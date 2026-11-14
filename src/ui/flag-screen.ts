import { withCaveats, type CandidateEnd, type PanelCandidate, type Reading } from './changes-view';
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

// Every lobe of a candidate with the visit it carries light in: the finder's `ends` (round 11), else a mover's
// `lightEnds`, else the one spot in the visit with more light.
export function endsOf(c: PanelCandidate): CandidateEnd[]
{
    if (c.ends?.length) {
        return c.ends;
    }
    if (c.lightEnds?.length) {
        return c.lightEnds;
    }
    return [{ visit: c.lightVisit ?? (c.sign === 1 ? 'later' : 'earlier'), x: c.x ?? c.pix.x, y: c.y ?? c.pix.y }];
}

// Readings that compare the light of the two visits at one place; OVERFLOW there withdraws them.
const COMPARES: readonly Reading[] = ['brighter', 'fainter', 'laterOnly', 'earlierOnly'];

function snrText(snr: number): string
{
    // The finder's own format (src/lib/changes.ts snrText); nothing when it is not a number.
    return !Number.isFinite(snr) ? '' : snr > 50 ? 'S/N > 50' : `S/N ${snr.toFixed(1)}`;
}

export function screen(candidates: PanelCandidate[], visits: { earlier: RegriddedFrame[]; later: RegriddedFrame[] }, frameFlags: Map<string, FrameFlags | null>, order: string[], saved = false): { kept: ScreenedCandidate[]; dropNote?: string; allUnread: boolean; lead: string[] }
{
    const dropped = new Set<string>();
    let count = 0;
    const kept: (ScreenedCandidate & { unread: 'none' | 'some' | 'all' })[] = [];
    const read = (frames: RegriddedFrame[], at: PixelCoord) => frames.map(f => frameFlags.get(f.frame.obsId)?.names(at) ?? null);
    for (const c of candidates) {
        const ends = endsOf(c);
        // Each end in the visit it carries light in: a DROP flag at any end drops the candidate (both ends of a pair go).
        const own = ends.map(end => ({ end, names: read(visits[end.visit], { x: end.x, y: end.y }) }));
        const bad = own.flatMap(o => o.names.flatMap(names => names?.filter(n => (DROP_FLAGS as readonly string[]).includes(n)) ?? []));
        if (bad.length) {
            count++;
            bad.forEach(n => dropped.add(n));
            continue;
        }
        // OVERFLOW at any end in its own visit. A single spot is a comparison of one place across both visits, so
        // the other visit at that place counts too; a pair's or mover's other end is that comparison already.
        const other = ends.length === 1 && c.kind !== 'mover'
            ? [{ end: { ...ends[0]!, visit: ends[0]!.visit === 'later' ? 'earlier' as const : 'later' as const }, names: read(
                visits[ends[0]!.visit === 'later' ? 'earlier' : 'later'], { x: ends[0]!.x, y: ends[0]!.y }) }]
            : [];
        const checked = [...own, ...other];
        const over = new Set(checked.filter(o => o.names.some(n => n?.includes(CORE_FLAG))).map(o => o.end.visit));
        const said = c.sentence ?? c.reason;
        let line = said;
        let kind = c.kind;
        if (over.size) {
            const where = over.size === 2 ? 'at least one frame of each visit'
                : `at least one frame of the ${over.has('earlier') ? 'earlier' : 'later'} visit`;
            // Each frame has its own brightest pixel. A pair's or mover's ends sit in different visits, so each
            // visit is named with its own spot; two ends in one visit are not told apart.
            const split = ends.length > 1 && new Set(ends.map(end => end.visit)).size === ends.length;
            const pixel = ends.length === 1 ? 'that frame’s brightest pixel within 12″ of the spot'
                : split ? 'that frame’s brightest pixel within 12″ of its spot in that visit'
                    : 'that frame’s brightest pixel within 12″ of at least one of its spots';
            const flagged = `In ${where}, the archive flags ${pixel} as OVERFLOW`;
            // Without the finder's `reading` (before round 11) every non-mover line is withdrawn: hiding a sound
            // reading is safer than showing one OVERFLOW may have spoiled. Only a known comparison is named as one.
            const compares = c.reading ? COMPARES.includes(c.reading) : c.kind !== 'mover';
            if (compares) {
                // The S/N is repeated only when the finder's own line shows one (round 11 drops it without error maps).
                const snr = said.includes('S/N') ? snrText(c.snr) : '';
                const what = c.reading ? 'the brightness comparison' : 'the finder’s reading here';
                line = `The two visits differ here${c.gaiaMatch ? ' at a catalogue star' : ''}${snr ? `, at ${snr}` : ''} (candidate). `
                    + `${flagged}, so ${what} is not shown; an overflowing pixel can spoil a brightness reading.`;
                kind = 'unknown';
            } else {
                line = `${line} ${flagged}; an overflowing pixel can spoil a brightness reading.`;
            }
        }
        // When no frame of an end's own visit was read, the drop check never ran for it: unread in full, even if
        // the other frames read fine (or that visit has no frames here at all).
        const endUnread = own.some(o => !o.names.some(n => n !== null));
        const missing = checked.some(o => o.names.some(n => n === null));
        kept.push({ ...c, kind, line, unread: endUnread ? 'all' : missing ? 'some' : 'none' });
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
    const list = [...new Set([...order, ...dropped])].filter(n => dropped.has(n));
    const flags = list.length === 1 ? `the archive flag ${list[0]}` : `at least one of these archive flags: ${list.join(', ')}`;
    const dropNote = count === 0 ? undefined
        : `${count === 1 ? '1 candidate is not listed:' : `${count} candidates are not listed: for each,`} in at least one frame of `
            + `the visit where its spot, or one of its two spots, shows more light, that frame’s brightest pixel within 12″ of that spot carries ${flags}.`;
    return { kept, dropNote, allUnread, lead };
}
