import { describe, expect, it, vi } from 'vitest';
import { ChangeInputError } from '../src/lib/change-input';
import type { ChangeCandidate, ChangeResult } from '../src/lib/changes';
import type { SkyResult } from '../src/lib/source';
import { changesHtml, changesMarks, changesView, EMPTY_LEAD } from '../src/ui/changes-view';
import { changesFor, DEFAULT_FEATURES } from '../src/ui/slots';

function cand(id: string, x: number, y: number, reason: string): ChangeCandidate
{
    return { id, kind: 'unknown', pix: { x, y }, sky: { ra: 0, dec: 0 }, snr: 7, sign: 1, gaiaMatch: false, frames: [], reason };
}

function found(candidates: ChangeCandidate[], notes: string[]): ChangeResult
{
    return { candidates, rejected: { streaks: 2, single: 3, edge: 1, residual: 0 }, sigma: 1.25, threshold: 5, skipped: [], notes };
}

const NOTES = ['Wavelengths: 1.10 µm and 1.11 µm.', 'Noise from the frames\' own error maps.'];

describe('Candidate changes panel', () => {
    it('prints each sentence as the module wrote it, labelled Candidate N, then the notes', () => {
        const v = changesView(found([cand('c1', 10, 20, 'A source <here> (S/N 7.0; candidate).'), cand('c2', 5, 5, 'Second (S/N 6.1; candidate).')], NOTES));
        const html = changesHtml(v);
        expect(html).toContain('<b>Candidate 1</b> A source &lt;here&gt; (S/N 7.0; candidate).');
        expect(html).toContain('<b>Candidate 2</b> Second (S/N 6.1; candidate).');
        for (const n of NOTES) {
            expect(html).toContain(`<li>${n.replace(/'/g, '\'')}</li>`);
        }
        expect(html).not.toContain(EMPTY_LEAD);
        // Nothing of its own: no counts, noise or threshold from the result.
        expect(html).not.toMatch(/1\.25|threshold|rejected|streak/);
        const items = html.match(/<li><b>Candidate \d+<\/b>/g) ?? [];
        expect(items).toHaveLength(2);
    });

    it('shows the module notes under a plain empty line when there are no candidates', () => {
        const html = changesHtml(changesView(found([], NOTES)));
        expect(html).toContain(EMPTY_LEAD);
        expect(html).toContain('<ul class="sk-chg-notes">');
        expect(html).not.toContain('<ol');
    });

    it('says nothing of its own when the finder measured nothing (sigma NaN)', () => {
        const none = { ...found([], ['2 frames skipped: no earlier image within 0.02 µm.']), sigma: NaN };
        expect(changesHtml(changesView(none))).toBe('<ul class="sk-chg-notes"><li>2 frames skipped: no earlier image within 0.02 µm.</li></ul>');
    });

    it('prints the finder\'s own message, and no empty line, when it cannot run', () => {
        const html = changesHtml(changesView({ error: 'Change finding needs two visits; these frames make 1.' }));
        expect(html).toBe('<ul class="sk-chg-notes"><li>Change finding needs two visits; these frames make 1.</li></ul>');
    });

    it('escapes lead paragraphs and candidate lines above the notes', () => {
        const v = changesView(found([cand('c', 1, 1, 'Original.')], ['Finder note.']));
        v.lead = ['A <caveat>.'];
        v.candidates[0]!.line = 'A <screened> line.';
        expect(changesHtml(v)).toBe('<p class="sk-chg-lead">A &lt;caveat&gt;.</p><ol class="sk-chg"><li><b>Candidate 1</b> A &lt;screened&gt; line.</li></ol><ul class="sk-chg-notes"><li>Finder note.</li></ul>');
    });

    it('drops candidates with no position and numbers the marks like the list', () => {
        const v = changesView(found([cand('c1', NaN, 3, 'x (candidate).'), cand('c2', 30, 2, 'y (candidate).')], []));
        expect(v.candidates.map((c) => c.id)).toEqual(['c2']);
        const svg = changesMarks(v, 200, 100);
        expect(svg).toContain('viewBox="0 0 200 100"');
        expect(svg.match(/<circle/g)).toHaveLength(1);
        expect(svg).toMatch(/<text [^>]*>1<\/text>/);
        // A ring near the top puts its number below, inside the picture.
        expect(Number(/<text x="[^"]+" y="([^"]+)"/.exec(svg)![1])).toBeGreaterThan(2);
        expect(changesMarks(changesView(found([], [])), 200, 100)).toBe('');
    });

    it('turns ChangeInputError into a note, hides on any other failure, and stays off by default', () => {
        const result = {} as SkyResult;
        const tooFew = changesFor(result, () => { throw new ChangeInputError('Change finding needs two visits; these frames make 1.'); });
        expect(tooFew).toEqual({ candidates: [], notes: ['Change finding needs two visits; these frames make 1.'], ran: false });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(changesFor(result, () => { throw new RangeError('boom'); })).toBeNull();
        warn.mockRestore();
        expect(DEFAULT_FEATURES.changes).toBe(false);
    });
});

describe('round 11: list cap', () => {
    const many = (n: number) => found(Array.from({ length: n }, (_, i) => ({ ...cand(`c${i}`, 10 + i, 10, `Spot ${i} (candidate).`), snr: 5 + i })), []);

    it('shows the strongest 8 first, by S/N, with a text button for the rest', () => {
        const v = changesView(many(11));
        expect(v.candidates[0]!.snr).toBe(15);
        const html = changesHtml(v);
        expect(html.match(/<li><b>Candidate \d+<\/b>/g)).toHaveLength(8);
        expect(html).toContain('Spot 10 (candidate).');
        expect(html).not.toContain('Spot 2 (candidate).');
        expect(html).toContain('<p class="sk-chg-more-row">Listed by the size of the change, largest first. <button type="button" class="sk-chg-more" data-chg-more aria-expanded="false">Show 3 more</button></p>');
        expect(changesMarks(v, 200, 100).match(/<circle/g)).toHaveLength(8);
        const all = changesHtml(v, true);
        expect(all.match(/<li><b>Candidate \d+<\/b>/g)).toHaveLength(11);
        expect(all).toContain('aria-expanded="true">Show fewer</button>');
        expect(changesMarks(v, 200, 100, true).match(/<circle/g)).toHaveLength(11);
    });

    it('has no button at 8 or fewer', () => {
        expect(changesHtml(changesView(many(8)))).not.toContain('data-chg-more');
    });
});

describe('round 11: order', () => {
    it('puts an infinite S/N first and a NaN last', () => {
        const v = changesView(found([{ ...cand('a', 1, 1, 'a (candidate).'), snr: 10 }, { ...cand('b', 2, 1, 'b (candidate).'), snr: Infinity },
            { ...cand('c', 3, 1, 'c (candidate).'), snr: NaN }], []));
        expect(v.candidates.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    });

    it('groups single spots, then pairs, then spots near catalogue stars, and says so', () => {
        const near = { ...cand('n', 1, 1, 'n (candidate).'), snr: 40, nearCatalogue: true };
        const pair = { ...cand('p', 2, 1, 'p (candidate).'), snr: 30, nearCatalogue: false, reading: 'pair' as const };
        const one = { ...cand('s', 3, 1, 's (candidate).'), snr: 6, nearCatalogue: false, reading: 'laterOnly' as const };
        const v = changesView(found([near, pair, one], []));
        expect(v.candidates.map((c) => c.id)).toEqual(['s', 'p', 'n']);
        expect(changesHtml(v)).toContain('<p class="sk-chg-more-row">Listed in groups, each by the size of the change, largest first: single spots away from catalogue stars, '
            + 'then pairs of spots away from catalogue stars, then spots or pairs near catalogue stars.</p>');
    });

    it('prints a caveat that only some lines share on those lines', () => {
        const a = { ...cand('a', 1, 1, 'a (candidate).'), snr: 9, caveat: 'One frame only.' };
        const b = { ...cand('b', 2, 1, 'b (candidate).'), snr: 8 };
        const html = changesHtml(changesView(found([a, b], [])));
        expect(html).toContain('<b>Candidate 1</b> a (candidate). One frame only.</li>');
        expect(html).toContain('<b>Candidate 2</b> b (candidate).</li>');
        expect(html).not.toContain('sk-chg-lead');
    });
});

describe('round 11: order wording follows what the lines show', () => {
    it('says by S/N only when a listed line shows one', () => {
        const a = { ...cand('a', 1, 1, 'a (S/N 9.0; candidate).'), snr: 9, nearCatalogue: false };
        const b = { ...cand('b', 2, 1, 'b (S/N 8.0; candidate).'), snr: 8, nearCatalogue: true };
        expect(changesHtml(changesView(found([a, b], [])))).toContain('Listed in groups, each by S/N, highest first: single spots away from catalogue stars, then spots or pairs near catalogue stars.');
    });
});

describe('round 11: groups from the review', () => {
    it('keeps a one-spot mover with the single spots, and says "away" only for a group the finder vouches for', () => {
        const mover = { ...cand('m', 1, 1, 'm (candidate).'), kind: 'mover' as const, snr: 9 };
        const pair = { ...cand('p', 2, 1, 'p (candidate).'), snr: 8, reading: 'pair' as const, nearCatalogue: false };
        const near = { ...cand('n', 3, 1, 'n (candidate).'), snr: 7, nearCatalogue: true };
        const html = changesHtml(changesView(found([near, pair, mover], [])));
        expect(html).toContain('Listed in groups, each by the size of the change, largest first: single spots, then pairs of spots away from catalogue stars, then spots or pairs near catalogue stars.');
    });

    it('sorts an S/N that is not a number last', () => {
        const v = changesView(found([{ ...cand('u', 1, 1, 'u (candidate).'), snr: undefined as unknown as number }, { ...cand('f', 2, 1, 'f (candidate).'), snr: 5 }], []));
        expect(v.candidates.map((c) => c.id)).toEqual(['f', 'u']);
    });
});
