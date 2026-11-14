import { describe, expect, it } from 'vitest';
// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { createHash } from 'node:crypto';
// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { execFileSync } from 'node:child_process';
import weights from '../public/models/change-classifier.json';
import treeWeights from '../models/change-classifier-trees.json';
import cnnWeightsAttempt from '../models/change-classifier-cnn.json';
import parity from './fixtures/classify-parity.json';
import evaluation from '../models/change-classifier.eval.json';
import { classify, loadClassifier, stampFor } from '../src/lib/classify';
import type { ClassifierModel } from '../src/lib/classify';
import * as classifier from '../src/lib/classify';
import type { OutputGrid } from '../src/lib/types';

it('records a compact card and per-fold gate exceptions from the evaluation', () => {
    const card = JSON.parse(readFileSync(new URL('../public/models/change-classifier.card.json', import.meta.url), 'utf8'));
    const digest = createHash('sha256').update(readFileSync(new URL('../models/change-classifier.eval.json', import.meta.url))).digest('hex');
    const worst = evaluation.folds.find((fold) => fold.testTarget === evaluation.worstFold)!;
    const round3 = (value: number): number => Math.round(value * 1000) / 1000;
    expect(card.macroF1).toBeUndefined();
    expect(card.meanFoldMacroF1).toBe(round3(evaluation.meanFoldMetrics.macroF1));
    expect(card.accuracy).toBeUndefined();
    expect(card.syntheticTestAccuracy).toBe(round3(evaluation.meanFoldMetrics.accuracy));
    expect(card.worstFold).toEqual({ target: worst.testTarget, macroF1: round3(worst.macroF1) });
    expect(card.treesMacroF1).toBeUndefined();
    expect(card.treesMacroF1OriginalFolds).toBe(round3(evaluation.cnnAttempt.sameTestTrees.meanFoldMetrics.macroF1));
    expect(card.treesNote).toBe('Trees saw 600 stamps per class per target, the CNN 2,500: not like-for-like.');
    // The weak-field text covers every mover/artifact target miss without a duplicate key.
    const gated = evaluation as typeof evaluation & { worstFoldGate: Record<string, { target: string; value: number }[]> };
    expect(card.belowGate).toBeUndefined();
    for (const key of ['moverRecallSnr10', 'artifactPrecision']) {
        const items = gated.worstFoldGate[key]!;
        for (const item of items) {
            expect(card.weakField).toContain(item.value.toFixed(3));
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
    expect(card.data).toBe('Trained and tested only on fake changes added to single real SPHEREx DR1/QR3 frames, never on '
        + 'two real dates. No real movers, no human labels.');
    const total = Object.values(evaluation.perClass).reduce((sum, value) => sum + value.count, 0);
    const share = evaluation.perClass.mover.count / total;
    const prevalence = share === 0.25 ? 'A quarter of test stamps are movers'
        : `${Number((share * 100).toFixed(2))}% of test stamps are movers`;
    expect(card.limits).toBe('Labels change spots only; it does not find planets. Not tested on a real asteroid. '
        + `Mover recall is ${low.classes.mover.recall!.toFixed(2)} at S/N 3-5. `
        + `${prevalence}; if real ones are rarer, more mover labels are wrong.`
        + ' The browser helper also declines faint, over-bright, inconsistent and close-call stamps, '
        + `and ones where a change away from the centre is over ${classifier.MAX_OFF_CENTRE_RATIO} times brighter, `
        + 'so it labels fewer stamps than these scores cover.');
    for (const text of [JSON.stringify(card), weights.aiNote, weights.madeBy]) {
        expect(text).not.toMatch(/detected a|confirmed|proves|discovery/i);
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
    expect(readFileSync(new URL('../public/models/change-classifier.card.json', import.meta.url)).length).toBeLessThan(2048);
    // The one frozen retest is on the card with its caveat, its numbers from the result file (-ba, 14 Nov).
    const confirm = JSON.parse(readFileSync(new URL('../models/change-classifier.confirm.json', import.meta.url), 'utf8'));
    expect(confirm.evalSha256).toBe(digest);
    const [lo, hi] = confirm.bootstrap.meanArtifactPrecision95 as [number, number];
    const target = evaluation.gate.thresholds.artifactPrecision;
    expect(card.retest).toBe(`${confirm.passed ? 'Passed' : 'Failed'} a frozen retest on fresh fake stamps `
        + `(same fields and frames, not new sky): macro-F1 ${confirm.meanFoldMetrics.macroF1.toFixed(3)}, `
        + `mover recall at S/N>=10 ${confirm.meanFoldMetrics.moverRecallSnr10.toFixed(3)}, `
        + `artifact precision ${confirm.meanFoldMetrics.artifactPrecision.toFixed(3)}. `
        + (lo < target ? `The last is a thin pass: its 95% range, ${lo.toFixed(3)}-${hi.toFixed(3)}, `
            + `crosses the ${target.toFixed(2)} target, and that range holds the ${confirm.folds.length} fields fixed, `
            + 'so it shows stamp-to-stamp noise only. ' : '')
        + `Trees on the same fresh stamps: macro-F1 ${confirm.treesMeanFoldMetrics.macroF1.toFixed(3)}.`);
    const names: Record<string, string> = { wise0855: 'WISE 0855', barnard: "Barnard's Star", epsindb: 'eps Indi B',
        rdra: 'R Dra', rwaur: 'RW Aur' };
    const weak = evaluation.folds.filter((f) => f.moverRecallSnr10 < evaluation.gate.thresholds.moverRecallSnr10
        || f.artifactPrecision < target);
    const weakText = weak.map((fold) => {
        const retest = (confirm.folds as typeof evaluation.folds).find((f) => f.testTarget === fold.testTarget)!;
        const trees = evaluation.comparison.find((f) => f.testTarget === fold.testTarget)!.trees;
        const misses = (['moverRecallSnr10', 'artifactPrecision'] as const)
            .filter((key) => fold[key] < evaluation.gate.thresholds[key]);
        if (misses.length === 1) {
            const key = misses[0]!, label = key === 'moverRecallSnr10' ? 'mover recall at S/N>=10' : 'artifact precision';
            return `${names[fold.testTarget]} missed the ${evaluation.gate.thresholds[key].toFixed(2)} target on ${label}: `
                + `${fold[key].toFixed(3)} (retest ${retest[key].toFixed(3)}).`;
        }
        return `${names[fold.testTarget]} missed both ${target.toFixed(2)} targets: mover recall at S/N>=10 `
            + `${fold.moverRecallSnr10.toFixed(3)} (retest ${retest.moverRecallSnr10.toFixed(3)}) and artifact precision `
            + `${fold.artifactPrecision.toFixed(3)} (retest ${retest.artifactPrecision.toFixed(3)})`
            + (trees.moverRecallSnr10 > fold.moverRecallSnr10 && trees.artifactPrecision > fold.artifactPrecision
                ? '; the trees did better on both.' : '.');
    });
    if (!weak.some((f) => f.testTarget === worst.testTarget)) {
        weakText.push(`${names[worst.testTarget]} has the lowest macro-F1 (${worst.macroF1.toFixed(3)}).`);
    }
    expect(card.weakField).toBe(weakText.join(' '));
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

function expectParity(model: ClassifierModel, samples: readonly { stamp: number[]; probabilities: number[] }[])
{
    let faint = 0, unclear = 0;
    expect(samples).toHaveLength(20);
    for (const sample of samples) {
        const result = classify(model, Float32Array.from(sample.stamp));
        const core = sample.stamp.slice(450).filter((_, i) => (i % 15 - 7) ** 2 + (Math.floor(i / 15) - 7) ** 2 <= 16);
        const scores = sample.probabilities.slice().sort((a, b) => b - a);
        if (Math.max(...core.map(Math.abs)) < 2.5) {
            expect(result).toEqual({ kind: 'declined', reason: 'too faint to label' });
            faint++;
        } else if (scores[0]! - scores[1]! < classifier.MIN_SCORE_MARGIN) {
            expect(result).toEqual({ kind: 'declined', reason: 'no clear label' });
            unclear++;
        } else {
            if (result.kind === 'declined') {
                throw new Error(result.reason);
            }
            model.classes.forEach((kind, i) => {
                expect(Math.abs(result.p[kind] - sample.probabilities[i]!)).toBeLessThan(1e-4);
            });
            expect(result.kind).toBe(model.classes[sample.probabilities.indexOf(Math.max(...sample.probabilities))]);
            expect(Object.values(result.p).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        }
    }
    return { faint, unclear };
}

const pythonExecutable = new URL('../scripts/.venv/bin/python', import.meta.url);

/** Guard probes use ASTs or command-line copies; never run training or the frozen retest. */
function pythonProbe(body: string, args: string[] = [])
{
    execFileSync(pythonExecutable.pathname, ['-c', `
import ast, copy, hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
ROOT = Path.cwd()
def source(name):
    return ast.parse((ROOT / 'scripts' / name).read_text())
def functions(tree, names, scope):
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<isolated guards>', 'exec'), scope)
def checkout(folder):
    for name in ['ml_stamps.py', 'ml_train.py', 'ml_train_cnn.py', 'ml_confirm.py']:
        destination = folder / 'scripts' / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / 'scripts' / name, destination)
    for name in ['models', 'public/models']:
        (folder / name).mkdir(parents=True, exist_ok=True)
        for path in (ROOT / name).glob('*.json'):
            shutil.copyfile(path, folder / name / path.name)
    subprocess.run(['git', 'init', '-q', str(folder)], check=True)
    subprocess.run(['git', 'add', 'scripts'], cwd=folder, check=True)
    subprocess.run(['git', '-c', 'user.name=Guard test', '-c', 'user.email=guard@example.invalid',
                    'commit', '-qm', 'temporary frozen scripts'], cwd=folder, check=True)
    plan_path = folder / 'models/confirmation-plan.json'
    plan = json.loads(plan_path.read_text())
    plan['frozenCommit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=folder, text=True).strip()
    plan_path.write_text(json.dumps(plan))
    result_path = folder / 'models/change-classifier.confirm.json'
    result = json.loads(result_path.read_text())
    result['planSha256'] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    result_path.write_text(json.dumps(result))
def snapshot(folder):
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in folder.rglob('*') if p.is_file() and '.git' not in p.relative_to(folder).parts}
def cli(folder, script, *arguments):
    return subprocess.run([sys.executable, str(folder / 'scripts' / script), *arguments],
                          cwd=folder, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1',
                                           'PYTHONPATH': str(folder)},
                          text=True, capture_output=True, timeout=15)
${body}`, ...args], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 20000 });
}

// A Node-only checkout has no optional fixture-rebuild virtualenv; the Python gate still runs with --check.
describe.skipIf(!existsSync(pythonExecutable))('frozen confirmation guards without training or a confirmation run', () => {
    it.each(['folds', 'treeFolds'])('CLI check recomputes the stored aggregate from %s on copied evidence', (kind) => {
        pythonProbe(`
with TemporaryDirectory(prefix='slowsky-aggregate-guard-') as temporary:
    folder = Path(temporary)
    checkout(folder)
    path = folder / 'models/change-classifier.confirm.json'
    result = json.loads(path.read_text())
    kind = sys.argv[1]
    key = 'artifactPrecision' if kind == 'folds' else 'macroF1'
    result[kind][0][key] = 0
    measured = sum(f[key] for f in result[kind]) / len(result[kind])
    path.write_text(json.dumps(result))
    before = snapshot(folder)
    run = cli(folder, 'ml_train_cnn.py', '--check')
    assert snapshot(folder) == before, '--check changed copied evidence'
    assert run.returncode != 0 and 'confirm' in run.stderr.lower(), (
        f'--check returned {run.returncode}; true {kind} {key} mean={measured:.6f}; '
        f'stored aggregate unchanged; stdout={run.stdout}; stderr={run.stderr}')
`, [kind]);
    });

    it('card-only CLI regeneration writes exactly the public card without entering training', () => {
        pythonProbe(`
with TemporaryDirectory(prefix='slowsky-card-cli-') as temporary:
    folder = Path(temporary)
    checkout(folder)
    card_path = folder / 'public/models/change-classifier.card.json'
    expected = card_path.read_bytes()
    card_path.unlink()
    (folder / 'sitecustomize.py').write_text('''import sys
def guard(frame, event, arg):
    if event == 'call' and frame.f_code.co_name in {'main', 'dataset', 'fit', 'train_trees'}:
        if frame.f_code.co_filename.endswith(('ml_train_cnn.py', 'ml_stamps.py', 'ml_train.py')):
            raise RuntimeError('TRAINING_REACHED: ' + frame.f_code.co_name)
sys.setprofile(guard)
''')
    before = snapshot(folder)
    run = cli(folder, 'ml_train_cnn.py', '--write-card')
    assert run.returncode == 0, f'--write-card failed: {run.stderr}'
    assert card_path.read_bytes() == expected
    after = snapshot(folder)
    assert set(after) - set(before) == {'public/models/change-classifier.card.json'}
    assert all(after[path] == digest for path, digest in before.items()), 'card CLI rewrote other evidence'
`);
    });

    it.each(['changedMetrics', 'clearRange', 'failedRetest', 'treesWorseOnOne', 'lowestIsWeak', 'multipleWeak',
        'noWeak', 'moverOnly', 'artifactOnly'])(
        'card wording follows changed evidence: %s', (mode) => {
            pythonProbe(`
mode = sys.argv[1]
summary = json.loads((ROOT / 'models/change-classifier.eval.json').read_text())
confirm = json.loads((ROOT / 'models/change-classifier.confirm.json').read_text())
wise = next(f for f in summary['folds'] if f['testTarget'] == 'wise0855')
target = summary['gate']['thresholds']['artifactPrecision']
if mode == 'changedMetrics':
    confirm['meanFoldMetrics'].update(macroF1=0.91234, moverRecallSnr10=0.92345, artifactPrecision=0.85678)
    confirm['treesMeanFoldMetrics']['macroF1'] = 0.81234
    confirm['bootstrap']['meanArtifactPrecision95'] = [0.8312, 0.8612]
    confirm['folds'] = confirm['folds'][1:]
elif mode == 'clearRange': confirm['bootstrap']['meanArtifactPrecision95'] = [target, target + 0.01]
elif mode == 'failedRetest': confirm['passed'] = False
elif mode == 'treesWorseOnOne':
    comparison = next(f for f in summary['comparison'] if f['testTarget'] == 'wise0855')
    comparison['trees']['moverRecallSnr10'] = wise['moverRecallSnr10'] - 0.01
elif mode == 'lowestIsWeak': wise['macroF1'] = 0.1
elif mode == 'multipleWeak':
    fold = next(f for f in summary['folds'] if f['testTarget'] == 'epsindb')
    fold.update(moverRecallSnr10=target - 0.01, artifactPrecision=target - 0.01)
elif mode == 'noWeak': wise.update(moverRecallSnr10=0.9, artifactPrecision=0.9)
elif mode == 'moverOnly': wise['artifactPrecision'] = 0.9
elif mode == 'artifactOnly': wise['moverRecallSnr10'] = 0.9
class EvidenceRoot:
    def __truediv__(self, _): return self
    def exists(self): return True
    def read_text(self): return json.dumps(confirm)
scope = dict(ROOT=EvidenceRoot(), json=json, TREES_NOTE=summary['cnnAttempt']['sameTestTrees']['note'])
functions(source('ml_train_cnn.py'), ['model_card'], scope)
card = scope['model_card'](summary, confirm['evalSha256'])
assert not {'accuracy', 'treesMacroF1'} & card.keys()
if mode == 'changedMetrics':
    for key in ['macroF1', 'moverRecallSnr10', 'artifactPrecision']:
        assert f"{confirm['meanFoldMetrics'][key]:.3f}" in card['retest']
    lo, hi = confirm['bootstrap']['meanArtifactPrecision95']
    assert f'{lo:.3f}-{hi:.3f}' in card['retest']
    assert f"holds the {len(confirm['folds'])} fields fixed" in card['retest']
    assert f"Trees on the same fresh stamps: macro-F1 {confirm['treesMeanFoldMetrics']['macroF1']:.3f}." in card['retest']
elif mode == 'clearRange':
    assert 'thin pass' not in card['retest'] and '95% range' not in card['retest']
elif mode == 'failedRetest':
    assert card['retest'].startswith('Failed a frozen retest') and 'thin pass' not in card['retest']
elif mode == 'treesWorseOnOne': assert 'the trees did better on both' not in card['weakField']
elif mode == 'lowestIsWeak': assert 'has the lowest macro-F1' not in card['weakField']
elif mode == 'multipleWeak':
    assert 'eps Indi B missed both' in card['weakField'] and 'WISE 0855 missed both' in card['weakField']
elif mode == 'noWeak': assert card['weakField'].startswith("Barnard's Star has the lowest macro-F1")
elif mode in ['moverOnly', 'artifactOnly']:
    key = 'moverRecallSnr10' if mode == 'moverOnly' else 'artifactPrecision'
    label = 'mover recall at S/N>=10' if mode == 'moverOnly' else 'artifact precision'
    retest = next(f for f in confirm['folds'] if f['testTarget'] == 'wise0855')
    expected = f"WISE 0855 missed the 0.85 target on {label}: {wise[key]:.3f} (retest {retest[key]:.3f})."
    assert expected in card['weakField'], card['weakField']
assert 'belowGate' not in card
`, [mode]);
        });

    it('atomically reserves one launch and refuses an existing lock or result', () => {
        pythonProbe(`
from concurrent.futures import ThreadPoolExecutor
tree = source('ml_confirm.py')
prefix = copy.deepcopy(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main'))
prefix.name = 'guard'
# Stop before evaluation is read, far before any dataset or training call.
stop = next(i for i, n in enumerate(prefix.body) if isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == 'evaluation' for t in n.targets))
prefix.body = prefix.body[:stop]
with TemporaryDirectory(prefix='slowsky-confirm-guard-') as temporary:
    folder = Path(temporary)
    plan, result, lock = folder / 'plan.json', folder / 'result.json', folder / 'result.lock'
    plan.write_text('{}')
    scope = dict(json=json, os=os, time=time, PLAN=plan, RESULT=result, LOCK=lock,
                 frozen=lambda _: None, validate_plan=lambda _: None, dry_run=lambda _: 0)
    functions(tree, ['reserve_confirmation'], scope)
    exec(compile(ast.Module(body=[prefix], type_ignores=[]), '<confirmation preamble>', 'exec'), scope)
    scope['guard'](True)
    assert not lock.exists(), 'dry preamble must not reserve the frozen run'
    def launch(_):
        try:
            scope['guard'](False)
            return 1
        except SystemExit:
            return 0
    with ThreadPoolExecutor(max_workers=2) as pool:
        winners = sum(pool.map(launch, range(2)))
    assert winners == 1 and lock.exists(), 'two launches both passed the single-run guard'
    assert launch(None) == 0, 'an abandoned reservation must still block a rerun'
    lock.unlink()
    result.write_text('{}')
    assert launch(None) == 0, 'an existing result must block a rerun'
`);
    });

    it('returns failure only after recording a failed confirmation result', () => {
        pythonProbe(`
tree = source('ml_confirm.py')
tail = copy.deepcopy(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main'))
tail.name = 'finish'
tail.args = ast.parse('def finish(dry, result): pass').body[0].args
tail.body = tail.body[-2:]
writes = []
scope = dict(RESULT='unused', write_json=lambda path, value: writes.append(copy.deepcopy(value)))
exec(compile(ast.Module(body=[tail], type_ignores=[]), '<confirmation result tail>', 'exec'), scope)
assert scope['finish'](False, {'passed': False}) != 0, 'a failed result returned success'
assert writes == [{'passed': False}], 'the failed result must be recorded first'
assert scope['finish'](False, {'passed': True}) == 0
`);
    });

    it.each(['lock', 'result'])('tree CLI refuses training with an existing confirmation %s on a temp copy', (state) => {
        pythonProbe(`
with TemporaryDirectory(prefix='slowsky-tree-guard-') as temporary:
    folder = Path(temporary)
    checkout(folder)
    if sys.argv[1] == 'lock':
        (folder / 'models/change-classifier.confirm.json').unlink()
        (folder / 'models/change-classifier.confirm.lock').touch()
    (folder / 'sitecustomize.py').write_text('''import sys\ndef guard(frame, event, arg):\n    if event == 'call' and frame.f_code.co_name in {'dataset', 'train_trees'}:\n        raise RuntimeError('TRAINING_REACHED: ' + frame.f_code.co_name)\nsys.setprofile(guard)\n''')
    before = snapshot(folder)
    run = cli(folder, 'ml_train.py')
    assert snapshot(folder) == before, 'training changed copied evidence'
    assert run.returncode != 0 and 'Training refused:' in run.stderr and 'confirm' in run.stderr.lower(), (
        f'{sys.argv[1]}: exit={run.returncode}; stdout={run.stdout}; stderr={run.stderr}')
    assert 'TRAINING_REACHED' not in run.stderr
`, [state]);
    });

    it.each(['folds', 'treeFolds'])('CLI check rejects a changed confusion matrix in %s', (kind) => {
        pythonProbe(`
with TemporaryDirectory(prefix='slowsky-fold-matrix-') as temporary:
    folder = Path(temporary)
    checkout(folder)
    path = folder / 'models/change-classifier.confirm.json'
    result = json.loads(path.read_text())
    result[sys.argv[1]][0]['confusionMatrix'][2][2] = 0
    path.write_text(json.dumps(result))
    before = snapshot(folder)
    run = cli(folder, 'ml_train_cnn.py', '--check')
    assert snapshot(folder) == before
    assert run.returncode != 0 and 'confirm' in run.stderr.lower(), (
        f'{sys.argv[1]}: exit={run.returncode}; stdout={run.stdout}; stderr={run.stderr}')
`, [kind]);
    });

    it.each(['perClass', 'snrBin'])('CLI check rejects altered fold %s metrics on copied evidence', (kind) => {
        pythonProbe(`
with TemporaryDirectory(prefix='slowsky-fold-metric-') as temporary:
    folder = Path(temporary)
    checkout(folder)
    path = folder / 'models/change-classifier.confirm.json'
    result = json.loads(path.read_text())
    fold = result['folds'][0]
    if sys.argv[1] == 'perClass': fold['perClass']['artifact']['f1'] = 0
    else: fold['recallBySnrBin'][3]['classes']['mover']['recall'] = 0
    path.write_text(json.dumps(result))
    before = snapshot(folder)
    run = cli(folder, 'ml_train_cnn.py', '--check')
    assert snapshot(folder) == before
    assert run.returncode != 0 and 'confirm' in run.stderr.lower(), (run.returncode, run.stdout, run.stderr)
`, [kind]);
    });

    it.each(['lock', 'result'])('CLI refuses training with an existing confirmation %s on a temp copy', (state) => {
        pythonProbe(`
with TemporaryDirectory(prefix='slowsky-training-guard-') as temporary:
    folder = Path(temporary)
    checkout(folder)
    if sys.argv[1] == 'lock':
        (folder / 'models/change-classifier.confirm.json').unlink()
        (folder / 'models/change-classifier.confirm.lock').touch()
    (folder / 'sitecustomize.py').write_text('''import sys
def guard(frame, event, arg):
    if event == 'call' and frame.f_code.co_name in {'dataset', 'fit', 'train_trees'}:
        raise RuntimeError('TRAINING_REACHED: ' + frame.f_code.co_name)
sys.setprofile(guard)
''')
    before = snapshot(folder)
    run = cli(folder, 'ml_train_cnn.py')
    assert snapshot(folder) == before, 'training refusal changed copied evidence'
    assert run.returncode != 0 and 'Training refused:' in run.stderr and 'confirm' in run.stderr.lower(), (
        f'{sys.argv[1]}: exit={run.returncode}; stdout={run.stdout}; stderr={run.stderr}')
    assert 'TRAINING_REACHED' not in run.stderr
`, [state]);
    });

    it.each(['available', 'lock', 'result', 'changedFrozen', 'badPlan'])(
        'dry CLI only checks metadata and creates no files: %s', (state) => {
            pythonProbe(`
with TemporaryDirectory(prefix='slowsky-dry-guard-') as temporary:
    folder = Path(temporary)
    checkout(folder)
    (folder / 'models/change-classifier.confirm.json').unlink()
    state = sys.argv[1]
    if state == 'lock': (folder / 'models/change-classifier.confirm.lock').touch()
    elif state == 'result': (folder / 'models/change-classifier.confirm.json').write_text('{}')
    elif state == 'changedFrozen':
        with (folder / 'scripts/ml_train.py').open('a') as stream: stream.write('# changed frozen code')
    elif state == 'badPlan':
        path = folder / 'models/confirmation-plan.json'
        plan = json.loads(path.read_text())
        plan['freshDraw']['perClassPerTarget'] = 0
        path.write_text(json.dumps(plan))
    (folder / 'sitecustomize.py').write_text('''import sys
class NoTrainingImports:
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'numpy', 'torch', 'ml_stamps', 'ml_train', 'ml_train_cnn'}:
            raise RuntimeError('TRAINING_IMPORT: ' + fullname)
sys.meta_path.insert(0, NoTrainingImports())
''')
    before = snapshot(folder)
    run = cli(folder, 'ml_confirm.py', '--dry-run')
    assert snapshot(folder) == before, 'dry mode created or changed files'
    assert 'TRAINING_IMPORT' not in run.stderr, run.stderr
    report = json.loads(run.stdout)
    assert report['dryRun'] is True
    assert report['lockExists'] is (state == 'lock')
    assert report['resultExists'] is (state == 'result')
    assert report['frozen'] is (state != 'changedFrozen')
    assert report['planValid'] is (state != 'badPlan')
    assert (run.returncode == 0) is (state == 'available')
    assert '731905' in run.stdout and 'wouldRun' in report
    assert not any(word in run.stdout for word in ['passed', 'macroF1', 'artifactPrecision', 'bootstrap'])
`, [state]);
        });

    it.each(['checks', 'passed', 'failed', 'macroF1', 'moverRecallSnr10', 'artifactPrecision',
        'treesMeanFoldMetrics', 'originalTrees', 'evalSha256', 'planSha256', 'orphanLock',
        'duplicateCnnTarget', 'duplicateTreeTarget', 'missingCnnTarget', 'unknownTreeTarget'])(
        'check rejects invalid confirmation evidence: %s', (mode) => {
            pythonProbe(`
import numpy as np
mode = sys.argv[1]
original = json.loads((ROOT / 'models/change-classifier.confirm.json').read_text())
altered = copy.deepcopy(original)
if mode == 'checks': altered['checks']['macroF1'] = False
elif mode == 'passed': altered['passed'] = False
elif mode == 'failed':
    altered['meanFoldMetrics']['artifactPrecision'] = 0.1
    altered['checks']['artifactPrecision'] = False
    altered['passed'] = False
elif mode in ['macroF1', 'moverRecallSnr10', 'artifactPrecision']: altered['meanFoldMetrics'][mode] = 0.1
elif mode == 'treesMeanFoldMetrics': altered['treesMeanFoldMetrics']['macroF1'] = 1
elif mode == 'originalTrees': altered['meanFoldMetrics']['macroF1'] = 0.825
elif mode in ['evalSha256', 'planSha256']: altered[mode] = 'wrong hash'
elif mode == 'duplicateCnnTarget': altered['folds'][0]['testTarget'] = altered['folds'][1]['testTarget']
elif mode == 'duplicateTreeTarget': altered['treeFolds'][0]['testTarget'] = altered['treeFolds'][1]['testTarget']
elif mode == 'missingCnnTarget': altered['folds'].pop()
elif mode == 'unknownTreeTarget': altered['treeFolds'][0]['testTarget'] = 'unknown'
class ReadPath:
    def __init__(self, path): self.path = path
    def __truediv__(self, part): return ReadPath(self.path / part)
    def exists(self):
        if mode == 'orphanLock' and self.path.name == 'change-classifier.confirm.json': return False
        if mode == 'orphanLock' and self.path.name == 'change-classifier.confirm.lock': return True
        return self.path.exists()
    def read_text(self): return self.path.read_text()
    def read_bytes(self): return self.path.read_bytes()
def loads(raw):
    value = json.loads(raw)
    return copy.deepcopy(altered) if isinstance(value, dict) and 'planSha256' in value else value
# Keep the public-card equality check separate, so it cannot mask a missing confirmation guard.
card = json.loads((ROOT / 'public/models/change-classifier.card.json').read_bytes())
scope = dict(ROOT=ReadPath(ROOT), np=np, hashlib=hashlib, json=SimpleNamespace(loads=loads),
             CONFIRM_RESULT=ReadPath(ROOT / 'models/change-classifier.confirm.json'),
             CONFIRM_LOCK=ReadPath(ROOT / 'models/change-classifier.confirm.lock'),
             CLASSES=['mover', 'brightness', 'artifact', 'nothing'],
             KEYS=('macroF1', 'accuracy', 'moverRecallSnr10', 'artifactPrecision'), model_card=lambda *_: card)
functions(source('ml_train_cnn.py'), ['check', 'sha', 'mean_metrics', 'confirmation_fold_metrics', 'check_confirmation', 'confirmation_checks'], scope)
try:
    scope['check']()
except AssertionError as error:
    assert 'confirm' in str(error).lower(), f'wrong guard failed: {error}'
else:
    raise AssertionError(f'--check accepted invalid confirmation evidence: {mode}')
`, [mode]);
        });
});

describe('snapshot change classifier', () => {
    it('declines invalid stamps instead of throwing and offers a nonthrowing model loader', () => {
        const model = loadClassifier(weights);
        for (const stamp of [new Float32Array(4), ...[NaN, Infinity, -Infinity].map((value) => {
            const invalid = new Float32Array(675);
            invalid[1] = value;
            return invalid;
        })]) {
            expect(classify(model, stamp)).toEqual({ kind: 'declined', reason: 'invalid stamp' });
        }
        if (!('tryLoadClassifier' in classifier) || typeof classifier.tryLoadClassifier !== 'function') {
            throw new Error('Missing nonthrowing model loader');
        }
        for (const bad of [null, {}, { ...weights, classes: [] }, { ...weights, conv: [] }]) {
            expect(classifier.tryLoadClassifier(bad)).toBeUndefined();
            expect(() => loadClassifier(bad)).toThrow();
        }
        expect(classifier.tryLoadClassifier(weights)).toEqual(model);
        expect('HELPER_LABEL' in classifier && classifier.HELPER_LABEL).toBe('Experimental sort hint, trained only on fake changes '
            + 'added to single frames. Never tested on real two-date changes. Not a verdict.');
    });

    it('declines near-tied uncalibrated scores using the documented margin choice', () => {
        const cnn = cnnWeights(), stamp = new Float32Array(675);
        stamp[225 + 112] = stamp[450 + 112] = 5;
        // Zero weights make the logits exactly these biases, independent of the stamp.
        cnn.dense[1]!.bias = [1, 1.01, 0, 0];
        expect(classify(loadClassifier(cnn), stamp)).toEqual({ kind: 'declined', reason: 'no clear label' });
        expect('MIN_SCORE_MARGIN' in classifier && classifier.MIN_SCORE_MARGIN).toBe(0.2);
        cnn.dense[1]!.bias = [0, 0, 0, 3];
        expect(classify(loadClassifier(cnn), stamp).kind).toBe('nothing');
    });

    it('declines disagreement in any difference pixel and tolerates float32 channel rounding', () => {
        const model = loadClassifier(weights), stamp = new Float32Array(675);
        stamp[562] = 20;
        expect(classify(model, stamp)).toEqual({ kind: 'declined', reason: 'stamp channels disagree' });
        stamp[225 + 112] = 20;
        stamp[450] = 0.001;
        expect(classify(model, stamp)).toEqual({ kind: 'declined', reason: 'stamp channels disagree' });
        // A real difference of 0.05 cannot be hidden in identical stored channels at this scale.
        stamp.fill(1000, 0, 450);
        stamp.fill(0.05, 450);
        stamp[225 + 112] = 1005;
        stamp[562] = 5.05;
        expect(classify(model, stamp)).toEqual({ kind: 'declined', reason: 'stamp channels disagree' });
        const a = new Float32Array(41 * 41).fill(1000.125), b = a.slice();
        b[20 * 41 + 20] = 1005.125;
        const sampled = stampFor(a, b, grid, { x: 20.25, y: 20.25 }, 0.123)!;
        expect(sampled).toHaveLength(675);
        expect(classify(loadClassifier(cnnWeights()), sampled).kind).toBe('nothing');
    });

    it('rejects a five-sigma difference on identical million-sigma image channels', () => {
        const stamp = new Float32Array(675);
        stamp.fill(1_000_000, 0, 450);
        stamp[562] = 5;
        expect(classify(loadClassifier(weights), stamp)).toEqual({
            kind: 'declined', reason: 'stamp channels disagree',
        });
    });

    it.each([[6_000_000, 2.5], [10_000_000, 4.5]])('declines unverifiable channels at %i with difference %f', (value, difference) => {
        const stamp = new Float32Array(675);
        stamp.fill(value, 0, 450);
        stamp[562] = difference;
        expect(classify(loadClassifier(weights), stamp)).toEqual({
            kind: 'declined', reason: 'values too large to check the channels against each other',
        });
    });

    it('rejects a 0.45 difference on identical million-sigma image channels', () => {
        const stamp = new Float32Array(675);
        stamp.fill(1_000_000, 0, 450);
        stamp[562] = 0.45;
        expect(classify(loadClassifier(weights), stamp)).toEqual({ kind: 'declined', reason: 'stamp channels disagree' });
    });

    it('declines an off-centre peak above the measured 99th-percentile threshold', () => {
        const stamp = new Float32Array(675);
        stamp[225 + 112] = stamp[450 + 112] = 10;
        stamp[225] = stamp[450] = 1370;
        stamp[225 + 224] = stamp[450 + 224] = 1370;
        expect(classify(loadClassifier(weights), stamp)).toEqual({
            kind: 'declined', reason: 'brighter change outside the centre',
        });
    });

    it('accepts channel rounding in every parity stamp and seeded random float32 images up to 1e6', () => {
        const model = loadClassifier(cnnWeights());
        for (const sample of [...parity.cases, ...parity.treeCases, ...parity.cnnCases]) {
            expect(classify(model, Float32Array.from(sample.stamp))).not.toEqual({
                kind: 'declined', reason: 'stamp channels disagree',
            });
        }
        let state = 731905;
        const random = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 2 ** 32;
        };
        for (const scale of [1, 1000, 1_000_000]) {
            for (let i = 0; i < 12; i++) {
                const a = Float32Array.from({ length: 41 * 41 }, () => (2 * random() - 1) * scale);
                const b = i % 2 === 0 ? a.map((v) => v + (2 * random() - 1) * 5)
                    : Float32Array.from(a, () => (2 * random() - 1) * scale);
                const stamp = stampFor(a, b, grid, { x: 20 + random(), y: 20 + random() }, 1.5 + random())!;
                expect(stamp).toHaveLength(675);
                const result = classify(model, stamp);
                if (result.kind === 'declined') {
                    expect(['stamp channels disagree', 'values too large to check the channels against each other'])
                        .not.toContain(result.reason);
                }
            }
        }
    });

    it('uses the core for faintness and the full stamp for the brightness ceiling', () => {
        const model = loadClassifier(cnnWeights()), stamp = new Float32Array(675);
        stamp[225 + 224] = stamp[450 + 224] = 10;
        expect(classify(model, stamp)).toEqual({ kind: 'declined', reason: 'too faint to label' });
        stamp.fill(0);
        stamp[225 + 112] = stamp[450 + 112] = 4;
        stamp[225] = stamp[450] = 1_000_000;
        for (const candidate of [model, loadClassifier(weights)]) {
            expect(classify(candidate, stamp)).toEqual({
                kind: 'declined', reason: 'brighter than anything in training',
            });
        }
    });

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
        expect(expectParity(model, parity.cases)).toEqual({ faint: 1, unclear: 1 });
        expect(classify(model, new Float32Array(675))).toEqual({ kind: 'declined', reason: 'too faint to label' });
    });

    it('matches PyTorch for the CNN attempt and the unchanged phone fallback', () => {
        for (const [json, cases] of [[treeWeights, parity.treeCases], [cnnWeightsAttempt, parity.cnnCases]] as const) {
            const model = loadClassifier(json);
            expect(expectParity(model, cases)).toEqual({ faint: 1, unclear: json === treeWeights ? 5 : 1 });
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
