// Lane: false colour display helper from two infrared wavelengths.
// Pure functions only; runs in the page and in Web Workers (no DOM globals).
import { aperture, centroid, resampleNoiseScale } from './photometry';
import type { ApertureOptions } from './photometry';
import { percentile, stretchValue } from './player';
import type { PixelCoord, Stretch } from './types';

export class FalseColourError extends Error {
    constructor(message: string)
    {
        super(message);
        this.name = 'FalseColourError';
    }
}

// Dark olive, deliberately outside the map's green = (red + blue) / 2 line.
export const NO_COLOUR_HATCH = Object.freeze([24, 40, 20, 255] as const);

export interface PairStretch {
    sShort: Stretch;
    sLong: Stretch;
    range: number;
    sigmaShort: number;
    sigmaLong: number;
}

export interface ColourAt {
    short: number;
    long: number;
    snrShort: number;
    snrLong: number;
    index: number;
    seen: 'both' | 'short' | 'long' | 'neither';
    valid: boolean;
}

const FALSE_COLOUR_NOTE = 'False colour, not what an eye would see. Both pictures share one brightness scale after each '
    + "one's own sky level is taken off: blue means brighter at the shorter wavelength, orange means brighter at the "
    + 'longer one, grey means about the same. Coloured rims around bright stars can come from the two pictures not '
    + 'being equally sharp.';

function channelStats(data: Float32Array, hiPercentile: number): { sky: number; top: number; sigma: number }
{
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
    const sky = percentile(sorted, 50);
    const top = percentile(sorted, hiPercentile) - sky;
    const deviations = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        deviations[i] = Math.abs(sorted[i]! - sky);
    }
    deviations.sort();
    const sigma = 1.4826 * percentile(deviations, 50);
    return { sky, top, sigma };
}

function checkStretch(s: Stretch): void
{
    if (!Number.isFinite(s.lo) || !Number.isFinite(s.hi) || !(s.hi > s.lo)) {
        throw new FalseColourError('Stretch bounds must be finite with hi greater than lo');
    }
}

// Subtracts each picture's own median sky level and gives both pictures one shared brightness range above sky
// (at least `minSigma` times the larger robust noise sigma, and wide enough that `hi > lo` in floating point).
export function pairStretch(
    short: Float32Array,
    long: Float32Array,
    opts?: { hiPercentile?: number; minSigma?: number },
): PairStretch
{
    const hiPercentile = opts?.hiPercentile ?? 99.5;
    const minSigma = opts?.minSigma ?? 10;
    if (!Number.isFinite(hiPercentile) || hiPercentile <= 50 || hiPercentile > 100) {
        throw new FalseColourError('High percentile must be above 50 and at most 100');
    }
    if (!Number.isFinite(minSigma) || minSigma < 0) {
        throw new FalseColourError('Minimum sigma multiple must be zero or positive');
    }
    if (short.length !== long.length) {
        throw new FalseColourError('Short and long pictures must have the same length');
    }
    const stShort = channelStats(short, hiPercentile);
    const stLong = channelStats(long, hiPercentile);
    let range = Math.max(stShort.top, stLong.top, minSigma * Math.max(stShort.sigma, stLong.sigma));
    if (!(range > 0)) {
        range = Math.max(1, Math.abs(stShort.sky), Math.abs(stLong.sky)) * 1e-3;
    }
    for (let i = 0; i < 1100 && (!(stShort.sky + range > stShort.sky) || !(stLong.sky + range > stLong.sky)); i++) {
        range *= 2;
    }
    return {
        sShort: { lo: stShort.sky, hi: stShort.sky + range, kind: 'asinh' },
        sLong: { lo: stLong.sky, hi: stLong.sky + range, kind: 'asinh' },
        range,
        sigmaShort: stShort.sigma,
        sigmaLong: stLong.sigma,
    };
}

// RGBA pixels: blue for short, orange for long, grey where equal, transparent gaps between hatch lines.
export function falseColourRgba(
    short: Float32Array,
    long: Float32Array,
    sShort: Stretch,
    sLong: Stretch,
    out: Uint8ClampedArray | undefined,
    width: number,
): Uint8ClampedArray
{
    if (short.length !== long.length) {
        throw new FalseColourError('Short and long pictures must have the same length');
    }
    checkStretch(sShort);
    checkStretch(sLong);
    const px = out ?? new Uint8ClampedArray(short.length * 4);
    if (px.length !== short.length * 4) {
        throw new FalseColourError('Output buffer length must be four times the pixel count');
    }
    for (let i = 0; i < short.length; i++) {
        const vs = short[i];
        const vl = long[i];
        const o = i * 4;
        if (vs === undefined || vl === undefined || !Number.isFinite(vs) || !Number.isFinite(vl)) {
            const x = i % width;
            const y = Math.floor(i / width);
            px.set((x + y) % 4 === 0 ? NO_COLOUR_HATCH : [0, 0, 0, 0], o);
            continue;
        }
        // The same pre-curve position for linear and asinh stretches; leave the unsaturated path byte-identical.
        const ts = Math.max(0, (vs - sShort.lo) / (sShort.hi - sShort.lo));
        const tl = Math.max(0, (vl - sLong.lo) / (sLong.hi - sLong.lo));
        const scale = Math.max(ts, tl);
        const s = scale > 1 ? stretchValue(ts / scale, { lo: 0, hi: 1, kind: sShort.kind }) : stretchValue(vs, sShort);
        const l = scale > 1 ? stretchValue(tl / scale, { lo: 0, hi: 1, kind: sLong.kind }) : stretchValue(vl, sLong);
        px[o] = 255 * l;
        px[o + 1] = 255 * (s + l) / 2;
        px[o + 2] = 255 * s;
        px[o + 3] = 255;
    }
    return px;
}

// Measures background-subtracted aperture sums and signal-to-noise at `at`, reporting a colour ratio only when both
// pictures see the source. A source is seen only at or above `minSnr` with a valid positive sum; a patch with no
// measurable noise has `snr = 0` and is not seen (with `minSnr: 0` a valid positive sum is still seen since `0 >= 0`).
// The signal-to-noise includes the resampling noise scale for `pixelArcsec` unless `noiseScale` overrides it.
// `radius`, `annulusIn` and `annulusOut` are in output pixels, so a caller on a finer grid must scale them to keep
// the same size on the sky.
export function colourAt(
    short: Float32Array,
    long: Float32Array,
    width: number,
    height: number,
    at: PixelCoord,
    opts: {
        pixelArcsec: number;
        noiseScale?: number;
        radius?: number;
        annulusIn?: number;
        annulusOut?: number;
        minSnr?: number;
    },
): ColourAt
{
    if (!Number.isFinite(opts.pixelArcsec) || opts.pixelArcsec <= 0) {
        throw new FalseColourError('Pixel size must be finite and positive');
    }
    if (opts.noiseScale !== undefined && (!Number.isFinite(opts.noiseScale) || opts.noiseScale < 1)) {
        throw new FalseColourError('Noise scale must be finite and at least 1');
    }
    const minSnr = opts.minSnr ?? 3;
    if (!Number.isFinite(minSnr) || minSnr < 0) {
        throw new FalseColourError('Minimum signal-to-noise ratio must be zero or positive');
    }
    const noiseScale = opts.noiseScale ?? resampleNoiseScale(opts.pixelArcsec);
    const apOpts: ApertureOptions = {
        radius: opts.radius,
        annulusIn: opts.annulusIn,
        annulusOut: opts.annulusOut,
        noiseScale,
    };
    const apShort = aperture(short, width, height, at, apOpts);
    const apLong = aperture(long, width, height, at, apOpts);
    const s = apShort.valid ? Math.max(0, apShort.sum) : Number.NaN;
    const l = apLong.valid ? Math.max(0, apLong.sum) : Number.NaN;
    const snrShort = apShort.valid ? apShort.snr : 0;
    const snrLong = apLong.valid ? apLong.snr : 0;
    const seenShort = apShort.valid && apShort.sum > 0 && apShort.snr >= minSnr;
    const seenLong = apLong.valid && apLong.sum > 0 && apLong.snr >= minSnr;

    if (seenShort && seenLong) {
        return {
            short: s,
            long: l,
            snrShort,
            snrLong,
            index: (l - s) / (l + s),
            seen: 'both',
            valid: true,
        };
    }
    return {
        short: s,
        long: l,
        snrShort,
        snrLong,
        index: Number.NaN,
        seen: seenShort ? 'short' : (seenLong ? 'long' : 'neither'),
        valid: false,
    };
}

// Measures how far apart the centroid near `at` (within a `2 * half + 1` box) sits between the short and long pictures.
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

// Fixed legend wording with wavelengths formatted to 2 decimal places and the shared-scale note.
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
