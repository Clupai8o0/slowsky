// Lane: player logic (Opus glue). Frame timing, the shared stretch and pixel drawing.
// The controls live in src/ui. Runs in the page and in Web Workers (no DOM globals).
import type { PlayerFrame, PlayerState, Stretch } from './types';

export const MAX_FPS = 4;
export const MIN_FPS = 0.5;

// Softness of the asinh curve: bigger shows more faint detail and squeezes bright stars.
const ASINH_SOFTNESS = 10;
// Samples pooled across all frames to pick the stretch; enough for stable percentiles.
const MAX_SAMPLES = 200_000;

export interface StretchOptions {
    loPercentile?: number; // default 0.5
    hiPercentile?: number; // default 99.5
    kind?: Stretch['kind']; // default asinh
}

// One stretch shared by every frame, so a brightness change on screen is a real change in the data.
// Percentiles are taken over the finite pixels of all frames together.
export function sharedStretch(frames: PlayerFrame[], opts: StretchOptions = {}): Stretch
{
    const loP = opts.loPercentile ?? 0.5;
    const hiP = opts.hiPercentile ?? 99.5;
    const kind = opts.kind ?? 'asinh';
    let total = 0;
    for (const f of frames) {
        total += f.frame.data.length;
    }
    const stride = Math.max(1, Math.ceil(total / MAX_SAMPLES));
    const pool: number[] = [];
    for (const f of frames) {
        const d = f.frame.data;
        for (let i = 0; i < d.length; i += stride) {
            const v = d[i] as number;
            if (Number.isFinite(v)) {
                pool.push(v);
            }
        }
    }
    if (pool.length === 0) {
        return { lo: 0, hi: 1, kind };
    }
    const sorted = Float64Array.from(pool).sort();
    const lo = percentile(sorted, loP);
    let hi = percentile(sorted, hiP);
    if (!(hi > lo)) {
        hi = lo + Math.max(Math.abs(lo) * 1e-3, 1e-6);
    }
    return { lo, hi, kind };
}

// Linear interpolation between order statistics; p in [0, 100].
export function percentile(sorted: Float64Array, p: number): number
{
    const n = sorted.length;
    if (n === 0) {
        return NaN;
    }
    const pos = Math.min(Math.max(p, 0), 100) / 100 * (n - 1);
    const i = Math.floor(pos);
    const frac = pos - i;
    const a = sorted[i] as number;
    const b = sorted[Math.min(i + 1, n - 1)] as number;
    return a + (b - a) * frac;
}

// Maps a data value to 0..1 on screen. NaN stays NaN.
export function stretchValue(v: number, s: Stretch): number
{
    if (Number.isNaN(v)) {
        return NaN;
    }
    const t = Math.min(Math.max((v - s.lo) / (s.hi - s.lo), 0), 1);
    if (s.kind === 'linear') {
        return t;
    }
    return Math.asinh(t * ASINH_SOFTNESS) / Math.asinh(ASINH_SOFTNESS);
}

// Grey RGBA pixels for one frame. Pixels with no data (NaN) are fully transparent,
// so the page background shows where the detector did not look.
export function renderRgba(data: Float32Array, s: Stretch, out?: Uint8ClampedArray): Uint8ClampedArray
{
    const px = out ?? new Uint8ClampedArray(data.length * 4);
    if (px.length !== data.length * 4) {
        throw new Error(`renderRgba: output has ${px.length} bytes, needs ${data.length * 4}`);
    }
    const span = s.hi - s.lo;
    const norm = 255 / Math.asinh(ASINH_SOFTNESS);
    for (let i = 0; i < data.length; i++) {
        const v = data[i] as number;
        const o = i * 4;
        if (Number.isNaN(v)) {
            px[o] = 0;
            px[o + 1] = 0;
            px[o + 2] = 0;
            px[o + 3] = 0;
            continue;
        }
        let t = (v - s.lo) / span;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const g = s.kind === 'linear' ? t * 255 : Math.asinh(t * ASINH_SOFTNESS) * norm;
        px[o] = g;
        px[o + 1] = g;
        px[o + 2] = g;
        px[o + 3] = 255;
    }
    return px;
}

// The minimal canvas surface drawFrame needs; both CanvasRenderingContext2D and
// OffscreenCanvasRenderingContext2D satisfy it.
export interface PixelSurface {
    createImageData(width: number, height: number): ImageData;
    putImageData(image: ImageData, dx: number, dy: number): void;
}

// Draws one regridded frame at 1 output pixel per canvas pixel, top-left at (0, 0).
// The UI scales the canvas up with CSS (image-rendering: pixelated) so 1 SPHEREx pixel
// covers several screen pixels.
export function drawFrame(ctx: PixelSurface, f: PlayerFrame, s: Stretch): void
{
    const { width, height } = f.frame.grid;
    if (f.frame.data.length !== width * height) {
        throw new Error(`drawFrame: data has ${f.frame.data.length} values, grid is ${width}x${height}`);
    }
    const img = ctx.createImageData(width, height);
    renderRgba(f.frame.data, s, img.data);
    ctx.putImageData(img, 0, 0);
}

// ---------- timing ----------

export function clampFps(fps: number): number
{
    if (!Number.isFinite(fps)) {
        return 1;
    }
    return Math.min(Math.max(fps, MIN_FPS), MAX_FPS);
}

// The player starts paused on load (no surprise motion), on the first frame.
export function initialState(stretch: Stretch, fps = 2): PlayerState
{
    return { index: 0, playing: false, fps: clampFps(fps), stretch };
}

// Next index when stepping by dir (+1 or -1), wrapping around n frames.
export function stepIndex(index: number, n: number, dir: number): number
{
    if (n <= 0) {
        return 0;
    }
    const k = Math.trunc(dir) || 1;
    return ((index + k) % n + n) % n;
}

// Milliseconds between frames at the clamped rate.
export function frameDelayMs(fps: number): number
{
    return 1000 / clampFps(fps);
}
