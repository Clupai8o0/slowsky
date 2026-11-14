import { describe, expect, it } from 'vitest';
import { decodeView, encodeView } from '../src/lib/urlstate';
import type { ViewState } from '../src/lib/types';

const VIEW: ViewState = {
    center: { ra: 76.956, dec: 30.40139 },
    fovDeg: 0.5,
    detector: 3,
    lambda: 2.1625,
    target: 'rwaur',
    frame: '2025W19_1B_0241_1D1',
};

describe('encodeView', () => {
    it('writes the short keys with fixed precision', () => {
        const params = new URLSearchParams(encodeView(VIEW));
        expect(params.get('ra')).toBe('76.95600');
        expect(params.get('dec')).toBe('30.40139');
        expect(params.get('fov')).toBe('0.500');
        expect(params.get('det')).toBe('3');
        expect(params.get('lam')).toBe('2.1625');
        expect(params.get('t')).toBe('rwaur');
        expect(params.get('f')).toBe('2025W19_1B_0241_1D1');
    });

    it('omits optional keys that are undefined', () => {
        const query = encodeView({ center: { ra: 1, dec: 2 }, fovDeg: 0.25, detector: 1 });
        expect(query).toBe('ra=1.00000&dec=2.00000&fov=0.250&det=1');
    });

    it('never writes RA 360', () => {
        const params = new URLSearchParams(encodeView({ center: { ra: 359.999999, dec: 0 }, fovDeg: 1, detector: 1 }));
        expect(params.get('ra')).toBe('0.00000');
    });
});

describe('decodeView', () => {
    it('round-trips a view', () => {
        expect(decodeView(encodeView(VIEW))).toEqual(VIEW);
        expect(decodeView(`?${encodeView(VIEW)}`)).toEqual(VIEW);
    });

    it('returns null without a usable ra and dec', () => {
        expect(decodeView('')).toBeNull();
        expect(decodeView('dec=30')).toBeNull();
        expect(decodeView('ra=76')).toBeNull();
        expect(decodeView('ra=abc&dec=30')).toBeNull();
        expect(decodeView('ra=400&dec=30')).toBeNull();
        expect(decodeView('ra=76&dec=95')).toBeNull();
    });

    it('defaults fov to 0.25 and detector to 1', () => {
        expect(decodeView('ra=10&dec=-5')).toEqual({
            center: { ra: 10, dec: -5 },
            fovDeg: 0.25,
            detector: 1,
        });
    });

    it('drops bad values instead of guessing', () => {
        const view = decodeView('ra=10&dec=5&fov=9&det=9&lam=6&t=mars&f=a%20b');
        expect(view).toEqual({ center: { ra: 10, dec: 5 }, fovDeg: 0.25, detector: 1 });
    });

    it('keeps values at the range edges and drops values just outside', () => {
        expect(decodeView('ra=10&dec=5&fov=0.05&det=6&lam=5.1')).toMatchObject({
            fovDeg: 0.05,
            detector: 6,
            lambda: 5.1,
        });
        expect(decodeView('ra=10&dec=5&fov=0.049&det=0&lam=0.69')).toMatchObject({
            fovDeg: 0.25,
            detector: 1,
        });
        expect(decodeView('ra=10&dec=5&det=2.5')).toMatchObject({ detector: 1 });
    });

    it('keeps a frame id only with letters, digits and underscores', () => {
        expect(decodeView('ra=10&dec=5&f=2025W19_1B_0241_1D1')?.frame).toBe('2025W19_1B_0241_1D1');
        expect(decodeView('ra=10&dec=5&f=../etc')?.frame).toBeUndefined();
    });

    it('keeps only known target ids', () => {
        expect(decodeView('ra=10&dec=5&t=barnard')?.target).toBe('barnard');
        expect(decodeView('ra=10&dec=5&t=constructor')?.target).toBeUndefined();
    });
});
