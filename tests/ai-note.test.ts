import { describe, expect, it } from 'vitest';
import { busyText, factsInput, leftText, visitGroups } from '../src/ui/ai-note';
import { buildFacts } from '../src/lib/insight-facts';
import { validateFacts } from '../src/lib/insight';
import type { SkyResult } from '../src/lib/source';
import type { FrameRecord, OutputGrid, RegriddedFrame } from '../src/lib/types';
import type { Shift } from '../src/ui/measure';

const N = 40;
const grid: OutputGrid = { center: { ra: 10, dec: 20 }, fovDeg: (N * 6) / 3600, pixelArcsec: 6, width: N, height: N };

function frame(mjd: number, peak = 0): RegriddedFrame
{
    const data = new Float32Array(N * N);
    for (let i = 0; i < data.length; i++) {
        data[i] = 1 + 0.05 * Math.sin(i * 12.9898 + mjd * 0.37);
    }
    data[(N / 2) * N + N / 2] = 1 + peak;
    const rec = { obsId: `F${mjd}`, collection: 'spherex_dr1', release: 'DR1', detector: 1, url: '', tMin: mjd, tMax: mjd + 0.01 } as unknown as FrameRecord;
    return { frame: rec, grid, data, lambdaAtCenter: 1.2, bandwidthAtCenter: 0.02 };
}

function sky(mjds: number[], source: 'live' | 'snapshot' = 'snapshot'): SkyResult
{
    const frames = mjds.map((m, i) => ({ frame: frame(m, i === mjds.length - 1 ? 5 : 0), label: '' }));
    return {
        source, grid, frames, lambda: 1.2, stars: [], credits: [], notes: [],
        locked: frames.map((f) => ({ frame: f.frame.frame, lambda: 1.2, dLambda: 0 })),
    };
}

describe('visitGroups', () => {
    it('chains frames under 10 days apart into one visit, in date order', () => {
        const g = visitGroups(sky([61195, 61000, 61004, 61008, 61190]));
        expect(g.map((v) => v.length)).toEqual([3, 2]);
        expect(g[0]![0]!.frame.tMin).toBe(61000);
    });
});

describe('factsInput', () => {
    it('builds facts the insight library accepts, from the frames on screen', () => {
        const res = sky([61000, 61003, 61180]);
        const facts = buildFacts(factsInput({ result: res, targetId: 'barnard', center: { ra: 269.45, dec: 4.74 }, curve: null }));
        expect(validateFacts(facts)).toEqual(facts);
        expect(facts.targetId).toBe('barnard');
        expect(facts.snapshot).toBe(true);
        expect(facts.visits.map((v) => v.frames)).toEqual([2, 1]);
        expect(facts.lambdaUm).toBe(1.2);
        expect(facts.difference?.peakSigma).toBeGreaterThan(3);
        expect(facts.motion).toBeUndefined();
    });

    it('marks a typed-in spot as custom and a live read as not the saved copy', () => {
        const input = factsInput({ result: sky([61000, 61180], 'live'), center: { ra: 1, dec: 2 }, curve: null });
        expect(input.targetId).toBe('custom');
        expect(input.snapshot).toBe(false);
    });

    it('sends a measured shift only when it clears its own error', () => {
        const res = sky([61000, 61180]);
        const base: Shift = { from: 0, to: 1, predictedArcsec: 5, errArcsec: 2, significant: true, measured: { measuredArcsec: 4.6 } as Shift['measured'] };
        expect(factsInput({ result: res, center: grid.center, curve: null, shift: base }).shift).toEqual({ measuredArcsec: 4.6, days: 180 });
        expect(factsInput({ result: res, center: grid.center, curve: null, shift: { ...base, significant: false } }).shift).toBeUndefined();
        expect(factsInput({ result: res, center: grid.center, curve: null, shift: { ...base, measured: null } }).shift).toBeUndefined();
        expect(factsInput({ result: res, center: grid.center, curve: null, shift: { ...base, errArcsec: 3 } }).shift).toBeUndefined();
    });

    it('leaves the difference out with a single frame', () => {
        expect(factsInput({ result: sky([61000]), center: grid.center, curve: null }).difference).toBeUndefined();
    });
});

describe('panel wording', () => {
    it('counts notes left in plain words', () => {
        expect(leftText(1)).toBe('1 AI note left today');
        expect(leftText(3)).toBe('3 AI notes left today');
    });

    it('says why it is busy', () => {
        expect(busyText({ reason: 'daily' })).toBe('You have used today’s AI notes.');
        expect(busyText({ retryAfter: 20 })).toBe('Too many requests. Try again in 20 s.');
        expect(busyText({})).toBe('Too many requests. Try again in a minute.');
    });
});
