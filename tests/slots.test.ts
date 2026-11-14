import { describe, expect, it, vi } from 'vitest';
import { FEATURES, FLAGS_TEXT, mountFlags, shownBits, type FlagsDeps, type SlotView } from '../src/ui/slots';
import { makeWcs } from '../src/lib/wcs';
import type { FlagsLayout } from '../src/lib/flags';
import type { SkyResult } from '../src/lib/source';
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

function harness(extra: Partial<FlagsDeps> = {})
{
    const calls: Call[] = [];
    const paints: Uint8ClampedArray[] = [];
    const onChange = vi.fn();
    const read = ((url: string, _l: FlagsLayout, _b: PixelBox, opts: { signal?: AbortSignal } = {}) => new Promise((res, rej) => {
        calls.push({ url, signal: opts.signal, resolve: () => res({ data: data(), width: 21, height: 21 }), reject: rej });
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
