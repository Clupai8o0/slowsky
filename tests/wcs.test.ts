import { describe, expect, it } from 'vitest';
import f1 from './fixtures/frame/frame1.json';
import f2 from './fixtures/frame/frame2.json';
import w1 from './fixtures/frame/frame1.wcs.json';
import w2 from './fixtures/frame/frame2.wcs.json';
import v1 from './fixtures/frame/frame1.wave.json';
import v2 from './fixtures/frame/frame2.wave.json';
import type { CardValue, FitsHeader } from '../src/lib/types';
import { makeWcs, wcsFromHeader } from '../src/lib/wcs';

const FILES: Record<string, any> = {
    'frame1.json': f1, 'frame2.json': f2,
    'frame1.wcs.json': w1, 'frame2.wcs.json': w2,
    'frame1.wave.json': v1, 'frame2.wave.json': v2,
};

function load(name: string): any
{
    return FILES[name];
}

function headerFrom(obj: Record<string, CardValue>): FitsHeader
{
    const cards = new Map<string, CardValue>(Object.entries(obj));
    return {
        cards,
        history: [],
        get: (k: string) => cards.get(k),
        num(k: string): number
        {
            const v = cards.get(k);
            if (typeof v !== 'number') {
                throw new Error(`missing numeric ${k}`);
            }
            return v;
        },
    };
}

for (const frame of ['frame1', 'frame2']) {
    describe(`wcs ${frame}`, () => {
        const wcs = makeWcs(wcsFromHeader(headerFrom(load(`${frame}.json`).imageHeader)));
        const ref = load(`${frame}.wcs.json`);
        const cd = wcs.params.cd;
        const scale = Math.sqrt(Math.abs(cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0]));

        it('pixToSky matches astropy within 0.01 px', () => {
            for (const s of ref.pixToSky) {
                const got = wcs.pixToSky({ x: s.pixel[0], y: s.pixel[1] });
                let dra = got.ra - s.sky[0];
                if (dra > 180) {
                    dra -= 360;
                }
                if (dra < -180) {
                    dra += 360;
                }
                dra *= Math.cos((s.sky[1] * Math.PI) / 180);
                const err = Math.hypot(dra, got.dec - s.sky[1]) / scale;
                expect(err).toBeLessThan(0.01);
            }
        });

        it('skyToPix matches astropy within 0.01 px', () => {
            for (const s of ref.skyToPix) {
                const got = wcs.skyToPix({ ra: s.sky[0], dec: s.sky[1] });
                expect(Math.hypot(got.x - s.pixel[0], got.y - s.pixel[1])).toBeLessThan(0.01);
            }
        });

        it('round trips within 1e-6 px', () => {
            for (const s of ref.pixToSky) {
                const sky = wcs.pixToSky({ x: s.pixel[0], y: s.pixel[1] });
                const back = wcs.skyToPix(sky);
                expect(Math.abs(back.x - s.pixel[0])).toBeLessThan(1e-6);
                expect(Math.abs(back.y - s.pixel[1])).toBeLessThan(1e-6);
            }
        });
    });
}

describe('wcs misc', () => {
    it('wraps RA at 0/360', () => {
        const wcs = makeWcs({
            crpix: [10, 10],
            crval: [0.001, 0],
            cd: [[-0.001, 0], [0, 0.001]],
            naxis: [20, 20],
        });
        const sky = wcs.pixToSky({ x: 0, y: 9 });
        expect(sky.ra).toBeGreaterThanOrEqual(0);
        expect(sky.ra).toBeLessThan(360);
        const back = wcs.skyToPix(sky);
        expect(back.x).toBeCloseTo(0, 6);
    });

    it('rejects other projections', () => {
        const h = headerFrom({ CTYPE1: 'RA---SIN', CTYPE2: 'DEC--SIN' });
        expect(() => wcsFromHeader(h)).toThrow();
    });
});
