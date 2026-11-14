import { describe, expect, it } from 'vitest';
import reference from './fixtures/frame/targets_astropy.json';
import { positionAt, TARGETS, targetById } from '../src/lib/targets';
import type { TargetId } from '../src/lib/types';

describe('target positions', () => {
    it('matches astropy to 0.05 arcseconds at each epoch', () => {
        expect(TARGETS).toHaveLength(5);
        for (const target of TARGETS) {
            expect(targetById(target.id)).toEqual(target);
            for (const expected of reference[target.id as TargetId]) {
                const actual = positionAt(target.astrometry, expected.mjd);
                const dra = (actual.ra - expected.ra) * Math.cos(expected.dec * Math.PI / 180);
                const separation = Math.hypot(dra, actual.dec - expected.dec) * 3600;
                expect(separation, `${target.id} at ${expected.mjd}`).toBeLessThan(0.05);
            }
        }
    });
});
