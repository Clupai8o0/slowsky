import { ASK_CANNOT } from '../lib/insight-prompt';
import { busyText, MSG, SHARED_DAILY } from './ai-note';

export type AskViewState =
    | { kind: 'answer'; sheet: string[]; lines: number[]; trust: number[]; text?: string }
    | { kind: 'none' | 'failed' | 'invalid' | 'locked' | 'loading' }
    | { kind: 'busy'; retryAfter?: number; reason?: string };

function escapeHtml(text: string): string
{
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function askViewHtml(state: AskViewState): string
{
    let body: string;
    if (state.kind === 'answer') {
        const valid = (numbers: number[]) => numbers.every((n, i) => Number.isInteger(n) && n >= 1 && n <= state.sheet.length && (i === 0 || n > numbers[i - 1]!));
        if (!state.lines.length || !valid(state.lines) || !valid(state.trust) || state.trust.some((n) => state.lines.includes(n))) { throw new RangeError('Invalid sheet line'); }
        const rows = (numbers: number[]) => `<ul class="sk-ask-rows">${numbers.map((n) => {
            if (!Number.isInteger(n) || n < 1 || n > state.sheet.length) { throw new RangeError('Invalid sheet line'); }
            return `<li>${escapeHtml(state.sheet[n - 1]!)}</li>`;
        }).join('')}</ul>`;
        const note = state.lines.some((n) => state.sheet[n - 1]!.startsWith('Largest change from the median brightness')) ? `<p class="sk-ask-note">${escapeHtml('"Largest change" is the larger of two gaps: from the middle value up to the brightest point, and down to the faintest. It does not say whether the brightness went up or down over time; the time-order line does.')}</p>` : '';
        body = `<h3 class="sk-ask-h">${escapeHtml("Lines from this page's measurements")}</h3><p>These measured lines are the closest match to your question. The AI picked them; when it picks a line about a brightness change, the page itself adds the time-order line. They are not a yes or no answer, and they do not say whether a change is real.</p>${rows(state.lines)}${note}${state.trust.length ? `<h3 class="sk-ask-h">How far to trust them</h3>${rows(state.trust)}` : ''}`;
    } else {
        const text = state.kind === 'none' ? ASK_CANNOT : state.kind === 'failed' ? 'The AI could not pick lines this time. Try again.' : state.kind === 'invalid' ? 'That question could not be sent. Use 3 to 200 characters with letters or numbers, and avoid angle brackets and special formatting.' : state.kind === 'busy' ? state.reason === 'daily' ? SHARED_DAILY : busyText(state) : state.kind === 'locked' ? MSG.enter : 'Picking lines…';
        body = `<p>${escapeHtml(text)}</p>`;
    }
    return `<section class="sk-ask">${body}</section>`;
}
