import { describe, expect, it } from 'vitest';
import page from '../src/ui/app.ts?raw';

// Execute the page's actual source-selection and text expressions with fake sources.
const selection = page.slice(page.indexOf('        let res: SkyResult | null = null;'), page.indexOf('        if (signal.aborted) {\n            return;\n        }\n        reading = null;'))
    .replace(': SkyResult | null', '').replace(': SourceKind', '').replace(': unknown', '').replace(': SkyResult | null', '');
const why = page.slice(page.indexOf('            const why = '), page.indexOf("            bind('err', why);"));
const note = page.split('\n').find((line) => line.includes("bind('lcNote', `At "))!;

async function pageSelection(order: string[], responses: Record<string, unknown>): Promise<{ res: { frames: unknown[] } | null; got: string; text: string | null }>
{
    const body = `${selection}\n${why}\nreturn { res, got, text: !res || res.frames.length === 0 ? why : null };`;
    const run = new (Object.getPrototypeOf(async function () {}).constructor)('order', 'responses', `
        const req = {}, signal = { aborted: false }, st = { target: 'rwaur' }, savedFirst = order[0] === 'snapshot';
        const demoOnly = false, wantFrame = undefined;
        let reading = null;
        const renderText = () => {}, isNotImplemented = () => false, plainError = () => 'The archive did not answer. Check the connection and try again.';
        const loadFrom = async (kind) => { const value = responses[kind]; if (value instanceof Error) throw value; return value; };
        ${body}`);
    return run(order, responses);
}

describe('release page messages', () => {
    it('describes the chart bar and its omitted photon noise', () => {
        const render = new Function('bind', 'c', 'noise', 'left', 'blendAt', note);
        let text = '';
        render((_name: string, value: string) => { text = value; }, { lc: { lambda: 4.6 }, refs: 2 }, 0.03, '', '');
        expect(text).toBe("At 4.60 µm, measured against 2 nearby comparison stars from Gaia. The band shows how much they wobble (±3.0%); the bar on each dot adds the noise of the sky around the star. The star’s own photon noise is not included, so the real uncertainty may be larger. A change inside its bar may be noise.");
        expect(text).not.toContain('own noise');
    });

    it('explains a failed live read when the saved copy is empty', async () => {
        const out = await pageSelection(['live', 'snapshot'], { live: new Error('network'), snapshot: { frames: [] } });
        expect(out.text).toBe("Couldn’t reach the live SPHEREx archive, and the saved copy has no frames at this colour. The archive did not answer. Check the connection and try again.");
        const savedFirst = await pageSelection(['snapshot', 'live'], { live: new Error('network'), snapshot: { frames: [] } });
        expect(savedFirst.text).toBe(out.text);
    });

    it('reports an empty live answer as no frames', async () => {
        const out = await pageSelection(['live', 'snapshot'], { live: { frames: [] } });
        expect(out.text).toBe('SPHEREx has no frames of this spot at this colour yet.');
    });

    it('keeps the saved copy after a live failure', async () => {
        const out = await pageSelection(['live', 'snapshot'], { live: new Error('network'), snapshot: { frames: [{}] } });
        expect(out.got).toBe('snapshot');
        expect(out.res?.frames).toHaveLength(1);
        expect(out.text).toBeNull();
        expect(page).toContain("liveFailed ? 'Saved copy · archive did not answer' : 'Saved copy'");
    });

    it('explains when all frames have unusable pixels', async () => {
        const out = await pageSelection(['live', 'snapshot'], { live: { frames: [], unusable: 3 } });
        expect(out.text).toBe('SPHEREx has frames of this spot at this colour, but none has usable pixels here.');
    });
});
