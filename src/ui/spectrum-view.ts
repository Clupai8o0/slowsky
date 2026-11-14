import { CUBE_QUANTITY, readCubeSpectrum, type CubeSpectrum } from '../lib/cube';
import { spectrumChartSvg, spectrumChartText } from '../lib/spectrum-chart';
import type { SkyCoord } from '../lib/types';

export const SPECTRUM_TEXT = Object.freeze({
    idle: 'Read the light of the spot at the centre of the view, colour by colour, from the SPHEREx all-sky cube.',
    read: 'Read the spectrum here',
    estimate: 'A live read from the public archive: about 2 MB, about 20 seconds.',
    reading: 'Reading the spectrum…',
    stop: 'Stop',
    failure: 'The spectrum could not be read from the archive. Try again.',
    retry: 'Try again',
    clear: 'Clear',
    spot: 'This is the spot at the centre of the view, not a named object: a star that moves, or a neighbour inside the same pixels, changes what is read.',
    reference: 'The labelled wavelengths are where well-known features fall. A label does not mean the feature is present here.',
    link: 'the cube tile',
    linkEnd: ' (SPHEREx DR1)',
});

export interface SpectrumView {
    center: SkyCoord;
    lambda?: number;
    source: 'live' | 'snapshot' | 'demo';
    available?: boolean;
}
export interface SpectrumOut {
    visible: boolean;
    state: 'idle' | 'reading' | 'ready' | 'failed';
    svg?: string;
    summary?: string;
    caption?: string;
    notes?: string[];
    facts?: string;
    read?: string;
    url?: string;
    reference?: string;
}
export interface SpectrumSlot {
    update(view: SpectrumView | null): void;
    press(): void;
    stop(): void;
    clear(): void;
    resize(width: number): void;
}
interface SpectrumDeps {
    enabled: boolean;
    draw: (out: SpectrumOut) => void;
    read?: typeof readCubeSpectrum;
}
type Entry = { spec: CubeSpectrum; center: SkyCoord };
function key(c: SkyCoord): string
{
    return `${c.ra.toFixed(5)},${c.dec.toFixed(5)}`;
}
function same(a: SkyCoord | undefined, b: SkyCoord | undefined): boolean
{
    return !!a && !!b && a.ra === b.ra && a.dec === b.dec;
}
function bytes(n: number): string
{
    const mb = n >= 1000000;
    return `${Number((n / (mb ? 1000000 : 1000)).toFixed(2))} ${mb ? 'MB' : 'kB'}`;
}
export function createSpectrum(deps: SpectrumDeps): SpectrumSlot
{
    let view: SpectrumView | null = null;
    let state: SpectrumOut['state'] = 'idle';
    let entry: Entry | null = null;
    let ctrl: AbortController | null = null;
    let generation = 0;
    let width = 320;
    const cache = new Map<string, Entry>();
    const read = deps.read ?? readCubeSpectrum;

    function abort(): void
    {
        generation++;
        ctrl?.abort();
        ctrl = null;
    }
    function draw(): void
    {
        const visible = deps.enabled && !!view && view.available !== false && view.source !== 'demo';
        if (!visible || state !== 'ready' || !entry || !view) {
            deps.draw({ visible, state });
            return;
        }
        const { spec, center } = entry;
        const svg = spectrumChartSvg(spec, { width, markLambda: view.lambda });
        const text = spectrumChartText(spec);
        deps.draw({ visible, state, svg, summary: text.summary, caption: text.caption, notes: text.notes,
            facts: `Spot: RA ${center.ra.toFixed(4)}°, Dec ${center.dec.toFixed(4)}° · ${CUBE_QUANTITY} · ${spec.unit}`,
            read: `Read ${bytes(spec.bytesRead)} from `, url: spec.spot.url,
            reference: svg.includes('data-feature-tick="true"') ? SPECTRUM_TEXT.reference : '' });
    }
    return {
        update(next): void
        {
            if (!deps.enabled) { return; }
            const changed = !same(view?.center, next?.center);
            const enteringDemo = next?.available !== false && next?.source === 'demo';
            const leavingDemo = view?.available !== false && view?.source === 'demo' && next?.source !== 'demo';
            if (changed || !next || enteringDemo || leavingDemo) {
                abort();
                entry = null;
                state = 'idle';
                if (next && (next.available === false || next.source !== 'demo')) {
                    const k = key(next.center);
                    const cached = cache.get(k);
                    if (cached) {
                        cache.delete(k);
                        cache.set(k, cached);
                        entry = cached;
                        state = 'ready';
                    }
                }
            }
            view = next ? { ...next, center: { ...next.center } } : null;
            draw();
        },
        press(): void
        {
            if (!deps.enabled || !view || view.available === false || view.source === 'demo' || state === 'reading' || state === 'ready') { return; }
            const center = { ...view.center };
            const mine = ++generation;
            const controller = new AbortController();
            ctrl = controller;
            state = 'reading';
            draw();
            let promise: Promise<CubeSpectrum>;
            try {
                promise = read(center, { signal: controller.signal });
            } catch (error) {
                promise = Promise.reject(error);
            }
            promise.then(spec => {
                if (mine !== generation || controller.signal.aborted) { return; }
                ctrl = null;
                entry = { spec, center };
                const k = key(center);
                cache.delete(k);
                cache.set(k, entry);
                if (cache.size > 4) { cache.delete(cache.keys().next().value!); }
                state = 'ready';
                draw();
            }, () => {
                if (mine !== generation || controller.signal.aborted) { return; }
                ctrl = null;
                state = 'failed';
                draw();
            });
        },
        stop(): void { abort(); state = 'idle'; entry = null; draw(); },
        clear(): void { abort(); state = 'idle'; entry = null; draw(); },
        resize(next): void {
            const w = Math.max(320, Number.isFinite(next) ? Math.round(next) : 320);
            if (width !== w) { width = w; if (deps.enabled) { draw(); } }
        },
    };
}

export function mountSpectrum(section: HTMLElement, deps: { enabled: boolean; read?: typeof readCubeSpectrum }): SpectrumSlot
{
    section.hidden = true;
    if (!deps.enabled) {
        return createSpectrum({ ...deps, draw: () => {} });
    }
    const q = <T extends HTMLElement>(name: string) => section.querySelector(`[data-sp="${name}"]`) as T;
    const heading = q<HTMLElement>('heading');
    const button = q<HTMLButtonElement>('read');
    const stop = q<HTMLButtonElement>('stop');
    const clear = q<HTMLButtonElement>('clear');
    const chart = q<HTMLElement>('chart');
    const notes = q<HTMLElement>('notes');
    const link = q<HTMLAnchorElement>('link');
    const doc = section.ownerDocument;
    let lastSvg = '';
    const slot = createSpectrum({ ...deps, draw: out => {
        section.hidden = !out.visible;
        const ready = out.state === 'ready';
        const reading = out.state === 'reading';
        if ((doc.activeElement === button && (reading || ready || !out.visible))
            || (doc.activeElement === stop && !reading) || (doc.activeElement === clear && !ready)) {
            heading.focus();
        }
        q<HTMLElement>('intro').hidden = ready || reading || out.state === 'failed';
        q<HTMLElement>('intro').textContent = SPECTRUM_TEXT.idle;
        q<HTMLElement>('estimate').hidden = ready || reading;
        q<HTMLElement>('estimate').textContent = SPECTRUM_TEXT.estimate;
        button.hidden = ready;
        button.disabled = reading;
        button.textContent = reading ? SPECTRUM_TEXT.reading : out.state === 'failed' ? SPECTRUM_TEXT.retry : SPECTRUM_TEXT.read;
        stop.hidden = !reading;
        stop.textContent = SPECTRUM_TEXT.stop;
        clear.hidden = !ready;
        clear.textContent = SPECTRUM_TEXT.clear;
        q<HTMLElement>('status').textContent = reading ? SPECTRUM_TEXT.reading : out.state === 'failed' ? SPECTRUM_TEXT.failure : '';
        q<HTMLElement>('result').hidden = !ready;
        if (!ready) { return; }
        if (out.svg !== lastSvg) { chart.innerHTML = out.svg ?? ''; lastSvg = out.svg ?? ''; }
        q<HTMLElement>('summary').textContent = out.summary ?? '';
        q<HTMLElement>('caption').textContent = out.caption ?? '';
        notes.replaceChildren(...(out.notes ?? []).map(note => { const p = doc.createElement('p'); p.textContent = note; return p; }));
        q<HTMLElement>('facts').textContent = out.facts ?? '';
        q<HTMLElement>('readBytes').textContent = out.read ?? '';
        link.textContent = SPECTRUM_TEXT.link;
        link.href = out.url ?? '';
        q<HTMLElement>('linkEnd').textContent = SPECTRUM_TEXT.linkEnd;
        q<HTMLElement>('spot').textContent = SPECTRUM_TEXT.spot;
        q<HTMLElement>('reference').textContent = out.reference ?? '';
    } });
    button.addEventListener('click', () => slot.press());
    stop.addEventListener('click', () => slot.stop());
    clear.addEventListener('click', () => slot.clear());
    const measure = () => slot.resize(q<HTMLElement>('body').clientWidth);
    measure();
    if (typeof ResizeObserver !== 'undefined') { new ResizeObserver(measure).observe(q<HTMLElement>('body')); }
    return slot;
}
