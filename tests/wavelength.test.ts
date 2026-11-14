import { describe, expect, it } from 'vitest';
import f1 from './fixtures/frame/frame1.json';
import f2 from './fixtures/frame/frame2.json';
import w1 from './fixtures/frame/frame1.wcs.json';
import w2 from './fixtures/frame/frame2.wcs.json';
import v1 from './fixtures/frame/frame1.wave.json';
import v2 from './fixtures/frame/frame2.wave.json';
import type { FrameRecord, WaveGrid } from '../src/lib/types';
import { groupVisits, sampleWave } from '../src/lib/wavelength';

const FILES: Record<string, any> = {
    'frame1.json': f1, 'frame2.json': f2,
    'frame1.wcs.json': w1, 'frame2.wcs.json': w2,
    'frame1.wave.json': v1, 'frame2.wave.json': v2,
};

function load(name: string): any
{
    return FILES[name];
}

function gridFrom(w: any): WaveGrid
{
    const xs: number[] = w.X.map((v: number) => v - 1);
    const ys: number[] = w.Y.map((v: number) => v - 1);
    return {
        xs,
        ys,
        lambda: w.VALUES.map((row: number[][]) => row.map((c) => c[0])),
        bandwidth: w.VALUES.map((row: number[][]) => row.map((c) => c[1])),
    };
}

for (const frame of ['frame1', 'frame2']) {
    describe(`sampleWave ${frame}`, () => {
        const w = load(`${frame}.wave.json`);
        const grid = gridFrom(w);
        it('matches astropy within 0.001 um', () => {
            for (const s of w.samples) {
                const got = sampleWave(grid, { x: s.pixel[0], y: s.pixel[1] });
                expect(Math.abs(got.lambda - s.lambda)).toBeLessThan(0.001);
                expect(Math.abs(got.bandwidth - s.bandwidth)).toBeLessThan(0.001);
            }
        });
        it('clamps outside the grid', () => {
            const a = sampleWave(grid, { x: -50, y: -50 });
            const b = sampleWave(grid, { x: 0, y: 0 });
            expect(a).toEqual(b);
        });
    });
}

function fr(id: string, det: 1 | 2, t: number): FrameRecord
{
    return {
        obsId: id, collection: 'spherex_dr1', release: 'dr1', detector: det, url: '',
        tMin: t, tMax: t + 0.001, lambdaMin: 1, lambdaMax: 2,
    };
}

describe('groupVisits', () => {
    it('splits on gap, sorts, and separates detectors', () => {
        const frames = [fr('c', 1, 10.5), fr('a', 1, 10), fr('d', 1, 20), fr('x', 2, 10.1)];
        const v = groupVisits(frames, 1);
        expect(v.map((g) => g.map((f) => f.obsId))).toEqual([['a', 'c'], ['d'], ['x']]);
    });
    it('handles empty input', () => {
        expect(groupVisits([], 1)).toEqual([]);
    });
    it('does not chain daily coverage into one visit', () => {
        const daily = Array.from({ length: 366 }, (_, i) => fr(`d${i}`, 1, 61000 + i));
        const v = groupVisits(daily, 10);
        expect(v.length).toBe(Math.ceil(366 / 11));
        for (const g of v) {
            expect(g[g.length - 1]!.tMin - g[0]!.tMin).toBeLessThanOrEqual(10);
        }
    });
});
