import { describe, expect, it } from 'vitest';
import { AI_CREDIT, DATA_CREDIT, DIFF_KEY, layoutShareCard, pngWithText, shareCardText } from '../src/lib/sharecard';

const input = { name: 'Barnard’s Star', position: { ra: 20, dec: 30 }, dateA: '9 Jul 2025', dateB: '10 Aug 2026',
    wavelength: 2.123, field: 0.1, rings: false, url: 'https://example.org/?x=1' };

describe('share card text', () => {
    it('names the target and describes both visits and the credits', () => {
        const text = shareCardText(input);
        expect(text.title).toBe('Slowsky · Barnard’s Star');
        expect(text.labels).toEqual(['A · 9 Jul 2025', 'B · 10 Aug 2026', 'B − A · 10 Aug 2026 − 9 Jul 2025']);
        expect(text.details).toContain('2.12 µm');
        expect(text.details).toContain('0.1°');
        expect(DIFF_KEY).toContain('blue marks more light in the earlier visit (A), orange more in the later one (B)');
        expect(text.credits).toEqual([DIFF_KEY, DATA_CREDIT, AI_CREDIT, 'A difference between two visits is a candidate only, not a confirmed change.', input.url]);
    });
    it('prints coordinates for a typed position and credits Gaia only with rings', () => {
        const text = shareCardText({ ...input, name: '', rings: true });
        expect(text.title).toBe('Slowsky · 01h20m00.00s  +30°00′00.0″');
        expect(text.credits[2]).toBe('Gaia DR3, CC BY-NC 3.0 IGO');
        expect(shareCardText(input).credits.join(' ')).not.toContain('Gaia');
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
});
