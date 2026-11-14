import { describe, expect, it } from 'vitest';
import * as planetx from '../src/lib/planetx';

describe('Planet Nine brightness estimate', () => {
    it('agrees with Neptune at mean opposition using its measured radius', () => {
        // NASA Neptune Fact Sheet, bulk and opposition parameters:
        // https://nssdc.gsfc.nasa.gov/planetary/factsheet/neptunefact.html
        const h = planetx.absoluteMag(24622, 0.442);
        const distance = 30.06896348;
        const magnitude = h + 5 * Math.log10(distance * (distance - 1));
        expect(Math.abs(magnitude - 7.7)).toBeLessThan(0.3);
    });

    it('places the illustrative V estimate within the plotted conditional R-curve extents', () => {
        const value = planetx.apparentMag(planetx.P9.mass.value, 0.475, planetx.P9.semiMajorAxis.value);
        expect(value).toBeGreaterThan(planetx.P9.percentileCurveExtents.value[0]);
        expect(value).toBeLessThan(planetx.P9.percentileCurveExtents.value[1]);
    });

    it('uses the stated distance approximation', () => {
        expect(planetx.magChangeWithDistance(500, 1000)).toBeCloseTo(10 * Math.log10(2), 12);
    });

    it('computes the assumed one-observation depths', () => {
        for (const range of planetx.SPHEREX_DEPTH) {
            expect(range.singleFrame.value[0]).toBeCloseTo(range.fourPass.value[0] - 0.75, 2);
            expect(range.singleFrame.value[1]).toBeCloseTo(range.fourPass.value[1] - 0.75, 2);
        }
    });

    it('keeps the W2 comparison in the longest wavelength range', () => {
        const long = planetx.SPHEREX_DEPTH[1];
        expect(planetx.WISE0855.bandMicrometres.value).toBeGreaterThanOrEqual(long.wavelength.value[0]);
        expect(planetx.WISE0855.bandMicrometres.value).toBeLessThanOrEqual(long.wavelength.value[1]);
        expect(planetx.WISE0855.w2AB.value).toBeCloseTo(17.229, 6);
        expect(planetx.WISE0855.w2AB.value - long.singleFrame.value[0]).toBeCloseTo(0.179, 6);
        expect(planetx.WISE0855.w2AB.value - long.fourPass.value[0]).toBeCloseTo(-0.571, 6);
    });

    it('sources every cited value and supplies unique matching references', () => {
        const refs = planetx.references();
        expect(new Set(refs.map((ref) => ref.url)).size).toBe(refs.length);
        expect(new Set(refs.map((ref) => ref.key)).size).toBe(refs.length);
        const walk = (value: unknown): void => {
            if (typeof value === 'string') {
                expect(value).not.toMatch(/discover/i);
            } else if (value && typeof value === 'object') {
                if ('value' in value && 'source' in value && 'kind' in value) {
                    const cited = value as planetx.Cited<unknown>;
                    expect(cited.source).toMatch(/https?:\/\//);
                    expect(['published', 'derived', 'read-from-figure']).toContain(cited.kind);
                    const urls = cited.source.match(/https?:\/\/[^\s;]+/g) ?? [];
                    expect(urls.length).toBeGreaterThan(0);
                    for (const url of urls) {
                        expect(refs.some((ref) => ref.url === url)).toBe(true);
                    }
                }
                Object.values(value).forEach(walk);
            }
        };
        [planetx.P9, planetx.SPHEREX_DEPTH, planetx.SURVEYS, planetx.EXCLUDED_FRACTION, planetx.WISE0855, planetx.TEXT, refs].forEach(walk);
        expect(planetx.TEXT.caveat).toContain('estimate');
    });

    it('rejects invalid values across the model', () => {
        for (const bad of [0, -1, NaN, Infinity]) {
            expect(() => planetx.radiusKm(bad)).toThrow(RangeError);
            expect(() => planetx.absoluteMag(bad, 0.5)).toThrow(RangeError);
            expect(() => planetx.absoluteMag(100, bad)).toThrow(RangeError);
            expect(() => planetx.apparentMag(bad, 0.5, 500)).toThrow(RangeError);
            expect(() => planetx.magChangeWithDistance(bad, 500)).toThrow(RangeError);
            expect(() => planetx.magChangeWithDistance(500, bad)).toThrow(RangeError);
        }
        expect(() => planetx.absoluteMag(100, 1.1)).toThrow(RangeError);
        expect(() => planetx.apparentMag(6, 0.5, 1)).toThrow(RangeError);
        expect(Number.isFinite(planetx.absoluteMag(100, 1))).toBe(true);
    });
});
