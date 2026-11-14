import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EPOCH_FLIP_MS, EPOCH_MAX_BYTES, EPOCH_TEXT, HATCH_DARK, HATCH_LIGHT, createEpoch, epochBracket, epochFailText, epochNoteParts,
    epochRgba, makeDecode, mountEpoch, noteText, type BitmapLike, type EpochElements, type EpochOut, type EpochSlotView,
} from '../src/ui/epoch-view';
import { DEFAULT_FEATURES, FEATURES } from '../src/ui/slots';
import { EPOCH_NOTE, TWO_MASS_K, epochCredit, type EpochResult } from '../src/lib/epoch';
import { renderRgba } from '../src/lib/player';
import { positionAt, targetById } from '../src/lib/targets';
import { gridSkyToPix } from '../src/lib/regrid';
import type { SkyResult } from '../src/lib/source';
import type { OutputGrid } from '../src/lib/types';
import page from '../src/ui/app.ts?raw';

const W = 40;
const H = 40;

function grid(fovDeg = 0.25): OutputGrid
{
    return { center: { ra: 150, dec: 2 }, fovDeg, pixelArcsec: fovDeg * 3600 / W, width: W, height: H };
}

function sky(fovDeg = 0.25, extra: Partial<SkyResult> = {}): SkyResult
{
    const g = grid(fovDeg);
    const frame = { frame: { frame: { tMin: 61000 }, grid: g, data: new Float32Array(W * H) }, label: '' };
    return { source: 'live', grid: g, frames: [frame, frame], locked: [], lambda: 1.5, stars: [], credits: [], notes: [], ...extra } as unknown as SkyResult;
}

function view(result: SkyResult | null, over: Partial<EpochSlotView> = {}): EpochSlotView | null
{
    return result ? { result, index: 0, mode: 'blink', source: 'live', when: '3 Mar 2026', ...over } : null;
}

function okResult(g: OutputGrid, pixels?: Float32Array): EpochResult
{
    const px = pixels ?? Float32Array.from({ length: g.width * g.height }, (_, i) => i % 256);
    return { ok: true, width: g.width, height: g.height, pixels: px, band: 'K', order: 9, wantedOrder: 9, pixelArcsec: 1.15,
        coarser: false, covered: 1, holes: false, values: 'display',
        source: { name: TWO_MASS_K.name, baseUrl: TWO_MASS_K.baseUrl, propertiesUrl: TWO_MASS_K.propertiesUrl, credit: TWO_MASS_K.credit,
            creditUrl: TWO_MASS_K.creditUrl, hipsCredit: TWO_MASS_K.hipsCredit, hipsCreator: TWO_MASS_K.hipsCreator, format: 'jpeg' },
        epoch: { label: TWO_MASS_K.epochLabel, fromMonth: TWO_MASS_K.fromMonth, toMonth: TWO_MASS_K.toMonth, nightKnown: false }, missing: [] };
}

interface Rig {
    slot: ReturnType<typeof createEpoch>;
    last: () => EpochOut;
    read: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    signals: AbortSignal[];
    resolve: (r: EpochResult) => void;
    vis: { hidden: boolean; fire: () => void };
}

function rig(opts: { reduced?: boolean; enabled?: boolean; wider?: boolean } = {}): Rig
{
    const outs: EpochOut[] = [];
    const signals: AbortSignal[] = [];
    let resolve: (r: EpochResult) => void = () => {};
    const read = vi.fn((_g: OutputGrid, o?: { signal?: AbortSignal }) => {
        if (o?.signal) {
            signals.push(o.signal);
        }
        return new Promise<EpochResult>((res) => {
            resolve = res;
        });
    });
    const pause = vi.fn();
    let listener: (() => void) | null = null;
    const vis = { hidden: false, fire: () => listener?.() };
    const slot = createEpoch({
        enabled: opts.enabled ?? true,
        reducedMotion: opts.reduced ?? false,
        draw: (o) => outs.push(o),
        pause,
        hasWiderField: (fov) => (opts.wider ?? true) && [0.1, 0.25, 0.5, 1].some((f) => f > fov),
        read: read as unknown as typeof import('../src/lib/epoch').readEpoch,
        decode: async () => ({ width: 1, height: 1, data: [0] }),
        visibility: {
            hidden: () => vis.hidden,
            listen: (cb) => {
                listener = cb;
                return () => {
                    listener = null;
                };
            },
        },
    });
    return { slot, last: () => outs[outs.length - 1]!, read, pause, signals, resolve: (r) => resolve(r), vis };
}

async function settle(): Promise<void>
{
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

async function ready(r: Rig, result: SkyResult, over: Partial<EpochSlotView> = {}): Promise<void>
{
    r.slot.update(view(result, over));
    r.slot.press();
    r.resolve(okResult(result.grid));
    await settle();
}

const NOTE = `${TWO_MASS_K.epochLabel}. ${EPOCH_NOTE} It comes from a different telescope at a different wavelength (2.16 µm; this SPHEREx frame is at 1.50 µm), so a star can look brighter or fainter between the two without having changed. Rings mark where the catalogue puts each star on the SPHEREx frame’s date; a star that sits away from its ring in the older picture may have moved: a candidate to check, not a measurement. ${epochCredit(TWO_MASS_K)}`;

describe('older picture: switched off', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('is off by default and makes no request while off', () => {
        expect(DEFAULT_FEATURES.epoch).toBe(false);
        expect(FEATURES.epoch).toBe(false);
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const r = rig({ enabled: false });
        r.slot.update(view(sky()));
        r.slot.press();
        r.slot.tagPress();
        expect(r.read).not.toHaveBeenCalled();
        expect(r.slot.on).toBe(false);
        const read = vi.fn();
        const mounted = mountEpoch({} as EpochElements, { enabled: false, pause: () => {}, read });
        mounted.update(view(sky()));
        mounted.press();
        expect(read).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('older picture: when the key is offered', () => {
    it('shows the key only in Blink, on 0.1 or 0.25 degrees, with a real result', () => {
        const r = rig();
        r.slot.update(view(sky(0.25)));
        expect(r.last().key).toBe(true);
        r.slot.update(view(sky(0.1)));
        expect(r.last().key).toBe(true);
        r.slot.update(view(sky(0.1), { source: 'snapshot' }));
        expect(r.last().key).toBe(true);
        r.slot.update(view(sky(0.25), { mode: 'stack' }));
        expect(r.last().key).toBe(false);
        r.slot.update(view(sky(0.25), { mode: 'diff' }));
        expect(r.last().key).toBe(false);
        r.slot.update(view(sky(0.5)));
        expect(r.last().key).toBe(false);
        r.slot.update(view(sky(1)));
        expect(r.last().key).toBe(false);
        r.slot.update(view(sky(0.25), { source: 'demo' }));
        expect(r.last().key).toBe(false);
        r.slot.update(null);
        expect(r.last().key).toBe(false);
        expect(r.read).not.toHaveBeenCalled();
    });

    it('switches off and clears when the mode leaves Blink', async () => {
        const r = rig();
        const s = sky();
        await ready(r, s);
        expect(r.last().picture).not.toBeNull();
        r.slot.update(view(s, { mode: 'stack' }));
        expect(r.slot.on).toBe(false);
        expect(r.last().key).toBe(false);
        r.slot.update(view(s));
        expect(r.last()).toMatchObject({ key: true, pressed: false, picture: null, then: false, tag: null });
    });

    it('keeps the key visible and remembers too-large without another read', async () => {
        const r = rig();
        const s = sky();
        r.slot.update(view(s));
        r.slot.press();
        r.resolve({ ok: false, reason: 'too-large', detail: 'This view is too large for the older picture', missing: [] });
        await settle();
        const message = 'The older picture is too large to read for this view. The SPHEREx frames are not affected.';
        expect(r.last()).toMatchObject({ key: true, pressed: false, note: [message], picture: null });
        expect(r.slot.on).toBe(false);
        r.slot.press();
        expect(r.read).toHaveBeenCalledTimes(1);
        expect(r.last().note).toEqual([]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(r.last()).toMatchObject({ key: true, pressed: false, note: [message] });
        r.slot.update(view(s, { index: 1 }));
        expect(r.last().note).toEqual([]);
        r.slot.press();
        expect(r.last().note).toEqual([message]);
        expect(r.read).toHaveBeenCalledTimes(1);
        r.slot.update(view(sky()));
        r.slot.press();
        expect(r.read).toHaveBeenCalledTimes(2);
    });

    it('pauses again on a remembered too-large view', async () => {
        const r = rig();
        r.slot.update(view(sky()));
        r.slot.press();
        r.resolve({ ok: false, reason: 'too-large', detail: '', missing: [] });
        await settle();
        expect(r.slot.canRead).toBe(false);
        r.slot.press();
        expect(r.pause).toHaveBeenCalledTimes(2);
        expect(r.read).toHaveBeenCalledTimes(1);
    });

    it('does not restore a repeated too-large note after leaving the view', async () => {
        vi.useFakeTimers();
        const r = rig();
        const s = sky();
        r.slot.update(view(s));
        r.slot.press();
        r.resolve({ ok: false, reason: 'too-large', detail: '', missing: [] });
        await settle();
        r.slot.press();
        expect(r.last().note).toEqual([]);
        r.slot.update(view(s, { mode: 'stack' }));
        vi.runAllTimers();
        r.slot.update(view(s));
        expect(r.last().note).toEqual([]);
        vi.useRealTimers();
    });

    it('clears a failure on off, and on mode or source changes', async () => {
        for (const change of ['off', 'mode', 'source', 'target'] as const) {
            const r = rig();
            const s = sky();
            r.slot.update(view(s));
            r.slot.press();
            r.resolve({ ok: false, reason: 'fetch', detail: 'missing', missing: [] });
            await settle();
            expect(r.signals[0]!.aborted).toBe(true);
            expect(r.last().note.length).toBe(1);
            if (change === 'off') {
                r.slot.off();
            } else if (change === 'target') {
                r.slot.update(null);
                r.slot.update(view(sky(), { targetId: 'barnard' }));
            } else {
                r.slot.update(view(s, change === 'mode' ? { mode: 'stack' } : { source: 'snapshot' }));
                r.slot.update(view(s));
            }
            expect(r.last().note).toEqual([]);
        }
    });
});

describe('older picture: pressing it', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reads once on the first press and aborts on the second', () => {
        const r = rig();
        const s = sky();
        r.slot.update(view(s));
        expect(r.read).not.toHaveBeenCalled();
        r.slot.press();
        expect(r.read).toHaveBeenCalledTimes(1);
        expect(r.read.mock.calls[0]![0]).toBe(s.grid);
        expect(r.last().note).toEqual([EPOCH_TEXT.loading]);
        expect(r.last().pressed).toBe(true);
        r.slot.update(view(s));
        expect(r.read).toHaveBeenCalledTimes(1);
        r.slot.press();
        expect(r.signals[0]!.aborted).toBe(true);
        expect(r.last()).toMatchObject({ pressed: false, note: [], picture: null });
    });

    it('a new target aborts the read and drops the picture', async () => {
        const r = rig();
        r.slot.update(view(sky()));
        r.slot.press();
        const next = sky();
        r.slot.update(view(next));
        expect(r.signals[0]!.aborted).toBe(true);
        expect(r.slot.on).toBe(false);
        r.resolve(okResult(next.grid));
        await settle();
        expect(r.last()).toMatchObject({ pressed: false, picture: null, then: false });
    });

    it('pauses playback and flips every 900 ms with the exact tag words', async () => {
        const r = rig();
        await ready(r, sky());
        expect(r.pause).toHaveBeenCalledTimes(1);
        expect(r.last()).toMatchObject({ then: true, tag: { label: 'Then: 2MASS, 1997 to 2001', action: null } });
        vi.advanceTimersByTime(EPOCH_FLIP_MS);
        expect(r.last()).toMatchObject({ then: false, tag: { label: 'Now: SPHEREx, 3 Mar 2026', action: null } });
        vi.advanceTimersByTime(EPOCH_FLIP_MS);
        expect(r.last().then).toBe(true);
    });

    it('with reduced motion never starts a timer and flips by hand', async () => {
        const r = rig({ reduced: true });
        await ready(r, sky());
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(EPOCH_FLIP_MS * 5);
        expect(r.last()).toMatchObject({ then: true, tag: { label: EPOCH_TEXT.then, action: 'Show now' } });
        r.slot.tagPress();
        expect(r.last()).toMatchObject({ then: false, tag: { label: 'Now: SPHEREx, 3 Mar 2026', action: 'Show then' } });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('the tag stops the flip and then flips by hand', async () => {
        const r = rig();
        await ready(r, sky());
        r.slot.tagPress();
        expect(vi.getTimerCount()).toBe(0);
        expect(r.last().tag?.action).toBe('Show now');
    });

    it('stops the timer when the key goes off and while the page is hidden', async () => {
        const r = rig();
        await ready(r, sky());
        expect(vi.getTimerCount()).toBe(1);
        r.vis.hidden = true;
        r.vis.fire();
        expect(vi.getTimerCount()).toBe(0);
        r.vis.hidden = false;
        r.vis.fire();
        expect(vi.getTimerCount()).toBe(1);
        r.slot.press();
        expect(vi.getTimerCount()).toBe(0);
        r.vis.fire();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('Play and stepping frames switch the older picture off', async () => {
        const r = rig();
        const s = sky();
        await ready(r, s);
        r.slot.off();
        expect(r.slot.on).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        expect(r.last()).toMatchObject({ pressed: false, picture: null });
        await ready(r, s);
        expect(r.slot.on).toBe(true);
        r.slot.update(view(s, { index: 1 }));
        expect(r.slot.on).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('pauses at the press, and a frame step while it loads switches it off and aborts', async () => {
        const r = rig();
        const s = sky();
        r.slot.update(view(s));
        r.slot.press();
        expect(r.pause).toHaveBeenCalledTimes(1);
        r.slot.update(view(s, { index: 1 }));
        expect(r.slot.on).toBe(false);
        expect(r.signals[0]!.aborted).toBe(true);
        r.resolve(okResult(s.grid));
        await settle();
        expect(r.last()).toMatchObject({ pressed: false, picture: null });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a refused read prints the reason and shows no picture', async () => {
        const r = rig();
        r.slot.update(view(sky()));
        r.slot.press();
        r.resolve({ ok: false, reason: 'fetch', detail: 'Some tiles are missing', missing: [] });
        await settle();
        expect(noteText(r.last().note)).toBe('The older picture could not be read for this view (Some tiles are missing). The SPHEREx frames are not affected.');
        expect(r.last()).toMatchObject({ picture: null, then: false, tag: null });
        expect(r.last().pressed).toBe(false);
        expect(r.slot.on).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        expect(r.pause).toHaveBeenCalledTimes(1);
        r.slot.press();
        expect(r.read).toHaveBeenCalledTimes(2);
        expect(r.last()).toMatchObject({ pressed: true, note: [EPOCH_TEXT.loading] });
        r.resolve({ ok: false, reason: 'fetch', detail: 'Some tiles are missing', missing: [] });
        await settle();
        expect(noteText(r.last().note)).toBe('The older picture could not be read for this view (Some tiles are missing). The SPHEREx frames are not affected.');
    });
});

describe('older picture: the words', () => {
    it('ships the exact strings', async () => {
        expect(EPOCH_TEXT.key).toBe('Older picture');
        expect(EPOCH_TEXT.loading).toBe('Reading the older picture…');
        expect(epochFailText('HTTP 502')).toBe('The older picture could not be read for this view (HTTP 502). The SPHEREx frames are not affected.');
        const parts = epochNoteParts(okResult(grid()) as Extract<EpochResult, { ok: true }>, 1.5);
        expect(noteText(parts)).toBe(NOTE);
        expect(parts).toContainEqual({ text: '2MASS', href: 'https://www.ipac.caltech.edu/2mass/' });
        expect(noteText(parts)).toContain('2MASS: University of Massachusetts & IPAC/Caltech. HiPS tiles: CNRS/Unistra, served by IRSA.');
        expect(noteText(parts)).not.toMatch(/discover|detected a|confirmed|proves|arcsec|″|%/i);
    });

    it('the ready note carries the credit and the frame wavelength', async () => {
        vi.useFakeTimers();
        const r = rig();
        await ready(r, sky());
        expect(noteText(r.last().note)).toBe(NOTE);
        vi.useRealTimers();
    });
});

describe('older picture: drawing', () => {
    it('draws NaN as hatching, never black', () => {
        const px = new Float32Array(12 * 12).fill(NaN);
        const rgba = epochRgba(px, 12, 12);
        const greys = new Set<number>();
        for (let i = 0; i < 144; i++) {
            expect(rgba[i * 4 + 3]).toBe(255);
            expect(rgba[i * 4]).toBeGreaterThan(0);
            greys.add(rgba[i * 4]!);
        }
        expect([...greys].sort()).toEqual([HATCH_LIGHT, HATCH_DARK].sort());
    });

    it('draws display values straight to grey, no re-stretch', () => {
        const px = Float32Array.from([0, 37, 128, 255]);
        const rgba = epochRgba(px, 4, 1);
        expect([rgba[0], rgba[4], rgba[8], rgba[12]]).toEqual([0, 37, 128, 255]);
        expect([rgba[5], rgba[6]]).toEqual([37, 37]);
    });

    it('a bright pixel lands on the canvas pixel the SPHEREx layer uses', () => {
        const w = 9;
        const h = 6;
        const x = 7;
        const y = 3;
        const old = new Float32Array(w * h).fill(10);
        old[y * w + x] = 250;
        const spx = new Float32Array(w * h).fill(1);
        spx[y * w + x] = 1000;
        const a = epochRgba(old, w, h);
        const b = renderRgba(spx, { lo: 0, hi: 1000, kind: 'linear' });
        const brightest = (d: Uint8ClampedArray) => {
            let k = 0;
            for (let i = 0; i < d.length / 4; i++) {
                if (d[i * 4]! > d[k * 4]!) {
                    k = i;
                }
            }
            return k;
        };
        expect(a.length).toBe(b.length);
        expect(brightest(a)).toBe(y * w + x);
        expect(brightest(a)).toBe(brightest(b));
    });

    it('brackets the catalogue path only when it lies inside the view', () => {
        const barnard = targetById('barnard')!;
        const centre = positionAt(barnard.astrometry, 61041);
        const g = (fovDeg: number): OutputGrid => ({ center: centre, fovDeg, pixelArcsec: 6.15, width: Math.round(fovDeg * 3600 / 6.15), height: Math.round(fovDeg * 3600 / 6.15) });
        const track = [{ mjd: 61041, ra: centre.ra, dec: centre.dec, pix: { x: 0, y: 0 } }];
        const wide = sky(0.25, { grid: g(0.25), track });
        const b = epochBracket(wide, 'barnard');
        expect(b).not.toBeNull();
        expect(Math.hypot(b!.to.x - b!.from.x, b!.to.y - b!.from.y)).toBeGreaterThan(3);
        expect(epochBracket(sky(0.1, { grid: g(0.1), track }), 'barnard')).toBeNull();
        expect(epochBracket(sky(0.25, { grid: g(0.25) }), 'barnard')).toBeNull();
        expect(epochBracket(wide, 'rwaur')).toBeNull();
        expect(epochBracket(wide, undefined)).toBeNull();
    });

    it('omits subpixel brackets and uses the returned survey months', async () => {
        const barnard = targetById('barnard')!;
        const centre = positionAt(barnard.astrometry, 61041);
        const g: OutputGrid = { center: centre, fovDeg: 0.25, pixelArcsec: 22.5, width: 40, height: 40 };
        const track = [{ mjd: 61041, ra: centre.ra, dec: centre.dec, pix: { x: 0, y: 0 } }];
        const s = sky(0.25, { grid: g, track });
        const r = rig({ reduced: true });
        r.slot.update(view(s, { targetId: 'barnard' }));
        r.slot.press();
        const result = okResult(g) as Extract<EpochResult, { ok: true }>;
        result.epoch = { ...result.epoch, fromMonth: '2000-01', toMonth: '2000-02' };
        r.resolve(result);
        await settle();
        expect(r.last()).toMatchObject({ bracket: null, legend: '' });
        expect(epochBracket(s, 'barnard')).not.toBeNull();
        const coarse = { ...g, width: 20, height: 20, pixelArcsec: 45 };
        expect(epochBracket(sky(0.25, { grid: coarse, track }), 'barnard')).toBeNull();
        r.slot.off();
        r.slot.press();
        result.epoch = { ...result.epoch, fromMonth: '1996-01', toMonth: '2001-02' };
        r.resolve(result);
        await settle();
        expect(r.last().bracket).not.toBeNull();
        expect(r.last().legend).toBe('Where the catalogue motion of Barnard’s Star puts it between January 1996 and February 2001');
    });

    it('explains an outside Barnard path and retains an inside bracket through the flip', async () => {
        vi.useFakeTimers();
        const centre = positionAt(targetById('barnard')!.astrometry, 61041);
        const track = [{ mjd: 61041, ra: centre.ra, dec: centre.dec, pix: { x: 0, y: 0 } }];
        const make = (fovDeg: number, pixelArcsec: number, height: number) => sky(fovDeg, {
            grid: { center: centre, fovDeg, pixelArcsec, width: 587, height }, track,
        });
        const narrow = make(0.1, 360 / 587, 587);
        const wide = make(0.25, 900 / 587, 587);
        const partial = make(0.25, 1, 550);
        const astro = targetById('barnard')!.astrometry;
        const endpoints = [50600, 51941].map((mjd) => gridSkyToPix(partial.grid, positionAt(astro, mjd)));
        expect(endpoints.map((p) => p.y >= -0.5 && p.y <= partial.grid.height - 0.5)).toEqual([false, true]);
        for (const [s, sentence] of [
            [narrow, 'The catalogue motion of Barnard’s Star puts it outside this view between June 1997 and February 2001. Try a wider field.'],
            [partial, 'The catalogue motion of Barnard’s Star puts it outside this view for part of June 1997 to February 2001. Try a wider field.'],
        ] as const) {
            const r = rig({ reduced: true });
            await ready(r, s, { targetId: 'barnard' });
            expect(r.last().bracket).toBeNull();
            expect(r.last().legend).toBe(sentence);
            r.slot.off();
            expect(r.last().legend).toBe('');
        }
        const r = rig();
        await ready(r, wide, { targetId: 'barnard' });
        expect(r.last().bracket).not.toBeNull();
        expect(r.last().legend).toBe('Where the catalogue motion of Barnard’s Star puts it between June 1997 and February 2001');
        vi.advanceTimersByTime(EPOCH_FLIP_MS);
        expect(r.last().then).toBe(false);
        expect(r.last().bracket).not.toBeNull();
        r.slot.off();
        const noWider = rig({ reduced: true, wider: false });
        await ready(noWider, narrow, { targetId: 'barnard' });
        expect(noWider.last().legend).toBe('The catalogue motion of Barnard’s Star puts it outside this view between June 1997 and February 2001.');
        noWider.slot.off();
        const otherMonths = rig({ reduced: true });
        otherMonths.slot.update(view(narrow, { targetId: 'barnard' }));
        otherMonths.slot.press();
        const otherResult = okResult(narrow.grid) as Extract<EpochResult, { ok: true }>;
        otherResult.epoch = { ...otherResult.epoch, fromMonth: '1996-01', toMonth: '2001-02' };
        otherMonths.resolve(otherResult);
        await settle();
        expect(otherMonths.last().legend).toBe('The catalogue motion of Barnard’s Star puts it outside this view between January 1996 and February 2001. Try a wider field.');
        otherMonths.slot.off();
        const short = rig({ reduced: true });
        short.slot.update(view(partial, { targetId: 'barnard' }));
        short.slot.press();
        const result = okResult(partial.grid) as Extract<EpochResult, { ok: true }>;
        result.epoch = { ...result.epoch, fromMonth: '2000-01', toMonth: '2000-02' };
        short.resolve(result);
        await settle();
        expect(short.last()).toMatchObject({ bracket: null, legend: '' });
        short.slot.off();
        vi.useRealTimers();
    });
});

describe('older picture: page wiring', () => {
    it('keeps tag spans in place with a spaced, visible action while flipping', async () => {
        vi.useFakeTimers();
        class Element {
            tagName = '';
            replacements = 0;
            children: (Element | string)[] = [];
            textContent = '';
            className = '';
            hidden = false;
            style = { visibility: '' };
            attrs: Record<string, string> = {};
            ownerDocument = doc;
            append(...items: (Element | string)[]) { this.children.push(...items); }
            prepend(item: Element) { this.children.unshift(item); }
            replaceChildren(...items: (Element | string)[]) { this.replacements++; this.children = items; }
            setAttribute(name: string, value: string) { this.attrs[name] = value; }
            removeAttribute(name: string) { delete this.attrs[name]; }
            querySelector(name: string) { return this.children.find((c) => c instanceof Element && c.tagName === name) ?? null; }
            remove() {}
            getContext() { return { putImageData: () => {} }; }
        }
        const doc = { defaultView: { matchMedia: () => ({ matches: false }) }, hidden: false,
            createElement: (name: string) => Object.assign(new Element(), { tagName: name }),
            createElementNS: (_ns: string, name: string) => Object.assign(new Element(), { tagName: name }),
            addEventListener: () => {}, removeEventListener: () => {} };
        vi.stubGlobal('ImageData', class { constructor(..._args: unknown[]) {} });
        const key = new Element(), layer = new Element(), tag = new Element(), note = new Element(), marks = new Element();
        const centre = positionAt(targetById('barnard')!.astrometry, 61041);
        const s = sky(0.25, { grid: { ...grid(), center: centre }, track: [{ mjd: 61041, ra: centre.ra, dec: centre.dec, pix: { x: 0, y: 0 } }] });
        const slot = mountEpoch({ key, layer, tag, note, thenHides: [marks] } as unknown as EpochElements,
            { enabled: true, pause: () => {}, read: vi.fn(async () => okResult(s.grid)) as unknown as typeof import('../src/lib/epoch').readEpoch });
        slot.update(view(s, { targetId: 'barnard' }));
        expect(note.hidden).toBe(false);
        expect(note.children).toEqual([]);
        slot.press();
        await settle();
        const [label, space, action] = tag.children;
        expect((label as Element).textContent).toBe(EPOCH_TEXT.then);
        expect(space).toBe(' ');
        expect((action as Element).textContent).toBe('Stop the flip');
        const bracketLegend = note.children.find((child) => child instanceof Element && child.className === 'sk-ep-leg') as Element;
        expect(bracketLegend.children.some((child) => child instanceof Element && child.tagName === 'i')).toBe(true);
        expect(tag.attrs['aria-label']).toBeUndefined();
        expect(marks.style.visibility).toBe('hidden');
        const noteUpdates = note.replacements;
        vi.advanceTimersByTime(EPOCH_FLIP_MS);
        expect(layer.hidden).toBe(false);
        expect((layer.children[0] as Element).hidden).toBe(true);
        expect(note.replacements).toBe(noteUpdates);
        expect(tag.children[0]).toBe(label);
        expect(tag.children[2]).toBe(action);
        expect(marks.style.visibility).toBe('');
        slot.tagPress();
        expect((action as Element).textContent).toBe('Show then');
        slot.off();
        for (const [fovDeg, pixelArcsec, height] of [[0.1, 360 / 587, 587], [0.25, 1, 550]] as const) {
            const outside = sky(fovDeg, { grid: { center: centre, fovDeg, pixelArcsec, width: 587, height },
                track: [{ mjd: 61041, ra: centre.ra, dec: centre.dec, pix: { x: 0, y: 0 } }] });
            const outsideSlot = mountEpoch({ key, layer, tag, note, thenHides: [marks] } as unknown as EpochElements,
                { enabled: true, pause: () => {}, read: vi.fn(async () => okResult(outside.grid)) as unknown as typeof import('../src/lib/epoch').readEpoch });
            outsideSlot.update(view(outside, { targetId: 'barnard' }));
            outsideSlot.press();
            await settle();
            const legend = note.children.find((child) => child instanceof Element && child.className === 'sk-ep-leg') as Element;
            expect(legend).toBeDefined();
            expect(legend.children.some((child) => child instanceof Element && child.tagName === 'i')).toBe(false);
            outsideSlot.off();
        }
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('wires wider-field advice to fields offered beyond both the view and picker', () => {
        const match = page.match(/hasWiderField:\s*(.*?)\s*\}\);/s);
        expect(match).not.toBeNull();
        const callback = new Function('mountEpoch', 'st', 'FOVS', `return (${match![1]});`);
        const check = (viewFov: number, pickerFov: number) =>
            callback(mountEpoch, { fovDeg: pickerFov }, [0.1, 0.25, 0.5, 1])(viewFov);
        expect(check(0.1, 0.1)).toBe(true);
        expect(check(0.25, 0.25)).toBe(false);
        expect(check(0.1, 0.25)).toBe(false);
        expect(check(0.25, 0.1)).toBe(false);
    });

    it('declares a status note and hides SPHEREx change marks during Then', () => {
        expect(page).toMatch(/data-ref="epochNote"[^>]*role="status"|role="status"[^>]*data-ref="epochNote"/);
        expect(page).toMatch(/thenHides:\s*\[[^\]]*ref<HTMLElement>\('changesMarks'\)/);
    });

    it('switches competing keys off only when a read can start', () => {
        const start = page.indexOf("        } else if (b.dataset.act === 'flags') {");
        const end = page.indexOf("        } else if (b.dataset.act === 'gaia') {", start);
        const handlers = page.slice(start, end).replace(/^        } else if/, 'if') + '\n}';
        expect(start).toBeGreaterThan(0);
        const run = new Function('b', 'epochSlot', 'observe', 'FEATURES', 'state', `
            let fcOn = state.fcOn, flagsOn = state.flagsOn;
            function renderSlots() { observe({ fcOn, flagsOn }); }
            ${handlers}
            return { fcOn, flagsOn };
        `);
        let epochOn = false;
        let state = { fcOn: true, flagsOn: true };
        const epochSlot = { canRead: true, get on() { return epochOn; }, off: () => { epochOn = false; },
            press: () => { expect(state.fcOn || state.flagsOn).toBe(false); epochOn = !epochOn; }, tagPress: () => {} };
        const renderSlots = (next: typeof state) => { state = next; };
        state = run({ dataset: { act: 'epoch' } }, epochSlot, renderSlots, { epoch: true }, state);
        expect(state).toEqual({ fcOn: false, flagsOn: false });
        expect(epochOn).toBe(true);
        epochOn = false;
        const blocked = { ...epochSlot, canRead: false, press: vi.fn() };
        state = run({ dataset: { act: 'epoch' } }, blocked, renderSlots, { epoch: true }, { fcOn: true, flagsOn: true });
        expect(state).toEqual({ fcOn: true, flagsOn: true });
        expect(blocked.press).toHaveBeenCalledOnce();
        epochOn = true;
        state = { fcOn: false, flagsOn: false };
        state = run({ dataset: { act: 'falsecolour' } }, epochSlot, () => {}, { epoch: true }, state);
        expect(epochOn).toBe(false);
        expect(state.fcOn).toBe(true);
        epochOn = true;
        state = run({ dataset: { act: 'flags' } }, epochSlot, () => {}, { epoch: true }, { fcOn: false, flagsOn: false });
        expect(epochOn).toBe(false);
        expect(state.flagsOn).toBe(true);
        epochOn = false;
        state = run({ dataset: { act: 'epoch' } }, { on: false, press: () => {} }, () => {}, { epoch: false }, { fcOn: true, flagsOn: true });
        expect(state).toEqual({ fcOn: true, flagsOn: true });
        expect(page.slice(page.indexOf('    function play('), page.indexOf('    function play(') + 400)).toContain('epochSlot.off()');
    });
});

describe('older picture: the decoder', () => {
    const jpeg = (n: number) => {
        const b = new Uint8Array(n);
        b[0] = 0xff;
        b[1] = 0xd8;
        b[n - 2] = 0xff;
        b[n - 1] = 0xd9;
        return b;
    };
    function fake(width: number, height: number): { bitmap: () => Promise<BitmapLike>; closed: () => number; made: () => number }
    {
        let closed = 0;
        let made = 0;
        return {
            bitmap: async () => {
                made++;
                return { width, height, close: () => { closed++; } };
            },
            closed: () => closed,
            made: () => made,
        };
    }

    it('refuses too many bytes, a bad start, a bad end and a wrong size', async () => {
        const f = fake(8, 8);
        const decode = makeDecode(8, { bitmap: f.bitmap, pixels: () => new Uint8ClampedArray(8 * 8 * 4) });
        await expect(decode(jpeg(EPOCH_MAX_BYTES + 1))).rejects.toThrow(Error);
        const badStart = jpeg(64);
        badStart[1] = 0xd9;
        await expect(decode(badStart)).rejects.toThrow(Error);
        const badEnd = jpeg(64);
        badEnd[63] = 0x00;
        await expect(decode(badEnd)).rejects.toThrow(Error);
        expect(f.made()).toBe(0);
        const wrong = fake(8, 7);
        await expect(makeDecode(8, { bitmap: wrong.bitmap, pixels: () => new Uint8ClampedArray(0) })(jpeg(64))).rejects.toThrow(Error);
        expect(wrong.closed()).toBe(1);
        const out = await decode(jpeg(EPOCH_MAX_BYTES));
        expect(out).toMatchObject({ width: 8, height: 8 });
        expect(out.data.length).toBe(256);
        expect(f.closed()).toBe(1);
    });
});
