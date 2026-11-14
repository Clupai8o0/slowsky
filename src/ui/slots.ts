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
// - epoch: an "Older picture" toggle in the sky legend that flips the sky between 2MASS (1997 to 2001) and the
//   SPHEREx frame (src/ui/epoch-view.ts, from src/lib/epoch.ts).
import { readFlags } from '../lib/flags';
import { flagsRgba, regridFlags, summariseFlags } from '../lib/flags-view';
import { createLiveSource, type SkyResult, type SkySource } from '../lib/source';
import { ColourGridError, falseColourView, pictureOnlyParts, TOO_LITTLE_COLOUR } from '../lib/falsecolour-view';
import { apertureFor } from './measure';
import type { RegriddedFrame, TargetId } from '../lib/types';
import { COPY } from './copy';
import { haloFor, haloHtml, type HaloDeps, type HaloView } from './halo-view';
import { ChangeInputError, findChanges } from '../lib/change-input';
import { PLAIN_LEAD, hasSnrFigure, plainListNotes } from '../lib/changes';
import { changesHtml, changesMarks, changesView, type ChangesView } from './changes-view';
import { createRangeReader } from '../lib/fits';
import { groupByVisit } from '../lib/stack';
import type { RangeReader } from '../lib/types';
import { readFrameFlags, screen, type FrameFlags } from './flag-screen';
import { readVariance } from './error-maps';

export type Feature = 'spectrum' | 'flags' | 'changes' | 'falseColour' | 'fcReading' | 'halo' | 'mlHint' | 'epoch';
export const DEFAULT_FEATURES: Readonly<Record<Feature, boolean>> =
    Object.freeze({ spectrum: false, flags: true, changes: false, falseColour: false, fcReading: false, halo: false, mlHint: false, epoch: false });

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
export const FLAGS_READ_TIMEOUT_MS = 20000;

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
    timeoutMs?: number; // defaults to FLAGS_READ_TIMEOUT_MS
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
        const resetSignal = ctrl.signal;
        const deadline = new AbortController();
        const abort = () => deadline.abort();
        let signal = deadline.signal;
        if (typeof AbortSignal.any === 'function') {
            signal = AbortSignal.any([resetSignal, deadline.signal]);
        } else if (resetSignal.aborted) {
            abort();
        } else {
            resetSignal.addEventListener('abort', abort, { once: true });
        }
        const timer = setTimeout(abort, deps.timeoutMs ?? FLAGS_READ_TIMEOUT_MS);
        read(context.url, flags.layout, context.box, { signal }).finally(() => {
            clearTimeout(timer);
            resetSignal.removeEventListener('abort', abort);
        }).then(r => {
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

// The page asks only for the finder's plain list (one spot each, reading moreLater/lessLater, no star claim):
// its cause sentences are not safe to show yet (-ba, 14 Nov). Every page call goes through changesFor.
export const PAGE_CHANGE_OPTIONS = { plain: true } as const;

// The finder's answer for a result, first visit against last, worked out once. Its own error message (too few
// visits, say) becomes the panel's note; any other failure hides the panel.
export function changesFor(result: SkyResult, find: typeof findChanges = findChanges): ChangesView | null
{
    try {
        return changesView(find(result, {}, PAGE_CHANGE_OPTIONS));
    } catch (e) {
        if (e instanceof ChangeInputError) {
            return changesView({ error: e.message });
        }
        console.warn('[slowsky] change finder failed', e);
        return null;
    }
}

export interface ChangesDeps {
    reader?: RangeReader;
    read?: typeof readFlags;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    find?: typeof findChanges;
    variance?: (frame: RegriddedFrame, signal: AbortSignal) => Promise<Float32Array | null>;
}

export const MAPS_NOTE = 'Reading the archive’s error maps for the two compared visits; the list shows once that is done.';

export function mountChanges(onChange: () => void, deps: ChangesDeps = {}): { render: (box: HTMLElement, marks: HTMLElement, view: SlotView) => boolean }
{
    const reader = deps.reader ?? createRangeReader({ fetch: deps.fetcher });
    const shown = new WeakMap<HTMLElement, string>();
    let current: SkyResult | null = null;
    let resultView: ChangesView | null = null;
    let controller = new AbortController();
    // Finished panels by result, so coming back to a result does not read the archive again.
    const done = new WeakMap<SkyResult, ChangesView | null>();
    // Results whose full list is open ("Show N more"), and the boxes that already listen for that button.
    const open = new WeakSet<SkyResult>();
    const wired = new WeakSet<HTMLElement>();
    let last: [HTMLElement, HTMLElement, SlotView] | null = null;

    // One frame at a time, each with its own deadline; null when a new result takes over. A read that fails or
    // runs out of time counts as null for that frame.
    async function eachFrame<T>(frames: RegriddedFrame[], reset: AbortSignal, read: (frame: RegriddedFrame, signal: AbortSignal) => Promise<T | null>): Promise<Map<string, T | null> | null>
    {
        const out = new Map<string, T | null>();
        for (const frame of frames) {
            if (reset.aborted) {
                return null;
            }
            const deadline = new AbortController();
            const abort = () => deadline.abort();
            reset.addEventListener('abort', abort, { once: true });
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<null>(resolve => {
                timer = setTimeout(() => { abort(); resolve(null); }, deps.timeoutMs ?? FLAGS_READ_TIMEOUT_MS);
                deadline.signal.addEventListener('abort', () => resolve(null), { once: true });
            });
            const value = await Promise.race([read(frame, deadline.signal).catch(() => null), timeout]);
            clearTimeout(timer);
            reset.removeEventListener('abort', abort);
            out.set(frame.frame.obsId, value);
        }
        return reset.aborted ? null : out;
    }

    // The two visits the finder compared: its own list when it gives one, else the same split it makes by default.
    function compared(result: SkyResult, found: ChangesView): { earlier: RegriddedFrame[]; later: RegriddedFrame[] }
    {
        const byId = (ids: string[]) => result.frames.map(f => f.frame).filter(f => ids.includes(f.frame.obsId));
        const visits = found.visits ? [byId(found.visits.earlier.obsIds), byId(found.visits.later.obsIds)]
            : groupByVisit(result.frames.map(f => f.frame), 10);
        return { earlier: visits[0] ?? [], later: visits.length > 1 ? visits[visits.length - 1]! : [] };
    }

    function start(result: SkyResult, source: SlotView['source']): void
    {
        controller.abort();
        controller = new AbortController();
        const reset = controller.signal;
        current = result;
        if (done.has(result)) {
            resultView = done.get(result) ?? null;
            return;
        }
        const saved = source === 'snapshot';
        const first = changesFor(result, deps.find);
        resultView = first;
        if (!first?.ran) {
            done.set(result, first);
            return;
        }
        const firstVisits = compared(result, first);
        const firstFrames = [...firstVisits.earlier, ...firstVisits.later];
        // Live frames: the finder runs again with the archive's error maps for the two compared visits, which give
        // each pixel its own noise (the difference image alone leaves out a source's own light). Until then only
        // a note shows, so a list that will shrink never appears.
        const maps = !saved && firstFrames.some(f => f.context);
        if (maps) {
            resultView = { candidates: [], notes: [MAPS_NOTE], ran: false };
        }
        void (async () => {
            let found = first;
            if (maps) {
                const read = deps.variance ?? ((f: RegriddedFrame, signal: AbortSignal) => readVariance(f, { reader, signal }));
                const got = await eachFrame(firstFrames, reset, read);
                if (!got) {
                    return;
                }
                const frames = result.frames.map(p => {
                    const variance = got.get(p.frame.frame.obsId);
                    return variance ? { ...p, frame: { ...p.frame, variance } } : p;
                });
                const missing = firstFrames.filter(f => !got.get(f.frame.obsId)).length;
                const again = missing === firstFrames.length ? first : changesFor({ ...result, frames }, deps.find) ?? first;
                found = missing ? { ...again, notes: [...again.notes, `Error maps could not be read for ${missing} ${missing === 1 ? 'frame' : 'frames'}.`] } : again;
            }
            if (!found.candidates.length) {
                resultView = found;
                done.set(result, found);
                if (maps) {
                    onChange();
                }
                return;
            }
            const { earlier, later } = compared(result, found);
            const frames = [...earlier, ...later];
            const order = frames.flatMap(f => f.context?.flags?.names.map(n => n.name) ?? []);
            const finish = (flags: Map<string, FrameFlags | null>) => {
                const screened = screen(found.candidates, { earlier, later }, flags, order, saved);
                const info = found.plainListInfo;
                if (info) {
                    screened.kept.sort((a, b) => Number(Boolean(a.nearCatalogue)) - Number(Boolean(b.nearCatalogue))
                        || Number(hasSnrFigure(b.line)) - Number(hasSnrFigure(a.line)) || b.snr - a.snr);
                }
                const listNotes = info ? plainListNotes(screened.kept, info.usedErrorMap, info.matchArcsec) : [];
                const notes = info ? found.notes.flatMap(note => note.startsWith('Listed with spots that have no catalogue star within ')
                    ? listNotes.filter(n => n.startsWith('Listed with spots that have no catalogue star within '))
                    : note.startsWith('S/N is left out for ') ? listNotes.filter(n => n.startsWith('S/N is left out for '))
                    : !screened.kept.length && note.startsWith('No catalogue stars for this view:') ? [] : [note]) : found.notes;
                resultView = { ...found, candidates: screened.kept, lead: [...(screened.kept.length ? (found.lead ?? []).filter((s) => s === PLAIN_LEAD) : []), ...screened.lead],
                    ran: screened.dropNote && !screened.kept.length ? false : found.ran,
                    notes: [...notes, ...(screened.dropNote ? [screened.dropNote] : [])] };
                done.set(result, resultView);
            };
            if (saved || !frames.some(f => f.context?.flags)) {
                finish(new Map());
                if (maps) {
                    onChange();
                }
                return;
            }
            resultView = { ...found, notes: [...found.notes, 'Checking the archive flags for these spots; the list and its numbers may update.'] };
            if (maps) {
                onChange();
            }
            const flags = await eachFrame(frames, reset, (frame, signal) => readFrameFlags(frame, { reader,
                readFlags: deps.read ?? readFlags, fetcher: deps.fetcher, signal }));
            if (flags) {
                finish(flags);
                onChange();
            }
        })();
        // A saved view or a view with nothing to read finishes in this same call.
    }

    function render(box: HTMLElement, marks: HTMLElement, view: SlotView): boolean
    {
        if (view.source === 'demo') {
            controller.abort();
            current = null;
            return false;
        }
        if (current !== view.result) {
            start(view.result, view.source);
        }
        const v = resultView;
        if (!v) {
            return false;
        }
        last = [box, marks, view];
        if (!wired.has(box) && typeof box.addEventListener === 'function') {
            wired.add(box);
            box.addEventListener('click', (event) => {
                const target = event.target as Element | null;
                if (!target?.closest?.('[data-chg-more]') || !current || !last) {
                    return;
                }
                if (open.has(current)) {
                    open.delete(current);
                } else {
                    open.add(current);
                }
                render(...last);
                // The button is drawn again, so keep the keyboard focus on it.
                (last[0].querySelector('[data-chg-more]') as HTMLElement | null)?.focus();
            });
        }
        const all = open.has(view.result);
        const html = changesHtml(v, all);
        if (shown.get(box) !== html) {
            box.innerHTML = html;
            shown.set(box, html);
        }
        const svg = changesMarks(v, view.result.grid.width, view.result.grid.height, all);
        if (shown.get(marks) !== svg) {
            marks.innerHTML = svg;
            shown.set(marks, svg);
        }
        return true;
    }
    return { render };
}

// False colour. `layer` is an empty layer over the sky (same box as the picture, under the Gaia rings) for a
// canvas from falseColourRgba. `update` runs on every render with whether the key is switched on, and returns
// what to show; key false hides the toggle. `onChange` asks for a render (e.g. when a read ends).
export interface FalseColourSlot {
    update(view: SlotView | null, on: boolean): LayerState;
}

export interface FalseColourDeps {
    enabled?: boolean;
    readingEnabled?: boolean;
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
                        entry = { status: 'failed', note: error instanceof ColourGridError ? FALSE_COLOUR_TEXT.grid
                            : error instanceof Error && error.message === TOO_LITTLE_COLOUR ? TOO_LITTLE_COLOUR : FALSE_COLOUR_TEXT.picture };
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
                const parts = (deps.readingEnabled ?? FEATURES.fcReading) ? entry.picture.parts : pictureOnlyParts(entry.picture.parts);
                const join = (xs: string[]) => xs.filter(Boolean).join(' ');
                return { key: true, layer: true, note: join(Object.values(parts)),
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
            // The table's date button, not the curve's dot (an SVG path cannot take focus).
            box.querySelector<HTMLElement>(`button[data-k="${k}"]`)?.focus();
        }
    }
    return true;
}
