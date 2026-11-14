import { describe, expect, it } from 'vitest';
import {
    FalseColourError, NO_COLOUR_HATCH, centroidOffset, colourAt, falseColourLegend, falseColourRgba as renderRgba, pairStretch,
} from '../src/lib/falsecolour';
import type { ColourAt, PairStretch } from '../src/lib/falsecolour';
import { centroid } from '../src/lib/photometry';
import { stretchValue } from '../src/lib/player';
import type { PixelCoord, Stretch } from '../src/lib/types';

const SIZE = 41;
const CENTER: PixelCoord = { x: 20, y: 20 };

function falseColourRgba(short: Float32Array, long: Float32Array, sShort: Stretch, sLong: Stretch, out?: Uint8ClampedArray): Uint8ClampedArray
{
    return renderRgba(short, long, sShort, sLong, out, short.length);
}

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

    it.each([['short', 0.9, 0.45], ['long', 0.45, 0.9]])('retains normalized colour for a %s-bright star above the scale', (_name, short, long) => {
        const reference = falseColourRgba(Float32Array.of(short), Float32Array.of(long), lin, lin);
        for (const factor of [1.5 / 0.9, 10 / 0.9, 100 / 0.9]) {
            const pixel = falseColourRgba(Float32Array.of(short * factor), Float32Array.of(long * factor), lin, lin);
            for (let channel = 0; channel < 3; channel++) {
                expect(Math.abs(pixel[channel]! * 0.9 - reference[channel]!)).toBeLessThanOrEqual(2);
            }
            expect(pixel[0] === 255 && pixel[2] === 255).toBe(false);
            expect(Math.sign(pixel[2]! - pixel[0]!)).toBe(Math.sign(short - long));
        }
    });

    it.each(['linear', 'asinh'] as const)('keeps saturated colours consistent across 1.5, 10 and 100 times the scale with %s', kind => {
        const stretch: Stretch = { lo: 0, hi: 1, kind };
        for (const [short, long] of [[1, 0.5], [0.5, 1]]) {
            const colours = [1.5, 10, 100].map(factor => falseColourRgba(
                Float32Array.of(short! * factor), Float32Array.of(long! * factor), stretch, stretch));
            for (const pixel of colours) {
                for (let channel = 0; channel < 3; channel++) {
                    expect(Math.abs(pixel[channel]! - colours[0]![channel]!)).toBeLessThanOrEqual(2);
                }
            }
        }
    });

    it.each(['linear', 'asinh'] as const)('keeps a saturated core blue at every brightness with %s stretches', kind => {
        const s: Stretch = { lo: 2, hi: 12, kind };
        const l: Stretch = { lo: 7, hi: 17, kind };
        const colours = [1, 10, 100].map(factor => falseColourRgba(
            Float32Array.of(2 + 330 * factor), Float32Array.of(7 + 100 * factor), s, l));
        for (const colour of colours) {
            expect(colour[2]).toBe(255);
            expect(colour[2]!).toBeGreaterThan(colour[0]!);
            expect(Math.abs(colour[0]! - colours[0]![0]!)).toBeLessThanOrEqual(2);
        }
        const equal = falseColourRgba(Float32Array.of(332), Float32Array.of(337), s, l);
        expect(Array.from(equal)).toEqual([255, 255, 255, 255]);
    });

    it.each(['linear', 'asinh'] as const)('preserves all unsaturated bytes from stretchValue for %s', kind => {
        const s: Stretch = { lo: 2, hi: 12, kind };
        const l: Stretch = { lo: 7, hi: 17, kind };
        const short = Float32Array.from({ length: 101 }, (_, i) => 1 + i / 10);
        const long = Float32Array.from({ length: 101 }, (_, i) => 17 - i / 10);
        const before = new Uint8ClampedArray(short.length * 4);
        for (let i = 0; i < short.length; i++) {
            const blue = stretchValue(short[i]!, s);
            const red = stretchValue(long[i]!, l);
            before.set([255 * red, 255 * (red + blue) / 2, 255 * blue, 255], 4 * i);
        }
        expect(falseColourRgba(short, long, s, l)).toEqual(before);
    });

    it('keeps the paired-stretch star core blue from 330/100 through 33000/10000', () => {
        const centres: number[][] = [];
        for (const factor of [1, 10, 100]) {
            const short = makePatch([{ ...CENTER, flux: 330 * factor }]);
            const long = makePatch([{ ...CENTER, flux: 100 * factor }], 2);
            const stretch = pairStretch(short, long);
            const rgba = falseColourRgba(short, long, stretch.sShort, stretch.sLong);
            const p = (CENTER.y * SIZE + CENTER.x) * 4;
            const centre = Array.from(rgba.slice(p, p + 4));
            expect(centre[2]!).toBeGreaterThan(centre[0]!);
            centres.push(centre);
        }
        for (let channel = 0; channel < 3; channel++) {
            expect(Math.abs(centres[0]![channel]! - centres[2]![channel]!)).toBeLessThanOrEqual(2);
        }
    });

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

    it('hatches non-finite values, preserves saturated ratios and overwrites reused out', () => {
        expectPixelNear(
            falseColourRgba(Float32Array.from([Number.POSITIVE_INFINITY]), Float32Array.from([0]), lin, lin),
            0,
            [...NO_COLOUR_HATCH],
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
            expectPixelNear(px, i, i % 4 === 0 ? [...NO_COLOUR_HATCH] : [0, 0, 0, 0], 0);
        }
        expectPixelNear(px, 5, [0, 0, 0, 255], 0);
        expectPixelNear(px, 6, [94, 174, 255, 255], 0);
        expectPixelNear(px, 7, [255, 128, 0, 255], 1);
        expectPixelNear(px, 8, [0, 128, 255, 255], 1);
    });

    it('agrees with stretchValue across 50 unsaturated values for the asinh stretch', () => {
        const n = 50;
        const short = new Float32Array(n);
        const long = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            short[i] = -1 + i * 0.2;
            long[i] = -2 + (n - 1 - i) * 0.4;
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
        const res: ColourAt = colourAt(short, long, nSize, nSize, spot, { pixelArcsec: 6.15 });

        expect(res.seen).toBe('neither');
        expect(res.valid).toBe(false);
        expect(res.index).toBeNaN();
    });

    it('reports seen long or short with unmeasured index when a star appears in only one noisy picture', () => {
        const noisyShort = makeNoisePatch(nSize, 0.5, 1, 703);
        const noisyLong = makeNoisePatch(nSize, 1.1, 1, 704);
        const starShort = makeNoisePatch(nSize, 0.5, 1, 705, [{ ...spot, flux: 2000 }]);
        const starLong = makeNoisePatch(nSize, 1.1, 1, 706, [{ ...spot, flux: 2000 }]);

        const onlyLong = colourAt(noisyShort, starLong, nSize, nSize, spot, { pixelArcsec: 6.15 });
        expect(onlyLong.seen).toBe('long');
        expect(onlyLong.valid).toBe(false);
        expect(onlyLong.index).toBeNaN();
        expect(onlyLong.snrLong).toBeGreaterThanOrEqual(3);
        expect(onlyLong.snrShort).toBeLessThan(3);

        const onlyShort = colourAt(starShort, noisyLong, nSize, nSize, spot, { pixelArcsec: 6.15 });
        expect(onlyShort.seen).toBe('short');
        expect(onlyShort.valid).toBe(false);
        expect(onlyShort.index).toBeNaN();
        expect(onlyShort.snrShort).toBeGreaterThanOrEqual(3);
        expect(onlyShort.snrLong).toBeLessThan(3);
    });

    it('returns 0.5 when long is 3x short and 0 when equal on noisy and noise-free backgrounds', () => {
        const shortNoisy = makeNoisePatch(nSize, 0.5, 1, 707, [{ ...spot, flux: 900 }]);
        const long3xNoisy = makeNoisePatch(nSize, 1.1, 1, 708, [{ ...spot, flux: 2700 }]);
        const ratioNoisy = colourAt(shortNoisy, long3xNoisy, nSize, nSize, spot, { pixelArcsec: 6.15 });
        expect(ratioNoisy.seen).toBe('both');
        expect(ratioNoisy.valid).toBe(true);
        expect(Math.abs(ratioNoisy.index - 0.5)).toBeLessThanOrEqual(0.03);

        const eqShortNoisy = makeNoisePatch(nSize, 0.5, 1, 709, [{ ...spot, flux: 1800 }]);
        const eqLongNoisy = makeNoisePatch(nSize, 1.1, 1, 710, [{ ...spot, flux: 1800 }]);
        const eqNoisy = colourAt(eqShortNoisy, eqLongNoisy, nSize, nSize, spot, { pixelArcsec: 6.15 });
        expect(eqNoisy.seen).toBe('both');
        expect(eqNoisy.valid).toBe(true);
        expect(Math.abs(eqNoisy.index)).toBeLessThanOrEqual(0.02);

        // Noise-free patches have snr = 0, so pass minSnr: 0 to check the ratio arithmetic alone.
        const cleanShort = makePatch([{ ...CENTER, flux: 600 }], 0.5);
        const cleanLong3x = makePatch([{ ...CENTER, flux: 1800 }], 1.25);
        const cleanRatio = colourAt(cleanShort, cleanLong3x, SIZE, SIZE, CENTER, { pixelArcsec: 6.15, minSnr: 0 });
        expect(cleanRatio.seen).toBe('both');
        expect(cleanRatio.valid).toBe(true);
        expect(Math.abs(cleanRatio.index - 0.5)).toBeLessThanOrEqual(0.03);

        const cleanEq = colourAt(
            cleanShort,
            makePatch([{ ...CENTER, flux: 600 }], 1.25),
            SIZE,
            SIZE,
            CENTER,
            { pixelArcsec: 6.15, minSnr: 0 },
        );
        expect(cleanEq.seen).toBe('both');
        expect(cleanEq.valid).toBe(true);
        expect(Math.abs(cleanEq.index)).toBeLessThanOrEqual(0.02);
    });

    it('honours minSnr and passes aperture radius options through', () => {
        const faintShort = makeNoisePatch(nSize, 0.5, 1, 711, [{ ...spot, flux: 250 }]);
        const faintLong = makeNoisePatch(nSize, 1.1, 1, 712, [{ ...spot, flux: 250 }]);

        const loose = colourAt(faintShort, faintLong, nSize, nSize, spot, { pixelArcsec: 6.15, minSnr: 1 });
        expect(loose.seen).toBe('both');
        expect(loose.valid).toBe(true);
        expect(Number.isFinite(loose.index)).toBe(true);

        const strict = colourAt(faintShort, faintLong, nSize, nSize, spot, { pixelArcsec: 6.15, minSnr: 50 });
        expect(strict.seen).toBe('neither');
        expect(strict.valid).toBe(false);
        expect(strict.index).toBeNaN();

        const wideStar = makePatch([{ ...spot, flux: 2000, sigma: 5 }], 0.5, nSize);
        const r3 = colourAt(wideStar, wideStar, nSize, nSize, spot, { pixelArcsec: 6.15, radius: 3 });
        const r8 = colourAt(wideStar, wideStar, nSize, nSize, spot, { pixelArcsec: 6.15, radius: 8 });
        expect(r8.short).toBeGreaterThan(r3.short * 2);
        expect(r8.long).toBeGreaterThan(r3.long * 2);
    });

    it('clamps negative sums to 0, handles invalid apertures, and throws on invalid minSnr', () => {
        // Seeded low-noise patches keep brightLong far above minSnr while dippedShort stays negative.
        const dippedShort = makeNoisePatch(SIZE, 0.5, 0.01, 713, [{ ...CENTER, flux: -50 }]);
        const brightLong = makeNoisePatch(SIZE, 0.5, 0.01, 714, [{ ...CENTER, flux: 1200 }]);
        const clamped = colourAt(dippedShort, brightLong, SIZE, SIZE, CENTER, { pixelArcsec: 6.15 });
        expect(clamped.short).toBe(0);
        expect(clamped.seen).toBe('long');
        expect(clamped.valid).toBe(false);
        expect(clamped.index).toBeNaN();

        const withNan = makeNoisePatch(SIZE, 0.5, 0.01, 715, [{ ...CENTER, flux: 1200 }]);
        withNan[CENTER.y * SIZE + CENTER.x] = Number.NaN;
        const badNan = colourAt(withNan, brightLong, SIZE, SIZE, CENTER, { pixelArcsec: 6.15 });
        expect(badNan.short).toBeNaN();
        expect(badNan.snrShort).toBe(0);
        expect(badNan.seen).toBe('long');
        expect(badNan.valid).toBe(false);
        expect(badNan.index).toBeNaN();

        const nearEdge = colourAt(brightLong, brightLong, SIZE, SIZE, { x: 2, y: 2 }, { pixelArcsec: 6.15 });
        expect(nearEdge.seen).toBe('neither');
        expect(nearEdge.snrShort).toBe(0);
        expect(nearEdge.snrLong).toBe(0);
        expect(nearEdge.valid).toBe(false);
        expect(nearEdge.index).toBeNaN();

        for (const minSnr of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => colourAt(brightLong, brightLong, SIZE, SIZE, CENTER, { pixelArcsec: 6.15, minSnr })).toThrow(FalseColourError);
        }
    });

    it('scales snrShort in a 4:1 ratio between 6.15 and 6.15 / 4 arcsec pixels, both below noiseScale 1', () => {
        const short = makeNoisePatch(nSize, 0.5, 1, 720, [{ ...spot, flux: 1500 }]);
        const long = makeNoisePatch(nSize, 1.1, 1, 721, [{ ...spot, flux: 1500 }]);

        const unscaled = colourAt(short, long, nSize, nSize, spot, { pixelArcsec: 6.15, noiseScale: 1 });
        const native = colourAt(short, long, nSize, nSize, spot, { pixelArcsec: 6.15 });
        const fine = colourAt(short, long, nSize, nSize, spot, { pixelArcsec: 6.15 / 4 });

        expect(fine.snrShort).toBeGreaterThan(0);
        expect(native.snrShort).toBeLessThan(unscaled.snrShort);
        expect(fine.snrShort).toBeLessThan(unscaled.snrShort);
        expect(Math.abs(native.snrShort / fine.snrShort - 4) / 4).toBeLessThanOrEqual(1e-9);
    });

    it('marks a source with plain snr between 3 and 4 as seen with noiseScale 1 but not at pixelArcsec 6.15', () => {
        const bSize = 301;
        const bSpot: PixelCoord = { x: 150, y: 150 };
        const ap = { radius: 50, annulusIn: 65, annulusOut: 145 };
        const marginalShort = makeNoisePatch(bSize, 0.5, 1, 730, [{ ...bSpot, flux: 345 }]);
        const emptyLong = makeNoisePatch(bSize, 1.1, 1, 731);

        const plain = colourAt(marginalShort, emptyLong, bSize, bSize, bSpot, { ...ap, pixelArcsec: 6.15, noiseScale: 1 });
        expect(plain.snrShort).toBeGreaterThan(3);
        expect(plain.snrShort).toBeLessThan(4);
        expect(plain.seen).toBe('short');

        const scaled = colourAt(marginalShort, emptyLong, bSize, bSize, bSpot, { ...ap, pixelArcsec: 6.15 });
        expect(scaled.snrShort).toBeLessThan(3);
        expect(scaled.seen).toBe('neither');
    });

    it('throws FalseColourError when pixelArcsec is zero, negative or non-finite', () => {
        const pic = makePatch([{ ...CENTER, flux: 1200 }], 0.5);
        for (const pixelArcsec of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            expect(() => colourAt(pic, pic, SIZE, SIZE, CENTER, { pixelArcsec })).toThrow(FalseColourError);
            expect(() => colourAt(pic, pic, SIZE, SIZE, CENTER, { pixelArcsec, noiseScale: 2 })).toThrow(FalseColourError);
        }
    });

    it('throws FalseColourError when noiseScale is below 1 or non-finite', () => {
        const pic = makePatch([{ ...CENTER, flux: 1200 }], 0.5);
        for (const noiseScale of [0, 0.5, 0.99, 1 - Number.EPSILON, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            expect(() => colourAt(pic, pic, SIZE, SIZE, CENTER, { pixelArcsec: 6.15, noiseScale })).toThrow(FalseColourError);
        }
    });

    it('treats a noise-free positive source as unseen at default minSnr and seen with minSnr 0', () => {
        const cleanShort = makePatch([{ ...CENTER, flux: 600 }], 0.5);
        const cleanLong = makePatch([{ ...CENTER, flux: 1200 }], 1.25);

        const atDefault = colourAt(cleanShort, cleanLong, SIZE, SIZE, CENTER, { pixelArcsec: 6.15 });
        expect(atDefault.seen).toBe('neither');
        expect(atDefault.valid).toBe(false);
        expect(atDefault.index).toBeNaN();

        const atZero = colourAt(cleanShort, cleanLong, SIZE, SIZE, CENTER, { pixelArcsec: 6.15, minSnr: 0 });
        expect(atZero.seen).toBe('both');
        expect(atZero.valid).toBe(true);
        expect(Number.isFinite(atZero.index)).toBe(true);

        // Even with minSnr 0, a flat patch (sum 0) and a dip (sum below 0) are not seen.
        const flat = makePatch([], 0.5);
        const dipped = makePatch([{ ...CENTER, flux: -50 }], 0.5);
        const flatAtZero = colourAt(flat, flat, SIZE, SIZE, CENTER, { pixelArcsec: 6.15, minSnr: 0 });
        expect(flatAtZero.seen).toBe('neither');
        expect(flatAtZero.valid).toBe(false);
        expect(colourAt(dipped, dipped, SIZE, SIZE, CENTER, { pixelArcsec: 6.15, minSnr: 0 }).seen).toBe('neither');
    });

    it('reports seen neither on a quantised sky ring where MAD clips to zero despite +/-10 outliers', () => {
        const qSize = 64;
        const centre: PixelCoord = { x: 32, y: 32 };
        // Default sky-ring bounds from aperture() in src/lib/photometry.ts (radius = 10, annulusIn = 16, annulusOut = 24).
        const annulusIn = 16;
        const annulusOut = 24;
        const inner2 = annulusIn * annulusIn;
        const outer2 = annulusOut * annulusOut;
        const quantised = new Float32Array(qSize * qSize);
        let ringIdx = 0;
        let sign = 1;
        const xMin = Math.max(0, Math.ceil(centre.x - annulusOut));
        const xMax = Math.min(qSize - 1, Math.floor(centre.x + annulusOut));
        const yMin = Math.max(0, Math.ceil(centre.y - annulusOut));
        const yMax = Math.min(qSize - 1, Math.floor(centre.y + annulusOut));
        for (let y = yMin; y <= yMax; y++) {
            const dy2 = (y - centre.y) ** 2;
            for (let x = xMin; x <= xMax; x++) {
                const distance2 = (x - centre.x) ** 2 + dy2;
                if (distance2 < inner2 || distance2 > outer2) {
                    continue;
                }
                if (ringIdx % 3 === 0) {
                    quantised[y * qSize + x] = 10 * sign;
                    sign = -sign;
                }
                ringIdx++;
            }
        }
        // A bright centre: it is unseen only because the ring gives no measurable noise, not because it is faint.
        quantised[centre.y * qSize + centre.x] = 1000;

        const res = colourAt(quantised, quantised, qSize, qSize, centre, { pixelArcsec: 6.15 });
        expect(res.short).toBeCloseTo(1000, 3);
        expect(res.snrShort).toBe(0);
        expect(res.seen).toBe('neither');
        expect(res.valid).toBe(false);
        expect(res.index).toBeNaN();
    });

    it('lets an explicit noiseScale of 2 override the pixelArcsec rule', () => {
        const short = makeNoisePatch(nSize, 0.5, 1, 740, [{ ...spot, flux: 1500 }]);
        const long = makeNoisePatch(nSize, 1.1, 1, 741, [{ ...spot, flux: 1800 }]);

        const one = colourAt(short, long, nSize, nSize, spot, { pixelArcsec: 6.15 / 4, noiseScale: 1 });
        const two = colourAt(short, long, nSize, nSize, spot, { pixelArcsec: 6.15 / 4, noiseScale: 2 });
        const byRule = colourAt(short, long, nSize, nSize, spot, { pixelArcsec: 6.15 / 4 });

        expect(two.snrShort).toBeCloseTo(one.snrShort / 2, 9);
        expect(two.snrLong).toBeCloseTo(one.snrLong / 2, 9);
        expect(two.snrShort).toBeGreaterThan(byRule.snrShort);

        // An override above the rule's 5.6 must also win, so the rule is not a ceiling.
        const ten = colourAt(short, long, nSize, nSize, spot, { pixelArcsec: 6.15 / 4, noiseScale: 10 });
        expect(ten.snrShort).toBeCloseTo(one.snrShort / 10, 9);
        expect(ten.snrShort).toBeLessThan(byRule.snrShort);
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
                + 'brighter at the longer one, grey means about the same. Where a star is too bright for that scale, '
                + "both colours are scaled down together, so its colour is kept, though paler, but its brightness is not. Coloured rims or one-sided edges around bright stars come from how the detector's pixels fell on the star in each picture and from the two pictures not being equally sharp; they are not the star's colour. Coloured speckle in dark sky is noise.",
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

        expect(colourAt(short, long, SIZE, SIZE, CENTER, { pixelArcsec: 6.15 }))
            .toEqual(colourAt(short, long, SIZE, SIZE, CENTER, { pixelArcsec: 6.15 }));
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
            () => colourAt(ok, ok, 2, 1, { x: 0, y: 0 }, { pixelArcsec: 6.15, minSnr: -1 }),
            () => colourAt(ok, ok, 2, 1, { x: 0, y: 0 }, { pixelArcsec: 6.15, noiseScale: 0.5 }),
            () => colourAt(ok, ok, 2, 1, { x: 0, y: 0 }, { pixelArcsec: 0 }),
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
            expect(text).not.toMatch(/discover|\bdetect(?:ed|ion|ing|s)?\b|confirm|prove/i);
        }
    });
});
