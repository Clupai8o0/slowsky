import { describe, expect, it } from 'vitest';
import page from '../src/ui/app.ts?raw';
import { dotBar } from '../src/ui/measure';

// Execute the page's actual source-selection and text expressions with fake sources.
const selection = page.slice(page.indexOf('        let res: SkyResult | null = null;'), page.indexOf('        if (signal.aborted) {\n            return;\n        }\n        reading = null;'))
    .replace(': SkyResult | null', '').replace(': SourceKind', '').replace(': unknown', '').replace(': SkyResult | null', '');
const why = page.slice(page.indexOf('            const none = '), page.indexOf("            bind('err', why);"));
const note = page.split('\n').find((line) => line.includes("bind('lcNote', `At "))!;
const plainErrorSource = page.slice(page.indexOf('    function plainError(e: unknown): string'), page.indexOf('    function play(on: boolean): void'))
    .replace('(e: unknown): string', '(e)');
const plainError = new Function(`${plainErrorSource}\nreturn plainError;`)() as (e: unknown) => string;

const NO_ANSWER = 'The archive did not answer. Check the connection and try again.';

async function pageSelection(order: string[], responses: Record<string, unknown>, wantFrame?: string): Promise<{ res: { frames: unknown[] } | null; got: string; text: string | null }>
{
    const body = `${selection}\n${why}\nreturn { res, got, text: !res || res.frames.length === 0 ? why : null };`;
    const run = new (Object.getPrototypeOf(async function () {}).constructor)('order', 'responses', 'wantFrame', 'plainError', `
        const req = {}, signal = { aborted: false }, st = { target: 'rwaur' }, savedFirst = order[0] === 'snapshot';
        const demoOnly = false;
        let reading = null;
        const renderText = () => {}, isNotImplemented = () => false;
        const loadFrom = async (kind) => { const value = responses[kind]; if (value instanceof Error) throw value; return value; };
        ${body}`);
    return run(order, responses, wantFrame, plainError);
}

const frame = (obsId: string) => ({ frame: { frame: { obsId } } });

describe('release page messages', () => {
    it('cuts the real loader, message and error code out of the page', () => {
        expect(selection).toContain('for (const kind of order)');
        expect(why).toContain('const why = ');
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
        const out = await pageSelection(['live', 'snapshot'], { live: new Error('network'), snapshot: { frames: [] } });
        expect(out.text).toBe(`Couldn’t read the live SPHEREx archive, and the saved copy has no frames at this colour. ${NO_ANSWER}`);
        const savedFirst = await pageSelection(['snapshot', 'live'], { live: new Error('network'), snapshot: { frames: [] } });
        expect(savedFirst.text).toBe(out.text);
    });

    it('does not say the archive could not be reached when it answered and the read failed', async () => {
        const out = await pageSelection(['live', 'snapshot'], { live: new Error('bad FITS header'), snapshot: { frames: [] } });
        expect(out.text).toBe('Couldn’t read the live SPHEREx archive, and the saved copy has no frames at this colour. Something went wrong reading the frames. Try again, or pick another spot.');
        expect(out.text).not.toContain('reach');
    });

    it('reports an empty live answer as no frames', async () => {
        const out = await pageSelection(['live', 'snapshot'], { live: { frames: [] } });
        expect(out.text).toBe('SPHEREx has no frames of this spot at this colour yet.');
        const zero = await pageSelection(['live', 'snapshot'], { live: { frames: [], unusable: 0, missed: 0 } });
        expect(zero.text).toBe('SPHEREx has no frames of this spot at this colour yet.');
    });

    it('keeps the saved copy after a live failure', async () => {
        const out = await pageSelection(['live', 'snapshot'], { live: new Error('network'), snapshot: { frames: [{}] } });
        expect(out.got).toBe('snapshot');
        expect(out.res?.frames).toHaveLength(1);
        expect(out.text).toBeNull();
        expect(page).toContain("liveFailed ? 'Saved copy · archive did not answer' : 'Saved copy'");
    });

    it('says frames exist when live answers but none could be used for this view', async () => {
        const text = 'SPHEREx has frames near this spot, but none of them could be used for this view at this colour.';
        for (const live of [{ frames: [], unusable: 3 }, { frames: [], missed: 2 }, { frames: [], unusable: 1, missed: 1 }]) {
            expect((await pageSelection(['live', 'snapshot'], { live })).text).toBe(text);
            expect((await pageSelection(['snapshot', 'live'], { live, snapshot: { frames: [] } })).text).toBe(text);
        }
    });

    it('never hides a failed live read behind what the saved copy lacks', async () => {
        const text = `Couldn’t read the live SPHEREx archive, and the saved copy has no frames that could be used for this view at this colour. ${NO_ANSWER}`;
        for (const snapshot of [{ frames: [], unusable: 2 }, { frames: [], missed: 2 }]) {
            for (const order of [['live', 'snapshot'], ['snapshot', 'live']]) {
                const out = await pageSelection(order, { live: new Error('network'), snapshot });
                expect(out.text).toBe(text);
                expect(out.text).not.toContain('SPHEREx has frames');
            }
        }
    });

    it('says the frames could not be loaded when both sources fail, with the last error', async () => {
        const out = await pageSelection(['live', 'snapshot'], { live: new Error('network'), snapshot: new Error('The saved copy timed out reading /snapshot/rwaur/index.json.') });
        expect(out.text).toBe('Couldn’t load the frames. The saved copy on this site took too long to load. Check the connection and try again.');
        const other = await pageSelection(['snapshot', 'live'], { live: new Error('network'), snapshot: new Error('Snapshot file /snapshot/rwaur/index.json answered 404') });
        expect(other.text).toBe(`Couldn’t load the frames. ${NO_ANSWER}`);
    });

    it('shows the saved copy when it lacks the linked frame and live answers with no frames', async () => {
        const saved = { frames: [frame('a')] };
        const out = await pageSelection(['snapshot', 'live'], { live: { frames: [] }, snapshot: saved }, 'b');
        expect(out.got).toBe('snapshot');
        expect(out.res).toBe(saved);
        expect(out.text).toBeNull();
        // Live with frames still wins over the saved copy, and so does live's answer when the saved copy is empty too.
        const live = { frames: [frame('b')] };
        const fresh = await pageSelection(['snapshot', 'live'], { live, snapshot: saved }, 'b');
        expect(fresh.got).toBe('live');
        expect(fresh.res).toBe(live);
        const empty = await pageSelection(['snapshot', 'live'], { live: { frames: [], missed: 1 }, snapshot: { frames: [] } }, 'b');
        expect(empty.got).toBe('live');
        expect(empty.text).toBe('SPHEREx has frames near this spot, but none of them could be used for this view at this colour.');
    });

    it('does not blame NASA for a slow saved copy on this site', () => {
        expect(plainError(new Error('The saved copy timed out reading /snapshot/rwaur/a.f32.'))).toBe('The saved copy on this site took too long to load. Check the connection and try again.');
        expect(plainError(new Error('Request failed: 503'))).toBe('NASA’s archive is busy or down right now. Try again in a minute.');
        expect(plainError(new Error('Failed to fetch'))).toBe(NO_ANSWER);
        expect(plainError(null)).toBe(NO_ANSWER);
        expect(plainError(new Error('bad FITS header'))).toBe('Something went wrong reading the frames. Try again, or pick another spot.');
    });
});
