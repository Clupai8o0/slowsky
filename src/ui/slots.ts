// Empty, feature-flagged slots for modules built in their own lanes, so those lanes edit this file and never
// the shared UI. A slot shows only when its flag is on AND it has something to show. Flags is on; the rest are off.
// - spectrum: a panel under the colour step, for src/lib/spectrum-chart.ts. Ships only once the owner logs it
//   in DECISIONS.md.
// - flags: a "Flagged pixels" toggle in the sky legend, a layer over the sky and a line under the legend, from
//   src/lib/flags.ts (read) and src/lib/flags-view.ts (mask on the picture's grid, counts, sentence).
// - changes: a "Candidate changes" panel in the right rail and a marks layer over the sky, for the change finder
//   (lane/changes): where, what kind and how far above the noise, each a candidate, never a percentage.
// - falseColour: a "False colour" toggle in the sky legend, a layer over the sky and a line under the legend, for
//   lane/falsecolour (falseColourRgba for the layer, colourAt for the line).
// - halo: a panel under "Brightness over time", for the R Draconis halo curve (lane/halo3).
import { readFlags } from '../lib/flags';
import { flagsRgba, regridFlags, summariseFlags } from '../lib/flags-view';
import { createLiveSource, type SkyResult, type SkySource } from '../lib/source';
import { ColourGridError, falseColourView } from '../lib/falsecolour-view';
import { apertureFor } from './measure';
import type { RegriddedFrame, TargetId } from '../lib/types';
import { COPY } from './copy';
import { haloFor, haloHtml, type HaloDeps, type HaloView } from './halo-view';
import { ChangeInputError, findChanges } from '../lib/change-input';
import { changesHtml, changesMarks, changesView, type ChangesView } from './changes-view';

export type Feature = 'spectrum' | 'flags' | 'changes' | 'falseColour' | 'halo' | 'mlHint';
export const DEFAULT_FEATURES: Readonly<Record<Feature, boolean>> =
    Object.freeze({ spectrum: false, flags: true, changes: false, falseColour: false, halo: false, mlHint: false });

// Preview builds only: VITE_PREVIEW_FEATURES="halo,falseColour" switches those slots on, "-flags" switches one off.
// Unset or empty keeps the defaults above; unknown names are ignored. Set it on a Vercel preview, never production.
export function featuresFrom(list: string | undefined, defaults: Readonly<Record<Feature, boolean>> = DEFAULT_FEATURES): Readonly<Record<Feature, boolean>>
{
    const out = { ...defaults };
    for (const raw of (list ?? '').split(',')) {
        const item = raw.trim();
        const off = item.startsWith('-');
        const name = (off ? item.slice(1) : item).trim();
        if (Object.prototype.hasOwnProperty.call(out, name)) {
            out[name as Feature] = !off;
        }
    }
    return Object.freeze(out);
}

export const FEATURES = featuresFrom(import.meta.env.VITE_PREVIEW_FEATURES as string | undefined);

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

// Flag names (from the file's own MSKN cards) the layer leaves out, per the Explanatory Supplement, Table 16:
// FULLSAMPLE is "purely informational", GHOST_FPA is "currently unused", and SOURCE marks pixels "mapped to a
// known source", so it sits on the stars themselves and drawing it would hide the picture.
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

// What a legend toggle with a layer over the sky shows: the key, the layer, and a line under the legend.
export interface LayerState {
    key: boolean; // show the key in the sky legend
    layer: boolean; // show the layer over the sky
    note: string; // the line under the legend ('' hides it)
    // Optional split of `note` for small screens: `lead` always shows, `more` goes behind "How to read this colour".
    split?: { lead: string; more: string };
}

export type FlagsState = LayerState;

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

// Change finder. `box` is the panel body in the right rail; `marks` is an empty layer over the sky (same box as
// the picture, pointer-events off) for rings or labels at each candidate. Called on every render: cache by
// `view.result` and return quickly. Fill both with textContent or trusted SVG only. Return true when there is
// something to show; false hides the panel and the layer.
const changesCache = new WeakMap<SkyResult, ChangesView | null>();
const changesShown = new WeakMap<HTMLElement, string>();

// The finder's answer for a result, first visit against last, worked out once. Its own error message (too few
// visits, say) becomes the panel's note; any other failure hides the panel.
export function changesFor(result: SkyResult, find: typeof findChanges = findChanges): ChangesView | null
{
    try {
        return changesView(find(result));
    } catch (e) {
        if (e instanceof ChangeInputError) {
            return changesView({ error: e.message });
        }
        console.warn('[slowsky] change finder failed', e);
        return null;
    }
}

export function renderChanges(box: HTMLElement, marks: HTMLElement, view: SlotView): boolean
{
    if (view.source === 'demo') {
        return false;
    }
    let v = changesCache.get(view.result);
    if (v === undefined) {
        v = changesFor(view.result);
        changesCache.set(view.result, v);
    }
    if (!v) {
        return false;
    }
    const html = changesHtml(v);
    if (changesShown.get(box) !== html) {
        box.innerHTML = html;
        changesShown.set(box, html);
    }
    const svg = changesMarks(v, view.result.grid.width, view.result.grid.height);
    if (changesShown.get(marks) !== svg) {
        marks.innerHTML = svg;
        changesShown.set(marks, svg);
    }
    return true;
}

// False colour. `layer` is an empty layer over the sky (same box as the picture, under the Gaia rings) for a
// canvas from falseColourRgba. `update` runs on every render with whether the key is switched on, and returns
// what to show; key false hides the toggle. `onChange` asks for a render (e.g. when a read ends).
export interface FalseColourSlot {
    update(view: SlotView | null, on: boolean): LayerState;
}

export interface FalseColourDeps {
    enabled?: boolean;
    source?: SkySource;
    paint?: (layer: HTMLElement, rgba: Uint8ClampedArray, width: number, height: number) => void;
}

// These partner wavelengths and threshold are a design choice for this view.
const COLOUR_THRESHOLD = 2.42;
const COLOUR_SHORT = 1.25;
const COLOUR_LONG = 4.60;
// The detectors that carry those two wavelengths (nominal ranges: 2 covers 1.10 to 1.62 µm, 6 covers 4.42 to 5.00).
const COLOUR_SHORT_DETECTOR = 2;
const COLOUR_LONG_DETECTOR = 6;

export const FALSE_COLOUR_TEXT = Object.freeze({
    snapshot: 'False colour needs a live read. Go live to load a second wavelength; the saved copy holds one wavelength per target.',
    stack: 'False colour is drawn in Stack.',
    loading: 'Reading the second colour…',
    failed: 'The second colour could not be read.',
    grid: 'The two colours are on different grids.',
    picture: 'False colour could not be drawn for this view.',
    empty: 'No frames were found in this view.',
});

export function mountFalseColour(layer: HTMLElement, onChange: () => void, deps: FalseColourDeps = {}): FalseColourSlot
{
    const enabled = deps.enabled ?? FEATURES.falseColour;
    const paint = deps.paint ?? paintCanvas;
    let result: SkyResult | null = null;
    let controller: AbortController | null = null;
    let generation = 0;
    let entry: { status: 'loading' | 'failed'; note: string } | { status: 'ready'; picture: ReturnType<typeof falseColourView> } | null = null;
    let painted = false;

    function reset(next: SkyResult | null): void
    {
        controller?.abort();
        controller = null;
        generation++;
        result = next;
        entry = null;
        painted = false;
    }

    function start(view: SlotView): void
    {
        const current = view.result;
        const partner = current.lambda >= COLOUR_THRESHOLD ? COLOUR_SHORT : COLOUR_LONG;
        controller = new AbortController();
        const mine = generation;
        entry = { status: 'loading', note: FALSE_COLOUR_TEXT.loading };
        try {
            const source = deps.source ?? createLiveSource();
            source.load({ center: current.grid.center, fovDeg: current.grid.fovDeg,
                detector: partner === COLOUR_SHORT ? COLOUR_SHORT_DETECTOR : COLOUR_LONG_DETECTOR, lambda: partner,
                ...(view.targetId ? { target: view.targetId as TargetId } : {}), signal: controller.signal }).then(other => {
                if (mine !== generation) {
                    return;
                }
                if (!other.frames.length) {
                    entry = { status: 'failed', note: `No frames were found at ${partner.toFixed(2)} µm.` };
                } else {
                    try {
                        entry = { status: 'ready', picture: falseColourView(current, other, apertureFor(current.grid)) };
                    } catch (error) {
                        entry = { status: 'failed', note: error instanceof ColourGridError ? FALSE_COLOUR_TEXT.grid : FALSE_COLOUR_TEXT.picture };
                    }
                }
                onChange();
            }, () => {
                if (mine === generation) {
                    entry = { status: 'failed', note: FALSE_COLOUR_TEXT.failed };
                    onChange();
                }
            });
        } catch {
            entry = { status: 'failed', note: FALSE_COLOUR_TEXT.failed };
        }
    }

    return {
        update(view: SlotView | null, on: boolean): LayerState
        {
            if (!enabled || !view || view.source === 'demo') {
                if (result) {
                    reset(null);
                }
                return { key: false, layer: false, note: '' };
            }
            if (result !== view.result) {
                reset(view.result);
            }
            if (!on || view.source !== 'live' || view.mode !== 'stack') {
                // A finished picture is kept for this view, so switching back does not read the archive again.
                // A read still running is dropped, and a failed one is forgotten so switching on again retries.
                if (entry && entry.status !== 'ready') {
                    reset(view.result);
                }
                const note = !on ? '' : view.source === 'snapshot' ? FALSE_COLOUR_TEXT.snapshot
                    : view.mode !== 'stack' ? FALSE_COLOUR_TEXT.stack : '';
                return { key: true, layer: false, note };
            }
            if (!view.result.frames.length) {
                return { key: true, layer: false, note: FALSE_COLOUR_TEXT.empty };
            }
            if (!entry) {
                start(view);
            }
            if (!entry || entry.status !== 'ready') {
                return { key: true, layer: false, note: entry?.note ?? FALSE_COLOUR_TEXT.failed };
            }
            try {
                if (!painted) {
                    const picture = entry.picture;
                    paint(layer, picture.rgba, picture.width, picture.height);
                    painted = true;
                }
                const parts = entry.picture.parts;
                const join = (xs: string[]) => xs.filter(Boolean).join(' ');
                return { key: true, layer: true, note: entry.picture.sentence,
                    split: { lead: join([parts.reading, parts.warning]), more: join([parts.labels, parts.note, parts.method]) } };
            } catch {
                entry = { status: 'failed', note: FALSE_COLOUR_TEXT.picture };
                return { key: true, layer: false, note: FALSE_COLOUR_TEXT.picture };
            }
        },
    };
}

// R Draconis halo curve. `box` is the panel body under "Brightness over time". Same rules as renderSpectrum.
// Measured once per result (src/ui/halo-view.ts); the simulated sky never gets a curve.
const haloCache = new WeakMap<SkyResult, HaloView | null>();
const haloShown = new WeakMap<HTMLElement, string>();

export function renderHalo(box: HTMLElement, view: SlotView, deps: HaloDeps = {}): boolean
{
    const card = view.targetId && view.targetId in COPY ? COPY[view.targetId as TargetId] : undefined;
    if (view.source === 'demo' || card?.kind !== 'saturated') {
        return false;
    }
    let h = haloCache.get(view.result);
    if (h === undefined) {
        h = haloFor(view.result, deps);
        haloCache.set(view.result, h);
    }
    if (!h) {
        return false;
    }
    const html = haloHtml(h, card.display, view.mode === 'blink' ? view.index : -1);
    if (haloShown.get(box) !== html) {
        // Rewriting the panel drops the focused date button; put focus back on the same date.
        const active = box.ownerDocument?.activeElement as HTMLElement | null | undefined;
        const k = active && box.contains(active) ? active.dataset?.k : undefined;
        box.innerHTML = html;
        haloShown.set(box, html);
        if (k !== undefined && /^\d+$/.test(k)) {
            box.querySelector<HTMLElement>(`[data-k="${k}"]`)?.focus();
        }
    }
    return true;
}
