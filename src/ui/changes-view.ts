// The "Candidate changes" panel (switch FEATURES.changes, on; live views only, see SAVED_NOTE in slots.ts). It prints the change finder's own sentences and
// notes (src/lib/changes.ts, src/lib/change-input.ts) exactly as the module writes them, and adds no number or
// claim of its own: each line is labelled "Candidate N" so the word stays on every line, and the marks over the
// sky carry the same N. The finder's counts, noise and threshold are not shown. Pure string builders, no DOM.

import { hasSnrFigure, isSnrNote, PLAIN_CAUSES, PLAIN_LEAD, type ChangeCandidate, type ChangeEnd, type ChangeReading, type ChangeResult } from '../lib/changes';
import { HELPER_LABEL, type Classification } from '../lib/classify';
import { hintHtml } from './ml-hint';

// Fields the finder is adding (lane/changes r10b): `sentence` (the reason without its caveat), `caveat` (a full
// sentence, absent when both visits have 2+ frames) and `lightVisit`; `reason` stays as an alias of `sentence`.
// Until they land, `reason` and the candidate's sign are used.
// Round 11 adds `reading` (what the sentence reads from the two visits) and `ends` (every lobe: one for a single
// spot, two for a pair or mover, each with its reading aperture `radiusPix`); `lightEnds` stays as an alias of
// `ends` for movers. The radius stays optional here only for older candidates that carry no `ends`.
// 'moreLater' / 'lessLater': the finder's plain list (compareVisits `plain: true`), one spot each, no star claim.
export type Reading = ChangeReading | 'moreLater' | 'lessLater';
export type CandidateEnd = Omit<ChangeEnd, 'radiusPix'> & { radiusPix?: number };
export type PanelCandidate = Omit<ChangeCandidate, 'lightEnds' | 'ends' | 'reading'> & {
    sentence?: string; caveat?: string; lightVisit?: 'earlier' | 'later'; x?: number; y?: number;
    reading?: Reading; ends?: CandidateEnd[]; lightEnds?: CandidateEnd[]; nearCatalogue?: boolean; catalogueChecked?: boolean; hint?: Classification;
};
export interface FinderVisits { earlier: { obsIds: string[] }; later: { obsIds: string[] } }

export interface ChangesView {
    candidates: (PanelCandidate & { line: string })[];
    notes: string[];
    lead?: string[]; // paragraphs above the list
    visits?: FinderVisits; // the frames of the two compared visits, when the finder says which
    plainListInfo?: ChangeResult['plainListInfo'];
    ran: boolean; // false when the finder could not run (its message is the only note)
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export const EMPTY_LEAD = 'The change finder lists no candidates between the first and last visit.';
// Maximum number of candidates in the closed list.
export const LIST_CAP = 8;

// 0 a single spot (a mover with one spot too), 1 two spots (a pair, or a mover seen in both visits), 2 near a
// catalogue star (finder round 11 `nearCatalogue`).
export function groupOf(c: PanelCandidate): number
{
    const two = c.reading === 'pair' || c.reading === 'moved' || (c.ends ?? c.lightEnds ?? []).length > 1;
    return c.nearCatalogue || c.catalogueChecked === false ? 2 : two ? 1 : 0;
}

// How the list is ordered, in words; only says "away from catalogue stars" when the finder says so.
export function orderNote(candidates: (PanelCandidate & { line?: string })[]): string
{
    // Without error maps the finder's lines show no S/N (round 11), so the order is named by what it follows:
    // the change over one noise figure for the whole field.
    const by = candidates.some((c) => (c.line ?? c.sentence ?? c.reason).includes('S/N')) ? 'by S/N, highest first' : 'by the size of the change, largest first';
    const groups = [...new Set(candidates.map(groupOf))].sort();
    if (groups.length < 2) {
        return `Listed ${by}.`;
    }
    // "away from catalogue stars" only for a group whose every candidate the finder says is not near one.
    const away = (g: number) => candidates.filter((c) => groupOf(c) === g).every((c) => c.nearCatalogue === false && c.catalogueChecked !== false) ? ' away from catalogue stars' : '';
    const pairs = groups.includes(1) || candidates.some((c) => groupOf(c) === 2 && (c.ends ?? c.lightEnds ?? []).length > 1);
    const unchecked = candidates.some(c => c.catalogueChecked === false);
    const label = [(pairs ? 'single spots' : 'spots') + away(0), 'pairs of spots' + away(1), unchecked
        ? (pairs ? 'other spots or pairs' : 'other spots') : pairs ? 'spots or pairs near catalogue stars' : 'spots near catalogue stars'];
    return `Listed in groups, each ${by}: ${groups.map((g) => label[g]).join(', then ')}.`;
}

// The finder's plain list: it orders the candidates itself and says how in its notes, so the panel keeps that order
// and adds no order sentence of its own.
export function isPlain(candidates: PanelCandidate[]): boolean
{
    return candidates.length > 0 && candidates.every((c) => c.reading === 'moreLater' || c.reading === 'lessLater' || c.reading === 'unclear');
}

function listed(v: ChangesView, all: boolean): ChangesView['candidates']
{
    if (all) { return v.candidates; }
    const match = v.plainListInfo?.matchArcsec;
    if (isPlain(v.candidates) && typeof match === 'number' && Number.isFinite(match)) {
        const firstNear = v.candidates.findIndex(c => c.nearCatalogue === true || c.catalogueChecked === false);
        return v.candidates.slice(0, Math.min(LIST_CAP, firstNear < 0 ? v.candidates.length : firstNear));
    }
    return v.candidates.slice(0, LIST_CAP);
}

// Flag screening can remove candidates and change their order after the finder has finished.
function coveredView(v: ChangesView): ChangesView
{
    const coverNote = v.notes.find(n => /^(?:1 listed spot lies|\d+ listed spots lie) outside the part of the picture where the Gaia star list was loaded \(within /.test(n));
    if (!coverNote && !v.candidates.some(c => c.catalogueChecked === false)) { return v; }
    const candidates = [...v.candidates].sort((a, b) => {
        const group = (c: PanelCandidate) => c.nearCatalogue ? 1 : c.catalogueChecked === false ? 2 : 0;
        return group(a) - group(b) || Number(hasSnrFigure(b.line)) - Number(hasSnrFigure(a.line));
    });
    const count = candidates.filter(c => c.catalogueChecked === false).length;
    const radius = coverNote?.match(/\(within ([\d.]+)° of the centre\)/)?.[1];
    const notes = v.notes.flatMap(n => n !== coverNote ? [n] : count && radius
        ? [`${count === 1 ? '1 listed spot lies' : `${count} listed spots lie`} outside the part of the picture where the Gaia star list was loaded (within ${radius}° of the centre), so ${count === 1 ? 'it was' : 'they were'} not checked against that list.`] : []);
    return { ...v, candidates, notes };
}

// From what findChanges returns, or the message of the error it threw (for example "needs two visits").
export function changesView(found: ChangeResult | { error: string }): ChangesView
{
    if ('error' in found) {
        return { candidates: [], notes: [found.error], ran: false };
    }
    // In groups (single spots, then pairs, then spots near catalogue stars), each strongest first (stable; an S/N
    // that is not a number goes last), so a capped list keeps the strongest away from bright-star residuals.
    const strength = (c: PanelCandidate) => (typeof c.snr === 'number' && !Number.isNaN(c.snr) ? c.snr : -Infinity);
    const placed = (found.candidates as PanelCandidate[]).filter((c) => Number.isFinite(c.pix.x) && Number.isFinite(c.pix.y))
        .map((c) => ({ ...c, line: c.sentence ?? c.reason }));
    const candidates = isPlain(placed) ? placed : placed.sort((a, b) => groupOf(a) - groupOf(b) || strength(b) - strength(a));
    const plainLead = isPlain(candidates) && found.notes[0] === PLAIN_LEAD ? [found.notes[0]] : [];
    const lead = [...plainLead, ...withCaveats(candidates)];
    const visits = (found as ChangeResult & { visits?: FinderVisits }).visits;
    return {
        candidates,
        notes: plainLead.length ? found.notes.slice(1) : found.notes,
        ...(lead.length ? { lead } : {}),
        ...(visits ? { visits } : {}),
        ...(found.plainListInfo ? { plainListInfo: found.plainListInfo } : {}),
        // The finder sets sigma to NaN when it measured nothing (no frames within its colour window); then
        // "no candidates" would claim a comparison that never happened, so only its notes show.
        ran: Number.isFinite(found.sigma) || found.candidates.length > 0,
    };
}

// One caveat shared by every candidate shows once above the list (returned); otherwise each line gets its own.
export function withCaveats(candidates: { caveat?: string; line: string }[]): string[]
{
    const first = candidates[0]?.caveat;
    if (first && candidates.every((c) => c.caveat === first)) {
        return [first];
    }
    for (const c of candidates) {
        if (c.caveat) {
            c.line += ` ${c.caveat}`;
        }
    }
    return [];
}

// The panel body. Text flows in plain blocks, so a reworded sentence or an extra note needs no layout change.
// `all` shows every candidate; the closed plain list stops at the first near-star spot or LIST_CAP.
export function changesHtml(v: ChangesView, all = false): string
{
    v = coveredView(v);
    const plain = isPlain(v.candidates);
    const clause = `; ${PLAIN_CAUSES} (`;
    const shared = plain && v.candidates.every(c => c.line.split(clause).length === 2);
    const lead = [...(v.lead ?? []), ...(shared && listed(v, all).length ? [`For every spot listed: ${PLAIN_CAUSES}.`] : [])].map(s => `<p class="sk-chg-lead">${esc(s)}</p>`).join('');
    const closed = listed(v, false);
    const hidden = v.candidates.slice(closed.length);
    const match = v.plainListInfo?.matchArcsec;
    const fold = plain && typeof match === 'number' && Number.isFinite(match);
    if (fold) {
        const starCount = hidden.filter(c => c.nearCatalogue === true && c.catalogueChecked !== false).length;
        const spots = `${hidden.length}${closed.length ? ' more' : ''} ${hidden.length === 1 ? 'spot' : 'spots'}`;
        const hiddenText = !closed.length && hidden.length === starCount
            ? `No spot is shown: ${hidden.length === 1 ? 'the 1 candidate lies' : hidden.length === 2 ? 'both candidates lie' : `all ${hidden.length} candidates lie`} within ${match}″ of a catalogue star.`
            : `Not shown: ${spots}${hidden.length === starCount ? ` within ${match}″ of a catalogue star` : starCount ? `; ${starCount} of them ${starCount === 1 ? 'lies' : 'lie'} within ${match}″ of a catalogue star` : ''}.`;
        const button = closed.length ? `Show ${hidden.length} more` : hidden.length === 1 ? 'Show it' : 'Show them';
        const more = hidden.length ? `<p class="sk-chg-more-row">${all ? '' : esc(hiddenText) + ' '}<button type="button" class="sk-chg-more" data-chg-more aria-expanded="${all}">${all ? (closed.length ? 'Show fewer' : hidden.length === 1 ? 'Hide it' : 'Hide them') : button}</button></p>` : '';
        const items = listed(v, all);
        const list = items.length ? `<ol class="sk-chg">${items.map((c, i) => `<li><b>Candidate ${i + 1}</b> ${esc(shared ? c.line.replace(clause, ' (') : c.line)}${c.hint ? hintHtml(c.hint, HELPER_LABEL) : ''}</li>`).join('')}</ol>`
            : '';
        const visibleNotes = !all && !items.length ? v.notes.filter(n => !n.startsWith('Listed with spots that have no catalogue star within ') && !isSnrNote(n)) : v.notes;
        const notes = visibleNotes.length ? `<ul class="sk-chg-notes">${visibleNotes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
        return lead + list + more + notes;
    }
    const rest = v.candidates.length - LIST_CAP;
    const order = isPlain(v.candidates) ? '' : orderNote(v.candidates);
    const button = rest > 0
        ? ` <button type="button" class="sk-chg-more" data-chg-more aria-expanded="${all}">${all ? 'Show fewer' : `Show ${rest} more`}</button>`
        : '';
    // Grouped lists show their order here; the plain list receives its order note from the finder.
    const more = button || order.startsWith('Listed in groups') ? `<p class="sk-chg-more-row">${`${order}${button}`.trim()}</p>` : '';
    const list = v.candidates.length
        ? `<ol class="sk-chg">${listed(v, all).map((c, i) => `<li><b>Candidate ${i + 1}</b> ${esc(shared ? c.line.replace(clause, ' (') : c.line)}${c.hint ? hintHtml(c.hint, HELPER_LABEL) : ''}</li>`).join('')}</ol>${more}`
        : v.ran ? `<p class="sk-chg-lead">${EMPTY_LEAD}</p>` : '';
    const notes = v.notes.length ? `<ul class="sk-chg-notes">${v.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    return lead + list + notes;
}

// Numbered rings over the sky, on the picture's own pixel grid, for the listed candidates only.
export function changesMarks(v: ChangesView, width: number, height: number, all = false): string
{
    v = coveredView(v);
    if (!v.candidates.length || !(width > 0) || !(height > 0)) {
        return '';
    }
    if (isPlain(v.candidates)) {
        return plainMarks(v, width, height, all);
    }
    // Text size, and the ring size when the finder gives no aperture.
    const r = Math.max(5, Math.min(width, height) / 40);
    const boxes: { left: number; right: number; top: number; bottom: number }[] = [];
    // One ring per end (both spots of a pair or mover), each the finder's own reading aperture when round 11 gives
    // it (kept at 3 px or more so it stays visible); every ring of a candidate carries its number.
    const ends = listed(v, all).flatMap((c, i) => {
        const given = (c.ends?.length ? c.ends : c.lightEnds ?? []).filter(end => Number.isFinite(end.x) && Number.isFinite(end.y));
        return (given.length ? given : [{ x: c.pix.x, y: c.pix.y, radiusPix: undefined }]).map(end => ({ end, i,
            ring: typeof end.radiusPix === 'number' && end.radiusPix > 0 ? Math.max(3, end.radiusPix) : r }));
    });
    const rings = ends.map(({ end, i, ring }, index) => {
        const x = end.x.toFixed(1);
        const y = end.y.toFixed(1);
        const below = end.y - ring - r * 2.1 - 1 < 0;
        const size = Number((r * 1.6).toFixed(1));
        const halfWidth = size * String(i + 1).length * 0.35 + 1;
        const box = (px: number, py: number) => ({ left: px - halfWidth, right: px + halfWidth, top: py - size - 1, bottom: py + 1 });
        const ringBoxes = ends.map(other => {
            const cx = Number(other.end.x.toFixed(1)), cy = Number(other.end.y.toFixed(1)), radius = Number(other.ring.toFixed(1));
            return { left: cx - radius, right: cx + radius, top: cy - radius, bottom: cy + radius };
        });
        const own = ringBoxes[index]!;
        const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
            !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
        // Work at SVG precision; a small inset keeps rounding from pushing a box outside the picture.
        const place = (px: number, py: number) => ({ x: Number(clamp(px, halfWidth + 0.05, width - halfWidth - 0.05).toFixed(1)),
            y: Number(clamp(py, size + 1.05, height - 1.05).toFixed(1)) });
        const hard = (p: { x: number; y: number }) => {
            const b = box(p.x, p.y);
            return b.left >= 0 && b.right <= width && b.top >= 0 && b.bottom <= height
                && !overlaps(b, own) && boxes.every(other => !overlaps(b, other));
        };
        const soft = (p: { x: number; y: number }) => ringBoxes.every((other, j) => j === index || !overlaps(box(p.x, p.y), other));
        const candidates: { x: number; y: number }[] = [];
        for (let step = 0; step <= Math.floor(size - 1.1); step++) {
            const gap = 1.1 + step;
            const above = Math.max(own.top - 1 - size, Math.min(end.y - ring - r * 0.5 - step, own.top - 1 - gap));
            const down = own.bottom + size + 1 + gap;
            const left = own.left - halfWidth - gap, right = own.right + halfWidth + gap;
            const middle = (own.top + own.bottom + size) / 2;
            const top = place(end.x, above), bottom = place(end.x, down);
            const diagonal = Math.min(gap, size / Math.SQRT2 - 0.1);
            const diagonalTop = Math.max(above, own.top - 1 - diagonal);
            const diagonalBottom = own.bottom + size + 1 + diagonal;
            const diagonalLeft = own.left - halfWidth - diagonal, diagonalRight = own.right + halfWidth + diagonal;
            candidates.push(...(below ? [bottom, top] : [top, bottom]), place(left, middle), place(right, middle),
                place(diagonalLeft, diagonalTop), place(diagonalRight, diagonalTop), place(diagonalLeft, diagonalBottom), place(diagonalRight, diagonalBottom));
        }
        const placed = candidates.find(p => hard(p) && soft(p)) ?? candidates.find(hard) ?? candidates[0]!;
        boxes.push(box(placed.x, placed.y));
        return `<circle cx="${x}" cy="${y}" r="${ring.toFixed(1)}"/><text x="${placed.x.toFixed(1)}" y="${placed.y.toFixed(1)}" font-size="${size.toFixed(1)}">${i + 1}</text>`;
    }).join('');
    return `<svg class="sk-chg-marks" viewBox="0 0 ${width} ${height}" aria-hidden="true">${rings}</svg>`;
}

type Box = { left: number; right: number; top: number; bottom: number };
type Point = { x: number; y: number };
export type PlacementCounts = { preferred: number; soft: number; hard: number; apart: number; grid: number; last: number };

// Optional counts let the seeded geometry test report which placement rule was needed.
export function plainMarks(v: ChangesView, width: number, height: number, all = false, counts?: PlacementCounts): string
{
    const r = Math.max(5, Math.min(width, height) / 40);
    const ends = listed(v, all).flatMap((c, i) => {
        const given = (c.ends?.length ? c.ends : c.lightEnds ?? []).filter(e => Number.isFinite(e.x) && Number.isFinite(e.y));
        return (given.length ? given : [{ x: c.pix.x, y: c.pix.y, radiusPix: undefined }]).map(e => ({
            x: Number(e.x.toFixed(1)), y: Number(e.y.toFixed(1)), i,
            radius: Number((typeof e.radiusPix === 'number' && e.radiusPix > 0 ? Math.max(3, e.radiusPix) : r).toFixed(1)),
        }));
    });
    const parent = ends.map((_, i) => i);
    const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]!));
    ends.forEach((a, i) => ends.slice(0, i).forEach((b, j) => {
        if (a.i !== b.i && Math.hypot(a.x - b.x, a.y - b.y) < Math.max(a.radius, b.radius)) {
            parent[root(i)] = root(j);
        }
    }));
    const groups = new Map<number, number[]>();
    ends.forEach((_, i) => { const k = root(i); groups.set(k, [...(groups.get(k) ?? []), i]); });
    const ringBoxes = ends.map(e => ({ left: e.x - e.radius, right: e.x + e.radius, top: e.y - e.radius, bottom: e.y + e.radius }));
    const overlap = (a: Box, b: Box) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const boxes: Box[] = [];
    const marks: string[] = [];
    for (const members of groups.values()) {
        const label = [...new Set(members.map(i => ends[i]!.i + 1))].sort((a, b) => a - b).join(', ');
        const size = Math.floor(Math.min(r * 1.6, (width - 2.2) / (label.length * 0.7)) * 10) / 10;
        const half = size * label.length * 0.35 + 1;
        const own = { left: Math.min(...members.map(i => ringBoxes[i]!.left)), right: Math.max(...members.map(i => ringBoxes[i]!.right)),
            top: Math.min(...members.map(i => ringBoxes[i]!.top)), bottom: Math.max(...members.map(i => ringBoxes[i]!.bottom)) };
        const cx = (own.left + own.right) / 2, cy = (own.top + own.bottom) / 2;
        const box = (p: Point): Box => ({ left: p.x - half, right: p.x + half, top: p.y - size - 1, bottom: p.y + 1 });
        const place = (x: number, y: number): Point => ({ x: Number(Math.max(half + 0.05, Math.min(width - half - 0.05, x)).toFixed(1)),
            y: Number(Math.max(size + 1.05, Math.min(height - 1.05, y)).toFixed(1)) });
        const apart = (p: Point) => boxes.every(b => !overlap(box(p), b));
        const hard = (p: Point) => apart(p) && !overlap(box(p), own);
        const soft = (p: Point) => ringBoxes.every((b, i) => members.includes(i) || !overlap(box(p), b));
        const mine = (p: Point) => {
            const distances = ends.map(e => Math.hypot(p.x - e.x, p.y - size / 2 - e.y));
            const d = Math.min(...members.map(i => distances[i]!));
            return ends.every((e, i) => members.includes(i) || members.some(j => ends[j]!.i === e.i) || distances[i]! >= d);
        };
        const candidates: Point[] = [];
        const below = own.top - r * 2.1 - 1 < 0;
        for (let step = 0; step <= Math.floor(size - 1.15); step++) {
            const gap = 1.1 + step;
            const above = Math.max(own.top - 1 - size, Math.min(own.top - r * 0.5 - step, own.top - 1 - gap));
            const down = Math.max(own.bottom + size + 1 + gap, own.bottom + r * 1.4 + step);
            const top = place(cx, above), bottom = place(cx, down);
            const middle = (own.top + own.bottom + size) / 2;
            const diagonal = Math.min(gap, size / Math.SQRT2 - 0.1);
            candidates.push(...(below ? [bottom, top] : [top, bottom]), place(own.left - half - gap, middle), place(own.right + half + gap, middle),
                place(own.left - half - diagonal, own.top - 1 - diagonal), place(own.right + half + diagonal, own.top - 1 - diagonal),
                place(own.left - half - diagonal, own.bottom + size + 1 + diagonal), place(own.right + half + diagonal, own.bottom + size + 1 + diagonal));
        }
        const rules = [(p: Point) => hard(p) && soft(p) && mine(p), (p: Point) => hard(p) && soft(p), hard, apart];
        let tier = rules.findIndex(rule => candidates.some(rule));
        let chosen = tier < 0 ? undefined : candidates.find(rules[tier]!);
        // Before accepting a place on the cluster itself, search for an available off-ring place across the picture.
        if (!chosen || overlap(box(chosen), own)) {
            const grid: Point[] = [];
            for (let y = size + 1.1; y <= height - 1.05; y += 2) {
                for (let x = half + 0.1; x <= width - half - 0.05; x += 2) { grid.push(place(x, y)); }
            }
            const byDistance = (a: Point, b: Point) => Math.hypot(a.x - cx, a.y - size / 2 - cy) - Math.hypot(b.x - cx, b.y - size / 2 - cy);
            const off = grid.filter(hard).sort(byDistance)[0];
            const free = off ?? grid.filter(apart).sort(byDistance)[0];
            if (free) { chosen = free; tier = 4; }
        }
        if (!chosen) { chosen = candidates[0]!; tier = 5; }
        if (counts) { counts[(['preferred', 'soft', 'hard', 'apart', 'grid', 'last'] as const)[tier]!]++; }
        boxes.push(box(chosen));
        // When another candidate's ring is strictly nearer and the own ring is at least 2 px away,
        // draw a white leader with a dark outline to the nearest own ring.
        const at = box(chosen);
        const gap = (e: { x: number; y: number; radius: number }) => Math.hypot(Math.max(at.left - e.x, 0, e.x - at.right), Math.max(at.top - e.y, 0, e.y - at.bottom)) - e.radius;
        const near = members.reduce((a, b) => gap(ends[a]!) <= gap(ends[b]!) ? a : b);
        const lead = gap(ends[near]!) >= 2 && ends.some(e => !members.some(j => ends[j]!.i === e.i) && Math.max(0, gap(e)) < Math.max(0, gap(ends[near]!)));
        const e0 = ends[near]!, bx = Math.max(at.left, Math.min(at.right, e0.x)), by = Math.max(at.top, Math.min(at.bottom, e0.y)), d = Math.hypot(bx - e0.x, by - e0.y);
        marks.push(...members.map(i => { const e = ends[i]!; return `<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="${e.radius.toFixed(1)}"/>`; }),
            ...(lead ? [`<line class="sk-chg-lead-under" x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${(e0.x + (bx - e0.x) * e0.radius / d).toFixed(1)}" y2="${(e0.y + (by - e0.y) * e0.radius / d).toFixed(1)}"/>`,
                `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${(e0.x + (bx - e0.x) * e0.radius / d).toFixed(1)}" y2="${(e0.y + (by - e0.y) * e0.radius / d).toFixed(1)}"/>`] : []),
            `<text x="${chosen.x.toFixed(1)}" y="${chosen.y.toFixed(1)}" font-size="${size.toFixed(1)}">${label}</text>`);
    }
    return `<svg class="sk-chg-marks" viewBox="0 0 ${width} ${height}" aria-hidden="true">${marks.join('')}</svg>`;
}
