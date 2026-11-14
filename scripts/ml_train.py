"""Train, validate and export the offline snapshot change classifier.

Gate: scripts/.venv/bin/python scripts/ml_train.py --seed 20261114
Returns 1 if target-held-out quality or size fails. No network, GPU or runtime ML
dependency. Repeating with the same seed/configuration/snapshot gives identical
model bytes; timestamps and the source revision live only in the eval sidecar.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import time

import numpy as np
import torch

from ml_stamps import CLASSES, FEATURES, NATIVE, ROOT, SIZE, dataset, features


def tree_predict(tree, x):
    if 'value' in tree:
        return np.tile(tree['value'], (len(x), 1))
    mask = x[:, tree['feature']] <= tree['threshold']
    out = np.empty((len(x), 4))
    out[mask] = tree_predict(tree['left'], x[mask])
    out[~mask] = tree_predict(tree['right'], x[~mask])
    return out


def train_trees(x, y, rounds):
    """Multiclass Newton gradient boosting, depth 3, twelve fixed hand features.

    Split thresholds and leaf values are rounded before use, so validation and
    export traverse precisely the same trees. No sklearn or other dependency.
    """
    thresholds = [np.unique([float(f'{v:.6g}') for v in np.quantile(x[:, i], np.linspace(0, 1, 34)[1:-1])])
                  for i in range(x.shape[1])]
    bins = [np.searchsorted(t, x[:, i], side='left') for i, t in enumerate(thresholds)]
    logits = np.zeros((len(x), 4))
    truth = np.eye(4)[y]
    trees = []
    for iteration in range(rounds):
        p = torch.from_numpy(logits).softmax(1).numpy()
        gradient, hessian = truth - p, np.maximum(p * (1 - p), 1e-4)

        def node(indices, depth):
            g, h = gradient[indices], hessian[indices]
            gs, hs = g.sum(0), h.sum(0)
            value = np.clip(0.1 * gs / (hs + 5), -1, 1)
            leaf = {'value': [float(f'{v:.6g}') for v in value]}
            if depth == 3 or len(indices) < 32:
                return leaf
            best_score, best = float(np.sum(gs * gs / (hs + 5))), None
            for feature in range(12):
                count = len(thresholds[feature]) + 1
                bucket = bins[feature][indices]
                size = np.bincount(bucket, minlength=count).cumsum()[:-1]
                gl = np.stack([np.bincount(bucket, weights=g[:, c], minlength=count).cumsum()[:-1]
                               for c in range(4)], axis=1)
                hl = np.stack([np.bincount(bucket, weights=h[:, c], minlength=count).cumsum()[:-1]
                               for c in range(4)], axis=1)
                scores = np.sum(gl * gl / (hl + 5) + (gs - gl) ** 2 / (hs - hl + 5), axis=1)
                scores[(size < 12) | (len(indices) - size < 12)] = -np.inf
                split = int(np.argmax(scores))
                if scores[split] > best_score + 1e-8:
                    best_score, best = float(scores[split]), (feature, split)
            if best is None:
                return leaf
            feature, split = best
            left = bins[feature][indices] <= split
            return {'feature': feature, 'threshold': float(thresholds[feature][split]),
                    'left': node(indices[left], depth + 1), 'right': node(indices[~left], depth + 1)}

        tree = node(np.arange(len(x)), 0)
        trees.append(tree)
        logits += tree_predict(tree, x)
    return trees


def tree_probabilities(trees, x):
    # Reference probabilities are computed by PyTorch CPU from exported trees.
    logits = torch.zeros((len(x), 4), dtype=torch.float64)
    for tree in trees:
        logits += torch.from_numpy(tree_predict(tree, x))
    return logits.softmax(1).numpy()


def metrics(truth, prediction, snrs):
    confusion = np.zeros((4, 4), dtype=int)
    np.add.at(confusion, (truth, prediction), 1)
    precision = np.diag(confusion) / np.maximum(confusion.sum(0), 1)
    recall = np.diag(confusion) / np.maximum(confusion.sum(1), 1)
    f1 = 2 * precision * recall / np.maximum(precision + recall, 1e-12)
    high = (truth == 0) & (snrs >= 10)
    if not high.any():
        raise ValueError('No held-out mover examples at S/N >= 10')
    bins = []
    edges = [3, 5, 7, 10, 20, 30]
    for i, lo in enumerate(edges):
        hi = edges[i + 1] if i + 1 < len(edges) else None
        selection = (snrs >= lo) & ((snrs < hi) if hi is not None else True)
        classes = {}
        for j, name in enumerate(CLASSES):
            mask = selection & (truth == j)
            classes[name] = {'count': int(mask.sum()),
                             'recall': float(np.mean(prediction[mask] == j)) if mask.any() else None}
        bins.append({'lo': lo, 'hi': hi, 'classes': classes})
    return {'confusionMatrix': confusion.tolist(), 'confusionOrder': 'rows=truth, columns=prediction',
            'accuracy': float(np.mean(truth == prediction)), 'macroF1': float(f1.mean()),
            'moverRecallSnr10': float(np.mean(prediction[high] == 0)),
            'moverSnr10Count': int(high.sum()), 'artifactPrecision': float(precision[2]),
            'perClass': {name: {'precision': float(precision[i]), 'recall': float(recall[i]),
                                'f1': float(f1[i]), 'count': int(confusion[i].sum())}
                         for i, name in enumerate(CLASSES)}, 'recallBySnrBin': bins}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n')


def git_state(outputs):
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    status = subprocess.check_output([
        'git', 'status', '--porcelain', '--untracked-files=no', '--', '.',
        *[f':(exclude){path}' for path in outputs],
    ], cwd=ROOT, text=True)
    return revision, bool(status.strip())


def export(model, args, counts, peak_snr_max):
    return {'version': 1, 'architecture': 'gradient-boosted-trees-12',
            'madeBy': 'Codex (OpenAI) and Claude; scripts/ml_train.py; PyTorch CPU',
            'aiNote': 'AI-written code, built by Codex (OpenAI) and Claude during the event. '
                      "The output is a model's guess about a candidate, and can be wrong. "
                      'Training labels are fake changes injected into real SPHEREx frames, not real objects.',
            'seed': args.seed, 'classes': CLASSES,
            'stamp': {'size': SIZE, 'channels': ['earlier', 'later', 'later-earlier'],
                      'layout': 'CHW', 'pixelArcsec': NATIVE, 'normalization': 'difference-MAD-sigma',
                      'preprocess': 'twelve-morphology-flux-features'},
            'training': {'rounds': args.rounds, 'perTargetPerClass': args.per_class,
                         'counts': counts, 'peakSnrMax': peak_snr_max, 'split': 'leave-one-target-out',
                         'optimizer': 'multiclass-Newton-gradient-boosting', 'learningRate': 0.1,
                         'maxDepth': 3, 'l2': 5, 'minimumLeaf': 12,
                         'torch': torch.__version__, 'numpy': np.__version__},
            'features': FEATURES, 'trees': model}


def main(args):
    started = time.monotonic()
    revision, dirty = git_state(('public/models/change-classifier.json',
                                 'models/change-classifier.eval.json',
                                 'tests/fixtures/classify-parity.json'))
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(args.seed)
    x, y, targets, snrs, provenance = dataset(seed=args.seed, per_class=args.per_class)
    fx = np.array([features(stamp) for stamp in x])
    folds, all_predictions = [], np.zeros(len(y), dtype=int)
    names = sorted(set(targets.tolist()))
    for target in names:
        test = targets == target
        print(f'Hold out {target}; train {int((~test).sum())}, test {int(test.sum())}', flush=True)
        model = train_trees(fx[~test], y[~test], args.rounds)
        prediction = tree_probabilities(model, fx[test]).argmax(1)
        all_predictions[test] = prediction
        result = metrics(y[test], prediction, snrs[test])
        folds.append({'testTarget': target, 'trainTargets': [n for n in names if n != target],
                      'trainCount': int((~test).sum()), 'testCount': int(test.sum()), **result})
        print(f"{target}: F1={result['macroF1']:.4f}, mover>=10={result['moverRecallSnr10']:.4f}, "
              f"artifact precision={result['artifactPrecision']:.4f}", flush=True)
    mean = {key: float(np.mean([fold[key] for fold in folds]))
            for key in ('macroF1', 'accuracy', 'moverRecallSnr10', 'artifactPrecision')}
    quality = mean['macroF1'] >= 0.80 and mean['moverRecallSnr10'] >= 0.85 and mean['artifactPrecision'] >= 0.85
    print('Fit final model on all five targets', flush=True)
    model = train_trees(fx, y, args.rounds)
    counts = {target: {name: int(((targets == target) & (y == i)).sum())
                       for i, name in enumerate(CLASSES)} for target in names}
    # Runtime compares the same observed sigma-normalized difference channel,
    # including noise/registration residuals, rather than the requested injection.
    peak_snrs = np.max(np.abs(x[:, 2]), axis=(1, 2))
    peak_snr_max = float(np.max(peak_snrs))
    model_path = ROOT / 'public/models/change-classifier.json'
    write_json(model_path, export(model, args, counts, peak_snr_max))
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    # Parity fixtures exercise inference within the runtime's supported range.
    selected = [int(np.flatnonzero((targets == target) & (y == kind) & (peak_snrs >= 2.5))[0])
                for target in names for kind in range(4)]
    probs = tree_probabilities(model, fx[selected])
    write_json(ROOT / 'tests/fixtures/classify-parity.json', {
        'seed': args.seed, 'modelSha256': digest, 'reference': 'PyTorch CPU, exported rounded weights',
        'cases': [{'stamp': x[index].flatten().tolist(), 'probabilities': probs[i].tolist(),
                   'truth': CLASSES[y[index]], **provenance['examples'][index]}
                  for i, index in enumerate(selected)]})
    passed = quality and model_path.stat().st_size <= 200_000
    summary = {'madeBy': 'scripts/ml_train.py', 'madeAt': datetime.now(timezone.utc).isoformat(),
               'gitSha': revision, 'gitDirty': dirty, 'seed': args.seed, 'classes': CLASSES, 'modelSha256': digest,
               'modelBytes': model_path.stat().st_size, 'elapsedSeconds': time.monotonic() - started,
               'training': {'rounds': args.rounds, 'perTargetPerClass': args.per_class,
                            'totalStamps': len(y), 'counts': counts, 'cpuThreads': 1,
                            'peakSnrMax': peak_snr_max},
               'modelFamily': 'gradient-boosted trees on twelve morphology/flux features',
               'selectionReason': 'Baseline only; not shipped. Kept for comparison.',
               'validation': 'Synthetic injections only; each fold holds out all frames of one target. '
                             'Final exported model refits all targets; these are out-of-fold metrics, '
                             'not accuracy on real unknown objects. No human labels or external data.',
               'snrDefinition': 'Peak injected native-pixel difference divided by post-injection tile MAD sigma',
               'psfMethod': 'Background-subtracted stellar second moments within radius 3 native pixels; '
                            'isolated finite peaks 10-500 noise sigma, axis ratio <=2, FWHM 1.2-4.5 pixels. '
                            'Injection widths sampled from individual stars measured in each source frame; '
                            'the brightness screen is a saturation proxy, not a calibrated saturation mask.',
               'configurationSelection': 'The held-out gate was used to select the fallback configuration; '
                                         'this is development validation, not an untouched benchmark.',
               'folds': folds, 'meanFoldMetrics': mean,
               'worstFold': min(folds, key=lambda fold: fold['macroF1'])['testTarget'],
               **metrics(y, all_predictions, snrs),
               'psfMeasurements': provenance['psfMeasurements'], 'skippedFrames': provenance['skippedFrames'],
               'gate': {'passed': passed, 'thresholds': {'macroF1': 0.8, 'moverRecallSnr10': 0.85,
                                                       'artifactPrecision': 0.85, 'maxBytes': 200_000}}}
    write_json(ROOT / 'models/change-classifier.eval.json', summary)
    print(json.dumps({'meanFoldMetrics': mean, 'gate': passed, 'modelSha256': digest,
                      'seconds': summary['elapsedSeconds']}), flush=True)
    return 0 if passed else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=int, default=20261114)
    parser.add_argument('--per-class', type=int, default=600)
    parser.add_argument('--rounds', type=int, default=220)
    args = parser.parse_args()
    if args.per_class < 4 or not 1 <= args.rounds <= 256:
        parser.error('Need at least four examples per class and 1-256 boosting rounds')
    raise SystemExit(main(args))
