import { describe, expect, it } from 'vitest';
import { compareVisits, plainListNotes, type VisitImage } from '../src/lib/changes';
import { groupOf } from '../src/ui/changes-view';
import type { OutputGrid } from '../src/lib/types';
import { changeInput, findChanges } from '../src/lib/change-input';
import { waveLattice, headerFromCards, type SkyResult } from '../src/lib/source';
import { makeWcs, wcsFromHeader } from '../src/lib/wcs';
import { sampleWave } from '../src/lib/wavelength';
import { changesHtml, changesView } from '../src/ui/changes-view';
import { fetchGaia } from '../src/lib/gaia';

const grid: OutputGrid = { center: { ra: 20, dec: 30 }, fovDeg: 0.1, pixelArcsec: 1.5375, width: 121, height: 121 };
function pictures(): [VisitImage, VisitImage]
{
    let seed = 918273;
    const noise = () => Float32Array.from({ length: grid.width * grid.height }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296 - 0.5;
    });
    const a = noise(), b = noise();
    for (const [cx, cy, amp] of [[60, 60, 80], [60, 20, 140]] as const) {
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                b[y * grid.width + x]! += amp * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 22);
            }
        }
    }
    return [{ data: a, lambda: 2, mjd: 60000, obsIds: ['a'] },
        { data: b, lambda: 2, mjd: 60100, obsIds: ['b'] }];
}
function lattice(slope: number)
{
    return { nx: 3, ny: 3, values: Float32Array.from({ length: 9 }, (_, i) => 2 + (Math.floor(i / 3) - 1) * slope) };
}

describe('comparison coverage', () => {
    it('masks mismatched wavelengths but retains the central candidate', () => {
        const [a, b] = pictures();
        const result = compareVisits({ ...a, lambdaGrid: lattice(0.04) }, { ...b, lambdaGrid: lattice(-0.04) }, grid, [], { plain: true });
        expect(result.candidates.some(c => Math.abs(c.pix.y - 60) < 5)).toBe(true);
        expect(result.candidates.some(c => Math.abs(c.pix.y - 20) < 5)).toBe(false);
        expect(result.notes).toContain("About 74% of the area both visits cover was left out of the comparison: there the two visits' wavelengths differ by more than 0.02 µm.");
    });
    it('adds no mask note when equal lattices or no lattices are supplied', () => {
        const [a, b] = pictures();
        const base = compareVisits(a, b, grid, [], { plain: true });
        const equal = compareVisits({ ...a, lambdaGrid: lattice(0) }, { ...b, lambdaGrid: lattice(0) }, grid, [], { plain: true });
        expect(equal).toEqual(base);
    });
    it('limits a NaN node to the cells that use it', () => {
        const [a, b] = pictures();
        const bad = lattice(0);
        bad.values[0] = NaN;
        const result = compareVisits({ ...a, lambdaGrid: bad }, { ...b, lambdaGrid: lattice(0) }, grid, [], { plain: true });
        expect(result.notes).toContain('About 25% of the area both visits cover was left out of the comparison: there the wavelength of at least one visit could not be worked out.');
        expect(result.candidates.some(c => Math.abs(c.pix.y - 60) < 5)).toBe(true);
        const beside = result.candidates.find(c => Math.abs(c.pix.y - 20) < 5)!;
        expect(beside).toBeDefined();
        expect(beside.sentence).toContain('Pixels at or near it were left out of the comparison: there the wavelength of at least one visit could not be worked out.');
        expect(beside.sentence).not.toContain('wavelengths differ');
    });
    it('describes a mask boundary as missing pixels rather than an image edge', () => {
        const [a, b] = pictures();
        const result = compareVisits({ ...a, lambdaGrid: lattice(0.08) }, { ...b, lambdaGrid: lattice(-0.08) }, grid, [], { plain: true });
        const center = result.candidates.find(c => Math.abs(c.pix.y - 60) < 5)!;
        expect(center).toBeDefined();
        expect(center.sentence).toContain('It is close to pixels that could not be compared');
        expect(center.sentence).not.toContain('It is near the edge of the picture.');
    });
    it('says left out, not missing, for a spot beside the wavelength mask', () => {
        const [a, b] = pictures();
        // Slope 0.1 leaves only rows 54 to 66 compared; the spot at row 60 is 12" wide, so its disc reaches past them.
        const result = compareVisits({ ...a, lambdaGrid: lattice(0.1) }, { ...b, lambdaGrid: lattice(-0.1) }, grid, [], { plain: true });
        const center = result.candidates.find(c => Math.abs(c.pix.y - 60) < 5)!;
        expect(center).toBeDefined();
        expect(center.sentence).toContain("Pixels at or near it were left out of the comparison: there the two visits' wavelengths differ by more than 0.02 µm.");
        expect(center.sentence).not.toContain('are missing in at least one visit');
        expect(center.sentence).not.toContain('could not be worked out');
    });
    it('keeps the missing sentence when a pixel has no data', () => {
        const [a, b] = pictures();
        const holed = { ...a, data: Float32Array.from(a.data) };
        holed.data[60 * grid.width + 62] = NaN;
        const result = compareVisits({ ...holed, lambdaGrid: lattice(0.1) }, { ...b, lambdaGrid: lattice(-0.1) }, grid, [], { plain: true });
        const center = result.candidates.find(c => Math.abs(c.pix.y - 60) < 5)!;
        expect(center).toBeDefined();
        expect(center.sentence).toContain('Pixels at or near it are missing in at least one visit.');
        // Its disc also reaches the rows the wavelength check left out, so it gets both sentences.
        expect(center.sentence).toContain("Pixels at or near it were left out of the comparison: there the two visits' wavelengths differ by more than 0.02 µm.");
    });
    it('marks an outside spot unchecked and sorts it after an inside spot', () => {
        const [a, b] = pictures();
        const base = compareVisits(a, b, grid, [], { plain: true });
        const result = compareVisits(a, b, grid, [], { plain: true, starCover: { x: 60, y: 60, radiusPix: 30 } });
        expect(result.candidates[0]!.pix.y).toBeCloseTo(60, -1);
        const outside = result.candidates.find(c => Math.abs(c.pix.y - 20) < 5)!;
        expect(outside.catalogueChecked).toBe(false);
        expect(outside.sentence).toContain('It lies outside the part of the picture where the Gaia star list was loaded, so it was not checked against that list.');
        expect(result.candidates[0]!.sentence).toBe(base.candidates.find(c => Math.abs(c.pix.y - 60) < 5)!.sentence);
        expect(result.notes).toContain('1 spot lies outside the part of the picture where the Gaia star list was loaded (within 0.01° of the centre), so it was not checked against that list.');
    });
    it('groups unchecked candidates last and counts them in notes', () => {
        const candidate = { id: '', kind: 'unknown' as const, pix: { x: 0, y: 0 }, sky: { ra: 0, dec: 0 }, snr: 1,
            sign: 1 as const, gaiaMatch: false, frames: [], reason: 'spot', nearCatalogue: false, catalogueChecked: false };
        expect(groupOf(candidate)).toBe(2);
        expect(plainListNotes([candidate], false, 6, 0.2)[1]).toContain('1 spot lies outside');
        const found = { candidates: [{ ...candidate, reading: 'unclear' as const }], notes: [], sigma: 1, threshold: 5,
            rejected: { streaks: 0, single: 0, edge: 0, residual: 0 }, skipped: [], plainListInfo: { usedErrorMap: false, matchArcsec: 6 } };
        const html = changesHtml(changesView(found));
        expect(html).toContain('Not shown: 1 spot that was not checked against the Gaia star list.');
        expect(html).not.toContain('within 6″ of a catalogue star');
    });
    it('restores coverage ordering and counts after flag screening', () => {
        const [a, b] = pictures();
        const result = compareVisits(a, b, grid, [], { plain: true, starCover: { x: 60, y: 60, radiusPix: 30 } });
        const view = changesView(result);
        view.candidates.reverse();
        const html = changesHtml(view, true);
        expect(html.indexOf('Candidate 1')).toBeLessThan(html.indexOf('It lies outside the part'));
        view.candidates = view.candidates.filter(c => c.catalogueChecked !== false);
        expect(changesHtml(view, true)).not.toContain('1 spot lies outside');
        expect(changesHtml(view, true)).not.toContain('come last');
        expect(changesHtml(view, true)).toContain('Listed with spots that have no catalogue star within 6″ first');
    });
    it('reports whether Gaia kept fewer rows than it received', async () => {
        const fetcher = async () => new Response('source_id,ra,dec,phot_g_mean_mag\n1,20,30,10\n2,20,30,11\n3,20,30,12');
        expect((await fetchGaia(grid.center, 0.1, { fetcher, maxRows: 2 })).cut).toBe(true);
        expect((await fetchGaia(grid.center, 0.1, { fetcher, maxRows: 3 })).cut).toBe(false);
    });
    it('samples the source lattice at the same wavelength as the centre', () => {
        const wcs = makeWcs(wcsFromHeader(headerFromCards({ CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', NAXIS1: 2040, NAXIS2: 2040,
            CRPIX1: 1020.5, CRPIX2: 1020.5, CRVAL1: 20, CRVAL2: 30, CD1_1: -0.001, CD1_2: 0, CD2_1: 0, CD2_2: 0.001 })));
        const wave = { xs: [0, 2040], ys: [0, 2040], lambda: [[1, 2], [2, 3]], bandwidth: [[0.1, 0.1], [0.1, 0.1]] };
        const lattice = waveLattice(wave, wcs, grid);
        expect(lattice.values[40]).toBeCloseTo(sampleWave(wave, wcs.skyToPix(grid.center)).lambda, 6);
    });
    it('averages finite lattice nodes per visit and reports the actual catalogue cap', () => {
        const [a, b] = pictures();
        const frame = (img: VisitImage, id: string, t: number, values: number[]) => ({
            frame: { obsId: id, collection: 'spherex_dr1' as const, release: 'dr1' as const, detector: 1 as const,
                url: '', tMin: t, tMax: t + 0.01, lambdaMin: 1, lambdaMax: 3 }, grid, data: img.data,
            lambdaAtCenter: 2, bandwidthAtCenter: 0.1, lambdaGrid: { nx: 2, ny: 2, values: Float32Array.from(values) },
        });
        const frames = [frame(a, 'a', 60000, [1, NaN, NaN, 4]), frame(a, 'b', 60001, [3, 2, NaN, 6]),
            frame(b, 'c', 60100, [2, 2, 2, 2])];
        const sky: SkyResult = { source: 'live', grid, frames: frames.map(f => ({ frame: f, label: '' })), locked: [], lambda: 2,
            stars: [], credits: [], notes: [], starCover: { center: grid.center, radiusDeg: 0.2, cut: true, kept: 17 } };
        expect(Array.from(changeInput(sky).earlier.lambdaGrid!.values)).toEqual([2, 2, NaN, 5]);
        expect(findChanges(sky).notes).toContain('The Gaia star list for this view was cut to its 17 brightest stars, so a fainter catalogue star can be missing from it.');
        delete (frames[0] as { lambdaGrid?: unknown }).lambdaGrid;
        expect(changeInput(sky).earlier.lambdaGrid).toBeUndefined();
    });
    it('says in the order note that unchecked spots come last', () => {
        const [a, b] = pictures();
        const order = (notes: string[]) => notes.find(n => n.startsWith('Listed with spots that have no catalogue star within '));
        const result = compareVisits(a, b, grid, [], { plain: true, starCover: { x: 60, y: 60, radiusPix: 30 } });
        expect(order(result.notes)).toContain('; spots not checked against the Gaia star list come last.');
        expect(order(compareVisits(a, b, grid, [], { plain: true }).notes)).not.toContain('come last');
    });
    it('counts hidden unchecked spots beside hidden near-star spots', () => {
        const spot = (over: { nearCatalogue?: boolean; catalogueChecked?: boolean }) => ({ id: '', kind: 'unknown' as const,
            pix: { x: 0, y: 0 }, sky: { ra: 0, dec: 0 }, snr: 1, sign: 1 as const, gaiaMatch: false, frames: [], reason: 'spot',
            nearCatalogue: false, reading: 'unclear' as const, ...over });
        const found = { candidates: [spot({}), spot({ nearCatalogue: true }), spot({ catalogueChecked: false }), spot({ catalogueChecked: false })],
            notes: [], sigma: 1, threshold: 5, rejected: { streaks: 0, single: 0, edge: 0, residual: 0 }, skipped: [],
            plainListInfo: { usedErrorMap: false, matchArcsec: 6 } };
        expect(changesHtml(changesView(found))).toContain('Not shown: 3 more spots; 1 of them lies within 6″ of a catalogue star and 2 of them were not checked against the Gaia star list.');
    });
    it('leaves no spot unchecked when the star cone reaches the corners of the picture', () => {
        const [a, b] = pictures();
        const frame = (img: VisitImage, id: string, t: number) => ({
            frame: { obsId: id, collection: 'spherex_dr1' as const, release: 'dr1' as const, detector: 1 as const,
                url: '', tMin: t, tMax: t + 0.01, lambdaMin: 1, lambdaMax: 3 }, grid, data: img.data,
            lambdaAtCenter: 2, bandwidthAtCenter: 0.1,
        });
        const sky = (radiusDeg: number): SkyResult => ({ source: 'live', grid, frames: [frame(a, 'a', 60000), frame(b, 'b', 60100)].map(f => ({ frame: f, label: '' })),
            locked: [], lambda: 2, stars: [], credits: [], notes: [],
            starCover: { center: grid.center, radiusDeg, cut: false, kept: 0 } });
        // The picture's corners are 0.0365 degrees from its centre: a 0.037 degree cone covers it, a 0.01 degree cone does not.
        const open = findChanges(sky(0.037), {}, { plain: true });
        expect(open.candidates.length).toBeGreaterThan(1);
        expect(open.candidates.some(c => c.catalogueChecked === false)).toBe(false);
        expect(findChanges(sky(0.01), {}, { plain: true }).candidates.some(c => c.catalogueChecked === false)).toBe(true);
        // A cone a hair short of the corners through grid rounding still counts as covering the picture.
        expect(findChanges(sky(0.0364), {}, { plain: true }).candidates.some(c => c.catalogueChecked === false)).toBe(false);
    });
    it('averages a visit wavelength only over the frames that hold data at that point', () => {
        const [a, b] = pictures();
        const half = Float32Array.from(a.data, (v, i) => i % grid.width > 40 ? NaN : v);
        const frame = (data: Float32Array, id: string, t: number, value: number) => ({
            frame: { obsId: id, collection: 'spherex_dr1' as const, release: 'dr1' as const, detector: 1 as const,
                url: '', tMin: t, tMax: t + 0.01, lambdaMin: 1, lambdaMax: 3 }, grid, data,
            lambdaAtCenter: 2, bandwidthAtCenter: 0.1, lambdaGrid: { nx: 2, ny: 2, values: Float32Array.from([value, value, value, value]) },
        });
        const frames = [frame(half, 'a', 60000, 1), frame(a.data, 'b', 60001, 3), frame(b.data, 'c', 60100, 2)];
        const sky: SkyResult = { source: 'live', grid, frames: frames.map(f => ({ frame: f, label: '' })), locked: [], lambda: 2,
            stars: [], credits: [], notes: [] };
        // Left corners: both frames hold data, so 2. Right corners: only the full frame does, so 3.
        expect(Array.from(changeInput(sky).earlier.lambdaGrid!.values)).toEqual([2, 3, 2, 3]);
        // The only frame with data at a corner has no wavelength there: unknown, not another frame's value.
        frames[1]!.lambdaGrid.values[1] = NaN;
        expect(Array.from(changeInput(sky).earlier.lambdaGrid!.values)).toEqual([2, NaN, 2, 3]);
    });
});
