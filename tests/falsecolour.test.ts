import { describe, expect, it } from 'vitest';
import {
    FalseColourError, centroidOffset, channelStretch, colourAt, falseColourLegend, falseColourRgba,
} from '../src/lib/falsecolour';
import { centroid } from '../src/lib/photometry';
import { percentile, stretchValue } from '../src/lib/player';
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

function expectPixelNear(px: Uint8ClampedArray, index: number, want: [number, number, number, number], tol = 1): void
{
    const o = index * 4;
    expect(Math.abs((px[o] ?? 0) - want[0])).toBeLessThanOrEqual(tol);
    expect(Math.abs((px[o + 1] ?? 0) - want[1])).toBeLessThanOrEqual(tol);
    expect(Math.abs((px[o + 2] ?? 0) - want[2])).toBeLessThanOrEqual(tol);
    expect(px[o + 3]).toBe(want[3]);
}

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

    it('renders NaN in either channel transparent and clamps values outside lo..hi', () => {
        const sShort: Stretch = { lo: 2, hi: 6, kind: 'linear' };
        const sLong: Stretch = { lo: 10, hi: 20, kind: 'linear' };
        const short = Float32Array.from([Number.NaN, 4, Number.NaN, -5, 99, -5, 99]);
        const long = Float32Array.from([15, Number.NaN, Number.NaN, 0, 99, 99, -5]);
        const prefilled = new Uint8ClampedArray(short.length * 4).fill(200);
        const px = falseColourRgba(short, long, sShort, sLong, prefilled);

        expectPixelNear(px, 0, [0, 0, 0, 0], 0);
        expectPixelNear(px, 1, [0, 0, 0, 0], 0);
        expectPixelNear(px, 2, [0, 0, 0, 0], 0);
        expectPixelNear(px, 3, [0, 0, 0, 255], 0);
        expectPixelNear(px, 4, [255, 255, 255, 255], 0);
        expectPixelNear(px, 5, [255, 128, 0, 255], 1);
        expectPixelNear(px, 6, [0, 128, 255, 255], 1);
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

    it('throws FalseColourError on mismatched lengths or wrong out size, and reuses out when valid', () => {
        const a = Float32Array.from([0, 0.5, 1]);
        const b = Float32Array.from([0, 1]);
        expect(() => falseColourRgba(a, b, lin, lin)).toThrow(FalseColourError);
        expect(() => falseColourRgba(a, a, lin, lin, new Uint8ClampedArray(8))).toThrow(FalseColourError);
        expect(() => falseColourRgba(a, a, lin, lin, new Uint8ClampedArray(16))).toThrow(FalseColourError);

        const out = new Uint8ClampedArray(a.length * 4);
        const got = falseColourRgba(a, a, lin, lin, out);
        expect(got).toBe(out);
        expectPixelNear(got, 2, [255, 255, 255, 255], 0);
    });
});

describe('channelStretch', () => {
    it('picks the median for lo and 99.5th percentile for hi over finite values, ignoring NaN', () => {
        const raw = [
            Number.NaN, 12.5, 0.4, -1.2, 3.3, Number.NaN, 8.7, 2.1, 0.9, 100.0,
            4.5, 1.1, 6.2, Number.NaN, 0.7, 5.5, 9.9, 2.8, 3.9, 7.4,
            1.6, 20.0, 0.2, Number.NaN, 4.0,
        ];
        const data = Float32Array.from(raw);
        const finite = Float64Array.from(Array.from(data).filter((v) => Number.isFinite(v))).sort();
        const wantLo = percentile(finite, 50);
        const wantHi = percentile(finite, 99.5);

        const s = channelStretch(data);
        expect(s.kind).toBe('asinh');
        expect(s.lo).toBeCloseTo(wantLo, 12);
        expect(s.hi).toBeCloseTo(wantHi, 12);

        const s90 = channelStretch(data, { hiPercentile: 90 });
        expect(s90.lo).toBeCloseTo(wantLo, 12);
        expect(s90.hi).toBeCloseTo(percentile(finite, 90), 12);
    });

    it('sets hi = lo + 1 on a flat picture and throws FalseColourError when no value is finite', () => {
        const flat = Float32Array.from([Number.NaN, 4.25, 4.25, Number.NaN, 4.25]);
        expect(channelStretch(flat)).toEqual({ lo: 4.25, hi: 5.25, kind: 'asinh' });

        const single = Float32Array.from([Number.NaN, -3]);
        expect(channelStretch(single)).toEqual({ lo: -3, hi: -2, kind: 'asinh' });

        expect(() => channelStretch(Float32Array.from([Number.NaN, Number.NaN]))).toThrow(FalseColourError);
        expect(() => channelStretch(new Float32Array(0))).toThrow(FalseColourError);
        expect(() => channelStretch(Float32Array.from([1, 2]), { hiPercentile: Number.NaN })).toThrow(FalseColourError);
    });
});

describe('colourAt', () => {
    it('returns +1 for long-only, -1 for short-only, 0 for equal flux, and invalid NaN on empty sky', () => {
        const emptyShort = makePatch([], 0.5);
        const emptyLong = makePatch([], 1.25);
        const brightShort = makePatch([{ ...CENTER, flux: 1200 }], 0.5);
        const brightLong = makePatch([{ ...CENTER, flux: 1200 }], 1.25);

        const longOnly = colourAt(emptyShort, brightLong, SIZE, SIZE, CENTER);
        expect(longOnly.valid).toBe(true);
        expect(Math.abs(longOnly.index - 1)).toBeLessThanOrEqual(0.02);
        expect(longOnly.short).toBe(0);
        expect(longOnly.long).toBeGreaterThan(1100);

        const shortOnly = colourAt(brightShort, emptyLong, SIZE, SIZE, CENTER);
        expect(shortOnly.valid).toBe(true);
        expect(Math.abs(shortOnly.index - (-1))).toBeLessThanOrEqual(0.02);
        expect(shortOnly.long).toBe(0);
        expect(shortOnly.short).toBeGreaterThan(1100);

        const equalBoth = colourAt(brightShort, brightLong, SIZE, SIZE, CENTER);
        expect(equalBoth.valid).toBe(true);
        expect(Math.abs(equalBoth.index)).toBeLessThanOrEqual(0.02);

        const emptyBoth = colourAt(emptyShort, emptyLong, SIZE, SIZE, CENTER);
        expect(emptyBoth.valid).toBe(false);
        expect(emptyBoth.index).toBeNaN();
    });

    it('clamps negative aperture sums to 0 and marks NaN or edge apertures invalid', () => {
        const dippedShort = makePatch([{ ...CENTER, flux: -50 }], 0.5);
        const brightLong = makePatch([{ ...CENTER, flux: 1200 }], 0.5);
        const clamped = colourAt(dippedShort, brightLong, SIZE, SIZE, CENTER);
        expect(clamped.valid).toBe(true);
        expect(clamped.short).toBe(0);
        expect(clamped.index).toBe(1);

        const bothDipped = colourAt(dippedShort, makePatch([{ ...CENTER, flux: -30 }], 0.5), SIZE, SIZE, CENTER);
        expect(bothDipped.valid).toBe(false);
        expect(bothDipped.index).toBeNaN();

        const withNan = makePatch([{ ...CENTER, flux: 1200 }], 0.5);
        withNan[CENTER.y * SIZE + CENTER.x] = Number.NaN;
        const badNan = colourAt(withNan, brightLong, SIZE, SIZE, CENTER);
        expect(badNan.valid).toBe(false);
        expect(badNan.index).toBeNaN();

        const nearEdge = colourAt(brightLong, brightLong, SIZE, SIZE, { x: 2, y: 2 });
        expect(nearEdge.valid).toBe(false);
        expect(nearEdge.index).toBeNaN();
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
});

describe('falseColourLegend', () => {
    it('returns the exact fixed wording for (1.12, 4.42) and rejects invalid or reversed wavelengths', () => {
        expect(falseColourLegend(1.12, 4.42)).toEqual({
            red: 'Orange: 4.42 µm (the longer wavelength)',
            blue: 'Blue: 1.12 µm (the shorter wavelength)',
            note: 'False colour. The colours show which of two infrared wavelengths is brighter at each spot, '
                + 'not what an eye would see. Each picture is stretched on its own, so compare colours within this view only.',
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

        const s1 = channelStretch(short);
        const s2 = channelStretch(short);
        expect(s1).toEqual(s2);

        const l1 = channelStretch(long);
        const rgba1 = falseColourRgba(short, long, s1, l1);
        const rgba2 = falseColourRgba(short, long, s1, l1);
        expect(rgba1).toEqual(rgba2);

        expect(colourAt(short, long, SIZE, SIZE, CENTER)).toEqual(colourAt(short, long, SIZE, SIZE, CENTER));
        expect(centroidOffset(short, long, SIZE, SIZE, CENTER)).toEqual(centroidOffset(short, long, SIZE, SIZE, CENTER));
        expect(falseColourLegend(1.12, 4.42)).toEqual(falseColourLegend(1.12, 4.42));

        expect(short).toEqual(shortCopy);
        expect(long).toEqual(longCopy);
    });

    it('never emits NaN, Infinity, undefined or claim words in any legend or error string', () => {
        const collected: string[] = [];
        for (const [s, l] of [[0.75, 1.12], [1.12, 4.42], [2.05, 4.98]] as const) {
            const leg = falseColourLegend(s, l);
            collected.push(leg.red, leg.blue, leg.note);
        }
        const badCalls: Array<() => unknown> = [
            () => channelStretch(Float32Array.from([Number.NaN])),
            () => channelStretch(Float32Array.from([1]), { hiPercentile: Number.POSITIVE_INFINITY }),
            () => falseColourRgba(new Float32Array(2), new Float32Array(3), { lo: 0, hi: 1, kind: 'linear' }, { lo: 0, hi: 1, kind: 'linear' }),
            () => falseColourRgba(new Float32Array(2), new Float32Array(2), { lo: 0, hi: 1, kind: 'linear' }, { lo: 0, hi: 1, kind: 'linear' }, new Uint8ClampedArray(4)),
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
        expect(collected.length).toBeGreaterThanOrEqual(15);
        for (const text of collected) {
            expect(text).not.toContain('NaN');
            expect(text).not.toContain('Infinity');
            expect(text).not.toContain('undefined');
            expect(text).not.toMatch(/discover|detect|confirm|prove/i);
        }
    });
});
