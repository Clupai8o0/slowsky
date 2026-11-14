import type { FitsHeader, PixelBox } from './types';
import { riceDecode } from './rice';

export class FlagsError extends Error {}

// SPHEREx frames are 2040 x 2040. A larger axis is not a FLAGS image we will decode.
export const MAX_AXIS = 4096;
const MAX_BLOCKSIZE = 1024;
const MAX_DECODED_PIXELS = MAX_AXIS * MAX_AXIS;

export interface FlagsLayout {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    tilesAcross: number;
    rowSize: number;
    rowCount: number;
    tableStart: number; // Absolute file offsets; heap offsets in descriptors are relative to heapStart.
    tableBytes: number;
    heapStart: number;
    heapBytes: number;
    descriptor: 'P' | 'Q';
    descriptorOffset: number;
    blockSize: number;
    bytePix: 1 | 2 | 4;
}

function integer(value: unknown, label: string, minimum = 0): number
{
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
        throw new FlagsError(`Invalid ${label}`);
    }
    return value;
}

function roundUp16(count: number): number
{
    return Math.ceil(count / 16) * 16;
}

function columnBytes(format: unknown): number
{
    if (typeof format !== 'string') {
        throw new FlagsError('Missing binary-table column format');
    }
    const match = format.trim().match(/^(\d*)([LXBIJKAEDCMPQ])([LXBIJKAEDCM])?(?:\((\d+)\))?$/);
    if (!match) {
        throw new FlagsError(`Unsupported column format ${format}`);
    }
    const count = integer(match[1] === '' ? 1 : Number(match[1]), 'column repeat');
    const code = match[2]!;
    if ((code === 'P' || code === 'Q') !== (match[3] !== undefined)
        || (code !== 'P' && code !== 'Q' && match[4] !== undefined)) {
        throw new FlagsError(`Invalid column format ${format}`);
    }
    const sizes: Record<string, number> = { L: 1, X: 0, B: 1, I: 2, J: 4, K: 8, A: 1,
        E: 4, D: 8, C: 8, M: 16, P: 8, Q: 16 };
    return integer(code === 'X' ? Math.ceil(count / 8) : count * sizes[code]!, 'column size');
}

export function parseFlagsLayout(header: FitsHeader, hduDataStart: number): FlagsLayout
{
    const h = header;
    if (h.get('XTENSION') !== 'BINTABLE' || h.get('BITPIX') !== 8 || h.get('NAXIS') !== 2
        || h.get('GCOUNT') !== 1 || h.get('ZIMAGE') !== true || h.get('ZCMPTYPE') !== 'RICE_1'
        || h.get('ZNAXIS') !== 2 || ![8, 16, 32].includes(Number(h.get('ZBITPIX')))) {
        throw new FlagsError('Expected a two-dimensional integer RICE_1 binary table');
    }
    if (['ZQUANTIZ', 'ZDITHER0', 'ZSCALE', 'ZZERO', 'ZBLANK'].some(key => h.get(key) !== undefined)
        || (h.get('BSCALE') !== undefined && h.get('BSCALE') !== 1)
        || (h.get('BZERO') !== undefined && h.get('BZERO') !== 0)) {
        throw new FlagsError('Quantised or scaled FLAGS images are unsupported');
    }
    const width = integer(h.get('ZNAXIS1'), 'image width', 1);
    const height = integer(h.get('ZNAXIS2'), 'image height', 1);
    if (width > MAX_AXIS) {
        throw new FlagsError('Invalid ZNAXIS1');
    }
    if (height > MAX_AXIS) {
        throw new FlagsError('Invalid ZNAXIS2');
    }
    integer(width * height, 'image pixel count', 1);
    const tileWidth = integer(h.get('ZTILE1') ?? width, 'tile width', 1);
    const tileHeight = integer(h.get('ZTILE2') ?? 1, 'tile height', 1);
    if (tileWidth > width) {
        throw new FlagsError('Invalid ZTILE1');
    }
    if (tileHeight > height) {
        throw new FlagsError('Invalid ZTILE2');
    }
    const tilesAcross = Math.ceil(width / tileWidth);
    const rowSize = integer(h.get('NAXIS1'), 'table row size', 1);
    const rowCount = integer(h.get('NAXIS2'), 'table row count', 1);
    if (rowCount !== tilesAcross * Math.ceil(height / tileHeight)) {
        throw new FlagsError('Table row count does not match tile grid');
    }
    const fields = integer(h.get('TFIELDS'), 'field count', 1);
    let offset = 0;
    let descriptor: 'P' | 'Q' | undefined;
    let descriptorOffset = 0;
    for (let i = 1; i <= fields; i++) {
        const name = String(h.get(`TTYPE${i}`) ?? '').trim().toUpperCase();
        if (['ZSCALE', 'ZZERO', 'ZBLANK', 'NULL_PIXEL_MASK'].includes(name)
            || (h.get(`TSCAL${i}`) !== undefined && h.get(`TSCAL${i}`) !== 1)
            || (h.get(`TZERO${i}`) !== undefined && h.get(`TZERO${i}`) !== 0)) {
            throw new FlagsError('Scaled, quantised or masked table columns are unsupported');
        }
        const format = h.get(`TFORM${i}`);
        const size = columnBytes(format);
        if (name === 'COMPRESSED_DATA') {
            const match = typeof format === 'string' ? format.match(/^1([PQ])B(?:\(\d+\))?$/) : null;
            if (descriptor !== undefined || !match) {
                throw new FlagsError('COMPRESSED_DATA must have one 1PB or 1QB descriptor');
            }
            descriptor = match[1] as 'P' | 'Q';
            descriptorOffset = offset;
        }
        offset = integer(offset + size, 'table column extent');
    }
    if (descriptor === undefined || offset !== rowSize) {
        throw new FlagsError('Missing compressed column or inconsistent table row size');
    }
    const parameters = new Map<string, number>();
    for (const [key, value] of h.cards) {
        const match = key.match(/^ZNAME([1-9]\d*)$/);
        if (match) {
            if (typeof value !== 'string' || !['BLOCKSIZE', 'BYTEPIX'].includes(value.trim())
                || parameters.has(value.trim())) {
                throw new FlagsError(`Unsupported or duplicate Rice parameter ${String(value)}`);
            }
            parameters.set(value.trim(), integer(h.get(`ZVAL${match[1]}`), value.trim(), 1));
        }
    }
    const blockSize = parameters.get('BLOCKSIZE') ?? 32;
    const bytePix = parameters.get('BYTEPIX') ?? 4;
    if (![1, 2, 4].includes(bytePix) || bytePix * 8 !== h.get('ZBITPIX')) {
        throw new FlagsError('BYTEPIX must agree with integer ZBITPIX');
    }
    // The FITS default BLOCKSIZE is 32 even when the tile is shorter (one partial block).
    const blockLimit = Math.min(MAX_BLOCKSIZE, Math.max(32, roundUp16(tileWidth * tileHeight)));
    if (blockSize > blockLimit) {
        throw new FlagsError('Invalid BLOCKSIZE');
    }
    const tableStart = integer(hduDataStart, 'HDU data start');
    const tableBytes = integer(rowSize * rowCount, 'table size');
    const pcount = integer(h.get('PCOUNT'), 'PCOUNT');
    const heapOffset = integer(h.get('THEAP') ?? tableBytes, 'THEAP', tableBytes);
    const dataBytes = integer(tableBytes + pcount, 'HDU data size');
    if (heapOffset > dataBytes) {
        throw new FlagsError('THEAP lies outside HDU data');
    }
    const heapStart = integer(tableStart + heapOffset, 'heap start');
    const heapBytes = dataBytes - heapOffset;
    integer(heapStart + heapBytes, 'heap end');
    return { width, height, tileWidth, tileHeight, tilesAcross, rowSize, rowCount, tableStart, tableBytes,
        heapStart, heapBytes, descriptor, descriptorOffset, blockSize, bytePix: bytePix as 1 | 2 | 4 };
}

export function flagNames(header: FitsHeader): { bit: number; name: string }[]
{
    const names: { bit: number; name: string }[] = [];
    for (const [key, value] of header.cards) {
        const match = key.match(/^MSKN(\d{4})$/);
        if (!match) {
            continue;
        }
        const bit = integer(Number(match[1]), 'flag bit');
        if (bit > 31 || typeof value !== 'string' || value.trim() === '') {
            throw new FlagsError(`Invalid flag name card ${key}`);
        }
        const mask = header.get(`MSKM${match[1]}`);
        if (mask !== undefined && mask !== 2 ** bit && mask !== (1 << bit)) {
            throw new FlagsError(`Flag mask disagrees with bit ${bit}`);
        }
        names.push({ bit, name: value.trim() });
    }
    // No names are invented for unnamed bits; callers can still mask by bit number.
    return names.sort((a, b) => a.bit - b.bit);
}

interface ByteRange {
    start: number;
    length: number;
    bytes?: Uint8Array;
}

function merged(ranges: ByteRange[]): ByteRange[]
{
    const result: ByteRange[] = [];
    for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
        const previous = result[result.length - 1];
        if (previous && range.start <= previous.start + previous.length) {
            previous.length = Math.max(previous.start + previous.length, range.start + range.length) - previous.start;
        } else {
            result.push({ start: range.start, length: range.length });
        }
    }
    return result;
}

function inside(ranges: ByteRange[], start: number, length: number): Uint8Array
{
    const range = ranges.find(part => part.start <= start && part.start + part.length >= start + length);
    if (!range?.bytes) {
        throw new FlagsError('Missing requested FLAGS bytes');
    }
    return range.bytes.subarray(start - range.start, start - range.start + length);
}

// fits.ts keeps its checked range helper private. Keep the same status/length
// contract here, including a bounded stream read, without depending on the DOM.
async function rangeRead(fetcher: typeof fetch, url: string, range: ByteRange, signal?: AbortSignal): Promise<Uint8Array>
{
    signal?.throwIfAborted();
    const response = await fetcher(url, { headers: { Range: `bytes=${range.start}-${range.start + range.length - 1}` }, signal });
    if (response.status !== 206) {
        try {
            await response.body?.cancel();
        } catch {
            // Status remains the useful error if cancellation also fails.
        }
        throw new FlagsError(`FLAGS range requires 206, received ${response.status}`);
    }
    // Browsers hide Content-Range unless the host exposes it, so it is checked only when it can be read.
    const span = /^bytes (\d+)-(\d+)\//.exec(response.headers.get('Content-Range') ?? '');
    if (span && (Number(span[1]) !== range.start || Number(span[2]) !== range.start + range.length - 1)) {
        try {
            await response.body?.cancel();
        } catch {
            // Keep the range error.
        }
        throw new FlagsError('FLAGS range reply covers other bytes than requested');
    }
    const output = new Uint8Array(range.length);
    const reader = response.body?.getReader();
    let size = 0;
    if (reader) {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                if (size + value.byteLength > range.length) {
                    try {
                        await reader.cancel();
                    } catch {
                        // Keep the range error.
                    }
                    throw new FlagsError('Wrong FLAGS range body length (over-long)');
                }
                output.set(value, size);
                size += value.byteLength;
            }
        } finally {
            reader.releaseLock();
        }
    } else {
        const body = new Uint8Array(await response.arrayBuffer());
        size = body.length;
        if (size === range.length) {
            output.set(body);
        }
    }
    signal?.throwIfAborted();
    if (size !== range.length) {
        throw new FlagsError(`Wrong FLAGS range body length: expected ${range.length}, received ${size}`);
    }
    return output;
}

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024; // the same cap fits.ts puts on one image read

function total(ranges: ByteRange[]): number
{
    return ranges.reduce((sum, range) => sum + range.length, 0);
}

// The most bytes RICE_1 can need for n pixels: the seed, then every block as an escape block.
function maxTileBytes(nPixels: number, layout: FlagsLayout): number
{
    const blocks = Math.ceil(nPixels / layout.blockSize);
    return layout.bytePix + Math.ceil(blocks * (5 + 8 * layout.bytePix * layout.blockSize) / 8);
}

export async function readFlags(url: string, layout: FlagsLayout, box: PixelBox,
    opts: { signal?: AbortSignal; fetcher?: typeof fetch; maxBytes?: number } = {}): Promise<{ data: Int32Array; width: number; height: number }>
{
    opts.signal?.throwIfAborted();
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new FlagsError('Invalid FLAGS byte limit');
    }
    for (const key of ['x0', 'y0', 'x1', 'y1'] as const) {
        integer(box[key], `box ${key}`);
    }
    if (box.x1 <= box.x0 || box.y1 <= box.y0 || box.x1 > layout.width || box.y1 > layout.height) {
        throw new FlagsError('Invalid FLAGS pixel box');
    }
    const fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
    const tiles: { index: number; x: number; y: number; width: number; height: number; start: number; length: number }[] = [];
    // A 1x1 box still decodes every tile it touches. Stop before any fetch when that would pass 4096 x 4096.
    let decoded = 0;
    for (let ty = Math.floor(box.y0 / layout.tileHeight); ty <= Math.floor((box.y1 - 1) / layout.tileHeight); ty++) {
        for (let tx = Math.floor(box.x0 / layout.tileWidth); tx <= Math.floor((box.x1 - 1) / layout.tileWidth); tx++) {
            const x = tx * layout.tileWidth;
            const y = ty * layout.tileHeight;
            const tileWidth = Math.min(layout.tileWidth, layout.width - x);
            const tileHeight = Math.min(layout.tileHeight, layout.height - y);
            const count = tileWidth * tileHeight;
            if (!Number.isSafeInteger(count) || count < 1 || decoded > MAX_DECODED_PIXELS - count) {
                throw new FlagsError('FLAGS cutout would decode too many pixels');
            }
            decoded += count;
            tiles.push({ index: ty * layout.tilesAcross + tx, x, y, width: tileWidth, height: tileHeight,
                start: 0, length: 0 });
        }
    }
    const tableRanges = merged(tiles.map(tile => ({ start: layout.tableStart + tile.index * layout.rowSize, length: layout.rowSize })));
    if (tableRanges.length >= 40) {
        throw new FlagsError('FLAGS cutout exceeds 40 requests');
    }
    if (total(tableRanges) > maxBytes) {
        throw new FlagsError(`FLAGS cutout exceeds ${maxBytes} bytes`);
    }
    for (const range of tableRanges) {
        range.bytes = await rangeRead(fetcher, url, range, opts.signal);
    }
    for (const tile of tiles) {
        const raw = inside(tableRanges, layout.tableStart + tile.index * layout.rowSize + layout.descriptorOffset,
            layout.descriptor === 'P' ? 8 : 16);
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        let length: number;
        let offset: number;
        if (layout.descriptor === 'P') {
            length = view.getInt32(0, false);
            offset = view.getInt32(4, false);
        } else {
            const count = view.getBigInt64(0, false);
            const relative = view.getBigInt64(8, false);
            if (count < 0n || relative < 0n || count > BigInt(Number.MAX_SAFE_INTEGER) || relative > BigInt(Number.MAX_SAFE_INTEGER)) {
                throw new FlagsError('Unsafe Q descriptor');
            }
            length = Number(count);
            offset = Number(relative);
        }
        integer(length, 'compressed tile length', 1);
        integer(offset, 'compressed tile heap offset');
        const end = integer(offset + length, 'compressed tile heap end');
        if (end > layout.heapBytes) {
            throw new FlagsError('Compressed tile lies outside FLAGS heap');
        }
        // The table is untrusted: a tile longer than RICE_1 could ever write is refused before any byte is fetched.
        if (length > maxTileBytes(tile.width * tile.height, layout)) {
            throw new FlagsError('Compressed tile is longer than RICE_1 allows');
        }
        tile.start = layout.heapStart + offset;
        tile.length = length;
    }
    const heapRanges = merged(tiles);
    if (tableRanges.length + heapRanges.length > 40) {
        throw new FlagsError('FLAGS cutout exceeds 40 requests');
    }
    if (total(tableRanges) + total(heapRanges) > maxBytes) {
        throw new FlagsError(`FLAGS cutout exceeds ${maxBytes} bytes`);
    }
    for (const range of heapRanges) {
        range.bytes = await rangeRead(fetcher, url, range, opts.signal);
    }
    const width = box.x1 - box.x0;
    const height = box.y1 - box.y0;
    const data = new Int32Array(width * height);
    for (const tile of tiles) {
        let pixels: Int32Array;
        const count = tile.width * tile.height;
        try {
            pixels = riceDecode(inside(heapRanges, tile.start, tile.length), count, {
                blockSize: layout.blockSize,
                bytePix: layout.bytePix,
                maxPixels: count,
            });
        } catch (error) {
            throw new FlagsError(`Invalid RICE_1 FLAGS tile ${tile.index}`, { cause: error });
        }
        const x0 = Math.max(box.x0, tile.x);
        const x1 = Math.min(box.x1, tile.x + tile.width);
        for (let y = Math.max(box.y0, tile.y); y < Math.min(box.y1, tile.y + tile.height); y++) {
            const start = (y - tile.y) * tile.width + x0 - tile.x;
            data.set(pixels.subarray(start, start + x1 - x0), (y - box.y0) * width + x0 - box.x0);
        }
    }
    return { data, width, height };
}

export function flagMask(data: Int32Array, bits: number[]): Uint8Array
{
    let mask = 0;
    for (const bit of bits) {
        if (integer(bit, 'flag bit') > 31) {
            throw new FlagsError('Flag bit must be between 0 and 31');
        }
        mask |= 1 << bit;
    }
    return Uint8Array.from(data, value => (value & mask) !== 0 ? 1 : 0);
}
