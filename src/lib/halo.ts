import type { PixelCoord, RegriddedFrame } from './types';
import { aperture } from './photometry';
import type { ApertureOptions, ApertureResult, LightCurve, LightCurvePoint } from './photometry';

export class HaloError extends Error {
    constructor(message: string)
    {
        super(message);
        this.name = 'HaloError';
    }
}

export interface RingOptions {
    ringIn: number;
    ringOut: number;
    skyIn?: number;
    skyOut?: number;
    minFraction?: number;
}

interface BlankOptions {
    seed?: number;
    maxRadius?: number;
}

function checkImage(data: Float32Array, width: number, height: number): void
{
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
        || !Number.isSafeInteger(width * height) || data.length !== width * height) {
        throw new HaloError('Require positive integer dimensions and matching data length');
    }
}

function checkBlankOptions(opts: BlankOptions): { seed: number; maxRadius: number }
{
    const seed = opts.seed ?? 1.5;
    const maxRadius = opts.maxRadius ?? 12;
    if (!Number.isFinite(seed) || seed < 0 || !Number.isFinite(maxRadius) || maxRadius <= 0 || seed > maxRadius) {
        throw new HaloError('Require finite search radii with 0 <= seed <= maxRadius and maxRadius > 0');
    }
    return { seed, maxRadius };
}

export function blankRadius(
    data: Float32Array,
    width: number,
    height: number,
    at: PixelCoord,
    opts: BlankOptions = {},
): { radius: number; pixels: number; touchesLimit: boolean }
{
    checkImage(data, width, height);
    const { seed, maxRadius } = checkBlankOptions(opts);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
        throw new HaloError('Require a finite blank-search centre');
    }
    const xMin = Math.max(0, Math.ceil(at.x - maxRadius));
    const xMax = Math.min(width - 1, Math.floor(at.x + maxRadius));
    const yMin = Math.max(0, Math.ceil(at.y - maxRadius));
    const yMax = Math.min(height - 1, Math.floor(at.y + maxRadius));
    if (xMin > xMax || yMin > yMax) {
        return { radius: 0, pixels: 0, touchesLimit: false };
    }
    const localWidth = xMax - xMin + 1;
    const seen = new Uint8Array(localWidth * (yMax - yMin + 1));
    const queue: number[] = [];
    function enqueue(x: number, y: number): void
    {
        if (x < xMin || x > xMax || y < yMin || y > yMax) {
            return;
        }
        const offset = (y - yMin) * localWidth + x - xMin;
        if (seen[offset]) {
            return;
        }
        seen[offset] = 1;
        if (Math.hypot(x - at.x, y - at.y) <= maxRadius && !Number.isFinite(data[y * width + x]!)) {
            queue.push(offset);
        }
    }
    for (let y = Math.max(yMin, Math.ceil(at.y - seed)); y <= Math.min(yMax, Math.floor(at.y + seed)); y++) {
        for (let x = Math.max(xMin, Math.ceil(at.x - seed)); x <= Math.min(xMax, Math.floor(at.x + seed)); x++) {
            if (Math.hypot(x - at.x, y - at.y) <= seed) {
                enqueue(x, y);
            }
        }
    }
    let radius = 0;
    for (let i = 0; i < queue.length; i++) {
        const offset = queue[i]!;
        const x = xMin + offset % localWidth;
        const y = yMin + Math.floor(offset / localWidth);
        radius = Math.max(radius, Math.hypot(x - at.x, y - at.y) + Math.SQRT1_2);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                enqueue(x + dx, y + dy);
            }
        }
    }
    return { radius, pixels: queue.length, touchesLimit: radius >= maxRadius };
}

// Median-of-medians selection keeps sky statistics linear in the number of pixels.
function select(values: number[], index: number): number
{
    if (values.length <= 5) {
        return values.sort((a, b) => a - b)[index]!;
    }
    const medians: number[] = [];
    for (let i = 0; i < values.length; i += 5) {
        const group = values.slice(i, i + 5).sort((a, b) => a - b);
        medians.push(group[Math.floor(group.length / 2)]!);
    }
    const pivot = select(medians, Math.floor(medians.length / 2));
    const lower: number[] = [];
    const upper: number[] = [];
    let equal = 0;
    for (const value of values) {
        if (value < pivot) {
            lower.push(value);
        } else if (value > pivot) {
            upper.push(value);
        } else {
            equal++;
        }
    }
    if (index < lower.length) {
        return select(lower, index);
    }
    if (index < lower.length + equal) {
        return pivot;
    }
    return select(upper, index - lower.length - equal);
}

function median(values: number[]): number
{
    if (values.length === 0) {
        return Number.NaN;
    }
    const mid = Math.floor(values.length / 2);
    const upper = select(values, mid);
    return values.length % 2 ? upper : (select(values, mid - 1) + upper) / 2;
}

function checkRingOptions(opts: RingOptions): Required<RingOptions>
{
    const { ringIn, ringOut } = opts;
    const skyIn = opts.skyIn ?? ringOut + 2;
    const skyOut = opts.skyOut ?? skyIn + 4;
    const minFraction = opts.minFraction ?? 0.8;
    if (!Number.isFinite(ringIn) || ringIn <= 0 || !Number.isFinite(ringOut) || ringOut <= ringIn
        || !Number.isFinite(skyIn) || skyIn < ringOut || !Number.isFinite(skyOut) || skyOut <= skyIn
        || !Number.isFinite(minFraction) || minFraction <= 0 || minFraction > 1) {
        throw new HaloError('Require finite ordered ring/sky radii and 0 < minFraction <= 1');
    }
    return { ringIn, ringOut, skyIn, skyOut, minFraction };
}

export function ringAperture(
    data: Float32Array,
    width: number,
    height: number,
    at: PixelCoord,
    opts: RingOptions,
): ApertureResult
{
    const { ringIn, ringOut, skyIn, skyOut, minFraction } = checkRingOptions(opts);
    checkImage(data, width, height);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
        return {
            valid: false, sum: Number.NaN, background: Number.NaN, backgroundSigma: Number.NaN,
            nPix: 0, nSky: 0, snr: Number.NaN,
        };
    }
    let allRing = 0;
    let nPix = 0;
    let total = 0;
    const sky: number[] = [];
    const xMin = Math.max(0, Math.ceil(at.x - skyOut));
    const xMax = Math.min(width - 1, Math.floor(at.x + skyOut));
    const yMin = Math.max(0, Math.ceil(at.y - skyOut));
    const yMax = Math.min(height - 1, Math.floor(at.y + skyOut));
    for (let y = yMin; y <= yMax; y++) {
        for (let x = xMin; x <= xMax; x++) {
            const distance = Math.hypot(x - at.x, y - at.y);
            const value = data[y * width + x]!;
            if (distance >= ringIn && distance < ringOut) {
                allRing++;
                if (Number.isFinite(value)) {
                    total += value;
                    nPix++;
                }
            } else if (distance >= skyIn && distance < skyOut && Number.isFinite(value)) {
                sky.push(value);
            }
        }
    }
    const background = median(sky);
    const backgroundSigma = 1.4826 * median(sky.map((value) => Math.abs(value - background)));
    // Pixel footprints span [-0.5, width - 0.5] and [-0.5, height - 0.5].
    const contained = at.x - ringOut >= -0.5 && at.x + ringOut <= width - 0.5
        && at.y - ringOut >= -0.5 && at.y + ringOut <= height - 0.5;
    const valid = contained && allRing > 0 && nPix / allRing >= minFraction && sky.length >= 8;
    const sum = valid ? (total / nPix - background) * allRing : Number.NaN;
    const snr = valid ? (backgroundSigma > 0 ? sum / (backgroundSigma * Math.sqrt(allRing)) : 0) : Number.NaN;
    return { valid, sum, background, backgroundSigma, nPix, nSky: sky.length, snr };
}

export function ringFor(
    frames: RegriddedFrame[],
    target: PixelCoord | ((f: RegriddedFrame, i: number) => PixelCoord),
    opts: BlankOptions & { margin?: number; thickness?: number } = {},
): { ringIn: number; ringOut: number }
{
    checkBlankOptions(opts);
    const pixelArcsec = frames[0]?.grid.pixelArcsec;
    if (pixelArcsec === undefined || !Number.isFinite(pixelArcsec) || pixelArcsec <= 0) {
        throw new HaloError('Require frames with a positive finite pixel scale');
    }
    const native = 6.15 / pixelArcsec;
    const margin = opts.margin ?? native;
    const thickness = opts.thickness ?? 2 * native;
    if (!Number.isFinite(margin) || margin < 0 || !Number.isFinite(thickness) || thickness <= 0) {
        throw new HaloError('Require a finite nonnegative margin and positive thickness');
    }
    let largest = 0;
    frames.forEach((f, i) => {
        const at = typeof target === 'function' ? target(f, i) : target;
        const blank = blankRadius(f.data, f.grid.width, f.grid.height, at, opts);
        if (blank.touchesLimit) {
            throw new HaloError('Blank region reaches the search limit');
        }
        largest = Math.max(largest, blank.radius);
    });
    if (largest === 0) {
        throw new HaloError('No frame has a blank centre');
    }
    const ringIn = largest + margin;
    const ringOut = ringIn + thickness;
    checkRingOptions({ ringIn, ringOut });
    return { ringIn, ringOut };
}

// Mirror lightCurve's private validation, wavelength/order, validity, normalisation and scatter rules; reuse aperture for refs.
export function haloCurve(
    frames: RegriddedFrame[],
    target: PixelCoord | ((f: RegriddedFrame, i: number) => PixelCoord),
    refs: PixelCoord[],
    opts: RingOptions & ApertureOptions & { maxDeltaUm?: number; lambda?: number },
): LightCurve
{
    checkRingOptions(opts);
    if (refs.length === 0) {
        throw new HaloError('At least one reference star is required');
    }
    const radius = opts.radius ?? 10;
    const annulusIn = opts.annulusIn ?? 16;
    const annulusOut = opts.annulusOut ?? 24;
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(annulusIn) || annulusIn < radius
        || !Number.isFinite(annulusOut) || annulusOut <= annulusIn) {
        throw new HaloError('Require finite radii with 0 < radius <= annulusIn < annulusOut');
    }
    const grid = frames[0]?.grid;
    for (const f of frames) {
        checkImage(f.data, f.grid.width, f.grid.height);
        if (grid && (f.grid.width !== grid.width || f.grid.height !== grid.height
            || f.grid.pixelArcsec !== grid.pixelArcsec)) {
            throw new HaloError('All frames must have matching width, height and pixelArcsec');
        }
    }
    const maxDeltaUm = opts.maxDeltaUm ?? 0.02;
    if (!Number.isFinite(maxDeltaUm) || maxDeltaUm < 0 || (opts.lambda !== undefined && !Number.isFinite(opts.lambda))) {
        throw new HaloError('Wavelength and nonnegative tolerance must be finite');
    }
    let lambda = opts.lambda;
    if (lambda === undefined) {
        const finite = frames.map((f) => f.lambdaAtCenter).filter(Number.isFinite).sort((a, b) => a - b);
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
        const measured = ringAperture(f.data, f.grid.width, f.grid.height, at, opts);
        const referenceResults = refs.map((ref) => aperture(f.data, f.grid.width, f.grid.height, ref, opts));
        const refSum = referenceResults.reduce((sum, ref) => sum + ref.sum, 0);
        const valid = measured.valid && referenceResults.every((ref) => ref.valid) && refSum > 0;
        points.push({
            mjd: (f.frame.tMin + f.frame.tMax) / 2, lambda: f.lambdaAtCenter, target: measured,
            refSum, ratio: valid ? measured.sum / refSum : Number.NaN, relative: Number.NaN, valid,
        });
        if (valid) {
            for (let i = 0; i < refRatios.length; i++) {
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
        if (!Number.isFinite(middle) || middle === 0) {
            return Number.NaN;
        }
        return Math.sqrt(ratios.reduce((sum, ratio) => sum + (ratio / middle - 1) ** 2, 0) / ratios.length);
    });
    return { points, dropped: frames.length - kept.length, refScatter, lambda: reference };
}
