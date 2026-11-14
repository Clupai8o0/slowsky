import xml from './fixtures/frame/sia_rwaur.xml?raw';
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

describe('saved SIA fixture', () => {
    it('is a complete reply with all six detectors', () => {
        expect(xml).toContain('name="QUERY_STATUS" value="OK"');
        expect(xml).not.toContain('OVERFLOW');
        for (let d = 1; d <= 6; d++) {
            expect(xml).toContain(`SPHEREx-D${d}`);
        }
        expect(xml.length).toBeLessThan(300000);
    });
});
