import { describe, expect, it } from 'vitest';
import { History, TAB_CARDS, tabStates } from '../src/ui/tool';

describe('inspector tabs', () => {
    it('hides the AI note tab whenever the note is not on the page', () => {
        const off = tabStates((ref) => ref === 'ai');
        expect(off.find((t) => t.tab === 'ai')).toEqual({ tab: 'ai', empty: true, hide: true });
        const on = tabStates(() => false);
        expect(on.find((t) => t.tab === 'ai')).toEqual({ tab: 'ai', empty: false, hide: false });
    });
    it('keeps Candidates and Charts, with their note, when their cards are off', () => {
        const all = tabStates(() => true);
        for (const tab of ['cands', 'charts']) {
            expect(all.find((t) => t.tab === tab)).toEqual({ tab, empty: true, hide: false });
        }
        // One card shown is enough for Charts to have something to show.
        expect(tabStates((ref) => ref !== 'spec').find((t) => t.tab === 'charts')?.empty).toBe(false);
        expect(Object.keys(TAB_CARDS).sort()).toEqual(['ai', 'cands', 'charts']);
    });
});

describe('undo history', () => {
    it('steps back and forward, folds quick changes, and drops redo on a new step', () => {
        const h = new History<number>(60, 450);
        h.record(1, 0);
        h.record(2, 1000);
        h.record(3, 1100); // within 450 ms of 2: replaces it
        expect(h.undo()).toBe(1);
        expect(h.redo()).toBe(3);
        expect(h.canRedo).toBe(false);
        h.undo();
        h.record(4, 5000);
        expect(h.canRedo).toBe(false);
        expect(h.undo()).toBe(1);
        expect(h.canUndo).toBe(false);
    });
    it('amends the newest step without dropping redo, and keeps at most the limit', () => {
        const h = new History<number>(3, 0);
        for (let i = 1; i <= 6; i++) {
            h.record(i, i * 1000);
        }
        let n = 0;
        while (h.canUndo) {
            h.undo();
            n++;
        }
        expect(n).toBe(3);
        h.redo();
        h.amend(9);
        expect(h.canRedo).toBe(true);
        expect(h.undo()).toBe(3);
    });
});
