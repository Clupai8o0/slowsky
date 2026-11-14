import { describe, expect, it } from 'vitest';
import { parseRegion, pickByWavelength, predictPixel } from '../src/lib/footprint';
import type { FrameRecord, SkyCoord } from '../src/lib/types';

function frame(obsId: string, tMin: number): FrameRecord
{
    return { obsId, tMin, tMax: tMin + 0.1, detector: 3, release: 'dr1',
        collection: 'spherex_dr1', url: 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/x.fits',
        lambdaMin: 1.6, lambdaMax: 2.4 };
}

// Inverse TAN projection of a rotated detector plane into sky coordinates.
function sky(x: number, y: number, ra0: number): SkyCoord
{
    const rad = Math.PI / 180;
    const dec0 = 6 * rad;
    const angle = 0.12;
    const scale = 6.15 / 3600 * rad;
    const dx = (x - 1019.5) * scale;
    const dy = (y - 1019.5) * scale;
    const xi = dx * Math.cos(angle) - dy * Math.sin(angle);
    const eta = dx * Math.sin(angle) + dy * Math.cos(angle);
    const denominator = Math.cos(dec0) - eta * Math.sin(dec0);
    const ra = ra0 * rad + Math.atan2(xi, denominator);
    const dec = Math.atan2(Math.sin(dec0) + eta * Math.cos(dec0), Math.hypot(denominator, xi));
    return { ra: ((ra / rad) % 360 + 360) % 360, dec: dec / rad };
}

function detector(ra: number): SkyCoord[]
{
    return [sky(-0.5, -0.5, ra), sky(2039.5, -0.5, ra),
        sky(2039.5, 2039.5, ra), sky(-0.5, 2039.5, ra)];
}

describe('parseRegion', () => {
    it('parses closed and open polygons', () => {
        expect(parseRegion('POLYGON ICRS 268.4745 8.1675 271.9732 7.8857 271.8281 4.3980 268.3234 4.6866 268.4745 8.1675')).toEqual([
            { ra: 268.4745, dec: 8.1675 }, { ra: 271.9732, dec: 7.8857 },
            { ra: 271.8281, dec: 4.398 }, { ra: 268.3234, dec: 4.6866 },
        ]);
        expect(parseRegion('polygon 1 2 3 4 5 6 7 8')).toEqual([
            { ra: 1, dec: 2 }, { ra: 3, dec: 4 }, { ra: 5, dec: 6 }, { ra: 7, dec: 8 },
        ]);
    });

    it('rejects malformed regions and coordinates', () => {
        for (const value of [undefined, '', 'CIRCLE ICRS 1 2 3', 'POLYGON ICRS 1 2 3',
            'POLYGON ICRS 1 2 3 4 5 6 7 8 1 3', 'POLYGON ICRS 1 91 3 4 5 6 7 8',
            'POLYGON ICRS NaN 2 3 4 5 6 7 8', 'POLYGON NaN 1 2 3 4 5 6 7 8',
            'POLYGON 361 2 3 4 5 6 7 8']) {
            expect(parseRegion(value)).toBeNull();
        }
    });
});

describe('predictPixel', () => {
    it.each([270, 0.2])('recovers TAN pixels around RA %s', ra => {
        const corners = detector(ra);
        if (ra === 0.2) {
            expect(corners.some(c => c.ra > 350)).toBe(true);
            expect(corners.some(c => c.ra < 10)).toBe(true);
        }
        for (const [x, y] of [[801, 1032], [100, 1900], [-25, 500]] as const) {
            const pixel = predictPixel(corners, [2040, 2040], sky(x, y, ra));
            expect(pixel).not.toBeNull();
            expect(Math.abs(pixel!.x - x)).toBeLessThan(0.5);
            expect(Math.abs(pixel!.y - y)).toBeLessThan(0.5);
        }
    });

    it('rejects invalid and opposite-hemisphere inputs', () => {
        const corners = detector(270);
        expect(predictPixel(corners, [2040, 2040], { ra: 30, dec: 0 })).toBeNull();
        expect(predictPixel(corners.slice(0, 3), [2040, 2040], sky(1, 1, 270))).toBeNull();
        expect(predictPixel(corners, [0, 2040], sky(1, 1, 270))).toBeNull();
        expect(predictPixel(corners, [2040, 2040], { ra: NaN, dec: 0 })).toBeNull();
        expect(predictPixel([corners[0]!, corners[0]!, corners[0]!, corners[0]!], [2040, 2040], corners[0]!)).toBeNull();
    });
});

describe('pickByWavelength', () => {
    it('breaks equal wavelength and time ties by observation ID before applying capacity', () => {
        const a = frame('a', 1);
        const b = frame('b', 1);
        for (const visit of [[a, b], [b, a]]) {
            expect(pickByWavelength([visit], () => 2, 2, () => 0, 1).frames).toEqual([a]);
        }
    });

    it('skips far visits and picks the closest eligible frames in time order', () => {
        const a = [frame('a1', 4), frame('a2', 1), frame('a3', 3)];
        const b = [frame('b1', 5)];
        const c = [frame('c1', 9), frame('c2', 7), frame('c3', 8)];
        const predictions: Record<string, number> = { a1: 2.02, a2: 2.01, a3: 2.08,
            b1: 2.5, c1: 2.02, c2: 2.01, c3: 2.2 };
        const result = pickByWavelength([a, b, c], f => predictions[f.obsId], 2, () => 0.05, 6);
        expect(result.frames.map(f => f.obsId)).toEqual(['a2', 'a1', 'c2', 'c1']);
        expect(result.skippedVisits).toBe(1);
    });

    it('offers the middle frame when predictions are unknown', () => {
        const visit = [frame('a', 1), frame('b', 2), frame('c', 3)];
        expect(pickByWavelength([visit, []], () => undefined, 2, () => 0, 5)).toEqual({ frames: [visit[1]], skippedVisits: 0 });
    });

    it('always offers the nearest frame when another frame makes the visit near', () => {
        const best = frame('best', 1);
        const near = frame('near', 2);
        const result = pickByWavelength([[near, best]], f => f === best ? 2.02 : 2.03,
            2, f => f === best ? 0 : 0.02, 2);
        expect(result.frames).toEqual([best, near]);
    });

    it('spreads visits over time and does not count visits dropped for the budget', () => {
        const visits = [5, 1, 4, 2, 3].map(n => [frame(String(n), n)]);
        const result = pickByWavelength(visits, () => 2, 2, () => 0, 2);
        expect(result.frames.map(f => f.obsId)).toEqual(['2', '4']);
        expect(result.skippedVisits).toBe(0);
    });

    it('handles zero capacity, invalid choice, tie breaks and duplicates', () => {
        const a = frame('a', 1);
        const b = frame('b', 1);
        expect(pickByWavelength([[a]], () => 2, 2, () => 0, 0)).toEqual({ frames: [], skippedVisits: 0 });
        expect(pickByWavelength([[a]], () => 2, NaN, () => 0, 2)).toEqual({ frames: [], skippedVisits: 0 });
        expect(pickByWavelength([[b, a, a]], () => 2, 2, () => 0, 3, { perVisit: 3 }).frames).toEqual([a, b]);
    });
});
