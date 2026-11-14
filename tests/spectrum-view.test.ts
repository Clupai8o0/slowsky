import { describe, expect, it, vi } from 'vitest';
import { createSpectrum, mountSpectrum, SPECTRUM_TEXT, type SpectrumOut } from '../src/ui/spectrum-view';
import { DEFAULT_FEATURES, featuresFrom } from '../src/ui/slots';
import { CUBE_QUANTITY, type CubeSpectrum } from '../src/lib/cube';
import { spectrumChartText } from '../src/lib/spectrum-chart';
import page from '../src/ui/app.ts?raw';

const a = { ra: 12.34567, dec: -4.56789 };
const b = { ra: 22, dec: 3 };
function spectrum(): CubeSpectrum
{
    return { lambda: Float64Array.from([1, 3.05, 5]), surfaceBrightness: Float32Array.from([2, 4, 1]),
        noise: Float32Array.from([1, 1, 1]), background: Float32Array.from([0, 0, 0]), reasons: [null, null, null],
        notes: ['3 example planes'], unit: 'test unit', caption: 'test caption', bytesRead: 2345000,
        spot: { tile: 'test', url: 'https://example.test/cube', x: 0, y: 0 } };
}
function rig(enabled = true)
{
    const calls: { signal: AbortSignal; resolve: (s: CubeSpectrum) => void; reject: () => void }[] = [];
    const read = vi.fn((_center: typeof a, options?: { signal?: AbortSignal }) => new Promise<CubeSpectrum>((resolve, reject) => {
        calls.push({ signal: options!.signal!, resolve, reject: () => reject(new Error('offline')) });
    }));
    let out: SpectrumOut | undefined;
    const slot = createSpectrum({ enabled, read, draw: value => { out = value; } });
    return { slot, read, calls, out: () => out! };
}
const view = (center = a, lambda = 1.5, source: 'live' | 'snapshot' | 'demo' = 'live') => ({ center, lambda, source });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function domRig()
{
    const doc: { activeElement: Fake | null; createElement: () => Fake } = {
        activeElement: null, createElement: () => new Fake(),
    };
    class Fake {
        hidden = false;
        disabled = false;
        textContent = '';
        innerHTML = '';
        href = '';
        clientWidth = 480;
        children: Fake[] = [];
        listeners: Record<string, () => void> = {};
        ownerDocument = doc;
        addEventListener(name: string, cb: () => void): void { this.listeners[name] = cb; }
        replaceChildren(...children: Fake[]): void { this.children = children; }
        focus(): void { doc.activeElement = this; }
        click(): void { if (!this.disabled && !this.hidden) { this.listeners.click?.(); } }
    }
    const names = ['heading', 'body', 'read', 'stop', 'clear', 'chart', 'notes', 'link', 'intro', 'estimate',
        'status', 'result', 'summary', 'caption', 'facts', 'readBytes', 'linkEnd', 'spot', 'reference'];
    const els = Object.fromEntries(names.map(name => [name, new Fake()])) as Record<string, Fake>;
    const section = new Fake() as Fake & { querySelector: (selector: string) => Fake };
    section.querySelector = selector => els[selector.match(/"([^"]+)"/)![1]!]!;
    const calls: { signal: AbortSignal; resolve: (s: CubeSpectrum) => void; reject: () => void }[] = [];
    const read = vi.fn((_center: typeof a, options?: { signal?: AbortSignal }) => new Promise<CubeSpectrum>((resolve, reject) => {
        calls.push({ signal: options!.signal!, resolve, reject: () => reject(new Error('offline')) });
    }));
    const slot = mountSpectrum(section as unknown as HTMLElement, { enabled: true, read });
    return { section, els, doc, calls, read, slot };
}

describe('spectrum panel', () => {
    it('is off by default and adds no listener or read when disabled', () => {
        expect(DEFAULT_FEATURES.spectrum).toBe(false);
        expect(featuresFrom('spectrum').spectrum).toBe(true);
        const addEventListener = vi.fn();
        const section = { hidden: false, addEventListener };
        const read = vi.fn();
        const slot = mountSpectrum(section as unknown as HTMLElement, { enabled: false, read });
        slot.update(view());
        slot.press();
        expect(section.hidden).toBe(true);
        expect(addEventListener).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
    });

    it('reads on press once, renders result data, and redraws from cache', async () => {
        const h = rig();
        h.slot.update(view());
        expect(h.out().state).toBe('idle');
        expect(h.read).not.toHaveBeenCalled();
        h.slot.press(); h.slot.press();
        expect(h.read).toHaveBeenCalledTimes(1);
        expect(h.read).toHaveBeenCalledWith(a, { signal: expect.any(AbortSignal) });
        expect(h.out().state).toBe('reading');
        const spec = spectrum();
        h.calls[0]!.resolve(spec);
        await settle();
        const ready = h.out();
        expect(ready.state).toBe('ready');
        expect(ready.svg).toContain('data-mark-lambda');
        expect(ready.summary).toBe(spectrumChartText(spec).summary);
        expect(ready.caption).toBe(spec.caption);
        expect(ready.notes).toEqual(spec.notes);
        expect(ready.facts).toBe(`Spot: RA 12.3457°, Dec -4.5679° · ${CUBE_QUANTITY} · test unit`);
        expect(ready.read).toBe('Read 2.35 MB from ');
        expect(ready.url).toBe(spec.spot.url);
        expect(ready.reference).toBe(SPECTRUM_TEXT.reference);
        const old = ready.svg;
        h.slot.update(view(a, 3.5));
        expect(h.out().svg).not.toBe(old);
        const narrow = h.out().svg;
        h.slot.resize(740);
        expect(h.out().svg).not.toBe(narrow);
        expect(h.out().svg).toContain('viewBox="0 0 740 ');
        expect(h.read).toHaveBeenCalledTimes(1);
        h.slot.update({ ...view(a), available: false });
        expect(h.out().visible).toBe(false);
        h.slot.update(view(a, 3.5));
        expect(h.out().state).toBe('ready');
        h.slot.update(view(b));
        expect(h.out().state).toBe('idle');
        h.slot.update(view({ ...a }));
        expect(h.out().state).toBe('ready');
        expect(h.read).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(h.out())).not.toMatch(/detected|confirmed|discovery|proves/i);
    });

    it('aborts and drops stale replies; stop and demo do not report failure', async () => {
        const h = rig();
        h.slot.update(view()); h.slot.press(); h.slot.update(view(b));
        expect(h.calls[0]!.signal.aborted).toBe(true);
        h.calls[0]!.resolve(spectrum()); await settle();
        expect(h.out().state).toBe('idle');
        h.slot.press(); h.slot.stop();
        expect(h.calls[1]!.signal.aborted).toBe(true);
        expect(h.out().state).toBe('idle');
        h.slot.update(view(b, 1, 'demo'));
        expect(h.out().visible).toBe(false);
    });

    it('offers a retry after failure and uses changed result numbers', async () => {
        const h = rig(); h.slot.update(view(a, 1, 'snapshot')); h.slot.press();
        h.calls[0]!.reject(); await settle();
        expect(h.out().state).toBe('failed');
        h.slot.press();
        const spec = spectrum(); spec.bytesRead = 12000; spec.unit = 'other'; spec.notes = ['17 planes'];
        h.calls[1]!.resolve(spec); await settle();
        expect(h.out().read).toBe('Read 12 kB from ');
        expect(h.out().facts).toContain('other');
        expect(h.out().notes).toEqual(['17 planes']);
    });

    it('renders and controls the panel through its elements, preserving focus', async () => {
        const h = domRig();
        h.slot.update(view());
        expect(h.section.hidden).toBe(false);
        expect(h.els.intro!.textContent).toBe(SPECTRUM_TEXT.idle);
        expect(h.els.estimate!.textContent).toBe(SPECTRUM_TEXT.estimate);
        expect(h.read).not.toHaveBeenCalled();
        h.els.read!.focus(); h.els.read!.click(); h.els.read!.click();
        expect(h.doc.activeElement).toBe(h.els.heading);
        expect(h.els.read!.disabled).toBe(true);
        expect(h.els.status!.textContent).toBe(SPECTRUM_TEXT.reading);
        expect(h.calls).toHaveLength(1);
        h.els.stop!.focus();
        h.calls[0]!.resolve(spectrum()); await settle();
        expect(h.doc.activeElement).toBe(h.els.heading);
        expect(h.els.chart!.innerHTML).toContain('<svg');
        expect(h.els.summary!.textContent).toBe(spectrumChartText(spectrum()).summary);
        expect(h.els.caption!.textContent).toBe('test caption');
        expect(h.els.notes!.children[0]!.textContent).toBe('3 example planes');
        expect(h.els.facts!.textContent).toContain('12.3457');
        expect(h.els.readBytes!.textContent).toBe('Read 2.35 MB from ');
        expect(h.els.link!.href).toBe('https://example.test/cube');
        expect(h.els.link!.textContent).toBe('the cube tile');
        expect(page).toContain('target="_blank" rel="noopener"');
        h.els.clear!.focus(); h.els.clear!.click();
        expect(h.doc.activeElement).toBe(h.els.heading);
        expect(h.els.intro!.hidden).toBe(false);
        h.els.read!.click(); h.els.stop!.click();
        expect(h.calls[1]!.signal.aborted).toBe(true);
        expect(h.els.status!.textContent).toBe('');
        h.els.read!.click();
        h.calls[2]!.reject(); await settle();
        expect(h.els.status!.textContent).toBe(SPECTRUM_TEXT.failure);
        expect(h.els.read!.textContent).toBe(SPECTRUM_TEXT.retry);
        h.els.read!.click();
        h.els.link!.focus();
        h.calls[3]!.resolve(spectrum()); await settle();
        expect(h.doc.activeElement).toBe(h.els.link);
    });

    it('omits the reference explanation when no reference ticks are drawn', async () => {
        const h = rig(); h.slot.update(view()); h.slot.press();
        const spec = spectrum();
        spec.lambda = Float64Array.from([0.8, 0.9, 1]);
        h.calls[0]!.resolve(spec); await settle();
        expect(h.out().svg).not.toContain('data-feature-tick');
        expect(h.out().reference).toBe('');
    });

    it('keeps an in-flight read during a same-centre reload, and evicts the oldest of four', async () => {
        const h = rig();
        h.slot.update(view()); h.slot.press();
        h.slot.update({ ...view(), available: false });
        expect(h.calls[0]!.signal.aborted).toBe(false);
        h.calls[0]!.resolve(spectrum()); await settle();
        expect(h.out().visible).toBe(false);
        h.slot.update(view());
        expect(h.out().state).toBe('ready');
        for (let i = 1; i <= 4; i++) {
            h.slot.update(view({ ra: i, dec: 0 })); h.slot.press();
            h.calls[i]!.resolve(spectrum()); await settle();
        }
        h.slot.update(view());
        expect(h.out().state).toBe('idle');
        h.slot.press();
        expect(h.calls).toHaveLength(6);
    });
});
