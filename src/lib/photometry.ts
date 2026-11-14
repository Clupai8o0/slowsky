import type { PixelCoord, RegriddedFrame } from './types';

export interface ApertureOptions {
    radius?: number;
    annulusIn?: number;
    annulusOut?: number;
    noiseScale?: number;
}

export interface ApertureResult {
    valid: boolean;
    sum: number;
    background: number;
    backgroundSigma: number;
    nPix: number;
    nSky: number;
    /** Sky noise only; excludes stellar photon, flat-field and pointing noise, so bright-star SNR is an upper limit. */
    snr: number;
}

export interface LightCurvePoint {
    mjd: number;
    lambda: number;
    target: ApertureResult;
    refSum: number;
    ratio: number;
    relative: number;
    valid: boolean;
}

export interface LightCurve {
    points: LightCurvePoint[];
    dropped: number;
    refScatter: number[];
    lambda: number;
}

export class PhotometryError extends Error {
    constructor(message: string)
    {
        super(message);
        this.name = 'PhotometryError';
    }
}

function median(values: number[]): number
{
    if (values.length === 0) {
        return Number.NaN;
    }
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!;
}

function madSigma(values: number[], center: number): number
{
    return 1.4826 * median(values.map((value) => Math.abs(value - center)));
}

function checkOptions(opts: ApertureOptions): { radius: number; annulusIn: number; annulusOut: number; noiseScale: number }
{
    const radius = opts.radius ?? 10;
    const annulusIn = opts.annulusIn ?? 16;
    const annulusOut = opts.annulusOut ?? 24;
    const noiseScale = opts.noiseScale ?? 1;
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(annulusIn) || annulusIn < radius
        || !Number.isFinite(annulusOut) || annulusOut <= annulusIn) {
        throw new PhotometryError('Require finite radii with 0 < radius <= annulusIn < annulusOut');
    }
    if (!Number.isFinite(noiseScale) || noiseScale < 1) {
        throw new PhotometryError('Noise scale must be finite and at least 1');
    }
    return { radius, annulusIn, annulusOut, noiseScale };
}

/** Whole pixel measurements; invalid sums are NaN and nSky counts the clipped ring. */
export function aperture(
    data: Float32Array,
    width: number,
    height: number,
    at: PixelCoord,
    opts: ApertureOptions = {},
): ApertureResult
{
    const { radius, annulusIn, annulusOut, noiseScale } = checkOptions(opts);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
        return {
            valid: false,
            sum: Number.NaN,
            background: Number.NaN,
            backgroundSigma: Number.NaN,
            nPix: 0,
            nSky: 0,
            snr: 0,
        };
    }
    let valid = true;
    let total = 0;
    let nPix = 0;
    const radius2 = radius * radius;
    for (let y = Math.ceil(at.y - radius); y <= Math.floor(at.y + radius); y++) {
        const dy2 = (y - at.y) ** 2;
        for (let x = Math.ceil(at.x - radius); x <= Math.floor(at.x + radius); x++) {
            if ((x - at.x) ** 2 + dy2 > radius2) {
                continue;
            }
            nPix++;
            const value = data[y * width + x];
            if (x < 0 || x >= width || y < 0 || y >= height || value === undefined || !Number.isFinite(value)) {
                valid = false;
            } else {
                total += value;
            }
        }
    }

    const ring: number[] = [];
    const inner2 = annulusIn * annulusIn;
    const outer2 = annulusOut * annulusOut;
    const xMin = Math.max(0, Math.ceil(at.x - annulusOut));
    const xMax = Math.min(width - 1, Math.floor(at.x + annulusOut));
    const yMin = Math.max(0, Math.ceil(at.y - annulusOut));
    const yMax = Math.min(height - 1, Math.floor(at.y + annulusOut));
    for (let y = yMin; y <= yMax; y++) {
        const dy2 = (y - at.y) ** 2;
        for (let x = xMin; x <= xMax; x++) {
            const distance2 = (x - at.x) ** 2 + dy2;
            if (distance2 < inner2 || distance2 > outer2) {
                continue;
            }
            const value = data[y * width + x];
            if (value !== undefined && Number.isFinite(value)) {
                ring.push(value);
            }
        }
    }
    const nRing = ring.length;
    const initialBackground = median(ring);
    const limit = 3 * madSigma(ring, initialBackground);
    // Compact in place: a zero MAD retains only pixels equal to the median.
    let nSky = 0;
    for (let i = 0; i < ring.length; i++) {
        const value = ring[i]!;
        if (Math.abs(value - initialBackground) <= limit) {
            ring[nSky++] = value;
        }
    }
    ring.length = nSky;
    const background = median(ring);
    const backgroundSigma = madSigma(ring, background);
    valid = valid && nPix > 0 && nRing >= 20;
    const sum = valid ? total - nPix * background : Number.NaN;
    const noise = backgroundSigma * Math.sqrt(nPix * (1 + Math.PI / 2 * nPix / nSky)) * noiseScale;
    const snr = valid && Number.isFinite(noise) && noise > 0 ? sum / noise : 0;
    return { valid, sum, background, backgroundSigma, nPix, nSky, snr };
}

export function centroid(
    data: Float32Array,
    width: number,
    height: number,
    guess: PixelCoord,
    halfWindow = 6,
): PixelCoord | undefined
{
    if (!Number.isFinite(guess.x) || !Number.isFinite(guess.y) || !Number.isInteger(halfWindow) || halfWindow < 0) {
        return undefined;
    }
    let at = { ...guess };
    for (let iteration = 0; iteration < 5; iteration++) {
        const xMin = Math.round(at.x) - halfWindow;
        const xMax = Math.round(at.x) + halfWindow;
        const yMin = Math.round(at.y) - halfWindow;
        const yMax = Math.round(at.y) + halfWindow;
        if (xMin < 0 || yMin < 0 || xMax >= width || yMax >= height) {
            return undefined;
        }
        const values: number[] = [];
        for (let y = yMin; y <= yMax; y++) {
            for (let x = xMin; x <= xMax; x++) {
                const value = data[y * width + x];
                if (value === undefined || !Number.isFinite(value)) {
                    return undefined;
                }
                values.push(value);
            }
        }
        const background = median(values);
        let flux = 0;
        let weightedX = 0;
        let weightedY = 0;
        for (let y = yMin; y <= yMax; y++) {
            for (let x = xMin; x <= xMax; x++) {
                const weight = Math.max(0, data[y * width + x]! - background);
                flux += weight;
                weightedX += x * weight;
                weightedY += y * weight;
            }
        }
        if (flux === 0) {
            return undefined;
        }
        const next = { x: weightedX / flux, y: weightedY / flux };
        const movement = Math.hypot(next.x - at.x, next.y - at.y);
        at = next;
        if (movement < 0.01) {
            break;
        }
    }
    return at;
}

/** Convert a sum in MJy/sr × pixels to Jy using square output pixels. */
export function toJy(sum: number, pixelArcsec: number): number
{
    return sum * 1e6 * pixelArcsec ** 2 * 2.3504430539e-11;
}

const NATIVE_PIXEL_ARCSEC = 6.15;

/** Moving targets receive the index in the original input, before filtering/sorting. */
export function lightCurve(
    frames: RegriddedFrame[],
    target: PixelCoord | ((f: RegriddedFrame, i: number) => PixelCoord),
    refs: PixelCoord[],
    opts: ApertureOptions & { maxDeltaUm?: number; lambda?: number } = {},
): LightCurve
{
    if (refs.length === 0) {
        throw new PhotometryError('At least one reference star is required');
    }
    checkOptions(opts);
    const grid = frames[0]?.grid;
    for (const frame of frames) {
        if (grid && (frame.grid.width !== grid.width || frame.grid.height !== grid.height
            || frame.grid.pixelArcsec !== grid.pixelArcsec)) {
            throw new PhotometryError('All frames must have matching width, height and pixelArcsec');
        }
    }
    const maxDeltaUm = opts.maxDeltaUm ?? 0.02;
    if (!Number.isFinite(maxDeltaUm) || maxDeltaUm < 0 || (opts.lambda !== undefined && !Number.isFinite(opts.lambda))) {
        throw new PhotometryError('Wavelength and nonnegative tolerance must be finite');
    }
    let lambda = opts.lambda;
    if (lambda === undefined) {
        const finite = frames.map((f) => f.lambdaAtCenter).filter((value) => Number.isFinite(value))
            .sort((a, b) => a - b);
        if (finite.length === 0) {
            return { points: [], dropped: frames.length, refScatter: [], lambda: Number.NaN };
        }
        lambda = finite[Math.floor((finite.length - 1) / 2)]!;
    }
    const reference = lambda;
    const kept = frames.map((frame, index) => ({ frame, index }))
        .filter(({ frame }) => Math.abs(frame.lambdaAtCenter - reference) <= maxDeltaUm + 1e-9)
        .sort((a, b) => a.frame.frame.tMin - b.frame.frame.tMin);
    const points: LightCurvePoint[] = [];
    const refRatios: number[][] = refs.length >= 2 ? refs.map(() => []) : [];
    for (const { frame: f, index } of kept) {
        const at = typeof target === 'function' ? target(f, index) : target;
        const apertureOpts = { ...opts, noiseScale: opts.noiseScale ?? Math.max(1, NATIVE_PIXEL_ARCSEC / f.grid.pixelArcsec) };
        const measured = aperture(f.data, f.grid.width, f.grid.height, at, apertureOpts);
        const referenceResults = refs.map((ref) => aperture(f.data, f.grid.width, f.grid.height, ref, apertureOpts));
        const refSum = referenceResults.reduce((sum, ref) => sum + ref.sum, 0);
        const valid = measured.valid && referenceResults.every((ref) => ref.valid) && refSum > 0;
        points.push({
            mjd: (f.frame.tMin + f.frame.tMax) / 2,
            lambda: f.lambdaAtCenter,
            target: measured,
            refSum,
            ratio: valid ? measured.sum / refSum : Number.NaN,
            relative: Number.NaN,
            valid,
        });
        if (valid) {
            for (let i = 0; i < refRatios.length; i++) {
                // Sum the others directly to avoid cancellation for a bright reference.
                let otherSum = 0;
                for (let j = 0; j < referenceResults.length; j++) {
                    if (j !== i) {
                        otherSum += referenceResults[j]!.sum;
                    }
                }
                const ratio = referenceResults[i]!.sum / otherSum;
                if (Number.isFinite(ratio)) {
                    refRatios[i]!.push(ratio);
                }
            }
        }
    }
    const medianRatio = median(points.filter((point) => point.valid).map((point) => point.ratio));
    for (const point of points) {
        if (point.valid && Number.isFinite(medianRatio) && medianRatio !== 0) {
            point.relative = point.ratio / medianRatio;
        }
    }
    const refScatter = refRatios.map((ratios) => {
        const middle = median(ratios);
        if (ratios.length < 2 || !Number.isFinite(middle) || middle === 0) {
            return Number.NaN;
        }
        return Math.sqrt(ratios.reduce((sum, ratio) => sum + (ratio / middle - 1) ** 2, 0) / (ratios.length - 1));
    });
    return { points, dropped: frames.length - kept.length, refScatter, lambda: reference };
}
