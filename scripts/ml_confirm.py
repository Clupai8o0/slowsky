"""One frozen confirmation of the CNN on a fresh synthetic test draw (plan: models/confirmation-plan.json).

Run once: scripts/.venv/bin/python scripts/ml_confirm.py
Plumbing check (tiny, throwaway seed, writes nothing): scripts/.venv/bin/python scripts/ml_confirm.py --dry-run
It refuses to run if the frozen training scripts differ from the plan's commit or the result file already exists.
"""

import argparse
import json
import os
import subprocess
import time

import numpy as np
import torch

from ml_stamps import ROOT, dataset
from ml_train import metrics, train_trees, tree_probabilities, write_json
from ml_train_cnn import (KEYS, all_features, export_cnn, fit, from_export, mean_metrics, partition,
                          probabilities, sha)

PLAN = ROOT / 'models/confirmation-plan.json'
RESULT = ROOT / 'models/change-classifier.confirm.json'
LOCK = ROOT / 'models/change-classifier.confirm.lock'


def reserve_confirmation():
    """Keep the reservation even on failure: the frozen draw must never be rerun."""
    if RESULT.exists():
        raise SystemExit(f'{RESULT.name} exists: the confirmation runs exactly once')
    try:
        descriptor = os.open(LOCK, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise SystemExit(f'{LOCK.name} exists: the confirmation run is already reserved') from None
    os.close(descriptor)


def frozen(plan):
    """The training code must be byte-identical to the frozen commit."""
    for path in plan['frozenFiles']:
        same = subprocess.run(['git', 'diff', '--quiet', plan['frozenCommit'], '--', path], cwd=ROOT).returncode == 0
        if not same:
            raise SystemExit(f'{path} differs from {plan["frozenCommit"]}: the confirmation must use frozen code')


def bootstrap(fresh_by_fold, seed, replicates):
    """95% interval of the mean (over fields) artifact precision, resampling each field's stamps."""
    rng = np.random.default_rng(seed)
    means = []
    for _ in range(replicates):
        values = []
        for truth, prediction in fresh_by_fold:
            pick = rng.integers(len(truth), size=len(truth))
            t, p = truth[pick], prediction[pick]
            called = p == 2
            values.append(float(np.mean(t[called] == 2)) if called.any() else 0.0)
        means.append(np.mean(values))
    lo, hi = np.percentile(means, [2.5, 97.5])
    return {'replicates': replicates, 'seed': seed, 'meanArtifactPrecision95': [float(lo), float(hi)]}


def main(dry):
    started = time.monotonic()
    plan = json.loads(PLAN.read_text())
    if not dry:
        frozen(plan)
        reserve_confirmation()
    evaluation = json.loads((ROOT / 'models/change-classifier.eval.json').read_text())
    attempt = evaluation['cnnAttempt']
    tree_json = json.loads((ROOT / 'models/change-classifier-trees.json').read_bytes())
    seed = attempt['seed']
    per_class = 40 if dry else attempt['training']['perTargetPerClass']
    fresh_per_class = 40 if dry else plan['freshDraw']['perClassPerTarget']
    fresh_seed = 1 if dry else plan['freshDraw']['stampSeed']
    args = argparse.Namespace(seed=seed, per_class=per_class, batch_size=256,
                              epochs=2 if dry else attempt['training']['maximumEpochs'])
    assert fresh_seed != seed and fresh_seed != tree_json['seed']
    # Training data exactly as ml_train_cnn.main builds it.
    tx, ty, tt, _, _ = dataset(seed=tree_json['seed'], per_class=40 if dry else 600)
    tfx = all_features(tx)
    x, y, targets, snrs, _ = dataset(seed=seed, per_class=per_class)
    peak_snrs = np.max(np.abs(x[:, 2]), axis=(1, 2))
    fx = all_features(x)
    # Fresh test draw: new injections and noise on the same frames.
    nx, ny, ntargets, nsnrs, _ = dataset(seed=fresh_seed, per_class=fresh_per_class)
    nfx = all_features(nx)
    names = sorted(set(targets.tolist()))
    assert names == sorted(set(ntargets.tolist()))
    recorded = {fold['testTarget']: fold for fold in attempt['folds']}
    counts = {}
    folds, tree_folds, fresh_by_fold = [], [], []
    for i, target in enumerate(names):
        train_targets = [n for n in names if n != target]
        train, val = partition(y, targets, train_targets, seed + i)
        model, history = fit(x, y, fx, train, val, args, seed + i)
        exported = export_cnn(model, tree_json, counts, args, history['bestEpoch'], float(np.max(peak_snrs[train])))
        frozen_model = from_export(exported)
        test = targets == target
        original = metrics(y[test], probabilities(frozen_model, x[test], fx[test]).argmax(1), snrs[test])
        if not dry:
            # Proof that this is the frozen fold model: its original held-out numbers reproduce exactly.
            for key in KEYS:
                assert abs(original[key] - recorded[target][key]) < 1e-12, f'{target} {key} does not reproduce'
            assert history['bestEpoch'] == recorded[target]['bestEpoch']
        fresh = ntargets == target
        prediction = probabilities(frozen_model, nx[fresh], nfx[fresh]).argmax(1)
        fold = {'testTarget': target, 'testCount': int(fresh.sum()), 'bestEpoch': history['bestEpoch'],
                'reproducedOriginal': {key: original[key] for key in KEYS},
                **metrics(ny[fresh], prediction, nsnrs[fresh])}
        folds.append(fold)
        fresh_by_fold.append((ny[fresh], prediction))
        trees = train_trees(tfx[tt != target], ty[tt != target], tree_json['training']['rounds'])
        tree_folds.append({'testTarget': target, **metrics(ny[fresh], tree_probabilities(trees, nfx[fresh]).argmax(1),
                                                         nsnrs[fresh])})
        print(f"{target}: fresh CNN F1={fold['macroF1']:.4f} mover>=10={fold['moverRecallSnr10']:.4f} "
              f"artifact precision={fold['artifactPrecision']:.4f}; trees F1={tree_folds[-1]['macroF1']:.4f}", flush=True)
    mean, tree_mean = mean_metrics(folds), mean_metrics(tree_folds)
    baseline = evaluation['treesBaseline']['meanFoldMetrics']['macroF1']
    checks = {'macroF1': mean['macroF1'] >= 0.8, 'moverRecallSnr10': mean['moverRecallSnr10'] >= 0.85,
              'artifactPrecision': mean['artifactPrecision'] >= 0.85,
              'beatsTreesOnSameTestStamps': mean['macroF1'] >= tree_mean['macroF1'] + 0.01,
              'beatsOriginalTrees': mean['macroF1'] >= baseline + 0.01}
    spread = {key: {'min': float(min(f[key] for f in folds)), 'max': float(max(f[key] for f in folds)),
                    'std': float(np.std([f[key] for f in folds], ddof=1))} for key in KEYS}
    result = {'plan': plan, 'planSha256': sha(PLAN.read_bytes()), 'evalSha256':
              sha((ROOT / 'models/change-classifier.eval.json').read_bytes()),
              'passed': all(checks.values()), 'checks': checks, 'meanFoldMetrics': mean,
              'treesMeanFoldMetrics': tree_mean, 'spreadOverFields': spread,
              'bootstrap': bootstrap(fresh_by_fold, plan['uncertainty']['bootstrapSeed'],
                                     20 if dry else plan['uncertainty']['replicates']),
              'folds': folds, 'treeFolds': tree_folds, 'elapsedSeconds': time.monotonic() - started}
    print(json.dumps({'passed': result['passed'], 'checks': checks,
                      'mean': {k: round(v, 4) for k, v in mean.items()},
                      'treesMeanMacroF1': round(tree_mean['macroF1'], 4),
                      'artifactPrecisionSpread': spread['artifactPrecision'],
                      'bootstrap': result['bootstrap']['meanArtifactPrecision95']}), flush=True)
    if not dry:
        write_json(RESULT, result)
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    options = parser.parse_args()
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(20261114)
    raise SystemExit(main(options.dry_run))
