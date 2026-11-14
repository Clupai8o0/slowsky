import { describe, expect, it } from 'vitest';
import { aperture, centroid, lightCurve, PhotometryError, toJy } from '../src/lib/photometry';
import type { ApertureOptions } from '../src/lib/photometry';
import type { OutputGrid, PixelCoord, RegriddedFrame } from '../src/lib/types';

interface Star extends PixelCoord {
    flux: number;
}

const width = 208;
const height = 176;
const target = { x: 48.37, y: 46.81 };
const refs: PixelCoord[] = [{ x: 112, y: 45 }, { x: 48, y: 119 }, { x: 145, y: 122 }];

function mulberry32(seed: number): () => number
{
    return function (): number
    {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function image(stars: Star[], sky = 0.5, noise = 0.01, gain = 1, seed = 123): Float32Array
{
    const random = mulberry32(seed);
    const data = new Float32Array(width * height);
    const variance = 3.3 ** 2;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const normal = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
            let value = sky + noise * normal;
            for (const star of stars) {
                const distance2 = (x - star.x) ** 2 + (y - star.y) ** 2;
                value += gain * star.flux / (2 * Math.PI * variance) * Math.exp(-distance2 / (2 * variance));
            }
            data[y * width + x] = value;
        }
    }
    return data;
}

function frame(index: number, at = target, lambda = 2): RegriddedFrame
{
    const grid: OutputGrid = {
        center: { ra: 76, dec: 30 },
        fovDeg: 0.1,
        pixelArcsec: 1.5,
        width,
        height,
    };
    const stars: Star[] = [
        { ...at, flux: index < 3 ? 1800 : 2700 },
        ...refs.map((ref, i) => ({ ...ref, flux: 1300 + 200 * i })),
    ];
    return {
        grid,
        data: image(stars, 0.1 + index * 0.17, 0.01, 0.8 + index * 0.08, 100 + index),
        lambdaAtCenter: lambda,
        bandwidthAtCenter: 0.04,
        frame: {
            obsId: `synthetic-${index}D1`,
            collection: 'spherex_dr1',
            release: 'dr1',
            detector: 1,
            url: 'https://example.invalid/synthetic.fits',
            tMin: 60000 + index,
            tMax: 60000 + index + 0.2,
            lambdaMin: 1.9,
            lambdaMax: 2.1,
        },
    };
}

function sixFrames(): RegriddedFrame[]
{
    return Array.from({ length: 6 }, (_, i) => frame(i));
}


/** Pixels of the default sky ring (16 to 24 px) around a point, as flat indices. */
function ringIndices(at: PixelCoord, w = width, h = height, inner = 16, outer = 24): number[]
{
    const out: number[] = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const d = Math.hypot(x - at.x, y - at.y);
            if (d >= inner && d <= outer) {
                out.push(y * w + x);
            }
        }
    }
    return out;
}

function ownMedian(values: number[]): number
{
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** A small image whose aperture is finite and whose ring holds exactly the given values; the rest is NaN. */
function sparseRing(values: number[]): { data: Float32Array; size: number; at: PixelCoord }
{
    const size = 61;
    const at = { x: 30, y: 30 };
    const data = new Float32Array(size * size).fill(Number.NaN);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (Math.hypot(x - at.x, y - at.y) <= 1) {
                data[y * size + x] = 1;
            }
        }
    }
    const ring = ringIndices(at, size, size, 2, 4);
    expect(ring.length).toBeGreaterThanOrEqual(values.length);
    values.forEach((value, i) => {
        data[ring[i]!] = value;
    });
    return { data, size, at };
}

function noisyValues(n: number, seed: number): number[]
{
    const random = mulberry32(seed);
    return Array.from({ length: n }, () => 0.5 + 0.02 * (random() - 0.5));
}

function sparseAperture(values: number[])
{
    const { data, size, at } = sparseRing(values);
    return aperture(data, size, size, at, { radius: 1, annulusIn: 2, annulusOut: 4 });
}

describe('aperture', () => {
    it('includes median sky uncertainty and a caller-supplied noise scale', () => {
        const { data, size, at } = sparseRing(Array.from({ length: 40 }, (_, i) => i % 2 ? 2 : 0));
        const opts = { radius: 1, annulusIn: 2, annulusOut: 4 };
        data[at.y * size + at.x] = 11;
        const expected = 10 / (1.4826 * Math.sqrt(5 * (1 + Math.PI / 2 * 5 / 40)));
        expect(aperture(data, size, size, at, opts).snr).toBeCloseTo(expected, 12);
        expect(aperture(data, size, size, at, { ...opts, noiseScale: 2 }).snr).toBeCloseTo(expected / 2, 12);
        for (const noiseScale of [0.99, NaN, Infinity]) {
            expect(() => aperture(data, size, size, at, { ...opts, noiseScale })).toThrow(PhotometryError);
        }
    });
    it('recovers known Gaussian flux and sky with seeded noise', () => {
        const at = { x: 60.37, y: 41.81 };
        const measured = aperture(image([{ ...at, flux: 2000 }]), width, height, at);
        let count = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (Math.hypot(x - at.x, y - at.y) <= 10) {
                    count++;
                }
            }
        }
        expect(measured.valid).toBe(true);
        expect(Math.abs(measured.sum / 2000 - 1)).toBeLessThan(0.02);
        expect(Math.abs(measured.background - 0.5)).toBeLessThan(0.005);
        expect(measured.backgroundSigma).toBeGreaterThan(0.008);
        expect(measured.backgroundSigma).toBeLessThan(0.012);
        expect(measured.nPix).toBe(count);
        expect(measured.nSky).toBeGreaterThan(20);
        expect(Number.isFinite(measured.snr)).toBe(true);
        expect(measured.snr).toBeGreaterThan(1000);
    });

    it('returns the noise that the signal-to-noise divides by, noise scale included', () => {
        const at = { x: 60.37, y: 41.81 };
        const data = image([{ ...at, flux: 2000 }]);
        const plain = aperture(data, width, height, at);
        const scaled = aperture(data, width, height, at, { noiseScale: 2.8 });
        const expected = plain.backgroundSigma * Math.sqrt(plain.nPix * (1 + Math.PI / 2 * plain.nPix / plain.nSky));
        expect(plain.noise).toBeCloseTo(expected, 12);
        expect(plain.snr).toBeCloseTo(plain.sum / plain.noise, 9);
        expect(scaled.noise).toBeCloseTo(2.8 * plain.noise, 12);
        expect(scaled.snr).toBeCloseTo(plain.snr / 2.8, 9);
        expect(Number.isNaN(aperture(data, width, height, { x: Number.NaN, y: 0 }).noise)).toBe(true);
    });

    it('counts fractional-centre pixels and includes both ring boundaries', () => {
        const data = new Float32Array(41 * 41).fill(0.5);
        data[20 * 41 + 20] = 10.5;
        const result = aperture(data, 41, 41, { x: 20, y: 20 }, { radius: 1, annulusIn: 2, annulusOut: 4 });
        expect(result).toMatchObject({ valid: true, sum: 10, nPix: 5, nSky: 40, background: 0.5, backgroundSigma: 0, noise: 0, snr: 0 });
        const fractional = aperture(data, 41, 41, { x: 20.5, y: 20.5 }, { radius: 1 });
        expect(fractional.nPix).toBe(4);
    });

    it('clips sky outliers even when the initial MAD is zero and ignores ring NaNs', () => {
        const data = new Float32Array(width * height).fill(0.5);
        data[50 * width + 50] = 100.5;
        data[50 * width + 70] = 10000;
        data[50 * width + 30] = Number.NaN;
        const result = aperture(data, width, height, { x: 50, y: 50 });
        expect(result).toMatchObject({ valid: true, sum: 100, background: 0.5, backgroundSigma: 0, snr: 0 });
    });

    it('rejects a NaN aperture, an off-image aperture and too little finite sky', () => {
        const data = image([{ ...target, flux: 2000 }]);
        data[47 * width + 48] = Number.NaN;
        expect(aperture(data, width, height, target).valid).toBe(false);
        expect(aperture(data, width, height, { x: 3, y: 50 }).valid).toBe(false);
        const sparse = new Float32Array(width * height).fill(Number.NaN);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (Math.hypot(x - 50, y - 50) <= 10) {
                    sparse[y * width + x] = 1;
                }
            }
        }
        for (let x = 40; x < 59; x++) {
            sparse[70 * width + x] = 0.5;
        }
        const result = aperture(sparse, width, height, { x: 50, y: 50 });
        expect(result.valid).toBe(false);
        expect(result.nSky).toBe(19);
    });

    it('clips a large share of bright sky outliers from background, sigma and nSky', () => {
        const at = { x: 100, y: 88 };
        const data = image([], 0.5, 0.01, 1, 77);
        const ring = ringIndices(at);
        const random = mulberry32(5);
        let raised = 0;
        for (const offset of ring) {
            if (random() < 0.15) {
                data[offset] = data[offset]! + 5;
                raised++;
            }
        }
        expect(raised).toBeGreaterThan(0.1 * ring.length);
        const result = aperture(data, width, height, at);
        expect(result.valid).toBe(true);
        expect(Math.abs(result.background - 0.5)).toBeLessThan(0.001);
        expect(result.backgroundSigma).toBeGreaterThan(0.0095);
        expect(result.backgroundSigma).toBeLessThan(0.0105);
        expect(result.nSky).toBeLessThanOrEqual(ring.length - raised);
        expect(result.nSky).toBeGreaterThan(0.8 * (ring.length - raised));
    });

    it('computes backgroundSigma as 1.4826 x MAD after the one-pass clip', () => {
        const at = { x: 60.37, y: 41.81 };
        const data = image([{ ...at, flux: 2000 }]);
        const ring: number[] = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const d = Math.hypot(x - at.x, y - at.y);
                if (d >= 16 && d <= 24) {
                    ring.push(data[y * width + x]!);
                }
            }
        }
        const mad = (values: number[], centre: number): number => 1.4826 * ownMedian(values.map((v) => Math.abs(v - centre)));
        const first = ownMedian(ring);
        const limit = 3 * mad(ring, first);
        const clipped = ring.filter((v) => Math.abs(v - first) <= limit);
        const expected = mad(clipped, ownMedian(clipped));
        const result = aperture(data, width, height, at);
        expect(Math.abs(result.backgroundSigma / expected - 1)).toBeLessThan(0.001);
        expect(result.nSky).toBe(clipped.length);
    });

    it('accepts a ring of exactly 20 finite pixels and rejects 19', () => {
        expect(sparseAperture(noisyValues(20, 1))).toMatchObject({ valid: true, nSky: 20 });
        expect(sparseAperture(noisyValues(19, 1)).valid).toBe(false);
    });

    it('counts finite ring pixels before the clip when validating', () => {
        const values = [...noisyValues(19, 2), 50, 50, 50];
        const result = sparseAperture(values);
        expect(result.valid).toBe(true);
        expect(result.nSky).toBe(19);
    });

    it.each([
        { x: Number.POSITIVE_INFINITY, y: 50 },
        { x: 50, y: Number.NEGATIVE_INFINITY },
        { x: Number.NaN, y: 50 },
    ])('returns an invalid aperture for nonfinite centre %j', (at) => {
        const result = aperture(new Float32Array(width * height), width, height, at);
        expect(result.valid).toBe(false);
        expect(result.sum).toBeNaN();
        expect(result.nPix).toBe(0);
    });

    it.each<ApertureOptions>([
        { radius: 0 }, { radius: -1 }, { radius: 17 }, { annulusIn: 9 }, { annulusOut: 16 },
        { annulusOut: 15 }, { radius: Number.NaN }, { annulusOut: Number.POSITIVE_INFINITY },
    ])('throws PhotometryError for invalid options %j', (opts) => {
        expect(() => aperture(new Float32Array(width * height), width, height, target, opts)).toThrow(PhotometryError);
    });
});

describe('centroid', () => {
    it('refines an offset guess to a subpixel Gaussian centre', () => {
        const at = { x: 60.37, y: 41.81 };
        const measured = centroid(image([{ ...at, flux: 2000 }]), width, height, { x: at.x + 2, y: at.y - 1.5 });
        expect(measured).toBeDefined();
        expect(Math.hypot(measured!.x - at.x, measured!.y - at.y)).toBeLessThan(0.05);
    });

    it('iterates: a guess 5 px off converges where one pass would not', () => {
        const at = { x: 60.37, y: 41.81 };
        const measured = centroid(image([{ ...at, flux: 2000 }]), width, height, { x: at.x + 5, y: at.y - 4 });
        expect(measured).toBeDefined();
        expect(Math.hypot(measured!.x - at.x, measured!.y - at.y)).toBeLessThan(0.05);
    });

    it('rejects edge, NaN and flat windows', () => {
        const data = image([{ ...target, flux: 2000 }]);
        expect(centroid(data, width, height, { x: 3, y: 50 })).toBeUndefined();
        data[47 * width + 48] = Number.NaN;
        expect(centroid(data, width, height, target)).toBeUndefined();
        expect(centroid(new Float32Array(width * height).fill(0.5), width, height, target)).toBeUndefined();
    });
});

describe('toJy', () => {
    it('converts surface brightness summed over square pixels to Jy', () => {
        // 2 MJy/sr pixels * 1e6 Jy/MJy * 4 arcsec²/pixel * 2.3504430539e-11 sr/arcsec².
        expect(toJy(2, 2)).toBeCloseTo(0.000188035444312, 15);
        expect(toJy(-2, 2)).toBeCloseTo(-0.000188035444312, 15);
    });
});

describe('lightCurve', () => {
    it('scales correlated noise for finer grids and respects an explicit override', () => {
        const native = frame(0);
        native.grid.pixelArcsec = 6.15;
        const fine = { ...native, grid: { ...native.grid, pixelArcsec: 3.075 } };
        const a = lightCurve([native], target, refs).points[0]!.target.snr;
        expect(lightCurve([fine], target, refs).points[0]!.target.snr).toBeCloseTo(a / 2, 10);
        expect(lightCurve([fine], target, refs, { noiseScale: 1 }).points[0]!.target.snr).toBeCloseTo(a * 1.4, 10);
    });

    it('uses the native floor for coarse grids with the resampling factor', () => {
        const coarse = frame(0);
        coarse.grid.pixelArcsec = 12.3;
        const measured = lightCurve([coarse], target, refs).points[0]!.target;
        const raw = aperture(coarse.data, width, height, target);
        expect(measured.snr).toBeCloseTo(raw.snr / 1.4, 10);
    });

    it('uses sample reference scatter and requires two ratios', () => {
        const controls = refs.slice(0, 2);
        const make = (ratio: number, index: number): RegriddedFrame => {
            const f = frame(index);
            f.data.fill(0);
            f.data[47 * width + 48] = 10;
            f.data[45 * width + 112] = ratio * 100;
            f.data[119 * width + 48] = 100;
            return f;
        };
        const frames = [make(0.9, 0), make(1.1, 1)];
        expect(lightCurve(frames, target, controls).refScatter[0]).toBeCloseTo(Math.sqrt(0.02), 6);
        expect(lightCurve(frames.slice(0, 1), target, controls).refScatter[0]).toBeNaN();
    });
    it('recovers a 1.5x target step while gains and skies change and reference controls stay flat', () => {
        const frames = sixFrames();
        const shuffled = [frames[4]!, frames[0]!, frames[5]!, frames[2]!, frames[1]!, frames[3]!];
        const originalOrder = shuffled.map((f) => f.frame.obsId);
        const curve = lightCurve(shuffled, target, refs);
        expect(curve.dropped).toBe(0);
        expect(curve.lambda).toBe(2);
        expect(curve.points).toHaveLength(6);
        expect(curve.points.every((p) => p.valid)).toBe(true);
        expect(curve.points.map((p) => p.mjd)).toEqual(frames.map((f) => (f.frame.tMin + f.frame.tMax) / 2));
        const low = curve.points.slice(0, 3).reduce((sum, p) => sum + p.relative, 0) / 3;
        const high = curve.points.slice(3).reduce((sum, p) => sum + p.relative, 0) / 3;
        expect(Math.abs(high / low / 1.5 - 1)).toBeLessThan(0.03);
        for (const point of curve.points) {
            expect(Math.abs(point.relative / (point.mjd < 60003 ? 0.8 : 1.2) - 1)).toBeLessThan(0.03);
            expect(point.ratio).toBeCloseTo(point.target.sum / point.refSum, 12);
            expect(point.lambda).toBe(2);
        }
        expect(curve.refScatter).toHaveLength(3);
        for (const scatter of curve.refScatter) {
            expect(scatter).toBeLessThan(0.02);
            expect(scatter).toBeGreaterThanOrEqual(0);
        }
        expect(shuffled.map((f) => f.frame.obsId)).toEqual(originalOrder);
    });

    it('filters wavelengths and retains invalid targets without including them in the median', () => {
        const frames = sixFrames();
        frames[0]!.lambdaAtCenter = 1.95;
        frames[5]!.lambdaAtCenter = 2.05;
        frames[2]!.data[47 * width + 48] = Number.NaN;
        const curve = lightCurve(frames, target, refs);
        expect(curve.dropped).toBe(2);
        expect(curve.points).toHaveLength(4);
        const invalid = curve.points[1]!;
        expect(invalid.valid).toBe(false);
        expect(invalid.ratio).toBeNaN();
        expect(invalid.relative).toBeNaN();
        expect(curve.points[0]!.relative).toBeCloseTo(2 / 3, 2);
        expect(curve.points[2]!.relative).toBeCloseTo(1, 2);
        expect(curve.points[3]!.relative).toBeCloseTo(1, 2);
    });

    it('uses explicit wavelength and tolerance overrides', () => {
        const frames = [frame(0, target, 1.95), frame(1), frame(2, target, 2.05)];
        const curve = lightCurve(frames, target, refs, { lambda: 1.95, maxDeltaUm: 0.06 });
        expect(curve.lambda).toBe(1.95);
        expect(curve.dropped).toBe(1);
        expect(curve.points.map((p) => p.lambda)).toEqual([1.95, 2]);
    });

    it('keeps frames exactly maxDeltaUm away despite rounding', () => {
        const frames = [frame(0, target, 2.02), frame(1, target, 1.98), frame(2)];
        const curve = lightCurve(frames, target, refs, { lambda: 2.0 });
        expect(curve.dropped).toBe(0);
        expect(curve.points).toHaveLength(3);
    });

    it('uses the lower middle frame wavelength as the default reference', () => {
        const lambdas = [2, 2, 2.01, 3, 3, 3];
        const curve = lightCurve(lambdas.map((l, i) => frame(i, target, l)), target, refs);
        expect(curve.lambda).toBe(2.01);
        expect(curve.points).toHaveLength(3);
        expect(curve.dropped).toBe(3);
    });

    it('drops a frame with a NaN wavelength without moving the reference', () => {
        const lambdas = [2, 2.01, 2.01, Number.NaN];
        const withNaN = lightCurve(lambdas.map((l, i) => frame(i, target, l)), target, refs);
        expect(withNaN.lambda).toBe(2.01);
        expect(withNaN.dropped).toBe(1);
        expect(withNaN.points).toHaveLength(3);
        const without = lightCurve(lambdas.slice(0, 3).map((l, i) => frame(i, target, l)), target, refs);
        expect(without.lambda).toBe(withNaN.lambda);
    });

    it('returns an empty curve when no frame has a finite wavelength', () => {
        const curve = lightCurve([frame(0, target, Number.NaN), frame(1, target, Number.NaN)], target, refs);
        expect(curve.points).toEqual([]);
        expect(curve.dropped).toBe(2);
        expect(curve.refScatter).toEqual([]);
        expect(curve.lambda).toBeNaN();
    });

    it('follows a moving target and passes original input indices through sorting and filtering', () => {
        const positions = [{ x: 38, y: 44 }, { x: 56, y: 49 }, { x: 74, y: 51 }];
        const frames = [frame(2, positions[0]), frame(0, positions[1]), frame(1, positions[2], 2.1)];
        const seen: number[] = [];
        const curve = lightCurve(frames, (f, i) => {
            expect(f).toBe(frames[i]);
            seen.push(i);
            return positions[i]!;
        }, refs, { lambda: 2 });
        expect(curve.dropped).toBe(1);
        expect(curve.points).toHaveLength(2);
        expect(curve.points.every((p) => p.valid)).toBe(true);
        expect(curve.points.every((p) => Math.abs(p.relative - 1) < 0.03)).toBe(true);
        expect(seen.sort()).toEqual([0, 1]);
    });

    it('invalidates a NaN reference or nonpositive reference sum', () => {
        const badReference = frame(0);
        badReference.data[45 * width + 112] = Number.NaN;
        expect(lightCurve([badReference], target, refs).points[0]!.valid).toBe(false);
        const noReferences = frame(0);
        noReferences.data.fill(0.5);
        const point = lightCurve([noReferences], target, refs).points[0]!;
        expect(point.refSum).toBe(0);
        expect(point.valid).toBe(false);
        expect(point.ratio).toBeNaN();
    });

    it('reports the RMS of reference ratios to the other references', () => {
        const frames = [frame(0), frame(1), frame(2)];
        const controls = refs.slice(0, 2);
        const first = frames.map((f) => aperture(f.data, width, height, controls[0]!).sum);
        const second = frames.map((f) => aperture(f.data, width, height, controls[1]!).sum);
        // Double one reference on just the last epoch, without altering its sky ring.
        for (let y = 35; y <= 55; y++) {
            for (let x = 102; x <= 122; x++) {
                if (Math.hypot(x - 112, y - 45) <= 10) {
                    const offset = y * width + x;
                    frames[2]!.data[offset] = 2 * frames[2]!.data[offset]!;
                }
            }
        }
        first[2] = aperture(frames[2]!.data, width, height, controls[0]!).sum;
        const curve = lightCurve(frames, target, controls);
        for (let i = 0; i < 2; i++) {
            const ratios = first.map((sum, j) => i === 0 ? sum / second[j]! : second[j]! / sum);
            const middle = [...ratios].sort((a, b) => a - b)[1]!;
            const rms = Math.sqrt(ratios.reduce((sum, value) => sum + (value / middle - 1) ** 2, 0) / (ratios.length - 1));
            expect(curve.refScatter[i]).toBeCloseTo(rms, 12);
        }
    });

    it('handles a single reference, no frames, and no valid measurements', () => {
        expect(lightCurve([frame(0)], target, [refs[0]!]).refScatter).toEqual([]);
        const empty = lightCurve([], target, refs);
        expect(empty.points).toEqual([]);
        expect(empty.dropped).toBe(0);
        expect(empty.lambda).toBeNaN();
        expect(empty.refScatter.every(Number.isNaN)).toBe(true);
        const bad = frame(0);
        bad.data.fill(Number.NaN);
        const curve = lightCurve([bad], target, refs);
        expect(curve.points[0]!.relative).toBeNaN();
        expect(curve.refScatter.every(Number.isNaN)).toBe(true);
    });

    it.each(['width', 'height', 'pixelArcsec'] as const)('rejects mixed %s grids', (key) => {
        const frames = [frame(0), frame(1)];
        frames[1]!.grid[key] += 1;
        expect(() => lightCurve(frames, target, refs)).toThrow(PhotometryError);
    });

    it('rejects empty references, including with no frames', () => {
        expect(() => lightCurve([frame(0)], target, [])).toThrow(PhotometryError);
        expect(() => lightCurve([], target, [])).toThrow(PhotometryError);
    });
});
