// Visit grouping, per-visit plain averaging, and two-visit combination for Subtract mode.
// Pure functions only (no DOM globals).
import { StackError, stackVisit, subtract } from '../lib/stack';
import type { SkyResult } from '../lib/source';
import { frameMjd } from './measure';

export interface Visit {
    ks: number[];
    mjd: number;
    n: number;
}

export type SubOp = 'diff' | 'sum';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utcDate(mjd: number): string
{
    const d = new Date((mjd - 40587) * 86400000);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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
        } else {
            out.push({ ks: [k], mjd, n: 1 });
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
    const dateA = utcDate(a.mjd);
    const dateB = utcDate(b.mjd);
    const looksA = looksText(a.n);
    const looksB = looksText(b.n);
    if (op === 'diff') {
        return `Later minus earlier: ${dateB} (${looksB}) minus ${dateA} (${looksA}). Blue was there on the earlier date, orange on the later one.`;
    }
    return `Sum of the two visits, ${dateA} (${looksA}) plus ${dateB} (${looksB}): what is in both adds up, and anything in only one shows at its own level. Pixels blank in either visit show black.`;
}

export function visitLabel(v: Visit): string
{
    return `${utcDate(v.mjd)} · ${v.n === 1 ? '1 look' : `${v.n} looks`}`;
}
