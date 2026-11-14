import { ASK_CANNOT } from '../lib/insight-prompt';
import { busyText, MSG } from './ai-note';

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
        const note = state.lines.some((n) => state.sheet[n - 1]!.startsWith('Largest change from the median brightness')) ? `<p class="sk-ask-note">${escapeHtml('"Largest change" compares the point furthest from the middle value with that middle value. It does not say whether the brightness went up or down over time; the time-order line does.')}</p>` : '';
        body = `<h3 class="sk-ask-h">${escapeHtml("Lines from this page's measurements")}</h3><p>The AI picked these measured lines as the closest match to your question. They are not a yes or no answer, and they do not say whether a change is real.</p>${rows(state.lines)}${note}${state.trust.length ? `<h3 class="sk-ask-h">How far to trust them</h3>${rows(state.trust)}` : ''}`;
    } else {
        const text = state.kind === 'none' ? ASK_CANNOT : state.kind === 'failed' ? 'The AI could not pick lines this time. Try again.' : state.kind === 'invalid' ? 'That question could not be sent. Use plain text, 3 to 200 characters.' : state.kind === 'busy' ? state.reason === 'daily' ? 'Today’s AI notes and questions are used up. Try again tomorrow.' : busyText(state) : state.kind === 'locked' ? MSG.enter : 'Picking lines…';
        body = `<p>${escapeHtml(text)}</p>`;
    }
    return `<section class="sk-ask" aria-live="polite">${body}</section>`;
}
