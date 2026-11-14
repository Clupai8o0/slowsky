"""Bake public/comet/3i-atlas.json: small comet-centred cut-outs of 3I/ATLAS from twelve SPHEREx DR1 frames.

Asks IRSA's Moving Object Search Tool (MOST) which SPHEREx frames hold the comet on 14 Dec 2025 and where it
should be at each exposure start, then reads by HTTP range only the IMAGE rows, headers and WCS-WAVE table it
needs from the public S3 bucket. Nothing is subtracted from the image; the border median is stored apart.

Run: python3 scripts/bake_comet.py  (needs astropy, numpy, requests; no JPL calls)
"""
import io
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
import requests
from astropy.io import ascii, fits
from astropy.wcs import WCS

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'comet' / '3i-atlas.json'
MOST = 'https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most'
PARAMS = {'catalog': 'spherex', 'input_type': 'name_input', 'obj_name': '3I', 'obj_type': 'Comet',
          'obs_begin': '2025 12 13', 'obs_end': '2025 12 16', 'output_mode': 'Brief'}
DAY = '2025-12-14'
DETECTOR = 5
# The three back-to-back visits on 14 Dec whose four exposures each step through the CO2 band on detector 5.
# (MOST also lists a lone 0827_1 D5 exposure that evening; it is a different pointing and is left out.)
VISITS = ('2025W50_2A_0685', '2025W50_2A_0698', '2025W50_2A_0712')
HALF = 20  # 41 x 41 cut-out
BORDER = 5
CAP = 80_000_000
HOSTS = ('nasa-irsa-spherex.s3.us-east-1.amazonaws.com', 'nasa-irsa-spherex.s3.amazonaws.com')

read_bytes = 0


def get_range(key, start, length):
    global read_bytes
    read_bytes += length
    if read_bytes > CAP:
        raise RuntimeError(f'byte cap reached: {read_bytes}')
    for attempt in range(6):
        try:
            r = requests.get(f'https://{HOSTS[attempt % 2]}/{key}', headers={'Range': f'bytes={start}-{start + length - 1}'},
                             timeout=(15, 60), stream=True)
            try:
                if r.status_code != 206:
                    raise RuntimeError(f'bad range response: {r.status_code}')
                body = r.raw.read(length + 1, decode_content=False)
            finally:
                r.close()
            if len(body) != length:
                raise RuntimeError(f'bad range length {len(body)} != {length}')
            return body
        except Exception:
            if attempt == 5:
                raise
            time.sleep(2 ** attempt)


def index(key):
    """Header, data start and data size of each HDU, reading only header blocks."""
    offset = 0
    out = {}
    for _ in range(7):
        blocks = bytearray()
        while True:
            block = get_range(key, offset + len(blocks), 2880)
            blocks.extend(block)
            if any(block[i:i + 8] == b'END     ' for i in range(0, 2880, 80)):
                break
        header = fits.Header.fromstring(blocks.decode('ascii'), sep='')
        start = offset + len(blocks)
        naxis = int(header.get('NAXIS', 0))
        size = 0 if naxis == 0 else abs(int(header['BITPIX'])) // 8
        for i in range(1, naxis + 1):
            size *= int(header[f'NAXIS{i}'])
        size = (size + int(header.get('PCOUNT', 0))) * int(header.get('GCOUNT', 1))
        out[header.get('EXTNAME', 'PRIMARY')] = (header, start, size)
        offset = start + ((size + 2879) // 2880) * 2880
        if 'WCS-WAVE' in out:
            break
    return out


def wave_grid(key, hdu):
    header, start, size = hdu
    raw = header.tostring().encode('ascii') + get_range(key, start, size) + b'\0' * ((-size) % 2880)
    primary = fits.PrimaryHDU().header.tostring().encode('ascii')
    with fits.open(io.BytesIO(primary + raw)) as f:
        entry = f[1].data[0]
        xs = np.asarray(entry['X'], dtype=float) - 1
        ys = np.asarray(entry['Y'], dtype=float) - 1
        values = np.asarray(entry['VALUES']).reshape(len(ys), len(xs), 2)
    return xs, ys, values[:, :, 0]


def bilinear(xs, ys, grid, x, y):
    ix = int(np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2))
    iy = int(np.clip(np.searchsorted(ys, y) - 1, 0, len(ys) - 2))
    fx = float(np.clip((x - xs[ix]) / (xs[ix + 1] - xs[ix]), 0, 1))
    fy = float(np.clip((y - ys[iy]) / (ys[iy + 1] - ys[iy]), 0, 1))
    top = grid[iy, ix] * (1 - fx) + grid[iy, ix + 1] * fx
    bot = grid[iy + 1, ix] * (1 - fx) + grid[iy + 1, ix + 1] * fx
    return float(top * (1 - fy) + bot * fy)


def sig4(v):
    v = float(v)
    if not math.isfinite(v):
        return None
    return float(f'{v:.4g}')


def most_rows():
    url = MOST + '?' + urlencode(PARAMS)
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    table = ascii.read(r.text, format='ipac')
    rows = []
    for row in table:
        uri = str(row['uri'])
        obs = str(row['observationid'])
        if not str(row['start_date']).startswith(DAY) or f'/{DETECTOR}/' not in uri or not uri.endswith(f'D{DETECTOR}_spx_l2b-v27-2026-210.fits'):
            continue
        if obs.rsplit('_', 1)[0] not in VISITS:
            continue
        # MOST gives IRSA's own path (ibe/data/spherex/<release>/...); the S3 key is the part after that prefix.
        prefix = 'ibe/data/spherex/'
        if not uri.startswith(prefix):
            raise RuntimeError(f'unexpected MOST path: {uri}')
        key = uri[len(prefix):]
        if not key.startswith('dr1/'):
            raise RuntimeError(f'refusing non-DR1 path: {key}')
        rows.append({'obs': obs, 'key': key, 'start': str(row['start_date']), 'mjd': float(row['mjd_start']),
                     'ra': float(row['ra_obj']), 'dec': float(row['dec_obj']), 'uri': uri})
    name = ''
    for line in r.text.splitlines():
        if line.startswith('\\object_name'):
            name = line.split('=', 1)[1].strip().strip('"')
    return url, name, rows


def main():
    url, name, rows = most_rows()
    print('MOST object:', name, '| frames:', len(rows), file=sys.stderr)
    if len(rows) != 12:
        raise RuntimeError(f'expected 12 frames, got {len(rows)}')
    frames = []
    for row in rows:
        hdus = index(row['key'])
        header, start, _ = hdus['IMAGE']
        if header.get('BUNIT', '').replace(' ', '') != 'MJy/sr':
            raise RuntimeError(f"unexpected unit {header.get('BUNIT')}")
        width, height = int(header['NAXIS1']), int(header['NAXIS2'])
        x, y = WCS(header).all_world2pix([[row['ra'], row['dec']]], 0)[0]
        cx, cy = int(round(x)), int(round(y))
        if not (HALF <= cx < width - HALF and HALF <= cy < height - HALF):
            raise RuntimeError(f"{row['obs']}: comet too near the edge ({x:.1f}, {y:.1f})")
        y0 = cy - HALF
        rows_bytes = get_range(row['key'], start + y0 * width * 4, (2 * HALF + 1) * width * 4)
        block = np.frombuffer(rows_bytes, dtype='>f4').reshape(2 * HALF + 1, width)
        cut = block[:, cx - HALF:cx + HALF + 1].astype(np.float64)
        core = cut[HALF - 1:HALF + 2, HALF - 1:HALF + 2]
        if np.isnan(core).any():
            raise RuntimeError(f"{row['obs']}: blank pixel in the 3x3 core")
        ring = np.concatenate([cut[:BORDER].ravel(), cut[-BORDER:].ravel(), cut[BORDER:-BORDER, :BORDER].ravel(), cut[BORDER:-BORDER, -BORDER:].ravel()])
        xs, ys, lam = wave_grid(row['key'], hdus['WCS-WAVE'])
        wave = bilinear(xs, ys, lam, x, y)
        frames.append({
            'obsId': row['obs'] + f'D{DETECTOR}',
            'start': row['start'].replace(' ', 'T') + 'Z',
            'mjdStart': row['mjd'],
            'wavelength': round(wave, 4),
            'ra': row['ra'], 'dec': row['dec'],
            'pixel': {'x': round(float(x), 2), 'y': round(float(y), 2)},
            'cutoutOrigin': {'x': cx - HALF, 'y': y0},
            'key': row['key'],
            'coreMean': sig4(np.nanmean(core)),
            'borderMedian': sig4(np.nanmedian(ring)),
            'cutout': [sig4(v) for v in cut.ravel()],
        })
        print(f"{row['obs']} {wave:.4f} um core {np.nanmean(core):.4g} sky {np.nanmedian(ring):.4g} bytes {read_bytes}", file=sys.stderr)
    frames.sort(key=lambda f: f['wavelength'])
    doc = {
        'object': '3I/ATLAS',
        'mostObjectName': name,
        'detector': DETECTOR,
        'size': 2 * HALF + 1,
        'units': 'MJy/sr',
        'core': '3x3 pixel mean at the predicted position',
        'border': f'median of the outer {BORDER} pixels of the cut-out',
        'mostQuery': url,
        'madeBy': 'scripts/bake_comet.py',
        'madeAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'note': 'Made by AI-written code (Claude) during NASA Space Apps 2026. Values are raw L2 IMAGE pixels, not calibrated photometry.',
        'bytesRead': read_bytes,
        'frames': frames,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, separators=(',', ':'))
    if len(text) > 400_000:
        raise RuntimeError(f'JSON too big: {len(text)}')
    OUT.write_text(text + '\n')
    print(f'wrote {OUT} ({len(text)} bytes), read {read_bytes} bytes', file=sys.stderr)


if __name__ == '__main__':
    main()
