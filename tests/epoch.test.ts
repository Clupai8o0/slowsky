import { describe, expect, it } from 'vitest';
import { planEpochTiles, readEpoch, TWO_MASS_K } from '../src/lib/epoch';
import type { EpochDecoded, EpochSource } from '../src/lib/epoch';
import type { OutputGrid, SkyCoord } from '../src/lib/types';
import { positionAt, targetById } from '../src/lib/targets';
import { gridPixToSky, gridSkyToPix } from '../src/lib/regrid';
import barnardGaia from './fixtures/epoch/barnard-gaia.json';
// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { execFile } from 'node:child_process';

declare const process: { env: Record<string, string | undefined>; stdout: { write(text: string): void } };

const DEG = Math.PI / 180;

// Separate, deliberately slow ang2pix_nest definition: integer edge numbers,
// polar sqrt(1-|z|), then recursive quadrants (no production geometry imports).
function referenceIndex(c: SkyCoord, order: number): number
{
    const n = 2 ** order;
    const z = Math.sin(c.dec * DEG);
    const tt = ((c.ra % 360) + 360) % 360 / 90;
    let face: number;
    let ix: number;
    let iy: number;
    if (Math.abs(z) <= 2 / 3) {
        const jp = Math.floor(n * (0.5 + tt - z * 0.75));
        const jm = Math.floor(n * (0.5 + tt + z * 0.75));
        const ifp = Math.floor(jp / n);
        const ifm = Math.floor(jm / n);
        face = ifp === ifm ? ifp % 4 + 4 : ifp < ifm ? ifp % 4 : ifm % 4 + 8;
        ix = jm % n;
        iy = n - jp % n - 1;
    } else {
        const quadrant = Math.min(3, Math.floor(tt));
        const fraction = tt - quadrant;
        const radius = n * Math.sqrt(3 * (1 - Math.abs(z)));
        const jp = Math.min(n - 1, Math.floor(fraction * radius));
        const jm = Math.min(n - 1, Math.floor((1 - fraction) * radius));
        face = quadrant + (z >= 0 ? 0 : 8);
        ix = z >= 0 ? n - jm - 1 : jp;
        iy = z >= 0 ? n - jp - 1 : jm;
    }
    let code = 0;
    for (let bit = order - 1; bit >= 0; bit--) {
        const half = 2 ** bit;
        const east = ix >= half ? 1 : 0;
        const west = iy >= half ? 1 : 0;
        code = 4 * code + east + 2 * west;
        ix -= east * half;
        iy -= west * half;
    }
    return face * n * n + code;
}

// Independent TAN inverse using a Cartesian tangent basis, rather than the
// atan2 formula in regrid.ts. Offsets are east and north in tangent arcseconds.
function tangent(c: SkyCoord, east: number, north: number): SkyCoord
{
    const r = c.ra * DEG;
    const d = c.dec * DEG;
    const e = east * DEG / 3600;
    const v = north * DEG / 3600;
    const x = Math.cos(d) * Math.cos(r) - e * Math.sin(r) - v * Math.sin(d) * Math.cos(r);
    const y = Math.cos(d) * Math.sin(r) + e * Math.cos(r) - v * Math.sin(d) * Math.sin(r);
    const z = Math.sin(d) + v * Math.cos(d);
    return { ra: (Math.atan2(y, x) / DEG + 360) % 360, dec: Math.asin(z / Math.hypot(x, y, z)) / DEG };
}

function gridAt(center: SkyCoord = { ra: 269.452, dec: 4.693 }, width = 121, pixelArcsec = 1.5375): OutputGrid
{
    return { center, width, height: width, pixelArcsec, fovDeg: width * pixelArcsec / 3600 };
}

function atPixel(grid: OutputGrid, x: number, y: number): SkyCoord
{
    return tangent(grid.center, ((grid.width - 1) / 2 - x) * grid.pixelArcsec,
        ((grid.height - 1) / 2 - y) * grid.pixelArcsec);
}

interface Mark { sky: SkyCoord; value: number }

function fitsBytes(data: Float32Array, width: number, bitpix = -32, scale = 1, zero = 0, blank?: number): Uint8Array
{
    const cards = [['SIMPLE', 'T'], ['BITPIX', String(bitpix)], ['NAXIS', '2'], ['NAXIS1', String(width)],
        ['NAXIS2', String(width)], ['BSCALE', String(scale)], ['BZERO', String(zero)]];
    if (blank !== undefined) {
        cards.push(['BLANK', String(blank)]);
    }
    const header = cards.map(([k, v]) => `${k!.padEnd(8)}= ${v}`.padEnd(80)).join('') + 'END'.padEnd(80);
    const start = Math.ceil(header.length / 2880) * 2880;
    const bytes = new Uint8Array(start + Math.ceil(data.length * Math.abs(bitpix) / 8 / 2880) * 2880);
    bytes.fill(32, 0, start);
    bytes.set(new TextEncoder().encode(header));
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < data.length; i++) {
        const offset = start + i * Math.abs(bitpix) / 8;
        const value = data[i]!;
        if (bitpix === -32) {
            view.setFloat32(offset, value, false);
        } else if (bitpix === -64) {
            view.setFloat64(offset, value, false);
        } else if (bitpix === 16) {
            view.setInt16(offset, value, false);
        } else if (bitpix === 32) {
            view.setInt32(offset, value, false);
        } else {
            view.setUint8(offset, value);
        }
    }
    return bytes;
}

// Test images are authored directly in the standard's tile coordinates.
// Fig. 4: FITS corners S,W / E,N; JPEG rows run in the opposite direction.
function synthetic(source: EpochSource, marks: Mark[] = [], opts: {
    uniform?: number; fail?: Set<number>; bitpix?: number; scale?: number; zero?: number; blank?: number;
    rgba?: boolean; transparent?: boolean;
} = {})
{
    const calls: string[] = [];
    function image(order: number, npix: number): Float32Array
    {
        const w = source.tileWidth;
        const data = Float32Array.from({ length: w * w }, (_, i) => opts.uniform ?? (i % w + Math.floor(i / w) / w));
        for (const mark of marks) {
            const cell = referenceIndex(mark.sky, order + Math.log2(w));
            if (Math.floor(cell / (w * w)) !== npix) {
                continue;
            }
            // Recursive base-4 digit walk, independent of production unpacking.
            let code = cell % (w * w);
            let horizontal = 0;
            let vertical = 0;
            for (let step = 1; step < w; step *= 2) {
                const quadrant = code % 4;
                horizontal += Math.floor(quadrant / 2) * step;
                vertical += (quadrant % 2) * step;
                code = Math.floor(code / 4);
            }
            const row = source.format === 'fits' ? w - 1 - vertical : vertical;
            data[row * w + horizontal] = mark.value;
        }
        return data;
    }
    const fetcher: typeof fetch = async (input) => {
        const url = String(input);
        calls.push(url);
        const match = /Norder(\d+)\/Dir\d+\/Npix(\d+)\./.exec(url)!;
        const order = Number(match[1]);
        const npix = Number(match[2]);
        if (opts.fail?.has(npix)) {
            return new Response('', { status: 404 });
        }
        const bytes = source.format === 'fits'
            ? fitsBytes(image(order, npix), source.tileWidth, opts.bitpix, opts.scale, opts.zero, opts.blank)
            : new TextEncoder().encode(JSON.stringify({ order, npix }));
        return new Response(new Uint8Array(bytes));
    };
    const decode = (bytes: Uint8Array) => {
        const { order, npix } = JSON.parse(new TextDecoder().decode(bytes)) as { order: number; npix: number };
        const data = image(order, npix);
        if (opts.rgba) {
            const rgba = new Float32Array(data.length * 4);
            for (let i = 0; i < data.length; i++) {
                rgba.set([data[i]!, data[i]!, data[i]!, opts.transparent ? 0 : 255], i * 4);
            }
            return { width: source.tileWidth, height: source.tileWidth, data: rgba };
        }
        return { width: source.tileWidth, height: source.tileWidth, data };
    };
    return { fetch: fetcher, decode, calls };
}

describe('older 2MASS epoch', () => {
    it('uses the full published observing span and verbatim credit', () => {
        expect(TWO_MASS_K.epochLabel).toBe('2MASS survey: 1997-06-01–2001-02-01');
        expect(TWO_MASS_K.credit).toBe('University of Massachusetts & IPAC/Caltech');
        expect(TWO_MASS_K.propertiesUrl).toBe(`${TWO_MASS_K.baseUrl}/properties`);
        expect(TWO_MASS_K.creditUrl).toBe('http://www.ipac.caltech.edu/2mass/');
    });

    it('places a source 30 arcsec north above centre and 30 arcsec east to the left', async () => {
        const grid = gridAt(undefined, 121, 1.5);
        const marks = [{ sky: tangent(grid.center, 0, 30), value: 10000 },
            { sky: tangent(grid.center, 30, 0), value: 20000 }];
        const result = await readEpoch(grid, synthetic(TWO_MASS_K, marks));
        expect(result.ok).toBe(true);
        if (!result.ok) { return; }
        expect(result.values).toBe('display');
        expect(result.source.format).toBe('jpeg');
        expect(result.pixels[40 * 121 + 60]).toBe(10000);
        expect(result.pixels[60 * 121 + 40]).toBe(20000);
        expect(result.pixels[80 * 121 + 60]).toBeLessThan(1000);
        expect(result.pixels[60 * 121 + 80]).toBeLessThan(1000);
    });

    for (const center of [{ ra: 0, dec: 1 }, { ra: 122, dec: 85 }, { ra: 312, dec: -85 }]) {
        for (const pixelArcsec of [1.5375, 6.15]) {
            for (const width of [121, 235]) {
                it(`independent sky mapping at ${center.ra},${center.dec}; ${width}px at ${pixelArcsec} arcsec`, async () => {
                    const grid = gridAt(center, width, pixelArcsec);
                    const x = Math.floor(width * 0.3);
                    const y = Math.floor(width * 0.7);
                    const result = await readEpoch(grid, synthetic(TWO_MASS_K, [{ sky: atPixel(grid, x, y), value: 10000 }]));
                    expect(result.ok).toBe(true);
                    if (result.ok) {
                        expect(result.pixels[y * width + x]).toBe(10000);
                        expect(result.pixels.every(Number.isFinite)).toBe(true);
                    }
                });
            }
        }
    }

    it('samples an exact tile border once with no gap or duplicate seam', async () => {
        const grid = gridAt({ ra: 45, dec: 0 }, 121, 6.15);
        const mock = synthetic(TWO_MASS_K, [{ sky: grid.center, value: 10000 }]);
        const result = await readEpoch(grid, mock);
        expect(result.ok).toBe(true);
        if (!result.ok) { return; }
        expect(result.pixels[60 * 121 + 60]).toBe(10000);
        const painted = referenceIndex(grid.center, result.order + 9);
        const expected: number[] = [];
        const actual: number[] = [];
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                if (referenceIndex(atPixel(grid, x, y), result.order + 9) === painted) {
                    expected.push(y * grid.width + x);
                }
                if (result.pixels[y * grid.width + x] === 10000) {
                    actual.push(y * grid.width + x);
                }
            }
        }
        expect(actual).toEqual(expected);
        // A HEALPix pixel can cover two output samples; they must form one spot.
        expect(actual.length).toBeGreaterThan(0);
        expect(actual.every((i) => Math.abs(i % 121 - 60) <= 1 && Math.abs(Math.floor(i / 121) - 60) <= 1)).toBe(true);
        expect(result.pixels.every(Number.isFinite)).toBe(true);
        expect(new Set(mock.calls).size).toBe(mock.calls.length);
    });

    it('FITS and JPEG row orders put the same asymmetric sources in the same output pixels', async () => {
        const grid = gridAt();
        const marks = [{ sky: atPixel(grid, 28, 47), value: 9000 }, { sky: atPixel(grid, 91, 83), value: 8000 }];
        for (const format of ['fits', 'jpeg', 'png'] as const) {
            const source = { ...TWO_MASS_K, format };
            const result = await readEpoch(grid, { source, ...synthetic(source, marks) });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.values).toBe(format === 'fits' ? 'fits' : 'display');
                expect(result.source.format).toBe(format);
                expect(result.pixels[47 * 121 + 28]).toBe(9000);
                expect(result.pixels[83 * 121 + 91]).toBe(8000);
            }
        }
    });

    it('uses order plus log2(tile width), and chooses the nearest angular pixel size', () => {
        expect(planEpochTiles(gridAt(undefined, 121, 1.5375), TWO_MASS_K).order).toBe(8);
        expect(planEpochTiles(gridAt(undefined, 235, 6.15), TWO_MASS_K).order).toBe(6);
        expect(planEpochTiles(gridAt(undefined, 121, 0.1), TWO_MASS_K).order).toBe(9);
        // Absolute angular distance, rather than rounding a logarithm.
        expect(planEpochTiles(gridAt(undefined, 121, 2.3), TWO_MASS_K).order).toBe(8);
    });

    it('steps down for a wide field to honour the tile cap, with stable URLs', () => {
        const source = { ...TWO_MASS_K, tileWidth: 8, hipsOrder: 15 };
        const grid = gridAt(undefined, 235, 6.15);
        const full = planEpochTiles(grid, source, 100000);
        const capped = planEpochTiles(grid, source, 4);
        expect(capped.order).toBeLessThan(full.order);
        expect(capped.tiles.length).toBeGreaterThan(0);
        expect(capped.tiles.length).toBeLessThanOrEqual(4);
        expect(capped).toEqual(planEpochTiles(grid, source, 4));
        expect(capped.tiles.map((t) => t.npix)).toEqual(capped.tiles.map((t) => t.npix).sort((a, b) => a - b));
        for (const tile of capped.tiles) {
            expect(tile.url).toBe(`${source.baseUrl}/Norder${capped.order}/Dir${Math.floor(tile.npix / 10000) * 10000}/Npix${tile.npix}.jpg`);
        }
    });

    for (const bitpix of [8, 16, 32, -32, -64]) {
        it(`reads big-endian FITS BITPIX ${bitpix}, BSCALE/BZERO and blanks`, async () => {
            const source: EpochSource = { ...TWO_MASS_K, format: 'fits' };
            const grid = gridAt();
            const marks = [{ sky: atPixel(grid, 30, 45), value: 100 }, { sky: atPixel(grid, 80, 90), value: bitpix > 0 ? 0 : NaN }];
            const result = await readEpoch(grid, { source, ...synthetic(source, marks, { bitpix, scale: 2, zero: 10, blank: bitpix > 0 ? 0 : undefined }) });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.pixels[45 * 121 + 30]).toBe(210);
                expect(result.pixels[90 * 121 + 80]).toBeNaN();
            }
        });
    }

    it('converts ICRS before sampling a galactic source', async () => {
        const source: EpochSource = { ...TWO_MASS_K, frame: 'galactic' };
        const grid = gridAt({ ra: 0, dec: 0 });
        const sky = { ra: 96.33728336969006, dec: -60.188551946914465 };
        const result = await readEpoch(grid, { source, ...synthetic(source, [{ sky, value: 9000 }]) });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.pixels[60 * 121 + 60]).toBe(9000);
        }
    });

    it('accepts decoded RGBA and keeps transparent pixels empty', async () => {
        const grid = gridAt();
        const result = await readEpoch(grid, synthetic(TWO_MASS_K, [], { rgba: true }));
        expect(result.ok).toBe(true);
        const empty = await readEpoch(grid, synthetic(TWO_MASS_K, [], { rgba: true, transparent: true }));
        expect(empty).toMatchObject({ ok: false, reason: 'empty' });
    });

    it('leaves NaN for a 404 on one tile of four and reports it', async () => {
        const grid = gridAt({ ra: 45, dec: 0 }, 121, 6.15);
        const plan = planEpochTiles(grid, TWO_MASS_K);
        expect(plan.tiles).toHaveLength(4);
        const failed = plan.tiles[0]!;
        const mock = synthetic(TWO_MASS_K, [], { fail: new Set([failed.npix]) });
        const result = await readEpoch(grid, mock);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.missing).toEqual([{ ...failed, reason: 'fetch', detail: 'HTTP 404' }]);
            expect(result.pixels.some(Number.isNaN)).toBe(true);
            expect(result.pixels.some(Number.isFinite)).toBe(true);
        }
    });

    it('refuses more than half missing, and accepts exactly half when sky varies', async () => {
        const grid = gridAt({ ra: 45, dec: 0 }, 121, 6.15);
        const ids = planEpochTiles(grid, TWO_MASS_K).tiles.map((t) => t.npix);
        expect(await readEpoch(grid, synthetic(TWO_MASS_K, [], { fail: new Set(ids.slice(0, 3)) })))
            .toMatchObject({ ok: false, reason: 'fetch', missing: expect.any(Array) });
        expect((await readEpoch(grid, synthetic(TWO_MASS_K, [], { fail: new Set(ids.slice(0, 2)) }))).ok).toBe(true);
    });

    it('returns no-tiles when even base cells cannot fit the cap or the grid is invalid', async () => {
        expect(await readEpoch(gridAt({ ra: 45, dec: 0 }), { maxTiles: 1 }))
            .toMatchObject({ ok: false, reason: 'no-tiles' });
        expect(await readEpoch({ ...gridAt(), width: 0 })).toMatchObject({ ok: false, reason: 'no-tiles' });
    });

    it('reports fetch failures, a hung response body, and a timeout even if fetch ignores its signal', async () => {
        const rejected: typeof fetch = async () => { throw new Error('offline'); };
        expect(await readEpoch(gridAt(), { fetch: rejected })).toMatchObject({ ok: false, reason: 'fetch' });
        const hanging: typeof fetch = () => new Promise(() => {});
        expect(await readEpoch(gridAt(), { fetch: hanging, timeoutMs: 5 }))
            .toMatchObject({ ok: false, reason: 'fetch', missing: expect.arrayContaining([expect.objectContaining({ detail: 'Tile timeout' })]) });
        const body: typeof fetch = async () => new Response(new ReadableStream({ start() {} }));
        expect(await readEpoch(gridAt(), { fetch: body, timeoutMs: 5 })).toMatchObject({ ok: false, reason: 'fetch' });
    });

    it('reports pre-abort and mid-request abort and propagates the signal', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await readEpoch(gridAt(), { signal: controller.signal })).toMatchObject({ ok: false, reason: 'fetch' });
        const active = new AbortController();
        let tileSignal: AbortSignal | undefined;
        const fetcher: typeof fetch = async (_url, init) => {
            tileSignal = init?.signal ?? undefined;
            active.abort();
            return new Promise(() => {});
        };
        expect(await readEpoch(gridAt(), { fetch: fetcher, signal: active.signal })).toMatchObject({ ok: false, reason: 'fetch' });
        expect(tileSignal?.aborted).toBe(true);
    });

    it('reports malformed images, missing decoder, invalid shape, FITS truncation and decoder timeout', async () => {
        const mock = synthetic(TWO_MASS_K);
        expect(await readEpoch(gridAt(), { fetch: mock.fetch })).toMatchObject({ ok: false, reason: 'decode' });
        for (const decode of [() => { throw new Error('bad'); }, () => ({ width: 1, height: 1, data: new Uint8Array(1) }),
            () => ({ width: 512, height: 512, data: new Uint8Array(3) })]) {
            expect(await readEpoch(gridAt(), { fetch: mock.fetch, decode })).toMatchObject({ ok: false, reason: 'decode' });
        }
        const source: EpochSource = { ...TWO_MASS_K, format: 'fits' };
        const fetcher: typeof fetch = async () => new Response(new Uint8Array(80));
        expect(await readEpoch(gridAt(), { source, fetch: fetcher })).toMatchObject({ ok: false, reason: 'decode' });
        expect(await readEpoch(gridAt(), { fetch: mock.fetch, decode: () => new Promise(() => {}), timeoutMs: 5 }))
            .toMatchObject({ ok: false, reason: 'decode' });
    });

    for (const uniform of [NaN, 0, 7]) {
        it(`refuses an empty or constant frame (${uniform})`, async () => {
            expect(await readEpoch(gridAt(), synthetic(TWO_MASS_K, [], { uniform }))).toMatchObject({ ok: false, reason: 'empty' });
        });
    }
});

const GAIA_QUERY = `SELECT TOP 10 g.source_id,g.ra,g.dec,g.pmra,g.pmdec,g.ref_epoch,t.ks_m,t.designation
FROM gaiadr3.gaia_source AS g
JOIN gaiadr3.tmass_psc_xsc_best_neighbour AS x ON g.source_id=x.source_id
JOIN gaiadr1.tmass_original_valid AS t ON x.original_ext_source_id=t.designation
WHERE 1=CONTAINS(POINT('ICRS',g.ra,g.dec),CIRCLE('ICRS',269.4520769586187,4.693364966576667,0.16))
AND t.ks_m<10 AND g.pmra*g.pmra+g.pmdec*g.pmdec<400
ORDER BY t.ks_m`;

function separation(a: SkyCoord, b: SkyCoord): number
{
    const d = Math.sin((a.dec - b.dec) * DEG / 2) ** 2
        + Math.cos(a.dec * DEG) * Math.cos(b.dec * DEG) * Math.sin((a.ra - b.ra) * DEG / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(d))) / DEG * 3600;
}

// The display-stretched JPEG clips bright cores. Choose an actual brightest
// pixel nearest the largest connected maximum plateau's centroid, using only
// image values to resolve ties. Expected sky positions do not resolve ties.
function imagePeak(pixels: Float32Array, width: number, bounds: { x0: number; x1: number; y0: number; y1: number },
    inside: (x: number, y: number) => boolean)
{
    let value = -Infinity;
    let maxima = new Set<number>();
    const samples: number[] = [];
    const height = Math.floor(pixels.length / width);
    for (let y = Math.max(0, bounds.y0); y <= Math.min(height - 1, bounds.y1); y++) {
        for (let x = Math.max(0, bounds.x0); x <= Math.min(width - 1, bounds.x1); x++) {
            const sample = pixels[y * width + x] ?? NaN;
            if (!inside(x, y) || !Number.isFinite(sample)) {
                continue;
            }
            samples.push(sample);
            if (sample > value) {
                value = sample;
                maxima = new Set();
            }
            if (sample === value) {
                maxima.add(y * width + x);
            }
        }
    }
    const maximumCount = maxima.size;
    let component: number[] = [];
    while (maxima.size) {
        const seed = maxima.values().next().value!;
        const group = [seed];
        maxima.delete(seed);
        for (let i = 0; i < group.length; i++) {
            const at = group[i]!;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const next = at + dy * width + dx;
                    if (Math.abs(next % width - at % width) <= 1 && maxima.delete(next)) {
                        group.push(next);
                    }
                }
            }
        }
        if (group.length > component.length) {
            component = group;
        }
    }
    expect(component.length, 'a finite image maximum').toBeGreaterThan(0);
    samples.sort((a, b) => a - b);
    const background = samples[Math.floor(samples.length / 2)]!;
    expect(value - background, 'a peak above the local background').toBeGreaterThan(20);
    const cx = component.reduce((sum, i) => sum + i % width, 0) / component.length;
    const cy = component.reduce((sum, i) => sum + Math.floor(i / width), 0) / component.length;
    const at = component.reduce((best, i) => Math.hypot(i % width - cx, Math.floor(i / width) - cy)
        < Math.hypot(best % width - cx, Math.floor(best / width) - cy) ? i : best, component[0]!);
    return { x: at % width, y: Math.floor(at / width), value, background, maximumCount, componentSize: component.length };
}

it('live peak measurement rejects flat patches and centres a connected saturated maximum independently', () => {
    const pixels = new Float32Array(49).fill(50);
    const bounds = { x0: 0, x1: 6, y0: 0, y1: 6 };
    expect(() => imagePeak(pixels, 7, bounds, () => true)).toThrow();
    pixels[0] = 255;
    for (let y = 2; y <= 4; y++) {
        for (let x = 2; x <= 4; x++) {
            pixels[y * 7 + x] = 255;
        }
    }
    expect(imagePeak(pixels, 7, bounds, () => true)).toMatchObject({ x: 3, y: 3, value: 255, background: 50, componentSize: 9 });
    pixels[6] = 255;
    expect(() => imagePeak(pixels, 7, { x0: -1, x1: -1, y0: 1, y1: 3 }, () => true)).toThrow();
});

function report(message: string, value?: unknown): void
{
    // Vitest's agent reporter hides console logs for passing tests by default.
    process.stdout.write(message + (value === undefined ? '' : ' ' + JSON.stringify(value)) + '\n');
}

function serialDecoder(run: (bytes: Uint8Array) => Promise<EpochDecoded>)
{
    let queue: Promise<void> = Promise.resolve();
    let stopped = false;
    return {
        decode(bytes: Uint8Array)
        {
            const pending = queue.then(() => {
                if (stopped) {
                    throw new Error('Live decoder stopped');
                }
                return run(bytes);
            });
            queue = pending.then(() => {}, () => {});
            return pending;
        },
        async stop()
        {
            stopped = true;
            await queue;
        },
    };
}

it('stops launching queued live decoders once the read finishes', async () => {
    let launches = 0;
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const decoder = serialDecoder(async () => {
        launches++;
        await ready;
        return { width: 1, height: 1, data: new Uint8Array(1) };
    });
    const first = decoder.decode(new Uint8Array());
    await Promise.resolve();
    const second = decoder.decode(new Uint8Array());
    // Attach the expected rejection handler before draining the active job.
    const replies = Promise.allSettled([first, second]);
    const stopped = decoder.stop();
    release();
    await stopped;
    expect(launches).toBe(1);
    expect((await replies).map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
});

const live = process.env.EPOCH_LIVE === '1' ? it : it.skip;
live('live K orientation, scale, two stationary Gaia/2MASS stars and Barnard track', async () => {
    // The permitted interpreter is only used as an interpreter (Pillow decode).
    // No other project implementation or data is read.
    const python = '/Users/clupa/Documents/projects/spaceapps-melbourne-2026/research/.venv/bin/python';
    const target = targetById('barnard')!;
    const grid = gridAt(target.astrometry, 1201, 1);
    // Keep interpreter imports serial on the shared Mac. The decoder is async
    // so library abort/timeout timers remain able to run while it is working.
    const decoder = serialDecoder((bytes) => new Promise<EpochDecoded>((resolve, reject) => {
        const child = execFile(python, ['-c',
            "import sys,io,struct; from PIL import Image; im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('L'); sys.stdout.buffer.write(struct.pack('<II',*im.size)+im.tobytes())"],
        { timeout: 5000, maxBuffer: 2 * 1024 * 1024, encoding: 'buffer' }, (error: Error | null, raw: Uint8Array) => {
            if (error) {
                reject(error);
                return;
            }
            try {
                const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
                resolve({ width: view.getUint32(0, true), height: view.getUint32(4, true), data: raw.subarray(8) });
            } catch (error) {
                reject(error);
            }
        });
        child.stdin.on('error', reject);
        child.stdin.end(bytes);
    }));
    let result: Awaited<ReturnType<typeof readEpoch>>;
    try {
        result = await readEpoch(grid, {
            maxTiles: 64,
            fetch: (url, init) => fetch(url, { ...init, headers: { Origin: 'https://slowsky.vercel.app' } }),
            decode: decoder.decode,
        });
    } finally {
        await decoder.stop();
    }
    report('Epoch image:', result.ok ? { order: result.order, tiles: planEpochTiles(grid, TWO_MASS_K, 64).tiles.length,
        missing: result.missing.length, label: result.epoch.label } : result);
    expect(result.ok).toBe(true);
    if (!result.ok) {
        return;
    }
    expect(result.missing).toHaveLength(0);

    // gaia.ts exposes G, not K. Obtain the K and low-motion selection from ESA
    // TAP, with an explicit Gaia DR3 -> 2MASS crossmatch; source IDs stay strings.
    report('ESA Gaia TAP query:\n' + GAIA_QUERY);
    const tap = new URL('https://gea.esac.esa.int/tap-server/tap/sync');
    tap.search = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: GAIA_QUERY }).toString();
    const response = await fetch(tap, { signal: AbortSignal.timeout(60000) });
    expect(response.ok).toBe(true);
    const rows = (await response.text()).trim().split(/\r?\n/).slice(1).map((line) => line.split(','));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const offsets: number[] = [];
    for (const row of rows.slice(0, 2)) {
        const [sourceId, ra, dec, pmra, pmdec, epoch, k] = row;
        const a = { ra: Number(ra), dec: Number(dec), pmRa: Number(pmra), pmDec: Number(pmdec), epochJyear: Number(epoch) };
        expect(Number(k)).toBeLessThan(10);
        expect(Math.hypot(a.pmRa, a.pmDec)).toBeLessThan(20);
        const sky = positionAt(a, 51544.5);
        const p = gridSkyToPix(grid, sky);
        const peak = imagePeak(result.pixels, grid.width,
            { x0: Math.floor(p.x) - 30, x1: Math.ceil(p.x) + 30, y0: Math.floor(p.y) - 30, y1: Math.ceil(p.y) + 30 },
            (x, y) => Math.hypot(x - p.x, y - p.y) <= 30);
        const offset = separation(gridPixToSky(grid, peak), sky);
        report(`Stationary ${sourceId}, K=${k}, pm=${Math.hypot(a.pmRa, a.pmDec).toFixed(3)} mas/yr: offset=${offset.toFixed(3)} arcsec`, peak);
        offsets.push(offset);
    }
    expect(offsets.every((offset) => offset <= 1.5)).toBe(true);

    // targets.ts currently labels its astrometry SIMBAD epoch2000. Use the
    // independently fetched ESA Gaia DR3 epoch2016 values for this track, and
    // check the repo target against it as well; both use the repo PM function.
    const atYear = (year: number) => positionAt(barnardGaia.astrometry, 51544.5 + (year - 2000) * 365.25);
    for (const year of [1997.4, 2001.2, 2026]) {
        const snapshot = positionAt(target.astrometry, 51544.5 + (year - 2000) * 365.25);
        expect(separation(snapshot, atYear(year))).toBeLessThan(0.5);
    }
    const start = gridSkyToPix(grid, atYear(1997.4));
    const end = gridSkyToPix(grid, atYear(2001.2));
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length2 = dx * dx + dy * dy;
    const alongTrack = (x: number, y: number) => Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / length2));
    const peak = imagePeak(result.pixels, grid.width,
        { x0: Math.floor(Math.min(start.x, end.x)) - 30, x1: Math.ceil(Math.max(start.x, end.x)) + 30,
            y0: Math.floor(Math.min(start.y, end.y)) - 30, y1: Math.ceil(Math.max(start.y, end.y)) + 30 },
        (x, y) => Math.hypot(x - start.x - alongTrack(x, y) * dx, y - start.y - alongTrack(x, y) * dy) <= 30);
    const fraction = alongTrack(peak.x, peak.y);
    const trackDistance = Math.hypot(peak.x - start.x - fraction * dx, peak.y - start.y - fraction * dy);
    const implied = 1997.4 + fraction * (2001.2 - 1997.4);
    const from2026 = separation(gridPixToSky(grid, peak), atYear(2026));
    report(`Barnard track offset=${trackDistance.toFixed(3)} arcsec; from 2026=${from2026.toFixed(3)} arcsec; implied date≈${implied.toFixed(1)} (whole-pixel JPEG estimate)`, peak);
    report('Gaia DR3 Barnard reference:', barnardGaia);
    report('Track uses the repository target snapshot:', { source: target.source, astrometry: target.astrometry });
    expect(trackDistance).toBeLessThanOrEqual(3);
    expect(from2026).toBeGreaterThan(180);
}, 180000);
