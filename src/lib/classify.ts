import type { OutputGrid, PixelCoord } from './types';

export type ModelKind = 'mover' | 'brightness' | 'artifact' | 'nothing';

type Tree = { value: number[] } | { feature: number; threshold: number; left: Tree; right: Tree };

export interface ClassifierModel {
    version: 1;
    architecture: 'gradient-boosted-trees-12';
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
    training: Record<string, unknown>;
    features: string[];
    trees: Tree[];
}

const KINDS: ModelKind[] = ['mover', 'brightness', 'artifact', 'nothing'];
const ARCHITECTURE = 'gradient-boosted-trees-12';
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

/** Parse once after a lazy fetch. Inference and sampling are DOM/Worker independent. */
export function loadClassifier(json: unknown): ClassifierModel
{
    const root = object(json), stamp = object(root.stamp), training = object(root.training);
    if (root.version !== 1 || root.architecture !== ARCHITECTURE || !equals(root.classes, KINDS)
        || typeof root.madeBy !== 'string' || !root.madeBy || typeof root.aiNote !== 'string'
        || typeof root.seed !== 'number' || !Number.isSafeInteger(root.seed)
        || stamp.size !== SIZE || stamp.layout !== 'CHW' || stamp.pixelArcsec !== NATIVE
        || !equals(stamp.channels, ['earlier', 'later', 'later-earlier'])
        || stamp.normalization !== 'difference-MAD-sigma' || stamp.preprocess !== PREPROCESS
        || !equals(root.features, FEATURES) || !Array.isArray(root.trees)
        || root.trees.length < 1 || root.trees.length > 256) {
        throw new Error('Classifier: unsupported model or stamp specification');
    }
    const counts = object(training.counts);
    if (Object.keys(counts).length !== 5 || !Number.isInteger(training.rounds)
        || training.rounds !== root.trees.length) {
        throw new Error('Classifier: missing training provenance');
    }
    for (const targetCounts of Object.values(counts)) {
        const count = object(targetCounts);
        if (!KINDS.every((kind) => Number.isSafeInteger(count[kind]) && Number(count[kind]) > 0)) {
            throw new Error('Classifier: invalid class counts');
        }
    }
    const trees = root.trees.map((entry: unknown) => treeFor(entry));
    return { version: 1, architecture: ARCHITECTURE, madeBy: root.madeBy,
        aiNote: root.aiNote, seed: root.seed, classes: KINDS.slice(),
        stamp: { size: SIZE, channels: ['earlier', 'later', 'later-earlier'], layout: 'CHW',
            pixelArcsec: NATIVE, normalization: 'difference-MAD-sigma', preprocess: PREPROCESS },
        training: { ...training }, features: FEATURES.slice(), trees };
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

function featuresFor(stamp: Float32Array): number[]
{
    const am = Array.from(stamp.subarray(0, AREA)).sort((a, b) => a - b)[112]!;
    const bm = Array.from(stamp.subarray(AREA, AREA * 2)).sort((a, b) => a - b)[112]!;
    const a = Float64Array.from(stamp.subarray(0, AREA), (v) => v - am);
    const b = Float64Array.from(stamp.subarray(AREA, AREA * 2), (v) => v - bm);
    const diff = stamp.subarray(AREA * 2), absolute = Float64Array.from(diff, Math.abs);
    let peak = -1, px = 7, py = 7;
    for (let y = 3; y <= 11; y++) {
        for (let x = 3; x <= 11; x++) {
            if ((x - 7) ** 2 + (y - 7) ** 2 <= 16 && absolute[y * SIZE + x]! > peak) {
                peak = absolute[y * SIZE + x]!;
                px = x;
                py = y;
            }
        }
    }
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

/** Twelve measured morphology/flux features and exported boosted trees. */
export function classify(model: ClassifierModel, stamp: Float32Array): { kind: ModelKind; p: Record<ModelKind, number> }
{
    if (stamp.length !== AREA * 3 || !stamp.every(Number.isFinite)) {
        throw new Error('Classifier: expected a finite 3x15x15 stamp');
    }
    const features = featuresFor(stamp), logits = [0, 0, 0, 0];
    for (const root of model.trees) {
        let tree = root;
        while (!('value' in tree)) {
            tree = features[tree.feature]! <= tree.threshold ? tree.left : tree.right;
        }
        for (let c = 0; c < 4; c++) {
            logits[c]! += tree.value[c]!;
        }
    }
    const maximum = Math.max(...logits), exp = logits.map((v) => Math.exp(v - maximum));
    const total = exp.reduce((a, b) => a + b, 0);
    const p = Object.fromEntries(KINDS.map((kind, i) => [kind, exp[i]! / total])) as Record<ModelKind, number>;
    return { kind: KINDS[logits.indexOf(maximum)]!, p };
}
