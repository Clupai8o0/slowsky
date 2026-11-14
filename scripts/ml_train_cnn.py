"""Deterministic CPU CNN attempt; preserve the reproducible round-one trees.

Gate: scripts/.venv/bin/python scripts/ml_train_cnn.py --check
Train: scripts/.venv/bin/python scripts/ml_train_cnn.py --verify-determinism
The check passes only for a shipped model that passed its gate; an honestly rejected run is recorded but fails it.
Held-out targets are evaluated once, after training-only validation selection.
"""

import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
import time

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from ml_stamps import CLASSES, FEATURES, ROOT, SIZE, dataset, features
from ml_train import git_state, metrics, train_trees, tree_probabilities, write_json

ARCHITECTURE = 'cnn-3x3-gap-features-12-16-16'
KEYS = ('macroF1', 'accuracy', 'moverRecallSnr10', 'artifactPrecision')
TREES_NOTE = 'Trees saw 600 stamps per class per target, the CNN 2,500: not like-for-like.'


def feature_batch(stamps):
    """Vectorized round-one features, including the same row-major peak ties."""
    a, b, diff = np.asarray(stamps, dtype=np.float64).transpose(1, 0, 2, 3)
    a = a - np.median(a, axis=(1, 2))[:, None, None]
    b = b - np.median(b, axis=(1, 2))[:, None, None]
    yy, xx = np.mgrid[:SIZE, :SIZE]
    absolute = np.abs(diff)
    core = (xx - 7) ** 2 + (yy - 7) ** 2 <= 16
    peak_index = np.where(core, absolute, -1).reshape(len(a), -1).argmax(1)
    py, px = peak_index // SIZE, peak_index % SIZE
    at = np.arange(len(a)), py, px
    peak = absolute[at]
    distance = (xx - px[:, None, None]) ** 2 + (yy - py[:, None, None]) ** 2
    region = distance <= 25
    reduce = lambda v: v.sum(axis=(1, 2))
    w = np.maximum(absolute - np.maximum(2, 0.15 * peak)[:, None, None], 0) * region
    total = reduce(w) + 1e-12
    mx, my = reduce(w * xx) / total, reduce(w * yy) / total
    vx = reduce(w * (xx - mx[:, None, None]) ** 2) / total
    vy = reduce(w * (yy - my[:, None, None]) ** 2) / total
    cov = reduce(w * (xx - mx[:, None, None]) * (yy - my[:, None, None])) / total
    gap = np.sqrt(np.maximum(0, (vx - vy) ** 2 + 4 * cov ** 2))
    elongation = (vx + vy + gap + 0.2) / (vx + vy - gap + 0.2)
    pos, neg = np.maximum(diff - 2, 0) * region, np.maximum(-diff - 2, 0) * region
    ps, ns = reduce(pos), reduce(neg)
    pxc, pyc = reduce(pos * xx) / (ps + 1e-12), reduce(pos * yy) / (ps + 1e-12)
    nxc, nyc = reduce(neg * xx) / (ns + 1e-12), reduce(neg * yy) / (ns + 1e-12)
    balance = np.minimum(ps, ns) / (np.maximum(ps, ns) + 1e-12)
    row = np.arange(len(a))
    laplace = lambda v: (4 * v[at] - v[row, py - 1, px] - v[row, py + 1, px]
                         - v[row, py, px - 1] - v[row, py, px + 1])
    sharp = laplace(absolute) / (peak + 1)
    fa, fb = np.maximum(0, reduce(a * (distance <= 4))), np.maximum(0, reduce(b * (distance <= 4)))
    ratio = np.minimum(fa, fb) / (np.maximum(fa, fb) + 1)
    fractional = peak / (np.maximum(np.abs(a[at]), np.abs(b[at])) + 1)
    source = np.where((diff[at] >= 0)[:, None, None], b, a)
    source_sharp = laplace(source) / np.maximum(1, np.abs(source[at]))
    average = (a + b) / 2
    maxima = np.zeros_like(region)
    v = average[:, 1:-1, 1:-1]
    maxima[:, 1:-1, 1:-1] = ((v > average[:, :-2, 1:-1]) & (v > average[:, 2:, 1:-1])
        & (v > average[:, 1:-1, :-2]) & (v > average[:, 1:-1, 2:])
        & (v > np.maximum(3, peak * 0.2)[:, None, None]))
    # A real maximum can be farther than 15; match the scalar implementation.
    nearest = np.where(maxima.any(axis=(1, 2)),
                       np.sqrt(np.where(maxima, distance, np.inf).min(axis=(1, 2))), 15)
    count = reduce(region)
    ac = (a - (reduce(a * region) / count)[:, None, None]) * region
    bc = (b - (reduce(b * region) / count)[:, None, None]) * region
    correlation = reduce(ac * bc) / np.sqrt(reduce(ac * ac) * reduce(bc * bc) + 1e-12)
    return np.stack((np.log1p(peak), np.log1p(total / (peak + 1)), np.log1p(elongation), sharp,
                     np.hypot(px - 7, py - 7), balance, np.hypot(pxc - nxc, pyc - nyc) * balance,
                     ratio, fractional, nearest, source_sharp, correlation), axis=1)


def all_features(x):
    return np.concatenate([feature_batch(x[i:i + 256]) for i in range(0, len(x), 256)])


def augment(x, generator):
    """Independent D4 rotation/reflection and common +/-0.3 pixel XY translation.

    Both epochs receive the same transform; the difference is recomputed to
    preserve the channel contract. Only the optimizer's training batches call it.
    """
    rotation = torch.randint(4, (len(x),), generator=generator)
    flip = torch.randint(2, (len(x),), generator=generator)
    result = torch.empty_like(x)
    for k in range(4):
        for f in range(2):
            mask = (rotation == k) & (flip == f)
            selected = torch.rot90(x[mask], k, (2, 3))
            result[mask] = selected.flip(3) if f else selected
    affine = torch.eye(2, 3).repeat(len(x), 1, 1)
    affine[:, :, 2] = (torch.rand((len(x), 2), generator=generator) * 0.6 - 0.3) * (2 / SIZE)
    grid = F.affine_grid(affine, x.shape, align_corners=False)
    result = F.grid_sample(result, grid, padding_mode='border', align_corners=False)
    result[:, 2] = result[:, 1] - result[:, 0]
    return result


class StampCNN(nn.Module):
    def __init__(self, mean, scale):
        super().__init__()
        self.register_buffer('feature_mean', torch.as_tensor(mean, dtype=torch.float32))
        self.register_buffer('feature_scale', torch.as_tensor(scale, dtype=torch.float32))
        self.blocks = nn.ModuleList([
            nn.Sequential(nn.Conv2d(3, 12, 3, padding=1), nn.BatchNorm2d(12), nn.ReLU()),
            nn.Sequential(nn.Conv2d(12, 16, 3, padding=1), nn.BatchNorm2d(16), nn.ReLU()),
            nn.Sequential(nn.Conv2d(16, 16, 3, padding=1), nn.BatchNorm2d(16), nn.ReLU()),
        ])
        self.hidden = nn.Linear(28, 32)
        self.output = nn.Linear(32, 4)

    def forward(self, x, fx):
        median = x.flatten(2).median(2).values[:, :, None, None]
        x = torch.asinh((x - median) / 5)
        x = self.blocks[0](x)
        x = F.max_pool2d(self.blocks[1](x), 2)
        x = self.blocks[2](x).mean((2, 3))
        combined = torch.cat((x, (fx - self.feature_mean) / self.feature_scale), dim=1)
        return self.output(F.relu(self.hidden(combined)))


def partition(y, targets, train_targets, seed):
    rng = np.random.default_rng(seed)
    train, validation = [], []
    for target in train_targets:
        for kind in range(4):
            indices = rng.permutation(np.flatnonzero((targets == target) & (y == kind)))
            n = max(1, int(len(indices) * 0.15))
            validation.extend(indices[:n])
            train.extend(indices[n:])
    return np.array(train), np.array(validation)


def probabilities(model, x, fx):
    model.eval()
    with torch.no_grad():
        return torch.cat([model(torch.from_numpy(x[i:i + 256]),
                                torch.as_tensor(fx[i:i + 256], dtype=torch.float32)).softmax(1)
                          for i in range(0, len(x), 256)]).numpy()


def fit(x, y, fx, train, validation, args, seed, epochs=None):
    torch.manual_seed(seed)
    generator = torch.Generator().manual_seed(seed + 1)
    mean, scale = fx[train].mean(0), np.maximum(fx[train].std(0), 0.05)
    model = StampCNN(mean, scale)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.003, weight_decay=0.01)
    limit = args.epochs if epochs is None else epochs
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=limit)
    best_score, best_state, best_epoch, history = -1, None, 0, []
    for epoch in range(limit):
        model.train()
        order = train[torch.randperm(len(train), generator=generator).numpy()]
        loss_sum = 0
        for start in range(0, len(order), args.batch_size):
            indices = order[start:start + args.batch_size]
            batch = augment(torch.from_numpy(x[indices]), generator)
            batch_features = torch.as_tensor(feature_batch(batch.numpy()), dtype=torch.float32)
            optimizer.zero_grad(set_to_none=True)
            logits = model(batch, batch_features)
            loss = F.cross_entropy(logits, torch.from_numpy(y[indices]), label_smoothing=0.05)
            loss.backward()
            optimizer.step()
            loss_sum += float(loss.detach()) * len(indices)
        schedule.step()
        entry = {'epoch': epoch + 1, 'trainingLoss': loss_sum / len(train)}
        if validation is not None:
            prediction = probabilities(model, x[validation], fx[validation]).argmax(1)
            # Selection is macro F1 on the four training targets only.
            confusion = np.zeros((4, 4), dtype=int)
            np.add.at(confusion, (y[validation], prediction), 1)
            score = float(np.mean(2 * np.diag(confusion)
                                 / np.maximum(confusion.sum(0) + confusion.sum(1), 1)))
            entry['validationMacroF1'] = score
            if score > best_score:
                best_score, best_state, best_epoch = score, copy.deepcopy(model.state_dict()), epoch + 1
        else:
            best_epoch = epoch + 1
        history.append(entry)
        print(f"  epoch {epoch + 1}/{limit} loss={entry['trainingLoss']:.4f}"
              + (f' validation F1={score:.4f}' if validation is not None else ''), flush=True)
        if validation is not None and epoch + 1 - best_epoch >= 5:
            break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    return model, {'bestEpoch': best_epoch, 'bestValidationMacroF1': best_score if validation is not None else None,
                   'epochsRun': len(history), 'history': history}


def rounded(tensor):
    return [float(f'{v:.7g}') for v in tensor.detach().flatten().tolist()]


def export_cnn(model, tree_json, counts, args, epochs, peak_snr_max):
    model.eval()
    conv = []
    for block in model.blocks:
        fused = nn.utils.fuse_conv_bn_eval(block[0], block[1])
        conv.append({'weights': rounded(fused.weight), 'bias': rounded(fused.bias)})
    return {**{k: tree_json[k] for k in ('version', 'classes', 'stamp', 'features', 'aiNote')},
            'architecture': ARCHITECTURE, 'seed': args.seed,
            'madeBy': 'Codex (OpenAI) and Claude; scripts/ml_train_cnn.py; PyTorch CPU',
            'inputTransform': 'median-asinh-5',
            'featureMean': rounded(model.feature_mean), 'featureScale': rounded(model.feature_scale),
            'conv': conv, 'dense': [{'weights': rounded(layer.weight), 'bias': rounded(layer.bias)}
                                   for layer in (model.hidden, model.output)],
            'training': {'counts': counts, 'perTargetPerClass': args.per_class, 'epochs': epochs,
                         'peakSnrMax': peak_snr_max,
                         'maximumEpochs': args.epochs, 'optimizer': 'AdamW', 'learningRate': 0.003,
                         'weightDecay': 0.01, 'schedule': 'cosine', 'labelSmoothing': 0.05,
                         'batchSize': args.batch_size, 'batchNormFolded': True,
                         'augmentation': 'training only: D4 rotations/flips; common XY shifts +/-0.3 px',
                         'split': 'leave-one-target-out; stratified 15% validation within training targets',
                         'cpuThreads': 1, 'torch': torch.__version__, 'numpy': np.__version__}}


def from_export(value):
    """PyTorch reference uses the rounded, BN-folded JSON weights."""
    model = StampCNN(value['featureMean'], value['featureScale'])
    for i, layer in enumerate(value['conv']):
        conv = model.blocks[i][0]
        conv.weight.data.copy_(torch.tensor(layer['weights']).reshape_as(conv.weight))
        conv.bias.data.copy_(torch.tensor(layer['bias']))
        model.blocks[i] = nn.Sequential(conv, nn.Identity(), nn.ReLU())
    for dense, layer in zip((model.hidden, model.output), value['dense']):
        dense.weight.data.copy_(torch.tensor(layer['weights']).reshape_as(dense.weight))
        dense.bias.data.copy_(torch.tensor(layer['bias']))
    return model.eval()


def encode(value):
    return (json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def mean_metrics(folds):
    return {key: float(np.mean([fold[key] for fold in folds])) for key in KEYS}


def model_card(summary, eval_digest):
    """Public wording and every displayed number come from this run's sidecar."""
    worst = min(summary['folds'], key=lambda fold: fold['macroF1'])
    labels = {'moverRecallSnr10': 'mover recall at S/N>=10', 'artifactPrecision': 'artifact precision',
              'macroF1': 'macro-F1'}
    thresholds = summary['gate']['thresholds']
    trees_by_target = {entry['testTarget']: entry['trees'] for entry in summary['comparison']}
    cnn_shipped = summary['cnnAttempt']['gate']['passed']
    # One clause per metric (not per field), grouped by target value, keeps every miss inside the card budget.
    below = {}
    for key, items in summary['worstFoldGate'].items():
        if not items:
            continue
        values = ', '.join(f"{item['target']} {item['value']:.3f}"
                           + (' (trees better)' if cnn_shipped and trees_by_target[item['target']][key] > item['value'] else '')
                           for item in items)
        below.setdefault(f"{thresholds[key]:.2f}", []).append(f"{labels[key]} on {values}")
    low_bin = next(b for b in summary['recallBySnrBin'] if b['lo'] == 3 and b['hi'] == 5)
    test_counts = sorted({fold['testCount'] for fold in summary['folds']})
    frame_counts = [sum(frame['target'] == fold['testTarget'] for frame in summary['psfMeasurements'])
                    for fold in summary['folds']]
    mover_count = summary['perClass']['mover']['count']
    total = sum(value['count'] for value in summary['perClass'].values())
    share = ('A quarter' if mover_count * 4 == total else f'{100 * mover_count / total:.2f}'.rstrip('0').rstrip('.') + '%')
    card = {
        'meanFoldMacroF1': round(summary['meanFoldMetrics']['macroF1'], 3),
        'syntheticTestAccuracy': round(summary['meanFoldMetrics']['accuracy'], 3),
        'worstFold': {'target': worst['testTarget'], 'macroF1': round(worst['macroF1'], 3)},
        'evaluation': (f"Leave-one-target-out over {len(summary['folds'])} SPHEREx fields "
                       f"({min(frame_counts)}-{max(frame_counts)} frames each), "
                       f"{'/'.join(f'{n:,}' for n in test_counts)} test stamps per fold. "
                       f"Scores are from fold models; the shipped model is trained on all {len(summary['folds'])}."),
        'data': ('Trained and tested only on fake changes added to single real SPHEREx DR1/QR3 frames, never on '
                 'two real dates. No real movers, no human labels.'),
        'selection': ('CNN chosen over trees on these same held-out folds and test stamps, so this is not an untouched benchmark.'
                      if summary['cnnAttempt']['gate']['passed'] else
                      'Trees retained; the CNN did not pass its comparison checks on these same held-out folds.'),
        'limits': ('Labels change spots only; it does not find planets. Not tested on a real asteroid. '
                   f"Mover recall is {low_bin['classes']['mover']['recall']:.2f} at S/N 3-5. "
                   f'{share} of test stamps are movers; if real ones are rarer, more mover labels are wrong.'),
        'treesMacroF1OriginalFolds': round(summary['cnnAttempt']['sameTestTrees']['meanFoldMetrics']['macroF1'], 3),
        'treesNote': TREES_NOTE, 'evalSha256': eval_digest, 'seed': summary['seed'],
    }
    # The one frozen retest (scripts/ml_confirm.py), once it has run against this evaluation.
    confirm_path = ROOT / 'models/change-classifier.confirm.json'
    retest_by_target = {}
    if confirm_path.exists():
        confirm = json.loads(confirm_path.read_text())
        assert confirm['evalSha256'] == eval_digest, 'retest was run against a different evaluation'
        mean = confirm['meanFoldMetrics']
        lo, hi = confirm['bootstrap']['meanArtifactPrecision95']
        card['retest'] = (f"{'Passed' if confirm['passed'] else 'Failed'} a frozen retest on fresh fake stamps "
                          f"(same fields and frames, not new sky): macro-F1 {mean['macroF1']:.3f}, "
                          f"mover recall at S/N>=10 {mean['moverRecallSnr10']:.3f}, "
                          f"artifact precision {mean['artifactPrecision']:.3f}. ")
        target = thresholds['artifactPrecision']
        if lo < target:
            opening = 'The last is a thin pass: its' if confirm['passed'] else 'Its'
            relation = 'crosses' if hi > target else 'does not clear'
            card['retest'] += (f"{opening} 95% range, {lo:.3f}-{hi:.3f}, {relation} the {target:.2f} target, "
                               f"and that range holds the {len(confirm['folds'])} fields fixed, "
                               'so it shows stamp-to-stamp noise only. ')
        card['retest'] += (f"Trees on the same fresh stamps: macro-F1 "
                           f"{confirm['treesMeanFoldMetrics']['macroF1']:.3f}.")
        retest_by_target = {fold['testTarget']: fold for fold in confirm['folds']}
    names = {'wise0855': 'WISE 0855', 'barnard': "Barnard's Star", 'epsindb': 'eps Indi B',
             'rdra': 'R Dra', 'rwaur': 'RW Aur'}
    weak = [fold for fold in summary['folds']
            if all(fold[key] < thresholds[key] for key in ('moverRecallSnr10', 'artifactPrecision'))]
    weak_notes = []
    for fold in weak:
        target = fold['testTarget']
        values = []
        for key in ('moverRecallSnr10', 'artifactPrecision'):
            value = f"{labels[key]} {fold[key]:.3f}"
            if target in retest_by_target:
                value += f" (retest {retest_by_target[target][key]:.3f})"
            values.append(value)
        gate = thresholds['artifactPrecision']
        both = f'both {gate:.2f} targets' if gate == thresholds['moverRecallSnr10'] else 'both targets'
        note = f"{names[target]} missed {both}: {' and '.join(values)}"
        note += ('; the trees did better on both.' if all(trees_by_target[target][key] > fold[key]
                  for key in ('moverRecallSnr10', 'artifactPrecision')) else '.')
        weak_notes.append(note)
    if worst['testTarget'] not in {fold['testTarget'] for fold in weak}:
        weak_notes.append(f"{names[worst['testTarget']]} has the lowest macro-F1 ({worst['macroF1']:.3f}).")
    card['weakField'] = ' '.join(weak_notes)
    if below:
        card['belowGate'] = ' '.join(f"Below the {target} target: {'; '.join(parts)}." for target, parts in below.items())
    return card


def write_card():
    """Rebuild only the public wording from existing evidence; never fit a model."""
    eval_raw = (ROOT / 'models/change-classifier.eval.json').read_bytes()
    card = model_card(json.loads(eval_raw), sha(eval_raw))
    assert len(encode(card)) < 2048, 'Model card exceeds the 2048-byte budget'
    write_json(ROOT / 'public/models/change-classifier.card.json', card)
    return 0


def self_test():
    rng = np.random.default_rng(123)
    x = rng.normal(size=(20, 3, SIZE, SIZE)).astype(np.float32)
    x[:, 2] = x[:, 1] - x[:, 0]
    np.testing.assert_allclose(feature_batch(x), [features(stamp) for stamp in x], atol=1e-9)
    zeros = np.zeros((1, 3, SIZE, SIZE), dtype=np.float32)
    np.testing.assert_allclose(feature_batch(zeros), [features(zeros[0])], atol=1e-9)
    gen = torch.Generator().manual_seed(12)
    augmented = augment(torch.from_numpy(x), gen).numpy()
    np.testing.assert_allclose(augmented[:, 2], augmented[:, 1] - augmented[:, 0])
    np.testing.assert_allclose(feature_batch(augmented), [features(stamp) for stamp in augmented], atol=1e-9)
    model = StampCNN(np.zeros(12), np.ones(12)).eval()
    template = {'version': 1, 'classes': CLASSES, 'stamp': {}, 'features': FEATURES, 'aiNote': 'test'}
    args = argparse.Namespace(seed=12, epochs=2, per_class=4, batch_size=16)
    exported = export_cnn(model, template, {}, args, 2, float(np.max(np.abs(x[:, 2]))))
    np.testing.assert_allclose(probabilities(model, x, feature_batch(x)),
                               probabilities(from_export(exported), x, feature_batch(x)), atol=1e-6)
    y = np.tile(np.repeat(np.arange(4), 20), 5)
    targets = np.repeat(['a', 'b', 'c', 'd', 'e'], 80)
    train, val = partition(y, targets, ['a', 'b', 'c', 'd'], 12)
    assert not set(train) & set(val)
    assert 'e' not in targets[np.r_[train, val]]
    print('CNN self-test passed: feature equivalence, augmentation, BN folding, target isolation', flush=True)


def check_confirmation(evaluation, eval_digest):
    """Recompute the five frozen-plan gates; no fitting or fresh draw is allowed here."""
    result_path = ROOT / 'models/change-classifier.confirm.json'
    lock_path = ROOT / 'models/change-classifier.confirm.lock'
    assert not (lock_path.exists() and not result_path.exists()), 'Confirmation lock exists without a result'
    if not result_path.exists():
        return
    result = json.loads(result_path.read_text())
    assert result['evalSha256'] == eval_digest, 'Confirmation evaluation hash mismatch'
    plan_path = ROOT / 'models/confirmation-plan.json'
    assert result['planSha256'] == sha(plan_path.read_bytes()), 'Confirmation plan hash mismatch'
    mean, trees = result['meanFoldMetrics'], result['treesMeanFoldMetrics']
    baseline = evaluation['treesBaseline']['meanFoldMetrics']['macroF1']
    expected = {
        'macroF1': mean['macroF1'] >= 0.8,
        'moverRecallSnr10': mean['moverRecallSnr10'] >= 0.85,
        'artifactPrecision': mean['artifactPrecision'] >= 0.85,
        'beatsTreesOnSameTestStamps': mean['macroF1'] >= trees['macroF1'] + 0.01,
        'beatsOriginalTrees': mean['macroF1'] >= baseline + 0.01,
    }
    assert result['checks'] == expected, 'Confirmation checks disagree with the fresh metrics'
    assert result['passed'] == all(expected.values()), 'Confirmation passed flag disagrees with its checks'
    assert result['passed'] is True, 'Confirmation failed its frozen-plan gates'


def check():
    folder = ROOT / 'models'
    eval_raw = (folder / 'change-classifier.eval.json').read_bytes()
    evaluation = json.loads(eval_raw)
    check_confirmation(evaluation, sha(eval_raw))
    attempt = evaluation['cnnAttempt']
    shipped = (ROOT / 'public/models/change-classifier.json').read_bytes()
    trees = (folder / 'change-classifier-trees.json').read_bytes()
    cnn = (folder / 'change-classifier-cnn.json').read_bytes()
    assert sha(trees) == evaluation['treesBaseline']['modelSha256']
    assert sha(cnn) == attempt['modelSha256']
    assert len(cnn) == attempt['modelBytes']
    assert attempt['determinism']['passed']
    assert attempt['determinism']['hashes'] == [sha(cnn), sha(cnn)]
    assert len(attempt['folds']) == 5
    assert attempt['training']['cpuThreads'] == 1
    assert attempt['elapsedSeconds'] < 1200, 'CNN attempt exceeded the 20-minute CPU budget'
    mean = mean_metrics(attempt['folds'])
    for key in KEYS:
        assert abs(mean[key] - attempt['meanFoldMetrics'][key]) < 1e-12
    for fold in attempt['folds']:
        assert fold['testTarget'] not in fold['trainTargets']
        assert fold['validationTargets'] == fold['trainTargets']
        assert fold['heldOutEvaluations'] == 1
        assert fold['optimizerCount'] + fold['validationCount'] == fold['trainCount']
        assert fold['bestValidationMacroF1'] == max(e['validationMacroF1'] for e in fold['history'])
        assert fold['history'][fold['bestEpoch'] - 1]['validationMacroF1'] == fold['bestValidationMacroF1']
    checks = attempt['gate']['checks']
    assert checks['macroF1'] == (mean['macroF1'] >= 0.8)
    assert checks['moverRecallSnr10'] == (mean['moverRecallSnr10'] >= 0.85)
    assert checks['artifactPrecision'] == (mean['artifactPrecision'] >= 0.85)
    assert checks['size'] == (len(cnn) <= 200_000)
    assert checks['beatsOriginalTrees'] == (mean['macroF1'] >= evaluation['treesBaseline']['meanFoldMetrics']['macroF1'] + 0.01)
    assert checks['beatsTreesOnSameTestStamps'] == (mean['macroF1'] >= attempt['sameTestTrees']['meanFoldMetrics']['macroF1'] + 0.01)
    assert attempt['gate']['passed'] == all(checks.values())
    assert sha(shipped) == evaluation['modelSha256']
    assert len(shipped) <= 200_000 and evaluation['gate']['passed']
    card = (ROOT / 'public/models/change-classifier.card.json').read_bytes()
    assert len(card) < 2048, 'Model card exceeds the 2048-byte budget'
    assert json.loads(card) == model_card(evaluation, sha((folder / 'change-classifier.eval.json').read_bytes()))
    for raw in (shipped, trees, cnn):
        maximum = json.loads(raw)['training']['peakSnrMax']
        assert np.isfinite(maximum) and maximum >= 2.5
    if attempt['gate']['passed']:
        assert sha(shipped) == sha(cnn)
        assert attempt['meanFoldMetrics']['macroF1'] >= evaluation['treesBaseline']['meanFoldMetrics']['macroF1'] + 0.01
    else:
        assert sha(shipped) == evaluation['treesBaseline']['modelSha256']
    print('CNN attempt gate passed: honest model selection, hashes, target isolation, size, determinism')
    return 0


def main(args):
    if (ROOT / 'models/change-classifier.confirm.json').exists():
        raise SystemExit('Training refused: a frozen confirmation result exists; do not overwrite its evaluation or model')
    started = time.monotonic()
    revision, dirty = git_state(('public/models/change-classifier.json',
                                 'public/models/change-classifier.card.json',
                                 'models/change-classifier.eval.json',
                                 'models/change-classifier-cnn.json',
                                 'models/change-classifier-trees.json',
                                 'tests/fixtures/classify-parity.json'))
    folder = ROOT / 'models'
    public = ROOT / 'public/models'
    tree_path = folder / 'change-classifier-trees.json'
    previous = json.loads((folder / 'change-classifier.eval.json').read_text())
    baseline = previous.get('treesBaseline', previous)
    tree_raw = (tree_path if 'treesBaseline' in previous else public / 'change-classifier.json').read_bytes()
    if sha(tree_raw) != baseline['modelSha256']:
        raise ValueError('Tree model does not match the recorded baseline hash')
    tree_json = json.loads(tree_raw)
    # The original data order must be regenerated with the original sample count.
    tx, ty, tt, tsnr, _ = dataset(seed=tree_json['seed'], per_class=600)
    tfx = all_features(tx)
    x, y, targets, snrs, provenance = dataset(seed=args.seed, per_class=args.per_class)
    peak_snrs = np.max(np.abs(x[:, 2]), axis=(1, 2))
    peak_snr_max = float(np.max(peak_snrs))
    fx = all_features(x)
    np.testing.assert_allclose(fx[:20], [features(stamp) for stamp in x[:20]], atol=1e-9)
    names = sorted(set(targets.tolist()))
    counts = {target: {name: int(((targets == target) & (y == i)).sum()) for i, name in enumerate(CLASSES)}
              for target in names}
    folds, tree_folds, baseline_folds = [], [], []
    predictions = np.zeros(len(y), dtype=int)
    for i, target in enumerate(names):
        train_targets = [n for n in names if n != target]
        train, val = partition(y, targets, train_targets, args.seed + i)
        test = targets == target
        print(f'Hold out {target}: optimize {len(train)}, validate {len(val)}, test {int(test.sum())}', flush=True)
        model, history = fit(x, y, fx, train, val, args, args.seed + i)
        # Serialize BEFORE seeing the held-out target; evaluate exactly once.
        exported = export_cnn(model, tree_json, counts, args, history['bestEpoch'], float(np.max(peak_snrs[train])))
        prediction = probabilities(from_export(exported), x[test], fx[test]).argmax(1)
        predictions[test] = prediction
        fold = {'testTarget': target, 'trainTargets': train_targets, 'validationTargets': train_targets,
                'trainCount': len(train) + len(val), 'optimizerCount': len(train), 'validationCount': len(val),
                'testCount': int(test.sum()), 'heldOutEvaluations': 1, **history,
                **metrics(y[test], prediction, snrs[test])}
        folds.append(fold)
        trees = train_trees(tfx[tt != target], ty[tt != target], tree_json['training']['rounds'])
        tree_prediction = tree_probabilities(trees, fx[test]).argmax(1)
        tree_folds.append({'testTarget': target, 'trainTargets': train_targets,
                           'trainCount': int((tt != target).sum()), 'testCount': int(test.sum()),
                           **metrics(y[test], tree_prediction, snrs[test])})
        original = tt == target
        baseline_folds.append({'testTarget': target, **metrics(ty[original],
            tree_probabilities(trees, tfx[original]).argmax(1), tsnr[original])})
        print(f"{target}: CNN F1={fold['macroF1']:.4f}; trees F1={tree_folds[-1]['macroF1']:.4f}", flush=True)
    # Check the reproduced tree folds against the stored round-one evaluation.
    for reproduced, original in zip(baseline_folds, baseline['folds']):
        assert reproduced['testTarget'] == original['testTarget']
        for key in KEYS:
            assert abs(reproduced[key] - original[key]) < 1e-12
    epochs = int(np.median([fold['bestEpoch'] for fold in folds]))
    print(f'Final fit: {epochs} epochs chosen from training-only fold validation', flush=True)
    model, _ = fit(x, y, fx, np.arange(len(y)), None, args, args.seed, epochs)
    exported = export_cnn(model, tree_json, counts, args, epochs, peak_snr_max)
    raw = encode(exported)
    hashes = [sha(raw)]
    if args.verify_determinism:
        print('Repeat final fit from the same seed to verify exact exported hash', flush=True)
        repeated, _ = fit(x, y, fx, np.arange(len(y)), None, args, args.seed, epochs)
        repeated_raw = encode(export_cnn(repeated, tree_json, counts, args, epochs, peak_snr_max))
        hashes.append(sha(repeated_raw))
        assert repeated_raw == raw, 'Non-deterministic CNN export'
    mean, tree_mean = mean_metrics(folds), mean_metrics(tree_folds)
    thresholds = {'macroF1': 0.8, 'moverRecallSnr10': 0.85, 'artifactPrecision': 0.85,
                  'maxBytes': 200_000, 'minimumImprovement': 0.01,
                  'baselineMacroF1': baseline['meanFoldMetrics']['macroF1']}
    checks = {'macroF1': mean['macroF1'] >= 0.8, 'moverRecallSnr10': mean['moverRecallSnr10'] >= 0.85,
              'artifactPrecision': mean['artifactPrecision'] >= 0.85, 'size': len(raw) <= 200_000,
              'beatsOriginalTrees': mean['macroF1'] >= thresholds['baselineMacroF1'] + 0.01,
              'beatsTreesOnSameTestStamps': mean['macroF1'] >= tree_mean['macroF1'] + 0.01,
              'determinism': len(hashes) == 2 and hashes[0] == hashes[1]}
    passed = all(checks.values())
    attempt = {'architecture': ARCHITECTURE, 'seed': args.seed, 'folds': folds, 'meanFoldMetrics': mean,
               'training': {'perTargetPerClass': args.per_class, 'totalStamps': len(y), 'maximumEpochs': args.epochs,
                            'finalEpochs': epochs, 'cpuThreads': 1, 'counts': counts, 'peakSnrMax': peak_snr_max},
               'validation': '15% per class per training target for epoch selection; '
                             'final epoch count is the median validation best epoch.',
               'augmentation': 'Training only, independent rotations/flips and common +/-0.3 px XY shifts; '
                               'twelve features recomputed from the augmented stamp.',
               'runtimeChoice': f'12/16/16 channels and {args.epochs} epoch cap; retain all stamps on one CPU thread',
               'modelBytes': len(raw), 'modelSha256': sha(raw), 'elapsedSeconds': time.monotonic() - started,
               'determinism': {'passed': checks['determinism'], 'hashes': hashes, 'scope': 'two independent final fits'},
               'gate': {'passed': passed, 'checks': checks, 'thresholds': thresholds},
               'sameTestTrees': {'folds': tree_folds, 'meanFoldMetrics': tree_mean,
                                 'training': 'Reproduced original 600/class/target, 220-round tree folds',
                                 'note': TREES_NOTE},
               'psfMeasurements': provenance['psfMeasurements'], 'skippedFrames': provenance['skippedFrames'],
               **metrics(y, predictions, snrs)}
    # Write only after all training/evaluation succeeds; preserve exact tree bytes.
    tree_path.write_bytes(tree_raw)
    (folder / 'change-classifier-cnn.json').write_bytes(raw)
    shipped_raw = raw if passed else tree_raw
    (public / 'change-classifier.json').write_bytes(shipped_raw)
    summary = {**baseline, 'madeBy': 'scripts/ml_train_cnn.py', 'madeAt': datetime.now(timezone.utc).isoformat(),
               'gitSha': revision, 'gitDirty': dirty, 'seed': args.seed, 'elapsedSeconds': attempt['elapsedSeconds'],
               'treesBaseline': baseline, 'cnnAttempt': attempt,
               'selectionReason': ('CNN passed quality, size, determinism and +0.01 F1 over trees'
                                   if passed else 'Trees retained: CNN failed ' + ', '.join(k for k, v in checks.items() if not v)),
               'modelSha256': sha(shipped_raw), 'modelBytes': len(shipped_raw)}
    if passed:
        summary.update({'modelFamily': ARCHITECTURE, 'folds': folds, 'meanFoldMetrics': mean,
                        'training': attempt['training'], 'gate': attempt['gate'],
                        'configurationSelection': 'Development validation, not an untouched benchmark: the CNN was '
                                                  'chosen over gradient-boosted trees on these same held-out folds, '
                                                  'and an earlier smaller CNN and a 20-epoch run (artifact '
                                                  'precision 0.839) were dropped on them.',
                        'worstFold': min(folds, key=lambda fold: fold['macroF1'])['testTarget'],
                        **metrics(y, predictions, snrs)})
    summary['comparison'] = [{'testTarget': f['testTarget'], 'cnn': {k: f[k] for k in KEYS},
                              'trees': {k: t[k] for k in KEYS},
                              'roundOneTrees': {k: old[k] for k in KEYS}}
                             for f, t, old in zip(folds, tree_folds, baseline['folds'])]
    summary['comparisonNote'] = TREES_NOTE
    summary['worstFoldGate'] = {
        key: [{'target': fold['testTarget'], 'value': fold[key]} for fold in summary['folds']
              if fold[key] < threshold]
        for key, threshold in (('moverRecallSnr10', 0.85), ('artifactPrecision', 0.85), ('macroF1', 0.80))
    }
    eval_path = folder / 'change-classifier.eval.json'
    write_json(eval_path, summary)
    card = model_card(summary, sha(eval_path.read_bytes()))
    assert len(encode(card)) < 2048, 'Model card exceeds the 2048-byte budget'
    write_json(public / 'change-classifier.card.json', card)
    selected = [int(np.flatnonzero((targets == target) & (y == kind) & (peak_snrs >= 2.5))[0])
                for target in names for kind in range(4)]
    cnn_probs = probabilities(from_export(exported), x[selected], fx[selected])
    tree_probs = tree_probabilities(tree_json['trees'], fx[selected])
    cases = lambda probs: [{'stamp': x[index].flatten().tolist(), 'probabilities': probs[j].tolist(),
                            'truth': CLASSES[y[index]], **provenance['examples'][index]}
                           for j, index in enumerate(selected)]
    write_json(ROOT / 'tests/fixtures/classify-parity.json', {
        'seed': args.seed, 'modelSha256': sha(shipped_raw), 'treeModelSha256': sha(tree_raw),
        'cnnModelSha256': sha(raw), 'reference': 'PyTorch CPU; exported rounded, BN-folded weights',
        'cases': cases(cnn_probs if passed else tree_probs),
        'treeCases': cases(tree_probs), 'cnnCases': cases(cnn_probs)})
    print(json.dumps({'cnn': mean, 'treesSameTest': tree_mean, 'cnnShips': passed,
                      'failed': [k for k, v in checks.items() if not v], 'sha256': sha(raw),
                      'seconds': attempt['elapsedSeconds']}), flush=True)
    return check() if args.verify_determinism else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=int, default=20261114)
    parser.add_argument('--per-class', type=int, default=2500)
    parser.add_argument('--epochs', type=int, default=30)  # 20 stopped short: best epoch 18-20 in every fold
    parser.add_argument('--batch-size', type=int, default=256)
    parser.add_argument('--verify-determinism', action='store_true')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--write-card', action='store_true', help='rebuild only the public card from existing eval/retest evidence')
    mode.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.per_class < 8 or not 1 <= args.epochs <= 30 or not 8 <= args.batch_size <= 1024:
        parser.error('Need >=8 stamps/class, 1-30 epochs and batch size 8-1024')
    if args.write_card:
        raise SystemExit(write_card())
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(args.seed)
    if args.self_test:
        self_test()
    else:
        raise SystemExit(check() if args.check else main(args))
