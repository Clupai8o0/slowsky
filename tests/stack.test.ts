import { describe, expect, it } from 'vitest';
import type { Detector, FrameRecord, OutputGrid, RegriddedFrame } from '../src/lib/types';
import {
    StackError, add, groupByVisit, stackVisit, subtract, symmetricRange,
    type StackResult,
} from '../src/lib/stack';

function mulberry32(seed: number): () => number
{
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function gauss(rng: () => number): number
{
    const u = Math.max(rng(), 1e-12);
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mkGrid(w: number, h = w): OutputGrid
{
    return { center: { ra: 10, dec: -20 }, fovDeg: 0.1, pixelArcsec: 6.15, width: w, height: h };
}

interface FrameOpts {
    detector?: Detector;
    tMin?: number;
    pipelineVersion?: string;
    grid?: OutputGrid;
    variance?: Float32Array;
}

function mkFrame(data: Float32Array, o: FrameOpts = {}): RegriddedFrame
{
    const grid = o.grid ?? mkGrid(Math.round(Math.sqrt(data.length)));
    const frame = {
        obsId: 'test',
        detector: o.detector ?? 1,
        tMin: o.tMin ?? 60000,
        tMax: (o.tMin ?? 60000) + 0.001,
        pipelineVersion: o.pipelineVersion,
    } as FrameRecord;
    return { frame, grid, data, variance: o.variance, lambdaAtCenter: 1, bandwidthAtCenter: 0.01 };
}

function noise(size: number, sigma: number, rng: () => number): Float32Array
{
    const a = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        a[i] = sigma * gauss(rng);
    }
    return a;
}

function addStar(img: Float32Array, w: number, cx: number, cy: number, amp: number, s = 1.2): void
{
    for (let y = 0; y < img.length / w; y++) {
        for (let x = 0; x < w; x++) {
            const r2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            img[y * w + x]! += amp * Math.exp(-r2 / (2 * s * s));
        }
    }
}

function median(a: ArrayLike<number>): number
{
    const s = Array.from(a).filter((v) => Number.isFinite(v)).sort((p, q) => p - q);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : 0.5 * (s[m - 1]! + s[m]!);
}

function std(a: ArrayLike<number>): number
{
    const v = Array.from(a);
    const mean = v.reduce((p, q) => p + q, 0) / v.length;
    return Math.sqrt(v.reduce((p, q) => p + (q - mean) * (q - mean), 0) / v.length);
}

function boxSum(img: Float32Array, w: number, cx: number, cy: number): number
{
    let s = 0;
    for (let y = cy - 3; y <= cy + 3; y++) {
        for (let x = cx - 3; x <= cx + 3; x++) {
            s += img[y * w + x]!;
        }
    }
    return s;
}

describe('stackVisit', () => {
    it('keeps clipped image and counts byte identical with variance', () => {
        const frames = [-100, 1, -1, 0, 0.5].map((v, i) => mkFrame(new Float32Array([v]), {
            variance: new Float32Array([[1000, 3, 6, 9, 12][i]!]),
        }));
        const options = { background: 'none' as const, clipSigma: 4 };
        const result = stackVisit(frames, options);
        const without = stackVisit(frames.map(({ variance, ...frame }) => frame), options);
        expect(result.n[0]).toBe(4);
        expect(result.variance![0]).toBe(30 / 16);
        expect(new Uint8Array(result.data.buffer)).toEqual(new Uint8Array(without.data.buffer));
        expect(new Uint8Array(result.n.buffer)).toEqual(new Uint8Array(without.n.buffer));
    });

    it.each([-5, NaN, Infinity, -Infinity])('masks invalid kept variance %s without changing data or counts', (invalid) => {
        const frames = [2, 4].map((v) => mkFrame(new Float32Array([v]), { variance: new Float32Array([invalid]) }));
        const result = stackVisit(frames, { background: 'none' });
        expect(result.variance![0]).toBeNaN();
        expect(result.data[0]).toBe(3);
        expect(result.n[0]).toBe(2);
    });
    it('propagates V/4 for four frames without changing image stacking', () => {
        const frames = [12, 14, 10, 16].map((v) => mkFrame(new Float32Array([v, v + 2, v + 4, v + 6]), {
            variance: new Float32Array([8, 12, 16, 20]),
        }));
        const result = stackVisit(frames);
        expect(result.variance).toEqual(new Float32Array([2, 3, 4, 5]));
        const without = frames.map(({ variance, ...frame }) => frame);
        expect(result.data).toEqual(stackVisit(without).data);
        expect(stackVisit(without).variance).toBeUndefined();
    });

    it('uses only kept frame variances after sorting and clipping at each pixel', () => {
        const frames = [100, 1, -1, 0].map((v) => mkFrame(new Float32Array([v, v === 100 ? 2 : v, 1, 1]), {
            variance: new Float32Array(4).fill(12),
        }));
        const result = stackVisit(frames, { background: 'none' });
        expect(Array.from(result.n)).toEqual([3, 4, 4, 4]);
        expect(result.variance).toEqual(new Float32Array([4, 3, 3, 3]));
        // Different V values expose an incorrect association after value sorting.
        frames[0]!.variance!.fill(1200);
        frames[1]!.variance!.fill(3);
        frames[2]!.variance!.fill(6);
        frames[3]!.variance!.fill(9);
        const different = stackVisit(frames, { background: 'none' });
        expect(different.variance![0]).toBe(2);
        expect(different.variance![1]).toBe(1218 / 16);
        const raw = stackVisit(frames, { background: 'none', clipSigma: Infinity });
        expect(raw.variance![0]).toBe(1218 / 16);
    });

    it('uses finite image coverage and propagates missing kept variance pixels', () => {
        const frames = [0, 1, 2, 3].map(() => mkFrame(new Float32Array([1, NaN, 1, 1]), {
            variance: new Float32Array(4).fill(12),
        }));
        frames[0]!.data[0] = NaN;
        frames[0]!.variance![0] = NaN;
        frames[1]!.variance![2] = NaN;
        const result = stackVisit(frames, { background: 'none' });
        expect(Array.from(result.n)).toEqual([3, 0, 4, 4]);
        expect(result.variance).toEqual(new Float32Array([4, NaN, NaN, 3]));
    });

    it('omits the entire variance map when any frame has no plane', () => {
        const withVariance = mkFrame(new Float32Array(4), { variance: new Float32Array(4).fill(12) });
        const without = mkFrame(new Float32Array(4));
        expect(stackVisit([withVariance, without]).variance).toBeUndefined();
        expect(stackVisit([without, withVariance]).variance).toBeUndefined();
    });

    it('rejects wrong variance lengths with StackError even if another frame has none', () => {
        const bad = mkFrame(new Float32Array(4), { variance: new Float32Array(3) });
        expect(() => stackVisit([bad])).toThrow(StackError);
        expect(() => stackVisit([mkFrame(new Float32Array(4)), bad])).toThrow(StackError);
        expect(() => stackVisit([mkFrame(new Float32Array(3), { grid: mkGrid(2) })])).toThrow(StackError);
    });

    it('identical frames give the frame minus its median, n = frame count', () => {
        const rng = mulberry32(1);
        const base = noise(32 * 32, 1, rng);
        for (let i = 0; i < base.length; i++) {
            base[i]! += 5;
        }
        const frames = [0, 1, 2, 3].map(() => mkFrame(base.slice()));
        const res = stackVisit(frames);
        const med = median(base);
        let maxShift = 0;
        const shift0 = base[0]! - res.data[0]!;
        for (let i = 0; i < base.length; i++) {
            maxShift = Math.max(maxShift, Math.abs(base[i]! - res.data[i]! - shift0));
            expect(res.n[i]!).toBe(4);
        }
        expect(maxShift).toBeLessThan(1e-4);
        expect(Math.abs(shift0 - med)).toBeLessThan(0.1);
    });

    it('handles NaN pixels', () => {
        const rng = mulberry32(2);
        const frames = [0, 1, 2, 3].map(() => mkFrame(noise(16 * 16, 1, rng)));
        frames[0]!.data[10] = NaN;
        frames[1]!.data[10] = NaN;
        for (const f of frames) {
            f.data[20] = NaN;
        }
        const res = stackVisit(frames);
        expect(res.n[10]!).toBe(2);
        expect(Number.isFinite(res.data[10]!)).toBe(true);
        expect(Number.isNaN(res.data[20]!)).toBe(true);
        expect(res.n[20]!).toBe(0);
        expect(res.n[11]!).toBe(4);
    });

    it('rejects an outlier, unless clipping is off', () => {
        const rng = mulberry32(3);
        const w = 16;
        const px = 5 * w + 7;
        const frames = [0, 1, 2, 3, 4].map(() => mkFrame(noise(w * w, 1, rng)));
        frames[2]!.data[px]! += 50;
        const clipped = stackVisit(frames);
        expect(Math.abs(clipped.data[px]!)).toBeLessThan(1.5);
        expect(clipped.n[px]!).toBe(4);
        const raw = stackVisit(frames, { clipSigma: Infinity });
        expect(raw.data[px]!).toBeGreaterThan(5);
        expect(raw.n[px]!).toBe(5);
    });

    it('removes per-frame background offsets and keeps star flux', () => {
        const w = 64;
        const stars: [number, number, number][] = [[16, 16, 100], [40, 20, 80], [30, 46, 120]];
        const clean = new Float32Array(w * w);
        for (const [x, y, a] of stars) {
            addStar(clean, w, x, y, a);
        }
        const rng = mulberry32(4);
        const offsets = [0.3, -0.2, 0];
        const frames = offsets.map((off) => {
            const d = noise(w * w, 0.02, rng);
            for (let i = 0; i < d.length; i++) {
                d[i]! += clean[i]! + off;
            }
            return mkFrame(d);
        });
        const input0 = frames[0]!.data.slice();
        const res = stackVisit(frames);
        expect(Array.from(frames[0]!.data)).toEqual(Array.from(input0));
        const sky: number[] = [];
        for (let y = 0; y < w; y++) {
            for (let x = 0; x < w; x++) {
                if (stars.every(([sx, sy]) => Math.hypot(x - sx, y - sy) > 8)) {
                    sky.push(res.data[y * w + x]!);
                }
            }
        }
        expect(Math.abs(median(sky))).toBeLessThan(0.02);
        for (const [x, y] of stars) {
            const want = boxSum(clean, w, x, y);
            const got = boxSum(res.data, w, x, y);
            expect(Math.abs(got - want) / want).toBeLessThan(0.02);
        }
        const none = stackVisit(frames, { background: 'none' });
        const skyNone: number[] = [];
        for (let y = 0; y < w; y++) {
            for (let x = 0; x < w; x++) {
                if (stars.every(([sx, sy]) => Math.hypot(x - sx, y - sy) > 8)) {
                    skyNone.push(none.data[y * w + x]!);
                }
            }
        }
        const meanOff = (0.3 - 0.2 + 0) / 3;
        expect(Math.abs(median(skyNone) - meanOff)).toBeLessThan(0.03);
    });

    it('averages noise down by about sqrt(9)', () => {
        const rng = mulberry32(5);
        const size = 128 * 128;
        const frames = Array.from({ length: 9 }, () => mkFrame(noise(size, 1, rng)));
        const one = std(frames[0]!.data);
        const stacked = std(stackVisit(frames).data);
        expect(stacked / one).toBeGreaterThan(0.28);
        expect(stacked / one).toBeLessThan(0.40);
    });

    it('throws StackError on bad input', () => {
        const d = () => new Float32Array(16);
        expect(() => stackVisit([])).toThrow(StackError);
        expect(() => stackVisit([mkFrame(d()), mkFrame(d(), { grid: { ...mkGrid(4), pixelArcsec: 7 } })]))
            .toThrow(StackError);
        expect(() => stackVisit([mkFrame(d()), mkFrame(d(), { grid: { ...mkGrid(4), center: { ra: 10.001, dec: -20 } } })]))
            .toThrow(StackError);
        expect(() => stackVisit([mkFrame(d(), { detector: 1 }), mkFrame(d(), { detector: 2 })]))
            .toThrow(StackError);
        expect(() => stackVisit([mkFrame(d(), { pipelineVersion: 'a' }), mkFrame(d(), { pipelineVersion: 'b' })]))
            .toThrow(StackError);
        expect(() => stackVisit([mkFrame(d(), { pipelineVersion: 'a' }), mkFrame(d())])).not.toThrow();
        expect(() => stackVisit([mkFrame(d()), mkFrame(d(), { pipelineVersion: 'b' })])).not.toThrow();
    });

    it('stacks 9 frames of 721x721 in under 1500 ms', () => {
        const rng = mulberry32(6);
        const size = 721 * 721;
        const frames = Array.from({ length: 9 }, () => mkFrame(noise(size, 1, rng)));
        const t0 = performance.now();
        const res = stackVisit(frames);
        const dt = performance.now() - t0;
        expect(res.data.length).toBe(size);
        expect(dt).toBeLessThan(1500);
    });
});

describe('subtract', () => {
    it.each([-5, NaN, Infinity, -Infinity])('masks invalid variance %s without changing data or counts', (invalid) => {
        const a: StackResult = { data: new Float32Array([5]), n: new Uint16Array([3]), variance: new Float32Array([invalid]) };
        const b: StackResult = { data: new Float32Array([2]), n: new Uint16Array([4]), variance: new Float32Array([1]) };
        for (const result of [subtract(a, b), subtract(b, a)]) {
            expect(result.variance![0]).toBeNaN();
            expect(result.n[0]).toBe(3);
        }
        expect(subtract(a, b).data[0]).toBe(3);
        expect(subtract(b, a).data[0]).toBe(-3);
    });
    it('adds visit variances and masks missing data', () => {
        const a: StackResult = {
            data: new Float32Array([5, NaN]), n: new Uint16Array([3, 0]), variance: new Float32Array([2, 7]),
        };
        const b: StackResult = {
            data: new Float32Array([2, 1]), n: new Uint16Array([4, 4]), variance: new Float32Array([6, 3]),
        };
        expect(subtract(a, b).variance).toEqual(new Float32Array([8, NaN]));
        expect(subtract(a, b.data).variance).toBeUndefined();
        expect(subtract(a.data, b).variance).toBeUndefined();
        expect(subtract(a, { data: b.data, n: b.n }).variance).toBeUndefined();
        expect(subtract(a.data, b.data).variance).toBeUndefined();
        expect(() => subtract({ ...a, variance: new Float32Array(1) }, b)).toThrow(StackError);
        expect(() => subtract(a, { ...b, variance: new Float32Array(3) })).toThrow(StackError);
    });

    it('shows a brighter star as a positive peak and nothing else', () => {
        const w = 48;
        const rng = mulberry32(7);
        const mkVisit = (amp: number) => {
            const frames = Array.from({ length: 5 }, () => {
                const d = noise(w * w, 1, rng);
                addStar(d, w, 24, 24, amp, 1.5);
                return mkFrame(d);
            });
            return stackVisit(frames);
        };
        const a = mkVisit(30);
        const b = mkVisit(60);
        const diff = subtract(b, a);
        expect(diff.data[24 * w + 24]!).toBeGreaterThan(15);
        expect(diff.n[24 * w + 24]!).toBe(5);
        const sigma = Math.sqrt(2 / 5);
        for (let y = 0; y < w; y++) {
            for (let x = 0; x < w; x++) {
                if (Math.hypot(x - 24, y - 24) > 8) {
                    expect(Math.abs(diff.data[y * w + x]!)).toBeLessThan(5 * sigma);
                }
            }
        }
    });

    it('spreads NaN, takes the smaller n and accepts bare arrays', () => {
        const a: StackResult = { data: new Float32Array([1, 2, NaN, 4]), n: new Uint16Array([5, 3, 0, 7]) };
        const b: StackResult = { data: new Float32Array([1, NaN, 3, 1]), n: new Uint16Array([2, 0, 4, 9]) };
        const d = subtract(a, b);
        expect(Array.from(d.data)).toEqual([0, NaN, NaN, 3]);
        expect(Array.from(d.n)).toEqual([2, 0, 0, 7]);
        const bare = subtract(new Float32Array([5, NaN, 2]), new Float32Array([1, 1, 2]));
        expect(Array.from(bare.data)).toEqual([4, NaN, 0]);
        expect(Array.from(bare.n)).toEqual([1, 0, 1]);
        const mixed = subtract(a, new Float32Array([1, 1, 1, 1]));
        expect(Array.from(mixed.n)).toEqual([1, 1, 0, 1]);
        expect(() => subtract(new Float32Array(2), new Float32Array(3))).toThrow(StackError);
    });
});

describe('add', () => {
    it.each([-5, NaN, Infinity, -Infinity])('masks invalid contributing variance %s without changing data or counts', (invalid) => {
        const a: StackResult = { data: new Float32Array([2]), n: new Uint16Array([2]), variance: new Float32Array([invalid]) };
        const b: StackResult = { data: new Float32Array([8]), n: new Uint16Array([4]), variance: new Float32Array([1]) };
        for (const result of [add(a, b), add(b, a)]) {
            expect(result.variance![0]).toBeNaN();
            expect(result.data[0]).toBe(6);
            expect(result.n[0]).toBe(6);
        }
        const empty: StackResult = { data: new Float32Array([NaN]), n: new Uint16Array([0]), variance: new Float32Array([1]) };
        expect(add(a, empty).variance![0]).toBeNaN();
        expect(add(empty, a).variance![0]).toBeNaN();
    });
    it('weights variances by squared counts and ignores zero-weight NaNs', () => {
        const a: StackResult = {
            data: new Float32Array([2, NaN, 5, NaN, 6]), n: new Uint16Array([2, 0, 3, 0, 0]),
            variance: new Float32Array([3, NaN, 7, NaN, NaN]),
        };
        const b: StackResult = {
            data: new Float32Array([8, 4, NaN, NaN, 9]), n: new Uint16Array([4, 2, 0, 0, 2]),
            variance: new Float32Array([6, 5, NaN, NaN, 11]),
        };
        expect(add(a, b).variance).toEqual(new Float32Array([(4 * 3 + 16 * 6) / 36, 5, 7, NaN, 11]));
        expect(add(a, { data: b.data, n: b.n }).variance).toBeUndefined();
        expect(add({ data: a.data, n: a.n }, b).variance).toBeUndefined();
        expect(() => add({ ...a, variance: new Float32Array(1) }, b)).toThrow(StackError);
        expect(() => add(a, { ...b, variance: new Float32Array(1) })).toThrow(StackError);
    });

    it('is a weighted mean, falls back to the side with data, and sums n', () => {
        const a: StackResult = { data: new Float32Array([1, 5, 9, NaN]), n: new Uint16Array([1, 0, 3, 0]) };
        const b: StackResult = { data: new Float32Array([4, 7, 2, NaN]), n: new Uint16Array([3, 2, 0, 0]) };
        const r = add(a, b);
        expect(r.data[0]!).toBeCloseTo((1 * 1 + 4 * 3) / 4, 6);
        expect(r.data[1]!).toBe(7);
        expect(r.data[2]!).toBe(9);
        expect(Number.isNaN(r.data[3]!)).toBe(true);
        expect(Array.from(r.n)).toEqual([4, 2, 3, 0]);
        const big = add(
            { data: new Float32Array([1]), n: new Uint16Array([60000]) },
            { data: new Float32Array([1]), n: new Uint16Array([60000]) },
        );
        expect(big.n[0]!).toBe(65535);
    });
});

describe('groupByVisit', () => {
    it('splits on gaps, in time order, whatever the input order', () => {
        const d = new Float32Array(4);
        const t = [60200, 60000, 60002, 60001];
        const visits = groupByVisit(t.map((tMin) => mkFrame(d, { tMin })));
        expect(visits.length).toBe(2);
        expect(visits[0]!.map((f) => f.frame.tMin)).toEqual([60000, 60001, 60002]);
        expect(visits[1]!.map((f) => f.frame.tMin)).toEqual([60200]);
        expect(groupByVisit([])).toEqual([]);
    });
});

describe('symmetricRange', () => {
    it('takes the percentile of |diff| over finite pixels', () => {
        const a = new Float32Array(100);
        for (let i = 0; i < 100; i++) {
            a[i] = (i % 2 ? -1 : 1) * (i + 1);
        }
        expect(symmetricRange(a, 99)).toBe(99);
        expect(symmetricRange(a, 100)).toBe(100);
        expect(symmetricRange(a, 50)).toBe(50);
        const withNaN = new Float32Array([NaN, -3, 1, Infinity]);
        expect(symmetricRange(withNaN, 100)).toBe(3);
        expect(symmetricRange(new Float32Array([NaN, NaN]))).toBe(0);
    });
});
