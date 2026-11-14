import { describe, expect, it } from 'vitest';
import { buildFacts, peakSigma, type FactsInput, type FactsLightCurve } from '../src/lib/insight-facts';
import { factSheet, InsightError, validateFacts } from '../src/lib/insight';
import type { OutputGrid, RegriddedFrame } from '../src/lib/types';

function frame(tMin: number, tMax: number = tMin): RegriddedFrame
{
    return {
        frame: { obsId: `o${tMin}`, collection: 'spherex_dr1', release: 'dr1', detector: 1, url: 'https://x', tMin, tMax, lambdaMin: 1, lambdaMax: 2 },
        grid: { center: { ra: 10, dec: 20 }, fovDeg: 0.1, pixelArcsec: 6.15, width: 2, height: 2 },
        data: new Float32Array(4),
        lambdaAtCenter: 1.5,
        bandwidthAtCenter: 0.02,
    };
}

function curve(mjds: number[], relative: (i: number) => number = () => 1): FactsLightCurve
{
    return { points: mjds.map((mjd, i) => ({ mjd, relative: relative(i), valid: true, target: { snr: 50 + i } })), dropped: 3, refScatter: [0.0123, 0.0456] };
}

// Mulberry32: small seeded PRNG.
function prng(seed: number): () => number
{
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function noise(n: number, rand: () => number, sigma = 1): Float32Array
{
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        // Box-Muller
        const u = Math.max(rand(), 1e-12);
        out[i] = sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    }
    return out;
}

function grid(width: number, height: number = width): OutputGrid
{
    return { center: { ra: 10, dec: 20 }, fovDeg: 0.1, pixelArcsec: 6.2, width, height };
}

function base(): FactsInput
{
    return {
        targetId: 'barnard',
        center: { ra: 269.45207, dec: 4.69336 },
        lambdaUm: 1.23456,
        visits: [[frame(60500.1), frame(60500.3)], [frame(60680.2), frame(60680.4), frame(60680.6)]],
        snapshot: true,
    };
}

describe('buildFacts', () => {
    it('describes retained visits and capped frame counts honestly and validates the result', () => {
        const visits = Array.from({ length: 13 }, (_, i) => [frame(60500 + i)]);
        visits[0] = Array.from({ length: 501 }, () => frame(60500));
        const f = buildFacts({ ...base(), visits, lightCurve: { ...curve([60500, 60501]), refScatter: [NaN, 0.02] } });
        expect(validateFacts(f)).toEqual(f);
        expect(f.lightCurve!.refScatter).toEqual([0.02]);
        const line = factSheet(f).find((s) => s.startsWith('Visits:'))!;
        expect(line).toContain('Visits: at least 12.');
        expect(line).toContain('at least 500');
    });
    it('does not round a sub-one signal-to-noise into a brightness measurement', () => {
        const lc = curve([60500, 60501]);
        lc.points[1]!.target.snr = 0.99;
        const f = buildFacts({ ...base(), lightCurve: lc });
        expect(f.lightCurve!.points[1]!.snr).toBeLessThan(1);
        expect(factSheet(f).some((line) => line.startsWith('Brightness relative'))).toBe(false);
    });
    it('full input passes validateFacts and the sheet shows the rounded numbers', () => {
        const diff = noise(441, prng(1));
        diff[220] = 20;
        const facts = buildFacts({ ...base(), lightCurve: curve([60500.2, 60680.4], (i) => [1.004, 0.874][i]!), difference: { data: diff, grid: grid(21) }, shift: { measuredArcsec: 1.8734, days: 180.12 } });
        expect(validateFacts(facts)).toEqual(facts);
        const sheet = factSheet(facts).join('\n');
        expect(sheet).toContain('RA 269.4521 deg, Dec 4.6934 deg');
        expect(sheet).toContain('Wavelength: 1.235 micron');
        expect(sheet).toContain('Visits: 2. Frames in each visit: 2, 3. Time from first to last visit: 180.2 days');
        expect(sheet).toContain('1.00, 0.87');
        expect(sheet).toContain('Scatter of each: 1.2, 4.6 percent');
        expect(sheet).toContain('did not match: 3');
        expect(sheet).toMatch(/Difference image at the target: strongest pixel \d+\.\d sigma, brighter/);
        expect(sheet).toContain('Shift in position: 1.9 arcsec over 180.1 days');
        expect(sheet).toContain('a saved copy');
    });

    it('leaves optional sections off when missing, empty or all-NaN', () => {
        const none = buildFacts(base());
        for (const key of ['lightCurve', 'difference', 'motion']) {
            expect(key in none).toBe(false);
        }
        const empty = buildFacts({ ...base(), lightCurve: { points: [], dropped: 0, refScatter: [] }, difference: { data: new Float32Array(0), grid: grid(0) }, shift: { measuredArcsec: NaN, days: 10 } });
        const nan = buildFacts({ ...base(), lightCurve: curve([60500, 60600], () => NaN), difference: { data: new Float32Array(400).fill(NaN), grid: grid(20) }, shift: { measuredArcsec: 1, days: Infinity } });
        for (const f of [empty, nan]) {
            expect('lightCurve' in f).toBe(false);
            expect('difference' in f).toBe(false);
            expect('motion' in f).toBe(false);
            expect(Object.values(f).some((v) => v === undefined)).toBe(false);
            expect(validateFacts(f)).toEqual(f);
        }
    });

    it('visit time is the mean frame time and frames the count', () => {
        const f = buildFacts({ ...base(), visits: [[frame(60100, 60100.2)], [frame(60200), frame(60201), frame(60202, 60204)]] });
        expect(f.visits).toEqual([{ mjd: 60100.1, frames: 1 }, { mjd: 60201.3333, frames: 3 }]);
    });

    it('throws InsightError for no visits, bad centre or unknown target', () => {
        expect(() => buildFacts({ ...base(), visits: [] })).toThrow(InsightError);
        expect(() => buildFacts({ ...base(), visits: [[]] })).toThrow(InsightError);
        expect(() => buildFacts({ ...base(), center: { ra: NaN, dec: 0 } })).toThrow(InsightError);
        expect(() => buildFacts({ ...base(), targetId: 'nope' })).toThrow(InsightError);
        expect(buildFacts({ ...base(), targetId: 'custom' }).targetId).toBe('custom');
    });

    it('reduces too many visits and points, keeping first and last', () => {
        const visits = Array.from({ length: 30 }, (_, i) => [frame(60000.5 + i * 7)]);
        const mjds = Array.from({ length: 150 }, (_, i) => 60001 + i);
        const f = buildFacts({ ...base(), visits: visits.reverse(), lightCurve: curve(mjds) });
        expect(validateFacts(f)).toEqual(f);
        expect(f.visits.length).toBe(12);
        expect(f.visits[0]!.mjd).toBe(60000.5);
        expect(f.visits.at(-1)!.mjd).toBe(60000.5 + 29 * 7);
        const pts = f.lightCurve!.points;
        expect(pts.length).toBe(60);
        expect(pts[0]!.mjd).toBe(60001);
        expect(pts.at(-1)!.mjd).toBe(60150);
    });

    it('200 random valid inputs all pass validateFacts', () => {
        const rand = prng(42);
        const ids = ['barnard', 'rwaur', 'epsindb', 'wise0855', 'rdra', 'custom'];
        for (let k = 0; k < 200; k++) {
            const nv = 1 + Math.floor(rand() * 20);
            const visits = Array.from({ length: nv }, () => Array.from({ length: 1 + Math.floor(rand() * 8) }, () => frame(60000 + rand() * 9000, 60000 + rand() * 9000)));
            const np = Math.floor(rand() * 90);
            const lc: FactsLightCurve = { points: Array.from({ length: np }, () => ({ mjd: 60000 + rand() * 9000, relative: rand() * 3, valid: rand() > 0.1, target: { snr: rand() * 2000 - 100 } })), dropped: Math.floor(rand() * 100), refScatter: Array.from({ length: Math.floor(rand() * 12) }, () => rand() * 0.2) };
            const input: FactsInput = {
                targetId: ids[Math.floor(rand() * ids.length)]!,
                center: { ra: rand() * 360, dec: rand() * 180 - 90 },
                lambdaUm: 0.75 + rand() * 4.3,
                visits,
                snapshot: rand() > 0.5,
                ...(rand() > 0.3 ? { lightCurve: lc } : {}),
                ...(rand() > 0.3 ? { difference: { data: noise(400, rand, 0.1 + rand() * 5), grid: grid(20) } } : {}),
                ...(rand() > 0.3 ? { shift: { measuredArcsec: rand() * 50, days: rand() * 3000 } } : {}),
            };
            const f = buildFacts(input);
            expect(validateFacts(f)).toEqual(f);
        }
    });
});

describe('peakSigma', () => {
    // 81x81 grid, centre pixel (40, 40).
    const g = grid(81);
    const at = (x: number, y: number): number => y * 81 + x;

    it('spike at the target gives about height / sigma', () => {
        const img = noise(81 * 81, prng(7), 2);
        img[at(40, 40)] = 40;
        const s = peakSigma(img, g)!;
        expect(s).toBeGreaterThan(20 * 0.9);
        expect(s).toBeLessThan(20 * 1.1);
    });

    it('the same spike 30 pixels away is not a change at the target', () => {
        const img = noise(81 * 81, prng(7), 2);
        img[at(70, 40)] = 40;
        expect(Math.abs(peakSigma(img, g)!)).toBeLessThan(4);
    });

    it('a dip at the target is negative', () => {
        const img = noise(81 * 81, prng(7), 2);
        img[at(40, 40)] = -40;
        expect(peakSigma(img, g)!).toBeLessThan(-18);
    });

    it('explicit at works off-centre', () => {
        const img = noise(81 * 81, prng(7), 2);
        img[at(10, 15)] = 40;
        expect(peakSigma(img, g, { x: 10, y: 15 })!).toBeGreaterThan(18);
        expect(Math.abs(peakSigma(img, g)!)).toBeLessThan(4);
    });

    it('undefined cases', () => {
        const small = grid(5);
        expect(peakSigma(new Float32Array(81 * 81).fill(NaN), g)).toBeUndefined();
        const hole = noise(81 * 81, prng(3));
        for (let y = 38; y <= 42; y++) {
            for (let x = 38; x <= 42; x++) {
                hole[at(x, y)] = NaN;
            }
        }
        expect(peakSigma(hole, g)).toBeUndefined();
        // 5x5 grid: background ring beyond 2 radii (3 px) holds fewer than 20 pixels.
        expect(peakSigma(noise(25, prng(4)), small)).toBeUndefined();
        const flat = new Float32Array(81 * 81).fill(3);
        flat[at(40, 40)] = 10;
        expect(peakSigma(flat, g)).toBeUndefined();
        expect(peakSigma(new Float32Array(100), g)).toBeUndefined();
    });
});
