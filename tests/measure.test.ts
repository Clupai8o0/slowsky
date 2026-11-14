import { describe, expect, it } from 'vitest';
import { centreNear, curveFor, frameMjd, middleMjd, ringsOn, shiftFor } from '../src/ui/measure';
import { gridPixToSky } from '../src/lib/regrid';
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

function star(id: string, at: PixelCoord, g: number): GaiaStar
{
    const c = gridPixToSky(grid, at);
    return { sourceId: id, ra: c.ra, dec: c.dec, g, epochJyear: 2016, pix: at };
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
        const rel = c!.lc.points.map((p) => p.relative);
        expect(rel[1]! / rel[0]!).toBeCloseTo(2, 1);
        expect(rel[2]! / rel[0]!).toBeCloseTo(1, 2);
        expect(middleMjd(r)).toBeCloseTo(MJD0 + 100, 1);
    });

    it('needs a track and steady stars', () => {
        expect(curveFor(result([100, 200], false))).toBeNull();
        const r = result([100, 200]);
        r.stars = [];
        expect(curveFor(r)).toBeNull();
    });
});

describe('shiftFor', () => {
    it('is null for one frame and measures from frame 1 otherwise', () => {
        const a: Astrometry = { ...grid.center, epochJyear: 2016, pmRa: 0, pmDec: 0 };
        expect(shiftFor(result([100]), a, 0)).toBeNull();
        const s = shiftFor(result([100, 100, 100]), a, 0);
        expect(s?.to).toBe(2);
        expect(s?.measuredArcsec).toBeLessThan(0.2);
    });
});
