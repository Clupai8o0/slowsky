import { describe, expect, it, vi } from 'vitest';
import { ChangeInputError } from '../src/lib/change-input';
import { hasSnrFigure, stripSnr, type ChangeCandidate, type ChangeResult } from '../src/lib/changes';
import type { SkyResult } from '../src/lib/source';
import { changesHtml, changesMarks, changesView, plainMarks, EMPTY_LEAD } from '../src/ui/changes-view';
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

describe('round 11: marks at every end', () => {
    it('keeps lone marks bounded and preserves valid above positions', () => {
        for (const [x, y] of [[117, 117], [0, 117], [234, 117], [117, 0], [117, 234], [0, 0], [234, 0], [0, 234], [234, 234]]) {
            const svg = changesMarks(changesView(found([cand('one', x!, y!, 'Spot (candidate).')], [])), 235, 235);
            const m = /<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"\/><text x="([^"]+)" y="([^"]+)" font-size="([^"]+)"/.exec(svg)!;
            const [cx, cy, r, tx, ty, size] = m.slice(1).map(Number) as [number, number, number, number, number, number];
            const half = size * 0.35 + 1;
            expect(tx - half).toBeGreaterThanOrEqual(-0.06);
            expect(tx + half).toBeLessThanOrEqual(235.06);
            expect(ty - size - 1).toBeGreaterThanOrEqual(-0.06);
            expect(ty + 1).toBeLessThanOrEqual(235.06);
            expect(tx + half <= cx - r || tx - half >= cx + r || ty + 1 <= cy - r || ty - size - 1 >= cy + r).toBe(true);
            const originalY = y! - 235 / 40 * 1.5;
            if (y! - 235 / 40 * 3.1 - 1 >= 0 && originalY - size - 1 >= 0 && x! - half >= 0 && x! + half <= 235) {
                expect(tx).toBe(x);
                expect(ty).toBeCloseTo(originalY, 0);
            }
        }
    });
    it('clamps label x positions in a crowded left-edge layout', () => {
        const points = [[1, 55], [2, 60], [3, 65], [1, 70], [4, 75], [3, 80]];
        const svg = changesMarks(changesView(found(points.map(([x, y], i) => cand(String(i), x!, y!, 'Spot (candidate).')), [])), 235, 235);
        for (const m of svg.matchAll(/<text x="([^"]+)" y="([^"]+)" font-size="([^"]+)"/g)) {
            const x = Number(m[1]), half = Number(m[3]) * 0.35 + 1;
            expect(x - half).toBeGreaterThanOrEqual(-0.06);
            expect(x + half).toBeLessThanOrEqual(235.06);
        }
    });
    it('measures bounded labels across seeded crowded and spread-out layouts', () => {
        let seed = 73421;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const intersects = (a: number[], b: number[]) => !(a[1]! <= b[0]! || a[0]! >= b[1]! || a[3]! <= b[2]! || a[2]! >= b[3]!);
        for (const crowded of [true, false]) {
            const counts = { outside: 0, distant: 0, own: 0, overlaps: 0, nearer: 0, numbers: 0 };
            for (let layout = 0; layout < 200; layout++) {
                const points: number[][] = [];
                const n = 4 + Math.floor(random() * 5);
                const anchors = [[0, 0], [175, 0], [0, 175], [175, 175], [0, 85], [175, 85], [85, 0], [85, 175], [85, 85]];
                const anchor = anchors[layout % anchors.length]!;
                while (points.length < n) {
                    const x = Math.round(crowded ? anchor[0]! + random() * 59 : random() * 234);
                    const y = Math.round(crowded ? anchor[1]! + random() * 59 : random() * 234);
                    if (crowded || points.every(p => Math.hypot(p[0]! - x, p[1]! - y) >= 35)) { points.push([x, y]); }
                }
                const svg = changesMarks(changesView(found(points.map(([x, y], i) => cand(String(i), x!, y!, 'Spot (candidate).')), [])), 235, 235);
                const marks = [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"\/><text x="([^"]+)" y="([^"]+)" font-size="([^"]+)"/g)]
                    .map(m => m.slice(1).map(Number));
                expect(marks).toHaveLength(n);
                const labels = marks.map(([, , , x, y, s]) => [x! - s! * 0.35 - 1, x! + s! * 0.35 + 1, y! - s! - 1, y! + 1]);
                marks.forEach(([cx, cy, r, x, y, s], i) => {
                    const b = labels[i]!, ring = [cx! - r!, cx! + r!, cy! - r!, cy! + r!];
                    counts.numbers++;
                    if (b[0]! < -1e-9 || b[1]! > 235 + 1e-9 || b[2]! < -1e-9 || b[3]! > 235 + 1e-9) { counts.outside++; }
                    const gap = Math.hypot(Math.max(0, ring[0]! - b[1]!, b[0]! - ring[1]!), Math.max(0, ring[2]! - b[3]!, b[2]! - ring[3]!));
                    if (gap > s! + 1e-9) { counts.distant++; }
                    if (intersects(b, ring)) { counts.own++; }
                    if (labels.slice(0, i).some(other => intersects(b, other))) { counts.overlaps++; }
                    const ownDistance = Math.hypot(x! - cx!, y! - s! / 2 - cy!);
                    if (marks.some(([ox, oy], j) => j !== i && Math.hypot(x! - ox!, y! - s! / 2 - oy!) < ownDistance - 0.01)) { counts.nearer++; }
                });
            }
            console.log(`${crowded ? 'crowded' : 'spread'} placement counts`, counts);
            expect([counts.outside, counts.distant, counts.own]).toEqual([0, 0, 0]);
            expect(counts.overlaps).toBe(0);
            expect(counts.nearer).toBeLessThanOrEqual(crowded ? 154 : 0);
        }
    });
    it('keeps the reviewers’ edge labels off their own rings and ordered', () => {
        for (const [width, points] of [[235, [[20, 4], [26, 4]]], [100, [[6, 81], [6, 93], [18, 93]]]] as [number, number[][]][]) {
            const svg = changesMarks(changesView(found(points.map(([x, y], i) => cand(String(i), x!, y!, 'Spot (candidate).')), [])), width, width);
            const marks = [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"\/><text x="([^"]+)" y="([^"]+)" font-size="([^"]+)"/g)];
            for (const m of marks) {
                const [cx, cy, r, x, y, size] = m.slice(1).map(Number) as [number, number, number, number, number, number];
                const half = size * 0.35 + 1;
                expect(x + half <= cx - r || x - half >= cx + r || y + 1 <= cy - r || y - size - 1 >= cy + r).toBe(true);
            }
            if (width === 235) { expect(Number(marks[0]![4])).toBeLessThan(Number(marks[1]![4])); }
        }
    });
    it('keeps the five-spot review case near each own ring', () => {
        const points = [[15, 82], [15, 82], [50, 90], [54, 90], [54, 90]];
        const svg = changesMarks(changesView(found(points.map(([x, y], i) => cand(String(i), x!, y!, 'Spot (candidate).')), [])), 100, 100);
        const marks = [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"\/><text x="([^"]+)" y="([^"]+)" font-size="([^"]+)"/g)];
        for (const m of marks) {
            const [cx, cy, r, x, y, size] = m.slice(1).map(Number) as [number, number, number, number, number, number];
            const half = size * 0.35 + 1;
            const gap = Math.max(0, cx - r - (x + half), x - half - cx - r, cy - r - (y + 1), y - size - 1 - cy - r);
            expect(gap).toBeLessThanOrEqual(size + 0.1);
        }
    });
    it('keeps labels outside other rings in the bottom pair and three-spot cluster', () => {
        for (const points of [[[100, 230], [104, 230]], [[100, 230], [104, 230], [108, 230]]]) {
            const svg = changesMarks(changesView(found(points.map(([x, y], i) => cand(String(i), x!, y!, 'Spot (candidate).')), [])), 235, 235);
            const rings = [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"\/><text x="([^"]+)" y="([^"]+)" font-size="([^"]+)"/g)];
            expect(rings).toHaveLength(points.length);
            for (let i = 0; i < rings.length; i++) {
                const [x, y, size] = [Number(rings[i]![4]), Number(rings[i]![5]), Number(rings[i]![6])];
                const half = size * 0.35 + 1;
                for (let j = 0; j < rings.length; j++) {
                    if (i === j) { continue; }
                    const [cx, cy, radius] = [Number(rings[j]![1]), Number(rings[j]![2]), Number(rings[j]![3])];
                    expect(x + half <= cx - radius || x - half >= cx + radius || y + 1 <= cy - radius || y - size - 1 >= cy + radius).toBe(true);
                }
            }
        }
    });

    it('keeps a lone label inside the top and left edges', () => {
        for (const [x, y] of [[100, 13], [2, 100]]) {
            const svg = changesMarks(changesView(found([cand('a', x!, y!, 'Spot (candidate).')], [])), 235, 235);
            const m = /<text x="([^"]+)" y="([^"]+)" font-size="([^"]+)"/.exec(svg)!;
            const px = Number(m[1]), py = Number(m[2]), size = Number(m[3]);
            expect(px - size * 0.35 - 1).toBeGreaterThanOrEqual(-0.05);
            expect(px + size * 0.35 + 1).toBeLessThanOrEqual(235.05);
            expect(py - size - 1).toBeGreaterThanOrEqual(-0.05);
            expect(py + 1).toBeLessThanOrEqual(235.05);
        }
    });
    it('keeps a lone mark unchanged and separates overlapping numbers', () => {
        const first = cand('a', 50, 50, 'A (candidate).');
        const one = changesView(found([first], []));
        expect(changesMarks(one, 100, 100)).toBe('<svg class="sk-chg-marks" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50.0" cy="50.0" r="5.0"/><text x="50.0" y="42.5" font-size="8.0">1</text></svg>');
        const both = changesMarks(changesView(found([first, cand('b', 54, 50, 'B (candidate).')], [])), 100, 100);
        expect(both).toBe('<svg class="sk-chg-marks" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50.0" cy="50.0" r="5.0"/><text x="50.0" y="42.5" font-size="8.0">1</text><circle cx="54.0" cy="50.0" r="5.0"/><text x="54.0" y="65.1" font-size="8.0">2</text></svg>');
    });

    it('finds clear alternatives when the lower position is outside the picture', () => {
        const items = [cand('a', 50, 90, 'A (candidate).'), cand('b', 54, 90, 'B (candidate).'), cand('c', 54, 90, 'C (candidate).')];
        const svg = changesMarks(changesView(found(items, [])), 100, 100);
        expect([...svg.matchAll(/<text x="([^"]+)" y="([^"]+)" font-size="[^"]+">(\d+)<\/text>/g)]
            .map(match => [match[1], match[2], match[3]])).toEqual([['50.0', '82.5', '1'], ['63.9', '94.0', '2'], ['63.9', '82.9', '3']]);
        expect([...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)"/g)].map(match => [match[1], match[2]]))
            .toEqual([['50.0', '90.0'], ['54.0', '90.0'], ['54.0', '90.0']]);
    });

    it('draws one ring per end at the finder\'s aperture, numbered like the list', () => {
        const pair = { ...cand('p', 40, 20, 'Two spots (candidate).'), reading: 'pair' as const,
            ends: [{ visit: 'earlier' as const, x: 30, y: 20, radiusPix: 4 }, { visit: 'later' as const, x: 50, y: 20, radiusPix: 1 }] };
        const svg = changesMarks(changesView(found([pair], [])), 200, 100);
        expect(svg.match(/<circle/g)).toHaveLength(2);
        expect(svg).toContain('<circle cx="30.0" cy="20.0" r="4.0"/>');
        // A tiny aperture is drawn at 3 px so the ring stays visible.
        expect(svg).toContain('<circle cx="50.0" cy="20.0" r="3.0"/>');
        expect(svg.match(/<text [^>]*>1<\/text>/g)).toHaveLength(2);
    });

    it('falls back to the candidate position when no end has a usable place', () => {
        const odd = { ...cand('o', 40, 20, 'Spot (candidate).'), ends: [{ visit: 'later' as const, x: NaN, y: 20, radiusPix: 4 }] };
        const svg = changesMarks(changesView(found([odd], [])), 200, 100);
        expect(svg).toContain('<circle cx="40.0" cy="20.0" r="5.0"/>');
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
        expect(changesHtml(changesView(found([a, b], [])))).toContain('Listed in groups, each by S/N, highest first: spots away from catalogue stars, then spots near catalogue stars.');
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

describe('plain list (compareVisits plain: true)', () => {
    it('folds the near-star suffix and keeps prefix numbers and rings', () => {
        const list = [false, false, true].map((nearCatalogue, i) => ({ ...cand(String(i), 20 + i * 30, 30, `spot ${i} (candidate).`), reading: 'unclear' as const, nearCatalogue }));
        const v = changesView({ ...found(list, []), plainListInfo: { usedErrorMap: true, matchArcsec: 6 } });
        expect(changesHtml(v)).toContain('1 more spot lies within 6″ of a catalogue star.');
        expect(changesHtml(v)).toContain('Show all 3');
        expect(changesHtml(v)).not.toContain('Candidate 3');
        expect(changesHtml(v, true)).toContain('Candidate 3');
        expect(changesMarks(v, 235, 235).match(/<circle/g)).toHaveLength(2);
    });
    it('joins a chain of nearby different candidates into one label', () => {
        const list = [50, 57, 64].map((x, i) => ({ ...cand(String(i), x, 60, 'spot'), reading: 'unclear' as const, ends: [{ visit: 'later' as const, x, y: 60, radiusPix: 7.8 }] }));
        const svg = changesMarks(changesView(found(list, [])), 235, 235);
        expect(svg.match(/<circle/g)).toHaveLength(3);
        expect(svg.match(/<text/g)).toHaveLength(1);
        expect(svg).toContain('>1, 2, 3</text>');
    });
    it('shares identical plain causes while retaining candidate details', () => {
        const causes = "a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this";
        const line = `The light differs; ${causes} (S/N 9.0; candidate).`;
        const v = changesView(found([{ ...cand('a', 20, 20, line), reading: 'unclear' }], []));
        expect(changesHtml(v)).toContain(`For every spot listed: ${causes}.`);
        expect(changesHtml(v)).toContain('The light differs (S/N 9.0; candidate).');
        const hidden = changesView({ ...found([{ ...cand('a', 20, 20, line), reading: 'unclear', nearCatalogue: true }], []), plainListInfo: { usedErrorMap: true, matchArcsec: 6 } });
        expect(changesHtml(hidden)).toContain(`For every spot listed: ${causes}.`);
        expect(changesHtml(hidden)).not.toContain('<ol');
    });
    it('keeps every line whole when any cause clause is absent or repeated', () => {
        const causes = "a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this";
        const full = `Here; ${causes} (candidate).`;
        for (const other of ['Different (candidate).', `${full}; ${causes} (candidate).`]) {
            const v = changesView(found([full, other].map((line, i) => ({ ...cand(String(i), i * 20, 20, line), reading: 'unclear' as const })), []));
            expect(changesHtml(v)).not.toContain('For every spot listed:');
            expect(changesHtml(v)).toContain(full);
        }
    });
    it('describes several hidden stars, a capped mixed suffix, and all stars', () => {
        const view = (flags: boolean[]) => changesView({ ...found(flags.map((nearCatalogue, i) => ({ ...cand(String(i), 10 + i * 10, 30, `spot ${i}`), reading: 'unclear' as const, nearCatalogue })), []), plainListInfo: { usedErrorMap: true, matchArcsec: 6 } });
        expect(changesHtml(view([false, true, true]))).toContain('2 more spots lie within 6″ of a catalogue star.');
        const capped = view([...Array(9).fill(false), true, true]);
        expect(changesHtml(capped)).toContain('3 more not shown; 2 of them lie within 6″ of a catalogue star.');
        expect(changesHtml(capped)).toContain('Candidate 8');
        expect(changesHtml(capped)).not.toContain('Candidate 9');
        expect(changesHtml(capped, true)).toContain('Candidate 9');
        expect(changesHtml(view(Array(10).fill(false)))).toContain('2 more not shown.');
        const stars = changesHtml(view([true, true]));
        expect(stars).toContain('Every spot found lies within 6″ of a catalogue star.');
        expect(stars).toContain('2 spots lie within 6″ of a catalogue star.');
        expect(stars).not.toContain('<ol');
    });
    it('joins all three observed separations with width for the joint label', () => {
        for (const distance of [4.3, 3.2, 4.9]) {
            const list = [60, 60 + distance].map((x, i) => ({ ...cand(String(i), x, 60, 'spot'), reading: 'unclear' as const, ends: [{ visit: 'later' as const, x, y: 60, radiusPix: 7.8 }] }));
            const svg = changesMarks(changesView(found(list, [])), 235, 235);
            expect(svg.match(/<circle/g)).toHaveLength(2);
            expect(svg.match(/<text/g)).toHaveLength(1);
            expect(svg).toContain('>1, 2</text>');
            const text = /<text x="([^"]+)" y="([^"]+)" font-size="([^"]+)">/.exec(svg)!;
            expect(Number(text[1]) - (Number(text[3]) * 4 * 0.35 + 1)).toBeGreaterThanOrEqual(0);
        }
        const edge = [0, 2, 4].map((x, i) => ({ ...cand(String(i), x, 1, 'spot'), reading: 'unclear' as const, ends: [{ visit: 'later' as const, x, y: 1, radiusPix: 7.8 }] }));
        const m = /<text x="([^"]+)" y="([^"]+)" font-size="([^"]+)">1, 2, 3<\/text>/.exec(changesMarks(changesView(found(edge, [])), 235, 235))!;
        expect(Number(m[1]) - (Number(m[3]) * 7 * 0.35 + 1)).toBeGreaterThanOrEqual(0);
    });
    it('puts a large-ring label outside its box and the top-edge label below', () => {
        const make = (x: number, y: number, radiusPix: number) => changesMarks(changesView(found([{ ...cand('a', x, y, 'spot'), reading: 'unclear', ends: [{ visit: 'later', x, y, radiusPix }] }], [])), 235, 235);
        const large = /<text x="([^"]+)" y="([^"]+)" font-size="([^"]+)">/.exec(make(117, 117, 60))!;
        const [x, y, s] = large.slice(1).map(Number) as [number, number, number];
        expect(x + s * 0.35 + 1 <= 57 || x - s * 0.35 - 1 >= 177 || y + 1 <= 57 || y - s - 1 >= 177).toBe(true);
        const top = /<text x="[^"]+" y="([^"]+)"/.exec(make(117, 3, 235 / 40))!;
        expect(Number(top[1])).toBeGreaterThan(3 + 5.9 + 9.4 + 1);
        const threshold = /<text x="[^"]+" y="([^"]+)"/.exec(make(117, 18.2, 235 / 40))!;
        expect(Number(threshold[1])).toBeGreaterThan(18.2 + 5.9);
    });
    it('checks 500 seeded layouts for bounds, unique ring numbers, overlaps and placement fallbacks', () => {
        let seed = 72931;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const layouts = { preferred: 0, soft: 0, hard: 0, apart: 0, grid: 0, last: 0, nearer: 0 };
        for (let trial = 0; trial < 500; trial++) {
            const n = 1 + Math.floor(random() * 8), anchor = [[0, 0], [234, 0], [0, 234], [234, 234], [117, 117]][trial % 5]!;
            const cs = Array.from({ length: n }, (_, i) => {
                const x = Math.max(0, Math.min(234, trial % 3 ? anchor[0]! + (random() - 0.5) * 32 : random() * 234));
                const y = Math.max(0, Math.min(234, trial % 3 ? anchor[1]! + (random() - 0.5) * 32 : random() * 234));
                const ends = [{ visit: 'later' as const, x, y, radiusPix: 7.8 }];
                if (trial % 7 === 0 && i === 0) { ends.push({ visit: 'later', x: 234 - x, y: 234 - y, radiusPix: 7.8 }); }
                return { ...cand(String(i), x, y, 'spot'), reading: 'unclear' as const, ends };
            });
            const counts = { preferred: 0, soft: 0, hard: 0, apart: 0, grid: 0, last: 0 };
            const svg = plainMarks(changesView(found(cs, [])), 235, 235, false, counts);
            for (const key of Object.keys(counts) as (keyof typeof counts)[]) { if (counts[key]) { layouts[key]++; } }
            const labels = [...svg.matchAll(/<text x="([^"]+)" y="([^"]+)" font-size="([^"]+)">([^<]+)<\/text>/g)].map(m => {
                const x = Number(m[1]), y = Number(m[2]), s = Number(m[3]), ids = m[4]!.split(', ').map(Number), half = s * m[4]!.length * 0.35 + 1;
                return { x, y, s, ids, left: x - half, right: x + half, top: y - s - 1, bottom: y + 1 };
            });
            const intersects = (a: typeof labels[number], b: typeof labels[number]) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
            let nearer = false;
            labels.forEach((label, i) => {
                expect(label.left).toBeGreaterThanOrEqual(0); expect(label.right).toBeLessThanOrEqual(235);
                expect(label.top).toBeGreaterThanOrEqual(0); expect(label.bottom).toBeLessThanOrEqual(235);
                expect(labels.slice(0, i).some(other => intersects(label, other))).toBe(false);
                const distance = (e: { x: number; y: number }) => Math.hypot(label.x - e.x, label.y - label.s / 2 - e.y);
                const own = Math.min(...label.ids.flatMap(id => cs[id - 1]!.ends.map(distance)));
                if (cs.some((c, j) => !label.ids.includes(j + 1) && c.ends.some(e => distance(e) < own - 0.01))) { nearer = true; }
            });
            cs.forEach((c, i) => expect(labels.filter(l => l.ids.includes(i + 1)).length).toBe(c.ends.length));
            if (nearer) { layouts.nearer++; }
        }
        console.log('500 layout counts', layouts);
    });
    it('P2 prints each new sentence exactly and strips only its S/N figure', () => {
        const ending = "a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this";
        for (const [reading, start] of [
            ['moreLater', 'Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one'],
            ['lessLater', 'Measured against the change in the sky around it, there is less light here in the later visit than in the earlier one'],
            ['unclear', 'The light here differs between the two visits, and which visit has more is not clear'],
        ] as const) {
            const sentence = `${start}; ${ending} (S/N 9.0; candidate). A catalogue star lies 8.0″ away.`;
            expect(stripSnr(sentence)).toBe(`${start}; ${ending} (candidate). A catalogue star lies 8.0″ away.`);
            expect(hasSnrFigure(sentence)).toBe(true);
            expect(hasSnrFigure(stripSnr(sentence))).toBe(false);
            const c = { ...cand('p', 10, 10, sentence), reading, sentence };
            expect(changesHtml(changesView(found([c], [])))).toBe(`<p class="sk-chg-lead">For every spot listed: ${ending}.</p><ol class="sk-chg"><li><b>Candidate 1</b> ${start} (S/N 9.0; candidate). A catalogue star lies 8.0″ away.</li></ol>`);
        }
    });
    it('places the confirmation note before the shared caveat and list', () => {
        const c = { ...cand('p', 10, 10, 'The light differs (candidate).'), reading: 'unclear' as const,
            caveat: 'Each visit has fewer than 3 frames, so a detector hit cannot be ruled out.' };
        const v = changesView(found([c], ['Every spot listed is a candidate only; this page cannot tell which, if any, are real changes in the sky.']));
        expect(changesHtml(v)).toBe('<p class="sk-chg-lead">Every spot listed is a candidate only; this page cannot tell which, if any, are real changes in the sky.</p><p class="sk-chg-lead">Each visit has fewer than 3 frames, so a detector hit cannot be ruled out.</p><ol class="sk-chg"><li><b>Candidate 1</b> The light differs (candidate).</li></ol>');
        expect(changesMarks(v, 100, 100)).toBe(changesMarks(changesView(found([{ ...c, reading: 'moreLater' }], [])), 100, 100));
    });
    const plain = (id: string, snr: number, reading: 'moreLater' | 'lessLater', near: boolean) => ({ ...cand(id, 10 + snr, 10, `${id} (candidate).`), snr, reading, nearCatalogue: near,
        ends: [{ visit: reading === 'moreLater' ? 'later' as const : 'earlier' as const, x: 10 + snr, y: 10, radiusPix: 4 }] }) as unknown as ChangeCandidate;
    // (cast: the plain readings join ChangeReading with -b3's plain mode)

    it('keeps the finder\'s order and adds no order sentence; the button still shows', () => {
        // The finder's own order (away from catalogue stars first); the panel would otherwise sort by S/N.
        const list = [plain('a', 5, 'moreLater', false), plain('b', 9, 'lessLater', false), plain('c', 20, 'moreLater', true),
            ...Array.from({ length: 7 }, (_, i) => plain(`d${i}`, 6, 'lessLater', true))];
        const v = changesView(found(list, ['Listed with spots away from catalogue stars first.']));
        expect(v.candidates.map((c) => c.id).slice(0, 3)).toEqual(['a', 'b', 'c']);
        const html = changesHtml(v);
        expect(html).not.toContain('Listed in groups');
        expect(html).not.toContain('Listed by');
        expect(html).toContain('<p class="sk-chg-more-row"><button type="button" class="sk-chg-more" data-chg-more aria-expanded="false">Show 2 more</button></p>');
        expect(html).toContain('<li>Listed with spots away from catalogue stars first.</li>');
        expect(changesMarks(v, 200, 100).match(/<circle/g)).toHaveLength(8);
    });

    it('a short plain list has no order row at all', () => {
        const html = changesHtml(changesView(found([plain('a', 5, 'moreLater', false), plain('c', 20, 'moreLater', true)], [])));
        expect(html).not.toContain('sk-chg-more-row');
    });
});
