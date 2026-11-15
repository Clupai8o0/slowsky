import { describe, expect, it } from 'vitest';
import { HINT_TEXT, hintHtml, hintText, type HintInput } from '../src/ui/ml-hint';
import { DEFAULT_FEATURES, featuresFrom } from '../src/ui/slots';

// A stand-in for HELPER_LABEL in src/lib/classify.ts (lane/ml), which is not on this branch yet.
const LABEL = 'Experimental sort hint, trained only on fake changes added to single frames. Never tested on real two-date changes. Not a verdict.';
const RAW = /\b(mover|artifact|nothing|declined|brightness)\b/;
const BANNED = /\b(changed|discover\w*|detected|confirm\w*|proves?|planet)\b/i;

describe('ML sort hint', () => {
    const answers: HintInput[] = [
        { kind: 'mover', p: { mover: 0.91, brightness: 0.05, artifact: 0.03, nothing: 0.01 } },
        { kind: 'brightness', p: {} },
        { kind: 'artifact', p: {} },
        { kind: 'nothing', p: {} },
        { kind: 'declined', reason: 'close call <b>' },
    ];

    it('maps every answer to plain words, never a class name, score or percentage', () => {
        for (const c of answers) {
            const html = hintHtml(c, LABEL);
            expect(html).toContain(HINT_TEXT[c.kind]);
            expect(html).toContain(LABEL);
            expect(hintText(c)).not.toMatch(RAW);
            expect(html).not.toMatch(/\d\s*%|0\.\d/);
            expect(html).not.toMatch(BANNED);
            expect(html).not.toContain('close call');
        }
    });

    it('reads anything unexpected as no hint', () => {
        for (const c of [null, undefined, { kind: 'planet' } as unknown as HintInput, { kind: 'toString' } as unknown as HintInput]) {
            expect(hintText(c)).toBe(HINT_TEXT.declined);
        }
    });

    it('escapes the label, is on by default and can be switched off', () => {
        expect(hintHtml(answers[0], 'a <i>b</i>')).toContain('a &lt;i&gt;b&lt;/i&gt;');
        expect(DEFAULT_FEATURES.mlHint).toBe(true);
        expect(featuresFrom('-mlHint').mlHint).toBe(false);
    });
});
