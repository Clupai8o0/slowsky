import { describe, expect, it } from 'vitest';
import {
    MAX_FPS, clampFps, drawFrame, frameDelayMs, initialState, percentile, renderRgba, sharedStretch,
    stepIndex, stretchValue, type PixelSurface,
} from '../src/lib/player';
import { commonRange, lockWavelength } from '../src/lib/lock';
import type { FrameRecord, PlayerFrame, Stretch } from '../src/lib/types';

function frameRecord(obsId: string, tMin: number): FrameRecord
{
    return {
        obsId, collection: 'spherex_dr1', release: 'dr1', detector: 1, url: `https://x/${obsId}.fits`,
        tMin, tMax: tMin + 0.001, lambdaMin: 0.75, lambdaMax: 1.1,
    };
}

function playerFrame(data: number[], width: number, height: number, t = 60000): PlayerFrame
{
    return {
        label: 'f',
        frame: {
            frame: frameRecord(`o${t}`, t),
            grid: { center: { ra: 0, dec: 0 }, fovDeg: 0.1, pixelArcsec: 1.5, width, height },
            data: Float32Array.from(data),
            lambdaAtCenter: 1,
            bandwidthAtCenter: 0.01,
        },
    };
}

describe('sharedStretch', () => {
    it('pools all frames, so one bright frame sets hi for every frame', () => {
        const dim = playerFrame(Array.from({ length: 100 }, (_, i) => i / 100), 10, 10);
        const bright = playerFrame(Array.from({ length: 100 }, (_, i) => 10 + i), 10, 10, 60001);
        const s = sharedStretch([dim, bright]);
        expect(s.kind).toBe('asinh');
        expect(s.lo).toBeLessThan(0.05);
        expect(s.hi).toBeGreaterThan(100);
        const alone = sharedStretch([dim]);
        expect(alone.hi).toBeLessThan(1);
    });

    it('ignores NaN and survives empty or flat input', () => {
        const nan = playerFrame([NaN, NaN, 5, 5], 2, 2);
        const s = sharedStretch([nan]);
        expect(Number.isFinite(s.lo)).toBe(true);
        expect(s.hi).toBeGreaterThan(s.lo);
        expect(sharedStretch([])).toEqual({ lo: 0, hi: 1, kind: 'asinh' });
        expect(sharedStretch([playerFrame([NaN], 1, 1)])).toEqual({ lo: 0, hi: 1, kind: 'asinh' });
    });

    it('percentile interpolates between order statistics', () => {
        const a = Float64Array.from([0, 10, 20, 30, 40]);
        expect(percentile(a, 0)).toBe(0);
        expect(percentile(a, 100)).toBe(40);
        expect(percentile(a, 50)).toBe(20);
        expect(percentile(a, 62.5)).toBeCloseTo(25, 12);
    });
});

describe('stretch and pixels', () => {
    const lin: Stretch = { lo: 0, hi: 10, kind: 'linear' };
    const ash: Stretch = { lo: 0, hi: 10, kind: 'asinh' };

    it('clamps, keeps NaN, and asinh lifts faint values', () => {
        expect(stretchValue(-5, lin)).toBe(0);
        expect(stretchValue(5, lin)).toBe(0.5);
        expect(stretchValue(50, lin)).toBe(1);
        expect(stretchValue(NaN, lin)).toBeNaN();
        expect(stretchValue(1, ash)).toBeGreaterThan(stretchValue(1, lin));
        expect(stretchValue(10, ash)).toBeCloseTo(1, 12);
    });

    it('renderRgba matches stretchValue and makes NaN transparent', () => {
        const data = Float32Array.from([0, 2.5, 10, NaN]);
        const px = renderRgba(data, ash);
        for (let i = 0; i < 3; i++) {
            const want = Math.round(stretchValue(data[i] as number, ash) * 255);
            expect(Math.abs((px[i * 4] as number) - want)).toBeLessThanOrEqual(1);
            expect(px[i * 4 + 3]).toBe(255);
        }
        expect(px[12 + 3]).toBe(0);
        expect(() => renderRgba(data, ash, new Uint8ClampedArray(3))).toThrow();
    });

    it('drawFrame puts one image at the origin with the grid size', () => {
        const calls: Array<[number, number, number]> = [];
        const surface: PixelSurface = {
            createImageData(w: number, h: number): ImageData
            {
                return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as ImageData;
            },
            putImageData(img: ImageData, x: number, y: number): void
            {
                calls.push([img.width, x, y]);
                expect(img.data[3]).toBe(255);
            },
        };
        drawFrame(surface, playerFrame([1, 2, 3, 4, 5, 6], 3, 2), lin);
        expect(calls).toEqual([[3, 0, 0]]);
        expect(() => drawFrame(surface, playerFrame([1, 2, 3], 3, 2), lin)).toThrow();
    });
});

describe('timing', () => {
    it('caps the speed and starts paused', () => {
        expect(clampFps(100)).toBe(MAX_FPS);
        expect(clampFps(0)).toBe(0.5);
        expect(clampFps(NaN)).toBe(1);
        expect(frameDelayMs(100)).toBe(250);
        const st = initialState({ lo: 0, hi: 1, kind: 'asinh' });
        expect(st.playing).toBe(false);
        expect(st.index).toBe(0);
    });

    it('steps and wraps both ways', () => {
        expect(stepIndex(0, 5, 1)).toBe(1);
        expect(stepIndex(4, 5, 1)).toBe(0);
        expect(stepIndex(0, 5, -1)).toBe(4);
        expect(stepIndex(3, 0, 1)).toBe(0);
    });
});

describe('wavelength lock', () => {
    const v1 = [frameRecord('a1', 60000.0), frameRecord('a2', 60000.1), frameRecord('a3', 60000.2)];
    const v2 = [frameRecord('b1', 60180.0), frameRecord('b2', 60180.1)];
    const lam: Record<string, number> = { a1: 0.90, a2: 0.95, a3: 1.00, b1: 0.97, b2: 1.02 };
    const lambdaOf = (f: FrameRecord): number | undefined => lam[f.obsId];

    it('keeps the nearest frame per visit, sorted by time, with the offset', () => {
        const got = lockWavelength([v2, v1], lambdaOf, 0.96);
        expect(got.map((g) => g.frame.obsId)).toEqual(['a2', 'b1']);
        expect(got[0]?.dLambda).toBeCloseTo(-0.01, 12);
        expect(got[1]?.dLambda).toBeCloseTo(0.01, 12);
    });

    it('drops visits beyond maxDelta and frames with no wavelength', () => {
        const got = lockWavelength([v1, v2], lambdaOf, 0.90, { maxDelta: 0.05 });
        expect(got.map((g) => g.frame.obsId)).toEqual(['a1']);
        expect(lockWavelength([v1], () => undefined, 1)).toEqual([]);
        expect(() => lockWavelength([v1], lambdaOf, NaN)).toThrow();
    });

    it('chooses the nearest frame inside its own passband', () => {
        const narrow = frameRecord('narrow', 60000);
        const wide = frameRecord('wide', 60000.1);
        const lambdaOf = (f: FrameRecord): number => f === narrow ? 1.000 : 1.0303;
        const limitOf = (f: FrameRecord): number => (f === narrow ? 0.030 : 0.031) / 2;
        const visits = [[narrow, wide]];
        const got = lockWavelength(visits, lambdaOf, 1.0151, { limitOf });
        expect(got.map((g) => g.frame.obsId)).toEqual(['wide']);
        expect(got[0]?.dLambda).toBeCloseTo(0.0152, 12);
        expect(lockWavelength(visits, lambdaOf, 1.0151, { limitOf, maxDelta: 0.015 })).toEqual([]);
        expect(lockWavelength(visits, lambdaOf, 1.0151, { limitOf, maxDelta: 0.016 })).toHaveLength(1);
    });

    it('rejects frames with an invalid passband limit', () => {
        const invalid = frameRecord('invalid', 60000);
        const valid = frameRecord('valid', 60000.1);
        const lambdaOf = (f: FrameRecord): number => f === invalid ? 1 : 1.01;
        const limitOf = (f: FrameRecord): number => f === invalid ? NaN : 0.015;
        const got = lockWavelength([[invalid, valid]], lambdaOf, 1, { limitOf });
        expect(got.map((g) => g.frame.obsId)).toEqual(['valid']);
        expect(lockWavelength([[invalid]], lambdaOf, 1, { limitOf })).toEqual([]);
    });

    it('commonRange is the overlap of every visit', () => {
        expect(commonRange([v1, v2], lambdaOf)).toEqual([0.97, 1.00]);
        const far = [frameRecord('c1', 60300)];
        expect(commonRange([v1, far], (f) => (f.obsId === 'c1' ? 2 : lam[f.obsId]))).toBeUndefined();
        expect(commonRange([], lambdaOf)).toBeUndefined();
    });
});
