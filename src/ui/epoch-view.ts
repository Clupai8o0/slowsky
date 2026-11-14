// "Older picture": the 2MASS K survey (1997 to 2001) on the page's own grid, flipped against the SPHEREx frame.
// The logic (createEpoch) takes its page hooks as arguments so tests run without a DOM; mountEpoch wires it to the
// page's elements. Rules kept here (reviews of src/lib/epoch.ts, rounds 3 and 4):
// - offered only in Blink, on the 0.1 and 0.25 degree fields, with real frames on screen;
// - nothing is read before the first press; a new result (target, field, colour) aborts and drops the picture;
// - display values are drawn straight to grey, never through the SPHEREx stretch; NaN is hatched, never black;
// - no number from the result (pixelArcsec, order, covered) is printed;
// - the older picture and frame playback are never on together: pressing the key pauses playback, and Play or a
//   frame step switches the older picture off.
import { EPOCH_NOTE, TWO_MASS_K, epochCredit, readEpoch, type EpochDecoded, type EpochResult } from '../lib/epoch';
import { gridSkyToPix } from '../lib/regrid';
import { positionAt, targetById } from '../lib/targets';
import type { SkyResult } from '../lib/source';
import type { TargetId } from '../lib/types';
import { COPY } from './copy';
import type { SlotView } from './slots';

export const EPOCH_FLIP_MS = 900;
export const EPOCH_FOVS: readonly number[] = [0.1, 0.25];
export const EPOCH_MAX_BYTES = 2000000;

export const EPOCH_TEXT = Object.freeze({
    key: 'Older picture',
    loading: 'Reading the older picture…',
    then: 'Then: 2MASS, 1997 to 2001',
    showNow: 'Show now',
    showThen: 'Show then',
    stop: 'Stop the flip',
    tooLarge: 'The older picture is too large to read for this view. The SPHEREx frames are not affected.',
    bracket: 'Where its catalogue motion puts it between June 1997 and February 2001',
});

export function epochNowLabel(when: string): string
{
    return `Now: SPHEREx, ${when}`;
}

export function epochFailText(detail: string): string
{
    return `The older picture could not be read for this view (${detail}). The SPHEREx frames are not affected.`;
}

export type NotePart = string | { text: string; href: string };

type EpochOk = Extract<EpochResult, { ok: true }>;

// The 2MASS K note under the legend, in parts so the page can link its credit when available.
export function epochNoteParts(res: Pick<EpochOk, 'epoch' | 'source'>, lambda: number): NotePart[]
{
    const lead = `${res.epoch.label}. ${EPOCH_NOTE} It comes from a different telescope at a different wavelength `
        + `(2.16 µm; this SPHEREx frame is at ${lambda.toFixed(2)} µm), so a star can look brighter or fainter between `
        + 'the two without having changed. Rings mark where the catalogue puts each star on the SPHEREx frame’s date; '
        + 'a star that sits away from its ring in the older picture may have moved: a candidate to check, not a measurement. ';
    const credit = epochCredit(res.source);
    const name = '2MASS';
    let href = '';
    try {
        const url = new URL(res.source.creditUrl);
        href = url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch {
        href = '';
    }
    if (href && credit.startsWith(`${name}:`)) {
        return [lead, { text: name, href }, credit.slice(name.length)];
    }
    return [lead + credit];
}

export function noteText(parts: NotePart[]): string
{
    return parts.map((p) => (typeof p === 'string' ? p : p.text)).join('');
}

// Hatching for "no data": two greys in diagonal stripes, so a hole never reads as dark sky.
export const HATCH_LIGHT = 120;
export const HATCH_DARK = 56;

// Grey RGBA on the grid the SPHEREx layer uses: index (y * width + x) * 4, row 0 at the top.
export function epochRgba(pixels: Float32Array, width: number, height: number): Uint8ClampedArray
{
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const v = pixels[i] as number;
            const g = Number.isNaN(v) || !Number.isFinite(v) ? ((x + y) % 6 < 3 ? HATCH_LIGHT : HATCH_DARK) : v;
            out[i * 4] = g;
            out[i * 4 + 1] = g;
            out[i * 4 + 2] = g;
            out[i * 4 + 3] = 255;
        }
    }
    return out;
}

export interface EpochBracket {
    from: { x: number; y: number }; // grid pixels (0-based), start of survey span
    to: { x: number; y: number }; // end of survey span
}

// MJD of the first day of a survey month.
function monthMjd(month: string): number
{
    const [y, m] = month.split('-').map(Number);
    return Date.UTC(y as number, (m as number) - 1, 1) / 86400000 + 40587;
}

// The target's catalogue path across the survey months, for a target the page draws a track ring for.
export function epochBracket(result: SkyResult, targetId: string | undefined,
    epoch: Pick<EpochOk['epoch'], 'fromMonth' | 'toMonth'> = TWO_MASS_K): EpochBracket | null
{
    if (!targetId || !Object.hasOwn(COPY, targetId) || !result.track?.length) {
        return null;
    }
    const kind = COPY[targetId as TargetId].kind;
    const astro = targetById(targetId as TargetId)?.astrometry;
    if ((kind !== 'mover' && kind !== 'spectrum') || !astro || (!astro.pmRa && !astro.pmDec)) {
        return null;
    }
    const at = (month: string) => gridSkyToPix(result.grid, positionAt(astro, monthMjd(month)));
    const from = at(epoch.fromMonth);
    const to = at(epoch.toMonth);
    const inside = (p: { x: number; y: number }) => p.x >= -0.5 && p.y >= -0.5
        && p.x <= result.grid.width - 0.5 && p.y <= result.grid.height - 0.5;
    return inside(from) && inside(to) && Math.hypot(to.x - from.x, to.y - from.y) >= 1 ? { from, to } : null;
}

function bracketLegend(epoch: EpochOk['epoch']): string
{
    const month = (value: string) => new Date((monthMjd(value) - 40587) * 86400000)
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return `Where its catalogue motion puts it between ${month(epoch.fromMonth)} and ${month(epoch.toMonth)}`;
}

// ---------- the decoder the page supplies ----------

export interface BitmapLike {
    width: number;
    height: number;
    close(): void;
}

export interface DecodeDeps {
    bitmap?: (blob: Blob) => Promise<BitmapLike>;
    pixels?: (bitmap: BitmapLike, width: number) => ArrayLike<number>;
}

function canvasPixels(bitmap: BitmapLike, width: number): Uint8ClampedArray
{
    const image = bitmap as unknown as CanvasImageSource;
    if (typeof OffscreenCanvas === 'function') {
        const ctx = new OffscreenCanvas(width, width).getContext('2d');
        if (!ctx) {
            throw new Error('No canvas');
        }
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, width, width).data;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = width;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('No canvas');
    }
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, width, width).data;
}

export function makeDecode(tileWidth: number, deps: DecodeDeps = {}): (bytes: Uint8Array) => Promise<EpochDecoded>
{
    const bitmapOf = deps.bitmap ?? ((blob: Blob) => createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
    const pixelsOf = deps.pixels ?? canvasPixels;
    return async (bytes: Uint8Array): Promise<EpochDecoded> => {
        const n = bytes.length;
        if (n > EPOCH_MAX_BYTES) {
            throw new Error('Tile too large');
        }
        if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) {
            throw new Error('Not a complete JPEG');
        }
        const bitmap = await bitmapOf(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
        try {
            if (bitmap.width !== tileWidth || bitmap.height !== tileWidth) {
                throw new Error('Wrong tile size');
            }
            return { width: tileWidth, height: tileWidth, data: pixelsOf(bitmap, tileWidth) };
        } finally {
            bitmap.close();
        }
    };
}

// ---------- the switch, the read and the flip ----------

export interface EpochSlotView extends SlotView {
    when: string; // the frame date the page prints
}

export interface EpochOut {
    key: boolean;
    pressed: boolean;
    note: NotePart[]; // [] hides the line
    legend: string; // the bracket's legend line, '' when there is none
    picture: { rgba: Uint8ClampedArray; width: number; height: number } | null;
    then: boolean; // the older picture covers the sky
    tag: { label: string; action: string | null } | null; // null action means pressing stops automatic flipping
    bracket: EpochBracket | null; // drawn only during Then
}

export interface VisibilityLike {
    hidden(): boolean;
    listen(cb: () => void): () => void;
}

export interface EpochDeps {
    enabled: boolean;
    reducedMotion: boolean;
    draw: (out: EpochOut) => void;
    pause: () => void; // the page's play(false)
    read?: typeof readEpoch;
    decode?: (bytes: Uint8Array) => Promise<EpochDecoded>;
    visibility?: VisibilityLike;
}

export interface EpochSlot {
    update(view: EpochSlotView | null): void;
    press(): void; // the legend key
    tagPress(): void; // the corner tag
    off(): void; // Play pressed
    readonly on: boolean;
}

type Status =
    | { s: 'idle' }
    | { s: 'loading' }
    | { s: 'failed'; message: string }
    | { s: 'ready'; res: EpochOk; rgba: Uint8ClampedArray; bracket: EpochBracket | null };

export const HIDDEN_OUT: Readonly<EpochOut> = Object.freeze({ key: false, pressed: false, note: [], legend: '',
    picture: null, then: false, tag: null, bracket: null });

export function createEpoch(deps: EpochDeps): EpochSlot
{
    const read = deps.read ?? readEpoch;
    let view: EpochSlotView | null = null;
    let current: SkyResult | null = null;
    let tooLarge = false;
    let on = false;
    let status: Status = { s: 'idle' };
    let ctrl: AbortController | null = null;
    let gen = 0;
    let phase: 'then' | 'now' = 'then';
    let hand = false;
    let anchor: number | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let unlisten: (() => void) | null = null;

    function offered(v: EpochSlotView | null): v is EpochSlotView
    {
        return !!v && v.source !== 'demo' && v.mode === 'blink' && v.result.frames.length > 0
            && !!v.result.frames[v.index] && EPOCH_FOVS.some((f) => Math.abs(v.result.grid.fovDeg - f) < 1e-6);
    }

    function stopTimer(): void
    {
        if (interval !== null) {
            clearInterval(interval);
            interval = null;
        }
        unlisten?.();
        unlisten = null;
    }

    function runTimer(): void
    {
        if (interval === null && on && status.s === 'ready' && !hand && !deps.visibility?.hidden()) {
            interval = setInterval(() => {
                phase = phase === 'then' ? 'now' : 'then';
                render();
            }, EPOCH_FLIP_MS);
        }
    }

    function stop(): void
    {
        on = false;
        ctrl?.abort();
        ctrl = null;
        gen++;
        status = { s: 'idle' };
        stopTimer();
        phase = 'then';
        hand = false;
        anchor = null;
    }

    function out(): EpochOut
    {
        if (!offered(view)) {
            return HIDDEN_OUT;
        }
        const base = { ...HIDDEN_OUT, key: true, pressed: on };
        if (status.s === 'failed') {
            return { ...base, note: [status.message] };
        }
        if (!on) {
            return base;
        }
        if (status.s === 'loading' || status.s === 'idle') {
            return { ...base, note: [EPOCH_TEXT.loading] };
        }
        const then = phase === 'then';
        const label = then ? EPOCH_TEXT.then : epochNowLabel(view.when);
        return { ...base, note: epochNoteParts(status.res, view.result.lambda), legend: status.bracket ? bracketLegend(status.res.epoch) : '',
            picture: { rgba: status.rgba, width: status.res.width, height: status.res.height }, then,
            tag: { label, action: hand ? (then ? EPOCH_TEXT.showNow : EPOCH_TEXT.showThen) : null },
            bracket: then ? status.bracket : null };
    }

    function render(): void
    {
        deps.draw(out());
    }

    function start(v: EpochSlotView): void
    {
        on = true;
        gen++;
        const mine = gen;
        ctrl = new AbortController();
        status = { s: 'loading' };
        const result = v.result;
        // Playback pauses at the press, so any frame change from here on is the user stepping: it switches this off.
        anchor = v.index;
        deps.pause();
        let got: Promise<EpochResult>;
        try {
            got = read(result.grid, { signal: ctrl.signal, ...(deps.decode ? { decode: deps.decode } : {}) });
        } catch {
            got = Promise.resolve({ ok: false, reason: 'fetch', detail: 'The read could not start', missing: [] });
        }
        got.catch((): EpochResult => ({ ok: false, reason: 'fetch', detail: 'The read stopped', missing: [] })).then((r) => {
            if (mine !== gen || current !== result) {
                return;
            }
            if (r.ok && r.values === 'display' && r.width === result.grid.width && r.height === result.grid.height) {
                status = { s: 'ready', res: r, rgba: epochRgba(r.pixels, r.width, r.height),
                    bracket: epochBracket(result, view?.targetId, r.epoch) };
                phase = 'then';
                hand = deps.reducedMotion;
                runTimer();
                if (!hand && deps.visibility && !unlisten) {
                    unlisten = deps.visibility.listen(() => {
                        if (deps.visibility?.hidden()) {
                            if (interval !== null) {
                                clearInterval(interval);
                                interval = null;
                            }
                        } else {
                            runTimer();
                        }
                    });
                }
            } else if (!r.ok && r.reason === 'too-large') {
                stop();
                tooLarge = true;
                status = { s: 'failed', message: EPOCH_TEXT.tooLarge };
            } else {
                on = false;
                status = { s: 'failed', message: epochFailText(r.ok ? 'The picture does not match this view' : r.detail) };
            }
            render();
        });
    }

    return {
        update(v: EpochSlotView | null): void
        {
            if (!deps.enabled) {
                return;
            }
            if ((v?.result ?? null) !== current) {
                stop();
                current = v?.result ?? null;
                tooLarge = false;
            } else if (status.s === 'failed' && (v?.index !== view?.index || v?.mode !== view?.mode || v?.source !== view?.source)) {
                stop();
            }
            view = v;
            if (on && (!offered(v) || (anchor !== null && v.index !== anchor))) {
                stop();
            }
            render();
        },
        press(): void
        {
            if (!deps.enabled || !offered(view)) {
                return;
            }
            if (on) {
                stop();
            } else if (tooLarge) {
                status = { s: 'failed', message: EPOCH_TEXT.tooLarge };
            } else {
                start(view);
            }
            render();
        },
        tagPress(): void
        {
            if (!on || status.s !== 'ready') {
                return;
            }
            if (!hand) {
                hand = true;
                stopTimer();
            } else {
                phase = phase === 'then' ? 'now' : 'then';
            }
            render();
        },
        off(): void
        {
            if (on || status.s === 'failed') {
                stop();
                render();
            }
        },
        get on(): boolean
        {
            return on;
        },
    };
}

// ---------- the page's elements ----------

export interface EpochElements {
    key: HTMLButtonElement;
    layer: HTMLElement; // over the picture, under the rings
    tag: HTMLButtonElement; // a corner of the sky
    note: HTMLElement; // the line under the legend
    thenHides?: HTMLElement[]; // layers hidden while the older picture shows
}

function drawInto(els: EpochElements): (o: EpochOut) => void
{
    const doc = els.layer.ownerDocument;
    const svgNs = 'http://www.w3.org/2000/svg';
    let painted: Uint8ClampedArray | null = null;
    let noteKey = '';
    let bracketKey = '';
    const label = doc.createElement('span');
    const act = doc.createElement('span');
    act.className = 'a';
    els.tag.replaceChildren(label, ' ', act);
    return (o: EpochOut) => {
        els.key.hidden = !o.key;
        els.key.setAttribute('aria-pressed', String(o.pressed));
        let canvas = els.layer.querySelector('canvas');
        if (o.picture && painted !== o.picture.rgba) {
            if (!canvas) {
                canvas = doc.createElement('canvas');
                els.layer.prepend(canvas);
            }
            canvas.width = o.picture.width;
            canvas.height = o.picture.height;
            canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(o.picture.rgba), o.picture.width, o.picture.height), 0, 0);
            painted = o.picture.rgba;
        } else if (!o.picture && painted) {
            canvas?.remove();
            painted = null;
        }
        els.layer.hidden = !o.then;
        const bk = o.bracket ? [o.bracket.from.x, o.bracket.from.y, o.bracket.to.x, o.bracket.to.y].join() : '';
        if (bk !== bracketKey) {
            bracketKey = bk;
            els.layer.querySelector('svg')?.remove();
            if (o.bracket && o.picture) {
                const svg = doc.createElementNS(svgNs, 'svg');
                svg.setAttribute('viewBox', `0 0 ${o.picture.width} ${o.picture.height}`);
                svg.setAttribute('preserveAspectRatio', 'none');
                svg.setAttribute('aria-hidden', 'true');
                const path = doc.createElementNS(svgNs, 'path');
                path.setAttribute('d', bracketPath(o.bracket, o.picture.width));
                path.setAttribute('class', 'path');
                path.setAttribute('fill', 'none');
                path.setAttribute('vector-effect', 'non-scaling-stroke');
                svg.append(path);
                els.layer.append(svg);
            }
        }
        for (const el of els.thenHides ?? []) {
            el.style.visibility = o.then ? 'hidden' : '';
        }
        if (o.tag) {
            if (label.textContent !== o.tag.label) {
                label.textContent = o.tag.label;
            }
            const action = o.tag.action ?? EPOCH_TEXT.stop;
            if (act.textContent !== action) {
                act.textContent = action;
            }
        }
        els.tag.hidden = !o.tag;
        const nk = `${noteText(o.note)}\u0000${o.legend}`;
        if (nk !== noteKey) {
            noteKey = nk;
            els.note.replaceChildren();
            for (const part of o.note) {
                if (typeof part === 'string') {
                    els.note.append(part);
                } else {
                    const a = doc.createElement('a');
                    a.href = part.href;
                    a.target = '_blank';
                    a.rel = 'noopener';
                    a.textContent = part.text;
                    els.note.append(a);
                }
            }
            if (o.legend) {
                const leg = doc.createElement('span');
                leg.className = 'sk-ep-leg';
                const sw = doc.createElement('i');
                sw.setAttribute('aria-hidden', 'true');
                leg.append(sw, o.legend);
                els.note.append(leg);
            }
        }
        els.note.hidden = !(o.key && o.note.length);
    };
}

// An open bracket beside the path (not on it, so the star in the older picture stays visible), ends turned in.
export function bracketPath(b: EpochBracket, width: number): string
{
    const ax = b.from.x + 0.5;
    const ay = b.from.y + 0.5;
    const bx = b.to.x + 0.5;
    const by = b.to.y + 0.5;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const d = Math.max(2.4, width / 60 * 1.4);
    const t = d * 0.5;
    const p = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;
    return `M${p(ax + nx * t, ay + ny * t)}L${p(ax + nx * d, ay + ny * d)}L${p(bx + nx * d, by + ny * d)}L${p(bx + nx * t, by + ny * t)}`;
}

export interface EpochMountDeps {
    enabled: boolean;
    pause: () => void;
    read?: typeof readEpoch;
}

export function mountEpoch(els: EpochElements, deps: EpochMountDeps): EpochSlot
{
    if (!deps.enabled) {
        return createEpoch({ enabled: false, reducedMotion: true, draw: () => {}, pause: deps.pause });
    }
    const doc = els.layer.ownerDocument;
    const win = doc.defaultView;
    return createEpoch({
        enabled: true,
        reducedMotion: !!win?.matchMedia('(prefers-reduced-motion: reduce)').matches,
        draw: drawInto(els),
        pause: deps.pause,
        ...(deps.read ? { read: deps.read } : {}),
        decode: makeDecode(TWO_MASS_K.tileWidth),
        visibility: {
            hidden: () => doc.hidden,
            listen: (cb) => {
                doc.addEventListener('visibilitychange', cb);
                return () => doc.removeEventListener('visibilitychange', cb);
            },
        },
    });
}
