// Lane: WCS. TAN-SIP both ways, matching astropy to 0.01 px.
import type { FitsHeader, PixelCoord, SipCoeffs, SkyCoord, Wcs, WcsParams } from './types';

const DEG = Math.PI / 180;

function readSip(header: FitsHeader, prefix: string): SipCoeffs | undefined
{
    const orderVal = header.get(`${prefix}_ORDER`);
    if (typeof orderVal !== 'number') {
        return undefined;
    }
    const order = orderVal;
    const coeffs: number[][] = [];
    for (let p = 0; p <= order; p++) {
        const row: number[] = [];
        for (let q = 0; q <= order; q++) {
            const val = p + q <= order ? header.get(`${prefix}_${p}_${q}`) : undefined;
            row.push(typeof val === 'number' ? val : 0);
        }
        coeffs.push(row);
    }
    return { order, coeffs };
}

export function wcsFromHeader(header: FitsHeader): WcsParams
{
    const ctype1 = String(header.get('CTYPE1') ?? '');
    const ctype2 = String(header.get('CTYPE2') ?? '');
    const okTypes = (ctype1 === 'RA---TAN-SIP' && ctype2 === 'DEC--TAN-SIP')
        || (ctype1 === 'RA---TAN' && ctype2 === 'DEC--TAN');
    if (!okTypes) {
        throw new Error(`Unsupported WCS projection: ${ctype1} / ${ctype2}`);
    }
    let cd: [[number, number], [number, number]];
    if (header.get('CD1_1') !== undefined) {
        cd = [
            [header.num('CD1_1'), header.num('CD1_2')],
            [header.num('CD2_1'), header.num('CD2_2')],
        ];
    } else {
        const d1 = typeof header.get('CDELT1') === 'number' ? header.num('CDELT1') : 1;
        const d2 = typeof header.get('CDELT2') === 'number' ? header.num('CDELT2') : 1;
        const pc = (k: string, dflt: number): number =>
        {
            const v = header.get(k);
            return typeof v === 'number' ? v : dflt;
        };
        cd = [
            [d1 * pc('PC1_1', 1), d1 * pc('PC1_2', 0)],
            [d2 * pc('PC2_1', 0), d2 * pc('PC2_2', 1)],
        ];
    }
    const params: WcsParams = {
        crpix: [header.num('CRPIX1'), header.num('CRPIX2')],
        crval: [header.num('CRVAL1'), header.num('CRVAL2')],
        cd,
        naxis: [header.num('NAXIS1'), header.num('NAXIS2')],
    };
    if (ctype1.endsWith('-SIP')) {
        const a = readSip(header, 'A');
        const b = readSip(header, 'B');
        const ap = readSip(header, 'AP');
        const bp = readSip(header, 'BP');
        if (a) {
            params.a = a;
        }
        if (b) {
            params.b = b;
        }
        if (ap) {
            params.ap = ap;
        }
        if (bp) {
            params.bp = bp;
        }
    }
    return params;
}

function evalSip(s: SipCoeffs | undefined, u: number, v: number): number
{
    if (!s) {
        return 0;
    }
    let sum = 0;
    for (let p = 0; p <= s.order; p++) {
        const row = s.coeffs[p];
        if (!row) {
            continue;
        }
        const up = Math.pow(u, p);
        for (let q = 0; q <= s.order - p; q++) {
            const c = row[q];
            if (c) {
                sum += c * up * Math.pow(v, q);
            }
        }
    }
    return sum;
}

function wrapRa(ra: number): number
{
    let r = ra % 360;
    if (r < 0) {
        r += 360;
    }
    return r;
}

// pixToSky applies SIP A/B; skyToPix applies AP/BP and then refines by iteration.
export function makeWcs(params: WcsParams): Wcs
{
    const [cd11, cd12] = params.cd[0];
    const [cd21, cd22] = params.cd[1];
    const det = cd11 * cd22 - cd12 * cd21;
    const ra0 = params.crval[0] * DEG;
    const dec0 = params.crval[1] * DEG;
    const sinD0 = Math.sin(dec0);
    const cosD0 = Math.cos(dec0);

    // (u, v) relative to CRPIX -> intermediate world coords in degrees.
    const forwardUV = (u: number, v: number): [number, number] =>
    {
        const uu = u + evalSip(params.a, u, v);
        const vv = v + evalSip(params.b, u, v);
        return [cd11 * uu + cd12 * vv, cd21 * uu + cd22 * vv];
    };

    return {
        params,
        pixToSky(p: PixelCoord): SkyCoord
        {
            const u = p.x + 1 - params.crpix[0];
            const v = p.y + 1 - params.crpix[1];
            const [xd, yd] = forwardUV(u, v);
            const xi = xd * DEG;
            const eta = yd * DEG;
            const ra = ra0 + Math.atan2(xi, cosD0 - eta * sinD0);
            const dec = Math.atan2(sinD0 + eta * cosD0, Math.hypot(cosD0 - eta * sinD0, xi));
            return { ra: wrapRa(ra / DEG), dec: dec / DEG };
        },
        skyToPix(c: SkyCoord): PixelCoord
        {
            const ra = c.ra * DEG;
            const dec = c.dec * DEG;
            const dra = ra - ra0;
            const denom = sinD0 * Math.sin(dec) + cosD0 * Math.cos(dec) * Math.cos(dra);
            const xi = (Math.cos(dec) * Math.sin(dra)) / denom;
            const eta = (cosD0 * Math.sin(dec) - sinD0 * Math.cos(dec) * Math.cos(dra)) / denom;
            const xd = xi / DEG;
            const yd = eta / DEG;
            // Undistorted target (U, V) in linear pixel offsets.
            const U = (cd22 * xd - cd12 * yd) / det;
            const V = (-cd21 * xd + cd11 * yd) / det;
            let u = U + evalSip(params.ap, U, V);
            let v = V + evalSip(params.bp, U, V);
            for (let i = 0; i < 50; i++) {
                const [fx, fy] = forwardUV(u, v);
                const fU = (cd22 * fx - cd12 * fy) / det;
                const fV = (-cd21 * fx + cd11 * fy) / det;
                const du = U - fU;
                const dv = V - fV;
                u += du;
                v += dv;
                if (Math.abs(du) < 1e-9 && Math.abs(dv) < 1e-9) {
                    break;
                }
            }
            return { x: u + params.crpix[0] - 1, y: v + params.crpix[1] - 1 };
        },
    };
}
