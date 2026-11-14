import { describe, expect, it } from 'vitest';
import page from '../src/ui/app.ts?raw';
import { dotBar } from '../src/ui/measure';

// Execute the page's actual source-selection and text expressions with fake sources.
const untyped = (code: string): string => code.replace(/: SkyResult \| null/g, '').replace(/: SourceKind/g, '').replace(/: unknown/g, '').replace('): number =>', ') =>');
const selection = untyped(page.slice(page.indexOf('        let res: SkyResult | null = null;'), page.indexOf('        if (signal.aborted) {\n            return;\n        }\n        reading = null;')));
const why = untyped(page.slice(page.indexOf('            const left = '), page.indexOf("            bind('err', why);")));
const fell = page.split('\n').find((line) => line.includes('        fellBack = got '))!;
const labels = page.slice(page.indexOf("        bind('statusShort', sourceKind === 'live'"), page.indexOf("        bind('status', status);"));
const note = page.split('\n').find((line) => line.includes("bind('lcNote', `At "))!;
const plainErrorSource = page.slice(page.indexOf('    function plainError(e: unknown): string'), page.indexOf('    function play(on: boolean): void'))
    .replace('(e: unknown): string', '(e)');
const plainError = new Function(`${plainErrorSource}\nreturn plainError;`)() as (e: unknown) => string;

const NO_ANSWER = 'The archive did not answer. Check the connection and try again.';
const NO_FRAMES = 'SPHEREx has no frames of this spot at this colour yet.';
const NOT_USABLE = 'SPHEREx has frames near this spot, but none of them could be used for this view at this colour.';
const EITHER = 'The saved copy on this site could not be loaded either.';

type Picked = { res: { frames: unknown[] } | null; got: string; text: string | null; fellBack: string | null; asked: string[] };

// `target: null` is a spot that is not one of the five targets, which has no saved copy.
async function pageSelection(order: string[], responses: Record<string, unknown>, wantFrame?: string, target: string | null = 'rwaur'): Promise<Picked>
{
    const body = `${selection}\n${why}\nlet fellBack;\n${fell}\nreturn { res, got, text: !res || res.frames.length === 0 ? why : null, fellBack, asked };`;
    const run = new (Object.getPrototypeOf(async function () {}).constructor)('order', 'responses', 'wantFrame', 'plainError', 'target', `
        const req = {}, signal = { aborted: false }, st = { target }, savedFirst = order[0] === 'snapshot';
        const demoOnly = false, asked = [];
        let reading = null;
        const renderText = () => {}, isNotImplemented = () => false;
        const loadFrom = async (kind) => {
            asked.push(kind);
            if (!(kind in responses)) throw new Error('the test gave no answer for ' + kind);
            const value = responses[kind];
            if (value instanceof Error) throw value;
            return value;
        };
        ${body}`);
    return run(order, responses, wantFrame, plainError, target);
}

function statusFor(sourceKind: string, fellBack: string | null): { short: string; long: string }
{
    const out: Record<string, string> = {};
    new Function('bind', 'sourceKind', 'fellBack', `${labels}\nbind('status', status);`)((name: string, value: string) => { out[name] = value; }, sourceKind, fellBack);
    return { short: out.statusShort as string, long: out.status as string };
}

const frame = (obsId: string) => ({ frame: { frame: { obsId } } });
const LIVE_FIRST = ['live', 'snapshot'];
const SAVED_FIRST = ['snapshot', 'live'];

describe('release page messages', () => {
    it('cuts the real loader, message, label and error code out of the page', () => {
        expect(selection).toContain('for (const kind of order)');
        expect(selection).toContain("got = 'snapshot';");
        expect(why).toContain('const why = ');
        expect(fell).toContain("failedLive ? 'failed'");
        expect(labels).toContain('const status = ');
        expect(plainErrorSource).toContain('function plainError');
        expect(page).toContain('if (!res || res.frames.length === 0) {');
    });

    it('describes what the chart bar holds and what it leaves out', () => {
        const render = new Function('bind', 'c', 'noise', 'left', 'blendAt', note);
        let text = '';
        render((_name: string, value: string) => { text = value; }, { lc: { lambda: 4.6 }, refs: 2 }, 0.03, '', '');
        expect(text).toBe('At 4.60 µm, measured against 2 nearby comparison stars from Gaia. The band shows how much they wobble (±3.0%); the bar on each dot combines that wobble, scaled to the dot’s value, with the noise of the sky around the star. Noise from the star’s own light, and anything that affects this star alone, is not in the bar, so the real uncertainty may be larger. A change inside its bar may be noise.');
        expect(text).not.toContain('own noise');
        expect(text).not.toContain('adds the noise');
    });

    it('draws the bar the note describes', () => {
        // The page's bar is this function and nothing else.
        expect(page).toContain('return dotBar(o.p.relative, noise, own);');
        expect(dotBar(1, 0.02, 0)).toBeCloseTo(0.02, 12);
        expect(dotBar(1, 0.02, 0.02)).toBeCloseTo(Math.hypot(0.02, 0.02), 12);
        expect(dotBar(1, 0, 0.015)).toBeCloseTo(0.015, 12);
        // The wobble is scaled to the dot's value, so a dimmed dot's bar can be shorter than the band.
        expect(dotBar(0.4, 0.02, 0.002)).toBeCloseTo(Math.hypot(0.008, 0.002), 12);
        expect(dotBar(0.4, 0.02, 0.002)).toBeLessThan(0.02);
        expect(dotBar(-0.4, 0.02, 0.002)).toBeCloseTo(dotBar(0.4, 0.02, 0.002), 12);
        // A target with no sky reading keeps the wobble part.
        expect(dotBar(1, 0.02, NaN)).toBeCloseTo(0.02, 12);
        expect(dotBar(1, 0.02, Infinity)).toBeCloseTo(0.02, 12);
    });

    it('explains a failed live read when the saved copy is empty', async () => {
        const out = await pageSelection(LIVE_FIRST, { live: new Error('network'), snapshot: { frames: [] } });
        expect(out.text).toBe(`Couldn’t read the live SPHEREx archive, and the saved copy has no frames at this colour. ${NO_ANSWER}`);
        const savedFirst = await pageSelection(SAVED_FIRST, { live: new Error('network'), snapshot: { frames: [] } });
        expect(savedFirst.text).toBe(out.text);
    });

    it('does not say the archive could not be reached when it answered and the read failed', async () => {
        const out = await pageSelection(LIVE_FIRST, { live: new Error('bad FITS header'), snapshot: { frames: [] } });
        expect(out.text).toBe('Couldn’t read the live SPHEREx archive, and the saved copy has no frames at this colour. Something went wrong reading the frames. Try again, or pick another spot.');
        expect(out.text).not.toContain('reach');
    });

    it('reports no frames only when neither source has any', async () => {
        for (const order of [LIVE_FIRST, SAVED_FIRST]) {
            const out = await pageSelection(order, { live: { frames: [] }, snapshot: { frames: [] } });
            expect(out.text).toBe(NO_FRAMES);
            expect(out.got).toBe('live');
            expect(out.asked.sort()).toEqual(['live', 'snapshot']);
            const zero = await pageSelection(order, { live: { frames: [], unusable: 0, missed: 0 }, snapshot: { frames: [], unusable: 0 } });
            expect(zero.text).toBe(NO_FRAMES);
        }
        // The archive's own answer stands when the saved copy cannot be read.
        const broken = await pageSelection(LIVE_FIRST, { live: { frames: [] }, snapshot: new Error('Snapshot file /snapshot/rwaur/index.json answered 404') });
        expect(broken.text).toBe(NO_FRAMES);
        expect(broken.got).toBe('live');
    });

    it('tries the saved copy when a live-first read answers with no frames (second review)', async () => {
        const saved = { frames: [{}] };
        for (const live of [{ frames: [] }, { frames: [], missed: 2 }, { frames: [], unusable: 1 }]) {
            const out = await pageSelection(LIVE_FIRST, { live, snapshot: saved });
            expect(out.asked).toEqual(['live', 'snapshot']);
            expect(out.got).toBe('snapshot');
            expect(out.res).toBe(saved);
            expect(out.text).toBeNull();
            expect(out.fellBack).toBe('empty');
        }
    });

    it('does not look for a saved copy of a spot that is not one of the five targets', async () => {
        const empty = await pageSelection(LIVE_FIRST, { live: { frames: [] }, snapshot: { frames: [{}] } }, undefined, null);
        expect(empty.asked).toEqual(['live']);
        expect(empty.text).toBe(NO_FRAMES);
        const failed = await pageSelection(LIVE_FIRST, { live: new Error('network'), snapshot: new Error('Snapshot file x answered 404') }, undefined, null);
        expect(failed.asked).toEqual(['live']);
        expect(failed.text).toBe(`Couldn’t load the frames. ${NO_ANSWER}`);
    });

    it('keeps the saved copy after a live failure, and live frames when live answers', async () => {
        const out = await pageSelection(LIVE_FIRST, { live: new Error('network'), snapshot: { frames: [{}] } });
        expect(out.got).toBe('snapshot');
        expect(out.res?.frames).toHaveLength(1);
        expect(out.text).toBeNull();
        expect(out.fellBack).toBe('failed');
        const live = { frames: [{}] };
        const fresh = await pageSelection(LIVE_FIRST, { live, snapshot: { frames: [{}, {}] } });
        expect(fresh.asked).toEqual(['live']);
        expect(fresh.res).toBe(live);
        expect(fresh.fellBack).toBeNull();
        // Opening from the saved copy makes no live read, so nothing fell back.
        const opened = await pageSelection(SAVED_FIRST, { live, snapshot: { frames: [{}] } });
        expect(opened.asked).toEqual(['snapshot']);
        expect(opened.got).toBe('snapshot');
        expect(opened.fellBack).toBeNull();
    });

    it('labels the saved copy by what the live read did, and never says the archive did not answer', () => {
        expect(statusFor('snapshot', 'failed')).toEqual({
            short: 'Saved copy · live read failed',
            long: 'The live read of NASA’s archive failed, so this is the saved copy: real SPHEREx frames stored with this page. Go live tries the archive again.',
        });
        expect(statusFor('snapshot', 'empty')).toEqual({
            short: 'Saved copy · live read gave no frames',
            long: 'The live read of NASA’s archive gave no frames for this view, so this is the saved copy: real SPHEREx frames stored with this page. Go live tries the archive again.',
        });
        expect(statusFor('snapshot', null).short).toBe('Saved copy');
        expect(statusFor('snapshot', null).long).toContain('Saved copy: real NASA SPHEREx frames stored with this page');
        expect(statusFor('live', null).short).toBe('Live from NASA’s SPHEREx archive');
        expect(statusFor('live', 'failed').short).toBe('Live from NASA’s SPHEREx archive');
        expect(labels).not.toContain('did not answer');
    });

    it('says frames exist when live answers but none could be used for this view', async () => {
        for (const live of [{ frames: [], unusable: 3 }, { frames: [], missed: 2 }, { frames: [], unusable: 1, missed: 1 }]) {
            expect((await pageSelection(LIVE_FIRST, { live, snapshot: { frames: [] } })).text).toBe(NOT_USABLE);
            expect((await pageSelection(SAVED_FIRST, { live, snapshot: { frames: [] } })).text).toBe(NOT_USABLE);
        }
    });

    it('counts the saved copy’s unusable frames as proof that frames exist (second review)', async () => {
        for (const snapshot of [{ frames: [], unusable: 2 }, { frames: [], missed: 1 }]) {
            for (const order of [LIVE_FIRST, SAVED_FIRST]) {
                const out = await pageSelection(order, { live: { frames: [] }, snapshot });
                expect(out.text).toBe(NOT_USABLE);
            }
        }
    });

    it('never hides a failed live read behind what the saved copy lacks', async () => {
        const text = `Couldn’t read the live SPHEREx archive, and the saved copy has no frames that could be used for this view at this colour. ${NO_ANSWER}`;
        for (const snapshot of [{ frames: [], unusable: 2 }, { frames: [], missed: 2 }]) {
            for (const order of [LIVE_FIRST, SAVED_FIRST]) {
                const out = await pageSelection(order, { live: new Error('network'), snapshot });
                expect(out.text).toBe(text);
                expect(out.text).not.toContain('SPHEREx has frames');
            }
        }
    });

    it('reports the live error when both sources fail, and says the saved copy failed too (second review)', async () => {
        for (const order of [LIVE_FIRST, SAVED_FIRST]) {
            const missing = await pageSelection(order, { live: new Error('network'), snapshot: new Error('Snapshot file /snapshot/rwaur/index.json answered 404') });
            expect(missing.text).toBe(`Couldn’t load the frames. ${NO_ANSWER} ${EITHER}`);
            const slow = await pageSelection(order, { live: new Error('Request failed: 503'), snapshot: new Error('The saved copy timed out reading /snapshot/rwaur/index.json.') });
            expect(slow.text).toBe(`Couldn’t load the frames. NASA’s archive is busy or down right now. Try again in a minute. ${EITHER}`);
            const parse = await pageSelection(order, { live: new Error('bad FITS header'), snapshot: new Error('Snapshot file a.f32 has 3 bytes, expected 8') });
            expect(parse.text).toBe(`Couldn’t load the frames. Something went wrong reading the frames. Try again, or pick another spot. ${EITHER}`);
        }
    });

    it('shows the saved copy when it lacks the linked frame and live answers with no frames', async () => {
        const saved = { frames: [frame('a')] };
        const out = await pageSelection(SAVED_FIRST, { live: { frames: [] }, snapshot: saved }, 'b');
        expect(out.got).toBe('snapshot');
        expect(out.res).toBe(saved);
        expect(out.text).toBeNull();
        expect(out.fellBack).toBe('empty');
        const down = await pageSelection(SAVED_FIRST, { live: new Error('network'), snapshot: saved }, 'b');
        expect(down.res).toBe(saved);
        expect(down.fellBack).toBe('failed');
        // Live with frames still wins over the saved copy, and so does live's answer when the saved copy is empty too.
        const live = { frames: [frame('b')] };
        const fresh = await pageSelection(SAVED_FIRST, { live, snapshot: saved }, 'b');
        expect(fresh.got).toBe('live');
        expect(fresh.res).toBe(live);
        expect(fresh.fellBack).toBeNull();
        const empty = await pageSelection(SAVED_FIRST, { live: { frames: [], missed: 1 }, snapshot: { frames: [] } }, 'b');
        expect(empty.got).toBe('live');
        expect(empty.text).toBe(NOT_USABLE);
        // A saved copy that holds the linked frame opens with no live read.
        const held = await pageSelection(SAVED_FIRST, { live, snapshot: saved }, 'a');
        expect(held.asked).toEqual(['snapshot']);
        expect(held.res).toBe(saved);
    });

    it('does not blame NASA for a failure of the saved copy on this site', () => {
        expect(plainError(new Error('The saved copy timed out reading /snapshot/rwaur/a.f32.'))).toBe('The saved copy on this site took too long to load. Check the connection and try again.');
        for (const message of ['Snapshot file /snapshot/rwaur/index.json answered 503', 'Snapshot file /snapshot/rwaur/index.json answered 404', 'Snapshot file a.f32 has no IMAGE plane', 'The saved copy only has the five official targets.']) {
            expect(plainError(new Error(message))).toBe('The saved copy on this site could not be loaded. Try again in a minute.');
        }
        expect(plainError(new Error('Request failed: 503'))).toBe('NASA’s archive is busy or down right now. Try again in a minute.');
        expect(plainError(new Error('Failed to fetch'))).toBe(NO_ANSWER);
        expect(plainError(null)).toBe(NO_ANSWER);
        expect(plainError(new Error('bad FITS header'))).toBe('Something went wrong reading the frames. Try again, or pick another spot.');
    });
});
