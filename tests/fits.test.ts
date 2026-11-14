// @ts-expect-error Node built-in is available in Vitest; no browser dependency.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRangeReader, parseHeader } from '../src/lib/fits';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/frame/${name}`, import.meta.url));
const frame = JSON.parse(fixture('frame1.json').toString());
const wave = JSON.parse(fixture('frame1.wave.json').toString());
const url = 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/test.fits';

function header(cards: string[]): Uint8Array
{
    const text = [...cards, 'END'].map(card => card.padEnd(80)).join('');
    return new TextEncoder().encode(text.padEnd(Math.ceil(text.length / 2880) * 2880));
}

function image(name: string, scale = 1): Uint8Array
{
    const result = new Uint8Array(5760);
    result.set(header(["XTENSION= 'IMAGE'", 'BITPIX  = -32', 'NAXIS   = 2', 'NAXIS1  = 4', 'NAXIS2  = 3', `EXTNAME = '${name}'`, `BSCALE  = ${scale}`, 'BZERO   = 10']));
    const view = new DataView(result.buffer);
    for (let i = 0; i < 12; i++) {
        view.setFloat32(2880 + i * 4, i + 0.5);
    }
    return result;
}

function synthetic(): Uint8Array
{
    const parts = [header(['SIMPLE  = T', 'BITPIX  = 8', 'NAXIS   = 0']), image('IMAGE', 2), image('ZODI'), fixture('frame1.wcswave.bin')];
    const data = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        data.set(part, offset);
        offset += part.length;
    }
    return data;
}

function server(data: Uint8Array, visible = true)
{
    const calls: { url: string; start: number; end: number }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
        init?.signal?.throwIfAborted();
        if (init?.method === 'HEAD') {
            return new Response(null, { headers: { 'Content-Length': String(data.length) } });
        }
        const range = new Headers(init?.headers).get('Range')!;
        const [, lo, hi] = /bytes=(\d+)-(\d+)/.exec(range)!;
        const start = Number(lo);
        const end = Number(hi);
        calls.push({ url: String(input), start, end });
        return new Response(data.slice(start, end + 1), { status: 206, headers: visible ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {} });
    };
    return { fetcher, calls };
}

describe('FITS range reader', () => {
    it('parses every real image header keyword', () => {
        const parsed = parseHeader(fixture('frame1.image-header.bin'));
        for (const [key, value] of Object.entries(frame.imageHeader)) {
            expect(parsed.get(key), key).toEqual(value);
        }
        expect(() => parsed.num('MISSING')).toThrow();
        expect(() => parsed.num('EXTNAME')).toThrow();
    });

    it('parses quoted strings, CONTINUE, D exponents and commentary', () => {
        const parsed = parseHeader(header(["TEXT    = 'it''s / a & ' / comment", "LONG    = 'first&'", "CONTINUE  'last   '", 'NUMBER  = -1.25D+2 / value', 'BOOL    = F', 'HISTORY a step', 'COMMENT a comment', '        blank']));
        expect(parsed.get('TEXT')).toBe("it's / a &");
        expect(parsed.get('LONG')).toBe('firstlast');
        expect(parsed.num('NUMBER')).toBe(-125);
        expect(parsed.get('BOOL')).toBe(false);
        expect(parsed.history).toContain('a step');
        expect(() => parseHeader(new Uint8Array(2880))).toThrow();
    });

    it('indexes, caches, reads scaled boxes and alternates chunk hosts', async () => {
        const { fetcher, calls } = server(synthetic(), false);
        const reader = createRangeReader({ fetch: fetcher, maxParallel: 3 });
        const index = await reader.index(url);
        expect(index.hdus.map(hdu => [hdu.headerStart, hdu.dataStart, hdu.dataBytes])).toEqual([[0, 2880, 0], [2880, 5760, 48], [8640, 11520, 48], [14400, 17280, 720]]);
        expect(calls).toHaveLength(1);
        const count = calls.length;
        expect(await reader.index(url)).toBe(index);
        expect(calls).toHaveLength(count);
        expect(Array.from(await reader.readFloat32(index, 'IMAGE', { x0: 1, y0: 0, x1: 3, y1: 3 }))).toEqual([13, 15, 21, 23, 29, 31]);
        const chunks = calls.slice(count);
        expect(chunks.map(call => new URL(call.url).hostname)).toEqual(['nasa-irsa-spherex.s3.us-east-1.amazonaws.com', 'nasa-irsa-spherex.s3.amazonaws.com', 'nasa-irsa-spherex.s3.us-east-1.amazonaws.com']);
        expect(chunks.map(call => call.end - call.start + 1)).toEqual([16, 16, 16]);
        expect(() => index.hdu('absent')).toThrow();
    });

    it('decodes the real wavelength table exactly with zero-based coordinates', async () => {
        const reader = createRangeReader({ fetch: server(synthetic()).fetcher });
        const grid = await reader.readWaveGrid(await reader.index(url));
        expect(grid.xs).toEqual(wave.X.map((x: number) => x - 1));
        expect(grid.ys).toEqual(wave.Y.map((y: number) => y - 1));
        expect(grid.lambda).toEqual(wave.VALUES.map((row: number[][]) => row.map(pair => pair[0])));
        expect(grid.bandwidth).toEqual(wave.VALUES.map((row: number[][]) => row.map(pair => pair[1])));
    });

    it.each([200, -1, 1])('rejects invalid status or body length (%s)', async mode => {
        const fetcher: typeof fetch = async () => new Response(new Uint8Array(mode === -1 ? 0 : 2), { status: mode === 200 ? 200 : 206 });
        await expect(createRangeReader({ fetch: fetcher }).index(url)).rejects.toThrow();
    });

    it('rejects and cancels an oversized range stream that never ends', async () => {
        let source!: ReadableStreamDefaultController<Uint8Array>;
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
            start(controller)
            {
                source = controller;
                controller.enqueue(new Uint8Array(11 * 2880));
                controller.enqueue(new Uint8Array(1));
            },
            cancel()
            {
                cancelled = true;
            },
        });
        const fetcher: typeof fetch = async () => new Response(body, { status: 206 });
        const pending = createRangeReader({ fetch: fetcher }).index(url);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await expect(Promise.race([
                pending,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Range read did not stop after exceeding length')), 200);
                }),
            ])).rejects.toThrow('Wrong range body length: expected 31680, received 31681');
            expect(cancelled).toBe(true);
            expect(body.locked).toBe(false);
        } finally {
            clearTimeout(timer);
            if (!cancelled) {
                source.close();
            }
            await pending.catch(() => {});
        }
    });

    it('reads an IMAGE-like primary HDU', async () => {
        const data = image('PRIMARY');
        data.set(header(['SIMPLE  = T', 'BITPIX  = -32', 'NAXIS   = 2', 'NAXIS1  = 4', 'NAXIS2  = 3']));
        const reader = createRangeReader({ fetch: server(data).fetcher });
        expect(Array.from(await reader.readFloat32(await reader.index(url), 'PRIMARY', { x0: 0, x1: 2, y0: 0, y1: 1 }))).toEqual([0.5, 1.5]);
    });

    it('accounts for random-groups data before the following HDU', async () => {
        const data = new Uint8Array(11520);
        data.set(header(['SIMPLE  = T', 'BITPIX  = -32', 'NAXIS   = 3', 'NAXIS1  = 0', 'NAXIS2  = 2', 'NAXIS3  = 3', 'GROUPS  = T', 'PCOUNT  = 1', 'GCOUNT  = 2']));
        data.set(image('IMAGE'), 5760);
        const reader = createRangeReader({ fetch: server(data).fetcher });
        const index = await reader.index(url);
        expect(index.hdu('PRIMARY').dataBytes).toBe(56);
        expect(index.hdu('IMAGE').headerStart).toBe(5760);
    });

    it('uses the explicit file size when HEAD is unavailable', async () => {
        const data = synthetic();
        const base = server(data, false);
        const fetcher: typeof fetch = async (input, init) => {
            if (init?.method === 'HEAD') {
                return new Response(null, { status: 403 });
            }
            return base.fetcher(input, init);
        };
        expect((await createRangeReader({ fetch: fetcher, sizeBytes: data.length }).index(url)).sizeBytes).toBe(data.length);
        await expect(createRangeReader({ fetch: fetcher }).index(url)).rejects.toThrow(/size/);
    });

    it.each([200, 15, 17])('rejects a failed cutout response (%s)', async mode => {
        const data = synthetic();
        const base = server(data);
        let reading = false;
        const fetcher: typeof fetch = async (input, init) => {
            if (reading) {
                return new Response(new Uint8Array(mode === 200 ? 16 : mode), { status: mode === 200 ? 200 : 206 });
            }
            return base.fetcher(input, init);
        };
        const reader = createRangeReader({ fetch: fetcher });
        const index = await reader.index(url);
        reading = true;
        await expect(reader.readFloat32(index, 'IMAGE', { x0: 0, x1: 4, y0: 0, y1: 1 })).rejects.toThrow();
    });

    it('refuses oversized reads before fetching and supports abort', async () => {
        const { fetcher, calls } = server(synthetic());
        const index = await createRangeReader({ fetch: fetcher }).index(url);
        const count = calls.length;
        await expect(createRangeReader({ fetch: fetcher, maxBytes: 47 }).readFloat32(index, 'IMAGE', { x0: 0, x1: 1, y0: 0, y1: 3 })).rejects.toThrow(/maxBytes/);
        expect(calls).toHaveLength(count);
        const controller = new AbortController();
        controller.abort();
        await expect(createRangeReader({ fetch: fetcher }).index(url, controller.signal)).rejects.toThrow();
    });

    it('indexes a many-block header with few requests', async () => {
        const cards = Array.from({ length: 1500 }, (_, i) => `KEY${i}`.padEnd(8) + '= 1');
        const primary = header(['SIMPLE  = T', 'BITPIX  = 8', 'NAXIS   = 0', ...cards]);
        const data = new Uint8Array(primary.length + 5760);
        data.set(primary);
        data.set(image('IMAGE'), primary.length);
        const { fetcher, calls } = server(data);
        await createRangeReader({ fetch: fetcher }).index(url);
        expect(calls.length).toBeLessThanOrEqual(3);
    });

    it('cancels chunks when the caller aborts or one chunk fails', async () => {
        const data = synthetic();
        const index = await createRangeReader({ fetch: server(data).fetcher }).index(url);
        const make = (fail: boolean) => {
            const signals: AbortSignal[] = [];
            const fetcher: typeof fetch = (_input, init) => new Promise((resolve, reject) => {
                const signal = init!.signal!;
                signals.push(signal);
                signal.addEventListener('abort', () => reject(signal.reason));
                if (fail && signals.length === 1) {
                    resolve(new Response(new Uint8Array(16), { status: 200 }));
                }
            });
            return { fetcher, signals };
        };
        const box = { x0: 0, x1: 4, y0: 0, y1: 3 };
        const caller = new AbortController();
        const a = make(false);
        const pending = createRangeReader({ fetch: a.fetcher, maxParallel: 3 }).readFloat32(index, 'IMAGE', box, caller.signal);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(a.signals).toHaveLength(3);
        caller.abort(new Error('stop'));
        await expect(pending).rejects.toThrow('stop');
        expect(a.signals.every(signal => signal.aborted)).toBe(true);
        const b = make(true);
        await expect(createRangeReader({ fetch: b.fetcher, maxParallel: 3 }).readFloat32(index, 'IMAGE', box)).rejects.toThrow(/206/);
        expect(b.signals).toHaveLength(3);
        expect(b.signals.every(signal => signal.aborted)).toBe(true);
    });
});
