import { describe, expect, it } from 'vitest';
import f1 from './fixtures/frame/frame1.json';
import box1 from './fixtures/frame/frame1.box.json';
import type { CardValue, Cutout, FitsHeader, FrameRecord, OutputGrid, WcsParams } from '../src/lib/types';
import { gridForView, gridPixToSky, gridSkyToPix, regridNorthUp, regridVariance } from '../src/lib/regrid';
import { makeWcs, wcsFromHeader } from '../src/lib/wcs';

function headerFrom(obj: Record<string, CardValue>): FitsHeader
{
    const cards = new Map<string, CardValue>(Object.entries(obj));
    return {
        cards,
        history: [],
        get: (k: string) => cards.get(k),
        num(k: string): number
        {
            const v = cards.get(k);
            if (typeof v !== 'number') {
                throw new Error(`missing numeric ${k}`);
            }
            return v;
        },
    };
}

function f32(name: string): Float32Array
{
    const fs = (globalThis as any).process.getBuiltinModule('node:fs');
    const buf: Uint8Array = fs.readFileSync(new URL(`./fixtures/frame/${name}`, import.meta.url));
    const copy = new Uint8Array(buf.byteLength);
    copy.set(buf);
    return new Float32Array(copy.buffer);
}

const DUMMY_FRAME = {} as FrameRecord;
const EMPTY_HEADER = headerFrom({});

function mkCutout(params: WcsParams, box: { x0: number; y0: number; x1: number; y1: number },
    image: Float32Array, zodi?: Float32Array): Cutout
{
    return {
        frame: DUMMY_FRAME, box, width: box.x1 - box.x0, height: box.y1 - box.y0,
        image, zodi, wcs: params, header: EMPTY_HEADER,
    };
}

describe('gridForView', () => {
    const c = { ra: 10, dec: 20 };
    it('sizes the grid and keeps it odd', () => {
        const g = gridForView(c, 0.1, 4, 4000);
        expect(g.pixelArcsec).toBeCloseTo(6.15 / 4, 12);
        expect(g.width).toBe(g.height);
        expect(g.width % 2).toBe(1);
        expect(g.width).toBeGreaterThanOrEqual(Math.ceil(360 / (6.15 / 4)));
        expect(g.width).toBeLessThanOrEqual(Math.ceil(360 / (6.15 / 4)) + 1);
        expect(g.fovDeg).toBe(0.1);
    });
    it('caps at the largest odd side', () => {
        const g = gridForView(c, 0.5, 4, 600);
        expect(g.width).toBe(599);
        expect(g.pixelArcsec).toBeCloseTo(1800 / 599, 12);
        expect(gridForView(c, 0.5, 4, 601).width).toBe(601);
    });
    it('throws on bad input', () => {
        expect(() => gridForView(c, 0, 4, 100)).toThrow();
        expect(() => gridForView(c, -1, 4, 100)).toThrow();
        expect(() => gridForView(c, 1, 0, 100)).toThrow();
        expect(() => gridForView(c, 1, 4, 0)).toThrow();
        expect(() => gridForView(c, NaN, 4, 100)).toThrow();
        expect(() => gridForView(c, 1, Infinity, 100)).toThrow();
        expect(() => gridForView({ ra: NaN, dec: 0 }, 1, 4, 100)).toThrow();
    });
});

describe('grid projection', () => {
    const grid = gridForView({ ra: 200, dec: 45 }, 0.2, 4, 500);
    it('round trips and has the right orientation', () => {
        const w = grid.width;
        const pts = [0, (w - 1) / 2, w - 1];
        for (const x of pts) {
            for (const y of pts) {
                const back = gridSkyToPix(grid, gridPixToSky(grid, { x, y }));
                expect(Math.hypot(back.x - x, back.y - y)).toBeLessThan(1e-9);
            }
        }
        const cen = gridSkyToPix(grid, grid.center);
        expect(cen.x).toBeCloseTo((w - 1) / 2, 9);
        const north = gridSkyToPix(grid, { ra: 200, dec: 45.01 });
        expect(north.y).toBeLessThan(cen.y);
        expect(Math.abs(north.x - cen.x)).toBeLessThan(1e-6);
        const east = gridSkyToPix(grid, { ra: 200 + 0.01 / Math.cos(45 * Math.PI / 180), dec: 45 });
        expect(east.x).toBeLessThan(cen.x);
    });
});

describe('synthetic stars across epochs', () => {
    const center = { ra: 150, dec: 2 };
    const stars = [
        { ra: 150.000, dec: 2.000 }, { ra: 150.020, dec: 2.014 }, { ra: 149.982, dec: 2.012 },
        { ra: 149.985, dec: 1.986 }, { ra: 150.018, dec: 1.983 },
    ];
    const rot = (deg: number, s: number): WcsParams['cd'] =>
    {
        const a = (deg * Math.PI) / 180;
        const sc = 6.15 / 3600;
        return [[-sc * Math.cos(a) * s, sc * Math.sin(a)], [sc * Math.sin(a) * s, sc * Math.cos(a)]];
    };
    const sipA = { order: 2, coeffs: [[0, 0, 0], [0, 1e-6, 0], [2e-6, 0, 0]] };
    const sipB = { order: 2, coeffs: [[0, 0, 3e-6], [0, 0, 0], [0, 0, 0]] };
    const pA: WcsParams = {
        crpix: [1020, 1020], crval: [150.002, 2.001], cd: rot(0, 1), naxis: [2040, 2040],
    };
    const pB: WcsParams = {
        crpix: [1020, 1020], crval: [149.998, 1.999], cd: rot(180 + 3, 1), naxis: [2040, 2040],
        a: sipA, b: sipB,
    };
    const grid = gridForView(center, 0.1, 4, 600);

    function paint(params: WcsParams): Float32Array
    {
        const wcs = makeWcs(params);
        // Frame centre is near the star field; put a 112x112 box around the centre pixel.
        const c = wcs.skyToPix(center);
        const box = { x0: Math.round(c.x) - 56, y0: Math.round(c.y) - 56, x1: Math.round(c.x) + 56, y1: Math.round(c.y) + 56 };
        const img = new Float32Array(112 * 112);
        for (const s of stars) {
            const p = wcs.skyToPix(s);
            const sx = p.x - box.x0;
            const sy = p.y - box.y0;
            for (let y = 0; y < 112; y++) {
                for (let x = 0; x < 112; x++) {
                    const d2 = (x - sx) ** 2 + (y - sy) ** 2;
                    img[y * 112 + x] = (img[y * 112 + x] ?? 0) + 100 * Math.exp(-d2 / (2 * 1.2 * 1.2));
                }
            }
        }
        const cut = mkCutout(params, box, img);
        return regridNorthUp(cut, wcs, grid);
    }

    const HALF = 12;
    // Flux-weighted centroid in a 7x7 native-pixel window (HALF output px per side, because the
    // grid is 4x oversampled), re-centred on its own result so the window does not bias it.
    function centroid(data: Float32Array, start: { x: number; y: number }): { x: number; y: number }
    {
        let px = start.x;
        let py = start.y;
        for (let iter = 0; iter < 6; iter++) {
            const cx = Math.round(px);
            const cy = Math.round(py);
            let sw = 0;
            let sx = 0;
            let sy = 0;
            for (let y = cy - HALF; y <= cy + HALF; y++) {
                for (let x = cx - HALF; x <= cx + HALF; x++) {
                    const v = data[y * grid.width + x] ?? NaN;
                    if (v === v) {
                        sw += v;
                        sx += v * x;
                        sy += v * y;
                    }
                }
            }
            px = sx / sw;
            py = sy / sw;
        }
        return { x: px, y: py };
    }

    it('stars agree across epochs and with the true sky position within 0.3 px', () => {
        const a = paint(pA);
        const b = paint(pB);
        let worst = 0;
        for (const s of stars) {
            const t = gridSkyToPix(grid, s);
            const ca = centroid(a, t);
            const cb = centroid(b, t);
            const dAB = Math.hypot(ca.x - cb.x, ca.y - cb.y);
            const dA = Math.hypot(ca.x - t.x, ca.y - t.y);
            const dB = Math.hypot(cb.x - t.x, cb.y - t.y);
            worst = Math.max(worst, dAB, dA, dB);
            expect(dAB).toBeLessThan(0.3);
            expect(dA).toBeLessThan(0.3);
            expect(dB).toBeLessThan(0.3);
        }
        console.log(`regrid star agreement, worst of all pairs: ${worst.toFixed(4)} px`);
    });
});

describe('real fixture', () => {
    const params = wcsFromHeader(headerFrom((f1 as any).imageHeader));
    const wcs = makeWcs(params);
    const box = box1.box;
    const image = f32('frame1.box.image.f32');
    const zodi = f32('frame1.box.zodi.f32');
    const cut = mkCutout(params, box, image, zodi);

    it('preserves every image bit from the pre-variance implementation', () => {
        const center = wcs.pixToSky({ x: (box.x0 + box.x1 - 1) / 2, y: (box.y0 + box.y1 - 1) / 2 });
        const out = regridNorthUp(cut, wcs, gridForView(center, 0.2, 4, 301));
        // Captured before refactoring by running the original regridNorthUp with
        // Node's --experimental-strip-types on this fixture and hashing all bytes.
        let hash = 0x811c9dc5;
        for (const byte of new Uint8Array(out.buffer, out.byteOffset, out.byteLength)) {
            hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
        }
        expect(out.length).toBe(90601);
        expect(hash).toBe(4210853044);
    });

    it('samples the coarse-grid centre within 0.05 native px of exact skyToPix', () => {
        const center = wcs.pixToSky({ x: (box.x0 + box.x1 - 1) / 2, y: (box.y0 + box.y1 - 1) / 2 });
        const grid = gridForView(center, 2, 4, 9);
        const pixel = { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 };
        const exact = wcs.skyToPix(gridPixToSky(grid, pixel));
        const sampled: number[] = [];
        for (const axis of ['x', 'y'] as const) {
            const ramp = new Float32Array(cut.width * cut.height);
            for (let y = 0; y < cut.height; y++) {
                for (let x = 0; x < cut.width; x++) {
                    ramp[y * cut.width + x] = axis === 'x' ? box.x0 + x : box.y0 + y;
                }
            }
            const out = regridNorthUp(mkCutout(params, box, ramp), wcs, grid);
            sampled.push(out[pixel.y * grid.width + pixel.x] ?? NaN);
        }
        expect(Math.hypot((sampled[0] ?? NaN) - exact.x, (sampled[1] ?? NaN) - exact.y)).toBeLessThan(0.05);
    });

    it('brightest pixel lands within 1 native pixel; NaN outside the footprint', () => {
        let best = -Infinity;
        let bi = 0;
        for (let k = 0; k < image.length; k++) {
            const v = (image[k] ?? 0) - (zodi[k] ?? 0);
            if (v > best) {
                best = v;
                bi = k;
            }
        }
        const bx = box.x0 + (bi % cut.width);
        const by = box.y0 + Math.floor(bi / cut.width);
        const inSky = wcs.pixToSky({ x: bx, y: by });
        const centreSky = wcs.pixToSky({ x: (box.x0 + box.x1 - 1) / 2, y: (box.y0 + box.y1 - 1) / 2 });
        const grid: OutputGrid = gridForView(centreSky, 0.2, 4, 301);
        const out = regridNorthUp(cut, wcs, grid);
        let ob = -Infinity;
        let oi = 0;
        let nan = 0;
        for (let k = 0; k < out.length; k++) {
            const ov = out[k] ?? NaN;
            if (ov !== ov) {
                nan++;
            } else if (ov > ob) {
                ob = ov;
                oi = k;
            }
        }
        const outSky = gridPixToSky(grid, { x: oi % grid.width, y: Math.floor(oi / grid.width) });
        const dra = (outSky.ra - inSky.ra) * Math.cos((inSky.dec * Math.PI) / 180);
        const sepPx = (Math.hypot(dra, outSky.dec - inSky.dec) * 3600) / 6.15;
        expect(ob).toBeGreaterThan(0);
        expect(sepPx).toBeLessThan(1);
        expect(nan).toBeGreaterThan(0);
        expect(nan).toBeLessThan(out.length);
        for (let k = 0; k < out.length; k += 37) {
            const s = gridPixToSky(grid, { x: k % grid.width, y: Math.floor(k / grid.width) });
            const p = wcs.skyToPix(s);
            const inside = p.x >= box.x0 && p.x <= box.x1 - 1 && p.y >= box.y0 && p.y <= box.y1 - 1;
            expect(out[k] === out[k]).toBe(inside);
        }
    });
});

describe('regridVariance', () => {
    const params: WcsParams = {
        crpix: [5, 5], crval: [150, 2],
        cd: [[-6.15 / 3600, 0], [0, 6.15 / 3600]], naxis: [9, 9],
    };
    const wcs = makeWcs(params);
    const box = { x0: 0, y0: 0, x1: 9, y1: 9 };
    const grid: OutputGrid = {
        center: wcs.pixToSky({ x: 4.25, y: 4.25 }),
        fovDeg: 0.03, pixelArcsec: 6.15 / 2, width: 25, height: 25,
    };

    it('keeps constant variance within exactly the image footprint and NaN mask', () => {
        const image = new Float32Array(81).fill(10);
        image[4 * 9 + 4] = NaN;
        const cut = mkCutout(params, box, image);
        cut.variance = new Float32Array(81).fill(12);
        const data = regridNorthUp(cut, wcs, grid);
        const variance = regridVariance(cut, wcs, grid)!;
        expect(variance.length).toBe(data.length);
        expect(data.some(Number.isNaN)).toBe(true);
        expect(data.some(Number.isFinite)).toBe(true);
        for (let i = 0; i < data.length; i++) {
            expect(variance[i]).toBe(Number.isNaN(data[i]) ? NaN : 12);
        }
    });

    it('puts a variance step on the same pixels with the same bilinear weights as IMAGE', () => {
        const step = Float32Array.from({ length: 81 }, (_, i) => i % 9 < 4 ? 2 : 18);
        const cut = mkCutout(params, box, step);
        cut.variance = step;
        const data = regridNorthUp(cut, wcs, grid);
        const variance = regridVariance(cut, wcs, grid)!;
        expect(variance).toEqual(data);
        expect(variance.some((v) => v > 2 && v < 18)).toBe(true);
    });

    it('never subtracts ZODI from variance, and masks invalid IMAGE minus ZODI', () => {
        const zodi = new Float32Array(81).fill(7);
        zodi[4 * 9 + 4] = NaN;
        const cut = mkCutout(params, box, new Float32Array(81).fill(10), zodi);
        cut.variance = new Float32Array(81).fill(12);
        const data = regridNorthUp(cut, wcs, grid);
        const variance = regridVariance(cut, wcs, grid)!;
        for (let i = 0; i < data.length; i++) {
            expect(variance[i]).toBe(Number.isNaN(data[i]) ? NaN : 12);
            if (Number.isFinite(data[i])) {
                expect(data[i]).toBe(3);
            }
        }
    });

    it.each([-1, NaN, Infinity, -Infinity])('masks an invalid V sample (%s) only in variance', (invalid) => {
        const cut = mkCutout(params, box, new Float32Array(81).fill(10));
        cut.variance = new Float32Array(81).fill(12);
        cut.variance[4 * 9 + 4] = invalid;
        const data = regridNorthUp(cut, wcs, grid);
        const variance = regridVariance(cut, wcs, grid)!;
        let extraNaN = 0;
        for (let i = 0; i < data.length; i++) {
            if (Number.isNaN(data[i])) {
                expect(variance[i]).toBeNaN();
            } else if (Number.isNaN(variance[i])) {
                extraNaN++;
            } else {
                expect(variance[i]).toBe(12);
            }
        }
        expect(extraNaN).toBeGreaterThan(0);
    });

    it('returns undefined without a variance plane', () => {
        const cut = mkCutout(params, box, new Float32Array(81));
        expect(regridVariance(cut, wcs, grid)).toBeUndefined();
    });
});

describe('timing', () => {
    it('regrids 600x600 from 112x112 quickly', () => {
        const params: WcsParams = {
            crpix: [1020, 1020], crval: [10, 10], cd: [[-6.15 / 3600, 0], [0, 6.15 / 3600]], naxis: [2040, 2040],
            a: { order: 2, coeffs: [[0, 0, 0], [0, 1e-6, 0], [2e-6, 0, 0]] },
            b: { order: 2, coeffs: [[0, 0, 3e-6], [0, 0, 0], [0, 0, 0]] },
        };
        const wcs = makeWcs(params);
        const box = { x0: 964, y0: 964, x1: 1076, y1: 1076 };
        const cut = mkCutout(params, box, new Float32Array(112 * 112).fill(1), new Float32Array(112 * 112));
        const grid = gridForView(wcs.pixToSky({ x: 1020, y: 1020 }), 0.26, 4, 600);
        expect(grid.width).toBe(599);
        regridNorthUp(cut, wcs, grid);
        const t0 = performance.now();
        const out = regridNorthUp(cut, wcs, grid);
        const ms = performance.now() - t0;
        console.log(`regrid ${grid.width}x${grid.height}: ${ms.toFixed(1)} ms`);
        expect(ms).toBeLessThan(200);
        expect(out[Math.floor(out.length / 2)]).toBeCloseTo(1, 5);
    });
});
