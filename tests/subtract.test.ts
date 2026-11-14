import { describe, expect, it } from 'vitest';
import { StackError, stackVisit, subtract } from '../src/lib/stack';
import type { SkyResult } from '../src/lib/source';
import type { FrameRecord, OutputGrid, RegriddedFrame } from '../src/lib/types';
import { frameMjd, visitsOf } from '../src/ui/measure';
import { combineVisits, defaultPicks, headerDates, subtractText, visitDates, visitGroups, visitImage, visitLabel, type Visit } from '../src/ui/subtract';

const W = 4;
const grid: OutputGrid = { center: { ra: 10, dec: 20 }, fovDeg: 0.1, pixelArcsec: 6.15, width: W, height: W };

function mjdUtc(year: number, month: number, day: number, fracDay = 0): number
{
    return Date.UTC(year, month - 1, day) / 86400000 + 40587 + fracDay;
}

function makeFrame(k: number, tMin: number, values?: ArrayLike<number>, tMax = tMin + 0.01): RegriddedFrame
{
    const data = new Float32Array(W * W);
    for (let i = 0; i < data.length; i++) {
        data[i] = values ? (values[i % values.length] ?? 0) : k + i * 0.25;
    }
    const rec: FrameRecord = {
        obsId: `F${k}`,
        collection: 'spherex_dr1',
        release: 'dr1',
        detector: 1,
        url: '',
        tMin,
        tMax,
        lambdaMin: 0.75,
        lambdaMax: 1.09,
    };
    return { frame: rec, grid, data, lambdaAtCenter: 0.9, bandwidthAtCenter: 0.02 };
}

function makeResult(frames: RegriddedFrame[]): SkyResult
{
    return {
        source: 'live',
        grid,
        frames: frames.map((frame) => ({ frame, label: '' })),
        locked: frames.map((f) => ({ frame: f.frame, lambda: 0.9, dLambda: 0 })),
        lambda: 0.9,
        stars: [],
        credits: [],
        notes: [],
    };
}

const BANNED = /\b(changed|discover\w*|detected|confirm\w*|proves?|brighter)\b/i;

describe('visitGroups', () => {
    it('chains 9-day gaps into one visit, splits at gapDays, sorts out-of-order frames, and skips NaN dates', () => {
        const frames = [
            makeFrame(0, 61200), // later visit, second look
            makeFrame(1, NaN, undefined, NaN), // invalid date
            makeFrame(2, 61009), // middle of chained visit (+9 d)
            makeFrame(3, 61195), // later visit, first look
            makeFrame(4, 61000), // earliest look
            makeFrame(5, 61018), // end of chained visit (+9 d from 61009, +18 d from 61000)
            makeFrame(6, 61028), // exactly +10 d after 61018 -> starts a new visit
            makeFrame(7, 61050, undefined, NaN), // non-finite tMax -> frameMjd is NaN
        ];
        const r = makeResult(frames);
        const groups = visitGroups(r);
        expect(groups).toEqual([
            { ks: [4, 2, 5], mjd: frameMjd(frames[4]!), end: frameMjd(frames[5]!), n: 3 },
            { ks: [6], mjd: frameMjd(frames[6]!), end: frameMjd(frames[6]!), n: 1 },
            { ks: [3, 0], mjd: frameMjd(frames[3]!), end: frameMjd(frames[0]!), n: 2 },
        ]);
        expect(groups.map((v) => ({ mjd: v.mjd, n: v.n }))).toEqual(visitsOf(r));
        expect(visitGroups(makeResult([]))).toEqual([]);
    });

    it('honours a custom gapDays threshold', () => {
        const r = makeResult([makeFrame(0, 61000), makeFrame(1, 61005), makeFrame(2, 61009)]);
        expect(visitGroups(r, 5).map((v) => v.ks)).toEqual([[0], [1, 2]]);
    });
});

describe('visitImage', () => {
    it('returns the exact frame array for a one-look visit without calling stackVisit', () => {
        // An invalid pixelArcsec would make stackVisit throw StackError if it were called.
        const single = makeFrame(0, 61000, [3, 7, NaN, 11]);
        single.grid = { ...grid, pixelArcsec: 0 };
        const r = makeResult([single]);
        const v: Visit = { ks: [0], mjd: frameMjd(single), end: frameMjd(single), n: 1 };
        const img = visitImage(r, v);
        expect(img).toBe(single.data);
    });

    it('matches stackVisit plain average (no clipping, no background subtraction) on multi-look visits', () => {
        // Include background offsets and a large spike on one frame so default clipping/background would differ.
        const f0 = makeFrame(0, 61000, [10, 10, 10, 10]);
        const f1 = makeFrame(1, 61001, [12, 12, 12, 12]);
        const f2 = makeFrame(2, 61002, [14, 14, 14, 14]);
        const f3 = makeFrame(3, 61003, [16, 16, 16, 16]);
        f2.data[0] = 500;
        f3.data[1] = NaN;
        const r = makeResult([f3, f1, f0, f2]);
        const visits = visitGroups(r);
        expect(visits).toHaveLength(1);
        const got = visitImage(r, visits[0]!);
        const want = stackVisit([f0, f1, f2, f3], { clipSigma: Infinity, background: 'none' }).data;
        expect(Array.from(got)).toEqual(Array.from(want));
        expect(got[0]).toBeCloseTo((10 + 12 + 500 + 16) / 4, 5);
        expect(got[1]).toBeCloseTo((10 + 12 + 14) / 3, 5);
    });
});

describe('combineVisits', () => {
    it('computes subtract(b, a) for diff', () => {
        const a = new Float32Array([2, 10, NaN, 4]);
        const b = new Float32Array([7, 3, 5, NaN]);
        const got = combineVisits(a, b, 'diff');
        const want = subtract(b, a).data;
        expect(Array.from(got)).toEqual(Array.from(want));
        expect(got[0]).toBe(5);
        expect(got[1]).toBe(-7);
        expect(Number.isNaN(got[2]!)).toBe(true);
        expect(Number.isNaN(got[3]!)).toBe(true);
    });

    it('computes pixelwise a + b for sum with NaN where either input is NaN', () => {
        const a = new Float32Array([1.5, NaN, 4, NaN, -2]);
        const b = new Float32Array([2.5, 8, NaN, NaN, 5]);
        const got = combineVisits(a, b, 'sum');
        expect(got[0]).toBe(4);
        expect(Number.isNaN(got[1]!)).toBe(true);
        expect(Number.isNaN(got[2]!)).toBe(true);
        expect(Number.isNaN(got[3]!)).toBe(true);
        expect(got[4]).toBe(3);
    });

    it('throws StackError on a length mismatch for both operations', () => {
        const a = new Float32Array(4);
        const b = new Float32Array(5);
        expect(() => combineVisits(a, b, 'diff')).toThrow(StackError);
        expect(() => combineVisits(a, b, 'sum')).toThrow(StackError);
    });
});

describe('defaultPicks', () => {
    it('returns null under 2 visits and first/last otherwise', () => {
        const v = (mjd: number): Visit => ({ ks: [0], mjd, end: mjd, n: 1 });
        expect(defaultPicks([])).toBeNull();
        expect(defaultPicks([v(61000)])).toBeNull();
        expect(defaultPicks([v(61000), v(61100)])).toEqual({ a: 0, b: 1 });
        expect(defaultPicks([v(61000), v(61100), v(61200), v(61300)])).toEqual({ a: 0, b: 3 });
    });
});

describe('subtractText and visitLabel', () => {
    const at = (y: number, m: number, d: number, f = 0) => mjdUtc(y, m, d, f);
    const visitA1: Visit = { ks: [0], mjd: at(2025, 7, 18, 0.25), end: at(2025, 7, 18, 0.25), n: 1 };
    const visitB3: Visit = { ks: [1, 2, 3], mjd: at(2026, 7, 9, 0.75), end: at(2026, 7, 14, 0.2), n: 3 };
    const visitA2: Visit = { ks: [0, 1], mjd: at(2024, 12, 28, 0.1), end: at(2025, 1, 3, 0.1), n: 2 };
    const visitB1: Visit = { ks: [2], mjd: at(2026, 11, 20, 0.9), end: at(2026, 11, 20, 0.9), n: 1 };
    const visitC2: Visit = { ks: [3, 4], mjd: at(2026, 4, 30, 0.8), end: at(2026, 5, 8, 0.1), n: 2 };
    const visitD2: Visit = { ks: [5, 6], mjd: at(2026, 6, 1, 0.1), end: at(2026, 6, 1, 0.3), n: 2 };
    const AVG = ' An averaged visit can show a spot that was in only one of its looks.';

    it('writes the dates a visit covers, in UTC', () => {
        expect(visitDates(visitA1)).toBe('18 Jul 2025');
        expect(visitDates(visitB3)).toBe('9–14 Jul 2026');
        expect(visitDates(visitA2)).toBe('28 Dec 2024 – 3 Jan 2025');
        expect(visitDates(visitC2)).toBe('30 Apr – 8 May 2026');
        expect(visitDates(visitD2)).toBe('1 Jun 2026');
    });

    it('writes header months, or full dates when the two visits share a month', () => {
        expect(headerDates(visitA1, visitB3)).toEqual(['Jul 2025', 'Jul 2026']);
        expect(headerDates(visitA2, visitC2)).toEqual(['Dec 2024–Jan 2025', 'Apr–May 2026']);
        const may25: Visit = { ks: [0], mjd: at(2025, 5, 2), end: at(2025, 5, 2), n: 1 };
        const late: Visit = { ks: [1, 2], mjd: at(2025, 5, 20), end: at(2025, 5, 27), n: 2 };
        const aprMay: Visit = { ks: [0, 1], mjd: at(2025, 4, 28), end: at(2025, 5, 5), n: 2 };
        const mid: Visit = { ks: [2], mjd: at(2025, 5, 16), end: at(2025, 5, 16), n: 1 };
        expect(headerDates(may25, late)).toEqual(['2 May 2025', '20–27 May 2025']);
        expect(headerDates(aprMay, mid)).toEqual(['28 Apr – 5 May 2025', '16 May 2025']);
    });

    it('formats option labels with singular and plural look counts', () => {
        expect(visitLabel(visitA1)).toBe('18 Jul 2025 · 1 look');
        expect(visitLabel(visitB3)).toBe('9–14 Jul 2026 · 3 looks');
    });

    it('formats both diff and sum sentences exactly', () => {
        expect(subtractText(visitA1, visitB3, 'diff')).toBe(
            `Later minus earlier: 9–14 Jul 2026 (3 looks, averaged) minus 18 Jul 2025 (1 look). Blue marks more light in the earlier visit, orange more in the later one. Black means about the same, or a pixel blank in either visit.${AVG}`,
        );
        expect(subtractText(visitA2, visitB1, 'diff')).toBe(
            `Later minus earlier: 20 Nov 2026 (1 look) minus 28 Dec 2024 – 3 Jan 2025 (2 looks, averaged). Blue marks more light in the earlier visit, orange more in the later one. Black means about the same, or a pixel blank in either visit.${AVG}`,
        );
        expect(subtractText(visitA1, visitB1, 'diff')).toBe(
            'Later minus earlier: 20 Nov 2026 (1 look) minus 18 Jul 2025 (1 look). Blue marks more light in the earlier visit, orange more in the later one. Black means about the same, or a pixel blank in either visit.',
        );
        expect(subtractText(visitA1, visitB3, 'sum')).toBe(
            `Sum of the two visits, 18 Jul 2025 (1 look) plus 9–14 Jul 2026 (3 looks, averaged): the pictures are added pixel by pixel, so light in both visits adds up and light in only one counts once. Pixels blank in either visit show black.${AVG}`,
        );
        expect(subtractText(visitA1, visitB1, 'sum')).toBe(
            'Sum of the two visits, 18 Jul 2025 (1 look) plus 20 Nov 2026 (1 look): the pictures are added pixel by pixel, so light in both visits adds up and light in only one counts once. Pixels blank in either visit show black.',
        );
    });

    it('uses no banned words in any sentence or label', () => {
        for (const [a, b] of [[visitA1, visitB3], [visitA2, visitB1], [visitC2, visitD2]] as const) {
            expect(visitLabel(a)).not.toMatch(BANNED);
            expect(visitLabel(b)).not.toMatch(BANNED);
            expect(subtractText(a, b, 'diff')).not.toMatch(BANNED);
            expect(subtractText(a, b, 'sum')).not.toMatch(BANNED);
        }
    });
});
