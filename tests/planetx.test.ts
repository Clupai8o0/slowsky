import { describe, expect, it } from 'vitest';
import * as p from '../src/lib/planetx';

describe('Planet Nine brightness estimate', () => {
    it('pins published values and their paper and locator', () => {
        const entries: [p.Cited<unknown>, unknown, RegExp][] = [
            [p.P9.mass, 6.2, /Brown & Batygin 2021.*abstract/i],
            [p.P9.massUncertainty, [-1.3, 2.2], /Brown & Batygin 2021.*abstract/i],
            [p.P9.semiMajorAxis, 380, /Brown & Batygin 2021.*abstract/i],
            [p.P9.semiMajorAxisUncertainty, [-80, 140], /Brown & Batygin 2021.*abstract/i],
            [p.P9.albedo, [0.2, 0.75], /Brown & Batygin 2021.*section 5/i],
            [p.P9.massRadiusRule, 'radius / Earth radius = mass / (3 Earth masses)', /Brown & Batygin 2021.*section 5/i],
            [p.P9.earthRadius, 6371, /NASA Earth Fact Sheet.*volumetric mean radius/i],
            [p.P9.diameterMagnitudeConstant, 1329, /Masiero et al\. 2011.*section 1/i],
            [p.P9.percentileCurveExtents, [18, 23], /Brown & Batygin 2021.*2108\.09868v2.*Figure 9/i],
            [p.P9.envelope, [17, 25.5], /Brown & Batygin 2021.*2108\.09868v2.*Figure 9/i],
            ...p.SURVEYS.map((survey, i): [p.Cited<unknown>, unknown, RegExp] => [survey.limit, [22, 21.8, 21.5, 20.9, 19.7, 20.5, 23.8][i], i < 5 ? /Brown, Holman & Batygin 2024.*section II/i : i === 5 ? /Brown & Batygin 2022.*abstract/i : /Belyakov et al\. 2022.*section I/i]),
            [p.EXCLUDED_FRACTION, 0.78, /Brown, Holman & Batygin 2024.*abstract, sections 5 and 6/i],
            [p.WISE0855.w2Vega, 13.89, /Luhman 2014.*Table 1/i],
            [p.WISE0855.w2Error, 0.05, /Luhman 2014.*Table 1/i],
            [p.WISE0855.w2Offset, 3.339, /WISE Explanatory Supplement.*Table 3/i],
            [p.WISE0855.bandMicrometres, 4.6, /WISE Explanatory Supplement.*Table 8/i],
            [p.SPHEREX_DEPTH[0].wavelength, [0.75, 3.8], /Bock et al\. 2025.*Figure 19/i],
            [p.SPHEREX_DEPTH[0].fourObservations, [19.5, 19.9], /Bock et al\. 2025.*Figure 19/i],
            [p.SPHEREX_DEPTH[1].wavelength, [3.8, 5], /Bock et al\. 2025.*Figure 19/i],
            [p.SPHEREX_DEPTH[1].fourObservations, [17.8, 18.8], /Bock et al\. 2025.*Figure 19/i],
            [p.PS1_HALF_COMPLETE, 21.5, /Brown, Holman & Batygin 2024.*abstract/i],
            [p.REMAINING.distanceAu, { value: 550, lower: -180, upper: 250 }, /Brown, Holman & Batygin 2024.*section 6/i],
            [p.REMAINING.vMag, { value: 22, lower: -1.4, upper: 1.1 }, /Brown, Holman & Batygin 2024.*section 6/i],
        ];
        expect(p.SURVEYS).toHaveLength(7);
        expect(p.SURVEYS.map(({ name, band }) => [name, band])).toEqual([
            ['Pan-STARRS1', 'g'], ['Pan-STARRS1', 'r'], ['Pan-STARRS1', 'i'],
            ['Pan-STARRS1', 'z'], ['Pan-STARRS1', 'y'], ['ZTF', 'V'], ['DES', 'r'],
        ]);
        for (const [entry, expected, source] of entries) {
            expect(entry.value).toEqual(expected);
            expect(entry.source).toMatch(source);
            expect(entry.kind).toBe(entry === p.P9.percentileCurveExtents || entry === p.P9.envelope ? 'read-from-figure' : 'published');
        }
        expect(p.SURVEYS[5]?.limit.unit).toContain('approximate 95% detection efficiency');
        expect(p.SURVEYS[6]?.limit.unit).toContain('typical limiting magnitude (r)');
        expect(p.EXCLUDED_FRACTION.unit).toContain("fraction of the synthetic reference population (assumes the 2021 paper's radius and albedo range)");
    });

    it('computes the W2 conversion, range margins and independent depth expectations', () => {
        expect(p.WISE0855.w2AB.value).toBeCloseTo(p.WISE0855.w2Vega.value + p.WISE0855.w2Offset.value, 12);
        const long = p.SPHEREX_DEPTH[1];
        const margins = p.wise0855Margin();
        expect(margins.fourObservations).toEqual([-1.57, -0.57]);
        expect(margins.oneObservation).toEqual([-0.82, 0.18]);
        for (const pair of [margins.fourObservations, margins.oneObservation]) {
            expect(pair[0]).toBeLessThan(pair[1]);
            for (const value of pair) {
                expect(Number(value.toFixed(2))).toBe(value);
            }
        }
        expect(p.SPHEREX_DEPTH[0].oneObservation.value).toEqual([18.75, 19.15]);
        expect(long.oneObservation.value).toEqual([17.05, 18.05]);
        expect(long.oneObservation.unit).toContain('one observation per channel (derived: 4-observation depth minus 0.75 mag)');
        expect(long.fourObservations.source).toContain('5 sigma point source, per spectral channel, 4 observations per channel at the median sky, Galactic plane excluded');
    });

    it('labels the conditional model example and compares it with the figure', () => {
        const albedo = (p.P9.albedo.value[0] + p.P9.albedo.value[1]) / 2;
        const example = p.modelExample();
        expect(example.vMag).toBe(p.apparentMag(p.P9.mass.value, albedo, p.P9.semiMajorAxis.value));
        expect(example.label).toContain('380 AU (its fitted semi-major axis, not its likely current distance)');
        expect(example.vMag).toBeGreaterThan(p.P9.percentileCurveExtents.value[0]);
        expect(example.vMag).toBeLessThan(p.P9.percentileCurveExtents.value[1]);
    });

    it('checks all exported content for sourcing and careful language', () => {
        const refs = p.references();
        expect(new Set(refs.map((ref) => ref.url)).size).toBe(refs.length);
        const walk = (value: unknown): void => {
            if (typeof value === 'string') {
                expect(value).not.toMatch(/discover|confirm/i);
                expect(value.replace(/detection efficiency/gi, '')).not.toMatch(/detect/i);
            } else if (value && typeof value === 'object') {
                if ('value' in value && 'source' in value && 'kind' in value) {
                    const cited = value as p.Cited<unknown>;
                    expect(cited.source).toMatch(/(Brown|Bock|Luhman|WISE|NASA|Masiero|Belyakov)/i);
                    expect(cited.source).toMatch(/(section|table|figure|abstract|fact sheet)/i);
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
        [p.P9, p.SPHEREX_DEPTH, p.SURVEYS, p.EXCLUDED_FRACTION, p.WISE0855, p.REMAINING, p.PS1_HALF_COMPLETE, p.TEXT, p.modelExample(), refs].forEach(walk);
        expect(p.TEXT.stackGain).not.toMatch(/\d/);
        expect(p.TEXT.bandNote).not.toMatch(/best case/i);
        expect(p.TEXT.bandNote).not.toMatch(/optical R only/i);
        expect(p.TEXT.bandNote).toMatch(/different bands/i);
        expect(p.TEXT.bandNote).toContain('papers listed');
        expect(p.TEXT.bandNote).toContain("this repo's own estimate (reflected sunlight, V band)");
        expect(p.TEXT.bandNote).toContain('no colour correction');
        expect(p.TEXT.bandNote).toContain('compare them only roughly');
        expect(p.TEXT.caveat).toContain('estimate');
        expect(p.TEXT.caveat).toContain('seen at opposition, fully lit');
        expect(p.TEXT.caveat).not.toMatch(/colour/i); // said once, in bandNote
        expect(p.TEXT.wiseNote).toContain('broadband average');
        expect(refs.filter((ref) => /Brown & Batygin 2021/i.test(ref.text))).toHaveLength(1);
        expect(refs.find((ref) => ref.key === 'orbit-v2')).toBeUndefined();
        const orbitUrl = refs.find((ref) => ref.key === 'orbit')?.url;
        expect(orbitUrl).toBeDefined();
        expect(p.P9.mass.source).toContain(orbitUrl!);
        expect(p.P9.percentileCurveExtents.source).toContain(orbitUrl!);
        expect(p.P9.envelope.source).toContain(orbitUrl!);
        expect(refs.find((ref) => ref.key === 'ztf')?.text).toContain('Brown & Batygin 2022');
        expect(refs.find((ref) => ref.key === 'inverse-fourth')?.text).toMatch(/\(cited only for the distance scaling\)$/);
    });

    it('matches Neptune, opposition distance geometry and the far-Sun inverse-fourth limit', () => {
        const magnitude = p.absoluteMag(24622, 0.442) + 5 * Math.log10(30.06896348 * (30.06896348 - 1));
        expect(Math.abs(magnitude - 7.7)).toBeLessThan(0.3);
        expect(Math.abs(p.magChangeWithDistance(380, 550) - 10 * Math.log10(550 / 380))).toBeLessThan(0.005);
        const distances = [2, 30, 380, 550];
        for (const from of distances) {
            for (const to of distances) {
                const diff = p.apparentMag(6.2, 0.5, to) - p.apparentMag(6.2, 0.5, from);
                expect(Math.abs(diff - p.magChangeWithDistance(from, to))).toBeLessThan(1e-9);
            }
        }
    });

    it('rejects invalid values', () => {
        for (const bad of [0, -1, NaN, Infinity]) {
            expect(() => p.radiusKm(bad)).toThrow(RangeError);
            expect(() => p.absoluteMag(bad, 0.5)).toThrow(RangeError);
            expect(() => p.absoluteMag(100, bad)).toThrow(RangeError);
            expect(() => p.apparentMag(bad, 0.5, 500)).toThrow(RangeError);
            expect(() => p.magChangeWithDistance(bad, 500)).toThrow(RangeError);
            expect(() => p.magChangeWithDistance(500, bad)).toThrow(RangeError);
        }
        expect(() => p.absoluteMag(100, 1.1)).toThrow(RangeError);
        expect(() => p.apparentMag(6, 0.5, 1)).toThrow(RangeError);
        expect(() => p.magChangeWithDistance(1, 500)).toThrow(RangeError);
        expect(() => p.magChangeWithDistance(500, 1)).toThrow(RangeError);
        expect(Number.isFinite(p.absoluteMag(100, 1))).toBe(true);
    });
});
