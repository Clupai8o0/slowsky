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
        expect(outside.sentence).toContain('It lies at or beyond the edge of the part of the picture where the Gaia star list was loaded, so it was not checked against that list.');
        expect(result.candidates[0]!.sentence).toBe(base.candidates.find(c => Math.abs(c.pix.y - 60) < 5)!.sentence);
        expect(result.notes).toContain('1 spot lies at or beyond the edge of the part of the picture where the Gaia star list was loaded (within 0.01° of the centre), so it was not checked against that list.');
    });
    it('groups unchecked candidates last and counts them in notes', () => {
        const candidate = { id: '', kind: 'unknown' as const, pix: { x: 0, y: 0 }, sky: { ra: 0, dec: 0 }, snr: 1,
            sign: 1 as const, gaiaMatch: false, frames: [], reason: 'spot', nearCatalogue: false, catalogueChecked: false };
        expect(groupOf(candidate)).toBe(2);
        expect(plainListNotes([candidate], false, 6, 0.2)[1]).toContain('1 spot lies at or beyond the edge of the part');
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
        expect(html.indexOf('Candidate 1')).toBeLessThan(html.indexOf('It lies at or beyond the edge of the part'));
        view.candidates = view.candidates.filter(c => c.catalogueChecked !== false);
        expect(changesHtml(view, true)).not.toContain('1 spot lies at or beyond the edge of the part');
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
    it('averages the wavelengths of the frames pixel by pixel and reports the actual catalogue cap', () => {
        const [a, b] = pictures();
        const frame = (img: VisitImage, id: string, t: number, values: number[]) => ({
            frame: { obsId: id, collection: 'spherex_dr1' as const, release: 'dr1' as const, detector: 1 as const,
                url: '', tMin: t, tMax: t + 0.01, lambdaMin: 1, lambdaMax: 3 }, grid, data: img.data,
            lambdaAtCenter: 2, bandwidthAtCenter: 0.1, lambdaGrid: { nx: 2, ny: 2, values: Float32Array.from(values) },
        });
        // Two by two lattices: frame a reads 1 µm along the top row and 3 along the bottom, frame b 3 and 5.
        const frames = [frame(a, 'a', 60000, [1, 1, 3, 3]), frame(a, 'b', 60001, [3, 3, 5, 5]),
            frame(b, 'c', 60100, [2, 2, 2, 2])];
        const sky: SkyResult = { source: 'live', grid, frames: frames.map(f => ({ frame: f, label: '' })), locked: [], lambda: 2,
            stars: [], credits: [], notes: [], starCover: { center: grid.center, radiusDeg: 0.2, cut: true, kept: 17 } };
        const map = changeInput(sky).earlier.lambdaMap!;
        expect(map.length).toBe(grid.width * grid.height);
        expect(map[0]).toBeCloseTo(2, 6);
        expect(map[60 * grid.width + 60]).toBeCloseTo(3, 6);
        expect(map[map.length - 1]).toBeCloseTo(4, 6);
        expect(findChanges(sky).notes).toContain('The Gaia star list for this view was cut to its 17 brightest stars, so a fainter catalogue star can be missing from it.');
        delete (frames[0] as { lambdaGrid?: unknown }).lambdaGrid;
        expect(changeInput(sky).earlier.lambdaMap).toBeUndefined();
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
        const at = (map: Float32Array, x: number, y: number) => map[y * grid.width + x]!;
        // Up to column 40 both frames hold data, so 2. From column 41 on only the full frame does, so 3. The step is
        // sharp: no blend across the columns beside it (averaging the lattices first gave one).
        const map = changeInput(sky).earlier.lambdaMap!;
        expect([at(map, 0, 0), at(map, 40, 60), at(map, 41, 60), at(map, 45, 80), at(map, 120, 120)]).toEqual([2, 2, 3, 3, 3]);
        // So the comparison keeps the left part (2 against 2 µm) and leaves out the right (3 against 2).
        const found = findChanges(sky, {}, { plain: true });
        expect(found.notes).toContain("About 66% of the area both visits cover was left out of the comparison: there the two visits' wavelengths differ by more than 0.02 µm.");
        // A frame that holds data where its wavelength is unknown makes the visit's wavelength unknown there, even
        // where the other frame's wavelength is known.
        frames[1]!.lambdaGrid.values[1] = NaN;
        const unknown = changeInput(sky).earlier.lambdaMap!;
        expect(Number.isNaN(at(unknown, 10, 60))).toBe(true);
        expect(Number.isNaN(at(unknown, 100, 60))).toBe(true);
    });
    it('uses per-pixel wavelength maps before the lattices', () => {
        const [a, b] = pictures();
        const size = grid.width * grid.height;
        // The maps differ only from row 100 down (21 of 121 rows); the lattices are equal and would leave nothing out.
        const later = Float32Array.from({ length: size }, (_, i) => Math.floor(i / grid.width) >= 100 ? 2.1 : 2);
        const result = compareVisits({ ...a, lambdaMap: new Float32Array(size).fill(2), lambdaGrid: lattice(0) },
            { ...b, lambdaMap: later, lambdaGrid: lattice(0) }, grid, [], { plain: true });
        expect(result.notes).toContain("About 17% of the area both visits cover was left out of the comparison: there the two visits' wavelengths differ by more than 0.02 µm.");
    });
    it('says a spot beside a left-out part has no S/N for that reason, not for missing error maps', () => {
        const [a, b] = pictures();
        const variance = () => new Float32Array(grid.width * grid.height).fill(1 / 12);
        // Rows more than 10 pixels (about 15 arcsec) from row 60 are left out; the spot at row 60 sits beside both edges.
        const result = compareVisits({ ...a, variance: variance(), lambdaGrid: lattice(0.06) },
            { ...b, variance: variance(), lambdaGrid: lattice(-0.06) }, grid, [], { plain: true });
        expect(result.notes).toContain("Noise estimated using the frames' pixel uncertainty maps.");
        expect(result.candidates.length).toBe(1);
        expect(result.candidates[0]!.snrLeftOutNear).toBe(true);
        expect(result.notes).toContain('The 1 candidate lies beside a part of the picture that was left out of the comparison, so its S/N is left out.');
        expect(result.notes.some(n => n.includes('error maps have no value'))).toBe(false);
        expect(result.notes.some(n => n.includes('estimated from the difference image'))).toBe(false);
        // With nothing left out, the same spot prints its S/N and carries no such mark.
        const whole = compareVisits({ ...a, variance: variance() }, { ...b, variance: variance() }, grid, [], { plain: true });
        expect(whole.candidates.some(c => c.snrLeftOutNear)).toBe(false);
        expect(whole.notes.some(n => n.includes('left out of the comparison'))).toBe(false);
    });
    it('says the wavelength check left nothing, not that the visits do not overlap', () => {
        const [a, b] = pictures();
        const flat = (value: number) => ({ nx: 3, ny: 3, values: new Float32Array(9).fill(value) });
        const result = compareVisits({ ...a, lambdaGrid: flat(2.1) }, { ...b, lambdaGrid: flat(2) }, grid, [], { plain: true });
        expect(result.notes).toContain("None of the area both visits cover could be compared: there the two visits' wavelengths differ by more than 0.02 µm.");
        expect(result.notes.some(n => n.includes('do not overlap'))).toBe(false);
        expect(result.candidates).toEqual([]);
    });
    it('marks a spot just inside the star cone as at or beyond its edge', () => {
        const [a, b] = pictures();
        // The spot at row 20 is 40 pixels from the centre: inside a 42 pixel cone, but closer to its edge than the
        // 6 arcsec (3.9 pixel) matching radius, so a star just past the edge could be missed.
        const result = compareVisits(a, b, grid, [], { plain: true, starCover: { x: 60, y: 60, radiusPix: 42 } });
        const spot = result.candidates.find(c => Math.abs(c.pix.y - 20) < 3)!;
        expect(spot.catalogueChecked).toBe(false);
        expect(spot.sentence).toContain(' It lies at or beyond the edge of the part of the picture where the Gaia star list was loaded, so it was not checked against that list.');
        expect(result.notes).toContain('1 spot lies at or beyond the edge of the part of the picture where the Gaia star list was loaded (within 0.02° of the centre), so it was not checked against that list.');
    });
});
