import { describe, expect, it } from 'vitest';
import weights from '../public/models/change-classifier.json';
import parity from './fixtures/classify-parity.json';
import evaluation from '../public/models/change-classifier.eval.json';
import { classify, loadClassifier, stampFor } from '../src/lib/classify';
import type { OutputGrid } from '../src/lib/types';

const grid: OutputGrid = { center: { ra: 0, dec: 0 }, fovDeg: 0.1,
    pixelArcsec: 6.15, width: 41, height: 41 };

describe('snapshot change classifier', () => {
    it('validates the complete model and refuses malformed or incompatible weights', () => {
        expect(loadClassifier(weights).classes).toEqual(['mover', 'brightness', 'artifact', 'nothing']);
        for (const bad of [null, {}, { ...weights, classes: ['nothing'] },
            { ...weights, stamp: { ...weights.stamp, pixelArcsec: 1 } },
            { ...weights, trees: [] }, { ...weights, features: [] }]) {
            expect(() => loadClassifier(bad)).toThrow();
        }
        const oneTree = { ...weights, training: { ...weights.training, rounds: 1 } };
        expect(() => loadClassifier({ ...oneTree, trees: [{ value: [Infinity, 0, 0, 0] }] })).toThrow();
        expect(() => loadClassifier({ ...oneTree, trees: [{ value: [] }] })).toThrow();
        expect(() => loadClassifier({ ...oneTree, trees: [{ value: [1e300, 0, 0, 0] }] })).toThrow();
        expect(() => loadClassifier({ ...oneTree, trees: [{ feature: 12, threshold: 1 }] })).toThrow();
        const node = { feature: 0, threshold: 1, left: { value: [0, 0, 0, 0] }, right: { value: [0, 0, 0, 0] } };
        expect(() => loadClassifier({ ...oneTree, trees: [{ ...node, threshold: NaN }] })).toThrow();
        expect(() => loadClassifier({ ...oneTree, trees: [{ ...node, left: { ...node, left: {
            ...node, left: { ...node, left: node } } } }] })).toThrow();
        expect(() => loadClassifier({ ...weights, training: { ...weights.training, counts: {} } })).toThrow();
    });

    it('matches PyTorch for twenty exported stamps to 1e-4', () => {
        const model = loadClassifier(weights);
        expect(parity.cases).toHaveLength(20);
        for (const sample of parity.cases) {
            const result = classify(model, Float32Array.from(sample.stamp));
            model.classes.forEach((kind, i) => {
                expect(Math.abs(result.p[kind] - sample.probabilities[i]!)).toBeLessThan(1e-4);
            });
            expect(Object.values(result.p).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        }
        expect(() => classify(model, new Float32Array(4))).toThrow();
        const invalid = new Float32Array(675);
        invalid[1] = NaN;
        expect(() => classify(model, invalid)).toThrow();
        expect(classify(model, new Float32Array(675)).kind).toBe('nothing');
    });

    it('cuts CHW native stamps and bilinearly resamples a finer output grid', () => {
        const a = Float32Array.from({ length: 41 * 41 }, (_, i) => i % 41 + 2 * Math.floor(i / 41));
        const b = a.map((v) => v + 4);
        const stamp = stampFor(a, b, grid, { x: 20.25, y: 19.5 }, 2)!;
        expect(stamp).toHaveLength(675);
        expect(stamp[112]).toBeCloseTo((20.25 + 2 * 19.5) / 2, 6);
        expect(stamp[225 + 112]).toBeCloseTo(stamp[112]! + 2, 6);
        expect(stamp[450 + 112]).toBe(2);
        const fineGrid = { ...grid, width: 81, height: 81, pixelArcsec: 3.075 };
        const fine = Float32Array.from({ length: 81 * 81 }, (_, i) => (i % 81) / 2);
        const native = stampFor(fine, fine, fineGrid, { x: 40.5, y: 40 }, 1)!;
        expect(native[0]).toBeCloseTo(13.25, 6);
        expect(native[14]).toBeCloseTo(27.25, 6);
    });

    it('rejects edges, nonfinite contributors, invalid dimensions and sigma', () => {
        const a = new Float32Array(41 * 41), b = a.slice();
        expect(stampFor(a, b, grid, { x: 2, y: 20 }, 1)).toBeUndefined();
        expect(stampFor(a, b, grid, { x: 35, y: 20 }, 1)).toBeUndefined();
        expect(stampFor(a, b, grid, { x: 20, y: 20 }, 0)).toBeUndefined();
        expect(stampFor(a, b, grid, { x: NaN, y: 20 }, 1)).toBeUndefined();
        expect(stampFor(a, b, { ...grid, pixelArcsec: 0 }, { x: 20, y: 20 }, 1)).toBeUndefined();
        expect(stampFor(a.subarray(1), b, grid, { x: 20, y: 20 }, 1)).toBeUndefined();
        a[20 * 41 + 20] = NaN;
        expect(stampFor(a, b, grid, { x: 20, y: 20 }, 1)).toBeUndefined();
        a[20 * 41 + 20] = 0;
        b[20 * 41 + 20] = Infinity;
        expect(stampFor(a, b, grid, { x: 20.2, y: 20.2 }, 1)).toBeUndefined();
    });

    it('calls an independently injected moving point source a mover', () => {
        const a = new Float32Array(41 * 41), b = a.slice();
        for (let y = 0; y < 41; y++) {
            for (let x = 0; x < 41; x++) {
                a[y * 41 + x] = 18 * Math.exp(-((x - 17) ** 2 + (y - 20) ** 2) / 2);
                b[y * 41 + x] = 18 * Math.exp(-((x - 22) ** 2 + (y - 20) ** 2) / 2);
            }
        }
        const result = classify(loadClassifier(weights), stampFor(a, b, grid, { x: 22, y: 20 }, 1)!);
        expect(result.kind).toBe('mover');
        expect(result.p.mover).toBeGreaterThan(0.5);
    });

    it('ships only measured passing target-held-out metrics and a small model', () => {
        expect(new TextEncoder().encode(JSON.stringify(weights)).length).toBeLessThanOrEqual(200_000);
        expect(evaluation.folds).toHaveLength(5);
        expect(evaluation.gate.passed).toBe(true);
        expect(evaluation.meanFoldMetrics.macroF1).toBeGreaterThanOrEqual(0.8);
        expect(evaluation.meanFoldMetrics.moverRecallSnr10).toBeGreaterThanOrEqual(0.85);
        expect(evaluation.meanFoldMetrics.artifactPrecision).toBeGreaterThanOrEqual(0.85);
        for (const fold of evaluation.folds) {
            expect(fold.trainTargets).not.toContain(fold.testTarget);
            expect(fold.trainTargets).toHaveLength(4);
        }
    });
});
