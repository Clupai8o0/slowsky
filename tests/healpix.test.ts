import { describe, expect, it } from 'vitest';
import { healpixCenter, healpixPosition, skyToHealpix } from '../src/lib/healpix';
import fixture from './fixtures/cube/fixture.json';

describe('fresh nested HEALPix geometry', () => {
    it('agrees with independent astropy-healpix cells and centres at orders 5 and 14', () => {
        for (const item of fixture.healpixReferences) {
            const position = healpixPosition(item.coord, item.order);
            expect(item.boundaryCells, JSON.stringify(item)).toContain(position.cell);
            if (position.cell === item.cell) {
                const tolerance = 1e-10;
                expect(Math.abs(position.dx - item.dx)).toBeLessThan(tolerance);
                expect(Math.abs(position.dy - item.dy)).toBeLessThan(tolerance);
            }
            const center = healpixCenter(item.cell, item.order);
            const deltaRa = ((center.ra - item.center.ra + 540) % 360) - 180;
            expect(Math.abs(deltaRa)).toBeLessThan(1e-7);
            expect(Math.abs(center.dec - item.center.dec)).toBeLessThan(1e-7);
        }
    });
    it('finds the two IRSA target cells and continuous face offsets', () => {
        const eps = healpixPosition({ ra: 331.0964, dec: -56.8005 }, 5);
        expect(eps.cell).toBe(11391);
        expect(eps.dx).toBeCloseTo(0.20144650969459832, 10);
        expect(eps.dy).toBeCloseTo(0.19152894994808456, 10);
        expect(skyToHealpix({ ra: 76.9563, dec: 30.4014 }, 5)).toBe(277);
    });

    it('round trips every base cell and order-5 centre', () => {
        for (const order of [0, 5]) {
            for (let cell = 0; cell < 12 * 4 ** order; cell++) {
                expect(skyToHealpix(healpixCenter(cell, order), order)).toBe(cell);
            }
        }
        expect(healpixCenter(0, 0).ra).toBeCloseTo(45, 12);
        expect(healpixCenter(4, 0)).toEqual({ ra: 0, dec: 0 });
        expect(healpixCenter(8, 0).dec).toBeCloseTo(-41.810314895778596, 10);
    });

    it('wraps RA, handles poles, and rejects invalid coordinates and orders', () => {
        for (const dec of [-90, -41.810314895778596, 0, 41.810314895778596, 90]) {
            expect(skyToHealpix({ ra: 360, dec }, 5)).toBe(skyToHealpix({ ra: 0, dec }, 5));
            expect(skyToHealpix({ ra: -90, dec }, 5)).toBe(skyToHealpix({ ra: 270, dec }, 5));
        }
        expect(() => skyToHealpix({ ra: NaN, dec: 0 }, 5)).toThrow();
        expect(() => skyToHealpix({ ra: 0, dec: 91 }, 5)).toThrow();
        for (const order of [-1, 0.5, 25]) {
            expect(() => skyToHealpix({ ra: 0, dec: 0 }, order)).toThrow();
        }
        expect(() => healpixCenter(12, 0)).toThrow();
    });
});
