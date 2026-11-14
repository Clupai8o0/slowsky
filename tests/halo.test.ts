import { describe, expect, it, vi } from 'vitest';
import * as photometry from '../src/lib/photometry';
import { blankRadius, HaloError, haloCurve, ringAperture, ringFor } from '../src/lib/halo';
import type { RingOptions } from '../src/lib/halo';
import { aperture, lightCurve, resampleNoiseScale } from '../src/lib/photometry';
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

// A steep Moffat halo (beta 3.5) on the 3.075 arcsec grid, NaN where it would saturate.
function steepFrame(at: PixelCoord): RegriddedFrame
{
    const f = frame(0, 0, 0, at);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const halo = 1e7 * (1 + (Math.hypot(x - at.x, y - at.y) / 1.5) ** 2) ** -3.5;
            f.data[y * width + x] = halo > 2e4 ? NaN : f.data[y * width + x]! + halo;
        }
    }
    return f;
}

describe('blankRadius', () => {
    it('marks each image border and includes neighbours exactly at the limit', () => {
        for (const at of [{ x: 0, y: 10 }, { x: 19, y: 10 }, { x: 10, y: 0 }, { x: 10, y: 19 }]) {
            const data = new Float32Array(400).fill(1);
            data[at.y * 20 + at.x] = NaN;
            expect(blankRadius(data, 20, 20, at).touchesLimit).toBe(true);
        }
        const data = new Float32Array(400).fill(1);
        data[10 * 20 + 10] = NaN;
        data[10 * 20 + 11] = NaN;
        expect(blankRadius(data, 20, 20, { x: 10, y: 10 }, { maxRadius: 1, seed: 0 }).touchesLimit).toBe(false);
    });
    it('measures the connected blank disc and ignores a detached NaN', () => {
        const f = frame(0, 1, 2.2);
        f.data[40 * width + 46] = Number.NaN;
        const blank = blankRadius(f.data, width, height, target);
        expect(Math.abs(blank.radius - 2.2)).toBeLessThan(1);
        expect(blank.radius).toBeCloseTo(2 + Math.SQRT1_2, 12);
        expect(blank.reach).toBe(2);
        expect(blank.pixels).toBe(13);
        expect(blank.touchesLimit).toBe(false);
        f.data.fill(3);
        f.data[40 * width + 46] = Number.NaN;
        expect(blankRadius(f.data, width, height, target)).toEqual({ radius: 0, reach: 0, pixels: 0, touchesLimit: false });
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

    it('detects continuation beyond the search circle and image edge, but not closed discs', () => {
        const diagonal = new Float32Array(40 * 40).fill(1);
        for (let y = 0; y < 40; y++) {
            for (let x = 0; x < 40; x++) {
                if ((x === y && x >= 20 && x <= 28) || (x >= 29 && y >= 29)) {
                    diagonal[y * 40 + x] = NaN;
                }
            }
        }
        expect(blankRadius(diagonal, 40, 40, { x: 20.1, y: 20.1 }).touchesLimit).toBe(true);
        const corner = new Float32Array(20 * 20).fill(1);
        for (let y = 0; y < 20; y++) {
            for (let x = 0; x < 20; x++) {
                if (x + y <= 9) {
                    corner[y * 20 + x] = NaN;
                }
            }
        }
        expect(blankRadius(corner, 20, 20, { x: 4, y: 4 }).touchesLimit).toBe(true);
        for (const [radius, reach] of [[11.4, Math.sqrt(128)], [4, 4]]) {
            const disc = new Float32Array(40 * 40).fill(1);
            for (let y = 0; y < 40; y++) {
                for (let x = 0; x < 40; x++) {
                    if (Math.hypot(x - 20, y - 20) <= radius!) {
                        disc[y * 40 + x] = NaN;
                    }
                }
            }
            const result = blankRadius(disc, 40, 40, { x: 20, y: 20 });
            expect(result.touchesLimit).toBe(false);
            expect(result.reach).toBe(reach);
        }
    });

    it('includes a seed pixel exactly on the seed radius', () => {
        const data = new Float32Array(width * height).fill(1);
        data[target.y * width + target.x + 2] = NaN;
        expect(blankRadius(data, width, height, target, { seed: 2 }).pixels).toBe(1);
    });
});

describe('ringAperture', () => {
    it.each([7, 8])('requires eight real pixels for radial fill: count=%s', (count) => {
        const f = frame(0);
        const ring = indices(target, 9, 10);
        const radius = (offset: number) => Math.hypot(offset % width - target.x, Math.floor(offset / width) - target.y);
        const ordered = [...ring].sort((a, b) => radius(a) - radius(b));
        const finite = Array.from({ length: count }, (_, i) => ordered[Math.floor(i * (ordered.length - 1) / (count - 1))]!);
        const radii = finite.map(radius);
        const mean = radii.reduce((sum, r) => sum + r, 0) / count;
        expect(Math.sqrt(radii.reduce((sum, r) => sum + (r - mean) ** 2, 0) / count)).toBeGreaterThan(0.1);
        ring.filter((offset) => !finite.includes(offset)).forEach((offset) => { f.data[offset] = NaN; });
        const result = ringAperture(f.data, width, height, target,
            { ...options, ringIn: 9, binWidth: 1, minFraction: 0.05 });
        expect(result.valid).toBe(count === 8);
    });

    it('rejects radial fill with spread between five and ten percent of bin width', () => {
        const f = frame(0);
        const ring = indices(target, 9, 10);
        const radius = (offset: number) => Math.hypot(offset % width - target.x, Math.floor(offset / width) - target.y);
        const finite = [
            ...ring.filter((offset) => radius(offset) === 9),
            ...ring.filter((offset) => radius(offset) === Math.sqrt(82)).slice(0, 2),
            ...ring.filter((offset) => radius(offset) === Math.sqrt(85)).slice(0, 2),
        ];
        expect(finite).toHaveLength(8);
        const radii = finite.map(radius);
        const mean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
        const spread = Math.sqrt(radii.reduce((sum, r) => sum + (r - mean) ** 2, 0) / radii.length);
        expect(spread).toBeGreaterThan(0.05);
        expect(spread).toBeLessThan(0.1);
        ring.filter((offset) => !finite.includes(offset)).forEach((offset) => { f.data[offset] = NaN; });
        expect(ringAperture(f.data, width, height, target,
            { ...options, ringIn: 9, binWidth: 1, minFraction: 0.05 }).valid).toBe(false);
    });

    it.each(['count', 'spread'] as const)('isolates the radial fill %s guard', (guard) => {
        const f = frame(0);
        const ring = indices(target, 9, 10);
        const radius = (offset: number) => Math.hypot(offset % width - target.x, Math.floor(offset / width) - target.y);
        const ordered = [...ring].sort((a, b) => radius(a) - radius(b));
        const finite = guard === 'count'
            ? [0, 0.25, 0.5, 0.75, 1].map((fraction) => ordered[Math.floor(fraction * (ordered.length - 1))]!)
            : [...ordered.filter((offset) => radius(offset) === 9),
                ...ordered.filter((offset) => radius(offset) > 9 && radius(offset) < 9.1).slice(0, 4)];
        const radii = finite.map(radius);
        const mean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
        const sd = Math.sqrt(radii.reduce((sum, r) => sum + (r - mean) ** 2, 0) / radii.length);
        if (guard === 'count') {
            expect(finite).toHaveLength(5);
            expect(sd).toBeGreaterThan(0.1);
        } else {
            expect(finite).toHaveLength(8);
            expect(sd).toBeGreaterThan(0);
            expect(sd).toBeLessThan(0.1);
        }
        expect(finite.length / ring.length).toBeGreaterThan(0.05);
        ring.filter((offset) => !finite.includes(offset)).forEach((offset) => { f.data[offset] = NaN; });
        const point = ringAperture(f.data, width, height, target, { ...options, binWidth: 1, minFraction: 0.05 });
        expect(point.valid).toBe(false);
        expect(point.sum).toBeNaN();
    });

    it('propagates the noise weights of fitted missing pixels', () => {
        const data = new Float32Array(width * height).fill(10);
        const opts = { ...options, binWidth: 2, noiseScale: 2.8 };
        const ring = indices(target, 6, 10);
        ring.forEach((offset, i) => { data[offset] = i % 10 === 0 ? NaN : 20; });
        indices(target, 14, 18).forEach((offset, i) => { data[offset] = 9 + i % 3; });
        const measured = ringAperture(data, width, height, target, opts);
        expect(measured.valid).toBe(true);
        // Measure each real pixel's influence on the fitted sum instead of duplicating the fit formula.
        let squaredWeights = 0;
        for (const offset of ring.filter((offset) => Number.isFinite(data[offset]))) {
            data[offset]! += 1;
            squaredWeights += (ringAperture(data, width, height, target, opts).sum - measured.sum) ** 2;
            data[offset]! -= 1;
        }
        const skyVariance = Math.PI / 2 * ring.length ** 2 / measured.nSky;
        const expected = measured.backgroundSigma * Math.sqrt(squaredWeights + skyVariance) * opts.noiseScale;
        expect(measured.noise).toBeCloseTo(expected, 8);
    });

    it.each([1, 2, 5])('rejects a sliver bin with only %s real pixels to fit', (count) => {
        const at = { x: 40.3, y: 39.6 };
        const f = steepFrame(at);
        const sliver = indices(at, 9, 9.09);
        expect(sliver).toHaveLength(6);
        sliver.slice(count).forEach((offset) => { f.data[offset] = NaN; });
        const measured = ringAperture(f.data, width, height, at,
            { ...options, ringOut: 9.09, binWidth: 1, minFraction: 0.1 });
        expect(measured.valid).toBe(false);
        expect(measured.sum).toBeNaN();
    });

    it('rejects a fill fit with eight pixels but no radius spread', () => {
        const at = { x: 40.5, y: 40.5 };
        const f = steepFrame(at);
        const ring = indices(at, 9, 10);
        const finite = ring.filter((offset) => Math.hypot(offset % width - at.x, Math.floor(offset / width) - at.y) < 9.2).slice(0, 8);
        expect(finite).toHaveLength(8);
        ring.filter((offset) => !finite.includes(offset)).forEach((offset) => { f.data[offset] = NaN; });
        expect(ringAperture(f.data, width, height, at, { ...options, binWidth: 1, minFraction: 0.1 }).valid).toBe(false);
    });

    it('checks containment at all boundaries including exact outer-radius equality', () => {
        const data = new Float32Array(400).fill(10);
        const opts = { ringIn: 1, ringOut: 3, skyIn: 3, skyOut: 7 };
        for (const at of [{ x: 2, y: 10 }, { x: 17, y: 10 }, { x: 10, y: 2 }, { x: 10, y: 17 }]) {
            expect(ringAperture(data, 20, 20, at, opts).valid).toBe(true);
        }
        expect(ringAperture(data, 20, 20, { x: 10, y: 17.1 }, opts).valid).toBe(false);
    });

    it('fills each radial bin separately and rejects a sparse bin', () => {
        const data = new Float32Array(width * height).fill(3);
        for (const offset of indices(target, 6, 10)) {
            const r = Math.hypot(offset % width - target.x, Math.floor(offset / width) - target.y);
            data[offset] = r < 8 ? 103 : 13;
        }
        const full = ringAperture(data, width, height, target, { ...options, binWidth: 2 });
        const inner = indices(target, 6, 8);
        inner.slice(0, 8).forEach((offset) => { data[offset] = NaN; });
        const partial = ringAperture(data, width, height, target, { ...options, binWidth: 2 });
        expect(partial.valid).toBe(true);
        expect(partial.sum).toBeCloseTo(full.sum, 8);
        inner.slice(0, Math.ceil(inner.length * 0.21)).forEach((offset) => { data[offset] = NaN; });
        expect(ringAperture(data, width, height, target, { ...options, binWidth: 2 }).valid).toBe(false);
    });
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
        expect(sparse.snr).toBe(0);
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
            expect(result.snr).toBe(0);
        }
        expect(ringAperture(data, width, height, target, { ringIn: 0.1, ringOut: 0.2 }).valid).toBe(false);
    });

    it.each([
        { ringIn: 0 }, { ringIn: -1 }, { ringIn: NaN }, { ringOut: Infinity }, { ringOut: 6 },
        { skyIn: 9 }, { skyIn: NaN }, { skyOut: 14 }, { skyOut: Infinity },
        { minFraction: 0 }, { minFraction: 1.01 }, { minFraction: NaN },
        { binWidth: 0 }, { binWidth: -1 }, { binWidth: NaN }, { binWidth: Infinity },
        { noiseScale: 0 }, { noiseScale: 0.9 }, { noiseScale: NaN }, { noiseScale: Infinity },
    ])('throws HaloError for bad options %j', (bad) => {
        expect(() => ringAperture(frame(0).data, width, height, target, { ...options, ...bad })).toThrow(HaloError);
    });

    it('rejects mismatched arrays and invalid dimensions', () => {
        expect(() => ringAperture(new Float32Array(5), width, height, target, options)).toThrow(HaloError);
        for (const w of [0, -1, 1.5, NaN, Infinity]) {
            expect(() => ringAperture(new Float32Array(0), w, 0, target, options)).toThrow(HaloError);
        }
    });

    it('allows a clipped sky when every whole ring pixel is inside', () => {
        const result = ringAperture(new Float32Array(400).fill(10), 20, 20, { x: 3, y: 10 },
            { ringIn: 1, ringOut: 3.6, skyIn: 4, skyOut: 8 });
        expect(result.valid).toBe(true);
        expect(result.sum).toBe(0);
    });

    it('accepts exactly 80 percent finite pixels and includes fill and sky noise', () => {
        const opts = { ringIn: 2, ringOut: 5, skyIn: 6, skyOut: 8 };
        const ring = indices(target, opts.ringIn, opts.ringOut);
        expect(ring.length % 5).toBe(0);
        const data = new Float32Array(width * height).fill(10);
        ring.forEach((offset, i) => { data[offset] = i < ring.length / 5 ? NaN : 20; });
        indices(target, 6, 8).forEach((offset, i) => { data[offset] = 9 + i % 3; });
        const result = ringAperture(data, width, height, target, opts);
        expect(result.valid).toBe(true);
        expect(result.nPix / ring.length).toBe(0.8);
        const noise = 1.4826 * Math.sqrt(60 * (1 + Math.PI / 2 * 60 / result.nSky));
        expect(result.noise).toBeGreaterThan(noise);
        expect(result.snr).toBeCloseTo(600 / result.noise, 10);
    });
});

describe('ringFor', () => {
    it.each([undefined, 0, 3.075, 6.15])('reserves the shifted-ring margin for sigma=%s arcsec', (sigma) => {
        const delta = (sigma ?? 1.5375) / 3.075;
        for (const inside of [true, false]) {
            const at = { x: 15 + delta - 1 + (inside ? 1e-4 : -1e-4), y: 40 };
            const f = frame(0, 1, 2.2, at);
            const core = blankRadius(f.data, width, height, at).radius;
            const opts = { ...options, margin: 4, thickness: 15 - core - 4, targetPositionSigmaArcsec: sigma,
                skyIn: 15 + 2 * delta + 2, skyOut: 15 + 2 * delta + 6 };
            if (!inside) {
                expect(() => ringFor([f], at, opts)).toThrow(HaloError);
                continue;
            }
            const ring = ringFor([f], at, opts);
            expect(ring.ringOut).toBeCloseTo(15, 12);
            indices(at, ring.ringIn - delta - 1, ring.ringOut + delta + 1).forEach((offset) => {
                f.data[offset] = 103;
            });
            indices(at, opts.skyIn - delta, opts.skyOut + delta).forEach((offset, i) => {
                f.data[offset] = 2 + i % 3;
            });
            expect(haloCurve([f], at, refs, { ...opts, ...ring }).points[0]!.valid).toBe(true);
        }
    });

    it.each([-1, NaN, Infinity, -Infinity])('validates ring selection position sigma=%s', (sigma) => {
        const opts = { targetPositionSigmaArcsec: sigma };
        expect(() => ringFor([frame(0, 1, 2.2)], target, opts)).toThrow(HaloError);
    });

    it('expands a limit-reaching search and keeps the larger core full margin', () => {
        const frames = [frame(0, 1, 9), frame(1, 1, 12.3), frame(2, 1, 12.3)];
        for (let x = target.x; x < width; x++) {
            frames[2]!.data[target.y * width + x] = NaN;
        }
        const largeCore = blankRadius(frames[1]!.data, width, height, target,
            { maxRadius: Math.hypot(width, height) });
        expect(largeCore.touchesLimit).toBe(false);
        expect(blankRadius(frames[1]!.data, width, height, target).touchesLimit).toBe(true);
        const chosen = ringFor(frames, target);
        expect(chosen.ringIn - largeCore.radius).toBeCloseTo(4, 12);
        for (const f of frames) {
            indices(target, 13, 28).forEach((offset) => {
                if (Number.isFinite(f.data[offset])) {
                    f.data[offset] = 103;
                }
            });
            indices(target, 28, 36).forEach((offset, i) => {
                if (Number.isFinite(f.data[offset])) {
                    f.data[offset] = 3 + (i % 3 - 1) * 1e-4;
                }
            });
        }
        const curve = haloCurve(frames, target, refs, { ...options, ...chosen, skyIn: 30, skyOut: 34 });
        expect(curve.points.map((point) => point.valid)).toEqual([true, true, false]);
        expect(curve.points[2]).toMatchObject({ ratio: NaN, relative: NaN, relativeNoise: NaN });
        expect(() => ringFor([frames[2]!], target)).toThrow(HaloError);
    });

    it('keeps the full core margin from bounded frames whose own ring cannot fit', () => {
        const positions = [target, { x: 13.5, y: 40 }];
        const frames = positions.map((at, i) => frame(i, 1, i === 0 ? 2.2 : 4, at));
        const chosen = ringFor(frames, (_f, i) => positions[i]!);
        const largest = blankRadius(frames[1]!.data, width, height, positions[1]!).radius;
        expect(chosen.ringIn).toBeCloseTo(largest + 4, 12);
        const curve = haloCurve(frames, (_f, i) => positions[i]!, refs,
            { ...options, ...chosen, skyIn: chosen.ringOut, skyOut: chosen.ringOut + 2 });
        expect(curve.points.map((point) => point.valid)).toEqual([true, false]);
        expect(chosen.ringIn - largest).toBeGreaterThanOrEqual(4);
    });

    it.each([{ x: NaN, y: 40 }, { x: 40, y: NaN }, { x: Infinity, y: 40 }])(
        'skips a non-finite target position %j while choosing a common ring', (bad) => {
            const frames = [frame(1, 1, 2.2), frame(0, 1, 2.2)];
            const locate = (_f: RegriddedFrame, i: number) => i === 0 ? bad : target;
            expect(ringFor(frames, locate)).toEqual(ringFor([frames[1]!], target));
            expect(haloCurve(frames, locate, refs, options).points.map((point) => point.valid)).toEqual([true, false]);
            expect(() => ringFor([frames[0]!], bad)).toThrow('The ring does not fit in the picture: use a wider view');
        },
    );

    it.each([0, 2, 4, 8])('chooses a ring from fitting frames and invalidates the frame at x=%s', (x) => {
        const positions = [target, { x, y: 40 }];
        const frames = positions.map((at, i) => frame(i, 1, i === 0 ? 2.2 : 6, at));
        const chosen = ringFor(frames, (_f, i) => positions[i]!);
        if (x === 8) {
            const bounded = blankRadius(frames[1]!.data, width, height, positions[1]!).radius;
            expect(chosen).toEqual({ ringIn: bounded + 4, ringOut: bounded + 10 });
        } else {
            expect(chosen).toEqual(ringFor([frames[0]!], target));
        }
        // The larger ring's sky reaches beyond the synthetic halo's hard cutoff; supply finite scatter.
        indices(target, chosen.ringOut + 2, chosen.ringOut + 6).forEach((offset, i) => {
            frames[0]!.data[offset] = 3 + (i % 3 - 1) * 1e-4;
        });
        const curve = haloCurve(frames, (_f, i) => positions[i]!, refs,
            { ...options, ...chosen, skyIn: chosen.ringOut + 2, skyOut: chosen.ringOut + 6 });
        expect(curve.points.map((point) => point.valid)).toEqual([true, false]);
        expect(curve.points[1]!.relative).toBeNaN();
        expect(() => ringFor([frames[1]!], positions[1]!)).toThrow(HaloError);
    });

    it('reports missing frames and rings that do not fit any selected frame', () => {
        expect(() => ringFor([], target)).toThrow('No frames given');
        expect(() => ringFor([frame(0)], target, { lambda: 3 })).toThrow('No frame at this wavelength');
        const f = frame(0, 1, 2.2, { x: 4, y: 40 });
        expect(() => ringFor([f], { x: 4, y: 40 })).toThrow('The ring does not fit in the picture: use a wider view');
        expect(() => ringFor([frame(0, 1, 2.2)], target, { seed: 13 })).not.toThrow();
        const moving = [target, { x: 4, y: 40 }];
        const frames = moving.map((at, i) => frame(i, 1, 2.2, at));
        expect(() => ringFor(frames, (_f, i) => moving[i]!)).not.toThrow();
        expect(() => ringFor([frame(0, 1, 2.2), frame(1, 2, 3.2)], target, { margin: 0 })).toThrow(HaloError);
        const neighbour = frame(0, 1, 2.2);
        neighbour.data[41 * width + 46] = NaN;
        expect(() => ringFor([neighbour], target)).toThrow('A blank area reaches the ring in every frame');
    });
    it('uses the largest hole, native-pixel defaults and explicit margins', () => {
        const frames = [frame(0, 1, 2.2), frame(1, 2, 3.2), frame(2, 4, 4.2)];
        const largest = Math.sqrt(17) + Math.SQRT1_2;
        expect(ringFor(frames, target)).toEqual({ ringIn: largest + 4, ringOut: largest + 10 });
        frames.forEach((f) => { f.grid.pixelArcsec = 6.15; });
        expect(ringFor(frames, target)).toEqual({ ringIn: largest + 2, ringOut: largest + 5 });
        expect(ringFor(frames, target, { margin: 1, thickness: 3 })).toEqual({ ringIn: largest + 1, ringOut: largest + 4 });
    });

    it('rejects no hole, a limit-reaching hole and invalid options', () => {
        expect(() => ringFor([], target)).toThrow(HaloError);
        expect(() => ringFor([frame(0)], target)).toThrow(HaloError);
        const blank = frame(1);
        blank.data.fill(Number.NaN);
        expect(() => ringFor([blank], target)).toThrow(HaloError);
        expect(ringFor([frame(0, 1, 2.2), blank], target)).toEqual(ringFor([frame(0, 1, 2.2)], target));
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
        expect(seen).toEqual([1, 0]);
        expect(result.ringIn).toBeCloseTo(Math.sqrt(10) + Math.SQRT1_2 + 1, 12);
    });

    it('rejects mixed grids and invalid scales before filtering', () => {
        for (const key of ['width', 'height', 'pixelArcsec'] as const) {
            const frames = [frame(0, 1, 2.2), frame(1, 1, 2.2, target, 3)];
            frames[1]!.grid[key] += 1;
            expect(() => ringFor(frames, target, { lambda: 2 })).toThrow(HaloError);
        }
        for (const scale of [0, NaN, Infinity]) {
            const f = frame(0, 1, 2.2);
            f.grid.pixelArcsec = scale;
            expect(() => ringFor([f], target)).toThrow(HaloError);
        }
    });

    it('filters out-of-band holes using the curve wavelength rules', () => {
        const frames = [frame(0, 1, 2.2), frame(1, 1, 7.2, target, 3)];
        const filtered = ringFor(frames, target, { lambda: 2 });
        expect(filtered).toEqual(ringFor([frames[0]!], target));
        expect(ringFor(frames, target)).toEqual(filtered);
        expect(ringFor(frames, target, { maxDeltaUm: 0.02 })).toEqual(filtered);
    });

    it('expands the default six-native-pixel search for a bounded larger core', () => {
        const f = frame(0, 1, 7.2);
        expect(() => ringFor([f], target)).not.toThrow();
        f.grid.pixelArcsec = 6.15;
        expect(ringFor([f], target)).toEqual(ringFor([f], target, { maxRadius: 12 }));
        expect(() => ringFor([f], target, { maxRadius: 12 })).not.toThrow();
    });
});

describe('haloCurve', () => {
    it('states once on each valid point when position uncertainty is disabled', () => {
        const frames = [frame(0), frame(1)];
        indices(target, 6, 10).forEach((offset) => { frames[1]!.data[offset] = NaN; });
        const curve = haloCurve(frames, target, refs, { ...options, targetPositionSigmaArcsec: 0 });
        expect(curve.points[0]!.valid).toBe(true);
        expect(curve.points[0]!.positionNoise).toBe(0);
        expect(curve.points[0]!.caveats).toEqual(['Position uncertainty is not included in this error bar.']);
        expect(curve.points[1]!.valid).toBe(false);
    });

    it.each([0.499, 0.5, 0.501])('pins the position caveat at fraction=%s of sky noise', (fraction) => {
        const at = { x: 40.3, y: 39.6 };
        const f = steepFrame(at);
        const opts = { ...options, ...ringFor([f], at), noiseScale: 1 };
        const sky = haloCurve([f], at, refs, { ...opts, targetPositionSigmaArcsec: 0 }).points[0]!;
        const initial = haloCurve([f], at, refs, opts).points[0]!;
        const noiseScale = initial.positionNoise / (fraction * sky.target.noise);
        const point = haloCurve([f], at, refs, { ...opts, noiseScale }).points[0]!;
        expect(point.valid).toBe(true);
        expect(point.positionNoise / (sky.target.noise * noiseScale)).toBeCloseTo(fraction, 12);
        expect(point.caveats.some((text) => /error bar includes/.test(text))).toBe(fraction >= 0.5);
    });

    it.each(['zero median', 'overflowing median', 'relative overflow', 'relative-noise overflow'] as const)(
        'clears all plot numbers after %s', (kind) => {
            const frames = kind === 'overflowing median' ? [frame(0), frame(1)] : [frame(0), frame(1), frame(2)];
            if (kind === 'zero median' || kind.includes('relative')) {
                for (const f of frames.slice(0, kind === 'zero median' ? 3 : 2)) {
                    f.data.forEach((value, i) => { f.data[i] = value * 1e-20; });
                }
            }
            const ref = aperture(frames[0]!.data, width, height, refs[0]!, options);
            const sum = ringAperture(frames[0]!.data, width, height, target, options).sum;
            // Supply extreme, finite comparison results to exercise normalization arithmetic
            // independently of the Float32 image range; leave the ring measurement real.
            const spy = vi.spyOn(photometry, 'aperture').mockImplementation((data) => {
                if (kind === 'zero median') {
                    return { ...ref, valid: true, sum: 1e308, noise: 1 };
                }
                if (kind === 'overflowing median') {
                    return { ...ref, valid: true, sum: sum / 1e308, noise: sum / 1e308 * 1e-3 };
                }
                if (data !== frames[2]!.data) {
                    return { ...ref, valid: true, sum: 1e50, noise: 1 };
                }
                return kind === 'relative overflow'
                    ? { ...ref, valid: true, sum: 1e-290, noise: 1e-300 }
                    : { ...ref, valid: true, sum: 1e-100, noise: 1e90 };
            });
            try {
                const curve = haloCurve(frames, target, [refs[0]!], { ...options, targetPositionSigmaArcsec: 0 });
                const bad = kind.includes('relative') ? curve.points.slice(2) : curve.points;
                expect(bad.every((point) => !point.valid)).toBe(true);
                for (const point of bad) {
                    expect(point).toMatchObject({ ratio: NaN, relative: NaN, relativeNoise: NaN });
                }
                if (kind.includes('relative')) {
                    expect(curve.points.slice(0, 2).every((point) => point.valid)).toBe(true);
                }
            } finally {
                spy.mockRestore();
            }
        },
    );

    it('rejects position-dominated rings before the median and reference scatter', () => {
        const catalog = { x: 40.3, y: 39.6 };
        const frames = [steepFrame(catalog), steepFrame({ x: catalog.x + 2, y: catalog.y }), steepFrame(catalog)];
        frames.forEach((f, i) => { f.frame.tMin += i; f.frame.tMax += i; });
        const ring = ringFor([frames[0]!], catalog);
        const opts = { ...options, ...ring, skyIn: ring.ringOut + 2, skyOut: ring.ringOut + 6,
            targetPositionSigmaArcsec: 6.15 };
        for (const f of [frames[0]!, frames[2]!]) {
            indices(catalog, ring.ringIn - 2, ring.ringOut + 2).forEach((offset) => {
                f.data[offset] = f === frames[0] ? 103 : 203;
            });
            indices(catalog, ring.ringOut + 2, ring.ringOut + 8).forEach((offset, i) => {
                f.data[offset] = 3 + (i % 3 - 1) * 1e-4;
            });
        }
        frames[1]!.data[refs[0]!.y * width + refs[0]!.x]! += 1000;
        const curve = haloCurve(frames, catalog, refs, opts);
        const bad = curve.points[1]!;
        expect(bad.target.snr).toBeGreaterThan(3);
        expect(bad.target.sum / bad.target.noise).toBeLessThan(1);
        expect(bad.valid).toBe(false);
        expect([bad.ratio, bad.relative, bad.relativeNoise].every(Number.isNaN)).toBe(true);
        const control = haloCurve([frames[0]!, frames[2]!], catalog, refs, opts);
        expect(curve.points[0]!.valid).toBe(true);
        expect(curve.points[0]!.relative).toBe(control.points[0]!.relative);
        expect(curve.refScatter).toEqual(control.refScatter);
    });

    it.each([0.125, 0.25, 0.5])('covers a %s native-pixel centre error within two combined sigma', (offsetNative) => {
        const catalog = { x: 40.3, y: 39.6 };
        const ring = ringFor([steepFrame(catalog)], catalog);
        const opts = { ...options, ...ring, skyIn: ring.ringOut + 2, skyOut: ring.ringOut + 6 };
        for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
            const actual = {
                x: catalog.x + 2 * offsetNative * Math.cos(angle),
                y: catalog.y + 2 * offsetNative * Math.sin(angle),
            };
            const frames = [steepFrame(catalog), steepFrame(actual)];
            const curve = haloCurve(frames, catalog, refs, opts);
            expect(curve.points.every((point) => point.valid)).toBe(true);
            const [first, second] = curve.points;
            const difference = Math.abs(second!.relative - first!.relative);
            // Compare the two visits using the quadrature sum of their one-sigma bars; allow <= 2 sigma.
            expect(difference / Math.hypot(first!.relativeNoise, second!.relativeNoise)).toBeLessThanOrEqual(2);
            const disabled = { ...opts, targetPositionSigmaArcsec: 0 };
            const control = haloCurve(frames, catalog, refs, disabled).points;
            expect(control.every((point) => point.valid)).toBe(true);
            if (angle === 0) {
                expect(Math.abs(control[1]!.relative - control[0]!.relative)
                    / Math.hypot(control[0]!.relativeNoise, control[1]!.relativeNoise)).toBeGreaterThan(4);
            }
        }
    });

    it.each([0, 3.075, 6.15])('matches the analytic linear-plane position error for sigma=%s arcsec', (sigma) => {
        const f = frame(0);
        const a = 2;
        const b = 3;
        for (const offset of indices(target, 0, 13)) {
            const x = offset % width - target.x;
            const y = Math.floor(offset / width) - target.y;
            f.data[offset] = 1003 + a * x + b * y;
        }
        indices(target, 12, 21).filter((offset) => Math.hypot(offset % width - target.x,
            Math.floor(offset / width) - target.y) >= 13).forEach((offset, i) => { f.data[offset] = 2 + i % 3; });
        const opts = { ...options, targetPositionSigmaArcsec: sigma };
        const original = ringAperture(f.data, width, height, target,
            { ...opts, noiseScale: resampleNoiseScale(f.grid.pixelArcsec) });
        const expected = sigma / f.grid.pixelArcsec * Math.hypot(a, b) * indices(target, 6, 10).length;
        const point = haloCurve([f], target, refs, opts).points[0]!;
        expect(point.valid).toBe(true);
        // Integer shifts translate an unchanged pixel mask on an exactly representable plane;
        // 1e-9 absolute tolerance allows only floating-point arithmetic rounding.
        expect(Math.abs(point.positionNoise - expected)).toBeLessThan(1e-9);
        expect(point.target.noise).toBeCloseTo(Math.hypot(original.noise, expected), 9);
        expect(point.target.snr).toBe(original.snr);
    });

    it('suppresses the caveat when a nonzero position term is below half the sky noise', () => {
        const at = { x: 40.3, y: 39.6 };
        const f = steepFrame(at);
        const opts = { ...options, ...ringFor([f], at), noiseScale: 100 };
        const point = haloCurve([f], at, refs, opts).points[0]!;
        const skyOnly = haloCurve([f], at, refs, { ...opts, targetPositionSigmaArcsec: 0 }).points[0]!;
        expect(point.valid).toBe(true);
        expect(point.positionNoise).toBeGreaterThan(0);
        expect(point.positionNoise).toBeLessThan(0.5 * skyOnly.target.noise);
        expect(point.caveats).toEqual([]);
        expect(point).toEqual(haloCurve([f], at, refs, { ...opts, targetPositionSigmaArcsec: 1.5375 }).points[0]);
    });

    it.each(['off the frame', 'too few ring pixels', 'too few sky pixels', 'blank core'] as const)(
        'invalidates a point when a position shift encounters %s', (kind) => {
            const at = kind === 'off the frame' ? { x: 9, y: 40 } : { x: 40.3, y: 39.6 };
            const f = frame(0, 1, 2.2, at);
            const opts = { ...options, ringIn: kind === 'blank core' ? 3 : 6 };
            if (kind === 'too few ring pixels') {
                const shifted = { x: at.x + 2, y: at.y };
                indices(shifted, 9, 10).filter((offset) => Math.hypot(offset % width - at.x,
                    Math.floor(offset / width) - at.y) >= 10).forEach((offset) => { f.data[offset] = NaN; });
            }
            if (kind === 'too few sky pixels') {
                const shiftedSky = new Set(indices({ x: at.x + 1, y: at.y }, 14, 18));
                indices(at, 12, 20).forEach((offset) => { f.data[offset] = NaN; });
                indices(at, 14, 18).filter((offset) => !shiftedSky.has(offset)).forEach((offset, i) => {
                    f.data[offset] = 2 + i % 3;
                });
            }
            const disabled = { ...opts, targetPositionSigmaArcsec: 0 };
            expect(haloCurve([f], at, refs, disabled).points[0]!.valid).toBe(true);
            const enabled = { ...opts, targetPositionSigmaArcsec: kind === 'too few ring pixels' ? 6.15 : 3.075 };
            const point = haloCurve([f], at, refs, enabled).points[0]!;
            expect(point.valid).toBe(false);
            expect(point.relativeNoise).toBeNaN();
            expect(point.positionNoise).toBeNaN();
            expect(point.caveats).toContain('Position uncertainty cannot be measured: a shifted ring could not be measured under the same rules.');
        },
    );

    it.each([-1, NaN, Infinity, -Infinity])('rejects a target position uncertainty of %s arcsec', (sigma) => {
        const opts = { ...options, targetPositionSigmaArcsec: sigma };
        expect(() => haloCurve([frame(0)], target, refs, opts)).toThrow(HaloError);
    });

    it.each([0, -1])('rejects an individual comparison with nonpositive net signal %s', (signal) => {
        const f = frame(0);
        const ref = refs[1]!;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (Math.hypot(x - ref.x, y - ref.y) <= 3) {
                    f.data[y * width + x] = 3 + signal;
                }
            }
        }
        const point = haloCurve([f], target, refs, options).points[0]!;
        expect(point.refSum).toBeGreaterThan(0);
        expect(point.valid).toBe(false);
        expect(point.relative).toBeNaN();
    });

    it.each([0.125, 0.25, 0.5])('exposes position sensitivity at an offset of %s native pixels', (offsetNative) => {
        const catalog = { x: 40.3, y: 39.6 };
        const ring = ringFor([steepFrame(catalog)], catalog);
        const opts = { ...options, ...ring, skyIn: ring.ringOut + 2, skyOut: ring.ringOut + 6 };
        for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
            const at = {
                x: catalog.x + 2 * offsetNative * Math.cos(angle),
                y: catalog.y + 2 * offsetNative * Math.sin(angle),
            };
            const f = steepFrame(at);
            const truth = haloCurve([f], at, refs, opts).points[0]!.target.sum;
            const point = haloCurve([f], catalog, refs, { ...opts, targetPositionSigmaArcsec: 0 }).points[0]!;
            const bias = Math.abs(point.target.sum / truth - 1);
            expect(point.valid).toBe(true);
            if (angle === 0) {
                expect(bias).toBeGreaterThan(0.02);
                expect(point.target.noise / truth).toBeLessThan(bias);
            }
            const covered = haloCurve([f], catalog, refs, opts).points[0]!;
            expect(covered.valid).toBe(true);
            if (bias > 0.02) {
                expect(covered.positionNoise).toBeGreaterThan(0.5 * point.target.noise);
                expect(covered.target.noise).toBeGreaterThan(point.target.noise);
                expect(covered.caveats.some((text) => /position.*error bar includes/i.test(text))).toBe(true);
            }
        }
    });

    it('rejects a native half-pixel sliver bin after a single lost pixel', () => {
        const at = { x: 40.3, y: 39.6 };
        const f = steepFrame(at);
        f.data[indices(at, 9, 9.09)[0]!] = NaN;
        expect(haloCurve([f], at, refs, { ...options, ringOut: 9.09 }).points[0]!.valid).toBe(false);
    });

    it.each([2, 3])('refuses reversed frame times even at wavelength %s', (lambda) => {
        const f = frame(0, 1, 2.2, target, lambda);
        f.frame.tMax = f.frame.tMin - 1;
        for (const measure of [
            () => haloCurve([f], target, refs, { ...options, lambda: 2 }),
            () => ringFor([f], target, { lambda: 2 }),
        ]) {
            expect(measure).toThrow(HaloError);
            expect(measure).toThrow('Frame end must not be before its start');
        }
    });

    it.each([0, -1, NaN, Infinity, -Infinity])('reports pixelArcsec=%s as HaloError before wavelength selection', (pixelArcsec) => {
        const f = frame(0, 1, 2.2, target, 3);
        f.grid.pixelArcsec = pixelArcsec;
        for (const measure of [
            () => haloCurve([f], target, refs, { ...options, lambda: 2 }),
            () => ringFor([f], target, { lambda: 2 }),
        ]) {
            expect(measure).toThrow(HaloError);
            expect(measure).toThrow('Pixel size must be finite and positive');
        }
    });

    it.each([0, -1, 0.99, NaN, Infinity, -Infinity])('rejects minSnr=%s below the finite floor of 1', (minSnr) => {
        expect(() => haloCurve([frame(0)], target, refs, { ...options, minSnr })).toThrow(HaloError);
    });

    it('gates faint rings on scaled SNR, including the threshold equality', () => {
        const skyOnly = { ...options, targetPositionSigmaArcsec: 0 };
        const f = frame(0);
        indices(target, 6, 10).forEach((offset) => { f.data[offset] = 3.5; });
        indices(target, 14, 18).forEach((offset, i) => { f.data[offset] = 2 + i % 3; });
        const point = haloCurve([f], target, refs, { ...skyOnly, minSnr: 1 }).points[0]!;
        expect(point.valid).toBe(true);
        expect(point.target.snr).toBeGreaterThan(1);
        expect(point.target.snr).toBeLessThan(2);
        expect(haloCurve([f], target, refs, { ...skyOnly, minSnr: 2 }).points[0]!.valid).toBe(false);
        expect(haloCurve([f], target, refs, { ...skyOnly, minSnr: point.target.snr }).points[0]!.valid).toBe(true);
        indices(target, 6, 10).forEach((offset) => { f.data[offset] = 3.1; });
        expect(haloCurve([f], target, refs, { ...skyOnly, minSnr: 1 }).points[0]!.valid).toBe(false);
    });

    it('defaults to a sky-only SNR threshold of three', () => {
        const skyOnly = { ...options, targetPositionSigmaArcsec: 0 };
        const f = frame(0);
        indices(target, 6, 10).forEach((offset) => { f.data[offset] = 3.5; });
        indices(target, 14, 18).forEach((offset, i) => { f.data[offset] = 2 + i % 3; });
        const permissive = haloCurve([f], target, refs, { ...skyOnly, minSnr: 1 }).points[0]!;
        expect(permissive.valid).toBe(true);
        expect(permissive.target.snr).toBeGreaterThan(1);
        expect(permissive.target.snr).toBeLessThan(3);
        expect(haloCurve([f], target, refs, skyOnly).points[0]!.valid).toBe(false);
        indices(target, 6, 10).forEach((offset) => { f.data[offset] = 4.5; });
        const brighter = haloCurve([f], target, refs, skyOnly).points[0]!;
        expect(brighter.target.snr).toBeGreaterThan(3);
        expect(brighter.valid).toBe(true);
        expect(brighter).toEqual(haloCurve([f], target, refs, { ...skyOnly, minSnr: 3 }).points[0]);
    });

    it('rejects a ring whose sky noise cannot give a positive SNR', () => {
        const f = frame(0);
        indices(target, 14, 18).forEach((offset) => { f.data[offset] = 3; });
        expect(haloCurve([f], target, refs, options).points[0]!.valid).toBe(false);
    });

    it.each([undefined, 5])('propagates comparison-star noise with noiseScale=%s', (noiseScale) => {
        const f = frame(0);
        for (const ref of refs) {
            indices(ref, 6, 10).forEach((offset, i) => { f.data[offset] = 2 + i % 3; });
        }
        const point = haloCurve([f], target, refs, { ...options, noiseScale }).points[0]!;
        const measuredRefs = refs.map((ref) => aperture(f.data, width, height, ref,
            { ...options, noiseScale: noiseScale ?? resampleNoiseScale(f.grid.pixelArcsec) }));
        const refNoise = Math.hypot(...measuredRefs.map((ref) => ref.noise));
        expect(point.valid).toBe(true);
        expect(point.relativeNoise).toBeCloseTo(point.relative * Math.hypot(
            point.target.noise / point.target.sum, refNoise / point.refSum,
        ), 12);
        expect(Number.isFinite(point.relativeNoise)).toBe(true);
    });

    it.each([6.15, 3.075, 1.5375])('scales ring noise and sky-level uncertainty on a %s arcsec grid', (pixelArcsec) => {
        const f = frame(0);
        f.grid.pixelArcsec = pixelArcsec;
        indices(target, 14, 18).forEach((offset, i) => { f.data[offset] = 2 + i % 3; });
        const opts = { ...options, targetPositionSigmaArcsec: 0 };
        const measured = haloCurve([f], target, refs, opts).points[0]!.target;
        const count = indices(target, 6, 10).length;
        const expected = measured.backgroundSigma * Math.sqrt(count * (1 + Math.PI / 2 * count / measured.nSky));
        expect(measured.noise).toBeCloseTo(expected * resampleNoiseScale(pixelArcsec), 10);
        expect(measured.snr).toBeCloseTo(measured.sum / measured.noise, 10);
        const explicit = haloCurve([f], target, refs, { ...opts, noiseScale: 7 }).points[0]!.target;
        expect(explicit.noise).toBeCloseTo(expected * 7, 10);
    });

    it.each([0, 1, 2, 3])('rejects or corrects disconnected blank pattern %i', (kind) => {
        const at = { x: 40.5, y: 40.5 };
        const baseline = frame(0, 1, 0, at);
        const truth = haloCurve([baseline], at, refs, { ...options, seed: 0.5 }).points[0]!.target.sum;
        const f = frame(0, 1, 0, at);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const r = Math.hypot(x - at.x, y - at.y);
                if ((kind === 0 && x >= at.x && r >= 6 && r < 7)
                    || (kind === 1 && x >= at.x && y >= at.y && r >= 6 && r < 8)
                    || (kind === 2 && (r < 2 || (x >= at.x && r >= 3 && r < 7)))
                    || (kind === 3 && x >= at.x && r >= 1 && r < 7)) {
                    f.data[y * width + x] = NaN;
                }
            }
        }
        const point = haloCurve([f], at, refs, { ...options, seed: 0.5 }).points[0]!;
        expect(!point.valid || Math.abs(point.target.sum / truth - 1) < 0.02).toBe(true);
    });

    it('stays within 2 percent or rejects NaN bands on a steep halo', () => {
        const at = { x: 40.3, y: 39.6 };
        const ring = ringFor([steepFrame(at)], at);
        const opts = { ...options, ...ring, skyIn: ring.ringOut + 2, skyOut: ring.ringOut + 6 };
        const truth = haloCurve([steepFrame(at)], at, refs, opts).points[0]!.target.sum;
        for (const lo of [0, 0.25, 0.5, 0.75, 1.5]) {
            for (const w of [0.25, 0.5, 0.75]) {
                for (const arc of [0.3, 0.5, 0.7, 0.95]) {
                    const f = steepFrame(at);
                    for (let y = 0; y < height; y++) {
                        for (let x = 0; x < width; x++) {
                            const r = Math.hypot(x - at.x, y - at.y);
                            const turn = (Math.atan2(y - at.y, x - at.x) / (2 * Math.PI) + 1.5) % 1;
                            if (turn < arc && r >= ring.ringIn + lo && r < ring.ringIn + lo + w) {
                                f.data[y * width + x] = NaN;
                            }
                        }
                    }
                    const point = haloCurve([f], at, refs, opts).points[0]!;
                    expect(!point.valid || Math.abs(point.target.sum / truth - 1) < 0.02).toBe(true);
                }
            }
        }
    });

    it('rejects a zero or negative halo among positive visits', () => {
        for (const value of [3, -7]) {
            const flat = frame(2);
            indices(target, 6, 10).forEach((offset) => { flat.data[offset] = value; });
            indices(target, 14, 18).forEach((offset) => { flat.data[offset] = 3; });
            const curve = haloCurve([frame(0), frame(1, 2), flat], target, refs, options);
            expect(curve.points.map((point) => point.valid)).toEqual([true, true, false]);
        }
    });

    it('counts a blank pixel footprint that reaches the ring, exactly at the edge', () => {
        const at = (dx: number, dy: number, ringIn = 6) => {
            const f = frame(0);
            f.data[(target.y + dy) * width + target.x + dx] = NaN;
            return haloCurve([f], target, refs, { ...options, ringIn, ringOut: ringIn + 4, targetPositionSigmaArcsec: 0 }).points[0]!.valid;
        };
        expect(at(5, 2)).toBe(false);
        expect(at(5, 0)).toBe(true);
        expect(at(5, 0, 5 + Math.SQRT1_2)).toBe(false);
        expect(at(6, 0)).toBe(true);
    });

    it('recovers evenly scattered missing ring pixels', () => {
        const at = { x: 40.5, y: 40.5 };
        const opts = { ...options, targetPositionSigmaArcsec: 0 };
        const truth = haloCurve([frame(0, 1, 0, at)], at, refs, opts).points[0]!.target.sum;
        const scattered = frame(0, 1, 0, at);
        for (const [inner, outer] of [[6, 8], [8, 10]]) {
            indices(at, inner!, outer!).forEach((offset, i) => { if (i % 10 === 0) { scattered.data[offset] = NaN; } });
        }
        const point = haloCurve([scattered], at, refs, opts).points[0]!;
        expect(point.valid).toBe(true);
        expect(Math.abs(point.target.sum / truth - 1)).toBeLessThan(0.02);
    });

    it('rejects nonpositive halo sums and non-finite frame times', () => {
        const zero = frame(0);
        indices(target, 6, 10).forEach((offset) => { zero.data[offset] = 3; });
        indices(target, 14, 18).forEach((offset) => { zero.data[offset] = 3; });
        const negative = frame(1);
        const positive = frame(2);
        indices(target, 14, 18).forEach((offset) => { negative.data[offset] = 3; positive.data[offset] = 3; });
        indices(target, 6, 10).forEach((offset) => {
            positive.data[offset] = 13;
            negative.data[offset] = -7;
        });
        for (const frames of [[zero], [negative, positive]]) {
            for (const point of haloCurve(frames, target, refs, options).points) {
                expect(!point.valid || [point.relative, point.relativeNoise, point.target.noise, point.ratio, point.mjd].every(Number.isFinite)).toBe(true);
            }
            expect(haloCurve(frames, target, refs, options).points[0]!.valid).toBe(false);
        }
        for (const key of ['tMin', 'tMax'] as const) {
            const f = frame(0);
            f.frame[key] = NaN;
            expect(() => haloCurve([f], target, refs, options)).toThrow(HaloError);
            expect(() => ringFor([f], target)).toThrow(HaloError);
        }
    });
    it('rejects a connected blank core entering the ring while a chosen ring recovers brightness', () => {
        const frames = [frame(0, 1, 2.2), frame(1, 2, 6), frame(2, 4, 3.2)];
        const ring = indices(target, 6, 10);
        const edge = ring.filter((offset) => Math.hypot(offset % width - target.x, Math.floor(offset / width) - target.y) < 6.4);
        edge.slice(0, 8).forEach((offset) => { frames[1]!.data[offset] = NaN; });
        const curve = haloCurve(frames, target, refs, options);
        expect(curve.points.map((point) => point.valid)).toEqual([true, false, true]);
        expect(curve.points[1]!.target.sum).toBeNaN();
        expect(curve.points[1]!.target.snr).toBe(0);
        const chosen = ringFor(frames, target);
        // A perfectly flat, truncated synthetic sky cannot support an SNR estimate.
        for (const f of frames) {
            indices(target, chosen.ringOut + 2, chosen.ringOut + 6).forEach((offset, i) => {
                f.data[offset] = 3 + (i % 3 - 1) * 1e-4;
            });
        }
        const safe = haloCurve(frames, target, refs, { ...options, ...chosen, skyIn: chosen.ringOut + 2, skyOut: chosen.ringOut + 6 });
        expect(safe.points.every((point) => point.valid)).toBe(true);
        safe.points.forEach((point, i) => {
            expect(Math.abs(point.relative / [0.5, 1, 2][i]! - 1)).toBeLessThan(0.02);
        });
    });

    it('keeps scattered missing ring pixels disconnected from the core', () => {
        const f = frame(0, 1, 2.2);
        const ring = indices(target, 6, 10);
        ring.forEach((offset, i) => { if (i % 10 === 0) { f.data[offset] = NaN; } });
        expect(haloCurve([f], target, refs, { ...options, targetPositionSigmaArcsec: 0 }).points[0]!.valid).toBe(true);
    });

    it('finds blank pixels inside the ring independently of seed', () => {
        const f = frame(0);
        for (let x = target.x + 2; x <= target.x + 6; x++) {
            f.data[target.y * width + x] = NaN;
        }
        expect(haloCurve([f], target, refs, { ...options, seed: 1 }).points[0]!.valid).toBe(false);
        expect(haloCurve([f], target, refs, { ...options, seed: 2 }).points[0]!.valid).toBe(false);
    });

    it('uses lightCurve’s lower default wavelength for even distinct inputs', () => {
        const frames = [1.8, 1.9, 2.1, 2.2].map((lambda, i) => frame(i, 1, 0, target, lambda));
        expect(haloCurve(frames, target, refs, options).lambda).toBe(lightCurve(frames, target, refs, options).lambda);
        expect(haloCurve(frames, target, refs, options).lambda).toBe(1.9);
    });
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
