#!/usr/bin/env python3
"""Bake reproducible SPHEREx cutouts using bounded HTTP range requests."""
import argparse
import concurrent.futures
import csv
import io
import json
import math
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyvo
import requests
from astropy.io import fits, votable
from astropy.time import Time
from astropy.wcs import WCS

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'snapshot'
COLLECTIONS = ('spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3', 'spherex_qr3_deep')
CAP = 6_000_000
PLANE_BYTES = 112 * 112 * 4


def moved(target, mjd):
    a = target['astrometry']
    years = Time(mjd, format='mjd').jyear - a['epochJyear']
    return ((a['ra'] + a['pmRa'] * years / (3_600_000 * math.cos(math.radians(a['dec'])))) % 360,
            a['dec'] + a['pmDec'] * years / 3_600_000)


class Reader:
    def __init__(self, key):
        self.key = key
        self.count = 0
        self.lock = threading.Lock()
        self.number = 0

    def read(self, start, length):
        with self.lock:
            self.count += length
            if self.count > CAP:
                raise RuntimeError('frame exceeds byte cap')
            self.number += 1
            host = ('nasa-irsa-spherex.s3.us-east-1.amazonaws.com', 'nasa-irsa-spherex.s3.amazonaws.com')[self.number % 2]
        hosts = ('nasa-irsa-spherex.s3.us-east-1.amazonaws.com', 'nasa-irsa-spherex.s3.amazonaws.com')
        for attempt in range(8):
            try:
                response = requests.get(f'https://{hosts[(self.number + attempt) % 2]}/{self.key}', headers={'Range': f'bytes={start}-{start + length - 1}'}, timeout=(15, 60), stream=True)
                try:
                    if response.status_code != 206:
                        raise RuntimeError(f'bad range response: {response.status_code}')
                    content = response.raw.read(length + 1, decode_content=False)
                finally:
                    response.close()
                if len(content) != length:
                    raise RuntimeError(f'bad range response: {len(content)} bytes, expected {length}')
                return content
            except Exception:
                if attempt == 7:
                    raise
                time.sleep(min(2 ** attempt, 20) + attempt * 0.3)

    def index(self):
        offset = 0
        result = {}
        for _ in range(7):
            blocks = bytearray()
            while True:
                block = self.read(offset + len(blocks), 2880)
                blocks.extend(block)
                if any(block[i:i + 8] == b'END     ' for i in range(0, len(block), 80)):
                    break
            header = fits.Header.fromstring(blocks.decode('ascii'), sep='')
            start = offset + len(blocks)
            naxis = int(header.get('NAXIS', 0))
            size = 0 if naxis == 0 else abs(int(header['BITPIX'])) // 8
            for i in range(1, naxis + 1):
                size *= int(header[f'NAXIS{i}'])
            size = (size + int(header.get('PCOUNT', 0))) * int(header.get('GCOUNT', 1))
            result[header.get('EXTNAME', 'PRIMARY')] = (header, start, size)
            offset = start + ((size + 2879) // 2880) * 2880
        return result

    def cutout(self, hdu, box):
        header, start, _ = hdu
        width = int(header['NAXIS1'])
        x0, y0, x1, y1 = box
        ranges = []
        for y in range(y0, y1, 14):
            rows = min(14, y1 - y)
            ranges.append((start + y * width * 4, rows * width * 4, rows))
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            data = list(pool.map(lambda part: self.read(part[0], part[1]), ranges))
        return np.concatenate([np.frombuffer(chunk, dtype='>f4').reshape(part[2], width)[:, x0:x1] for chunk, part in zip(data, ranges)]).astype('<f4').tobytes()


def cloud(row, detector):
    try:
        data = json.loads(str(row['cloud_access']))['aws']
        key = data['key']
        if data['bucket_name'] != 'nasa-irsa-spherex' or data['region'] != 'us-east-1' or not re.search(rf'D{detector}(?:_|\.)', key):
            return None
        return key
    except (ValueError, KeyError, TypeError):
        return None


def query(target):
    service = pyvo.dal.SIA2Service('https://irsa.ipac.caltech.edu/SIA')
    ra, dec = moved(target, 51544.5 + 26 * 365.25)
    rows = []
    for collection in COLLECTIONS:
        table = service.search(pos=(ra, dec, 0.01), collection=collection).to_table()
        for row in table:
            key = cloud(row, target['detector'])
            if key:
                rows.append((row, key, collection))
    rows.sort(key=lambda entry: float(entry[0]['t_min']))
    return rows


def gaia_write(path, stars):
    path.write_text(json.dumps({'credit': 'ESA/Gaia/DPAC, CC BY-NC 3.0 IGO', 'sources': stars}, allow_nan=False))


def num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def gaia_stsci(target):
    ra, dec = moved(target, 57388.5)
    response = requests.get('https://gsss.stsci.edu/webservices/vo/CatalogSearch.aspx', params={'CAT': 'GAIADR3', 'RA': ra, 'DEC': dec, 'SR': 0.1, 'FORMAT': 'CSV'}, timeout=(15, 180))
    response.raise_for_status()
    lines = [line for line in response.text.splitlines() if line and not line.startswith('#')]
    stars = []
    for row in csv.DictReader(lines):
        g = num(row.get('phot_g_mean_mag'))
        if g is None or g >= 19:
            continue
        stars.append({'source_id': row['source_id'].strip(), 'ra': num(row['ra']), 'dec': num(row['dec']), 'pmra': num(row['pmra']), 'pmdec': num(row['pmdec']), 'parallax': num(row['parallax']), 'phot_g_mean_mag': g, 'ref_epoch': num(row.get('ref_epoch')) or 2016.0})
    if not stars:
        raise RuntimeError('STScI Gaia reply had no usable rows')
    return stars


def gaia_vizier(target):
    ra, dec = moved(target, 57388.5)
    response = requests.get('https://vizier.cfa.harvard.edu/viz-bin/asu-tsv', params={'-source': 'I/355/gaiadr3', '-c': f'{ra} {dec:+}', '-c.rd': '0.1', '-out': 'Source,RA_ICRS,DE_ICRS,pmRA,pmDE,Plx,Gmag', '-out.max': 'unlimited', 'Gmag': '<19'}, timeout=(15, 180))
    response.raise_for_status()
    lines = response.text.splitlines()
    header = next(i for i, line in enumerate(lines) if line.startswith('Source\tRA_ICRS\t'))
    fields = ['source_id', 'ra', 'dec', 'pmra', 'pmdec', 'parallax', 'phot_g_mean_mag']
    stars = []
    for line in lines[header + 3:]:
        if not line.strip() or line.startswith('#'):
            continue
        values = line.split('\t')
        if len(values) != len(fields):
            raise RuntimeError('unexpected Gaia catalogue row')
        star = {field: (value.strip() if field == 'source_id' else num(value)) for field, value in zip(fields, values)}
        star['ref_epoch'] = 2016.0
        stars.append(star)
    return stars


def gaia(target, path):
    try:
        stars = gaia_stsci(target)
        source = 'stsci'
    except Exception as error:
        print('STScI Gaia failed, using CfA VizieR:', error, flush=True)
        stars = gaia_vizier(target)
        source = 'vizier-cfa'
    print(target['id'], 'gaia', source, len(stars), flush=True)
    gaia_write(path, stars)


def bake_frame(target, row, key, collection, directory):
    reader = Reader(key)
    hdus = reader.index()
    header = hdus['IMAGE'][0]
    ra, dec = moved(target, float(row['t_min']))
    x, y = WCS(header).all_world2pix([[ra, dec]], 0)[0]
    if not (70 <= x < header['NAXIS1'] - 70 and 70 <= y < header['NAXIS2'] - 70):
        return None
    x0, y0 = int(round(x)) - 56, int(round(y)) - 56
    box = (x0, y0, x0 + 112, y0 + 112)
    obsid = str(row['obs_id']) + 'D' + str(target['detector'])
    filename = obsid + '.f32'
    path = directory / filename
    if not path.exists() or path.stat().st_size != PLANE_BYTES * 3 or ARGS.force:
        tmp = path.with_suffix('.tmp')
        data = b''.join(reader.cutout(hdus[name], box) for name in ('IMAGE', 'ZODI', 'VARIANCE'))
        if len(data) != PLANE_BYTES * 3:
            raise RuntimeError('bad cutout size')
        tmp.write_bytes(data)
        tmp.replace(path)
    wave_header, wave_start, wave_size = hdus['WCS-WAVE']
    wave_data = reader.read(wave_start, wave_size)
    # Interpret the packed fixed-width table through Astropy's FITS reader.
    raw = wave_header.tostring().encode('ascii') + wave_data + b'\0' * ((-wave_size) % 2880)
    primary = fits.PrimaryHDU().header.tostring().encode('ascii')
    with fits.open(io.BytesIO(primary + raw)) as file:
        entry = file[1].data[0]
        xs = np.asarray(entry['X'], dtype=int) - 1
        ys = np.asarray(entry['Y'], dtype=int) - 1
        values = np.asarray(entry['VALUES']).reshape(len(ys), len(xs), 2)
    record = {'obsId': obsid, 'collection': collection, 'release': 'qr3' if 'qr3' in collection else 'dr1', 'detector': target['detector'], 'url': 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/' + key, 'tMin': float(row['t_min']), 'tMax': float(row['t_max']), 'lambdaMin': float(row['em_min']) * 1e6, 'lambdaMax': float(row['em_max']) * 1e6, 'center': {'ra': float(row['s_ra']), 'dec': float(row['s_dec'])}, 'estSizeBytes': int(float(row['access_estsize']) * 1024)}
    keep = re.compile(r'^(CTYPE[12]|CRPIX[12]|CRVAL[12]|CUNIT[12]|CDELT[12]|PC\d_\d|CD\d+_\d+|LONPOLE|LATPOLE|RADESYS|WCSAXES|DATE|DATE-AVG|DATE-END|MJD-AVG|MJD-END|OBSID|DETECTOR|(?:A|B|AP|BP)_(?:\d+_\d+|ORDER)|NAXIS[12]|DATE-OBS|MJD-OBS|BUNIT|.*VERS.*)$')
    cards = {k: v for k, v in header.items() if keep.match(k) and isinstance(v, (str, int, float, bool))}
    return {'record': record, 'box': dict(zip(('x0', 'y0', 'x1', 'y1'), box)), 'planes': ['IMAGE', 'ZODI', 'VARIANCE'], 'file': filename, 'imageHeader': cards, 'wave': {'xs': xs.tolist(), 'ys': ys.tolist(), 'lambda': values[:, :, 0].tolist(), 'bandwidth': values[:, :, 1].tolist(), 'pixelOrigin': 0}}


def main():
    targets = json.loads((ROOT / 'src/data/targets.json').read_text())
    made = datetime.now(timezone.utc).isoformat()
    summary = []
    total = 0
    for target in targets:
        directory = OUT / target['id']
        directory.mkdir(parents=True, exist_ok=True)
        index_path = directory / 'index.json'
        if index_path.exists() and not ARGS.force:
            index = json.loads(index_path.read_text())
        else:
            rows = query(target)
            visits = {}
            for row in rows:
                visit = '_'.join(str(row[0]['obs_id']).split('_')[:3])
                visits.setdefault(visit, []).append(row)
            if len(visits) > 24:
                # Too many visits: keep 24 spread evenly across time, then take frames from those.
                names = list(visits)
                visits = {names[round(i * (len(names) - 1) / 23)]: visits[names[round(i * (len(names) - 1) / 23)]] for i in range(24)}
            selected = []
            # Round-robin through visits so each is retained before thinning.
            for rank in range(max(map(len, visits.values()), default=0)):
                for group in visits.values():
                    if rank < len(group):
                        selected.append(group[rank])
            frames = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                for start in range(0, len(selected), 8):
                    if len(frames) >= 24:
                        break
                    batch = selected[start:start + 8]
                    for row, _, _ in batch:
                        print(target['id'], row['obs_id'], flush=True)
                    futures = [pool.submit(bake_frame, target, row, key, collection, directory)
                               for row, key, collection in batch]
                    for future in futures:
                        frame = future.result()
                        if frame and len(frames) < 24:
                            frames.append(frame)
            frames.sort(key=lambda frame: frame['record']['tMin'])
            if not frames:
                raise RuntimeError(f'no frames for {target["id"]}')
            index = {'target': target, 'madeBy': 'scripts/bake.py', 'madeAt': made, 'frames': frames}
            index_path.write_text(json.dumps(index, allow_nan=False))
        gaia_path = directory / 'gaia.json'
        if ARGS.force or not gaia_path.exists():
            gaia(target, gaia_path)
        count = len(index['frames'])
        total += sum((directory / frame['file']).stat().st_size for frame in index['frames'])
        summary.append({'id': target['id'], 'frameCount': count})
    if total >= 30_000_000:
        raise RuntimeError('snapshot exceeds 30 MB')
    (OUT / 'manifest.json').write_text(json.dumps({'targets': summary, 'totalBytes': total, 'madeAt': made}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true')
    ARGS = parser.parse_args()
    main()
    print('DONE', flush=True)
