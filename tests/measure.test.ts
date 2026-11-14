import { describe, expect, it } from 'vitest';
import { apertureFor, centreNear, coreBlank, curveFor, frameMjd, middleMjd, ringsOn, shiftFor, sumNoise, visitsOf } from '../src/ui/measure';
import { aperture } from '../src/lib/photometry';
import { gridPixToSky } from '../src/lib/regrid';
import { separationDeg } from '../src/lib/coords';
import { GaiaError, shiftReadout } from '../src/lib/gaia';
import { positionAt } from '../src/lib/targets';
import type { GaiaStar, SkyResult, TrackPoint } from '../src/lib/source';
import type { Astrometry, FrameRecord, OutputGrid, PixelCoord, RegriddedFrame } from '../src/lib/types';

const N = 160;
const grid: OutputGrid = { center: { ra: 10, dec: 20 }, fovDeg: (N * 1.5) / 3600, pixelArcsec: 1.5, width: N, height: N };
const MJD0 = 61000;

function frame(k: number, stars: { at: PixelCoord; flux: number }[], nanAt?: PixelCoord): RegriddedFrame
{
    const data = new Float32Array(N * N).fill(1);
    for (const s of stars) {
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const r2 = (x - s.at.x) ** 2 + (y - s.at.y) ** 2;
                data[y * N + x] = data[y * N + x]! + s.flux * Math.exp(-r2 / (2 * 2 * 2));
            }
        }
    }
    if (nanAt) {
        data[Math.round(nanAt.y) * N + Math.round(nanAt.x)] = NaN;
    }
    const rec = {
        obsId: `F${k}`, collection: 'spherex_dr1', release: 'DR1', detector: 1, url: '', tMin: MJD0 + k * 100, tMax: MJD0 + k * 100 + 0.01,
        lambdaMin: 0.75, lambdaMax: 1.1,
    } as unknown as FrameRecord;
    return { frame: rec, grid, data, lambdaAtCenter: 0.9, bandwidthAtCenter: 0.01 };
}

function star(id: string, at: PixelCoord, g: number, outputGrid = grid): GaiaStar
{
    const c = gridPixToSky(outputGrid, at);
    return { sourceId: id, ra: c.ra, dec: c.dec, g, epochJyear: 2016, pmRa: 0, pmDec: 0, pix: at };
}

const TARGET = { x: 80, y: 80 };
const REFS = [{ x: 30, y: 30 }, { x: 130, y: 30 }, { x: 30, y: 130 }, { x: 130, y: 130 }];

function result(targetFlux: number[], withTrack = true): SkyResult
{
    const frames = targetFlux.map((f, k) => frame(k, [{ at: TARGET, flux: f }, ...REFS.map((at) => ({ at, flux: 200 }))]));
    const track: TrackPoint[] = frames.map((f) => ({ mjd: frameMjd(f), ...grid.center, pix: TARGET }));
    return {
        source: 'snapshot', grid, frames: frames.map((f) => ({ frame: f, label: '' })),
        locked: frames.map(() => ({ lambda: 0.9, dLambda: 0 })) as unknown as SkyResult['locked'],
        lambda: 0.9, stars: REFS.map((at, i) => star(`r${i}`, at, 11 + i)), credits: [], notes: [],
        ...(withTrack ? { track } : {}),
    };
}

describe('apertureFor', () => {
    it('scales native apertures to the output grid and keeps minimum gaps', () => {
        const fine = apertureFor(grid);
        expect(fine.radius).toBeCloseTo(12.3 / 1.5, 10);
        expect(fine.annulusIn).toBeCloseTo(18.45 / 1.5, 10);
        expect(fine.annulusOut).toBeCloseTo(36.9 / 1.5, 10);
        const coarse = apertureFor({ ...grid, pixelArcsec: 6.1 });
        expect(coarse.radius).toBeCloseTo(12.3 / 6.1, 10);
        expect(coarse.annulusIn).toBeCloseTo(18.45 / 6.1, 10);
        expect(coarse.annulusOut).toBeCloseTo(36.9 / 6.1, 10);
        expect(apertureFor({ ...grid, pixelArcsec: 20 })).toEqual({ radius: 1.5, annulusIn: 2.5, annulusOut: 4.5 });
    });
});

describe('centreNear', () => {
    it('finds a star whose core pixel is masked', () => {
        const f = frame(0, [{ at: { x: 40.3, y: 60.7 }, flux: 500 }], { x: 40, y: 61 });
        const c = centreNear(f, { x: 42, y: 59 });
        expect(c?.x).toBeCloseTo(40.3, 0);
        expect(c?.y).toBeCloseTo(60.7, 0);
    });

    it('gives up at the frame edge', () => {
        const f = frame(0, [{ at: { x: 2, y: 2 }, flux: 500 }]);
        expect(centreNear(f, { x: 2, y: 2 })).toBeUndefined();
    });
});

describe('ringsOn', () => {
    it('moves a star to the date and keeps the brightest', () => {
        const r = result([100, 100]);
        // 36 arcsec a year north, about 2.4 px in 100 days on this grid.
        const mover: GaiaStar = { ...star('m', { x: 80, y: 80 }, 5), pmRa: 0, pmDec: 36000 };
        r.stars = [...r.stars, mover];
        const early = ringsOn(r, 57388, 2); // 2016.0
        const late = ringsOn(r, 57388 + 365.25, 2);
        expect(early.map((s) => s.sourceId)).toEqual(['m', 'r0']);
        expect(early[0]!.pix.y - late[0]!.pix.y).toBeCloseTo(24, 0);
        expect(ringsOn(r, NaN, 2)).toEqual([]);
    });
});

describe('curveFor', () => {
    it('measures the target against the steady stars', () => {
        const r = result([100, 200, 100]);
        const c = curveFor(r);
        expect(c).not.toBeNull();
        expect(c!.refs).toBe(4);
        expect(c!.frameOf).toEqual([0, 1, 2]);
        expect(c!.blend).toBeNull();
        const f = r.frames[0]!.frame;
        expect(c!.lc.points[0]!.target.sum).toBeCloseTo(aperture(f.data, N, N, TARGET, apertureFor(grid)).sum, 5);
        const rel = c!.lc.points.map((p) => p.relative);
        expect(rel[1]! / rel[0]!).toBeCloseTo(2, 1);
        expect(rel[2]! / rel[0]!).toBeCloseTo(1, 2);
        expect(middleMjd(r)).toBeCloseTo(MJD0 + 100, 1);
    });

    it('keeps references with room for the scaled annulus on a coarse grid', () => {
        const r = result([100, 100]);
        r.grid = { ...grid, pixelArcsec: 6.1, fovDeg: N * 6.1 / 3600 };
        const refs = [{ x: 10, y: 10 }, { x: 22, y: 10 }, { x: 80, y: 94 }, { x: 100, y: 80 }];
        r.stars = refs.map((at, i) => star(`r${i}`, at, 11 + i, r.grid));
        r.frames = [0, 1].map((k) => ({
            frame: { ...frame(k, [{ at: TARGET, flux: 100 }, ...refs.map((at) => ({ at, flux: 200 }))]), grid: r.grid },
            label: '',
        }));
        expect(curveFor(r)?.refs).toBe(4);
    });

    it('reports the brightest blend at 3 px and ignores the nearest self star at 0.5 px', () => {
        const r = result([100, 100, 100]);
        r.stars.push(star('self', { x: 80.5, y: 80 }, 15), star('blend', { x: 83, y: 80 }, 16.3), star('fainter', { x: 82, y: 80 }, 17));
        const me: Astrometry = { ...grid.center, epochJyear: 2016, pmRa: 0, pmDec: 0 };
        const c = curveFor(r, me);
        expect(c).not.toBeNull();
        expect(c!.blend?.sourceId).toBe('blend');
        expect(c!.blend?.g).toBe(16.3);
        expect(c!.blend?.px).toBeCloseTo(3, 6);
        r.stars = r.stars.filter((s) => s.sourceId !== 'blend' && s.sourceId !== 'fainter');
        expect(curveFor(r, me)?.blend).toBeNull();
        // Over 2.5 mag fainter than the target: under 10% of its light, not a blend.
        r.stars.push(star('faint', { x: 83, y: 80 }, 17.6));
        expect(curveFor(r, me)?.blend).toBeNull();
        // A star that does not move like the target is never taken for it, however close (WISE 0855 is not in Gaia).
        const fast: Astrometry = { ...me, pmRa: -8000, pmDec: -700 };
        expect(curveFor(r, fast)?.blend?.sourceId).toBe('self');
    });

    it('takes the nearest co-moving star as the target, so a brighter companion is the blend (RW Aur A and B)', () => {
        const r = result([100, 100, 100]);
        r.stars.push(star('A', { x: 80, y: 80 }, 13.0), star('B', { x: 82, y: 80 }, 12.2));
        const me: Astrometry = { ...grid.center, epochJyear: 2016, pmRa: 0, pmDec: 0 };
        const c = curveFor(r, me);
        expect(c!.blend?.sourceId).toBe('B');
        expect(c!.blend?.px).toBeCloseTo(2, 6);
    });

    it('solves each comparison star\'s own scatter before adding them', () => {
        // Two equal stars, each seen with scatter s against the other: the sum scatters by s / 2.
        expect(sumNoise([100, 100], [0.02, 0.02])).toBeCloseTo(0.02 / 2, 4);
        // A bright steady star dominates the sum; faint noisy ones barely move it.
        expect(sumNoise([1000, 10, 20, 30], [0.001, 0.3, 0.3, 0.3])).toBeLessThan(0.02);
        // Two stars can't say which one is noisy: their own sky noise decides. Faint and noisy barely moves the sum.
        expect(sumNoise([1000, 10], [0.1, 0.1], [0.0001, 0.1])).toBeLessThan(0.002);
        expect(sumNoise([1000, 10], [0.1, 0.1], [0.1, 0.0001])).toBeGreaterThan(0.09);
        // Non-positive fluxes are skipped and never give a negative noise.
        expect(sumNoise([400, -450], [0.05, 0.05])).toBeGreaterThanOrEqual(0);
        expect(sumNoise([], [])).toBe(0);
    });

    it('checks blends at each frame date and target track position', () => {
        const r = result([100, 100, 100]);
        r.track![0]!.pix = { x: 70, y: 80 };
        r.track![1]!.pix = { x: 75, y: 80 };
        const mover = { ...star('mover', { x: 100, y: 80 }, 16.3), epochJyear: 2000 + (MJD0 + 0.005 - 51544.5) / 365.25, pmRa: 17 * 1.5 * 1000 * 365.25 / 200 };
        r.stars.push(mover);
        const c = curveFor(r);
        expect(c!.blend?.sourceId).toBe('mover');
        expect(c!.blend?.px).toBeCloseTo(3, 2);
    });

    it('weights comparison noise by median reference flux over valid frames', () => {
        const r = result([100, 100, 100, 100, 100, 100]);
        r.frames = [800, 1200, 1000, 900, 1100, 100000].map((flux, k) => ({
            frame: frame(k, [{ at: TARGET, flux: 100 }, ...REFS.map((at, i) => ({ at, flux: i === 0 ? flux : 20 }))], k === 5 ? TARGET : undefined),
            label: '',
        }));
        const c = curveFor(r);
        expect(c?.refs).toBe(4);
        expect(c!.lc.points.filter((p) => p.valid)).toHaveLength(5);
        const fluxes = [1000, 20, 20, 20];
        // Aperture sums are proportional to the injected fluxes, and sumNoise depends only on their ratios.
        expect(c!.noise).toBeCloseTo(sumNoise(fluxes, c!.lc.refScatter), 3);
        expect(c!.noise).toBeGreaterThan(0.1);
    });

    it('needs a track and steady stars', () => {
        expect(curveFor(result([100, 200], false))).toBeNull();
        const r = result([100, 200]);
        r.stars = [];
        expect(curveFor(r)).toBeNull();
    });

    it.each([
        { pmRa: 200, pmDec: 0 },
        { pmRa: 30, pmDec: 40 },
        { pmRa: undefined, pmDec: 0 },
        { pmRa: 0, pmDec: undefined },
        { pmRa: NaN, pmDec: 0 },
    ])('excludes a reference with unsafe motion %j', (motion) => {
        const r = result([100, 100, 100]);
        Object.assign(r.stars[0]!, motion);
        expect(curveFor(r)?.refs).toBe(3);
    });

    it('needs at least two references with known slow motion', () => {
        const r = result([100, 100, 100]);
        r.stars = r.stars.slice(0, 2);
        r.stars[0]!.pmRa = 200;
        expect(curveFor(r)).toBeNull();
    });

    it.each([3, 4])('drops a variable reference from %i refs and recomputes', (count) => {
        const r = result([100, 100, 100]);
        r.stars = r.stars.slice(0, count);
        r.frames = [200, 500, 200].map((flux, k) => ({
            frame: frame(k, [{ at: TARGET, flux: 100 }, ...REFS.slice(0, count).map((at, i) => ({ at, flux: i === count - 1 ? flux : 200 }))]),
            label: '',
        }));
        const c = curveFor(r);
        expect(c?.refs).toBe(count - 1);
        expect(c?.lc.refScatter).toHaveLength(count - 1);
        for (const p of c!.lc.points) {
            expect(p.valid).toBe(true);
            expect(p.relative).toBeCloseTo(1, 6);
        }
    });
});

describe('shiftFor', () => {
    it('is null for one frame and measures from the first to the last otherwise', () => {
        const a: Astrometry = { ...grid.center, epochJyear: 2016, pmRa: 0, pmDec: 0 };
        expect(shiftFor(result([100]), a)).toBeNull();
        const s = shiftFor(result([100, 100, 100]), a);
        expect(s?.from).toBe(0);
        expect(s?.to).toBe(2);
        expect(s?.predictedArcsec).toBe(0);
        expect(s?.significant).toBe(false);
        expect(s?.errArcsec).toBeCloseTo(0.65 * 6.15, 10);
        expect(s?.measured?.measuredArcsec).toBeLessThan(0.2);
    });

    it.each([
        { pmDec: 10000, significant: false },
        { pmDec: 20000, significant: true },
    ])('tests first-to-last motion significance for $pmDec mas/year', ({ pmDec, significant }) => {
        const r = result([100, 100, 100]);
        const a: Astrometry = { ...grid.center, epochJyear: 2016, pmRa: 0, pmDec };
        const s = shiftFor(r, a);
        const expected = separationDeg(positionAt(a, frameMjd(r.frames[0]!.frame)), positionAt(a, frameMjd(r.frames[2]!.frame))) * 3600;
        expect(s?.to).toBe(2);
        expect(s?.predictedArcsec).toBeCloseTo(expected, 8);
        expect(s?.errArcsec).toBeCloseTo(3.9975, 10);
        expect(s?.significant).toBe(significant);
    });

    it.each([0, 2])('rejects a distant centre in frame %i and preserves the catalogue prediction', (index) => {
        const r = result([100, 100, 100]);
        const a: Astrometry = { ...grid.center, epochJyear: 2016, pmRa: 0, pmDec: 10000 };
        const p = r.track![index]!;
        p.pix = { x: TARGET.x + 10, y: TARGET.y };
        const c = centreNear(r.frames[index]!.frame, p.pix);
        expect(c).toBeDefined();
        expect(Math.hypot(c!.x - p.pix.x, c!.y - p.pix.y)).toBeGreaterThan(1.5 * 6.15 / grid.pixelArcsec);
        const s = shiftFor(r, a);
        expect(s?.measured).toBeNull();
        const predicted = separationDeg(positionAt(a, frameMjd(r.frames[0]!.frame)), positionAt(a, frameMjd(r.frames[2]!.frame))) * 3600;
        expect(predicted).toBeGreaterThan(5);
        expect(s?.predictedArcsec).toBeCloseTo(predicted, 8);
    });

    it('preserves the prediction when no centre can be found', () => {
        const r = result([100, 100]);
        r.frames[1]!.frame.data.fill(1);
        const a: Astrometry = { ...grid.center, epochJyear: 2016, pmRa: 0, pmDec: 0 };
        expect(shiftFor(r, a)).toEqual({ from: 0, to: 1, predictedArcsec: 0, errArcsec: 0.65 * 6.15, significant: false, measured: null });
        expect(shiftFor(result([100, 100], false), a)).toBeNull();
    });

    it('returns no measurement when Gaia cannot compare a stale target with the grid', () => {
        const r = result([100, 100]);
        const a: Astrometry = { ra: 190, dec: -20, epochJyear: 2016, pmRa: 0, pmDec: 0 };
        expect(() => shiftReadout(a, grid,
            { mjd: frameMjd(r.frames[0]!.frame), pix: TARGET },
            { mjd: frameMjd(r.frames[1]!.frame), pix: TARGET })).toThrow(GaiaError);
        expect(shiftFor(r, a)).toEqual({ from: 0, to: 1, predictedArcsec: 0, errArcsec: 0.65 * 6.15, significant: false, measured: null });
    });
});

describe('coreBlank', () => {
    it('counts frames with no value at a bright target centre', () => {
        const r = result([5000, 5000, 5000]);
        r.frames[0]!.frame.data[TARGET.y * N + TARGET.x] = NaN;
        r.frames[2]!.frame.data[TARGET.y * N + TARGET.x + 1] = Infinity;
        expect(coreBlank(r)).toEqual({ blank: 2, of: 3 });
    });

    it('ignores blank pixels away from the centre', () => {
        const r = result([5000, 5000]);
        r.frames[0]!.frame.data[(TARGET.y + 10) * N + TARGET.x] = NaN;
        expect(coreBlank(r)).toEqual({ blank: 0, of: 2 });
    });

    it('does not call a blank centre in dark sky saturated', () => {
        const r = result([0, 0]);
        r.frames[0]!.frame.data[TARGET.y * N + TARGET.x] = NaN;
        expect(coreBlank(r)).toEqual({ blank: 0, of: 2 });
    });

    it('needs a track', () => {
        expect(coreBlank(result([100, 100], false))).toBeNull();
    });
});

describe('visitsOf', () => {
    it('groups looks less than 10 days apart', () => {
        const r = result([100, 100, 100, 100]);
        const at = [MJD0, MJD0 + 1, MJD0 + 200, MJD0 + 201.5];
        r.frames.forEach((f, i) => {
            f.frame.frame.tMin = at[i]!;
            f.frame.frame.tMax = at[i]!;
        });
        expect(visitsOf(r).map((v) => v.n)).toEqual([2, 2]);
        expect(visitsOf(r)[1]!.mjd).toBe(MJD0 + 200);
    });
});
