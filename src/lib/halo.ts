import type { PixelCoord, RegriddedFrame } from './types';
import { aperture, resampleNoiseScale } from './photometry';
import type { ApertureOptions, ApertureResult, LightCurve, LightCurvePoint } from './photometry';

const NATIVE_PIXEL_ARCSEC = 6.15;
// Radial fill bins are half a native pixel wide; a straight-line fit in radius fills each bin's gaps.
const RING_BIN_NATIVE = 0.5;
// Our own choice for catalogue placement on a regridded frame: allow a quarter native pixel (1 sigma).
const DEFAULT_TARGET_POSITION_SIGMA_ARCSEC = NATIVE_PIXEL_ARCSEC / 4;
// A position term at least half the remaining target noise merits a visible caveat.
const SIGNIFICANT_POSITION_NOISE_FRACTION = 0.5;

type RingBin = { all: number; finite: number; total: number; sr: number; srr: number; svr: number; mr: number };

export interface HaloCurvePoint extends LightCurvePoint {
    /** Ring measurement: noise includes positionNoise; snr retains the sky-only selection statistic. */
    target: ApertureResult;
    /** RMS change from four position shifts, in target.sum units; 0 when disabled, NaN when unavailable. */
    positionNoise: number;
    /** Propagated target sky/position and comparison sky noise, conditional on the median baseline. */
    relativeNoise: number;
    /** Significant position sensitivity, or the reason a position-error measurement failed. */
    caveats: string[];
}

export interface HaloCurve extends LightCurve {
    points: HaloCurvePoint[];
}

export type HaloCurveOptions = RingOptions & ApertureOptions & WavelengthOptions & {
    seed?: number;
    /** Minimum ring sky-only SNR; finite and >= 1, default 3 (our own choice for the sky-only statistic). */
    minSnr?: number;
    /** Target position 1-sigma uncertainty in arcsec; default 1.5375 (our own choice); 0 disables it. */
    targetPositionSigmaArcsec?: number;
};

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
    binWidth?: number;
    /** Multiplier on sky noise; defaults to 1 here and the grid's resampling scale in haloCurve. */
    noiseScale?: number;
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
): { radius: number; reach: number; pixels: number; touchesLimit: boolean }
{
    return blankSearch(data, width, height, at, opts, false);
}

function blankSearch(
    data: Float32Array, width: number, height: number, at: PixelCoord,
    opts: BlankOptions, exclusiveSeed: boolean,
): { radius: number; reach: number; pixels: number; touchesLimit: boolean }
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
        return { radius: 0, reach: 0, pixels: 0, touchesLimit: false };
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
            const distance = Math.hypot(x - at.x, y - at.y);
            if (exclusiveSeed ? distance < seed : distance <= seed) {
                enqueue(x, y);
            }
        }
    }
    let reach = 0;
    let touchesLimit = false;
    for (let i = 0; i < queue.length; i++) {
        const offset = queue[i]!;
        const x = xMin + offset % localWidth;
        const y = yMin + Math.floor(offset / localWidth);
        reach = Math.max(reach, Math.hypot(x - at.x, y - at.y));
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
            touchesLimit = true;
        }
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height
                    && Math.hypot(nx - at.x, ny - at.y) > maxRadius
                    && !Number.isFinite(data[ny * width + nx]!)) {
                    touchesLimit = true;
                }
                enqueue(x + dx, y + dy);
            }
        }
    }
    return { radius: queue.length ? reach + Math.SQRT1_2 : 0, reach, pixels: queue.length, touchesLimit };
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
    const binWidth = opts.binWidth ?? ringOut - ringIn;
    const noiseScale = opts.noiseScale ?? 1;
    if (!Number.isFinite(ringIn) || ringIn <= 0 || !Number.isFinite(ringOut) || ringOut <= ringIn
        || !Number.isFinite(skyIn) || skyIn < ringOut || !Number.isFinite(skyOut) || skyOut <= skyIn
        || !Number.isFinite(minFraction) || minFraction <= 0 || minFraction > 1
        || !Number.isFinite(binWidth) || binWidth <= 0) {
        throw new HaloError('Require finite ordered ring/sky radii and 0 < minFraction <= 1');
    }
    if (!Number.isFinite(noiseScale) || noiseScale < 1) {
        throw new HaloError('Noise scale must be finite and at least 1');
    }
    return { ringIn, ringOut, skyIn, skyOut, minFraction, binWidth, noiseScale };
}

function ringContained(width: number, height: number, at: PixelCoord, ringOut: number): boolean
{
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
        return false;
    }
    const nearestX = Math.round(at.x);
    const nearestY = Math.round(at.y);
    return Math.hypot(Math.min(-1, nearestX) - at.x, nearestY - at.y) >= ringOut
        && Math.hypot(Math.max(width, nearestX) - at.x, nearestY - at.y) >= ringOut
        && Math.hypot(nearestX - at.x, Math.min(-1, nearestY) - at.y) >= ringOut
        && Math.hypot(nearestX - at.x, Math.max(height, nearestY) - at.y) >= ringOut;
}

// A bin's finite pixels plus its missing ones, read off a least-squares line of value against radius.
function binSum(bin: RingBin): number
{
    const missing = bin.all - bin.finite;
    const meanR = bin.sr / bin.finite;
    const meanV = bin.total / bin.finite;
    const spread = bin.srr - bin.finite * meanR * meanR;
    const slope = missing > 0 ? (bin.svr - bin.finite * meanR * meanV) / spread : 0;
    return bin.total + missing * meanV + slope * (bin.mr - missing * meanR);
}

function canFillBin(bin: RingBin, binWidth: number): boolean
{
    if (bin.all === bin.finite) {
        return true;
    }
    // Fit only with >= 8 real pixels and a radius standard deviation >= 10% of the bin width.
    const spread = bin.srr / bin.finite - (bin.sr / bin.finite) ** 2;
    return bin.finite >= 8 && spread > 0 && spread >= (0.1 * binWidth) ** 2;
}

function binNoisePixels(bin: RingBin): number
{
    if (bin.all === bin.finite) {
        return bin.all;
    }
    const meanR = bin.sr / bin.finite;
    const spread = bin.srr - bin.finite * meanR * meanR;
    const missingRadius = bin.mr - (bin.all - bin.finite) * meanR;
    // Sum of squared linear-fit weights, including the leverage of the missing radii.
    return bin.all ** 2 / bin.finite + missingRadius ** 2 / spread;
}

// True when a blank area that starts inside ringIn reaches the ring's pixel footprints.
function blankInRing(f: RegriddedFrame, at: PixelCoord, ringIn: number, ringOut: number): boolean
{
    const blank = blankSearch(f.data, f.grid.width, f.grid.height, at, { seed: ringIn, maxRadius: ringOut }, true);
    return blank.touchesLimit || (blank.pixels > 0 && blank.reach + Math.SQRT1_2 >= ringIn);
}

// Measures the ring alone; haloCurve checks whether the blank middle reaches it.
export function ringAperture(
    data: Float32Array,
    width: number,
    height: number,
    at: PixelCoord,
    opts: RingOptions,
): ApertureResult
{
    const { ringIn, ringOut, skyIn, skyOut, minFraction, binWidth, noiseScale } = checkRingOptions(opts);
    checkImage(data, width, height);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
        return {
            valid: false, sum: Number.NaN, background: Number.NaN, backgroundSigma: Number.NaN,
            nPix: 0, nSky: 0, noise: Number.NaN, snr: 0,
        };
    }
    let allRing = 0;
    let nPix = 0;
    const bins = new Map<number, RingBin>();
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
                const binIndex = Math.floor((distance - ringIn) / binWidth);
                const bin = bins.get(binIndex) ?? { all: 0, finite: 0, total: 0, sr: 0, srr: 0, svr: 0, mr: 0 };
                bin.all++;
                if (Number.isFinite(value)) {
                    bin.total += value;
                    bin.finite++;
                    bin.sr += distance;
                    bin.srr += distance * distance;
                    bin.svr += value * distance;
                    nPix++;
                } else {
                    bin.mr += distance;
                }
                bins.set(binIndex, bin);
            } else if (distance >= skyIn && distance < skyOut && Number.isFinite(value)) {
                sky.push(value);
            }
        }
    }
    const background = median(sky);
    const backgroundSigma = 1.4826 * median(sky.map((value) => Math.abs(value - background)));
    const valid = ringContained(width, height, at, ringOut) && allRing > 0 && sky.length >= 8
        && [...bins.values()].every((bin) => bin.finite / bin.all >= minFraction && canFillBin(bin, binWidth));
    const sum = valid ? [...bins.values()].reduce((total, bin) => total + binSum(bin), 0)
        - background * allRing : Number.NaN;
    // The sky median is shared by every ring pixel, just as in aperture().
    const noisePixels = valid ? [...bins.values()].reduce((total, bin) => total + binNoisePixels(bin), 0) : Number.NaN;
    const noise = backgroundSigma * Math.sqrt(noisePixels + Math.PI / 2 * allRing ** 2 / sky.length) * noiseScale;
    const snr = valid && Number.isFinite(noise) && noise > 0 ? sum / noise : 0;
    return { valid, sum, background, backgroundSigma, nPix, nSky: sky.length, noise, snr };
}

type WavelengthOptions = { lambda?: number; maxDeltaUm?: number };

function selectFrames(frames: RegriddedFrame[], opts: WavelengthOptions): {
    lambda: number; kept: { frame: RegriddedFrame; index: number }[];
}
{
    const maxDeltaUm = opts.maxDeltaUm ?? 0.02;
    if (!Number.isFinite(maxDeltaUm) || maxDeltaUm < 0 || (opts.lambda !== undefined && !Number.isFinite(opts.lambda))) {
        throw new HaloError('Wavelength and nonnegative tolerance must be finite');
    }
    const finite = frames.map((f) => f.lambdaAtCenter).filter(Number.isFinite).sort((a, b) => a - b);
    const lambda = opts.lambda ?? finite[Math.floor((finite.length - 1) / 2)] ?? Number.NaN;
    const kept = frames.map((frame, index) => ({ frame, index }))
        .filter(({ frame }) => Math.abs(frame.lambdaAtCenter - lambda) <= maxDeltaUm + 1e-9)
        .sort((a, b) => a.frame.frame.tMin - b.frame.frame.tMin);
    return { lambda, kept };
}

function checkFrames(frames: RegriddedFrame[]): void
{
    const grid = frames[0]?.grid;
    for (const f of frames) {
        if (!Number.isFinite(f.grid.pixelArcsec) || f.grid.pixelArcsec <= 0) {
            throw new HaloError('Pixel size must be finite and positive');
        }
        if (grid && (f.grid.width !== grid.width || f.grid.height !== grid.height
            || f.grid.pixelArcsec !== grid.pixelArcsec)) {
            throw new HaloError('All frames must have matching width, height and pixelArcsec');
        }
        checkImage(f.data, f.grid.width, f.grid.height);
        if (!Number.isFinite(f.frame.tMin) || !Number.isFinite(f.frame.tMax)) {
            throw new HaloError('Frame times must be finite');
        }
        if (f.frame.tMax < f.frame.tMin) {
            throw new HaloError('Frame end must not be before its start');
        }
    }
}

export function ringFor(
    frames: RegriddedFrame[],
    target: PixelCoord | ((f: RegriddedFrame, i: number) => PixelCoord),
    opts: BlankOptions & WavelengthOptions & { margin?: number; thickness?: number } = {},
): { ringIn: number; ringOut: number }
{
    checkFrames(frames);
    if (frames.length === 0) {
        throw new HaloError('No frames given');
    }
    const pixelArcsec = frames[0]!.grid.pixelArcsec;
    const native = NATIVE_PIXEL_ARCSEC / pixelArcsec;
    const margin = opts.margin ?? 2 * native;
    const thickness = opts.thickness ?? 3 * native;
    const blankOpts = { seed: opts.seed, maxRadius: opts.maxRadius ?? Math.max(opts.seed ?? 1.5, 6 * native) };
    checkBlankOptions(blankOpts);
    if (!Number.isFinite(margin) || margin <= 0 || !Number.isFinite(thickness) || thickness <= 0) {
        throw new HaloError('Require a finite positive margin and positive thickness');
    }
    let largest = 0;
    const selected = selectFrames(frames, opts).kept;
    if (selected.length === 0) {
        throw new HaloError('No frame at this wavelength');
    }
    const locations: { frame: RegriddedFrame; at: PixelCoord }[] = [];
    selected.forEach(({ frame: f, index: i }) => {
        const at = typeof target === 'function' ? target(f, i) : target;
        if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
            return;
        }
        const blank = blankRadius(f.data, f.grid.width, f.grid.height, at, blankOpts);
        if (blank.touchesLimit) {
            return;
        }
        // Every bounded core sets the margin, even if its frame cannot fit the resulting ring.
        largest = Math.max(largest, blank.radius);
        if (!ringContained(f.grid.width, f.grid.height, at, blank.radius + margin + thickness)) {
            return;
        }
        locations.push({ frame: f, at });
    });
    if (locations.length === 0) {
        throw new HaloError('The ring does not fit in the picture: use a wider view');
    }
    if (largest === 0) {
        throw new HaloError('No frame has a blank centre');
    }
    const ringIn = largest + margin;
    const ringOut = ringIn + thickness;
    checkRingOptions({ ringIn, ringOut });
    const fits = locations.filter(({ frame, at }) => ringContained(frame.grid.width, frame.grid.height, at, ringOut));
    if (fits.length === 0) {
        throw new HaloError('The ring does not fit in the picture: use a wider view');
    }
    if (fits.every(({ frame, at }) => blankInRing(frame, at, ringIn, ringOut))) {
        throw new HaloError('A blank area reaches the ring in every frame');
    }
    return { ringIn, ringOut };
}

function targetRing(f: RegriddedFrame, at: PixelCoord, opts: RingOptions): ApertureResult
{
    const measured = ringAperture(f.data, f.grid.width, f.grid.height, at, opts);
    if (Number.isFinite(at.x) && Number.isFinite(at.y) && blankInRing(f, at, opts.ringIn, opts.ringOut)) {
        measured.valid = false;
        measured.sum = Number.NaN;
        measured.snr = 0;
    }
    return measured;
}

// Mirror lightCurve's private validation, wavelength/order, validity, normalisation and scatter rules; reuse aperture for refs.
export function haloCurve(
    frames: RegriddedFrame[],
    target: PixelCoord | ((f: RegriddedFrame, i: number) => PixelCoord),
    refs: PixelCoord[],
    opts: HaloCurveOptions,
): HaloCurve
{
    checkRingOptions(opts);
    const minSnr = opts.minSnr ?? 3;
    if (!Number.isFinite(minSnr) || minSnr < 1) {
        throw new HaloError('Minimum SNR must be finite and at least 1');
    }
    const positionSigma = opts.targetPositionSigmaArcsec ?? DEFAULT_TARGET_POSITION_SIGMA_ARCSEC;
    if (!Number.isFinite(positionSigma) || positionSigma < 0) {
        throw new HaloError('Target position uncertainty must be finite and nonnegative (arcsec)');
    }
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
    checkFrames(frames);
    checkBlankOptions({ seed: opts.seed, maxRadius: opts.ringOut });
    const { lambda: reference, kept } = selectFrames(frames, opts);
    if (Number.isNaN(reference)) {
        return { points: [], dropped: frames.length, refScatter: [], lambda: Number.NaN };
    }
    const points: HaloCurvePoint[] = [];
    const refRatios: number[][] = refs.length >= 2 ? refs.map(() => []) : [];
    for (const { frame: f, index } of kept) {
        const at = typeof target === 'function' ? target(f, index) : target;
        const noiseScale = opts.noiseScale ?? resampleNoiseScale(f.grid.pixelArcsec);
        const ringOpts = { ...opts, noiseScale, binWidth: RING_BIN_NATIVE * NATIVE_PIXEL_ARCSEC / f.grid.pixelArcsec };
        const measured = targetRing(f, at, ringOpts);
        const caveats: string[] = [];
        let positionNoise = positionSigma === 0 ? 0 : Number.NaN;
        if (measured.valid && positionSigma > 0) {
            const delta = positionSigma / f.grid.pixelArcsec;
            const shifted = [
                { x: at.x + delta, y: at.y }, { x: at.x - delta, y: at.y },
                { x: at.x, y: at.y + delta }, { x: at.x, y: at.y - delta },
            ].map((centre) => targetRing(f, centre, ringOpts));
            // Fail closed: every shift must obey the same containment, core, sky and fill rules.
            if (shifted.some((ring) => !ring.valid || !Number.isFinite(ring.sum))) {
                measured.valid = false;
                measured.sum = Number.NaN;
                measured.noise = Number.NaN;
                measured.snr = 0;
                caveats.push('Position uncertainty cannot be measured: a shifted ring is off the picture, has too few usable pixels, or meets the blank core.');
            } else {
                positionNoise = Math.hypot(...shifted.map((ring) => ring.sum - measured.sum)) / 2;
                if (positionNoise > 0 && positionNoise >= SIGNIFICANT_POSITION_NOISE_FRACTION * measured.noise) {
                    caveats.push('Ring brightness is sensitive to the catalogue position; the error bar includes the stated position uncertainty.');
                }
                // Keep snr as the existing sky-only statistic; add pointing sensitivity only to the error bar.
                measured.noise = Math.hypot(measured.noise, positionNoise);
            }
        }
        const referenceResults = refs.map((ref) => aperture(f.data, f.grid.width, f.grid.height, ref, { ...opts, noiseScale }));
        const refSum = referenceResults.reduce((sum, ref) => sum + ref.sum, 0);
        const ratio = measured.sum / refSum;
        const refNoise = Math.hypot(...referenceResults.map((ref) => ref.noise));
        const ratioNoise = Math.hypot(measured.noise / refSum, ratio * (refNoise / refSum));
        const mjd = f.frame.tMin / 2 + f.frame.tMax / 2;
        const valid = measured.valid && measured.sum > 0 && measured.snr >= minSnr && Number.isFinite(measured.snr)
            && referenceResults.every((ref) => ref.valid && ref.sum > 0 && Number.isFinite(ref.sum))
            && refSum > 0 && Number.isFinite(refSum) && Number.isFinite(ratio)
            && Number.isFinite(ratioNoise) && Number.isFinite(mjd);
        points.push({
            mjd, lambda: f.lambdaAtCenter, target: measured,
            refSum, ratio: valid ? ratio : Number.NaN, relative: Number.NaN, valid,
            // Held in ratio units until the median baseline is available below.
            relativeNoise: valid ? ratioNoise : Number.NaN, positionNoise, caveats,
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
            point.relativeNoise /= medianRatio;
            if (!Number.isFinite(point.relative) || !Number.isFinite(point.relativeNoise)) {
                point.valid = false;
            }
        } else {
            point.valid = false;
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
