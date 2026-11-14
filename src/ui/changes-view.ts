// The "Candidate changes" panel (switch FEATURES.changes, off). It prints the change finder's own sentences and
// notes (src/lib/changes.ts, src/lib/change-input.ts) exactly as the module writes them, and adds no number or
// claim of its own: each line is labelled "Candidate N" so the word stays on every line, and the marks over the
// sky carry the same N. The finder's counts, noise and threshold are not shown. Pure string builders, no DOM.

import type { ChangeCandidate, ChangeResult } from '../lib/changes';

export interface ChangesView {
    candidates: Pick<ChangeCandidate, 'id' | 'pix' | 'reason'>[];
    notes: string[];
    ran: boolean; // false when the finder could not run (its message is the only note)
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export const EMPTY_LEAD = 'The change finder lists no candidates between the first and last visit.';

// From what findChanges returns, or the message of the error it threw (for example "needs two visits").
export function changesView(found: ChangeResult | { error: string }): ChangesView
{
    if ('error' in found) {
        return { candidates: [], notes: [found.error], ran: false };
    }
    return {
        candidates: found.candidates.filter((c) => Number.isFinite(c.pix.x) && Number.isFinite(c.pix.y)),
        notes: found.notes,
        // The finder sets sigma to NaN when it measured nothing (no frames within its colour window); then
        // "no candidates" would claim a comparison that never happened, so only its notes show.
        ran: Number.isFinite(found.sigma) || found.candidates.length > 0,
    };
}

// The panel body. Text flows in plain blocks, so a reworded sentence or an extra note needs no layout change.
export function changesHtml(v: ChangesView): string
{
    const list = v.candidates.length
        ? `<ol class="sk-chg">${v.candidates.map((c, i) => `<li><b>Candidate ${i + 1}</b> ${esc(c.reason)}</li>`).join('')}</ol>`
        : v.ran ? `<p class="sk-chg-lead">${EMPTY_LEAD}</p>` : '';
    const notes = v.notes.length ? `<ul class="sk-chg-notes">${v.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    return list + notes;
}

// Numbered rings over the sky, on the picture's own pixel grid.
export function changesMarks(v: ChangesView, width: number, height: number): string
{
    if (!v.candidates.length || !(width > 0) || !(height > 0)) {
        return '';
    }
    const r = Math.max(5, Math.min(width, height) / 40);
    const rings = v.candidates.map((c, i) => {
        const x = c.pix.x.toFixed(1);
        const y = c.pix.y.toFixed(1);
        const below = c.pix.y - r * 2.2 < 0;
        const ty = (below ? c.pix.y + r * 2.4 : c.pix.y - r * 1.5).toFixed(1);
        return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}"/><text x="${x}" y="${ty}" font-size="${(r * 1.6).toFixed(1)}">${i + 1}</text>`;
    }).join('');
    return `<svg class="sk-chg-marks" viewBox="0 0 ${width} ${height}" aria-hidden="true">${rings}</svg>`;
}
