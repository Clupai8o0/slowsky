import { withCaveats, type PanelCandidate } from './changes-view';
import type { PixelCoord, RangeReader, RegriddedFrame } from '../lib/types';
import { gridPixToSky } from '../lib/regrid';
import { readFlags } from '../lib/flags';

export const DROP_FLAGS = ['TRANSIENT', 'OUTLIER', 'NONFUNC', 'SUR_ERROR'] as const;
export const CORE_FLAG = 'OVERFLOW';
export type ScreenedCandidate = PanelCandidate & { line: string };
export interface FrameFlags { obsId: string; names: (pix: PixelCoord) => string[] | null; }

export function nativePeak(frame: RegriddedFrame, image: Float32Array, zodi: Float32Array, pix: PixelCoord): PixelCoord | null
{
    const context = frame.context;
    if (!context) {
        return null;
    }
    const g = frame.grid;
    const r = 12 / g.pixelArcsec;
    let best = -Infinity;
    let peak: PixelCoord | null = null;
    for (let y = Math.max(0, Math.ceil(pix.y - r)); y <= Math.min(g.height - 1, Math.floor(pix.y + r)); y++) {
        for (let x = Math.max(0, Math.ceil(pix.x - r)); x <= Math.min(g.width - 1, Math.floor(pix.x + r)); x++) {
            const value = frame.data[y * g.width + x]!;
            if (Math.hypot(x - pix.x, y - pix.y) <= r && Number.isFinite(value) && value > best) {
                best = value;
                peak = { x, y };
            }
        }
    }
    if (!peak) {
        return null;
    }
    const step = Math.max(1, Math.min(8, Math.floor(8 * 6.15 / g.pixelArcsec)));
    const x0 = Math.floor(peak.x / step) * step;
    const y0 = Math.floor(peak.y / step) * step;
    const x1 = Math.min(x0 + step, g.width - 1);
    const y1 = Math.min(y0 + step, g.height - 1);
    const tx = x1 > x0 ? (peak.x - x0) / (x1 - x0) : 0;
    const ty = y1 > y0 ? (peak.y - y0) / (y1 - y0) : 0;
    const lattice = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }]
        .map(p => context.wcs.skyToPix(gridPixToSky(g, p)));
    const mix = (key: 'x' | 'y') => (1 - ty) * ((1 - tx) * lattice[0]![key] + tx * lattice[1]![key])
        + ty * ((1 - tx) * lattice[2]![key] + tx * lattice[3]![key]);
    const dx = mix('x');
    const dy = mix('y');
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        return null;
    }
    const box = context.box;
    best = -Infinity;
    let native: PixelCoord | null = null;
    for (let y = Math.floor(dy); y <= Math.floor(dy) + 1; y++) {
        for (let x = Math.floor(dx); x <= Math.floor(dx) + 1; x++) {
            if (x < box.x0 || x >= box.x1 || y < box.y0 || y >= box.y1) {
                continue;
            }
            const n = (y - box.y0) * (box.x1 - box.x0) + x - box.x0;
            const value = image[n]! - zodi[n]!;
            // A pixel with no finite value (NONFUNC pixels are often blank) cannot be the brightest, so it is
            // never the one read; such pixels add no light to the picture either.
            if (Number.isFinite(value) && value > best) {
                best = value;
                native = { x, y };
            }
        }
    }
    return native;
}

export async function readFrameFlags(frame: RegriddedFrame, deps: { reader: RangeReader; readFlags: typeof readFlags; fetcher?: typeof fetch; signal: AbortSignal }): Promise<FrameFlags | null>
{
    const context = frame.context;
    if (!context?.flags) {
        return null;
    }
    try {
        const index = await deps.reader.index(context.url, deps.signal);
        const [image, zodi, flags] = await Promise.all([
            deps.reader.readFloat32(index, 'IMAGE', context.box, deps.signal),
            deps.reader.readFloat32(index, 'ZODI', context.box, deps.signal),
            deps.readFlags(context.url, context.flags.layout, context.box, { signal: deps.signal, fetcher: deps.fetcher }),
        ]);
        const width = context.box.x1 - context.box.x0;
        const height = context.box.y1 - context.box.y0;
        if (image.length !== width * height || zodi.length !== width * height || flags.width !== width || flags.height !== height || flags.data.length !== width * height) {
            return null;
        }
        const header = context.flags.names;
        return { obsId: frame.frame.obsId, names(pix) {
            let peak: PixelCoord | null;
            try {
                peak = nativePeak(frame, image, zodi, pix);
            } catch {
                return null;
            }
            if (!peak) {
                return null;
            }
            const n = (peak.y - context.box.y0) * width + peak.x - context.box.x0;
            return header.filter(item => (flags.data[n]! & (1 << item.bit)) !== 0).map(item => item.name);
        } };
    } catch {
        return null;
    }
}

export function screen(candidates: PanelCandidate[], visits: { earlier: RegriddedFrame[]; later: RegriddedFrame[] }, frameFlags: Map<string, FrameFlags | null>, order: string[], saved = false): { kept: ScreenedCandidate[]; dropNote?: string; allUnread: boolean; lead: string[] }
{
    const dropped = new Set<string>();
    let count = 0;
    const kept: (ScreenedCandidate & { unread: 'none' | 'some' | 'all' })[] = [];
    for (const c of candidates) {
        const found = (frames: RegriddedFrame[]) => frames.map(f => frameFlags.get(f.frame.obsId)?.names(c.pix) ?? null);
        const early = found(visits.earlier);
        const late = found(visits.later);
        const light = (c.lightVisit ?? (c.sign === 1 ? 'later' : 'earlier')) === 'later' ? late : early;
        const bad = light.flatMap(names => names?.filter(n => (DROP_FLAGS as readonly string[]).includes(n)) ?? []);
        if (bad.length) {
            count++;
            bad.forEach(n => dropped.add(n));
            continue;
        }
        // A mover's light is in one visit only, so only that visit's frames speak for it.
        const mover = c.kind === 'mover';
        const lightIsLater = light === late;
        const e = (!mover || !lightIsLater) && early.some(n => n?.includes(CORE_FLAG));
        const l = (!mover || lightIsLater) && late.some(n => n?.includes(CORE_FLAG));
        const said = c.sentence ?? c.reason;
        let line = said;
        if (e || l) {
            const where = e && l ? 'at least one frame of each visit'
                : `at least one frame of the ${e ? 'earlier' : 'later'} visit`;
            const flagged = `The archive flags the brightest pixel within 12″ as OVERFLOW in ${where}`;
            if (!mover && /\b(brighter|fainter|appeared)\b/i.test(said)) {
                // Keep the finder's own S/N (as it wrote it); drop only the direction it read.
                const snr = /S\/N (?:> 50|\d+(?:\.\d+)?)/.exec(said)?.[0];
                line = `A difference between the visits${c.gaiaMatch ? ' at a catalogue star' : ''}${snr ? `, at ${snr}` : ''} (candidate). ${flagged}, so the brightness comparison is not shown.`;
            } else {
                line = `${line} ${flagged}.`;
            }
        }
        // When no frame of the visit with the light was read, the drop check never ran: that counts as unread
        // in full, even if the other visit read fine (or the visit has no frames here at all).
        const needed = mover ? light : [...early, ...late];
        const lightRead = light.some(n => n !== null);
        const missing = needed.filter(n => n === null).length;
        kept.push({ ...c, line, unread: !lightRead ? 'all' : missing === 0 ? 'none' : 'some' });
    }
    const allUnread = kept.length > 0 && kept.every(c => c.unread === 'all');
    const lead: string[] = [];
    if (allUnread) {
        lead.push(saved ? 'Archive flags are not checked in a saved view, so these spots are listed without that check.'
            : 'The archive flags could not be read for the listed spots, so they are listed without that check.');
    }
    for (const c of kept) {
        if (!allUnread && c.unread === 'all') {
            c.line += ' The archive flags for this spot could not be read, so it is listed without that check.';
        } else if (!allUnread && c.unread === 'some') {
            c.line += ' Some of the archive flags for this spot could not be read, so that check is incomplete.';
        }
    }
    lead.push(...withCaveats(kept));
    const names = [...new Set([...order, ...dropped])].filter(n => dropped.has(n)).join(', ');
    const dropNote = count === 0 ? undefined : count === 1
        ? `1 spot is not listed: in at least one frame of the visit with more light, the brightest pixel within 12″ of it carries an archive flag (${names}).`
        : `${count} spots are not listed: in at least one frame of the visit with more light, the brightest pixel within 12″ of each carries an archive flag (${names}).`;
    return { kept, dropNote, allUnread, lead };
}
