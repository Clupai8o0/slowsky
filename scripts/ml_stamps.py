"""Offline synthetic changes on baked IMAGE-ZODI pixels; no downloads or labels.

S/N means peak injected difference / local native-pixel difference MAD sigma,
the peak convention used by the change finder. Positions are zero-based.
"""

from dataclasses import dataclass
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CLASSES = ['mover', 'brightness', 'artifact', 'nothing']
SIZE = 15
NATIVE = 6.15
# Common stand-in for the change finder's centroid error, in native pixels.
CENTRE_JITTER_SIGMA = 0.3
ALLOWED = {'spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3', 'spherex_qr3_deep'}


@dataclass
class Frame:
    target: str
    obs_id: str
    image: np.ndarray
    variance: np.ndarray
    stars: list
    fwhm: float
    digest: str


def robust_sigma(diff):
    # changes.ts: median of tile MADs, falling back to the global MAD.
    values = diff[np.isfinite(diff)]
    fallback = 1.4826 * np.median(np.abs(values - np.median(values)))
    sigmas = []
    for y in range(0, diff.shape[0], 10):
        for x in range(0, diff.shape[1], 10):
            tile = diff[y:y + 10, x:x + 10]
            tile = tile[np.isfinite(tile)]
            value = 1.4826 * np.median(np.abs(tile - np.median(tile))) if tile.size >= 12 else fallback
            sigmas.append(value if value > 0 else fallback)
    return float(np.median(sigmas))


def bilinear(image, x, y):
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    return ((1 - fy) * ((1 - fx) * image[y0, x0] + fx * image[y0, x0 + 1])
            + fy * ((1 - fx) * image[y0 + 1, x0] + fx * image[y0 + 1, x0 + 1]))


def measured_stars(image, variance):
    """Isolated local maxima, background-subtracted second-moment PSF widths.

    Reject nonfinite patches, flat/nonstellar peaks and extreme (>500 sigma)
    peaks as an unsaturated-star screen; no external catalogue is consulted.
    """
    stars = []
    yy, xx = np.mgrid[-4:5, -4:5]
    radius = xx * xx + yy * yy
    for y in range(24, image.shape[0] - 24):
        for x in range(24, image.shape[1] - 24):
            patch = image[y - 4:y + 5, x - 4:x + 5]
            var = variance[y - 4:y + 5, x - 4:x + 5]
            if not np.isfinite(patch).all() or not np.isfinite(var).all() or np.min(var) <= 0:
                continue
            peak = image[y, x]
            if peak != np.max(patch) or np.sum(patch == peak) != 1:
                continue
            background = np.median(patch[radius >= 12])
            amplitude = float(peak - background)
            noise = float(np.sqrt(variance[y, x]))
            if not 10 <= amplitude / noise <= 500:
                continue
            flux = np.maximum(patch - background - 2 * noise, 0) * (radius <= 9)
            total = np.sum(flux)
            if total <= 0:
                continue
            mx, my = np.sum(flux * xx) / total, np.sum(flux * yy) / total
            sx = np.sum(flux * (xx - mx) ** 2) / total
            sy = np.sum(flux * (yy - my) ** 2) / total
            fwhm = 2.354820045 * np.sqrt((sx + sy) / 2)
            if not 1.2 <= fwhm <= 4.5 or min(sx, sy) <= 0 or max(sx, sy) / min(sx, sy) > 2:
                continue
            stars.append({'x': x, 'y': y, 'peak': amplitude, 'fwhm': float(fwhm),
                          'snr': amplitude / (np.sqrt(2) * noise)})
    return stars


def read_frames(snapshot):
    frames, skipped = [], []
    indexes = sorted(snapshot.glob('*/index.json'))
    if len(indexes) != 5:
        raise ValueError('Expected the five baked snapshot targets')
    for path in indexes:
        index = json.loads(path.read_text())
        for entry in index['frames']:
            record = entry['record']
            if record['collection'] not in ALLOWED or record['release'] not in ('dr1', 'qr3'):
                raise ValueError('Only SPHEREx DR1 / QR3 may be used')
            if entry['planes'] != ['IMAGE', 'ZODI', 'VARIANCE']:
                raise ValueError('Unexpected snapshot plane order')
            box = entry['box']
            shape = (3, box['y1'] - box['y0'], box['x1'] - box['x0'])
            file = (path.parent / entry['file']).resolve()
            if file.parent != path.parent.resolve() or file.suffix != '.f32':
                raise ValueError('Snapshot file must be a local .f32 plane file')
            raw = file.read_bytes()
            planes = np.frombuffer(raw, dtype='<f4').reshape(shape)
            image = (planes[0] - planes[1]).astype(np.float64)
            variance = planes[2].astype(np.float64)
            stars = measured_stars(image, variance)
            if not stars:
                skipped.append({'target': path.parent.name, 'obsId': record['obsId'],
                                'reason': 'No isolated unsaturated star for a frame-specific PSF'})
                continue
            frames.append(Frame(path.parent.name, record['obsId'], image, variance,
                                stars, float(np.median([s['fwhm'] for s in stars])),
                                hashlib.sha256(raw).hexdigest()))
    for target in (p.parent.name for p in indexes):
        if not any(f.target == target for f in frames):
            raise ValueError(f'No measured PSF for target {target}')
    return frames, skipped


def signal_centre(difference):
    """Local |difference| flux centroid around the candidate's strongest peak.

    Use the same radius-four candidate core for every class, keeping a mover's
    other epoch (up to 20 pixels away) from dragging its centre between peaks.
    An uninjected/static example has no signal: use its nominal candidate site.
    Coordinates here are zero-based array indices, unlike the injection grid.
    """
    yy, xx = np.indices(difference.shape)
    absolute = np.abs(difference)
    core = (xx - 22) ** 2 + (yy - 22) ** 2 <= 16
    py, px = np.unravel_index(np.argmax(np.where(core, absolute, -1)), absolute.shape)
    flux = absolute * ((xx - px) ** 2 + (yy - py) ** 2 <= 16)
    total = float(flux.sum())
    if total == 0:
        return np.array([22.0, 22.0])
    return np.array([float((flux * xx).sum() / total), float((flux * yy).sum() / total)])


def sample(frame, kind, rng, centres=None):
    # A 47-pixel region contains the 15-pixel stamp and a 20-pixel motion.
    if kind == 1 or (kind == 3 and rng.random() < 0.65):
        choices = [s for s in frame.stars if 4 <= s['snr'] <= 200]
        if not choices:
            return None
        star = choices[int(rng.integers(len(choices)))]
        cx, cy = star['x'], star['y']
    else:
        cx = int(rng.integers(24, frame.image.shape[1] - 24))
        cy = int(rng.integers(24, frame.image.shape[0] - 24))
    sky = frame.image[cy - 23:cy + 24, cx - 23:cx + 24]
    var = frame.variance[cy - 23:cy + 24, cx - 23:cx + 24]
    if not np.isfinite(sky).all() or not np.isfinite(var).all() or np.min(var) <= 0:
        return None
    a = sky + rng.normal(size=sky.shape) * np.sqrt(var)
    noisy_later = sky + rng.normal(size=sky.shape) * np.sqrt(var)
    yy, xx = np.mgrid[1:46, 1:46].astype(float)
    angle, shift = rng.uniform(0, 2 * np.pi), rng.uniform(0, 0.3)
    dx, dy = shift * np.cos(angle), shift * np.sin(angle)
    a = a[1:46, 1:46]
    b = bilinear(noisy_later, xx + dx, yy + dy)
    sigma = robust_sigma(b - a)
    if not np.isfinite(sigma) or sigma <= 0:
        return None
    # Continuous source positions; detector hits below stay on native pixels.
    px, py = 23 + rng.uniform(-0.45, 0.45), 23 + rng.uniform(-0.45, 0.45)
    # Sample an actual width measured in this frame, retaining spatial PSF
    # variation that would be lost by using only one median width per frame.
    psf_sigma = frame.stars[int(rng.integers(len(frame.stars)))]['fwhm'] / 2.354820045

    def point(x, y):
        return np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * psf_sigma ** 2))

    snr = float(rng.uniform(3, 30))
    delta_a, delta_b = np.zeros_like(a), np.zeros_like(b)
    subtype = 'noise-or-static-star'
    if kind == 0:
        if rng.random() < 0.3:
            delta_b = point(px, py)
            subtype = 'one-epoch'
        else:
            distance, theta = rng.uniform(1, 20), rng.uniform(0, 2 * np.pi)
            delta_a = point(px + distance * np.cos(theta), py + distance * np.sin(theta))
            delta_b = point(px, py)
            subtype = 'moving-1-to-20px'
    elif kind == 1:
        # Scale the actual observed star above its local background; no fake PSF.
        local = frame.image[cy - 4:cy + 5, cx - 4:cx + 5]
        sy, sx = np.mgrid[-4:5, -4:5]
        background = np.median(local[sx * sx + sy * sy >= 12])
        source = np.maximum(sky - background, 0)[1:46, 1:46]
        source *= ((xx - 23) ** 2 + (yy - 23) ** 2 <= 16)
        lo = max(3, 0.15 * float(np.max(source)) / sigma)
        hi = min(30, float(np.max(source)) / sigma)
        if lo >= hi:
            return None
        snr = float(rng.uniform(lo, hi))
        fraction = snr * sigma / float(np.max(source))
        if rng.random() < 0.5 and fraction <= 0.5:
            fraction = -fraction
        delta_b = source * fraction
        subtype = f'real-star-scaled-{1 + fraction:.4f}'
    elif kind == 2:
        variant = int(rng.integers(3))
        if variant == 0:
            delta_b[22, 22] = 1
            subtype = 'hot-pixel'
        elif variant == 1:
            delta_b[22:24, 22:24] = rng.uniform(0.7, 1, (2, 2))
            subtype = '2x2-cosmic-ray'
        else:
            length, theta = rng.uniform(5, 40), rng.uniform(0, 2 * np.pi)
            along = (xx - px) * np.cos(theta) + (yy - py) * np.sin(theta)
            across = -(xx - px) * np.sin(theta) + (yy - py) * np.cos(theta)
            delta_b = np.exp(-0.5 * (across / rng.uniform(0.25, 0.65)) ** 2) * (np.abs(along) <= length / 2)
            subtype = 'streak-5-to-40px'
    if kind in (0, 2):
        amplitude = snr * sigma / np.max(np.abs(delta_b - delta_a))
        delta_a *= amplitude
        delta_b *= amplitude
    swap_epochs = rng.random() < 0.5
    # Preserve the requested 0.5-0.85 / 1.15-2 brightness ratios: reversing a
    # 1.15 brightening would turn it into a 0.87 fade, outside those ranges.
    if swap_epochs and kind != 1:
        a, b, delta_a, delta_b = b, a, delta_b, delta_a
    a, b = a + delta_a, b + delta_b
    sigma = robust_sigma(b - a)
    if kind != 3:
        snr = float(np.max(np.abs(delta_b - delta_a)) / sigma)
    else:
        snr = 0.0
    centre = signal_centre(delta_b - delta_a)
    extraction = centre + rng.normal(0, CENTRE_JITTER_SIGMA, 2)
    if centres is not None:
        centres.append(extraction - centre)
    # Same bilinear native stamp extraction as stampFor, CHW / MAD sigma.
    sy, sx = np.mgrid[-7:8, -7:8].astype(float)
    sa = bilinear(a, extraction[0] + sx, extraction[1] + sy)
    sb = bilinear(b, extraction[0] + sx, extraction[1] + sy)
    stamp = np.stack((sa / sigma, sb / sigma, (sb - sa) / sigma)).astype(np.float32)
    stamp = np.rot90(stamp, int(rng.integers(4)), axes=(1, 2))
    if rng.random() < 0.5:
        stamp = stamp[:, :, ::-1]
    return stamp.copy(), snr, subtype


def check_centres(seed=20261114, per_class=240):
    """Manual diagnostic only; never called by either training script."""
    frames, _ = read_frames(ROOT / 'public/snapshot')
    rng = np.random.default_rng(seed)
    means, spreads = [], []
    count = per_class * len({frame.target for frame in frames})
    for kind, name in enumerate(CLASSES):
        offsets = []
        attempts = 0
        while len(offsets) < count:
            attempts += 1
            if attempts > count * 200:
                raise RuntimeError(f'Cannot check centres for {name}')
            sample(frames[int(rng.integers(len(frames)))], kind, rng, offsets)
        offsets = np.array(offsets)
        mean, spread = offsets.mean(0), offsets.std(0, ddof=1)
        means.append(mean)
        spreads.append(spread)
        print(f'{name}: n={count} offset mean=({mean[0]:+.4f}, {mean[1]:+.4f}) px; '
              f'spread=({spread[0]:.4f}, {spread[1]:.4f}) px', flush=True)
    # Five standard errors allow ordinary seeded sampling noise, while the old
    # dead-centre hot pixels and fixed half-pixel hits fail the spread check.
    mean_error = CENTRE_JITTER_SIGMA / np.sqrt(count)
    spread_error = CENTRE_JITTER_SIGMA / np.sqrt(2 * (count - 1))
    assert np.max(np.abs(means)) < 5 * mean_error, 'Class centring bias'
    assert np.max(np.abs(np.array(spreads) - CENTRE_JITTER_SIGMA)) < 5 * spread_error, 'Class jitter mismatch'
    assert np.max(np.ptp(means, axis=0)) < 5 * np.sqrt(2) * mean_error, 'Class means differ'
    assert np.max(np.ptp(spreads, axis=0)) < 5 * np.sqrt(2) * spread_error, 'Class spreads differ'


def dataset(snapshot=ROOT / 'public/snapshot', seed=20261114, per_class=240):
    frames, skipped = read_frames(snapshot)
    rng = np.random.default_rng(seed)
    stamps, labels, targets, snrs, provenance = [], [], [], [], []
    for target in sorted({f.target for f in frames}):
        pool = [f for f in frames if f.target == target]
        for kind in range(4):
            count, attempts = 0, 0
            while count < per_class:
                attempts += 1
                if attempts > per_class * 200:
                    raise RuntimeError(f'Cannot generate valid {CLASSES[kind]} examples for {target}')
                frame = pool[int(rng.integers(len(pool)))]
                result = sample(frame, kind, rng)
                if result is None:
                    continue
                stamp, snr, subtype = result
                stamps.append(stamp)
                labels.append(kind)
                targets.append(target)
                snrs.append(snr)
                provenance.append({'target': target, 'obsId': frame.obs_id, 'subtype': subtype})
                count += 1
        print(f'{target}: {4 * per_class} stamps, {len(pool)} measured frames', flush=True)
    psfs = [{'target': f.target, 'obsId': f.obs_id, 'fwhmNativePixels': f.fwhm,
             'stellarFwhmNativePixels': [s['fwhm'] for s in f.stars],
             'starCount': len(f.stars), 'sha256': f.digest} for f in frames]
    return (np.stack(stamps), np.array(labels), np.array(targets), np.array(snrs),
            {'psfMeasurements': psfs, 'skippedFrames': skipped, 'examples': provenance})


FEATURES = ['logPeak', 'logArea', 'elongation', 'residualSharpness',
            'peakDistance', 'dipoleBalance', 'dipoleDistance', 'epochFluxRatio',
            'fractionalResidual', 'nearestStarDistance', 'sourceSharpness', 'epochCorrelation']


def features(stamp):
    a, b, diff = stamp.astype(np.float64)
    a, b = a - np.median(a), b - np.median(b)
    yy, xx = np.mgrid[0:15, 0:15]
    core = (xx - 7) ** 2 + (yy - 7) ** 2 <= 16
    absolute = np.abs(diff)
    # Measure the candidate core, not an unrelated extreme star at the edge.
    flat = int(np.argmax(np.where(core, absolute, -1)))
    py, px = divmod(flat, 15)
    peak = float(absolute[py, px])
    region = (xx - px) ** 2 + (yy - py) ** 2 <= 25
    w = np.maximum(absolute - max(2, 0.15 * peak), 0) * region
    total = float(w.sum()) + 1e-12
    mx, my = float((w * xx).sum() / total), float((w * yy).sum() / total)
    vx, vy = float((w * (xx - mx) ** 2).sum() / total), float((w * (yy - my) ** 2).sum() / total)
    cov = float((w * (xx - mx) * (yy - my)).sum() / total)
    gap = np.sqrt(max(0, (vx - vy) ** 2 + 4 * cov * cov))
    elongation = (vx + vy + gap + 0.2) / (vx + vy - gap + 0.2)
    pos, neg = np.maximum(diff - 2, 0) * region, np.maximum(-diff - 2, 0) * region
    ps, ns = float(pos.sum()), float(neg.sum())
    pxc, pyc = float((pos * xx).sum() / (ps + 1e-12)), float((pos * yy).sum() / (ps + 1e-12))
    nxc, nyc = float((neg * xx).sum() / (ns + 1e-12)), float((neg * yy).sum() / (ns + 1e-12))
    balance = min(ps, ns) / (max(ps, ns) + 1e-12)
    sharp = (4 * absolute[py, px] - absolute[py - 1, px] - absolute[py + 1, px]
             - absolute[py, px - 1] - absolute[py, px + 1]) / (peak + 1)
    near = (xx - px) ** 2 + (yy - py) ** 2 <= 4
    fa, fb = max(0, float(a[near].sum())), max(0, float(b[near].sum()))
    ratio = min(fa, fb) / (max(fa, fb) + 1)
    fractional = peak / (max(abs(float(a[py, px])), abs(float(b[py, px]))) + 1)
    source = b if diff[py, px] >= 0 else a
    source_peak = max(1, abs(float(source[py, px])))
    source_sharp = (4 * source[py, px] - source[py - 1, px] - source[py + 1, px]
                    - source[py, px - 1] - source[py, px + 1]) / source_peak
    average = (a + b) / 2
    maxima = np.zeros((15, 15), dtype=bool)
    maxima[1:-1, 1:-1] = ((average[1:-1, 1:-1] > average[:-2, 1:-1])
                          & (average[1:-1, 1:-1] > average[2:, 1:-1])
                          & (average[1:-1, 1:-1] > average[1:-1, :-2])
                          & (average[1:-1, 1:-1] > average[1:-1, 2:])
                          & (average[1:-1, 1:-1] > max(3, peak * 0.2)))
    distance = float(np.sqrt(np.min(((xx - px) ** 2 + (yy - py) ** 2)[maxima]))) if maxima.any() else 15
    ac, bc = a[region], b[region]
    ac, bc = ac - ac.mean(), bc - bc.mean()
    correlation = float((ac * bc).sum() / np.sqrt((ac * ac).sum() * (bc * bc).sum() + 1e-12))
    return [float(np.log1p(peak)), float(np.log1p(total / (peak + 1))),
            float(np.log1p(elongation)), float(sharp), float(np.hypot(px - 7, py - 7)),
            balance, float(np.hypot(pxc - nxc, pyc - nyc) * balance), ratio,
            fractional, distance, float(source_sharp), correlation]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=int, default=20261114)
    parser.add_argument('--per-class', type=int, default=240)
    parser.add_argument('--check-centres', action='store_true')
    args = parser.parse_args()
    if args.per_class < 2:
        parser.error('Need at least two examples per class')
    if args.check_centres:
        check_centres(args.seed, args.per_class)
        raise SystemExit(0)
    x, y, target, snr, info = dataset(seed=args.seed, per_class=args.per_class)
    print(json.dumps({'shape': list(x.shape), 'classes': CLASSES,
                      'measuredFrames': len(info['psfMeasurements']),
                      'skippedFrames': len(info['skippedFrames'])}))
