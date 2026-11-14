// Lane: false colour display helper from two infrared wavelengths.
// Pure functions only; runs in the page and in Web Workers (no DOM globals).
import { aperture, centroid } from './photometry';
import { percentile, stretchValue } from './player';
import type { PixelCoord, Stretch } from './types';

export class FalseColourError extends Error {
    constructor(message: string)
    {
        super(message);
        this.name = 'FalseColourError';
    }
}

const FALSE_COLOUR_NOTE = 'False colour. The colours show which of two infrared wavelengths is brighter at each spot, '
    + 'not what an eye would see. Each picture is stretched on its own, so compare colours within this view only.';

// A stretch for one picture on its own: lo = the median of its finite values (the sky level),
// hi = its `hiPercentile` (default 99.5) of finite values, kind 'asinh'.
// If hi <= lo (flat picture) return hi = lo + 1 so nothing divides by zero. No finite value: throw.
export function channelStretch(data: Float32Array, opts?: { hiPercentile?: number }): Stretch
{
    const hiPercentile = opts?.hiPercentile ?? 99.5;
    if (!Number.isFinite(hiPercentile) || hiPercentile < 0 || hiPercentile > 100) {
        throw new FalseColourError('High percentile must be between 0 and 100');
    }
    let count = 0;
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v !== undefined && Number.isFinite(v)) {
            count++;
        }
    }
    if (count === 0) {
        throw new FalseColourError('Picture has no finite pixel values');
    }
    const sorted = new Float64Array(count);
    let k = 0;
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v !== undefined && Number.isFinite(v)) {
            sorted[k++] = v;
        }
    }
    sorted.sort();
    const lo = percentile(sorted, 50);
    const rawHi = percentile(sorted, hiPercentile);
    const hi = rawHi <= lo ? lo + 1 : rawHi;
    return { lo, hi, kind: 'asinh' };
}

// RGBA for canvas putImageData.
export function falseColourRgba(
    short: Float32Array,
    long: Float32Array,
    sShort: Stretch,
    sLong: Stretch,
    out?: Uint8ClampedArray,
): Uint8ClampedArray
{
    if (short.length !== long.length) {
        throw new FalseColourError('Short and long pictures must have the same length');
    }
    const px = out ?? new Uint8ClampedArray(short.length * 4);
    if (px.length !== short.length * 4) {
        throw new FalseColourError('Output buffer length must be four times the pixel count');
    }
    for (let i = 0; i < short.length; i++) {
        const vs = short[i]!;
        const vl = long[i]!;
        const o = i * 4;
        if (Number.isNaN(vs) || Number.isNaN(vl)) {
            px[o] = 0;
            px[o + 1] = 0;
            px[o + 2] = 0;
            px[o + 3] = 0;
            continue;
        }
        const s = stretchValue(vs, sShort);
        const l = stretchValue(vl, sLong);
        if (Number.isNaN(s) || Number.isNaN(l)) {
            px[o] = 0;
            px[o + 1] = 0;
            px[o + 2] = 0;
            px[o + 3] = 0;
            continue;
        }
        px[o] = 255 * l;
        px[o + 1] = 255 * (s + l) / 2;
        px[o + 2] = 255 * s;
        px[o + 3] = 255;
    }
    return px;
}

// Which picture is brighter at one spot, from background-subtracted aperture sums.
export function colourAt(
    short: Float32Array,
    long: Float32Array,
    width: number,
    height: number,
    at: PixelCoord,
    opts?: { radius?: number; annulusIn?: number; annulusOut?: number },
): { short: number; long: number; index: number; valid: boolean }
{
    const apShort = aperture(short, width, height, at, opts);
    const apLong = aperture(long, width, height, at, opts);
    if (!apShort.valid || !apLong.valid) {
        return {
            short: apShort.valid ? Math.max(0, apShort.sum) : Number.NaN,
            long: apLong.valid ? Math.max(0, apLong.sum) : Number.NaN,
            index: Number.NaN,
            valid: false,
        };
    }
    const s = Math.max(0, apShort.sum);
    const l = Math.max(0, apLong.sum);
    const total = s + l;
    if (total <= 0) {
        return {
            short: s,
            long: l,
            index: Number.NaN,
            valid: false,
        };
    }
    return {
        short: s,
        long: l,
        index: (l - s) / total,
        valid: true,
    };
}

// How far apart the brightest point near `at` is in the two pictures, in output pixels.
export function centroidOffset(
    short: Float32Array,
    long: Float32Array,
    width: number,
    height: number,
    at: PixelCoord,
    half?: number,
): { dx: number; dy: number; distance: number } | null
{
    const cShort = centroid(short, width, height, at, half);
    const cLong = centroid(long, width, height, at, half);
    if (cShort === undefined || cLong === undefined) {
        return null;
    }
    const dx = cLong.x - cShort.x;
    const dy = cLong.y - cShort.y;
    return {
        dx,
        dy,
        distance: Math.hypot(dx, dy),
    };
}

// Fixed legend wording with wavelengths formatted to 2 decimal places.
export function falseColourLegend(lambdaShort: number, lambdaLong: number): { red: string; blue: string; note: string }
{
    if (!Number.isFinite(lambdaShort) || lambdaShort <= 0
        || !Number.isFinite(lambdaLong) || lambdaLong <= 0
        || lambdaShort >= lambdaLong) {
        throw new FalseColourError('Wavelengths must be finite, positive, and ordered short before long');
    }
    return {
        red: `Orange: ${lambdaLong.toFixed(2)} µm (the longer wavelength)`,
        blue: `Blue: ${lambdaShort.toFixed(2)} µm (the shorter wavelength)`,
        note: FALSE_COLOUR_NOTE,
    };
}
