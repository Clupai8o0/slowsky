import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findChanges } from '../src/lib/change-input';
import { gridPixToSky, gridSkyToPix } from '../src/lib/regrid';
import type { GaiaStar, SkyResult } from '../src/lib/source';
import { positionAt } from '../src/lib/targets';
import type { FrameRecord, OutputGrid, RangeReader, RegriddedFrame, Wcs } from '../src/lib/types';
// The page's change list goes through changesFor (src/ui/slots.ts), which must ask for the plain list only.
import { changesFor, mountChanges, PAGE_CHANGE_OPTIONS } from '../src/ui/slots';
import { HELPER_LABEL } from '../src/lib/classify';
import weights from '../public/models/change-classifier.json';
import { shell } from '../src/ui/app';

describe('share picture switch', () => {
    it('leaves the page HTML unchanged while disabled', () => {
        const fetcher = vi.spyOn(globalThis, 'fetch');
        expect(shell()).toBe(shell(false));
        expect(shell()).not.toContain('Save picture');
        expect(shell(true)).toContain('Save picture');
        expect(fetcher).not.toHaveBeenCalled();
        fetcher.mockRestore();
    });
});
// Fixtures as in tests/change-input.test.ts.

const grid: OutputGrid = { center: { ra: 20, dec: 30 }, fovDeg: 0.1, pixelArcsec: 1.5375, width: 121, height: 121 };

describe('optional change hints', () => {
    function result(): SkyResult
    {
        const a = noise(grid), b = noise(grid);
        point(b, 60, 60, 100);
        return { ...sky([frame('a', 60000, 2, a), frame('b', 60030, 2, b)]), source: 'live' };
    }

    it('does not fetch or change HTML when switched off, or on a saved view', () => {
        const data = result(), fetcher = vi.fn(), box = {} as HTMLElement, marks = {} as HTMLElement;
        const view = { source: 'live' as const, result: data, index: 0, mode: 'blink' as const };
        const off = mountChanges(() => {}, { fetcher: fetcher as unknown as typeof fetch });
        off.render(box, marks, view);
        const before = box.innerHTML;
        mountChanges(() => {}, { hint: false, fetcher: fetcher as unknown as typeof fetch }).render(box, marks, view);
        expect(box.innerHTML).toBe(before);
        mountChanges(() => {}, { hint: true, savedList: true, fetcher: fetcher as unknown as typeof fetch })
            .render(box, marks, { ...view, source: 'snapshot' });
        expect(box.innerHTML).not.toContain('sk-hintml');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('adds hints only after the final list and reuses the fetched model', async () => {
        const data = result(), box = {} as HTMLElement, marks = {} as HTMLElement, onChange = vi.fn();
        let resolve!: (response: Response) => void;
        const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
        const slot = mountChanges(onChange, { hint: true, fetcher: fetcher as unknown as typeof fetch });
        const view = { source: 'live' as const, result: data, index: 0, mode: 'blink' as const };
        slot.render(box, marks, view);
        expect(box.innerHTML).not.toContain('sk-hintml');
        expect(fetcher).toHaveBeenCalledTimes(1);
        resolve({ ok: true, json: async () => weights } as Response);
        await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
        slot.render(box, marks, view);
        expect(box.innerHTML).toContain(HELPER_LABEL);
        expect(box.innerHTML).toMatch(/<li><b>Candidate 1<\/b>.*?<p class="sk-hintml">/);
        const hint = /<p class="sk-hintml">.*?<\/p>/.exec(box.innerHTML)?.[0] ?? '';
        expect(hint).not.toMatch(/\b(?:mover|brightness|artifact|nothing)\b|\d+%/i);
        slot.render(box, marks, view);
        expect(fetcher).toHaveBeenCalledTimes(1);
        const next = result();
        slot.render(box, marks, { ...view, result: next });
        slot.render(box, marks, { ...view, result: next });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(box.innerHTML).toContain(HELPER_LABEL);
    });

    it.each(['failed', 'broken'])('silently ignores a %s model', async (kind) => {
        const data = result(), box = {} as HTMLElement, marks = {} as HTMLElement;
        const fetcher = vi.fn(async () => kind === 'failed' ? { ok: false } : { ok: true, json: async () => ({}) });
        const slot = mountChanges(() => {}, { hint: true, fetcher: fetcher as unknown as typeof fetch });
        const view = { source: 'live' as const, result: data, index: 0, mode: 'blink' as const };
        slot.render(box, marks, view);
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        await new Promise(resolve => setTimeout(resolve, 0));
        slot.render(box, marks, view);
        expect(box.innerHTML).not.toContain('sk-hintml');
    });

    it('aborts a pending model load on a new result and ignores its late response', async () => {
        const first = result(), second = result(), box = {} as HTMLElement, marks = {} as HTMLElement, onChange = vi.fn();
        const pending: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
        const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(resolve => {
            pending.push({ signal: init!.signal as AbortSignal, resolve });
        }));
        const slot = mountChanges(onChange, { hint: true, fetcher: fetcher as typeof fetch });
        const view = { source: 'live' as const, result: first, index: 0, mode: 'blink' as const };
        slot.render(box, marks, view);
        slot.render(box, marks, { ...view, result: second });
        expect(pending).toHaveLength(2);
        expect(pending[0]!.signal.aborted).toBe(true);
        pending[0]!.resolve({ ok: true, json: async () => weights } as Response);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(onChange).not.toHaveBeenCalled();
        pending[1]!.resolve({ ok: true, json: async () => weights } as Response);
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
        slot.render(box, marks, { ...view, result: second });
        expect(box.innerHTML).toContain(HELPER_LABEL);
    });

    it('waits for flag screening before fetching and labels only kept candidates', async () => {
        const data = livePair(), box = {} as HTMLElement, marks = {} as HTMLElement, onChange = vi.fn();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const frames = new Map(data.frames.map(f => [f.frame.frame.obsId, f.frame]));
        const reader = { index: async (url: string) => ({ url }),
            readFloat32: async (index: { url: string }) => frames.get(index.url)!.data } as unknown as RangeReader;
        const read = vi.fn(async (url: string) => {
            await gate;
            const values = new Int32Array(grid.width * grid.height);
            if (url === 'b') {
                values.fill(1);
            }
            return { data: values, width: grid.width, height: grid.height };
        });
        const fetcher = vi.fn(async () => ({ ok: true, json: async () => weights } as Response));
        const slot = mountChanges(onChange, { hint: true, reader, read, fetcher: fetcher as unknown as typeof fetch,
            variance: async f => f.variance ?? null });
        const view = { source: 'live' as const, result: data, index: 0, mode: 'blink' as const };
        slot.render(box, marks, view);
        await vi.waitFor(() => expect(read).toHaveBeenCalled());
        expect(fetcher).not.toHaveBeenCalled();
        release();
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
        slot.render(box, marks, view);
        expect(box.innerHTML).not.toContain('sk-hintml');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('adds only hint paragraphs without changing the list or marks', async () => {
        const data = livePair(), box = {} as HTMLElement, marks = {} as HTMLElement, onChange = vi.fn();
        point(data.frames[1]!.frame.data, 30, 90, 500);
        for (const f of data.frames) { delete f.frame.context; }
        let resolve!: (response: Response) => void;
        const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
        const slot = mountChanges(onChange, { hint: true, fetcher: fetcher as unknown as typeof fetch });
        const view = { source: 'live' as const, result: data, index: 0, mode: 'blink' as const };
        slot.render(box, marks, view);
        const html = box.innerHTML, svg = marks.innerHTML;
        const count = [...html.matchAll(/<li><b>Candidate \d+<\/b>/g)].length;
        expect(count).toBe(3);
        expect(fetcher).toHaveBeenCalledTimes(1);
        resolve({ ok: true, json: async () => weights } as Response);
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
        slot.render(box, marks, view);
        expect(marks.innerHTML).toBe(svg);
        expect(box.innerHTML.replace(/<p class="sk-hintml">.*?<\/p>/g, '')).toBe(html);
        expect([...box.innerHTML.matchAll(/<p class="sk-hintml">.*?<\/p>/g)]).toHaveLength(count);
    });

    it('never fetches with hints off when a finished list is drawn again, also after stop()', async () => {
        const data = livePair(), box = {} as HTMLElement, marks = {} as HTMLElement, onChange = vi.fn();
        const fetcher = vi.fn();
        const frames = new Map(data.frames.map(f => [f.frame.frame.obsId, f.frame]));
        const reader = { index: async (url: string) => ({ url }),
            readFloat32: async (index: { url: string }) => frames.get(index.url)!.data } as unknown as RangeReader;
        const read = vi.fn(async () => ({ data: new Int32Array(grid.width * grid.height), width: grid.width, height: grid.height }));
        const slot = mountChanges(onChange, { hint: false, reader, read, fetcher: fetcher as unknown as typeof fetch,
            variance: async f => f.variance ?? null });
        const view = { source: 'live' as const, result: data, index: 0, mode: 'blink' as const };
        slot.render(box, marks, view);
        expect(fetcher).toHaveBeenCalledTimes(0);
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
        slot.render(box, marks, view);
        expect([...box.innerHTML.matchAll(/<li><b>Candidate \d+<\/b>/g)]).toHaveLength(2);
        slot.render(box, marks, view);
        expect(fetcher).toHaveBeenCalledTimes(0);
        // The page drops its view and draws the same result again: the finished list comes back from the slot's
        // own store, with the same HTML, no new read, no new draw request and still no model fetch.
        const finished = box.innerHTML, finishedMarks = marks.innerHTML;
        const reads = read.mock.calls.length, draws = onChange.mock.calls.length;
        slot.stop();
        const again = {} as HTMLElement, againMarks = {} as HTMLElement;
        expect(slot.render(again, againMarks, view)).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 0));
        slot.render(again, againMarks, view);
        expect(again.innerHTML).toBe(finished);
        expect(againMarks.innerHTML).toBe(finishedMarks);
        expect(read.mock.calls.length).toBe(reads);
        expect(onChange.mock.calls.length).toBe(draws);
        expect(fetcher).toHaveBeenCalledTimes(0);
    });

    it('fetches after error-map screening but before the final list is drawn', async () => {
        const data = livePair(), box = {} as HTMLElement, marks = {} as HTMLElement, onChange = vi.fn();
        const frames = new Map(data.frames.map(f => [f.frame.frame.obsId, f.frame]));
        const reader = { index: async (url: string) => ({ url }),
            readFloat32: async (index: { url: string }) => frames.get(index.url)!.data } as unknown as RangeReader;
        let release!: () => void, resolveModel!: (response: Response) => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const read = vi.fn(async (url: string) => {
            await gate;
            const values = new Int32Array(grid.width * grid.height);
            if (url === 'b') {
                for (let y = 0; y < grid.height; y++) {
                    for (let x = 0; x < 60; x++) { values[y * grid.width + x] = 1; }
                }
            }
            return { data: values, width: grid.width, height: grid.height };
        });
        const find = vi.fn((...args: Parameters<typeof findChanges>) => findChanges(...args));
        const fetcher = vi.fn(() => new Promise<Response>(resolve => { resolveModel = resolve; }));
        const slot = mountChanges(onChange, { hint: true, reader, read, find,
            variance: async f => f.variance ?? null, fetcher: fetcher as unknown as typeof fetch });
        const view = { source: 'live' as const, result: data, index: 0, mode: 'blink' as const };
        slot.render(box, marks, view);
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
        slot.render(box, marks, view);
        expect(find).toHaveBeenCalledTimes(2);
        expect([...box.innerHTML.matchAll(/<li><b>Candidate \d+<\/b>/g)]).toHaveLength(2);
        expect(fetcher).toHaveBeenCalledTimes(0);
        release();
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect([...box.innerHTML.matchAll(/<li><b>Candidate \d+<\/b>/g)]).toHaveLength(2);
        slot.render(box, marks, view);
        expect([...box.innerHTML.matchAll(/<li><b>Candidate \d+<\/b>/g)]).toHaveLength(1);
        resolveModel({ ok: true, json: async () => weights } as Response);
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(3));
        slot.render(box, marks, view);
        expect([...box.innerHTML.matchAll(/<p class="sk-hintml">.*?<\/p>/g)]).toHaveLength(1);
    });

    it.each(['HTTP 500', 'rejection'])('keeps hints off after a model load %s', async (kind) => {
        const data = result(), box = {} as HTMLElement, marks = {} as HTMLElement;
        const offBox = {} as HTMLElement, offMarks = {} as HTMLElement;
        const fetcher = vi.fn(async () => {
            if (kind === 'rejection') { throw new Error('model unavailable'); }
            return { ok: false, status: 500 } as Response;
        });
        const slot = mountChanges(() => {}, { hint: true, fetcher: fetcher as unknown as typeof fetch });
        const off = mountChanges(() => {}, { hint: false, fetcher: fetcher as unknown as typeof fetch });
        const view = { source: 'live' as const, result: data, index: 0, mode: 'blink' as const };
        off.render(offBox, offMarks, view);
        const expected = offBox.innerHTML;
        slot.render(box, marks, view);
        await new Promise(resolve => setTimeout(resolve, 0));
        slot.render(box, marks, view);
        expect(box.innerHTML).toBe(expected);
        expect(fetcher).toHaveBeenCalledTimes(1);
        const next = { ...view, result: result() };
        off.render(offBox, offMarks, next);
        const nextExpected = offBox.innerHTML;
        slot.render(box, marks, next);
        await new Promise(resolve => setTimeout(resolve, 0));
        slot.render(box, marks, next);
        expect(box.innerHTML).toBe(nextExpected);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
});

let seed = 918273;
function random(): number
{
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
}

function noise(g: OutputGrid): Float32Array
{
    const nw = Math.ceil(g.width / 4) + 1, nh = Math.ceil(g.height / 4) + 1;
    const native = new Float32Array(nw * nh);
    for (let i = 0; i < native.length; i += 2) {
        const r = Math.sqrt(-2 * Math.log(random())), t = 2 * Math.PI * random();
        native[i] = r * Math.cos(t);
        if (i + 1 < native.length) {
            native[i + 1] = r * Math.sin(t);
        }
    }
    const out = new Float32Array(g.width * g.height);
    for (let y = 0; y < g.height; y++) {
        for (let x = 0; x < g.width; x++) {
            const ix = Math.floor(x / 4), iy = Math.floor(y / 4), fx = x / 4 - ix, fy = y / 4 - iy;
            out[y * g.width + x] = (1 - fy) * ((1 - fx) * native[iy * nw + ix]! + fx * native[iy * nw + ix + 1]!)
                + fy * ((1 - fx) * native[(iy + 1) * nw + ix]! + fx * native[(iy + 1) * nw + ix + 1]!);
        }
    }
    return out;
}

function point(data: Float32Array, x: number, y: number, amplitude: number): void
{
    const s = 12 / 2.35482 / grid.pixelArcsec;
    for (let j = Math.max(0, Math.floor(y - 4 * s)); j <= Math.min(grid.height - 1, Math.ceil(y + 4 * s)); j++) {
        for (let i = Math.max(0, Math.floor(x - 4 * s)); i <= Math.min(grid.width - 1, Math.ceil(x + 4 * s)); i++) {
            data[j * grid.width + i]! += amplitude * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (2 * s * s));
        }
    }
}

function frame(id: string, mjd: number, lambda = 2, data = noise(grid)): RegriddedFrame
{
    const record: FrameRecord = { obsId: id, collection: 'spherex_dr1', release: 'dr1', detector: 1,
        url: '', tMin: mjd, tMax: mjd + 0.01, lambdaMin: 1, lambdaMax: 3 };
    return { frame: record, grid, data, lambdaAtCenter: lambda, bandwidthAtCenter: 0.1 };
}

function sky(frames: RegriddedFrame[], stars: GaiaStar[] = []): SkyResult
{
    return { source: 'snapshot', grid, frames: frames.map((f) => ({ frame: f, label: f.frame.obsId })),
        locked: [], lambda: 2, stars, credits: [], notes: [] };
}

function star(sourceId: string, ra = grid.center.ra, dec = grid.center.dec): GaiaStar
{
    return { sourceId, ra, dec, g: 10, epochJyear: 2016, pix: gridSkyToPix(grid, { ra, dec }) };
}

function livePair(): SkyResult
{
    seed = 918273;
    const a = noise(grid), b = noise(grid);
    point(b, 30, 30, 1000);
    point(b, 90, 90, 100);
    const frames = [frame('a', 60000, 2, a), frame('b', 60030, 2, b)];
    for (const f of frames) {
        f.variance = new Float32Array(f.data.length).fill(1);
        f.context = { url: f.frame.obsId, box: { x0: 0, y0: 0, x1: grid.width, y1: grid.height },
            wcs: { skyToPix: (s) => gridSkyToPix(grid, s) } as Wcs,
            flags: { layout: {} as never, names: [{ bit: 0, name: 'TRANSIENT' }, { bit: 1, name: 'OVERFLOW' }] } };
    }
    return { ...sky(frames), source: 'live' };
}

async function screenedPage(result: SkyResult, flagged: (x: number, y: number) => number, find?: typeof findChanges): Promise<string>
{
    const frames = new Map(result.frames.map(f => [f.frame.frame.obsId, f.frame]));
    const reader = { index: async (url: string) => ({ url }),
        readFloat32: async (index: { url: string }, name: string) => name === 'IMAGE' ? frames.get(index.url)!.data : new Float32Array(grid.width * grid.height),
    } as unknown as RangeReader;
    const read = vi.fn(async (url: string) => {
        const data = new Int32Array(grid.width * grid.height);
        if (url === 'b') {
            for (let y = 0; y < grid.height; y++) {
                for (let x = 0; x < grid.width; x++) { data[y * grid.width + x] = flagged(x, y); }
            }
        }
        return { data, width: grid.width, height: grid.height };
    });
    const onChange = vi.fn(), box = {} as HTMLElement, marks = {} as HTMLElement;
    const slot = mountChanges(onChange, { reader, read, find, variance: async f => f.variance ?? null });
    const view = { source: 'live' as const, result, index: 0, mode: 'blink' as const };
    slot.render(box, marks, view);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    slot.render(box, marks, view);
    return box.innerHTML;
}

function pageNotes(html: string): string[]
{
    const list = /<ul class="sk-chg-notes">(.*?)<\/ul>/.exec(html)?.[1] ?? '';
    return [...list.matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1]!.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&'));
}


describe('page change list stops reading when the page drops its view', () => {
    it('stop() ends the pending reads at once; the same result drawn again starts over', async () => {
        const result = livePair();
        const signals: AbortSignal[] = [];
        const variance = (_: RegriddedFrame, signal: AbortSignal) => new Promise<Float32Array | null>((resolve) => {
            signals.push(signal);
            signal.addEventListener('abort', () => resolve(null), { once: true });
        });
        const onChange = vi.fn(), box = {} as HTMLElement, marks = {} as HTMLElement;
        const slot = mountChanges(onChange, { variance, read: vi.fn(), reader: {} as RangeReader });
        const view = { source: 'live' as const, result, index: 0, mode: 'blink' as const };
        expect(slot.render(box, marks, view)).toBe(true);
        expect(box.innerHTML).toContain('Reading');
        expect(signals).toHaveLength(1);
        expect(signals[0]!.aborted).toBe(false);
        slot.stop();
        expect(signals[0]!.aborted).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        // The stopped read ends quietly: no later frame is read and the page is not asked to draw.
        expect(signals).toHaveLength(1);
        expect(onChange).not.toHaveBeenCalled();
        // The same result on screen again: a fresh read, not a half-finished list.
        expect(slot.render(box, marks, view)).toBe(true);
        expect(signals).toHaveLength(2);
        expect(signals[1]!.aborted).toBe(false);
        slot.stop();
    });

    it('a list that had finished comes back after stop() without reading again', async () => {
        const result = livePair();
        const variance = vi.fn(async (f: RegriddedFrame) => f.variance ?? null);
        const read = vi.fn(async () => ({ data: new Int32Array(grid.width * grid.height), width: grid.width, height: grid.height }));
        const frames = new Map(result.frames.map(f => [f.frame.frame.obsId, f.frame]));
        const reader = { index: async (url: string) => ({ url }),
            readFloat32: async (index: { url: string }, name: string) => name === 'IMAGE' ? frames.get(index.url)!.data : new Float32Array(grid.width * grid.height),
        } as unknown as RangeReader;
        const onChange = vi.fn(), box = {} as HTMLElement, marks = {} as HTMLElement;
        const slot = mountChanges(onChange, { reader, read, variance });
        const view = { source: 'live' as const, result, index: 0, mode: 'blink' as const };
        slot.render(box, marks, view);
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
        slot.render(box, marks, view);
        const finished = box.innerHTML;
        const reads = [variance.mock.calls.length, read.mock.calls.length];
        expect(finished).toContain('Candidate 1');
        slot.stop();
        const again = {} as HTMLElement;
        expect(slot.render(again, {} as HTMLElement, view)).toBe(true);
        expect(again.innerHTML).toBe(finished);
        expect([variance.mock.calls.length, read.mock.calls.length]).toEqual(reads);
    });

    it('a frame whose flag read fails ends its other downloads when its turn is over', async () => {
        const result = livePair();
        const variance = vi.fn(async (f: RegriddedFrame) => f.variance ?? null);
        const read = vi.fn(async () => { throw new Error('flags failed'); });
        // The picture and background downloads never finish; each records the signal it was given.
        const pending: AbortSignal[] = [];
        const reader = { index: async (url: string) => ({ url }),
            readFloat32: (_index: unknown, _name: string, _box: unknown, signal: AbortSignal) => new Promise<Float32Array>(() => { pending.push(signal); }),
        } as unknown as RangeReader;
        const onChange = vi.fn(), box = {} as HTMLElement, marks = {} as HTMLElement;
        const slot = mountChanges(onChange, { reader, read, variance });
        const view = { source: 'live' as const, result, index: 0, mode: 'blink' as const };
        slot.render(box, marks, view);
        // Two frames, each with a picture and a background download: four in all, one frame after the other.
        await vi.waitFor(() => expect(pending).toHaveLength(4));
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
        expect(read).toHaveBeenCalledTimes(2);
        // Every download left behind by a failed frame was ended when that frame's turn was over.
        expect(pending.map(s => s.aborted)).toEqual([true, true, true, true]);
        slot.stop();
    });

    it('stop() during a frame whose flag read is still running ends all three of its downloads', async () => {
        const result = livePair();
        const variance = vi.fn(async (f: RegriddedFrame) => f.variance ?? null);
        const pending: AbortSignal[] = [];
        const hang = (signal: AbortSignal) => new Promise<never>(() => { pending.push(signal); });
        const read = vi.fn((_url: string, _layout: unknown, _box: unknown, options: { signal: AbortSignal }) => hang(options.signal));
        const reader = { index: async (url: string) => ({ url }),
            readFloat32: (_index: unknown, _name: string, _box: unknown, signal: AbortSignal) => hang(signal),
        } as unknown as RangeReader;
        const onChange = vi.fn(), box = {} as HTMLElement, marks = {} as HTMLElement;
        const slot = mountChanges(onChange, { reader, read: read as never, variance });
        slot.render(box, marks, { source: 'live' as const, result, index: 0, mode: 'blink' as const });
        await vi.waitFor(() => expect(pending).toHaveLength(3));
        expect(pending.map(s => s.aborted)).toEqual([false, false, false]);
        slot.stop();
        expect(pending.map(s => s.aborted)).toEqual([true, true, true]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        // The second frame is never started.
        expect(pending).toHaveLength(3);
    });
});

describe('page change list is the plain list', () => {
    beforeEach(() => { seed = 918273; });

    it('passes plain: true on every page call', () => {
        const find = vi.fn((..._a: Parameters<typeof findChanges>) => findChanges(..._a));
        const a = noise(grid), b = noise(grid);
        point(b, 60, 60, 3000);
        changesFor(sky([frame('a', 60000, 2, a), frame('b', 60030, 2, b)]), find);
        expect(find).toHaveBeenCalledTimes(1);
        expect(find.mock.calls[0]![2]).toEqual({ plain: true });
        expect(PAGE_CHANGE_OPTIONS).toEqual({ plain: true });
    });

    it('P7 removes catalogue and ordering notes when archive flags remove the entire real list', async () => {
        const html = await screenedPage(livePair(), () => 1);
        expect(pageNotes(html)).toEqual([
            'Earlier visit at 2.000 µm, later at 2.000 µm.',
            "Noise estimated using the frames' pixel uncertainty maps.",
            'No source above 5 times the noise at the centre of the view in either visit.',
            '2 candidates are not listed: for each, in at least one frame of a checked visit, the brightest of up to four detector pixels at or beside that frame’s brightest point within 12″ of its spot carries the archive flag TRANSIENT.',
        ]);
        expect(html.includes('Every spot listed')).toBe(false);
    });

    it('P9 re-sorts the real list after overflow removes the strongest spot S/N', async () => {
        const html = await screenedPage(livePair(), x => x < 60 ? 2 : 0);
        const lines = [...html.matchAll(/<li><b>Candidate \d+<\/b> (.*?)<\/li>/g)].map(m => m[1]!);
        expect(lines).toEqual([
            "Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one (S/N &gt; 50; candidate).",
            "The light here differs between the two visits, and which visit has more is not clear (candidate). In at least one frame of the later visit, the archive flags the brightest of up to four detector pixels at or beside that frame’s brightest point within 12″ of the spot as OVERFLOW; an overflowing pixel can make the reading here unreliable.",
        ]);
        expect(pageNotes(html)).toEqual([
            'Earlier visit at 2.000 µm, later at 2.000 µm.',
            "Noise estimated using the frames' pixel uncertainty maps.",
            'No source above 5 times the noise at the centre of the view in either visit.',
            'Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise; within each group, spots with no S/N figure come after those with one.',
            '1 of the 2 candidates is marked by an archive overflow flag, so its S/N is left out; the S/N figure there can be unreliable.',
            'No catalogue stars for this view: every spot is listed without a catalogue match.',
        ]);
    });

    it('explains when flags remove every displayed S/N', async () => {
        const html = await screenedPage(livePair(), () => 2);
        expect(pageNotes(html)).toEqual([
            'Earlier visit at 2.000 µm, later at 2.000 µm.',
            "Noise estimated using the frames' pixel uncertainty maps.",
            'No source above 5 times the noise at the centre of the view in either visit.',
            'Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise.',
            'Both candidates are marked by an archive overflow flag, so their S/N is left out; the S/N figure there can be unreliable.',
            'No catalogue stars for this view: every spot is listed without a catalogue match.',
        ]);
    });

    it('P9 real finder metadata rebuilds stale S/N counts after the flag screen', async () => {
        const result = livePair();
        for (const f of result.frames) { f.frame.variance![30 * grid.width + 30] = NaN; }
        const html = await screenedPage(result, x => x < 60 ? 1 : 0);
        expect(pageNotes(html)).toEqual([
            'Earlier visit at 2.000 µm, later at 2.000 µm.',
            "Noise estimated using the frames' pixel uncertainty maps.",
            'No source above 5 times the noise at the centre of the view in either visit.',
            'Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise.',
            'No catalogue stars for this view: every spot is listed without a catalogue match.',
            '1 candidate is not listed: in at least one frame of a checked visit, the brightest of up to four detector pixels at or beside that frame’s brightest point within 12″ of its spot carries the archive flag TRANSIENT.',
        ]);
    });

    it('replaces a finder note for two of three after screening the third candidate', async () => {
        const find: typeof findChanges = (...args) => {
            const result = findChanges(...args);
            const dropped = result.candidates.find(c => c.pix.x < 60)!;
            const kept = result.candidates.find(c => c.pix.x > 60)!;
            result.candidates = [dropped, { ...kept, snrMapMissing: true }, { ...kept, id: 'other', snrMapMissing: true }];
            result.notes.push("The frames' error maps have no value at 2 of the 3 candidates, so their S/N is left out; the noise there comes from the difference image alone.");
            return result;
        };
        const notes = pageNotes(await screenedPage(livePair(), x => x < 60 ? 1 : 0, find));
        expect(notes.filter(n => n.includes("frames' error maps have no value"))).toEqual([
            "The frames' error maps have no value at both candidates, so their S/N is left out; the noise there comes from the difference image alone.",
        ]);
    });

    it('only lists plain readings on the cases the classifier names', () => {
        const firstMjd = 60000, lastMjd = firstMjd + 365.25;
        // A Barnard-shaped mover with listed motion (classifier: mover / moved).
        const pos = gridPixToSky(grid, { x: 57, y: 60 });
        const moving = { ...star('barnard', pos.ra, pos.dec), epochJyear: 2000 + (firstMjd + 0.005 - 51544.5) / 365.25, pmRa: -10300, pmDec: 0 };
        const later = gridSkyToPix(grid, positionAt({ ra: moving.ra, dec: moving.dec, epochJyear: moving.epochJyear,
            pmRa: moving.pmRa, pmDec: moving.pmDec }, lastMjd + 0.005));
        const a = noise(grid), b = noise(grid);
        point(a, 57, 60, 3000); point(b, later.x, later.y, 3000);
        // A catalogue star that fades (classifier: fainter), and new light away from any star (classifier: laterOnly).
        const fade = gridPixToSky(grid, { x: 25, y: 25 });
        point(a, 25, 25, 3000); point(b, 25, 25, 800);
        point(b, 95, 95, 2500);
        const frames = [frame('a', firstMjd, 2, a), frame('b', lastMjd, 2, b)];
        const stars = [moving, star('fade', fade.ra, fade.dec)];
        const page = changesFor(sky(frames, stars))!;
        expect(page.ran).toBe(true);
        expect(page.candidates.length).toBeGreaterThanOrEqual(3);
        for (const c of page.candidates) {
            expect(c.kind).toBe('unknown');
            expect(['moreLater', 'lessLater', 'unclear']).toContain(c.reading);
            expect(c.ends).toHaveLength(1);
        }
        // The classifier would have named some of them, so this is the plain path, not a quiet input.
        const classified = findChanges(sky(frames, stars)).candidates;
        expect(classified.some((c) => c.kind !== 'unknown' || !['moreLater', 'lessLater'].includes(c.reading as string))).toBe(true);
    });
});
