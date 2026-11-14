import { describe, expect, it, vi } from 'vitest';
import { plainListNotes } from '../src/lib/changes';
import type { ChangeCandidate, VisitChangeResult } from '../src/lib/changes';
import type { OutputGrid, RangeReader, RegriddedFrame, Wcs } from '../src/lib/types';
import type { SkyResult } from '../src/lib/source';
import { gridSkyToPix } from '../src/lib/regrid';
import { nativePeak, readFrameFlags, screen } from '../src/ui/flag-screen';
import { MAPS_NOTE, mountChanges, type SlotView } from '../src/ui/slots';

const candidate = { id: 'a', kind: 'brightness', pix: { x: 1, y: 1 }, sign: 1,
    gaiaMatch: false, reason: 'A spot appeared.' } as ChangeCandidate;
const earlier = { frame: { obsId: 'early' } } as RegriddedFrame;
const later = { frame: { obsId: 'late' } } as RegriddedFrame;

describe('archive flag screen', () => {
    it('leaves out a spot flagged in its light visit', () => {
        const flags = new Map([['early', { obsId: 'early', names: () => [] }],
            ['late', { obsId: 'late', names: () => ['TRANSIENT'] }]]);
        const result = screen([candidate], { earlier: [earlier], later: [later] }, flags, ['TRANSIENT']);
        expect(result.kept).toHaveLength(0);
        expect(result.dropNote).toBe('1 candidate is not listed: in at least one frame of the visit where its spot shows more light, that frame’s brightest pixel within 12″ of that spot carries the archive flag TRANSIENT.');
    });

    it('uses the light visit, header order, and lets a drop win over unread', () => {
        const flags = new Map([['early', { obsId: 'early', names: (p: { x: number }) => p.x === 1 ? ['NONFUNC'] : ['OUTLIER'] }],
            ['late', null]]);
        const a = { ...candidate, sign: -1 as const };
        const b = { ...a, id: 'b', pix: { x: 2, y: 1 } };
        const r = screen([a, b], { earlier: [earlier], later: [later] }, flags, ['OUTLIER', 'NONFUNC']);
        expect(r.dropNote).toBe('2 candidates are not listed: for each, in at least one frame of the visit where its spot shows more light, that frame’s brightest pixel within 12″ of that spot carries at least one of these archive flags: OUTLIER, NONFUNC.');
        expect(r.kept).toHaveLength(0);
        expect(screen([candidate], { earlier: [earlier], later: [later] }, flags, []).kept).toHaveLength(1);
    });

    it('replaces brightness wording for OVERFLOW but appends for movers', () => {
        const flags = new Map([['early', { obsId: 'early', names: () => ['OVERFLOW'] }],
            ['late', { obsId: 'late', names: () => [] }]]);
        const r = screen([candidate, { ...candidate, id: 'b', kind: 'mover', gaiaMatch: true }],
            { earlier: [earlier], later: [later] }, flags, []);
        expect(r.kept[0]!.line).toBe('The two visits differ here (candidate). In at least one frame of the earlier visit, the archive flags that frame’s brightest pixel within 12″ of the spot as OVERFLOW, so the finder’s reading here is not shown; an overflowing pixel can make the reading here unreliable.');
        // A mover's light is only in its light visit (later here), so the earlier visit's OVERFLOW is not its own.
        expect(r.kept[1]!.line).toBe('A spot appeared.');
        flags.set('late', { obsId: 'late', names: () => ['OVERFLOW'] });
        const both = screen([candidate, { ...candidate, id: 'b', kind: 'mover' }], { earlier: [earlier], later: [later] }, flags, []);
        expect(both.kept[0]!.line).toContain('In at least one frame of each visit');
        expect(both.kept[1]!.line).toBe('A spot appeared. In at least one frame of the later visit, the archive flags that frame’s brightest pixel within 12″ of the spot as OVERFLOW; an overflowing pixel can make the reading here unreliable.');
        // A sentence with no brighter/fainter reading keeps its words and gets the flag sentence added.
        const plain = screen([{ ...candidate, reason: 'Changed at S/N 7.0 (candidate).', reading: 'differs' as const }], { earlier: [earlier], later: [later] }, flags, []);
        expect(plain.kept[0]!.line).toBe('Changed at S/N 7.0 (candidate). In at least one frame of each visit, the archive flags that frame’s brightest pixel within 12″ of the spot as OVERFLOW; an overflowing pixel can make the reading here unreliable.');
        const snr = screen([{ ...candidate, snr: 12, reading: 'brighter' as const, reason: 'A catalogue star here is brighter than in the earlier image (S/N 12.0; candidate).' }],
            { earlier: [earlier], later: [later] }, flags, []);
        expect(snr.kept[0]!.line).toBe('The two visits differ here, at S/N 12.0 (candidate). In at least one frame of each visit, the archive flags that frame’s brightest pixel within 12″ of the spot as OVERFLOW, so the brightness comparison is not shown; an overflowing pixel can make the reading here unreliable.');
        for (const c of [...r.kept, ...both.kept, ...plain.kept, ...snr.kept]) {
            expect(c.line.replace(c.reason, '')).not.toMatch(/discovery|detected|confirmed|proves|changed|brighter/i);
        }
    });

    it('combines unread and caveat leads only when shared by all listed spots', () => {
        const flags = new Map([['early', { obsId: 'early', names: (p: { x: number }) => p.x === 1 ? null : [] }],
            ['late', { obsId: 'late', names: () => [] }]]);
        const a = { ...candidate, caveat: 'Shared caveat.' };
        const b = { ...a, id: 'b', pix: { x: 2, y: 1 } };
        const r = screen([a, b], { earlier: [earlier], later: [later] }, flags, []);
        expect(r.lead).toEqual(['Shared caveat.']);
        expect(r.kept[0]!.line).toContain('Some of the archive flags for this spot could not be read, so that check is incomplete.');
        expect(r.kept[1]!.line).not.toContain('Shared caveat.');
        const all = screen([a, { ...b, caveat: 'Other caveat.' }], { earlier: [earlier], later: [later] }, new Map(), []);
        expect(all.lead).toEqual(['The archive flags could not be read for the listed spots, so they are listed without that check.']);
        expect(all.kept[0]!.line).toBe('A spot appeared. Shared caveat.');
        expect(all.kept[1]!.line).toBe('A spot appeared. Other caveat.');
    });
});

const grid: OutputGrid = { width: 40, height: 40, pixelArcsec: 6.15, center: { ra: 150, dec: 2 }, fovDeg: 0.07 };
function frame(id: string, time: number): RegriddedFrame
{
    const data = new Float32Array(1600).fill(NaN);
    data[10 * 40 + 10] = 5;
    return { frame: { obsId: id, tMin: time, tMax: time }, grid, data, lambdaAtCenter: 1, bandwidthAtCenter: 0.1,
        context: { url: id, box: { x0: 100, y0: 200, x1: 140, y1: 240 },
            wcs: { skyToPix: (s: OutputGrid['center']) => { const p = gridSkyToPix(grid, s); return { x: p.x + 100.25, y: p.y + 200.25 }; } } as Wcs,
            flags: { layout: {} as never, names: [{ bit: 0, name: 'TRANSIENT' }] } } } as unknown as RegriddedFrame;
}

describe('native frame reads', () => {
    it('selects the brightest of four native pixels after subtracting ZODI', () => {
        const f = frame('a', 0);
        const image = new Float32Array(1600);
        const zodi = new Float32Array(1600);
        image[10 * 40 + 10] = 9;
        zodi[10 * 40 + 10] = 8;
        image[11 * 40 + 11] = 4;
        expect(nativePeak(f, image, zodi, { x: 10, y: 10 })).toEqual({ x: 111, y: 211 });
    });

    it('turns failed reads and missing context into unread', async () => {
        const f = frame('a', 0);
        const reader = { index: async () => { throw new Error('offline'); } } as unknown as RangeReader;
        expect(await readFrameFlags(f, { reader, readFlags: vi.fn(), signal: new AbortController().signal })).toBeNull();
        delete f.context;
        expect(await readFrameFlags(f, { reader, readFlags: vi.fn(), signal: new AbortController().signal })).toBeNull();
    });

    it('reads the flag at the selected native pixel in header order', async () => {
        const f = frame('a', 0);
        f.context!.flags!.names = [{ bit: 3, name: 'OUTLIER' }, { bit: 1, name: 'NONFUNC' }];
        const image = new Float32Array(1600);
        image[11 * 40 + 11] = 7;
        const data = new Int32Array(1600);
        data[11 * 40 + 11] = (1 << 1) | (1 << 3);
        const reader = { index: async () => ({}), readFloat32: async (_i: unknown, name: string) => name === 'IMAGE' ? image : new Float32Array(1600) } as unknown as RangeReader;
        const entry = await readFrameFlags(f, { reader, readFlags: vi.fn(async () => ({ data, width: 40, height: 40 })), signal: new AbortController().signal });
        expect(entry?.names({ x: 10, y: 10 })).toEqual(['OUTLIER', 'NONFUNC']);
    });
});

function sky(frames: RegriddedFrame[]): SkyResult
{
    return { grid, frames: frames.map(f => ({ frame: f, label: '' })) } as SkyResult;
}

function found(result: SkyResult): VisitChangeResult
{
    const first = result.frames[0]!.frame.frame;
    const last = result.frames[result.frames.length - 1]!.frame.frame;
    return { candidates: [{ ...candidate, pix: { x: 10, y: 10 } }, { ...candidate, id: 'b', pix: { x: 20, y: 20 } }],
        sigma: 1, notes: ['Finder note.'], visits: { earlier: { obsIds: [first.obsId], mjd: first.tMin },
            later: { obsIds: [last.obsId], mjd: last.tMin } } } as VisitChangeResult;
}

describe('change slot', () => {
    it('rebuilds plain list notes after archive flags remove spots', async () => {
        for (const all of [false, true]) {
            const a = frame('a', 0), b = frame('b', 20);
            a.data[20 * 40 + 20] = b.data[20 * 40 + 20] = 5;
            const find = (result: SkyResult): VisitChangeResult => {
                const value = found(result);
                value.candidates = value.candidates.map(c => ({ ...c, reading: 'moreLater', kind: 'unknown', snrMapMissing: true,
                    reason: 'More light here (candidate).', sentence: 'More light here (candidate).' }));
                value.plainListInfo = { usedErrorMap: true, matchArcsec: 6 };
                value.notes = ['Every spot listed is a candidate only; this page cannot tell which, if any, are real changes in the sky.',
                    'Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise estimated from the difference image; that figure is used only for this order.',
                    "S/N is left out for 2 candidates where the frames' error maps have no value, because the noise there comes from the difference image alone."];
                return value;
            };
            const reader = { index: async () => ({}), readFloat32: async () => new Float32Array(1600) } as unknown as RangeReader;
            const read = vi.fn(async (url: string) => {
                const data = new Int32Array(1600);
                if (url === 'b') { data[10 * 40 + 10] = 1; if (all) { data[20 * 40 + 20] = 1; } }
                return { data, width: 40, height: 40 };
            });
            const onChange = vi.fn(), box = {} as HTMLElement, marks = {} as HTMLElement;
            const slot = mountChanges(onChange, { find, reader, read, variance: async () => null });
            const view = { source: 'live', result: sky([a, b]), index: 0, mode: 'blink' } as SlotView;
            slot.render(box, marks, view);
            await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
            slot.render(box, marks, view);
            if (all) {
                expect(box.innerHTML.includes('Listed with spots')).toBe(false);
                expect(box.innerHTML.includes('S/N is left out')).toBe(false);
                expect(box.innerHTML.includes('Every spot listed')).toBe(false);
            } else {
                expect(box.innerHTML.includes("S/N is left out for 1 candidate where the frames' error maps have no value, because the noise there comes from the difference image alone.")).toBe(true);
            }
        }
    });
    it('keeps the plain confirmation note above the caveat after screening', () => {
        const find = (result: SkyResult): VisitChangeResult => {
            const value = found(result);
            value.candidates = [{ ...value.candidates[0]!, reading: 'unclear', reason: 'Plain spot (candidate).', sentence: 'Plain spot (candidate).',
                caveat: 'Each visit has fewer than 3 frames, so a detector hit cannot be ruled out.' }];
            value.notes = ['Every spot listed is a candidate only; this page cannot tell which, if any, are real changes in the sky.'];
            return value;
        };
        const a = frame('a', 0), b = frame('b', 20);
        delete a.context; delete b.context;
        const box = {} as HTMLElement;
        mountChanges(vi.fn(), { find }).render(box, {} as HTMLElement, { source: 'snapshot', result: sky([a, b]), index: 0, mode: 'blink' });
        expect(box.innerHTML).toBe('<p class="sk-chg-lead">Every spot listed is a candidate only; this page cannot tell which, if any, are real changes in the sky.</p><p class="sk-chg-lead">Archive flags are not checked in a saved view, so these spots are listed without that check.</p><p class="sk-chg-lead">Each visit has fewer than 3 frames, so a detector hit cannot be ruled out.</p><ol class="sk-chg"><li><b>Candidate 1</b> Plain spot (candidate).</li></ol>');
    });
    it('shows the finder at once, then updates once with screened marks', async () => {
        const a = frame('a', 0);
        const b = frame('b', 20);
        a.data[20 * 40 + 20] = b.data[20 * 40 + 20] = 5;
        const reader = { index: async (url: string) => ({ url }), readFloat32: async () => new Float32Array(1600) } as unknown as RangeReader;
        let release = () => {};
        const gate = new Promise<void>(resolve => { release = resolve; });
        const read = vi.fn(async (url: string) => {
            await gate;
            const data = new Int32Array(1600);
            if (url === 'b') {
                data[10 * 40 + 10] = 1;
            }
            return { data, width: 40, height: 40 };
        });
        const onChange = vi.fn();
        const slot = mountChanges(onChange, { reader, read, find: found, variance: async () => null });
        const v = { source: 'live', result: sky([a, b]), index: 0, mode: 'blink' } as SlotView;
        const box = {} as HTMLElement;
        const marks = {} as HTMLElement;
        slot.render(box, marks, v);
        expect(box.innerHTML).toBe(`<ul class="sk-chg-notes"><li>${MAPS_NOTE}</li></ul>`);
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
        slot.render(box, marks, v);
        expect(box.innerHTML).toContain('Checking the archive flags for these spots; the list and its numbers may update.');
        expect(box.innerHTML).toContain('Error maps could not be read for 2 frames.');
        expect(box.innerHTML).toContain('Candidate 2');
        release();
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
        slot.render(box, marks, v);
        expect(box.innerHTML).toContain('1 candidate is not listed');
        expect(box.innerHTML).not.toContain('Candidate 2');
        expect(marks.innerHTML.match(/<circle/g)).toHaveLength(1);
        expect(marks.innerHTML).toContain('>1</text>');
    });

    it('times out uncooperative reads and aborts on a new result', async () => {
        const signals: AbortSignal[] = [];
        const reader = { index: (_url: string, signal: AbortSignal) => { signals.push(signal); return new Promise(() => {}); } } as unknown as RangeReader;
        const onChange = vi.fn();
        const slot = mountChanges(onChange, { reader, find: found, timeoutMs: 5 });
        const box = {} as HTMLElement;
        const marks = {} as HTMLElement;
        const v = { source: 'live', result: sky([frame('a', 0), frame('b', 20)]), index: 0, mode: 'blink' } as SlotView;
        slot.render(box, marks, v);
        const next = { ...v, result: sky([frame('c', 0), frame('d', 20)]) };
        slot.render(box, marks, next);
        expect(signals[0]!.aborted).toBe(true);
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
        slot.render(box, marks, next);
        expect(box.innerHTML).toContain('The archive flags could not be read for the listed spots, so they are listed without that check.');
        expect(box.innerHTML).not.toContain('Checking the archive');
    });

    it('resolves saved frames immediately without reads', () => {
        const reader = { index: vi.fn() } as unknown as RangeReader;
        const find = vi.fn(found);
        const slot = mountChanges(vi.fn(), { reader, find });
        const a = frame('a', 0);
        const b = frame('b', 20);
        delete a.context;
        delete b.context;
        const box = {} as HTMLElement;
        const result = sky([a, b]);
        slot.render(box, {} as HTMLElement, { source: 'snapshot', result, index: 0, mode: 'blink' });
        expect(box.innerHTML).toContain('Archive flags are not checked in a saved view, so these spots are listed without that check.');
        // Leaving for the demo and coming back reuses the finished panel.
        expect(slot.render(box, {} as HTMLElement, { source: 'demo', result, index: 0, mode: 'blink' })).toBe(false);
        slot.render(box, {} as HTMLElement, { source: 'snapshot', result, index: 0, mode: 'blink' });
        expect(find).toHaveBeenCalledTimes(1);
        expect(box.innerHTML).not.toContain('Checking the archive');
        expect(reader.index).not.toHaveBeenCalled();
    });
});

describe('fields the finder is adding', () => {
    it('prefers sentence, lightVisit and a shared caveat when present', async () => {
        const { changesView, changesHtml } = await import('../src/ui/changes-view');
        const base = { kind: 'unknown' as const, sky: { ra: 0, dec: 0 }, snr: 7, sign: 1 as const, gaiaMatch: false, frames: [] };
        const found = {
            candidates: [
                { ...base, id: 'a', pix: { x: 1, y: 1 }, reason: 'Old A (candidate).', sentence: 'New A (candidate).', caveat: 'The earlier visit is one frame.', lightVisit: 'earlier' as const },
                { ...base, id: 'b', pix: { x: 2, y: 2 }, reason: 'Old B (candidate).', sentence: 'New B (candidate).', caveat: 'The earlier visit is one frame.' },
            ],
            rejected: { streaks: 0, single: 0, edge: 0, residual: 0 }, sigma: 1, threshold: 5, skipped: [], notes: [],
            visits: { earlier: { obsIds: ['e1'], mjd: 1 }, later: { obsIds: ['l1'], mjd: 30 } },
        };
        const v = changesView(found);
        expect(v.visits?.later.obsIds).toEqual(['l1']);
        const html = changesHtml(v);
        expect(html.indexOf('The earlier visit is one frame.')).toBeLessThan(html.indexOf('<ol'));
        expect(html.match(/one frame/g)).toHaveLength(1);
        expect(html).toContain('New A (candidate).');
        expect(html).not.toContain('Old A');
    });
});

describe('light visit from the finder', () => {
    it('uses lightVisit over the sign when the finder gives it', () => {
        const flags = new Map([['early', { obsId: 'early', names: () => ['TRANSIENT'] }],
            ['late', { obsId: 'late', names: () => [] }]]);
        const c = { ...candidate, sign: 1 as const, lightVisit: 'earlier' as const };
        expect(screen([c], { earlier: [earlier], later: [later] }, flags, ['TRANSIENT']).kept).toHaveLength(0);
        expect(screen([{ ...c, lightVisit: 'later' as const }], { earlier: [earlier], later: [later] }, flags, ['TRANSIENT']).kept).toHaveLength(1);
    });
});

describe('review fixes', () => {
    it('counts a candidate as unread in full when no frame of its light visit was read', () => {
        const flags = new Map([['early', { obsId: 'early', names: () => [] }], ['late', null]]);
        const other = { ...candidate, id: 'z', sign: -1 as const };
        const r = screen([candidate, other], { earlier: [earlier], later: [later] }, flags, []);
        expect(r.kept[0]!.line).toBe('A spot appeared. The archive flags for this spot could not be read, so it is listed without that check.');
        expect(r.kept[1]!.line).toBe('A spot appeared. Some of the archive flags for this spot could not be read, so that check is incomplete.');
        const empty = screen([candidate], { earlier: [earlier], later: [] }, flags, []);
        expect(empty.allUnread).toBe(true);
    });

    it('names a catalogue star when it drops the direction for OVERFLOW', () => {
        const flags = new Map([['early', { obsId: 'early', names: () => ['OVERFLOW'] }], ['late', { obsId: 'late', names: () => [] }]]);
        const c = { ...candidate, gaiaMatch: true, snr: 60, reason: 'A catalogue star here is fainter than in the earlier image (S/N > 50; candidate).' };
        expect(screen([c], { earlier: [earlier], later: [later] }, flags, []).kept[0]!.line).toBe('The two visits differ here at a catalogue star, at S/N > 50 (candidate). In at least one frame of the earlier visit, the archive flags that frame’s brightest pixel within 12″ of the spot as OVERFLOW, so the finder’s reading here is not shown; an overflowing pixel can make the reading here unreliable.');
    });
});

describe('round 11: every end, and the finder\'s reading', () => {
    const pair = { ...candidate, id: 'p', kind: 'unknown' as const, snr: 9, reading: 'pair' as const, reason: 'Two spots (S/N 9.0; candidate).',
        ends: [{ visit: 'later' as const, x: 1, y: 1, radiusPix: 2 }, { visit: 'earlier' as const, x: 5, y: 1, radiusPix: 2 }] };
    const at = (x: number, names: string[]) => ({ obsId: '', names: (p: { x: number }) => (p.x === x ? names : []) });

    it('drops a pair when either end is flagged in its own visit, not in the other visit', () => {
        const flagged = new Map([['early', at(5, ['TRANSIENT'])], ['late', at(9, [])]]);
        const gone = screen([pair], { earlier: [earlier], later: [later] }, flagged, ['TRANSIENT']);
        expect(gone.kept).toHaveLength(0);
        expect(gone.dropNote).toBe('1 candidate is not listed: in at least one frame of the visit where its spot, or one of its two spots, shows more light, that frame’s brightest pixel within 12″ of that spot carries the archive flag TRANSIENT.');
        // The earlier end's place flagged only in the later visit: not that end's own visit.
        const elsewhere = new Map([['early', at(9, [])], ['late', at(5, ['TRANSIENT'])]]);
        expect(screen([pair], { earlier: [earlier], later: [later] }, elsewhere, ['TRANSIENT']).kept).toHaveLength(1);
    });

    it('keeps a pair\'s explanation and names one of its two spots for OVERFLOW', () => {
        const flags = new Map([['early', at(5, ['OVERFLOW'])], ['late', at(9, [])]]);
        const kept = screen([pair], { earlier: [earlier], later: [later] }, flags, []).kept[0]!;
        expect(kept.line).toBe('Two spots (S/N 9.0; candidate). In at least one frame of the earlier visit, the archive flags that frame’s brightest pixel within 12″ of its spot in that visit as OVERFLOW; an overflowing pixel can make the reading here unreliable.');
        expect(kept.kind).toBe('unknown');
    });

    it('withdraws a comparison reading for OVERFLOW and sets the kind to unknown', () => {
        const flags = new Map([['early', at(1, ['OVERFLOW'])], ['late', at(9, [])]]);
        const c = { ...candidate, kind: 'brightness' as const, snr: 6.25, reading: 'laterOnly' as const,
            reason: 'Light here in the later visit; the earlier visit shows none above its noise (S/N 6.3; candidate).' };
        const kept = screen([c], { earlier: [earlier], later: [later] }, flags, []).kept[0]!;
        expect(kept.line).toBe('The two visits differ here, at S/N 6.2 (candidate). In at least one frame of the earlier visit, the archive flags that frame’s brightest pixel within 12″ of the spot as OVERFLOW, so the brightness comparison is not shown; an overflowing pixel can make the reading here unreliable.');
        expect(kept.kind).toBe('unknown');
    });

    it('checks a two-visit mover at both light ends and keeps its moved line', () => {
        const mover = { ...candidate, id: 'm', kind: 'mover' as const, reading: 'moved' as const, reason: 'Moved (candidate).',
            lightEnds: [{ visit: 'earlier' as const, x: 1, y: 1, radiusPix: 2 }, { visit: 'later' as const, x: 5, y: 1, radiusPix: 2 }] };
        const over = new Map([['early', at(9, [])], ['late', at(5, ['OVERFLOW'])]]);
        expect(screen([mover], { earlier: [earlier], later: [later] }, over, []).kept[0]!.line)
            .toBe('Moved (candidate). In at least one frame of the later visit, the archive flags that frame’s brightest pixel within 12″ of its spot in that visit as OVERFLOW; an overflowing pixel can make the reading here unreliable.');
        const hit = new Map([['early', at(1, ['OUTLIER'])], ['late', at(9, [])]]);
        expect(screen([mover], { earlier: [earlier], later: [later] }, hit, ['OUTLIER']).kept).toHaveLength(0);
    });
});

describe('round 11 wording', () => {
    const at = (x: number, names: string[]) => ({ obsId: '', names: (p: { x: number }) => (p.x === x ? names : []) });
    it('names each visit with its own spot when both ends of a pair overflow', () => {
        const pair = { ...candidate, id: 'p', kind: 'unknown' as const, snr: 9, reading: 'pair' as const, reason: 'Two spots (S/N 9.0; candidate).',
            ends: [{ visit: 'later' as const, x: 1, y: 1, radiusPix: 2 }, { visit: 'earlier' as const, x: 5, y: 1, radiusPix: 2 }] };
        const flags = new Map([['early', at(5, ['OVERFLOW'])], ['late', at(1, ['OVERFLOW'])]]);
        expect(screen([pair], { earlier: [earlier], later: [later] }, flags, []).kept[0]!.line)
            .toBe('Two spots (S/N 9.0; candidate). In at least one frame of each visit, the archive flags that frame’s brightest pixel within 12″ of its spot in that visit as OVERFLOW; an overflowing pixel can make the reading here unreliable.');
    });
});

describe('error maps for the compared visits (C6)', () => {
    it('regrids VARIANCE on the frame grid and blanks it where the picture is blank', async () => {
        const { readVariance } = await import('../src/ui/error-maps');
        const f = frame('a', 0);
        const names: string[] = [];
        const reader = { index: async () => ({}), readFloat32: async (_i: unknown, name: string) => { names.push(name); return new Float32Array(1600).fill(4); } } as unknown as RangeReader;
        const out = (await readVariance(f, { reader, signal: new AbortController().signal }))!;
        expect(names).toEqual(['VARIANCE']); // only the error map, not the picture again
        expect(out[10 * 40 + 10]).toBeCloseTo(4, 5);
        expect(out[0]).toBeNaN();
        const none = { index: async () => ({}), readFloat32: async () => new Float32Array(1600) } as unknown as RangeReader;
        expect(await readVariance(f, { reader: none, signal: new AbortController().signal })).toBeNull();
        const wrong = { index: async () => ({}), readFloat32: async () => new Float32Array(3).fill(1) } as unknown as RangeReader;
        expect(await readVariance(f, { reader: wrong, signal: new AbortController().signal })).toBeNull();
    });

    it('runs the finder again with the maps on only the compared frames', async () => {
        const a = frame('a', 0);
        const mid = frame('m', 10);
        const b = frame('b', 20);
        const find = vi.fn(found);
        const asked: string[] = [];
        const variance = async (f: RegriddedFrame) => { asked.push(f.frame.obsId); return new Float32Array(1600).fill(2); };
        const onChange = vi.fn();
        const slot = mountChanges(onChange, { reader: { index: () => new Promise(() => {}) } as unknown as RangeReader, find, variance, timeoutMs: 5 });
        slot.render({} as HTMLElement, {} as HTMLElement, { source: 'live', result: sky([a, mid, b]), index: 0, mode: 'blink' });
        await vi.waitFor(() => expect(find).toHaveBeenCalledTimes(2));
        expect(asked).toEqual(['a', 'b']);
        const again = find.mock.calls[1]![0];
        expect(again.frames.map(p => !!p.frame.variance)).toEqual([true, false, true]);
        expect(find.mock.calls[0]![0].frames.some(p => p.frame.variance)).toBe(false);
    });
});

describe('plain list (compareVisits plain: true)', () => {
    const at = (x: number, names: string[]) => ({ obsId: '', names: (p: { x: number }) => (p.x === x ? names : []) });
    const plain = { ...candidate, id: 'q', kind: 'unknown' as const, snr: 9, reading: 'moreLater' as const, lightVisit: 'later' as const, x: 1, y: 1,
        sentence: 'Measured against the sky around it in each visit, there is more light here in the later visit than in the earlier one; a change in a source\'s brightness, a moving source, a change in the sky around it, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N 9.0; candidate).',
        neutral: 'The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a change in the sky around it, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N 9.0; candidate).',
        ends: [{ visit: 'later' as const, x: 1, y: 1, radiusPix: 2 }] };

    it('withdraws plain direction when either visit has OVERFLOW', () => {
        for (const visit of ['earlier', 'later'] as const) {
            const flags = new Map([['early', at(1, visit === 'earlier' ? ['OVERFLOW'] : [])], ['late', at(1, visit === 'later' ? ['OVERFLOW'] : [])]]);
            const kept = screen([plain], { earlier: [earlier], later: [later] }, flags, []).kept[0]!;
            expect(kept.line).toBe(`The light here differs between the two visits, and which visit has more is not clear; a change in a source's brightness, a moving source, a change in the sky around it, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (candidate). In at least one frame of the ${visit} visit, the archive flags that frame’s brightest pixel within 12″ of the spot as OVERFLOW; an overflowing pixel can make the reading here unreliable.`);
            expect(kept.reading).toBe('unclear');
            expect(kept.kind).toBe('unknown');
        }
    });

    it('keeps mapped ordering explained when overflow hides every S/N', () => {
        const flags = new Map([['early', at(1, ['OVERFLOW'])], ['late', at(1, [])]]);
        const kept = screen([plain], { earlier: [earlier], later: [later] }, flags, []).kept;
        expect(plainListNotes(kept, true, 6)).toEqual(['Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise.', 'S/N is left out for 1 candidate that an archive flag marks, because the reading there can be unreliable.']);
        expect(plainListNotes([...kept, ...kept], true, 6)).toEqual(['Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise.', 'S/N is left out for 2 candidates that an archive flag marks, because the reading there can be unreliable.']);
        expect(plainListNotes([], true, 6)).toEqual([]);
        const noFigure = { ...plain, sentence: plain.sentence.replace('(S/N 9.0; candidate)', '(candidate)'), snrMapMissing: true };
        const mixed = screen([plain, noFigure], { earlier: [earlier], later: [later] }, flags, []).kept;
        expect(plainListNotes(mixed, true, 6)).toEqual([
            'Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise.',
            'S/N is left out for 1 candidate that an archive flag marks, because the reading there can be unreliable.',
            "S/N is left out for 1 candidate where the frames' error maps have no value, because the noise there comes from the difference image alone.",
        ]);
    });

    it('truncates S/N for overflowed comparison readings', () => {
        const flags = new Map([['early', at(1, ['OVERFLOW'])], ['late', at(1, [])]]);
        const c = { ...plain, reading: 'brighter' as const, snr: 49.96 };
        expect(screen([c], { earlier: [earlier], later: [later] }, flags, []).kept[0]!.line).toBe('The two visits differ here, at S/N 49.9 (candidate). In at least one frame of the earlier visit, the archive flags that frame’s brightest pixel within 12″ of the spot as OVERFLOW, so the brightness comparison is not shown; an overflowing pixel can make the reading here unreliable.');
    });

    it('does not print a non-finite S/N for an overflowed comparison', () => {
        const flags = new Map([['early', at(1, ['OVERFLOW'])], ['late', at(1, [])]]);
        const c = { ...plain, reading: 'brighter' as const, snr: NaN };
        expect(screen([c], { earlier: [earlier], later: [later] }, flags, []).kept[0]!.line).toBe('The two visits differ here (candidate). In at least one frame of the earlier visit, the archive flags that frame’s brightest pixel within 12″ of the spot as OVERFLOW, so the brightness comparison is not shown; an overflowing pixel can make the reading here unreliable.');
    });

    it('drops a plain spot flagged in its light visit, with one-spot wording', () => {
        const flags = new Map([['early', at(9, [])], ['late', at(1, ['TRANSIENT'])]]);
        const out = screen([plain], { earlier: [earlier], later: [later] }, flags, ['TRANSIENT']);
        expect(out.kept).toHaveLength(0);
        expect(out.dropNote).toBe('1 candidate is not listed: in at least one frame of a checked visit, that frame’s brightest pixel within 12″ of its spot carries the archive flag TRANSIENT.');
    });

    it('drops a plain spot flagged in the earlier visit', () => {
        const flags = new Map([['early', at(1, ['TRANSIENT'])], ['late', at(1, [])]]);
        const out = screen([plain], { earlier: [earlier], later: [later] }, flags, ['TRANSIENT']);
        expect(out.kept).toHaveLength(0);
        expect(out.dropNote).toBe('1 candidate is not listed: in at least one frame of a checked visit, that frame’s brightest pixel within 12″ of its spot carries the archive flag TRANSIENT.');
    });

    it('counts a plain spot unread in full only when neither visit is read', () => {
        const flags = new Map([['early', at(1, [])], ['late', null]]);
        const out = screen([plain], { earlier: [earlier], later: [later] }, flags, []);
        expect(out.allUnread).toBe(false);
        expect(out.kept[0]!.line).toBe(`${plain.sentence} The archive flags of the later visit could not be read for this spot, so that visit is not checked.`);
        expect(screen([plain], { earlier: [earlier], later: [later] }, new Map(), []).allUnread).toBe(true);
    });

    it('P8 two unreadable earlier frames and a readable later frame leave a partial check', () => {
        const early2 = { frame: { obsId: 'early2' } } as RegriddedFrame;
        const c = { ...plain, reading: 'lessLater' as const,
            sentence: "Measured against the sky around it in each visit, there is less light here in the later visit than in the earlier one; a change in a source's brightness, a moving source, a change in the sky around it, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N 9.0; candidate).",
            ends: [{ visit: 'earlier' as const, x: 1, y: 1, radiusPix: 2 }] };
        const flags = new Map([['early', null], ['early2', null], ['late', at(1, [])]]);
        const out = screen([c], { earlier: [earlier, early2], later: [later] }, flags, []);
        expect(out.allUnread).toBe(false);
        expect(out.lead).toEqual([]);
        expect(out.kept[0]!.line).toBe(`${c.sentence} The archive flags of the earlier visit could not be read for this spot, so that visit is not checked.`);
        const partly = screen([c], { earlier: [earlier, early2], later: [later] }, new Map([['early', null], ['early2', at(1, [])], ['late', at(1, [])]]), []);
        expect(partly.kept[0]!.line).toBe(`${c.sentence} Some of the archive flags for this spot could not be read, so that check is incomplete.`);
    });

    it('does not claim a direction when a drop flag and OVERFLOW occur in opposite visits', () => {
        const flags = new Map([['early', at(1, ['OVERFLOW'])], ['late', at(1, ['TRANSIENT'])]]);
        const out = screen([plain], { earlier: [earlier], later: [later] }, flags, ['TRANSIENT']);
        expect(out.dropNote).toBe('1 candidate is not listed: in at least one frame of a checked visit, that frame’s brightest pixel within 12″ of its spot carries the archive flag TRANSIENT.');
    });

    it('uses neutral drop wording for an unclear spot', () => {
        const flags = new Map([['early', at(1, [])], ['late', at(1, ['TRANSIENT'])]]);
        const out = screen([{ ...plain, reading: 'unclear' }], { earlier: [earlier], later: [later] }, flags, ['TRANSIENT']);
        expect(out.dropNote).toBe('1 candidate is not listed: in at least one frame of a checked visit, that frame’s brightest pixel within 12″ of its spot carries the archive flag TRANSIENT.');
    });
});
