import { gridPixToSky } from './regrid';
import type { OutputGrid, PixelCoord, RegriddedFrame, SkyCoord } from './types';

export type ChangeKind = 'mover' | 'brightness' | 'unknown';
export interface StarPix { x: number; y: number; }
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
    reason: string;
}
export interface ChangeResult {
    candidates: ChangeCandidate[];
    rejected: { streaks: number; single: number; edge: number };
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
}

type Image = { data: Float32Array; lambda: number; mjd: number; obsIds: string[] };
type Settings = Required<ChangeOptions>;
type Blob = { pix: PixelCoord; snr: number; sign: 1 | -1; area: number };
type Measurement = { z: Float32Array; sigma: number; k: number; width: number; height: number };
const NATIVE = 6.15;

function settings(opts: ChangeOptions = {}): Settings
{
    return { threshold: opts.threshold ?? 5, minAreaArcsec2: opts.minAreaArcsec2 ?? 1.5 * NATIVE ** 2,
        maxElongation: opts.maxElongation ?? 3, matchArcsec: opts.matchArcsec ?? 6,
        dipoleArcsec: opts.dipoleArcsec ?? 15, edgeArcsec: opts.edgeArcsec ?? 12,
        maxDeltaLambda: opts.maxDeltaLambda ?? 0.02, maxCandidates: opts.maxCandidates ?? 50,
        minSpeedArcsecPerHour: opts.minSpeedArcsecPerHour ?? 5,
        maxSpeedArcsecPerHour: opts.maxSpeedArcsecPerHour ?? 4000, lineTolArcsec: opts.lineTolArcsec ?? 4 };
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

function measure(diff: Float32Array, grid: OutputGrid): Measurement
{
    validate(diff, grid);
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
    const z = new Float32Array(bins.length);
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
            const noise = Math.exp(interpolate(logNoise));
            const value = bins[y * width + x]!;
            z[y * width + x] = Number.isFinite(value) && noise > 0 ? (value - interpolate(centers)) / noise : NaN;
        }
    }
    return { z, sigma, k, width, height };
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

function blobs(diff: Float32Array, grid: OutputGrid, opt: Settings, result: ChangeResult, support = 3.75): Blob[]
{
    const m = measure(diff, grid);
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
        if (nearEdge) {
            result.rejected.edge++;
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
        // Refine the binned centroid using the original grid within the component.
        let fullX = 0, fullY = 0, fullWeight = 0;
        for (const p of queue) {
            const bx = p % m.width, by = Math.floor(p / m.width);
            for (let y = by * m.k; y < Math.min((by + 1) * m.k, grid.height); y++) {
                for (let x = bx * m.k; x < Math.min((bx + 1) * m.k, grid.width); x++) {
                    const w = Math.max(0, sign * diff[y * grid.width + x]!);
                    fullX += x * w;
                    fullY += y * w;
                    fullWeight += w;
                }
            }
        }
        out.push({ pix: fullWeight > 0 ? { x: fullX / fullWeight, y: fullY / fullWeight }
            : { x: cx * m.k + (m.k - 1) / 2, y: cy * m.k + (m.k - 1) / 2 }, snr: peak, sign, area: queue.length });
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
        best = Math.min(best, distance(p, star, grid));
    }
    return best <= radius ? best : undefined;
}

function empty(opt: Settings): ChangeResult
{
    return { candidates: [], rejected: { streaks: 0, single: 0, edge: 0 }, sigma: NaN,
        threshold: opt.threshold, skipped: [], notes: [] };
}

function finish(result: ChangeResult, opt: Settings): ChangeResult
{
    result.candidates.sort((a, b) => b.snr - a.snr || a.pix.y - b.pix.y || a.pix.x - b.pix.x);
    result.candidates = result.candidates.slice(0, Math.max(0, opt.maxCandidates));
    result.candidates.forEach((c, i) => { c.id = `c${i + 1}`; });
    return result;
}

function candidate(blob: Blob, grid: OutputGrid, stars: StarPix[], opt: Settings, frames: string[]): ChangeCandidate
{
    const dist = match(blob.pix, stars, grid, opt.matchArcsec);
    const kind: ChangeKind = dist === undefined ? 'unknown' : 'brightness';
    return { id: '', kind, pix: blob.pix, sky: gridPixToSky(grid, blob.pix), snr: blob.snr, sign: blob.sign,
        gaiaMatch: dist !== undefined, ...(dist === undefined ? {} : { gaiaDistArcsec: dist }), frames,
        reason: kind === 'brightness'
            ? `A catalogue star here is ${blob.sign === 1 ? 'brighter' : 'fainter'} than in the earlier image, at S/N ${blob.snr.toFixed(1)} (candidate).`
            : `Changed at S/N ${blob.snr.toFixed(1)} with no catalogue star here (candidate).` };
}

export function compareVisits(earlier: Image, later: Image, grid: OutputGrid, stars: StarPix[], opts?: ChangeOptions): ChangeResult
{
    const opt = settings(opts), result = empty(opt);
    const diff = difference(earlier.data, later.data, grid);
    if (!wavelengthsMatch(earlier.lambda, later.lambda, opt.maxDeltaLambda)) {
        result.skipped = later.obsIds.map((obsId) => ({ obsId, reason: `No earlier image within ${opt.maxDeltaLambda} µm.` }));
        result.notes.push(`${later.obsIds.length} frames skipped: no earlier image within ${opt.maxDeltaLambda} µm.`);
        return result;
    }
    const found = blobs(diff, grid, opt, result);
    const used = new Set<number>();
    for (let i = 0; i < found.length; i++) {
        const positive = found[i]!;
        if (positive.sign !== 1) {
            continue;
        }
        let best = -1, closest = Infinity;
        for (let j = 0; j < found.length; j++) {
            const negative = found[j]!;
            const d = distance(positive.pix, negative.pix, grid);
            if (negative.sign === -1 && !used.has(j) && d <= opt.dipoleArcsec && d < closest
                && Math.max(positive.area, negative.area) <= 3 * Math.min(positive.area, negative.area)) {
                best = j;
                closest = d;
            }
        }
        if (best >= 0) {
            used.add(i);
            used.add(best);
            const c = candidate(positive, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]);
            c.kind = 'mover';
            c.reason = `A spot faded at one place and appeared ${closest.toFixed(1)}″ away: something moved between visits (candidate).`;
            result.candidates.push(c);
        }
    }
    found.forEach((b, i) => {
        if (!used.has(i)) {
            result.candidates.push(candidate(b, grid, stars, opt, [...earlier.obsIds, ...later.obsIds]));
        }
    });
    return finish(result, opt);
}

type Point = { mjd: number; blob: Blob; obsId: string; templateId: string };
function fit(points: Point[], grid: OutputGrid): { speed: number; pa: number; residual: number; worst: number } | undefined
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
    let residual = 0, worst = 0;
    points.forEach((p, i) => {
        const dt = times[i]! - t;
        const d = Math.hypot(p.blob.pix.x - x - vx * dt, p.blob.pix.y - y - vy * dt) * grid.pixelArcsec;
        if (d > residual) {
            residual = d;
            worst = i;
        }
    });
    return { speed: Math.hypot(vx, vy) * grid.pixelArcsec,
        pa: (Math.atan2(-vx, -vy) * 180 / Math.PI + 360) % 360, residual, worst };
}

export function findTracklets(visit: RegriddedFrame[], templates: RegriddedFrame[], grid: OutputGrid,
    stars: StarPix[], opts?: ChangeOptions): ChangeResult
{
    const opt = settings(opts), result = empty(opt), groups: Point[][] = [], sigmas: number[] = [];
    for (const frame of [...visit, ...templates]) {
        if (!sameGrid(frame.grid, grid)) {
            throw new Error('Frame output grid differs from requested grid');
        }
        validate(frame.data, grid);
    }
    for (const frame of visit.slice().sort((a, b) => a.frame.tMin - b.frame.tMin)) {
        const template = templates.filter((t) => Math.abs(t.frame.tMin - frame.frame.tMin) >= 5
            && Number.isFinite(t.lambdaAtCenter) && Number.isFinite(frame.lambdaAtCenter))
            .sort((a, b) => Math.abs(a.lambdaAtCenter - frame.lambdaAtCenter) - Math.abs(b.lambdaAtCenter - frame.lambdaAtCenter))[0];
        if (!template || !wavelengthsMatch(template.lambdaAtCenter, frame.lambdaAtCenter, opt.maxDeltaLambda)) {
            result.skipped.push({ obsId: frame.frame.obsId, reason: `No template at least 5 days away within ${opt.maxDeltaLambda} µm.` });
            continue;
        }
        const found = blobs(difference(template.data, frame.data, grid), grid, opt, result, 2);
        if (Number.isFinite(result.sigma)) {
            sigmas.push(result.sigma);
        }
        groups.push(found.filter((b) => b.sign === 1 && match(b.pix, stars, grid, opt.matchArcsec) === undefined)
            .map((blob) => ({ mjd: frame.frame.tMin, blob, obsId: frame.frame.obsId, templateId: template.frame.obsId })));
    }
    result.sigma = median(sigmas);
    if (result.skipped.length) {
        result.notes.push(`${result.skipped.length} frames skipped: no template at least 5 days away within ${opt.maxDeltaLambda} µm.`);
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
                    let motion = fit(points, grid);
                    while (points.length > 3 && motion && motion.residual > opt.lineTolArcsec) {
                        points.splice(motion.worst, 1);
                        motion = fit(points, grid);
                    }
                    if (points.length >= 3 && motion && motion.residual <= opt.lineTolArcsec
                        && motion.speed >= opt.minSpeedArcsecPerHour && motion.speed <= opt.maxSpeedArcsecPerHour) {
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
        c.reason = `Seen in ${points.length} frames along a straight line at ${motion.speed.toFixed(1)}″ per hour (candidate).`;
        result.candidates.push(c);
    }
    return finish(result, opt);
}
