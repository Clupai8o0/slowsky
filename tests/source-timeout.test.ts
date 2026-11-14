// @ts-expect-error Node built-in is available in Vitest.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveSource } from '../src/lib/source';
import { createRangeReader } from '../src/lib/fits';
import type { FrameRecord } from '../src/lib/types';

const capture = vi.hoisted(() => ({ fetch: undefined as typeof fetch | undefined }));
vi.mock('../src/lib/fits', async (importOriginal) => {
    const original = await importOriginal<typeof import('../src/lib/fits')>();
    return {
        ...original,
        createRangeReader(options: Parameters<typeof original.createRangeReader>[0])
        {
            capture.fetch = options?.fetch;
            return original.createRangeReader(options);
        },
    };
});

const center = { ra: 76.95, dec: 30.4 };
const request = { center, fovDeg: 0.005, detector: 1 as const, withVariance: true };
const record: FrameRecord = {
    obsId: 'testD1', collection: 'spherex_dr1', release: 'dr1', detector: 1,
    url: 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/test.fits',
    tMin: 60900, tMax: 60900.002, lambdaMin: 0.75, lambdaMax: 1.1,
};

function header(cards: string[]): Uint8Array
{
    const text = [...cards, 'END'].map((card) => card.padEnd(80)).join('');
    return new TextEncoder().encode(text.padEnd(Math.ceil(text.length / 2880) * 2880));
}

function frameFile()
{
    const primary = header(['SIMPLE  = T', 'BITPIX  = 8', 'NAXIS   = 0']);
    const names = ['IMAGE', 'ZODI', 'VARIANCE'];
    const parts = [primary];
    const offsets: Record<string, number> = {};
    let position = primary.length;
    for (const name of names) {
        const head = header(["XTENSION= 'IMAGE'", 'BITPIX  = -32', 'NAXIS   = 2', 'NAXIS1  = 32', 'NAXIS2  = 32',
            `EXTNAME = '${name}'`, "CTYPE1  = 'RA---TAN'", "CTYPE2  = 'DEC--TAN'", 'CRPIX1  = 16', 'CRPIX2  = 16',
            `CRVAL1  = ${center.ra}`, `CRVAL2  = ${center.dec}`, 'CD1_1   = -0.001708333333', 'CD1_2   = 0',
            'CD2_1   = 0', 'CD2_2   = 0.001708333333']);
        offsets[name] = position + head.length;
        const data = new Uint8Array(5760);
        const view = new DataView(data.buffer);
        for (let i = 0; i < 1024; i++) {
            view.setFloat32(i * 4, name === 'ZODI' ? 0 : 1);
        }
        parts.push(head, data);
        position += head.length + data.length;
    }
    const wave = readFileSync(new URL('./fixtures/frame/frame1.wcswave.bin', import.meta.url));
    offsets.wave = position + 2880;
    parts.push(wave);
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let cursor = 0;
    for (const part of parts) {
        data.set(part, cursor);
        cursor += part.length;
    }
    return { data, offsets };
}

type Stage = 'search' | 'index' | 'wave' | 'IMAGE' | 'ZODI' | 'VARIANCE';

function archive(stall?: Stage | Stage[], body = false, delay = 0)
{
    const { data, offsets } = frameFile();
    const reached: Stage[] = [];
    const signals: { stage: Stage; signal: AbortSignal }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('gsss.stsci.edu')) {
            return new Response('source_id,ra,dec,phot_g_mean_mag,pmra,pmdec,parallax,ref_epoch\n');
        }
        let stage: Stage;
        let response: Response;
        if (url.startsWith('/api/sia')) {
            stage = 'search';
            response = new Response('<VOTABLE><RESOURCE><TABLE><DATA><TABLEDATA/></DATA></TABLE></RESOURCE></VOTABLE>');
        } else {
            const range = new Headers(init?.headers).get('Range')!;
            const [, lo, hi] = /bytes=(\d+)-(\d+)/.exec(range)!;
            const start = Number(lo);
            const end = Number(hi);
            stage = start === 0 || (start >= 28800 && start < offsets.wave!) ? 'index'
                : start >= offsets.wave! ? 'wave'
                    : start >= offsets.VARIANCE! ? 'VARIANCE' : start >= offsets.ZODI! ? 'ZODI' : 'IMAGE';
            response = new Response(data.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${Math.min(end, data.length - 1)}/${data.length}` } });
        }
        reached.push(stage);
        if (init?.signal) {
            signals.push({ stage, signal: init.signal });
        }
        if (stage === stall || (Array.isArray(stall) && stall.includes(stage))) {
            if (body) {
                return new Response(new ReadableStream<Uint8Array>({}), { status: response.status, headers: response.headers });
            }
            return new Promise<Response>(() => {});
        }
        if (delay) {
            await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }
        return response;
    };
    return { fetcher, reached, signals };
}

function observed<T>(promise: Promise<T>)
{
    const state: { value?: T; error?: unknown; settled: boolean } = { settled: false };
    promise.then((value) => { state.value = value; state.settled = true; }, (error: unknown) => { state.error = error; state.settled = true; });
    return state;
}

describe('live archive deadlines', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it.each(['search', 'index', 'wave', 'IMAGE', 'ZODI', 'VARIANCE'] as Stage[])(
        'times out stalled %s response headers', async (stage) => {
            const fake = archive(stage);
            const source = createLiveSource({ fetch: fake.fetcher, ...(stage === 'search' ? {} : { search: async () => [record] }) });
            const state = observed(source.load(request));
            await vi.advanceTimersByTimeAsync(20000);
            expect(fake.reached).toContain(stage);
            expect(state.settled).toBe(true);
            expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError' });
            expect(fake.signals.filter((item) => item.stage === stage).every((item) => item.signal.aborted)).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each(['search', 'index', 'wave', 'IMAGE', 'ZODI', 'VARIANCE'] as Stage[])(
        'times out stalled %s response body', async (stage) => {
            const fake = archive(stage, true);
            const source = createLiveSource({ fetch: fake.fetcher, ...(stage === 'search' ? {} : { search: async () => [record] }) });
            const state = observed(source.load(request));
            await vi.advanceTimersByTimeAsync(20000);
            expect(fake.reached).toContain(stage);
            expect(state.settled).toBe(true);
            expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError' });
            expect(fake.signals.filter((item) => item.stage === stage).every((item) => item.signal.aborted)).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('preserves the caller abort reason and clears timers', async () => {
        const fake = archive('index');
        const caller = new AbortController();
        const reason = new Error('new target');
        const state = observed(createLiveSource({ fetch: fake.fetcher, search: async () => [record] }).load({ ...request, signal: caller.signal }));
        await vi.advanceTimersByTimeAsync(100);
        caller.abort(reason);
        await vi.advanceTimersByTimeAsync(0);
        expect(state.error).toBe(reason);
        expect(fake.signals.every((item) => item.signal.aborted)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('aborts all concurrent pixel requests when one times out', async () => {
        const fake = archive(['IMAGE', 'ZODI', 'VARIANCE']);
        const state = observed(createLiveSource({ fetch: fake.fetcher, search: async () => [record] }).load(request));
        await vi.advanceTimersByTimeAsync(20000);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError' });
        for (const stage of ['IMAGE', 'ZODI', 'VARIANCE'] as Stage[]) {
            const requests = fake.signals.filter((item) => item.stage === stage);
            expect(requests.length).toBeGreaterThan(0);
            expect(requests.every((item) => item.signal.aborted)).toBe(true);
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the Gaia six-second first-host limit while the archive is still loading', async () => {
        const fake = archive('index');
        const hosts: string[] = [];
        const fetcher: typeof fetch = (input, init) => {
            if (String(input).includes('gsss.stsci.edu') || String(input).includes('vizier.cfa.harvard.edu')) {
                hosts.push(String(input));
                return new Promise<Response>(() => {});
            }
            return fake.fetcher(input, init);
        };
        const caller = new AbortController();
        const state = observed(createLiveSource({ fetch: fetcher, search: async () => [record] }).load({ ...request, signal: caller.signal }));
        await vi.advanceTimersByTimeAsync(5999);
        expect(hosts).toHaveLength(1);
        expect(vi.getTimerCount()).toBeGreaterThan(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(hosts).toHaveLength(2);
        expect(state.settled).toBe(false);
        caller.abort(new Error('stop'));
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds the entire load even if an injected search ignores its signal', async () => {
        const fake = archive();
        const state = observed(createLiveSource({ fetch: fake.fetcher, search: () => new Promise(() => {}), loadTimeoutMs: 1000 }).load(request));
        await vi.advanceTimersByTimeAsync(1000);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not report progress when a timed-out search resolves late', async () => {
        const fake = archive();
        let finish!: (records: FrameRecord[]) => void;
        const progress = vi.fn();
        const search = () => new Promise<FrameRecord[]>((resolve) => { finish = resolve; });
        const state = observed(createLiveSource({ fetch: fake.fetcher, search, loadTimeoutMs: 1000 }).load({ ...request, onProgress: progress }));
        await vi.advanceTimersByTimeAsync(1000);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError' });
        const count = progress.mock.calls.length;
        finish([]);
        await vi.advanceTimersByTimeAsync(0);
        expect(progress).toHaveBeenCalledTimes(count);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses the configured request deadline and ignores a later fetch rejection', async () => {
        let rejectFetch!: (reason: Error) => void;
        const fake = archive();
        const fetcher: typeof fetch = (input, init) => String(input).startsWith('/api/sia')
            ? new Promise<Response>((_resolve, reject) => { rejectFetch = reject; }) : fake.fetcher(input, init);
        const state = observed(createLiveSource({ fetch: fetcher, stallTimeoutMs: 250 }).load(request));
        await vi.advanceTimersByTimeAsync(249);
        expect(state.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError', message: 'Network request timed out.' });
        rejectFetch(new Error('late failure'));
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses the total limit when cancelling an invalid range response hangs', async () => {
        const fetcher: typeof fetch = async (input) => {
            if (String(input).includes('gsss.stsci.edu') || String(input).includes('vizier.cfa.harvard.edu')) {
                return new Response('', { status: 503 });
            }
            return new Response(new ReadableStream<Uint8Array>({
                cancel() { return new Promise<void>(() => {}); },
            }), { status: 200 });
        };
        const state = observed(createLiveSource({ fetch: fetcher, search: async () => [record] }).load(request));
        await vi.advanceTimersByTimeAsync(180000);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError', reason: 'total' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses the 180 second default for the whole load', async () => {
        const fake = archive();
        const state = observed(createLiveSource({ fetch: fake.fetcher, search: () => new Promise(() => {}) }).load(request));
        await vi.advanceTimersByTimeAsync(179999);
        expect(state.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('allows thirty queued requests when six finish every six seconds', async () => {
        let active = 0;
        const queue: (() => void)[] = [];
        const fetcher: typeof fetch = async (input) => {
            if (String(input).includes('gsss.stsci.edu') || String(input).includes('vizier.cfa.harvard.edu')) {
                return new Response('');
            }
            return new Promise<Response>((resolve) => {
                const start = () => {
                    active++;
                    setTimeout(() => {
                        active--;
                        resolve(new Response(null));
                        queue.shift()?.();
                    }, 6000);
                };
                if (active < 6) { start(); } else { queue.push(start); }
            });
        };
        const search = async () => {
            await Promise.all(Array.from({ length: 30 }, (_, i) => capture.fetch!(`https://archive/${i}`)));
            return [];
        };
        const state = observed(createLiveSource({ fetch: fetcher, search }).load(request));
        await vi.advanceTimersByTimeAsync(30000);
        expect(state.error).toBeUndefined();
        expect(state.value?.source).toBe('live');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('allows a body that delivers a chunk every fifteen seconds for over 100 seconds', async () => {
        let finishWaiting!: (response: Response) => void;
        const fetcher: typeof fetch = async (input) => {
            if (String(input).includes('gsss.stsci.edu') || String(input).includes('vizier.cfa.harvard.edu')) { return new Response(''); }
            if (String(input).endsWith('/waiting')) {
                return new Promise<Response>((resolve) => { finishWaiting = resolve; });
            }
            let count = 0;
            return new Response(new ReadableStream<Uint8Array>({
                pull(controller) {
                    return new Promise<void>((resolve) => setTimeout(() => {
                        controller.enqueue(new Uint8Array([++count]));
                        if (count === 7) { controller.close(); }
                        resolve();
                    }, 15000));
                },
            }));
        };
        const search = async () => {
            const waiting = capture.fetch!('https://archive/waiting');
            const reading = (async () => {
                await (await capture.fetch!('https://archive/trickle')).arrayBuffer();
                finishWaiting(new Response(null));
            })();
            await Promise.all([waiting, reading]);
            return [];
        };
        const state = observed(createLiveSource({ fetch: fetcher, search }).load(request));
        await vi.advanceTimersByTimeAsync(20000);
        expect(state.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(85000);
        expect(state.error).toBeUndefined();
        expect(state.value?.source).toBe('live');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('times out twenty seconds after the last progress among pending requests', async () => {
        const fetcher: typeof fetch = async (input) => {
            if (String(input).includes('gsss.stsci.edu') || String(input).includes('vizier.cfa.harvard.edu')) { return new Response(''); }
            if (String(input).endsWith('stall')) { return new Promise<Response>(() => {}); }
            await new Promise<void>((resolve) => setTimeout(resolve, 15000));
            return new Response(null);
        };
        const search = async () => { await Promise.all([capture.fetch!('https://archive/stall'), capture.fetch!('https://archive/progress')]); return []; };
        const state = observed(createLiveSource({ fetch: fetcher, search }).load(request));
        await vi.advanceTimersByTimeAsync(34999);
        expect(state.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError', reason: 'stall', message: 'Network request timed out.' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['unread body', 'no body'])( 'does not time out with %s and no pending operations', async (kind) => {
        const fetcher: typeof fetch = async (input) => String(input).includes('gsss.stsci.edu')
            ? new Response('') : new Response(kind === 'no body' ? null : new ReadableStream<Uint8Array>({}));
        let release!: () => void;
        const search = async () => {
            await capture.fetch!('https://archive/quiet', kind === 'no body' ? { method: 'HEAD' } : undefined);
            await new Promise<void>((resolve) => { release = resolve; });
            return [];
        };
        const state = observed(createLiveSource({ fetch: fetcher, search }).load(request));
        await vi.advanceTimersByTimeAsync(60000);
        expect(state.settled).toBe(false);
        expect(vi.getTimerCount()).toBe(1);
        release();
        await vi.advanceTimersByTimeAsync(0);
        expect(state.value?.source).toBe('live');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('enforces the total cap despite steady body progress', async () => {
        const fetcher: typeof fetch = async (input) => {
            if (String(input).includes('gsss.stsci.edu') || String(input).includes('vizier.cfa.harvard.edu')) { return new Response(''); }
            let timer: ReturnType<typeof setTimeout>;
            return new Response(new ReadableStream<Uint8Array>({
                pull(controller) { return new Promise<void>((resolve) => { timer = setTimeout(() => { controller.enqueue(new Uint8Array([1])); resolve(); }, 15000); }); },
                cancel() { clearTimeout(timer); },
            }));
        };
        const search = async () => { await (await capture.fetch!('https://archive/trickle')).arrayBuffer(); return []; };
        const state = observed(createLiveSource({ fetch: fetcher, search, loadTimeoutMs: 40000 }).load(request));
        await vi.advanceTimersByTimeAsync(40000);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError', reason: 'total' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('aborts siblings and removes caller listeners when a request fails', async () => {
        const caller = new AbortController();
        const add = vi.spyOn(caller.signal, 'addEventListener');
        const remove = vi.spyOn(caller.signal, 'removeEventListener');
        let sibling!: AbortSignal;
        const failure = new Error('archive failed');
        const fetcher: typeof fetch = async (input, init) => {
            if (String(input).includes('gsss.stsci.edu')) { return new Response(''); }
            if (String(input).endsWith('sibling')) {
                sibling = init!.signal!;
                return new Promise<Response>(() => {});
            }
            throw failure;
        };
        const search = async () => {
            await Promise.all([capture.fetch!('https://archive/sibling'), capture.fetch!('https://archive/failure')]);
            return [];
        };
        const state = observed(createLiveSource({ fetch: fetcher, search }).load({ ...request, signal: caller.signal }));
        await vi.advanceTimersByTimeAsync(0);
        expect(state.error).toBe(failure);
        expect(sibling.aborted).toBe(true);
        expect(add).toHaveBeenCalledTimes(remove.mock.calls.length);
        for (const [event, listener] of add.mock.calls) {
            expect(remove.mock.calls.some(([removedEvent, removedListener]) => removedEvent === event && removedListener === listener)).toBe(true);
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('removes internal signal listeners after a response with no body', async () => {
        const upstream = new AbortController();
        let requestRemove: ReturnType<typeof vi.spyOn> | undefined;
        const fetcher: typeof fetch = async (input, init) => {
            if (String(input).includes('archive/head')) {
                requestRemove = vi.spyOn(init!.signal!, 'removeEventListener');
            }
            return new Response(null);
        };
        const search = async (_query: unknown, signal?: AbortSignal) => {
            const loadAdd = vi.spyOn(signal!, 'addEventListener');
            const loadRemove = vi.spyOn(signal!, 'removeEventListener');
            const upstreamAdd = vi.spyOn(upstream.signal, 'addEventListener');
            const upstreamRemove = vi.spyOn(upstream.signal, 'removeEventListener');
            await capture.fetch!('https://archive/head', { method: 'HEAD', signal: upstream.signal });
            for (const [add, remove] of [[loadAdd, loadRemove], [upstreamAdd, upstreamRemove]] as const) {
                expect(add).toHaveBeenCalledTimes(1);
                expect(remove).toHaveBeenCalledTimes(1);
                expect(remove.mock.calls[0]![1]).toBe(add.mock.calls[0]![1]);
            }
            expect(requestRemove).toHaveBeenCalledTimes(1);
            return [];
        };
        const state = observed(createLiveSource({ fetch: fetcher, search }).load(request));
        await vi.advanceTimersByTimeAsync(0);
        expect(state.error).toBeUndefined();
        expect(state.value?.source).toBe('live');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves the live pixels and metadata from the same healthy archive without the wrapper', async () => {
        const fake = archive();
        const direct = observed(createLiveSource({ fetch: fake.fetcher, reader: createRangeReader({ fetch: fake.fetcher }), search: async () => [record] }).load(request));
        const wrapped = observed(createLiveSource({ fetch: fake.fetcher, search: async () => [record] }).load(request));
        await vi.advanceTimersByTimeAsync(0);
        expect(direct.error).toBeUndefined();
        expect(wrapped.error).toBeUndefined();
        expect(direct.value?.frames).toHaveLength(1);
        expect(JSON.stringify(wrapped.value)).toBe(JSON.stringify(direct.value));
        const directFrame = direct.value!.frames[0]!.frame;
        const wrappedFrame = wrapped.value!.frames[0]!.frame;
        expect(new Uint8Array(wrappedFrame.data.buffer)).toEqual(new Uint8Array(directFrame.data.buffer));
        expect(new Uint8Array(wrappedFrame.variance!.buffer)).toEqual(new Uint8Array(directFrame.variance!.buffer));
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops after index resolves if the caller aborts before the next step', async () => {
        const fake = archive();
        const base = createRangeReader({ fetch: fake.fetcher });
        const caller = new AbortController();
        const reason = new Error('stop after index');
        const wave = vi.fn(base.readWaveGrid);
        const reader = { ...base, readWaveGrid: wave, async index(url: string, signal?: AbortSignal) {
            const index = await base.index(url, signal);
            caller.abort(reason);
            return index;
        } };
        const state = observed(createLiveSource({ fetch: fake.fetcher, reader, search: async () => [record] }).load({ ...request, signal: caller.signal }));
        await vi.advanceTimersByTimeAsync(0);
        expect(state.error).toBe(reason);
        expect(wave).not.toHaveBeenCalled();
        expect(fake.reached).not.toContain('wave');
    });

    it('stops after cutout resolves if the caller aborts before regridding', async () => {
        const fake = archive();
        const base = createRangeReader({ fetch: fake.fetcher });
        const caller = new AbortController();
        const reason = new Error('stop after pixels');
        const progress = vi.fn();
        let remaining = 3;
        const reader = { ...base, async readFloat32(...args: Parameters<typeof base.readFloat32>) {
            const result = await base.readFloat32(...args);
            if (--remaining === 0) { caller.abort(reason); }
            return result;
        } };
        const state = observed(createLiveSource({ fetch: fake.fetcher, reader, search: async () => [record] }).load({ ...request, signal: caller.signal, onProgress: progress }));
        await vi.advanceTimersByTimeAsync(0);
        expect(state.error).toBe(reason);
        expect(remaining).toBe(0);
        expect(progress.mock.calls.some(([event]) => event.stage === 'regrid')).toBe(false);
    });

    it('clears timers on ordinary failure, including the Gaia fallback', async () => {
        let rejectSearch!: (reason: Error) => void;
        const search = () => new Promise<FrameRecord[]>((_resolve, reject) => { rejectSearch = reject; });
        const hosts: string[] = [];
        const fetcher: typeof fetch = async (input) => {
            hosts.push(String(input));
            if (String(input).includes('gsss.stsci.edu')) {
                return new Response('', { status: 503 });
            }
            return new Promise<Response>(() => {});
        };
        const state = observed(createLiveSource({ fetch: fetcher, search }).load(request));
        await vi.advanceTimersByTimeAsync(0);
        expect(hosts).toHaveLength(2);
        expect(vi.getTimerCount()).toBeGreaterThan(1);
        const failure = new Error('archive failed');
        rejectSearch(failure);
        await vi.advanceTimersByTimeAsync(0);
        expect(state.error).toBe(failure);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('accepts archive responses taking 19 seconds each within the overall limit', async () => {
        const fake = archive(undefined, false, 19000);
        const state = observed(createLiveSource({ fetch: fake.fetcher, search: async () => [record] }).load(request));
        await vi.advanceTimersByTimeAsync(1);
        expect(vi.getTimerCount()).toBeGreaterThan(1);
        await vi.advanceTimersByTimeAsync(89998);
        expect(state.error).toBeUndefined();
        expect(state.value?.frames).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
