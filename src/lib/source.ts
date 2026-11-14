// Sky sources (Opus glue): everything between "show me this patch of sky" and a list of
// frames ready for the player. The UI talks only to SkySource; it never calls SIA, S3 or
// the WCS code itself. Two sources share the interface: live (SIA -> S3 range reads -> WCS ->
// wavelength lock -> regrid) and snapshot (the same steps on frames baked into public/snapshot).
// Runs in the page and in Web Workers (no DOM globals).
import type {
    CardValue, Cutout, Detector, FitsHeader, FrameQuery, FrameRecord, OutputGrid, PixelBox, PixelCoord,
    PlayerFrame, RangeReader, RegriddedFrame, SkyCoord, Target, TargetId, WaveGrid, Wcs,
} from './types';
import { commonRange, lockWavelength, type LockedFrame } from './lock';
import { createRangeReader } from './fits';
import { searchFrames, type FrameList } from './sia';
import { makeWcs, wcsFromHeader } from './wcs';
import { groupVisits, sampleWave } from './wavelength';
import { gridForView, gridSkyToPix, regridNorthUp } from './regrid';
import { positionAt, targetById } from './targets';

export type SkyStage = 'search' | 'headers' | 'pixels' | 'regrid';

export interface SkyProgress {
    stage: SkyStage;
    done: number;
    total: number;
}

export interface SkyRequest {
    center: SkyCoord; // centre of the view, fixed on the sky for every frame
    fovDeg: number;
    detector: Detector;
    lambda?: number; // µm; unset = the middle of the range every visit can reach
    target?: TargetId; // known target: its moving position is tracked and marked
    signal?: AbortSignal;
    onProgress?(p: SkyProgress): void;
}

// A Gaia DR3 star for the overlay, with its position already in grid pixels.
export interface GaiaStar {
    sourceId: string;
    ra: number; // deg, at the Gaia epoch
    dec: number;
    g: number; // G magnitude
    pmRa?: number; // mas/yr, includes cos(dec)
    pmDec?: number;
    parallax?: number; // mas
    epochJyear: number; // 2016.0 for DR3
    pix: PixelCoord; // on the output grid, at the Gaia epoch
}

// Where the target is in one frame.
export interface TrackPoint {
    mjd: number;
    ra: number;
    dec: number;
    pix: PixelCoord; // on the output grid
}

export interface SkyResult {
    source: 'live' | 'snapshot';
    grid: OutputGrid;
    frames: PlayerFrame[]; // sorted by time; label = date and wavelength
    locked: LockedFrame[]; // same order as frames: lambda and dLambda per frame
    lambda: number; // the wavelength the frames are locked to, µm
    lambdaRange?: [number, number]; // what every visit can reach, µm
    stars: GaiaStar[]; // empty when no catalogue is available for this view
    track?: TrackPoint[]; // same order as frames; only with a target
    credits: string[]; // data credits to show under the player
    notes: string[]; // plain-language notes, e.g. "2 visits dropped: no frame within 0.02 µm"
}

export interface SkySource {
    load(req: SkyRequest): Promise<SkyResult>;
}

// Thrown when a source cannot serve a request at all (e.g. the snapshot has no such target).
export class SkyUnavailable extends Error {}

// ---------- tuning ----------

export interface SourceOptions {
    visitGapDays?: number; // frames further apart than this start a new visit (default 10)
    minScreenPx?: number; // output pixels per SPHEREx pixel (default 4)
    maxSide?: number; // largest output grid side (default 721)
    // A visit is kept only if its nearest frame is within this many µm of the chosen
    // wavelength. Default: half of that frame's own bandwidth, so the chosen wavelength
    // lies inside the frame's passband.
    maxDeltaUm?: number;
    concurrency?: number; // frames worked on at once (default 4)
}

export interface LiveOptions extends SourceOptions {
    search?: (q: FrameQuery, signal?: AbortSignal) => Promise<FrameRecord[]>;
    reader?: RangeReader;
    maxHeaders?: number; // most frames whose headers are read (default 60); every visit is kept
}

export interface SnapshotOptions extends SourceOptions {
    baseUrl?: string; // where public/ is served (default '' = same site)
    fetch?: typeof fetch;
}

const NATIVE_ARCSEC = 6.15;
const EDGE_MARGIN_PX = 4; // the target must be this far inside the detector to get a wavelength

// ---------- shared steps ----------

// What we know about a frame once its header and wavelength grid are in hand.
interface FrameInfo {
    record: FrameRecord;
    wcs: Wcs;
    wave: WaveGrid;
    lambda: number; // at the target (or the view centre)
    bandwidth: number;
    trackSky?: SkyCoord; // target at this frame's time
    loadCutout(box: PixelBox, signal?: AbortSignal): Promise<Cutout>;
}

function mid(f: FrameRecord): number
{
    return (f.tMin + f.tMax) / 2;
}

// Calendar date of an MJD, UTC, as YYYY-MM-DD.
export function mjdToDate(mjd: number): string
{
    const ms = (mjd - 40587) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
}

export function frameLabel(f: FrameRecord, lambda: number): string
{
    return `${mjdToDate(mid(f))} · ${lambda.toFixed(3)} µm`;
}

function inside(p: PixelCoord, naxis: [number, number], margin: number): boolean
{
    return p.x >= margin && p.y >= margin && p.x <= naxis[0] - 1 - margin && p.y <= naxis[1] - 1 - margin;
}

function safeSkyToPix(wcs: Wcs, c: SkyCoord): PixelCoord | undefined
{
    try {
        const p = wcs.skyToPix(c);
        return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : undefined;
    } catch {
        return undefined;
    }
}

// Detector box that covers the whole view around centrePix, clipped to the detector.
// Half side is the view's half diagonal (any rotation) plus 2 pixels for interpolation.
export function boxForView(centrePix: PixelCoord, fovDeg: number, naxis: [number, number]): PixelBox | undefined
{
    const half = Math.ceil(fovDeg * 3600 / NATIVE_ARCSEC * Math.SQRT1_2) + 2;
    const x0 = Math.max(0, Math.floor(centrePix.x) - half);
    const y0 = Math.max(0, Math.floor(centrePix.y) - half);
    const x1 = Math.min(naxis[0], Math.floor(centrePix.x) + half + 1);
    const y1 = Math.min(naxis[1], Math.floor(centrePix.y) + half + 1);
    if (x1 <= x0 || y1 <= y0) {
        return undefined;
    }
    return { x0, y0, x1, y1 };
}

// Runs fn over items with at most `limit` running at once; keeps order; rejects on the first error.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]>
{
    const out = new Array<R>(items.length);
    let next = 0;
    async function worker(): Promise<void>
    {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i] as T, i);
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return out;
}

// Keeps every visit and thins frames evenly inside visits until at most max remain.
export function thinFrames(frames: FrameRecord[], gapDays: number, max: number): FrameRecord[]
{
    if (frames.length <= max) {
        return frames;
    }
    return thinVisits(groupVisits(frames, gapDays), max);
}

function thinVisits(visits: FrameRecord[][], max: number): FrameRecord[]
{
    const perVisit = Math.max(1, Math.floor(max / Math.max(1, visits.length)));
    const kept: FrameRecord[] = [];
    for (const v of visits) {
        if (v.length <= perVisit) {
            kept.push(...v);
            continue;
        }
        for (let k = 0; k < perVisit; k++) {
            kept.push(v[Math.floor((k + 0.5) * v.length / perVisit)] as FrameRecord);
        }
    }
    return kept.sort((a, b) => a.tMin - b.tMin);
}

function credits(records: FrameRecord[], withGaia: boolean): string[]
{
    const out: string[] = [];
    if (records.some((r) => r.release === 'dr1')) {
        out.push('SPHEREx DR1, NASA/IPAC Infrared Science Archive, doi:10.26131/IRSA678');
    }
    if (records.some((r) => r.release === 'qr3')) {
        out.push('SPHEREx QR3, NASA/IPAC Infrared Science Archive, doi:10.26131/IRSA662');
    }
    if (withGaia) {
        out.push('ESA/Gaia/DPAC, Gaia DR3, CC BY-NC 3.0 IGO');
    }
    return out;
}

function plural(n: number, word: string): string
{
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// The default wavelength: the one that keeps the most visits (each visit needs a frame whose
// passband holds it). Ties go to the value nearest the middle of the common range, else of all.
export function bestLambda(
    visits: FrameRecord[][],
    lambdaOf: (f: FrameRecord) => number | undefined,
    limitOf: (f: FrameRecord) => number,
    range?: [number, number],
): number
{
    const all: number[] = [];
    const ends: number[] = [];
    for (const v of visits) {
        for (const f of v) {
            const l = lambdaOf(f);
            if (l !== undefined && Number.isFinite(l)) {
                all.push(l);
                const limit = limitOf(f);
                ends.push(...[l - limit, l + limit].filter(Number.isFinite));
            }
        }
    }
    if (all.length === 0) {
        return NaN;
    }
    all.sort((a, b) => a - b);
    ends.sort((a, b) => a - b);
    const candidates = all.slice();
    for (let i = 1; i < ends.length; i++) {
        candidates.push(((ends[i - 1] as number) + (ends[i] as number)) / 2);
    }
    const middle = range ? (range[0] + range[1]) / 2 : ((all[0] as number) + (all[all.length - 1] as number)) / 2;
    let best = all[0] as number;
    let bestCount = -1;
    for (const c of candidates) {
        let count = 0;
        for (const v of visits) {
            if (v.some((f) => {
                const l = lambdaOf(f);
                return l !== undefined && Math.abs(l - c) <= limitOf(f);
            })) {
                count++;
            }
        }
        if (count > bestCount || (count === bestCount && Math.abs(c - middle) < Math.abs(best - middle))) {
            best = c;
            bestCount = count;
        }
    }
    return best;
}

// Lock, cut out and regrid. Shared by both sources.
async function assemble(
    req: SkyRequest,
    infos: FrameInfo[],
    frameVisits: FrameRecord[][],
    opts: SourceOptions,
    notes: string[],
): Promise<Omit<SkyResult, 'source' | 'stars' | 'credits'>>
{
    const grid = gridForView(req.center, req.fovDeg, opts.minScreenPx ?? 4, opts.maxSide ?? 721);
    if (infos.length === 0) {
        return { grid, frames: [], locked: [], lambda: req.lambda ?? NaN, notes };
    }
    const byId = new Map(infos.map((f) => [f.record.obsId, f]));
    const lambdaOf = (r: FrameRecord): number | undefined => byId.get(r.obsId)?.lambda;
    const visits = frameVisits.map((v) => v.flatMap((r) => {
        const info = byId.get(r.obsId);
        return info ? [info.record] : [];
    })).filter((v) => v.length > 0);
    const range = commonRange(visits, lambdaOf);
    const limitOf = (r: FrameRecord): number => opts.maxDeltaUm ?? (byId.get(r.obsId) as FrameInfo).bandwidth / 2;
    const chosen = req.lambda ?? bestLambda(visits, lambdaOf, limitOf, range);
    if (!Number.isFinite(chosen)) {
        notes.push('No usable wavelength in these frames.');
        return { grid, frames: [], locked: [], lambda: NaN, notes };
    }
    const locked = lockWavelength(visits, lambdaOf, chosen, { limitOf });
    const dropped = visits.length - locked.length;
    if (dropped > 0) {
        notes.push(`${plural(dropped, 'visit')} left out: no frame close enough to ${chosen.toFixed(3)} µm.`);
    }

    const total = locked.length;
    let done = 0;
    req.onProgress?.({ stage: 'pixels', done, total });
    const regridded = await mapLimit(locked, opts.concurrency ?? 4, async (l) => {
        req.signal?.throwIfAborted();
        const info = byId.get(l.frame.obsId) as FrameInfo;
        const centrePix = safeSkyToPix(info.wcs, req.center);
        const box = centrePix ? boxForView(centrePix, req.fovDeg, info.wcs.params.naxis) : undefined;
        if (!centrePix || !box) {
            return undefined;
        }
        const cutout = await info.loadCutout(box, req.signal);
        const data = regridNorthUp(cutout, info.wcs, grid);
        const atCentre = inside(centrePix, info.wcs.params.naxis, 0) ? sampleWave(info.wave, centrePix) : undefined;
        done++;
        req.onProgress?.({ stage: 'regrid', done, total });
        const frame: RegriddedFrame = {
            frame: l.frame,
            grid,
            data,
            lambdaAtCenter: atCentre?.lambda ?? l.lambda,
            bandwidthAtCenter: atCentre?.bandwidth ?? info.bandwidth,
        };
        return { l, info, frame };
    });

    const kept = regridded.filter((r): r is NonNullable<typeof r> => r !== undefined);
    if (kept.length < locked.length) {
        notes.push(`${plural(locked.length - kept.length, 'frame')} left out: the view is off the detector.`);
    }
    const frames: PlayerFrame[] = kept.map((r) => ({ frame: r.frame, label: frameLabel(r.l.frame, r.l.lambda) }));
    const result: Omit<SkyResult, 'source' | 'stars' | 'credits'> = {
        grid,
        frames,
        locked: kept.map((r) => r.l),
        lambda: chosen,
        notes,
    };
    if (range) {
        result.lambdaRange = range;
    }
    if (req.target) {
        result.track = kept.flatMap((r) => {
            const sky = r.info.trackSky;
            if (!sky) {
                return [];
            }
            return [{ mjd: mid(r.l.frame), ra: sky.ra, dec: sky.dec, pix: gridSkyToPix(grid, sky) }];
        });
    }
    return result;
}

// Where to measure the wavelength in a frame: the target at the frame's time, else the view centre.
function lookPoint(target: Target | undefined, req: SkyRequest, record: FrameRecord): SkyCoord
{
    return target ? positionAt(target.astrometry, mid(record)) : req.center;
}

function knownTarget(id: TargetId | undefined): Target | undefined
{
    if (!id) {
        return undefined;
    }
    const t = targetById(id);
    if (!t) {
        throw new SkyUnavailable(`Unknown target ${id}`);
    }
    return t;
}

// ---------- live ----------

export function createLiveSource(opts: LiveOptions = {}): SkySource
{
    const reader = opts.reader ?? createRangeReader();
    const search = opts.search ?? ((q: FrameQuery, signal?: AbortSignal) => searchFrames(q, signal));
    const gap = opts.visitGapDays ?? 10;
    return {
        async load(req: SkyRequest): Promise<SkyResult>
        {
            const notes: string[] = [];
            const target = knownTarget(req.target);
            req.onProgress?.({ stage: 'search', done: 0, total: 1 });
            const found = await search({ center: req.center, radiusDeg: 0.001, detector: req.detector }, req.signal);
            const onDetector = found.filter((f) => f.detector === req.detector);
            req.onProgress?.({ stage: 'search', done: 1, total: 1 });
            if ((found as FrameList).truncated) {
                notes.push('This spot has more frames than the archive lists at once, so some visits may be missing.');
            }
            if (onDetector.length === 0) {
                notes.push(`No SPHEREx frames on detector ${req.detector} cover this spot yet.`);
            }
            const visits = groupVisits(onDetector, gap);
            const maxHeaders = opts.maxHeaders ?? 60;
            const candidates = onDetector.length <= maxHeaders ? onDetector : thinVisits(visits, maxHeaders);
            if (candidates.length < onDetector.length) {
                notes.push(`Read ${candidates.length} of ${onDetector.length} frames to keep loading quick.`);
            }
            let done = 0;
            const total = candidates.length;
            req.onProgress?.({ stage: 'headers', done, total });
            const infos = await mapLimit(candidates, opts.concurrency ?? 4, async (record): Promise<FrameInfo | undefined> => {
                req.signal?.throwIfAborted();
                const index = await reader.index(record.url, req.signal);
                const header = index.hdu('IMAGE').header;
                const wcs = makeWcs(wcsFromHeader(header));
                const look = lookPoint(target, req, record);
                const pix = safeSkyToPix(wcs, look);
                done++;
                req.onProgress?.({ stage: 'headers', done, total });
                if (!pix || !inside(pix, wcs.params.naxis, EDGE_MARGIN_PX)) {
                    return undefined;
                }
                const wave = await reader.readWaveGrid(index, req.signal);
                const sample = sampleWave(wave, pix);
                const version = header.get('PIPEVERS') ?? header.get('VERSION');
                const full: FrameRecord = typeof version === 'string' ? { ...record, pipelineVersion: version } : record;
                const info: FrameInfo = {
                    record: full,
                    wcs,
                    wave,
                    lambda: sample.lambda,
                    bandwidth: sample.bandwidth,
                    async loadCutout(box: PixelBox, signal?: AbortSignal): Promise<Cutout>
                    {
                        const [image, zodi] = await Promise.all([
                            reader.readFloat32(index, 'IMAGE', box, signal),
                            reader.readFloat32(index, 'ZODI', box, signal),
                        ]);
                        return {
                            frame: full, box, width: box.x1 - box.x0, height: box.y1 - box.y0,
                            image, zodi, wcs: wcs.params, wave, header,
                        };
                    },
                };
                if (target) {
                    info.trackSky = look;
                }
                return info;
            });
            const usable = infos.filter((f): f is FrameInfo => f !== undefined);
            if (usable.length < candidates.length) {
                notes.push(`${plural(candidates.length - usable.length, 'frame')} left out: the spot is at the detector edge.`);
            }
            const core = await assemble(req, usable, visits, opts, notes);
            const records = core.frames.map((f) => f.frame.frame);
            return { source: 'live', stars: [], credits: credits(records, false), ...core };
        },
    };
}

// ---------- snapshot ----------

interface SnapshotFrameJson {
    record: FrameRecord & { sizeBytes?: number };
    box: PixelBox;
    planes: string[];
    file: string;
    imageHeader: Record<string, CardValue>;
    wave: { xs: number[]; ys: number[]; lambda: number[][]; bandwidth: number[][]; pixelOrigin?: number };
}

interface SnapshotIndexJson {
    target: Target;
    madeBy: string;
    madeAt: string;
    frames: SnapshotFrameJson[];
}

interface GaiaJson {
    credit: string;
    sources: Array<{
        source_id: string | number;
        ra: number;
        dec: number;
        pmra?: number | null;
        pmdec?: number | null;
        parallax?: number | null;
        phot_g_mean_mag: number;
        ref_epoch?: number;
    }>;
}

// A FitsHeader over a plain keyword -> value object (the baked IMAGE header cards).
export function headerFromCards(cards: Record<string, CardValue>): FitsHeader
{
    const map = new Map<string, CardValue>(Object.entries(cards));
    return {
        cards: map,
        history: [],
        get(key: string): CardValue | undefined
        {
            return map.get(key);
        },
        num(key: string): number
        {
            const v = map.get(key);
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                throw new Error(`Header card ${key} is missing or not a number`);
            }
            return v;
        },
    };
}

function snapshotWave(w: SnapshotFrameJson['wave']): WaveGrid
{
    const shift = w.pixelOrigin === 1 ? 1 : 0;
    return {
        xs: w.xs.map((x) => x - shift),
        ys: w.ys.map((y) => y - shift),
        lambda: w.lambda,
        bandwidth: w.bandwidth,
    };
}

function optionalNumber(v: number | null | undefined): number | undefined
{
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const SNAPSHOT_MAX_FOV_DEG = 0.1;

export function createSnapshotSource(opts: SnapshotOptions = {}): SkySource
{
    const base = (opts.baseUrl ?? '').replace(/\/$/, '');
    const fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const indexCache = new Map<string, Promise<SnapshotIndexJson>>();

    async function getJson<T>(path: string, signal?: AbortSignal): Promise<T>
    {
        const response = await fetcher(`${base}${path}`, { signal });
        if (!response.ok) {
            throw new SkyUnavailable(`Snapshot file ${path} answered ${response.status}`);
        }
        return await response.json() as T;
    }

    async function getIndex(id: TargetId, signal?: AbortSignal): Promise<SnapshotIndexJson>
    {
        signal?.throwIfAborted();
        let p = indexCache.get(id);
        if (!p) {
            p = getJson<SnapshotIndexJson>(`/snapshot/${id}/index.json`);
            p.catch(() => indexCache.delete(id));
            indexCache.set(id, p);
        }
        if (!signal) {
            return p;
        }
        let onAbort!: () => void;
        const aborted = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) {
                onAbort();
            }
        });
        try {
            return await Promise.race([p, aborted]);
        } finally {
            signal.removeEventListener('abort', onAbort);
        }
    }

    return {
        async load(req: SkyRequest): Promise<SkyResult>
        {
            if (!req.target) {
                throw new SkyUnavailable('The offline copy only has the five official targets.');
            }
            const target = knownTarget(req.target) as Target;
            const notes: string[] = ['Offline copy of real SPHEREx frames, baked for this target.'];
            req.onProgress?.({ stage: 'search', done: 0, total: 1 });
            const index = await getIndex(req.target, req.signal);
            req.onProgress?.({ stage: 'search', done: 1, total: 1 });
            const onDetector = index.frames.filter((f) => f.record.detector === req.detector);
            const visits = groupVisits(onDetector.map((f) => f.record), opts.visitGapDays ?? 10);
            if (onDetector.length === 0) {
                notes.push(`The offline copy has detector ${target.detector} only for this target.`);
            }
            if (onDetector.length > 0) {
                // The baked boxes follow the star at frame time and span about 0.19 deg, so centre there and keep the view inside.
                const meanMjd = onDetector.reduce((a, f) => a + mid(f.record), 0) / onDetector.length;
                const center = positionAt(target.astrometry, meanMjd);
                const fovDeg = Math.min(req.fovDeg, SNAPSHOT_MAX_FOV_DEG);
                if (fovDeg < req.fovDeg) {
                    notes.push(`The offline copy limits the field to ${SNAPSHOT_MAX_FOV_DEG}°.`);
                }
                req = { ...req, center, fovDeg };
            }
            const infos: FrameInfo[] = [];
            let missingScale = 0;
            for (const f of onDetector) {
                const finite = (key: string): boolean => {
                    const value = f.imageHeader[key];
                    return typeof value === 'number' && Number.isFinite(value);
                };
                const anyCd = ['CD1_1', 'CD1_2', 'CD2_1', 'CD2_2'].some((key) => f.imageHeader[key] !== undefined);
                // Mirror wcsFromHeader: with any CD key present, missing ones default to 0.
                const hasScale = anyCd
                    ? ['CD1_1', 'CD2_2'].every(finite)
                    : ['CDELT1', 'CDELT2'].every(finite);
                if (!hasScale) {
                    missingScale++;
                    continue;
                }
                const header = headerFromCards(f.imageHeader);
                const wcs = makeWcs(wcsFromHeader(header));
                const wave = snapshotWave(f.wave);
                const record: FrameRecord = { ...f.record };
                const look = lookPoint(target, req, record);
                const pix = safeSkyToPix(wcs, look);
                if (!pix || !inside(pix, wcs.params.naxis, EDGE_MARGIN_PX)) {
                    continue;
                }
                const sample = sampleWave(wave, pix);
                const stored = f.box;
                const info: FrameInfo = {
                    record,
                    wcs,
                    wave,
                    lambda: sample.lambda,
                    bandwidth: sample.bandwidth,
                    trackSky: look,
                    async loadCutout(_box: PixelBox, signal?: AbortSignal): Promise<Cutout>
                    {
                        // The baked box is fixed; regrid leaves NaN where the view runs past it.
                        const response = await fetcher(`${base}/snapshot/${req.target}/${f.file}`, { signal });
                        if (!response.ok) {
                            throw new SkyUnavailable(`Snapshot file ${f.file} answered ${response.status}`);
                        }
                        const buf = await response.arrayBuffer();
                        const width = stored.x1 - stored.x0;
                        const height = stored.y1 - stored.y0;
                        const n = width * height;
                        if (buf.byteLength !== n * 4 * f.planes.length) {
                            throw new Error(`Snapshot file ${f.file} has ${buf.byteLength} bytes, expected ${n * 4 * f.planes.length}`);
                        }
                        const view = new DataView(buf);
                        const plane = (name: string): Float32Array | undefined => {
                            const k = f.planes.indexOf(name);
                            if (k < 0) {
                                return undefined;
                            }
                            const out = new Float32Array(n);
                            for (let i = 0; i < n; i++) {
                                out[i] = view.getFloat32((k * n + i) * 4, true);
                            }
                            return out;
                        };
                        const image = plane('IMAGE');
                        if (!image) {
                            throw new Error(`Snapshot file ${f.file} has no IMAGE plane`);
                        }
                        const cutout: Cutout = { frame: record, box: stored, width, height, image, wcs: wcs.params, wave, header };
                        const zodi = plane('ZODI');
                        const variance = plane('VARIANCE');
                        if (zodi) {
                            cutout.zodi = zodi;
                        }
                        if (variance) {
                            cutout.variance = variance;
                        }
                        return cutout;
                    },
                };
                infos.push(info);
            }
            if (missingScale > 0) {
                const note = `${missingScale} offline frames lack a pixel scale and were skipped.`;
                notes.push(note);
                if (infos.length === 0) {
                    throw new SkyUnavailable(note);
                }
            }
            const core = await assemble(req, infos, visits, opts, notes);
            let stars: GaiaStar[] = [];
            try {
                const gaia = await getJson<GaiaJson>(`/snapshot/${req.target}/gaia.json`, req.signal);
                stars = gaia.sources.flatMap((s): GaiaStar[] => {
                    const pix = gridSkyToPix(core.grid, { ra: s.ra, dec: s.dec });
                    if (!(pix.x >= -0.5 && pix.y >= -0.5 && pix.x <= core.grid.width - 0.5 && pix.y <= core.grid.height - 0.5)) {
                        return [];
                    }
                    const star: GaiaStar = {
                        sourceId: String(s.source_id), ra: s.ra, dec: s.dec, g: s.phot_g_mean_mag,
                        epochJyear: s.ref_epoch ?? 2016.0, pix,
                    };
                    const pmRa = optionalNumber(s.pmra);
                    const pmDec = optionalNumber(s.pmdec);
                    const parallax = optionalNumber(s.parallax);
                    if (pmRa !== undefined) {
                        star.pmRa = pmRa;
                    }
                    if (pmDec !== undefined) {
                        star.pmDec = pmDec;
                    }
                    if (parallax !== undefined) {
                        star.parallax = parallax;
                    }
                    return [star];
                });
            } catch (error) {
                req.signal?.throwIfAborted();
                notes.push('Gaia stars are not available for this view.');
            }
            const records = core.frames.map((f) => f.frame.frame);
            return { source: 'snapshot', stars, credits: credits(records, stars.length > 0), ...core };
        },
    };
}
