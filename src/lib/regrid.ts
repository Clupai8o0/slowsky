// Lane: regrid. Detector cutout to a north-up, east-left TAN grid.
import type { Cutout, OutputGrid, PixelCoord, SkyCoord, Wcs } from './types';

const DEG = Math.PI / 180;
const NATIVE_PIXEL_ARCSEC = 6.15;

// Picks a grid size so 1 SPHEREx pixel is at least minScreenPx screen pixels,
// capped at maxSide.
export function gridForView(center: SkyCoord, fovDeg: number, minScreenPx: number, maxSide: number): OutputGrid
{
    if (!Number.isFinite(center.ra) || !Number.isFinite(center.dec) || !Number.isFinite(fovDeg)
        || !Number.isFinite(minScreenPx) || !Number.isFinite(maxSide)) {
        throw new Error('gridForView: non-finite input');
    }
    if (fovDeg <= 0 || minScreenPx <= 0 || maxSide < 1) {
        throw new Error('gridForView: fovDeg and minScreenPx must be > 0 and maxSide >= 1');
    }
    let pixelArcsec = NATIVE_PIXEL_ARCSEC / minScreenPx;
    let side = Math.ceil((fovDeg * 3600) / pixelArcsec);
    if (side % 2 === 0) {
        side += 1;
    }
    if (side > maxSide) {
        side = Math.floor(maxSide);
        if (side % 2 === 0) {
            side -= 1;
        }
        if (side < 1) {
            side = 1;
        }
        pixelArcsec = (fovDeg * 3600) / side;
    }
    return { center: { ra: center.ra, dec: center.dec }, fovDeg, pixelArcsec, width: side, height: side };
}

// Output pixel (0-based, centre of grid at ((w-1)/2, (h-1)/2)) to sky.
// x grows west, y grows south (row 0 is north).
export function gridPixToSky(grid: OutputGrid, p: PixelCoord): SkyCoord
{
    const scale = (grid.pixelArcsec / 3600) * DEG;
    const xi = -(p.x - (grid.width - 1) / 2) * scale;
    const eta = -(p.y - (grid.height - 1) / 2) * scale;
    const ra0 = grid.center.ra * DEG;
    const dec0 = grid.center.dec * DEG;
    const sinD0 = Math.sin(dec0);
    const cosD0 = Math.cos(dec0);
    const ra = ra0 + Math.atan2(xi, cosD0 - eta * sinD0);
    const dec = Math.atan2(sinD0 + eta * cosD0, Math.hypot(cosD0 - eta * sinD0, xi));
    let r = (ra / DEG) % 360;
    if (r < 0) {
        r += 360;
    }
    return { ra: r, dec: dec / DEG };
}

export function gridSkyToPix(grid: OutputGrid, c: SkyCoord): PixelCoord
{
    const ra = c.ra * DEG;
    const dec = c.dec * DEG;
    const ra0 = grid.center.ra * DEG;
    const dec0 = grid.center.dec * DEG;
    const sinD0 = Math.sin(dec0);
    const cosD0 = Math.cos(dec0);
    const dra = ra - ra0;
    const denom = sinD0 * Math.sin(dec) + cosD0 * Math.cos(dec) * Math.cos(dra);
    if (!(denom > 0)) {
        return { x: NaN, y: NaN };
    }
    const xi = (Math.cos(dec) * Math.sin(dra)) / denom;
    const eta = (cosD0 * Math.sin(dec) - sinD0 * Math.cos(dec) * Math.cos(dra)) / denom;
    const scale = (grid.pixelArcsec / 3600) * DEG;
    return {
        x: (grid.width - 1) / 2 - xi / scale,
        y: (grid.height - 1) / 2 - eta / scale,
    };
}

// Values are taken from cutout.image - cutout.zodi when zodi is present.
// Outside the detector the output is NaN.
export function regridNorthUp(cutout: Cutout, wcs: Wcs, grid: OutputGrid): Float32Array
{
    return resample(cutout, wcs, grid, 'image');
}

// Relative noise map, not a calibrated variance. Per pixel it overstates the true
// variance by 1.3 to 4 times (sigma up to 2 times), because the image is
// interpolated with weights w and this map uses sum(w V), not sum(w^2 V).
// Oversampled output pixels share input pixels, so a sum over neighbouring pixels
// understates the noise. Rescale it against measured scatter before reading it as
// a sigma. The map is NaN wherever data is NaN or a file variance is invalid,
// even when the image value is finite.
export function regridVariance(cutout: Cutout, wcs: Wcs, grid: OutputGrid): Float32Array | undefined
{
    if (!cutout.variance) {
        return undefined;
    }
    if (cutout.variance.length !== cutout.width * cutout.height) {
        throw new Error(`regridVariance: variance has ${cutout.variance.length} pixels, cutout needs ${cutout.width * cutout.height}`);
    }
    return resample(cutout, wcs, grid, 'variance');
}

function resample(cutout: Cutout, wcs: Wcs, grid: OutputGrid, plane: 'image' | 'variance'): Float32Array
{
    const { width, height } = grid;
    const out = new Float32Array(width * height);
    const cw = cutout.width;
    const ch = cutout.height;
    const img = cutout.image;
    const zodi = cutout.zodi;
    const variance = plane === 'variance' ? cutout.variance : undefined;
    const bx = cutout.box.x0;
    const by = cutout.box.y0;

    const scale = (grid.pixelArcsec / 3600) * DEG;
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const ra0 = grid.center.ra * DEG;
    const dec0 = grid.center.dec * DEG;
    const sinD0 = Math.sin(dec0);
    const cosD0 = Math.cos(dec0);
    const sky: SkyCoord = { ra: 0, dec: 0 };

    // Evaluate exact wcs.skyToPix on a lattice and interpolate detector positions bilinearly.
    // Limit each cell to 8 native SPHEREx pixels (6.15 arcsec each), at most 8 output pixels;
    // coarse grids use every output pixel. Always include the last row and column.
    const STEP = Math.max(1, Math.min(8, Math.floor(8 * NATIVE_PIXEL_ARCSEC / grid.pixelArcsec)));
    const nx = Math.ceil((width - 1) / STEP) + 1;
    const ny = Math.ceil((height - 1) / STEP) + 1;
    const nodeX = new Float64Array(nx * ny);
    const nodeY = new Float64Array(nx * ny);
    for (let gj = 0; gj < ny; gj++) {
        const j = Math.min(gj * STEP, height - 1);
        const eta = -(j - cy) * scale;
        for (let gi = 0; gi < nx; gi++) {
            const i = Math.min(gi * STEP, width - 1);
            const xi = -(i - cx) * scale;
            const ra = ra0 + Math.atan2(xi, cosD0 - eta * sinD0);
            const dec = Math.atan2(sinD0 + eta * cosD0, Math.hypot(cosD0 - eta * sinD0, xi));
            sky.ra = ra / DEG;
            sky.dec = dec / DEG;
            const p = wcs.skyToPix(sky);
            nodeX[gj * nx + gi] = p.x;
            nodeY[gj * nx + gi] = p.y;
        }
    }

    for (let j = 0; j < height; j++) {
        const row = j * width;
        const gj0 = Math.min(Math.floor(j / STEP), ny - 2 < 0 ? 0 : ny - 2);
        const gj1 = Math.min(gj0 + 1, ny - 1);
        const jA = gj0 * STEP;
        const jB = Math.min(gj1 * STEP, height - 1);
        const ty = jB > jA ? (j - jA) / (jB - jA) : 0;
        for (let i = 0; i < width; i++) {
            const gi0 = Math.min(Math.floor(i / STEP), nx - 2 < 0 ? 0 : nx - 2);
            const gi1 = Math.min(gi0 + 1, nx - 1);
            const iA = gi0 * STEP;
            const iB = Math.min(gi1 * STEP, width - 1);
            const tx = iB > iA ? (i - iA) / (iB - iA) : 0;
            const k00 = gj0 * nx + gi0;
            const k10 = gj0 * nx + gi1;
            const k01 = gj1 * nx + gi0;
            const k11 = gj1 * nx + gi1;
            const px0 = (nodeX[k00] ?? NaN) * (1 - tx) + (nodeX[k10] ?? NaN) * tx;
            const px1 = (nodeX[k01] ?? NaN) * (1 - tx) + (nodeX[k11] ?? NaN) * tx;
            const py0 = (nodeY[k00] ?? NaN) * (1 - tx) + (nodeY[k10] ?? NaN) * tx;
            const py1 = (nodeY[k01] ?? NaN) * (1 - tx) + (nodeY[k11] ?? NaN) * tx;
            const x = px0 * (1 - ty) + px1 * ty - bx;
            const y = py0 * (1 - ty) + py1 * ty - by;
            if (!(x >= 0 && y >= 0 && x <= cw - 1 && y <= ch - 1)) {
                out[row + i] = NaN;
                continue;
            }
            let x0 = Math.floor(x);
            let y0 = Math.floor(y);
            if (x0 >= cw - 1) {
                x0 = cw - 2;
            }
            if (y0 >= ch - 1) {
                y0 = ch - 2;
            }
            if (x0 < 0 || y0 < 0) {
                // cutout narrower than 2 px: no 4 neighbours exist
                out[row + i] = NaN;
                continue;
            }
            const fx = x - x0;
            const fy = y - y0;
            const k = y0 * cw + x0;
            let v00 = img[k] ?? NaN;
            let v10 = img[k + 1] ?? NaN;
            let v01 = img[k + cw] ?? NaN;
            let v11 = img[k + cw + 1] ?? NaN;
            if (zodi) {
                v00 -= zodi[k] ?? 0;
                v10 -= zodi[k + 1] ?? 0;
                v01 -= zodi[k + cw] ?? 0;
                v11 -= zodi[k + cw + 1] ?? 0;
            }
            const top = v00 + (v10 - v00) * fx;
            const bot = v01 + (v11 - v01) * fx;
            // NaN in any neighbour propagates through the arithmetic, but a zero
            // weight would hide it (0 * NaN is NaN, so it does not): still explicit.
            if (v00 !== v00 || v10 !== v10 || v01 !== v01 || v11 !== v11) {
                out[row + i] = NaN;
            } else {
                out[row + i] = top + (bot - top) * fy;
            }
            if (variance && !Number.isNaN(out[row + i])) {
                const v00 = variance[k] ?? NaN;
                const v10 = variance[k + 1] ?? NaN;
                const v01 = variance[k + cw] ?? NaN;
                const v11 = variance[k + cw + 1] ?? NaN;
                if (!Number.isFinite(v00) || v00 <= 0 || !Number.isFinite(v10) || v10 <= 0
                    || !Number.isFinite(v01) || v01 <= 0 || !Number.isFinite(v11) || v11 <= 0) {
                    out[row + i] = NaN;
                } else {
                    const top = v00 + (v10 - v00) * fx;
                    const bot = v01 + (v11 - v01) * fx;
                    out[row + i] = top + (bot - top) * fy;
                }
            }
        }
    }
    return out;
}
