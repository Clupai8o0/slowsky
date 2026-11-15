import { describe, expect, it } from 'vitest';
import css from '../src/ui/styles.css?raw';
import { CONTROL_HELP, GLOSSARY, TERM_ORDER, AI_LINK, AI_LINE, HELP_INTRO, HELP_TITLE, type ControlId } from '../src/ui/help';
import { glossFor, helpDialogHtml } from '../src/ui/help-view';
import { shell } from '../src/ui/app';
import { disclaimer } from '../src/ui/ai-note';

describe('beginner help', () => {
    it('has safe text for every control and term', () => {
        const controls: ControlId[] = ['target', 'blink', 'stack', 'subtract', 'colour', 'field', 'gaia', 'flags', 'falseColour', 'epoch', 'changes', 'spectrum', 'aiNote'];
        expect(Object.keys(CONTROL_HELP)).toHaveLength(controls.length);
        expect(new Set(TERM_ORDER).size).toBe(Object.keys(GLOSSARY).length);
        for (const id of controls) {
            expect(CONTROL_HELP[id].name).toBeTruthy();
            expect(CONTROL_HELP[id].line).toBeTruthy();
        }
        for (const id of TERM_ORDER) {
            for (const value of Object.values(GLOSSARY[id])) {
                expect(value).toBeTruthy();
            }
        }
        expect(JSON.stringify([CONTROL_HELP, GLOSSARY, AI_LINE, HELP_INTRO, HELP_TITLE])).not.toMatch(/discover|confirmed that|proves|detected a/i);
    });
    it('returns matching glosses in the requested order', () => {
        expect(glossFor('S/N and ″', ['arcsec', 'catalogueStar', 'snr'])).toEqual([GLOSSARY.arcsec.short, GLOSSARY.snr.short]);
        expect(glossFor('nothing', TERM_ORDER)).toEqual([]);
        expect(glossFor('Catalogue star nearby', ['catalogueStar'])).toEqual([GLOSSARY.catalogueStar.short]);
    });
    it('includes both help buttons and every glossary entry and source link', () => {
        expect(shell().match(/data-act="help"/g)).toHaveLength(2);
        const html = helpDialogHtml();
        for (const id of TERM_ORDER) {
            expect(html).toContain(GLOSSARY[id].term);
        }
        expect(html).toContain(AI_LINK);
    });
    it('starts with a generic AI label without repeating a model in the disclaimer', () => {
        expect(shell()).toContain('data-ai="tag">AI-generated</span>');
        expect(disclaimer('claude-opus-5-5')).not.toContain('Claude');
    });
    it('keeps new help and gloss corners small', () => {
        const rules = css.match(/[^{}]*\.sk-(?:help|gloss)[^{}]*\{[^{}]*\}/g) ?? [];
        for (const rule of rules) {
            for (const radius of rule.matchAll(/border-radius:\s*([\d.]+)(px|%)/g)) {
                expect(radius[2]).toBe('px');
                expect(Number(radius[1])).toBeLessThanOrEqual(4);
            }
        }
    });
});
