// What the UI measures on the frames it already has: Gaia rings moved to each frame's date, a light curve
// against steady Gaia stars, and how far a fast mover really moved compared with its catalogue motion.
import { GaiaError, ringsAt, shiftReadout, type Ring, type ShiftReadout } from '../lib/gaia';
import { separationDeg } from '../lib/coords';
import { aperture, lightCurve, PhotometryError, type LightCurve } from '../lib/photometry';
import { positionAt } from '../lib/targets';
import type { SkyResult, TrackPoint } from '../lib/source';
import type { Astrometry, OutputGrid, PixelCoord, RegriddedFrame } from '../lib/types';

const NATIVE_ARCSEC = 6.15;
// SPHEREx saturates on stars brighter than about G 9, and stars fainter than G 15 are lost in the noise
// of one frame at 0.1°. References come from between.
const REF_G_MIN = 9;
const REF_G_MAX = 15;
const MAX_REFS = 4;

export function apertureFor(grid: OutputGrid): { radius: number; annulusIn: number; annulusOut: number }
{
    const native = NATIVE_ARCSEC / grid.pixelArcsec;
    const radius = Math.max(1.5, 2 * native);
    const annulusIn = Math.max(radius + 1, 3 * native);
    const annulusOut = Math.max(annulusIn + 2, 6 * native);
    return { radius, annulusIn, annulusOut };
}

function median(values: number[]): number
{
    if (values.length === 0) {
        return NaN;
    }
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[mid - 1]! + values[mid]!) / 2 : values[mid]!;
}

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
    blend: { sourceId: string; g: number; px: number } | null;
    noise: number;
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
    const options = apertureFor(result.grid);
    const { radius, annulusOut } = options;
    const mid = middleMjd(result);
    const target = trackNear(result.track, mid);
    if (!target) {
        return null;
    }
    const inside = (p: PixelCoord) => p.x >= annulusOut && p.y >= annulusOut && p.x <= width - 1 - annulusOut && p.y <= height - 1 - annulusOut;
    const all = ringsAt(result.stars, result.grid, mid);
    const stars = new Map(result.stars.map((s) => [s.sourceId, s]));
    // A reference must be clear of the target and of any other catalogued star that would leak into its aperture.
    const refs = all
        .filter((r) => r.g >= REF_G_MIN && r.g <= REF_G_MAX && inside(r.pix))
        .filter((r) => {
            const s = stars.get(r.sourceId);
            return s?.pmRa !== undefined && s.pmDec !== undefined && Math.hypot(s.pmRa, s.pmDec) < 50;
        })
        .filter((r) => Math.hypot(r.pix.x - target.pix.x, r.pix.y - target.pix.y) > annulusOut + radius)
        .filter((r) => !all.some((o) => o !== r && o.g < r.g + 2.5 && Math.hypot(o.pix.x - r.pix.x, o.pix.y - r.pix.y) < annulusOut))
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
        const measure = () => lightCurve(frames, (f) => where(f), refs.map((r) => r.pix), { ...options, lambda: result.lambda, maxDeltaUm: 0.05 });
        lc = measure();
        while (refs.length > 2) {
            const worst = lc.refScatter.reduce((best, scatter, i) => scatter > (lc.refScatter[best] ?? -Infinity) ? i : best, -1);
            if (worst < 0) {
                break;
            }
            const others = lc.refScatter.filter((_, i) => i !== worst);
            if (!(lc.refScatter[worst]! > 3 * median(others))) {
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
    const validFrames = frameOf.filter((_, i) => lc.points[i]!.valid).map((i) => frames[i]!);
    let fluxSum = 0;
    let variance = 0;
    for (let i = 0; i < refs.length; i++) {
        const flux = median(validFrames.map((f) => aperture(f.data, width, height, refs[i]!.pix, options).sum));
        const scatter = lc.refScatter[i]!;
        if (Number.isFinite(flux) && Number.isFinite(scatter)) {
            fluxSum += flux;
            variance += (flux * scatter) ** 2;
        }
    }
    const noise = fluxSum !== 0 ? Math.sqrt(variance) / fluxSum : 0;
    let blend: Curve['blend'] = null;
    for (const index of frameOf) {
        const mjd = frameMjd(frames[index]!);
        const target = trackNear(result.track, mjd)!.pix;
        const nearby = ringsAt(result.stars, result.grid, mjd).map((r) => ({
            sourceId: r.sourceId, g: r.g, px: Math.hypot(r.pix.x - target.x, r.pix.y - target.y),
        }));
        const nearest = nearby.reduce<typeof nearby[number] | undefined>((best, r) => !best || r.px < best.px ? r : best, undefined);
        // The target itself, when Gaia sees it. A neighbour over 2.5 mag fainter than it adds under 10% light;
        // when Gaia does not see the target (WISE 0855), any neighbour in the aperture counts.
        const self = nearest && nearest.px <= 1.5 ? nearest : undefined;
        for (const r of nearby) {
            if (r === self || r.px > radius + 2 || (self && r.g > self.g + 2.5)) {
                continue;
            }
            if (!blend || r.g < blend.g || (r.sourceId === blend.sourceId && r.px < blend.px)) {
                blend = r;
            }
        }
    }
    return { lc, refs: refs.length, frameOf, blend, noise };
}

export interface Shift {
    from: number;
    to: number;
    predictedArcsec: number;
    errArcsec: number;
    significant: boolean;
    measured: ShiftReadout | null;
}

// Catalogue motion from the first frame to the last, with a measured shift when reliable.
export function shiftFor(result: SkyResult, a: Astrometry): Shift | null
{
    const to = result.frames.length - 1;
    if (to <= 0 || !result.track?.length) {
        return null;
    }
    const f0 = result.frames[0]!.frame;
    const f1 = result.frames[to]!.frame;
    const mjd0 = frameMjd(f0);
    const mjd1 = frameMjd(f1);
    const predictedArcsec = separationDeg(positionAt(a, mjd0), positionAt(a, mjd1)) * 3600;
    const errArcsec = 0.65 * NATIVE_ARCSEC;
    const shift: Shift = {
        from: 0, to,
        predictedArcsec, errArcsec,
        significant: predictedArcsec >= 2 * errArcsec,
        measured: null,
    };
    const p0 = trackNear(result.track, mjd0);
    const p1 = trackNear(result.track, mjd1);
    const c0 = p0 && centreNear(f0, p0.pix);
    const c1 = p1 && centreNear(f1, p1.pix);
    const maxDistance = 1.5 * NATIVE_ARCSEC / result.grid.pixelArcsec;
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
