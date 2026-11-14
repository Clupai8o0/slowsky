import { beforeEach, describe, expect, it } from 'vitest';
import { changeInput, ChangeInputError, findChanges } from '../src/lib/change-input';
import { gridPixToSky, gridSkyToPix } from '../src/lib/regrid';
import type { GaiaStar, SkyResult } from '../src/lib/source';
import { stackVisit } from '../src/lib/stack';
import { positionAt } from '../src/lib/targets';
import type { FrameRecord, OutputGrid, RegriddedFrame } from '../src/lib/types';

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

function visit(prefix: string, mjd: number): RegriddedFrame[]
{
    return [frame(`${prefix}0`, mjd, 1.8), frame(`${prefix}1`, mjd + 0.1, 2), frame(`${prefix}2`, mjd + 0.2, 2.3)];
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

describe('change input', () => {
    beforeEach(() => { seed = 918273; });

    it('reports the number of frames without a finite time', () => {
        const bad = frame('bad', 60000);
        bad.frame.tMin = NaN;
        const one = changeInput(sky([...visit('a', 60000), ...visit('b', 60030), bad]));
        expect(one.notes).toContain('1 frame without a time was left out.');
        const bad2 = frame('bad2', 60000);
        bad2.frame.tMax = Infinity;
        const two = changeInput(sky([...visit('a', 60000), ...visit('b', 60030), bad, bad2]));
        expect(two.notes).toContain('2 frames without a time were left out.');
    });

    it('groups visits and reports ordered ids, the full time midpoint and mean wavelength', () => {
        const first = visit('a', 60000), second = visit('b', 60030);
        first[0]!.frame.tMax = 60000.5;
        const input = changeInput(sky([...first, ...second]));
        expect(input.visits).toBe(2);
        expect(input.earlier.obsIds).toEqual(['a0', 'a1', 'a2']);
        expect(input.earlier.mjd).toBe((60000 + 60000.5) / 2);
        expect(input.earlier.lambda).toBeCloseTo((1.8 + 2 + 2.3) / 3, 12);
    });

    it('uses exactly the stacked first visit image', () => {
        const first = visit('a', 60000);
        const input = changeInput(sky([...first, ...visit('b', 60030)]));
        expect(input.earlier.data).toEqual(stackVisit(first).data);
    });

    it('propagates variance only when every frame in a visit has it', () => {
        const first = visit('a', 60000), second = visit('b', 60030);
        for (const [i, f] of [...first, ...second].entries()) {
            f.variance = new Float32Array(f.data.length).fill(i + 1);
        }
        const complete = changeInput(sky([...first, ...second]));
        expect(complete.earlier.variance).toEqual(stackVisit(first).variance);
        expect(complete.earlier.variance).toBeInstanceOf(Float32Array);
        expect(complete.notes.join(' ')).not.toContain('No error maps');
        delete first[1]!.variance;
        const incomplete = changeInput(sky([...first, ...second]));
        expect(incomplete.earlier).not.toHaveProperty('variance');
        expect(incomplete.later.variance).toBeInstanceOf(Float32Array);
        expect(incomplete.notes.join(' ')).toContain('No error maps');
    });

    it('places each moving Gaia star at both visit dates with its shared id', () => {
        const moving = { ...star('moving'), pmRa: 1000, pmDec: 0 };
        const input = changeInput(sky([...visit('a', 58000), ...visit('b', 58000 + 2 * 365.25)], [moving]));
        expect(input.stars.map(({ visit, properMotion }) => ({ visit, properMotion }))).toEqual([
            { visit: 'earlier', properMotion: true }, { visit: 'later', properMotion: true },
        ]);
        expect(input.stars).toHaveLength(2);
        expect(input.stars.map((s) => s.id)).toEqual(['moving', 'moving']);
        const astrometry = { ra: moving.ra, dec: moving.dec, epochJyear: moving.epochJyear, pmRa: 1000, pmDec: 0 };
        const expectedEarlier = gridSkyToPix(grid, positionAt(astrometry, input.earlier.mjd));
        const expectedLater = gridSkyToPix(grid, positionAt(astrometry, input.later.mjd));
        expect(input.stars[0]!.x).toBeCloseTo(expectedEarlier.x, 8);
        expect(input.stars[1]!.x).toBeCloseTo(expectedLater.x, 8);
        expect(input.stars[1]!.x - input.stars[0]!.x).toBeCloseTo(expectedLater.x - expectedEarlier.x, 8);
        expect(Math.abs(input.stars[1]!.x - input.stars[0]!.x)).toBeGreaterThan(1);
    });

    it('uses listed proper motion end to end for a Barnard-shaped source', () => {
        const firstMjd = 60000, lastMjd = firstMjd + 365.25;
        const pos = gridPixToSky(grid, { x: 57, y: 60 });
        const moving = { ...star('barnard', pos.ra, pos.dec), epochJyear: 2000 + (firstMjd + 0.005 - 51544.5) / 365.25,
            pmRa: -10300, pmDec: 0 };
        const later = gridSkyToPix(grid, positionAt({ ra: moving.ra, dec: moving.dec, epochJyear: moving.epochJyear,
            pmRa: moving.pmRa, pmDec: moving.pmDec }, lastMjd + 0.005));
        const a = noise(grid), b = noise(grid);
        point(a, 57, 60, 3000); point(b, later.x, later.y, 3000);
        const frames = [frame('a', firstMjd, 2, a), frame('b', lastMjd, 2, b)];
        const found = findChanges(sky(frames, [moving]));
        expect(found.candidates).toHaveLength(1);
        expect(found.candidates[0]).toMatchObject({ kind: 'mover', reading: 'moved', nearCatalogue: true });
        expect(found.candidates[0]!.sentence).toMatch(/listed motion of about 10″/);
        const withoutMotion = findChanges(sky(frames, [star('barnard', pos.ra, pos.dec)]));
        expect(withoutMotion.candidates).toHaveLength(1);
        expect(withoutMotion.candidates[0]).toMatchObject({ kind: 'unknown', reading: 'pair' });
    });

    it('drops distant stars and honours the default and zero margins', () => {
        const outside = gridPixToSky(grid, { x: grid.width - 1 + 10 / grid.pixelArcsec, y: 60 });
        const result = sky([...visit('a', 60000), ...visit('b', 60030)],
            [star('far', grid.center.ra + 2), star('edge', outside.ra, outside.dec)]);
        expect(changeInput(result).stars.map((s) => s.id)).toEqual(['edge', 'edge']);
        expect(changeInput(result, { marginArcsec: 0 }).stars).toEqual([]);
    });

    it('rejects too few visits, reversed or equal visits, and invalid indices', () => {
        expect(() => changeInput(sky(visit('a', 60000)))).toThrow(/two visits/i);
        expect(() => changeInput(sky(visit('a', 60000)))).toThrow(ChangeInputError);
        const result = sky([...visit('a', 60000), ...visit('b', 60030)]);
        for (const opts of [{ earlier: 1, later: 0 }, { earlier: 1, later: 1 }, { earlier: -1 }, { later: 2 }]) {
            expect(() => changeInput(result, opts)).toThrow(ChangeInputError);
        }
    });

    it('selects the requested second and third visits', () => {
        const result = sky([...visit('a', 60000), ...visit('b', 60030), ...visit('c', 60060)]);
        const input = changeInput(result, { earlier: 1, later: 2 });
        expect(input.visits).toBe(3);
        expect(input.earlier.obsIds).toEqual(['b0', 'b1', 'b2']);
        expect(input.later.obsIds).toEqual(['c0', 'c1', 'c2']);
    });

    it('notes when no catalogue stars are available', () => {
        expect(changeInput(sky([...visit('a', 60000), ...visit('b', 60030)])).notes[0])
            .toBe('No catalogue stars for this view: every spot is listed without a catalogue match.');
    });

    it('does not claim noise was estimated when wavelengths prevent comparison', () => {
        const result = sky([frame('a', 60000, 2), frame('b', 60030, 2.1)]);
        const found = findChanges(result, {}, { plain: true });
        expect(found.notes[1]).toBe('The two visits were not compared: their wavelengths differ by more than 0.02 µm.');
        expect(found.notes.some((n) => n.startsWith('No error maps'))).toBe(false);
        expect(Number.isFinite(found.sigma)).toBe(false);
    });

    it('finds a catalogue-matched brightening and preserves input notes', () => {
        const frames: RegriddedFrame[] = [];
        for (const [prefix, mjd, amplitude] of [['a', 60000, 200], ['b', 60030, 800]] as const) {
            for (let i = 0; i < 3; i++) {
                const data = noise(grid);
                point(data, 30, 30, 50);
                point(data, 90, 90, 80);
                point(data, 60, 60, amplitude);
                frames.push(frame(`${prefix}${i}`, mjd + i * 0.1, 2, data));
            }
        }
        const result = sky(frames, [star('g1')]);
        const input = changeInput(result);
        const found = findChanges(result);
        expect(found.candidates.some((c) => c.kind === 'unknown' && c.gaiaMatch
            && /reads brighter.*sharper image/.test(c.reason)
            && Math.hypot(c.pix.x - 60, c.pix.y - 60) * grid.pixelArcsec < 3)).toBe(true);
        expect(input.notes).not.toHaveLength(0);
        for (const note of input.notes) {
            if (!note.startsWith('No error maps')) { expect(found.notes).toContain(note); }
        }
        expect(found.notes.filter((note) => /error map|noise from the difference/i.test(note))).toHaveLength(1);
        expect(found.notes.join(' ')).toMatch(/noise from the difference image.*no error maps/i);
    });
});
