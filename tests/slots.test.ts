import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURES, FEATURES, FLAGS_READ_TIMEOUT_MS, FLAGS_TEXT, featuresFrom, mountChanges, mountFalseColour, mountFlags, renderHalo, shownBits, type FlagsDeps, type SlotView } from '../src/ui/slots';
import { DETECTORS } from '../src/ui/copy';
import { apertureFor } from '../src/ui/measure';
import { colourAt } from '../src/lib/falsecolour';
import * as colour from '../src/lib/falsecolour';
import { makeWcs } from '../src/lib/wcs';
import type { FlagsLayout } from '../src/lib/flags';
import type { SkyRequest, SkyResult } from '../src/lib/source';
import type { OutputGrid, PixelBox, RegriddedFrame, WcsParams } from '../src/lib/types';

const angle = 31 * Math.PI / 180;
const scale = 6.15 / 3600;
const params: WcsParams = {
    crpix: [21, 21], crval: [150, 2], naxis: [40, 40],
    cd: [[-scale * Math.cos(angle), scale * Math.sin(angle)], [scale * Math.sin(angle), scale * Math.cos(angle)]],
};
const wcs = makeWcs(params);
const box: PixelBox = { x0: 10, y0: 10, x1: 31, y1: 31 };
const grid: OutputGrid = { center: { ra: 150, dec: 2 }, fovDeg: 0.06, pixelArcsec: 1.5375, width: 97, height: 97 };
const layout = {} as FlagsLayout;
const names = [
    { bit: 0, name: 'TRANSIENT' }, { bit: 12, name: 'FULLSAMPLE' }, { bit: 19, name: 'OUTLIER' },
    { bit: 21, name: 'SOURCE' }, { bit: 23, name: 'GHOST_FPA' },
];

function frame(url: string, withFlags = true): RegriddedFrame
{
    return {
        frame: {} as RegriddedFrame['frame'], grid, data: new Float32Array(97 * 97), lambdaAtCenter: 1, bandwidthAtCenter: 0.01,
        context: { wcs, box, url, ...(withFlags ? { flags: { layout, names } } : {}) },
    };
}

function sky(frames: RegriddedFrame[]): SkyResult
{
    return { source: 'live', grid, frames: frames.map(f => ({ frame: f, label: '' })), locked: [], lambda: 1, stars: [], credits: [], notes: [] } as unknown as SkyResult;
}

// 21 x 21 detector box: a 5 x 5 TRANSIENT block in the middle and SOURCE everywhere else.
function data(): Int32Array
{
    const d = new Int32Array(21 * 21).fill(1 << 21);
    for (let y = 8; y <= 12; y++) {
        for (let x = 8; x <= 12; x++) {
            d[y * 21 + x] = 1;
        }
    }
    return d;
}

interface Call { url: string; signal?: AbortSignal; resolve: () => void; reject: (e: unknown) => void }

function harness(extra: Partial<FlagsDeps> = {}, rejectOnAbort = false)
{
    const calls: Call[] = [];
    const paints: Uint8ClampedArray[] = [];
    const onChange = vi.fn();
    const read = ((url: string, _l: FlagsLayout, _b: PixelBox, opts: { signal?: AbortSignal } = {}) => new Promise((res, rej) => {
        calls.push({ url, signal: opts.signal, resolve: () => res({ data: data(), width: 21, height: 21 }), reject: rej });
        if (rejectOnAbort) {
            opts.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
        }
    })) as unknown as FlagsDeps['read'];
    const slot = mountFlags({} as HTMLElement, onChange, { enabled: true, read, paint: (_l, rgba) => paints.push(rgba), ...extra });
    return { slot, calls, paints, onChange };
}

const flush = () => new Promise(r => setTimeout(r, 0));
const view = (result: SkyResult, index = 0, over: Partial<SlotView> = {}): SlotView => ({ result, index, mode: 'blink', source: 'live', ...over });

describe('flags slot', () => {
    it('ships switched on (spectrum stays off); switched off it shows nothing and reads nothing', () => {
        expect(FEATURES.flags).toBe(true);
        expect(FEATURES.spectrum).toBe(false);
        const { slot, calls } = harness({ enabled: false });
        expect(slot.update(view(sky([frame('a')])), true)).toEqual({ key: false, layer: false, note: '' });
        expect(calls).toHaveLength(0);
    });

    it('leaves out SOURCE, FULLSAMPLE and GHOST_FPA', () => {
        expect(shownBits(names)).toEqual([0, 19]);
    });

    it('hides in Stack, Subtract and the simulated sky', () => {
        const { slot } = harness();
        const r = sky([frame('a')]);
        for (const over of [{ mode: 'stack' }, { mode: 'diff' }, { source: 'demo' }] as Partial<SlotView>[]) {
            expect(slot.update(view(r, 0, over), true)).toEqual({ key: false, layer: false, note: '' });
        }
    });

    it('shows the key but reads nothing while switched off', () => {
        const { slot, calls } = harness();
        expect(slot.update(view(sky([frame('a')])), false)).toEqual({ key: true, layer: false, note: '' });
        expect(calls).toHaveLength(0);
    });

    it('asks for a live read on the saved copy', () => {
        const { slot, calls } = harness();
        const f = frame('a');
        delete f.context;
        expect(slot.update(view(sky([f]), 0, { source: 'snapshot' }), true).note).toBe(FLAGS_TEXT.snapshot);
        expect(calls).toHaveLength(0);
    });

    it('reads once, paints once, and counts only the bits it shows', async () => {
        const { slot, calls, paints, onChange } = harness();
        const r = sky([frame('a')]);
        expect(slot.update(view(r), true)).toEqual({ key: true, layer: false, note: FLAGS_TEXT.loading });
        expect(slot.update(view(r), true).note).toBe(FLAGS_TEXT.loading);
        expect(calls.map(c => c.url)).toEqual(['a']);
        calls[0]!.resolve();
        await flush();
        expect(onChange).toHaveBeenCalledTimes(1);
        const s = slot.update(view(r), true);
        expect(s.layer).toBe(true);
        expect(s.note).toMatch(/^25 of 4[0-4]\d detector pixels in this view are flagged/);
        expect(s.note).toContain('TRANSIENT (25)');
        expect(s.note).not.toContain('SOURCE');
        slot.update(view(r), true);
        expect(paints).toHaveLength(1);
        expect(calls).toHaveLength(1);
    });

    it('reads one frame at a time and skips frames passed while playing', async () => {
        const { slot, calls } = harness();
        const r = sky([frame('a'), frame('b'), frame('c')]);
        slot.update(view(r, 0), true);
        slot.update(view(r, 1), true);
        slot.update(view(r, 2), true);
        expect(calls.map(c => c.url)).toEqual(['a']);
        calls[0]!.resolve();
        await flush();
        expect(calls.map(c => c.url)).toEqual(['a', 'c']);
        expect(slot.update(view(r, 0), true).layer).toBe(true);
    });

    it('says when a read fails or the frame has no flags', async () => {
        const { slot, calls } = harness();
        const r = sky([frame('a'), frame('b', false)]);
        slot.update(view(r, 0), true);
        calls[0]!.reject(new Error('503'));
        await flush();
        expect(slot.update(view(r, 0), true)).toEqual({ key: true, layer: false, note: FLAGS_TEXT.failed });
        expect(slot.update(view(r, 1), true).note).toBe(FLAGS_TEXT.failed);
        expect(calls).toHaveLength(1);
    });

    describe.each([true, false])('read deadlines with AbortSignal.any=%s', useAny => {
        beforeEach(() => {
            vi.useFakeTimers();
            if (!useAny) {
                vi.stubGlobal('AbortSignal', { any: undefined });
            }
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.unstubAllGlobals();
        });

        it.each([undefined, 50])('fails a stalled frame at the deadline (%s ms) and starts the next wanted frame', async timeoutMs => {
            const { slot, calls, onChange } = harness({ timeoutMs }, true);
            const r = sky([frame('a'), frame('b')]);
            slot.update(view(r, 0), true);
            slot.update(view(r, 1), true);
            expect(calls.map(c => c.url)).toEqual(['a']);
            await vi.advanceTimersByTimeAsync((timeoutMs ?? FLAGS_READ_TIMEOUT_MS) - 1);
            expect(calls[0]!.signal?.aborted).toBe(false);
            expect(onChange).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(calls[0]!.signal?.aborted).toBe(true);
            expect(slot.update(view(r, 0), true)).toEqual({ key: true, layer: false, note: FLAGS_TEXT.failed });
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(calls.map(c => c.url)).toEqual(['a', 'b']);
            expect(slot.update(view(r, 1), true).note).toBe(FLAGS_TEXT.loading);
            slot.update(null, false);
            await vi.advanceTimersByTimeAsync(0);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('aborts a read on reset before its deadline without changing the new result', async () => {
            const { slot, calls, onChange } = harness({ timeoutMs: 100 }, true);
            slot.update(view(sky([frame('a')])), true);
            await vi.advanceTimersByTimeAsync(50);
            const r2 = sky([frame('b')]);
            slot.update(view(r2), true);
            expect(calls[0]!.signal?.aborted).toBe(true);
            await vi.advanceTimersByTimeAsync(0);
            expect(onChange).not.toHaveBeenCalled();
            expect(slot.update(view(r2), true).note).toBe(FLAGS_TEXT.loading);
            expect(calls.map(c => c.url)).toEqual(['a', 'b']);
            calls[1]!.resolve();
            await vi.advanceTimersByTimeAsync(0);
            expect(slot.update(view(r2), true).layer).toBe(true);
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('clears the deadline after success so the ready read is never aborted later', async () => {
            const { slot, calls, onChange } = harness({ timeoutMs: 50 }, true);
            const r = sky([frame('a')]);
            slot.update(view(r), true);
            calls[0]!.resolve();
            await vi.advanceTimersByTimeAsync(0);
            expect(slot.update(view(r), true).layer).toBe(true);
            await vi.advanceTimersByTimeAsync(FLAGS_READ_TIMEOUT_MS);
            expect(calls[0]!.signal?.aborted).toBe(false);
            expect(slot.update(view(r), true).layer).toBe(true);
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(calls).toHaveLength(1);
            expect(vi.getTimerCount()).toBe(0);
        });
    });

    it('drops a read when the frames change', async () => {
        const { slot, calls, onChange } = harness();
        slot.update(view(sky([frame('a')])), true);
        const r2 = sky([frame('b')]);
        slot.update(view(r2), true);
        expect(calls[0]!.signal?.aborted).toBe(true);
        calls[0]!.resolve();
        await flush();
        expect(onChange).not.toHaveBeenCalled();
        expect(calls.map(c => c.url)).toEqual(['a', 'b']);
        calls[1]!.resolve();
        await flush();
        expect(slot.update(view(r2), true).layer).toBe(true);
    });
});

describe('slots for modules still in their lanes', () => {
    it('ship switched off and show nothing until a module fills them (the change list is on)', () => {
        expect(FEATURES.changes).toBe(true);
        expect(FEATURES.falseColour).toBe(true);
        expect(FEATURES.fcReading).toBe(false);
        expect(FEATURES.halo).toBe(false);
        const dated = frame('a');
        dated.frame.tMin = 60000;
        dated.frame.tMax = 60000.001;
        const v = view(sky([dated]));
        const el = {} as HTMLElement;
        // The change panel (switched on): one visit read live shows only the finder's own message.
        const box = {} as HTMLElement;
        const marks = {} as HTMLElement;
        expect(mountChanges(() => {}).render(box, marks, v)).toBe(true);
        expect(box.innerHTML).toBe('<ul class="sk-chg-notes"><li>Change finding needs two visits; these frames make 1.</li></ul>');
        expect(marks.innerHTML).toBe('');
        expect(renderHalo(el, v)).toBe(false);
        const none = { key: false, layer: false, note: '' };
        expect(mountFalseColour(el, () => {}, { enabled: false }).update(v, true)).toEqual(none);
        expect(mountFalseColour(el, () => {}, { enabled: true }).update(null, true)).toEqual(none);
    });
});

function colourHarness(enabled = true, readingEnabled = true)
{
    const calls: { req: SkyRequest; resolve: (result: SkyResult) => void; reject: (error: Error) => void }[] = [];
    const paint = vi.fn();
    const onChange = vi.fn();
    const source = { load: (req: SkyRequest) => new Promise<SkyResult>((resolve, reject) => calls.push({ req, resolve, reject })) };
    const slot = mountFalseColour({} as HTMLElement, onChange, { enabled, readingEnabled, source, paint });
    return { slot, calls, paint, onChange };
}

describe('false colour slot', () => {
    it('reports the chosen picture frames and keeps labels and warning visible', async () => {
        const h = colourHarness(true, true);
        const a = frame('a');
        const excluded = frame('excluded');
        const b = frame('b');
        a.lambdaAtCenter = 0.85;
        b.lambdaAtCenter = 4.6;
        excluded.data.fill(NaN);
        a.frame = { tMin: 60857, tMax: 60858, detector: 1, collection: 'spherex_dr1', release: 'dr1' } as RegriddedFrame['frame'];
        b.frame = { tMin: 61000, tMax: 61001, detector: 6, collection: 'spherex_qr3', release: 'qr3' } as RegriddedFrame['frame'];
        const v = view(sky([a, excluded]), 0, { mode: 'stack' });
        expect(h.slot.update(v, true).picture).toBeUndefined();
        h.calls[0]!.resolve(sky([b]));
        await flush();
        const state = h.slot.update(v, true);
        expect(state.picture).toEqual([
            { lambda: 0.85, used: 1, leftOut: 1, times: [[60857, 60858]], records: [a.frame] },
            { lambda: 4.6, used: 1, leftOut: 0, times: [[61000, 61001]], records: [b.frame] },
        ]);
        expect(state.split?.lead).toContain('Blue: 0.85 µm');
        expect(state.split?.lead).toContain('Orange: 4.60 µm');
        expect(state.split?.lead).toContain('False colour, not what an eye would see.');
        expect(state.split?.lead).toContain('a detector hit can show as a coloured point');
        const all = `${state.split?.lead} ${state.split?.more}`;
        for (const sentence of state.note.split(/(?<=\.)\s+/)) {
            expect(all).toContain(sentence);
        }
    });

    it('keeps the sentence on how 3 or more frames are combined in view, not folded', async () => {
        const h = colourHarness(true, true);
        const mk = (name: string, lambda: number, t: number) => {
            const f = frame(name);
            f.lambdaAtCenter = lambda;
            f.frame = { tMin: t, tMax: t + 1, detector: 1, collection: 'spherex_dr1', release: 'dr1' } as RegriddedFrame['frame'];
            return f;
        };
        const v = view(sky([mk('a1', 0.85, 60857), mk('a2', 0.85, 60887), mk('a3', 0.85, 60917)]), 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([mk('b1', 4.6, 60857), mk('b2', 4.6, 60887), mk('b3', 4.6, 60917)]));
        await flush();
        const state = h.slot.update(v, true);
        expect(state.split?.lead).toContain('With 3 or more frames at 0.85 µm and 4.60 µm, the middle value of the frames is used at each pixel');
        expect(state.split?.more).not.toContain('With 3 or more frames');
        expect(state.split?.more).toContain('blue means brighter at the shorter wavelength');
        const all = `${state.split?.lead} ${state.split?.more}`;
        for (const sentence of state.note.split(/(?<=\.)\s+/)) {
            expect(all).toContain(sentence);
        }
    });

    it('reports a picture only while the colour layer is actually on screen', async () => {
        for (const leave of ['off', 'blink', 'subtract', 'snapshot', 'target', 'field', 'colour', 'play'] as const) {
            const h = colourHarness();
            const primary = sky([frame('primary')]);
            const partner = frame('partner');
            partner.lambdaAtCenter = 4.6;
            const active = view(primary, 0, { mode: 'stack' });
            expect(h.slot.update(active, true).picture).toBeUndefined();
            h.calls[0]!.resolve(sky([partner]));
            await flush();
            expect(h.slot.update(active, true).picture).toBeDefined();
            let next = active;
            if (leave === 'blink' || leave === 'play') {
                next = view(primary, 0, { mode: 'blink' });
            } else if (leave === 'subtract') {
                next = view(primary, 0, { mode: 'diff' });
            } else if (leave === 'snapshot') {
                next = view(primary, 0, { mode: 'stack', source: 'snapshot' });
            } else if (leave === 'target' || leave === 'field' || leave === 'colour') {
                next = view(sky([frame(leave)]), 0, { mode: 'stack' });
            }
            const state = h.slot.update(next, leave !== 'off');
            expect(state.layer).toBe(false);
            expect(state.picture).toBeUndefined();
        }
    });
    it('shows the reason when less than half the view can be coloured', async () => {
        const h = colourHarness();
        const a = frame('a');
        const b = frame('b');
        b.lambdaAtCenter = 4.6;
        for (let p = 0; p < a.data.length; p++) {
            if (p % 97 < 49) {
                b.data[p] = NaN;
            } else {
                a.data[p] = NaN;
            }
        }
        const v = view(sky([a]), 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([b]));
        await flush();
        const state = h.slot.update(v, true);
        expect(state.layer).toBe(false);
        expect(state.note).toBe('False colour is not shown for this view: the frames at the two wavelengths give a colour to less than half of it.');
        expect(h.paint).not.toHaveBeenCalled();
    });
    it('defaults false colour on and its colour reading off, and accepts both in preview features', () => {
        expect(DEFAULT_FEATURES.falseColour).toBe(true);
        expect(DEFAULT_FEATURES.fcReading).toBe(false);
        expect(featuresFrom('falseColour,fcReading')).toMatchObject({ falseColour: true, fcReading: true });
        expect(featuresFrom('fcReading,-fcReading')).toMatchObject({ falseColour: true, fcReading: false });
        expect(featuresFrom('-falseColour')).toMatchObject({ falseColour: false, fcReading: false });
        for (const reading of [false, true]) {
            const h = colourHarness(false, reading);
            expect(JSON.stringify(h.slot.update(view(sky([frame('a')])), true))).toBe('{"key":false,"layer":false,"note":""}');
            expect(h.calls).toHaveLength(0);
            expect(h.paint).not.toHaveBeenCalled();
        }
    });

    it('shows only picture text with fcReading off, retaining the warning in the lead', async () => {
        const h = colourHarness(true, false);
        const a = frame('a');
        const b = frame('b');
        b.lambdaAtCenter = 4.6;
        for (let y = 0; y < 97; y++) {
            for (let x = 0; x < 48; x++) {
                b.data[y * 97 + x] = NaN;
            }
        }
        const v = view(sky([a]), 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([b]));
        await flush();
        const state = h.slot.update(v, true);
        expect(state.layer).toBe(true);
        expect(state.note).not.toMatch(/At the centre|signal-to-noise|seen at|The reading|Position is compared|count as one visit/);
        expect(state.note).toContain('Blue:');
        expect(state.note).toContain('Hatched areas have no colour:');
        expect(state.split?.lead).toContain('Hatched areas have no colour:');
        expect(state.split?.more).not.toContain('Hatched areas have no colour:');
        expect(state.split?.lead).toContain('a detector hit can show as a coloured point');
    });

    it('defaults the reading off when its override is omitted', async () => {
        const calls: { resolve: (result: SkyResult) => void }[] = [];
        const source = { load: () => new Promise<SkyResult>(resolve => calls.push({ resolve })) };
        const slot = mountFalseColour({} as HTMLElement, vi.fn(), { enabled: true, source, paint: vi.fn() });
        const b = frame('b');
        b.lambdaAtCenter = 4.6;
        const v = view(sky([frame('a')]), 0, { mode: 'stack' });
        slot.update(v, true);
        calls[0]!.resolve(sky([b]));
        await flush();
        expect(slot.update(v, true).note).not.toMatch(/At the centre|No reading is given|signal-to-noise/);
    });

    it('keeps the slot off when false colour is switched off, even with fcReading enabled', async () => {
        vi.stubEnv('VITE_PREVIEW_FEATURES', '-falseColour,fcReading');
        vi.resetModules();
        try {
            const { mountFalseColour: mount } = await import('../src/ui/slots');
            const load = vi.fn();
            const paint = vi.fn();
            const slot = mount({} as HTMLElement, vi.fn(), { source: { load }, paint });
            expect(slot.update(view(sky([frame('a')]), 0, { mode: 'stack' }), true))
                .toEqual({ key: false, layer: false, note: '' });
            expect(load).not.toHaveBeenCalled();
            expect(paint).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllEnvs();
            vi.resetModules();
        }
    });
    it('does not request a partner when the current view has no frames', () => {
        const h = colourHarness();
        const state = h.slot.update(view(sky([]), 0, { mode: 'stack' }), true);
        expect(state.note).toBe('No frames were found in this view.');
        expect(h.calls).toHaveLength(0);
    });

    it('reports the actual stacked frame counts and UTC dates and warns about different times', async () => {
        const h = colourHarness();
        const a = frame('a');
        const b = frame('b');
        const c = frame('c');
        a.frame = { tMin: 60857, tMax: 60857 } as RegriddedFrame['frame'];
        b.frame = { tMin: 61284, tMax: 61284 } as RegriddedFrame['frame'];
        c.frame = { tMin: 61000, tMax: 61000 } as RegriddedFrame['frame'];
        a.lambdaAtCenter = b.lambdaAtCenter = 1.23;
        c.lambdaAtCenter = 4.57;
        const v = view(sky([a, b]), 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([c]));
        await flush();
        const note = h.slot.update(v, true).note;
        expect(note).toContain('Blue: 1.23 µm (the shorter wavelength), 2 frames, 2025-07-01 and 2026-09-01.');
        expect(note).toContain('Orange: 4.57 µm (the longer wavelength), 1 frame, 2025-11-21.');
        expect(note).toContain('The two colours were not taken at the same times, so anything that moved or changed in between can show a false tint.');
    });

    it('omits the time warning for the same frame times', async () => {
        const h = colourHarness();
        const a = frame('a');
        const b = frame('b');
        a.frame = { tMin: 60857, tMax: 60857 } as RegriddedFrame['frame'];
        b.frame = { tMin: 60857 + 0.5 / 86400, tMax: 60857 + 0.5 / 86400 } as RegriddedFrame['frame'];
        a.lambdaAtCenter = 1.23;
        b.lambdaAtCenter = 4.57;
        const v = view(sky([a]), 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([b]));
        await flush();
        expect(h.slot.update(v, true).note).not.toContain('The two colours were not taken at the same times');
        expect(h.slot.update(v, true).note).toContain('1 frame, 2025-07-01');
    });

    it('does not claim different times when frame dates are unavailable', async () => {
        const h = colourHarness();
        const a = frame('a');
        const b = frame('b');
        b.lambdaAtCenter = 4.5;
        const v = view(sky([a]), 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([b]));
        await flush();
        const note = h.slot.update(v, true).note;
        expect(note).toContain('The frame dates are unavailable, so the two colours may have been taken at different times.');
        expect(note).not.toContain('were not taken at the same times');
    });

    it('warns when frame times differ by more than the one-second tolerance', async () => {
        const h = colourHarness();
        const a = frame('a');
        const b = frame('b');
        a.frame = { tMin: 60857, tMax: 60857 } as RegriddedFrame['frame'];
        b.frame = { tMin: 60857 + 1.5 / 86400, tMax: 60857 + 1.5 / 86400 } as RegriddedFrame['frame'];
        b.lambdaAtCenter = 4.5;
        const v = view(sky([a]), 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([b]));
        await flush();
        expect(h.slot.update(v, true).note).toContain('The two colours were not taken at the same times');
    });

    it('labels a band with all its frames when one frame is partly blank at the spot', async () => {
        const h = colourHarness();
        const a = frame('a');
        const b = frame('b');
        const c = frame('c');
        const d = frame('d');
        a.lambdaAtCenter = 1.1;
        b.lambdaAtCenter = 1.3;
        c.lambdaAtCenter = 4.5;
        d.lambdaAtCenter = 4.7;
        b.data[48 * 97 + 48] = NaN;
        c.data[48 * 97 + 48] = NaN;
        d.data[48 * 97 + 48] = NaN;
        const v = view(sky([a, b]), 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([c, d]));
        await flush();
        const note = h.slot.update(v, true).note;
        // Frame b is blank at the centre while frame a is not, so the short band cannot be measured there and the
        // label describes the picture, which both frames paint: their mean wavelength, not frame a's alone.
        expect(note).toContain('Blue: 1.20 µm (the shorter wavelength), 2 frames');
        expect(note).toContain('Orange: 4.60 µm');
        expect(note).toContain('At the centre: cannot be measured here (blank pixels).');
    });

    it('measures a native-width star with the page aperture on the fine grid', async () => {
        const h = colourHarness();
        const measure = vi.spyOn(colour, 'colourAt');
        const a = frame('a');
        const b = frame('b');
        a.lambdaAtCenter = 1.25;
        b.lambdaAtCenter = 4.6;
        for (let y = 0; y < 97; y++) {
            for (let x = 0; x < 97; x++) {
                const d2 = (x - 48) ** 2 + (y - 48) ** 2;
                const value = 15 * Math.exp(-d2 / (2 * 4 ** 2)) + ((x * 13 + y * 7) % 11 - 5);
                a.data[y * 97 + x] = value;
                b.data[y * 97 + x] = value;
            }
        }
        const v = view(sky([a]), 0, { mode: 'stack' });
        const centre = { x: 48, y: 48 };
        const radii = apertureFor(grid);
        expect(radii).toEqual({ radius: 8, annulusIn: 12, annulusOut: 24 });
        expect(colourAt(a.data, b.data, 97, 97, centre, { pixelArcsec: grid.pixelArcsec, ...radii }).seen).toBe('both');
        expect(colourAt(a.data, b.data, 97, 97, centre, { pixelArcsec: grid.pixelArcsec }).seen).not.toBe('both');
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([b]));
        await flush();
        expect(h.slot.update(v, true).note).toContain('At the centre: seen at 1.25 µm');
        expect(h.slot.update(v, true).note).toContain('seen at 4.60 µm');
        expect(h.slot.update(v, true).note).toContain('one frame only, so a detector hit cannot be ruled out');
        expect(measure).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 97, 97, centre,
            { pixelArcsec: grid.pixelArcsec, ...radii, minSnr: 3 });
        measure.mockRestore();
    });
    it('hides demo and disabled views, and explains snapshot and Blink', () => {
        const h = colourHarness();
        const r = sky([frame('a')]);
        expect(h.slot.update(view(r, 0, { source: 'demo' }), true)).toEqual({ key: false, layer: false, note: '' });
        expect(h.slot.update(view(r, 0, { source: 'snapshot' }), true).note).toMatch(/live read/i);
        expect(h.slot.update(view(r), true).note).toMatch(/Stack/);
        expect(h.slot.update(view(r), false).note).toBe('');
        expect(h.calls).toHaveLength(0);
        const disabled = colourHarness(false);
        expect(disabled.slot.update(view(r, 0, { mode: 'stack' }), true)).toEqual({ key: false, layer: false, note: '' });
        expect(disabled.calls).toHaveLength(0);
    });

    it.each([[2.419, 4.6, 6], [2.42, 1.25, 2]] as const)('requests the partner of %s once', (lambda, partner, detector) => {
        const h = colourHarness();
        const r = { ...sky([frame('a')]), lambda };
        const v = view(r, 0, { mode: 'stack', targetId: 'barnard' });
        expect(h.slot.update(v, true).note).toMatch(/Reading/);
        h.slot.update(v, true);
        expect(h.calls).toHaveLength(1);
        expect(h.calls[0]!.req).toMatchObject({ center: grid.center, fovDeg: grid.fovDeg, lambda: partner, detector, target: 'barnard' });
    });

    it('drops stale and switched-off reads', async () => {
        const h = colourHarness();
        const a = sky([frame('a')]);
        const b = sky([frame('b')]);
        const v = view(b, 0, { mode: 'stack' });
        h.slot.update(view(a, 0, { mode: 'stack' }), true);
        h.slot.update(v, true);
        expect(h.calls[0]!.req.signal?.aborted).toBe(true);
        h.calls[0]!.resolve(sky([frame('old')]));
        await flush();
        expect(h.paint).not.toHaveBeenCalled();
        expect(h.onChange).not.toHaveBeenCalled();
        h.slot.update(v, false);
        expect(h.calls[1]!.req.signal?.aborted).toBe(true);
        h.calls[1]!.resolve(sky([frame('old')]));
        await flush();
        expect(h.paint).not.toHaveBeenCalled();
    });

    it('reports read failure, no frames and a mismatched grid', async () => {
        for (const failure of ['reject', 'empty', 'grid'] as const) {
            const h = colourHarness();
            const r = sky([frame('a')]);
            const v = view(r, 0, { mode: 'stack' });
            h.slot.update(v, true);
            if (failure === 'reject') {
                h.calls[0]!.reject(new Error('offline'));
            } else if (failure === 'empty') {
                h.calls[0]!.resolve(sky([]));
            } else {
                h.calls[0]!.resolve({ ...sky([frame('b')]), grid: { ...grid, width: 98 } });
            }
            await flush();
            const state = h.slot.update(v, true);
            expect(state.layer).toBe(false);
            expect(state.failed).toBe(true);
            expect(state.note).toMatch(failure === 'empty' ? /4\.60 µm/ : failure === 'grid' ? /grid/i : /read/i);
            expect(h.paint).not.toHaveBeenCalled();
        }
    });

    it.each([false, true])('paints the short band blue whichever band starts the view (long first: %s)', async longFirst => {
        const h = colourHarness();
        const short = frame('short');
        const long = frame('long');
        short.lambdaAtCenter = 1.234;
        long.lambdaAtCenter = 4.567;
        short.data[0] = 100;
        const initial = sky([longFirst ? long : short]);
        initial.lambda = longFirst ? 4.6 : 1.25;
        const partner = sky([longFirst ? short : long]);
        const v = view(initial, 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(partner);
        await flush();
        const state = h.slot.update(v, true);
        expect(state.layer).toBe(true);
        expect(state.note).toContain('Blue: 1.23 µm');
        expect(state.note).toContain('Orange: 4.57 µm');
        const rgba = h.paint.mock.calls[0]![1] as Uint8ClampedArray;
        expect(rgba[2]).toBeGreaterThan(rgba[0]!);
        h.slot.update(v, true);
        expect(h.paint).toHaveBeenCalledTimes(1);
        expect(h.calls).toHaveLength(1);
    });

    it('uses the mean measured wavelengths of all stacked frames', async () => {
        const h = colourHarness();
        const first = frame('a');
        const second = frame('b');
        const partner = frame('c');
        first.lambdaAtCenter = 1.1;
        second.lambdaAtCenter = 1.3;
        partner.lambdaAtCenter = 4.4;
        const initial = sky([first, second]);
        const v = view(initial, 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([partner]));
        await flush();
        expect(h.slot.update(v, true).note).toContain('Blue: 1.20 µm');
    });

    it('turns source, stack and paint exceptions into notes', async () => {
        const r = sky([frame('a')]);
        const v = view(r, 0, { mode: 'stack' });
        const sync = mountFalseColour({} as HTMLElement, () => {}, { enabled: true, source: { load: () => { throw new Error(); } } });
        expect(sync.update(v, true).layer).toBe(false);
        expect(sync.update(v, true).failed).toBe(true);
        const h = colourHarness();
        h.slot.update(v, true);
        const bad = frame('bad');
        bad.data = new Float32Array(1);
        h.calls[0]!.resolve(sky([bad]));
        await flush();
        expect(h.slot.update(v, true).layer).toBe(false);
        expect(h.slot.update(v, true).failed).toBe(true);
        const p = colourHarness();
        p.paint.mockImplementation(() => { throw new Error(); });
        p.slot.update(v, true);
        const partner = frame('p');
        partner.lambdaAtCenter = 4.5;
        p.calls[0]!.resolve(sky([partner]));
        await flush();
        expect(p.slot.update(v, true).layer).toBe(false);
        expect(p.slot.update(v, true).failed).toBe(true);
    });

    it('says nothing on the saved copy until the toggle is on', () => {
        const h = colourHarness();
        const snap = view(sky([frame('a')]), 0, { source: 'snapshot' });
        expect(h.slot.update(snap, false)).toEqual({ key: true, layer: false, note: '' });
        expect(h.slot.update(snap, true).note).toMatch(/live read/i);
    });

    it('keeps a finished picture when switched off and on, and across Blink and Stack', async () => {
        const h = colourHarness();
        const partner = frame('p');
        partner.lambdaAtCenter = 4.5;
        const r = sky([frame('a')]);
        const v = view(r, 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.resolve(sky([partner]));
        await flush();
        expect(h.slot.update(v, true).layer).toBe(true);
        expect(h.slot.update(v, false)).toEqual({ key: true, layer: false, note: '' });
        expect(h.slot.update(view(r, 0, { mode: 'blink' }), true).layer).toBe(false);
        const back = h.slot.update(v, true);
        expect(back.layer).toBe(true);
        expect(back.note).toContain('At the centre');
        expect(h.calls).toHaveLength(1);
        expect(h.paint).toHaveBeenCalledTimes(1);
    });

    it('tries a failed read again after the toggle goes off and on', async () => {
        const h = colourHarness();
        const v = view(sky([frame('a')]), 0, { mode: 'stack' });
        h.slot.update(v, true);
        h.calls[0]!.reject(new Error('offline'));
        await flush();
        expect(h.slot.update(v, true).note).toMatch(/could not be read/);
        expect(h.calls).toHaveLength(1);
        h.slot.update(v, false);
        expect(h.slot.update(v, true).note).toMatch(/Reading/);
        expect(h.calls).toHaveLength(2);
    });

    it('asks each partner wavelength of the detector that carries it', () => {
        for (const lambda of [1.0, 4.0]) {
            const h = colourHarness();
            h.slot.update(view({ ...sky([frame('a')]), lambda }, 0, { mode: 'stack' }), true);
            const req = h.calls[0]!.req;
            const [low, high] = DETECTORS[(req.detector as number) - 1]!;
            expect(req.lambda).toBeGreaterThanOrEqual(low);
            expect(req.lambda).toBeLessThanOrEqual(high);
        }
    });
});

describe('preview switch', () => {
    it('keeps the defaults when unset or empty, and flips only known names', () => {
        expect(featuresFrom(undefined)).toEqual(DEFAULT_FEATURES);
        expect(featuresFrom('')).toEqual(DEFAULT_FEATURES);
        expect(featuresFrom(' halo , falseColour,-flags,nonsense,constructor,__proto__')).toEqual({ ...DEFAULT_FEATURES, halo: true, falseColour: true, flags: false });
        expect(featuresFrom('halo,-halo')).toEqual(DEFAULT_FEATURES);
        expect(DEFAULT_FEATURES.epoch).toBe(true);
        expect(featuresFrom('-epoch')).toEqual({ ...DEFAULT_FEATURES, epoch: false });
        expect(DEFAULT_FEATURES.gestures).toBe(false);
        expect(featuresFrom('gestures').gestures).toBe(true);
    });

    it('ships with the build defaults when the variable is not set', () => {
        expect(import.meta.env.VITE_PREVIEW_FEATURES).toBeUndefined();
        expect(FEATURES).toEqual(DEFAULT_FEATURES);
    });
});
