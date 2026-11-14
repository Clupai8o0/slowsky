// Frame footprints (Codex Terra, from a Claude brief). SIA lists each frame's s_region: the sky positions of its
// 4 detector corners, in pixel order (-0.5,-0.5), (nx-0.5,-0.5), (nx-0.5,ny-0.5), (-0.5,ny-0.5) (checked live).
// From those the live loader guesses where a star falls on the detector, and so its wavelength, before it reads
// any FITS header. Lens distortion makes the guess 6-9 px off on SPHEREx, which is close enough to rank frames.
import type { FrameRecord, PixelCoord, SkyCoord } from './types';

// The 4 corners of an SIA s_region 'POLYGON [ICRS] ra1 dec1 ... ra4 dec4 [ra1 dec1]', or null.
export function parseRegion(region: string | undefined): SkyCoord[] | null
{
    if (!region?.trim()) {
        return null;
    }
    const tokens = region.trim().split(/\s+/);
    if (tokens.shift()?.toUpperCase() !== 'POLYGON') {
        return null;
    }
    if (tokens.length > 0 && /^[a-z][a-z0-9_-]*$/i.test(tokens[0]!)
        && !/^(nan|infinity)$/i.test(tokens[0]!)) {
        tokens.shift();
    }
    if (tokens.length !== 8 && tokens.length !== 10) {
        return null;
    }
    const values = tokens.map(Number);
    if (values.some(value => !Number.isFinite(value))) {
        return null;
    }
    const points: SkyCoord[] = [];
    for (let i = 0; i < values.length; i += 2) {
        const ra = values[i]!;
        const dec = values[i + 1]!;
        if (ra < 0 || ra > 360 || dec < -90 || dec > 90) {
            return null;
        }
        points.push({ ra, dec });
    }
    if (points.length === 5 && (Math.abs(points[4]!.ra - points[0]!.ra) > 1e-9
        || Math.abs(points[4]!.dec - points[0]!.dec) > 1e-9)) {
        return null;
    }
    return points.slice(0, 4);
}

type Vector = [number, number, number];

function vector(coord: SkyCoord): Vector
{
    const ra = coord.ra * Math.PI / 180;
    const dec = coord.dec * Math.PI / 180;
    return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

function dot(a: Vector, b: Vector): number
{
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Approximate 0-based pixel of point on a detector with these corners and size naxis: a bilinear map from the
// corners, inverted in the gnomonic plane at their mean. Points off the detector return pixels outside it.
export function predictPixel(corners: SkyCoord[], naxis: [number, number], point: SkyCoord): PixelCoord | null
{
    if (corners.length !== 4 || naxis.some(n => !Number.isFinite(n) || n <= 0)
        || [...corners, point].some(c => !Number.isFinite(c.ra) || !Number.isFinite(c.dec))) {
        return null;
    }
    const vectors = corners.map(vector);
    const mean: Vector = [0, 0, 0];
    for (const v of vectors) {
        mean[0] += v[0];
        mean[1] += v[1];
        mean[2] += v[2];
    }
    const length = Math.hypot(...mean);
    if (!Number.isFinite(length) || length < 1e-15) {
        return null;
    }
    const center: Vector = [mean[0] / length, mean[1] / length, mean[2] / length];
    const ra = Math.atan2(center[1], center[0]);
    const dec = Math.atan2(center[2], Math.hypot(center[0], center[1]));
    const east: Vector = [-Math.sin(ra), Math.cos(ra), 0];
    const north: Vector = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
    function project(v: Vector): PixelCoord | null
    {
        const cos = dot(v, center);
        if (cos <= 0) {
            return null;
        }
        const x = dot(v, east) / cos;
        const y = dot(v, north) / cos;
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }
    const q = vectors.map(project);
    const target = project(vector(point));
    if (!target || q.some(p => p === null)) {
        return null;
    }
    const [q0, q1, q2, q3] = q as PixelCoord[];
    const ax = q1!.x - q0!.x;
    const ay = q1!.y - q0!.y;
    const bx = q3!.x - q0!.x;
    const by = q3!.y - q0!.y;
    const cx = q0!.x - q1!.x + q2!.x - q3!.x;
    const cy = q0!.y - q1!.y + q2!.y - q3!.y;
    let u = 0.5;
    let v = 0.5;
    for (let i = 0; i < 30; i++) {
        const fx = q0!.x + ax * u + bx * v + cx * u * v - target.x;
        const fy = q0!.y + ay * u + by * v + cy * u * v - target.y;
        const xu = ax + cx * v;
        const xv = bx + cx * u;
        const yu = ay + cy * v;
        const yv = by + cy * u;
        const det = xu * yv - xv * yu;
        if (det === 0 || !Number.isFinite(det)) {
            return null;
        }
        const du = (fx * yv - fy * xv) / det;
        const dv = (fy * xu - fx * yu) / det;
        u -= du;
        v -= dv;
        if (!Number.isFinite(u) || !Number.isFinite(v)) {
            return null;
        }
        if (Math.hypot(du, dv) < 1e-12) {
            break;
        }
    }
    const x = -0.5 + u * naxis[0];
    const y = -0.5 + v * naxis[1];
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export interface WavePick {
    frames: FrameRecord[]; // frames to read, sorted by tMin
    // Visits left out because no frame is predicted near the chosen wavelength. Visits dropped only to stay
    // within max are not counted: the caller already says it read fewer frames than it found.
    skippedVisits: number;
}

// Chooses at most max frames to read so each visit keeps the frames whose predicted wavelength is nearest chosen
// (up to perVisit each). A visit with no prediction offers its middle frame. More visits than max: spread in time.
export function pickByWavelength(
    visits: FrameRecord[][],
    predicted: (f: FrameRecord) => number | undefined,
    chosen: number,
    limitOf: (f: FrameRecord) => number,
    max: number,
    opts: { perVisit?: number; slackUm?: number } = {},
): WavePick
{
    if (!Number.isFinite(chosen) || max < 1 || Number.isNaN(max)) {
        return { frames: [], skippedVisits: 0 };
    }
    const capacity = Math.floor(max);
    const slack = opts.slackUm ?? 0.01;
    const offers: { time: number; frames: FrameRecord[] }[] = [];
    let skippedVisits = 0;
    for (const visit of visits) {
        if (visit.length === 0) {
            continue;
        }
        const ranked: { frame: FrameRecord; delta: number; near: boolean }[] = [];
        for (const frame of visit) {
            const value = predicted(frame);
            if (value !== undefined && Number.isFinite(value)) {
                const delta = Math.abs(value - chosen);
                ranked.push({ frame, delta, near: delta <= limitOf(frame) + slack });
            }
        }
        const time = Math.min(...visit.map(frame => frame.tMin));
        if (ranked.length === 0) {
            offers.push({ time, frames: [visit[Math.floor(visit.length / 2)]!] });
        } else if (!ranked.some(item => item.near)) {
            skippedVisits++;
        } else {
            ranked.sort((a, b) => a.delta - b.delta || a.frame.tMin - b.frame.tMin);
            offers.push({ time, frames: ranked.filter((item, index) => index === 0 || item.near).map(item => item.frame) });
        }
    }
    offers.sort((a, b) => a.time - b.time);
    if (offers.length === 0) {
        return { frames: [], skippedVisits };
    }
    let selected: FrameRecord[];
    if (offers.length > capacity) {
        selected = [];
        for (let k = 0; k < capacity; k++) {
            selected.push(offers[Math.floor((k + 0.5) * offers.length / capacity)]!.frames[0]!);
        }
    } else {
        const share = Math.max(1, Math.min(opts.perVisit ?? 2, Math.floor(capacity / offers.length)));
        selected = offers.flatMap(offer => offer.frames.slice(0, share));
    }
    selected.sort((a, b) => a.tMin - b.tMin || a.obsId.localeCompare(b.obsId));
    const seen = new Set<string>();
    const frames = selected.filter(frame => {
        if (seen.has(frame.obsId)) {
            return false;
        }
        seen.add(frame.obsId);
        return true;
    });
    return { frames, skippedVisits };
}
