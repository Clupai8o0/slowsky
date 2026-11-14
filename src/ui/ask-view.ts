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
        const rows = (numbers: number[]) => `<ul class="sk-ask-rows">${numbers.map((n) => {
            if (!Number.isInteger(n) || n < 1 || n > state.sheet.length) { throw new RangeError('Invalid sheet line'); }
            return `<li>${escapeHtml(state.sheet[n - 1]!)}</li>`;
        }).join('')}</ul>`;
        body = `<h3 class="sk-ask-h">${escapeHtml("Lines from this page's measurements")}</h3><p>The AI picked these measured lines as the closest match to your question. They are not a yes or no answer, and they do not say whether a change is real.</p>${rows(state.lines)}${state.trust.length ? `<h3 class="sk-ask-h">How far to trust them</h3>${rows(state.trust)}` : ''}`;
    } else {
        const text = state.kind === 'none' ? ASK_CANNOT : state.kind === 'failed' ? 'The AI could not pick lines this time. Nothing was used up.' : state.kind === 'invalid' ? 'That question could not be sent. Use plain text, 3 to 200 characters.' : state.kind === 'busy' ? busyText(state) : state.kind === 'locked' ? MSG.enter : 'Picking lines…';
        body = `<p>${escapeHtml(text)}</p>`;
    }
    return `<section class="sk-ask" aria-live="polite">${body}</section>`;
}
