import { describe, expect, it } from 'vitest';
import {
    FalseColourError, centroidOffset, colourAt, falseColourLegend, falseColourRgba, pairStretch,
} from '../src/lib/falsecolour';
import type { ColourAt, PairStretch } from '../src/lib/falsecolour';
import { centroid } from '../src/lib/photometry';
import { stretchValue } from '../src/lib/player';
import type { PixelCoord, Stretch } from '../src/lib/types';

const SIZE = 41;
const CENTER: PixelCoord = { x: 20, y: 20 };

interface SyntheticSource extends PixelCoord {
    flux: number;
    sigma?: number;
}

function makePatch(sources: SyntheticSource[], sky = 0.5, size = SIZE): Float32Array
{
    const data = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let value = sky;
            for (const src of sources) {
                const sigma = src.sigma ?? 2;
                const variance = sigma * sigma;
                const d2 = (x - src.x) ** 2 + (y - src.y) ** 2;
                value += src.flux / (2 * Math.PI * variance) * Math.exp(-d2 / (2 * variance));
            }
            data[y * size + x] = value;
        }
    }
    return data;
}

// Fixed-seed LCG noise with robust MAD sigma ~ `sigma` (antithetic pairs keep zero-mean balance without Math.random).
function makeNoisePatch(
    size: number,
    sky: number,
    sigma: number,
    seed: number,
    sources: SyntheticSource[] = [],
): Float32Array
{
    let state = seed >>> 0;
    const halfSpan = sigma / 0.7413;
    const count = size * size;
    const data = new Float32Array(count);
    for (let i = 0; i < count; i += 2) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const u = state / 4294967296;
        const delta = (2 * u - 1) * halfSpan;
        data[i] = sky + delta;
        if (i + 1 < count) {
            data[i + 1] = sky - delta;
        }
    }
    for (const src of sources) {
        const s = src.sigma ?? 2;
        const variance = s * s;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const d2 = (x - src.x) ** 2 + (y - src.y) ** 2;
                const idx = y * size + x;
                data[idx] = (data[idx] ?? 0) + src.flux / (2 * Math.PI * variance) * Math.exp(-d2 / (2 * variance));
            }
        }
    }
    return data;
}

function expectPixelNear(px: Uint8ClampedArray, index: number, want: [number, number, number, number], tol = 1): void
{
    const o = index * 4;
    expect(Math.abs((px[o] ?? 0) - want[0])).toBeLessThanOrEqual(tol);
    expect(Math.abs((px[o + 1] ?? 0) - want[1])).toBeLessThanOrEqual(tol);
    expect(Math.abs((px[o + 2] ?? 0) - want[2])).toBeLessThanOrEqual(tol);
    expect(px[o + 3]).toBe(want[3]);
}

describe('pairStretch', () => {
    it('draws an equal-flux star grey even when the short picture also has a 50x brighter second star', () => {
        const starOne: PixelCoord = { x: 10, y: 20 };
        const starTwo: PixelCoord = { x: 32, y: 20 };
        const short = makePatch([
            { ...starOne, flux: 300 },
            { ...starTwo, flux: 15000 },
        ], 0.5);
        const long = makePatch([
            { ...starOne, flux: 300 },
        ], 2.0);

        const ps: PairStretch = pairStretch(short, long);
        const px = falseColourRgba(short, long, ps.sShort, ps.sLong);
        const o = (starOne.y * SIZE + starOne.x) * 4;
        const r = px[o]!;
        const g = px[o + 1]!;
        const b = px[o + 2]!;
        const a = px[o + 3]!;

        expect(r).toBeGreaterThan(10);
        expect(a).toBe(255);
        expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
        expect(Math.abs(r - b)).toBeLessThanOrEqual(2);
        expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
    });

    it('keeps two pure-noise pictures dark with no pixel above 110 in red, green or blue', () => {
        const nSize = 61;
        const short = makeNoisePatch(nSize, 0.5, 1, 101);
        const long = makeNoisePatch(nSize, 1.2, 1, 202);
        const ps = pairStretch(short, long);
        expect(Math.abs(ps.sigmaShort - 1)).toBeLessThan(0.15);
        expect(Math.abs(ps.sigmaLong - 1)).toBeLessThan(0.15);

        const px = falseColourRgba(short, long, ps.sShort, ps.sLong);
        for (let i = 0; i < short.length; i++) {
            const o = i * 4;
            expect(px[o]!).toBeLessThanOrEqual(110);
            expect(px[o + 1]!).toBeLessThanOrEqual(110);
            expect(px[o + 2]!).toBeLessThanOrEqual(110);
            expect(px[o + 3]).toBe(255);
        }
    });

    it('keeps red at or below 110 away from the star when long is noise-only and short has one bright star', () => {
        const nSize = 61;
        const starAt: PixelCoord = { x: 30, y: 30 };
        const short = makeNoisePatch(nSize, 0.5, 1, 303, [{ ...starAt, flux: 8000 }]);
        const long = makeNoisePatch(nSize, 1.2, 1, 404);
        const ps = pairStretch(short, long);
        const px = falseColourRgba(short, long, ps.sShort, ps.sLong);

        expect(px[(starAt.y * nSize + starAt.x) * 4 + 2]!).toBeGreaterThan(200);
        for (let y = 0; y < nSize; y++) {
            for (let x = 0; x < nSize; x++) {
                if (Math.hypot(x - starAt.x, y - starAt.y) > 10) {
                    const o = (y * nSize + x) * 4;
                    expect(px[o]!).toBeLessThanOrEqual(110);
                }
            }
        }
    });

    it('shares one range across both stretches while subtracting each picture median sky', () => {
        const short = makeNoisePatch(SIZE, 0.5, 1, 505, [{ ...CENTER, flux: 900 }]);
        const long = makeNoisePatch(SIZE, 7.25, 1, 606, [{ ...CENTER, flux: 400 }]);
        const ps = pairStretch(short, long);

        expect(ps.sShort.kind).toBe('asinh');
        expect(ps.sLong.kind).toBe('asinh');
        expect(Math.abs(ps.sShort.lo - 0.5)).toBeLessThan(0.2);
        expect(Math.abs(ps.sLong.lo - 7.25)).toBeLessThan(0.2);
        expect(ps.sLong.lo - ps.sShort.lo).toBeGreaterThan(6);
        expect(ps.sShort.hi - ps.sShort.lo).toBeCloseTo(ps.range, 9);
        expect(ps.sLong.hi - ps.sLong.lo).toBeCloseTo(ps.range, 9);
        expect(ps.sShort.hi - ps.sShort.lo).toBeCloseTo(ps.sLong.hi - ps.sLong.lo, 9);
    });

    it('gives hi > lo and draws opaque black pixels on flat pictures including 1e20 and mixed flat/varied pairs', () => {
        const flatCases: Array<[Float32Array, Float32Array]> = [
            [new Float32Array(16).fill(3), new Float32Array(16).fill(3)],
            [new Float32Array(16).fill(0), new Float32Array(16).fill(0)],
            [new Float32Array(16).fill(1e20), new Float32Array(16).fill(1e20)],
        ];
        for (const [short, long] of flatCases) {
            const ps = pairStretch(short, long);
            expect(ps.sShort.hi).toBeGreaterThan(ps.sShort.lo);
            expect(ps.sLong.hi).toBeGreaterThan(ps.sLong.lo);
            const px = falseColourRgba(short, long, ps.sShort, ps.sLong);
            for (let i = 0; i < short.length; i++) {
                expectPixelNear(px, i, [0, 0, 0, 255], 0);
            }
        }

        const ramp = Float32Array.from({ length: 16 }, (_, i) => i);
        const hugeFlat = new Float32Array(16).fill(1e20);
        for (const [short, long] of [[hugeFlat, ramp], [ramp, hugeFlat]] as const) {
            const ps = pairStretch(short, long);
            expect(ps.sShort.hi).toBeGreaterThan(ps.sShort.lo);
            expect(ps.sLong.hi).toBeGreaterThan(ps.sLong.lo);
            const px = falseColourRgba(short, long, ps.sShort, ps.sLong);
            expectPixelNear(px, 0, [0, 0, 0, 255], 0);
            for (let i = 0; i < short.length; i++) {
                expect(px[i * 4 + 3]).toBe(255);
            }
        }
    });

    it('ignores positive and negative infinity identically to missing entries', () => {
        const shortWithInf = Float32Array.from([
            Number.POSITIVE_INFINITY, 0.2, 1.4, Number.NEGATIVE_INFINITY, 3.8, 0.9, 12.0, Number.NaN, 2.1, 0.6,
        ]);
        const longWithInf = Float32Array.from([
            1.1, Number.NEGATIVE_INFINITY, 4.5, 2.2, Number.POSITIVE_INFINITY, 9.0, 1.7, 3.0, Number.NaN, 0.8,
        ]);
        const shortNan = Float32Array.from(Array.from(shortWithInf, (v) => (Number.isFinite(v) ? v : Number.NaN)));
        const longNan = Float32Array.from(Array.from(longWithInf, (v) => (Number.isFinite(v) ? v : Number.NaN)));

        expect(pairStretch(shortWithInf, longWithInf)).toEqual(pairStretch(shortNan, longNan));
    });

    it('throws FalseColourError on mismatched lengths, non-finite pictures or invalid options', () => {
        const ok = Float32Array.from([0, 1, 2, 3]);
        expect(() => pairStretch(ok, Float32Array.from([0, 1, 2]))).toThrow(FalseColourError);
        expect(() => pairStretch(new Float32Array(0), new Float32Array(0))).toThrow(FalseColourError);
        expect(() => pairStretch(Float32Array.from([Number.NaN, Number.POSITIVE_INFINITY]), Float32Array.from([1, 2]))).toThrow(FalseColourError);
        expect(() => pairStretch(Float32Array.from([1, 2]), Float32Array.from([Number.NEGATIVE_INFINITY, Number.NaN]))).toThrow(FalseColourError);

        for (const hiPercentile of [-1, 0, 50, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => pairStretch(ok, ok, { hiPercentile })).toThrow(FalseColourError);
        }
        for (const minSigma of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => pairStretch(ok, ok, { minSigma })).toThrow(FalseColourError);
        }
    });
});

describe('falseColourRgba', () => {
    const lin: Stretch = { lo: 0, hi: 1, kind: 'linear' };

    it('maps orange to long-only, blue to short-only, and grey/white/black to equal channels', () => {
        const short = Float32Array.from([0, 1, 1, 0, 0.5]);
        const long = Float32Array.from([1, 0, 1, 0, 0.5]);
        const px = falseColourRgba(short, long, lin, lin);

        expectPixelNear(px, 0, [255, 128, 0, 255], 1);
        expectPixelNear(px, 1, [0, 128, 255, 255], 1);
        expectPixelNear(px, 2, [255, 255, 255, 255], 0);
        expectPixelNear(px, 3, [0, 0, 0, 255], 0);

        const r = px[16]!;
        const g = px[17]!;
        const b = px[18]!;
        const a = px[19]!;
        expect(r).toBe(g);
        expect(g).toBe(b);
        expect(Math.abs(r - 128)).toBeLessThanOrEqual(1);
        expect(a).toBe(255);
    });

    it('renders non-finite values in either channel transparent, clamps finite range and overwrites reused out', () => {
        expectPixelNear(
            falseColourRgba(Float32Array.from([Number.POSITIVE_INFINITY]), Float32Array.from([0]), lin, lin),
            0,
            [0, 0, 0, 0],
            0,
        );

        const sShort: Stretch = { lo: 2, hi: 6, kind: 'linear' };
        const sLong: Stretch = { lo: 10, hi: 20, kind: 'linear' };
        const short = Float32Array.from([
            Number.NaN, 4, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 4, -5, 99, -5, 99,
        ]);
        const long = Float32Array.from([
            15, Number.NaN, 15, 15, Number.NEGATIVE_INFINITY, 0, 99, 99, -5,
        ]);
        const out = new Uint8ClampedArray(short.length * 4);
        for (let i = 0; i < short.length; i++) {
            out[i * 4] = 45;
            out[i * 4 + 1] = 90;
            out[i * 4 + 2] = 180;
            out[i * 4 + 3] = 255;
        }
        const px = falseColourRgba(short, long, sShort, sLong, out);
        expect(px).toBe(out);

        for (let i = 0; i < 5; i++) {
            expectPixelNear(px, i, [0, 0, 0, 0], 0);
        }
        expectPixelNear(px, 5, [0, 0, 0, 255], 0);
        expectPixelNear(px, 6, [255, 255, 255, 255], 0);
        expectPixelNear(px, 7, [255, 128, 0, 255], 1);
        expectPixelNear(px, 8, [0, 128, 255, 255], 1);
    });

    it('agrees with stretchValue across 50 values for the asinh stretch', () => {
        const n = 50;
        const short = new Float32Array(n);
        const long = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            short[i] = -1 + i * 0.35;
            long[i] = -2 + (n - 1 - i) * 0.6;
        }
        const sShort: Stretch = { lo: 0.5, hi: 12, kind: 'asinh' };
        const sLong: Stretch = { lo: 1, hi: 24, kind: 'asinh' };
        const px = falseColourRgba(short, long, sShort, sLong);

        for (let i = 0; i < n; i++) {
            const s = stretchValue(short[i]!, sShort);
            const l = stretchValue(long[i]!, sLong);
            const o = i * 4;
            expect(Math.abs(px[o]! - Math.round(255 * l))).toBeLessThanOrEqual(1);
            expect(Math.abs(px[o + 1]! - Math.round(255 * (s + l) / 2))).toBeLessThanOrEqual(1);
            expect(Math.abs(px[o + 2]! - Math.round(255 * s))).toBeLessThanOrEqual(1);
            expect(px[o + 3]).toBe(255);
        }
    });

    it('throws FalseColourError on broken stretches, mismatched lengths or wrong out size', () => {
        const a = Float32Array.from([0, 0.5, 1]);
        const b = Float32Array.from([0, 1]);
        expect(() => falseColourRgba(a, b, lin, lin)).toThrow(FalseColourError);
        expect(() => falseColourRgba(a, a, lin, lin, new Uint8ClampedArray(8))).toThrow(FalseColourError);
        expect(() => falseColourRgba(a, a, lin, lin, new Uint8ClampedArray(16))).toThrow(FalseColourError);

        const brokenStretches: Stretch[] = [
            { lo: 5, hi: 5, kind: 'linear' },
            { lo: 6, hi: 5, kind: 'asinh' },
            { lo: Number.NaN, hi: 1, kind: 'linear' },
            { lo: 0, hi: Number.NaN, kind: 'linear' },
            { lo: Number.NEGATIVE_INFINITY, hi: 1, kind: 'linear' },
            { lo: 0, hi: Number.POSITIVE_INFINITY, kind: 'linear' },
        ];
        for (const bad of brokenStretches) {
            expect(() => falseColourRgba(a, a, bad, lin)).toThrow(FalseColourError);
            expect(() => falseColourRgba(a, a, lin, bad)).toThrow(FalseColourError);
        }
    });
});

describe('colourAt', () => {
    const nSize = 61;
    const spot: PixelCoord = { x: 30, y: 30 };

    it('reports seen neither and invalid unmeasured index on pure noise', () => {
        const short = makeNoisePatch(nSize, 0.5, 1, 701);
        const long = makeNoisePatch(nSize, 1.1, 1, 702);
        const res: ColourAt = colourAt(short, long, nSize, nSize, spot);

        expect(res.seen).toBe('neither');
        expect(res.valid).toBe(false);
        expect(res.index).toBeNaN();
    });

    it('reports seen long or short with unmeasured index when a star appears in only one noisy picture', () => {
        const noisyShort = makeNoisePatch(nSize, 0.5, 1, 703);
        const noisyLong = makeNoisePatch(nSize, 1.1, 1, 704);
        const starShort = makeNoisePatch(nSize, 0.5, 1, 705, [{ ...spot, flux: 2000 }]);
        const starLong = makeNoisePatch(nSize, 1.1, 1, 706, [{ ...spot, flux: 2000 }]);

        const onlyLong = colourAt(noisyShort, starLong, nSize, nSize, spot);
        expect(onlyLong.seen).toBe('long');
        expect(onlyLong.valid).toBe(false);
        expect(onlyLong.index).toBeNaN();
        expect(onlyLong.snrLong).toBeGreaterThanOrEqual(3);
        expect(onlyLong.snrShort).toBeLessThan(3);

        const onlyShort = colourAt(starShort, noisyLong, nSize, nSize, spot);
        expect(onlyShort.seen).toBe('short');
        expect(onlyShort.valid).toBe(false);
        expect(onlyShort.index).toBeNaN();
        expect(onlyShort.snrShort).toBeGreaterThanOrEqual(3);
        expect(onlyShort.snrLong).toBeLessThan(3);
    });

    it('returns 0.5 when long is 3x short and 0 when equal on noisy and noise-free backgrounds', () => {
        const shortNoisy = makeNoisePatch(nSize, 0.5, 1, 707, [{ ...spot, flux: 900 }]);
        const long3xNoisy = makeNoisePatch(nSize, 1.1, 1, 708, [{ ...spot, flux: 2700 }]);
        const ratioNoisy = colourAt(shortNoisy, long3xNoisy, nSize, nSize, spot);
        expect(ratioNoisy.seen).toBe('both');
        expect(ratioNoisy.valid).toBe(true);
        expect(Math.abs(ratioNoisy.index - 0.5)).toBeLessThanOrEqual(0.03);

        const eqShortNoisy = makeNoisePatch(nSize, 0.5, 1, 709, [{ ...spot, flux: 1800 }]);
        const eqLongNoisy = makeNoisePatch(nSize, 1.1, 1, 710, [{ ...spot, flux: 1800 }]);
        const eqNoisy = colourAt(eqShortNoisy, eqLongNoisy, nSize, nSize, spot);
        expect(eqNoisy.seen).toBe('both');
        expect(eqNoisy.valid).toBe(true);
        expect(Math.abs(eqNoisy.index)).toBeLessThanOrEqual(0.02);

        const cleanShort = makePatch([{ ...CENTER, flux: 600 }], 0.5);
        const cleanLong3x = makePatch([{ ...CENTER, flux: 1800 }], 1.25);
        const cleanRatio = colourAt(cleanShort, cleanLong3x, SIZE, SIZE, CENTER);
        expect(cleanRatio.seen).toBe('both');
        expect(cleanRatio.valid).toBe(true);
        expect(Math.abs(cleanRatio.index - 0.5)).toBeLessThanOrEqual(0.03);

        const cleanEq = colourAt(cleanShort, makePatch([{ ...CENTER, flux: 600 }], 1.25), SIZE, SIZE, CENTER);
        expect(cleanEq.seen).toBe('both');
        expect(cleanEq.valid).toBe(true);
        expect(Math.abs(cleanEq.index)).toBeLessThanOrEqual(0.02);
    });

    it('honours minSnr and passes aperture radius options through', () => {
        const faintShort = makeNoisePatch(nSize, 0.5, 1, 711, [{ ...spot, flux: 250 }]);
        const faintLong = makeNoisePatch(nSize, 1.1, 1, 712, [{ ...spot, flux: 250 }]);

        const loose = colourAt(faintShort, faintLong, nSize, nSize, spot, { minSnr: 1 });
        expect(loose.seen).toBe('both');
        expect(loose.valid).toBe(true);
        expect(Number.isFinite(loose.index)).toBe(true);

        const strict = colourAt(faintShort, faintLong, nSize, nSize, spot, { minSnr: 50 });
        expect(strict.seen).toBe('neither');
        expect(strict.valid).toBe(false);
        expect(strict.index).toBeNaN();

        const wideStar = makePatch([{ ...spot, flux: 2000, sigma: 5 }], 0.5, nSize);
        const r3 = colourAt(wideStar, wideStar, nSize, nSize, spot, { radius: 3 });
        const r8 = colourAt(wideStar, wideStar, nSize, nSize, spot, { radius: 8 });
        expect(r8.short).toBeGreaterThan(r3.short * 2);
        expect(r8.long).toBeGreaterThan(r3.long * 2);
    });

    it('clamps negative sums to 0, handles invalid apertures, and throws on invalid minSnr', () => {
        const dippedShort = makePatch([{ ...CENTER, flux: -50 }], 0.5);
        const brightLong = makePatch([{ ...CENTER, flux: 1200 }], 0.5);
        const clamped = colourAt(dippedShort, brightLong, SIZE, SIZE, CENTER);
        expect(clamped.short).toBe(0);
        expect(clamped.seen).toBe('long');
        expect(clamped.valid).toBe(false);
        expect(clamped.index).toBeNaN();

        const withNan = makePatch([{ ...CENTER, flux: 1200 }], 0.5);
        withNan[CENTER.y * SIZE + CENTER.x] = Number.NaN;
        const badNan = colourAt(withNan, brightLong, SIZE, SIZE, CENTER);
        expect(badNan.short).toBeNaN();
        expect(badNan.snrShort).toBe(0);
        expect(badNan.seen).toBe('long');
        expect(badNan.valid).toBe(false);
        expect(badNan.index).toBeNaN();

        const nearEdge = colourAt(brightLong, brightLong, SIZE, SIZE, { x: 2, y: 2 });
        expect(nearEdge.seen).toBe('neither');
        expect(nearEdge.snrShort).toBe(0);
        expect(nearEdge.snrLong).toBe(0);
        expect(nearEdge.valid).toBe(false);
        expect(nearEdge.index).toBeNaN();

        for (const minSnr of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => colourAt(brightLong, brightLong, SIZE, SIZE, CENTER, { minSnr })).toThrow(FalseColourError);
        }
    });
});

describe('centroidOffset', () => {
    it('measures subpixel offset between sources at (20, 20) and (21.5, 20), and returns null when missing', () => {
        const short = makePatch([{ x: 20, y: 20, flux: 1500 }], 0.5);
        const long = makePatch([{ x: 21.5, y: 20, flux: 1500 }], 0.5);
        const offset = centroidOffset(short, long, SIZE, SIZE, CENTER);

        expect(offset).not.toBeNull();
        expect(Math.abs(offset!.dx - 1.5)).toBeLessThanOrEqual(0.2);
        expect(Math.abs(offset!.dy)).toBeLessThanOrEqual(0.05);
        expect(Math.abs(offset!.distance - 1.5)).toBeLessThanOrEqual(0.2);

        const longDiag = makePatch([{ x: 18.5, y: 22, flux: 1500 }], 0.5);
        const diag = centroidOffset(short, longDiag, SIZE, SIZE, CENTER);
        expect(diag).not.toBeNull();
        expect(Math.abs(diag!.dx - (-1.5))).toBeLessThanOrEqual(0.2);
        expect(Math.abs(diag!.dy - 2)).toBeLessThanOrEqual(0.2);
        expect(Math.abs(diag!.distance - 2.5)).toBeLessThanOrEqual(0.2);

        const empty = makePatch([], 0.5);
        expect(centroid(empty, SIZE, SIZE, CENTER)).toBeUndefined();
        expect(centroidOffset(short, empty, SIZE, SIZE, CENTER)).toBeNull();
        expect(centroidOffset(empty, long, SIZE, SIZE, CENTER)).toBeNull();
    });

    it('passes half to centroid so a second star 9 px away pulls dx at half 12 but not at half 3', () => {
        const shortTwo = makePatch([
            { x: 20, y: 20, flux: 1500 },
            { x: 29, y: 20, flux: 1500 },
        ], 0.5);
        const longOne = makePatch([{ x: 20, y: 20, flux: 1500 }], 0.5);

        const tight = centroidOffset(shortTwo, longOne, SIZE, SIZE, CENTER, 3);
        const wide = centroidOffset(shortTwo, longOne, SIZE, SIZE, CENTER, 12);

        expect(tight).not.toBeNull();
        expect(wide).not.toBeNull();
        expect(Math.abs(tight!.dx)).toBeLessThan(0.05);
        expect(Math.abs(wide!.dx - tight!.dx)).toBeGreaterThan(1);
    });
});

describe('falseColourLegend', () => {
    it('returns the exact fixed wording for (1.12, 4.42) and rejects invalid or reversed wavelengths', () => {
        expect(falseColourLegend(1.12, 4.42)).toEqual({
            red: 'Orange: 4.42 µm (the longer wavelength)',
            blue: 'Blue: 1.12 µm (the shorter wavelength)',
            note: 'False colour, not what an eye would see. Both pictures share one brightness scale after each '
                + "one's own sky level is taken off: blue means brighter at the shorter wavelength, orange means "
                + 'brighter at the longer one, grey means about the same. Coloured rims around bright stars can '
                + 'come from the two pictures not being equally sharp.',
        });

        expect(falseColourLegend(0.9, 4.5)).toMatchObject({
            red: 'Orange: 4.50 µm (the longer wavelength)',
            blue: 'Blue: 0.90 µm (the shorter wavelength)',
        });

        expect(() => falseColourLegend(4.42, 1.12)).toThrow(FalseColourError);
        expect(() => falseColourLegend(2, 2)).toThrow(FalseColourError);
        expect(() => falseColourLegend(Number.NaN, 2)).toThrow(FalseColourError);
        expect(() => falseColourLegend(1, Number.NaN)).toThrow(FalseColourError);
        expect(() => falseColourLegend(0, 2)).toThrow(FalseColourError);
        expect(() => falseColourLegend(-1, 2)).toThrow(FalseColourError);
        expect(() => falseColourLegend(1, Number.POSITIVE_INFINITY)).toThrow(FalseColourError);
    });
});

describe('determinism and string hygiene', () => {
    it('produces identical outputs across repeated calls without mutating inputs', () => {
        const short = makePatch([{ x: 20, y: 20, flux: 900 }], 0.5);
        const long = makePatch([{ x: 21.2, y: 20, flux: 1400 }], 0.7);
        short[0] = Number.NaN;
        const shortCopy = short.slice();
        const longCopy = long.slice();

        const ps1 = pairStretch(short, long);
        const ps2 = pairStretch(short, long);
        expect(ps1).toEqual(ps2);

        const rgba1 = falseColourRgba(short, long, ps1.sShort, ps1.sLong);
        const rgba2 = falseColourRgba(short, long, ps1.sShort, ps1.sLong);
        expect(rgba1).toEqual(rgba2);

        expect(colourAt(short, long, SIZE, SIZE, CENTER)).toEqual(colourAt(short, long, SIZE, SIZE, CENTER));
        expect(centroidOffset(short, long, SIZE, SIZE, CENTER)).toEqual(centroidOffset(short, long, SIZE, SIZE, CENTER));
        expect(falseColourLegend(1.12, 4.42)).toEqual(falseColourLegend(1.12, 4.42));

        expect(short).toEqual(shortCopy);
        expect(long).toEqual(longCopy);
    });

    it('never emits forbidden tokens or claim words in any legend or error string', () => {
        const collected: string[] = [];
        for (const [s, l] of [[0.75, 1.12], [1.12, 4.42], [2.05, 4.98]] as const) {
            const leg = falseColourLegend(s, l);
            collected.push(leg.red, leg.blue, leg.note);
        }
        const ok = Float32Array.from([0, 1]);
        const badCalls: Array<() => unknown> = [
            () => pairStretch(Float32Array.from([Number.NaN]), ok),
            () => pairStretch(ok, Float32Array.from([1, 2, 3])),
            () => pairStretch(ok, ok, { hiPercentile: 50 }),
            () => pairStretch(ok, ok, { minSigma: -1 }),
            () => falseColourRgba(new Float32Array(2), new Float32Array(3), { lo: 0, hi: 1, kind: 'linear' }, { lo: 0, hi: 1, kind: 'linear' }),
            () => falseColourRgba(ok, ok, { lo: 5, hi: 5, kind: 'linear' }, { lo: 0, hi: 1, kind: 'linear' }),
            () => falseColourRgba(ok, ok, { lo: 0, hi: 1, kind: 'linear' }, { lo: 0, hi: 1, kind: 'linear' }, new Uint8ClampedArray(4)),
            () => colourAt(ok, ok, 2, 1, { x: 0, y: 0 }, { minSnr: -1 }),
            () => falseColourLegend(Number.NaN, Number.POSITIVE_INFINITY),
            () => falseColourLegend(4.42, 1.12),
        ];
        for (const fn of badCalls) {
            try {
                fn();
            } catch (err) {
                if (err instanceof Error) {
                    collected.push(err.message);
                }
            }
        }
        expect(collected.length).toBeGreaterThanOrEqual(19);
        for (const text of collected) {
            expect(text).not.toContain('Na' + 'N');
            expect(text).not.toContain('Infin' + 'ity');
            expect(text).not.toContain('undef' + 'ined');
            expect(text).not.toMatch(/discover|detect|confirm|prove/i);
        }
    });
});
