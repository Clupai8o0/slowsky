// Builds the InsightFacts object sent to /api/insight from what the app has measured.
// Every number comes from the input; values are rounded to (at least) the digits factSheet prints,
// and trimmed so validateFacts accepts them. Safe to run in a Web Worker (no DOM).
import { InsightError, type InsightFacts } from './insight';
import { TARGETS } from './targets';
import type { OutputGrid, PixelCoord, RegriddedFrame, SkyCoord } from './types';

// photometry.ts and stack.ts are not on this branch, so the inputs are typed structurally.
// LightCurve (photometry.ts) and StackResult (stack.ts) both fit these shapes.
export interface FactsLightCurvePoint {
    mjd: number;
    relative: number;
    valid?: boolean;
    target: { snr: number };
}
export interface FactsLightCurve {
    points: FactsLightCurvePoint[];
    dropped: number;
    refScatter: number[];
}

export interface FactsDifference {
    data: Float32Array;
    grid: OutputGrid;
    at?: PixelCoord; // target pixel; defaults to the grid centre
}

export interface FactsInput {
    targetId: string; // a TARGETS id, or 'custom' for a typed-in position
    center: SkyCoord; // ICRS degrees
    lambdaUm: number;
    visits: RegriddedFrame[][];
    lightCurve?: FactsLightCurve;
    difference?: FactsDifference; // StackResult users pass { data: stack.data, grid }
    shift?: { measuredArcsec: number; days: number };
    snapshot: boolean;
}

// Limits mirrored from validateFacts in insight.ts.
const MAX_VISITS = 12;
const MAX_FRAMES = 500;
const MAX_POINTS = 60;
const MAX_REFS = 8;
const MAX_DROPPED = 5000;
const MJD_MIN = 60000;
const MJD_MAX = 70000;

function round(value: number, digits: number): number
{
    const f = 10 ** digits;
    const r = Math.round(value * f) / f;
    return Object.is(r, -0) ? 0 : r;
}

function clamp(value: number, lo: number, hi: number): number
{
    return Math.min(hi, Math.max(lo, value));
}

// Keep at most `max` items of a time-sorted list, evenly spaced, always keeping the first and
// last so the time span (which the fact sheet reports) is unchanged.
function thin<T>(sorted: T[], max: number): T[]
{
    if (sorted.length <= max) {
        return sorted;
    }
    const out: T[] = [];
    for (let i = 0; i < max; i++) {
        out.push(sorted[Math.round(i * (sorted.length - 1) / (max - 1))]!);
    }
    return out;
}

function median(values: number[]): number
{
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// Aperture radius at the target: 1.5 SPHEREx pixels of 6.2 arcsec.
const APERTURE_ARCSEC = 9.3;
// Background pixels start this many aperture radii from the target.
const BACKGROUND_FACTOR = 2;
const MIN_BACKGROUND = 20;

export function peakSigma(diff: Float32Array, grid: OutputGrid, at?: PixelCoord): number | undefined
{
    const { width, height } = grid;
    if (diff.length !== width * height) {
        return undefined;
    }
    const cx = at?.x ?? (width - 1) / 2;
    const cy = at?.y ?? (height - 1) / 2;
    const radius = Math.max(APERTURE_ARCSEC / grid.pixelArcsec, 1.5);
    if (!Number.isFinite(radius) || !Number.isFinite(cx) || !Number.isFinite(cy)) {
        return undefined;
    }
    const inner: number[] = [];
    const background: number[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const v = diff[y * width + x]!;
            if (!Number.isFinite(v)) {
                continue;
            }
            const r = Math.hypot(x - cx, y - cy);
            if (r <= radius) {
                inner.push(v);
            } else if (r > BACKGROUND_FACTOR * radius) {
                background.push(v);
            }
        }
    }
    if (!inner.length || background.length < MIN_BACKGROUND) {
        return undefined;
    }
    const level = median(background);
    const sigma = median(background.map((v) => Math.abs(v - level))) * 1.4826;
    if (!(sigma > 0) || !Number.isFinite(sigma)) {
        return undefined;
    }
    let peak = 0;
    for (const v of inner) {
        if (Math.abs(v - level) > Math.abs(peak)) {
            peak = v - level;
        }
    }
    const result = peak / sigma;
    return Number.isFinite(result) ? result : undefined;
}

function visitsSection(groups: RegriddedFrame[][]): InsightFacts['visits']
{
    const visits: InsightFacts['visits'] = [];
    for (const group of groups) {
        const times = group.map((f) => (f.frame.tMin + f.frame.tMax) / 2).filter((t) => Number.isFinite(t));
        if (!times.length) {
            continue;
        }
        const mjd = round(times.reduce((a, b) => a + b, 0) / times.length, 4);
        if (mjd < MJD_MIN || mjd > MJD_MAX) {
            continue;
        }
        visits.push({ mjd, frames: Math.min(times.length, MAX_FRAMES) });
    }
    visits.sort((a, b) => a.mjd - b.mjd);
    if (!visits.length) {
        throw new InsightError('invalid');
    }
    return thin(visits, MAX_VISITS);
}

function lightCurveSection(lc: FactsLightCurve | undefined): InsightFacts['lightCurve']
{
    if (!lc || !Array.isArray(lc.points)) {
        return undefined;
    }
    // Points outside what validateFacts allows are left out rather than clamped, so no value is altered.
    const points = lc.points
        .filter((p) => p.valid !== false && Number.isFinite(p.mjd) && Number.isFinite(p.relative) && Number.isFinite(p.target.snr))
        .map((p) => ({ mjd: round(p.mjd, 4), relative: round(p.relative, 4), snr: round(p.target.snr, 1) }))
        .filter((p) => p.mjd >= MJD_MIN && p.mjd <= MJD_MAX && p.relative >= 0 && p.relative <= 100 && p.snr >= -1000 && p.snr <= 100000)
        .sort((a, b) => a.mjd - b.mjd);
    if (!points.length) {
        return undefined;
    }
    const refScatter = (lc.refScatter ?? [])
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 10)
        .map((n) => round(n, 4))
        .slice(0, MAX_REFS);
    const dropped = Number.isFinite(lc.dropped) ? clamp(Math.round(lc.dropped), 0, MAX_DROPPED) : 0;
    return { points: thin(points, MAX_POINTS), refScatter, dropped };
}

function differenceSection(diff: FactsDifference | undefined): InsightFacts['difference']
{
    if (!diff) {
        return undefined;
    }
    const sigma = peakSigma(diff.data, diff.grid, diff.at);
    if (sigma === undefined) {
        return undefined;
    }
    return { peakSigma: clamp(round(sigma, 2), -10000, 10000) };
}

function motionSection(shift: FactsInput['shift']): InsightFacts['motion']
{
    if (!shift || !Number.isFinite(shift.measuredArcsec) || !Number.isFinite(shift.days)) {
        return undefined;
    }
    const arcsec = round(shift.measuredArcsec, 2);
    const days = round(shift.days, 2);
    if (arcsec < 0 || arcsec > 100000 || days < 0 || days > 4000) {
        return undefined;
    }
    return { arcsec, days };
}

export function buildFacts(input: FactsInput): InsightFacts
{
    if (input.targetId !== 'custom' && !TARGETS.some((t) => t.id === input.targetId)) {
        throw new InsightError('invalid');
    }
    const { ra, dec } = input.center;
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(input.lambdaUm)) {
        throw new InsightError('invalid');
    }
    let raOut = round(((ra % 360) + 360) % 360, 4);
    if (raOut >= 360) {
        raOut = 0;
    }
    const decOut = round(dec, 4);
    const lambdaUm = round(input.lambdaUm, 3);
    if (decOut < -90 || decOut > 90 || lambdaUm < 0.7 || lambdaUm > 5.1) {
        throw new InsightError('invalid');
    }
    const facts: InsightFacts = { targetId: input.targetId, ra: raOut, dec: decOut, lambdaUm, visits: visitsSection(input.visits), snapshot: input.snapshot };
    const lightCurve = lightCurveSection(input.lightCurve);
    if (lightCurve) {
        facts.lightCurve = lightCurve;
    }
    const difference = differenceSection(input.difference);
    if (difference) {
        facts.difference = difference;
    }
    const motion = motionSection(input.shift);
    if (motion) {
        facts.motion = motion;
    }
    return facts;
}
