import { formatDec, formatRa } from './coords';
import { AVERAGED_VISIT_NOTE } from '../ui/subtract';

export const AI_CREDIT = 'Made with AI-written code (Claude, Codex, Gemini)';
export const SIMULATED_CREDIT = 'Simulated sky made by this page. Not NASA data.';

// The same words as the page's own Subtract hint (subtractText), so the picture explains its colours by itself.
export const DIFF_KEY = 'B − A: blue marks more light in the earlier visit (A), orange more in the later one (B). Black means about the same, or a pixel blank in either visit.';

export interface ShareCardInput {
    name: string;
    position: { ra: number; dec: number };
    labelA: string;
    labelB: string;
    averaged: boolean;
    releases: string[];
    wavelength: number;
    field: number;
    rings: boolean;
    url: string;
    simulated?: boolean;
}

export function shareCardText(input: ShareCardInput)
{
    return {
        title: `Slowsky · ${input.name || `${formatRa(input.position.ra)}  ${formatDec(input.position.dec)}`}`,
        labels: [`A · ${input.labelA}`, `B · ${input.labelB}`, 'B − A · later minus earlier'],
        details: `${input.simulated ? 'Simulated sky · ' : ''}${input.wavelength.toFixed(2)} µm · Field ${Number(input.field.toFixed(3))}°`,
        credits: [DIFF_KEY, ...(input.averaged ? [AVERAGED_VISIT_NOTE] : []),
            ...(input.simulated ? [SIMULATED_CREDIT] : input.releases), ...(input.rings ? ['Gaia DR3, CC BY-NC 3.0 IGO'] : []), AI_CREDIT,
            'A difference between two visits is a candidate only, not a confirmed change.', input.url],
    };
}

export interface CardRect { x: number; y: number; width: number; height: number; radius: 0 }

// Fixed-width text and conservative character widths let layout stay independent of canvas.
function wrap(text: string, width: number): string[]
{
    const limit = Math.max(1, Math.floor(width / 9));
    const out: string[] = [];
    for (const paragraph of text.split('\n')) {
        let rest = paragraph;
        while (rest.length > limit) {
            const space = rest.lastIndexOf(' ', limit);
            const end = space > 0 ? space : limit;
            out.push(rest.slice(0, end));
            rest = rest.slice(end).trimStart();
        }
        out.push(rest);
    }
    return out;
}

export function layoutShareCard(width: number, panels: string[], lines: string[])
{
    if (!Number.isFinite(width) || width < 120 || panels.length !== 3 || lines.length < 2) {
        throw new Error('Invalid share card layout');
    }
    const w = Math.min(1600, Math.floor(width));
    const margin = 16, gap = 8, fontSize = 14, lineHeight = 20;
    const size = Math.floor((w - margin * 2 - gap * 2) / 3);
    const headingLines = lines.slice(0, 2).flatMap(line => wrap(line, w - margin * 2));
    const labelLines = panels.map(label => wrap(label, size));
    const bandLines = lines.slice(2).flatMap(line => wrap(line, w - margin * 2));
    const rect = (x: number, y: number, rw: number, height: number): CardRect => ({ x, y, width: rw, height, radius: 0 });
    const heading = rect(margin, margin, w - margin * 2, headingLines.length * lineHeight);
    const labelY = heading.y + heading.height + 12;
    const labelHeight = Math.max(...labelLines.map(label => label.length)) * lineHeight;
    const labels = labelLines.map((_, i) => rect(margin + i * (size + gap), labelY, size, labelHeight));
    const panelY = labelY + labelHeight + 8;
    const panelRects = panels.map((_, i) => rect(margin + i * (size + gap), panelY, size, size));
    const band = rect(margin, panelY + size + 16, w - margin * 2, bandLines.length * lineHeight);
    return { width: w, height: band.y + band.height + margin, fontSize, lineHeight, heading, headingLines,
        labels, labelLines, panels: panelRects, band, bandLines };
}

function crc32(bytes: Uint8Array): number
{
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export function pngWithText(png: Uint8Array, entries: { key: string; text: string }[]): Uint8Array
{
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (png.length < 33 || !signature.every((v, i) => png[i] === v)
        || new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(8) !== 13
        || String.fromCharCode(...png.subarray(12, 16)) !== 'IHDR') {
        throw new Error('Not a PNG');
    }
    const original = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let pos = 8, hasData = false, hasEnd = false;
    while (pos + 12 <= png.length) {
        const length = original.getUint32(pos);
        const end = pos + 12 + length;
        if (end > png.length || original.getUint32(end - 4) !== crc32(png.subarray(pos + 4, end - 4))) {
            throw new Error('Not a PNG');
        }
        const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
        hasData ||= type === 'IDAT';
        if (type === 'IEND') {
            hasEnd = length === 0 && end === png.length;
            break;
        }
        pos = end;
    }
    if (!hasData || !hasEnd) {
        throw new Error('Not a PNG');
    }
    const encoder = new TextEncoder();
    const chunks = entries.map(({ key, text }) => {
        if (!/^[\x20-\x7e]{1,79}$/.test(key) || key.startsWith(' ') || key.endsWith(' ') || key.includes('  ')) {
            throw new Error('Invalid PNG keyword');
        }
        if (text.includes('\0')) {
            throw new Error('Invalid PNG text');
        }
        const keyword = encoder.encode(key), value = encoder.encode(text);
        const data = new Uint8Array(keyword.length + 5 + value.length);
        data.set(keyword);
        data.set(value, keyword.length + 5);
        const chunk = new Uint8Array(data.length + 12), view = new DataView(chunk.buffer);
        view.setUint32(0, data.length);
        chunk.set(encoder.encode('iTXt'), 4);
        chunk.set(data, 8);
        view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
        return chunk;
    });
    const out = new Uint8Array(png.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    out.set(png.subarray(0, 33));
    let offset = 33;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    out.set(png.subarray(33), offset);
    return out;
}
