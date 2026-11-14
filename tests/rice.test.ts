// @ts-expect-error Node built-ins are provided by Vitest; this project has no Node typings.
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error Test-only Node built-in, without a browser dependency.
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { RiceError, riceDecode } from '../src/lib/rice';

const root = new URL('./fixtures/flags/', import.meta.url);
const exists: (path: URL) => boolean = existsSync;
const readBytes: (path: URL) => Uint8Array = readFileSync;
const readText: (path: URL, encoding: 'utf8') => string = readFileSync;
const gunzip: (bytes: Uint8Array) => Uint8Array = gunzipSync;
const present = exists(new URL('fixture.json', root));

function int32(bytes: Uint8Array, offset: number): number
{
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true);
}

function packed(bits: string): Uint8Array
{
    const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
    return Uint8Array.from(padded.match(/.{8}/g) ?? [], part => parseInt(part, 2));
}

describe('RICE_1 wire cases', () => {
    it('repeats the seed for an all-zero difference block, including pixel zero', () => {
        expect(riceDecode(packed('00000000000000000000000000101010' + '00000'), 32,
            { blockSize: 32, bytePix: 4 })).toEqual(new Int32Array(32).fill(42));
    });

    it('decodes an escape block of raw mapped differences', () => {
        // Seed 10, selector 26 (fs=25); differences 0, +1, -2.
        const bits = '00000000000000000000000000001010' + '11010'
            + '00000000000000000000000000000000'
            + '00000000000000000000000000000010'
            + '00000000000000000000000000000011';
        expect(riceDecode(packed(bits), 3, { blockSize: 32, bytePix: 4 }))
            .toEqual(Int32Array.of(10, 11, 9));
    });

    it('reads unary quotients and low bits, then a short final block', () => {
        // Seed 5; fs=1: mapped 0,2,1 => 5,6,5; then a zero block.
        const bits = '00000101' + '010' + '10' + '010' + '11' + '000';
        expect(riceDecode(packed(bits), 5, { blockSize: 3, bytePix: 1 }))
            .toEqual(Int32Array.of(5, 6, 5, 5, 5));
    });

    it('preserves unsigned bytes, signed shorts, and int32 wraparound', () => {
        expect(riceDecode(packed('11111111' + '001' + '1' + '001'), 2,
            { blockSize: 32, bytePix: 1 })).toEqual(Int32Array.of(255, 0));
        expect(riceDecode(packed('0111111111111111' + '0001' + '1' + '001'), 2,
            { blockSize: 32, bytePix: 2 })).toEqual(Int32Array.of(32767, -32768));
        expect(riceDecode(packed('01111111111111111111111111111111' + '00001' + '1' + '001'), 2,
            { blockSize: 32, bytePix: 4 })).toEqual(Int32Array.of(2147483647, -2147483648));
    });

    it('throws on truncated seeds, selectors, unary codes, and raw blocks', () => {
        for (const bytes of [new Uint8Array(3), Uint8Array.of(0, 0, 0, 0),
            Uint8Array.of(0, 0, 0, 0, 8), packed('0'.repeat(32) + '11010' + '0'.repeat(31))]) {
            expect(() => riceDecode(bytes, 32, { blockSize: 32, bytePix: 4 })).toThrow(RiceError);
        }
    });

    it('rejects extra bytes, nonzero padding, invalid selectors and parameters', () => {
        for (const bytes of [Uint8Array.of(0, 0, 0, 0, 0, 0), Uint8Array.of(0, 0, 0, 0, 1),
            packed('0'.repeat(32) + '11111')]) {
            expect(() => riceDecode(bytes, 1, { blockSize: 32, bytePix: 4 })).toThrow(RiceError);
        }
        for (const n of [-1, 1.5, NaN]) {
            expect(() => riceDecode(new Uint8Array(), n, { blockSize: 32, bytePix: 4 })).toThrow(RiceError);
        }
        expect(() => riceDecode(new Uint8Array(), 1, { blockSize: 0, bytePix: 4 })).toThrow(RiceError);
        expect(riceDecode(new Uint8Array(), 0, { blockSize: 32, bytePix: 4 })).toEqual(new Int32Array());
        expect(() => riceDecode(Uint8Array.of(0), 0, { blockSize: 32, bytePix: 4 })).toThrow(RiceError);
    });
});

describe.skipIf(!present)('real FLAGS tiles (run scripts/make_flags_fixture.py if absent)', () => {
    it('matches astropy bit-for-bit for every saved tile and all 64 image rows', () => {
        const fixture = JSON.parse(readText(new URL('fixture.json', root), 'utf8')) as {
            layout: { width: number; blockSize: number; bytePix: 1 | 2 | 4 };
            rows: number[];
            tiles: { x: number; y: number; width: number; height: number; start: number; length: number; expectedOffset: number }[];
            heapRanges: { start: number; length: number; file: string }[];
        };
        const expected = gunzip(readBytes(new URL('tiles.i32.gz', root)));
        const rowOracle = readBytes(new URL('rows.i32', root));
        const rows = new Int32Array(fixture.rows.length * fixture.layout.width);
        for (const tile of fixture.tiles) {
            const range = fixture.heapRanges.find(part => part.start <= tile.start && part.start + part.length >= tile.start + tile.length)!;
            const heap = readBytes(new URL(range.file, root));
            const actual = riceDecode(heap.subarray(tile.start - range.start, tile.start - range.start + tile.length),
                tile.width * tile.height, fixture.layout);
            const oracle = new Int32Array(actual.length);
            for (let i = 0; i < actual.length; i++) {
                oracle[i] = int32(expected, tile.expectedOffset + i * 4);
            }
            expect(actual, `tile at (${tile.x}, ${tile.y})`).toEqual(oracle);
            for (let y = 0; y < tile.height; y++) {
                const row = fixture.rows.indexOf(tile.y + y);
                if (row >= 0) {
                    rows.set(actual.subarray(y * tile.width, (y + 1) * tile.width), row * fixture.layout.width + tile.x);
                }
            }
        }
        for (let i = 0; i < rows.length; i++) {
            expect(rows[i], `oracle row pixel ${i}`).toBe(int32(rowOracle, i * 4));
        }
    });
});
