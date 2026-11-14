// The "Candidate changes" panel (switch FEATURES.changes, off). It prints the change finder's own sentences and
// notes (src/lib/changes.ts, src/lib/change-input.ts) exactly as the module writes them, and adds no number or
// claim of its own: each line is labelled "Candidate N" so the word stays on every line, and the marks over the
// sky carry the same N. The finder's counts, noise and threshold are not shown. Pure string builders, no DOM.

import { PLAIN_LEAD, type ChangeCandidate, type ChangeEnd, type ChangeReading, type ChangeResult } from '../lib/changes';

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
    reading?: Reading; ends?: CandidateEnd[]; lightEnds?: CandidateEnd[]; nearCatalogue?: boolean;
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
// How many candidates show before "Show N more"; the list is ordered by S/N, so these are the strongest.
export const LIST_CAP = 8;

// 0 a single spot (a mover with one spot too), 1 two spots (a pair, or a mover seen in both visits), 2 near a
// catalogue star (finder round 11 `nearCatalogue`).
export function groupOf(c: PanelCandidate): number
{
    const two = c.reading === 'pair' || c.reading === 'moved' || (c.ends ?? c.lightEnds ?? []).length > 1;
    return c.nearCatalogue ? 2 : two ? 1 : 0;
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
    const away = (g: number) => candidates.filter((c) => groupOf(c) === g).every((c) => c.nearCatalogue === false) ? ' away from catalogue stars' : '';
    const pairs = groups.includes(1) || candidates.some((c) => groupOf(c) === 2 && (c.ends ?? c.lightEnds ?? []).length > 1);
    const label = [(pairs ? 'single spots' : 'spots') + away(0), 'pairs of spots' + away(1), pairs ? 'spots or pairs near catalogue stars' : 'spots near catalogue stars'];
    return `Listed in groups, each ${by}: ${groups.map((g) => label[g]).join(', then ')}.`;
}

// The finder's plain list: it orders the candidates itself and says how in its notes, so the panel keeps that order
// and adds no order sentence of its own.
export function isPlain(candidates: PanelCandidate[]): boolean
{
    return candidates.length > 0 && candidates.every((c) => c.reading === 'moreLater' || c.reading === 'lessLater' || c.reading === 'unclear');
}

function listed<T>(v: { candidates: T[] }, all: boolean): T[]
{
    return all ? v.candidates : v.candidates.slice(0, LIST_CAP);
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
// `all` shows every candidate; otherwise the first LIST_CAP and a text button for the rest.
export function changesHtml(v: ChangesView, all = false): string
{
    const lead = (v.lead ?? []).map(s => `<p class="sk-chg-lead">${esc(s)}</p>`).join('');
    const rest = v.candidates.length - LIST_CAP;
    const order = isPlain(v.candidates) ? '' : orderNote(v.candidates);
    const button = rest > 0
        ? ` <button type="button" class="sk-chg-more" data-chg-more aria-expanded="${all}">${all ? 'Show fewer' : `Show ${rest} more`}</button>`
        : '';
    // The order is said when the list is cut or grouped; a short plain list needs no explanation.
    const more = button || order.startsWith('Listed in groups') ? `<p class="sk-chg-more-row">${`${order}${button}`.trim()}</p>` : '';
    const list = v.candidates.length
        ? `<ol class="sk-chg">${listed(v, all).map((c, i) => `<li><b>Candidate ${i + 1}</b> ${esc(c.line)}</li>`).join('')}</ol>${more}`
        : v.ran ? `<p class="sk-chg-lead">${EMPTY_LEAD}</p>` : '';
    const notes = v.notes.length ? `<ul class="sk-chg-notes">${v.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    return lead + list + notes;
}

// Numbered rings over the sky, on the picture's own pixel grid, for the listed candidates only.
export function changesMarks(v: ChangesView, width: number, height: number, all = false): string
{
    if (!v.candidates.length || !(width > 0) || !(height > 0)) {
        return '';
    }
    // Text size, and the ring size when the finder gives no aperture.
    const r = Math.max(5, Math.min(width, height) / 40);
    const boxes: { left: number; right: number; top: number; bottom: number }[] = [];
    // One ring per end (both spots of a pair or mover), each the finder's own reading aperture when round 11 gives
    // it (kept at 3 px or more so it stays visible); every ring of a candidate carries its number.
    const rings = listed(v, all).flatMap((c, i) => {
        const given = (c.ends?.length ? c.ends : c.lightEnds ?? []).filter(end => Number.isFinite(end.x) && Number.isFinite(end.y));
        const ends = given.length ? given : [{ x: c.pix.x, y: c.pix.y }];
        return ends.map((end: { x: number; y: number; radiusPix?: number }) => {
            const ring = typeof end.radiusPix === 'number' && end.radiusPix > 0 ? Math.max(3, end.radiusPix) : r;
            const x = end.x.toFixed(1);
            const y = end.y.toFixed(1);
            const below = end.y - ring - r * 1.2 < 0;
            const size = r * 1.6;
            const halfWidth = size * String(i + 1).length * 0.35 + 1;
            const box = (px: number, py: number) => ({ left: px - halfWidth, right: px + halfWidth, top: py - size - 1, bottom: py + 1 });
            const clear = (b: ReturnType<typeof box>) => boxes.every(other => b.right <= other.left || b.left >= other.right || b.bottom <= other.top || b.top >= other.bottom);
            const free = (b: ReturnType<typeof box>) => b.left >= 0 && b.right <= width && b.top >= 0 && b.bottom <= height && clear(b);
            const original = { x: end.x, y: below ? end.y + ring + r * 1.4 : end.y - ring - r * 0.5 };
            const options = [original, { x: end.x, y: end.y + ring + r * 1.4 },
                { x: end.x - ring - halfWidth, y: end.y + size * 0.35 },
                { x: end.x + ring + halfWidth, y: end.y + size * 0.35 }];
            const placed = clear(box(original.x, original.y)) ? original : options.slice(1).find(p => free(box(p.x, p.y))) ?? original;
            boxes.push(box(placed.x, placed.y));
            return `<circle cx="${x}" cy="${y}" r="${ring.toFixed(1)}"/><text x="${placed.x.toFixed(1)}" y="${placed.y.toFixed(1)}" font-size="${size.toFixed(1)}">${i + 1}</text>`;
        });
    }).join('');
    return `<svg class="sk-chg-marks" viewBox="0 0 ${width} ${height}" aria-hidden="true">${rings}</svg>`;
}
