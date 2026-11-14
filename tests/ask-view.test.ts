import { describe, expect, it } from 'vitest';
import { askViewHtml } from '../src/ui/ask-view';
import { busyText, MSG } from '../src/ui/ai-note';

describe('ask view', () => {
    const wrap = (body: string) => `<section class="sk-ask" aria-live="polite">${body}</section>`;
    it('adds the explanation only for a largest-change answer', () => {
        const note = '&quot;Largest change&quot; compares the point furthest from the middle value with that middle value. It does not say whether the brightness went up or down over time; the time-order line does.';
        const sheet = ['Brightness relative to the reference stars', 'Largest change from the median brightness: 30 percent brighter.', 'Visits: 3.'];
        expect(askViewHtml({ kind: 'answer', sheet, lines: [1, 2], trust: [3] })).toContain(`<p class="sk-ask-note">${note}</p>`);
        expect(askViewHtml({ kind: 'answer', sheet, lines: [1], trust: [3] })).not.toContain('sk-ask-note');
    });
    it('rejects empty, unsorted, duplicate, invalid and overlapping row numbers', () => {
        const sheet = ['one', 'two', 'three'];
        for (const [lines, trust] of [[[], []], [[2, 1], []], [[1, 1], []], [[1.5], []], [[1], [3, 2]], [[1], [2, 2]], [[1], [1]], [[1], [4]]] as number[][][]) {
            expect(() => askViewHtml({ kind: 'answer', sheet, lines: lines!, trust: trust! })).toThrow(RangeError);
        }
    });
    it('uses question-specific daily wording and retains other busy wording', () => {
        expect(askViewHtml({ kind: 'busy', reason: 'daily' })).toBe(wrap('<p>Today’s AI notes and questions are used up. Try again tomorrow.</p>'));
        expect(askViewHtml({ kind: 'busy', retryAfter: 20 })).toBe(wrap(`<p>${busyText({ retryAfter: 20 })}</p>`));
    });
    it('prints the answer and trust rows from the sheet, escaped', () => {
        expect(askViewHtml({ kind: 'answer', sheet: ['A < B & C', 'Trust'], lines: [1], trust: [2], text: '<script>hostile</script>' })).toBe(wrap('<h3 class="sk-ask-h">Lines from this page&#39;s measurements</h3><p>The AI picked these measured lines as the closest match to your question. They are not a yes or no answer, and they do not say whether a change is real.</p><ul class="sk-ask-rows"><li>A &lt; B &amp; C</li></ul><h3 class="sk-ask-h">How far to trust them</h3><ul class="sk-ask-rows"><li>Trust</li></ul>'));
        expect(() => askViewHtml({ kind: 'answer', sheet: ['one'], lines: [2], trust: [] })).toThrow();
        expect(() => askViewHtml({ kind: 'answer', sheet: ['one'], lines: [1], trust: [0] })).toThrow();
        expect(askViewHtml({ kind: 'answer', sheet: ['one'], lines: [1], trust: [] })).toBe(wrap('<h3 class="sk-ask-h">Lines from this page&#39;s measurements</h3><p>The AI picked these measured lines as the closest match to your question. They are not a yes or no answer, and they do not say whether a change is real.</p><ul class="sk-ask-rows"><li>one</li></ul>'));
    });
    it.each([
        ['none', 'The measured lines on this page do not answer that question directly.'],
        ['failed', 'The AI could not pick lines this time. Try again.'],
        ['invalid', 'That question could not be sent. Use plain text, 3 to 200 characters.'],
        ['busy', busyText({})], ['locked', MSG.enter], ['loading', 'Picking lines…'],
    ] as const)('renders %s', (kind, text) => {
        expect(askViewHtml({ kind })).toBe(wrap(`<p>${text}</p>`));
    });
});
