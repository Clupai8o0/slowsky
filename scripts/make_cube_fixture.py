#!/usr/bin/env python3
"""Fresh IRSA DR1 cube reference, bounded to 30 MB of HTTP Range responses.

The default compact archive stores only the requested box pixels.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import threading
import time
from urllib.request import Request, urlopen
from urllib.error import URLError

import astropy
from astropy.io import fits
from astropy.wcs import WCS
import astropy.units as u
import astropy_healpix
from astropy_healpix import HEALPix
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'fixtures' / 'cube'
BASE = 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/dr1/hips5_cube/hips_20261026'
PROPERTIES = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube/properties'
SOURCES = [
    'https://irsa.ipac.caltech.edu/cloud_access/#spherex',
    'https://irsa.ipac.caltech.edu/spherex-archive-documentation/spherex-data-access/#browsable-directories',
    'https://caltech-ipac.github.io/irsa-tutorials/spherex-hipscube/',
    PROPERTIES,
]
HP = HEALPix(nside=32, order='nested', frame='icrs')
BLOCK = 2880
CAP = 30_000_000
LOCK = threading.Lock()
COUNT = 0


def download(url, start, length):
    global COUNT
    for attempt in range(3):
        with LOCK:
            COUNT += length
            if COUNT > CAP:
                raise RuntimeError('30 MB total network budget exceeded')
        request = Request(url, headers={'Range': f'bytes={start}-{start + length - 1}'})
        try:
            with urlopen(request, timeout=60) as response:
                if response.status != 206:
                    raise RuntimeError(f'Range requires 206, got {response.status}')
                data = response.read(length + 1)
                if len(data) != length:
                    raise RuntimeError(f'Range requires {length} bytes, got {len(data)}')
                return data
        except (URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise RuntimeError('No range response')


def celestial(header):
    header = header.copy()
    # Avoid loading any data solely to resolve the spectral -TAB axis.
    for key in list(header):
        if key.endswith('3') or key.startswith(('PS3', 'PV3', 'PC3')):
            del header[key]
    header['NAXIS'] = 2
    header['WCSAXES'] = 2
    return WCS(header)


def tile_for(ra, dec):
    cell = int(HP.lonlat_to_healpix(ra * u.deg, dec * u.deg))
    return cell, f'{BASE}/Norder5/Dir{cell // 10000 * 10000}/Npix{cell}_cube.fits'


def load_tile(cell, url):
    offset = 0
    headers = []
    requests = []
    archive = bytearray()
    for index in range(12):
        raw = bytearray()
        while True:
            data = download(url, offset + len(raw), BLOCK)
            requests.append({'offset': offset + len(raw), 'length': BLOCK, 'fileOffset': len(archive)})
            archive.extend(data)
            raw.extend(data)
            if any(data[i:i + 8] == b'END     ' for i in range(0, BLOCK, 80)):
                break
            if len(raw) > 131072:
                raise RuntimeError('Unbounded FITS header')
        header = fits.Header.fromstring(raw.decode('ascii'))
        data_start = offset + len(raw)
        size = abs(int(header['BITPIX'])) // 8 if header['NAXIS'] else 0
        for axis in range(1, int(header['NAXIS']) + 1):
            size *= int(header[f'NAXIS{axis}'])
        size = (size + int(header.get('PCOUNT', 0))) * int(header.get('GCOUNT', 1))
        headers.append((header, data_start))
        if header.get('EXTNAME') == 'WCS-WAVE':
            wave = download(url, data_start, size)
            requests.append({'offset': data_start, 'length': size, 'fileOffset': len(archive)})
            archive.extend(wave)
            # astropy decodes the real BINTABLE using a small, in-memory FITS HDU.
            import io
            minimal = fits.PrimaryHDU().header.tostring().encode('ascii') + bytes(raw) + wave
            minimal += b'\0' * ((-len(minimal)) % BLOCK)
            with fits.open(io.BytesIO(minimal)) as hdus:
                wavelengths = hdus[1].data['WAVELENGTHS'][0].flatten().astype(float)
            image, image_start = next(item for item in headers if item[0].get('EXTNAME') == 'IMAGE')
            filename = f'Npix{cell}.headers.bin'
            (OUT / filename).write_bytes(archive)
            return {
                'tile': f'Npix{cell}', 'url': url, 'headerFile': filename, 'requests': requests,
                'imageDataStart': image_start, 'width': int(image['NAXIS1']),
                'height': int(image['NAXIS2']), 'planes': int(image['NAXIS3']),
                'bitpix': int(image['BITPIX']), 'unit': image['BUNIT'],
                'lambda': wavelengths.tolist(),
                'midMjd': (float(headers[0][0]['MJD-BEG']) + float(headers[0][0]['MJD-END'])) / 2,
                'hduLayout': [dict(name=h.get('EXTNAME', 'PRIMARY'), dataStart=start) for h, start in headers],
            }, image
        offset = data_start + math.ceil(size / BLOCK) * BLOCK
    raise RuntimeError('WCS-WAVE not found')


def healpix_reference(hp, order, ra, dec):
    cell, dx, dy = hp.lonlat_to_healpix(ra * u.deg, dec * u.deg, return_offsets=True)
    cell = int(cell)
    lon, lat = hp.healpix_to_lonlat(cell)
    # The exact shared edge belongs to both closed cells. Floating-point
    # projection libraries can pick either; independently sample both sides.
    candidates = {cell}
    if min(dx, dy, 1 - dx, 1 - dy) < 1e-9:
        for dra in [-1e-10, 0, 1e-10]:
            for ddec in [-1e-10, 0, 1e-10]:
                if abs(dec + ddec) <= 90:
                    candidates.add(int(hp.lonlat_to_healpix(((ra + dra) % 360) * u.deg, (dec + ddec) * u.deg)))
    return {'order': order, 'coord': {'ra': float(ra), 'dec': float(dec)},
            'cell': cell, 'dx': float(dx), 'dy': float(dy), 'boundaryCells': sorted(candidates),
            'center': {'ra': float(lon.deg), 'dec': float(lat.deg)}}


def reference_spot(name, ra, dec, tile, header, compact):
    x, y = celestial(header).all_world2pix([[ra, dec]], 0)[0]
    cx, cy = math.floor(x + 0.5), math.floor(y + 0.5)
    width, height = tile['width'], tile['height']
    x0, x1 = max(0, cx - 5), min(width, cx + 6)
    y0, y1 = max(0, cy - 5), min(height, cy + 6)
    stride = width * abs(tile['bitpix']) // 8
    length = (y1 - y0 - 1) * stride + (x1 - x0) * 4
    flux, background, means, noise = [], [], [], []
    archive = bytearray()
    requests = []
    yy, xx = np.mgrid[y0:y1, x0:x1]
    source = (np.abs(xx - cx) <= 1) & (np.abs(yy - cy) <= 1)
    sky = (xx - cx) ** 2 + (yy - cy) ** 2 >= 9
    start_time = time.monotonic()

    def plane(index):
        offset = tile['imageDataStart'] + index * width * height * 4 + (y0 * width + x0) * 4
        data = download(tile['url'], offset, length)
        rows = np.ndarray((y1 - y0, x1 - x0), dtype='>f4', buffer=data, strides=(stride, 4)).astype(float)
        rows = rows * float(header.get('BSCALE', 1)) + float(header.get('BZERO', 0))
        valid_source, valid_sky = rows[source], rows[sky]
        valid_sky = valid_sky[np.isfinite(valid_sky)]
        mean = float(np.mean(valid_source)) if len(valid_source) == 9 and np.all(np.isfinite(valid_source)) else float('nan')
        bg = float(np.median(valid_sky)) if len(valid_sky) else float('nan')
        mad = float(1.4826 * np.median(np.abs(valid_sky - bg))) if len(valid_sky) >= 8 else float('nan')
        if index in (50, 51):
            mean = bg = mad = float('nan')
        packed = b''.join(data[row * stride:row * stride + (x1 - x0) * 4] for row in range(y1 - y0)) if compact else data
        return offset, packed, mean, bg, mad, hashlib.sha256(data).hexdigest()

    with ThreadPoolExecutor(max_workers=8) as pool:
        for index, (offset, packed, mean, bg, mad, sha) in enumerate(pool.map(plane, range(tile['planes']))):
            requests.append({'plane': index, 'offset': offset, 'length': length,
                             'fileOffset': len(archive), 'storedLength': len(packed), 'sha256': sha})
            archive.extend(packed)
            means.append(mean)
            background.append(bg)
            noise.append(mad)
            flux.append(mean - bg)
    seconds = time.monotonic() - start_time
    filename = f'{name}.ranges.bin.gz'
    (OUT / filename).write_bytes(gzip.compress(bytes(archive), mtime=0))
    values = lambda values: [float(value) if math.isfinite(value) else None for value in values]
    return {
        'name': name, 'coord': {'ra': ra, 'dec': dec}, 'tile': tile['tile'], 'url': tile['url'],
        'x': float(x), 'y': float(y), 'center': [cx, cy], 'box': [x0, y0, x1, y1],
        'boxPx': 11, 'clipped': x0 != cx - 5 or y0 != cy - 5 or x1 != cx + 6 or y1 != cy + 6,
        'file': filename, 'encoding': 'gzip-box-pixels' if compact else 'gzip-exact-ranges',
        'requests': requests, 'sourceMean': values(means), 'background': values(background),
        'flux': values(flux), 'noise': values(noise),
        'bytesRead': sum(r['length'] for r in tile['requests']) + length * tile['planes'],
        'planeReadSeconds': seconds, 'concurrency': 8,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compact', action='store_true', default=True, help='omit ignored inter-row gaps from the archive')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    with urlopen(PROPERTIES, timeout=45) as response:
        properties_text = response.read(32_001)
    if len(properties_text) > 32_000:
        raise RuntimeError('Unexpected properties size')
    (OUT / 'properties.txt').write_bytes(properties_text)
    properties = dict(line.split('=', 1) for line in properties_text.decode().splitlines() if '=' in line and not line.startswith('#'))
    properties = {key.strip(): value.strip() for key, value in properties.items()}
    assert properties['hips_order'] == '5' and properties['hips_tile_width'] == '512'
    blank_ra, blank_dec = HP.healpix_to_lonlat(11391, dx=0.65, dy=0.65)
    edge_ra, edge_dec = HP.healpix_to_lonlat(11391, dx=1 - 408.5 / 512, dy=1.5 / 512)
    spots = [
        ('epsindb', 331.0964, -56.8005), ('rwaur', 76.9563, 30.4014),
        ('blank', float(blank_ra.deg), float(blank_dec.deg)),
        ('edge', float(edge_ra.deg), float(edge_dec.deg)),
    ]
    tiles, headers, result = {}, {}, []
    for name, ra, dec in spots:
        cell, url = tile_for(ra, dec)
        if cell not in tiles:
            tiles[cell], headers[cell] = load_tile(cell, url)
        spot = reference_spot(name, ra, dec, tiles[cell], headers[cell], args.compact)
        result.append(spot)
        print(name, spot['tile'], (spot['x'], spot['y']),
              'bytes', spot['bytesRead'], 'seconds', round(spot['planeReadSeconds'], 2), flush=True)
    references = []
    coords = [(ra, dec) for _, ra, dec in spots]
    coords += [(ra, dec) for dec in [-90, -70, -math.degrees(math.asin(2 / 3)), 0,
                                    math.degrees(math.asin(2 / 3)), 70, 90]
               for ra in [0, 0.00001, 45, 90, 179.99999, 270, 359.99999]]
    rng = np.random.default_rng(20261114)
    coords += list(zip(rng.uniform(0, 360, 80), np.degrees(np.arcsin(rng.uniform(-1, 1, 80)))))
    for order in [5, 14]:
        hp = HEALPix(nside=2 ** order, order='nested', frame='icrs')
        for ra, dec in coords:
            references.append(healpix_reference(hp, order, ra, dec))
    metadata = {
        'notice': 'Fixture made with AI-written code during the event',
        'createdUtc': datetime.now(timezone.utc).isoformat(),
        'sources': SOURCES, 'pathPattern': f'{BASE}/Norder5/Dir{{floor(cell/10000)*10000}}/Npix{{cell}}_cube.fits',
        'layout': 'Equatorial NESTED order 5; 512x512 HPX raster; x=512*dy-0.5, y=512*(1-dx)-0.5; IMAGE 102 planes, FITS big endian',
        'blankPlanesZeroBased': [50, 51], 'caption': 'quick look, one-year average, not for measurement',
        'pixelConvention': 'ICRS degrees; astropy origin=0; source rounded to nearest pixel; radial background distance >=3 pixels',
        'movingTargets': 'Coordinates must be propagated with positionAt to the cube midMjd before lookup; the Eps Ind B coordinate is supplied at about 2025.9.',
        'encodingNote': 'Only exact box pixels are archived; unused FITS inter-row gaps are reconstructed by tests.' if args.compact else 'All requested bytes are preserved losslessly, including FITS inter-row gaps.',
        'versions': {'python': __import__('platform').python_version(), 'astropy': astropy.__version__,
                     'numpy': np.__version__, 'astropy_healpix': astropy_healpix.__version__},
        'networkBytes': COUNT + len(properties_text), 'tiles': list(tiles.values()),
        'spots': result, 'healpixReferences': references,
    }
    (OUT / 'fixture.json').write_text(json.dumps(metadata, separators=(',', ':'), allow_nan=False) + '\n')
    total = sum(path.stat().st_size for path in OUT.iterdir() if path.is_file())
    print('fixture bytes', total, 'network bytes', metadata['networkBytes'], flush=True)
    if total >= 600_000:
        raise RuntimeError('Fixture exceeds 600 KB')


if __name__ == '__main__':
    main()
