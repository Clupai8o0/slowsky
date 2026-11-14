// Stand-in for Stack and Subtract until src/lib/stack.ts lands (v0.2: per-visit stacks with a 4-sigma clip).
// Plain NaN-aware mean and difference of already-locked, regridded frames.
import type { RegriddedFrame } from '../lib/types';

export function meanStack(frames: RegriddedFrame[]): Float32Array
{
    const first = frames[0];
    if (!first) {
        return new Float32Array(0);
    }
    const n = first.data.length;
    const sum = new Float64Array(n);
    const count = new Uint16Array(n);
    for (const f of frames) {
        const d = f.data;
        for (let i = 0; i < n; i++) {
            const v = d[i] as number;
            if (Number.isFinite(v)) {
                sum[i] = (sum[i] as number) + v;
                count[i] = (count[i] as number) + 1;
            }
        }
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const k = count[i] as number;
        out[i] = k ? (sum[i] as number) / k : NaN;
    }
    return out;
}

// later minus earlier; NaN where either is missing.
export function difference(later: Float32Array, earlier: Float32Array): Float32Array
{
    const out = new Float32Array(later.length);
    for (let i = 0; i < later.length; i++) {
        out[i] = (later[i] as number) - (earlier[i] as number);
    }
    return out;
}

export interface DiffScale {
    floor: number; // changes smaller than this are shown black (about 2.5 sigma of the noise)
    limit: number; // full colour at and above this
}

// Colour scale for a difference image. Noise from a robust sigma (median absolute value),
// so pure noise stays dark and only real changes light up.
export function diffScale(data: Float32Array): DiffScale
{
    const vals: number[] = [];
    const stride = Math.max(1, Math.floor(data.length / 100000));
    for (let i = 0; i < data.length; i += stride) {
        const v = data[i] as number;
        if (Number.isFinite(v)) {
            vals.push(Math.abs(v));
        }
    }
    if (!vals.length) {
        return { floor: 0, limit: 1 };
    }
    vals.sort((a, b) => a - b);
    const sigma = 1.4826 * (vals[Math.floor(0.5 * (vals.length - 1))] as number);
    const top = vals[Math.floor(0.999 * (vals.length - 1))] as number;
    const floor = 2.5 * sigma;
    return { floor, limit: Math.max(top, 12 * sigma, floor + 1e-6) };
}

const NEG = [92, 150, 240];
const POS = [243, 152, 58];

// Blue for "was there then" (negative), orange for "is there now" (positive), black for no change.
// Blue and orange stay distinct for the common kinds of colour blindness.
export function renderDiverging(data: Float32Array, scale: DiffScale, out: Uint8ClampedArray): void
{
    const span = scale.limit - scale.floor;
    for (let i = 0; i < data.length; i++) {
        const v = data[i] as number;
        const o = i * 4;
        if (!Number.isFinite(v)) {
            out[o] = 0;
            out[o + 1] = 0;
            out[o + 2] = 0;
            out[o + 3] = 0;
            continue;
        }
        const u = Math.sqrt(Math.max(0, Math.min(1, (Math.abs(v) - scale.floor) / span)));
        const c = v >= 0 ? POS : NEG;
        out[o] = u * (c[0] as number);
        out[o + 1] = u * (c[1] as number);
        out[o + 2] = u * (c[2] as number);
        out[o + 3] = 255;
    }
}
