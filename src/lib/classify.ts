import type { OutputGrid, PixelCoord } from './types';

export type ModelKind = 'mover' | 'brightness' | 'artifact' | 'nothing';

export type Classification = {
    kind: ModelKind;
    /** Internal uncalibrated scores, not probabilities; never rendered. */
    p: Record<ModelKind, number>;
} | { kind: 'declined'; reason: string };

type Tree = { value: number[] } | { feature: number; threshold: number; left: Tree; right: Tree };

interface ModelBase {
    version: 1;
    madeBy: string;
    aiNote: string;
    seed: number;
    classes: ModelKind[];
    stamp: {
        size: 15;
        channels: string[];
        layout: 'CHW';
        pixelArcsec: 6.15;
        normalization: 'difference-MAD-sigma';
        preprocess: 'twelve-morphology-flux-features';
    };
    training: Record<string, unknown> & { peakSnrMax: number };
    features: string[];
}

interface TreesModel extends ModelBase {
    architecture: 'gradient-boosted-trees-12';
    trees: Tree[];
}

interface Layer {
    weights: number[];
    bias: number[];
}

interface CnnModel extends ModelBase {
    architecture: 'cnn-3x3-gap-features-12-16-16';
    inputTransform: 'median-asinh-5';
    featureMean: number[];
    featureScale: number[];
    conv: Layer[];
    dense: Layer[];
}

export type ClassifierModel = TreesModel | CnnModel;

// Our own choice, not tuned or validated: decline when the top two uncalibrated scores are closer than this.
export const MIN_SCORE_MARGIN = 0.2;
export const HELPER_LABEL = 'Experimental sort hint, trained only on fake changes added to single frames. '
    + 'Never tested on real two-date changes. Not a verdict.';

const KINDS: ModelKind[] = ['mover', 'brightness', 'artifact', 'nothing'];
const ARCHITECTURE = 'gradient-boosted-trees-12';
const CNN = 'cnn-3x3-gap-features-12-16-16';
const PREPROCESS = 'twelve-morphology-flux-features';
const FEATURES = ['logPeak', 'logArea', 'elongation', 'residualSharpness',
    'peakDistance', 'dipoleBalance', 'dipoleDistance', 'epochFluxRatio',
    'fractionalResidual', 'nearestStarDistance', 'sourceSharpness', 'epochCorrelation'];
const SIZE = 15;
const AREA = SIZE * SIZE;
const NATIVE = 6.15;

function object(value: unknown): Record<string, unknown>
{
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Classifier: expected an object');
    }
    return value as Record<string, unknown>;
}

function numbers(value: unknown, length: number): number[]
{
    if (!Array.isArray(value) || value.length !== length
        || !value.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))) {
        throw new Error('Classifier: invalid coefficient shape or nonfinite coefficient');
    }
    return value.slice() as number[];
}

function equals(value: unknown, expected: readonly unknown[]): boolean
{
    return Array.isArray(value) && value.length === expected.length
        && expected.every((v, i) => v === value[i]);
}

function treeFor(value: unknown, depth = 0): Tree
{
    const node = object(value);
    if (depth > 3) {
        throw new Error('Classifier: tree exceeds supported depth');
    }
    if ('value' in node) {
        const value = numbers(node.value, 4);
        if (Object.keys(node).length !== 1 || value.some((v) => Math.abs(v) > 1)) {
            throw new Error('Classifier: invalid bounded leaf coefficients');
        }
        return { value };
    }
    if (Object.keys(node).length !== 4 || typeof node.feature !== 'number' || !Number.isInteger(node.feature)
        || node.feature < 0 || node.feature >= FEATURES.length
        || typeof node.threshold !== 'number' || !Number.isFinite(node.threshold)) {
        throw new Error('Classifier: invalid tree split');
    }
    return { feature: node.feature, threshold: node.threshold,
        left: treeFor(node.left, depth + 1), right: treeFor(node.right, depth + 1) };
}

function bounded(value: unknown, length: number, limit: number): number[]
{
    const values = numbers(value, length);
    if (values.some((v) => Math.abs(v) > limit)) {
        throw new Error('Classifier: unbounded neural coefficient');
    }
    return values;
}

function layersFor(value: unknown, dimensions: readonly (readonly [number, number])[], kernel: number): Layer[]
{
    if (!Array.isArray(value) || value.length !== dimensions.length) {
        throw new Error('Classifier: invalid neural layer count');
    }
    return dimensions.map(([inputs, outputs], i) => {
        const layer = object(value[i]);
        return { weights: bounded(layer.weights, inputs * outputs * kernel, 1000),
            bias: bounded(layer.bias, outputs, 1000) };
    });
}

/** Parse once after a lazy fetch. Inference and sampling are DOM/Worker independent. */
export function loadClassifier(json: unknown): ClassifierModel
{
    const root = object(json), stamp = object(root.stamp), training = object(root.training);
    if (root.version !== 1 || typeof root.architecture !== 'string' || ![ARCHITECTURE, CNN].includes(root.architecture) || !equals(root.classes, KINDS)
        || typeof root.madeBy !== 'string' || !root.madeBy || typeof root.aiNote !== 'string'
        || typeof root.seed !== 'number' || !Number.isSafeInteger(root.seed)
        || stamp.size !== SIZE || stamp.layout !== 'CHW' || stamp.pixelArcsec !== NATIVE
        || !equals(stamp.channels, ['earlier', 'later', 'later-earlier'])
        || stamp.normalization !== 'difference-MAD-sigma' || stamp.preprocess !== PREPROCESS
        || !equals(root.features, FEATURES)) {
        throw new Error('Classifier: unsupported model or stamp specification');
    }
    const counts = object(training.counts);
    if (Object.keys(counts).sort().join(',') !== 'barnard,epsindb,rdra,rwaur,wise0855') {
        throw new Error('Classifier: missing training provenance');
    }
    for (const targetCounts of Object.values(counts)) {
        const count = object(targetCounts);
        if (!KINDS.every((kind) => Number.isSafeInteger(count[kind]) && Number(count[kind]) > 0)) {
            throw new Error('Classifier: invalid class counts');
        }
    }
    if (typeof training.peakSnrMax !== 'number' || !Number.isFinite(training.peakSnrMax)
        || training.peakSnrMax < 2.5) {
        throw new Error('Classifier: missing or invalid training peak S/N maximum; retrain the model');
    }
    const base: ModelBase = { version: 1, madeBy: root.madeBy,
        aiNote: root.aiNote, seed: root.seed, classes: KINDS.slice(),
        stamp: { size: SIZE, channels: ['earlier', 'later', 'later-earlier'], layout: 'CHW',
            pixelArcsec: NATIVE, normalization: 'difference-MAD-sigma', preprocess: PREPROCESS },
        training: { ...training, peakSnrMax: training.peakSnrMax }, features: FEATURES.slice() };
    if (root.architecture === ARCHITECTURE) {
        if (!Array.isArray(root.trees) || root.trees.length < 1 || root.trees.length > 256
            || !Number.isInteger(training.rounds) || training.rounds !== root.trees.length) {
            throw new Error('Classifier: invalid tree count or training rounds');
        }
        return { ...base, architecture: ARCHITECTURE, trees: root.trees.map((entry: unknown) => treeFor(entry)) };
    }
    if (root.inputTransform !== 'median-asinh-5' || training.batchNormFolded !== true
        || !Number.isInteger(training.epochs) || Number(training.epochs) < 1 || Number(training.epochs) > 30) {
        throw new Error('Classifier: invalid neural preprocessing or training provenance');
    }
    const featureScale = bounded(root.featureScale, 12, 1e6);
    if (featureScale.some((v) => v < 1e-6)) {
        throw new Error('Classifier: invalid feature scale');
    }
    return { ...base, architecture: CNN, inputTransform: 'median-asinh-5',
        featureMean: bounded(root.featureMean, 12, 1e6), featureScale,
        conv: layersFor(root.conv, [[3, 12], [12, 16], [16, 16]], 9),
        dense: layersFor(root.dense, [[28, 32], [32, 4]], 1) };
}

/** Disable the optional helper when fetched weights cannot be loaded. */
export function tryLoadClassifier(json: unknown): ClassifierModel | undefined
{
    try {
        return loadClassifier(json);
    } catch {
        return undefined;
    }
}

function bilinear(data: Float32Array, grid: OutputGrid, x: number, y: number): number | undefined
{
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    if (ix < 0 || iy < 0 || ix + 1 >= grid.width || iy + 1 >= grid.height) {
        return undefined;
    }
    const a = data[iy * grid.width + ix]!, b = data[iy * grid.width + ix + 1]!;
    const c = data[(iy + 1) * grid.width + ix]!, d = data[(iy + 1) * grid.width + ix + 1]!;
    if (![a, b, c, d].every(Number.isFinite)) {
        return undefined;
    }
    return (1 - fy) * ((1 - fx) * a + fx * b) + fy * ((1 - fx) * c + fx * d);
}

/** Cut CHW earlier/later/difference at 6.15 arcsec/pixel, centred at pix.
 * sigma is the change finder's native difference MAD sigma. Values are IMAGE-ZODI.
 * The caller supplies earlier/later on the same output grid, after registration.
 * A missing contributing pixel, edge, or invalid input declines classification.
 */
export function stampFor(earlier: Float32Array, later: Float32Array, grid: OutputGrid,
    pix: PixelCoord, sigma: number): Float32Array | undefined
{
    if (!Number.isSafeInteger(grid.width) || !Number.isSafeInteger(grid.height)
        || grid.width < 2 || grid.height < 2 || !Number.isFinite(grid.pixelArcsec) || grid.pixelArcsec <= 0
        || earlier.length !== grid.width * grid.height || later.length !== earlier.length
        || !Number.isFinite(pix.x) || !Number.isFinite(pix.y) || !Number.isFinite(sigma) || sigma <= 0) {
        return undefined;
    }
    const step = NATIVE / grid.pixelArcsec, result = new Float32Array(AREA * 3);
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const sx = pix.x + (x - 7) * step, sy = pix.y + (y - 7) * step;
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
                return undefined;
            }
            const a = bilinear(earlier, grid, sx, sy), b = bilinear(later, grid, sx, sy);
            if (a === undefined || b === undefined) {
                return undefined;
            }
            const i = y * SIZE + x;
            result[i] = a / sigma;
            result[AREA + i] = b / sigma;
            result[AREA * 2 + i] = (b - a) / sigma;
            if (![result[i], result[AREA + i], result[AREA * 2 + i]].every(Number.isFinite)) {
                return undefined;
            }
        }
    }
    return result;
}

/** Row-major peak in the radius-4 disc used by the morphology features and S/N gates. */
function corePeak(diff: Float32Array): { peak: number; px: number; py: number }
{
    let peak = -1, px = 7, py = 7;
    for (let y = 3; y <= 11; y++) {
        for (let x = 3; x <= 11; x++) {
            if ((x - 7) ** 2 + (y - 7) ** 2 <= 16 && Math.abs(diff[y * SIZE + x]!) > peak) {
                peak = Math.abs(diff[y * SIZE + x]!);
                px = x;
                py = y;
            }
        }
    }
    return { peak, px, py };
}

function featuresFor(stamp: Float32Array): number[]
{
    const am = Array.from(stamp.subarray(0, AREA)).sort((a, b) => a - b)[112]!;
    const bm = Array.from(stamp.subarray(AREA, AREA * 2)).sort((a, b) => a - b)[112]!;
    const a = Float64Array.from(stamp.subarray(0, AREA), (v) => v - am);
    const b = Float64Array.from(stamp.subarray(AREA, AREA * 2), (v) => v - bm);
    const diff = stamp.subarray(AREA * 2), absolute = Float64Array.from(diff, Math.abs);
    const { peak, px, py } = corePeak(diff);
    let total = 1e-12, mx = 0, my = 0, ps = 0, ns = 0;
    let pxc = 0, pyc = 0, nxc = 0, nyc = 0, fa = 0, fb = 0;
    let count = 0, asum = 0, bsum = 0;
    const region: number[] = [], weights = new Float64Array(AREA);
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const i = y * SIZE + x, distance = (x - px) ** 2 + (y - py) ** 2;
            if (distance <= 25) {
                region.push(i);
                const w = Math.max(absolute[i]! - Math.max(2, 0.15 * peak), 0);
                weights[i] = w;
                total += w;
                mx += w * x;
                my += w * y;
                const positive = Math.max(diff[i]! - 2, 0), negative = Math.max(-diff[i]! - 2, 0);
                ps += positive;
                ns += negative;
                pxc += positive * x;
                pyc += positive * y;
                nxc += negative * x;
                nyc += negative * y;
                asum += a[i]!;
                bsum += b[i]!;
                count++;
            }
            if (distance <= 4) {
                fa += a[i]!;
                fb += b[i]!;
            }
        }
    }
    mx /= total;
    my /= total;
    let vx = 0, vy = 0, cov = 0, aa = 0, bb = 0, ab = 0;
    for (const i of region) {
        const x = i % SIZE, y = Math.floor(i / SIZE), w = weights[i]!;
        vx += w * (x - mx) ** 2 / total;
        vy += w * (y - my) ** 2 / total;
        cov += w * (x - mx) * (y - my) / total;
        const ac = a[i]! - asum / count, bc = b[i]! - bsum / count;
        aa += ac * ac;
        bb += bc * bc;
        ab += ac * bc;
    }
    const gap = Math.sqrt(Math.max(0, (vx - vy) ** 2 + 4 * cov ** 2));
    const elongation = (vx + vy + gap + 0.2) / (vx + vy - gap + 0.2);
    const balance = Math.min(ps, ns) / (Math.max(ps, ns) + 1e-12);
    const at = py * SIZE + px;
    const sharp = (4 * absolute[at]! - absolute[at - SIZE]! - absolute[at + SIZE]!
        - absolute[at - 1]! - absolute[at + 1]!) / (peak + 1);
    fa = Math.max(0, fa);
    fb = Math.max(0, fb);
    const ratio = Math.min(fa, fb) / (Math.max(fa, fb) + 1);
    const fractional = peak / (Math.max(Math.abs(a[at]!), Math.abs(b[at]!)) + 1);
    const source = diff[at]! >= 0 ? b : a;
    const sourceSharp = (4 * source[at]! - source[at - SIZE]! - source[at + SIZE]!
        - source[at - 1]! - source[at + 1]!) / Math.max(1, Math.abs(source[at]!));
    const average = a.map((v, i) => (v + b[i]!) / 2);
    let nearest = 15;
    for (let y = 1; y < SIZE - 1; y++) {
        for (let x = 1; x < SIZE - 1; x++) {
            const i = y * SIZE + x, v = average[i]!;
            if (v > average[i - SIZE]! && v > average[i + SIZE]! && v > average[i - 1]!
                && v > average[i + 1]! && v > Math.max(3, peak * 0.2)) {
                nearest = Math.min(nearest, Math.hypot(x - px, y - py));
            }
        }
    }
    return [Math.log1p(peak), Math.log1p(total / (peak + 1)), Math.log1p(elongation), sharp,
        Math.hypot(px - 7, py - 7), balance,
        Math.hypot(pxc / (ps + 1e-12) - nxc / (ns + 1e-12),
            pyc / (ps + 1e-12) - nyc / (ns + 1e-12)) * balance,
        ratio, fractional, nearest, sourceSharp, ab / Math.sqrt(aa * bb + 1e-12)];
}

function convolution(input: Float64Array, size: number, channels: number, layer: Layer): Float64Array
{
    const area = size * size, result = new Float64Array(layer.bias.length * area);
    for (let out = 0; out < layer.bias.length; out++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let value = layer.bias[out]!;
                for (let channel = 0; channel < channels; channel++) {
                    const offset = (out * channels + channel) * 9;
                    for (let ky = 0; ky < 3; ky++) {
                        const sy = y + ky - 1;
                        if (sy < 0 || sy >= size) {
                            continue;
                        }
                        for (let kx = 0; kx < 3; kx++) {
                            const sx = x + kx - 1;
                            if (sx >= 0 && sx < size) {
                                value += input[channel * area + sy * size + sx]! * layer.weights[offset + ky * 3 + kx]!;
                            }
                        }
                    }
                }
                result[out * area + y * size + x] = Math.max(0, value);
            }
        }
    }
    return result;
}

function dense(input: readonly number[], layer: Layer): number[]
{
    return layer.bias.map((bias, out) => {
        let result = bias;
        for (let i = 0; i < input.length; i++) {
            result += input[i]! * layer.weights[out * input.length + i]!;
        }
        return result;
    });
}

function cnnLogits(model: CnnModel, stamp: Float32Array, features: number[]): number[]
{
    const normalized = new Float64Array(stamp.length);
    for (let channel = 0; channel < 3; channel++) {
        const start = channel * AREA, values = Array.from(stamp.subarray(start, start + AREA));
        const median = values.slice().sort((a, b) => a - b)[112]!;
        for (let i = 0; i < AREA; i++) {
            normalized[start + i] = Math.asinh((values[i]! - median) / 5);
        }
    }
    const first = convolution(normalized, 15, 3, model.conv[0]!);
    const second = convolution(first, 15, 12, model.conv[1]!);
    const pooled = new Float64Array(16 * 49);
    for (let c = 0; c < 16; c++) {
        for (let y = 0; y < 7; y++) {
            for (let x = 0; x < 7; x++) {
                const at = c * AREA + y * 2 * 15 + x * 2;
                pooled[c * 49 + y * 7 + x] = Math.max(second[at]!, second[at + 1]!,
                    second[at + 15]!, second[at + 16]!);
            }
        }
    }
    const last = convolution(pooled, 7, 16, model.conv[2]!);
    const combined: number[] = [];
    for (let c = 0; c < 16; c++) {
        let sum = 0;
        for (let i = 0; i < 49; i++) {
            sum += last[c * 49 + i]!;
        }
        combined.push(sum / 49);
    }
    features.forEach((v, i) => combined.push((v - model.featureMean[i]!) / model.featureScale[i]!));
    return dense(dense(combined, model.dense[0]!).map((v) => Math.max(0, v)), model.dense[1]!);
}

/** Label an in-range candidate with the exported CNN or boosted trees.
 * p contains uncalibrated scores, not probabilities; never show percentages or "% sure".
 * Decline faint, over-bright or spatially flat changes before inference.
 */
export function classify(model: ClassifierModel, stamp: Float32Array): Classification
{
    if (stamp.length !== AREA * 3 || !stamp.every(Number.isFinite)) {
        return { kind: 'declined', reason: 'invalid stamp' };
    }
    for (let i = 0; i < AREA; i++) {
        const earlier = stamp[i]!, later = stamp[AREA + i]!, difference = stamp[AREA * 2 + i]!;
        if (Math.abs(difference - (later - earlier)) > 1e-4 * Math.max(1, Math.abs(earlier), Math.abs(later))) {
            return { kind: 'declined', reason: 'stamp channels disagree' };
        }
    }
    const diff = stamp.subarray(AREA * 2), { peak } = corePeak(diff);
    if (peak < 2.5) {
        return { kind: 'declined', reason: 'too faint to label' };
    }
    if (peak > 2 * model.training.peakSnrMax) {
        return { kind: 'declined', reason: 'brighter than anything in training' };
    }
    // An affine plane (including a constant offset) has no localized change.
    // Fit all pixels so rounding noise in a Float32 gradient is tolerated.
    let mean = 0, slopeX = 0, slopeY = 0;
    const moment = AREA * (SIZE * SIZE - 1) / 12;
    for (let i = 0; i < AREA; i++) {
        mean += diff[i]! / AREA;
        slopeX += diff[i]! * (i % SIZE - 7) / moment;
        slopeY += diff[i]! * (Math.floor(i / SIZE) - 7) / moment;
    }
    if (diff.every((v, i) => Math.abs(v - mean - slopeX * (i % SIZE - 7)
        - slopeY * (Math.floor(i / SIZE) - 7)) <= peak * 1e-6)) {
        return { kind: 'declined', reason: 'no localized change to label' };
    }
    const features = featuresFor(stamp);
    const logits = model.architecture === CNN ? cnnLogits(model, stamp, features) : [0, 0, 0, 0];
    if (model.architecture === ARCHITECTURE) {
        for (const root of model.trees) {
            let tree = root;
            while (!('value' in tree)) {
                tree = features[tree.feature]! <= tree.threshold ? tree.left : tree.right;
            }
            for (let c = 0; c < 4; c++) {
                logits[c]! += tree.value[c]!;
            }
        }
    }
    const maximum = Math.max(...logits), exp = logits.map((v) => Math.exp(v - maximum));
    const total = exp.reduce((a, b) => a + b, 0);
    const scores = exp.map((v) => v / total).sort((a, b) => b - a);
    if (scores[0]! - scores[1]! < MIN_SCORE_MARGIN) {
        return { kind: 'declined', reason: 'no clear label' };
    }
    const p = Object.fromEntries(KINDS.map((kind, i) => [kind, exp[i]! / total])) as Record<ModelKind, number>;
    return { kind: KINDS[logits.indexOf(maximum)]!, p };
}
