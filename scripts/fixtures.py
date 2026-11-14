#!/usr/bin/env python3
"""Build compact reference fixtures using only HTTP byte ranges."""
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import requests
import numpy as np
import astropy
from astropy.io import fits
from astropy.io.votable import parse_single_table
from astropy.wcs import WCS

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'tests/fixtures/frame'
SESSION = requests.Session()
POINTS = [[0, 0], [2039, 0], [0, 2039], [2039, 2039], [1019.5, 0], [1019.5, 2039], [0, 1019.5], [2039, 1019.5], [1019.5, 1019.5]]

def dump(name, value):
    (OUT/name).write_text(json.dumps(value, indent=4, allow_nan=False) + '\n')

def fetch(url, start, length):
    response = SESSION.get(url, headers={'Range': f'bytes={start}-{start + length - 1}', 'Accept-Encoding': 'identity'}, timeout=90)
    if response.status_code != 206 or len(response.content) != length:
        raise RuntimeError(f'Bad range {url} {start}+{length}: {response.status_code}, {len(response.content)} bytes')
    print(f'Fetched {url}: bytes {start}-{start + length - 1}', flush=True)
    return response.content

def query(collection, ra, dec, save=False):
    response = SESSION.get('https://irsa.ipac.caltech.edu/SIA', params={'COLLECTION': collection, 'POS': f'CIRCLE {ra} {dec} 0.001', 'MAXREC': 50}, timeout=90)
    response.raise_for_status()
    if save:
        (OUT/'sia_rwaur.xml').write_bytes(response.content)
    table = parse_single_table(io.BytesIO(response.content)).to_table(use_names_over_ids=True)
    return [row for row in table if str(row['energy_bandpassname']) == 'SPHEREx-D1']

def index(url):
    hdus = []
    pos = 0
    while len(hdus) < 7:
        start = pos
        raw = b''
        while True:
            raw += fetch(url, start + len(raw), 2880)
            if any(raw[i:i+8] == b'END     ' for i in range(0, len(raw), 80)):
                break
        header = fits.Header.fromstring(raw.decode('ascii'), sep='')
        dims = int(header.get('NAXIS', 0))
        size = (abs(int(header['BITPIX'])) // 8 * int(np.prod([int(header[f'NAXIS{i}']) for i in range(1, dims + 1)])) if dims else 0)
        size = (size + int(header.get('PCOUNT', 0))) * int(header.get('GCOUNT', 1))
        data_start = start + len(raw)
        hdus.append(({'index': len(hdus), 'name': header.get('EXTNAME', 'PRIMARY'), 'headerStart': start, 'dataStart': data_start, 'dataBytes': size}, header, raw))
        pos = data_start + ((size + 2879)//2880)*2880
    return hdus, pos

def main():
    target = next(t for t in json.loads((ROOT/'src/data/targets.json').read_text()) if t['id'] == 'rwaur')['astrometry']
    ra = target['ra'] + target['pmRa'] * 26 / 3600000 / np.cos(np.deg2rad(target['dec']))
    dec = target['dec'] + target['pmDec'] * 26 / 3600000
    for number, collection in enumerate(('spherex_dr1', 'spherex_qr3'), 1):
        rows = query(collection, ra, dec, number == 1)
        if not rows:
            rows = query(collection, 0, 0)
        if not rows:
            raise RuntimeError(f'No D1 frames in {collection}')
        row = rows[0]
        url = str(row['access_url'])
        hdus, size = index(url)
        lookup = {info['name']: (info, header, raw) for info, header, raw in hdus}
        info, header, raw = lookup['IMAGE']
        (OUT/f'frame{number}.image-header.bin').write_bytes(raw)
        cards = [str(card) for card in header.cards]
        header_values = {key: value for key, value in header.items() if key not in ('', 'COMMENT', 'HISTORY') and isinstance(value, (str, int, float, bool))}
        dump(f'frame{number}.json', {'url': url, 'obsId': str(row['obs_id']), 'collection': collection, 'sizeBytes': size, 'hdus': [x[0] for x in hdus], 'imageHeader': header_values, 'imageHeaderCards': cards, 'madeBy': 'scripts/fixtures.py', 'madeAt': datetime.now(timezone.utc).isoformat()})
        wcs = WCS(header).celestial
        sky = wcs.all_pix2world(POINTS, 0)
        shifted = sky + [20/3600, -15/3600]
        pixels = wcs.all_world2pix(shifted, 0, tolerance=1e-8, maxiter=100)
        dump(f'frame{number}.wcs.json', {'astropyVersion': astropy.__version__, 'pixToSky': [{'pixel': p, 'sky': s.tolist()} for p, s in zip(POINTS, sky)], 'skyToPix': [{'sky': s.tolist(), 'pixel': p.tolist()} for s, p in zip(shifted, pixels)]})
        waveinfo, _, waveraw = lookup['WCS-WAVE']
        wavebytes = waveraw + fetch(url, waveinfo['dataStart'], ((waveinfo['dataBytes'] + 2879)//2880)*2880)
        (OUT/f'frame{number}.wcswave.bin').write_bytes(wavebytes)
        primary = fits.PrimaryHDU().header.tostring().encode('ascii')
        with fits.open(io.BytesIO(primary + wavebytes)) as f:
            table = f[1].data
            xs = np.asarray(table['X'][0]).tolist()
            ys = np.asarray(table['Y'][0]).tolist()
            values = np.asarray(table['VALUES'][0]).tolist()
            # SIP belongs to the celestial WCS, not the alternate spectral WCS.
            spectral_header = header.copy()
            for key in list(spectral_header):
                if key.startswith(('A_', 'B_', 'AP_', 'BP_')):
                    del spectral_header[key]
            spectral_wcs = WCS(spectral_header, fobj=f, key='W')
            evaluated = spectral_wcs.all_pix2world(POINTS, 0)
        samples = [{'pixel': point, 'lambda': float(value[0]), 'bandwidth': float(value[1])} for point, value in zip(POINTS, evaluated)]
        dump(f'frame{number}.wave.json', {'X': xs, 'Y': ys, 'VALUES': values, 'method': 'Astropy alternate W spectral WCS, with celestial SIP coefficients removed', 'astropyVersion': astropy.__version__, 'samples': samples})
        years = 2000 + (float(row['t_min']) - 51544.5) / 365.25 - target['epochJyear']
        frame_ra = target['ra'] + target['pmRa'] * years / 3600000 / np.cos(np.deg2rad(target['dec']))
        frame_dec = target['dec'] + target['pmDec'] * years / 3600000
        xy = wcs.all_world2pix([[frame_ra, frame_dec]], 0)[0]
        if not (32 <= xy[0] < 2008 and 32 <= xy[1] < 2008):
            xy = [1020, 1020]
        x0, y0 = [int(round(v))-32 for v in xy]
        box = {'x0': x0, 'y0': y0, 'x1': x0+64, 'y1': y0+64}
        results = {}
        for name in ('IMAGE', 'ZODI'):
            offset = lookup[name][0]['dataStart']
            chunk = fetch(url, offset + (y0*2040+x0)*4, 63*2040*4 + 256)
            data = b''.join(chunk[y*2040*4:y*2040*4+256] for y in range(64))
            arr = np.frombuffer(data, dtype='>f4').reshape(64,64)
            (OUT/f'frame{number}.box.{name.lower()}.f32').write_bytes(arr.astype('<f4').tobytes())
            results[name] = {'sum': float(np.nansum(arr, dtype=np.float64)), 'nanCount': int(np.isnan(arr).sum()), 'samples': [{'x': x0+x, 'y': y0+y, 'value': None if np.isnan(arr[y,x]) else float(arr[y,x])} for x,y in ((0,0),(63,0),(32,32),(0,63),(63,63))]}
        dump(f'frame{number}.box.json', {'box': box, **results, 'imageFirstRowOffset': info['dataStart']+(y0*2040+x0)*4, 'imageLastRowOffset': info['dataStart']+((y0+63)*2040+x0)*4})

if __name__ == '__main__':
    main()
