import { describe, expect, it, vi } from 'vitest';
import type { ChangeCandidate, VisitChangeResult } from '../src/lib/changes';
import type { OutputGrid, RangeReader, RegriddedFrame, Wcs } from '../src/lib/types';
import type { SkyResult } from '../src/lib/source';
import { gridSkyToPix } from '../src/lib/regrid';
import { nativePeak, readFrameFlags, screen } from '../src/ui/flag-screen';
import { mountChanges, type SlotView } from '../src/ui/slots';

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
        expect(result.dropNote).toBe('1 candidate is not listed: in at least one frame of the visit where a spot shows more light, the brightest pixel within 12″ of that spot carries an archive flag (TRANSIENT).');
    });

    it('uses the light visit, header order, and lets a drop win over unread', () => {
        const flags = new Map([['early', { obsId: 'early', names: (p: { x: number }) => p.x === 1 ? ['NONFUNC'] : ['OUTLIER'] }],
            ['late', null]]);
        const a = { ...candidate, sign: -1 as const };
        const b = { ...a, id: 'b', pix: { x: 2, y: 1 } };
        const r = screen([a, b], { earlier: [earlier], later: [later] }, flags, ['OUTLIER', 'NONFUNC']);
        expect(r.dropNote).toBe('2 candidates are not listed: in at least one frame of the visit where a spot shows more light, the brightest pixel within 12″ of that spot carries an archive flag (OUTLIER, NONFUNC).');
        expect(r.kept).toHaveLength(0);
        expect(screen([candidate], { earlier: [earlier], later: [later] }, flags, []).kept).toHaveLength(1);
    });

    it('replaces brightness wording for OVERFLOW but appends for movers', () => {
        const flags = new Map([['early', { obsId: 'early', names: () => ['OVERFLOW'] }],
            ['late', { obsId: 'late', names: () => [] }]]);
        const r = screen([candidate, { ...candidate, id: 'b', kind: 'mover', gaiaMatch: true }],
            { earlier: [earlier], later: [later] }, flags, []);
        expect(r.kept[0]!.line).toBe('The two visits differ here (candidate). The archive flags the brightest pixel within 12″ as OVERFLOW in at least one frame of the earlier visit, so the brightness comparison is not shown.');
        // A mover's light is only in its light visit (later here), so the earlier visit's OVERFLOW is not its own.
        expect(r.kept[1]!.line).toBe('A spot appeared.');
        flags.set('late', { obsId: 'late', names: () => ['OVERFLOW'] });
        const both = screen([candidate, { ...candidate, id: 'b', kind: 'mover' }], { earlier: [earlier], later: [later] }, flags, []);
        expect(both.kept[0]!.line).toContain('in at least one frame of each visit');
        expect(both.kept[1]!.line).toBe('A spot appeared. The archive flags the brightest pixel within 12″ as OVERFLOW in at least one frame of the later visit.');
        // A sentence with no brighter/fainter reading keeps its words and gets the flag sentence added.
        const plain = screen([{ ...candidate, reason: 'Changed at S/N 7.0 (candidate).', reading: 'differs' as const }], { earlier: [earlier], later: [later] }, flags, []);
        expect(plain.kept[0]!.line).toBe('Changed at S/N 7.0 (candidate). The archive flags the brightest pixel within 12″ as OVERFLOW in at least one frame of each visit.');
        const snr = screen([{ ...candidate, snr: 12, reason: 'A catalogue star here is brighter than in the earlier image (S/N 12.0; candidate).' }],
            { earlier: [earlier], later: [later] }, flags, []);
        expect(snr.kept[0]!.line).toBe('The two visits differ here, at S/N 12.0 (candidate). The archive flags the brightest pixel within 12″ as OVERFLOW in at least one frame of each visit, so the brightness comparison is not shown.');
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
    it('shows the finder at once, then updates once with screened marks', async () => {
        const a = frame('a', 0);
        const b = frame('b', 20);
        a.data[20 * 40 + 20] = b.data[20 * 40 + 20] = 5;
        const reader = { index: async (url: string) => ({ url }), readFloat32: async () => new Float32Array(1600) } as unknown as RangeReader;
        const read = vi.fn(async (url: string) => {
            const data = new Int32Array(1600);
            if (url === 'b') {
                data[10 * 40 + 10] = 1;
            }
            return { data, width: 40, height: 40 };
        });
        const onChange = vi.fn();
        const slot = mountChanges(onChange, { reader, read, find: found });
        const v = { source: 'live', result: sky([a, b]), index: 0, mode: 'blink' } as SlotView;
        const box = {} as HTMLElement;
        const marks = {} as HTMLElement;
        slot.render(box, marks, v);
        expect(box.innerHTML).toContain('Checking the archive flags for these spots; the list and its numbers may update.');
        expect(box.innerHTML).toContain('Candidate 2');
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
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
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
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
        expect(screen([c], { earlier: [earlier], later: [later] }, flags, []).kept[0]!.line).toBe('The two visits differ here at a catalogue star, at S/N > 50 (candidate). The archive flags the brightest pixel within 12″ as OVERFLOW in at least one frame of the earlier visit, so the brightness comparison is not shown.');
    });
});

describe('round 11: every end, and the finder\'s reading', () => {
    const pair = { ...candidate, id: 'p', kind: 'unknown' as const, snr: 9, reading: 'pair' as const, reason: 'Two spots (S/N 9.0; candidate).',
        ends: [{ visit: 'later' as const, x: 1, y: 1 }, { visit: 'earlier' as const, x: 5, y: 1 }] };
    const at = (x: number, names: string[]) => ({ obsId: '', names: (p: { x: number }) => (p.x === x ? names : []) });

    it('drops a pair when either end is flagged in its own visit, not in the other visit', () => {
        const flagged = new Map([['early', at(5, ['TRANSIENT'])], ['late', at(9, [])]]);
        expect(screen([pair], { earlier: [earlier], later: [later] }, flagged, ['TRANSIENT']).kept).toHaveLength(0);
        // The earlier end's place flagged only in the later visit: not that end's own visit.
        const elsewhere = new Map([['early', at(9, [])], ['late', at(5, ['TRANSIENT'])]]);
        expect(screen([pair], { earlier: [earlier], later: [later] }, elsewhere, ['TRANSIENT']).kept).toHaveLength(1);
    });

    it('keeps a pair\'s explanation and names one of its two spots for OVERFLOW', () => {
        const flags = new Map([['early', at(5, ['OVERFLOW'])], ['late', at(9, [])]]);
        const kept = screen([pair], { earlier: [earlier], later: [later] }, flags, []).kept[0]!;
        expect(kept.line).toBe('Two spots (S/N 9.0; candidate). The archive flags the brightest pixel within 12″ of one of its two spots as OVERFLOW in at least one frame of the earlier visit.');
        expect(kept.kind).toBe('unknown');
    });

    it('withdraws a comparison reading for OVERFLOW and sets the kind to unknown', () => {
        const flags = new Map([['early', at(1, ['OVERFLOW'])], ['late', at(9, [])]]);
        const c = { ...candidate, kind: 'brightness' as const, snr: 6.25, reading: 'laterOnly' as const,
            reason: 'Light here in the later visit; the earlier visit shows none above its noise (S/N 6.3; candidate).' };
        const kept = screen([c], { earlier: [earlier], later: [later] }, flags, []).kept[0]!;
        expect(kept.line).toBe('The two visits differ here, at S/N 6.3 (candidate). The archive flags the brightest pixel within 12″ as OVERFLOW in at least one frame of the earlier visit, so the brightness comparison is not shown.');
        expect(kept.kind).toBe('unknown');
    });

    it('checks a two-visit mover at both light ends and keeps its moved line', () => {
        const mover = { ...candidate, id: 'm', kind: 'mover' as const, reading: 'moved' as const, reason: 'Moved (candidate).',
            lightEnds: [{ visit: 'earlier' as const, x: 1, y: 1, radiusPix: 2 }, { visit: 'later' as const, x: 5, y: 1, radiusPix: 2 }] };
        const over = new Map([['early', at(9, [])], ['late', at(5, ['OVERFLOW'])]]);
        expect(screen([mover], { earlier: [earlier], later: [later] }, over, []).kept[0]!.line)
            .toBe('Moved (candidate). The archive flags the brightest pixel within 12″ of one of its two spots as OVERFLOW in at least one frame of the later visit.');
        const hit = new Map([['early', at(1, ['OUTLIER'])], ['late', at(9, [])]]);
        expect(screen([mover], { earlier: [earlier], later: [later] }, hit, ['OUTLIER']).kept).toHaveLength(0);
    });
});
