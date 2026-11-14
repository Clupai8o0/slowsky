import data from '../data/targets.json' with { type: 'json' };
import type { Astrometry, SkyCoord, Target, TargetId } from './types';

export const TARGETS: Target[] = data as Target[];

export function targetById(id: TargetId): Target | undefined
{
    return TARGETS.find((target) => target.id === id);
}

export function positionAt(a: Astrometry, mjd: number): SkyCoord
{
    const radians = Math.PI / 180;
    const ra = a.ra * radians;
    const dec = a.dec * radians;
    const years = 2000 + (mjd - 51544.5) / 365.25 - a.epochJyear;
    const factor = radians / 3600000 * years;
    const radial = a.parallax && a.parallax > 0 && a.radialVelocity !== undefined
        ? a.radialVelocity * years * a.parallax / 977792221.6807892 : 0;
    const cosRa = Math.cos(ra);
    const sinRa = Math.sin(ra);
    const cosDec = Math.cos(dec);
    const sinDec = Math.sin(dec);
    const x = (1 + radial) * cosDec * cosRa - factor * (a.pmRa * sinRa + a.pmDec * sinDec * cosRa);
    const y = (1 + radial) * cosDec * sinRa + factor * (a.pmRa * cosRa - a.pmDec * sinDec * sinRa);
    const z = (1 + radial) * sinDec + factor * a.pmDec * cosDec;
    return { ra: (Math.atan2(y, x) / radians + 360) % 360, dec: Math.atan2(z, Math.hypot(x, y)) / radians };
}
