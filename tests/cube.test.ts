// Live read on 2026-11-14, Npix11391: 114 requests, 2,126,352 bytes, 23.44 s;
// plane 62 was 0.2222884893 MJy/sr; the former methane index 0.482462641 was invalid.
// @ts-expect-error Node built-in is available in Vitest; no browser dependency.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-in is available in Vitest; no browser dependency.
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { CubeError, cubeSpot, LINES, clearCubeCache, findCubeFolder, CUBE_FOLDER, CUBE_CAPTION, readCubeSpectrum } from '../src/lib/cube';
import fixture from './fixtures/cube/fixture.json';

const directory = new URL('./fixtures/cube/', import.meta.url);
type Spot = typeof fixture.spots[number];

function bytes(file: string): Uint8Array
{
    return Uint8Array.from(readFileSync(new URL(file, directory)));
}

function fake(spot: Spot, override?: (data: Uint8Array, plane?: number) => Response | undefined)
{
    const tile = fixture.tiles.find(tile => tile.tile === spot.tile)!;
    const headers = bytes(tile.headerFile);
    const planes: Uint8Array = gunzipSync(bytes(spot.file));
    const calls: { start: number; length: number; plane?: number }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
        expect(String(input)).toBe(spot.url);
        init?.signal?.throwIfAborted();
        const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('Range') ?? '');
        expect(match).not.toBeNull();
        const start = Number(match![1]);
        const length = Number(match![2]) - start + 1;
        const header = tile.requests.find(item => item.offset === start && item.length === length);
        const initial = start === 0 && length === 8640;
        const plane = spot.requests.find(item => item.offset === start && item.length === length);
        expect(header ?? plane ?? (initial ? true : undefined), `unrecorded range ${start}+${length}`).toBeDefined();
        calls.push({ start, length, plane: plane?.plane });
        let data: Uint8Array;
        if (initial) {
            data = headers.slice(0, length);
        } else if (header) {
            data = headers.slice(header.fileOffset, header.fileOffset + length);
        } else {
            const item = plane!;
            const packed = planes.subarray(item.fileOffset, item.fileOffset + item.storedLength);
            if (spot.encoding === 'gzip-box-pixels') {
                data = new Uint8Array(length);
                const view = new DataView(data.buffer);
                for (let i = 0; i + 4 <= length; i += 4) {
                    view.setFloat32(i, 1e30, false);
                }
                const rowBytes = (spot.box[2]! - spot.box[0]!) * 4;
                for (let row = 0; row < spot.box[3]! - spot.box[1]!; row++) {
                    data.set(packed.subarray(row * rowBytes, (row + 1) * rowBytes), row * tile.width * 4);
                }
            } else {
                data = Uint8Array.from(packed);
            }
        }
        return override?.(data, plane?.plane) ?? new Response(data.slice().buffer, { status: 206 });
    };
    return { fetcher, calls, tile };
}

function close(actual: number, expected: number | null): void
{
    if (expected === null) {
        expect(actual).toBeNaN();
    } else {
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(expected) * 1e-5));
    }
}

describe('IRSA DR1 cube range reader', () => {
    beforeEach(() => clearCubeCache());
    it('marks a plane with any missing central pixel as no data', async () => {
        const spot = fixture.spots[0]!;
        const server = fake(spot, (data, plane) => {
            if (plane === 0) {
                new DataView(data.buffer, data.byteOffset, data.byteLength).setFloat32((5 * 512 + 5) * 4, NaN, false);
            }
            return undefined;
        });
        const result = await readCubeSpectrum(spot.coord, { fetcher: server.fetcher });
        expect(result.surfaceBrightness[0]).toBeNaN();
        expect(result.reasons[0]).toBe('no data');
        expect(result.notes.join(' ')).toMatch(/planes have no data at the centre/);
        expect(Number.isFinite(result.surfaceBrightness[1])).toBe(true);
    });

    it('requires eight finite background pixels for noise', async () => {
        const spot = fixture.spots[0]!;
        const server = fake(spot, (data, plane) => {
            if (plane === 0) {
                const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
                for (let y = 0; y < 11; y++) {
                    for (let x = 0; x < 11; x++) {
                        if ((x - 5) ** 2 + (y - 5) ** 2 >= 9 && (y * 11 + x) > 6) {
                            view.setFloat32((y * 512 + x) * 4, NaN, false);
                        }
                    }
                }
            }
            return undefined;
        });
        const result = await readCubeSpectrum(spot.coord, { fetcher: server.fetcher });
        expect(result.noise[0]).toBeNaN();
        expect(Number.isFinite(result.surfaceBrightness[0])).toBe(true);
    });

    it('reads all channels when BLANKCH is missing or malformed', async () => {
        const spot = fixture.spots[0]!;
        for (const card of ['        ', "'D3:99' "]) {
            clearCubeCache();
            const server = fake(spot, (data, plane) => {
                if (plane === undefined && data.length === 8640) {
                    const text = new TextDecoder().decode(data);
                    const at = text.indexOf('BLANKCH');
                    if (card.startsWith(' ')) {
                        data.set(new TextEncoder().encode('        '), at);
                    } else {
                        data.set(new TextEncoder().encode(card), at + 10);
                    }
                }
                return undefined;
            });
            await readCubeSpectrum(spot.coord, { fetcher: server.fetcher });
            expect(server.calls.filter(call => call.plane !== undefined)).toHaveLength(102);
        }
    });

    it('uses the supplied folder and accepts the box size endpoints', async () => {
        const spot = fixture.spots[0]!;
        for (const boxPx of [5, 31]) {
            const fetcher: typeof fetch = async input => {
                expect(String(input)).toContain('/hips_20261101/');
                throw new Error('test stopped after validation');
            };
            await expect(readCubeSpectrum(spot.coord, { fetcher, boxPx, folder: 'hips_20261101' }))
                .rejects.toThrow('test stopped after validation');
        }
    });
    for (const spot of fixture.spots) {
        it(`locates ${spot.name} and reproduces its independent numpy spectrum`, async () => {
            const location = cubeSpot(spot.coord);
            expect(location.tile).toBe(spot.tile);
            expect(location.url).toBe(spot.url);
            expect(location.x).toBeCloseTo(spot.x, 7);
            expect(location.y).toBeCloseTo(spot.y, 7);
            const server = fake(spot);
            const result = await readCubeSpectrum(spot.coord, { fetcher: server.fetcher });
            expect(result.lambda).toBeInstanceOf(Float64Array);
            expect(result.surfaceBrightness).toBeInstanceOf(Float32Array);
            expect(result.background).toBeInstanceOf(Float32Array);
            expect(result.surfaceBrightness.length).toBe(102);
            expect(result.surfaceBrightness[50]).toBeNaN();
            expect(result.surfaceBrightness[51]).toBeNaN();
            expect(result.background[50]).toBeNaN();
            expect(result.background[51]).toBeNaN();
            for (let plane = 0; plane < 102; plane++) {
                close(result.surfaceBrightness[plane]!, spot.flux[plane]!);
                close(result.background[plane]!, spot.background[plane]!);
                expect(Math.abs(result.lambda[plane]! - server.tile.lambda[plane]!)).toBeLessThan(0.001);
            }
            expect(result.unit).toBe(server.tile.unit);
            expect(result.reasons.filter(Boolean).length).toBe(spot.flux.filter(value => value === null).length);
            for (let plane = 0; plane < 102; plane++) {
                close(result.noise[plane]!, spot.noise[plane]!);
            }
            expect(server.calls.filter(item => item.plane !== undefined)).toHaveLength(100);
            expect(result.caption).toBe(CUBE_CAPTION);
            expect(result.notes.some(note => note.includes('clipped'))).toBe(spot.clipped);
        });
    }

    for (const mode of ['200', 'short', 'failed'] as const) {
        it(`rejects a ${mode} plane response and identifies the plane`, async () => {
            const spot = fixture.spots[0]!;
            const server = fake(spot, (data, plane) => {
                if (plane !== 4) {
                    return undefined;
                }
                if (mode === 'failed') {
                    throw new Error('network failed');
                }
                return new Response(data.slice(0, mode === 'short' ? data.length - 1 : data.length).buffer,
                    { status: mode === '200' ? 200 : 206 });
            });
            await expect(readCubeSpectrum(spot.coord, { fetcher: server.fetcher, concurrency: 1 }))
                .rejects.toThrow(/plane 4/i);
            expect(server.calls.filter(item => item.plane !== undefined)).toHaveLength(5);
        });
    }

    it('rejects bad header ranges with CubeError', async () => {
        const spot = fixture.spots[0]!;
        for (const status of [200, 206]) {
            const server = fake(spot, data => new Response(data.slice(0, status === 206 ? 1 : data.length).buffer, { status }));
            await expect(readCubeSpectrum(spot.coord, { fetcher: server.fetcher })).rejects.toBeInstanceOf(CubeError);
            expect(server.calls).toHaveLength(1);
        }
    });

    it('caps concurrent planes at eight and aborts in-flight and queued requests', async () => {
        const spot = fixture.spots[0]!;
        const server = fake(spot);
        const controller = new AbortController();
        let active = 0;
        let maximum = 0;
        let started = 0;
        let cancelled = 0;
        const fetcher: typeof fetch = async (input, init) => {
            const pending = server.fetcher(input, init);
            const plane = server.calls.at(-1)?.plane;
            const response = await pending;
            if (plane === undefined) {
                return response;
            }
            started++;
            active++;
            maximum = Math.max(maximum, active);
            await new Promise<void>((resolve, reject) => {
                const abort = (): void => {
                    clearTimeout(timer);
                    active--;
                    cancelled++;
                    reject(new Error('aborted'));
                };
                const timer = setTimeout(() => {
                    init?.signal?.removeEventListener('abort', abort);
                    active--;
                    resolve();
                }, 5);
                init?.signal?.addEventListener('abort', abort, { once: true });
                if (started === 8) {
                    controller.abort();
                }
            });
            return response;
        };
        await expect(readCubeSpectrum(spot.coord, { fetcher, signal: controller.signal, concurrency: 99 }))
            .rejects.toBeInstanceOf(CubeError);
        expect(maximum).toBe(8);
        expect(started).toBe(8);
        expect(cancelled).toBe(8);
        expect(active).toBe(0);
    });

    it('does no work for an already aborted signal or invalid box/concurrency', async () => {
        const spot = fixture.spots[0]!;
        const server = fake(spot);
        const controller = new AbortController();
        controller.abort();
        await expect(readCubeSpectrum(spot.coord, { fetcher: server.fetcher, signal: controller.signal })).rejects.toBeInstanceOf(CubeError);
        for (const boxPx of [1, 3, 8, 0, 33, NaN]) {
            await expect(readCubeSpectrum(spot.coord, { fetcher: server.fetcher, boxPx })).rejects.toBeInstanceOf(CubeError);
        }
        for (const concurrency of [0, -1, 1.5, NaN]) {
            await expect(readCubeSpectrum(spot.coord, { fetcher: server.fetcher, concurrency })).rejects.toBeInstanceOf(CubeError);
        }
        expect(server.calls).toHaveLength(0);
    });

    it('cancels a stalled response body when the fetcher has already returned', async () => {
        const spot = fixture.spots[0]!;
        const controller = new AbortController();
        let cancelled = false;
        let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
        const server = fake(spot, (_, plane) => {
            if (plane !== 0) {
                return undefined;
            }
            const body = new ReadableStream<Uint8Array>({
                start(value)
                {
                    streamController = value;
                    setTimeout(() => controller.abort(), 0);
                },
                cancel()
                {
                    cancelled = true;
                }
            });
            return new Response(body, { status: 206 });
        });
        const pending = readCubeSpectrum(spot.coord, { fetcher: server.fetcher, signal: controller.signal, concurrency: 1 });
        const result = await Promise.race([
            pending.then(() => 'resolved', error => error instanceof CubeError ? 'aborted' : 'other'),
            new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 50))
        ]);
        if (result === 'timeout') {
            streamController?.close();
            await pending.catch(() => undefined);
        }
        expect(result).toBe('aborted');
        expect(cancelled).toBe(true);
        expect(server.calls.filter(item => item.plane !== undefined)).toHaveLength(1);
    });

    it('reads BSCALE/BZERO from IMAGE and scales source and background correctly', async () => {
        const spot = fixture.spots[0]!;
        let changed = false;
        const server = fake(spot, (data, plane) => {
            if (plane === undefined && new TextDecoder().decode(data).includes('END     ') && !changed) {
                const text = new TextDecoder().decode(data);
                if (text.includes('BUNIT')) {
                    const end = text.indexOf('END     ', text.indexOf('BUNIT'));
                    const replacement = "BSCALE  =                  2.0".padEnd(80) + "BZERO   =                  7.0".padEnd(80) + 'END'.padEnd(80);
                    data.set(new TextEncoder().encode(replacement), end);
                    changed = true;
                }
            }
            return undefined;
        });
        const result = await readCubeSpectrum(spot.coord, { fetcher: server.fetcher });
        expect(changed).toBe(true);
        close(result.surfaceBrightness[0]!, spot.flux[0]! * 2);
        close(result.background[0]!, spot.background[0]! * 2 + 7);
    });

    it('labels spectral features without making a detection claim', () => {
        expect(LINES.map(line => line.um)).toEqual([1.083, 1.875, 3.05, 3.3, 4.05, 4.27, 4.67]);
        expect(LINES.find(line => line.label.includes('PAH'))).toBeDefined();
    });

    it('finds the newest cube folder and falls back on failure', async () => {
        const list = '<ListBucketResult><CommonPrefixes><Prefix>dr1/hips5_cube/hips_20261026/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>dr1/hips5_cube/hips_20261101/</Prefix></CommonPrefixes></ListBucketResult>';
        expect(await findCubeFolder(async () => new Response(list))).toBe('hips_20261101');
        expect(await findCubeFolder(async () => { throw new Error('offline'); })).toBe(CUBE_FOLDER);
        expect(await findCubeFolder(async () => new Response('<html>hips_20990101</html>'))).toBe(CUBE_FOLDER);
        expect(await findCubeFolder(async () => new Response('', { status: 500 }))).toBe(CUBE_FOLDER);
    });

    it('starts planes early, skips blank channels, and caches headers and wavelengths', async () => {
        const spot = fixture.spots[0]!;
        const server = fake(spot);
        await readCubeSpectrum(spot.coord, { fetcher: server.fetcher });
        const firstPlane = server.calls.findIndex(call => call.plane !== undefined);
        expect(firstPlane).toBeLessThanOrEqual(3);
        expect(server.calls.some(call => call.plane === 50 || call.plane === 51)).toBe(false);
        const first = server.calls.length;
        expect(first).toBe(110);
        await readCubeSpectrum(spot.coord, { fetcher: server.fetcher });
        expect(server.calls.slice(first)).toHaveLength(100);
        expect(server.calls.slice(first).every(call => call.plane !== undefined)).toBe(true);
    });
});
