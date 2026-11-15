// Planet Nine chart card (FEATURES.planetx). Off: nothing is added to the page. On: a card goes right after `after`
// (the comet card, or "What to look for" when that is off) with the chart from src/lib/planetx-chart.ts, its title and
// caption, and the notes and references in a closed "About these numbers" block. Every word but the heading and the
// summary label comes from planetxChartText(). The chart's text is in SVG units, so it is drawn at the real width
// of its holder inside the card and redrawn when that width changes.

import { planetxChartSvg, planetxChartText } from '../lib/planetx-chart';
import { esc } from './comet-view';

export interface PlanetXDeps {
    enabled: boolean;
    // The chart's words; tests pass their own to check escaping. Defaults to planetxChartText.
    text?: () => ReturnType<typeof planetxChartText>;
}

export interface PlanetXSlot { section: HTMLElement | null }

const FALLBACK_WIDTH = 360;

function widthOf(el: HTMLElement): number
{
    const w = Math.round(el.clientWidth);
    return Number.isFinite(w) && w > 0 ? w : FALLBACK_WIDTH;
}

export function planetxBodyHtml(text: ReturnType<typeof planetxChartText>, width: number): string
{
    const notes = text.notes.map(n => `<p>${esc(n)}</p>`).join('');
    const refs = text.references.map(r => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.text)}</a></li>`).join('');
    return `<figure class="sk-px-fig"><div class="sk-px-svg">${planetxChartSvg({ width })}</div>`
        + `<figcaption><b>${esc(text.title)}</b><span>${esc(text.caption)}</span></figcaption></figure>`
        + `<details class="sk-px-more"><summary>About these numbers</summary>${notes}<ul class="sk-px-refs">${refs}</ul></details>`;
}

// `after` is the element the card goes after. Off, or no `after` in the page: returns at once, touches nothing.
export function mountPlanetX(after: HTMLElement | null, deps: PlanetXDeps): PlanetXSlot
{
    if (!deps.enabled || !after || !after.parentElement) {
        return { section: null };
    }
    const doc = after.ownerDocument;
    const section = doc.createElement('section');
    section.className = 'sk-mod sk-m-px';
    section.setAttribute('aria-labelledby', 'sk-hpx');
    after.insertAdjacentElement('afterend', section);
    const text = (deps.text ?? planetxChartText)();
    section.innerHTML = `<h2 class="sk-mh" id="sk-hpx">Planet Nine: how faint, how deep?</h2>${planetxBodyHtml(text, FALLBACK_WIDTH)}`;
    const holder = section.querySelector<HTMLElement>('.sk-px-svg');
    if (!holder) {
        return { section };
    }
    // The holder is the card's inner width (the card has side padding on a phone), so the chart is never scaled down
    // from a wider drawing. A redraw changes the holder's height, not its width, so the observer cannot loop.
    let drawn = FALLBACK_WIDTH;
    const redraw = (): void => {
        const w = widthOf(holder);
        if (w !== drawn) {
            drawn = w;
            holder.innerHTML = planetxChartSvg({ width: w });
        }
    };
    redraw();
    const view = doc.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null;
    const RO = view?.ResizeObserver;
    if (typeof RO === 'function') {
        new RO(redraw).observe(holder);
    }
    return { section };
}
