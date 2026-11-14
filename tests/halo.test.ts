import { describe, expect, it } from 'vitest';
import { blankRadius, HaloError, haloCurve, ringAperture, ringFor } from '../src/lib/halo';
import type { RingOptions } from '../src/lib/halo';
import { lightCurve } from '../src/lib/photometry';
import type { ApertureOptions } from '../src/lib/photometry';
import type { PixelCoord, RegriddedFrame } from '../src/lib/types';

const width = 128;
const height = 128;
const target = { x: 40, y: 40 };
const refs = [{ x: 96, y: 26 }, { x: 26, y: 96 }, { x: 96, y: 96 }];
const options: RingOptions & ApertureOptions = {
    ringIn: 6, ringOut: 10, skyIn: 14, skyOut: 18,
    radius: 3, annulusIn: 6, annulusOut: 10,
};

function ownMedian(values: number[]): number
{
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 0) {
        return Number.NaN;
    }
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function indices(at: PixelCoord, inner: number, outer: number): number[]
{
    const result: number[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const distance = Math.hypot(x - at.x, y - at.y);
            if (distance >= inner && distance < outer) {
                result.push(y * width + x);
            }
        }
    }
    return result;
}

function frame(visit: number, scale = 1, hole = 0, at = target, lambda = 2): RegriddedFrame
{
    const data = new Float32Array(width * height).fill(3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const distance2 = (x - at.x) ** 2 + (y - at.y) ** 2;
            let value = 3;
            if (distance2 < 20 ** 2) {
                value += scale * (1000 * Math.exp(-distance2 / 4.5) + 25 * Math.exp(-distance2 / 40.5));
            }
            for (let i = 0; i < refs.length; i++) {
                const ref = refs[i]!;
                const d2 = (x - ref.x) ** 2 + (y - ref.y) ** 2;
                if (d2 < 8 ** 2) {
                    value += (80 + 20 * i) * Math.exp(-d2 / 4.5);
                }
            }
            data[y * width + x] = hole > 0 && distance2 < hole ** 2 ? Number.NaN : value;
        }
    }
    return {
        data,
        grid: { center: { ra: 10, dec: 30 }, fovDeg: 0.2, pixelArcsec: 3.075, width, height },
        lambdaAtCenter: lambda,
        bandwidthAtCenter: 0.04,
        frame: {
            obsId: `halo-${visit}D1`, collection: 'spherex_dr1', release: 'dr1', detector: 1,
            url: 'https://example.invalid/halo.fits', tMin: 61000 + visit, tMax: 61000.2 + visit,
            lambdaMin: 1.8, lambdaMax: 2.2,
        },
    };
}

describe('blankRadius', () => {
    it('measures the connected blank disc and ignores a detached NaN', () => {
        const f = frame(0, 1, 2.2);
        f.data[40 * width + 46] = Number.NaN;
        const blank = blankRadius(f.data, width, height, target);
        expect(Math.abs(blank.radius - 2.2)).toBeLessThan(1);
        expect(blank.radius).toBeCloseTo(2 + Math.SQRT1_2, 12);
        expect(blank.pixels).toBe(13);
        expect(blank.touchesLimit).toBe(false);
        f.data.fill(3);
        f.data[40 * width + 46] = Number.NaN;
        expect(blankRadius(f.data, width, height, target)).toEqual({ radius: 0, pixels: 0, touchesLimit: false });
    });

    it('seeds every nearby blank pixel and joins diagonal neighbours', () => {
        const data = new Float32Array(width * height).fill(1);
        data[40 * width + 39] = Number.NaN;
        data[40 * width + 41] = Number.POSITIVE_INFINITY;
        data[41 * width + 42] = Number.NaN;
        const result = blankRadius(data, width, height, target);
        expect(result.pixels).toBe(3);
        expect(result.radius).toBeCloseTo(Math.sqrt(5) + Math.SQRT1_2, 12);
    });

    it('caps a blank half-plane and marks the limit at the pixel far edge', () => {
        const data = new Float32Array(width * height).fill(1);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x <= target.x; x++) {
                data[y * width + x] = Number.NaN;
            }
        }
        const result = blankRadius(data, width, height, target, { maxRadius: 5.5 });
        expect(result.touchesLimit).toBe(true);
        expect(result.radius).toBeLessThanOrEqual(5.5 + Math.SQRT1_2);
        expect(result.pixels).toBeLessThan(100);
    });

    it('validates shape, centre and search options', () => {
        const data = frame(0).data;
        for (const opts of [{ seed: -1 }, { seed: Number.NaN }, { maxRadius: 0 }, { maxRadius: Infinity }, { seed: 3, maxRadius: 2 }]) {
            expect(() => blankRadius(data, width, height, target, opts)).toThrow(HaloError);
        }
        expect(() => blankRadius(data.subarray(1), width, height, target)).toThrow(HaloError);
        expect(() => blankRadius(data, width, height, { x: NaN, y: 0 })).toThrow(HaloError);
    });
});

describe('ringAperture', () => {
    it('matches an independent loop, median and MAD without clipping the sky', () => {
        const at = { x: 40.3, y: 40.7 };
        const data = frame(0, 1, 2.2, at).data;
        const sky = indices(at, 14, 18);
        sky.forEach((offset, i) => {
            data[offset] = i % 7 === 0 ? 100 : 3 + (i % 5) / 4;
        });
        data[sky[2]!] = Number.NaN;
        const values = sky.map((offset) => data[offset]!).filter(Number.isFinite);
        const background = ownMedian(values);
        const sigma = 1.4826 * ownMedian(values.map((value) => Math.abs(value - background)));
        let count = 0;
        let total = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const distance = Math.hypot(x - at.x, y - at.y);
                if (distance >= 6 && distance < 10) {
                    count++;
                    total += data[y * width + x]!;
                }
            }
        }
        const result = ringAperture(data, width, height, at, options);
        expect(result.valid).toBe(true);
        expect(result.nPix).toBe(count);
        expect(result.nSky).toBe(values.length);
        expect(result.background).toBe(background);
        expect(result.backgroundSigma).toBe(sigma);
        expect(result.sum).toBeCloseTo(total - count * background, 9);
        expect(result.snr).toBeCloseTo(result.sum / (sigma * Math.sqrt(count)), 10);
    });

    it('scales missing ring pixels to the full area and rejects 30 percent missing', () => {
        const data = frame(0, 1, 2.2).data;
        const baseline = ringAperture(data, width, height, target, options);
        const ring = indices(target, 6, 10).sort((a, b) => {
            return Math.hypot(a % width - target.x, Math.floor(a / width) - target.y)
                - Math.hypot(b % width - target.x, Math.floor(b / width) - target.y);
        });
        ring.forEach((offset, i) => {
            if (i % 10 === 0) {
                data[offset] = Number.NaN;
            }
        });
        const partial = ringAperture(data, width, height, target, options);
        expect(partial.valid).toBe(true);
        expect(partial.nPix / ring.length).toBeCloseTo(0.9, 2);
        expect(Math.abs(partial.sum / baseline.sum - 1)).toBeLessThan(0.03);
        ring.forEach((offset, i) => {
            if (i % 10 < 3) {
                data[offset] = Number.NaN;
            }
        });
        const sparse = ringAperture(data, width, height, target, options);
        expect(sparse.valid).toBe(false);
        expect(sparse.sum).toBeNaN();
        expect(sparse.snr).toBeNaN();
    });

    it('uses inclusive inner and exclusive outer edges for ring and sky', () => {
        const data = new Float32Array(width * height).fill(3);
        data[40 * width + 42] = 13;
        data[40 * width + 44] = 10000;
        data[40 * width + 48] = 10000;
        const result = ringAperture(data, width, height, target, { ringIn: 2, ringOut: 4, skyIn: 6, skyOut: 8 });
        expect(result).toMatchObject({ valid: true, background: 3, backgroundSigma: 0, snr: 0 });
        expect(result.sum).toBeCloseTo(10, 12);
        expect(result.nPix).toBe(indices(target, 2, 4).length);
        expect(result.nSky).toBe(indices(target, 6, 8).length);
    });

    it('defaults sky radii and minFraction and requires eight finite sky pixels', () => {
        const data = new Float32Array(width * height).fill(3);
        const opts = { ringIn: 2, ringOut: 4 };
        expect(ringAperture(data, width, height, target, opts)).toEqual(
            ringAperture(data, width, height, target, { ...opts, skyIn: 6, skyOut: 10, minFraction: 0.8 }),
        );
        const sky = indices(target, 6, 10);
        sky.forEach((offset, i) => {
            if (i >= 7) {
                data[offset] = Number.NaN;
            }
        });
        expect(ringAperture(data, width, height, target, opts)).toMatchObject({ valid: false, nSky: 7 });
        data[sky[7]!] = 3;
        expect(ringAperture(data, width, height, target, opts)).toMatchObject({ valid: true, nSky: 8 });
    });

    it('rejects clipped or empty rings and non-finite centres', () => {
        const data = frame(0).data;
        for (const at of [{ x: 4, y: 40 }, { x: 130, y: 40 }, { x: NaN, y: 40 }]) {
            const result = ringAperture(data, width, height, at, options);
            expect(result.valid).toBe(false);
            expect(result.sum).toBeNaN();
            expect(result.snr).toBeNaN();
        }
        expect(ringAperture(data, width, height, target, { ringIn: 0.1, ringOut: 0.2 }).valid).toBe(false);
    });

    it.each([
        { ringIn: 0 }, { ringIn: -1 }, { ringIn: NaN }, { ringOut: Infinity }, { ringOut: 6 },
        { skyIn: 9 }, { skyIn: NaN }, { skyOut: 14 }, { skyOut: Infinity },
        { minFraction: 0 }, { minFraction: 1.01 }, { minFraction: NaN },
    ])('throws HaloError for bad options %j', (bad) => {
        expect(() => ringAperture(frame(0).data, width, height, target, { ...options, ...bad })).toThrow(HaloError);
    });

    it('rejects mismatched arrays and invalid dimensions', () => {
        expect(() => ringAperture(new Float32Array(5), width, height, target, options)).toThrow(HaloError);
        for (const w of [0, -1, 1.5, NaN, Infinity]) {
            expect(() => ringAperture(new Float32Array(0), w, 0, target, options)).toThrow(HaloError);
        }
    });
});

describe('ringFor', () => {
    it('uses the largest hole, native-pixel defaults and explicit margins', () => {
        const frames = [frame(0, 1, 2.2), frame(1, 2, 3.2), frame(2, 4, 4.2)];
        const largest = Math.max(...frames.map((f) => blankRadius(f.data, width, height, target).radius));
        expect(ringFor(frames, target)).toEqual({ ringIn: largest + 2, ringOut: largest + 6 });
        expect(ringFor(frames, target, { margin: 1, thickness: 3 })).toEqual({ ringIn: largest + 1, ringOut: largest + 4 });
    });

    it('rejects no hole, a limit-reaching hole and invalid options', () => {
        expect(() => ringFor([], target)).toThrow(HaloError);
        expect(() => ringFor([frame(0)], target)).toThrow(HaloError);
        const blank = frame(1);
        blank.data.fill(Number.NaN);
        expect(() => ringFor([frame(0, 1, 2.2), blank], target)).toThrow(HaloError);
        for (const opts of [{ margin: -1 }, { margin: NaN }, { thickness: 0 }, { thickness: Infinity }]) {
            expect(() => ringFor([frame(0, 1, 2.2)], target, opts)).toThrow(HaloError);
        }
        blank.grid.pixelArcsec = 0;
        expect(() => ringFor([blank], target)).toThrow(HaloError);
    });

    it('uses each moving target position and original input index', () => {
        const positions = [{ x: 32, y: 40 }, { x: 48, y: 40 }];
        const frames = positions.map((at, i) => frame(3 - i, 1, 2.2 + i, at));
        const seen: number[] = [];
        const result = ringFor(frames, (f, i) => {
            expect(f).toBe(frames[i]);
            seen.push(i);
            return positions[i]!;
        }, { margin: 1, thickness: 2 });
        expect(seen).toEqual([0, 1]);
        expect(result.ringIn).toBeCloseTo(Math.sqrt(10) + Math.SQRT1_2 + 1, 12);
    });
});

describe('haloCurve', () => {
    it('recovers 1:2:4 variability through growing blank cores', () => {
        const frames = [frame(0, 1, 2.2), frame(1, 2, 3.2), frame(2, 4, 4.2)];
        const ring = ringFor(frames, target, { margin: 1, thickness: 4 });
        const curve = haloCurve([frames[2]!, frames[0]!, frames[1]!], target, refs, { ...options, ...ring });
        expect(curve.dropped).toBe(0);
        expect(curve.points.every((point) => point.valid)).toBe(true);
        curve.points.forEach((point, i) => {
            expect(Math.abs(point.relative / [0.5, 1, 2][i]! - 1)).toBeLessThan(0.02);
            expect(point.ratio).toBe(point.target.sum / point.refSum);
        });
        expect(curve.refScatter.every((scatter) => scatter < 1e-9)).toBe(true);
        expect(lightCurve(frames, target, refs, options).points.every((point) => !point.valid)).toBe(true);
    });

    it.each([{}, { lambda: 2, maxDeltaUm: 0.02 }, { lambda: 1.98, maxDeltaUm: 0.05 }])(
        'agrees with lightCurve filtering, ordering and reference controls for %j', (wavelength) => {
            const frames = [frame(4, 1, 0, target, NaN), frame(3, 2, 0, target, 2.02), frame(0, 1, 0, target, 1.98),
                frame(2, 1, 0, target, 2), frame(1, 4, 0, target, 2.01), frame(5, 1, 0, target, 3)];
            // Vary a reference so agreement checks a nonzero scatter, and retain an invalid-reference visit.
            frames[3]!.data[26 * width + 96] = 500;
            frames[4]!.data[26 * width + 96] = Number.NaN;
            const input = frames.map((f) => f.frame.obsId);
            const opts = { ...options, ...wavelength };
            const normal = lightCurve(frames, target, refs, opts);
            const halo = haloCurve(frames, target, refs, opts);
            expect(halo.lambda).toBe(normal.lambda);
            expect(halo.dropped).toBe(normal.dropped);
            expect(halo.refScatter).toEqual(normal.refScatter);
            expect(halo.points.map(({ mjd, lambda, refSum, valid }) => ({ mjd, lambda, refSum, valid }))).toEqual(
                normal.points.map(({ mjd, lambda, refSum, valid }) => ({ mjd, lambda, refSum, valid })),
            );
            expect(halo.points.some((point, i) => point.target.sum !== normal.points[i]!.target.sum)).toBe(true);
            expect(frames.map((f) => f.frame.obsId)).toEqual(input);
        },
    );

    it('passes original moving-target indices after filtering and sorting', () => {
        const positions = [{ x: 32, y: 40 }, { x: 48, y: 40 }, { x: 40, y: 48 }];
        const frames = [frame(2, 2, 2.2, positions[0]), frame(0, 1, 2.2, positions[1]), frame(1, 4, 2.2, positions[2], 3)];
        const seen: number[] = [];
        const curve = haloCurve(frames, (f, i) => {
            expect(f).toBe(frames[i]);
            seen.push(i);
            return positions[i]!;
        }, refs, { ...options, lambda: 2 });
        expect(seen).toEqual([1, 0]);
        expect(curve.dropped).toBe(1);
        expect(curve.points.every((point) => point.valid)).toBe(true);
        expect(curve.points[1]!.relative / curve.points[0]!.relative).toBeCloseTo(2, 5);
    });

    it('excludes invalid target rings from normalisation and reference scatter', () => {
        const frames = [frame(0, 1, 2.2), frame(1, 20, 2.2), frame(2, 4, 2.2)];
        for (const offset of indices(target, 6, 10)) {
            frames[1]!.data[offset] = Number.NaN;
        }
        frames[1]!.data[26 * width + 96] = 10000;
        const curve = haloCurve(frames, target, refs, options);
        expect(curve.dropped).toBe(0);
        expect(curve.points[1]).toMatchObject({ valid: false, ratio: NaN, relative: NaN });
        expect(curve.points[0]!.relative).toBeCloseTo(0.4, 6);
        expect(curve.points[2]!.relative).toBeCloseTo(1.6, 6);
        expect(curve.refScatter.every((scatter) => scatter < 1e-9)).toBe(true);
    });

    it('matches empty, non-finite wavelength, one-reference and zero-signal behaviour', () => {
        for (const frames of [[], [frame(0, 1, 0, target, NaN)]]) {
            expect(haloCurve(frames, target, refs, options)).toEqual(lightCurve(frames, target, refs, options));
        }
        expect(haloCurve([frame(0)], target, refs.slice(0, 1), options).refScatter).toEqual([]);
        const flat = frame(0);
        flat.data.fill(3);
        const curve = haloCurve([flat], target, refs, options);
        expect(curve.points[0]).toMatchObject({ valid: false, refSum: 0, ratio: NaN, relative: NaN });
        expect(curve.refScatter.every(Number.isNaN)).toBe(true);
    });

    it('validates refs, aperture and wavelength options, grids and every data length', () => {
        expect(() => haloCurve([], target, [], options)).toThrow(HaloError);
        for (const bad of [{ radius: 0 }, { annulusIn: 2 }, { annulusOut: Infinity }, { maxDeltaUm: -1 }, { maxDeltaUm: NaN }, { lambda: Infinity }]) {
            expect(() => haloCurve([], target, refs, { ...options, ...bad })).toThrow(HaloError);
        }
        for (const key of ['width', 'height', 'pixelArcsec'] as const) {
            const frames = [frame(0), frame(1)];
            frames[1]!.grid[key] += 1;
            expect(() => haloCurve(frames, target, refs, options)).toThrow(HaloError);
        }
        const bad = frame(1, 1, 0, target, 3);
        bad.data = new Float32Array(1);
        expect(() => haloCurve([frame(0), bad], target, refs, options)).toThrow(HaloError);
    });
});
