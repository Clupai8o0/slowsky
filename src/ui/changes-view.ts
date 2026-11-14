// The "Candidate changes" panel (switch FEATURES.changes, off). It prints the change finder's own sentences and
// notes (src/lib/changes.ts, src/lib/change-input.ts) exactly as the module writes them, and adds no number or
// claim of its own: each line is labelled "Candidate N" so the word stays on every line, and the marks over the
// sky carry the same N. The finder's counts, noise and threshold are not shown. Pure string builders, no DOM.

import type { ChangeCandidate, ChangeResult } from '../lib/changes';

// Fields the finder is adding (lane/changes r10b): `sentence` (the reason without its caveat), `caveat` (a full
// sentence, absent when both visits have 2+ frames) and `lightVisit`; `reason` stays as an alias of `sentence`.
// Until they land, `reason` and the candidate's sign are used.
// Round 11 adds `reading` (what the sentence reads from the two visits) and `ends` (every lobe: one for a single
// spot, two for a pair or mover); `lightEnds` stays as an alias of `ends` for movers.
export type Reading = 'brighter' | 'fainter' | 'laterOnly' | 'earlierOnly' | 'moved' | 'pair' | 'differs';
export interface CandidateEnd { visit: 'earlier' | 'later'; x: number; y: number; radiusPix?: number }
export type PanelCandidate = Omit<ChangeCandidate, 'lightEnds'> & {
    sentence?: string; caveat?: string; lightVisit?: 'earlier' | 'later'; x?: number; y?: number;
    reading?: Reading; ends?: CandidateEnd[]; lightEnds?: CandidateEnd[]; nearCatalogue?: boolean;
};
export interface FinderVisits { earlier: { obsIds: string[] }; later: { obsIds: string[] } }

export interface ChangesView {
    candidates: (PanelCandidate & { line: string })[];
    notes: string[];
    lead?: string[]; // paragraphs above the list
    visits?: FinderVisits; // the frames of the two compared visits, when the finder says which
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
    const label = ['single spots' + away(0), 'pairs of spots' + away(1), 'spots or pairs near catalogue stars'];
    return `Listed in groups, each ${by}: ${groups.map((g) => label[g]).join(', then ')}.`;
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
    const candidates = (found.candidates as PanelCandidate[]).filter((c) => Number.isFinite(c.pix.x) && Number.isFinite(c.pix.y))
        .map((c) => ({ ...c, line: c.sentence ?? c.reason }))
        .sort((a, b) => groupOf(a) - groupOf(b) || strength(b) - strength(a));
    const lead = withCaveats(candidates);
    const visits = (found as ChangeResult & { visits?: FinderVisits }).visits;
    return {
        candidates,
        notes: found.notes,
        ...(lead.length ? { lead } : {}),
        ...(visits ? { visits } : {}),
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
    const order = orderNote(v.candidates);
    const button = rest > 0
        ? ` <button type="button" class="sk-chg-more" data-chg-more aria-expanded="${all}">${all ? 'Show fewer' : `Show ${rest} more`}</button>`
        : '';
    // The order is said when the list is cut or grouped; a short plain list needs no explanation.
    const more = button || order.startsWith('Listed in groups') ? `<p class="sk-chg-more-row">${order}${button}</p>` : '';
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
    const r = Math.max(5, Math.min(width, height) / 40);
    const rings = listed(v, all).map((c, i) => {
        const x = c.pix.x.toFixed(1);
        const y = c.pix.y.toFixed(1);
        const below = c.pix.y - r * 2.2 < 0;
        const ty = (below ? c.pix.y + r * 2.4 : c.pix.y - r * 1.5).toFixed(1);
        return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}"/><text x="${x}" y="${ty}" font-size="${(r * 1.6).toFixed(1)}">${i + 1}</text>`;
    }).join('');
    return `<svg class="sk-chg-marks" viewBox="0 0 ${width} ${height}" aria-hidden="true">${rings}</svg>`;
}
