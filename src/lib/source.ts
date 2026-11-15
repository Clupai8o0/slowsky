// Sky sources (Opus glue): everything between "show me this patch of sky" and a list of
// frames ready for the player. The UI talks only to SkySource; it never calls SIA, S3 or
// the WCS code itself. Two sources share the interface: live (SIA -> S3 range reads -> WCS ->
// wavelength lock -> regrid) and snapshot (the same steps on frames baked into public/snapshot).
// Runs in the page and in Web Workers (no DOM globals).
import type {
    CardValue, Cutout, Detector, FitsHeader, FitsIndex, FrameContext, FrameQuery, FrameRecord, OutputGrid, PixelBox, PixelCoord,
    PlayerFrame, RangeReader, RegriddedFrame, SkyCoord, Target, TargetId, WaveGrid, Wcs,
} from './types';
import { commonRange, lockWavelength, type LockedFrame } from './lock';
import { createRangeReader } from './fits';
import { searchFrames, type FrameList } from './sia';
import { makeWcs, wcsFromHeader } from './wcs';
import { groupVisits, sampleWave, sampleWaveLinear } from './wavelength';
import { pickByWavelength, predictPixel } from './footprint';
import { gridForView, gridPixToSky, gridSkyToPix, regridNorthUp, regridVariance } from './regrid';
import { positionAt, targetById } from './targets';
import { fetchGaia, type GaiaRow } from './gaia';
import { flagNames, parseFlagsLayout } from './flags';

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
    withVariance?: boolean; // default false; true adds RegriddedFrame.variance (see regridVariance for what it is; +50% bytes/frame live)
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
    // The cone the Gaia star list was loaded in. `cut`: the list was cut to its `kept` brightest stars.
    starCover?: { center: SkyCoord; radiusDeg: number; cut: boolean; kept?: number };
    track?: TrackPoint[]; // same order as frames; only with a target
    credits: string[]; // data credits to show under the player
    notes: string[]; // plain-language notes, e.g. "2 visits dropped: no frame within 0.02 µm"
    unusable?: number; // frames with no finite output pixels
    missed?: number; // frames left out because the view is off their detector or the spot is at its edge
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
    stallTimeoutMs?: number; // no progress while archive operations are pending (default 30000; above the proxy's 25 s limit)
    loadTimeoutMs?: number; // backstop for a whole load (default 600000); the stall limit is the real limit
}

export interface SnapshotOptions extends SourceOptions {
    baseUrl?: string; // where public/ is served (default '' = same site)
    fetch?: typeof fetch;
    timeoutMs?: number;
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
    context?: { url: string; flags?: FrameContext['flags'] };
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
    if (visits.length > max) {
        // More visits than reads: take max visits spread over the whole span, the middle frame of each.
        const picked = Array.from({ length: max }, (_, k) => visits[Math.floor((k + 0.5) * visits.length / max)] as FrameRecord[]);
        return picked.map((v) => v[Math.floor(v.length / 2)] as FrameRecord).sort((a, b) => a.tMin - b.tMin);
    }
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
        out.push('ESA, Gaia DPAC; Gaia DR3; CC BY-NC 3.0 IGO');
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
export function waveLattice(wave: WaveGrid, wcs: Wcs, grid: OutputGrid): NonNullable<RegriddedFrame['lambdaGrid']>
{
    const nx = 9, ny = 9, values = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const sky = gridPixToSky(grid, { x: i * (grid.width - 1) / (nx - 1), y: j * (grid.height - 1) / (ny - 1) });
            const pix = safeSkyToPix(wcs, sky);
            values[j * nx + i] = pix ? sampleWaveLinear(wave, pix).lambda : NaN;
        }
    }
    return { nx, ny, values };
}

async function assemble(
    req: SkyRequest,
    infos: FrameInfo[],
    frameVisits: FrameRecord[][],
    opts: SourceOptions,
    notes: string[],
    skippedVisits = 0,
    live = false,
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
    const dropped = visits.length - locked.length + skippedVisits;
    if (dropped > 0) {
        notes.push(`${plural(dropped, 'visit')} left out: no frame close enough to ${chosen.toFixed(3)} µm.`);
    }

    const total = locked.length;
    let done = 0;
    let unusable = 0;
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
        req.signal?.throwIfAborted();
        const data = regridNorthUp(cutout, info.wcs, grid);
        const atCentre = inside(centrePix, info.wcs.params.naxis, 0) ? sampleWave(info.wave, centrePix) : undefined;
        done++;
        req.onProgress?.({ stage: 'regrid', done, total });
        if (!data.some(Number.isFinite)) {
            unusable++;
            return undefined;
        }
        const frame: RegriddedFrame = {
            frame: l.frame,
            grid,
            data,
            lambdaAtCenter: atCentre?.lambda ?? l.lambda,
            ...(live ? { lambdaGrid: waveLattice(info.wave, info.wcs, grid) } : {}),
            bandwidthAtCenter: atCentre?.bandwidth ?? info.bandwidth,
            ...(info.context ? { context: { wcs: info.wcs, box, ...info.context } } : {}),
        };
        if (req.withVariance) {
            const variance = regridVariance(cutout, info.wcs, grid);
            // A map with no finite, positive pixel is no map: count the frame as missing.
            if (variance && variance.some((v) => Number.isFinite(v) && v > 0)) {
                frame.variance = variance;
            }
        }
        return { l, info, frame };
    });

    const kept = regridded.filter((r): r is NonNullable<typeof r> => r !== undefined);
    const missed = locked.length - kept.length - unusable;
    if (missed > 0) {
        notes.push(`${plural(missed, 'frame')} left out: the view is off the detector.`);
    }
    if (unusable > 0) {
        notes.push(`${plural(unusable, 'frame')} had no usable pixels here and ${unusable === 1 ? 'was' : 'were'} left out.`);
    }
    if (req.withVariance) {
        const missing = kept.filter((r) => !r.frame.variance).length;
        if (missing > 0) {
            notes.push(`Error maps could not be read for ${plural(missing, 'frame')}.`);
        }
    }
    const frames: PlayerFrame[] = kept.map((r) => ({ frame: r.frame, label: frameLabel(r.l.frame, r.l.lambda) }));
    const result: Omit<SkyResult, 'source' | 'stars' | 'credits'> = {
        grid,
        frames,
        locked: kept.map((r) => r.l),
        lambda: chosen,
        notes,
        ...(unusable > 0 ? { unusable } : {}),
        ...(missed > 0 ? { missed } : {}),
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

const GAIA_UNAVAILABLE_NOTE = 'Gaia stars are not available for this view.';
const GAIA_MAX_RADIUS_DEG = 0.2; // the widest cone gaia.ts accepts
const GAIA_GRACE_MS = 1500; // how long a finished picture waits for a slow catalogue

export class ArchiveTimeoutError extends Error {
    constructor(readonly reason: 'stall' | 'total')
    {
        super('Network request timed out.');
        this.name = 'ArchiveTimeoutError';
    }
}

// One clock follows progress across all pending archive operations in the load.
function archiveFetch(fetcher: typeof fetch, load: AbortController, timeoutMs: number): { fetch: typeof fetch; dispose: () => void }
{
    let pending = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const cleanups = new Set<() => void>();
    const arm = (): void => {
        clearTimeout(timer);
        timer = pending > 0 && !disposed && !load.signal.aborted
            ? setTimeout(() => load.abort(new ArchiveTimeoutError('stall')), timeoutMs) : undefined;
    };
    const start = (): ((progress: boolean) => void) => {
        if (pending++ === 0) {
            arm();
        }
        let finished = false;
        return (progress) => {
            if (finished) {
                return;
            }
            finished = true;
            pending--;
            if (progress || pending === 0) {
                arm();
            }
        };
    };
    const stopTimer = (): void => clearTimeout(timer);
    load.signal.addEventListener('abort', stopTimer, { once: true });
    const wrapped: typeof fetch = async (input, init) => {
        const request = new AbortController();
        const upstream = init?.signal;
        let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let onRequestAbort: () => void = () => {};
        const abort = (): void => request.abort(upstream?.aborted ? upstream.reason : load.signal.reason);
        const cleanup = (): void => {
            load.signal.removeEventListener('abort', onAbort);
            upstream?.removeEventListener('abort', onAbort);
            request.signal.removeEventListener('abort', onRequestAbort);
            cleanups.delete(cleanup);
        };
        const onAbort = (): void => {
            abort();
            if (bodyReader) {
                void bodyReader.cancel(request.signal.reason).catch(() => undefined);
            }
            cleanup();
        };
        load.signal.addEventListener('abort', onAbort, { once: true });
        upstream?.addEventListener('abort', onAbort, { once: true });
        cleanups.add(cleanup);
        if (load.signal.aborted || upstream?.aborted) {
            onAbort();
            throw request.signal.reason;
        }
        const cancelled = new Promise<never>((_resolve, reject) => {
            onRequestAbort = () => reject(request.signal.reason);
            request.signal.addEventListener('abort', onRequestAbort, { once: true });
        });
        const finishHeaders = start();
        try {
            const response = await Promise.race([fetcher(input, { ...init, signal: request.signal }), cancelled]);
            finishHeaders(true);
            if (request.signal.aborted) {
                void response.body?.cancel().catch(() => undefined);
                throw request.signal.reason;
            }
            if (!response.body) {
                cleanup();
                return response;
            }
            const reader = response.body.getReader();
            bodyReader = reader;
            let cancelling = false;
            const stream = new ReadableStream<Uint8Array>({
                async pull(controller)
                {
                    const finishRead = start();
                    try {
                        const chunk = await Promise.race([reader.read(), cancelled]);
                        finishRead(true);
                        if (chunk.done) {
                            if (!cancelling) {
                                cleanup();
                            }
                            controller.close();
                        } else {
                            controller.enqueue(chunk.value);
                        }
                    } catch (error) {
                        finishRead(false);
                        if (!cancelling) {
                            cleanup();
                        }
                        controller.error(error);
                    }
                },
                async cancel(reason)
                {
                    cancelling = true;
                    const finishCancel = start();
                    try {
                        await Promise.race([reader.cancel(reason), cancelled]);
                        finishCancel(true);
                    } catch (error) {
                        finishCancel(false);
                        throw error;
                    } finally {
                        cleanup();
                    }
                },
            }, { highWaterMark: 0 });
            return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (error) {
            finishHeaders(false);
            cleanup();
            throw error;
        }
    };
    return {
        fetch: wrapped,
        dispose()
        {
            disposed = true;
            clearTimeout(timer);
            load.signal.removeEventListener('abort', stopTimer);
            for (const cleanup of cleanups) {
                cleanup();
            }
        },
    };
}

// Runs the Gaia cone search beside the frame work. `rows` never rejects: undefined means "no catalogue".
function startCatalogue(req: SkyRequest, fetcher: typeof fetch): { rows: Promise<{ rows: GaiaRow[]; cut: boolean } | undefined>; radiusDeg: number; stop: () => void }
{
    const own = new AbortController();
    const onAbort = (): void => own.abort(req.signal?.reason);
    req.signal?.addEventListener('abort', onAbort, { once: true });
    const radiusDeg = Math.max(0.000001, Math.min(GAIA_MAX_RADIUS_DEG, req.fovDeg * Math.SQRT1_2));
    const rows = fetchGaia(req.center, radiusDeg, { signal: own.signal, fetcher, timeoutMs: 6000 })
        .then((found) => found, () => undefined);
    return {
        rows,
        radiusDeg,
        stop: () => {
            req.signal?.removeEventListener('abort', onAbort);
            own.abort();
        },
    };
}

// Waits for a promise at most `ms` longer: undefined when time runs out, a rejection when the caller aborts.
function settleWithin<T>(pending: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | undefined>
{
    return new Promise<T | undefined>((resolve, reject) => {
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve(undefined);
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
        pending.then((value) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error: unknown) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
}

function gaiaStarsOnGrid(rows: GaiaRow[], grid: OutputGrid): GaiaStar[]
{
    return rows.flatMap((row): GaiaStar[] => {
        const pix = gridSkyToPix(grid, { ra: row.ra, dec: row.dec });
        if (!(pix.x >= -0.5 && pix.y >= -0.5 && pix.x <= grid.width - 0.5 && pix.y <= grid.height - 0.5)) {
            return [];
        }
        return [{ ...row, pix }];
    }).sort((a, b) => a.g - b.g);
}

const DETECTOR_PX = 2040; // SPHEREx detectors are 2040 x 2040; only used to choose the probe frame
const GUESS_MAX_ERROR_PX = 40; // a probe guess further off than this means the corners can't be trusted
const GUESS_EDGE_PX = 20; // a guess this far outside the detector still counts as on it (guesses are ~10 px off)

interface ProbeRead {
    url?: string;
    index?: FitsIndex;
    wave?: WaveGrid;
    failed?: boolean;
    error?: unknown;
}

// When there are too many frames to read every header, guess each frame's wavelength at the spot from its corner
// positions (SIA s_region) and spend the reads on the frames nearest the chosen wavelength. Inside a visit the spot
// steps across the detector, and so across the filter, so frames spread evenly in time mostly miss it. The
// wavelength at a pixel is the same in every frame of one detector, so one frame's grid serves all. One "probe"
// header is read to get that grid and to check the guess. Returns undefined to fall back to thinning in time.
async function pickByGuess(
    frames: FrameRecord[],
    visits: FrameRecord[][],
    target: Target | undefined,
    req: SkyRequest,
    reader: RangeReader,
    opts: SourceOptions,
    max: number,
    probeRead: ProbeRead,
): Promise<{ frames: FrameRecord[]; skippedVisits: number } | undefined>
{
    if (max < 1) {
        return undefined;
    }
    let probe: FrameRecord | undefined;
    let probeDepth = 0;
    for (const f of frames) {
        if (!f.footprint) {
            return undefined;
        }
        const p = predictPixel(f.footprint, [DETECTOR_PX, DETECTOR_PX], lookPoint(target, req, f));
        if (!p) {
            continue;
        }
        const d = Math.min(p.x, p.y, DETECTOR_PX - 1 - p.x, DETECTOR_PX - 1 - p.y);
        if (d > probeDepth) {
            probe = f;
            probeDepth = d;
        }
    }
    if (!probe?.footprint) {
        return undefined;
    }
    try {
        probeRead.url = probe.url;
        const index = await reader.index(probe.url, req.signal);
        req.signal?.throwIfAborted();
        probeRead.index = index;
        const wcs = makeWcs(wcsFromHeader(index.hdu('IMAGE').header));
        const naxis = wcs.params.naxis;
        const look = lookPoint(target, req, probe);
        const truth = safeSkyToPix(wcs, look);
        const guess = predictPixel(probe.footprint, naxis, look);
        if (!truth || !inside(truth, naxis, 0) || !guess
            || Math.hypot(truth.x - guess.x, truth.y - guess.y) > GUESS_MAX_ERROR_PX) {
            return undefined;
        }
        // The footprint order is (-0.5,-0.5), (nx-0.5,-0.5), (nx-0.5,ny-0.5), (-0.5,ny-0.5).
        const corner0 = safeSkyToPix(wcs, probe.footprint[0]!);
        const corner1 = safeSkyToPix(wcs, probe.footprint[1]!);
        const corner2 = safeSkyToPix(wcs, probe.footprint[2]!);
        const corner3 = safeSkyToPix(wcs, probe.footprint[3]!);
        if (!corner0 || !corner1 || !corner2 || !corner3
            || Math.hypot(corner0.x + 0.5, corner0.y + 0.5) > GUESS_MAX_ERROR_PX
            || Math.hypot(corner1.x - (naxis[0] - 0.5), corner1.y + 0.5) > GUESS_MAX_ERROR_PX
            || Math.hypot(corner2.x - (naxis[0] - 0.5), corner2.y - (naxis[1] - 0.5)) > GUESS_MAX_ERROR_PX
            || Math.hypot(corner3.x + 0.5, corner3.y - (naxis[1] - 0.5)) > GUESS_MAX_ERROR_PX) {
            return undefined;
        }
        const wave = await reader.readWaveGrid(index, req.signal);
        req.signal?.throwIfAborted();
        probeRead.wave = wave;
        const guessed = new Map<string, { lambda: number; bandwidth: number }>();
        for (const f of frames) {
            if (!f.footprint) {
                return undefined;
            }
            const p = predictPixel(f.footprint, naxis, lookPoint(target, req, f));
            if (!p) {
                continue;
            }
            if (!inside(p, naxis, -GUESS_EDGE_PX)) {
                // Off the detector: never near any wavelength.
                guessed.set(f.obsId, { lambda: Infinity, bandwidth: 0 });
                continue;
            }
            const clamped = { x: Math.min(Math.max(p.x, 0), naxis[0] - 1), y: Math.min(Math.max(p.y, 0), naxis[1] - 1) };
            guessed.set(f.obsId, sampleWave(wave, clamped));
        }
        const lambdaOf = (f: FrameRecord): number | undefined => guessed.get(f.obsId)?.lambda;
        const limitOf = (f: FrameRecord): number => opts.maxDeltaUm ?? (guessed.get(f.obsId)?.bandwidth ?? 0) / 2;
        const known = visits.map((v) => v.filter((f) => Number.isFinite(lambdaOf(f) ?? NaN))).filter((v) => v.length > 0);
        const chosen = req.lambda ?? bestLambda(known, lambdaOf, limitOf, commonRange(known, lambdaOf));
        if (!Number.isFinite(chosen)) {
            return undefined;
        }
        function predicted(f: FrameRecord): number | undefined
        {
            const l = lambdaOf(f);
            // Off-detector guesses are known to be useless: a huge finite value makes their visit "far", not "unknown".
            return l === Infinity ? 1e9 : l;
        }
        const probeUrl = probe.url;
        let pick = pickByWavelength(visits, predicted, chosen, limitOf, max);
        if (pick.frames.length >= max && !pick.frames.some((f) => f.url === probeUrl)) {
            pick = pickByWavelength(visits, predicted, chosen, limitOf, max - 1);
        }
        return pick.frames.length > 0 ? pick : undefined;
    } catch (err) {
        if (req.signal?.aborted) {
            throw err;
        }
        probeRead.failed = true;
        probeRead.error = err;
        return undefined;
    }
}

export function createLiveSource(opts: LiveOptions & { fetch?: typeof fetch } = {}): SkySource
{
    const fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const gap = opts.visitGapDays ?? 10;
    return {
        async load(req: SkyRequest): Promise<SkyResult>
        {
            req.signal?.throwIfAborted();
            const callerSignal = req.signal;
            const controller = new AbortController();
            const abort = (): void => controller.abort(callerSignal?.reason);
            callerSignal?.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(() => controller.abort(new ArchiveTimeoutError('total')), opts.loadTimeoutMs ?? 600000);
            const archive = archiveFetch(fetcher, controller, opts.stallTimeoutMs ?? 30000);
            const timedFetch = archive.fetch;
            const reader = opts.reader ?? createRangeReader({ fetch: timedFetch });
            const search = opts.search ?? ((q: FrameQuery, signal?: AbortSignal) => searchFrames(q, signal, timedFetch));
            const loadReq = { ...req, signal: controller.signal };
            let onAbort: (() => void) | undefined;
            const cancelled = new Promise<never>((_resolve, reject) => {
                onAbort = () => reject(controller.signal.reason);
                controller.signal.addEventListener('abort', onAbort, { once: true });
            });
            async function work(req: SkyRequest): Promise<SkyResult>
            {
                const notes: string[] = [];
                const target = knownTarget(req.target);
                // Started now so it costs no waiting time; its failure is absorbed even if the frame work fails first.
                const catalogue = startCatalogue(req, fetcher);
                try {
                    req.onProgress?.({ stage: 'search', done: 0, total: 1 });
                    const found = await search({ center: req.center, radiusDeg: 0.001, detector: req.detector }, req.signal);
                    req.signal?.throwIfAborted();
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
                    let candidates = onDetector;
                    let skippedVisits = 0;
                    const probeRead: ProbeRead = {};
                    if (onDetector.length > maxHeaders) {
                        const pick = await pickByGuess(onDetector, visits, target, req, reader, opts, maxHeaders, probeRead);
                        if (pick) {
                            candidates = pick.frames;
                            skippedVisits = pick.skippedVisits;
                        } else if (probeRead.failed) {
                            const fallback = thinVisits(visits, maxHeaders);
                            candidates = thinVisits(visits, Math.max(0, maxHeaders - 1)).filter((frame) => frame.url !== probeRead.url);
                            const urls = new Set([probeRead.url, ...candidates.map((frame) => frame.url)]);
                            for (const frame of [...fallback, ...onDetector]) {
                                if (urls.size >= maxHeaders) {
                                    break;
                                }
                                if (!urls.has(frame.url)) {
                                    candidates.push(frame);
                                    urls.add(frame.url);
                                }
                            }
                            candidates.sort((a, b) => a.tMin - b.tMin);
                            if (candidates.length === 0) {
                                throw probeRead.error;
                            }
                        } else {
                            const fallback = thinVisits(visits, maxHeaders);
                            if (!probeRead.url || fallback.some((frame) => frame.url === probeRead.url)) {
                                candidates = fallback;
                            } else {
                                candidates = thinVisits(visits, Math.max(0, maxHeaders - 1));
                                const urls = new Set([probeRead.url, ...candidates.map((frame) => frame.url)]);
                                const budget = Math.min(maxHeaders, new Set(onDetector.map((frame) => frame.url)).size);
                                for (const frame of [...fallback, ...onDetector]) {
                                    if (urls.size >= budget) {
                                        break;
                                    }
                                    if (!urls.has(frame.url)) {
                                        candidates.push(frame);
                                        urls.add(frame.url);
                                    }
                                }
                                if (candidates.length === 0) {
                                    candidates = onDetector.filter((frame) => frame.url === probeRead.url).slice(0, 1);
                                }
                                candidates.sort((a, b) => a.tMin - b.tMin);
                            }
                        }
                    }
                    let done = 0;
                    let unreadable = probeRead.failed ? 1 : 0;
                    let firstError: unknown = probeRead.error;
                    const total = candidates.length;
                    req.onProgress?.({ stage: 'headers', done, total });
                    async function readInfo(record: FrameRecord): Promise<FrameInfo | undefined>
                    {
                        let info: FrameInfo | undefined;
                        try {
                            req.signal?.throwIfAborted();
                            const index = record.url === probeRead.url && probeRead.index
                                ? probeRead.index : await reader.index(record.url, req.signal);
                            req.signal?.throwIfAborted();
                            let flags: FrameContext['flags'];
                            const flagsHdu = index.hdus.find(hdu => hdu.name === 'FLAGS');
                            if (flagsHdu) {
                                try {
                                    flags = { layout: parseFlagsLayout(flagsHdu.header, flagsHdu.dataStart), names: flagNames(flagsHdu.header) };
                                } catch {
                                    // Unsupported FLAGS must not prevent the image from loading.
                                }
                            }
                            const header = index.hdu('IMAGE').header;
                            const wcs = makeWcs(wcsFromHeader(header));
                            const look = lookPoint(target, req, record);
                            const pix = safeSkyToPix(wcs, look);
                            if (pix && inside(pix, wcs.params.naxis, EDGE_MARGIN_PX)) {
                                const wave = record.url === probeRead.url && probeRead.wave
                                    ? probeRead.wave : await reader.readWaveGrid(index, req.signal);
                                req.signal?.throwIfAborted();
                                const sample = sampleWave(wave, pix);
                                const version = header.get('PIPEVERS') ?? header.get('VERSION');
                                const full: FrameRecord = typeof version === 'string' ? { ...record, pipelineVersion: version } : record;
                                info = {
                                    record: full,
                                    wcs,
                                    wave,
                                    lambda: sample.lambda,
                                    bandwidth: sample.bandwidth,
                                    context: { url: record.url, ...(flags ? { flags } : {}) },
                                    async loadCutout(box: PixelBox, signal?: AbortSignal): Promise<Cutout>
                                    {
                                        const [image, zodi, variance] = await Promise.all([
                                            reader.readFloat32(index, 'IMAGE', box, signal),
                                            reader.readFloat32(index, 'ZODI', box, signal),
                                            req.withVariance
                                                ? reader.readFloat32(index, 'VARIANCE', box, signal).catch((e: unknown) => {
                                                    if (signal?.aborted) {
                                                        throw e;
                                                    }
                                                    return undefined;
                                                })
                                                : undefined,
                                        ]);
                                        const cutout: Cutout = {
                                            frame: full, box, width: box.x1 - box.x0, height: box.y1 - box.y0,
                                            image, zodi, wcs: wcs.params, wave, header,
                                        };
                                        if (variance) {
                                            cutout.variance = variance;
                                        }
                                        return cutout;
                                    },
                                };
                                if (target) {
                                    info.trackSky = look;
                                }
                            }
                        } catch (err) {
                            if (req.signal?.aborted) {
                                throw err;
                            }
                            if (unreadable === 0) {
                                firstError = err;
                            }
                            unreadable++;
                        }
                        return info;
                    }
                    const infos = await mapLimit(candidates, opts.concurrency ?? 4, async (record) => {
                        const info = await readInfo(record);
                        done++;
                        req.onProgress?.({ stage: 'headers', done, total });
                        return info;
                    });
                    let usable = infos.filter((f): f is FrameInfo => f !== undefined);
                    let reusedProbe = false;
                    if (usable.length === 0 && unreadable > 0 && probeRead.index && probeRead.wave
                        && !candidates.some((frame) => frame.url === probeRead.url)) {
                        const probe = onDetector.find((frame) => frame.url === probeRead.url);
                        if (probe) {
                            const info = await readInfo(probe);
                            if (info) {
                                usable = [info];
                                reusedProbe = true;
                            }
                        }
                    }
                    if (candidates.length < onDetector.length) {
                        notes.push(`Read ${candidates.length + (reusedProbe ? 1 : 0)} of ${onDetector.length} frames to keep loading quick.`);
                    }
                    if (unreadable > 0) {
                        if (usable.length === 0) {
                            throw firstError;
                        }
                        notes.push(`${plural(unreadable, 'frame')} could not be read.`);
                    }
                    const atEdge = candidates.length - infos.filter((f) => f !== undefined).length - (unreadable - (probeRead.failed ? 1 : 0));
                    if (atEdge > 0) {
                        notes.push(`${plural(atEdge, 'frame')} left out: the spot is at the detector edge.`);
                    }
                    const core = await assemble(req, usable, visits, opts, notes, skippedVisits, true);
                    if (atEdge > 0) {
                        core.missed = (core.missed ?? 0) + atEdge;
                    }
                    // The picture is ready: give a slow catalogue a short grace time, then go on without it.
                    const rows = await settleWithin(catalogue.rows, GAIA_GRACE_MS, req.signal);
                    req.signal?.throwIfAborted();
                    const stars = rows ? gaiaStarsOnGrid(rows.rows, core.grid) : [];
                    if (!rows) {
                        notes.push(GAIA_UNAVAILABLE_NOTE);
                    } else if (stars.length > 0 && req.fovDeg * Math.SQRT1_2 > GAIA_MAX_RADIUS_DEG) {
                        notes.push(`Gaia stars are shown only within ${GAIA_MAX_RADIUS_DEG}° of the centre.`);
                    }
                    const records = core.frames.map((f) => f.frame.frame);
                    return { source: 'live', stars, credits: credits(records, stars.length > 0), ...core,
                        ...(rows ? { starCover: { center: req.center, radiusDeg: catalogue.radiusDeg, cut: rows.cut, kept: rows.rows.length } } : {}) };
                } finally {
                    catalogue.stop();
                }
            }
            try {
                return await Promise.race([work(loadReq), cancelled]);
            } catch (error) {
                controller.abort(error);
                throw error;
            } finally {
                clearTimeout(timer);
                callerSignal?.removeEventListener('abort', abort);
                if (onAbort) {
                    controller.signal.removeEventListener('abort', onAbort);
                }
                archive.dispose();
            }
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
// Bound each saved-copy request, including its body read.
// One deadline for headers and body. The files are 150 to 200 KB and load four at a time, so 30 s still lets a
// 0.4 Mbit/s phone finish, and a stalled connection cannot hang the page.
export const SNAPSHOT_TIMEOUT_MS = 30_000;

export function createSnapshotSource(opts: SnapshotOptions = {}): SkySource
{
    const base = (opts.baseUrl ?? '').replace(/\/$/, '');
    const fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const indexCache = new Map<string, Promise<SnapshotIndexJson>>();

    async function getBody<T>(path: string, read: (response: Response) => Promise<T>, signal?: AbortSignal): Promise<T>
    {
        signal?.throwIfAborted();
        const controller = new AbortController();
        let onAbort!: () => void;
        let timer!: ReturnType<typeof setTimeout>;
        const interrupted = new Promise<never>((_resolve, reject) => {
            onAbort = () => { controller.abort(signal?.reason); reject(signal?.reason); };
            signal?.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(() => {
                controller.abort();
                reject(new SkyUnavailable(`The saved copy timed out reading ${path}.`));
            }, opts.timeoutMs ?? SNAPSHOT_TIMEOUT_MS);
        });
        try {
            return await Promise.race([interrupted, (async () => {
                const response = await fetcher(`${base}${path}`, { signal: controller.signal });
                if (!response.ok) {
                    throw new SkyUnavailable(`Snapshot file ${path} answered ${response.status}`);
                }
                return await read(response);
            })()]);
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }
    }

    async function getJson<T>(path: string, signal?: AbortSignal): Promise<T>
    {
        return getBody(path, async (response) => await response.json() as T, signal);
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
                throw new SkyUnavailable('The saved copy only has the five official targets.');
            }
            const target = knownTarget(req.target) as Target;
            const notes: string[] = ['Saved copy of real SPHEREx frames, stored with this page.'];
            req.onProgress?.({ stage: 'search', done: 0, total: 1 });
            const index = await getIndex(req.target, req.signal);
            req.onProgress?.({ stage: 'search', done: 1, total: 1 });
            const onDetector = index.frames.filter((f) => f.record.detector === req.detector);
            const visits = groupVisits(onDetector.map((f) => f.record), opts.visitGapDays ?? 10);
            if (onDetector.length === 0) {
                notes.push(`The saved copy has detector ${target.detector} only for this target.`);
            }
            if (onDetector.length > 0) {
                // The baked boxes follow the star at frame time and span about 0.19 deg, so centre there and keep the view inside.
                const meanMjd = onDetector.reduce((a, f) => a + mid(f.record), 0) / onDetector.length;
                const center = positionAt(target.astrometry, meanMjd);
                const fovDeg = Math.min(req.fovDeg, SNAPSHOT_MAX_FOV_DEG);
                if (fovDeg < req.fovDeg) {
                    notes.push(`The saved copy limits the field to ${SNAPSHOT_MAX_FOV_DEG}°.`);
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
                        const buf = await getBody(`/snapshot/${req.target}/${f.file}`, (response) => response.arrayBuffer(), signal);
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
                        const variance = req.withVariance ? plane('VARIANCE') : undefined;
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
                notes.push(GAIA_UNAVAILABLE_NOTE);
            }
            const records = core.frames.map((f) => f.frame.frame);
            return { source: 'snapshot', stars, credits: credits(records, stars.length > 0), ...core };
        },
    };
}
