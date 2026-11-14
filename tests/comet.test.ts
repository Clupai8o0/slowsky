// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { readFileSync as nodeRead } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    BLANK_RGB, CO2_BAND_UM, COMET_BANNED, COMET_TITLE, COMET_URL, CometDataError, cometCaption, cometPoints, cutoutRgba, frameLabel, parseComet,
    nearCo2, sharedScale,
} from '../src/lib/comet';
import { COMET_FAILED, cometBodyHtml, cometChartSvg, cometTableHtml, mountComet } from '../src/ui/comet-view';
import { DEFAULT_FEATURES, featuresFrom } from '../src/ui/slots';

const readFileSync = nodeRead as { (path: URL, encoding: 'utf8'): string; (path: URL): Uint8Array };

const BAKED = JSON.parse(readFileSync(new URL('../public/comet/3i-atlas.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const clone = () => JSON.parse(JSON.stringify(BAKED)) as { frames: Record<string, unknown>[] } & Record<string, unknown>;

function tiny(over: Partial<Record<string, unknown>> = {}, frames?: Record<string, unknown>[])
{
    const frame = (w: number, core: number, i: number) => ({
        obsId: `X_${i}D5`, start: `2025-12-14T04:2${i}:00.000Z`, mjdStart: 61023.18 + i / 1440, wavelength: w, ra: 167, dec: 5,
        pixel: { x: 10, y: 10 }, key: `dr1/level2/x/${i}.fits`, coreMean: core, borderMedian: 0.5, cutout: Array(25).fill(1),
    });
    return {
        object: '3I/ATLAS', detector: 5, size: 5, units: 'MJy/sr', mostQuery: 'q', madeBy: 'm', madeAt: 't', note: 'n',
        frames: frames ?? [frame(4.25, 40, 1), frame(3.96, 0.9, 0), frame(4.36, 1.5, 2)], ...over,
    };
}

describe('comet: baked file', () => {
    it('parses, every key is a DR1 path, and wavelengths span the CO2 band', () => {
        const doc = parseComet(BAKED);
        expect(doc.frames).toHaveLength(12);
        for (const f of (BAKED.frames as { key: string }[])) {
            expect(f.key.startsWith('dr1/')).toBe(true);
            expect(f.key).not.toMatch(/qr2/i);
        }
        const w = doc.frames.map(f => f.wavelength);
        expect(Math.min(...w)).toBeLessThan(CO2_BAND_UM[0]);
        expect(Math.max(...w)).toBeGreaterThan(CO2_BAND_UM[1]);
        expect(doc.frames.every(f => f.cutout.length === doc.size * doc.size)).toBe(true);
        expect(readFileSync(new URL('../public/comet/3i-atlas.json', import.meta.url)).length).toBeLessThan(400_000);
        expect(String(BAKED.note)).toMatch(/AI-written code/);
    });

    it('the core is far brighter near 4.25 µm than at 3.96 to 4.18 µm', () => {
        const pts = cometPoints(parseComet(BAKED));
        const top = pts.reduce((a, p) => (p.value > a.value ? p : a));
        expect(top.wavelength).toBeGreaterThan(4.22);
        expect(top.wavelength).toBeLessThan(4.29);
        const blue = pts.filter(p => p.wavelength < 4.19);
        expect(blue.length).toBeGreaterThanOrEqual(6);
        expect(Math.max(...blue.map(p => p.value))).toBeLessThan(top.value / 10);
    });
});

describe('comet: parser', () => {
    it('sorts frames by wavelength', () => {
        expect(parseComet(tiny()).frames.map(f => f.wavelength)).toEqual([3.96, 4.25, 4.36]);
    });

    it('rejects a key that is not a DR1 path', () => {
        const d = clone();
        d.frames[3]!.key = 'qr2/level2/x.fits';
        expect(() => parseComet(d)).toThrow(CometDataError);
        const e = tiny();
        (e.frames[0] as Record<string, unknown>).key = 'data/spherex/dr1/x.fits';
        expect(() => parseComet(e)).toThrow(/DR1/);
    });

    it('rejects repeated wavelengths, wrong sizes, bad values, bad units', () => {
        const rep = tiny();
        (rep.frames[1] as Record<string, unknown>).wavelength = 4.25;
        expect(() => parseComet(rep)).toThrow(/share a wavelength/);
        const short = tiny();
        (short.frames[0] as Record<string, unknown>).cutout = Array(24).fill(1);
        expect(() => parseComet(short)).toThrow(/wrong size/);
        const nan = tiny();
        (nan.frames[0] as Record<string, unknown>).cutout = [...Array(24).fill(1), 'x'];
        expect(() => parseComet(nan)).toThrow(/bad value/);
        expect(() => parseComet(tiny({ units: 'Jy' }))).toThrow(/units/);
        expect(() => parseComet(tiny({ size: 4 }))).toThrow(/size/);
        expect(() => parseComet(null)).toThrow(CometDataError);
        const time = tiny();
        (time.frames[0] as Record<string, unknown>).start = '2025-12-14 04:26:00';
        expect(() => parseComet(time)).toThrow(/ISO/);
    });

    it('names carbon dioxide only when the brightest frame is on the reported band', () => {
        expect(nearCo2(4.2473)).toBe(true);
        expect(nearCo2(4.2116)).toBe(false);
        expect(nearCo2(4.3211)).toBe(false);
        const moved = JSON.parse(JSON.stringify(BAKED)) as { frames: { wavelength: number; coreMean: number }[] };
        const first = moved.frames.reduce((a, f) => (f.wavelength < a.wavelength ? f : a));
        first.coreMean = 500; // as if a star sat on the predicted spot at 3.96 µm
        const lines = cometCaption(parseComet(moved));
        expect(lines[4]).toMatch(/brightest at 3\.96 µm/);
        expect(lines[4]).not.toMatch(/carbon dioxide/);
        expect(cometCaption(parseComet(BAKED))[4]).toMatch(/brightest at 4\.25 µm.*reports carbon dioxide gas glowing at 4\.25 to 4\.27 µm/);
    });

    it('rounds a visit’s span up, never down', () => {
        const text = cometCaption(parseComet(BAKED))[1]!;
        const starts = (BAKED.frames as { start: string; wavelength: number }[]).filter(f => f.wavelength > 4.24).map(f => Date.parse(f.start));
        const span = (Math.max(...starts) - Math.min(...starts)) / 60000;
        expect(span).toBeGreaterThan(6);
        expect(span).toBeLessThan(7);
        expect(text).toContain('started within 7 minutes');
    });

    it('refuses a file with a blank pixel in a 3×3 core', () => {
        const d = tiny();
        const cut = Array(25).fill(1);
        cut[2 * 5 + 3] = null; // centre row, one right of centre
        (d.frames[0] as Record<string, unknown>).cutout = cut;
        expect(() => parseComet(d)).toThrow(/blank pixel in its 3×3 core/);
    });

    it('keeps nulls in the cut-out and draws them in their own colour', () => {
        const d = tiny();
        const cut = Array(25).fill(1);
        cut[0] = null; // row 0 (lowest y), column 0 -> bottom-left on screen
        (d.frames[0] as Record<string, unknown>).cutout = cut;
        const doc = parseComet(d);
        const f = doc.frames.find(x => x.obsId === 'X_1D5')!;
        const px = cutoutRgba(f, 5, { lo: 0, hi: 2 });
        const bottomLeft = (4 * 5 + 0) * 4;
        expect([...px.slice(bottomLeft, bottomLeft + 4)]).toEqual([...BLANK_RGB, 255]);
        expect(px[3]).toBe(255);
        expect(px[0]).toBe(128);
    });
});

describe('comet: labels, chart, caption', () => {
    const doc = parseComet(BAKED);

    it('labels each frame with its wavelength and start time', () => {
        const lab = frameLabel(doc.frames[0]!);
        expect(lab.wave).toBe('3.96 µm');
        expect(lab.time).toBe('04:26 UTC');
        expect(lab.aria).toContain('2025-12-14');
    });

    it('chart points are core minus border, with the plain values kept', () => {
        for (const p of cometPoints(doc)) {
            expect(p.value).toBeCloseTo(p.core - p.border, 10);
        }
    });

    it('one shared scale from the darkest border to the brightest core', () => {
        const s = sharedScale(doc);
        expect(s.lo).toBe(Math.min(...doc.frames.map(f => f.borderMedian)));
        expect(s.hi).toBe(Math.max(...doc.frames.map(f => f.coreMean)));
    });

    it('caption says colour not time, 3x3 mean not calibrated, shared scale, and who reported the coma', () => {
        const text = cometCaption(doc).join(' ');
        expect(text).toMatch(/mixes colour and time/);
        expect(text).toMatch(/4\.25 to 4\.36 µm started within 7 minutes/);
        expect(text).toMatch(/39\.2 MJy\/sr at 4\.25 µm and 1\.03 at 4\.36 µm/);
        expect(text).toMatch(/there most of the change is colour, not time/);
        expect(text).toMatch(/border still holds some of the comet’s own glow/);
        expect(text).toMatch(/drawn dark red/);
        expect(text).toMatch(/not turned north up/);
        expect(text).toMatch(/does not separate gas light from dust light/);
        expect(text).toMatch(/adds nothing new/);
        expect(COMET_TITLE).toBe('Comet 3I/ATLAS across the CO₂ band');
        expect(text).toMatch(/3×3 pixels/);
        expect(text).toMatch(/not a calibrated measurement/);
        expect(text).toMatch(/one linear brightness scale/);
        expect(text).toMatch(/Lisse et al\. 2025 and 2026/);
        expect(text).toMatch(/14 December 2025/);
    });

    it('no banned words anywhere the card shows', () => {
        const html = cometBodyHtml(doc) + COMET_TITLE + COMET_FAILED;
        const visible = html.replace(/<[^>]+>/g, ' ');
        expect(visible).not.toMatch(COMET_BANNED);
        expect(cometCaption(doc).join(' ')).not.toMatch(COMET_BANNED);
        expect('Discovery').toMatch(COMET_BANNED);
        expect('detected').toMatch(COMET_BANNED);
    });

    it('a flat chart (core equals border everywhere) draws no NaN', () => {
        const d = tiny();
        for (const f of d.frames as Record<string, unknown>[]) {
            f.coreMean = 0.5;
        }
        expect(cometChartSvg(parseComet(d))).not.toMatch(/NaN|Infinity/);
    });

    it('chart has labelled axes and a text alternative; table has twelve rows', () => {
        const svg = cometChartSvg(doc);
        expect(svg).toContain('Wavelength (µm)');
        expect(svg).toContain('MJy/sr');
        expect(svg).toMatch(/<title id="sk-cm-ct">/);
        expect(svg).toMatch(/<desc id="sk-cm-cd">[^<]*4\.25 µm/);
        expect(svg).not.toMatch(/NaN|undefined/);
        expect((cometTableHtml(doc).match(/<tr>/g) ?? []).length).toBe(13);
        expect((cometBodyHtml(doc).match(/<canvas /g) ?? []).length).toBe(12);
    });
});

describe('comet: the switch', () => {
    it('is off by default; a preview build can switch it on', () => {
        expect(DEFAULT_FEATURES.comet).toBe(false);
        expect(featuresFrom('comet').comet).toBe(true);
    });

    it('off: adds nothing and fetches nothing', async () => {
        const insert = vi.fn();
        const fetcher = vi.fn();
        const globalFetch = vi.spyOn(globalThis, 'fetch');
        const after = { parentElement: {}, insertAdjacentElement: insert, ownerDocument: { createElement: vi.fn() } } as unknown as HTMLElement;
        const slot = mountComet(after, { enabled: false, fetch: fetcher });
        await slot.ready;
        expect(slot.section).toBeNull();
        expect(insert).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled();
        expect(globalFetch).not.toHaveBeenCalled();
        globalFetch.mockRestore();
    });

    it('off: the page shell is unchanged (no comet markup in it)', () => {
        const app = readFileSync(new URL('../src/ui/app.ts', import.meta.url), 'utf8');
        const shell = app.slice(app.indexOf('function shell(): string'), app.indexOf('export function mount('));
        expect(shell.length).toBeGreaterThan(1000);
        expect(shell).not.toMatch(/comet|sk-cm/i);
        expect(app).toContain("mountComet(root.querySelector<HTMLElement>('.sk-m-about'), { enabled: FEATURES.comet });");
    });

    it('on: puts the card after the section it is given and fetches the file once', async () => {
        const body = { innerHTML: '' };
        const section = { className: '', innerHTML: '', setAttribute: vi.fn(), querySelector: () => body, querySelectorAll: () => [] };
        const insert = vi.fn();
        const after = { parentElement: {}, insertAdjacentElement: insert, ownerDocument: { createElement: () => section, defaultView: null } } as unknown as HTMLElement;
        const fetcher = vi.fn(async () => ({ ok: true, json: async () => BAKED }));
        const slot = mountComet(after, { enabled: true, fetch: fetcher, paint: vi.fn() });
        await slot.ready;
        expect(insert).toHaveBeenCalledWith('afterend', section);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith(COMET_URL);
        expect(body.innerHTML).toContain('sk-cm-row');
        expect(section.innerHTML).toContain(COMET_TITLE);
    });

    it('on: a bad file shows a plain failure line, not a picture', async () => {
        const body = { innerHTML: '' };
        const section = { className: '', innerHTML: '', setAttribute: vi.fn(), querySelector: () => body, querySelectorAll: () => [] };
        const after = { parentElement: {}, insertAdjacentElement: vi.fn(), ownerDocument: { createElement: () => section, defaultView: null } } as unknown as HTMLElement;
        const slot = mountComet(after, { enabled: true, fetch: async () => ({ ok: true, json: async () => ({ ...BAKED, units: 'Jy' }) }) });
        await slot.ready;
        expect(body.innerHTML).toContain(COMET_FAILED);
    });
});
