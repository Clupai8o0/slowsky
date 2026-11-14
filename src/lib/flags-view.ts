import type { OutputGrid, PixelBox, SkyCoord, Wcs } from './types';

export class FlagsViewError extends Error {}
export const NO_COVERAGE = 2;

export interface FlagCount {
    bit: number;
    name: string;
    pixels: number;
}

export interface FlagsSummary {
    total: number;
    flagged: number;
    counts: FlagCount[];
    sentence: string;
}

function selectedMask(bits: number[]): number
{
    let mask = 0;
    for (const bit of bits) {
        if (!Number.isInteger(bit) || bit < 0 || bit > 31) {
            throw new FlagsViewError(`Invalid flag bit ${bit}`);
        }
        mask |= 1 << bit;
    }
    return mask;
}

export function regridFlags(flags: Int32Array, box: PixelBox, wcs: Wcs, grid: OutputGrid, bits: number[]): Uint8Array
{
    const mask = selectedMask(bits);
    const boxWidth = box.x1 - box.x0;
    const boxHeight = box.y1 - box.y0;
    if (![box.x0, box.y0, box.x1, box.y1].every(Number.isSafeInteger)
        || boxWidth < 0 || boxHeight < 0 || flags.length !== boxWidth * boxHeight) {
        throw new FlagsViewError('FLAGS length does not match the detector box');
    }
    const { width, height } = grid;
    const result = new Uint8Array(width * height);
    if (width === 0 || height === 0) {
        return result;
    }

    // Match regridNorthUp's lattice and interpolation, including its shortened last cell.
    const step = Math.max(1, Math.min(8, Math.floor(8 * 6.15 / grid.pixelArcsec)));
    const nx = Math.ceil((width - 1) / step) + 1;
    const ny = Math.ceil((height - 1) / step) + 1;
    const xs = new Float64Array(nx * ny);
    const ys = new Float64Array(nx * ny);
    const radians = Math.PI / 180;
    const scale = grid.pixelArcsec / 3600 * radians;
    const ra0 = grid.center.ra * radians;
    const dec0 = grid.center.dec * radians;
    const sinDec = Math.sin(dec0);
    const cosDec = Math.cos(dec0);
    const sky: SkyCoord = { ra: 0, dec: 0 };
    for (let row = 0; row < ny; row++) {
        const y = Math.min(row * step, height - 1);
        const eta = -(y - (height - 1) / 2) * scale;
        for (let col = 0; col < nx; col++) {
            const x = Math.min(col * step, width - 1);
            const xi = -(x - (width - 1) / 2) * scale;
            sky.ra = (ra0 + Math.atan2(xi, cosDec - eta * sinDec)) / radians;
            sky.dec = Math.atan2(sinDec + eta * cosDec, Math.hypot(cosDec - eta * sinDec, xi)) / radians;
            const pixel = wcs.skyToPix(sky);
            xs[row * nx + col] = pixel.x;
            ys[row * nx + col] = pixel.y;
        }
    }
    for (let y = 0; y < height; y++) {
        const y0 = Math.min(Math.floor(y / step), Math.max(0, ny - 2));
        const y1 = Math.min(y0 + 1, ny - 1);
        const yEnd = Math.min(y1 * step, height - 1);
        const ty = yEnd > y0 * step ? (y - y0 * step) / (yEnd - y0 * step) : 0;
        for (let x = 0; x < width; x++) {
            const x0 = Math.min(Math.floor(x / step), Math.max(0, nx - 2));
            const x1 = Math.min(x0 + 1, nx - 1);
            const xEnd = Math.min(x1 * step, width - 1);
            const tx = xEnd > x0 * step ? (x - x0 * step) / (xEnd - x0 * step) : 0;
            const a = y0 * nx + x0;
            const b = y0 * nx + x1;
            const c = y1 * nx + x0;
            const d = y1 * nx + x1;
            const px = ((xs[a]! * (1 - tx) + xs[b]! * tx) * (1 - ty)
                + (xs[c]! * (1 - tx) + xs[d]! * tx) * ty) - box.x0;
            const py = ((ys[a]! * (1 - tx) + ys[b]! * tx) * (1 - ty)
                + (ys[c]! * (1 - tx) + ys[d]! * tx) * ty) - box.y0;
            const index = y * width + x;
            if (!(px >= 0 && py >= 0 && px <= boxWidth - 1 && py <= boxHeight - 1)) {
                result[index] = NO_COVERAGE;
            } else {
                const value = flags[Math.round(py) * boxWidth + Math.round(px)]!;
                result[index] = (value & mask) !== 0 ? 1 : 0;
            }
        }
    }
    return result;
}

export function flagCounts(flags: Int32Array, names: { bit: number; name: string }[]): FlagCount[]
{
    const counts = new Uint32Array(32);
    for (const value of flags) {
        for (let bit = 0; bit < 32; bit++) {
            if (((value >>> bit) & 1) !== 0) {
                counts[bit]!++;
            }
        }
    }
    const nameByBit = new Map(names.map(item => [item.bit, item.name]));
    const result: FlagCount[] = [];
    for (let bit = 0; bit < 32; bit++) {
        const pixels = counts[bit]!;
        if (pixels > 0) {
            result.push({ bit, name: nameByBit.get(bit) ?? '', pixels });
        }
    }
    return result.sort((a, b) => b.pixels - a.pixels || a.bit - b.bit);
}

function formatNumber(value: number): string
{
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function summariseFlags(flags: Int32Array, names: { bit: number; name: string }[], bits: number[]): FlagsSummary
{
    const mask = selectedMask(bits);
    const counts = flagCounts(flags, names);
    let flagged = 0;
    for (const value of flags) {
        if ((value & mask) !== 0) {
            flagged++;
        }
    }
    const total = flags.length;
    let sentence: string;
    if (total === 0) {
        sentence = 'No detector pixels in this view.';
    } else if (flagged === 0) {
        sentence = 'No pixel in this view is flagged.';
    } else {
        const common = counts.filter(count => (mask & (1 << count.bit)) !== 0).slice(0, 3)
            .map(count => `${count.name || `bit ${count.bit}`} (${formatNumber(count.pixels)})`).join(', ');
        sentence = `${formatNumber(flagged)} of ${formatNumber(total)} detector pixels in this view are flagged `
            + `(${(flagged / total * 100).toFixed(1)}%). Most common: ${common}.`;
    }
    return { total, flagged, counts, sentence };
}

export function flagsRgba(mask: Uint8Array, color: [number, number, number], alpha: number): Uint8ClampedArray
{
    const result = new Uint8ClampedArray(mask.length * 4);
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] === 1) {
            result[i * 4] = color[0];
            result[i * 4 + 1] = color[1];
            result[i * 4 + 2] = color[2];
            result[i * 4 + 3] = alpha;
        }
    }
    return result;
}
