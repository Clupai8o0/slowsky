import { describe, expect, it, vi } from 'vitest';
import { changeInput } from '../src/lib/change-input';
import { hintsFor } from '../src/lib/change-hints';
import { classify, loadClassifier, stampFor } from '../src/lib/classify';
import type { VisitChangeResult } from '../src/lib/changes';
import type { SkyResult } from '../src/lib/source';
import type { OutputGrid, RegriddedFrame } from '../src/lib/types';
import weights from '../public/models/change-classifier.json';
import * as classifier from '../src/lib/classify';

const grid: OutputGrid = { center: { ra: 20, dec: 30 }, fovDeg: 0.1, pixelArcsec: 6.15, width: 41, height: 41 };
const model = loadClassifier(weights);

function fixture(): SkyResult
{
    const frames = [0, 1, 2, 3].map((n) => {
        const data = Float32Array.from({ length: 41 * 41 }, (_, i) => 100 + n * 3 + Math.sin(i * 0.3));
        data[20 * 41 + 20]! += n * 8;
        const frame: RegriddedFrame = { frame: { obsId: String(n), collection: 'spherex_dr1', release: 'dr1',
            detector: 1, url: '', tMin: 60000 + Math.floor(n / 2) * 30 + n / 100, tMax: 60000 + Math.floor(n / 2) * 30 + n / 100 + 0.001,
            lambdaMin: 1, lambdaMax: 3 }, grid, data, variance: new Float32Array(data.length).fill(n + 1),
            lambdaAtCenter: 2, bandwidthAtCenter: 0.1 };
        return { frame, label: String(n) };
    });
    return { source: 'live', grid, frames, locked: [], lambda: 2, stars: [], credits: [], notes: [] };
}

function found(result: SkyResult): VisitChangeResult
{
    const input = changeInput(result);
    return { candidates: [], rejected: { streaks: 0, single: 0, edge: 0, residual: 0 }, sigma: 2, threshold: 5,
        skipped: [], notes: [], visits: { earlier: { obsIds: input.earlier.obsIds, mjd: input.earlier.mjd },
            later: { obsIds: input.later.obsIds, mjd: input.later.mjd } } };
}

describe('change hints', () => {
    it('uses the same error-map visit images and preserves candidate order', () => {
        const result = fixture(), comparison = found(result), input = changeInput(result);
        const candidates = [{ x: 20, y: 20 }, { x: 1, y: 1 }, { x: 19, y: 20 }];
        const spy = vi.spyOn(classifier, 'stampFor');
        const hints = hintsFor(result, comparison, candidates, model);
        expect(spy.mock.calls[0]![0]).toEqual(input.earlier.data);
        expect(spy.mock.calls[0]![1]).toEqual(input.later.data);
        expect(spy.mock.calls[0]![4]).toBe(comparison.sigma);
        spy.mockRestore();
        expect(hints).toEqual([classify(model, stampFor(input.earlier.data, input.later.data, grid, candidates[0]!, comparison.sigma)!),
            expect.objectContaining({ kind: 'declined' }),
            classify(model, stampFor(input.earlier.data, input.later.data, grid, candidates[2]!, comparison.sigma)!)]);
    });

    it('declines invalid sigma, positions and mismatched visits', () => {
        const result = fixture(), comparison = found(result), candidates = [{ x: 20, y: 20 }, { x: NaN, y: 20 }];
        expect(hintsFor(result, { ...comparison, sigma: NaN }, candidates, model).every(c => c.kind === 'declined')).toBe(true);
        expect(hintsFor(result, { ...comparison, visits: { ...comparison.visits, earlier: { ...comparison.visits.earlier, obsIds: ['wrong'] } } }, candidates, model)
            .every(c => c.kind === 'declined')).toBe(true);
        expect(hintsFor(result, comparison, candidates, model)[1]?.kind).toBe('declined');
        result.frames[0]!.frame.data[20 * 41 + 20] = NaN;
        result.frames[1]!.frame.data[20 * 41 + 20] = NaN;
        expect(hintsFor(result, comparison, [{ x: 20, y: 20 }], model)[0]?.kind).toBe('declined');
    });
});
