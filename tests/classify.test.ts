import { describe, expect, it } from 'vitest';
// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { createHash } from 'node:crypto';
// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { readFileSync } from 'node:fs';
import weights from '../public/models/change-classifier.json';
import treeWeights from '../models/change-classifier-trees.json';
import cnnWeightsAttempt from '../models/change-classifier-cnn.json';
import parity from './fixtures/classify-parity.json';
import evaluation from '../models/change-classifier.eval.json';
import { classify, loadClassifier, stampFor } from '../src/lib/classify';
import type { OutputGrid } from '../src/lib/types';

it('records a compact card and per-fold gate exceptions from the evaluation', () => {
    const card = JSON.parse(readFileSync(new URL('../public/models/change-classifier.card.json', import.meta.url), 'utf8'));
    const digest = createHash('sha256').update(readFileSync(new URL('../models/change-classifier.eval.json', import.meta.url))).digest('hex');
    const worst = evaluation.folds.find((fold) => fold.testTarget === evaluation.worstFold)!;
    const round3 = (value: number): number => Math.round(value * 1000) / 1000;
    expect(card.macroF1).toBeUndefined();
    expect(card.meanFoldMacroF1).toBe(round3(evaluation.meanFoldMetrics.macroF1));
    expect(card.accuracy).toBe(round3(evaluation.meanFoldMetrics.accuracy));
    expect(card.worstFold).toEqual({ target: worst.testTarget, macroF1: round3(worst.macroF1) });
    expect(card.treesMacroF1).toBe(round3(evaluation.cnnAttempt.sameTestTrees.meanFoldMetrics.macroF1));
    expect(card.treesNote).toBe('Trees saw 600 stamps per class per target, the CNN 2,500: not like-for-like.');
    // Every fold under a gate is named on the card with its value.
    const gated = evaluation as typeof evaluation & { worstFoldGate: Record<string, { target: string; value: number }[]> };
    for (const items of Object.values(gated.worstFoldGate)) {
        for (const item of items) {
            expect(card.belowGate).toContain(item.target);
            expect(card.belowGate).toContain(item.value.toFixed(3));
        }
    }
    const low = evaluation.recallBySnrBin.find((bin) => bin.lo === 3 && bin.hi === 5)!;
    expect(card.limits).toContain(`Mover recall is ${low.classes.mover.recall!.toFixed(2)} at S/N 3-5`);
    const frameCounts = evaluation.folds.map((fold) => evaluation.psfMeasurements
        .filter((frame) => frame.target === fold.testTarget).length);
    const testCounts = [...new Set(evaluation.folds.map((fold) => fold.testCount))].sort((a, b) => a - b);
    expect(card.evaluation).toBe(`Leave-one-target-out over ${evaluation.folds.length} SPHEREx fields `
        + `(${Math.min(...frameCounts)}-${Math.max(...frameCounts)} frames each), `
        + `${testCounts.map((n) => n.toLocaleString('en-US')).join('/')} test stamps per fold. `
        + `Scores are from fold models; the shipped model is trained on all ${evaluation.folds.length}.`);
    expect(card.data).toBe('Fake changes added to real SPHEREx DR1/QR3 frames; before and after are one frame with fresh fake noise, '
        + 'not two visits. No real movers, no human labels.');
    const total = Object.values(evaluation.perClass).reduce((sum, value) => sum + value.count, 0);
    const share = evaluation.perClass.mover.count / total;
    const prevalence = share === 0.25 ? 'A quarter of test stamps are movers'
        : `${Number((share * 100).toFixed(2))}% of test stamps are movers`;
    expect(card.limits).toBe('Labels change spots only; it does not find planets. Not tested on a real asteroid. '
        + `Mover recall is ${low.classes.mover.recall!.toFixed(2)} at S/N 3-5. `
        + `${prevalence}; if real ones are rarer, more mover labels are wrong.`);
    const misses = Object.values(gated.worstFoldGate).flat();
    if (misses.length === 0) {
        expect(card.belowGate).toBeUndefined();
    } else {
        expect(card.belowGate).not.toContain('under the gate');
        for (const key of ['moverRecallSnr10', 'artifactPrecision']) {
            if (gated.worstFoldGate[key]!.length > 0) {
                expect(card.belowGate).toMatch(/below the 0\.85 target/i);
            }
        }
    }
    for (const text of [JSON.stringify(card), weights.aiNote, weights.madeBy]) {
        expect(text).not.toMatch(/discover|confirm|detected/i);
    }
    expect(weights.madeBy).toContain('Codex (OpenAI) and Claude');
    expect(evaluation.treesBaseline.selectionReason).toBe('Baseline only; not shipped. Kept for comparison.');
    const updated = evaluation as typeof evaluation & {
        worstFoldGate: unknown; comparisonNote: string;
        cnnAttempt: typeof evaluation.cnnAttempt & { sameTestTrees: typeof evaluation.cnnAttempt.sameTestTrees & { note: string } };
    };
    expect(card.treesNote).toBe(updated.cnnAttempt.sameTestTrees.note);
    expect(updated.comparisonNote).toBe(card.treesNote);
    expect(evaluation.validation).toContain('Synthetic injections only; each fold holds out all frames of one target');
    expect(evaluation.validation).toContain('not accuracy on real unknown objects');
    // Whichever model is kept (CNN or the trees fallback), the eval says the folds were used for selection.
    expect(evaluation.configurationSelection).toMatch(/development validation, not an untouched benchmark/i);
    expect(card.evalSha256).toBe(digest);
    expect(card.seed).toBe(evaluation.seed);
    expect(readFileSync(new URL('../public/models/change-classifier.card.json', import.meta.url)).length).toBeLessThan(1280);
    // The one frozen retest is on the card with its caveat, its numbers from the result file (-ba, 14 Nov).
    const confirm = JSON.parse(readFileSync(new URL('../models/change-classifier.confirm.json', import.meta.url), 'utf8'));
    expect(confirm.evalSha256).toBe(digest);
    expect(card.retest).toContain(confirm.passed ? 'Passed a frozen retest' : 'Failed a frozen retest');
    expect(card.retest).toContain('fresh synthetic draw (same fields and frames, not new sky)');
    expect(card.retest).toContain(`macro-F1 ${confirm.meanFoldMetrics.macroF1.toFixed(3)}`);
    expect(card.retest).toContain(`artifact precision ${confirm.meanFoldMetrics.artifactPrecision.toFixed(3)}`);
    const [lo, hi] = confirm.bootstrap.meanArtifactPrecision95 as [number, number];
    expect(card.retest).toContain(`(95% ${lo.toFixed(3)}-${hi.toFixed(3)})`);
    const thresholds = { moverRecallSnr10: 0.85, artifactPrecision: 0.85, macroF1: 0.80 } as const;
    const expected = Object.fromEntries(Object.entries(thresholds).map(([key, threshold]) => [key,
        evaluation.folds.filter((fold) => fold[key as keyof typeof thresholds] < threshold)
            .map((fold) => ({ target: fold.testTarget, value: fold[key as keyof typeof thresholds] }))]));
    expect(updated.worstFoldGate).toEqual(expected);
});

const grid: OutputGrid = { center: { ra: 0, dec: 0 }, fovDeg: 0.1,
    pixelArcsec: 6.15, width: 41, height: 41 };

function cnnWeights()
{
    const layer = (inputs: number, outputs: number, kernel: number) => ({
        weights: Array.from({ length: inputs * outputs * kernel }, () => 0),
        bias: Array.from({ length: outputs }, () => 0),
    });
    return { ...treeWeights, architecture: 'cnn-3x3-gap-features-12-16-16',
        inputTransform: 'median-asinh-5', featureMean: Array(12).fill(0) as number[],
        featureScale: Array(12).fill(1) as number[],
        conv: [layer(3, 12, 9), layer(12, 16, 9), layer(16, 16, 9)],
        dense: [layer(28, 32, 1), { ...layer(32, 4, 1), bias: [0, 1, 2, 3] }],
        training: { ...treeWeights.training, peakSnrMax: 40, epochs: 20, batchNormFolded: true } };
}

describe('snapshot change classifier', () => {
    it('declines a flat gradient even within the training S/N range', () => {
        const stamp = new Float32Array(675);
        for (let y = 0; y < 15; y++) {
            for (let x = 0; x < 15; x++) {
                const at = y * 15 + x, value = 4 + x / 7 + y / 14;
                stamp[225 + at] = value;
                stamp[450 + at] = value;
            }
        }
        expect(classify(loadClassifier(cnnWeights()), stamp)).toEqual({
            kind: 'declined', reason: 'no localized change to label',
        });
    });

    it('declines pure noise with a peak below 2.5 sigma', () => {
        const stamp = new Float32Array(675);
        for (let i = 0; i < 225; i++) {
            stamp[i] = Math.sin(i * 73.1) * 1.1;
            stamp[225 + i] = Math.cos(i * 17.3) * 1.1;
            stamp[450 + i] = stamp[225 + i]! - stamp[i]!;
        }
        expect(classify(loadClassifier(cnnWeights()), stamp)).toEqual({
            kind: 'declined', reason: 'too faint to label',
        });
    });

    it('declines a peak at three times the recorded training maximum', () => {
        for (const peakSnrMax of [12, 40]) {
            const cnn = cnnWeights();
            cnn.training.peakSnrMax = peakSnrMax;
            const stamp = new Float32Array(675);
            stamp[225 + 112] = stamp[450 + 112] = -3 * peakSnrMax;
            expect(classify(loadClassifier(cnn), stamp)).toEqual({
                kind: 'declined', reason: 'brighter than anything in training',
            });
        }
    });

    it('keeps both S/N boundaries in range and validates the recorded maximum', () => {
        const cnn = cnnWeights();
        for (const peak of [2.5, 2 * cnn.training.peakSnrMax]) {
            const stamp = new Float32Array(675);
            stamp[225 + 112] = stamp[450 + 112] = peak;
            expect(classify(loadClassifier(cnn), stamp).kind).toBe('nothing');
        }
        for (const peakSnrMax of [undefined, '40', NaN, Infinity, -1, 0, 2.4]) {
            expect(() => loadClassifier({ ...cnn, training: { ...cnn.training, peakSnrMax } })).toThrow(/peak S\/N/);
        }
    });

    it('dispatches folded CNN weights and rejects malformed neural layers', () => {
        const cnn = cnnWeights();
        const model = loadClassifier(cnn);
        const stamp = new Float32Array(675);
        stamp[225 + 112] = stamp[450 + 112] = 5;
        const result = classify(model, stamp);
        if (result.kind === 'declined') {
            throw new Error(result.reason);
        }
        expect(result.kind).toBe('nothing');
        expect(result.p.nothing).toBeCloseTo(Math.exp(3) / (1 + Math.exp(1) + Math.exp(2) + Math.exp(3)), 12);
        for (const bad of [
            { ...cnn, architecture: 'cnn-unknown' },
            { ...cnn, architecture: [cnn.architecture] },
            { ...cnn, conv: [] }, { ...cnn, dense: [] },
            { ...cnn, featureScale: Array(12).fill(0) },
            { ...cnn, featureMean: [NaN, ...Array(11).fill(0)] },
            { ...cnn, inputTransform: 'unknown' },
            { ...cnn, training: { ...cnn.training, batchNormFolded: false } },
            { ...cnn, conv: [{ ...cnn.conv[0], weights: [1] }, ...cnn.conv.slice(1)] },
            { ...cnn, dense: [cnn.dense[0], { ...cnn.dense[1], bias: [0, 1, 2, Infinity] }] },
            { ...cnn, dense: [cnn.dense[0], { ...cnn.dense[1], bias: [0, 1, 2, 1e300] }] },
        ]) {
            expect(() => loadClassifier(bad)).toThrow();
        }
    });

    it('validates the complete model and refuses malformed or incompatible weights', () => {
        expect(loadClassifier(weights).classes).toEqual(['mover', 'brightness', 'artifact', 'nothing']);
        for (const bad of [null, {}, { ...treeWeights, classes: ['nothing'] },
            { ...treeWeights, stamp: { ...treeWeights.stamp, pixelArcsec: 1 } },
            { ...treeWeights, trees: [] }, { ...treeWeights, features: [] }]) {
            expect(() => loadClassifier(bad)).toThrow();
        }
        const oneTree = { ...treeWeights, training: { ...treeWeights.training, rounds: 1 } };
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
            if (result.kind === 'declined') {
                throw new Error(result.reason);
            }
            model.classes.forEach((kind, i) => {
                expect(Math.abs(result.p[kind] - sample.probabilities[i]!)).toBeLessThan(1e-4);
            });
            expect(result.kind).toBe(model.classes[sample.probabilities.indexOf(Math.max(...sample.probabilities))]);
            expect(Object.values(result.p).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        }
        expect(() => classify(model, new Float32Array(4))).toThrow();
        const invalid = new Float32Array(675);
        invalid[1] = NaN;
        expect(() => classify(model, invalid)).toThrow();
        expect(classify(model, new Float32Array(675))).toEqual({ kind: 'declined', reason: 'too faint to label' });
    });

    it('matches PyTorch for the CNN attempt and the unchanged phone fallback', () => {
        for (const [json, cases] of [[treeWeights, parity.treeCases], [cnnWeightsAttempt, parity.cnnCases]] as const) {
            const model = loadClassifier(json);
            expect(cases).toHaveLength(20);
            for (const sample of cases) {
                const result = classify(model, Float32Array.from(sample.stamp));
                if (result.kind === 'declined') {
                    throw new Error(result.reason);
                }
                model.classes.forEach((kind, i) => {
                    expect(Math.abs(result.p[kind] - sample.probabilities[i]!)).toBeLessThan(1e-4);
                });
            }
        }
        const digest = (path: string) => createHash('sha256')
            .update(readFileSync(new URL(path, import.meta.url))).digest('hex');
        expect(digest('../public/models/change-classifier.json')).toBe(evaluation.modelSha256);
        expect(digest('../models/change-classifier-trees.json')).toBe(evaluation.treesBaseline.modelSha256);
        expect(digest('../models/change-classifier-cnn.json')).toBe(evaluation.cnnAttempt.modelSha256);
        expect(evaluation.modelSha256).toBe(parity.modelSha256);
        expect(evaluation.treesBaseline.modelSha256).toBe(parity.treeModelSha256);
        expect(evaluation.cnnAttempt.modelSha256).toBe(parity.cnnModelSha256);
    });

    it('selects on training-target validation and records an honest neural gate', () => {
        const attempt = evaluation.cnnAttempt;
        expect(attempt.training.totalStamps).toBe(50_000);
        expect(attempt.training.perTargetPerClass).toBe(2500);
        expect(attempt.determinism.passed).toBe(true);
        expect(attempt.determinism.hashes).toEqual([parity.cnnModelSha256, parity.cnnModelSha256]);
        expect(attempt.folds).toHaveLength(5);
        expect(evaluation.comparison).toHaveLength(5);
        for (const fold of attempt.folds) {
            expect(fold.trainTargets).not.toContain(fold.testTarget);
            expect(fold.validationTargets).toEqual(fold.trainTargets);
            expect(fold.heldOutEvaluations).toBe(1);
            expect(fold.optimizerCount + fold.validationCount).toBe(fold.trainCount);
            const best = Math.max(...fold.history.map((epoch) => epoch.validationMacroF1!));
            expect(fold.bestValidationMacroF1).toBe(best);
        }
        expect(attempt.gate.passed).toBe(Object.values(attempt.gate.checks).every(Boolean));
        if (attempt.gate.passed) {
            expect(weights.architecture).toBe(cnnWeightsAttempt.architecture);
            expect(attempt.meanFoldMetrics.macroF1)
                .toBeGreaterThanOrEqual(evaluation.treesBaseline.meanFoldMetrics.macroF1 + 0.01);
        } else {
            expect(weights.architecture).toBe(treeWeights.architecture);
        }
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
        if (result.kind === 'declined') {
            throw new Error(result.reason);
        }
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
