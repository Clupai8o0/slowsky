import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_CREDIT, DIFF_KEY, layoutShareCard, pngWithText, releaseCredits, shareCardText } from '../src/lib/sharecard';
import { saveShareCard } from '../src/ui/share-view';
import { AVERAGED_VISIT_NOTE } from '../src/lib/stack';

const dr1 = 'SPHEREx DR1, NASA/IPAC Infrared Science Archive, doi:10.26131/IRSA678';
const input = { name: 'Barnard’s Star', position: { ra: 20, dec: 30 }, labelA: '9 Jul 2025 · 1 look', labelB: '10 Aug 2026 · 1 look', averaged: false, releases: [dr1],
    wavelength: 2.123, field: 0.1, rings: false, url: 'https://example.org/?x=1' };

describe('share card text', () => {
    it('names a release once when two of its collections are in the pair (spherex_dr1 and spherex_dr1_deep)', () => {
        const qr3 = 'SPHEREx QR3, NASA/IPAC Infrared Science Archive, doi:10.26131/IRSA662';
        expect(releaseCredits([dr1, dr1, qr3, dr1])).toEqual([dr1, qr3]);
        const text = shareCardText({ ...input, releases: [dr1, dr1, qr3] });
        expect(text.credits.filter(line => line === dr1)).toHaveLength(1);
        expect(text.credits.filter(line => line === qr3)).toHaveLength(1);
    });

    it('names the target and describes both visits and the credits', () => {
        const text = shareCardText(input);
        expect(text.title).toBe('Slowsky · Barnard’s Star');
        expect(text.labels).toEqual(['A · 9 Jul 2025 · 1 look', 'B · 10 Aug 2026 · 1 look', 'B − A · later minus earlier']);
        expect(text.details).toContain('2.12 µm');
        expect(text.details).toContain('0.1°');
        expect(DIFF_KEY).toContain('blue marks more light in the earlier visit (A), orange more in the later one (B)');
        expect(text.credits).toEqual([DIFF_KEY, dr1, AI_CREDIT, 'A difference between two visits is a candidate only, not a confirmed change.', input.url]);
        expect(text.credits.join(' ')).not.toContain('QR3');
    });
    it('prints coordinates for a typed position and credits Gaia only with rings', () => {
        const text = shareCardText({ ...input, name: '', rings: true });
        expect(text.title).toBe('Slowsky · 01h20m00.00s  +30°00′00.0″');
        expect(text.credits[2]).toBe('Gaia DR3, CC BY-NC 3.0 IGO');
        expect(shareCardText(input).credits.join(' ')).not.toContain('Gaia');
    });
    it('identifies simulated skies and explains averaged visits', () => {
        const text = shareCardText({ ...input, simulated: true, averaged: true, labelA: '9–10 Jul 2025 · 2 looks' });
        expect(text.details).toContain('Simulated sky');
        expect(text.credits).toContain('Simulated sky made by this page. Not NASA data.');
        expect(text.credits.join(' ')).not.toContain('doi:10.26131');
        expect(text.credits).toContain(AVERAGED_VISIT_NOTE);
        expect(text.labels[0]).toBe('A · 9–10 Jul 2025 · 2 looks');
        expect(shareCardText(input).credits).not.toContain(AVERAGED_VISIT_NOTE);
    });
});

describe('card layout', () => {
    it.each([320, 800, 1600, 2200])('fits non-overlapping rectangles at width %i', width => {
        const text = shareCardText(input);
        const layout = layoutShareCard(width, text.labels, [text.title, text.details, ...text.credits]);
        expect(layout.width).toBeLessThanOrEqual(Math.min(width, 1600));
        expect(layout.fontSize).toBeGreaterThanOrEqual(14);
        const rects = [layout.heading, ...layout.panels, ...layout.labels, layout.band];
        for (const [i, a] of rects.entries()) {
            expect(a.radius).toBe(0);
            expect(a.x).toBeGreaterThanOrEqual(0);
            expect(a.y).toBeGreaterThanOrEqual(0);
            expect(a.x + a.width).toBeLessThanOrEqual(layout.width);
            expect(a.y + a.height).toBeLessThanOrEqual(layout.height);
            for (const b of rects.slice(i + 1)) {
                expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
            }
        }
        expect(layout.panels.every(p => p.width === p.height && p.width === layout.panels[0]!.width)).toBe(true);
        expect(layout.band.height).toBeGreaterThanOrEqual(layout.bandLines.length * layout.lineHeight);
    });
});

// Independent, bit-by-bit CRC implementation.
function crc(bytes: Uint8Array): number
{
    let value = 0xffffffff;
    for (const byte of bytes) {
        value ^= byte;
        for (let i = 0; i < 8; i++) {
            value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
        }
    }
    return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array
{
    const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(out.length - 4, crc(out.subarray(4, out.length - 4)));
    return out;
}

function concat(...parts: Uint8Array[]): Uint8Array
{
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    return out;
}

describe('PNG metadata', () => {
    it('inserts UTF-8 iTXt with valid CRCs and preserves the original image chunks', () => {
        const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
        const ihdr = chunk('IHDR', new Uint8Array(13));
        const idat = chunk('IDAT', Uint8Array.from([1, 2, 3, 255, 0]));
        const rest = concat(idat, chunk('IEND', new Uint8Array()));
        const png = concat(signature, ihdr, rest);
        const entries = [{ key: 'Software', text: 'Slowsky' }, { key: 'Comment', text: 'B − A · 2 µm' }, { key: 'Source', text: input.url }];
        const out = pngWithText(png, entries);
        expect(out).not.toBe(png);
        let pos = signature.length + ihdr.length;
        for (const entry of entries) {
            const length = new DataView(out.buffer, out.byteOffset + pos, 4).getUint32(0);
            const payload = out.subarray(pos + 8, pos + 8 + length);
            expect(new TextDecoder().decode(out.subarray(pos + 4, pos + 8))).toBe('iTXt');
            expect(new DataView(out.buffer, out.byteOffset + pos + 8 + length, 4).getUint32(0)).toBe(crc(out.subarray(pos + 4, pos + 8 + length)));
            const end = payload.indexOf(0);
            expect(new TextDecoder().decode(payload.subarray(0, end))).toBe(entry.key);
            expect([...payload.subarray(end, end + 5)]).toEqual([0, 0, 0, 0, 0]);
            expect(new TextDecoder().decode(payload.subarray(end + 5))).toBe(entry.text);
            pos += length + 12;
        }
        expect(out.subarray(pos)).toEqual(rest);
        expect(out.subarray(0, signature.length + ihdr.length)).toEqual(png.subarray(0, signature.length + ihdr.length));
    });
    it('rejects non-PNG and truncated PNG data', () => {
        expect(() => pngWithText(new Uint8Array([1, 2, 3]), [])).toThrow();
        const headerOnly = concat(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(13)));
        expect(() => pngWithText(headerOnly, [])).toThrow();
    });
    it('rejects invalid keywords, NUL text, trailing data and a non-IHDR first chunk', () => {
        const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
        const png = concat(signature, chunk('IHDR', new Uint8Array(13)), chunk('IDAT', new Uint8Array([1])), chunk('IEND', new Uint8Array()));
        for (const key of [' Comment', 'Comment ', 'A  B']) {
            expect(() => pngWithText(png, [{ key, text: 'x' }])).toThrow();
        }
        expect(() => pngWithText(png, [{ key: 'Comment', text: 'x\0y' }])).toThrow();
        expect(() => pngWithText(concat(png, new Uint8Array([0])), [])).toThrow();
        expect(() => pngWithText(concat(signature, chunk('IHDX', new Uint8Array(13)), chunk('IDAT', new Uint8Array([1])), chunk('IEND', new Uint8Array())), [])).toThrow('Not a PNG');
    });
    it('handles a six-megabyte PNG promptly', () => {
        const png = concat(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(13)), chunk('IDAT', new Uint8Array(6_000_000)), chunk('IEND', new Uint8Array()));
        const start = performance.now();
        pngWithText(png, [{ key: 'Comment', text: 'x' }]);
        expect(performance.now() - start).toBeLessThan(5000);
    });
});

describe('saving a picture', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
    function setup(share?: (data: ShareData) => Promise<void>)
    {
        const clicks: string[] = [], drawn: number[] = [];
        const png = concat(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(13)), chunk('IDAT', new Uint8Array([1])), chunk('IEND', new Uint8Array()));
        const ctx = { fillRect() {}, fillText(_text: string, _x: number, _y: number, max: number) { drawn.push(max); }, clearRect() {}, putImageData() {}, drawImage() {},
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) };
        vi.stubGlobal('document', { createElement: (tag: string) => tag === 'canvas'
            ? { width: 0, height: 0, getContext: () => ctx, toBlob: (cb: (b: Blob) => void) => cb(new Blob([new Uint8Array(png)])) }
            : { href: '', download: '', click() { clicks.push(this.download); } } });
        const canShare = vi.fn((_data: ShareData) => true);
        vi.stubGlobal('navigator', share ? { canShare, share } : {});
        vi.stubGlobal('URL', class extends URL {
            static createObjectURL(): string { return 'blob:x'; }
            static revokeObjectURL(): void {}
        });
        const frame = { frame: { data: new Float32Array(16).fill(1) } };
        const view = { card: input, result: { grid: { width: 4, height: 4 }, frames: [frame, frame] } as never,
            a: { ks: [0], mjd: 60000, end: 60000, n: 1 }, b: { ks: [1], mjd: 60400, end: 60400, n: 1 },
            stretch: { lo: 0, hi: 2, kind: 'linear' as const }, filename: 'x.png' };
        return { clicks, drawn, canShare, view };
    }
    it('downloads when sharing is unsupported and constrains every text line', async () => {
        const { clicks, drawn, view } = setup();
        const toast = vi.fn();
        await saveShareCard(view, toast);
        expect(clicks).toEqual(['x.png']);
        expect(drawn.length).toBeGreaterThan(0);
        expect(drawn.every(width => Number.isFinite(width) && width > 0)).toBe(true);
        expect(toast).not.toHaveBeenCalled();
    });
    it('checks and shares the same payload, including simulated metadata', async () => {
        const share = vi.fn(async (_data: ShareData) => {});
        const { canShare, view } = setup(share);
        await saveShareCard({ ...view, card: { ...input, simulated: true } }, vi.fn());
        expect(share).toHaveBeenCalledOnce();
        expect(share.mock.calls[0]![0]).toEqual(canShare.mock.calls[0]![0]);
        const payload = share.mock.calls[0]![0];
        expect(Object.keys(payload).sort()).toEqual(['files', 'title']);
        const bytes = new Uint8Array(await payload.files![0]!.arrayBuffer());
        const metadata = new TextDecoder().decode(bytes);
        expect(metadata).toContain('Simulated sky made by this page. Not NASA data.');
        expect(metadata).not.toContain('doi:10.26131');
    });
    it('does nothing when sharing is cancelled', async () => {
        const { clicks, view } = setup(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
        const toast = vi.fn();
        await saveShareCard(view, toast);
        expect(clicks).toEqual([]);
        expect(toast).not.toHaveBeenCalled();
    });
    it('downloads after another share failure, reporting only a download failure', async () => {
        const { clicks, view } = setup(() => Promise.reject(new DOMException('no activation', 'NotAllowedError')));
        const toast = vi.fn();
        await saveShareCard(view, toast);
        expect(clicks).toEqual(['x.png']);
        expect(toast).not.toHaveBeenCalled();
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('download failed'); });
        await saveShareCard(view, toast);
        expect(toast).toHaveBeenCalledOnce();
    });
});
