// Empty, feature-flagged slots for modules built in their own lanes, so those lanes edit this file and never
// the shared UI. Both are off by default: a slot shows only when its flag is on AND it has something to show.
// - spectrum: a panel under the colour step, for src/lib/spectrum-chart.ts. Ships only once the owner logs it
//   in DECISIONS.md.
// - flags: a "Flags" toggle in the sky legend, a layer over the sky and a line under the legend, from
//   src/lib/flags.ts (read) and src/lib/flags-view.ts (mask on the picture's grid, counts, sentence).
import { readFlags } from '../lib/flags';
import { flagsRgba, regridFlags, summariseFlags } from '../lib/flags-view';
import type { SkyResult } from '../lib/source';
import type { RegriddedFrame } from '../lib/types';

export const FEATURES = Object.freeze({ spectrum: false, flags: false });

export interface SlotView {
    result: SkyResult;
    targetId?: string;
    index: number; // the frame on screen, in result.frames
    mode: 'blink' | 'stack' | 'diff';
    source: 'live' | 'snapshot' | 'demo';
}

// Called on every render (each frame while playing): cache by `view.result` and return quickly.
// Fill `box` with textContent or trusted SVG only. Return true when there is something to show.
export function renderSpectrum(box: HTMLElement, view: SlotView): boolean
{
    void box;
    void view;
    return false;
}

// Flag names (from the file's own MSKN cards) the layer leaves out. FULLSAMPLE is information only and GHOST_FPA
// is unused (Explanatory Supplement v2.1, Table 16). SOURCE marks every pixel of a catalogue star, which covers
// up to 75% of a crowded field (research/12), so drawing it would hide the picture.
export const FLAGS_LEFT_OUT: ReadonlySet<string> = new Set(['SOURCE', 'FULLSAMPLE', 'GHOST_FPA']);
export const FLAGS_COLOR: [number, number, number] = [255, 79, 216];
export const FLAGS_ALPHA = 170;

export const FLAGS_TEXT = Object.freeze({
    snapshot: 'Flags need a live read. Go live to load this frame from the archive with its flags.',
    loading: 'Reading this frame’s flags…',
    failed: 'This frame’s flags could not be read.',
});

export function shownBits(names: { bit: number; name: string }[]): number[]
{
    return names.filter(n => !FLAGS_LEFT_OUT.has(n.name.toUpperCase())).map(n => n.bit);
}

export interface FlagsState {
    key: boolean; // show the Flags key
    layer: boolean; // show the layer over the sky
    note: string; // the line under the legend ('' hides it)
}

type Entry =
    | { status: 'loading' }
    | { status: 'failed' }
    | { status: 'ready'; rgba: Uint8ClampedArray; width: number; height: number; sentence: string };

export interface FlagsDeps {
    enabled?: boolean; // defaults to FEATURES.flags (tests switch it on)
    read?: typeof readFlags;
    // Paints an RGBA mask over the sky; the default uses a canvas inside `layer`.
    paint?: (layer: HTMLElement, rgba: Uint8ClampedArray, width: number, height: number) => void;
}

export interface FlagsSlot {
    update(view: SlotView | null, on: boolean): FlagsState;
}

function paintCanvas(layer: HTMLElement, rgba: Uint8ClampedArray, width: number, height: number): void
{
    let canvas = layer.querySelector('canvas');
    if (!canvas) {
        canvas = layer.ownerDocument.createElement('canvas');
        layer.append(canvas);
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx && width > 0 && height > 0) {
        ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    }
}

// Reads FLAGS only once the layer is switched on, one frame at a time, and keeps each frame's mask until the
// result changes. While playing, the frame on screen when a read ends is read next; frames passed on the way
// are skipped. `onChange` runs when a read ends so the caller can render again.
export function mountFlags(layer: HTMLElement, onChange: () => void, deps: FlagsDeps = {}): FlagsSlot
{
    const enabled = deps.enabled ?? FEATURES.flags;
    const read = deps.read ?? readFlags;
    const paint = deps.paint ?? paintCanvas;
    let result: SkyResult | null = null;
    let cache = new Map<RegriddedFrame, Entry>();
    let ctrl = new AbortController();
    let gen = 0;
    let busy = false;
    let wanted: RegriddedFrame | null = null;
    let painted: RegriddedFrame | null = null;

    function reset(next: SkyResult | null): void
    {
        ctrl.abort();
        ctrl = new AbortController();
        gen++;
        result = next;
        cache = new Map();
        busy = false;
        wanted = null;
        painted = null;
    }

    function pump(): void
    {
        const frame = wanted;
        if (busy || !frame || cache.has(frame)) {
            return;
        }
        const context = frame.context;
        const flags = context?.flags;
        const bits = flags ? shownBits(flags.names) : [];
        if (!context || !flags || bits.length === 0) {
            cache.set(frame, { status: 'failed' });
            return;
        }
        busy = true;
        cache.set(frame, { status: 'loading' });
        const mine = gen;
        const signal = ctrl.signal;
        read(context.url, flags.layout, context.box, { signal }).then(r => {
            const used = new Uint8Array(r.data.length);
            const mask = regridFlags(r.data, context.box, context.wcs, frame.grid, bits, used);
            const summary = summariseFlags(r.data, flags.names, bits, used);
            return { status: 'ready', rgba: flagsRgba(mask, FLAGS_COLOR, FLAGS_ALPHA), width: frame.grid.width,
                height: frame.grid.height, sentence: summary.sentence } as const;
        }).catch((): Entry => ({ status: 'failed' })).then(entry => {
            if (mine !== gen) {
                return;
            }
            cache.set(frame, entry);
            busy = false;
            pump();
            onChange();
        });
    }

    function update(view: SlotView | null, on: boolean): FlagsState
    {
        const none = { key: false, layer: false, note: '' };
        if (!enabled || !view) {
            if (result) {
                reset(null);
            }
            return none;
        }
        if (view.result !== result) {
            reset(view.result);
        }
        const frame = view.result.frames[view.index]?.frame;
        if (view.mode !== 'blink' || view.source === 'demo' || !frame) {
            return none;
        }
        if (!on) {
            return { key: true, layer: false, note: '' };
        }
        if (view.source === 'snapshot' || !frame.context) {
            return { key: true, layer: false, note: FLAGS_TEXT.snapshot };
        }
        if (!cache.has(frame)) {
            wanted = frame;
            pump();
        }
        const entry = cache.get(frame);
        if (!entry || entry.status === 'loading') {
            return { key: true, layer: false, note: FLAGS_TEXT.loading };
        }
        if (entry.status === 'failed') {
            return { key: true, layer: false, note: FLAGS_TEXT.failed };
        }
        if (painted !== frame) {
            paint(layer, entry.rgba, entry.width, entry.height);
            painted = frame;
        }
        return { key: true, layer: true, note: entry.sentence };
    }

    return { update };
}
