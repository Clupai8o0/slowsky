// Visit grouping, per-visit plain averaging, and two-visit combination for Subtract mode.
// Pure functions only (no DOM globals).
import { AVERAGED_VISIT_NOTE, StackError, stackVisit, subtract } from '../lib/stack';
import type { SkyResult } from '../lib/source';
import { frameMjd } from './measure';

export interface Visit {
    ks: number[];
    mjd: number; // first look
    end: number; // last look
    n: number;
}

export type SubOp = 'diff' | 'sum';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utcDate(mjd: number): string
{
    const d = new Date((mjd - 40587) * 86400000);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// The UTC dates a visit covers: "9 Jul 2026", "30 Apr – 8 May 2026", "28 Dec 2025 – 3 Jan 2026".
export function visitDates(v: Visit): string
{
    const a = new Date((v.mjd - 40587) * 86400000);
    const b = new Date((v.end - 40587) * 86400000);
    const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
    if (sameYear && a.getUTCMonth() === b.getUTCMonth()) {
        return a.getUTCDate() === b.getUTCDate() ? utcDate(v.mjd) : `${a.getUTCDate()}–${utcDate(v.end)}`;
    }
    return sameYear ? `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${utcDate(v.end)}` : `${utcDate(v.mjd)} – ${utcDate(v.end)}`;
}

function looksText(n: number): string
{
    return n === 1 ? '1 look' : `${n} looks, averaged`;
}

// Frames less than `gapDays` after the previous look belong to one visit (the visitsOf rule), in date order.
export function visitGroups(result: SkyResult, gapDays = 10): Visit[]
{
    const dated = result.frames
        .map((f, k) => ({ k, mjd: frameMjd(f.frame) }))
        .filter((item) => Number.isFinite(item.mjd))
        .sort((a, b) => a.mjd - b.mjd || a.k - b.k);
    const out: Visit[] = [];
    let prev = -Infinity;
    for (const { k, mjd } of dated) {
        const last = out[out.length - 1];
        if (last && mjd - prev < gapDays) {
            last.ks.push(k);
            last.n = last.ks.length;
            last.end = mjd;
        } else {
            out.push({ ks: [k], mjd, end: mjd, n: 1 });
        }
        prev = mjd;
    }
    return out;
}

export function visitImage(result: SkyResult, v: Visit): Float32Array
{
    if (v.n === 1) {
        const first = result.frames[v.ks[0] ?? -1];
        if (!first) {
            throw new StackError('visitImage: missing frame');
        }
        return first.frame.data;
    }
    const frames = v.ks.map((k) => {
        const f = result.frames[k];
        if (!f) {
            throw new StackError(`visitImage: frame ${k} out of range`);
        }
        return f.frame;
    });
    return stackVisit(frames, { clipSigma: Infinity, background: 'none' }).data;
}

export function combineVisits(a: Float32Array, b: Float32Array, op: SubOp): Float32Array
{
    if (a.length !== b.length) {
        throw new StackError(`combineVisits: lengths differ (${a.length} vs ${b.length})`);
    }
    if (op === 'diff') {
        return subtract(b, a).data;
    }
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
        const va = a[i]!;
        const vb = b[i]!;
        out[i] = Number.isFinite(va) && Number.isFinite(vb) ? va + vb : NaN;
    }
    return out;
}

export function defaultPicks(visits: Visit[]): { a: number; b: number } | null
{
    if (visits.length < 2) {
        return null;
    }
    return { a: 0, b: visits.length - 1 };
}

export function subtractText(a: Visit, b: Visit, op: SubOp): string
{
    const dateA = visitDates(a);
    const dateB = visitDates(b);
    const looksA = looksText(a.n);
    const looksB = looksText(b.n);
    // A plain average keeps a spot that was in only one of its looks, at a fraction of its level.
    const avg = a.n > 1 || b.n > 1 ? ` ${AVERAGED_VISIT_NOTE}` : '';
    if (op === 'diff') {
        return `Later minus earlier: ${dateB} (${looksB}) minus ${dateA} (${looksA}). Blue marks more light in the earlier visit, orange more in the later one. Black means about the same, or a pixel blank in either visit.${avg}`;
    }
    return `Sum of the two visits, ${dateA} (${looksA}) plus ${dateB} (${looksB}): the pictures are added pixel by pixel, so light in both visits adds up and light in only one counts once. Pixels blank in either visit show black.${avg}`;
}

// The months a visit covers: "Jul 2026", "Apr–May 2026", "Dec 2025–Jan 2026". Also used by the looks sentence,
// so a visit that runs over a month end agrees with the thumbnails, which are dated frame by frame.
export function visitMonths(v: Pick<Visit, 'mjd' | 'end'>): string
{
    const a = new Date((v.mjd - 40587) * 86400000);
    const b = new Date((v.end - 40587) * 86400000);
    const my = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    if (my(a) === my(b)) {
        return my(a);
    }
    return a.getUTCFullYear() === b.getUTCFullYear() ? `${MONTHS[a.getUTCMonth()]}–${my(b)}` : `${my(a)}–${my(b)}`;
}

// The short header dates for A and B: months, or the full dates when the two visits share a month.
export function headerDates(a: Visit, b: Visit): [string, string]
{
    const month = (mjd: number) => {
        const d = new Date((mjd - 40587) * 86400000);
        return d.getUTCFullYear() * 12 + d.getUTCMonth();
    };
    const share = month(a.end) >= month(b.mjd) && month(b.end) >= month(a.mjd);
    return share ? [visitDates(a), visitDates(b)] : [visitMonths(a), visitMonths(b)];
}

export function visitLabel(v: Visit): string
{
    return `${visitDates(v)} · ${v.n === 1 ? '1 look' : `${v.n} looks`}`;
}
