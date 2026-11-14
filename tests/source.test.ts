import { describe, expect, it } from 'vitest';
import {
    boxForView, createLiveSource, createSnapshotSource, frameLabel, headerFromCards, mjdToDate, SkyUnavailable, thinFrames,
    type SkyProgress,
} from '../src/lib/source';
import { makeWcs, wcsFromHeader } from '../src/lib/wcs';
import { gridSkyToPix } from '../src/lib/regrid';
import type {
    CardValue, FitsIndex, FrameRecord, PixelBox, RangeReader, SkyCoord, WaveGrid,
} from '../src/lib/types';

const CENTER: SkyCoord = { ra: 76.95, dec: 30.40 };
const STAR: SkyCoord = { ra: 76.955, dec: 30.402 };
const PX = 6.15 / 3600;

// A synthetic SPHEREx-like frame: TAN WCS, flipped for the second season, the view centre
// landing on a different detector row in each frame so each sees a different wavelength.
interface Fake {
    record: FrameRecord;
    cards: Record<string, CardValue>;
    wave: WaveGrid;
}

function fake(obsId: string, tMin: number, rowOffset: number, flipped: boolean): Fake
{
    const s = flipped ? -1 : 1;
    const cards: Record<string, CardValue> = {
        CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', NAXIS1: 2040, NAXIS2: 2040,
        CRPIX1: 1020.5, CRPIX2: 1020.5 + rowOffset,
        CRVAL1: CENTER.ra, CRVAL2: CENTER.dec,
        CD1_1: -PX * s, CD1_2: 0, CD2_1: 0, CD2_2: PX * s,
    };
    const xs = Array.from({ length: 9 }, (_, i) => i * 255);
    const ys = xs.slice();
    const lambda = ys.map((y) => xs.map(() => 0.75 + 0.35 * y / 2040));
    const bandwidth = ys.map(() => xs.map(() => 0.03));
    const record: FrameRecord = {
        obsId, collection: 'spherex_dr1', release: 'dr1', detector: 1,
        url: `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/dr1/${obsId}.fits`,
        tMin, tMax: tMin + 0.002, lambdaMin: 0.75, lambdaMax: 1.1,
    };
    return { record, cards, wave: { xs, ys, lambda, bandwidth } };
}

// Visit 1 (MJD 60900): centre near rows 1020, 1220, 1420. Visit 2 (MJD 61080, flipped): rows 1020, 1200.
const FAKES: Fake[] = [
    fake('v1aD1', 60900.0, 0, false),
    fake('v1bD1', 60900.1, 200, false),
    fake('v1cD1', 60900.2, 400, false),
    fake('v2aD1', 61080.0, 0, true),
    fake('v2bD1', 61080.1, 180, true),
];

function lambdaAtCentre(f: Fake): number
{
    const wcs = makeWcs(wcsFromHeader(headerFromCards(f.cards)));
    const p = wcs.skyToPix(CENTER);
    return 0.75 + 0.35 * p.y / 2040;
}

function fakeBand(obsId: string, tMin: number, lambda: number, bandwidth = 0.030): Fake
{
    const f = fake(obsId, tMin, 0, false);
    f.wave.lambda = f.wave.ys.map(() => f.wave.xs.map(() => lambda));
    f.wave.bandwidth = f.wave.ys.map(() => f.wave.xs.map(() => bandwidth));
    return f;
}

function fakeReader(fakes = FAKES): RangeReader & { reads: number }
{
    const byUrl = new Map(fakes.map((f) => [f.record.url, f]));
    const reader = {
        reads: 0,
        async index(url: string): Promise<FitsIndex>
        {
            const f = byUrl.get(url);
            if (!f) {
                throw new Error(`no fake for ${url}`);
            }
            const header = headerFromCards(f.cards);
            const hdu = { index: 1, name: 'IMAGE', headerStart: 0, dataStart: 0, dataBytes: 0, header };
            return { url, sizeBytes: 0, hdus: [hdu], hdu: () => hdu };
        },
        async readWaveGrid(index: FitsIndex): Promise<WaveGrid>
        {
            return (byUrl.get(index.url) as Fake).wave;
        },
        async readFloat32(index: FitsIndex, name: string, box: PixelBox): Promise<Float32Array>
        {
            reader.reads++;
            const f = byUrl.get(index.url) as Fake;
            const w = box.x1 - box.x0;
            const h = box.y1 - box.y0;
            const out = new Float32Array(w * h);
            if (name === 'ZODI') {
                return out.fill(0.5);
            }
            const wcs = makeWcs(wcsFromHeader(headerFromCards(f.cards)));
            const sp = wcs.skyToPix(STAR);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const dx = box.x0 + x - sp.x;
                    const dy = box.y0 + y - sp.y;
                    out[y * w + x] = 0.5 + 100 * Math.exp(-(dx * dx + dy * dy) / (2 * 1.2 * 1.2));
                }
            }
            return out;
        },
    };
    return reader;
}

function centroid(data: Float32Array, width: number, height: number, around: { x: number; y: number }, r: number)
{
    let sx = 0;
    let sy = 0;
    let s = 0;
    for (let y = Math.max(0, Math.round(around.y) - r); y <= Math.min(height - 1, Math.round(around.y) + r); y++) {
        for (let x = Math.max(0, Math.round(around.x) - r); x <= Math.min(width - 1, Math.round(around.x) + r); x++) {
            const v = data[y * width + x] as number;
            if (Number.isFinite(v) && v > 0) {
                sx += x * v;
                sy += y * v;
                s += v;
            }
        }
    }
    return { x: sx / s, y: sy / s };
}

describe('helpers', () => {
    it('dates, labels and boxes', () => {
        expect(mjdToDate(60900)).toBe('2025-08-13');
        expect(mjdToDate(51544.5)).toBe('2000-01-01');
        expect(frameLabel(FAKES[0]!.record, 0.98765)).toBe('2025-08-13 · 0.988 µm');
        const box = boxForView({ x: 10, y: 2035 }, 0.1, [2040, 2040]);
        expect(box).toEqual({ x0: 0, y0: 1991, x1: 55, y1: 2040 }); // half side ceil(0.1 deg / 6.15" * 0.707) + 2 = 44
        expect(boxForView({ x: -500, y: 10 }, 0.01, [2040, 2040])).toBeUndefined();
    });

    it('thinFrames keeps every visit', () => {
        const many = Array.from({ length: 30 }, (_, i) => fake(`a${i}D1`, 60000 + (i < 20 ? i * 0.01 : 200 + i * 0.01), 0, false).record);
        const kept = thinFrames(many, 10, 6);
        expect(kept.length).toBe(6);
        expect(kept.filter((f) => f.tMin < 60100).length).toBe(3);
        expect(kept.filter((f) => f.tMin > 60100).length).toBe(3);
        expect(thinFrames(many.slice(0, 4), 10, 6).length).toBe(4);
    });
});

describe('live source (fake SIA and S3)', () => {
    it('keeps a visit when only the farther frame contains the chosen wavelength', async () => {
        const fakes = [fakeBand('narrowD1', 60900, 1.000), fakeBand('wideD1', 60900.1, 1.0303, 0.031)];
        const source = createLiveSource({ reader: fakeReader(fakes), search: async () => fakes.map((f) => f.record) });
        const res = await source.load({ center: CENTER, fovDeg: 0.05, detector: 1, lambda: 1.0151 });
        expect(res.frames).toHaveLength(1);
        expect(res.locked.map((l) => l.frame.obsId)).toEqual(['wideD1']);
        expect(res.notes.join(' ')).not.toMatch(/visit.*left out/);
    });

    it('locks one frame per visit near the chosen wavelength and keeps stars still', async () => {
        const reader = fakeReader();
        const stages = new Set<string>();
        const source = createLiveSource({ reader, search: async () => FAKES.map((f) => f.record) });
        const chosen = lambdaAtCentre(FAKES[1]!);
        const res = await source.load({
            center: CENTER, fovDeg: 0.05, detector: 1, lambda: chosen,
            onProgress: (p: SkyProgress) => stages.add(p.stage),
        });
        expect(res.source).toBe('live');
        expect([...stages]).toEqual(['search', 'headers', 'pixels', 'regrid']);
        expect(res.frames.length).toBe(2);
        expect(res.locked.map((l) => l.frame.obsId)).toEqual(['v1bD1', 'v2bD1']);
        expect(Math.abs(res.locked[0]!.dLambda)).toBeLessThan(1e-9);
        for (const l of res.locked) {
            expect(Math.abs(l.dLambda)).toBeLessThanOrEqual(0.015);
        }
        expect(res.lambda).toBe(chosen);
        expect(res.credits[0]).toContain('IRSA678');
        expect(res.frames[0]!.label).toMatch(/^2025-08-13 · \d\.\d{3} µm$/);
        expect(reader.reads).toBe(4); // IMAGE + ZODI for 2 frames, nothing else

        const g = res.grid;
        const want = gridSkyToPix(g, STAR);
        for (const f of res.frames) {
            const c = centroid(f.frame.data, g.width, g.height, want, 12);
            expect(Math.hypot(c.x - want.x, c.y - want.y)).toBeLessThan(0.3);
        }
    });

    it('leaves out visits with no frame inside the passband, and says so', async () => {
        const source = createLiveSource({ reader: fakeReader(), search: async () => FAKES.map((f) => f.record) });
        const res = await source.load({ center: CENTER, fovDeg: 0.05, detector: 1, lambda: lambdaAtCentre(FAKES[2]!) });
        expect(res.frames.length).toBe(1);
        expect(res.notes.join(' ')).toMatch(/1 visit left out/);
    });

    it('by default picks the wavelength that keeps the most visits', async () => {
        const source = createLiveSource({ reader: fakeReader(), search: async () => FAKES.map((f) => f.record) });
        const res = await source.load({ center: CENTER, fovDeg: 0.05, detector: 1 });
        expect(res.lambdaRange).toBeDefined();
        expect(res.frames.length).toBe(2);
        expect(res.notes.join(' ')).not.toMatch(/visit left out/);
    });

    it('finds a default wavelength between centres in overlapping passbands', async () => {
        const fakes = [fakeBand('firstD1', 60900, 1.000), fakeBand('secondD1', 61080, 1.020)];
        const source = createLiveSource({ reader: fakeReader(fakes), search: async () => fakes.map((f) => f.record) });
        const res = await source.load({ center: CENTER, fovDeg: 0.05, detector: 1 });
        expect(res.lambda).toBeGreaterThanOrEqual(1.005);
        expect(res.lambda).toBeLessThanOrEqual(1.015);
        expect(res.frames).toHaveLength(2);
        expect(res.locked.map((l) => l.frame.obsId)).toEqual(['firstD1', 'secondD1']);
    });

    it('keeps one frame for a daily visit after thinning to two headers', async () => {
        const fakes = Array.from({ length: 40 }, (_, i) => fakeBand(`day${i}D1`, 60900 + i, 1.000));
        const reader = fakeReader(fakes);
        const source = createLiveSource({
            reader, search: async () => fakes.map((f) => f.record), visitGapDays: 10, maxHeaders: 2,
        });
        const res = await source.load({ center: CENTER, fovDeg: 0.05, detector: 1, lambda: 1.000 });
        expect(res.frames).toHaveLength(1);
        expect(res.locked.map((l) => l.frame.obsId)).toEqual(['day10D1']);
        expect(reader.reads).toBe(2);
        expect(res.notes.join(' ')).toContain('Read 2 of 40 frames');
    });

    it('reports an empty sky and stops on abort', async () => {
        const empty = createLiveSource({ reader: fakeReader(), search: async () => [] });
        const res = await empty.load({ center: CENTER, fovDeg: 0.05, detector: 2 });
        expect(res.frames).toEqual([]);
        expect(res.notes[0]).toMatch(/No SPHEREx frames on detector 2/);
        const ctl = new AbortController();
        ctl.abort();
        const live = createLiveSource({ reader: fakeReader(), search: async () => FAKES.map((f) => f.record) });
        await expect(live.load({ center: CENTER, fovDeg: 0.05, detector: 1, signal: ctl.signal })).rejects.toThrow();
    });
});

describe('snapshot source (fake site)', () => {
    function site(fakes = FAKES.slice(0, 2)): typeof fetch
    {
        const box: PixelBox = { x0: 960, y0: 960, x1: 1080, y1: 1080 };
        const frames = fakes.map((f) => ({
            record: f.record,
            box,
            planes: ['IMAGE', 'ZODI', 'VARIANCE'],
            file: `${f.record.obsId}.f32`,
            imageHeader: f.cards,
            wave: { ...f.wave, pixelOrigin: 0 },
        }));
        const files = new Map<string, ArrayBuffer>();
        for (const f of fakes) {
            const n = 120 * 120;
            const buf = new ArrayBuffer(n * 4 * 3);
            const view = new DataView(buf);
            for (let i = 0; i < n; i++) {
                view.setFloat32(i * 4, 1 + (i % 7), true);
                view.setFloat32((n + i) * 4, 0.5, true);
                view.setFloat32((2 * n + i) * 4, 0.01, true);
            }
            files.set(`/snapshot/rwaur/${f.record.obsId}.f32`, buf);
        }
        const index = { target: { id: 'rwaur' }, madeBy: 'test', madeAt: 'now', frames };
        const gaia = {
            credit: 'ESA/Gaia/DPAC, CC BY-NC 3.0 IGO',
            sources: [
                { source_id: 1, ra: CENTER.ra, dec: CENTER.dec, pmra: 1, pmdec: null, parallax: 2, phot_g_mean_mag: 12, ref_epoch: 2016 },
                { source_id: 2, ra: CENTER.ra + 1, dec: CENTER.dec, phot_g_mean_mag: 12 },
            ],
        };
        return (async (input: string | URL | Request) => {
            const path = String(input);
            if (path === '/snapshot/rwaur/index.json') {
                return new Response(JSON.stringify(index));
            }
            if (path === '/snapshot/rwaur/gaia.json') {
                return new Response(JSON.stringify(gaia));
            }
            const file = files.get(path);
            return file ? new Response(file) : new Response('missing', { status: 404 });
        }) as typeof fetch;
    }

    it('reads baked frames, decodes little-endian planes and places Gaia stars', async () => {
        const source = createSnapshotSource({ fetch: site() });
        const res = await source.load({ center: CENTER, fovDeg: 0.05, detector: 1, target: 'rwaur' });
        expect(res.source).toBe('snapshot');
        expect(res.frames.length).toBeGreaterThan(0);
        const data = res.frames[0]!.frame.data;
        const finite = Array.from(data).filter(Number.isFinite);
        expect(finite.length).toBeGreaterThan(0);
        expect(Math.min(...finite)).toBeGreaterThanOrEqual(0.5 - 1e-6); // IMAGE - ZODI, IMAGE >= 1
        expect(res.stars.map((s) => s.sourceId)).toEqual(['1']);
        const c = res.stars[0]!.pix;
        expect(Math.abs(c.x - (res.grid.width - 1) / 2)).toBeLessThan(1e-6);
        expect(res.stars[0]!.pmDec).toBeUndefined();
        expect(res.credits.join(' ')).toContain('Gaia');
        expect(res.track?.length).toBe(res.frames.length);
    });

    it('shares a slow index fetch without sharing a caller abort', async () => {
        const fetchSite = site();
        let releaseIndex!: () => void;
        let indexFetches = 0;
        const fetcher: typeof fetch = async (input, init) => {
            if (String(input) === '/snapshot/rwaur/index.json') {
                indexFetches++;
                await new Promise<void>((resolve, reject) => {
                    releaseIndex = resolve;
                    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
                });
            }
            return fetchSite(input, init);
        };
        const source = createSnapshotSource({ fetch: fetcher });
        const req = { center: CENTER, fovDeg: 0.05, detector: 1, target: 'rwaur' } as const;
        const ctl = new AbortController();
        const reason = new Error('first load cancelled');
        const firstAborted = expect(source.load({ ...req, signal: ctl.signal })).rejects.toBe(reason);
        const second = source.load(req).then((result) => ({ result }), (error: unknown) => ({ error }));
        ctl.abort(reason);
        await firstAborted;
        releaseIndex();
        expect(await second).toMatchObject({ result: { source: 'snapshot' } });
        expect(indexFetches).toBe(1);
    });

    it('skips offline frames without a complete pixel scale and notes their count once', async () => {
        const noScale = fakeBand('noScaleD1', 60900, 1);
        const partialScale = fakeBand('partialScaleD1', 61080, 1);
        const scaled = fakeBand('scaledD1', 61260, 1);
        for (const f of [noScale, partialScale]) {
            for (const key of ['CD1_1', 'CD1_2', 'CD2_1', 'CD2_2']) {
                delete f.cards[key];
            }
        }
        partialScale.cards.CDELT1 = -PX;
        const source = createSnapshotSource({ fetch: site([noScale, partialScale, scaled]) });
        const res = await source.load({ center: CENTER, fovDeg: 0.05, detector: 1, target: 'rwaur', lambda: 1 });
        expect(res.locked.map((l) => l.frame.obsId)).toEqual(['scaledD1']);
        expect(res.notes.filter((n) => n.includes('lack a pixel scale'))).toEqual([
            '2 offline frames lack a pixel scale and were skipped.',
        ]);
        expect(Array.from(res.frames[0]!.frame.data).some(Number.isFinite)).toBe(true);
    });

    it('throws SkyUnavailable when every offline frame lacks a pixel scale', async () => {
        const f = fakeBand('noScaleD1', 60900, 1);
        for (const key of ['CD1_1', 'CD1_2', 'CD2_1', 'CD2_2']) {
            delete f.cards[key];
        }
        const source = createSnapshotSource({ fetch: site([f]) });
        await expect(source.load({ center: CENTER, fovDeg: 0.05, detector: 1, target: 'rwaur' })).rejects.toBeInstanceOf(SkyUnavailable);
    });

    it('refuses views without a target and notes a missing detector', async () => {
        const source = createSnapshotSource({ fetch: site() });
        await expect(source.load({ center: CENTER, fovDeg: 0.05, detector: 1 })).rejects.toThrow(/five official targets/);
        const res = await source.load({ center: CENTER, fovDeg: 0.05, detector: 4, target: 'rwaur' });
        expect(res.frames).toEqual([]);
        expect(res.notes.join(' ')).toMatch(/detector/);
    });
});
