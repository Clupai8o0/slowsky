import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findChanges } from '../src/lib/change-input';
import { gridPixToSky, gridSkyToPix } from '../src/lib/regrid';
import type { GaiaStar, SkyResult } from '../src/lib/source';
import { positionAt } from '../src/lib/targets';
import type { FrameRecord, OutputGrid, RangeReader, RegriddedFrame, Wcs } from '../src/lib/types';
// The page's change list goes through changesFor (src/ui/slots.ts), which must ask for the plain list only.
import { changesFor, mountChanges, PAGE_CHANGE_OPTIONS } from '../src/ui/slots';
// Fixtures as in tests/change-input.test.ts.

const grid: OutputGrid = { center: { ra: 20, dec: 30 }, fovDeg: 0.1, pixelArcsec: 1.5375, width: 121, height: 121 };

let seed = 918273;
function random(): number
{
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
}

function noise(g: OutputGrid): Float32Array
{
    const nw = Math.ceil(g.width / 4) + 1, nh = Math.ceil(g.height / 4) + 1;
    const native = new Float32Array(nw * nh);
    for (let i = 0; i < native.length; i += 2) {
        const r = Math.sqrt(-2 * Math.log(random())), t = 2 * Math.PI * random();
        native[i] = r * Math.cos(t);
        if (i + 1 < native.length) {
            native[i + 1] = r * Math.sin(t);
        }
    }
    const out = new Float32Array(g.width * g.height);
    for (let y = 0; y < g.height; y++) {
        for (let x = 0; x < g.width; x++) {
            const ix = Math.floor(x / 4), iy = Math.floor(y / 4), fx = x / 4 - ix, fy = y / 4 - iy;
            out[y * g.width + x] = (1 - fy) * ((1 - fx) * native[iy * nw + ix]! + fx * native[iy * nw + ix + 1]!)
                + fy * ((1 - fx) * native[(iy + 1) * nw + ix]! + fx * native[(iy + 1) * nw + ix + 1]!);
        }
    }
    return out;
}

function point(data: Float32Array, x: number, y: number, amplitude: number): void
{
    const s = 12 / 2.35482 / grid.pixelArcsec;
    for (let j = Math.max(0, Math.floor(y - 4 * s)); j <= Math.min(grid.height - 1, Math.ceil(y + 4 * s)); j++) {
        for (let i = Math.max(0, Math.floor(x - 4 * s)); i <= Math.min(grid.width - 1, Math.ceil(x + 4 * s)); i++) {
            data[j * grid.width + i]! += amplitude * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (2 * s * s));
        }
    }
}

function frame(id: string, mjd: number, lambda = 2, data = noise(grid)): RegriddedFrame
{
    const record: FrameRecord = { obsId: id, collection: 'spherex_dr1', release: 'dr1', detector: 1,
        url: '', tMin: mjd, tMax: mjd + 0.01, lambdaMin: 1, lambdaMax: 3 };
    return { frame: record, grid, data, lambdaAtCenter: lambda, bandwidthAtCenter: 0.1 };
}

function sky(frames: RegriddedFrame[], stars: GaiaStar[] = []): SkyResult
{
    return { source: 'snapshot', grid, frames: frames.map((f) => ({ frame: f, label: f.frame.obsId })),
        locked: [], lambda: 2, stars, credits: [], notes: [] };
}

function star(sourceId: string, ra = grid.center.ra, dec = grid.center.dec): GaiaStar
{
    return { sourceId, ra, dec, g: 10, epochJyear: 2016, pix: gridSkyToPix(grid, { ra, dec }) };
}

function livePair(): SkyResult
{
    seed = 918273;
    const a = noise(grid), b = noise(grid);
    point(b, 30, 30, 1000);
    point(b, 90, 90, 100);
    const frames = [frame('a', 60000, 2, a), frame('b', 60030, 2, b)];
    for (const f of frames) {
        f.variance = new Float32Array(f.data.length).fill(1);
        f.context = { url: f.frame.obsId, box: { x0: 0, y0: 0, x1: grid.width, y1: grid.height },
            wcs: { skyToPix: (s) => gridSkyToPix(grid, s) } as Wcs,
            flags: { layout: {} as never, names: [{ bit: 0, name: 'TRANSIENT' }, { bit: 1, name: 'OVERFLOW' }] } };
    }
    return { ...sky(frames), source: 'live' };
}

async function screenedPage(result: SkyResult, flagged: (x: number, y: number) => number, find?: typeof findChanges): Promise<string>
{
    const frames = new Map(result.frames.map(f => [f.frame.frame.obsId, f.frame]));
    const reader = { index: async (url: string) => ({ url }),
        readFloat32: async (index: { url: string }, name: string) => name === 'IMAGE' ? frames.get(index.url)!.data : new Float32Array(grid.width * grid.height),
    } as unknown as RangeReader;
    const read = vi.fn(async (url: string) => {
        const data = new Int32Array(grid.width * grid.height);
        if (url === 'b') {
            for (let y = 0; y < grid.height; y++) {
                for (let x = 0; x < grid.width; x++) { data[y * grid.width + x] = flagged(x, y); }
            }
        }
        return { data, width: grid.width, height: grid.height };
    });
    const onChange = vi.fn(), box = {} as HTMLElement, marks = {} as HTMLElement;
    const slot = mountChanges(onChange, { reader, read, find, variance: async f => f.variance ?? null });
    const view = { source: 'live' as const, result, index: 0, mode: 'blink' as const };
    slot.render(box, marks, view);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    slot.render(box, marks, view);
    return box.innerHTML;
}

function pageNotes(html: string): string[]
{
    const list = /<ul class="sk-chg-notes">(.*?)<\/ul>/.exec(html)?.[1] ?? '';
    return [...list.matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1]!.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&'));
}


describe('page change list is the plain list', () => {
    beforeEach(() => { seed = 918273; });

    it('passes plain: true on every page call', () => {
        const find = vi.fn((..._a: Parameters<typeof findChanges>) => findChanges(..._a));
        const a = noise(grid), b = noise(grid);
        point(b, 60, 60, 3000);
        changesFor(sky([frame('a', 60000, 2, a), frame('b', 60030, 2, b)]), find);
        expect(find).toHaveBeenCalledTimes(1);
        expect(find.mock.calls[0]![2]).toEqual({ plain: true });
        expect(PAGE_CHANGE_OPTIONS).toEqual({ plain: true });
    });

    it('P7 removes catalogue and ordering notes when archive flags remove the entire real list', async () => {
        const html = await screenedPage(livePair(), () => 1);
        expect(pageNotes(html)).toEqual([
            'Earlier visit at 2.000 µm, later at 2.000 µm.',
            "Noise estimated using the frames' pixel uncertainty maps.",
            'No source above 5 times the noise at the centre of the view in either visit.',
            '2 candidates are not listed: for each, in at least one frame of a checked visit, that frame’s brightest pixel within 12″ of its spot carries the archive flag TRANSIENT.',
        ]);
        expect(html.includes('Every spot listed')).toBe(false);
    });

    it('P9 re-sorts the real list after overflow removes the strongest spot S/N', async () => {
        const html = await screenedPage(livePair(), x => x < 60 ? 2 : 0);
        const lines = [...html.matchAll(/<li><b>Candidate \d+<\/b> (.*?)<\/li>/g)].map(m => m[1]!);
        expect(lines).toEqual([
            "Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one (S/N &gt; 50; candidate).",
            "The light here differs between the two visits, and which visit has more is not clear (candidate). In at least one frame of the later visit, the archive flags that frame’s brightest pixel within 12″ of the spot as OVERFLOW; an overflowing pixel can make the reading here unreliable.",
        ]);
        expect(pageNotes(html)).toEqual([
            'Earlier visit at 2.000 µm, later at 2.000 µm.',
            "Noise estimated using the frames' pixel uncertainty maps.",
            'No source above 5 times the noise at the centre of the view in either visit.',
            'Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise; within each group, spots with no S/N figure come after those with one.',
            '1 of the 2 candidates is marked by an archive overflow flag, so its S/N is left out; the S/N figure there can be unreliable.',
            'No catalogue stars for this view: every spot is listed without a catalogue match.',
        ]);
    });

    it('explains when flags remove every displayed S/N', async () => {
        const html = await screenedPage(livePair(), () => 2);
        expect(pageNotes(html)).toEqual([
            'Earlier visit at 2.000 µm, later at 2.000 µm.',
            "Noise estimated using the frames' pixel uncertainty maps.",
            'No source above 5 times the noise at the centre of the view in either visit.',
            'Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise.',
            'Both candidates are marked by an archive overflow flag, so their S/N is left out; the S/N figure there can be unreliable.',
            'No catalogue stars for this view: every spot is listed without a catalogue match.',
        ]);
    });

    it('P9 real finder metadata rebuilds stale S/N counts after the flag screen', async () => {
        const result = livePair();
        for (const f of result.frames) { f.frame.variance![30 * grid.width + 30] = NaN; }
        const html = await screenedPage(result, x => x < 60 ? 1 : 0);
        expect(pageNotes(html)).toEqual([
            'Earlier visit at 2.000 µm, later at 2.000 µm.',
            "Noise estimated using the frames' pixel uncertainty maps.",
            'No source above 5 times the noise at the centre of the view in either visit.',
            'Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise.',
            'No catalogue stars for this view: every spot is listed without a catalogue match.',
            '1 candidate is not listed: in at least one frame of a checked visit, that frame’s brightest pixel within 12″ of its spot carries the archive flag TRANSIENT.',
        ]);
    });

    it('replaces a finder note for two of three after screening the third candidate', async () => {
        const find: typeof findChanges = (...args) => {
            const result = findChanges(...args);
            const dropped = result.candidates.find(c => c.pix.x < 60)!;
            const kept = result.candidates.find(c => c.pix.x > 60)!;
            result.candidates = [dropped, { ...kept, snrMapMissing: true }, { ...kept, id: 'other', snrMapMissing: true }];
            result.notes.push("The frames' error maps have no value at 2 of the 3 candidates, so their S/N is left out; the noise there comes from the difference image alone.");
            return result;
        };
        const notes = pageNotes(await screenedPage(livePair(), x => x < 60 ? 1 : 0, find));
        expect(notes.filter(n => n.includes("frames' error maps have no value"))).toEqual([
            "The frames' error maps have no value at both candidates, so their S/N is left out; the noise there comes from the difference image alone.",
        ]);
    });

    it('only lists plain readings on the cases the classifier names', () => {
        const firstMjd = 60000, lastMjd = firstMjd + 365.25;
        // A Barnard-shaped mover with listed motion (classifier: mover / moved).
        const pos = gridPixToSky(grid, { x: 57, y: 60 });
        const moving = { ...star('barnard', pos.ra, pos.dec), epochJyear: 2000 + (firstMjd + 0.005 - 51544.5) / 365.25, pmRa: -10300, pmDec: 0 };
        const later = gridSkyToPix(grid, positionAt({ ra: moving.ra, dec: moving.dec, epochJyear: moving.epochJyear,
            pmRa: moving.pmRa, pmDec: moving.pmDec }, lastMjd + 0.005));
        const a = noise(grid), b = noise(grid);
        point(a, 57, 60, 3000); point(b, later.x, later.y, 3000);
        // A catalogue star that fades (classifier: fainter), and new light away from any star (classifier: laterOnly).
        const fade = gridPixToSky(grid, { x: 25, y: 25 });
        point(a, 25, 25, 3000); point(b, 25, 25, 800);
        point(b, 95, 95, 2500);
        const frames = [frame('a', firstMjd, 2, a), frame('b', lastMjd, 2, b)];
        const stars = [moving, star('fade', fade.ra, fade.dec)];
        const page = changesFor(sky(frames, stars))!;
        expect(page.ran).toBe(true);
        expect(page.candidates.length).toBeGreaterThanOrEqual(3);
        for (const c of page.candidates) {
            expect(c.kind).toBe('unknown');
            expect(['moreLater', 'lessLater', 'unclear']).toContain(c.reading);
            expect(c.ends).toHaveLength(1);
        }
        // The classifier would have named some of them, so this is the plain path, not a quiet input.
        const classified = findChanges(sky(frames, stars)).candidates;
        expect(classified.some((c) => c.kind !== 'unknown' || !['moreLater', 'lessLater'].includes(c.reading as string))).toBe(true);
    });
});
