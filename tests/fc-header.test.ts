import { describe, expect, it, vi } from 'vitest';
import { transformWithOxc } from 'vite';
import app from '../src/ui/app.ts?raw';
import { FALSE_COLOUR_HINT, MODE_HINT } from '../src/ui/copy';

// Exercise the page's real header and details rendering with small stand-ins for its DOM nodes.
async function render(layer: boolean, leftOut = 0, shown = 4)
{
    const records = [
        ...[60857, 60887, 60917, 60947].map((t, i) => ({ tMin: t, tMax: t, detector: 1, collection: 'spherex_dr1', release: 'dr1', obsId: `a${i}`, url: `https://example.test/a${i}` })),
        ...[60796, 61000, 61284].map((t, i) => ({ tMin: t, tMax: t, detector: 6, collection: 'spherex_qr3', release: 'qr3', obsId: `b${i}` })),
    ];
    const picture = [
        { lambda: 0.85, used: shown - leftOut, leftOut, times: records.slice(leftOut, shown).map(r => [r.tMin, r.tMax]), records: records.slice(leftOut, shown) },
        { lambda: 4.6, used: 3, leftOut: 0, times: records.slice(4).map(r => [r.tMin, r.tMax]), records: records.slice(4) },
    ];
    const result = { lambda: 0.85, frames: records.slice(0, shown).map(frame => ({ frame: { frame } })),
        locked: records.slice(0, shown).map(() => ({ lambda: 0.85, dLambda: 0 })), grid: { fovDeg: 0.25, width: 97, height: 97, pixelArcsec: 1.54 } };
    const values: Record<string, string> = {};
    const elements: Record<string, { innerHTML: string }> = { dl: { innerHTML: '' } };
    const date = (mjd: number) => new Date((mjd - 40587) * 86400000);
    const start = app.indexOf('        const n = result.frames.length;', app.indexOf('    function renderText()'));
    const end = app.indexOf("        bind('statusShort'", start);
    const code = (await transformWithOxc(app.slice(start, end), 'render.ts')).code;
    const context = {
        result, st: { index: 0, mode: 'stack', target: undefined }, fcState: { layer, picture }, pair: null, cored: false,
        bind: (name: string, value: string) => { values[name] = value; }, sizeBar: () => {},
        niceDate: (mjd: number) => date(mjd).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).replace('Sept', 'Sep'),
        monthYear: (mjd: number) => date(mjd).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' }).replace('Sept', 'Sep'),
        mjdToDate: date, ref: (name: string) => elements[name] ??= { innerHTML: '' },
        sourceKind: 'live', RELEASE_DOI: { dr1: { id: 'dr1', label: 'SPHEREx DR1', cite: 'DR1' }, qr3: { id: 'qr3', label: 'SPHEREx QR3', cite: 'QR3' } },
        esc: (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;'), ICON: { file: '', out: '' },
    };
    new Function(...Object.keys(context), code)(...Object.values(context));
    return { values, html: elements.dl!.innerHTML };
}

describe('false colour page', () => {
    it('renders both bands in the header and frame details, then restores Stack when the layer is absent', async () => {
        const colour = await render(true);
        expect(colour.values).toMatchObject({ frame: 'False colour', when: 'May 2025 – Sep 2026', dlh: 'These frames' });
        for (const text of ['False colour from 2 wavelengths', '1 May 2025 to 1 Sep 2026', '0.85 µm and 4.60 µm',
            '4 at 0.85 µm, 3 at 4.60 µm', 'D1, D6', 'SPHEREx DR1', 'SPHEREx QR3',
            '<dt>Files</dt><dd><span class="sk-only">0.85 µm only</span>4, a0 to a3</dd>', '<dt>Open</dt><dd><span class="sk-only">0.85 µm only</span>']) {
            expect(colour.html).toContain(text);
        }
        const stack = await render(false);
        expect(stack.values.frame).toBe('Average of 4');
        expect(stack.html).toContain('Average of all 4 frames');
        expect(stack.html).not.toContain('µm only');
        const hint = app.match(/bind\('hint', (.+)\);/)![1]!;
        const getHint = new Function('fcState', 'st', 'pair', 'subtractText', 'MODE_HINT', 'FALSE_COLOUR_HINT', `return ${hint};`);
        expect(getHint({ layer: true }, { mode: 'stack' }, null, null, MODE_HINT, FALSE_COLOUR_HINT)).toBe(FALSE_COLOUR_HINT);
        expect(getHint({ layer: false }, { mode: 'stack' }, null, null, MODE_HINT, FALSE_COLOUR_HINT)).toBe(MODE_HINT.stack);
    });

    it('counts frames used of those on screen when some are left out, and names a single file as one file', async () => {
        const partly = await render(true, 2);
        expect(partly.html).toContain('2 of 4 at 0.85 µm, 3 at 4.60 µm');
        expect(partly.html).toContain('<dt>Files</dt><dd><span class="sk-only">0.85 µm only</span>');
        expect(partly.html).toContain('4, a0 to a3');
        const single = await render(true, 0, 1);
        expect(single.html).toContain('1 at 0.85 µm, 3 at 4.60 µm');
        expect(single.html).toContain('<dt>File</dt><dd><span class="sk-only">0.85 µm only</span>a0</dd>');
        expect(single.html).not.toContain('a0 to a0');
        // One file gets one link: "first" and "last" would point at the same file.
        expect(single.html).toContain('FITS file</a>');
        expect(single.html).not.toContain('FITS, first');
        expect(partly.html).toContain('FITS, first');
        // The wavelength on screen has no used frame: the Files row still says which wavelength it lists.
        const none = await render(true, 4);
        expect(none.html).toContain('0 of 4 at 0.85 µm');
        // Detector and Release cover the files listed, so a left-out file's detector is not missing from the box.
        expect(none.html).toContain('D1, D6');
        expect(none.html).toContain('SPHEREx DR1');
        expect(none.html).toContain('<dt>Files</dt><dd><span class="sk-only">0.85 µm only</span>');
    });

    it('creates a closed disclosure at either width and leaves the visible warning outside', async () => {
        const start = app.indexOf('    function layerSlot(');
        const end = app.indexOf('    function renderText()', start);
        const code = (await transformWithOxc(app.slice(start, end), 'layer.ts')).code;
        for (const matches of [false, true]) {
            const nodes: Record<string, any> = {};
            const ref = (name: string) => nodes[name] ??= { dataset: {}, setAttribute: vi.fn(), replaceChildren(...items: unknown[]) { this.children = items; }, append(item: unknown) { this.children.push(item); } };
            const document = { createElement: () => ({ open: false, append: vi.fn(), className: '', textContent: '' }) };
            const layerSlot = new Function('ref', 'document', 'narrow', `${code}; return layerSlot;`)(ref, document, { matches });
            layerSlot({ key: true, layer: true, note: 'full', split: { lead: 'labels warning', more: 'explanation' } }, true, 'key', 'layer', 'fcNote');
            expect(nodes.fcNote.children[0]).toBe('labels warning');
            expect(nodes.fcNote.children[2].open).toBe(false);
            expect(nodes.fcNote.children[2].append).toHaveBeenCalledWith(expect.objectContaining({ textContent: 'How to read this colour: scale, bright stars, rims, speckle' }), 'explanation');
        }
        const fs = (globalThis as any).process.getBuiltinModule('node:fs');
        expect(fs.readFileSync('src/ui/styles.css', 'utf8')).toContain('[data-ref="fcNote"] .sk-more summary { display: flex;');
    });

    it('unpresses failed reads, retries on one press and clears errors on view and key changes', async () => {
        const start = app.indexOf('        if (fcFailure &&');
        const end = app.indexOf('        // FLAGS are read', start);
        const code = (await transformWithOxc(app.slice(start, end), 'state.ts')).code;
        const clickStart = app.indexOf("        } else if (b.dataset.act === 'flags') {");
        const clickEnd = app.indexOf("        } else if (b.dataset.act === 'gaia') {", clickStart);
        const handlers = app.slice(clickStart, clickEnd).replace(/^        } else if/, 'if') + '\n}';
        const make = new Function('failure', `
            let fcOn = true, flagsOn = false, fcFailure = null, fcState;
            let view = { result: {}, mode: 'stack', source: 'live' }, rendered, calls = 0;
            const FEATURES = { epoch: true };
            const epochSlot = { on: false, off() {}, press() {}, tagPress() {} };
            const fcLayer = { update(v, on) {
                if (!on) return { key: true, layer: false, note: '' };
                calls++;
                return calls === 1 ? { key: true, layer: false, note: failure, failed: true }
                    : { key: true, layer: false, note: 'Reading' };
            } };
            const layerSlot = (state, on) => { rendered = { state, on }; };
            function renderSlots() { ${code} }
            function press(act) { const b = { dataset: { act } }; ${handlers} }
            return { renderSlots, press, changeMode: () => { view = { ...view, mode: 'blink' }; },
                changeColour: () => { view = { ...view, result: {} }; }, get: () => ({ rendered, calls }) };
        `);
        for (const failure of ['read failed', 'no partner', 'picture failed']) {
            const h = make(failure);
            h.renderSlots();
            expect(h.get().rendered).toMatchObject({ on: false, state: { note: failure } });
            h.renderSlots();
            expect(h.get().rendered.state.note).toBe(failure);
            h.press('falsecolour');
            expect(h.get()).toMatchObject({ calls: 2, rendered: { on: true, state: { note: 'Reading' } } });
            for (const change of ['changeMode', 'changeColour'] as const) {
                const fresh = make(failure);
                fresh.renderSlots();
                fresh[change]();
                fresh.renderSlots();
                expect(fresh.get().rendered.state.note).toBe('');
            }
            for (const key of ['flags', 'epoch']) {
                const fresh = make(failure);
                fresh.renderSlots();
                fresh.press(key);
                expect(fresh.get().rendered.state.note).toBe('');
            }
        }
    });
});
