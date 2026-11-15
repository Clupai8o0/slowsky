// Comet 3I/ATLAS card (FEATURES.comet). Off: nothing is added to the page and nothing is fetched. On: a framed
// card is put at the foot of the left panel, under "What to look for"; when it first comes into view it fetches /comet/3i-atlas.json once and
// draws twelve cut-outs on one shared linear scale, an SVG chart with a text alternative, and a table fallback.

import { COMET_PAPERS, COMET_TITLE, COMET_URL, cometCaption, cometPoints, cutoutRgba, frameLabel, parseComet, sharedScale, type CometDoc } from '../lib/comet';

export interface CometDeps {
    enabled: boolean;
    fetch?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
    // Paints one cut-out; the default uses a canvas 2D context.
    paint?: (canvas: HTMLCanvasElement, rgba: Uint8ClampedArray, size: number) => void;
}

export interface CometSlot { section: HTMLElement | null; ready: Promise<void> }

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const COMET_FAILED = 'The comet frames could not be loaded.';

function paintCanvas(canvas: HTMLCanvasElement, rgba: Uint8ClampedArray, size: number): void
{
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), size, size), 0, 0);
    }
}

function num(v: number): string
{
    return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
}

// Inline SVG: core minus border (MJy/sr) against wavelength (µm), with labelled axes.
export function cometChartSvg(doc: CometDoc): string
{
    const pts = cometPoints(doc);
    const W = 300;
    const H = 170;
    const L = 40;
    const R = 10;
    const T = 10;
    const B = 34;
    const x0 = Math.floor(pts[0]!.wavelength * 10) / 10;
    const x1 = Math.ceil(pts[pts.length - 1]!.wavelength * 10) / 10;
    const ymax = Math.max(...pts.map(p => p.value));
    const step = ymax > 20 ? 10 : ymax > 5 ? 2 : 0.5;
    const y1 = Math.ceil(ymax / step) * step;
    const y0f = Math.min(0, Math.floor(Math.min(...pts.map(p => p.value)) / step) * step);
    const y0 = y1 > y0f ? y0f : y1 - step; // a flat chart still gets a positive span
    const sx = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
    const sy = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const xt: string[] = [];
    for (let v = x0; v <= x1 + 1e-9; v += 0.1) {
        xt.push(`<text x="${sx(v).toFixed(1)}" y="${H - B + 14}" text-anchor="middle">${v.toFixed(1)}</text>`);
    }
    const yt: string[] = [];
    for (let v = y0; v <= y1 + 1e-9; v += step) {
        yt.push(`<text x="${L - 6}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`);
    }
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.wavelength).toFixed(1)} ${sy(p.value).toFixed(1)}`).join(' ');
    const dots = pts.map(p => `<circle cx="${sx(p.wavelength).toFixed(1)}" cy="${sy(p.value).toFixed(1)}" r="2.5"/>`).join('');
    const top = pts.reduce((a, p) => (p.value > a.value ? p : a));
    const desc = `Core brightness minus border, by wavelength: ${pts.map(p => `${p.wavelength.toFixed(2)} µm ${num(p.value)}`).join('; ')} MJy/sr.`
        + ` Highest at ${top.wavelength.toFixed(2)} µm.`;
    return `<svg class="sk-cm-chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="sk-cm-ct sk-cm-cd">`
        + `<title id="sk-cm-ct">Comet core brightness against wavelength</title><desc id="sk-cm-cd">${esc(desc)}</desc>`
        + `<path class="ax" d="M${L} ${T}V${H - B}H${W - R}"/>`
        + `<g class="tk">${xt.join('')}${yt.join('')}</g>`
        + `<text class="al" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">Wavelength (µm)</text>`
        + `<text class="al" transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">MJy/sr</text>`
        + `<path class="ln" d="${line}"/><g class="pt">${dots}</g></svg>`;
}

export function cometTableHtml(doc: CometDoc): string
{
    const rows = doc.frames.map((f) => {
        const lab = frameLabel(f);
        return `<tr><td>${esc(lab.wave)}</td><td>${esc(lab.time)}</td><td>${num(f.coreMean)}</td><td>${num(f.borderMedian)}</td><td>${num(f.coreMean - f.borderMedian)}</td></tr>`;
    }).join('');
    return '<table class="sk-cm-tab"><caption>The numbers behind the chart, in MJy/sr</caption>'
        + '<thead><tr><th scope="col">Wavelength</th><th scope="col">Start</th><th scope="col">Core 3×3 mean</th><th scope="col">Border median</th><th scope="col">Core minus border</th></tr></thead>'
        + `<tbody>${rows}</tbody></table>`;
}

export function cometBodyHtml(doc: CometDoc): string
{
    const cells = doc.frames.map((f, i) => {
        const lab = frameLabel(f);
        return `<figure class="sk-cm-cell"><canvas data-i="${i}" role="img" aria-label="${esc(`Comet-centred picture at ${lab.aria}`)}"></canvas>`
            + `<figcaption><b>${esc(lab.wave)}</b><span>${esc(lab.time)}</span></figcaption></figure>`;
    }).join('');
    const caption = cometCaption(doc).map(s => `<p>${esc(s)}</p>`).join('');
    const papers = COMET_PAPERS.map(p => `<li><a href="https://doi.org/${p.doi}" target="_blank" rel="noopener">${esc(p.cite)}</a></li>`).join('');
    return `<div class="sk-cm-row">${cells}</div>`
        + `<figure class="sk-cm-fig">${cometChartSvg(doc)}</figure>`
        + `<div class="sk-cm-cap">${caption}<p class="sk-cm-refs">Frames: SPHEREx DR1, detector ${doc.detector}, from IRSA. Papers:</p><ul class="sk-cm-papers">${papers}</ul></div>`
        + `<details class="sk-cm-more"><summary>Show the numbers</summary>${cometTableHtml(doc)}</details>`;
}

function paintAll(section: HTMLElement, doc: CometDoc, paint: NonNullable<CometDeps['paint']>): void
{
    const scale = sharedScale(doc);
    section.querySelectorAll<HTMLCanvasElement>('canvas[data-i]').forEach((c) => {
        const f = doc.frames[Number(c.dataset.i)];
        if (f) {
            paint(c, cutoutRgba(f, doc.size, scale), doc.size);
        }
    });
}

// `after` is the element the card goes after (the "What to look for" section). Off: returns at once, touches nothing.
export function mountComet(after: HTMLElement | null, deps: CometDeps): CometSlot
{
    if (!deps.enabled || !after || !after.parentElement) {
        return { section: null, ready: Promise.resolve() };
    }
    const doc = after.ownerDocument;
    const section = doc.createElement('section');
    section.className = 'sk-mod sk-m-comet';
    section.setAttribute('aria-labelledby', 'sk-hcm');
    section.innerHTML = `<h2 class="sk-mh" id="sk-hcm">${esc(COMET_TITLE)}</h2><div class="sk-cm-body" aria-live="polite"><p class="sk-body mute">Loading the comet frames…</p></div>`;
    after.insertAdjacentElement('afterend', section);
    const body = section.querySelector<HTMLElement>('.sk-cm-body')!;
    const get = deps.fetch ?? ((url: string) => fetch(url));
    const paint = deps.paint ?? paintCanvas;
    let resolve: () => void = () => {};
    const ready = new Promise<void>((r) => {
        resolve = r;
    });
    let started = false;
    const load = () => {
        if (started) {
            return;
        }
        started = true;
        get(COMET_URL)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error('fetch failed'))))
            .then((raw) => {
                const data = parseComet(raw);
                body.innerHTML = cometBodyHtml(data);
                paintAll(section, data, paint);
            })
            .catch(() => {
                body.innerHTML = `<p class="sk-body mute">${COMET_FAILED}</p>`;
            })
            .finally(resolve);
    };
    const IO = (doc.defaultView as (Window & typeof globalThis) | null)?.IntersectionObserver;
    if (IO) {
        const io = new IO((entries) => {
            if (entries.some(e => e.isIntersecting)) {
                io.disconnect();
                load();
            }
        });
        io.observe(section);
    } else {
        load();
    }
    return { section, ready };
}
