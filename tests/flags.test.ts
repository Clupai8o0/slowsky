// @ts-expect-error Node built-ins are provided by Vitest; this project has no Node typings.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHeader } from '../src/lib/fits';
import { FlagsError, MAX_AXIS, flagMask, flagNames, parseFlagsLayout, readFlags } from '../src/lib/flags';
import type { FlagsLayout } from '../src/lib/flags';
import { RiceError, riceDecode } from '../src/lib/rice';
import type { CardValue, FitsHeader, PixelBox } from '../src/lib/types';

function header(changes: Record<string, CardValue | undefined> = {}): FitsHeader
{
    const cards = new Map<string, CardValue>(Object.entries({
        XTENSION: 'BINTABLE', BITPIX: 8, NAXIS: 2, NAXIS1: 12, NAXIS2: 4, PCOUNT: 32, GCOUNT: 1,
        TFIELDS: 2, TTYPE1: 'TAG', TFORM1: '1J', TTYPE2: 'COMPRESSED_DATA', TFORM2: '1PB(5)',
        THEAP: 60, ZIMAGE: true, ZCMPTYPE: 'RICE_1', ZBITPIX: 32, ZNAXIS: 2, ZNAXIS1: 5, ZNAXIS2: 3,
        ZTILE1: 3, ZTILE2: 2, ZNAME1: 'BLOCKSIZE', ZVAL1: 32, ZNAME2: 'BYTEPIX', ZVAL2: 4
    }));
    for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) {
            cards.delete(key);
        } else {
            cards.set(key, value);
        }
    }
    return { cards, history: [], get: key => cards.get(key), num(key)
    {
        const value = cards.get(key);
        if (typeof value !== 'number') {
            throw new Error(`Missing numeric card ${key}`);
        }
        return value;
    } };
}

// One table row, so a changed axis still matches the tile grid the old parser accepts.
function oneRow(changes: Record<string, CardValue | undefined> = {}): FitsHeader
{
    return header({ ZNAXIS2: 1, ZTILE2: 1, NAXIS2: 1, PCOUNT: 0, THEAP: 12, ...changes });
}

interface Segment { start: number; bytes: Uint8Array }

function server(segments: Segment[], status = 206, trim = 0)
{
    const calls: { start: number; length: number }[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
        const match = new Headers(init?.headers).get('Range')?.match(/^bytes=(\d+)-(\d+)$/);
        expect(match).toBeTruthy();
        const start = Number(match![1]);
        const length = Number(match![2]) - start + 1;
        calls.push({ start, length });
        const segment = segments.find(part => start >= part.start && start + length <= part.start + part.bytes.length);
        expect(segment, `request ${start}+${length} must stay inside a saved range`).toBeDefined();
        const body = segment!.bytes.slice(start - segment!.start, start - segment!.start + length - trim);
        return new Response(body, { status });
    };
    return { calls, fetcher };
}

function synthetic(q = false)
{
    const h = header(q ? { TFORM2: '1QB(5)', NAXIS1: 20, THEAP: 92 } : {});
    const layout = parseFlagsLayout(h, 1000);
    const table = new Uint8Array(layout.tableBytes);
    const view = new DataView(table.buffer);
    const heap = new Uint8Array(20);
    for (let i = 0; i < 4; i++) {
        if (q) {
            view.setBigInt64(i * layout.rowSize + 4, 5n);
            view.setBigInt64(i * layout.rowSize + 12, BigInt(i * 5));
        } else {
            view.setInt32(i * layout.rowSize + 4, 5);
            view.setInt32(i * layout.rowSize + 8, i * 5);
        }
        new DataView(heap.buffer).setInt32(i * 5, (i + 1) * 11);
    }
    return { h, layout, table, heap, segments: [{ start: 1000, bytes: table }, { start: layout.heapStart, bytes: heap }] };
}

// Encodes a tile as RICE_1 escape blocks (selector 26 for 32-bit pixels): the seed, then each mapped
// difference in 32 bits. Written for the tests only, so the decoder is checked against separate code.
function riceEscape(values: number[], blockSize = 32): Uint8Array
{
    const bits: number[] = [];
    const put = (value: number, count: number): void => {
        for (let i = count - 1; i >= 0; i--) {
            bits.push(Math.floor(value / 2 ** i) % 2);
        }
    };
    put(values[0]! >>> 0, 32);
    let last = values[0]!;
    for (let start = 0; start < values.length; start += blockSize) {
        put(26, 5);
        for (const value of values.slice(start, start + blockSize)) {
            const diff = value - last;
            put(diff >= 0 ? 2 * diff : -2 * diff - 1, 32);
            last = value;
        }
    }
    while (bits.length % 8) {
        bits.push(0);
    }
    return Uint8Array.from({ length: bits.length / 8 }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((a, b) => a * 2 + b, 0));
}

describe('FLAGS layouts and safety', () => {
    it('keeps row and column order inside 2-D tiles (a different value in every pixel)', async () => {
        const { layout } = synthetic();
        const value = (x: number, y: number): number => 100 * y + x - 7; // some values negative
        const tiles = [0, 1, 2, 3].map((index) => {
            const tx = index % 2;
            const ty = Math.floor(index / 2);
            const values: number[] = [];
            for (let y = 0; y < Math.min(2, 3 - ty * 2); y++) {
                for (let x = 0; x < Math.min(3, 5 - tx * 3); x++) {
                    values.push(value(tx * 3 + x, ty * 2 + y));
                }
            }
            return riceEscape(values);
        });
        const heap = new Uint8Array(tiles.reduce((sum, tile) => sum + tile.length, 0));
        const table = new Uint8Array(layout.tableBytes);
        const view = new DataView(table.buffer);
        let offset = 0;
        tiles.forEach((tile, i) => {
            view.setInt32(i * layout.rowSize + 4, tile.length);
            view.setInt32(i * layout.rowSize + 8, offset);
            heap.set(tile, offset);
            offset += tile.length;
        });
        const fake = server([{ start: 1000, bytes: table }, { start: layout.heapStart, bytes: heap }]);
        const whole = await readFlags('https://example.test/frame', { ...layout, heapBytes: heap.length }, { x0: 0, y0: 0, x1: 5, y1: 3 }, fake);
        expect(whole.data).toEqual(Int32Array.from({ length: 15 }, (_, i) => value(i % 5, Math.floor(i / 5))));
        const part = await readFlags('https://example.test/frame', { ...layout, heapBytes: heap.length }, { x0: 2, y0: 1, x1: 4, y1: 3 }, fake);
        expect(part.data).toEqual(Int32Array.of(value(2, 1), value(3, 1), value(2, 2), value(3, 2)));
    });

    it('refuses to read past the byte limit, and tiles longer than RICE_1 could write', async () => {
        const fixture = synthetic();
        const all = { x0: 0, y0: 0, x1: 5, y1: 3 };
        const first = server(fixture.segments);
        await expect(readFlags('x', fixture.layout, all, { ...first, maxBytes: 47 })).rejects.toThrow('exceeds 47 bytes');
        expect(first.calls).toEqual([]);
        const second = server(fixture.segments);
        await expect(readFlags('x', fixture.layout, all, { ...second, maxBytes: 60 })).rejects.toThrow('exceeds 60 bytes');
        expect(second.calls).toEqual([{ start: 1000, length: 48 }]);
        expect((await readFlags('x', fixture.layout, all, { ...server(fixture.segments), maxBytes: 68 })).data).toHaveLength(15);
        await expect(readFlags('x', fixture.layout, all, { ...server(fixture.segments), maxBytes: 0 })).rejects.toThrow(FlagsError);
        const long = synthetic();
        new DataView(long.table.buffer).setInt32(4, 200);
        const third = server(long.segments);
        await expect(readFlags('x', { ...long.layout, heapBytes: 100000 }, { x0: 0, y0: 0, x1: 1, y1: 1 }, third))
            .rejects.toThrow('longer than RICE_1 allows');
        expect(third.calls).toHaveLength(1);
    });

    it('refuses a 206 whose Content-Range names other bytes, and accepts a matching one', async () => {
        const fixture = synthetic();
        const all = { x0: 0, y0: 0, x1: 5, y1: 3 };
        const withRange = (shift: number): typeof fetch => async (url, init) => {
            const response = await server(fixture.segments).fetcher(url, init);
            const match = new Headers(init?.headers).get('Range')!.match(/^bytes=(\d+)-(\d+)$/)!;
            return new Response(await response.arrayBuffer(), { status: 206,
                headers: { 'Content-Range': `bytes ${Number(match[1]) + shift}-${Number(match[2]) + shift}/99999` } });
        };
        await expect(readFlags('x', fixture.layout, all, { fetcher: withRange(12) })).rejects.toThrow('other bytes');
        expect((await readFlags('x', fixture.layout, all, { fetcher: withRange(0) })).data).toHaveLength(15);
    });

    it('handles a preceding column, THEAP gap and 2-D partial edge tiles', async () => {
        const fixture = synthetic();
        expect(fixture.layout).toMatchObject({ width: 5, height: 3, tileWidth: 3, tileHeight: 2,
            rowSize: 12, rowCount: 4, tableStart: 1000, tableBytes: 48, heapStart: 1060,
            heapBytes: 20, descriptor: 'P', descriptorOffset: 4, blockSize: 32, bytePix: 4 });
        const fake = server(fixture.segments);
        const actual = await readFlags('https://example.test/frame', fixture.layout, { x0: 1, y0: 1, x1: 5, y1: 3 }, fake);
        expect(actual).toEqual({ data: Int32Array.of(11, 11, 22, 22, 33, 33, 44, 44), width: 4, height: 2 });
        expect(fake.calls).toEqual([{ start: 1000, length: 48 }, { start: 1060, length: 20 }]);
    });

    it('handles Q descriptors without truncating 64-bit fields', async () => {
        const fixture = synthetic(true);
        const fake = server(fixture.segments);
        expect((await readFlags('https://example.test/frame', fixture.layout,
            { x0: 3, y0: 2, x1: 5, y1: 3 }, fake)).data).toEqual(Int32Array.of(44, 44));
        const view = new DataView(fixture.table.buffer);
        view.setBigInt64(3 * 20 + 12, 9007199254740992n);
        await expect(readFlags('https://example.test/frame', fixture.layout,
            { x0: 3, y0: 2, x1: 5, y1: 3 }, fake)).rejects.toThrow(FlagsError);
    });

    it('uses standard absent THEAP and tiling defaults and named Rice parameters', () => {
        expect(parseFlagsLayout(header({ THEAP: undefined }), 1000).heapStart).toBe(1048);
        const h = header({ ZTILE1: undefined, ZTILE2: undefined, NAXIS2: 3, NAXIS1: 12,
            THEAP: undefined, ZNAME1: 'BYTEPIX', ZVAL1: 4, ZNAME2: 'BLOCKSIZE', ZVAL2: 16 });
        expect(parseFlagsLayout(h, 0)).toMatchObject({ tileWidth: 5, tileHeight: 1, blockSize: 16 });
    });

    it('throws FlagsError for unsupported encodings, scaling and malformed layouts', () => {
        const variants: Record<string, CardValue | undefined>[] = [
            { ZCMPTYPE: 'GZIP_1' }, { ZBITPIX: -32 }, { ZBITPIX: 64 }, { ZIMAGE: false },
            { ZNAXIS: 3 }, { ZQUANTIZ: 'SUBTRACTIVE_DITHER_1' }, { TTYPE1: 'ZSCALE' }, { TTYPE1: 'ZZERO' },
            { BSCALE: 2 }, { BZERO: 2147483648 }, { TSCAL2: 2 }, { ZZERO: 1 },
            { ZVAL2: 2 }, { ZVAL1: 0 }, { ZTILE1: 0 }, { NAXIS2: 5 }, { NAXIS1: 11 },
            { THEAP: 47 }, { THEAP: 81 }, { PCOUNT: -1 }, { TFORM2: '1PI(5)' },
            { TFORM2: '2PB(5)' }, { TFORM1: 'garbage' }, { TFIELDS: undefined },
            { ZNAME2: 'BLOCKSIZE' }, { ZVAL1: undefined }, { ZNAXIS1: 1.5 }
        ];
        for (const changes of variants) {
            expect(() => parseFlagsLayout(header(changes), 1000), JSON.stringify(changes)).toThrow(FlagsError);
        }
        expect(() => parseFlagsLayout(header(), -1)).toThrow(FlagsError);
        expect(() => parseFlagsLayout(header(), Number.MAX_SAFE_INTEGER)).toThrow(FlagsError);
    });

    it('refuses 200, short and over-long bodies', async () => {
        const fixture = synthetic();
        for (const [status, trim] of [[200, 0], [206, 1], [206, -1]]) {
            const fake = server(fixture.segments, status, trim);
            // For the over-long case, use a descriptor-only subrange so the saved table has one extra byte.
            await expect(readFlags('https://example.test/frame', fixture.layout,
                { x0: 0, y0: 0, x1: 1, y1: 1 }, fake)).rejects.toThrow(FlagsError);
        }
    });

    it('rejects null, negative, outside-heap descriptors and invalid Rice bytes', async () => {
        for (const [length, offset] of [[0, 0], [-1, 0], [5, -1], [6, 15]]) {
            const fixture = synthetic();
            const view = new DataView(fixture.table.buffer);
            view.setInt32(4, length!);
            view.setInt32(8, offset!);
            await expect(readFlags('x', fixture.layout, { x0: 0, y0: 0, x1: 1, y1: 1 }, server(fixture.segments)))
                .rejects.toThrow(FlagsError);
        }
        const fixture = synthetic();
        fixture.heap[4] = 255;
        await expect(readFlags('x', fixture.layout, { x0: 0, y0: 0, x1: 1, y1: 1 }, server(fixture.segments)))
            .rejects.toThrow(FlagsError);
    });

    it('enforces 40 requests before fetching disjoint heaps', async () => {
        const h = header({ ZNAXIS1: 1, ZNAXIS2: 40, ZTILE1: 1, ZTILE2: 1, NAXIS1: 8, NAXIS2: 40,
            TFIELDS: 1, TTYPE1: 'COMPRESSED_DATA', TFORM1: '1PB', THEAP: undefined, PCOUNT: 400 });
        const layout = parseFlagsLayout(h, 0);
        const table = new Uint8Array(320);
        const view = new DataView(table.buffer);
        for (let i = 0; i < 40; i++) {
            view.setInt32(i * 8, 5);
            view.setInt32(i * 8 + 4, i * 10);
        }
        const fake = server([{ start: 0, bytes: table }]);
        await expect(readFlags('x', layout, { x0: 0, y0: 0, x1: 1, y1: 40 }, fake)).rejects.toThrow(/40/);
        expect(fake.calls).toHaveLength(1);
    });

    it('rejects invalid boxes and honors aborts before any request', async () => {
        const fixture = synthetic();
        const fake = server(fixture.segments);
        for (const box of [{ x0: 0, y0: 0, x1: 0, y1: 1 }, { x0: -1, y0: 0, x1: 1, y1: 1 },
            { x0: 0, y0: 0, x1: 6, y1: 1 }, { x0: 0.5, y0: 0, x1: 1, y1: 1 }]) {
            await expect(readFlags('x', fixture.layout, box, fake)).rejects.toThrow(FlagsError);
        }
        await expect(readFlags('x', fixture.layout, { x0: 0, y0: 0, x1: 1, y1: 1 },
            { fetcher: fake.fetcher, signal: AbortSignal.abort() })).rejects.toThrow();
        expect(fake.calls).toHaveLength(0);
    });

    it('refuses an image, tile or block larger than a SPHEREx frame', () => {
        const huge = 2_147_483_647;
        expect(() => parseFlagsLayout(oneRow({ ZNAXIS1: huge, ZTILE1: huge, ZVAL1: huge, PCOUNT: 5 }), 1000))
            .toThrow(/ZNAXIS1/);
        expect(() => parseFlagsLayout(oneRow({ ZNAXIS1: MAX_AXIS + 1, ZTILE1: MAX_AXIS + 1 }), 0)).toThrow(/ZNAXIS1/);
        expect(() => parseFlagsLayout(header({
            ZNAXIS1: 1, ZNAXIS2: MAX_AXIS + 1, ZTILE1: 1, ZTILE2: 1, NAXIS2: MAX_AXIS + 1,
            PCOUNT: 0, THEAP: 12 * (MAX_AXIS + 1),
        }), 0)).toThrow(/ZNAXIS2/);
        expect(() => parseFlagsLayout(oneRow({ ZNAXIS1: 8, ZTILE1: 9 }), 0)).toThrow(/ZTILE1/);
        expect(() => parseFlagsLayout(header({
            ZNAXIS1: 4, ZNAXIS2: 4, ZTILE1: 4, ZTILE2: 5, NAXIS2: 1, PCOUNT: 0, THEAP: 12,
        }), 0)).toThrow(/ZTILE2/);
        expect(() => parseFlagsLayout(oneRow({ ZNAXIS1: 2040, ZTILE1: 2040, ZVAL1: 2048 }), 0)).toThrow(/BLOCKSIZE/);
        expect(() => parseFlagsLayout(header({ ZVAL1: 48 }), 1000)).toThrow(/BLOCKSIZE/);
        expect(parseFlagsLayout(oneRow({ ZNAXIS1: MAX_AXIS, ZTILE1: MAX_AXIS }), 0).width).toBe(MAX_AXIS);
        expect(parseFlagsLayout(oneRow({ ZNAXIS1: 1024, ZTILE1: 1024, ZVAL1: 1024 }), 0).blockSize).toBe(1024);
    });

    it('refuses a forged huge tile before fetching its heap', async () => {
        const huge = 2_147_483_647;
        const layout: FlagsLayout = {
            width: huge, height: 1, tileWidth: huge, tileHeight: 1, tilesAcross: 1,
            rowSize: 8, rowCount: 1, tableStart: 0, tableBytes: 8, heapStart: 8, heapBytes: 5,
            descriptor: 'P', descriptorOffset: 0, blockSize: huge, bytePix: 4,
        };
        const calls: string[] = [];
        const fetcher: typeof fetch = async (_url, init) => {
            calls.push(new Headers(init?.headers).get('Range') ?? '');
            return new Response(new Uint8Array(5));
        };
        const started = performance.now();
        await expect(readFlags('x', layout, { x0: 0, y0: 0, x1: 1, y1: 1 }, { fetcher }))
            .rejects.toThrow('FLAGS cutout would decode too many pixels');
        expect(performance.now() - started).toBeLessThan(1000);
        expect(calls).toEqual([]);
    });

    it('refuses a cutout whose tiles would decode more than 4096 x 4096 pixels, before any fetch', async () => {
        const side = MAX_AXIS;
        const layout: FlagsLayout = {
            width: side, height: side * 2, tileWidth: side, tileHeight: side, tilesAcross: 1,
            rowSize: 8, rowCount: 2, tableStart: 0, tableBytes: 16, heapStart: 16, heapBytes: 8,
            descriptor: 'P', descriptorOffset: 0, blockSize: 32, bytePix: 4,
        };
        let calls = 0;
        const fetcher: typeof fetch = async () => {
            calls += 1;
            return new Response(new Uint8Array(5));
        };
        await expect(readFlags('x', layout, { x0: 0, y0: 0, x1: side, y1: side * 2 }, { fetcher }))
            .rejects.toThrow('FLAGS cutout would decode too many pixels');
        expect(calls).toBe(0);
    });

    it('still fetches a tile that decodes to exactly 2048 x 2048 pixels', async () => {
        const side = 2048;
        const layout: FlagsLayout = {
            width: side, height: side, tileWidth: side, tileHeight: side, tilesAcross: 1,
            rowSize: 8, rowCount: 1, tableStart: 0, tableBytes: 8, heapStart: 8, heapBytes: 5,
            descriptor: 'P', descriptorOffset: 0, blockSize: 32, bytePix: 4,
        };
        let calls = 0;
        const fetcher: typeof fetch = async () => {
            calls += 1;
            return new Response(new Uint8Array(0), { status: 200 });
        };
        await expect(readFlags('x', layout, { x0: 0, y0: 0, x1: side, y1: side }, { fetcher })).rejects.toThrow(FlagsError);
        expect(calls).toBe(1);
    });

    it('rejects excessive tile counts before allocating or fetching', async () => {
        const layout = parseFlagsLayout(header({ ZNAXIS1: 1024, ZNAXIS2: 1024, ZTILE1: 1, ZTILE2: 1,
            NAXIS1: 8, NAXIS2: 1048576, TFIELDS: 1, TTYPE1: 'COMPRESSED_DATA', TFORM1: '1PB',
            PCOUNT: 0, THEAP: undefined }), 0);
        let calls = 0;
        const fetcher: typeof fetch = async () => { calls++; throw new Error('unexpected fetch'); };
        const started = performance.now();
        const result = readFlags('x', layout, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, { fetcher });
        await expect(result).rejects.toThrow(FlagsError);
        await expect(result).rejects.toThrow(/tile count/i);
        expect(performance.now() - started).toBeLessThan(200);
        expect(calls).toBe(0);
    });

    it('rejects an oversized tile and mismatched table row counts', () => {
        const oversized = header({ ZNAXIS1: 4096, ZNAXIS2: 4096, ZTILE1: 4096, ZTILE2: 4096,
            NAXIS1: 8, NAXIS2: 1, TFIELDS: 1, TTYPE1: 'COMPRESSED_DATA', TFORM1: '1PB',
            PCOUNT: 327684, THEAP: undefined });
        expect(() => parseFlagsLayout(oversized, 0)).toThrow(/tile size/i);
        for (const rows of [3, 5]) {
            expect(() => parseFlagsLayout(header({ NAXIS2: rows, THEAP: undefined }), 0)).toThrow(/row count/i);
        }
    });

    it('bounds cutout pixels while accepting the exact limit and real image dimensions', async () => {
        const makeLayout = (side: number) => parseFlagsLayout(header({ ZNAXIS1: side, ZNAXIS2: side,
            ZTILE1: side, ZTILE2: 1, NAXIS1: 8, NAXIS2: side, TFIELDS: 1, TTYPE1: 'COMPRESSED_DATA',
            TFORM1: '1PB', PCOUNT: 0, THEAP: undefined }), 0);
        const layout = makeLayout(4096);
        let calls = 0;
        const fetcher: typeof fetch = async () => { calls++; return new Response(null, { status: 200 }); };
        await expect(readFlags('x', layout, { x0: 0, y0: 0, x1: 2049, y1: 2048 }, { fetcher }))
            .rejects.toThrow(/too many pixels/i);
        expect(calls).toBe(0);
        await expect(readFlags('x', layout, { x0: 0, y0: 0, x1: 2048, y1: 2048 }, { fetcher }))
            .rejects.toThrow(/206/);
        expect(calls).toBe(1);
        const real = makeLayout(2040);
        await expect(readFlags('x', real, { x0: 0, y0: 0, x1: 2040, y1: 2040 }, { fetcher }))
            .rejects.toThrow(/206/);
        expect(calls).toBe(2);
    });

    it('rejects non-integer or non-finite dimensions before reading', async () => {
        const layout = synthetic().layout;
        let calls = 0;
        const fetcher: typeof fetch = async () => { calls++; throw new Error('unexpected fetch'); };
        for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
            for (const key of ['width', 'height', 'tileWidth', 'tileHeight'] as const) {
                await expect(readFlags('x', { ...layout, [key]: value },
                    { x0: 0, y0: 0, x1: 1, y1: 1 }, { fetcher })).rejects.toThrow(FlagsError);
            }
            expect(() => parseFlagsLayout(header({ ZTILE1: value }), 0)).toThrow(FlagsError);
        }
        expect(calls).toBe(0);
    });

    it('decodes 100 pixels at maxPixels 100 and refuses 101', () => {
        const values = Array.from({ length: 101 }, (_, i) => i - 50);
        const over = riceEscape(values);
        expect(() => riceDecode(over, 101, { blockSize: 32, bytePix: 4, maxPixels: 100 })).toThrow(RiceError);
        const fitted = riceEscape(values.slice(0, 100));
        expect(riceDecode(fitted, 100, { blockSize: 32, bytePix: 4, maxPixels: 100 }))
            .toEqual(Int32Array.from(values.slice(0, 100)));
    });
});

describe('flag names and masks', () => {
    it('uses the real MSKN bit numbering and checks matching MSKM values', () => {
        expect(flagNames(header({ MSKN0010: 'HOT', MSKM0010: 1024, MSKN0001: 'OVERFLOW', MSKM0001: 2 })))
            .toEqual([{ bit: 1, name: 'OVERFLOW' }, { bit: 10, name: 'HOT' }]);
        expect(flagNames(header())).toEqual([]);
        expect(() => flagNames(header({ MSKN0001: 'OVERFLOW', MSKM0001: 4 }))).toThrow(FlagsError);
        expect(() => flagNames(header({ MSKN0032: 'INVALID' }))).toThrow(FlagsError);
    });

    it('marks any selected bit, including bit 31, and rejects invalid bit numbers', () => {
        const data = Int32Array.of(0, 1, 2, 3, 1024, -2147483648, -1);
        expect(flagMask(data, [1, 10])).toEqual(Uint8Array.of(0, 0, 1, 1, 1, 0, 1));
        expect(flagMask(data, [31])).toEqual(Uint8Array.of(0, 0, 0, 0, 0, 1, 1));
        expect(flagMask(data, [])).toEqual(new Uint8Array(7));
        for (const bit of [-1, 32, 0.5, NaN]) {
            expect(() => flagMask(data, [bit])).toThrow(FlagsError);
        }
    });
});

const root = new URL('./fixtures/flags/', import.meta.url);
const exists: (path: URL) => boolean = existsSync;
const readBytes: (path: URL) => Uint8Array = readFileSync;
const readText: (path: URL, encoding: 'utf8') => string = readFileSync;
const present = exists(new URL('fixture.json', root));

describe.skipIf(!present)('real FLAGS fixture (run scripts/make_flags_fixture.py if absent)', () => {
    it('parses the downloaded header and matches every recorded layout value and flag name', () => {
        const fixture = JSON.parse(readText(new URL('fixture.json', root), 'utf8')) as {
            hduDataStart: number; layout: unknown; flagNames: { bit: number; name: string }[];
            theapCard: number | null; pcount: number;
        };
        const h = parseHeader(readBytes(new URL('header.bin', root)));
        expect(parseFlagsLayout(h, fixture.hduDataStart)).toEqual(fixture.layout);
        expect(flagNames(h)).toEqual(fixture.flagNames);
        expect(h.get('THEAP') ?? null).toBe(fixture.theapCard);
        expect(h.num('PCOUNT')).toBe(fixture.pcount);
    });

    it('range-reads both boxes exactly like astropy, coalescing adjacent tile heaps', async () => {
        const fixture = JSON.parse(readText(new URL('fixture.json', root), 'utf8')) as {
            url: string; hduDataStart: number; box: PixelBox; crossBox: PixelBox;
            heapRanges: { start: number; length: number; file: string }[];
        };
        const layout = parseFlagsLayout(parseHeader(readBytes(new URL('header.bin', root))), fixture.hduDataStart);
        const segments = [{ start: fixture.hduDataStart, bytes: readBytes(new URL('table.bin', root)) },
            ...fixture.heapRanges.map(range => ({ start: range.start, bytes: readBytes(new URL(range.file, root)) }))];
        for (const [name, box] of [['box', fixture.box], ['cross', fixture.crossBox]] as const) {
            const fake = server(segments);
            const actual = await readFlags(fixture.url, layout, box, fake);
            const bytes = readBytes(new URL(`${name}.i32`, root));
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const oracle = Int32Array.from({ length: bytes.length / 4 }, (_, i) => view.getInt32(i * 4, true));
            expect(actual).toEqual({ data: oracle, width: box.x1 - box.x0, height: box.y1 - box.y0 });
            expect(fake.calls.length).toBeLessThanOrEqual(40);
            expect(fake.calls).toHaveLength(2);
            for (const [status, trim] of [[200, 0], [206, 1]]) {
                await expect(readFlags(fixture.url, layout, box, server(segments, status, trim))).rejects.toThrow(FlagsError);
            }
        }
    });
});
