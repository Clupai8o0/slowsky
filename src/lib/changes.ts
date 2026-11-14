// Callers must pass stars at both visit dates (join gaia.ts ringsAt results), with the same optional id at each date.
// Gaia coordinates are for 2016; proper motion otherwise moves stars far off.
// Candidate counts are not science numbers. S/N uses background noise only;
// displayed S/N is capped at "S/N > 50".
import { gridPixToSky } from './regrid';
import type { OutputGrid, PixelCoord, RegriddedFrame, SkyCoord } from './types';

export type ChangeKind = 'mover' | 'brightness' | 'unknown';
export interface StarPix { x: number; y: number; id?: string; }
export interface ChangeCandidate {
    id: string;
    kind: ChangeKind;
    pix: PixelCoord;
    sky: SkyCoord;
    snr: number;
    sign: 1 | -1;
    gaiaMatch: boolean;
    gaiaDistArcsec?: number;
    fracChange?: number;
    frames: string[];
    speedArcsecPerHour?: number;
    paDeg?: number;
    track?: { mjd: number; pix: PixelCoord }[];
    reason: string;
}
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
type Blob = { pix: PixelCoord; snr: number; sign: 1 | -1; area: number; edge: boolean };
type Measurement = { z: Float32Array; background: Float32Array; sigma: number; k: number; width: number; height: number };
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
    const sigma = median(localSigmas);
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
    const side = (2 * half + 1) ** 2;
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
                        const similarity = Math.min(n / base, base / n) ** 2;
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
            const level = interpolate(centers);
            background[y * width + x] = Number.isFinite(level) ? level : 0;
            z[y * width + x] = Number.isFinite(value) && noise > 0 ? (value - level) / noise : NaN;
        }
    }
    return { z, background, sigma, k, width, height };
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

function blobs(diff: Float32Array, grid: OutputGrid, opt: Settings, result: ChangeResult, support = 3.75,
    varSum?: Float32Array): Blob[]
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
            for (let dy = -edge; dy <= edge && !nearEdge; dy++) {
                for (let dx = -edge; dx <= edge; dx++) {
                    if (dx * dx + dy * dy <= edge * edge && !Number.isFinite(m.z[(y + dy) * m.width + x + dx]!)) {
                        nearEdge = true;
                        break;
                    }
                }
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
        if (queue.length < 2 || queue.length * (m.k * grid.pixelArcsec) ** 2 < opt.minAreaArcsec2) {
            result.rejected.single++;
            continue;
        }
        const cx = sx / weight, cy = sy / weight;
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
            : { x: cx * m.k + (m.k - 1) / 2, y: cy * m.k + (m.k - 1) / 2 }, snr: peak, sign, area: queue.length, edge: nearEdge });
    }
    return out;
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

function finish(result: ChangeResult, opt: Settings, singleFrame = false): ChangeResult
{
    result.candidates.sort((a, b) => (singleFrame ? Number(b.gaiaMatch) - Number(a.gaiaMatch) : 0)
        || b.snr - a.snr || a.pix.y - b.pix.y || a.pix.x - b.pix.x);
    result.candidates = result.candidates.slice(0, Math.max(0, opt.maxCandidates));
    result.candidates.forEach((c, i) => { c.id = `c${i + 1}`; });
    return result;
}

function snrText(snr: number): string
{
    return snr > 50 ? 'S/N > 50' : `S/N ${snr.toFixed(1)}`;
}

function candidate(blob: Blob, grid: OutputGrid, stars: StarPix[], opt: Settings, frames: string[]): ChangeCandidate
{
    const dist = match(blob.pix, stars, grid, opt.matchArcsec);
    const kind: ChangeKind = dist === undefined ? 'unknown' : 'brightness';
    return { id: '', kind, pix: blob.pix, sky: gridPixToSky(grid, blob.pix), snr: blob.snr, sign: blob.sign,
        gaiaMatch: dist !== undefined, ...(dist === undefined ? {} : { gaiaDistArcsec: dist }), frames,
        reason: kind === 'brightness'
            ? `A catalogue star here is ${blob.sign === 1 ? 'brighter' : 'fainter'} than in the earlier image, at ${snrText(blob.snr)} (candidate).`
            : `Changed at ${snrText(blob.snr)} with no catalogue star here (candidate).` };
}

function sourceCentroid(data: Float32Array, center: PixelCoord, grid: OutputGrid): PixelCoord | undefined
{
    const radius = 12 / grid.pixelArcsec;
    const ring: number[] = [];
    for (let y = Math.max(0, Math.floor(center.y - 3 * radius)); y <= Math.min(grid.height - 1, Math.ceil(center.y + 3 * radius)); y++) {
        for (let x = Math.max(0, Math.floor(center.x - 3 * radius)); x <= Math.min(grid.width - 1, Math.ceil(center.x + 3 * radius)); x++) {
            const d = Math.hypot(x - center.x, y - center.y), v = data[y * grid.width + x]!;
            if (d >= 2 * radius && d <= 3 * radius && Number.isFinite(v)) { ring.push(v); }
        }
    }
    if (ring.length < 20) { return undefined; }
    const background = median(ring);
    let sx = 0, sy = 0, sum = 0;
    for (let y = Math.max(0, Math.floor(center.y - radius)); y <= Math.min(grid.height - 1, Math.ceil(center.y + radius)); y++) {
        for (let x = Math.max(0, Math.floor(center.x - radius)); x <= Math.min(grid.width - 1, Math.ceil(center.x + radius)); x++) {
            if (Math.hypot(x - center.x, y - center.y) > radius) { continue; }
            const value = data[y * grid.width + x]! - background;
            if (Number.isFinite(value) && value > 0) { sx += x * value; sy += y * value; sum += value; }
        }
    }
    return sum > 0 ? { x: sx / sum, y: sy / sum } : undefined;
}

// Background-subtracted aperture sums in both images and the earlier sum's noise; undefined when the
// aperture or its 24-36″ ring cannot be measured.
function apertureSums(earlier: Float32Array, later: Float32Array, pix: PixelCoord, grid: OutputGrid,
    apertureArcsec = 12): { sumA: number; sumB: number; noise: number } | undefined
{
    const radius = apertureArcsec / grid.pixelArcsec, ring = 24 / grid.pixelArcsec;
    const ringA: number[] = [], ringB: number[] = [];
    let sumA = 0, sumB = 0, count = 0;
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
            if (!Number.isFinite(a) || !Number.isFinite(b)) {
                if (weight > 0) {
                    return undefined;
                }
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
    if (count === 0 || ringA.length < 20) {
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
    const noise = backgroundA.sigma * Math.sqrt(count) * k;
    return { sumA, sumB, noise };
}

function fractionalChange(earlier: Float32Array, later: Float32Array, pix: PixelCoord, grid: OutputGrid,
    apertureArcsec = 12): number | undefined
{
    const sums = apertureSums(earlier, later, pix, grid, apertureArcsec);
    if (!sums) {
        return undefined;
    }
    const { sumA, sumB, noise } = sums;
    if (!(sumA > 0) || !(sumB > 0) || !(noise > 0) || !Number.isFinite(noise) || sumA < 5 * noise) {
        return undefined;
    }
    const frac = (sumB - sumA) / sumA;
    return Number.isFinite(frac) && frac >= -1 ? frac : undefined;
}

export function compareVisits(earlier: Image, later: Image, grid: OutputGrid, stars: StarPix[], opts?: ChangeOptions): ChangeResult
{
    const opt = settings(opts), result = empty(opt);
    const diff = difference(earlier.data, later.data, grid);
    const wavelength = (value: number): string => Number.isFinite(value) ? `${value.toFixed(3)} µm` : 'unknown';
    result.notes.push(`Wavelengths: ${wavelength(earlier.lambda)} and ${wavelength(later.lambda)}.`);
    const singleFrame = earlier.obsIds.length === 1 || later.obsIds.length === 1;
    const warning = 'each visit is one frame; artefacts not ruled out';
    if (singleFrame) { result.notes.push(warning); }
    if (!wavelengthsMatch(earlier.lambda, later.lambda, opt.maxDeltaLambda)) {
        result.skipped = later.obsIds.map((obsId) => ({ obsId, reason: `No earlier image within ${opt.maxDeltaLambda} µm.` }));
        result.notes.push(`${later.obsIds.length} frames skipped: no earlier image within ${opt.maxDeltaLambda} µm.`);
        return result;
    }
    let varSum: Float32Array | undefined;
    if ((earlier.variance && earlier.variance.length !== diff.length)
        || (later.variance && later.variance.length !== diff.length)) {
        throw new Error('Variance input length does not match output grid');
    }
    if (earlier.variance && later.variance) {
        varSum = new Float32Array(diff.length);
        for (let i = 0; i < varSum.length; i++) {
            varSum[i] = earlier.variance[i]! + later.variance[i]!;
        }
        result.notes.push('Noise from the frames\' own error maps.');
    } else if (earlier.variance || later.variance) {
        result.notes.push('Error map on only one visit; noise from the difference image only.');
    } else {
        result.notes.push('Noise from the difference image only (no error maps given): a small patch of extra noise can show up as false change candidates.');
    }
    const found = blobs(diff, grid, opt, result, 3.75, varSum);
    const used = new Set<number>();
    const nearestStar = (p: PixelCoord): StarPix | undefined => stars
        .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && distance(p, s, grid) <= opt.matchArcsec)
        .sort((a, b) => distance(p, a, grid) - distance(p, b, grid))[0];
    if (stars.some((s) => s.id === undefined)) {
        result.notes.push('Catalogue stars have no ids: two nearby catalogue stars that change in opposite ways can look like one mover.');
    }
    // With an id on either entry the ids decide (an entry without one comes from another list, so another star).
    // Position alone would merge two stars 5″ apart, one with an id, and let their swap pass as a mover.
    const sameStar = (a: StarPix, b: StarPix): boolean => a.id !== undefined || b.id !== undefined
        ? a.id === b.id : distance(a, b, grid) <= opt.matchArcsec;
    // Two catalogue stars that change in opposite ways within 2 FWHM (the 12″ aperture plus the neighbour's
    // wings) cancel in the measured fraction, so that fraction is not measurable. Steady neighbours do not count: they subtract out. Nor does a much
    // weaker spot (a shadow, 5x rule below) or one inside the same PSF core (a close pair such as RW Aur A/B
    // cannot be split, and the change is measured for both together).
    // The neighbour counts only when its own core changed by the floor: a common wobble of two steady stars
    // gives two opposite spots on two ids, but no core change, so it is not a blend (Opus High 1).
    const blended = (blob: Blob, star: StarPix): boolean => found.some((other) => {
        if (other === blob || other.sign === blob.sign
            || other.snr * 5 < blob.snr || distance(other.pix, blob.pix, grid) < PSF_FWHM / 2) {
            return false;
        }
        const otherStar = nearestStar(other.pix);
        if (otherStar === undefined || sameStar(otherStar, star) || distance(otherStar, star, grid) > 2 * PSF_FWHM) {
            return false;
        }
        const otherFrac = fractionalChange(earlier.data, later.data, otherStar, grid, CORE_ARCSEC);
        return otherFrac !== undefined && Math.abs(otherFrac) >= opt.minFracChange;
    });
    // The fraction the floor is judged on: the 12″ aperture, or for a blend the 6″ core, which the neighbour
    // reaches less. A blend's core fraction is still not quoted (part of it is the neighbour).
    const floorFrac = (star: StarPix | PixelCoord, isBlended: boolean): number | undefined => isBlended
        ? fractionalChange(earlier.data, later.data, star, grid, CORE_ARCSEC)
        : fractionalChange(earlier.data, later.data, star, grid);
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
            const blocked = positiveStar !== undefined && negativeStar !== undefined && !sameStar(positiveStar, negativeStar)
                && (positiveStar.id !== undefined || negativeStar.id !== undefined);
            if (d <= opt.dipoleArcsec && Math.max(positive.area, negative.area) <= 3 * Math.min(positive.area, negative.area)) {
                partners.push({ j, d, blocked, same: positiveStar !== undefined && negativeStar !== undefined
                    && positiveStar.id !== undefined && positiveStar.id === negativeStar.id });
            }
        }
        partners.sort((a, b) => Number(b.same) - Number(a.same) || Number(a.blocked) - Number(b.blocked) || a.d - b.d);
        for (const { j, blocked: onTwoStars } of partners) {
            const negative = found[j]!;
            if (positive.edge || negative.edge) {
                continue;
            }
            const center = { x: (positive.pix.x + negative.pix.x) / 2, y: (positive.pix.y + negative.pix.y) / 2 };
            const before = sourceCentroid(earlier.data, center, grid), after = sourceCentroid(later.data, center, grid);
            const shift = before && after ? distance(before, after, grid) : 0;
            const uncertainty = Math.hypot(PSF_FWHM / (2.35 * positive.snr), PSF_FWHM / (2.35 * negative.snr));
            if (shift < opt.minShiftArcsec || shift < 3 * uncertainty) {
                continue;
            }
            // Two fixed stars keep the light centre between them, give or take the wobble. A shift beyond that
            // (a source crossing a pair 0.5″ apart, Argon M5) is a mover; within it, the either/or (Codex round 7:
            // a 2.9″ pair swapping 3000/30 under a 1.4″ wobble shifts 3.4″).
            const blocked = onTwoStars
                && shift <= distance(positiveStar!, nearestStar(negative.pix)!, grid) + WOBBLE_ARCSEC;
            used.add(i);
            used.add(j);
            const c = candidate(positive, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]);
            if (blocked) {
                // Spots on two catalogue stars: a source moving from one to the other and the two stars changing
                // the opposite way give the same difference image under ordinary registration wobble. A two-PSF
                // fit could not tell them apart (round 5 review: 8-44 false movers in 135), so do not choose.
                const apart = distance(positiveStar!, nearestStar(negative.pix)!, grid);
                c.kind = 'unknown';
                c.reason = `Either a source moved between two catalogue stars ${apart.toFixed(1)}″ apart, or one got brighter `
                    + `and the other fainter; these look the same here (${snrText(c.snr)}; candidate).`;
            } else {
                c.kind = 'mover';
                c.reason = `Source centroids shifted ${shift.toFixed(1)}″ between visits (${snrText(c.snr)}; candidate).`;
            }
            result.candidates.push(c);
            break;
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
        const star = nearestStar(blob.pix);
        if (star) {
            const frac = floorFrac(star, blended(blob, star));
            if (frac !== undefined && Math.abs(frac) < opt.minFracChange) {
                used.add(i); result.rejected.residual++;
            }
        }
    });
    // Spots that survive the floor. A pair on two catalogue stars that passed the shift test is the either/or
    // candidate above; a spot whose partner failed it is judged here like any other (blend, crowd, edge rules).
    const kept = found.map((b, i) => {
        if (used.has(i)) {
            return undefined;
        }
        const star = nearestStar(b.pix);
        const isBlended = star !== undefined && blended(b, star);
        const floor = floorFrac(b.pix, isBlended);
        const mismatch = floor !== undefined && Math.sign(floor) !== b.sign;
        if (floor !== undefined && !mismatch && Math.abs(floor) < opt.minFracChange) {
            result.rejected.residual++;
            return undefined;
        }
        return { b, star, isBlended, floor, mismatch };
    });
    // Peak above the local background (24-36″ ring) in one image, to compare a star with its neighbours.
    const level = (p: PixelCoord, data: Float32Array): number => {
        const x = Math.round(p.x), y = Math.round(p.y);
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
            return NaN;
        }
        const inner = 24 / grid.pixelArcsec, outer = 36 / grid.pixelArcsec, ring: number[] = [];
        for (let j = Math.max(0, Math.floor(p.y - outer)); j <= Math.min(grid.height - 1, Math.ceil(p.y + outer)); j++) {
            for (let i = Math.max(0, Math.floor(p.x - outer)); i <= Math.min(grid.width - 1, Math.ceil(p.x + outer)); i++) {
                const r = Math.hypot(i - p.x, j - p.y), v = data[j * grid.width + i]!;
                if (r >= inner && r <= outer && Number.isFinite(v)) {
                    ring.push(v);
                }
            }
        }
        return ring.length ? data[y * grid.width + x]! - median(ring) : NaN;
    };
    // Another catalogue star 6-24″ away with at least NEIGHBOUR of this one's peak puts its own light (and its
    // wobble) in the 12″ aperture, so the fraction is not this star's alone (Opus round 6 High 1 and 2: 13% on
    // a steady star, 35% for a 50% change). A neighbour inside the 6″ core is measured together with it (a
    // close pair such as RW Aur A/B), as the blend rule does. Each peak includes the other's wing; the 12″ PSF
    // model splits the two. A peak that cannot be measured counts as crowded. Both visits are checked: a faint
    // neighbour that brightens is in the later aperture (Codex round 7: "80% brighter" for a 50% change).
    const NEIGHBOUR = 0.25;
    // Neighbours add up: two at 0.2 each dilute like one at 0.4 (Codex round 7: 39% quoted for a 50% change).
    // A star listed once per visit (two entries, one id) counts once: its largest share is kept (Codex round 7).
    const crowdedIn = (star: StarPix, data: Float32Array): boolean => {
        const own = level(star, data), sigma = PSF_FWHM / 2.35482;
        const byId = new Map<string, number>();
        let share = 0;
        for (const s of stars) {
            if (s === star || !Number.isFinite(s.x) || !Number.isFinite(s.y) || sameStar(s, star)) {
                continue;
            }
            const d = distance(s, star, grid);
            if (d < CORE_ARCSEC || d > 2 * PSF_FWHM) {
                continue;
            }
            const g = Math.exp(-(d * d) / (2 * sigma * sigma)), other = level(s, data);
            const mine = (own - g * other) / (1 - g * g), theirs = (other - g * own) / (1 - g * g);
            const ratio = theirs / mine;
            if (!Number.isFinite(ratio) || !(mine > 0)) {
                return true;
            }
            if (s.id === undefined) {
                share += Math.max(0, ratio);
            } else {
                byId.set(s.id, Math.max(byId.get(s.id) ?? 0, ratio));
            }
        }
        for (const ratio of byId.values()) {
            share += ratio;
        }
        return !(share < NEIGHBOUR);
    };
    const crowded = (star: StarPix): boolean => crowdedIn(star, earlier.data) || crowdedIn(star, later.data);
    kept.forEach((k) => {
        if (!k) {
            return;
        }
        const { b, star, isBlended, floor, mismatch } = k;
        // No star of its own but one within 2 FWHM: the earlier light in the aperture may be that star's wing, so
        // quote no percentage and do not say "appeared" (round 6 item 3).
        const wing = star === undefined && stars.some((s) => Number.isFinite(s.x) && Number.isFinite(s.y)
            && distance(b.pix, s, grid) <= 2 * PSF_FWHM);
        // An opposite spot within dipoleArcsec dropped at the edge (G1), or, for a spot with no catalogue star,
        // any unpaired opposite spot within 2 FWHM (a source that moved 16-22″, Argon M4): the earlier light here
        // may be that source's, so quote no percentage and do not say "appeared".
        const opposite = found.some((o) => o !== b && o.sign !== b.sign && (o.edge
            ? distance(o.pix, b.pix, grid) <= opt.dipoleArcsec
            : star === undefined && distance(o.pix, b.pix, grid) <= 2 * PSF_FWHM));
        const crowd = star !== undefined && crowded(star);
        const signMismatch = mismatch && !isBlended;
        const frac = isBlended || mismatch || wing || opposite || crowd ? undefined : floor;
        const c = candidate(b, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]);
        if (frac !== undefined) {
            c.fracChange = frac;
            const change = `${Math.round(Math.abs(frac) * 100)}% ${frac >= 0 ? 'brighter' : 'fainter'}`;
            c.reason = c.kind === 'brightness'
                ? `A catalogue star here is ${change} than in the earlier image (candidate).`
                : `A source here is ${change} than in the earlier image, with no catalogue star here (candidate).`;
        } else if (isBlended) {
            // Opposite spots on two nearby stars: both changing and a source moving between them look alike.
            c.kind = 'unknown';
            c.reason = `${b.sign === 1 ? 'Brighter' : 'Fainter'} at this catalogue star and the opposite at a nearby one: either both `
                + `stars changed or a source moved between them; by how much could not be measured (${snrText(c.snr)}; candidate).`;
        } else {
            c.kind = 'unknown';
            // "Appeared" only when the earlier aperture was measured and held no source (Codex round 7: a zero-
            // scatter background left the fraction unmeasurable and a 2000 -> 3000 source read as new).
            const sums = apertureSums(earlier.data, later.data, b.pix, grid);
            const absentBefore = sums !== undefined && sums.noise > 0 && Number.isFinite(sums.noise) && sums.sumA < 5 * sums.noise;
            c.reason = b.sign === 1 && !c.gaiaMatch && !signMismatch && !wing && !opposite && absentBefore
                ? `A source appeared here (candidate); ${snrText(c.snr)}.`
                : `Changed at ${snrText(c.snr)}; brightness change could not be measured here (candidate).`;
        }
        result.candidates.push(c);
    });
    // A spot with no catalogue star of its own, within dipoleArcsec of one that changed, or whose image shifted
    // (an opposite spot beside it), may be the far half of that star's dipole. Keep it, but say so rather than
    // "no catalogue star here" or "appeared".
    result.candidates.forEach((c) => {
        if (c.gaiaMatch || c.kind === 'mover') {
            return;
        }
        const star = stars.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y)
            && distance(c.pix, s, grid) <= opt.dipoleArcsec)
            .sort((a, b) => distance(c.pix, a, grid) - distance(c.pix, b, grid))[0];
        if (!star) {
            return;
        }
        const changed = result.candidates.some((o) => o !== c && o.gaiaMatch && o.kind !== 'mover'
            && distance(o.pix, star, grid) <= opt.matchArcsec);
        const shifted = found.some((o) => o.sign !== c.sign && distance(o.pix, star, grid) <= opt.dipoleArcsec);
        if (changed || shifted) {
            c.kind = 'unknown';
            delete c.fracChange;
            c.reason = `Changed ${distance(c.pix, star, grid).toFixed(1)}″ from a catalogue star ${changed ? 'that also changed' : 'whose image shifted slightly between visits'}; `
                + `it may be part of that star rather than a separate source (${snrText(c.snr)}; candidate).`;
        }
    });
    const smallLeftovers = result.rejected.residual;
    const candidates = result.candidates;
    result.candidates = candidates.filter((c) => {
        if (c.kind !== 'mover' && candidates.some((stronger) => stronger !== c && stronger.snr >= 5 * c.snr
            && distance(c.pix, stronger.pix, grid) <= 2 * PSF_FWHM)) {
            result.rejected.residual++;
            return false;
        }
        return true;
    });
    const shadows = result.rejected.residual - smallLeftovers;
    if (result.rejected.residual > 0) {
        result.notes.push(`${smallLeftovers} small leftovers on steady stars ignored (under ${Math.round(opt.minFracChange * 100)}% change); ${shadows} shadows near stronger changes ignored.`);
    }
    result.candidates.forEach((c) => {
        if (c.snr > 50 && !c.reason.includes('S/N > 50')) { c.reason += ' S/N > 50.'; }
        if (singleFrame) { c.reason += ` ${warning}.`; }
    });
    return finish(result, opt, singleFrame);
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
    const seenIds = new Set<string>(), seenTimes = new Set<number>();
    const uniqueVisit = visit.slice().sort((a, b) => a.frame.tMin - b.frame.tMin).filter((frame) => {
        if (seenIds.has(frame.frame.obsId) || seenTimes.has(frame.frame.tMin)) { return false; }
        seenIds.add(frame.frame.obsId); seenTimes.add(frame.frame.tMin); return true;
    });
    if (uniqueVisit.length < 3) { result.notes.push('Tracklets need at least 3 frames.'); }
    for (const frame of uniqueVisit) {
        const template = templates.filter((t) => Math.abs(t.frame.tMin - frame.frame.tMin) >= 5
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
        const found = blobs(diff, grid, opt, result, 2);
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
        result.notes.push(`${result.skipped.length} frames skipped: no template at least 5 days away within ${opt.maxDeltaLambda} µm.`);
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
        c.reason = `Seen in ${points.length} frames along a straight line at ${motion.speed.toFixed(1)}″ per hour (${snrText(c.snr)}; candidate).`;
        result.candidates.push(c);
    }
    return finish(result, opt);
}
