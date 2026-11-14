// What the UI measures on the frames it already has: Gaia rings moved to each frame's date, a light curve
// against steady Gaia stars, and how far a fast mover really moved compared with its catalogue motion.
import { GaiaError, ringsAt, shiftReadout, type Ring, type ShiftReadout } from '../lib/gaia';
import { separationDeg } from '../lib/coords';
import { aperture, lightCurve, PhotometryError, type LightCurve } from '../lib/photometry';
import { positionAt } from '../lib/targets';
import type { SkyResult, TrackPoint } from '../lib/source';
import type { Astrometry, OutputGrid, PixelCoord, RegriddedFrame } from '../lib/types';

export const NATIVE_ARCSEC = 6.15; // SPHEREx detector pixel
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
// `self` is the target's catalogue motion: a Gaia star moving like it is the target itself, not a blend.
export function curveFor(result: SkyResult, self?: Astrometry): Curve | null
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
    let order: number[] = []; // lightCurve asks for the target once per kept frame, in point order
    try {
        const measure = () => {
            order = [];
            return lightCurve(frames, (f, i) => {
                order.push(i);
                return where(f);
            }, refs.map((r) => r.pix), { ...options, lambda: result.lambda, maxDeltaUm: 0.05 });
        };
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
    const frameOf = order.slice();
    const validFrames = frameOf.filter((_, i) => lc.points[i]!.valid).map((i) => frames[i]!);
    const native = NATIVE_ARCSEC / result.grid.pixelArcsec;
    // Per star: its median flux, and its sky noise over the aperture (scaled up because regridded pixels share
    // a detector pixel's noise) as a fraction of that flux.
    const perStar = refs.map((r) => {
        const ap = validFrames.map((f) => aperture(f.data, width, height, r.pix, options));
        const flux = median(ap.map((a) => a.sum));
        const sky = median(ap.map((a) => a.backgroundSigma * Math.sqrt(a.nPix) * Math.max(1, native)));
        return { flux, phot: flux > 0 ? sky / flux : NaN };
    });
    const noise = sumNoise(perStar.map((p) => p.flux), lc.refScatter, perStar.map((p) => p.phot));
    const reach = radius + 0.33 * native;
    const pmOk = (id: string): boolean => {
        const s = stars.get(id);
        if (!self || s?.pmRa === undefined || s.pmDec === undefined) {
            return false;
        }
        const want = Math.hypot(self.pmRa, self.pmDec);
        return Math.hypot(s.pmRa - self.pmRa, s.pmDec - self.pmDec) <= Math.max(20, 0.1 * want);
    };
    let blend: Curve['blend'] = null;
    for (const index of frameOf) {
        const mjd = frameMjd(frames[index]!);
        const target = trackNear(result.track, mjd)!.pix;
        const nearby = ringsAt(result.stars, result.grid, mjd).map((r) => ({
            sourceId: r.sourceId, g: r.g, px: Math.hypot(r.pix.x - target.x, r.pix.y - target.y),
        }));
        // The target itself, when Gaia sees it: the nearest star within a native pixel that moves like it. Not
        // the brightest: a wide binary moves together, and RW Aur B (1.5 arcsec off) is brighter in Gaia than A.
        // A neighbour over 2.5 mag fainter adds under 10% light; when Gaia does not see the target (WISE 0855),
        // any neighbour in the aperture counts.
        const me = nearby.filter((r) => r.px <= native && pmOk(r.sourceId)).sort((a, b) => a.px - b.px || a.g - b.g)[0];
        for (const r of nearby) {
            if (r === me || r.px > reach || (me && r.g > me.g + 2.5)) {
                continue;
            }
            if (!blend || r.g < blend.g || (r.sourceId === blend.sourceId && r.px < blend.px)) {
                blend = r;
            }
        }
    }
    return { lc, refs: refs.length, frameOf, blend, noise };
}

// Fractional scatter of the summed comparison flux. Each refScatter[i] is star i against the sum of the others, so
// it carries their noise too: solve for each star's own scatter first, then add them weighted by flux.
// With two stars both ratios scatter alike and can't say which star is noisy, so their shared scatter is split
// in proportion to each one's own sky noise (`phot`, fractional), or evenly when that is unknown.
export function sumNoise(flux: number[], scatter: number[], phot: number[] = []): number
{
    const ok = flux.map((f, i) => Number.isFinite(f) && f > 0 && Number.isFinite(scatter[i]));
    const F = flux.map((f, i) => (ok[i] ? f : 0));
    const s2 = scatter.map((v, i) => (ok[i] ? v * v : 0));
    const total = F.reduce((a, b) => a + b, 0);
    if (!(total > 0)) {
        return 0;
    }
    const used = ok.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (used.length === 2) {
        const [a, b] = used as [number, number];
        const shared = (s2[a]! + s2[b]!) / 2;
        const pa = phot[a]! ** 2;
        const pb = phot[b]! ** 2;
        const wa = Number.isFinite(pa) && Number.isFinite(pb) && pa + pb > 0 ? pa / (pa + pb) : 0.5;
        return Math.sqrt(F[a]! ** 2 * shared * wa + F[b]! ** 2 * shared * (1 - wa)) / total;
    }
    let own = s2.slice();
    for (let pass = 0; pass < 40; pass++) {
        own = own.map((v, i) => {
            if (!ok[i]) {
                return 0;
            }
            let rest = 0;
            let restVar = 0;
            for (let j = 0; j < F.length; j++) {
                if (j !== i && ok[j]) {
                    rest += F[j]!;
                    restVar += F[j]! ** 2 * own[j]!;
                }
            }
            const next = Math.max(0, s2[i]! - (rest > 0 ? restVar / rest ** 2 : 0));
            return 0.5 * v + 0.5 * next; // damped, so equal stars settle instead of see-sawing
        });
    }
    return Math.sqrt(F.reduce((sum, f, i) => sum + f ** 2 * own[i]!, 0)) / total;
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

// How many frames show a saturated centre: no value within half a detector pixel of the target's track
// position, with a bright ring around it (its median above the frame's 99th percentile). Blank pixels in dark
// sky (no coverage, an edge) do not count. R Dra and Barnard's Star saturate.
export function coreBlank(result: SkyResult): { blank: number; of: number } | null
{
    if (!result.track || result.track.length === 0 || result.frames.length === 0) {
        return null;
    }
    const { width, height } = result.grid;
    const native = NATIVE_ARCSEC / result.grid.pixelArcsec;
    const reach = Math.max(Math.SQRT1_2, native / 2); // at least the nearest pixel
    const ringOut = Math.max(3, native * 1.5);
    let blank = 0;
    for (const { frame: f } of result.frames) {
        const at = trackNear(result.track, frameMjd(f))!.pix;
        let hole = false;
        const ring: number[] = [];
        const r = Math.ceil(ringOut);
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const x = Math.round(at.x) + dx;
                const y = Math.round(at.y) + dy;
                const d = Math.hypot(x - at.x, y - at.y);
                if (d > ringOut || x < 0 || y < 0 || x >= width || y >= height) {
                    continue;
                }
                const v = f.data[y * width + x] as number;
                if (!Number.isFinite(v)) {
                    hole ||= d <= reach;
                } else if (d > reach) {
                    ring.push(v);
                }
            }
        }
        if (!hole || ring.length === 0) {
            continue;
        }
        const sample: number[] = [];
        for (let i = 0; i < f.data.length; i += 7) {
            const v = f.data[i] as number;
            if (Number.isFinite(v)) {
                sample.push(v);
            }
        }
        sample.sort((a, b) => a - b);
        const p99 = sample[Math.floor(sample.length * 0.99)];
        if (p99 !== undefined && median(ring) > p99) {
            blank++;
        }
    }
    return { blank, of: result.frames.length };
}

// Looks grouped into visits: frames less than `gapDays` apart belong to one visit. In date order.
export function visitsOf(result: SkyResult, gapDays = 10): { mjd: number; n: number }[]
{
    const days = result.frames.map((f) => frameMjd(f.frame)).filter(Number.isFinite).sort((a, b) => a - b);
    const out: { mjd: number; n: number }[] = [];
    let prev = -Infinity;
    for (const d of days) {
        const last = out[out.length - 1];
        if (last && d - prev < gapDays) {
            last.n++;
        } else {
            out.push({ mjd: d, n: 1 });
        }
        prev = d;
    }
    return out;
}
