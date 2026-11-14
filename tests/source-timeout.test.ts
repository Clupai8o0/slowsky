// @ts-expect-error Node built-in is available in Vitest.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveSource } from '../src/lib/source';
import type { FrameRecord } from '../src/lib/types';

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
        const state = observed(createLiveSource({ fetch: fetcher, requestTimeoutMs: 250 }).load(request));
        await vi.advanceTimersByTimeAsync(249);
        expect(state.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError', message: 'Network request timed out.' });
        rejectFetch(new Error('late failure'));
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('times out when cancelling an invalid range response hangs', async () => {
        const fetcher: typeof fetch = async (input) => {
            if (String(input).includes('gsss.stsci.edu')) {
                return new Response('', { status: 503 });
            }
            return new Response(new ReadableStream<Uint8Array>({
                cancel() { return new Promise<void>(() => {}); },
            }), { status: 200 });
        };
        const state = observed(createLiveSource({ fetch: fetcher, search: async () => [record] }).load(request));
        await vi.advanceTimersByTimeAsync(20000);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses the 90 second default for the whole load', async () => {
        const fake = archive();
        const state = observed(createLiveSource({ fetch: fake.fetcher, search: () => new Promise(() => {}) }).load(request));
        await vi.advanceTimersByTimeAsync(89999);
        expect(state.settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(state.error).toMatchObject({ name: 'ArchiveTimeoutError' });
        expect(vi.getTimerCount()).toBe(0);
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
