import type { SkyCoord } from './types';

export interface HealpixPosition {
    cell: number;
    // Fractional distance along the nested cell's two face axes, in [0, 1].
    dx: number;
    dy: number;
}

function side(order: number): number
{
    if (!Number.isInteger(order) || order < 0 || order > 24) {
        throw new RangeError('HEALPix order must be an integer from 0 to 24');
    }
    return 2 ** order;
}

function interleave(x: number, y: number, order: number): number
{
    // Arithmetic rather than 32-bit bitwise operations preserves high orders.
    let cell = 0;
    for (let bit = 0; bit < order; bit++) {
        cell += ((Math.floor(x / 2 ** bit) % 2) + 2 * (Math.floor(y / 2 ** bit) % 2)) * 4 ** bit;
    }
    return cell;
}

/** Equatorial HEALPix, NESTED scheme. Derived from the equal-area face geometry. */
export function healpixPosition(c: SkyCoord, order: number): HealpixPosition
{
    const n = side(order);
    if (!Number.isFinite(c.ra) || !Number.isFinite(c.dec) || Math.abs(c.dec) > 90) {
        throw new RangeError('Invalid ICRS coordinate');
    }
    const lon = ((c.ra % 360) + 360) % 360 / 90;
    const z = Math.sin(c.dec * Math.PI / 180);
    let face: number;
    let x: number;
    let y: number;
    let dx: number;
    let dy: number;
    if (Math.abs(z) <= 2 / 3) {
        // Ascending and descending diagonal edges of the equatorial diamonds.
        const ascending = n * (0.5 + lon - 0.75 * z);
        const descending = n * (0.5 + lon + 0.75 * z);
        const a = Math.floor(ascending);
        const d = Math.floor(descending);
        const af = Math.floor(a / n);
        const df = Math.floor(d / n);
        face = af === df ? (af % 4) + 4 : af < df ? af % 4 : (df % 4) + 8;
        x = d % n;
        y = n - 1 - a % n;
        dx = descending - d;
        dy = 1 - (ascending - a);
    } else {
        const quadrant = Math.floor(lon);
        const fraction = lon - quadrant;
        // cos(dec)/sqrt(1+|sin(dec)|) avoids cancellation near the poles.
        const radius = n * Math.sqrt(3) * Math.cos(c.dec * Math.PI / 180) / Math.sqrt(1 + Math.abs(z));
        const a = fraction * radius;
        const d = (1 - fraction) * radius;
        const px = z > 0 ? n - d : a;
        const py = z > 0 ? n - a : d;
        x = Math.min(n - 1, Math.max(0, Math.floor(px)));
        y = Math.min(n - 1, Math.max(0, Math.floor(py)));
        dx = px - x;
        dy = py - y;
        face = quadrant + (z > 0 ? 0 : 8);
    }
    return { cell: face * n * n + interleave(x, y, order), dx, dy };
}

export function skyToHealpix(c: SkyCoord, order: number): number
{
    return healpixPosition(c, order).cell;
}

/** ICRS centre of an equatorial NESTED cell. */
export function healpixCenter(cell: number, order: number): SkyCoord
{
    const n = side(order);
    if (!Number.isSafeInteger(cell) || cell < 0 || cell >= 12 * n * n) {
        throw new RangeError('Invalid HEALPix cell');
    }
    const face = Math.floor(cell / (n * n));
    const code = cell % (n * n);
    let x = 0.5;
    let y = 0.5;
    for (let bit = 0; bit < order; bit++) {
        x += (Math.floor(code / 4 ** bit) % 2) * 2 ** bit;
        y += (Math.floor(code / (2 * 4 ** bit)) % 2) * 2 ** bit;
    }
    const band = Math.floor(face / 4);
    const row = (band + 2) * n - x - y;
    const radius = Math.min(n, row, 4 * n - row);
    const z = row < n ? 1 - radius ** 2 / (3 * n ** 2)
        : row > 3 * n ? -1 + radius ** 2 / (3 * n ** 2) : (2 * n - row) * 2 / (3 * n);
    const meridian = band === 1 ? 2 * (face % 4) : 2 * (face % 4) + 1;
    const ra = ((meridian * radius + x - y) * 45 / radius % 360 + 360) % 360;
    return { ra, dec: Math.asin(z) * 180 / Math.PI };
}

/** HiPS 1.0, section 4.2.1, figure 4 (FITS corners S,W / E,N).
 * https://www.ivoa.net/documents/HiPS/20170519/REC-HIPS-1.0-20170519.pdf
 * The NESTED even bits run south->east, odd bits south->west. Thus tile
 * columns take the odd bits; JPEG/PNG rows take the even bits. FITS flips rows.
 */
export function healpixTilePixel(cell: number, tileOrder: number, tileWidth: number,
    format: 'fits' | 'jpeg' | 'png'): { npix: number; x: number; y: number }
{
    const shift = Math.log2(tileWidth);
    side(tileOrder);
    if (!Number.isInteger(shift) || shift < 0 || tileOrder + shift > 24) {
        throw new RangeError('HiPS tile width must be a power of two within HEALPix order 24');
    }
    const count = tileWidth * tileWidth;
    if (!Number.isSafeInteger(cell) || cell < 0 || cell >= 12 * 4 ** (tileOrder + shift)) {
        throw new RangeError('Invalid HiPS pixel');
    }
    const code = cell % count;
    let x = 0;
    let row = 0;
    for (let bit = 0; bit < shift; bit++) {
        row += Math.floor(code / 4 ** bit) % 2 * 2 ** bit;
        x += Math.floor(code / (2 * 4 ** bit)) % 2 * 2 ** bit;
    }
    return { npix: Math.floor(cell / count), x, y: format === 'fits' ? tileWidth - 1 - row : row };
}

/** Galactic longitude/latitude in the SkyCoord ra/dec slots, in degrees.
 * Rotation of ICRS Cartesian axes into the Galactic frame, evaluated with
 * astropy SkyCoord(..., frame='icrs').galactic for the three unit vectors.
 * https://docs.astropy.org/en/stable/coordinates/transforming.html
 */
export function icrsToGalactic(c: SkyCoord): SkyCoord
{
    if (!Number.isFinite(c.ra) || !Number.isFinite(c.dec) || Math.abs(c.dec) > 90) {
        throw new RangeError('Invalid ICRS coordinate');
    }
    const ra = ((c.ra % 360) + 360) % 360 * Math.PI / 180;
    const dec = c.dec * Math.PI / 180;
    const x = Math.cos(dec) * Math.cos(ra);
    const y = Math.cos(dec) * Math.sin(ra);
    const z = Math.sin(dec);
    const gx = -0.05487565771259168 * x - 0.8734370519556163 * y - 0.4838350736167155 * z;
    const gy = 0.4941094371927275 * x - 0.44482972122329517 * y + 0.7469821839866676 * z;
    const gz = -0.8676661375596587 * x - 0.1980763372730008 * y + 0.45598381368730173 * z;
    return { ra: (Math.atan2(gy, gx) * 180 / Math.PI + 360) % 360,
        dec: Math.atan2(gz, Math.hypot(gx, gy)) * 180 / Math.PI };
}
