import { describe, expect, it } from 'vitest';
import { askViewHtml } from '../src/ui/ask-view';
import { busyText, MSG } from '../src/ui/ai-note';

describe('ask view', () => {
    const wrap = (body: string) => `<section class="sk-ask" aria-live="polite">${body}</section>`;
    it('prints the answer and trust rows from the sheet, escaped', () => {
        expect(askViewHtml({ kind: 'answer', sheet: ['A < B & C', 'Trust'], lines: [1], trust: [2], text: '<script>hostile</script>' })).toBe(wrap('<h3 class="sk-ask-h">Lines from this page&#39;s measurements</h3><p>The AI picked these measured lines as the closest match to your question. They are not a yes or no answer, and they do not say whether a change is real.</p><ul class="sk-ask-rows"><li>A &lt; B &amp; C</li></ul><h3 class="sk-ask-h">How far to trust them</h3><ul class="sk-ask-rows"><li>Trust</li></ul>'));
        expect(() => askViewHtml({ kind: 'answer', sheet: ['one'], lines: [2], trust: [] })).toThrow();
        expect(() => askViewHtml({ kind: 'answer', sheet: ['one'], lines: [1], trust: [0] })).toThrow();
        expect(askViewHtml({ kind: 'answer', sheet: ['one'], lines: [1], trust: [] })).toBe(wrap('<h3 class="sk-ask-h">Lines from this page&#39;s measurements</h3><p>The AI picked these measured lines as the closest match to your question. They are not a yes or no answer, and they do not say whether a change is real.</p><ul class="sk-ask-rows"><li>one</li></ul>'));
    });
    it.each([
        ['none', 'The AI found no measured line on this page that matches your question.'],
        ['failed', 'The AI could not pick lines this time. Nothing was used up.'],
        ['invalid', 'That question could not be sent. Use plain text, 3 to 200 characters.'],
        ['busy', busyText({})], ['locked', MSG.enter], ['loading', 'Picking lines…'],
    ] as const)('renders %s', (kind, text) => {
        expect(askViewHtml({ kind })).toBe(wrap(`<p>${text}</p>`));
    });
});
