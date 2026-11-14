// Callers must pass stars at both visit dates (join gaia.ts ringsAt results), with the same optional id at each date.
// Gaia coordinates are for 2016; proper motion otherwise moves stars far off.
// Candidate counts are not science numbers. S/N uses background noise only;
// displayed S/N is capped at "S/N > 50".
import { gridPixToSky } from './regrid';
import type { OutputGrid, PixelCoord, RegriddedFrame, SkyCoord } from './types';

export type ChangeKind = 'mover' | 'brightness' | 'unknown';
export type ChangeReading = 'brighter' | 'fainter' | 'laterOnly' | 'earlierOnly' | 'moved' | 'pair' | 'differs';
/** A light-bearing location in output-grid pixels, for checking the corresponding visit. */
export type ChangeEnd = { visit: 'earlier' | 'later'; x: number; y: number; radiusPix: number };
export const MIN_CLIPPED_FRAMES = 3;
const MIN_MOVER_SNR = 10;
export interface StarPix {
    x: number; y: number; id?: string;
    /** Visit at which this catalogue position was evaluated, and whether proper motion was listed. */
    visit?: 'earlier' | 'later'; properMotion?: boolean;
    /** Proper-motion-only position, excluding any parallax correction. */
    motionX?: number; motionY?: number;
}
export interface ChangeCandidate {
    id: string;
    kind: ChangeKind;
    pix: PixelCoord;
    sky: SkyCoord;
    snr: number;
    sign: 1 | -1;
    gaiaMatch: boolean;
    gaiaDistArcsec?: number;
    frames: string[];
    speedArcsecPerHour?: number;
    paDeg?: number;
    track?: { mjd: number; pix: PixelCoord }[];
    /** @deprecated Use sentence. */
    reason: string;
    /** Public wording; optional only for legacy manually constructed candidates. */
    sentence?: string;
    caveat?: string;
    /** @deprecated Use ends. */
    lightEnds?: ChangeEnd[];
    reading?: ChangeReading;
    ends?: ChangeEnd[];
    nearCatalogue?: boolean;
    radiusPix?: number;
}
export type VisitChangeCandidate = ChangeCandidate & {
    sentence: string;
    /** Measured reading and all light-bearing locations, including both members of a pair. */
    reading: ChangeReading;
    ends: ChangeEnd[];
    /** Whether any light-bearing end is within the catalogue match radius. */
    nearCatalogue: boolean;
    /** Sign-bearing visit and the reading aperture on the output grid, in pixels. */
    lightVisit: 'earlier' | 'later'; x: number; y: number; radiusPix: number;
};
export type VisitChangeResult = Omit<ChangeResult, 'candidates'> & {
    candidates: VisitChangeCandidate[];
    visits: { earlier: { obsIds: string[]; mjd: number }; later: { obsIds: string[]; mjd: number } };
};
export interface ChangeResult {
    candidates: ChangeCandidate[];
    rejected: { streaks: number; single: number; edge: number; residual: number };
    // Difference-image noise; NaN when nothing was measured (wavelengths do not match, no frames). Print it only
    // when Number.isFinite(sigma).
    sigma: number;
    threshold: number;
    skipped: { obsId: string; reason: string }[];
    notes: string[];
}
export interface ChangeOptions {
    threshold?: number;
    minAreaArcsec2?: number;
    maxElongation?: number;
    matchArcsec?: number;
    dipoleArcsec?: number;
    edgeArcsec?: number;
    maxDeltaLambda?: number;
    maxCandidates?: number;
    minSpeedArcsecPerHour?: number;
    maxSpeedArcsecPerHour?: number;
    lineTolArcsec?: number;
    minFracChange?: number;
    minShiftArcsec?: number;
    maxSpotsPerFrame?: number;
}

// One visit (a stack or a single frame) on the output grid. `variance` is optional: the per-pixel variance on
// the same grid (e.g. the VARIANCE plane regridded like the image). With it, noise follows the frames' own
// error map (scaled once to the difference's measured scatter); without it, noise comes from the difference
// image alone in 64 arcsec tiles, and a noisy patch smaller than a tile can give false candidates.
export interface VisitImage { data: Float32Array; lambda: number; mjd: number; obsIds: string[]; variance?: Float32Array; }
type Image = VisitImage;
type Settings = Required<ChangeOptions>;
type Blob = { pix: PixelCoord; snr: number; sign: 1 | -1; area: number; edge: boolean; narrow?: boolean; compactUncertain?: boolean };
type Measurement = { z: Float32Array; background: Float32Array; noise: Float32Array; usedErrorMap: boolean;
    sigma: number; k: number; width: number; height: number };
const NATIVE = 6.15;
const PSF_FWHM = 12; // arcsec
const CORE_ARCSEC = PSF_FWHM / 2;
// Registration wobble between visits: the reviews' sweeps go up to 1.4″; it moves a steady pair's light centre too.
const WOBBLE_ARCSEC = 1.5;

function settings(opts: ChangeOptions = {}): Settings
{
    return { threshold: opts.threshold ?? 5, minAreaArcsec2: opts.minAreaArcsec2 ?? 1.5 * NATIVE ** 2,
        maxElongation: opts.maxElongation ?? 3, matchArcsec: opts.matchArcsec ?? 6,
        dipoleArcsec: opts.dipoleArcsec ?? 15, edgeArcsec: opts.edgeArcsec ?? 12,
        maxDeltaLambda: opts.maxDeltaLambda ?? 0.02, maxCandidates: opts.maxCandidates ?? 50,
        minSpeedArcsecPerHour: opts.minSpeedArcsecPerHour ?? 5,
        maxSpeedArcsecPerHour: opts.maxSpeedArcsecPerHour ?? 4000, lineTolArcsec: opts.lineTolArcsec ?? 4,
        minFracChange: opts.minFracChange ?? 0.10, minShiftArcsec: opts.minShiftArcsec ?? 3,
        maxSpotsPerFrame: opts.maxSpotsPerFrame ?? 15 };
}

function validate(data: Float32Array, grid: OutputGrid): void
{
    if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 1 || grid.height < 1
        || !Number.isFinite(grid.pixelArcsec) || grid.pixelArcsec <= 0) {
        throw new Error('Invalid output grid dimensions or pixel scale');
    }
    if (data.length !== grid.width * grid.height) {
        throw new Error('Image data length does not match output grid');
    }
}

function sameGrid(a: OutputGrid, b: OutputGrid): boolean
{
    return a.width === b.width && a.height === b.height && a.pixelArcsec === b.pixelArcsec
        && a.center.ra === b.center.ra && a.center.dec === b.center.dec && a.fovDeg === b.fovDeg;
}

function median(values: number[]): number
{
    if (values.length === 0) {
        return NaN;
    }
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}

function robust(values: number[]): { center: number; sigma: number }
{
    const center = median(values.slice());
    return { center, sigma: 1.4826 * median(values.map((v) => Math.abs(v - center))) };
}

function measure(diff: Float32Array, grid: OutputGrid, varSum?: Float32Array): Measurement
{
    validate(diff, grid);
    if (varSum) {
        validate(varSum, grid);
    }
    const k = Math.max(1, Math.round(NATIVE / grid.pixelArcsec));
    const width = Math.ceil(grid.width / k);
    const height = Math.ceil(grid.height / k);
    const bins = new Float32Array(width * height);
    const all: number[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            let count = 0;
            let valid = true;
            for (let j = y * k; j < Math.min((y + 1) * k, grid.height); j++) {
                for (let i = x * k; i < Math.min((x + 1) * k, grid.width); i++) {
                    const v = diff[j * grid.width + i]!;
                    if (!Number.isFinite(v)) {
                        valid = false;
                    } else {
                        sum += v;
                        count++;
                    }
                }
            }
            const v = valid && count ? sum / count : NaN;
            bins[y * width + x] = v;
            if (Number.isFinite(v)) {
                all.push(v);
            }
        }
    }
    const global = robust(all);
    // Error map from the frames, binned like the difference, then scaled to the measured scatter.
    let errorMap: Float32Array | undefined;
    if (varSum) {
        errorMap = new Float32Array(width * height).fill(NaN);
        const ratios: number[] = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0, count = 0, valid = true;
                for (let j = y * k; j < Math.min((y + 1) * k, grid.height); j++) {
                    for (let i = x * k; i < Math.min((x + 1) * k, grid.width); i++) {
                        const v = varSum[j * grid.width + i]!;
                        if (!Number.isFinite(v) || v <= 0) {
                            valid = false;
                        } else {
                            sum += v;
                            count++;
                        }
                    }
                }
                const b = bins[y * width + x]!;
                if (valid && count && Number.isFinite(b)) {
                    const e = Math.sqrt(sum / count);
                    errorMap[y * width + x] = e;
                    ratios.push((b - global.center) / e);
                }
            }
        }
        const scale = ratios.length >= 50 ? robust(ratios).sigma : NaN;
        if (Number.isFinite(scale) && scale > 0) {
            for (let i = 0; i < errorMap.length; i++) {
                errorMap[i]! *= scale;
            }
        } else {
            errorMap = undefined;
        }
    }
    const tile = Math.max(2, Math.round(64 / (grid.pixelArcsec * k)));
    const tw = Math.ceil(width / tile);
    const th = Math.ceil(height / tile);
    const noises = new Float64Array(tw * th);
    const centers = new Float64Array(tw * th);
    const localSigmas: number[] = [];
    for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
            const values: number[] = [];
            for (let y = ty * tile; y < Math.min((ty + 1) * tile, height); y++) {
                for (let x = tx * tile; x < Math.min((tx + 1) * tile, width); x++) {
                    const v = bins[y * width + x]!;
                    if (Number.isFinite(v)) {
                        values.push(v);
                    }
                }
            }
            const stat = values.length >= 12 ? robust(values) : global;
            noises[ty * tw + tx] = Number.isFinite(stat.sigma) && stat.sigma > 0 ? stat.sigma : global.sigma;
            centers[ty * tw + tx] = Number.isFinite(stat.center) ? stat.center : global.center;
            if (Number.isFinite(noises[ty * tw + tx]!)) {
                localSigmas.push(noises[ty * tw + tx]!);
            }
        }
    }
    const localSigma = median(localSigmas);
    const sigma = localSigma > 0 ? localSigma : NaN;
    // Smooth neighboring MADs without washing a quiet tile into a much noisier
    // one. Similar estimates receive most of the weight; sharp changes remain.
    const smooth = new Float64Array(noises.length);
    for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
            let total = 0, count = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const x = tx + dx, y = ty + dy;
                    if (x >= 0 && x < tw && y >= 0 && y < th && noises[y * tw + x]! > 0) {
                        const value = noises[y * tw + x]!, center = noises[ty * tw + tx]!;
                        const similarity = value > 0 && center > 0
                            ? Math.exp(-2 * Math.abs(Math.log(value / center))) : 1;
                        const w = (2 - Math.abs(dx)) * (2 - Math.abs(dy)) * similarity;
                        total += Math.log(value) * w;
                        count += w;
                    }
                }
            }
            smooth[ty * tw + tx] = count ? Math.exp(total / count) : NaN;
        }
    }
    const logNoise = smooth.map((value) => value > 0 ? Math.log(value) : NaN);
    // A noisy patch smaller than a tile hides inside the tile's median. Look again in a window of about 31″
    // around each binned pixel: estimate the scatter separately from the values below and above the
    // tile's centre and keep the smaller. A star that brightened or faded raises one side only, so it does not
    // count as noise; noise raises both. A window counts only when it is 1.8 times as noisy as its tile (chance
    // alone rarely gets there), and then it raises the noise over the whole window, edges of the patch included.
    const half = Math.max(1, Math.round(31 / (grid.pixelArcsec * k) / 2));
    const tileAt = (x: number, y: number): number => Math.min(th - 1, Math.floor(y / tile)) * tw + Math.min(tw - 1, Math.floor(x / tile));
    const raisedNoise = new Float32Array(bins.length);
    const side = (2 * half + 1) ** 4;
    const below = new Float64Array(side), above = new Float64Array(side);
    const middle = (values: Float64Array, n: number): number => {
        const part = values.subarray(0, n).sort();
        return n % 2 ? part[(n - 1) / 2]! : (part[n / 2 - 1]! + part[n / 2]!) / 2;
    };
    // Quick screen first: the window's mean absolute deviation (a summed-area table) must already be high.
    const sumDev = new Float64Array((width + 1) * (height + 1)), sumCount = new Float64Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const v = bins[y * width + x]!, finite = Number.isFinite(v);
            const at = (y + 1) * (width + 1) + x + 1;
            sumDev[at] = (finite ? Math.abs(v - centers[tileAt(x, y)]!) : 0) + sumDev[at - 1]! + sumDev[at - width - 1]! - sumDev[at - width - 2]!;
            sumCount[at] = (finite ? 1 : 0) + sumCount[at - 1]! + sumCount[at - width - 1]! - sumCount[at - width - 2]!;
        }
    }
    const boxSum = (table: Float64Array, x0: number, y0: number, x1: number, y1: number): number =>
        table[(y1 + 1) * (width + 1) + x1 + 1]! - table[y0 * (width + 1) + x1 + 1]! - table[(y1 + 1) * (width + 1) + x0]! + table[y0 * (width + 1) + x0]!;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const t = tileAt(x, y), center = centers[t]!, tileNoise = smooth[t]!;
            if (!(tileNoise > 0)) {
                continue;
            }
            const x0 = Math.max(0, x - half), y0 = Math.max(0, y - half);
            const x1 = Math.min(width - 1, x + half), y1 = Math.min(height - 1, y + half);
            const n = boxSum(sumCount, x0, y0, x1, y1);
            if (n < 16 || boxSum(sumDev, x0, y0, x1, y1) / n < 1.5 * 0.798 * tileNoise) {
                continue;
            }
            let nb = 0, na = 0;
            for (let j = Math.max(0, y - half); j <= Math.min(height - 1, y + half); j++) {
                for (let i = Math.max(0, x - half); i <= Math.min(width - 1, x + half); i++) {
                    const v = bins[j * width + i]!;
                    // Values past 8 tile sigmas are sources, not noise: leave them out so a bright mover's
                    // two halves do not raise its own noise.
                    if (v < center && center - v < 8 * tileNoise) {
                        below[nb++] = center - v;
                    } else if (v > center && v - center < 8 * tileNoise) {
                        above[na++] = v - center;
                    }
                }
            }
            if (nb < 8 || na < 8) {
                continue;
            }
            const local = 1.4826 * Math.min(middle(below, nb), middle(above, na));
            if (local > 1.8 * tileNoise) {
                for (let j = Math.max(0, y - half); j <= Math.min(height - 1, y + half); j++) {
                    for (let i = Math.max(0, x - half); i <= Math.min(width - 1, x + half); i++) {
                        raisedNoise[j * width + i] = Math.max(raisedNoise[j * width + i]!, local);
                    }
                }
            }
        }
    }
    const raised = (x: number, y: number): number => raisedNoise[y * width + x]!;
    const z = new Float32Array(bins.length), background = new Float32Array(bins.length);
    const noiseMap = new Float32Array(bins.length);
    let usedErrorMap = false;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const fx = Math.max(0, Math.min(tw - 1, (x + 0.5) / tile - 0.5));
            const fy = Math.max(0, Math.min(th - 1, (y + 0.5) / tile - 0.5));
            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            const x1 = Math.min(x0 + 1, tw - 1), y1 = Math.min(y0 + 1, th - 1);
            const interpolate = (arr: Float64Array): number => {
                const base = smooth[Math.floor(y / tile) * tw + Math.floor(x / tile)]!;
                const samples = [
                    { index: y0 * tw + x0, weight: (1 - (fx - x0)) * (1 - (fy - y0)) },
                    { index: y0 * tw + x1, weight: (fx - x0) * (1 - (fy - y0)) },
                    { index: y1 * tw + x0, weight: (1 - (fx - x0)) * (fy - y0) },
                    { index: y1 * tw + x1, weight: (fx - x0) * (fy - y0) },
                ];
                let sum = 0, weight = 0;
                for (const sample of samples) {
                    const n = smooth[sample.index]!, value = arr[sample.index]!;
                    if (sample.weight > 0 && n > 0 && base > 0 && Number.isFinite(value)) {
                        const similarity = Math.min(n / base, base / n) ** 4;
                        const w = sample.weight * similarity;
                        sum += value * w;
                        weight += w;
                    }
                }
                return weight ? sum / weight : NaN;
            };
            const fromFrames = errorMap ? errorMap[y * width + x]! : NaN;
            const noise = Math.max(Math.exp(interpolate(logNoise)), Number.isFinite(fromFrames) ? fromFrames : 0, raised(x, y));
            const value = bins[y * width + x]!;
            noiseMap[y * width + x] = noise;
            if (Number.isFinite(value) && Number.isFinite(fromFrames) && fromFrames > 0) {
                usedErrorMap = true;
            }
            const level = interpolate(centers);
            background[y * width + x] = Number.isFinite(level) ? level : 0;
            z[y * width + x] = Number.isFinite(value) && noise > 0 ? (value - level) / noise : NaN;
        }
    }
    return { z, background, noise: noiseMap, usedErrorMap, sigma, k, width, height };
}

export function significance(diff: Float32Array, grid: OutputGrid): { z: Float32Array; sigma: number; k: number }
{
    const { z, sigma, k } = measure(diff, grid);
    return { z, sigma, k };
}

function difference(earlier: Float32Array, later: Float32Array, grid: OutputGrid): Float32Array
{
    validate(earlier, grid);
    validate(later, grid);
    const out = new Float32Array(earlier.length);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.isFinite(earlier[i]!) && Number.isFinite(later[i]!) ? later[i]! - earlier[i]! : NaN;
    }
    return out;
}

// A sampled 12″ Gaussian places approximately 4 pixel areas / (2 pi sigma²) in its four brightest
// pixels. Require at least three times that share, and 40%, before calling a spot unusually narrow.
function narrowChange(diff: Float32Array, pix: PixelCoord, sign: 1 | -1, grid: OutputGrid): boolean | undefined
{
    const expected = 4 * grid.pixelArcsec ** 2 / (2 * Math.PI * (PSF_FWHM / 2.35482) ** 2);
    if (3 * expected >= 0.8) { return undefined; }
    const values: number[] = [], ring: number[] = [];
    const radius = 24 / grid.pixelArcsec;
    for (let y = Math.floor(pix.y - radius); y <= Math.ceil(pix.y + radius); y++) {
        for (let x = Math.floor(pix.x - radius); x <= Math.ceil(pix.x + radius); x++) {
            const d = Math.hypot(x - pix.x, y - pix.y) * grid.pixelArcsec;
            if (d > 24) { continue; }
            if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) { return undefined; }
            const value = diff[y * grid.width + x]!;
            if (!Number.isFinite(value)) { return undefined; }
            if (d <= PSF_FWHM) { values.push(value); }
            if (d >= 18) { ring.push(value); }
        }
    }
    if (ring.length < 20 || values.length < 5) { return undefined; }
    const background = median(ring);
    const weights = values.map((v) => Math.max(0, sign * (v - background))).sort((a, b) => b - a);
    const total = weights.reduce((a, b) => a + b, 0);
    return total > 0 && weights.slice(0, 4).reduce((a, b) => a + b, 0) / total > Math.max(0.4, 3 * expected);
}

function blobs(diff: Float32Array, grid: OutputGrid, opt: Settings, result: ChangeResult, support = 3.75,
    varSum?: Float32Array, allowNarrow = false): { found: Blob[]; measurement: Measurement }
{
    const m = measure(diff, grid, varSum);
    result.sigma = m.sigma;
    const seen = new Uint8Array(m.z.length);
    const out: Blob[] = [];
    const grow = Math.min(opt.threshold, support);
    const edge = Math.ceil(opt.edgeArcsec / (m.k * grid.pixelArcsec));
    for (let i = 0; i < m.z.length; i++) {
        const value = m.z[i]!;
        if (seen[i] || !Number.isFinite(value) || Math.abs(value) < grow) {
            continue;
        }
        const sign: 1 | -1 = value > 0 ? 1 : -1;
        const queue = [i];
        seen[i] = 1;
        let peak = 0, sx = 0, sy = 0, weight = 0;
        let nearEdge = false;
        for (let q = 0; q < queue.length; q++) {
            const p = queue[q]!, x = p % m.width, y = Math.floor(p / m.width), w = Math.abs(m.z[p]!);
            peak = Math.max(peak, w);
            sx += x * w;
            sy += y * w;
            weight += w;
            if (x < edge || y < edge || x >= m.width - edge || y >= m.height - edge) {
                nearEdge = true;
            }
            if (!nearEdge) {
                const radius = opt.edgeArcsec / grid.pixelArcsec;
                const cx = x * m.k + (m.k - 1) / 2, cy = y * m.k + (m.k - 1) / 2;
                let missing = 0, total = 0;
                for (let py = Math.ceil(cy - radius); py <= Math.floor(cy + radius); py++) {
                    for (let px = Math.ceil(cx - radius); px <= Math.floor(cx + radius); px++) {
                        if (Math.hypot(px - cx, py - cy) <= radius) {
                            total++;
                            if (!Number.isFinite(diff[py * grid.width + px]!)) {
                                missing++;
                            }
                        }
                    }
                }
                nearEdge = missing > 0.1 * total;
            }
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy, ni = ny * m.width + nx;
                    if (nx >= 0 && nx < m.width && ny >= 0 && ny < m.height && !seen[ni]
                        && sign * m.z[ni]! >= grow) {
                        seen[ni] = 1;
                        queue.push(ni);
                    }
                }
            }
        }
        if (peak < opt.threshold) {
            continue;
        }
        const cx = sx / weight, cy = sy / weight;
        const area = queue.reduce((sum, p) => sum + Math.min(m.k, grid.width - (p % m.width) * m.k)
            * Math.min(m.k, grid.height - Math.floor(p / m.width) * m.k), 0) * grid.pixelArcsec ** 2;
        const small = queue.length < 2 || area < opt.minAreaArcsec2;
        const shape = allowNarrow && small
            ? narrowChange(diff, { x: cx * m.k + (m.k - 1) / 2, y: cy * m.k + (m.k - 1) / 2 }, sign, grid) : false;
        // A one-bin peak alone is common in noise. Retain an unresolved compact source only when its
        // four surrounding bins support the same sign; a genuinely narrow hit is handled separately.
        const bx = Math.round(cx), by = Math.round(cy);
        const neighbours = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) =>
            bx + dx! >= 0 && bx + dx! < m.width && by + dy! >= 0 && by + dy! < m.height
                ? sign * m.z[(by + dy!) * m.width + bx + dx!]! : NaN);
        const supported = neighbours.every((z) => z > 0) && neighbours.reduce((a, b) => a + b, 0) >= 1.8 * peak;
        const narrow = shape === true, compactUncertain = allowNarrow && small && !narrow && (supported || peak >= 10);
        if (small && !narrow && !compactUncertain) {
            result.rejected.single++;
            continue;
        }
        let xx = 0, yy = 0, xy = 0;
        for (const p of queue) {
            const dx = p % m.width - cx, dy = Math.floor(p / m.width) - cy, w = Math.abs(m.z[p]!);
            xx += w * dx * dx;
            yy += w * dy * dy;
            xy += w * dx * dy;
        }
        const disc = Math.hypot(xx - yy, 2 * xy);
        const major = (xx + yy + disc) / 2, minor = (xx + yy - disc) / 2;
        if (queue.length >= 3 && Math.sqrt(major / Math.max(minor, weight * 0.02)) > opt.maxElongation) {
            result.rejected.streaks++;
            continue;
        }
        // Refine the binned centroid using the original grid within the component. Only the core (at least
        // half the component's peak) counts: with the whole component, a very bright spot's centre drifts
        // into its wide wings, and the two halves of a bright mover end up too far apart to pair.
        let top = 0;
        for (const p of queue) {
            const bx = p % m.width, by = Math.floor(p / m.width);
            for (let y = by * m.k; y < Math.min((by + 1) * m.k, grid.height); y++) {
                for (let x = bx * m.k; x < Math.min((bx + 1) * m.k, grid.width); x++) {
                    top = Math.max(top, sign * (diff[y * grid.width + x]! - m.background[p]!));
                }
            }
        }
        let fullX = 0, fullY = 0, fullWeight = 0;
        for (const p of queue) {
            const bx = p % m.width, by = Math.floor(p / m.width);
            for (let y = by * m.k; y < Math.min((by + 1) * m.k, grid.height); y++) {
                for (let x = bx * m.k; x < Math.min((bx + 1) * m.k, grid.width); x++) {
                    const w = Math.max(0, sign * (diff[y * grid.width + x]! - m.background[p]!) - 0.5 * top);
                    fullX += x * w;
                    fullY += y * w;
                    fullWeight += w;
                }
            }
        }
        out.push({ pix: fullWeight > 0 ? { x: fullX / fullWeight, y: fullY / fullWeight }
            : { x: cx * m.k + (m.k - 1) / 2, y: cy * m.k + (m.k - 1) / 2 }, snr: peak, sign, area: queue.length, edge: nearEdge, narrow, compactUncertain });
    }
    return { found: out, measurement: m };
}

function distance(a: PixelCoord, b: PixelCoord, grid: OutputGrid): number
{
    return Math.hypot(a.x - b.x, a.y - b.y) * grid.pixelArcsec;
}

function wavelengthsMatch(a: number, b: number, limit: number): boolean
{
    const tolerance = Number.EPSILON * 8 * Math.max(1, Math.abs(a), Math.abs(b));
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= limit + tolerance;
}

function match(p: PixelCoord, stars: StarPix[], grid: OutputGrid, radius: number): number | undefined
{
    let best = Infinity;
    for (const star of stars) {
        if (Number.isFinite(star.x) && Number.isFinite(star.y)) {
            best = Math.min(best, distance(p, star, grid));
        }
    }
    return best <= radius ? best : undefined;
}

function empty(opt: Settings): ChangeResult
{
    return { candidates: [], rejected: { streaks: 0, single: 0, edge: 0, residual: 0 }, sigma: NaN,
        threshold: opt.threshold, skipped: [], notes: [] };
}

// showSnr is false when the noise came from the difference image alone: that estimate leaves out each source's own
// light, so the S/N it gives can be several times too high near anything bright. The value stays in `snr`; only the
// printed text drops it.
function finish(result: ChangeResult, opt: Settings, singleFrame = false, showSnr = true): ChangeResult
{
    result.candidates.sort((a, b) => (singleFrame ? Number(b.gaiaMatch) - Number(a.gaiaMatch) : 0)
        || b.snr - a.snr || a.pix.y - b.pix.y || a.pix.x - b.pix.x);
    const total = result.candidates.length;
    result.candidates = result.candidates.slice(0, Math.max(0, opt.maxCandidates));
    const omitted = total - result.candidates.length;
    if (omitted > 0) {
        result.notes.push(`${omitted} additional ${omitted === 1 ? 'candidate' : 'candidates'} not shown because of the candidate limit.`);
    }
    result.candidates.forEach((c, i) => {
        c.id = `c${i + 1}`;
        c.sentence = showSnr ? c.reason : c.reason.replace(SNR_IN_TEXT, '(candidate)');
        c.reason = c.sentence;
    });
    return result;
}

const SNR_IN_TEXT = /\(S\/N [^;()]*; candidate\)/g;
export const NO_SNR_NOTE = 'Signal-to-noise figures are not shown, because this noise estimate leaves out each source\'s own light.';

export function snrText(snr: number): string
{
    return !Number.isFinite(snr) ? 'S/N not measured' : snr > 50 ? 'S/N > 50' : `S/N ${snr.toFixed(1)}`;
}

function candidate(blob: Blob, grid: OutputGrid, stars: StarPix[], opt: Settings, frames: string[]): ChangeCandidate
{
    const dist = match(blob.pix, stars, grid, opt.matchArcsec);
    const kind: ChangeKind = dist === undefined ? 'unknown' : 'brightness';
    return { id: '', kind, pix: blob.pix, sky: gridPixToSky(grid, blob.pix), snr: blob.snr, sign: blob.sign,
        gaiaMatch: dist !== undefined, ...(dist === undefined ? {} : { gaiaDistArcsec: dist }), frames,
        reason: `The two visits differ here (${snrText(blob.snr)}; candidate).` };
}

function sourceCentroid(data: Float32Array, other: Float32Array, center: PixelCoord, grid: OutputGrid): PixelCoord | undefined
{
    const radius = 12 / grid.pixelArcsec;
    const ring: number[] = [];
    for (let y = Math.max(0, Math.floor(center.y - 3 * radius)); y <= Math.min(grid.height - 1, Math.ceil(center.y + 3 * radius)); y++) {
        for (let x = Math.max(0, Math.floor(center.x - 3 * radius)); x <= Math.min(grid.width - 1, Math.ceil(center.x + 3 * radius)); x++) {
            const d = Math.hypot(x - center.x, y - center.y), v = data[y * grid.width + x]!;
            if (d >= 2 * radius && d <= 3 * radius && Number.isFinite(v)
                && Number.isFinite(other[y * grid.width + x]!)) { ring.push(v); }
        }
    }
    if (ring.length < 20) { return undefined; }
    const background = median(ring);
    let sx = 0, sy = 0, sum = 0;
    for (let y = Math.max(0, Math.floor(center.y - radius)); y <= Math.min(grid.height - 1, Math.ceil(center.y + radius)); y++) {
        for (let x = Math.max(0, Math.floor(center.x - radius)); x <= Math.min(grid.width - 1, Math.ceil(center.x + radius)); x++) {
            if (Math.hypot(x - center.x, y - center.y) > radius) { continue; }
            const value = data[y * grid.width + x]! - background;
            if (Number.isFinite(value) && Number.isFinite(other[y * grid.width + x]!) && value > 0) {
                sx += x * value; sy += y * value; sum += value;
            }
        }
    }
    return sum > 0 ? { x: sx / sum, y: sy / sum } : undefined;
}

// Background-subtracted aperture sums and each visit's noise; undefined when the
// aperture or its 24-36″ ring cannot be measured.
function apertureSums(earlier: Float32Array, later: Float32Array, pix: PixelCoord, grid: OutputGrid,
    apertureArcsec = 12): { sumA: number; sumB: number; noiseA: number; noiseB: number } | undefined
{
    const radius = apertureArcsec / grid.pixelArcsec, ring = 24 / grid.pixelArcsec;
    const ringA: number[] = [], ringB: number[] = [];
    let sumA = 0, sumB = 0, count = 0, total = 0;
    for (let y = Math.ceil(pix.y - 1.5 * ring); y <= Math.floor(pix.y + 1.5 * ring); y++) {
        for (let x = Math.ceil(pix.x - 1.5 * ring); x <= Math.floor(pix.x + 1.5 * ring); x++) {
            const r = Math.hypot(x - pix.x, y - pix.y);
            if (r > 1.5 * ring || (r > radius + 1 && r < ring)) {
                continue;
            }
            let weight = 0;
            if (r <= radius + 1) {
                for (let sy = 0; sy < 4; sy++) {
                    for (let sx = 0; sx < 4; sx++) {
                        if (Math.hypot(x + (sx + 0.5) / 4 - 0.5 - pix.x,
                            y + (sy + 0.5) / 4 - 0.5 - pix.y) <= radius) {
                            weight += 1 / 16;
                        }
                    }
                }
            }
            const inside = x >= 0 && y >= 0 && x < grid.width && y < grid.height;
            const a = inside ? earlier[y * grid.width + x]! : NaN;
            const b = inside ? later[y * grid.width + x]! : NaN;
            total += weight;
            if (!inside && weight > 0) {
                return undefined;
            }
            if (!Number.isFinite(a) || !Number.isFinite(b)) {
                continue;
            }
            if (weight > 0) {
                sumA += weight * a;
                sumB += weight * b;
                count += weight;
            } else if (r >= ring) {
                ringA.push(a);
                ringB.push(b);
            }
        }
    }
    if (count < 0.9 * total || count === 0 || ringA.length < 20) {
        return undefined;
    }
    const backgroundA = robust(ringA);
    const backgroundB = robust(ringB);
    const clippedMean = (values: number[], stat: { center: number; sigma: number }): number => {
        const retained = values.filter((v) => Math.abs(v - stat.center) <= 3 * stat.sigma);
        return retained.length ? retained.reduce((a, b) => a + b, 0) / retained.length : stat.center;
    };
    sumA -= count * clippedMean(ringA, backgroundA);
    sumB -= count * clippedMean(ringB, backgroundB);
    // The regridded pixels are correlated on the scale of one native pixel.
    const k = Math.max(1, Math.round(NATIVE / grid.pixelArcsec));
    const scale = total / count;
    const noiseA = backgroundA.sigma * Math.sqrt(count) * k * scale;
    const noiseB = backgroundB.sigma * Math.sqrt(count) * k * scale;
    return { sumA: sumA * scale, sumB: sumB * scale, noiseA, noiseB };
}

function fractionalChange(earlier: Float32Array, later: Float32Array, pix: PixelCoord, grid: OutputGrid,
    apertureArcsec = 12): number | undefined
{
    const sums = apertureSums(earlier, later, pix, grid, apertureArcsec);
    if (!sums) {
        return undefined;
    }
    const { sumA, sumB, noiseA } = sums;
    if (!(sumA > 0) || !(sumB > 0) || !(noiseA > 0) || !Number.isFinite(noiseA) || sumA < 5 * noiseA) {
        return undefined;
    }
    const frac = (sumB - sumA) / sumA;
    return Number.isFinite(frac) && frac >= -1 ? frac : undefined;
}

// Compare the fraction of light in the core to that in the wider aperture, propagating both visits' noise.
function sharpnessChanged(earlier: Float32Array, later: Float32Array, pix: PixelCoord, grid: OutputGrid): boolean | undefined
{
    const core = apertureSums(earlier, later, pix, grid, 6);
    const wide = apertureSums(earlier, later, pix, grid, 18);
    if (!core || !wide || wide.sumA <= 5 * wide.noiseA || wide.sumB <= 5 * wide.noiseB) { return undefined; }
    const a = core.sumA / wide.sumA, b = core.sumB / wide.sumB;
    const error = Math.hypot(core.noiseA / wide.sumA, core.noiseB / wide.sumB,
        a * wide.noiseA / wide.sumA, b * wide.noiseB / wide.sumB);
    // A non-significant difference does not establish equal widths; without a bound tight enough to rule out
    // aperture bias, leave the cause unresolved rather than treating a failed significance test as equality.
    return Number.isFinite(error) && Math.abs(a - b) > 3 * error ? true : undefined;
}

// Catmull-Rom bicubic sample of an image at a fractional pixel; NaN outside the grid or next to a non-finite
// pixel. Bilinear resampling leaves a residual of tens of noise units on a bright star's core (-ba round 8).
function cubic(data: Float32Array, grid: OutputGrid, sx: number, sy: number): number
{
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    if (x0 < 1 || y0 < 1 || x0 + 2 >= grid.width || y0 + 2 >= grid.height) {
        return NaN;
    }
    const weights = (f: number): number[] => [
        ((-0.5 * f + 1) * f - 0.5) * f,
        (1.5 * f - 2.5) * f * f + 1,
        ((-1.5 * f + 2) * f + 0.5) * f,
        (0.5 * f - 0.5) * f * f,
    ];
    const wx = weights(fx), wy = weights(fy);
    let out = 0;
    for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
            const weight = wx[i]! * wy[j]!;
            if (weight !== 0) {
                const value = data[(y0 - 1 + j) * grid.width + x0 - 1 + i]!;
                if (!Number.isFinite(value)) {
                    return NaN;
                }
                out += weight * value;
            }
        }
    }
    return out;
}

function localBackground(data: Float32Array, a: PixelCoord, grid: OutputGrid): number
{
    const ring: number[] = [];
    const r0 = 30 / grid.pixelArcsec, r1 = 36 / grid.pixelArcsec;
    for (let y = Math.max(0, Math.floor(a.y - r1)); y <= Math.min(grid.height - 1, Math.ceil(a.y + r1)); y++) {
        for (let x = Math.max(0, Math.floor(a.x - r1)); x <= Math.min(grid.width - 1, Math.ceil(a.x + r1)); x++) {
            const r = Math.hypot(x - a.x, y - a.y), v = data[y * grid.width + x]!;
            if (r >= r0 && r <= r1 && Number.isFinite(v)) {
                ring.push(v);
            }
        }
    }
    return median(ring);
}

function earlierAmplitude(data: Float32Array, a: PixelCoord, grid: OutputGrid): number
{
    const peak = cubic(data, grid, a.x, a.y);
    const sky = localBackground(data, a, grid);
    if (!Number.isFinite(sky)) { return NaN; }
    if (Number.isFinite(peak)) { return Math.max(0, peak - sky); }
    // A missing interpolation neighbour does not make a source vanish. Fit the finite samples in the core.
    const sigma = PSF_FWHM / 2.35482 / grid.pixelArcsec;
    let sum = 0, weight = 0, count = 0;
    for (let y = Math.max(0, Math.floor(a.y - sigma)); y <= Math.min(grid.height - 1, Math.ceil(a.y + sigma)); y++) {
        for (let x = Math.max(0, Math.floor(a.x - sigma)); x <= Math.min(grid.width - 1, Math.ceil(a.x + sigma)); x++) {
            const value = data[y * grid.width + x]!;
            if (!Number.isFinite(value)) { continue; }
            const p = Math.exp(-((x - a.x) ** 2 + (y - a.y) ** 2) / (2 * sigma ** 2));
            sum += p * (value - sky); weight += p * p; count++;
        }
    }
    return count >= 5 && weight > 0 ? Math.max(0, sum / weight) : NaN;
}

function anchorAmplitudes(earlier: Float32Array, anchors: PixelCoord[], grid: OutputGrid): number[]
{
    const sigma = PSF_FWHM / 2.35482 / grid.pixelArcsec;
    const amplitudes = anchors.map((a) => earlierAmplitude(earlier, a, grid));
    // A peak in an overlapping PSF includes its neighbours' light. Fit the amplitudes together so a faint
    // catalogue entry on a bright wing cannot acquire that wing's amplitude and its own artificial shift.
    if (anchors.length > 1) {
        const gram = anchors.map(() => anchors.map(() => 0));
        const rhs = anchors.map(() => 0);
        const sky = median(anchors.map((a) => localBackground(earlier, a, grid)).filter(Number.isFinite));
        if (!Number.isFinite(sky)) { return anchors.map(() => NaN); }
        const radius = 2 * PSF_FWHM / grid.pixelArcsec;
        const loX = Math.max(0, Math.floor(Math.min(...anchors.map((a) => a.x)) - radius));
        const hiX = Math.min(grid.width - 1, Math.ceil(Math.max(...anchors.map((a) => a.x)) + radius));
        const loY = Math.max(0, Math.floor(Math.min(...anchors.map((a) => a.y)) - radius));
        const hiY = Math.min(grid.height - 1, Math.ceil(Math.max(...anchors.map((a) => a.y)) + radius));
        for (let y = loY; y <= hiY; y++) {
            for (let x = loX; x <= hiX; x++) {
                const value = earlier[y * grid.width + x]! - sky;
                if (!Number.isFinite(value)) {
                    continue;
                }
                const profile = anchors.map((a) => Math.exp(-((x - a.x) ** 2 + (y - a.y) ** 2) / (2 * sigma ** 2)));
                for (let i = 0; i < anchors.length; i++) {
                    rhs[i]! += profile[i]! * value;
                    for (let j = 0; j < anchors.length; j++) {
                        gram[i]![j]! += profile[i]! * profile[j]!;
                    }
                }
            }
        }
        const matrix = gram.map((row, i) => [...row, rhs[i]!]);
        for (let i = 0; i < anchors.length; i++) {
            let pivot = i;
            for (let j = i + 1; j < anchors.length; j++) {
                if (Math.abs(matrix[j]![i]!) > Math.abs(matrix[pivot]![i]!)) {
                    pivot = j;
                }
            }
            [matrix[i], matrix[pivot]] = [matrix[pivot]!, matrix[i]!];
            const scale = matrix[i]![i]!;
            if (Math.abs(scale) < 1e-8) {
                continue;
            }
            for (let k = i; k <= anchors.length; k++) {
                matrix[i]![k]! /= scale;
            }
            for (let j = 0; j < anchors.length; j++) {
                if (j === i) {
                    continue;
                }
                const weight = matrix[j]![i]!;
                for (let k = i; k <= anchors.length; k++) {
                    matrix[j]![k]! -= weight * matrix[i]![k]!;
                }
            }
        }
        for (let i = 0; i < amplitudes.length; i++) {
            if (Math.abs(matrix[i]![i]!) > 1e-8) {
                amplitudes[i] = Math.max(0, matrix[i]![anchors.length]!);
            }
        }
        for (let round = 0; round < 40; round++) {
            let change = 0;
            for (let i = 0; i < amplitudes.length; i++) {
                if (!(gram[i]![i]! > 1e-8)) {
                    amplitudes[i] = 0;
                    continue;
                }
                const other = gram[i]!.reduce((sum, g, j) => sum + (i === j ? 0 : g * amplitudes[j]!), 0);
                const next = Math.max(0, (rhs[i]! - other) / gram[i]![i]!);
                change = Math.max(change, Math.abs(next - amplitudes[i]!) / Math.max(1, amplitudes[i]!));
                amplitudes[i] = next;
            }
            if (change < 1e-6) {
                break;
            }
        }
    }
    return amplitudes;
}

// Test whether a translation of at most WOBBLE_ARCSEC explains the spots, on the original measurement's bins and
// noise scale. With no anchors the whole patch moves as one. With anchors (catalogue stars) each star may move by its
// own amount, since two stars' fitted centroids can differ by a fraction of an arcsecond (-ba round 8): after the
// common shift, each star's light is moved on to its own shift (see `peak`), fitted one star at a time on the bins
// near the spots and the stars' cores; the whole patch must agree. A coarse search is refined around its best shift
// so a bright star's residual is not left behind by a 0.25″ search step. (A single warp, one shift per pixel, could
// not do this: a pixel lit by two stars needs both shifts.)
function explainedByWobble(earlier: Float32Array, later: Float32Array, spots: PixelCoord[], grid: OutputGrid,
    opt: Settings, m: Measurement, anchors: PixelCoord[] = [], allowCoreFallback = false,
    sourceAnchors: PixelCoord[] = anchors, onFallback?: () => void): boolean
{
    // Validate the surrounding PSF as well as the spot: fitting one wing must not create a change at the core.
    const bins: { x: number; y: number; index: number; spot: boolean; spotIndices: number[]; core: boolean }[] = [];
    const radius = Math.min(opt.matchArcsec, 2 * PSF_FWHM);
    for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
            const pix = { x: x * m.k + (m.k - 1) / 2, y: y * m.k + (m.k - 1) / 2 };
            const spotIndices = spots.flatMap((s, i) => distance(pix, s, grid) <= radius ? [i] : []);
            const spot = spotIndices.length > 0;
            const valid = m.noise[y * m.width + x]! > 0;
            if (spot && !valid) {
                return false;
            }
            if (valid && (spots.some((s) => distance(pix, s, grid) <= 2 * PSF_FWHM)
                || anchors.some((a) => distance(pix, a, grid) <= radius))) {
                bins.push({ x, y, index: y * m.width + x, spot, spotIndices,
                    core: anchors.some((a) => distance(pix, a, grid) <= CORE_ARCSEC) });
            }
        }
    }
    if (!bins.some((bin) => bin.spot)) {
        return false;
    }
    // Translating noise is not evidence for wobble. Require an earlier source close to a measured spot.
    const amplitudes = anchorAmplitudes(earlier, anchors, grid);
    if (amplitudes.some((amplitude) => !Number.isFinite(amplitude))) { return false; }
    const anchorSource = (a: PixelCoord, i: number, radius: number): boolean => {
        const x = Math.round(a.x / m.k), y = Math.round(a.y / m.k);
        const index = Math.max(0, Math.min(m.height - 1, y)) * m.width + Math.max(0, Math.min(m.width - 1, x));
        // A deblended earlier source may supply the local peak. A lobe farther from it needs a separate
        // clear improvement at the catalogue cores under the fitted registration (see explained).
        return amplitudes[i]! >= 5 * m.noise[index]! / Math.SQRT2
            && spots.some((spot) => distance(spot, a, grid) <= radius);
    };
    const sourceAmplitudes = sourceAnchors === anchors ? amplitudes : anchorAmplitudes(earlier, sourceAnchors, grid);
    const sourceSigma = PSF_FWHM / 2.35482 / grid.pixelArcsec;
    const residual = (x: number, y: number): number => earlier[y * grid.width + x]!
        - sourceAnchors.reduce((sum, anchor, i) => sum + sourceAmplitudes[i]!
            * Math.exp(-((x - anchor.x) ** 2 + (y - anchor.y) ** 2) / (2 * sourceSigma ** 2)), 0);
    const hasSource = spots.every((spot) => {
        if (sourceAnchors.some((a, i) => {
            const x = Math.max(0, Math.min(m.width - 1, Math.round(a.x / m.k)));
            const y = Math.max(0, Math.min(m.height - 1, Math.round(a.y / m.k)));
            return sourceAmplitudes[i]! >= 5 * m.noise[y * m.width + x]! / Math.SQRT2
                && distance(spot, a, grid) <= opt.matchArcsec;
        })) { return true; }
        const radius = opt.matchArcsec / grid.pixelArcsec;
        const sky = localBackground(earlier, spot, grid);
        for (let y = Math.max(1, Math.ceil(spot.y - radius)); y <= Math.min(grid.height - 2, Math.floor(spot.y + radius)); y++) {
            for (let x = Math.max(1, Math.ceil(spot.x - radius)); x <= Math.min(grid.width - 2, Math.floor(spot.x + radius)); x++) {
                const value = sourceAnchors.length ? residual(x, y) : earlier[y * grid.width + x]!;
                if (!Number.isFinite(value) || Math.hypot(x - spot.x, y - spot.y) > radius) {
                    continue;
                }
                let maximum = true;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const neighbour = sourceAnchors.length ? residual(x + dx, y + dy) : earlier[(y + dy) * grid.width + x + dx]!;
                        if (!Number.isFinite(neighbour) || neighbour > value) {
                            maximum = false;
                        }
                    }
                }
                const index = Math.floor(y / m.k) * m.width + Math.floor(x / m.k);
                const height = sourceAnchors.length ? value - sky : earlierAmplitude(earlier, { x, y }, grid);
                if (maximum && height >= 5 * m.noise[index]! / Math.SQRT2) {
                    return true;
                }
            }
        }
        return false;
    });
    const requireCoreImprovement = !hasSource && allowCoreFallback;
    if (!hasSource && (!allowCoreFallback || !bins.some((bin) => bin.core)
        || !anchors.some((a, i) => anchorSource(a, i, 2 * PSF_FWHM)))) {
        return false;
    }
    // Each anchor's deblended earlier peak, for the first-order correction below.
    const sigma = PSF_FWHM / 2.35482 / grid.pixelArcsec;
    // `common` moves the whole earlier image. Each anchor's own shift then moves that star's light, modelled as a
    // Gaussian of the PSF width, from the common shift to its own: exact to first order in the difference, so the
    // PSF's true shape matters little.
    const common = { x: 0, y: 0 };
    const shifts = anchors.map(() => ({ x: 0, y: 0 }));
    let fitted: { base: number; pixels: PixelCoord[] }[] | undefined;
    let commonProfiles: number[][] = [], ownProfiles: number[][] = [];
    const caches = anchors.map(() => new Map<string, number[]>());
    const loX = Math.min(...bins.map((b) => b.x * m.k)), hiX = Math.min(grid.width, Math.max(...bins.map((b) => (b.x + 1) * m.k)));
    const loY = Math.min(...bins.map((b) => b.y * m.k)), hiY = Math.min(grid.height, Math.max(...bins.map((b) => (b.y + 1) * m.k)));
    const profile = (s: number, d: PixelCoord): number[] => {
        const cache = caches[s]!, key = `${Math.round(d.x * 1e6)},${Math.round(d.y * 1e6)}`;
        const cached = cache.get(key);
        if (cached) {
            return cached;
        }
        const a = anchors[s]!, amplitude = amplitudes[s]!;
        const xs = new Float64Array(grid.width), ys = new Float64Array(grid.height);
        for (let x = loX; x < hiX; x++) {
            xs[x] = Math.exp(-((x - a.x - d.x / grid.pixelArcsec) ** 2) / (2 * sigma * sigma));
        }
        for (let y = loY; y < hiY; y++) {
            ys[y] = Math.exp(-((y - a.y - d.y / grid.pixelArcsec) ** 2) / (2 * sigma * sigma));
        }
        const result = fitted!.map((bin, i) => amplitude * bin.pixels.reduce((sum, p) => sum + xs[p.x]! * ys[p.y]!, 0)
            / bin.pixels.length / m.noise[bins[i]!.index]!);
        if (cache.size >= 4096) {
            cache.clear();
        }
        cache.set(key, result);
        return result;
    };
    // Worst spot bin and sum of squares over all bins (noise units); with anchors the shifts are fitted on the sum.
    const peak = (): [number, number, number, number, number[], number[]] => {
        let worst = 0, squares = 0, patch = 0, coreSquares = 0, missing = 0, total = 0;
        const perSpot = spots.map(() => 0);
        const signed: number[] = [];
        const record = (bin: typeof bins[number], value: number): void => {
            for (const i of bin.spotIndices) { perSpot[i] = Math.max(perSpot[i]!, value); }
        };
        if (fitted) {
            for (let i = 0; i < fitted.length; i++) {
                let value = fitted[i]!.base;
                for (let s = 0; s < anchors.length; s++) {
                    value += commonProfiles[s]![i]! - ownProfiles[s]![i]!;
                }
                const z = Math.abs(value);
                signed.push(value);
                if (bins[i]!.spot) {
                    worst = Math.max(worst, z);
                    record(bins[i]!, z);
                }
                squares += z * z;
                if (bins[i]!.core) {
                    coreSquares += z * z;
                }
                patch = Math.max(patch, z);
            }
            return [worst, squares, patch, coreSquares, perSpot, signed];
        }
        for (let i = 0; i < bins.length; i++) {
            const bin = bins[i]!;
            let sum = 0, count = 0;
            for (let y = bin.y * m.k; y < Math.min((bin.y + 1) * m.k, grid.height); y++) {
                for (let x = bin.x * m.k; x < Math.min((bin.x + 1) * m.k, grid.width); x++) {
                    total++;
                    let shifted = cubic(earlier, grid, x - common.x / grid.pixelArcsec, y - common.y / grid.pixelArcsec);
                    const value = later[y * grid.width + x]!;
                    if (!Number.isFinite(shifted) || !Number.isFinite(value)) {
                        missing++;
                        continue;
                    }
                    sum += value - shifted;
                    count++;
                }
            }
            if (!count) {
                return [Infinity, Infinity, Infinity, Infinity, spots.map(() => Infinity), []];
            }
            const value = (sum / count - m.background[bin.index]!) / m.noise[bin.index]!;
            signed.push(value);
            const z = Math.abs(value);
            if (bin.spot) {
                worst = Math.max(worst, z);
                record(bin, z);
            }
            squares += z * z;
            if (bin.core) {
                coreSquares += z * z;
            }
            patch = Math.max(patch, z);
        }
        return missing > 0.1 * total ? [Infinity, Infinity, Infinity, Infinity, spots.map(() => Infinity), []]
            : [worst, squares, patch, coreSquares, perSpot, signed];
    };
    const initial = peak();
    if (!Number.isFinite(initial[0]) || !Number.isFinite(initial[1])) {
        return false;
    }
    const explained = (): boolean => {
        const [worst, squares, patch, coreSquares, perSpot, signed] = peak();
        if (!(patch < opt.threshold && worst < initial[0] * 0.5 && squares < initial[1])
            || perSpot.some((value, i) => !(value < opt.threshold / 2 && value < initial[4][i]! * 0.5))
            || (requireCoreImprovement && !(coreSquares < 0.1 * initial[3]))) {
            return false;
        }
        if (requireCoreImprovement) {
            for (let s = 0; s < spots.length; s++) {
                let best = -1;
                bins.forEach((bin, i) => {
                    if (bin.spotIndices.includes(s) && (best < 0 || Math.abs(initial[5][i]!) > Math.abs(initial[5][best]!))) { best = i; }
                });
                if (best < 0 || perSpot[s]! >= opt.threshold / 2
                    || Math.sign(initial[5][best]!) * (initial[5][best]! - signed[best]!) < Math.abs(initial[5][best]!) / 2) {
                    return false;
                }
            }
        }
        return true;
    };
    // Fit the common translation on all bins before judging the accepted shift.
    let best = initial[1], bestX = 0, bestY = 0;
    for (const step of [0.25, 0.05, 0.01, 0.002]) {
        const range = step === 0.25 ? WOBBLE_ARCSEC : step * 5;
        const cx = bestX, cy = bestY, n = Math.round(range / step);
        for (let y = -n; y <= n; y++) {
            for (let x = -n; x <= n; x++) {
                const dx = cx + x * step, dy = cy + y * step;
                if (Math.hypot(dx, dy) > WOBBLE_ARCSEC + 1e-12) {
                    continue;
                }
                common.x = dx;
                common.y = dy;
                for (const own of shifts) {
                    own.x = dx;
                    own.y = dy;
                }
                const [, squares] = peak();
                if (squares < best) {
                    best = squares;
                    bestX = dx;
                    bestY = dy;
                }
            }
        }
    }
    // Overlapping stars need repeated refinement; stop at convergence, with a fixed work bound.
    common.x = bestX;
    common.y = bestY;
    for (const own of shifts) {
        own.x = bestX;
        own.y = bestY;
    }
    if (explained()) {
        if (requireCoreImprovement) { onFallback?.(); }
        return true;
    }
    if (anchors.length < 2) {
        return false;
    }
    // Once the common image is fixed, only the Gaussian corrections change. Reuse its finite samples;
    // separable Gaussian profiles avoid resampling the whole patch for every per-star trial.
    fitted = bins.map((bin) => {
        const pixels: PixelCoord[] = [];
        let sum = 0;
        for (let y = bin.y * m.k; y < Math.min((bin.y + 1) * m.k, grid.height); y++) {
            for (let x = bin.x * m.k; x < Math.min((bin.x + 1) * m.k, grid.width); x++) {
                const shifted = cubic(earlier, grid, x - common.x / grid.pixelArcsec, y - common.y / grid.pixelArcsec);
                const value = later[y * grid.width + x]!;
                if (Number.isFinite(shifted) && Number.isFinite(value)) {
                    pixels.push({ x, y });
                    sum += value - shifted;
                }
            }
        }
        return { pixels, base: (sum / pixels.length - m.background[bin.index]!) / m.noise[bin.index]! };
    });
    if (fitted.some((bin) => bin.pixels.length === 0)) {
        return false;
    }
    commonProfiles = anchors.map((_, s) => profile(s, common));
    ownProfiles = commonProfiles.slice();
    for (let round = 0; round < 40; round++) {
        const previous = best;
        for (let s = 0; s < shifts.length; s++) {
            const own = shifts[s]!;
            if (amplitudes[s]! === 0) {
                continue;
            }
            let ox = own.x, oy = own.y;
            for (const step of [0.1, 0.02, 0.004]) {
                const cx = ox, cy = oy;
                for (let y = -5; y <= 5; y++) {
                    for (let x = -5; x <= 5; x++) {
                        const dx = cx + x * step, dy = cy + y * step;
                        if (Math.hypot(dx, dy) > WOBBLE_ARCSEC + 1e-12) {
                            continue;
                        }
                        own.x = dx;
                        own.y = dy;
                        ownProfiles[s] = profile(s, own);
                        const [, squares] = peak();
                        if (squares < best) {
                            best = squares;
                            ox = dx;
                            oy = dy;
                        }
                    }
                }
            }
            own.x = ox;
            own.y = oy;
            ownProfiles[s] = profile(s, own);
        }
        if (explained()) {
            if (requireCoreImprovement) { onFallback?.(); }
            return true;
        }
        if (previous - best <= 1e-6 * Math.max(1, previous)) {
            break;
        }
    }
    return false;
}

export function compareVisits(earlier: Image, later: Image, grid: OutputGrid, stars: StarPix[], opts?: ChangeOptions): VisitChangeResult
{
    const opt = settings(opts), result = empty(opt);
    const visits = { earlier: { obsIds: [...earlier.obsIds], mjd: earlier.mjd },
        later: { obsIds: [...later.obsIds], mjd: later.mjd } };
    const diff = difference(earlier.data, later.data, grid);
    const pairedEarlier = diff.some((value) => !Number.isFinite(value))
        ? earlier.data.map((value, i) => Number.isFinite(diff[i]!) ? value : NaN) : earlier.data;
    const wavelength = (value: number): string => Number.isFinite(value) ? `${value.toFixed(3)} µm` : 'unknown';
    result.notes.push(`Earlier visit at ${wavelength(earlier.lambda)}, later at ${wavelength(later.lambda)}.`
        + (Number.isFinite(earlier.lambda) && Number.isFinite(later.lambda) && earlier.lambda !== later.lambda
            ? ' A source can read differently at different wavelengths.' : ''));
    const singleFrame = earlier.obsIds.length === 1 || later.obsIds.length === 1;
    const earlierUnclipped = earlier.obsIds.length < MIN_CLIPPED_FRAMES;
    const laterUnclipped = later.obsIds.length < MIN_CLIPPED_FRAMES;
    const caveat = earlierUnclipped && laterUnclipped
        ? `Each visit has fewer than ${MIN_CLIPPED_FRAMES} frames, so a detector hit cannot be ruled out.`
        : earlierUnclipped ? `The earlier visit has fewer than ${MIN_CLIPPED_FRAMES} frames, so a detector hit cannot be ruled out.`
            : laterUnclipped ? `The later visit has fewer than ${MIN_CLIPPED_FRAMES} frames, so a detector hit cannot be ruled out.` : undefined;
    if (!Number.isFinite(earlier.lambda) || !Number.isFinite(later.lambda)) {
        result.notes.push('The wavelength is unknown for at least one visit, so the visits were not compared.');
        return { ...result, visits } as VisitChangeResult;
    }
    if (!wavelengthsMatch(earlier.lambda, later.lambda, opt.maxDeltaLambda)) {
        result.skipped = later.obsIds.map((obsId) => ({ obsId, reason: `No earlier image within ${opt.maxDeltaLambda} µm.` }));
        result.notes.push(`${later.obsIds.length} ${later.obsIds.length === 1 ? 'frame' : 'frames'} skipped: no earlier image within ${opt.maxDeltaLambda} µm.`);
        return { ...result, visits } as VisitChangeResult;
    }
    let varSum: Float32Array | undefined;
    if ((earlier.variance && earlier.variance.length !== diff.length)
        || (later.variance && later.variance.length !== diff.length)) {
        throw new Error('Variance input length does not match output grid');
    }
    if (earlier.variance && later.variance) {
        varSum = new Float32Array(diff.length);
        for (let i = 0; i < varSum.length; i++) {
            const a = earlier.variance[i]!, b = later.variance[i]!;
            varSum[i] = Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0 ? a + b : NaN;
        }
    }
    const { found, measurement } = blobs(diff, grid, opt, result, 3.75, varSum, true);
    if (!Number.isFinite(measurement.sigma)) {
        result.notes.push(diff.some(Number.isFinite)
            ? 'Not enough overlapping image pixels to compare the visits.'
            : 'The two visits do not overlap here, so nothing was compared.');
        return { ...result, visits } as VisitChangeResult;
    }
    if (measurement.usedErrorMap) {
        result.notes.push('Noise estimated using the frames\' pixel uncertainty maps.');
    } else if (earlier.variance || later.variance) {
        result.notes.push(earlier.variance && later.variance
            ? `Error maps unusable; noise from the difference image only. ${NO_SNR_NOTE}`
            : `Error map on only one visit; noise from the difference image only. ${NO_SNR_NOTE}`);
    } else {
        result.notes.push(`Noise from the difference image only (no error maps given): a small patch of extra noise can show up as false change candidates. ${NO_SNR_NOTE}`);
    }
    const center = { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 };
    const centerRadius = opt.matchArcsec / grid.pixelArcsec;
    let centerBlank = true, centerChecked = false;
    const coverageRadius = centerRadius + 12 / grid.pixelArcsec;
    for (let y = Math.ceil(center.y - coverageRadius); y <= Math.floor(center.y + coverageRadius) && centerBlank; y++) {
        for (let x = Math.ceil(center.x - coverageRadius); x <= Math.floor(center.x + coverageRadius); x++) {
            if (Math.hypot(x - center.x, y - center.y) > coverageRadius) { continue; }
            if (x < 0 || y < 0 || x >= grid.width || y >= grid.height
                || !Number.isFinite(earlier.data[y * grid.width + x]!) || !Number.isFinite(later.data[y * grid.width + x]!)) {
                centerBlank = false;
                break;
            }
        }
    }
    for (let y = Math.ceil(center.y - centerRadius); y <= Math.floor(center.y + centerRadius) && centerBlank; y++) {
        for (let x = Math.ceil(center.x - centerRadius); x <= Math.floor(center.x + centerRadius); x++) {
            if (Math.hypot(x - center.x, y - center.y) > centerRadius) { continue; }
            const sums = apertureSums(earlier.data, later.data, { x, y }, grid);
            if (!sums || !(sums.noiseA > 0) || !(sums.noiseB > 0)
                || !Number.isFinite(sums.noiseA) || !Number.isFinite(sums.noiseB)) {
                centerBlank = false;
                break;
            }
            centerChecked = true;
            if (sums.sumA >= 5 * sums.noiseA || sums.sumB >= 5 * sums.noiseB) {
                centerBlank = false;
                break;
            }
        }
    }
    let smallChanges = 0, smallUncatalogued = 0, wobble = 0;
    const used = new Set<number>();
    found.forEach((blob, i) => {
        if (blob.edge) {
            used.add(i);
            const c = candidate(blob, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]);
            c.kind = 'unknown';
            const margin = opt.edgeArcsec / grid.pixelArcsec;
            const atEdge = blob.pix.x < margin || blob.pix.y < margin
                || blob.pix.x >= grid.width - margin || blob.pix.y >= grid.height - margin;
            c.reason = `The two visits differ here, near ${atEdge ? 'an image edge' : 'missing image pixels'}; its cause is uncertain (${snrText(c.snr)}; candidate).`;
            result.candidates.push(c);
            return;
        }
        let missing = 0;
        const radius = PSF_FWHM / grid.pixelArcsec;
        for (let y = Math.max(0, Math.ceil(blob.pix.y - radius)); y <= Math.min(grid.height - 1, Math.floor(blob.pix.y + radius)); y++) {
            for (let x = Math.max(0, Math.ceil(blob.pix.x - radius)); x <= Math.min(grid.width - 1, Math.floor(blob.pix.x + radius)); x++) {
                if (Math.hypot(x - blob.pix.x, y - blob.pix.y) <= radius && !Number.isFinite(diff[y * grid.width + x]!)) { missing++; }
            }
        }
        const narrow = blob.narrow || narrowChange(diff, blob.pix, blob.sign, grid) === true;
        if (!narrow && !blob.compactUncertain && missing < 3) { return; }
        used.add(i);
        const c = candidate(blob, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]);
        c.kind = 'unknown';
        c.reason = narrow
            ? `A very narrow change in one visit, narrower than a star image; ${earlierUnclipped || laterUnclipped ? 'could be a single-frame hit' : 'its cause is uncertain'} (${snrText(c.snr)}; candidate).`
            : blob.compactUncertain
                ? `A compact change whose cause is uncertain (${snrText(c.snr)}; candidate).`
                : `The two visits differ here, near missing image pixels; the missing data make its cause uncertain (${snrText(c.snr)}; candidate).`;
        result.candidates.push(c);
    });
    const nearestStar = (p: PixelCoord): StarPix | undefined => stars
        .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && distance(p, s, grid) <= opt.matchArcsec)
        .sort((a, b) => distance(p, a, grid) - distance(p, b, grid))[0];
    const wobbleCache = new Map<string, boolean>();
    const fallbackSpots = new Set<PixelCoord>();
    const spotKey = (spots: PixelCoord[]): string => spots.map((p) => `${p.x},${p.y}`).sort().join(';');
    const nearbyAnchors = (spots: PixelCoord[]): StarPix[] => {
        const unique: StarPix[] = [];
        for (const star of stars) {
            if (Number.isFinite(star.x) && Number.isFinite(star.y)
                && spots.some((p) => distance(p, star, grid) <= opt.matchArcsec + 2 * PSF_FWHM)
                && !unique.some((other) => sameStar(star, other))) {
                unique.push(star);
            }
        }
        const sigma = PSF_FWHM / 2.35482;
        return unique.map((star) => ({ star, influence: earlierAmplitude(pairedEarlier, star, grid)
            * Math.max(...spots.map((spot) => Math.exp(-(distance(spot, star, grid) ** 2) / (2 * sigma ** 2)))) }))
            .sort((a, b) => b.influence - a.influence).slice(0, 4).map((a) => a.star);
    };
    const commonWobble = (spots: PixelCoord[]): boolean => {
        const key = `common:${spotKey(spots)}`;
        const cached = wobbleCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const result = explainedByWobble(pairedEarlier, later.data, spots, grid, opt, measurement,
            [], false, nearbyAnchors(spots));
        wobbleCache.set(key, result);
        return result;
    };
    // Each nearby catalogue star may wobble by its own amount (see explainedByWobble).
    const ownWobble = (spots: PixelCoord[]): boolean => {
        const key = `own:${spotKey(spots)}`;
        const cached = wobbleCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const anchors = nearbyAnchors(spots);
        let fallback = false;
        const explained = anchors.length > 1 && explainedByWobble(pairedEarlier, later.data, spots, grid, opt,
            measurement, anchors, true, anchors, () => { fallback = true; });
        if (fallback) { spots.forEach((spot) => fallbackSpots.add(spot)); }
        const result = explained && !fallback;
        wobbleCache.set(key, result);
        return result;
    };
    if (stars.some((star, i) => star.id === undefined && Number.isFinite(star.x) && Number.isFinite(star.y)
        && stars.some((other, j) => j > i && other.id === undefined && Number.isFinite(other.x) && Number.isFinite(other.y)
            && distance(star, other, grid) <= opt.dipoleArcsec))) {
        result.notes.push('Catalogue stars have no ids: two nearby catalogue stars that change in opposite ways can look like one mover.');
    }
    // Repeated ids must also be close enough for the elapsed time, allowing up to 10.5″ per year.
    const sameIdRadius = opt.matchArcsec + (Number.isFinite(earlier.mjd) && Number.isFinite(later.mjd)
        ? 10.5 * Math.abs(later.mjd - earlier.mjd) / 365.25 : 0);
    const sameStar = (a: StarPix, b: StarPix): boolean => a.id !== undefined || b.id !== undefined
        ? a.id !== undefined && a.id === b.id && distance(a, b, grid) <= sameIdRadius
        : a === b || (a.x === b.x && a.y === b.y);
    // Difference lobes can be displaced from their source centres by the image width. Require both
    // date-tagged positions within one FWHM, matching direction and vector within one FWHM.
    // `endError` is the larger distance from a lobe to its dated catalogue position, in arcsec.
    const predictedMotion = (negative: Blob, positive: Blob): { motion: number; endError: number; id: string } | undefined => {
        for (const first of stars) {
            if (!first.id || first.visit !== 'earlier' || !first.properMotion) { continue; }
            const firstPos = { x: first.motionX ?? first.x, y: first.motionY ?? first.y };
            for (const second of stars) {
                if (second.id !== first.id || second.visit !== 'later' || !second.properMotion) { continue; }
                const secondPos = { x: second.motionX ?? second.x, y: second.motionY ?? second.y };
                const dx = secondPos.x - firstPos.x, dy = secondPos.y - firstPos.y;
                const ox = positive.pix.x - negative.pix.x, oy = positive.pix.y - negative.pix.y;
                const motion = distance(firstPos, secondPos, grid);
                const endError = Math.max(distance(negative.pix, firstPos, grid), distance(positive.pix, secondPos, grid));
                if (motion >= opt.minShiftArcsec && endError <= PSF_FWHM && dx * ox + dy * oy > 0
                    && Math.hypot(dx - ox, dy - oy) * grid.pixelArcsec <= PSF_FWHM) {
                    return { motion, endError, id: first.id };
                }
            }
        }
        return undefined;
    };
    // A bright steady neighbour can dominate an unsubtracted aperture without being the changed source.
    // In that case neither its fractional change nor its light centroid describes the spot reliably.
    const brighterNeighbour = (pix: PixelCoord): StarPix | undefined => {
        const own = nearestStar(pix);
        const sums = apertureSums(earlier.data, later.data, pix, grid);
        if (!sums) {
            return undefined;
        }
        const radius = PSF_FWHM / grid.pixelArcsec, sigma = radius / 2.35482;
        const nearby: StarPix[] = [];
        for (const star of stars) {
            if (Number.isFinite(star.x) && Number.isFinite(star.y) && distance(pix, star, grid) <= 2 * PSF_FWHM
                && !nearby.some((other) => sameStar(star, other))) { nearby.push(star); }
        }
        const ranked = nearby.filter((star) => !own || !sameStar(star, own))
            .map((star) => ({ star, peak: earlierAmplitude(pairedEarlier, star, grid) }))
            .sort((a, b) => b.peak - a.peak || a.star.x - b.star.x || a.star.y - b.star.y);
        // Include the changed source in the fit even when it has no catalogue entry.
        const anchors: PixelCoord[] = [own ?? pix, ...ranked.map((entry) => entry.star)];
        const amplitudes = anchorAmplitudes(pairedEarlier, anchors, grid);
        const qualified: { star: StarPix; amplitude: number }[] = [];
        ranked.forEach(({ star }, index) => {
            if (!Number.isFinite(star.x) || !Number.isFinite(star.y) || (own && sameStar(star, own))
                || distance(pix, star, grid) > 2 * PSF_FWHM) {
                return;
            }
            const frac = fractionalChange(earlier.data, later.data, star, grid, CORE_ARCSEC);
            if (frac === undefined || Math.abs(frac) >= opt.minFracChange) {
                return;
            }
            const core = apertureSums(earlier.data, later.data, star, grid, CORE_ARCSEC);
            if (core && Math.abs(core.sumB - core.sumA) > 5 * Math.hypot(core.noiseA, core.noiseB)
                && found.some((b) => distance(b.pix, star, grid) <= opt.matchArcsec && b.sign === Math.sign(frac))) {
                return;
            }
            let profile = 0;
            for (let y = Math.ceil(pix.y - radius); y <= Math.floor(pix.y + radius); y++) {
                for (let x = Math.ceil(pix.x - radius); x <= Math.floor(pix.x + radius); x++) {
                    if (Math.hypot(x - pix.x, y - pix.y) <= radius) {
                        profile += Math.exp(-((x - star.x) ** 2 + (y - star.y) ** 2) / (2 * sigma ** 2));
                    }
                }
            }
            const amplitude = amplitudes[index + 1]!;
            if (amplitude * profile > 0.5 * Math.max(sums.sumA, sums.sumB)) { qualified.push({ star, amplitude }); }
        });
        qualified.sort((a, b) => b.amplitude - a.amplitude || a.star.x - b.star.x || a.star.y - b.star.y);
        return qualified[0]?.star;
    };
    const crowded = found.map((blob) => {
        const unique: StarPix[] = [];
        for (const star of stars) {
            if (Number.isFinite(star.x) && Number.isFinite(star.y) && distance(blob.pix, star, grid) <= 2 * PSF_FWHM
                && !unique.some((other) => sameStar(star, other))) {
                unique.push(star);
                if (unique.length > 3) { return true; }
            }
        }
        return false;
    });
    const brighter = found.map((b, i) => crowded[i] ? undefined : brighterNeighbour(b.pix));
    const blendedLight = found.map((blob) => {
        const anchors = nearbyAnchors([blob.pix]).filter((s) => distance(s, blob.pix, grid) <= 2 * PSF_FWHM);
        if (anchors.length < 2) { return false; }
        const sums = apertureSums(earlier.data, later.data, blob.pix, grid);
        if (!sums || sums.sumA <= 0) { return false; }
        const amplitudes = anchorAmplitudes(pairedEarlier, anchors, grid);
        const radius = PSF_FWHM / grid.pixelArcsec, sigma = radius / 2.35482;
        const light = anchors.map((anchor, i) => {
            let profile = 0;
            for (let y = Math.ceil(blob.pix.y - radius); y <= Math.floor(blob.pix.y + radius); y++) {
                for (let x = Math.ceil(blob.pix.x - radius); x <= Math.floor(blob.pix.x + radius); x++) {
                    if (Math.hypot(x - blob.pix.x, y - blob.pix.y) <= radius) {
                        profile += Math.exp(-((x - anchor.x) ** 2 + (y - anchor.y) ** 2) / (2 * sigma ** 2));
                    }
                }
            }
            return amplitudes[i]! * profile;
        }).filter((value) => Number.isFinite(value) && value > 0);
        const halfAperture = 0.5 * Math.max(sums.sumA, sums.sumB);
        return light.length >= 2 && Math.max(...light) <= halfAperture
            && light.reduce((a, b) => a + b, 0) > halfAperture;
    });
    // Opposite changes on two catalogue stars within 2 FWHM are ambiguous. Steady neighbours subtract out;
    // a much weaker shadow or an unresolved pair inside one PSF core does not establish this ambiguity.
    // The neighbour counts only when its own core changed by the floor: a common wobble of two steady stars
    // gives two opposite spots on two ids, but no core change, so it is not a blend (Opus High 1).
    const blended = (blob: Blob, star: StarPix, pool = found.filter((_, i) => !used.has(i))): boolean => pool.some((other) => {
        if (other === blob || other.sign === blob.sign
            || other.snr * 5 < blob.snr || distance(other.pix, blob.pix, grid) < PSF_FWHM / 2) {
            return false;
        }
        const otherStar = nearestStar(other.pix);
        if (otherStar === undefined || sameStar(otherStar, star) || distance(otherStar, star, grid) > 2 * PSF_FWHM) {
            return false;
        }
        const otherFrac = fractionalChange(earlier.data, later.data, otherStar, grid, CORE_ARCSEC);
        const ownFrac = fractionalChange(earlier.data, later.data, star, grid, CORE_ARCSEC);
        return ownFrac !== undefined && Math.sign(ownFrac) === blob.sign && otherFrac !== undefined
            && Math.sign(otherFrac) === other.sign && Math.abs(otherFrac) >= opt.minFracChange;
    });
    // Judge the internal floor on the 12″ aperture, or on the 6″ core when opposite catalogue changes blend.
    const floorFrac = (star: StarPix | PixelCoord, isBlended: boolean): number | undefined => isBlended
        ? fractionalChange(earlier.data, later.data, star, grid, CORE_ARCSEC)
        : fractionalChange(earlier.data, later.data, star, grid);
    const uncertainNeighbour = (star: StarPix | undefined): boolean => star !== undefined && stars.some((other) =>
        Number.isFinite(other.x) && Number.isFinite(other.y) && !sameStar(star, other)
        && distance(star, other, grid) <= 2 * PSF_FWHM);
    for (let i = 0; i < found.length; i++) {
        const positive = found[i]!;
        if (positive.sign !== 1 || used.has(i)) {
            continue;
        }
        // Partners in order: the same catalogue star first, then nearest. The first that passes the shift test
        // is the mover; a nearer partner that fails it must not hide a real one further out. Spots on two
        // different catalogue stars pair into the either/or candidate below. Edge spots never pair; each is
        // judged on its own below.
        const positiveStar = nearestStar(positive.pix);
        const partners: { j: number; d: number; same: boolean; blocked: boolean }[] = [];
        for (let j = 0; j < found.length; j++) {
            const negative = found[j]!;
            if (negative.sign !== -1 || used.has(j)) {
                continue;
            }
            const d = distance(positive.pix, negative.pix, grid);
            const negativeStar = nearestStar(negative.pix);
            const blocked = positiveStar !== undefined && negativeStar !== undefined && !sameStar(positiveStar, negativeStar);
            if (d <= opt.dipoleArcsec && Math.max(positive.area, negative.area) <= 3 * Math.min(positive.area, negative.area)) {
                partners.push({ j, d, blocked, same: positiveStar !== undefined && negativeStar !== undefined
                    && positiveStar.id !== undefined && sameStar(positiveStar, negativeStar) });
            }
        }
        partners.sort((a, b) => Number(b.same) - Number(a.same) || Number(a.blocked) - Number(b.blocked) || a.d - b.d);
        let ambiguous: { j: number; shift: number } | undefined;
        for (const { j, d, blocked: onTwoStars } of partners) {
            const negative = found[j]!;
            const predicted = predictedMotion(negative, positive);
            const prediction = predicted?.motion;
            if (positive.edge || negative.edge) {
                continue;
            }
            const negativeStar = nearestStar(negative.pix);
            // Crowding makes light centroids unreliable, but a catalogue motion test uses the lobe positions only.
            // When both lobes sit within a quarter image width of the star's two dated positions AND that star is
            // the nearest catalogue entry to each lobe, the listed motion is still the reading to report, hedged for
            // the crowding (Barnard's Star at 4.6 µm: 5 catalogue stars within 24″, lobes 0.7″ and about 2″ from
            // the dated positions). A nearer catalogue entry means the light may be that star's (Codex r11c: a
            // catalogued stationary pair swapping light with an unseen motion star 7″ away read as a mover).
            const tightPrediction = predicted !== undefined && predicted.endError <= PSF_FWHM / 4
                && nearestStar(negative.pix)?.id === predicted.id && nearestStar(positive.pix)?.id === predicted.id;
            const isCrowded = crowded[i] || crowded[j];
            // A single star's own dipole may put one lobe just outside the matching radius. Test that pair
            // for wobble/slow-shift ambiguity; other neighbour-dominated spots cannot give reliable centroids.
            if ((isCrowded && !tightPrediction) || (brighter[i] && (!negativeStar || !sameStar(brighter[i]!, negativeStar)))
                || (brighter[j] && (!positiveStar || !sameStar(brighter[j]!, positiveStar)))) {
                ambiguous ??= { j, shift: d };
                continue;
            }
            const center = { x: (positive.pix.x + negative.pix.x) / 2, y: (positive.pix.y + negative.pix.y) / 2 };
            const before = sourceCentroid(earlier.data, later.data, center, grid);
            const after = sourceCentroid(later.data, earlier.data, center, grid);
            const shift = before && after ? distance(before, after, grid) : 0;
            const uncertainty = Math.hypot(PSF_FWHM / (2.35 * positive.snr), PSF_FWHM / (2.35 * negative.snr));
            // Two fixed stars keep the light centre between them, give or take the wobble. A shift beyond that
            // (a source crossing a pair 0.5″ apart, Argon M5) is a mover; within it, the either/or (Codex round 7:
            // a 2.9″ pair swapping 3000/30 under a 1.4″ wobble shifts 3.4″).
            const blocked = onTwoStars
                && shift <= distance(positiveStar!, nearestStar(negative.pix)!, grid) + WOBBLE_ARCSEC;
            if (commonWobble([positive.pix, negative.pix])
                || ownWobble([positive.pix, negative.pix])) {
                used.add(i);
                used.add(j);
                result.rejected.residual += 2;
                wobble += 2;
                break;
            }
            if (prediction === undefined && (shift < 3 * uncertainty || (onTwoStars && shift < opt.minShiftArcsec))) {
                const first = positiveStar && floorFrac(positiveStar, true);
                const second = negativeStar && floorFrac(negativeStar, true);
                const radialProfile = d < CORE_ARCSEC && positiveStar
                    && sharpnessChanged(earlier.data, later.data, positiveStar, grid) === true;
                if (!radialProfile && (!onTwoStars || (first !== undefined && second !== undefined
                    && Math.abs(first) < opt.minFracChange && Math.abs(second) < opt.minFracChange))) {
                    ambiguous ??= { j, shift: d };
                }
                continue;
            }
            if (prediction === undefined && !blocked && (shift < opt.minShiftArcsec || shift <= WOBBLE_ARCSEC + 3 * uncertainty)) {
                ambiguous ??= { j, shift: d };
                continue;
            }
            used.add(i);
            used.add(j);
            const c = candidate(positive, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]);
            c.reading = 'pair';
            c.ends = [
                { visit: 'earlier', ...negative.pix, radiusPix: 12 / grid.pixelArcsec },
                { visit: 'later', ...positive.pix, radiusPix: 12 / grid.pixelArcsec },
            ];
            if (prediction !== undefined && !onTwoStars && Math.min(positive.snr, negative.snr) >= MIN_MOVER_SNR) {
                c.kind = 'mover';
                c.reading = 'moved';
                c.reason = `A catalogue star has a listed motion of about ${Math.round(prediction)}″ between these dates; the light here is consistent with that motion. `
                    + `Two changing sources, an image shift${earlierUnclipped || laterUnclipped ? ', or detector hits' : ''} could also look like this`
                    + `${isCrowded ? ', and other catalogue stars close by make it less certain' : ''} (${snrText(c.snr)}; candidate).`;
                c.lightEnds = c.ends;
            } else if (blocked) {
                // Spots on two catalogue stars: a source moving from one to the other and the two stars changing
                // the opposite way give the same difference image under ordinary registration wobble. A two-PSF
                // fit could not tell them apart (round 5 review: 8-44 false movers in 135), so do not choose.
                const apart = distance(positiveStar!, nearestStar(negative.pix)!, grid);
                c.kind = 'unknown';
                c.reason = `Either a source moved between two catalogue stars ${apart.toFixed(1)}″ apart, or one got brighter `
                    + `and the other fainter; a small image shift could also cause this (${snrText(c.snr)}; candidate).`;
            } else {
                c.kind = 'unknown';
                // No separation is printed: pairs are at most dipoleArcsec (15″) apart, under two image widths, where
                // the two difference peaks overlap and sit 20 to 50 percent off the sources' true separation.
                c.reason = `Two nearby spots changed in opposite ways; one source that moved, two sources changing, or a small image shift could look like this (${snrText(c.snr)}; candidate).`;
            }
            result.candidates.push(c);
            break;
        }
        if (ambiguous && !used.has(i)) {
            used.add(i);
            used.add(ambiguous.j);
            const c = candidate(positive, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]);
            c.kind = 'unknown';
            c.reading = 'pair';
            c.ends = [{ visit: 'earlier', ...found[ambiguous.j]!.pix, radiusPix: 12 / grid.pixelArcsec },
                { visit: 'later', ...positive.pix, radiusPix: 12 / grid.pixelArcsec }];
            // No separation is printed: a small shift of one source gives two peaks about one image width apart whatever
            // the shift (1.7″ printed 10.8″; a 2″ swap printed 11.0″, Codex r11c).
            c.reason = `Two close spots changed in opposite ways; a small shift of one source, a slow mover, or two changing sources could look like this (${snrText(c.snr)}; candidate).`;
            result.candidates.push(c);
        }
    }
    // Steady catalogue stars: small changes are leftovers, judged after movers are paired. Only a spot within
    // matchArcsec counts as a star's own: a wider rule (a wobble lobe up to dipoleArcsec out) also swallowed
    // real new sources beside a wobbling star (Opus High 2). Lobes further out are worded below instead.
    found.forEach((blob, i) => {
        if (used.has(i)) {
            return;
        }
        if (blob.edge) {
            used.add(i); result.rejected.edge++;
            return;
        }
        // Include the other lobes of this local patch: an earlier core can lie between its wobble lobes.
        const spots = found.filter((b, j) => !used.has(j) && !b.edge && distance(b.pix, blob.pix, grid) <= 2 * PSF_FWHM).map((b) => b.pix);
        if (commonWobble(spots) || ownWobble(spots)
            || (spots.length > 1 && (commonWobble([blob.pix]) || ownWobble([blob.pix])))) {
            used.add(i);
            result.rejected.residual++;
            wobble++;
            return;
        }
        if (fallbackSpots.has(blob.pix)) {
            used.add(i);
            const c = candidate(blob, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]);
            c.kind = 'unknown';
            c.reason = `The two visits differ here, beside catalogue stars; a small image shift could also cause this (${snrText(c.snr)}; candidate).`;
            result.candidates.push(c);
            return;
        }
        const star = nearestStar(blob.pix);
        if (star && !brighter[i] && !crowded[i] && !blendedLight[i] && !uncertainNeighbour(star)) {
            const frac = floorFrac(star, blended(blob, star));
            if (frac !== undefined && Math.abs(frac) < opt.minFracChange) {
                used.add(i); result.rejected.residual++;
                smallChanges++;
            }
        }
    });
    // Spots that survive the floor. A pair on two catalogue stars that passed the shift test is the either/or
    // candidate above; a spot whose partner failed it is judged here like any other.
    const kept = found.map((b, i) => {
        if (used.has(i)) {
            return undefined;
        }
        const star = nearestStar(b.pix);
        const isBlended = star !== undefined && blended(b, star);
        const floor = brighter[i] || crowded[i] || blendedLight[i] || uncertainNeighbour(star) ? undefined : floorFrac(b.pix, isBlended);
        const mismatch = floor !== undefined && Math.sign(floor) !== b.sign;
        if (floor !== undefined && !mismatch && Math.abs(floor) < opt.minFracChange) {
            used.add(i);
            result.rejected.residual++;
            if (star) { smallChanges++; } else { smallUncatalogued++; }
            return undefined;
        }
        return { b, star, isBlended, floor, mismatch, brighter: brighter[i], crowded: crowded[i], blendedLight: blendedLight[i] };
    });
    // Keep weak changes out of the explanations for stronger ones, but do not assume they are shadows.
    // Use one snapshot so a middle weak change cannot hide another beyond the strongest one's radius.
    const beforeShadows = kept.slice();
    kept.forEach((k, i) => {
        if (k && (beforeShadows.some((other) => other !== undefined && other !== k && other.b.snr >= 5 * k.b.snr
            && distance(other.b.pix, k.b.pix, grid) <= 2 * PSF_FWHM)
            || result.candidates.some((other) => other.snr >= 5 * k.b.snr
                && distance(other.pix, k.b.pix, grid) <= 2 * PSF_FWHM))) {
            kept[i] = undefined;
            used.add(i);
            const c = candidate(k.b, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]);
            c.kind = 'unknown';
            c.reason = `A weaker change near a stronger change; it may be related or a separate source (${snrText(c.snr)}; candidate).`;
            result.candidates.push(c);
        }
    });
    const pairedKept = new Set<Blob>();
    kept.forEach((k) => {
        if (!k || pairedKept.has(k.b)) {
            return;
        }
        const { b, star, floor, mismatch, brighter: neighbour, crowded: isCrowded, blendedLight: multiBlend } = k;
        const survivors = kept.flatMap((other) => other ? [other.b] : []);
        const isBlended = star !== undefined && blended(b, star, survivors);
        const wing = star === undefined && stars.some((s) => Number.isFinite(s.x) && Number.isFinite(s.y)
            && distance(b.pix, s, grid) <= 2 * PSF_FWHM);
        const opposite = survivors.find((o) => o !== b && o.sign !== b.sign
            && distance(o.pix, b.pix, grid) <= 2 * PSF_FWHM
            && (nearestStar(o.pix) === undefined || (() => {
                const frac = fractionalChange(earlier.data, later.data, nearestStar(o.pix)!, grid, CORE_ARCSEC);
                return frac !== undefined && Math.sign(frac) === o.sign;
            })()));
        const signMismatch = mismatch && !isBlended;
        const c = candidate(b, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]);
        if (isBlended) { c.radiusPix = CORE_ARCSEC / grid.pixelArcsec; }
        const direction = b.sign === 1 ? 'brighter' : 'fainter';
        const sums = !c.gaiaMatch && !wing && !opposite && !isBlended && !signMismatch
            ? apertureSums(earlier.data, later.data, b.pix, grid) : undefined;
        const measurable = sums !== undefined && sums.noiseA > 0 && sums.noiseB > 0
            && Number.isFinite(sums.noiseA) && Number.isFinite(sums.noiseB);
        const appeared = measurable && Math.abs(sums.sumA) < 2 * sums.noiseA && sums.sumB >= 5 * sums.noiseB;
        const disappeared = measurable && Math.abs(sums.sumB) < 2 * sums.noiseB && sums.sumA >= 5 * sums.noiseA;
        if (isCrowded) {
            c.kind = 'unknown';
            c.reason = `The two visits differ here, in a crowded field; nearby sources make the cause uncertain (${snrText(c.snr)}; candidate).`;
        } else if (multiBlend && !isBlended && !opposite) {
            c.kind = 'unknown';
            c.reason = `The two visits differ near brighter catalogue stars whose light overlaps here, so this reading may be their light (${snrText(c.snr)}; candidate).`;
        } else if (neighbour) {
            c.kind = 'unknown';
            c.reason = `The two visits differ ${distance(b.pix, neighbour, grid).toFixed(1)}″ from a brighter catalogue star whose light overlaps here, so this reading may be that star's light (${snrText(c.snr)}; candidate).`;
        } else if (uncertainNeighbour(star) && !isBlended) {
            c.kind = 'unknown';
            c.reason = `The two visits differ here, beside catalogue stars; a small image shift could also cause this (${snrText(c.snr)}; candidate).`;
        } else if (mismatch && star && !isBlended) {
            c.kind = 'unknown';
            c.reason = `The two visits differ here (${snrText(c.snr)}; candidate).`;
        } else if (b.sign === 1 && appeared) {
            c.kind = 'unknown';
            c.reading = 'laterOnly';
            c.reason = `Light here in the later visit; the earlier visit shows none above its noise (${snrText(c.snr)}; candidate).`;
        } else if (b.sign === -1 && disappeared) {
            c.kind = 'unknown';
            c.reading = 'earlierOnly';
            c.reason = `Light here in the earlier visit; the later visit shows none above its noise (${snrText(c.snr)}; candidate).`;
        } else if (!isBlended && !mismatch && !wing && !opposite && floor !== undefined) {
            if (c.gaiaMatch) { c.reading = direction; }
            const narrow = narrowChange(diff, b.pix, b.sign, grid);
            const sharpness = sharpnessChanged(earlier.data, later.data, star ?? b.pix, grid);
            if (sharpness) {
                c.kind = 'unknown';
                c.reason = c.gaiaMatch
                    ? `A catalogue star here reads ${direction} in the later visit; its image profile differs between visits, and a sharper image or a nearby change could also cause this (${snrText(c.snr)}; candidate).`
                    : `The two visits differ here; the image profile differs between visits, and a sharper image or a nearby change could also cause this (${snrText(c.snr)}; candidate).`;
            } else if (narrow === undefined || sharpness === undefined) {
                c.kind = 'unknown';
                const cause = earlierUnclipped || laterUnclipped ? 'a sharper image or a single-frame hit' : 'a sharper image or another source on top of the star';
                c.reason = c.gaiaMatch
                    ? `A catalogue star here reads ${direction} in the later visit; ${cause} could also cause this (${snrText(c.snr)}; candidate).`
                    : `The two visits differ here; ${earlierUnclipped || laterUnclipped ? 'a sharper image or a single-frame hit' : 'a sharper image or a nearby source'} could also cause this (${snrText(c.snr)}; candidate).`;
            }
        } else if (isBlended) {
            c.kind = 'unknown';
            if (opposite) {
                pairedKept.add(opposite);
                c.reading = 'pair';
                c.ends = [b, opposite].map((spot) => ({ visit: spot.sign === 1 ? 'later' as const : 'earlier' as const,
                    ...spot.pix, radiusPix: CORE_ARCSEC / grid.pixelArcsec })).sort((a, b) => a.visit.localeCompare(b.visit));
            }
            c.reason = `${b.sign === 1 ? 'Brighter' : 'Fainter'} at this catalogue star and the opposite at a nearby one: either both `
                + `stars changed, a source moved between them, or a small image shift caused this (${snrText(c.snr)}; candidate).`;
        } else if (opposite) {
            c.kind = 'unknown';
            pairedKept.add(opposite);
            c.reading = 'pair';
            c.ends = [b, opposite].map((spot) => ({ visit: spot.sign === 1 ? 'later' as const : 'earlier' as const,
                ...spot.pix, radiusPix: 12 / grid.pixelArcsec })).sort((a, b) => a.visit.localeCompare(b.visit));
            c.reason = `${b.sign === 1 ? 'Brighter' : 'Fainter'} at ${c.gaiaMatch ? 'this catalogue star' : 'this spot'}, with a `
                + `${opposite.sign === 1 ? 'brighter' : 'fainter'} spot ${distance(b.pix, opposite.pix, grid).toFixed(1)}″ away: `
                + `either ${c.gaiaMatch ? 'the star' : 'a source'} changed, a source moved between them, or a small image shift caused this (${snrText(c.snr)}; candidate).`;
        } else {
            c.kind = 'unknown';
            c.reason = `The two visits differ here (${snrText(c.snr)}; candidate).`;
        }
        result.candidates.push(c);
    });
    const candidates = result.candidates;
    candidates.forEach((c) => {
        if (c.reading !== 'pair' && c.reading !== 'moved' && !c.reason.startsWith('A weaker change near a stronger change')
            && !c.reason.startsWith('The two visits differ here, near')
            && candidates.some((stronger) => stronger !== c && stronger.snr >= 5 * c.snr
                && distance(c.pix, stronger.pix, grid) <= 2 * PSF_FWHM)) {
            c.kind = 'unknown';
            c.reason = `A weaker change near a stronger change; it may be related or a separate source (${snrText(c.snr)}; candidate).`;
        }
    });
    // A spot with no catalogue star of its own, near a catalogue change or an opposite spot, may be part of
    // that star's residual. Keep it, but describe the measured proximity rather than
    // "no catalogue star here" or "appeared".
    result.candidates.forEach((c) => {
        if (c.gaiaMatch || c.reading === 'pair' || c.reading === 'moved') {
            return;
        }
        if (c.reason.includes('from a brighter catalogue star whose light overlaps here')
            || c.reason.startsWith('The two visits differ here, near')
            || c.reason.startsWith('A weaker change near a stronger change')) {
            return;
        }
        const star = stars.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y)
            && distance(c.pix, s, grid) <= opt.dipoleArcsec)
            .sort((a, b) => distance(c.pix, a, grid) - distance(c.pix, b, grid))[0];
        if (!star) {
            return;
        }
        const changed = result.candidates.some((o) => o !== c && o.gaiaMatch && o.kind !== 'mover'
            && !o.reason.startsWith('A weaker change near a stronger change')
            && !o.reason.startsWith('The two visits differ here, near')
            && distance(o.pix, star, grid) <= opt.matchArcsec);
        const shifted = result.candidates.some((o) => o !== c && o.sign !== c.sign
            && distance(o.pix, star, grid) <= opt.dipoleArcsec);
        if (changed || shifted) {
            c.kind = 'unknown';
            c.reason = `The two visits differ ${distance(c.pix, star, grid).toFixed(1)}″ from a catalogue star ${changed ? 'that also shows a difference' : 'with an opposite difference near that star'}; `
                + `this spot may be part of that star's image (${snrText(c.snr)}; candidate).`;
        }
    });
    if (smallChanges > 0) {
        result.notes.push(`${smallChanges} small ${smallChanges === 1 ? 'difference' : 'differences'} at catalogue stars ${smallChanges === 1 ? 'is' : 'are'} not listed.`);
    }
    if (smallUncatalogued > 0) {
        result.notes.push(`${smallUncatalogued} small ${smallUncatalogued === 1 ? 'difference is' : 'differences are'} not listed.`);
    }
    if (wobble > 0) {
        result.notes.push(`${wobble} ${wobble === 1 ? 'spot' : 'spots'} consistent with a shift of up to 1.5″ between visits not listed.`);
    }
    result.candidates.forEach((c) => {
        if (caveat) { c.caveat = caveat; }
    });
    if (centerChecked && centerBlank && !result.candidates.some((c) => distance(c.pix, center, grid) <= opt.matchArcsec)) {
        result.notes.push('No source above 5 times the noise at the centre of the view in either visit.');
    }
    const finished = finish(result, opt, singleFrame, measurement.usedErrorMap);
    return { ...finished, visits, candidates: finished.candidates.map((c) => {
        const ends = c.ends ?? [{ visit: c.sign === 1 ? 'later' as const : 'earlier' as const,
            x: c.pix.x, y: c.pix.y, radiusPix: c.radiusPix ?? 12 / grid.pixelArcsec }];
        return { ...c, sentence: c.reason, reading: c.reading ?? 'differs', ends,
            nearCatalogue: ends.some((end) => match(end, stars, grid, opt.matchArcsec) !== undefined),
            ...(ends.length > 1 ? { lightEnds: ends } : {}),
            lightVisit: c.sign === 1 ? 'later' as const : 'earlier' as const,
            x: c.pix.x, y: c.pix.y, radiusPix: c.radiusPix ?? 12 / grid.pixelArcsec };
    }) };
}

type Point = { mjd: number; blob: Blob; obsId: string; templateId: string };
// How far a track point may sit from the fitted line: 4 times its own centroid error (PSF FWHM / (2.35 S/N)),
// at least 1.5″ for regrid leftovers, at most lineTolArcsec. A flat tolerance let random spots line up.
function pointTolerance(snr: number, lineTolArcsec: number): number
{
    return Math.min(lineTolArcsec, Math.max(1.5, 4 * PSF_FWHM / (2.35 * Math.max(snr, 1e-6))));
}

function fit(points: Point[], grid: OutputGrid, lineTolArcsec = Infinity): { speed: number; pa: number; residual: number; excess: number; worst: number } | undefined
{
    const base = points[0]!.mjd;
    const times = points.map((p) => (p.mjd - base) * 24);
    const t = times.reduce((a, b) => a + b, 0) / times.length;
    const x = points.reduce((a, p) => a + p.blob.pix.x, 0) / points.length;
    const y = points.reduce((a, p) => a + p.blob.pix.y, 0) / points.length;
    let den = 0, vx = 0, vy = 0;
    points.forEach((p, i) => {
        const dt = times[i]! - t;
        den += dt * dt;
        vx += dt * (p.blob.pix.x - x);
        vy += dt * (p.blob.pix.y - y);
    });
    if (den <= 0) {
        return undefined;
    }
    vx /= den;
    vy /= den;
    let residual = 0, excess = 0, worst = 0;
    points.forEach((p, i) => {
        const dt = times[i]! - t;
        const d = Math.hypot(p.blob.pix.x - x - vx * dt, p.blob.pix.y - y - vy * dt) * grid.pixelArcsec;
        residual = Math.max(residual, d);
        const ratio = d / pointTolerance(p.blob.snr, lineTolArcsec);
        if (ratio > excess) {
            excess = ratio;
            worst = i;
        }
    });
    return { speed: Math.hypot(vx, vy) * grid.pixelArcsec,
        pa: (Math.atan2(-vx, -vy) * 180 / Math.PI + 360) % 360, residual, excess, worst };
}

export function findTracklets(visit: RegriddedFrame[], templates: RegriddedFrame[], grid: OutputGrid,
    stars: StarPix[], opts?: ChangeOptions): ChangeResult
{
    const opt = settings(opts), result = empty(opt), groups: Point[][] = [], sigmas: number[] = [], areas: number[] = [];
    for (const frame of [...visit, ...templates]) {
        if (!sameGrid(frame.grid, grid)) {
            throw new Error('Frame output grid differs from requested grid');
        }
        validate(frame.data, grid);
    }
    const timed = (f: RegriddedFrame): boolean => Number.isFinite((f.frame.tMin + f.frame.tMax) / 2);
    const untimed = [...visit, ...templates].filter((f) => !timed(f)).length;
    if (untimed) {
        result.notes.push(`${untimed} ${untimed === 1 ? 'frame' : 'frames'} without a time ${untimed === 1 ? 'was' : 'were'} left out.`);
    }
    const timedTemplates = templates.filter(timed);
    const seenIds = new Set<string>(), seenTimes = new Set<number>();
    const uniqueVisit = visit.filter(timed).sort((a, b) => a.frame.tMin - b.frame.tMin).filter((frame) => {
        if (seenIds.has(frame.frame.obsId) || seenTimes.has(frame.frame.tMin)) { return false; }
        seenIds.add(frame.frame.obsId); seenTimes.add(frame.frame.tMin); return true;
    });
    if (uniqueVisit.length < 3) { result.notes.push('Tracklets need at least 3 frames.'); }
    for (const frame of uniqueVisit) {
        const template = timedTemplates.filter((t) => Math.abs(t.frame.tMin - frame.frame.tMin) >= 5
            && Number.isFinite(t.lambdaAtCenter) && Number.isFinite(frame.lambdaAtCenter))
            .sort((a, b) => Math.abs(a.lambdaAtCenter - frame.lambdaAtCenter) - Math.abs(b.lambdaAtCenter - frame.lambdaAtCenter))[0];
        if (!template || !wavelengthsMatch(template.lambdaAtCenter, frame.lambdaAtCenter, opt.maxDeltaLambda)) {
            result.skipped.push({ obsId: frame.frame.obsId, reason: `No template at least 5 days away within ${opt.maxDeltaLambda} µm.` });
            continue;
        }
        const diff = difference(template.data, frame.data, grid);
        let finite = 0;
        for (let i = 0; i < diff.length; i++) {
            if (Number.isFinite(diff[i]!)) {
                finite++;
            }
        }
        areas.push(finite * grid.pixelArcsec * grid.pixelArcsec);
        const { found } = blobs(diff, grid, opt, result, 2);
        if (Number.isFinite(result.sigma)) {
            sigmas.push(result.sigma);
        }
        result.rejected.edge += found.filter((b) => b.edge).length;
        const spots = found.filter((b) => !b.edge && b.sign === 1 && match(b.pix, stars, grid, opt.matchArcsec) === undefined)
            .sort((a, b) => b.snr - a.snr);
        const cap = Math.max(0, Math.floor(opt.maxSpotsPerFrame));
        if (spots.length > cap && !result.notes.includes(`Spots limited to ${cap} brightest per frame for linking.`)) {
            result.notes.push(`Spots limited to ${cap} brightest per frame for linking.`);
        }
        groups.push(spots.slice(0, cap)
            .map((blob) => ({ mjd: frame.frame.tMin, blob, obsId: frame.frame.obsId, templateId: template.frame.obsId })));
    }
    result.sigma = median(sigmas);
    if (result.skipped.length) {
        result.notes.push(`${result.skipped.length} ${result.skipped.length === 1 ? 'frame' : 'frames'} skipped: no template at least 5 days away within ${opt.maxDeltaLambda} µm.`);
    }
    // Expected number of 3-frame lines that random spots would make by chance: every pair of spots in two frames
    // that has an allowed speed, times the chance that a spot in a third frame falls within its tolerance of the
    // predicted place. When that is not small, a track needs 4 frames.
    let chanceLines = 0;
    for (let a = 0; a < groups.length; a++) {
        for (let b = a + 1; b < groups.length; b++) {
            let pairs = 0;
            for (const first of groups[a]!) {
                for (const second of groups[b]!) {
                    const dt = (second.mjd - first.mjd) * 24;
                    const speed = dt > 0 ? distance(first.blob.pix, second.blob.pix, grid) / dt : NaN;
                    if (speed >= opt.minSpeedArcsecPerHour && speed <= opt.maxSpeedArcsecPerHour) {
                        pairs++;
                    }
                }
            }
            for (let c = a + 1; c < b; c++) {
                if (areas[c]! > 0) {
                    chanceLines += pairs * groups[c]!.reduce((sum, p) => sum + Math.PI
                        * pointTolerance(p.blob.snr, opt.lineTolArcsec) ** 2, 0) / areas[c]!;
                }
            }
        }
    }
    const minPoints = chanceLines > 0.1 ? 4 : 3;
    if (minPoints === 4) {
        result.notes.push(`Many spots per frame: random spots would make about ${chanceLines.toFixed(1)} 3-frame lines by chance, so tracks here need at least 4 frames.`);
    }
    const tracks: Point[][] = [];
    for (let a = 0; a < groups.length; a++) {
        for (let b = a + 1; b < groups.length; b++) {
            for (const first of groups[a]!) {
                for (const second of groups[b]!) {
                    const dt = (second.mjd - first.mjd) * 24;
                    if (dt <= 0) {
                        continue;
                    }
                    const speed = distance(first.blob.pix, second.blob.pix, grid) / dt;
                    if (speed < opt.minSpeedArcsecPerHour || speed > opt.maxSpeedArcsecPerHour) {
                        continue;
                    }
                    const points = [first, second];
                    for (let c = 0; c < groups.length; c++) {
                        if (c === a || c === b) {
                            continue;
                        }
                        const ratio = (groups[c]![0]?.mjd ?? first.mjd) - first.mjd;
                        const pred = { x: first.blob.pix.x + (second.blob.pix.x - first.blob.pix.x) * ratio / (second.mjd - first.mjd),
                            y: first.blob.pix.y + (second.blob.pix.y - first.blob.pix.y) * ratio / (second.mjd - first.mjd) };
                        let nearest: Point | undefined, best = opt.lineTolArcsec * 2;
                        for (const point of groups[c]!) {
                            const d = distance(point.blob.pix, pred, grid);
                            if (d < best) {
                                best = d;
                                nearest = point;
                            }
                        }
                        if (nearest) {
                            points.push(nearest);
                        }
                    }
                    points.sort((p, q) => p.mjd - q.mjd);
                    let motion = fit(points, grid, opt.lineTolArcsec);
                    while (points.length > minPoints && motion && motion.excess > 1) {
                        points.splice(motion.worst, 1);
                        motion = fit(points, grid, opt.lineTolArcsec);
                    }
                    if (points.length >= minPoints && motion && motion.excess <= 1
                        && motion.speed >= opt.minSpeedArcsecPerHour && motion.speed <= opt.maxSpeedArcsecPerHour
                        && distance(points[0]!.blob.pix, points[points.length - 1]!.blob.pix, grid) >= NATIVE
                        && distance(points[0]!.blob.pix, points[points.length - 1]!.blob.pix, grid) >= 3 * Math.hypot(
                            PSF_FWHM / (2.35 * points[0]!.blob.snr), PSF_FWHM / (2.35 * points[points.length - 1]!.blob.snr))
                        && Math.max(...points.map((p) => p.blob.snr)) <= 3 * Math.min(...points.map((p) => p.blob.snr))) {
                        tracks.push(points);
                    }
                }
            }
        }
    }
    tracks.sort((a, b) => b.length - a.length || b.reduce((s, p) => s + p.blob.snr, 0) - a.reduce((s, p) => s + p.blob.snr, 0));
    const used = new Set<Point>();
    for (const points of tracks) {
        if (points.some((p) => used.has(p))) {
            continue;
        }
        points.forEach((p) => used.add(p));
        const motion = fit(points, grid)!;
        const peak = points.reduce((a, b) => a.blob.snr >= b.blob.snr ? a : b);
        const c = candidate(peak.blob, grid, [], opt, [...new Set(points.flatMap((p) => [p.obsId, p.templateId]))]);
        c.kind = 'mover';
        c.speedArcsecPerHour = motion.speed;
        c.paDeg = motion.pa;
        c.track = points.map((p) => ({ mjd: p.mjd, pix: p.blob.pix }));
        c.reason = `Light in ${points.length} frames lies along a straight line at about ${Math.round(motion.speed)}″ per hour, as a moving source or aligned frame hits would (${snrText(c.snr)}; candidate).`;
        result.candidates.push(c);
    }
    // Track spots are measured against difference-image noise only, so their S/N is not printed either.
    if (result.candidates.length > 0) {
        result.notes.push(`Noise from the difference images only. ${NO_SNR_NOTE}`);
    }
    return finish(result, opt, false, false);
}
