// What the UI measures on the frames it already has: Gaia rings moved to each frame's date, a light curve
// against steady Gaia stars, and how far a fast mover really moved compared with its catalogue motion.
import { GaiaError, ringsAt, shiftReadout, type Ring, type ShiftReadout } from '../lib/gaia';
import { separationDeg } from '../lib/coords';
import { lightCurve, PhotometryError, type LightCurve } from '../lib/photometry';
import { positionAt } from '../lib/targets';
import type { SkyResult, TrackPoint } from '../lib/source';
import type { Astrometry, PixelCoord, RegriddedFrame } from '../lib/types';

// Aperture sizes in output pixels (photometry.ts defaults): star inside R, sky between IN and OUT.
const R = 10;
const OUT = 24;
// SPHEREx saturates on stars brighter than about G 9, and stars fainter than G 15 are lost in the noise
// of one frame at 0.1°. References come from between.
const REF_G_MIN = 9;
const REF_G_MAX = 15;
const MAX_REFS = 4;

export function frameMjd(f: RegriddedFrame): number
{
    return (f.frame.tMin + f.frame.tMax) / 2;
}

// The date halfway through the looks: where rings go when every frame is shown at once.
export function middleMjd(result: SkyResult): number
{
    const fs = result.frames;
    if (fs.length === 0) {
        return NaN;
    }
    return (frameMjd(fs[0]!.frame) + frameMjd(fs[fs.length - 1]!.frame)) / 2;
}

// The brightest `max` Gaia stars, each where it was on `mjd`. Ranked after moving, so a star that walked
// into the field counts and one that walked out does not.
export function ringsOn(result: SkyResult, mjd: number, max: number): Ring[]
{
    if (!Number.isFinite(mjd) || result.stars.length === 0) {
        return [];
    }
    return ringsAt(result.stars, result.grid, mjd).sort((a, b) => a.g - b.g).slice(0, max);
}

// The track point nearest a date (the track need not have one point per frame).
export function trackNear(track: TrackPoint[] | undefined, mjd: number): TrackPoint | undefined
{
    if (!track || track.length === 0) {
        return undefined;
    }
    return track.reduce((best, p) => (Math.abs(p.mjd - mjd) < Math.abs(best.mjd - mjd) ? p : best));
}

// Light-weighted centre of a star near `guess`. Unlike photometry.centroid it steps over NaN pixels, because
// a bright star's core is often masked as saturated and the wings still show where it is. Undefined when the
// window leaves the frame or holds nothing above the local median.
export function centreNear(f: RegriddedFrame, guess: PixelCoord, half = 6): PixelCoord | undefined
{
    const { width, height } = f.grid;
    let at = { ...guess };
    for (let pass = 0; pass < 5; pass++) {
        const cx = Math.round(at.x);
        const cy = Math.round(at.y);
        if (cx - half < 0 || cy - half < 0 || cx + half >= width || cy + half >= height) {
            return undefined;
        }
        const values: number[] = [];
        for (let y = cy - half; y <= cy + half; y++) {
            for (let x = cx - half; x <= cx + half; x++) {
                const v = f.data[y * width + x]!;
                if (Number.isFinite(v)) {
                    values.push(v);
                }
            }
        }
        if (values.length < (2 * half + 1) ** 2 / 2) {
            return undefined;
        }
        values.sort((p, q) => p - q);
        const floor = values[Math.floor(values.length / 2)]!;
        let sum = 0;
        let sx = 0;
        let sy = 0;
        for (let y = cy - half; y <= cy + half; y++) {
            for (let x = cx - half; x <= cx + half; x++) {
                const v = f.data[y * width + x]!;
                const w = Number.isFinite(v) ? Math.max(0, v - floor) : 0;
                sum += w;
                sx += x * w;
                sy += y * w;
            }
        }
        if (!(sum > 0)) {
            return undefined;
        }
        const next = { x: sx / sum, y: sy / sum };
        const moved = Math.hypot(next.x - at.x, next.y - at.y);
        at = next;
        if (moved < 0.01) {
            break;
        }
    }
    return at;
}

export interface Curve {
    lc: LightCurve;
    refs: number; // how many steady stars it is measured against
    frameOf: number[]; // for each point, its index in result.frames
}

// The target's brightness in each frame divided by the summed brightness of a few steady Gaia stars, so
// changes in the instrument cancel. Null when there is no track, too few frames or too few usable stars.
export function curveFor(result: SkyResult): Curve | null
{
    const frames = result.frames.map((p) => p.frame);
    if (!result.track?.length || frames.length < 2 || result.stars.length === 0) {
        return null;
    }
    const { width, height } = result.grid;
    const mid = middleMjd(result);
    const target = trackNear(result.track, mid);
    if (!target) {
        return null;
    }
    const inside = (p: PixelCoord) => p.x >= OUT && p.y >= OUT && p.x <= width - 1 - OUT && p.y <= height - 1 - OUT;
    const all = ringsAt(result.stars, result.grid, mid);
    const stars = new Map(result.stars.map((s) => [s.sourceId, s]));
    // A reference must be clear of the target and of any other catalogued star that would leak into its aperture.
    const refs = all
        .filter((r) => r.g >= REF_G_MIN && r.g <= REF_G_MAX && inside(r.pix))
        .filter((r) => {
            const s = stars.get(r.sourceId);
            return s?.pmRa !== undefined && s.pmDec !== undefined && Math.hypot(s.pmRa, s.pmDec) < 50;
        })
        .filter((r) => Math.hypot(r.pix.x - target.pix.x, r.pix.y - target.pix.y) > OUT + R)
        .filter((r) => !all.some((o) => o !== r && o.g < r.g + 2.5 && Math.hypot(o.pix.x - r.pix.x, o.pix.y - r.pix.y) < OUT))
        .sort((a, b) => a.g - b.g)
        .slice(0, MAX_REFS);
    if (refs.length < 2) {
        return null;
    }
    const where = (f: RegriddedFrame): PixelCoord => {
        const p = trackNear(result.track, frameMjd(f))!.pix;
        const c = centreNear(f, p);
        // Trust the measured centre only when it agrees with the predicted one to within a few pixels.
        return c && Math.hypot(c.x - p.x, c.y - p.y) < 3 ? c : p;
    };
    let lc: LightCurve;
    try {
        const measure = () => lightCurve(frames, (f) => where(f), refs.map((r) => r.pix), { lambda: result.lambda, maxDeltaUm: 0.05 });
        lc = measure();
        while (refs.length > 2) {
            const worst = lc.refScatter.reduce((best, scatter, i) => scatter > (lc.refScatter[best] ?? -Infinity) ? i : best, -1);
            if (worst < 0) {
                break;
            }
            const others = lc.refScatter.filter((_, i) => i !== worst).sort((a, b) => a - b);
            const mid = Math.floor(others.length / 2);
            const median = others.length % 2 === 0 ? (others[mid - 1]! + others[mid]!) / 2 : others[mid]!;
            if (!(lc.refScatter[worst]! > 3 * median)) {
                break;
            }
            refs.splice(worst, 1);
            lc = measure();
        }
    } catch (e) {
        if (e instanceof PhotometryError) {
            return null;
        }
        throw e;
    }
    if (lc.points.filter((p) => p.valid).length < 2) {
        return null;
    }
    const frameOf = lc.points.map((p) => frames.findIndex((f) => frameMjd(f) === p.mjd));
    return { lc, refs: refs.length, frameOf };
}

export interface Shift {
    from: number;
    to: number;
    predictedArcsec: number;
    measured: ShiftReadout | null;
}

// Catalogue motion from the first frame to frame k (or the last when k is first), with a measured shift when reliable.
export function shiftFor(result: SkyResult, a: Astrometry, k: number): Shift | null
{
    const n = result.frames.length;
    const to = k > 0 ? k : n - 1;
    if (to <= 0 || !result.track?.length) {
        return null;
    }
    const f0 = result.frames[0]!.frame;
    const f1 = result.frames[to]!.frame;
    const mjd0 = frameMjd(f0);
    const mjd1 = frameMjd(f1);
    const shift: Shift = {
        from: 0, to,
        predictedArcsec: separationDeg(positionAt(a, mjd0), positionAt(a, mjd1)) * 3600,
        measured: null,
    };
    const p0 = trackNear(result.track, mjd0);
    const p1 = trackNear(result.track, mjd1);
    const c0 = p0 && centreNear(f0, p0.pix);
    const c1 = p1 && centreNear(f1, p1.pix);
    const maxDistance = 1.5 * 6.15 / result.grid.pixelArcsec;
    if (!p0 || !p1 || !c0 || !c1
        || Math.hypot(c0.x - p0.pix.x, c0.y - p0.pix.y) > maxDistance
        || Math.hypot(c1.x - p1.pix.x, c1.y - p1.pix.y) > maxDistance) {
        return shift;
    }
    try {
        shift.measured = shiftReadout(a, result.grid, { mjd: mjd0, pix: c0 }, { mjd: mjd1, pix: c1 });
    } catch (e) {
        if (!(e instanceof GaiaError)) {
            throw e;
        }
    }
    return shift;
}
