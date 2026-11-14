// @ts-expect-error Node built-ins are provided by Vitest; this project has no Node typings.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHeader } from '../src/lib/fits';
import { flagNames } from '../src/lib/flags';
import { FlagsViewError, NO_COVERAGE, flagCounts, flagsRgba, regridFlags, summariseFlags } from '../src/lib/flags-view';
import { gridPixToSky, gridSkyToPix, regridNorthUp } from '../src/lib/regrid';
import { makeWcs } from '../src/lib/wcs';
import type { Cutout, FitsHeader, FrameRecord, OutputGrid, PixelBox, WcsParams } from '../src/lib/types';

const angle = 31 * Math.PI / 180;
const scale = 6.15 / 3600;
const params: WcsParams = {
    crpix: [21, 21], crval: [150, 2], naxis: [40, 40],
    cd: [[-scale * Math.cos(angle), scale * Math.sin(angle)],
        [scale * Math.sin(angle), scale * Math.cos(angle)]],
};
const wcs = makeWcs(params);
const box: PixelBox = { x0: 10, y0: 10, x1: 31, y1: 31 };
const grid: OutputGrid = { center: { ra: 150, dec: 2 }, fovDeg: 0.06, pixelArcsec: 1.5375, width: 97, height: 97 };

function cutout(flags: Int32Array): Cutout
{
    return { frame: {} as FrameRecord, box, width: 21, height: 21,
        image: Float32Array.from(flags), wcs: params, header: {} as FitsHeader };
}

describe('flag regridding', () => {
    for (const shape of ['block', 'single'] as const) {
        it(`matches the image and nearest detector pixel for a rotated ${shape}`, () => {
            const data = new Int32Array(21 * 21);
            for (let y = 0; y < 21; y++) {
                for (let x = 0; x < 21; x++) {
                    if (shape === 'block' ? x >= 7 && x <= 13 && y >= 7 && y <= 13 : x === 10 && y === 10) {
                        data[y * 21 + x] = 1;
                    }
                }
            }
            const mask = regridFlags(data, box, wcs, grid, [0]);
            const image = regridNorthUp(cutout(data), wcs, grid);
            let high = 0;
            let low = 0;
            let nearestChecked = 0;
            for (let y = 0; y < grid.height; y++) {
                for (let x = 0; x < grid.width; x++) {
                    const i = y * grid.width + x;
                    const v = image[i]!;
                    if (v > 0.99) {
                        expect(mask[i]).toBe(1);
                        high++;
                    } else if (v < 0.01 && mask[i] !== NO_COVERAGE) {
                        expect(mask[i]).toBe(0);
                        low++;
                    }
                    const p = wcs.skyToPix(gridPixToSky(grid, { x, y }));
                    const dx = p.x - box.x0;
                    const dy = p.y - box.y0;
                    // Exclude rounding boundaries and the edge, where projection interpolation can differ.
                    if (dx >= 0 && dx <= 20 && dy >= 0 && dy <= 20
                        && Math.abs(dx % 1 - 0.5) > 0.01 && Math.abs(dy % 1 - 0.5) > 0.01) {
                        expect(mask[i]).toBe(data[Math.round(dy) * 21 + Math.round(dx)]);
                        nearestChecked++;
                    }
                }
            }
            expect(high).toBeGreaterThan(0);
            expect(low).toBeGreaterThan(0);
            expect(nearestChecked).toBeGreaterThan(100);
        });
    }

    it('marks uncovered output transparent and handles bit 31', () => {
        const data = new Int32Array(441).fill(-2147483648);
        const mask = regridFlags(data, box, wcs, grid, [31]);
        expect(mask).toContain(NO_COVERAGE);
        expect(mask).toContain(1);
        const rgba = flagsRgba(mask, [20, 30, 40], 200);
        for (let i = 0; i < mask.length; i++) {
            expect(Array.from(rgba.slice(i * 4, i * 4 + 4))).toEqual(mask[i] === 1 ? [20, 30, 40, 200] : [0, 0, 0, 0]);
        }
    });

    it('validates bits and box length, and supports empty selections', () => {
        const data = new Int32Array(441);
        const mask = regridFlags(data, box, wcs, grid, []);
        expect(mask).toContain(0);
        expect(mask).not.toContain(1);
        expect(summariseFlags(Int32Array.of(-1), [], []).flagged).toBe(0);
        for (const bit of [32, -1, 1.5, NaN]) {
            expect(() => regridFlags(data, box, wcs, grid, [bit])).toThrow(FlagsViewError);
            expect(() => summariseFlags(data, [], [bit])).toThrow(FlagsViewError);
        }
        expect(() => regridFlags(new Int32Array(440), box, wcs, grid, [])).toThrow(FlagsViewError);
    });
});

describe('counts and summaries', () => {
    it('counts the real FLAGS fixture against a plain bit loop', () => {
        const root = new URL('./fixtures/flags/', import.meta.url);
        const bytes = readFileSync(new URL('box.i32', root));
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const data = Int32Array.from({ length: bytes.length / 4 }, (_, i) => view.getInt32(i * 4, true));
        const names = flagNames(parseHeader(readFileSync(new URL('header.bin', root))));
        const expected = [];
        for (let bit = 0; bit < 32; bit++) {
            let pixels = 0;
            for (const value of data) {
                if (((value >>> bit) & 1) === 1) {
                    pixels++;
                }
            }
            if (pixels) {
                expected.push({ bit, name: names.find(item => item.bit === bit)?.name ?? '', pixels });
            }
        }
        expected.sort((a, b) => b.pixels - a.pixels || a.bit - b.bit);
        expect(flagCounts(data, names)).toEqual(expected);
    });

    it('includes unnamed and sign bits, and formats only chosen counts', () => {
        const data = new Int32Array(14400);
        data.fill(1, 0, 900);
        data.fill(128, 900, 1204);
        data.fill(-2147483648, 1204, 1514);
        const names = [{ bit: 0, name: 'TRANSIENT' }, { bit: 31, name: 'HIGH' }];
        expect(flagCounts(data, names)).toEqual([
            { bit: 0, name: 'TRANSIENT', pixels: 900 }, { bit: 31, name: 'HIGH', pixels: 310 },
            { bit: 7, name: '', pixels: 304 },
        ]);
        expect(summariseFlags(data, names, [0, 7])).toEqual({ total: 14400, flagged: 1204,
            counts: flagCounts(data, names),
            sentence: '1,204 of 14,400 detector pixels in the loaded detector area are flagged (8.4%). Most common: TRANSIENT (900), bit 7 (304).' });
        expect(summariseFlags(data, names, [31]).sentence)
            .toBe('310 of 14,400 detector pixels in the loaded detector area are flagged (2.2%). Most common: HIGH (310).');
        expect(summariseFlags(data, names, [4]).sentence).toBe('No pixel in the loaded detector area is flagged.');
        expect(summariseFlags(new Int32Array(), [], []).sentence).toBe('No detector pixels in the loaded detector area.');
    });

    it('counts overlapping selected bits once per pixel and lists at most three', () => {
        const data = Int32Array.of(15, 15, 7, 3, 1, 0);
        const summary = summariseFlags(data, [], [0, 1, 2, 3]);
        expect(summary.flagged).toBe(5);
        expect(summary.counts.map(count => count.pixels)).toEqual([5, 4, 3, 2]);
        expect(summary.sentence).toBe('5 of 6 detector pixels in the loaded detector area are flagged (83.3%). '
            + 'Most common: bit 0 (5), bit 1 (4), bit 2 (3).');
    });
});

it('counts only distinct detector pixels sampled in the view', () => {
    const data = new Int32Array(441).fill(1);
    const smallGrid = { ...grid, width: 21, height: 21 };
    const used = new Uint8Array(data.length).fill(9);
    regridFlags(data, box, wcs, smallGrid, [0], used);
    for (let i = 0; i < used.length; i++) {
        if (used[i] === 1) {
            data[i] = 0;
            const p = gridSkyToPix(smallGrid, wcs.pixToSky({ x: box.x0 + i % 21, y: box.y0 + Math.floor(i / 21) }));
            // Rotation can move a sampled centre by half a detector pixel along both axes.
            expect(p.x).toBeGreaterThanOrEqual(-2.9);
            expect(p.x).toBeLessThanOrEqual(22.9);
            expect(p.y).toBeGreaterThanOrEqual(-2.9);
            expect(p.y).toBeLessThanOrEqual(22.9);
        } else {
            expect(used[i]).toBe(0);
        }
    }
    const summary = summariseFlags(data, [], [0], used);
    expect(summary.total).toBe(Array.from(used).filter(value => value === 1).length);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.flagged).toBe(0);
    expect(summary.sentence).toBe('No pixel in this view is flagged.');
    expect(summariseFlags(data, [], [0]).flagged).toBeGreaterThan(0);
    expect(flagCounts(data, [], used)).toEqual([]);
    const mixed = Int32Array.of(1, 2, 4);
    const subset = Uint8Array.of(1, 2, 0);
    expect(flagCounts(mixed, [], subset)).toEqual([{ bit: 0, name: '', pixels: 1 }]);
    expect(summariseFlags(mixed, [], [0, 1, 2], subset)).toMatchObject({ total: 1, flagged: 1 });
    expect(() => regridFlags(data, box, wcs, smallGrid, [], new Uint8Array(1))).toThrow(FlagsViewError);
    expect(() => flagCounts(data, [], new Uint8Array(1))).toThrow(FlagsViewError);
    expect(() => summariseFlags(data, [], [], new Uint8Array(1))).toThrow(FlagsViewError);
    expect(summariseFlags(data, [], [], new Uint8Array(data.length)).sentence).toBe('No detector pixels in this view.');
});

it('formats extreme percentages and singular and plural grammar', () => {
    const data = new Int32Array(2500);
    data[0] = 1;
    const used = new Uint8Array(data.length).fill(1);
    expect(summariseFlags(data, [], [0], used).sentence)
        .toBe('1 of 2,500 detector pixels in this view is flagged (under 0.1%). Most common: bit 0 (1).');
    expect(summariseFlags(Int32Array.of(1), [], [0]).sentence)
        .toBe('1 of 1 detector pixel in the loaded detector area is flagged (100.0%). Most common: bit 0 (1).');
    data.fill(1);
    data[0] = 0;
    expect(summariseFlags(data, [], [0]).sentence).toContain('are flagged (over 99.9%)');
    data[0] = 1;
    expect(summariseFlags(data, [], [0]).sentence).toContain('are flagged (100.0%)');
});

it('rejects invalid grid sizes and returns no coverage for narrow boxes', () => {
    for (const width of [-5, 1.5, NaN, Infinity]) {
        expect(() => regridFlags(new Int32Array(441), box, wcs, { ...grid, width }, [])).toThrow(FlagsViewError);
        expect(() => regridFlags(new Int32Array(441), box, wcs, { ...grid, height: width }, [])).toThrow(FlagsViewError);
    }
    for (const [width, height] of [[0, 0], [0, 3], [3, 0], [1, 3], [3, 1], [1, 1]]) {
        const narrow = { x0: 20, y0: 20, x1: 20 + width!, y1: 20 + height! };
        const used = new Uint8Array(width! * height!).fill(1);
        expect(Array.from(regridFlags(new Int32Array(width! * height!), narrow, wcs, grid, [], used))
            .every(value => value === NO_COVERAGE)).toBe(true);
        expect(Array.from(used).every(value => value === 0)).toBe(true);
    }
    expect(regridFlags(new Int32Array(441), box, wcs, { ...grid, width: 0 }, [])).toHaveLength(0);
});

it('reuses and clears an RGBA output buffer', () => {
    const out = new Uint8ClampedArray(8).fill(99);
    expect(flagsRgba(Uint8Array.of(1, 0), [10, 20, 30], 40, out)).toBe(out);
    expect(flagsRgba(Uint8Array.of(NO_COVERAGE, 1), [1, 2, 3], 4, out)).toBe(out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
    expect(() => flagsRgba(Uint8Array.of(1), [0, 0, 0], 0, out)).toThrow(FlagsViewError);
});

it('orders equal counts by ascending bit', () => {
    expect(flagCounts(Int32Array.of(8, 2, 8, 2), []).map(item => item.bit)).toEqual([1, 3]);
});

it('matches image coverage and asymmetric flags on a non-square box and shortened lattice', () => {
    const rect = { x0: 9, y0: 12, x1: 32, y1: 29 };
    const data = new Int32Array(23 * 17);
    for (let y = 2; y < 14; y++) {
        for (let x = 3; x < 19; x++) {
            if (x === 3 || y === 13) {
                data[y * 23 + x] = 1;
            }
        }
    }
    const oddGrid = { ...grid, width: 101, height: 101 };
    const image = regridNorthUp({ ...cutout(data), box: rect, width: 23, height: 17 }, wcs, oddGrid);
    const mask = regridFlags(data, rect, wcs, oddGrid, [0]);
    let covered = 0;
    let uncovered = 0;
    let shape = 0;
    for (let y = 0; y < oddGrid.height; y++) {
        for (let x = 0; x < oddGrid.width; x++) {
            const i = y * oddGrid.width + x;
            expect(mask[i] === NO_COVERAGE).toBe(Number.isNaN(image[i]!));
            if (mask[i] === NO_COVERAGE) {
                uncovered++;
                continue;
            }
            covered++;
            const p = wcs.skyToPix(gridPixToSky(oddGrid, { x, y }));
            const px = p.x - rect.x0;
            const py = p.y - rect.y0;
            if (Math.abs(px % 1 - 0.5) > 0.01 && Math.abs(py % 1 - 0.5) > 0.01) {
                expect(mask[i]).toBe(data[Math.round(py) * 23 + Math.round(px)]);
            }
            if (mask[i] === 1) {
                shape++;
            }
        }
    }
    expect(covered).toBeGreaterThan(0);
    expect(uncovered).toBeGreaterThan(0);
    expect(shape).toBeGreaterThan(0);
});

it('produces clamped RGBA only for mask value one', () => {
    const mask = Uint8Array.of(0, 1, NO_COVERAGE, 3);
    expect(flagsRgba(mask, [12, 34, 56], 300)).toEqual(Uint8ClampedArray.of(0, 0, 0, 0, 12, 34, 56, 255, 0, 0, 0, 0, 0, 0, 0, 0));
    expect(flagsRgba(Uint8Array.of(1), [12, 34, 56], -2)).toEqual(Uint8ClampedArray.of(12, 34, 56, 0));
});
