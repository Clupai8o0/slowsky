#!/usr/bin/env python3
"""Download a bounded, fresh SPHEREx FLAGS oracle; never read a local frame.

Run with the interpreter named in the lane brief. Only SIA and S3 are contacted.
The complete FLAGS HDU (not the complete FITS file) is decoded by astropy once;
only selected compressed tiles and their oracle pixels are saved.
"""
import argparse
import gzip
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import astropy
import numpy as np
import requests
from astropy.io import fits, votable

CAP = 40_000_000
FIXTURE_CAP = 1_500_000
COLLECTIONS = ('spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3', 'spherex_qr3_deep')
OUT = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures' / 'flags'


class RangeReader:
    def __init__(self, url):
        self.url = url
        self.bytes = 0
        self.requests = []

    def read(self, start, length):
        if start < 0 or length < 1 or self.bytes + length > CAP:
            raise RuntimeError('Invalid range or 40 MB transfer cap exceeded')
        self.bytes += length
        with requests.get(self.url, headers={'Range': f'bytes={start}-{start + length - 1}'},
                          timeout=(15, 60), stream=True) as response:
            if response.status_code != 206:
                raise RuntimeError(f'Range requires 206, received {response.status_code}')
            data = response.raw.read(length + 1, decode_content=False)
        if len(data) != length:
            raise RuntimeError(f'Wrong range length: {len(data)} instead of {length}')
        self.requests.append({'start': start, 'length': length})
        return data

    def flags_header(self):
        offset = 0
        for _ in range(7):
            raw = bytearray()
            while True:
                block = self.read(offset + len(raw), 2880)
                raw.extend(block)
                if any(block[i:i + 8] == b'END     ' for i in range(0, 2880, 80)):
                    break
            header = fits.Header.fromstring(raw.decode('ascii'), sep='')
            start = offset + len(raw)
            size = 0 if header['NAXIS'] == 0 else abs(header['BITPIX']) // 8
            for axis in range(1, header['NAXIS'] + 1):
                size *= header[f'NAXIS{axis}']
            size = (size + header.get('PCOUNT', 0)) * header.get('GCOUNT', 1)
            if header.get('EXTNAME') == 'FLAGS':
                return header, bytes(raw), offset, start, size
            offset = start + ((size + 2879) // 2880) * 2880
        raise RuntimeError('No FLAGS HDU')


def choose_frame(args):
    # Like bake.py: position + allowlisted collection, cloud_access only.
    with requests.get('https://irsa.ipac.caltech.edu/SIA',
                      params={'COLLECTION': args.collection,
                              'POS': f'CIRCLE {args.ra} {args.dec} 0.01'},
                      timeout=(15, 60)) as response:
        response.raise_for_status()
        table = votable.parse_single_table(io.BytesIO(response.content)).to_table(use_names_over_ids=True)
    for row in sorted(table, key=lambda row: float(row['t_min'])):
        try:
            cloud = json.loads(str(row['cloud_access']))['aws']
            key = cloud['key']
            if (str(row['obs_collection']) != args.collection
                    or cloud['bucket_name'] != 'nasa-irsa-spherex'
                    or cloud['region'] != 'us-east-1'
                    or not key.startswith(('dr1/', 'qr3/'))
                    or not re.search(rf'D{args.detector}(?:_|\.)', key)):
                continue
            return {'obsId': str(row['obs_id']) + f'D{args.detector}',
                    'collection': args.collection,
                    'url': f"https://{cloud['bucket_name']}.s3.{cloud['region']}.amazonaws.com/{key}"}
        except (KeyError, ValueError, TypeError):
            continue
    raise RuntimeError('SIA returned no eligible frame')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ra', type=float, default=76.75)
    parser.add_argument('--dec', type=float, default=30.3)
    parser.add_argument('--detector', type=int, choices=range(1, 7), default=1)
    parser.add_argument('--collection', choices=COLLECTIONS, default='spherex_dr1')
    args = parser.parse_args()
    frame = choose_frame(args)
    reader = RangeReader(frame['url'])
    header, raw_header, header_start, data_start, size = reader.flags_header()
    for card in header.cards:
        if re.match(r'^(MSK[NMD]\d{4}|ZTILE\d|ZBITPIX|ZCMPTYPE|ZNAME\d|ZVAL\d|TTYPE\d|TFORM\d|THEAP|PCOUNT)$', card.keyword):
            print(str(card), flush=True)
    # Discover every layout value from this header, including an optional heap gap.
    width, height = header['ZNAXIS1'], header['ZNAXIS2']
    tw, th = header.get('ZTILE1', width), header.get('ZTILE2', 1)
    params = {header[f'ZNAME{i}']: header[f'ZVAL{i}'] for i in range(1, 10) if f'ZNAME{i}' in header}
    if header['ZCMPTYPE'] != 'RICE_1' or header['ZBITPIX'] not in (8, 16, 32):
        raise RuntimeError('Expected integer RICE_1 FLAGS')
    if width < 64 or height < 64:
        raise RuntimeError('Frame too small for required fixture')
    columns = fits.ColDefs([fits.Column(name=header[f'TTYPE{i}'], format=header[f'TFORM{i}'])
                            for i in range(1, header['TFIELDS'] + 1)])
    col = next(i for i, column in enumerate(columns) if column.name == 'COMPRESSED_DATA')
    column_offset = sum(column.dtype.itemsize for column in columns[:col])
    descriptor = re.fullmatch(r'1([PQ])B(?:\(\d+\))?', str(columns[col].format))
    if descriptor is None:
        raise RuntimeError('Unsupported compressed column descriptor')
    kind = descriptor[1]
    row_size, row_count = header['NAXIS1'], header['NAXIS2']
    table_bytes = row_size * row_count
    heap_relative = header.get('THEAP', table_bytes)
    heap_start = data_start + heap_relative
    heap_bytes = size - heap_relative
    if heap_relative < table_bytes or heap_bytes < 0:
        raise RuntimeError('Invalid heap bounds')
    payload = reader.read(data_start, size)
    # A minimal in-memory FITS container lets astropy decode the original bytes.
    primary = fits.PrimaryHDU().header.tostring().encode('ascii')
    isolated = primary + raw_header + payload + bytes((-size) % 2880)
    with fits.open(io.BytesIO(isolated), memmap=False) as hdus:
        pixels = np.asarray(hdus[1].data, dtype='<i4')
    rows = np.linspace(0, height - 1, 64, dtype=int).tolist()
    x0, y0 = width // 2 - 24, height // 2 - 24
    box = {'x0': x0, 'y0': y0, 'x1': x0 + 48, 'y1': y0 + 48}
    cross = {'x0': max(0, x0 - 13), 'y0': y0 + 7, 'x1': min(width, x0 + 61), 'y1': y0 + 38}
    selected_rows = set(rows) | set(range(y0, y0 + 48))
    nx = (width + tw - 1) // tw
    tile_ids = sorted({(y // th) * nx + tx for y in selected_rows for tx in range(nx)})
    tiles, tile_ranges, expected = [], [], bytearray()
    dtype = '>i4' if kind == 'P' else '>i8'
    for index in tile_ids:
        length, relative = map(int, np.frombuffer(payload, dtype=dtype, count=2,
                                                  offset=index * row_size + column_offset))
        if length <= 0 or relative < 0 or relative + length > heap_bytes:
            raise RuntimeError('Descriptor outside heap')
        tx, ty = (index % nx) * tw, (index // nx) * th
        tile = pixels[ty:min(ty + th, height), tx:min(tx + tw, width)]
        tiles.append({'index': index, 'x': tx, 'y': ty, 'width': tile.shape[1], 'height': tile.shape[0],
                      'start': heap_start + relative, 'length': length, 'expectedOffset': len(expected)})
        expected.extend(tile.astype('<i4').tobytes())
        tile_ranges.append([heap_start + relative, heap_start + relative + length])
    ranges = []
    for start, end in sorted(tile_ranges):
        if ranges and start <= ranges[-1][1]:
            ranges[-1][1] = max(ranges[-1][1], end)
        else:
            ranges.append([start, end])
    files = {'header.bin': raw_header, 'table.bin': payload[:table_bytes],
             'rows.i32': pixels[rows, :].astype('<i4').tobytes(),
             'tiles.i32.gz': gzip.compress(bytes(expected), mtime=0)}
    heaps = []
    for i, (start, end) in enumerate(ranges):
        name = f'heap-{i:03d}.bin'
        files[name] = payload[start - data_start:end - data_start]
        heaps.append({'start': start, 'length': end - start, 'file': name})
    for name, bounds in [('box', box), ('cross', cross)]:
        files[f'{name}.i32'] = pixels[bounds['y0']:bounds['y1'], bounds['x0']:bounds['x1']].astype('<i4').tobytes()
    names = [{'bit': int(key[4:]), 'name': header[key]} for key in header if re.fullmatch(r'MSKN\d{4}', key)]
    fixture = {**frame, 'createdUtc': datetime.now(timezone.utc).isoformat(), 'astropyVersion': astropy.__version__,
               'headerStart': header_start, 'hduDataStart': data_start, 'hduDataBytes': size,
               'theapCard': header.get('THEAP'), 'pcount': header['PCOUNT'],
               'layout': {'width': width, 'height': height, 'tileWidth': tw, 'tileHeight': th,
                          'tilesAcross': nx, 'rowSize': row_size, 'rowCount': row_count,
                          'tableStart': data_start, 'tableBytes': table_bytes, 'heapStart': heap_start,
                          'heapBytes': heap_bytes, 'descriptor': kind, 'descriptorOffset': column_offset,
                          'blockSize': params.get('BLOCKSIZE', 32), 'bytePix': params.get('BYTEPIX', 4)},
               'rows': rows, 'box': box, 'crossBox': cross, 'flagNames': names,
               'tiles': tiles, 'heapRanges': heaps, 'rangeRequests': reader.requests,
               'downloadBytes': reader.bytes}
    files['fixture.json'] = (json.dumps(fixture, indent=2) + '\n').encode()
    total = sum(map(len, files.values()))
    if total >= FIXTURE_CAP:
        raise RuntimeError(f'Fixture would exceed 1.5 MB: {total} bytes')
    OUT.mkdir(parents=True, exist_ok=True)
    for path in OUT.iterdir():
        if path.is_file():
            path.unlink()
    for name, data in files.items():
        (OUT / name).write_bytes(data)
    print(f"Wrote {frame['obsId']}: {total} fixture bytes; {reader.bytes} downloaded bytes", flush=True)


if __name__ == '__main__':
    main()
