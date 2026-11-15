// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { readFileSync as nodeRead } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { planetxChartSvg, planetxChartText } from '../src/lib/planetx-chart';
import { mountPlanetX } from '../src/ui/planetx-view';

const readFileSync = nodeRead as (path: URL, encoding: 'utf8') => string;

// A small stand-in for the DOM (the repo has no jsdom): `after` records where the card is put, the section keeps
// its HTML as a string, and `.sk-px-svg` is the holder the resize path redraws.
function fakePage(opts: { width?: number; observer?: boolean } = {})
{
    const holder = { innerHTML: '', clientWidth: opts.width ?? 0 };
    const section = { className: '', innerHTML: '', clientWidth: opts.width ?? 0, attrs: {} as Record<string, string>,
        setAttribute(k: string, v: string) {
            this.attrs[k] = v;
        },
        querySelector: (sel: string) => (sel === '.sk-px-svg' ? holder : null) };
    let fire: () => void = () => {};
    const observed: unknown[] = [];
    class FakeRO {
        constructor(cb: () => void) {
            fire = cb;
        }
        observe(el: unknown) {
            observed.push(el);
        }
    }
    const createElement = vi.fn(() => section);
    const insert = vi.fn();
    const after = { parentElement: {}, insertAdjacentElement: insert,
        ownerDocument: { createElement, defaultView: opts.observer ? { ResizeObserver: FakeRO } : null } } as unknown as HTMLElement;
    return { after, section, holder, insert, createElement, observed, fire: () => fire() };
}

describe('planetx view', () => {
    it('off: returns no section and touches nothing', () => {
        const page = fakePage();
        expect(mountPlanetX(page.after, { enabled: false })).toEqual({ section: null });
        expect(page.insert).not.toHaveBeenCalled();
        expect(page.createElement).not.toHaveBeenCalled();
        expect(mountPlanetX(null, { enabled: true })).toEqual({ section: null });
        const orphan = { parentElement: null, insertAdjacentElement: vi.fn() } as unknown as HTMLElement;
        expect(mountPlanetX(orphan, { enabled: true })).toEqual({ section: null });
    });

    it('on: one card right after the anchor, one chart, the heading, every note and every reference', () => {
        const page = fakePage();
        const slot = mountPlanetX(page.after, { enabled: true });
        expect(slot.section).toBe(page.section);
        expect(page.insert).toHaveBeenCalledTimes(1);
        expect(page.insert).toHaveBeenCalledWith('afterend', page.section);
        expect(page.section.className).toBe('sk-mod sk-m-px');
        expect(page.section.attrs['aria-labelledby']).toBe('sk-hpx');
        const html = page.section.innerHTML;
        expect(html.match(/<svg/g)?.length).toBe(1);
        expect(html).toContain('<h2 class="sk-mh" id="sk-hpx">Planet Nine: how faint, how deep?</h2>');
        expect(html).toContain('<summary>About these numbers</summary>');
        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const text = planetxChartText();
        expect(html).toContain(`<b>${esc(text.title)}</b>`);
        expect(html).toContain(esc(text.caption));
        expect(text.notes.length).toBeGreaterThan(0);
        for (const note of text.notes) {
            expect(html).toContain(`<p>${esc(note)}</p>`);
        }
        expect(text.references.length).toBeGreaterThan(0);
        for (const ref of text.references) {
            expect(html).toContain(`href="${esc(ref.url)}" target="_blank" rel="noopener noreferrer">${esc(ref.text)}</a>`);
        }
        expect(html).toContain('<ul class="sk-px-refs">');
    });

    it('draws at the holder width, and at 360 when the width is 0 (no layout)', () => {
        const none = fakePage({ width: 0 });
        mountPlanetX(none.after, { enabled: true });
        expect(none.section.innerHTML).toContain(planetxChartSvg({ width: 360 }));
        expect(none.holder.innerHTML).toBe('');
        const wide = fakePage({ width: 512.4 });
        mountPlanetX(wide.after, { enabled: true });
        expect(wide.holder.innerHTML).toBe(planetxChartSvg({ width: 512 }));
    });

    it('watches the holder and redraws only when its rounded width changes', () => {
        const page = fakePage({ width: 400, observer: true });
        mountPlanetX(page.after, { enabled: true });
        expect(page.observed).toEqual([page.holder]);
        expect(page.holder.innerHTML).toBe(planetxChartSvg({ width: 400 }));
        page.holder.innerHTML = '';
        page.fire();
        expect(page.holder.innerHTML).toBe('');
        page.holder.clientWidth = 400.3;
        page.fire();
        expect(page.holder.innerHTML).toBe('');
        page.holder.clientWidth = 600;
        page.fire();
        expect(page.holder.innerHTML).toBe(planetxChartSvg({ width: 600 }));
        page.holder.innerHTML = 'kept';
        page.fire();
        expect(page.holder.innerHTML).toBe('kept');
    });

    it('sits after the comet card on a narrow screen, not at the top of the page', () => {
        const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
        expect(css).toContain('@media (max-width: 1080px) { .sk-m-px { order: 7; margin-top: 40px; } }');
        expect(css).toContain('@media (max-width: 1080px) { .sk-m-comet { order: 7;');
    });

    it('gives the drawing 320 px or close to it on the smallest phones, so its text is not shrunk', () => {
        const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
        expect(css).toContain('@media (max-width: 355px) { .sk-px-svg { margin: 0 -18px 0 -14px; } }');
    });

    it('escapes < & > and quotes in every string it is given', () => {
        const base = planetxChartText();
        const page = fakePage();
        mountPlanetX(page.after, { enabled: true, text: () => ({
            title: 'T <b>x</b>', caption: 'C & D', notes: ['a < b & c > d'],
            references: [{ key: 'k', text: 'R <i>', url: 'https://example.org/?a=1&b="2"' }],
        }) });
        const html = page.section.innerHTML;
        expect(html).toContain('<b>T &lt;b&gt;x&lt;/b&gt;</b>');
        expect(html).toContain('C &amp; D');
        expect(html).toContain('<p>a &lt; b &amp; c &gt; d</p>');
        expect(html).toContain('href="https://example.org/?a=1&amp;b=&quot;2&quot;"');
        expect(html).toContain('>R &lt;i&gt;</a>');
        expect(html).not.toContain(base.notes[0]!);
    });

    it('adds none of the claim words beyond what the chart text already has', () => {
        const view = readFileSync(new URL('../src/ui/planetx-view.ts', import.meta.url), 'utf8');
        expect(view).not.toMatch(/candidate|discovery|detected|confirmed|proves/i);
        const app = readFileSync(new URL('../src/ui/app.ts', import.meta.url), 'utf8');
        expect(app).toContain("mountPlanetX(comet.section ?? root.querySelector<HTMLElement>('.sk-m-about'), { enabled: FEATURES.planetx });");
    });
});
