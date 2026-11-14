// Per-visit stacking: combine regridded frames of one visit into one image,
// then add or subtract visits. Pure number crunching, no DOM globals, so it
// runs in a Web Worker.

import type { OutputGrid, RegriddedFrame } from './types';

export class StackError extends Error
{
    constructor(message: string)
    {
        super(message);
        this.name = 'StackError';
    }
}

export interface StackResult {
    data: Float32Array;
    variance?: Float32Array;
    n: Uint16Array;
}

export interface StackOptions {
    clipSigma?: number;
    background?: 'median' | 'none';
}

const MAD_TO_SIGMA = 1.4826;
const MAX_CLIP_ROUNDS = 3;
const CENTRE_TOL_DEG = 1e-9;

function sameGrid(a: OutputGrid, b: OutputGrid): boolean
{
    return a.width === b.width
        && a.height === b.height
        && a.pixelArcsec === b.pixelArcsec
        && Math.abs(a.center.ra - b.center.ra) <= CENTRE_TOL_DEG
        && Math.abs(a.center.dec - b.center.dec) <= CENTRE_TOL_DEG;
}

// Sort the first m entries of buf ascending (insertion sort, no allocation).
function sortHead(buf: Float32Array, m: number, indices?: Uint32Array): void
{
    for (let i = 1; i < m; i++) {
        const v = buf[i]!;
        const index = indices?.[i];
        let j = i - 1;
        while (j >= 0 && buf[j]! > v) {
            buf[j + 1] = buf[j]!;
            if (indices) {
                indices[j + 1] = indices[j]!;
            }
            j--;
        }
        buf[j + 1] = v;
        if (indices) {
            indices[j + 1] = index!;
        }
    }
}

// Median of the first m entries of an already sorted buffer.
function sortedMedian(buf: Float32Array, m: number): number
{
    const mid = m >> 1;
    if (m & 1) {
        return buf[mid]!;
    }
    return 0.5 * (buf[mid - 1]! + buf[mid]!);
}

// Median of a frame's finite pixels after one 3-sigma clip about the median.
function frameBackground(data: Float32Array): number
{
    let count = 0;
    for (let i = 0; i < data.length; i++) {
        if (Number.isFinite(data[i]!)) {
            count++;
        }
    }
    if (count === 0) {
        return 0;
    }
    const vals = new Float32Array(count);
    let k = 0;
    for (let i = 0; i < data.length; i++) {
        if (Number.isFinite(data[i]!)) {
            vals[k++] = data[i]!;
        }
    }
    vals.sort();
    const med = sortedMedian(vals, count);
    const devs = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        devs[i] = Math.abs(vals[i]! - med);
    }
    devs.sort();
    const sigma = MAD_TO_SIGMA * sortedMedian(devs, count);
    if (!(sigma > 0)) {
        return med;
    }
    const lim = 3 * sigma;
    let lo = 0;
    let hi = count;
    while (lo < hi && med - vals[lo]! > lim) {
        lo++;
    }
    while (hi > lo && vals[hi - 1]! - med > lim) {
        hi--;
    }
    if (hi <= lo) {
        return med;
    }
    const m = hi - lo;
    const mid = lo + (m >> 1);
    return (m & 1) ? vals[mid]! : 0.5 * (vals[mid - 1]! + vals[mid]!);
}

export function stackVisit(frames: RegriddedFrame[], opts: StackOptions = {}): StackResult
{
    const clipSigma = opts.clipSigma ?? 4;
    const background = opts.background ?? 'median';

    if (frames.length === 0) {
        throw new StackError('stackVisit: no frames');
    }
    const first = frames[0]!;
    let version: string | undefined = first.frame.pipelineVersion;
    for (let f = 1; f < frames.length; f++) {
        const fr = frames[f]!;
        if (!sameGrid(first.grid, fr.grid)) {
            throw new StackError(`stackVisit: frame ${f} is on a different grid`);
        }
        if (fr.frame.detector !== first.frame.detector) {
            throw new StackError(`stackVisit: frame ${f} is from a different detector`);
        }
        const v = fr.frame.pipelineVersion;
        if (v !== undefined) {
            if (version !== undefined && v !== version) {
                throw new StackError(`stackVisit: mixed pipeline versions ${version} and ${v}`);
            }
            version = v;
        }
    }

    const size = first.grid.width * first.grid.height;
    for (let f = 0; f < frames.length; f++) {
        if (frames[f]!.data.length !== size) {
            throw new StackError(`stackVisit: frame ${f} has ${frames[f]!.data.length} pixels, grid needs ${size}`);
        }
        const variance = frames[f]!.variance;
        if (variance && variance.length !== size) {
            throw new StackError(`stackVisit: frame ${f} variance has ${variance.length} pixels, grid needs ${size}`);
        }
    }

    const nf = frames.length;
    const offsets = new Float64Array(nf);
    if (background === 'median') {
        for (let f = 0; f < nf; f++) {
            offsets[f] = frameBackground(frames[f]!.data);
        }
    }

    const out = new Float32Array(size);
    const counts = new Uint16Array(size);
    const vals = new Float32Array(nf);
    const devs = new Float32Array(nf);
    const arrays = frames.map((fr) => fr.data);
    // No variance buffers or per-pixel variance work unless every frame has V.
    const variances = frames.every((fr) => fr.variance !== undefined) ? frames.map((fr) => fr.variance!) : undefined;
    const variance = variances ? new Float32Array(size) : undefined;
    const indices = variances ? new Uint32Array(nf) : undefined;

    for (let p = 0; p < size; p++) {
        let m = 0;
        for (let f = 0; f < nf; f++) {
            const v = arrays[f]![p]!;
            if (Number.isFinite(v)) {
                if (indices) {
                    indices[m] = f;
                }
                vals[m++] = v - offsets[f]!;
            }
        }
        if (m === 0) {
            out[p] = NaN;
            counts[p] = 0;
            if (variance) {
                variance[p] = NaN;
            }
            continue;
        }
        if (m >= 3 && clipSigma !== Infinity) {
            sortHead(vals, m, indices);
            for (let round = 0; round < MAX_CLIP_ROUNDS && m >= 3; round++) {
                const med = sortedMedian(vals, m);
                for (let i = 0; i < m; i++) {
                    devs[i] = Math.abs(vals[i]! - med);
                }
                sortHead(devs, m);
                const sigma = MAD_TO_SIGMA * sortedMedian(devs, m);
                if (!(sigma > 0)) {
                    break;
                }
                const lim = clipSigma * sigma;
                let w = 0;
                for (let i = 0; i < m; i++) {
                    if (Math.abs(vals[i]! - med) <= lim) {
                        if (indices) {
                            indices[w] = indices[i]!;
                        }
                        vals[w++] = vals[i]!;
                    }
                }
                if (w === m) {
                    break;
                }
                m = w;
            }
        }
        let sum = 0;
        for (let i = 0; i < m; i++) {
            sum += vals[i]!;
        }
        out[p] = sum / m;
        counts[p] = m;
        if (variance && variances && indices) {
            let sumVariance = 0;
            for (let i = 0; i < m; i++) {
                sumVariance += variances[indices[i]!]![p]!;
            }
            variance[p] = m > 0 ? sumVariance / (m * m) : NaN;
        }
    }
    return variance ? { data: out, n: counts, variance } : { data: out, n: counts };
}

function asResult(x: StackResult | Float32Array): StackResult
{
    if (!(x instanceof Float32Array)) {
        return x;
    }
    const n = new Uint16Array(x.length);
    for (let i = 0; i < x.length; i++) {
        n[i] = Number.isFinite(x[i]!) ? 1 : 0;
    }
    return { data: x, n };
}

function checkVarianceLength(result: StackResult, operation: string): void
{
    if (result.variance && result.variance.length !== result.data.length) {
        throw new StackError(`${operation}: variance length differs (${result.variance.length} vs ${result.data.length})`);
    }
}

export function subtract(a: StackResult | Float32Array, b: StackResult | Float32Array): StackResult
{
    const ra = asResult(a);
    const rb = asResult(b);
    if (ra.data.length !== rb.data.length) {
        throw new StackError(`subtract: lengths differ (${ra.data.length} vs ${rb.data.length})`);
    }
    checkVarianceLength(ra, 'subtract');
    checkVarianceLength(rb, 'subtract');
    const len = ra.data.length;
    const data = new Float32Array(len);
    const n = new Uint16Array(len);
    const variance = ra.variance && rb.variance ? new Float32Array(len) : undefined;
    for (let i = 0; i < len; i++) {
        const va = ra.data[i]!;
        const vb = rb.data[i]!;
        if (Number.isFinite(va) && Number.isFinite(vb)) {
            data[i] = va - vb;
            n[i] = Math.min(ra.n[i]!, rb.n[i]!);
            if (variance) {
                variance[i] = ra.variance![i]! + rb.variance![i]!;
            }
        } else {
            data[i] = NaN;
            n[i] = 0;
            if (variance) {
                variance[i] = NaN;
            }
        }
    }
    return variance ? { data, n, variance } : { data, n };
}

export function add(a: StackResult, b: StackResult): StackResult
{
    if (a.data.length !== b.data.length) {
        throw new StackError(`add: lengths differ (${a.data.length} vs ${b.data.length})`);
    }
    checkVarianceLength(a, 'add');
    checkVarianceLength(b, 'add');
    const len = a.data.length;
    const data = new Float32Array(len);
    const n = new Uint16Array(len);
    const variance = a.variance && b.variance ? new Float32Array(len) : undefined;
    for (let i = 0; i < len; i++) {
        const wa = Number.isFinite(a.data[i]!) ? a.n[i]! : 0;
        const wb = Number.isFinite(b.data[i]!) ? b.n[i]! : 0;
        const w = wa + wb;
        if (w === 0) {
            data[i] = NaN;
            n[i] = 0;
            if (variance) {
                variance[i] = NaN;
            }
        } else if (wa === 0) {
            data[i] = b.data[i]!;
            n[i] = Math.min(wb, 65535);
            if (variance) {
                variance[i] = b.variance![i]!;
            }
        } else if (wb === 0) {
            data[i] = a.data[i]!;
            n[i] = Math.min(wa, 65535);
            if (variance) {
                variance[i] = a.variance![i]!;
            }
        } else {
            data[i] = (a.data[i]! * wa + b.data[i]! * wb) / w;
            n[i] = Math.min(w, 65535);
            if (variance) {
                variance[i] = (wa * wa * a.variance![i]! + wb * wb * b.variance![i]!) / (w * w);
            }
        }
    }
    return variance ? { data, n, variance } : { data, n };
}

export function groupByVisit(frames: RegriddedFrame[], gapDays = 10): RegriddedFrame[][]
{
    if (frames.length === 0) {
        return [];
    }
    const sorted = frames.slice().sort((p, q) => p.frame.tMin - q.frame.tMin);
    // A visit spans at most gapDays from its first frame, so daily coverage does not chain into one visit.
    const visits: RegriddedFrame[][] = [[sorted[0]!]];
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.frame.tMin - visits[visits.length - 1]![0]!.frame.tMin > gapDays) {
            visits.push([]);
        }
        visits[visits.length - 1]!.push(sorted[i]!);
    }
    return visits;
}

export function symmetricRange(diff: Float32Array, pct = 99): number
{
    let count = 0;
    for (let i = 0; i < diff.length; i++) {
        if (Number.isFinite(diff[i]!)) {
            count++;
        }
    }
    if (count === 0) {
        return 0;
    }
    const abs = new Float32Array(count);
    let k = 0;
    for (let i = 0; i < diff.length; i++) {
        if (Number.isFinite(diff[i]!)) {
            abs[k++] = Math.abs(diff[i]!);
        }
    }
    abs.sort();
    const idx = Math.min(count - 1, Math.max(0, Math.ceil((pct / 100) * count) - 1));
    return abs[idx]!;
}
