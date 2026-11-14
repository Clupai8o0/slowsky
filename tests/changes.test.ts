import { beforeEach, describe, expect, it } from 'vitest';
import { compareVisits, findTracklets, significance, snrText, NO_SNR_NOTE, PLAIN_LEAD, hasSnrFigure, plainListNotes, stripSnr } from '../src/lib/changes';
// @ts-expect-error Node types are not included in the browser project.
import { readFileSync } from 'node:fs';
import { createSnapshotSource } from '../src/lib/source';
import { groupByVisit, stackVisit } from '../src/lib/stack';
import { gridSkyToPix } from '../src/lib/regrid';
import { positionAt, targetById } from '../src/lib/targets';
import type { FrameRecord, OutputGrid, RegriddedFrame } from '../src/lib/types';

declare const process: { cwd(): string };

const grid: OutputGrid = { center: { ra: 20, dec: 30 }, fovDeg: 0.1, pixelArcsec: 1.5375, width: 121, height: 121 };

describe('plain pass 5 noise regressions', () => {
    it('records the review’s single-left-edge input', () => {
        const g = { ...grid, width: 200, height: 200 };
        seed = 772991;
        const a = noise(g), b = noise(g);
        injectSnr(a, b, g, 8, 100, 15);
        for (let y = 81; y <= 94; y++) { for (let x = 0; x <= 7; x++) { b[y * g.width + x] = NaN; } }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
            .find(c => Math.hypot(c.pix.x - 8, c.pix.y - 100) * g.pixelArcsec < 6)!;
        expect(c).toBeDefined();
        expect(c.reading).toBe('unclear');
        expect(c.sentence).toContain('Pixels at or near it are missing in at least one visit.');
    });
    it('attributes a 22–31 arcsecond blank arc to missing pixels rather than the left edge', () => {
        const g = { ...grid, width: 161, height: 161 };
        const x = 25 / g.pixelArcsec, y = 80.3;
        seed = 9041;
        const a = noise(g), b = noise(g);
        injectSnr(a, b, g, x, y, 20);
        for (let j = 0; j < g.height; j++) {
            for (let i = 0; i < g.width; i++) {
                const d = Math.hypot(i - x, j - y) * g.pixelArcsec;
                if (i >= x && d >= 22 && d <= 31) { a[j * g.width + i] = NaN; }
            }
        }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
            .find(c => Math.hypot(c.pix.x - x, c.pix.y - y) * g.pixelArcsec < 9)!;
        expect(c).toBeDefined();
        expect(c.sentence).toContain('Too few pixels around it could be compared to tell which visit has more light.');
        expect(c.sentence).not.toContain('It is too close to the edge');
    });
    it('checks a left edge at mid-height on a coarse grid', () => {
        const g = { ...grid, width: 100, height: 100, pixelArcsec: 25 };
        seed = 9912;
        const a = noise(g), b = noise(g);
        point(b, g, 1, 50, 300);
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
            .find(c => Math.hypot(c.pix.x - 1, c.pix.y - 50) < 1)!;
        expect(c).toBeDefined();
        expect(c.sentence).toContain('It is too close to the edge of the picture to compare with the sky around it.');
    });
    it('explains an unclear coarse-grid reading with only four ring pixels per quadrant', () => {
        const g = { ...grid, width: 100, height: 100, pixelArcsec: 3.5 };
        seed = 1532;
        const a = noise(g), b = noise(g);
        point(b, g, 50, 50, 300);
        const kept = [0, 0, 0, 0];
        for (let y = 40; y <= 60; y++) {
            for (let x = 40; x <= 60; x++) {
                const d = Math.hypot(x - 50, y - 50) * g.pixelArcsec;
                if (d < 18 || d > 30) { continue; }
                const side = (x >= 50 ? 1 : 0) + (y >= 50 ? 2 : 0);
                if (kept[side]!++ >= 4) { a[y * g.width + x] = NaN; }
            }
        }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
            .find(c => Math.hypot(c.pix.x - 50, c.pix.y - 50) < 2)!;
        expect(c).toBeDefined();
        expect(c.reading).toBe('unclear');
        expect(c.nearGap).toBe(true);
        expect(c.sentence).toContain('It is close to pixels that could not be compared, or to the edge of the picture.');
        expect(c.sentence).not.toContain('Too few pixels around it');
    });
    it('explains an unclear reading on a naturally sparse coarse grid', () => {
        const g = { ...grid, width: 100, height: 100, pixelArcsec: 12 };
        seed = 1532;
        const a = noise(g), b = noise(g);
        point(b, g, 50, 50, 300);
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
            .find(c => Math.hypot(c.pix.x - 50, c.pix.y - 50) < 1)!;
        expect(c).toBeDefined();
        expect(c.reading).toBe('unclear');
        expect(c.sentence).toContain('Too few pixels around it could be compared to tell which visit has more light.');
    });
    it('qualifies ordering within catalogue groups and leaves the S/N clause out when no figure is shown', () => {
        const visible = { reason: 'Spot (S/N 9.0; candidate).' };
        const hidden = { reason: 'Spot (candidate).', snrMapMissing: true };
        expect(plainListNotes([visible, hidden], true, 6)[0]).toContain('within each group, spots with no S/N figure come after those with one');
        expect(plainListNotes([{ reason: 'Spot (candidate).', snrFlagRemoved: true }, hidden], true, 6)[0])
            .toBe('Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise.');
    });
    it('does not repeat a gap explanation for an unclear ring', () => {
        const g = { ...grid, width: 200, height: 200 };
        seed = 772991;
        const a = noise(g), b = noise(g);
        injectSnr(a, b, g, 16, 100, 15);
        for (let y = 100; y <= 118; y++) { for (let x = 24; x <= 35; x++) { b[y * g.width + x] = NaN; } }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
            .find(c => Math.hypot(c.pix.x - 16, c.pix.y - 100) * g.pixelArcsec < 6)!;
        expect(c.sentence).toContain('It is close to pixels that could not be compared, or to the edge of the picture.');
        expect(c.sentence).not.toContain('Too few pixels around it');
    });
    it('source text check: retains the ring-scatter guard', () => {
        // The 5-sigma core guard can make the scatter guard redundant on normal grids; preserve the contract explicitly.
        const source = readFileSync(`${process.cwd()}/src/lib/changes.ts`, 'utf8');
        expect(source).toMatch(/&&\s*scatter\s*<=\s*PLAIN_RING_SPREAD\s*\*\s*Math\.abs\(local\)/);
    });
    it('does not give a direction with only one populated radial band', () => {
        seed = 998877;
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 200);
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                const d = Math.hypot(x - 60, y - 60) * grid.pixelArcsec;
                if (d >= 21 && d <= 30) { b[y * grid.width + x] = NaN; }
            }
        }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .find(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) < 2);
        expect(c).toBeDefined();
        expect(c!.reading).toBe('unclear');
    });
    it('explains geometrically clipped rings between 18 and 30 arcseconds from a corner', () => {
        const results: string[] = [];
        for (const pixelArcsec of [1.5375, 2.5, 4.99, 6.15]) {
            const g = { ...grid, pixelArcsec };
            for (const edge of [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]) {
                seed = 772991;
                const a = noise(g), b = noise(g), x = edge / pixelArcsec;
                injectSnr(a, b, g, x, x, 15);
                const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
                    .find(c => Math.hypot(c.pix.x - x, c.pix.y - x) * pixelArcsec < 6);
                if (c?.sentence.includes('It is too close to the edge of the picture to compare with the sky around it.')) { results.push(`${pixelArcsec}/${edge}`); }
            }
        }
        expect(results.length).toBeGreaterThan(0);
    });
    it('explains blank pixels in the ring without claiming the edge caused it', () => {
        const g = { ...grid, width: 200, height: 200 };
        for (const left of [28, 24]) {
            seed = 772991;
            const a = noise(g), b = noise(g);
            injectSnr(a, b, g, 16, 100, 15);
            for (let y = 100; y <= 118; y++) {
                for (let x = left; x <= 35; x++) { b[y * g.width + x] = NaN; }
            }
            const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
                .find(c => Math.hypot(c.pix.x - 16, c.pix.y - 100) * g.pixelArcsec < 6);
            expect(c).toBeDefined();
            expect(c!.sentence).not.toContain('It is too close to the edge of the picture to compare with the sky around it.');
            if (left === 28) {
                expect(c!.reading).toBe('moreLater');
            } else {
                expect(c!.reading).toBe('unclear');
                expect(c!.sentence).toBe(`The light here differs between the two visits, and which visit has more is not clear; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (${snrText(c!.snr)}; candidate). It is close to pixels that could not be compared, or to the edge of the picture.`);
            }
        }
    });
    it('compares the difference ring when a steady star cancels between visits', () => {
        const g = { ...grid, width: 200, height: 200 };
        seed = 991241;
        const a = noise(g), b = noise(g);
        point(a, g, 100 + 22 / g.pixelArcsec, 100, 500);
        point(b, g, 100 + 22 / g.pixelArcsec, 100, 500);
        injectSnr(a, b, g, 100, 100, 20);
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
            .find(c => Math.hypot(c.pix.x - 100, c.pix.y - 100) * g.pixelArcsec < 6);
        expect(c).toBeDefined();
        expect(c!.reading).toBe('moreLater');
        expect(c!.sentence).toBe(`Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (${snrText(c!.snr)}; candidate).`);
    });
    it('does not repeat an edge explanation at an 18-arcsecond corner', () => {
        for (const pixelArcsec of [1.5375, 2.5]) {
            const g = { ...grid, pixelArcsec }, x = 18 / pixelArcsec;
            seed = 772991;
            const a = noise(g), b = noise(g);
            point(b, g, x, x, 300);
            const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
                .find(c => Math.hypot(c.pix.x - x, c.pix.y - x) * pixelArcsec < 6);
            expect(c).toBeDefined();
            expect(c!.sentence).toContain('It is close to pixels that could not be compared, or to the edge of the picture.');
            expect(c!.sentence).not.toContain('It is too close to the edge of the picture to compare with the sky around it.');
        }
    });
    it('retains the field-noise floor when the sky ring is unusually quiet', () => {
        seed = 113377;
        const a = noise(grid), b = noise(grid);
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                const d = Math.hypot(x - 60, y - 60) * grid.pixelArcsec;
                const i = y * grid.width + x;
                if (d >= 18 && d <= 30) { b[i] = a[i]!; }
                if (d <= 6) { b[i] = a[i]! + 1; }
                else if (d <= 12) { b[i] = a[i]! + 20; }
            }
        }
        b[60 * grid.width + 60] = a[60 * grid.width + 60]! + 20;
        const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .filter(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) * grid.pixelArcsec < 3);
        expect(spots.length).toBeGreaterThan(0);
        expect(spots.map(c => c.reading)).toEqual(spots.map(() => 'unclear'));
    });

    it('does not count more independent core pixels than picture pixels', () => {
        const g = { ...grid, pixelArcsec: 8 };
        seed = 113377;
        const a = noise(g), b = noise(g);
        const sigma = significance(b.map((v, i) => v - a[i]!), g).sigma;
        for (let y = 0; y < g.height; y++) {
            for (let x = 0; x < g.width; x++) {
                const d = Math.hypot(x - 60, y - 60) * g.pixelArcsec;
                const i = y * g.width + x;
                if (d >= 18 && d <= 30) { b[i] = a[i]!; }
                if (d <= 8) { b[i] = a[i]! - 1.5 * sigma; }
                else if (d <= 12) { b[i]! += 1 * sigma; }
            }
        }
        b[60 * g.width + 60] = a[60 * g.width + 60]! + 15 * sigma;
        const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
            .filter(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) * g.pixelArcsec < 3);
        expect(spots.length).toBeGreaterThan(0);
        expect(spots.map(c => c.reading)).toEqual(spots.map(() => 'unclear'));
    });

    it('keeps a resolved native-pixel core direction when its neighbours support it', () => {
        const g = { ...grid, pixelArcsec: 6.15 };
        seed = 113377;
        const a = noise(g), b = noise(g);
        const sigma = significance(b.map((v, i) => v - a[i]!), g).sigma;
        for (let y = 0; y < g.height; y++) {
            for (let x = 0; x < g.width; x++) {
                const d = Math.hypot(x - 60, y - 60) * g.pixelArcsec;
                const i = y * g.width + x;
                if (d >= 18 && d <= 30) { b[i] = a[i]!; }
                if (d <= 6.15) { b[i] = a[i]! + 4 * sigma; }
            }
        }
        b[60 * g.width + 60] = a[60 * g.width + 60]! + 20 * sigma;
        const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
            .filter(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) * g.pixelArcsec < 3);
        expect(spots.length).toBeGreaterThan(0);
        expect(spots.map(c => c.reading)).toEqual(spots.map(() => 'moreLater'));
    });

    it('explains clipped sky rings without repeating the nearer edge fact', () => {
        const g = { ...grid, pixelArcsec: 1.5375 };
        for (const [edge, corner] of [[3, false], [15, false], [25, false], [35, false], [18, true]] as const) {
            seed = 772991;
            const a = noise(g), b = noise(g), x = edge / g.pixelArcsec, y = corner ? x : 60;
            point(b, g, x, y, 300);
            const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
                .find(c => Math.hypot(c.pix.x - x, c.pix.y - y) * g.pixelArcsec < 6);
            expect(c, `${edge}/${corner}`).toBeDefined();
            const prefix = c!.reading === 'unclear' ? 'The light here differs between the two visits, and which visit has more is not clear'
                : `Measured against the change in the sky around it, there is ${c!.reading === 'moreLater' ? 'more' : 'less'} light here in the later visit than in the earlier one`;
            const fact = edge === 3 ? ' It is near the edge of the picture.' : corner
                ? ' It is close to pixels that could not be compared, or to the edge of the picture.' : edge === 15
                    ? ' It is close to pixels that could not be compared, or to the edge of the picture.' : '';
            expect(c!.sentence).toBe(`${prefix}; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (${snrText(c!.snr)}; candidate).${fact}`);
        }
    });

    it('rejects directions at empty centres of bright rings', () => {
        const wrong: string[] = [];
        for (const pixelArcsec of [1.5375, 2.5]) {
            const g = { ...grid, pixelArcsec };
            for (const radius of [9, 12, 15]) {
                for (const width of [4, 8]) {
                    for (const brightness of [30, 100]) {
                        for (const base of [123456, 654321]) {
                            for (let trial = 0; trial < 30; trial++) {
                                seed = base + trial * 7919;
                                const a = noise(g), b = noise(g);
                                for (let y = 0; y < g.height; y++) {
                                    for (let x = 0; x < g.width; x++) {
                                        const d = Math.hypot(x - 60, y - 60) * pixelArcsec;
                                        if (d >= radius && d <= radius + width) { b[y * g.width + x]! += brightness; }
                                    }
                                }
                                const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates;
                                for (const c of spots) {
                                    if (Math.hypot(c.pix.x - 60, c.pix.y - 60) * pixelArcsec < 9 && c.reading !== 'unclear') {
                                        wrong.push(`${pixelArcsec}/${radius}/${width}/${brightness}/${base + trial * 7919}`);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        console.log('pass5 ring wrong', wrong.length, wrong.slice(0, 12));
        expect(wrong).toEqual([]);
    }, 600000);

    it('preserves directions for real new and fading sources', () => {
        const table: Record<string, number> = {};
        const wrong: string[] = [];
        for (const pixelArcsec of [1.5375, 2.5, 4.99, 6.15]) {
            const g = { ...grid, pixelArcsec };
            for (const snr of [8, 15, 50]) {
                for (const fading of [false, true]) {
                    let right = 0;
                    for (let trial = 0; trial < 20; trial++) {
                        seed = 73421 + trial * 7919;
                        const a = noise(g), b = noise(g);
                        const before = b.slice();
                        injectSnr(a, b, g, 60, 60, snr);
                        if (fading) {
                            for (let i = 0; i < a.length; i++) { a[i]! += 2 * (b[i]! - before[i]!); }
                        }
                        const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
                            .filter(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) * pixelArcsec < 9);
                        if (spots.some(c => c.reading === (fading ? 'lessLater' : 'moreLater'))) { right++; }
                        if (spots.some(c => c.reading === (fading ? 'moreLater' : 'lessLater'))) { wrong.push(`${pixelArcsec}/${snr}/${fading}/${trial}`); }
                    }
                    table[`${pixelArcsec}/${snr}/${fading ? 'fade' : 'new'}`] = right;
                }
            }
        }
        console.log('pass5 real sources', JSON.stringify(table));
        expect(wrong).toEqual([]);
        const baseline = [20, 20, 20, 20, 20, 20, 18, 14, 20, 20, 20, 20, 12, 9, 17, 16, 20, 20, 10, 10, 18, 13, 20, 20];
        Object.values(table).forEach((count, index) => expect(count, Object.keys(table)[index]).toBeGreaterThanOrEqual(baseline[index]!));
    }, 600000);

    it('rejects block-correlated noise with and without a neighbouring sky step', () => {
        const wrong: string[] = [];
        let seen = 0;
        for (const pixelArcsec of [1.5375, 2.5]) {
            const g = { ...grid, pixelArcsec, width: 200, height: 200 };
            const block = pixelArcsec === 1.5375 ? 4 : 2;
            const tile = block * Math.max(2, Math.round(64 / (pixelArcsec * block)));
            for (const step of [0, 40, -40]) {
                for (let trial = 0; trial < 60; trial++) {
                    seed = 302411 + trial * 7919;
                    const a = new Float32Array(g.width * g.height), b = a.slice();
                    for (let y = 0; y < g.height; y += block) {
                        for (let x = 0; x < g.width; x += block) {
                            const av = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
                            const bv = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
                            for (let j = y; j < Math.min(y + block, g.height); j++) {
                                for (let i = x; i < Math.min(x + block, g.width); i++) {
                                    a[j * g.width + i] = av;
                                    b[j * g.width + i] = bv + (i >= tile && i < 2 * tile && j >= tile && j < 2 * tile ? step : 0);
                                }
                            }
                        }
                    }
                    const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates;
                    seen += spots.length;
                    for (const c of spots) {
                        if (c.reading !== 'unclear') { wrong.push(`${pixelArcsec}/${step}/${trial}/${c.pix.x}/${c.pix.y}`); }
                    }
                }
            }
        }
        console.log('pass5 block wrong', wrong.length, 'found', seen, wrong.slice(0, 12));
        expect(seen).toBeGreaterThan(0);
        expect(wrong).toEqual([]);
    }, 600000);

    it('rejects directions at empty centres of glows in the sky ring', () => {
        const wrong: string[] = [];
        let found = 0;
        for (const pixelArcsec of [1.5375, 2.5, 4.99]) {
            const g = { ...grid, pixelArcsec, width: 200, height: 200 };
            const k = Math.max(1, Math.round(6.15 / pixelArcsec));
            const tile = k * Math.max(2, Math.round(64 / (pixelArcsec * k)));
            for (const radius of [20, 22, 24, 26, 28]) {
                for (const width of [3, 6, 9]) {
                    for (let trial = 0; trial < 20; trial++) {
                        seed = 777123 + trial * 7919;
                        const a = noise(g), b = noise(g);
                        for (let y = 0; y < g.height; y++) {
                            for (let x = 0; x < g.width; x++) {
                                const d = Math.hypot(x - 100, y - 100) * pixelArcsec;
                                if (d > 18 && Math.floor(x / tile) === Math.floor(100 / tile) && Math.floor(y / tile) === Math.floor(100 / tile)) { b[y * g.width + x]! += 15; }
                                if (d >= 18 && Math.abs(d - radius) <= width / 2) { b[y * g.width + x]! += 40; }
                            }
                        }
                        const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
                            .filter(c => Math.hypot(c.pix.x - 100, c.pix.y - 100) * pixelArcsec < 6);
                        found += spots.length;
                        for (const c of spots) {
                            if (c.reading !== 'unclear') { wrong.push(`${pixelArcsec}/${radius}/${width}/${trial}/${c.pix.x.toFixed(2)}/${c.pix.y.toFixed(2)}/${c.reading}`); }
                        }
                    }
                }
            }
        }
        console.log('pass5 sky ring wrong', wrong.length, 'found', found, wrong.slice(0, 12));
        expect(found).toBeGreaterThan(0);
        expect(wrong).toEqual([]);
    }, 600000);
});

describe('plain pass 4', () => {
    it.each(['core', 'spread', 'inner', 'floor'])('P9 independently requires the %s guard', (model) => {
        seed = 918273;
        const a = noise(grid), b = noise(grid);
        const cx = model === 'floor' ? 5 : 60;
        if (model !== 'core') { point(b, grid, cx, 60, model === 'inner' ? 30 : model === 'spread' ? 60 : 100); }
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                const d = Math.hypot(x - cx, y - 60) * grid.pixelArcsec;
                const i = y * grid.width + x;
                if (model === 'core') {
                    if (d <= 6) {
                        b[i]! -= 5;
                    } else if (d <= 12) {
                        b[i]! += 1000;
                    } else if (d >= 24 && d <= 30) {
                        b[i]! -= 30;
                    }
                } else if (model === 'spread' && d >= 18 && d <= 30) {
                    b[i]! += x < cx ? 20 : 0;
                } else if (model === 'inner' && d >= 18 && d <= 25) {
                    b[i]! += 15;
                }
            }
        }
        if (model === 'core') { b[60 * grid.width + cx] = a[60 * grid.width + cx]! + 20; }
        const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .filter(c => Math.hypot(c.pix.x - cx, c.pix.y - 60) * grid.pixelArcsec < 6);
        expect(spots).toHaveLength(1);
        const c = spots[0]!;
        expect(c.reading).toBe('unclear');
        expect(c.sentence).toBe(`The light here differs between the two visits, and which visit has more is not clear; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (${snrText(c.snr)}; candidate).${model === 'floor' ? ' It is near the edge of the picture.' : ''}`);
    });
    it('P2 unchanged discs are described relative to the surrounding sky', () => {
        for (const radius of [12, 15, 18, 23]) {
            for (let trial = 0; trial < 10; trial++) {
                seed = 918273 + trial;
                const a = noise(grid), b = noise(grid), cx = radius === 23 ? 80 : 60;
                for (let y = 0; y < grid.height; y++) {
                    for (let x = 0; x < grid.width; x++) {
                        if (Math.hypot(x - cx, y - cx) * grid.pixelArcsec > radius) { b[y * grid.width + x]! += 30; }
                    }
                }
                const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
                    .find(c => Math.hypot(c.pix.x - cx, c.pix.y - cx) * grid.pixelArcsec < 6)!;
                expect(c, `${radius}/${trial}`).toBeDefined();
                const start = radius === 23 ? 'The light here differs between the two visits, and which visit has more is not clear'
                    : 'Measured against the change in the sky around it, there is less light here in the later visit than in the earlier one';
                expect(c.sentence, `${radius}/${trial}`).toBe(`${start}; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (${snrText(c.snr)}; candidate).`);
            }
        }
    });

    it('P2 a fading source with more raw light later still names the surrounding sky', () => {
        seed = 918273;
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 100);
        point(b, grid, 60, 60, 89);
        for (let i = 0; i < b.length; i++) { b[i]! += 41; }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .find(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) < 2)!;
        expect(b[60 * grid.width + 60]! - a[60 * grid.width + 60]!).toBeGreaterThan(25);
        expect(c.reading).toBe('lessLater');
        expect(c.sentence).toBe(`Measured against the change in the sky around it, there is less light here in the later visit than in the earlier one; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (${snrText(c.snr)}; candidate).`);
    });

    it('P4 a straight patch edge nine arcseconds away gives no direction', () => {
        const directions: string[] = [];
        for (const pixelArcsec of [1.5375, 2.5, 4.99]) {
            const g = { ...grid, pixelArcsec };
            for (const amplitude of [1.5, 3]) {
                for (let trial = 0; trial < 10; trial++) {
                    seed = 918273 + trial;
                    const a = noise(g), b = noise(g);
                    const sigma = significance(b.map((v, i) => v - a[i]!), g).sigma;
                    for (let y = 0; y < g.height; y++) {
                        for (let x = Math.ceil(60 + 9 / pixelArcsec); x < g.width; x++) { b[y * g.width + x]! += amplitude * sigma; }
                    }
                    for (const c of compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates) {
                        if (c.pix.x < 60 + 9 / pixelArcsec && c.reading !== 'unclear') { directions.push(`${pixelArcsec}/${amplitude}/${trial}`); }
                    }
                }
            }
        }
        expect(directions).toEqual([]);
    });

    it('P5 a found hot pixel on the 6.15 arcsecond grid has no direction', () => {
        const g = { ...grid, pixelArcsec: 6.15 };
        for (let trial = 0; trial < 7; trial++) {
            seed = 918273 + trial;
            const a = noise(g), b = noise(g);
            const sigma = significance(b.map((v, i) => v - a[i]!), g).sigma;
            b[60 * g.width + 60] = a[60 * g.width + 60]! + 20 * sigma;
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const i = (60 + dy!) * g.width + 60 + dx!;
                b[i] = a[i]! - 4 * sigma;
            }
            const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true, minAreaArcsec2: 1 }).candidates
                .filter(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) * g.pixelArcsec < 12);
            expect(spots.length, `trial ${trial}`).toBeGreaterThan(0);
            expect(spots.map(c => c.reading)).toEqual(spots.map(() => 'unclear'));
        }
    });

    it('P1 ring centres have zero directions across radii, widths, brightnesses and noise seeds', () => {
        const directions: string[] = [];
        let seen = 0;
        for (const pixelArcsec of [1.5375, 4.99]) {
            const g = { ...grid, pixelArcsec };
            for (const radius of [15, 16.5, 18]) {
                for (const width of [6, 8]) {
                    for (const amplitude of [30, 100]) {
                        for (let trial = 0; trial < 10; trial++) {
                            seed = 918273 + trial;
                            const a = noise(g), b = noise(g);
                            for (let y = 0; y < g.height; y++) {
                                for (let x = 0; x < g.width; x++) {
                                    const d = Math.hypot(x - 60, y - 60) * pixelArcsec;
                                    if (d >= radius && d <= radius + width) { b[y * g.width + x]! += amplitude; }
                                }
                            }
                            const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
                                .filter(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) * pixelArcsec < 12);
                            seen += spots.length;
                            for (const c of spots) {
                                if (c.reading !== 'unclear') { directions.push(`${pixelArcsec}/${radius}/${width}/${amplitude}/${trial}: ${c.reading}`); }
                            }
                        }
                    }
                }
            }
        }
        console.log('P1 ring', seen, directions);
        expect(seen).toBeGreaterThan(0);
        expect(directions).toEqual([]);
    }, 30000);

    it('P1 preserves new and half-fading point-source directions at every page scale', () => {
        const counts: number[][] = [];
        const wrong: string[] = [];
        for (const pixelArcsec of [1.5375, 2.5, 4.99]) {
            const g = { ...grid, pixelArcsec };
            for (const fading of [false, true]) {
                for (const snr of [8, 15, 50]) {
                    let right = 0;
                    for (let trial = 0; trial < 10; trial++) {
                        seed = 918273 + trial;
                        const a = noise(g), b = noise(g);
                        const bare = b.slice();
                        injectSnr(a, b, g, 60, 60, snr);
                        if (fading) {
                            // The injected profile is the difference: twice that light fades to half.
                            for (let i = 0; i < a.length; i++) {
                                const signal = b[i]! - bare[i]!;
                                a[i]! += 2 * signal;
                            }
                        }
                        const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
                            .filter(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) * pixelArcsec < 12);
                        const expected = fading ? 'lessLater' : 'moreLater';
                        if (spots.some(c => c.reading === expected)) { right++; }
                        for (const c of spots) {
                            if (c.reading !== expected && c.reading !== 'unclear') { wrong.push(`${pixelArcsec}/${fading}/${snr}/${trial}`); }
                        }
                    }
                    counts.push([pixelArcsec, Number(fading), snr, right]);
                }
            }
        }
        console.log('P1 point counts', JSON.stringify(counts));
        expect(wrong).toEqual([]);
        const before = [10, 10, 10, 9, 10, 10, 5, 9, 9, 5, 7, 9, 3, 8, 8, 4, 7, 7];
        counts.forEach((row, index) => expect(row[3], JSON.stringify(row)).toBeGreaterThanOrEqual(before[index]!));
        expect(counts.map(row => row[3])).toEqual([10, 10, 10, 9, 10, 10, 5, 10, 10, 5, 8, 10, 3, 8, 10, 4, 10, 10]);
    }, 30000);

    it('P3 gradients give no direction even at the clipped picture edges', () => {
        const directions: string[] = [];
        let seen = 0;
        for (const pixelArcsec of [1.5375, 2.5, 4.99]) {
            const g = { ...grid, width: 200, height: 200, pixelArcsec };
            for (const [slope, noiseScale] of [[0, 0], [1, 0], [0, 0.02], [1, 0.02], [0, 1], [1, 1]]) {
                for (let trial = 0; trial < 10; trial++) {
                    seed = 918273 + trial;
                    const a = noise(g).map(v => v * noiseScale!), b = noise(g).map(v => v * noiseScale!);
                    for (let y = 0; y < g.height; y++) {
                        for (let x = 0; x < g.width; x++) { b[y * g.width + x]! += slope ? 8 - 0.15 * y : 0.2 * (y - 39); }
                    }
                    const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates;
                    seen += spots.length;
                    for (const c of spots) {
                        if (c.reading !== 'unclear') { directions.push(`${pixelArcsec}/${slope}/${trial}: ${c.pix.x},${c.pix.y}`); }
                    }
                }
            }
        }
        console.log('P3 gradient', seen, directions);
        expect(directions).toEqual([]);
    }, 30000);

    it('P3 checks new sources three arcseconds from an edge and in a corner', () => {
        const counts: number[][] = [];
        for (const pixelArcsec of [1.5375, 2.5, 4.99]) {
            const g = { ...grid, pixelArcsec };
            for (const corner of [false, true]) {
                let right = 0, seen = 0;
                for (let trial = 0; trial < 10; trial++) {
                    seed = 918273 + trial;
                    const a = noise(g), b = noise(g), x = 3 / pixelArcsec, y = corner ? x : 60;
                    point(b, g, x, y, 300);
                    const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
                        .filter(c => Math.hypot(c.pix.x - x, c.pix.y - y) * pixelArcsec < 12);
                    seen += spots.length;
                    right += Number(spots.some(c => c.reading === 'moreLater'));
                    expect(spots.some(c => c.reading === 'lessLater')).toBe(false);
                }
                counts.push([pixelArcsec, Number(corner), seen, right]);
            }
        }
        console.log('P3 edge counts', JSON.stringify(counts));
        // The required quadrant floor withdraws even true near-edge directions: no balanced ring fits here.
        expect(counts).toEqual([[1.5375, 0, 10, 0], [1.5375, 1, 10, 0], [2.5, 0, 10, 0], [2.5, 1, 10, 0], [4.99, 0, 10, 0], [4.99, 1, 10, 0]]);
    });

    it('P4 keeps a true S/N 50 source twenty arcseconds from a steady bright star', () => {
        const counts: number[][] = [];
        const wrong: string[] = [];
        for (const pixelArcsec of [1.5375, 2.5, 4.99]) {
            const g = { ...grid, pixelArcsec };
            for (const shift of [0, 0.3]) {
                let right = 0;
                for (let trial = 0; trial < 20; trial++) {
                    seed = 918273 + trial;
                    const a = noise(g), b = noise(g);
                    injectSnr(a, b, g, 60, 60, 50);
                    point(a, g, 60 + 20 / pixelArcsec, 60, 3000);
                    point(b, g, 60 + 20 / pixelArcsec + shift, 60, 3000);
                    const spots = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), g, [], { plain: true }).candidates
                        .filter(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) * pixelArcsec < 6);
                    if (spots.some(c => c.reading === 'moreLater')) { right++; }
                    for (const c of spots) {
                        if (c.reading === 'lessLater') { wrong.push(`${pixelArcsec}/${shift}/${trial}`); }
                    }
                }
                counts.push([pixelArcsec, shift, right]);
            }
        }
        console.log('P4 neighbour counts', JSON.stringify(counts));
        expect(wrong).toEqual([]);
        expect(counts).toEqual([[1.5375, 0, 20], [1.5375, 0.3, 20], [2.5, 0, 20], [2.5, 0.3, 20], [4.99, 0, 20], [4.99, 0.3, 0]]);
    }, 30000);

    it('P8 keeps only catalogue ordering when overflow hides every mapped S/N', () => {
        expect(plainListNotes([{ reason: 'The light here differs (candidate).' }], true, 6)).toEqual([
            'Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise.',
        ]);
    });

    it('P9 S/N not measured is not a figure or a reason for numeric ordering', () => {
        const text = 'The light here differs (S/N not measured; candidate).';
        expect(hasSnrFigure(text)).toBe(false);
        expect(stripSnr(text)).toBe('The light here differs (candidate).');
        expect(plainListNotes([{ reason: text }], false, 6)).toEqual([
            'Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise estimated from the difference image; that figure is used only for this order.',
        ]);
    });
});

describe('round 11 public readings', () => {
    beforeEach(() => { seed = 918273; });
    it('leaves patch-edge directions unclear across ten noise seeds', () => {
        const counts: number[] = [];
        for (const [amplitude, x2, y1] of [[8, 70, 40], [30, 70, 40], [30, 79, 50]]) {
            let directed = 0;
            for (let trial = 0; trial < 10; trial++) {
                seed = 918273 + trial;
                const a = noise(grid), b = noise(grid);
                for (let y = y1!; y <= 79; y++) {
                    for (let x = 40; x <= x2!; x++) { b[y * grid.width + x]! += amplitude!; }
                }
                const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
                for (const c of r.candidates) {
                    const dx = Math.max(40 - c.pix.x, 0, c.pix.x - x2!);
                    const dy = Math.max(y1! - c.pix.y, 0, c.pix.y - 79);
                    if ((dx > 0 || dy > 0) && Math.hypot(dx, dy) * grid.pixelArcsec <= 30 && c.reading !== 'unclear') { directed++; }
                }
            }
            counts.push(directed);
        }
        expect(counts).toEqual([0, 0, 0]);
    });
    it('gives no direction for a spot that did not change inside a sky that brightened', () => {
        // The later visit is brighter everywhere except a disc of radius 23 pixels (35″) that is the same in both. The
        // background tiles cannot follow the hole, so the tile-corrected difference is negative inside it; the spot's
        // own ring (18″ to 30″) lies inside the hole and shows no difference. A bare sign test on that local reading
        // passed on noise alone in 4 to 7 of 10 draws.
        const counts: number[][] = [];
        for (const [cx, cy, amplitude] of [[80, 80, 30], [60, 60, 30], [40, 40, 30], [80, 80, 8]]) {
            let directed = 0, seen = 0;
            for (let trial = 0; trial < 10; trial++) {
                seed = 918273 + trial;
                const a = noise(grid), b = noise(grid);
                for (let y = 0; y < grid.height; y++) {
                    for (let x = 0; x < grid.width; x++) {
                        if (Math.hypot(x - cx!, y - cy!) > 23) { b[y * grid.width + x]! += amplitude!; }
                    }
                }
                const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
                for (const c of r.candidates) {
                    if (Math.hypot(c.pix.x - cx!, c.pix.y - cy!) <= 23) {
                        seen++;
                        if (c.reading !== 'unclear') { directed++; }
                    }
                }
            }
            counts.push([seen > 0 ? 1 : 0, directed]);
        }
        expect(counts).toEqual([[1, 0], [1, 0], [1, 0], [1, 0]]);
    });
    it('gives no direction in the inside corner of a patch of sky that brightened', () => {
        // The later visit is brighter everywhere except one quarter of the picture. Just inside that quarter's corner
        // three sides of a spot's ring are brighter and one is not, so the ring cannot say what the sky around it did.
        let directed = 0, seen = 0;
        for (const corner of [60, 50, 70]) {
            for (let trial = 0; trial < 10; trial++) {
                seed = 918273 + trial;
                const a = noise(grid), b = noise(grid);
                for (let y = 0; y < grid.height; y++) {
                    for (let x = 0; x < grid.width; x++) {
                        if (x >= corner || y >= corner) { b[y * grid.width + x]! += 30; }
                    }
                }
                const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
                for (const c of r.candidates) {
                    if (c.pix.x < corner && c.pix.y < corner && Math.hypot(corner - c.pix.x, corner - c.pix.y) * grid.pixelArcsec <= 30) {
                        seen++;
                        if (c.reading !== 'unclear') { directed++; }
                    }
                }
            }
        }
        expect(seen).toBeGreaterThan(0);
        expect(directed).toBe(0);
    });
    it('rounds catalogue facts outward only beyond the match radius', () => {
        const a = noise(grid), b = noise(grid); point(b, grid, 60, 60, 1000);
        const bare = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates[0]!;
        for (const [d, printed] of [[6.04, '6.1'], [6.10, '6.1'], [6.41, '6.4'], [8.01, '8.0'], [10.001, '10.0'],
            [14.91, '14.9'], [14.96, '15.0'], [6, '6.0'], [5.96, '6.0']] as const) {
            const star = { x: bare.pix.x + d / grid.pixelArcsec, y: bare.pix.y };
            const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [star], { plain: true }).candidates[0]!;
            expect(c.sentence).toBe(`Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate). A catalogue star lies ${printed}″ away.`);
        }
    });
    it('includes catalogue facts at 14.5 arcseconds but not 15.5', () => {
        const a = noise(grid), b = noise(grid); point(b, grid, 60, 60, 1000);
        const bare = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates[0]!;
        for (const [d, fact] of [[14.5, ' A catalogue star lies 14.5″ away.'], [15.0001, ''], [15.5, '']] as const) {
            const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid,
                [{ x: bare.pix.x + d / grid.pixelArcsec, y: bare.pix.y }], { plain: true }).candidates[0]!;
            expect(c.sentence).toBe(`Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate).${fact}`);
        }
    });
    it('counts only listed unmapped spots in the S/N note', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 30, 30, 100); point(b, grid, 90, 90, 1000);
        const va = new Float32Array(a.length).fill(1), vb = new Float32Array(a.length).fill(1);
        va[90 * grid.width + 90] = NaN;
        const r = compareVisits({ ...image(a, 'a'), variance: va }, { ...image(b, 'b'), variance: vb }, grid, [], { plain: true, maxCandidates: 1 });
        expect(r.candidates).toHaveLength(1);
        expect(r.notes.filter(n => n.startsWith('S/N is left out'))).toEqual([]);
    });
    it('leaves direction unclear when the centre pixel opposes the core', () => {
        const a = noise(grid), b = noise(grid); point(b, grid, 60, 60, 1000);
        b[60 * grid.width + 60] = a[60 * grid.width + 60]! - 10;
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .find(item => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 2)!;
        expect(c.reading).toBe('unclear');
        expect(c.sentence).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate).');
    });
    it('reads a fading source through a larger positive sky offset', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 100); point(b, grid, 60, 60, 70);
        for (let i = 0; i < b.length; i++) { b[i]! += 50; }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .find(item => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 2)!;
        expect(c.reading).toBe('lessLater');
        expect(c.sentence).toBe(`Measured against the change in the sky around it, there is less light here in the later visit than in the earlier one; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (${snrText(c.snr)}; candidate).`);
    });
    it('leaves direction unclear when the twelve-arcsecond sum loses the core signal', () => {
        const a = noise(grid), b = noise(grid), core: number[] = [], outer: number[] = [];
        for (let y = 52; y <= 68; y++) {
            for (let x = 52; x <= 68; x++) {
                const d = Math.hypot(x - 60, y - 60) * grid.pixelArcsec;
                if (d <= 6) { core.push(y * grid.width + x); }
                else if (d <= 12) { outer.push(y * grid.width + x); }
            }
        }
        for (const i of core) { b[i]! += 1000 / core.length; }
        for (const i of outer) { b[i]! -= 600 / outer.length; }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .find(item => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 2)!;
        expect(c.reading).toBe('unclear');
        expect(c.sentence).toBe(`The light here differs between the two visits, and which visit has more is not clear; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (${snrText(c.snr)}; candidate).`);
    });
    it('uses the nearest centre pixel for a spot at x point six', () => {
        const a = noise(grid), b = noise(grid); point(b, grid, 60.6, 60, 1000);
        b[60 * grid.width + 61] = a[60 * grid.width + 61]! - 10;
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .find(item => Math.hypot(item.pix.x - 60.6, item.pix.y - 60) < 2)!;
        expect(Math.round(c.pix.x)).toBe(61);
        expect(Math.floor(c.pix.x)).toBe(60);
        expect(c.reading).toBe('unclear');
        expect(c.sentence).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate).');
    });
    it('leaves a heavily cancelled twelve-arcsecond sum unclear', () => {
        const a = noise(grid), b = noise(grid), core: number[] = [], outer: number[] = [];
        for (let y = 52; y <= 68; y++) {
            for (let x = 52; x <= 68; x++) {
                const d = Math.hypot(x - 60, y - 60) * grid.pixelArcsec;
                if (d <= 6) { core.push(y * grid.width + x); }
                else if (d <= 12) { outer.push(y * grid.width + x); }
            }
        }
        for (const i of core) { a[i] = 0; b[i] = outer.length; }
        for (const i of outer) { a[i] = 0; b[i] = -core.length; }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .find(item => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 2)!;
        expect(c.reading).toBe('unclear');
        expect(c.sentence).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate).');
    });
    it('prints the missing-pixels fact once without a gap fact', () => {
        const a = noise(grid), b = noise(grid); point(b, grid, 60, 60, 1000);
        for (let y = 54; y <= 66; y++) { for (let x = 64; x <= 72; x++) { a[y * grid.width + x] = NaN; } }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .find(item => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 4)!;
        expect(c.nearMissing).toBe(true);
        expect(c.nearGap).toBe(false);
        expect(c.sentence).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate). Pixels at or near it are missing in at least one visit.');
    });
    it('leaves direction unclear when fewer than twenty ring pixels are usable', () => {
        const a = noise(grid), b = noise(grid); point(b, grid, 60, 60, 1000);
        for (let y = 38; y <= 82; y++) {
            for (let x = 38; x <= 82; x++) {
                const d = Math.hypot(x - 60, y - 60) * grid.pixelArcsec;
                if (d >= 17 && d <= 31) { a[y * grid.width + x] = NaN; }
            }
        }
        const c = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates
            .find(item => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 2)!;
        expect(c.reading).toBe('unclear');
    });
    it('plain wording has no banned terms across all readings and notes', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 25, 25, 1000); point(a, grid, 95, 25, 1000); point(b, grid, 60, 90, 1000);
        a[90 * grid.width + 64] = NaN;
        const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
        expect(r.candidates.map(c => c.reading).sort()).toEqual(['lessLater', 'moreLater', 'unclear']);
        expect(r.notes[0]).toBe(PLAIN_LEAD);
        for (const s of [PLAIN_LEAD, ...r.notes, ...r.candidates.flatMap(c => [c.sentence!, c.neutral!])]) {
            expect(s.replace('a small patch of sky that changed', '')).not.toMatch(/\b(changed|discover\w*|detected|confirm\w*|proves?|mover|moved|consistent)\b/i);
        }
    });
    it('plain direction is unclear with missing wing pixels in either visit', () => {
        for (const reverse of [false, true]) {
            const a = new Float32Array(grid.width * grid.height), b = new Float32Array(a.length);
            for (let y = 0; y < grid.height; y++) {
                for (let x = 0; x < grid.width; x++) {
                    const d2 = ((x - 60) ** 2 + (y - 60) ** 2) * grid.pixelArcsec ** 2;
                    a[y * grid.width + x] = 3000 * Math.exp(-4 * Math.log(2) * d2 / 12 ** 2);
                    b[y * grid.width + x] = 3570 * Math.exp(-4 * Math.log(2) * d2 / 11 ** 2);
                }
            }
            for (let y = 57; y <= 63; y++) { a[y * grid.width + 66] = NaN; }
            const r = compareVisits(mapped(image(reverse ? b : a, 'a')), mapped(image(reverse ? a : b, 'b')), grid, [], { plain: true });
            const spot = r.candidates.find(c => Math.hypot(c.pix.x - 60, c.pix.y - 60) < 2)!;
            expect(spot.reading).toBe('unclear');
            expect(spot.sentence).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate). Pixels at or near it are missing in at least one visit.');
            seed = 918273;
            const c = noise(grid), d = noise(grid);
            point(d, grid, 60, 60, 1000);
            c[60 * grid.width + 64] = NaN;
            const hole = compareVisits(mapped(image(reverse ? d : c, 'a')), mapped(image(reverse ? c : d, 'b')), grid, [], { plain: true }).candidates
                .find(item => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 2)!;
            expect(hole.reading).toBe('unclear');
            expect(hole.sentence).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate). Pixels at or near it are missing in at least one visit.');
        }
    });
    it('plain direction rejects a ring cancelling more than half the core in either sign', () => {
        for (const sign of [1, -1]) {
            for (const ring of [400, 600]) {
                seed = 918273;
                const a = noise(grid), b = noise(grid);
                const core: number[] = [], outer: number[] = [];
                for (let y = 52; y <= 68; y++) {
                    for (let x = 52; x <= 68; x++) {
                        const d = Math.hypot(x - 60, y - 60) * grid.pixelArcsec;
                        if (d <= 6) { core.push(y * grid.width + x); }
                        else if (d <= 12) { outer.push(y * grid.width + x); }
                    }
                }
                for (const i of core) { b[i]! += sign * 1000 / core.length; }
                for (const i of outer) { b[i]! -= sign * ring / outer.length; }
                const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
                const c = r.candidates.find(item => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 2)!;
                expect(c.reading).toBe(ring === 600 ? 'unclear' : sign === 1 ? 'moreLater' : 'lessLater');
                expect(c.sentence).toBe(`${ring === 600 ? 'The light here differs between the two visits, and which visit has more is not clear' : `Measured against the change in the sky around it, there is ${sign === 1 ? 'more' : 'less'} light here in the later visit than in the earlier one`}; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (${snrText(c.snr)}; candidate).`);
            }
        }
    });
    it('plain order note describes a list with no S/N figures', () => {
        const a = noise(grid), b = noise(grid); point(b, grid, 60, 60, 1000);
        const va = new Float32Array(a.length).fill(1), vb = new Float32Array(a.length).fill(1);
        va[60 * grid.width + 60] = NaN;
        const r = compareVisits({ ...image(a, 'a'), variance: va }, { ...image(b, 'b'), variance: vb }, grid, [], { plain: true });
        expect(r.notes.find(n => n.startsWith('Listed with'))).toBe('Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise estimated from the difference image; that figure is used only for this order.');
    });
    it('plain list makes equal-flux changing image widths unclear in either direction', () => {
        for (const reverse of [false, true]) {
            const a = new Float32Array(grid.width * grid.height), b = new Float32Array(a.length);
            for (let y = 0; y < grid.height; y++) {
                for (let x = 0; x < grid.width; x++) {
                    const d2 = ((x - 60) ** 2 + (y - 60) ** 2) * grid.pixelArcsec ** 2;
                    a[y * grid.width + x] = 3000 * Math.exp(-4 * Math.log(2) * d2 / 12 ** 2);
                    b[y * grid.width + x] = 3570 * Math.exp(-4 * Math.log(2) * d2 / 11 ** 2);
                }
            }
            const r = compareVisits(mapped(image(reverse ? b : a, 'a')), mapped(image(reverse ? a : b, 'b')), grid, [], { plain: true });
            const spot = r.candidates.find((c) => Math.hypot(c.pix.x - 60, c.pix.y - 60) < 1)!;
            expect(spot.reading, JSON.stringify(r.candidates)).toBe('unclear');
            expect(spot.sentence).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate).');
        }
    });
    it('plain list orders mapped spots ahead of stronger unmapped spots before the limit', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 30, 30, 100); point(b, grid, 90, 90, 1000);
        const va = new Float32Array(a.length).fill(1), vb = new Float32Array(a.length).fill(1);
        va[90 * grid.width + 90] = NaN;
        const r = compareVisits({ ...image(a, 'a'), variance: va }, { ...image(b, 'b'), variance: vb }, grid, [], { plain: true, maxCandidates: 1 });
        expect(r.candidates[0]!.pix.x).toBeLessThan(50);
        expect(r.candidates[0]!.sentence!.includes('S/N')).toBe(true);
    });
    it('plain direction ignores a uniform sky offset and shows a new source', () => {
        for (const fading of [true, false]) {
            seed = 918273;
            const a = noise(grid), b = noise(grid);
            if (fading) { point(a, grid, 60, 60, 1000); point(b, grid, 60, 60, 300); }
            else { point(b, grid, 60, 60, 1000); }
            for (let i = 0; i < b.length; i++) { b[i]! += 50; }
            const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
            const c = r.candidates.find((item) => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 3)!;
            expect(c.reading).toBe(fading ? 'lessLater' : 'moreLater');
            expect(c.sentence).toBe(`Measured against the change in the sky around it, there is ${fading ? 'less' : 'more'} light here in the later visit than in the earlier one; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate).`);
        }
    });
    it('plain direction is unclear when finite visit pixels overflow their difference', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 1000);
        a[60 * grid.width + 66] = -3.4e38;
        b[60 * grid.width + 66] = 3.4e38;
        const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
        const spot = r.candidates.find((c) => Math.hypot(c.pix.x - 60, c.pix.y - 60) < 3)!;
        expect(spot.reading).toBe('unclear');
    });
    it('plain order note accounts for uncovered spots', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 30, 30, 100); point(b, grid, 90, 90, 1000);
        const va = new Float32Array(a.length).fill(1), vb = new Float32Array(a.length).fill(1);
        va[90 * grid.width + 90] = NaN;
        const r = compareVisits({ ...image(a, 'a'), variance: va }, { ...image(b, 'b'), variance: vb }, grid, [], { plain: true });
        expect(r.candidates[0]!.sentence!.includes('S/N')).toBe(true);
        expect(r.notes.find((n) => n.startsWith('Listed with'))).toBe('Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise; within each group, spots with no S/N figure come after those with one.');
        expect(r.notes[0]).toBe('Every spot listed is a candidate only; this page cannot tell which, if any, are real changes in the sky.');
    });
    it('plain star facts extend to 15 arcseconds without changing grouping', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 1000);
        const bare = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true }).candidates[0]!;
        for (const d of [0.99, 1, 6.5]) {
            const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [{ x: bare.pix.x + (d + 1e-10) / grid.pixelArcsec, y: bare.pix.y }], { plain: true });
            const c = r.candidates.find((item) => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 3)!;
            expect(c.nearCatalogue).toBe(d <= 6);
            expect(c.sentence).toBe(`Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate). A catalogue star lies ${d < 1 ? 'less than 1″' : `${d.toFixed(1)}″`} away.`);
        }
        const far = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid,
            [{ x: bare.pix.x + 16 / grid.pixelArcsec, y: bare.pix.y }], { plain: true, matchArcsec: 20 });
        expect(far.candidates[0]!.nearCatalogue).toBe(true);
        expect(far.candidates[0]!.sentence).toBe('Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate).');
    });
    it('plain wavelengths use displayed precision and explain incompatible visits', () => {
        const a = noise(grid), b = noise(grid);
        const same = compareVisits(image(a, 'a', 60000, 4.5941), image(b, 'b', 60010, 4.5944), grid, [], { plain: true });
        expect(same.notes[0]).toBe('Earlier visit at 4.594 µm, later at 4.594 µm.');
        const apart = compareVisits(image(a, 'a', 60000, 2), image(b, 'b', 60010, 2.03), grid, [], { plain: true });
        expect(apart.notes[1]).toBe('The two visits were not compared: their wavelengths differ by more than 0.02 µm.');
        const different = compareVisits(image(a, 'a', 60000, 2), image(b, 'b', 60010, 2.01), grid, [], { plain: true });
        expect(different.notes[0]).toBe('Earlier visit at 2.000 µm, later at 2.010 µm. A source can read differently at different wavelengths.');
        expect(same.notes.some((n) => n.startsWith('Listed with'))).toBe(false);
    });
    it('plain notes use the requested small-change and shift wording', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 200); point(b, grid, 60, 60, 210);
        const small = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60 }], { plain: true, minFracChange: 0.07 });
        expect(small.notes.find((n) => n.startsWith('1 small difference'))).toBe('1 small difference at a catalogue star is not listed.');
        seed = 918273;
        const c = noise(grid), d = noise(grid), p = grid.pixelArcsec;
        const x1 = 60 - 2 / p, x2 = 60 + 2 / p;
        point(c, grid, x1, 60, 1000); point(c, grid, x2, 60, 100);
        point(d, grid, x1 + 1.4 / p, 60, 1000); point(d, grid, x2 + 1.4 / p, 60, 100);
        const shift = compareVisits(image(c, 'a'), image(d, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }], { plain: true, minShiftArcsec: 0.1 });
        expect(shift.notes.find((n) => n.startsWith('2 spots'))).toBe('2 spots that a shift of up to 1.5″ between the two pictures can explain are not listed.');
    });
    it('plain note uses the singular shift wording', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2, p = grid.pixelArcsec;
        const second = x + 7 / p;
        point(a, grid, x, y, 100); point(a, grid, second, y, 70);
        point(b, grid, x + 0.8 / p, y, 100); point(b, grid, second, y, 70);
        a[60 * grid.width + Math.floor(x) + 1] = NaN;
        a[60 * grid.width + Math.floor(second) + 1] = NaN;
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 'a' }, { x: second, y, id: 'b' }], { plain: true });
        expect(r.notes.find((n) => n.startsWith('1 spot that'))).toBe('1 spot that a shift of up to 1.5″ between the two pictures can explain is not listed.');
    });
    it('plain note uses the plural catalogue small-change wording', () => {
        const a = noise(grid), b = noise(grid);
        for (const x of [30, 90]) { point(a, grid, x, 60, 200); point(b, grid, x, 60, 210); }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 30, y: 60 }, { x: 90, y: 60 }], { plain: true, minFracChange: 0.07 });
        expect(r.notes.find((n) => n.startsWith('2 small differences'))).toBe('2 small differences at catalogue stars are not listed.');
    });
    it('plain list retains the finder caution for a nearby block of missing pixels', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 1000);
        for (let y = 54; y <= 66; y++) { for (let x = 70; x <= 77; x++) { a[y * grid.width + x] = NaN; } }
        const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
        const c = r.candidates.find((item) => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 3)!;
        expect(c).toMatchObject({ nearGap: true, nearEdge: false, nearMissing: false });
        expect(c.sentence).toBe('Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate). It is close to pixels that could not be compared, or to the edge of the picture.');
    });
    it('plain gap fact remains true when finite visit pixels overflow their difference', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 1000);
        for (let y = 54; y <= 66; y++) {
            for (let x = 70; x <= 77; x++) { a[y * grid.width + x] = -3.4e38; b[y * grid.width + x] = 3.4e38; }
        }
        const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
        const c = r.candidates.find(item => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 3)!;
        expect(c).toMatchObject({ nearGap: true, nearEdge: false, nearMissing: false });
        expect(c.sentence).toBe('Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate). It is close to pixels that could not be compared, or to the edge of the picture.');
    });
    it('plain list marks bottom and right picture edges', () => {
        for (const [x, y] of [[60, 116], [116, 60]]) {
            seed = 918273;
            const a = noise(grid), b = noise(grid);
            point(b, grid, x!, y!, 1000);
            const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
            const c = r.candidates.find((item) => Math.hypot(item.pix.x - x!, item.pix.y - y!) < 4)!;
            expect(c.nearEdge).toBe(true);
            expect(c.sentence).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate). It is near the edge of the picture.');
        }
    });
    it('plain list omits S/N for a map hole beyond the source aperture', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 1000);
        const va = new Float32Array(a.length).fill(1), vb = new Float32Array(a.length).fill(1);
        va[60 * grid.width + 69] = NaN;
        const r = compareVisits({ ...image(a, 'a'), variance: va }, { ...image(b, 'b'), variance: vb }, grid, [], { plain: true });
        const c = r.candidates.find((item) => Math.hypot(item.pix.x - 60, item.pix.y - 60) < 3)!;
        expect(c.sentence).toBe('Measured against the change in the sky around it, there is more light here in the later visit than in the earlier one; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (candidate).');
        expect(c.neutral).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (candidate).');
    });
    it('plain pair ends retain their own different S/N figures', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 50, 60, 120); point(b, grid, 50 + 8 / grid.pixelArcsec, 60, 35);
        const full = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, []);
        const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { plain: true });
        expect(full.candidates.some((c) => c.ends.length === 2)).toBe(true);
        expect(r.candidates).toHaveLength(2);
        expect(Math.abs(r.candidates[0]!.snr - r.candidates[1]!.snr)).toBeGreaterThan(1);
        expect(snrText(r.candidates[0]!.snr)).not.toBe(snrText(r.candidates[1]!.snr));
        for (const c of r.candidates) {
            expect(c.sentence).toBe(`${c.reading === 'unclear' ? 'The light here differs between the two visits, and which visit has more is not clear' : `Measured against the change in the sky around it, there is ${c.reading === 'moreLater' ? 'more' : 'less'} light here in the later visit than in the earlier one`}; a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (${snrText(c.snr)}; candidate).`);
        }
    });
    it('plain list prints a spot shared by two classifier candidates once', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 1000);
        point(b, grid, 48, 60, 700); point(b, grid, 72, 60, 700);
        const opts = { dipoleArcsec: 1, minFracChange: 0 };
        const full = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], opts);
        const ends = full.candidates.flatMap((c) => c.ends.map((e) => `${e.x},${e.y}`));
        expect(new Set(ends).size).toBeLessThan(ends.length);
        const plain = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, [], { ...opts, plain: true });
        expect(plain.candidates.length).toBe(new Set(ends).size);
        expect(new Set(plain.candidates.map((c) => `${c.pix.x},${c.pix.y}`)).size).toBe(plain.candidates.length);
    });
    it('keeps uncatalogued opposite brightness swaps as pairs', () => {
        for (const separation of [6, 9, 12]) {
            seed = 918273;
            const a = noise(grid), b = noise(grid), x = 57, dx = separation / grid.pixelArcsec;
            point(a, grid, x, 60, 300); point(a, grid, x + dx, 60, 30);
            point(b, grid, x, 60, 30); point(b, grid, x + dx, 60, 300);
            const result = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
            console.log('swap', separation, result.candidates.map((c) => `${c.kind}/${c.reading}: ${c.sentence}`));
            expect(result.candidates).toHaveLength(1);
            expect(result.candidates[0]).toMatchObject({ kind: 'unknown', reading: 'pair' });
            expect(result.candidates[0]!.sentence).toMatch(/^Two nearby spots changed in opposite ways; one source that moved, two sources changing/);
        }
    });
    it('reports catalogue proximity at either pair end', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 53, 60, 300); point(b, grid, 60, 60, 300);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 53, y: 60, id: 'early' }]);
        expect(r.candidates[0]).toMatchObject({ reading: 'pair', nearCatalogue: true });
        const other = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(other.candidates[0]).toMatchObject({ reading: 'pair', nearCatalogue: false });
    });
    it('notes when no pixels overlap and when wavelengths are unknown', () => {
        const a = noise(grid), b = noise(grid);
        a.fill(NaN);
        const noOverlap = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(noOverlap.notes).toContain('The two visits do not overlap here, so nothing was compared.');
        expect(noOverlap.candidates).toHaveLength(0);
        const unknown = compareVisits(image(a, 'a', 60000, NaN), image(b, 'b', 60010, NaN), grid, []);
        expect(unknown.notes.join(' ')).toMatch(/wavelength.*unknown/i);
        expect(unknown.notes.join(' ')).not.toContain('0 frames skipped');
    });
    it('reports an unknown wavelength without a zero-frame skip', () => {
        const r = compareVisits({ ...image(noise(grid), 'a', 60000, NaN), obsIds: [] },
            { ...image(noise(grid), 'b', 60010, NaN), obsIds: [] }, grid, []);
        expect(r.notes.join(' ')).toMatch(/wavelength.*unknown/i);
        expect(r.notes.join(' ')).not.toContain('0 frames skipped');
    });
    it('reports untimed frames in the track path without calling them missing templates', () => {
        const visit = [frame(noise(grid), grid, 'bad', NaN)];
        const r = findTracklets(visit, [frame(noise(grid), grid, 'template', 60000)], grid, []);
        expect(r.notes).toContain('1 frame without a time was left out.');
        expect(r.skipped).toHaveLength(0);
    });
    it('notes when no complete noise bins can be compared', () => {
        const a = noise(grid), b = noise(grid);
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x += 2) { a[y * grid.width + x] = NaN; }
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.notes).toContain('Not enough overlapping image pixels to compare the visits.');
        expect(r.candidates).toHaveLength(0);
        expect(r.notes.join(' ')).not.toMatch(/NaN|Infinity|undefined/);
    });
    it('does not give a blank-centre note if only one visit has a central source', () => {
        for (const later of [false, true]) {
            seed = 918273;
            const a = noise(grid), b = noise(grid);
            point(later ? b : a, grid, 60, 60, 100);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [], { threshold: 1e9 });
            expect(r.notes.join(' ')).not.toContain('No source above 5 times the noise');
        }
    });
    it('avoids a single-frame-hit hedge if both visits have at least three frames', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 500); point(b, grid, 60, 60, 800);
        const r = compareVisits({ ...image(a, 'a'), obsIds: ['a1', 'a2', 'a3'] },
            { ...image(b, 'b'), obsIds: ['b1', 'b2', 'b3'] }, grid, [{ x: 60, y: 60, id: 'star' }]);
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(r.candidates[0]!.sentence).not.toMatch(/single-frame hit|hit in one visit/);
        expect(r.candidates[0]!.caveat).toBeUndefined();
    });
    it('prints a catalogue-predicted motion and gives both endpoints', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 57, 60, 3000); point(b, grid, 63, 60, 3000);
        const stars = [{ x: 57, y: 60, id: 's', visit: 'earlier' as const, properMotion: true },
            { x: 63, y: 60, id: 's', visit: 'later' as const, properMotion: true }];
        const r = compareVisits(image(a, 'a'), image(b, 'b', 60365.25), grid, stars);
        const c = r.candidates.find((item) => item.kind === 'mover');
        console.log('r11 mover:', JSON.stringify(c));
        expect(c?.sentence).toMatch(/listed motion of about 9″ between these dates/);
        expect(c?.sentence).toMatch(/two changing sources.*image shift.*detector hits/i);
        expect(c).toMatchObject({ reading: 'moved', ends: [{ visit: 'earlier' }, { visit: 'later' }] });
        expect(c?.caveat).toContain('fewer than 3 frames');
    });
    it('does not match the wrong direction or an unrelated catalogue motion', () => {
        for (const [first, last] of [[63, 57], [37, 43]] as const) {
            seed = 918273;
            const a = noise(grid), b = noise(grid);
            point(a, grid, 57, 60, 300); point(b, grid, 63, 60, 300);
            const stars = [{ x: first, y: 60, id: 's', visit: 'earlier' as const, properMotion: true },
                { x: last, y: 60, id: 's', visit: 'later' as const, properMotion: true }];
            const r = compareVisits(image(a, 'a'), image(b, 'b', 60365.25), grid, stars);
            expect(r.candidates.some((candidate) => candidate.kind === 'mover')).toBe(false);
        }
    });
    it('keeps a weak two-ended reading as unknown', () => {
        const results: { amplitude: number; kind: string; sentence: string }[] = [];
        for (const amplitude of [5, 7, 10, 15, 20, 25, 30, 50, 100]) {
            seed = 918273;
            const a = noise(grid), b = noise(grid);
            point(a, grid, 57, 60, amplitude); point(b, grid, 63, 60, amplitude);
            const stars = [{ x: 57, y: 60, id: 's', visit: 'earlier' as const, properMotion: true },
                { x: 63, y: 60, id: 's', visit: 'later' as const, properMotion: true }];
            const r = compareVisits(image(a, 'a'), image(b, 'b', 60365.25), grid, stars);
            results.push(...r.candidates.filter((c) => c.ends.length === 2).map((c) => ({ amplitude, kind: c.kind, sentence: c.sentence })));
        }
        console.log('r11 floor:', JSON.stringify(results));
        expect(results.some((c) => c.kind === 'unknown')).toBe(true);
        expect(results.some((c) => c.kind === 'mover')).toBe(true);
    });
    it('keeps the Barnard-shaped source with and without a later catalogue position', () => {
        for (const both of [false, true]) {
            const a = noise(grid), b = noise(grid), x = 57, y = 60, moved = 10.3 / grid.pixelArcsec;
            point(a, grid, x, y, 3000); point(b, grid, x + moved, y, 3000);
            const stars = [{ x, y, id: 'barnard', visit: 'earlier' as const, properMotion: both },
                ...(both ? [{ x: x + moved, y, id: 'barnard', visit: 'later' as const, properMotion: true }] : [])];
            const r = compareVisits(image(a, 'a', 60000), image(b, 'b', 60365.25), grid, stars);
            console.log('r11 Barnard', both, JSON.stringify(r.candidates));
            expect(r.candidates).toHaveLength(1);
            expect(r.candidates[0]).toMatchObject({ reading: both ? 'moved' : 'pair', kind: both ? 'mover' : 'unknown' });
            expect(r.candidates[0]!.sentence).toMatch(both ? /listed motion of about 10″/ : /^Two nearby spots changed in opposite ways/);
        }
    });
    it('lets a tight catalogue motion win over crowding, and hedges it (Barnard at 4.6 µm)', () => {
        // Barnard's Star in the partner band had 4 more catalogue stars within 24″ of its earlier lobe, so the pair
        // was sent to "Opposite changes ..." before its 10.3″ listed motion was looked at.
        const P = grid.pixelArcsec, x = 57, y = 60, moved = 10.3 / P;
        const others = [{ x: x - 10 / P, y: y + 8 / P, id: 'n1' }, { x: x - 6 / P, y: y - 14 / P, id: 'n2' },
            { x: x + 4 / P, y: y + 16 / P, id: 'n3' }, { x: x - 16 / P, y: y - 2 / P, id: 'n4' }];
        const run = (offset: number) => {
            const a = noise(grid), b = noise(grid);
            point(a, grid, x, y, 3000); point(b, grid, x + moved, y, 3000);
            for (const o of others) { point(a, grid, o.x, o.y, 20); point(b, grid, o.x, o.y, 20); }
            const stars = [...others, { x, y: y + offset / P, id: 'gj699', visit: 'earlier' as const, properMotion: true },
                { x: x + moved, y: y + offset / P, id: 'gj699', visit: 'later' as const, properMotion: true }];
            return compareVisits(mapped(image(a, 'a', 60000)), mapped(image(b, 'b', 60365.25)), grid, stars);
        };
        const tight = run(0).candidates;
        expect(tight).toHaveLength(1);
        expect(tight[0]).toMatchObject({ kind: 'mover', reading: 'moved' });
        expect(tight[0]!.sentence).toMatch(/^A catalogue star has a listed motion of about 10″ between these dates/);
        expect(tight[0]!.sentence).toContain('other catalogue stars close by make it less certain');
        // Dated positions 9″ off both lobes: the loose 12″ match still predicts it, but crowding keeps it unknown.
        const loose = run(9).candidates;
        expect(loose.some((c) => c.kind === 'mover')).toBe(false);
        expect(loose.length).toBeGreaterThan(0);
    });
    it('does not let an unseen motion star claim a catalogued stationary swap in a crowded field (Codex r11c)', () => {
        const P = grid.pixelArcsec, x = 55, y = 60, sep = 9 / P;
        const a = noise(grid), b = noise(grid);
        point(a, grid, x, y, 3000); point(a, grid, x + sep, y, 30);
        point(b, grid, x, y, 30); point(b, grid, x + sep, y, 3000);
        const others = [{ x: x - 10 / P, y: y + 8 / P, id: 'n1' }, { x: x - 6 / P, y: y - 14 / P, id: 'n2' },
            { x: x + 4 / P, y: y + 16 / P, id: 'n3' }, { x: x - 16 / P, y: y - 2 / P, id: 'n4' }];
        for (const o of others) { point(a, grid, o.x, o.y, 20); point(b, grid, o.x, o.y, 20); }
        for (const near of [7, 2]) {
            const stars = [...others, { x, y, id: 'steady' },
                { x, y: y + near / P, id: 'pm', visit: 'earlier' as const, properMotion: true },
                { x: x + sep, y: y + near / P, id: 'pm', visit: 'later' as const, properMotion: true }];
            const r = compareVisits(mapped(image(a, 'a', 60000)), mapped(image(b, 'b', 60365.25)), grid, stars);
            expect(r.candidates.some((c) => c.kind === 'mover'), `${near}: ${JSON.stringify(r.candidates.map((c) => c.sentence))}`).toBe(false);
        }
    });
    it('plain list: one candidate per spot with the fixed sentence, no pair, mover or separation', () => {
        const P = grid.pixelArcsec, a = noise(grid), b = noise(grid);
        point(a, grid, 50, 60, 300); point(b, grid, 50 + 8 / P, 60, 300);
        const full = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b', 60200)), grid, []);
        const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b', 60200)), grid, [], { plain: true });
        expect(full.candidates.length).toBe(1);
        expect(r.candidates.map((c) => c.reading).sort()).toEqual(['lessLater', 'moreLater']);
        for (const c of r.candidates) {
            expect(c.kind).toBe('unknown');
            expect(c.ends).toHaveLength(1);
            expect(c.ends[0]).toMatchObject({ visit: c.reading === 'moreLater' ? 'later' : 'earlier', x: c.pix.x, y: c.pix.y });
            expect(c.lightVisit).toBe(c.ends[0]!.visit);
            expect(c.sentence).toBe(`Measured against the change in the sky around it, there is ${c.reading === 'moreLater' ? 'more' : 'less'} light here in the later visit than in the earlier one; `
                + `a change in a source's brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate).`);
            expect(c.reason).toBe(c.sentence);
            expect(c).toMatchObject({ nearCatalogue: false, nearEdge: false, nearMissing: false });
        }
        expect(new Set(r.candidates.map((c) => `${c.pix.x},${c.pix.y}`)).size).toBe(r.candidates.length);
        expect(r.notes.join(' ')).not.toContain('Catalogue stars have no ids');
        expect(r.notes.find((n) => n.startsWith('Listed with'))).toBe('Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise.');
    });
    it('plain list: visit-matched catalogue lookup, order and the no-map order note', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 30, 30, 1000); point(b, grid, 30, 30, 2000);       // catalogue star, strong
        point(b, grid, 90, 90, 60);                                       // uncatalogued, weaker
        point(a, grid, 30, 90, 300);                                      // earlier light under a later-only entry
        const stars = [{ x: 30, y: 30, id: 's' }, { x: 30, y: 90, id: 'pm', visit: 'later' as const, properMotion: true }];
        const r = compareVisits(image(a, 'a'), image(b, 'b', 60200), grid, stars, { plain: true });
        const at = (x: number, y: number) => r.candidates.find((c) => Math.hypot(c.pix.x - x, c.pix.y - y) < 3);
        expect(at(30, 30)).toMatchObject({ reading: 'moreLater', nearCatalogue: true });
        expect(at(30, 30)!.catalogueArcsec).toBeLessThan(1);
        expect(at(30, 30)!.sentence).toMatch(/\(candidate\)\. A catalogue star lies less than 1″ away\.$/);
        expect(at(90, 90)).toMatchObject({ reading: 'moreLater', nearCatalogue: false });
        // The only entry near (30, 90) is the later-visit position; the light there is in the earlier visit.
        expect(at(30, 90)).toMatchObject({ reading: 'lessLater', nearCatalogue: false });
        const order = r.candidates.map((c) => c.nearCatalogue);
        expect(order).toEqual([...order].sort((x, y) => Number(x) - Number(y)));
        expect(r.candidates.indexOf(at(90, 90)!)).toBeLessThan(r.candidates.indexOf(at(30, 30)!));
        expect(r.notes.find((n) => n.startsWith('Listed with'))).toBe('Listed with spots that have no catalogue star within 6″ first, then by how far each stands out from the noise estimated from the difference image; that figure is used only for this order.');
        for (const c of r.candidates) {
            expect(c.sentence).not.toMatch(/S\/N/);
        }
    });
    it('plain list: edge and missing-pixel lookups', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 5, 60, 300);
        point(b, grid, 60, 60, 300);
        for (let y = 63; y < 66; y++) { for (let x = 60; x < 63; x++) { a[y * grid.width + x] = NaN; } }
        const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b', 60200)), grid, [], { plain: true });
        const edge = r.candidates.find((c) => c.pix.x < 12);
        const hole = r.candidates.find((c) => Math.hypot(c.pix.x - 60, c.pix.y - 60) < 3);
        expect(edge).toMatchObject({ nearEdge: true });
        expect(edge!.sentence).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate). It is near the edge of the picture.');
        expect(hole).toMatchObject({ nearMissing: true, nearEdge: false });
        expect(hole!.sentence).toBe('The light here differs between the two visits, and which visit has more is not clear; a change in a source\'s brightness, a moving source, a small patch of sky that changed, a detector hit, a sharper star image in one visit or a small shift between the two pictures could cause this (S/N > 50; candidate). Pixels at or near it are missing in at least one visit.');
    });
    it('prints S/N only where both error maps cover the spot (Opus r11), in plain and full mode', () => {
        for (const plain of [false, true]) {
            const a = noise(grid), b = noise(grid);
            point(b, grid, 30, 30, 1000); point(b, grid, 90, 90, 1000);
            const va = new Float32Array(a.length).fill(1), vb = new Float32Array(b.length).fill(1);
            for (let y = 80; y < 100; y++) { for (let x = 80; x < 100; x++) { va[y * grid.width + x] = NaN; } }
            const r = compareVisits({ ...image(a, 'a'), variance: va }, { ...image(b, 'b', 60200), variance: vb }, grid, [], { plain });
            const covered = r.candidates.find((c) => Math.hypot(c.pix.x - 30, c.pix.y - 30) < 3)!;
            const hole = r.candidates.find((c) => Math.hypot(c.pix.x - 90, c.pix.y - 90) < 3)!;
            expect(covered.sentence, `${plain}`).toMatch(/\(S\/N > 50; candidate\)/);
            expect(hole.sentence, `${plain}`).not.toMatch(/S\/N/);
            expect(r.notes).toContain('S/N is left out for 1 candidate where the frames\' error maps have no value, because the noise there comes from the difference image alone.');
        }
    });
    it('prints no S/N when the maps have holes around the spot but not at its centre (Codex r11p)', () => {
        for (const plain of [false, true]) {
            const a = noise(grid), b = noise(grid);
            point(b, grid, 60, 60, 1000);
            const va = new Float32Array(a.length).fill(1), vb = new Float32Array(b.length).fill(1);
            // One NaN in every 4x4 bin around the spot, none at the spot's own pixel.
            for (let y = 44; y < 77; y += 4) { for (let x = 44; x < 77; x += 4) { if (x !== 60 || y !== 60) { va[y * grid.width + x] = NaN; } } }
            const r = compareVisits({ ...image(a, 'a'), variance: va }, { ...image(b, 'b', 60200), variance: vb }, grid, [], { plain });
            const c = r.candidates.find((k) => Math.hypot(k.pix.x - 60, k.pix.y - 60) < 3)!;
            expect(c, `${plain}`).toBeDefined();
            expect(c.sentence, `${plain}`).not.toMatch(/S\/N/);
        }
    });
    it('never prints S/N 50.0 below the > 50 form', () => {
        expect(snrText(49.96)).toBe('S/N 49.9');
        expect(snrText(50)).toBe('S/N 50.0');
        expect(snrText(50.01)).toBe('S/N > 50');
        expect(snrText(5.04)).toBe('S/N 5.0');
    });
    it('prints no separation for an uncatalogued opposite pair at 8″ and 9″', () => {
        for (const sep of [8, 9]) {
            for (const swap of [false, true]) {
                const a = noise(grid), b = noise(grid), P = grid.pixelArcsec, x = 55;
                if (swap) {
                    point(a, grid, x, 60, 300); point(a, grid, x + sep / P, 60, 30);
                    point(b, grid, x, 60, 30); point(b, grid, x + sep / P, 60, 300);
                } else {
                    point(a, grid, x, 60, 300); point(b, grid, x + sep / P, 60, 300);
                }
                const r = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b', 60200)), grid, []);
                const pair = r.candidates.find((c) => c.reading === 'pair');
                expect(pair, `${sep} ${swap}`).toBeDefined();
                expect(pair!.kind).toBe('unknown');
                expect(pair!.sentence).toMatch(/^Two nearby spots changed in opposite ways; one source that moved, two sources changing, or a small image shift could look like this \(S\/N/);
                expect(pair!.sentence).not.toMatch(/\d″/);
            }
        }
    });
    it('describes later-only and earlier-only light above noise', () => {
        for (const later of [true, false]) {
            const a = noise(grid), b = noise(grid);
            point(later ? b : a, grid, 60, 60, 100);
            const c = compareVisits(image(a, 'a'), image(b, 'b'), grid, []).candidates[0]!;
            console.log('r11 one visit:', c?.sentence);
            expect(c.sentence).toContain(later ? 'earlier visit shows none above its noise' : 'later visit shows none above its noise');
            expect(c).toMatchObject({ reading: later ? 'laterOnly' : 'earlierOnly', ends: [{ visit: later ? 'later' : 'earlier' }] });
        }
    });
    it('limits plain brightness kinds and warns for two-frame visits', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 100); point(b, grid, 60, 60, 200);
        const earlier = { ...image(a, 'a'), obsIds: ['a', 'a2'] };
        const later = { ...image(b, 'b'), obsIds: ['b', 'b2', 'b3'] };
        const c = compareVisits(earlier, later, grid, [{ x: 60, y: 60, id: 'star' }]).candidates[0]!;
        console.log('r11 brightness:', JSON.stringify(c));
        expect(c.kind).toBe('unknown');
        expect(c.sentence).toMatch(/hit in one visit|sharper image/);
        expect(c.caveat).toBe('The earlier visit has fewer than 3 frames, so a detector hit cannot be ruled out.');
        expect(c.reading).toBe('brighter');
    });
    it('distinguishes a missing centre from the image edge', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 57, 60, 3000); point(b, grid, 57 + 10.3 / grid.pixelArcsec, 60, 3000);
        for (let y = 58; y <= 62; y++) {
            for (let x = 55; x <= 59; x++) { a[y * grid.width + x] = NaN; }
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        console.log('r11 blank core:', JSON.stringify(r.candidates));
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(r.candidates.every((c) => !c.sentence.includes('image edge'))).toBe(true);
        expect(r.candidates.some((c) => c.sentence.includes('missing image pixels'))).toBe(true);
    });
    it('labels a pair once and includes the image-shift alternative', () => {
        const a = noise(grid), b = noise(grid), x1 = 56, x2 = 64;
        point(a, grid, x1, 60, 2000); point(a, grid, x2, 60, 2000);
        point(b, grid, x1, 60, 800); point(b, grid, x2, 60, 3200);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
        console.log('r11 pair:', JSON.stringify(r.candidates));
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0]).toMatchObject({ reading: 'pair', ends: [{ visit: 'earlier' }, { visit: 'later' }] });
        expect(r.candidates[0]!.sentence).toMatch(/image shift/);
    });
    it('explains opposite peaks caused by a small image shift', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 3000); point(b, grid, 60 + 1.7 / grid.pixelArcsec, 60, 3000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        console.log('r11 shift:', JSON.stringify(r.candidates));
        const pair = r.candidates.find((c) => c.sentence.startsWith('Two close spots'));
        expect(pair?.sentence).toMatch(/a small shift of one source/);
        expect(pair?.sentence).not.toMatch(/\d″/);
    });
    it('names visit wavelengths and excludes central candidates from the blank note', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 8);
        const r = compareVisits(image(a, 'a', 60000, 2), image(b, 'b', 60001, 2.01), grid, []);
        console.log('r11 notes:', r.notes, r.candidates.map((c) => c.sentence));
        expect(r.notes.join(' ')).toContain('Earlier visit at 2.000 µm, later at 2.010 µm.');
        expect(r.notes.join(' ')).toContain('A source can read differently at different wavelengths');
        expect(r.notes.join(' ')).not.toMatch(/No source above 5 times the noise/);
    });
    it('does not render non-finite S/N and shows it once in candidate sentences', () => {
        expect(snrText(NaN)).toBe('S/N not measured');
        expect(snrText(Infinity)).toBe('S/N not measured');
        for (const mode of ['later', 'earlier', 'moved', 'pair']) {
            const a = noise(grid), b = noise(grid);
            if (mode === 'earlier' || mode === 'moved' || mode === 'pair') { point(a, grid, 57, 60, 100); }
            if (mode === 'later' || mode === 'moved' || mode === 'pair') { point(b, grid, 63, 60, 100); }
            for (const c of compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, []).candidates) {
                expect(c.sentence.match(/S\/N/g), `${mode}: ${c.sentence}`).toHaveLength(1);
            }
        }
    });
    it('puts exactly one S/N in every candidate sentence template', () => {
        const text = readFileSync(`${process.cwd()}/src/lib/changes.ts`, 'utf8');
        const assignments = [...text.matchAll(/c\.reason\s*=\s*([\s\S]*?);\s*\n/g)].map((match) => match[1]!);
        expect(assignments.length).toBeGreaterThan(15);
        // finish() writes `c.reason = c.sentence` after taking the S/N out when no error map was used.
        for (const assignment of assignments.filter((a) => a !== 'c.sentence')) {
            const endings = assignment.match(/; candidate\)/g) ?? [];
            expect(endings.length, assignment).toBeGreaterThan(0);
            expect(assignment.match(/snrText\(/g), assignment).toHaveLength(endings.length);
            expect(assignment, assignment).not.toMatch(/S\/N/);
        }
        expect(text).not.toMatch(/c\.reason\s*\+=/);
        expect(text).toMatch(/reason: `The two visits differ here \(\$\{snrText\(blob\.snr\)\}; candidate\)\.`/);
    });
});

let seed = 918273;
function random(): number
{
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
}

function noise(g: OutputGrid): Float32Array
{
    const nw = Math.ceil(g.width / 4) + 1, nh = Math.ceil(g.height / 4) + 1;
    const native = new Float32Array(nw * nh);
    for (let i = 0; i < native.length; i += 2) {
        const r = Math.sqrt(-2 * Math.log(random())), t = 2 * Math.PI * random();
        native[i] = r * Math.cos(t);
        if (i + 1 < native.length) {
            native[i + 1] = r * Math.sin(t);
        }
    }
    const out = new Float32Array(g.width * g.height);
    for (let y = 0; y < g.height; y++) {
        for (let x = 0; x < g.width; x++) {
            const ix = Math.floor(x / 4), iy = Math.floor(y / 4), fx = x / 4 - ix, fy = y / 4 - iy;
            out[y * g.width + x] = (1 - fy) * ((1 - fx) * native[iy * nw + ix]! + fx * native[iy * nw + ix + 1]!)
                + fy * ((1 - fx) * native[(iy + 1) * nw + ix]! + fx * native[(iy + 1) * nw + ix + 1]!);
        }
    }
    return out;
}

function point(data: Float32Array, g: OutputGrid, x: number, y: number, amplitude: number, fwhm = 12): void
{
    const s = fwhm / 2.35482 / g.pixelArcsec;
    for (let j = Math.max(0, Math.floor(y - 4 * s)); j <= Math.min(g.height - 1, Math.ceil(y + 4 * s)); j++) {
        for (let i = Math.max(0, Math.floor(x - 4 * s)); i <= Math.min(g.width - 1, Math.ceil(x + 4 * s)); i++) {
            data[j * g.width + i]! += amplitude * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (2 * s * s));
        }
    }
}

function staticSky(a: Float32Array, b: Float32Array, g: OutputGrid): void
{
    for (let i = 0; i < 60;) {
        const x = 10 + random() * (g.width - 20), y = 10 + random() * (g.height - 20);
        if (Math.hypot(x - g.width / 2, y - g.height / 2) < 15) {
            continue;
        }
        i++;
        const amplitude = 3 + random() * 8;
        point(a, g, x, y, amplitude);
        point(b, g, x, y, amplitude);
    }
}

function injectSnr(a: Float32Array, b: Float32Array, g: OutputGrid, x: number, y: number, snr: number): void
{
    const diff = new Float32Array(a.length);
    for (let i = 0; i < diff.length; i++) {
        diff[i] = b[i]! - a[i]!;
    }
    const { sigma, k } = significance(diff, g);
    const signal = new Float32Array(a.length);
    point(signal, g, x, y, 1);
    let peak = 0;
    for (let by = Math.max(0, Math.floor(y / k) - 4); by <= Math.min(Math.floor((g.height - 1) / k), Math.floor(y / k) + 4); by++) {
        for (let bx = Math.max(0, Math.floor(x / k) - 4); bx <= Math.min(Math.floor((g.width - 1) / k), Math.floor(x / k) + 4); bx++) {
            let sum = 0, n = 0;
            for (let j = by * k; j < Math.min((by + 1) * k, g.height); j++) {
                for (let i = bx * k; i < Math.min((bx + 1) * k, g.width); i++) {
                    sum += signal[j * g.width + i]!;
                    n++;
                }
            }
            peak = Math.max(peak, sum / n);
        }
    }
    point(b, g, x, y, snr * sigma / peak);
}

function image(data: Float32Array, id: string, mjd = 60000, lambda = 2)
{
    return { data, lambda, mjd, obsIds: [id] };
}

// The test noise has unit variance per output pixel, so a map of ones is the correct error map.
function mapped<T extends { data: Float32Array }>(img: T): T & { variance: Float32Array }
{
    return { ...img, variance: new Float32Array(img.data.length).fill(1) };
}

function frame(data: Float32Array, g: OutputGrid, id: string, mjd: number, lambda = 2): RegriddedFrame
{
    const record: FrameRecord = { obsId: id, collection: 'spherex_dr1', release: 'dr1', detector: 1,
        url: '', tMin: mjd, tMax: mjd, lambdaMin: 1, lambdaMax: 3 };
    return { data, frame: record, grid: g, lambdaAtCenter: lambda, bandwidthAtCenter: 0.1 };
}

function near(x: number, y: number, a: { pix: { x: number; y: number } }, radius = 3): boolean
{
    return Math.hypot(a.pix.x - x, a.pix.y - y) * grid.pixelArcsec < radius;
}

describe('change finder', () => {
    beforeEach(() => { seed = 918273; });
    it('keeps opposite changes on distinct catalogue stars', () => {
        for (const separation of [4, 6]) {
            for (const fraction of [0.6, 0.9]) {
                for (const ids of [false, true]) {
                    const a = noise(grid), b = noise(grid);
                    const x1 = 60 - separation / 2, x2 = 60 + separation / 2;
                    point(a, grid, x1, 60, 2000); point(a, grid, x2, 60, 2000);
                    point(b, grid, x1, 60, 2000 * (1 - fraction));
                    point(b, grid, x2, 60, 2000 * (1 + fraction));
                    const stars = [{ x: x1, y: 60, ...(ids ? { id: 'a' } : {}) },
                        { x: x2, y: 60, ...(ids ? { id: 'b' } : {}) }];
                    const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
                    const label = `${separation} px, ${fraction}, ids ${ids}`;
                    if (ids) {
                        expect(r.candidates.filter((c) => c.kind === 'mover'), label).toHaveLength(0);
                        // Round 6: two stars changing the opposite way and a source moving between them look the
                        // same here, so the finder says either/or and quotes no percentage.
                        expect(r.candidates.length, label).toBeGreaterThan(0);
                        expect(r.candidates.every((c) => !/\d\s*%/.test(c.reason)), label).toBe(true);
                        expect(r.candidates.every((c) => c.kind === 'unknown'
                            && /^Either a source moved|either both stars changed, a source moved between them|could not be measured/
                                .test(c.reason)), label).toBe(true);
                        if (r.candidates.length === 2) {
                            expect(r.candidates.map((c) => c.sign).sort(), label).toEqual([-1, 1]);
                        }
                    } else {
                        // Without ids two stars cannot always be told from one moving star; the result must say so.
                        expect(r.candidates.length, label).toBeGreaterThan(0);
                        expect(r.notes.join(' '), label).toMatch(/no ids.*look like one mover/);
                    }
                }
            }
        }
    });

    it('does not label edge wobble as an uncatalogued source', () => {
        for (const x of [10, 14, 18]) {
            for (const amplitude of [300, 1000, 3000]) {
                const a = noise(grid), b = noise(grid);
                point(a, grid, x, 60, amplitude);
                point(b, grid, x - 1.4 / grid.pixelArcsec, 60, amplitude);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y: 60 }]);
                expect(r.candidates.some((c) => c.reason.includes('no catalogue star here'))).toBe(false);
            }
        }
    });

    it('reports nonfinite wavelengths as unknown', () => {
        const a = noise(grid), b = noise(grid);
        for (const lambda of [NaN, Infinity]) {
            expect(compareVisits(image(a, 'a', 60000, lambda), image(b, 'b'), grid, []).notes.join(' '))
                .toMatch(/Earlier visit at unknown/);
        }
    });

    it('reports a single variance map accurately', () => {
        const a = noise(grid), b = noise(grid);
        const one = compareVisits({ ...image(a, 'a'), variance: new Float32Array(a.length) }, image(b, 'b'), grid, []);
        expect(one.notes.join(' ')).toMatch(/error map on only one visit; noise from the difference image only/i);
    });

    it('identifies a malformed variance input', () => {
        const a = noise(grid), b = noise(grid);
        expect(() => compareVisits({ ...image(a, 'a'), variance: new Float32Array(2) },
            { ...image(b, 'b'), variance: new Float32Array(b.length) }, grid, [])).toThrow(/variance/i);
        expect(() => compareVisits({ ...image(a, 'a'), variance: new Float32Array(2) },
            image(b, 'b'), grid, [])).toThrow(/variance/i);
    });
    it('rejects sub-threshold catalogue wobble as a mover', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 2000);
        point(b, grid, 60 + 0.5 / grid.pixelArcsec, 60, 2000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60 }]);
        expect(r.candidates.some((c) => c.kind === 'mover')).toBe(false);
    });

    it('does not pair small changes on different catalogue stars', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 57, 60, 2000); point(a, grid, 63, 60, 2000);
        point(b, grid, 57, 60, 1990); point(b, grid, 63, 60, 2010);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 57, y: 60 }, { x: 63, y: 60 }]);
        expect(r.candidates.some((c) => c.kind === 'mover')).toBe(false);
    });

    it('ignores invalid catalogue coordinates', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 30); point(b, grid, 60, 60, 50);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: NaN, y: 0 }, { x: 60, y: 60 }]);
        expect(r.candidates[0]?.gaiaMatch).toBe(true);
    });

    it('reports wavelengths and single-frame limitations', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 1000);
        const r = compareVisits(mapped(image(a, 'a', 60000, 2.001)), mapped(image(b, 'b', 60001, 2.002)), grid, []);
        expect(r.notes.join(' ')).toMatch(/2\.001.*2\.002.*µm/);
        expect(r.notes.join(' ')).not.toContain('each visit is one frame; artefacts not ruled out');
        expect(r.candidates[0]?.caveat).toBe('Each visit has fewer than 3 frames, so a detector hit cannot be ruled out.');
        expect(r.candidates[0]?.reason).toContain('S/N > 50');
        expect(r.candidates[0]?.reason).toContain('Light here in the later visit; the earlier visit shows none above its noise');
    });

    it('does not make a track from a stationary source (finding 4)', () => {
        const template = noise(grid);
        const visit = [0, 2.1, 4.2, 6.3].map((minutes, i) => {
            const data = noise(grid); point(data, grid, 60, 60, 30);
            return frame(data, grid, `v${i}`, 60010 + minutes / 1440);
        });
        expect(findTracklets(visit, [frame(template, grid, 't', 60000)], grid, []).candidates).toHaveLength(0);
    });

    it('does not count a repeated observation as a new frame (finding 6)', () => {
        const template = noise(grid);
        const visit = [0, 20, 40].map((minutes, i) => {
            const data = noise(grid);
            injectSnr(template, data, grid, 40 + i * 15, 60, 30);
            return frame(data, grid, `v${i}`, 60010 + minutes / 1440);
        });
        const t = [frame(template, grid, 't', 60000)];
        expect(findTracklets(visit, t, grid, []).candidates.filter((c) => c.kind === 'mover')).toHaveLength(1);
        const repeated = findTracklets([visit[0]!, visit[1]!, visit[1]!], t, grid, []);
        expect(repeated.candidates).toHaveLength(0);
        const sameTime = findTracklets([visit[0]!, visit[1]!, { ...visit[2]!, frame: { ...visit[2]!.frame,
            tMin: visit[1]!.frame.tMin, tMax: visit[1]!.frame.tMax } }], t, grid, []);
        expect(sameTime.candidates).toHaveLength(0);
    });

    it('notes that tracklets need at least 3 frames (finding 15)', () => {
        const template = noise(grid);
        const visit = [0, 2.1].map((minutes, i) => frame(noise(grid), grid, `v${i}`, 60010 + minutes / 1440));
        const r = findTracklets(visit, [frame(template, grid, 't', 60000)], grid, []);
        expect(r.candidates).toHaveLength(0);
        expect(r.notes.join(' ')).toMatch(/at least 3 frames/);
    });

    it('never reports a brightness change whose sign disagrees with the spot (finding 5)', () => {
        // The core fades but a ring of light inside the aperture adds more: the spot is negative, the flux grows.
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 2000); point(b, grid, 60, 60, 1500);
        for (let q = 0; q < 12; q++) {
            point(b, grid, 60 + 6 * Math.cos(q * Math.PI / 6), 60 + 6 * Math.sin(q * Math.PI / 6), 100);
        }
        const r = compareVisits(image(a, 'a'), { ...image(b, 'b'), obsIds: ['b', 'b2'] }, grid, [{ x: 60, y: 60 }]);
        expect(r.candidates.some((c) => c.ends.some((end) => end.visit === 'earlier'))).toBe(true);
        expect(r.candidates.every((c) => c.kind === 'unknown')).toBe(true);
        for (const c of r.candidates) {
            expect(c.sign === -1 && /^A catalogue star here reads brighter/.test(c.reason)).toBe(false);
            expect(c.sign === 1 && /^A catalogue star here reads fainter/.test(c.reason)).toBe(false);
        }
    });

    it('says a new source appeared (finding 14)', () => {
        const a = noise(grid), b = noise(grid);
        injectSnr(a, b, grid, 60, 60, 20);
        const r = compareVisits({ ...image(a, 'a'), obsIds: ['a', 'a2'] }, { ...image(b, 'b'), obsIds: ['b', 'b2'] }, grid, []);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0]!.reason).toContain('Light here in the later visit; the earlier visit shows none above its noise');
        expect(r.candidates[0]!.reason).not.toMatch(/could not be measured/);
        expect(r.candidates[0]!.reason).not.toContain('artefacts not ruled out');
    });

    it('writes S/N > 50 in every kind of reason (finding 9)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 30, 30, 200); point(b, grid, 30, 30, 120);           // fade, catalogue star
        point(a, grid, 90, 30, 300); point(b, grid, 96, 30, 300);           // mover, 9″
        point(b, grid, 60, 90, 300);                                         // appeared
        // A5: the mover's two date entries have one id; distinct stars without ids are now ambiguous.
        const stars = [{ x: 30, y: 30, id: 'fade' },
            { x: 90, y: 30, id: 'm', visit: 'earlier' as const, properMotion: true },
            { x: 96, y: 30, id: 'm', visit: 'later' as const, properMotion: true }];
        const r = compareVisits(mapped({ ...image(a, 'a'), obsIds: ['a', 'a2'] }), mapped({ ...image(b, 'b', 60500), obsIds: ['b', 'b2'] }), grid, stars);
        const g = { ...grid, width: 241, height: 241 };
        const template = noise(g);
        const visit = [0, 20, 40, 60].map((minutes, i) => {
            const data = noise(g);
            injectSnr(template, data, g, 60 + 80 * (minutes / 60) / g.pixelArcsec, 120, 80);
            return frame(data, g, `v${i}`, 60010 + minutes / 1440);
        });
        const t = findTracklets(visit, [frame(template, g, 't', 60000)], g, []);
        const all = [...r.candidates, ...t.candidates];
        const kinds = new Set(all.filter((c) => c.snr > 50).map((c) => c.kind + (c.track ? '-track' : '')));
        expect([...kinds].sort()).toEqual(['mover', 'mover-track', 'unknown']);
        for (const c of r.candidates.filter((c) => c.snr > 50)) {
            expect(c.reason.match(/S\/N/g)).toHaveLength(1);
            expect(c.reason).toContain('S/N > 50');
            expect(c.reason).not.toMatch(/S\/N (5\d|[6-9]\d|\d{3,})/);
        }
        // Track spots are measured against difference-image noise only, so their text carries no S/N (item F).
        for (const c of t.candidates) {
            expect(c.reason).not.toMatch(/S\/N/);
            expect(c.reason).toMatch(/\(candidate\)\.$/);
        }
    });

    it('prints no S/N when the noise came from the difference image alone (item F)', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 1000);                                       // later only
        point(a, grid, 30, 30, 300); point(b, grid, 30, 30, 120);           // fade
        point(a, grid, 90, 30, 300); point(b, grid, 96, 30, 300);           // pair
        const none = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        const oneMap = compareVisits(mapped(image(a, 'a')), image(b, 'b'), grid, []);
        const both = compareVisits(mapped(image(a, 'a')), mapped(image(b, 'b')), grid, []);
        for (const r of [none, oneMap]) {
            expect(r.candidates.length).toBeGreaterThan(1);
            for (const c of r.candidates) {
                expect(c.sentence, c.sentence).not.toMatch(/S\/N/);
                expect(c.reason).toBe(c.sentence);
                expect(c.sentence).toMatch(/\(candidate\)\.$/);
                expect(c.caveat ?? '').not.toMatch(/S\/N/);
                expect(Number.isFinite(c.snr)).toBe(true);
            }
            expect(r.notes.filter((n) => n.includes(NO_SNR_NOTE))).toHaveLength(1);
            expect(r.notes.join(' ')).toMatch(/noise from the difference image only/i);
        }
        expect(both.candidates.length).toBeGreaterThan(1);
        for (const c of both.candidates) {
            expect(c.sentence.match(/S\/N/g), c.sentence).toHaveLength(1);
        }
        expect(both.notes.join(' ')).not.toContain(NO_SNR_NOTE);
    });

    it('ranks catalogue stars above unmatched spots when each visit is one frame (finding 10)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 30, 60, 40); point(b, grid, 30, 60, 40);
        injectSnr(a, b, grid, 30, 60, 10);
        injectSnr(a, b, grid, 90, 60, 30);
        const one = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 30, y: 60 }]);
        expect(one.candidates.map((c) => c.gaiaMatch)).toEqual([true, false]);
        expect(one.candidates[0]!.snr).toBeLessThan(one.candidates[1]!.snr);
        const many = compareVisits({ ...image(a, 'a'), obsIds: ['a', 'a2'] }, { ...image(b, 'b'), obsIds: ['b', 'b2'] }, grid, [{ x: 30, y: 60 }]);
        expect(many.candidates.map((c) => c.gaiaMatch)).toEqual([false, true]);
    });

    it('keeps random one-frame clutter from linking into tracks (finding 8)', () => {
        const g = { ...grid, width: 241, height: 241 };
        for (const cadence of [[0, 2.1, 98, 100.1], [0, 2.1, 4.2, 6.3]]) {
        let tracks = 0;
        for (let v = 0; v < 20; v++) {
            const template = noise(g);
            const visit = cadence.map((minutes, i) => {
                const data = noise(g);
                for (let j = 0; j < 20; j++) {
                    injectSnr(template, data, g, 15 + random() * (g.width - 30), 15 + random() * (g.height - 30), 6 + random() * 10);
                }
                return frame(data, g, `v${v}-${i}`, 60010 + v + minutes / 1440);
            });
            tracks += findTracklets(visit, [frame(template, g, `t${v}`, 60000)], g, []).candidates.length;
        }
        console.log(`Clutter: ${tracks / 20} false tracklets per visit (20 spots per frame, 20 visits, frames at ${cadence.join(', ')} min)`);
        expect(tracks / 20).toBeLessThanOrEqual(0.1);
        }
    }, 60000);

    it('suppresses false detections in a small noisy patch when error maps are given', () => {
        // Review finding 3: a 37″ patch with 5x noise is smaller than a noise tile. Only the frames' own
        // error maps can see it; without them the module says so in its notes.
        const variance = new Float32Array(grid.width * grid.height).fill(1);
        for (let y = 48; y <= 71; y++) {
            for (let x = 48; x <= 71; x++) {
                variance[y * grid.width + x] = 25;
            }
        }
        let count = 0;
        let blind = 0;
        let understated = 0;
        const falseMovers = [0, 0, 0];
        // Right shape but the patch at half its true noise (a uniform map is rescaled and acts like no map).
        const lowVariance = new Float32Array(grid.width * grid.height).fill(1);
        for (let y = 48; y <= 71; y++) {
            for (let x = 48; x <= 71; x++) {
                lowVariance[y * grid.width + x] = 6.25;
            }
        }
        for (let trial = 0; trial < 30; trial++) {
            const a = noise(grid), b = noise(grid);
            for (let y = 48; y <= 71; y++) {
                for (let x = 48; x <= 71; x++) {
                    a[y * grid.width + x]! *= 5; b[y * grid.width + x]! *= 5;
                }
            }
            const correct = compareVisits({ ...image(a, 'a'), variance }, { ...image(b, 'b'), variance }, grid, []);
            count += correct.candidates.length;
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
            blind += r.candidates.length;
            const low = compareVisits({ ...image(a, 'a'), variance: lowVariance },
                { ...image(b, 'b'), variance: lowVariance }, grid, []);
            understated += low.candidates.length;
            [correct, r, low].forEach((result, i) => { falseMovers[i]! += result.candidates.filter((c) => c.kind === 'mover').length; });
        }
        console.log(`Noisy patch, 30 trials: ${count} correct map, ${blind} no map, ${understated} understated map`);
        console.log(`False movers, 30 patches (correct/no/low map): ${falseMovers.join('/')}`);
        expect(count).toBeLessThanOrEqual(1);
        // Without error maps the noise comes from the difference alone; a 37″ patch at 5x noise is close in size
        // to a cluster of real faint changes. The one-sided window estimate cuts 67 to 14; error maps cut it to 0.
        expect(blind).toBeLessThanOrEqual(20);
        // A map with the right shape but half the patch's noise still helps: 5 here against 18 without a map.
        expect(understated).toBeLessThanOrEqual(8);
    });

    it('keeps sensitivity with flat error maps', () => {
        const variance = new Float32Array(grid.width * grid.height).fill(1);
        let recovered = 0;
        for (let i = 0; i < 20; i++) {
            const a = noise(grid), b = noise(grid);
            const x = 35 + (i % 5) * 12, y = 35 + Math.floor(i / 5) * 12;
            injectSnr(a, b, grid, x, y, 10);
            const r = compareVisits({ ...image(a, 'a'), variance }, { ...image(b, 'b'), variance }, grid, []);
            if (r.candidates.some((c) => near(x, y, c, 6))) {
                recovered++;
            }
        }
        expect(recovered).toBeGreaterThanOrEqual(18);
    });

    it('reports a small-change count without a cutoff percentage', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 200); point(b, grid, 60, 60, 210);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60 }], { minFracChange: 0.07 });
        expect(r.notes.join(' ')).toContain('1 small difference at catalogue stars is not listed.');
        expect(r.notes.join(' ')).not.toContain('%');
    });

    it('limits the number of spots used for track linking', () => {
        const g = { ...grid, width: 361, height: 361 };
        const template = noise(g);
        const visit = [0, 20, 40].map((minutes, i) => {
            const data = noise(g);
            for (let j = 0; j < 20; j++) {
                point(data, g, 30 + (j % 5) * 65, 30 + Math.floor(j / 5) * 90, 50 + j);
            }
            return frame(data, g, `v${i}`, 60010 + minutes / 1440);
        });
        const r = findTracklets(visit, [frame(template, g, 't', 60000)], g, [], { maxSpotsPerFrame: 3 });
        expect(r.notes.join(' ')).toMatch(/spots.*3/i);
        const moving = [0, 20, 40].map((minutes, i) => {
            const data = noise(g);
            for (let j = 0; j < 3; j++) {
                point(data, g, 40 + j * 100, 50, 100);
            }
            point(data, g, 80 + i * 20, 250, 30);
            return frame(data, g, `m${i}`, 60010 + minutes / 1440);
        });
        const capped = findTracklets(moving, [frame(template, g, 't', 60000)], g, [], { maxSpotsPerFrame: 3 });
        expect(capped.candidates.some((c) => c.track?.some((p) => near(80, 250, { pix: p.pix }, 6)))).toBe(false);
        const uncapped = findTracklets(moving, [frame(template, g, 't', 60000)], g, [], { maxSpotsPerFrame: 4 });
        expect(uncapped.candidates.some((c) => c.track?.length === 3)).toBe(true);
    });

    it('links a three-frame mover in a crowded small field', () => {
        let recovered = 0;
        for (let trial = 0; trial < 5; trial++) {
            seed = 918273 + trial;
            const template = noise(grid);
            const visit = [0, 2.1, 4.2].map((minutes, i) => {
                const data = noise(grid);
                // Clutter stays at least 2 FWHM off the mover's row: a spot on top of the mover merges with it
                // into one long blob (a streak), which is a different limit from the one tested here.
                for (let j = 0; j < 5; j++) {
                    const y = 15 + random() * 70;
                    injectSnr(template, data, grid, 15 + random() * 91, y < 44 ? y : y + 32, 6 + random() * 10);
                }
                injectSnr(template, data, grid, 45 + 400 * (minutes / 60) / grid.pixelArcsec, 60, 20);
                return frame(data, grid, `v${i}`, 60010 + minutes / 1440);
            });
            if (findTracklets(visit, [frame(template, grid, 't', 60000)], grid, [])
                .candidates.some((c) => c.track && Math.abs(c.speedArcsecPerHour! - 400) < 80)) {
                recovered++;
            }
        }
        expect(recovered).toBeGreaterThanOrEqual(4);
    });
    it('pairs a mover past a nearer spot that fails the shift test', () => {
        const P = grid.pixelArcsec;
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60 + 13 / P, 60, 300); point(b, grid, 60, 60, 300);
        point(a, grid, 60 - 7 / P, 60, 1000); point(b, grid, 60 - 7 / P, 60, 800);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60 - 7 / P, y: 60, id: 's' }]);
        expect(r.candidates.filter((c) => c.reading === 'pair' && c.kind === 'unknown')).toHaveLength(1);
    });

    it('pairs a mover past a nearer edge spot', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 20, 60, 300); point(b, grid, 12, 60, 300);
        point(a, grid, 5, 60, 1000); point(b, grid, 5, 60, 700);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 5, y: 60, id: 's' }]);
        expect(r.candidates.filter((c) => c.reading === 'pair' && c.kind === 'unknown')).toHaveLength(1);
    });

    it('pairs a catalogue mover with its own entry before a nearer uncatalogued spot', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 66, 60, 400); point(b, grid, 60, 60, 400);
        point(a, grid, 60 - 4.5 / grid.pixelArcsec, 62, 150);
        const r = compareVisits(image(a, 'a'), image(b, 'b', 60500), grid,
            [{ x: 66, y: 60, id: 'm', visit: 'earlier', properMotion: true },
                { x: 60, y: 60, id: 'm', visit: 'later', properMotion: true }]);
        expect(r.candidates.filter((c) => c.kind === 'mover' && c.gaiaMatch)).toHaveLength(1);
    });

    it('never pairs a star that has an id with one that has none', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 57, 60, 2000); point(a, grid, 63, 60, 2000);
        point(b, grid, 57, 60, 200); point(b, grid, 63, 60, 3800);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 57, y: 60, id: 'a' }, { x: 63, y: 60 }]);
        expect(r.candidates.filter((c) => c.kind === 'mover')).toHaveLength(0);
        // Round 6: the pair passes the shift test, so it is one either/or candidate, not a mover.
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0]!.reason).toMatch(/^Either a source moved between two catalogue stars/);
    });

    it('does not quote a fraction diluted by a changing neighbour 12-14 arcsec away', () => {
        for (const separation of [8, 9]) {
            const a = noise(grid), b = noise(grid);
            const x1 = 60 - separation / 2, x2 = 60 + separation / 2;
            point(a, grid, x1, 60, 2000); point(a, grid, x2, 60, 2000);
            point(b, grid, x1, 60, 800); point(b, grid, x2, 60, 3200);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
            expect(r.candidates).toHaveLength(1);
            expect(r.candidates[0]!.ends).toHaveLength(2);
        }
    });

    it('keeps spot positions under a background offset between visits', () => {
        const a = noise(grid), b0 = noise(grid);
        point(b0, grid, 60.3, 60.3, 10);
        const base = compareVisits(image(a, 'a'), image(b0, 'b'), grid, []).candidates[0]!;
        for (const offset of [200, -200]) {
            const r = compareVisits(image(a, 'a'), image(b0.map((v) => v + offset), 'b'), grid, []);
            expect(r.candidates).toHaveLength(1);
            expect(Math.hypot(r.candidates[0]!.pix.x - base.pix.x, r.candidates[0]!.pix.y - base.pix.y) * grid.pixelArcsec).toBeLessThan(0.05);
        }
    });

    it('words a wobble half beside a changed star as part of that star', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 1000); point(b, grid, 60 - 1.4 / grid.pixelArcsec, 60, 1150);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }]);
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(r.candidates.some((c) => /no catalogue star here|appeared|earlier visit shows none above its noise/.test(c.reason))).toBe(false);
    });

    it('keeps a brightening star that also shifts 2.9 arcsec', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 1000); point(b, grid, 60 - 2.9 / grid.pixelArcsec, 60, 1150);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }]);
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(r.candidates.some((c) => /no catalogue star here|appeared|earlier visit shows none above its noise/.test(c.reason))).toBe(false);
    });

    it('makes no brightness claim on a wobbling close pair of steady stars (Opus High 1)', () => {
        const P = grid.pixelArcsec;
        let claims = 0;
        for (const separation of [3, 5, 8]) {
            for (const amplitude of [500, 2000]) {
                for (const angle of [0, Math.PI / 2, Math.PI / 4]) {
                    const a = noise(grid), b = noise(grid);
                    const x1 = 60 - separation / 2 / P, x2 = 60 + separation / 2 / P;
                    const dx = 0.58 * Math.cos(angle) / P, dy = 0.58 * Math.sin(angle) / P;
                    point(a, grid, x1, 60, amplitude); point(a, grid, x2, 60, amplitude * 0.7);
                    point(b, grid, x1 + dx, 60 + dy, amplitude); point(b, grid, x2 + dx, 60 + dy, amplitude * 0.7);
                    claims += compareVisits(image(a, 'a'), image(b, 'b'), grid,
                        [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]).candidates.filter((c) => c.kind !== 'unknown').length;
                }
            }
        }
        expect(claims).toBe(0);
    });

    it('makes few claims in fields of wobbling steady stars with ids (Opus High 1)', () => {
        const P = grid.pixelArcsec;
        let claims = 0;
        for (let field = 0; field < 10; field++) {
            const a = noise(grid), b = noise(grid);
            const t = 2 * Math.PI * random(), dx = 0.58 * Math.cos(t) / P, dy = 0.58 * Math.sin(t) / P;
            const stars = [];
            for (let s = 0; s < 25; s++) {
                const x = 15 + random() * 91, y = 15 + random() * 91, amplitude = 500 + random() * 1500;
                point(a, grid, x, y, amplitude); point(b, grid, x + dx, y + dy, amplitude);
                stars.push({ x, y, id: `s${s}` });
            }
            claims += compareVisits(image(a, 'a'), image(b, 'b'), grid, stars).candidates.filter((c) => c.kind !== 'unknown').length;
        }
        console.log(`Wobbling fields: ${claims} claims in 10 fields of 25 steady stars`);
        expect(claims).toBeLessThanOrEqual(2);
    });

    it('keeps a new source 10-15 arcsec from a wobbling star (Opus High 2)', () => {
        const P = grid.pixelArcsec;
        const missed: string[] = [];
        for (const d of [10, 11, 12, 13, 14, 15]) {
            for (const wobble of [1.0, 1.2, 1.4]) {
                const a = noise(grid), b = noise(grid);
                point(a, grid, 60, 60, 2000); point(b, grid, 60 - wobble / P, 60, 2000);
                point(b, grid, 60 - d / P, 60, 300);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }]);
                if (!r.candidates.some((c) => c.sign === 1 && near(60 - d / P, 60, c, 6))) {
                    missed.push(`${d}″/${wobble}″`);
                }
            }
        }
        expect(missed).toEqual([]);
    });

    it('reports opposite changes on stars 11 arcsec apart (Opus Medium 1)', () => {
        const P = grid.pixelArcsec;
        const missed: string[] = [];
        for (const f of [0.15, 0.2, 0.3]) {
            for (const amplitude of [300, 2000]) {
                const a = noise(grid), b = noise(grid);
                const x1 = 60 - 5.5 / P, x2 = 60 + 5.5 / P;
                point(a, grid, x1, 60, amplitude); point(a, grid, x2, 60, amplitude);
                point(b, grid, x1, 60, amplitude * (1 - f)); point(b, grid, x2, 60, amplitude * (1 + f));
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
                if (r.candidates.length === 0) {
                    missed.push(`${f}/${amplitude}`);
                }
            }
        }
        // A faint 15% pair sits at the floor once the neighbour's wing is counted; at most that one is lost.
        expect(missed.length, missed.join(', ')).toBeLessThanOrEqual(1);
    });

    it('does not turn a mover between two faint catalogue stars into two brightness claims (Opus Medium 2)', () => {
        const P = grid.pixelArcsec;
        for (const amplitude of [100, 200, 300]) {
            const a = noise(grid), b = noise(grid);
            const xa = 60 - 7.5 / P, xb = 60 + 7.5 / P;
            point(a, grid, xa, 60, 50); point(a, grid, xb, 60, 50);
            point(b, grid, xa, 60, 50); point(b, grid, xb, 60, 50);
            point(a, grid, xa + 3 / P, 60, amplitude); point(b, grid, xb - 3 / P, 60, amplitude);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: xa, y: 60, id: 'a' }, { x: xb, y: 60, id: 'b' }]);
            const label = `amplitude ${amplitude}`;
            expect(r.candidates.filter((c) => c.kind === 'brightness'), label).toHaveLength(0);
            expect(r.candidates, label).toHaveLength(1);
        }
    });

    it('does not turn two changing stars into a mover under a background offset', () => {
        for (const offset of [-500, 500]) {
            const a = noise(grid), b = noise(grid);
            point(a, grid, 57, 60, 2000); point(a, grid, 63, 60, 2000);
            point(b, grid, 57, 60, 200); point(b, grid, 63, 60, 3800);
            for (let i = 0; i < b.length; i++) {
                b[i]! += offset;
            }
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 57, y: 60, id: 'a' }, { x: 63, y: 60, id: 'b' }]);
            expect(r.candidates.filter((c) => c.kind === 'mover'), `offset ${offset}`).toHaveLength(0);
        }
    });

    it('keeps a mover that starts near the image edge (Opus Low 1)', () => {
        const P = grid.pixelArcsec;
        const missed: string[] = [];
        for (const x of [6, 8, 10]) {
            for (const move of [8, 12]) {
                const a = noise(grid), b = noise(grid);
                point(a, grid, x, 60, 200); point(b, grid, x + move / P, 60, 200);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
                if (!r.candidates.some((c) => near(x + move / P, 60, c, 4))) {
                    missed.push(`${x} px/${move}″`);
                }
            }
        }
        expect(missed).toEqual([]);
    });

    it('warns that a small noisy patch can give false candidates without error maps (Opus Low 2)', () => {
        const r = compareVisits(image(noise(grid), 'a'), image(noise(grid), 'b'), grid, []);
        expect(r.notes.join(' ')).toMatch(/small patch of extra noise can show up as false/);
    });

    it('never calls two stars changing in opposite ways a mover under wobble, at any PSF width (round 6 item 1)', () => {
        const P = grid.pixelArcsec;
        const movers: string[] = [];
        for (const fwhm of [12, 9, 6]) {
            for (let k = 0; k < 12; k++) {
                const t = k * Math.PI / 6, dx = 1.4 * Math.cos(t) / P, dy = 1.4 * Math.sin(t) / P;
                const a = noise(grid), b = noise(grid);
                const x1 = 60 - 5 / P, x2 = 60 + 5 / P;
                point(a, grid, x1, 60, 2000, fwhm); point(a, grid, x2, 60, 2000, fwhm);
                point(b, grid, x1 + dx, 60 + dy, 200, fwhm); point(b, grid, x2 + dx, 60 + dy, 3800, fwhm);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
                if (r.candidates.some((c) => c.kind === 'mover' || /The light centre here moved/.test(c.reason))) {
                    movers.push(`${fwhm}″/${k * 30}°`);
                }
            }
        }
        expect(movers).toEqual([]);
    });

    it('says either/or for a source passing between two catalogue stars (round 6 item 1)', () => {
        const P = grid.pixelArcsec;
        const a = noise(grid), b = noise(grid);
        const xa = 60 - 7.5 / P, xb = 60 + 7.5 / P;
        point(a, grid, xa, 60, 50); point(a, grid, xb, 60, 50);
        point(b, grid, xa, 60, 50); point(b, grid, xb, 60, 50);
        point(a, grid, xa + 3 / P, 60, 300); point(b, grid, xb - 3 / P, 60, 300);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: xa, y: 60, id: 'a' }, { x: xb, y: 60, id: 'b' }]);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0]!.kind).toBe('unknown');
        expect(r.candidates[0]!.reason).toMatch(/^Either a source moved between two catalogue stars 15\.0″ apart, or one got brighter and the other fainter; a small image shift/);
    });

    it('quotes no percentage for a mover passing 2-4 arcsec off two catalogue stars, off the line (round 6 item 2)', () => {
        const P = grid.pixelArcsec;
        const claims: string[] = [];
        const lost: string[] = [];
        for (const separation of [10, 13, 16]) {
            for (const starAmplitude of [50, 500]) {
                for (const moverAmplitude of [150, 1000, 3000]) {
                    for (const offset of [2, 3, 4]) {
                        const a = noise(grid), b = noise(grid);
                        const xa = 60 - separation / 2 / P, xb = 60 + separation / 2 / P, off = 1 / P;
                        point(a, grid, xa, 60, starAmplitude); point(a, grid, xb, 60, starAmplitude);
                        point(b, grid, xa, 60, starAmplitude); point(b, grid, xb, 60, starAmplitude);
                        point(a, grid, xa + offset / P, 60 + off, moverAmplitude);
                        point(b, grid, xb - offset / P, 60 + off, moverAmplitude);
                        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: xa, y: 60, id: 'a' }, { x: xb, y: 60, id: 'b' }]);
                        if (r.candidates.length === 0) {
                            lost.push(`${separation}″ ${starAmplitude}/${moverAmplitude} ${offset}″`);
                        }
                        for (const c of r.candidates) {
                            if (/\d+% (brighter|fainter)/.test(c.reason) || c.kind === 'mover') {
                                claims.push(`${separation}″ ${starAmplitude}/${moverAmplitude} ${offset}″: ${c.reason}`);
                            }
                        }
                    }
                }
            }
        }
        expect(claims).toEqual([]);
        // Three faint cases have only a 2-4″ displacement: the floor or the allowed 1.5″ translation can
        // explain the remaining spot. Keep their absence bounded while refusing a stronger interpretation.
        expect(lost.length, lost.join(', ')).toBeLessThanOrEqual(3);
    });

    it('quotes no percentage and no "appeared" beside a catalogue star it does not sit on (round 6 item 3)', () => {
        const P = grid.pixelArcsec;
        // At 10″ the star's own wing fills the 12″ aperture and the fade falls under the floor (a miss, not a claim).
        for (const d of [14, 20]) {
            const a = noise(grid), b = noise(grid);
            point(a, grid, 60, 60, 3000); point(b, grid, 60, 60, 3000);
            point(a, grid, 60 + d / P, 60, 300); point(b, grid, 60 + d / P, 60, 150);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }]);
            const spot = r.candidates.filter((c) => near(60 + d / P, 60, c, 6));
            expect(spot, `${d}″`).toHaveLength(1);
            expect(spot[0]!.reason, `${d}″`).not.toMatch(/appeared|earlier visit shows none above its noise|\d+% (brighter|fainter)/);
        }
    });

    it('quotes no percentage off catalogue stars in steady wobbling bright fields (round 6 item 3)', () => {
        const P = grid.pixelArcsec;
        const claims: string[] = [];
        for (let field = 0; field < 20; field++) {
            const a = noise(grid), b = noise(grid);
            const t = 2 * Math.PI * random(), w = 1.0 + 0.4 * random();
            const dx = w * Math.cos(t) / P, dy = w * Math.sin(t) / P;
            const stars = [];
            for (let s = 0; s < 30; s++) {
                const x = 12 + random() * 97, y = 12 + random() * 97;
                const amplitude = s < 3 ? 20000 + random() * 30000 : 300 + random() * 3000;
                point(a, grid, x, y, amplitude); point(b, grid, x + dx, y + dy, amplitude);
                stars.push({ x, y, id: `s${s}` });
            }
            for (const c of compareVisits(image(a, 'a'), image(b, 'b'), grid, stars).candidates) {
                if (!c.gaiaMatch && (/appeared|earlier visit shows none above its noise/.test(c.reason))) {
                    claims.push(`field ${field}: ${c.reason}`);
                }
            }
        }
        expect(claims).toEqual([]);
    });

    it('does not call two stars 5 arcsec apart, one without an id, a mover when they swap brightness (round 6 item 6, sameStar)', () => {
        // Codex round 6: position alone treats the two as one star and the swap passes the shift test.
        const P = grid.pixelArcsec;
        const a = noise(grid), b = noise(grid);
        const x1 = 60 - 2.5 / P, x2 = 60 + 2.5 / P;
        point(a, grid, x1, 60, 2000); point(a, grid, x2, 60, 100);
        point(b, grid, x1, 60, 100); point(b, grid, x2, 60, 2000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60 }]);
        expect(r.candidates.filter((c) => c.kind === 'mover')).toHaveLength(0);
    });

    it('pairs a catalogue mover with its own entry even when a nearer uncatalogued spot also shifts (round 6 item 6, sort)', () => {
        const P = grid.pixelArcsec;
        for (const ux of [9, 10]) {
            const a = noise(grid), b = noise(grid);
            point(a, grid, 60 + 13 / P, 60, 400); point(b, grid, 60, 60, 400);
            point(a, grid, 60 - ux / P, 60, 400);
            const r = compareVisits(image(a, 'a'), image(b, 'b', 60500), grid,
                [{ x: 60 + 13 / P, y: 60, id: 'm', visit: 'earlier', properMotion: true },
                    { x: 60, y: 60, id: 'm', visit: 'later', properMotion: true }]);
            const label = `uncatalogued spot ${ux}″ away`;
            expect(r.candidates.filter((c) => c.kind === 'mover'), label).toHaveLength(1);
            // The uncatalogued spot that vanished is what is left over, not the star's old position.
            expect(r.candidates.some((c) => c.kind !== 'mover' && near(60 - ux / P, 60, c, 4)), label).toBe(true);
            expect(r.candidates.some((c) => c.kind !== 'mover' && near(60 + 13 / P, 60, c, 6)), label).toBe(false);
        }
    });

    it('keeps a new source beside a steady catalogue star', () => {
        const earlier = noise(grid), later = noise(grid);
        point(earlier, grid, 60, 60, 2000);
        point(later, grid, 60, 60, 2000);
        point(later, grid, 60 + 14 / grid.pixelArcsec, 60, 100);
        const result = compareVisits(image(earlier, 'a'), image(later, 'b'), grid, [{ x: 60, y: 60, id: 's1' }]);
        expect(result.candidates.some((c) => c.sign === 1 && near(60 + 14 / grid.pixelArcsec, 60, c))).toBe(true);
    });
    it('hedges a weak change near a much stronger change', () => {
        const earlier = noise(grid), later = noise(grid);
        point(later, grid, 55, 60, 1000);
        point(earlier, grid, 69, 60, 25);
        const result = compareVisits(image(earlier, 'a'), image(later, 'b'), grid, []);
        expect(result.candidates).toHaveLength(2);
        expect(result.candidates.some((c) => c.kind === 'unknown' && /weaker change near a stronger change/.test(c.reason))).toBe(true);
    });

    it('does not quantify a change when the later aperture flux is negative', () => {
        const earlier = noise(grid), later = noise(grid);
        point(earlier, grid, 60, 60, 30);
        point(later, grid, 60, 60, -20);
        const result = compareVisits(image(earlier, 'a'), image(later, 'b'), grid, [{ x: 60, y: 60 }]);
        const change = result.candidates.find((c) => near(60, 60, c));
        expect(change).toBeDefined();
        expect(change!.kind).toBe('unknown');
        expect(change!.reason).toMatch(/^The two visits differ here/);
        expect(change!.caveat).toBe('Each visit has fewer than 3 frames, so a detector hit cannot be ruled out.');
    });

    it('ignores small changes in bright sources and measures substantial changes', () => {
        const earlier = noise(grid), small = noise(grid), large = noise(grid);
        point(earlier, grid, 60, 60, 200);
        point(small, grid, 60, 60, 206);
        point(large, grid, 60, 60, 260);
        const ignored = compareVisits(image(earlier, 'a'), image(small, 'b'), grid, [{ x: 60, y: 60 }]);
        expect(ignored.candidates).toHaveLength(0);
        expect(ignored.rejected.residual).toBeGreaterThanOrEqual(1);
        expect(ignored.notes.join(' ')).toMatch(/small differences? at catalogue stars (is|are) not listed/);
        const kept = compareVisits(image(earlier, 'a'), image(large, 'b'), grid, [{ x: 60, y: 60 }]);
        expect(kept.candidates[0]?.kind).toBe('unknown');
        expect(kept.candidates[0]!.reason).toMatch(/reads brighter in the later visit/);
        const custom = compareVisits(image(earlier, 'a'), image(small, 'b'), grid, [], { minFracChange: 0.01 });
        expect(custom.candidates[0]?.kind).toBe('unknown');
        expect(custom.candidates[0]?.reason).toMatch(/The two visits differ here/);
        const strict = compareVisits(image(earlier, 'a'), image(large, 'b'), grid, [], { minFracChange: 0.4 });
        expect(strict.candidates).toHaveLength(0);
        expect(strict.notes.join(' ')).toMatch(/small differences? (is|are) not listed\./);
    });
    it('rejects malformed image shapes', () => {
        expect(() => significance(new Float32Array(3), grid)).toThrow(/length/i);
        expect(() => compareVisits({ data: new Float32Array(3), lambda: 1, mjd: 1, obsIds: [] },
            { data: new Float32Array(3), lambda: 1, mjd: 2, obsIds: [] }, grid, [])).toThrow(/length/i);
    });

    it('returns no tracks for an empty visit', () => {
        expect(findTracklets([], [], grid, []).candidates).toEqual([]);
    });

    it('finds a brightening, fading, appearance and a dipole', () => {
        const x = 60, y = 60;
        const earlier = noise(grid), later = noise(grid);
        staticSky(earlier, later, grid);
        point(earlier, grid, x, y, 30);
        point(later, grid, x, y, 39);
        let r = compareVisits(image(earlier, 'a'), image(later, 'b'), grid, [{ x, y }]);
        expect(r.candidates.some((c) => ['brightness', 'unknown'].includes(c.kind) && c.sign === 1 && c.gaiaMatch && near(x, y, c))).toBe(true);
        const faded = noise(grid), original = noise(grid);
        staticSky(original, faded, grid);
        point(original, grid, x, y, 30);
        point(faded, grid, x, y, 21);
        r = compareVisits(image(original, 'a'), image(faded, 'b'), grid, [{ x, y }]);
        expect(r.candidates.some((c) => ['brightness', 'unknown'].includes(c.kind) && c.sign === -1 && near(x, y, c))).toBe(true);
        const before = noise(grid), after = noise(grid);
        staticSky(before, after, grid);
        injectSnr(before, after, grid, x, y, 8);
        r = compareVisits(image(before, 'a'), image(after, 'b'), grid, []);
        expect(r.candidates.some((c) => c.kind === 'unknown' && near(x, y, c))).toBe(true);
        const left = noise(grid), right = noise(grid);
        staticSky(left, right, grid);
        point(left, grid, x - 3, y, 30);
        point(right, grid, x + 3, y, 30);
        r = compareVisits(image(left, 'a'), image(right, 'b'), grid, []);
        expect(r.candidates.filter((c) => c.reading === 'pair' && c.kind === 'unknown')).toHaveLength(1);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates.every((c) => !/discover|detected|found an asteroid/i.test(c.reason))).toBe(true);
    });

    it('measures the noise false-alarm rate on 200 independent fields', () => {
        const g = { ...grid, width: 361, height: 361 };
        let count = 0;
        let movers = 0;
        for (let i = 0; i < 200; i++) {
            const r = compareVisits(image(noise(g), 'a'), image(noise(g), 'b'), g, []);
            count += r.candidates.length;
            movers += r.candidates.filter((c) => c.kind === 'mover').length;
        }
        console.log(`False candidates per trial: ${count / 200} (${count}/200)`);
        console.log(`False movers, 200 pure-noise fields: ${movers}`);
        expect(count).toBeLessThanOrEqual(2);
    }, 60000);

    it('measures recovery at five signal strengths', () => {
        const curve: number[] = [];
        for (const snr of [3, 5, 7, 10, 20]) {
            let recovered = 0;
            for (let i = 0; i < 50; i++) {
                const a = noise(grid), b = noise(grid);
                const x = 35 + (i % 5) * 12 + (i % 4), y = 35 + Math.floor(i / 5) * 5;
                staticSky(a, b, grid);
                injectSnr(a, b, grid, x, y, snr);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
                if (r.candidates.some((c) => near(x, y, c, 6))) {
                    recovered++;
                }
            }
            curve.push(recovered / 50);
        }
        console.log(`Recovery (S/N 3, 5, 7, 10, 20): ${curve.join(', ')}`);
        expect(curve[3]).toBeGreaterThanOrEqual(0.9);
        expect(curve[4]).toBeGreaterThanOrEqual(0.98);
    }, 60000);

    it('rejects streaks and skips templates at incompatible wavelengths', () => {
        const a = noise(grid), b = noise(grid);
        for (let x = 40; x <= 80; x++) {
            point(b, grid, x, 60, 1.5);
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.rejected.streaks).toBeGreaterThanOrEqual(1);
        expect(r.candidates).toHaveLength(0);
        const skipped = findTracklets([frame(a, grid, 'visit', 60010, 2.05)], [frame(b, grid, 'template', 60000)], grid, []);
        expect(skipped.skipped[0]?.obsId).toBe('visit');
        expect(skipped.notes.join(' ')).toMatch(/skipped.*0.02/);
        const boundary = findTracklets([frame(a, grid, 'visit', 60010, 2.02)], [frame(b, grid, 'template', 60000)], grid, []);
        expect(boundary.skipped).toHaveLength(0);
        expect(compareVisits(image(a, 'a', 60000, 2), image(b, 'b', 60010, 2.02), grid, []).skipped).toHaveLength(0);
    });

    it('retains sensitivity in a region with lower local noise', () => {
        const g = { ...grid, width: 361, height: 361 };
        const a = noise(g), b = noise(g);
        injectSnr(a, b, g, 45, 180, 10);
        for (let y = 0; y < g.height; y++) {
            for (let x = 0; x < 90; x++) {
                a[y * g.width + x]! *= 0.2;
                b[y * g.width + x]! *= 0.2;
            }
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), g, []);
        expect(r.candidates.some((c) => Math.hypot(c.pix.x - 45, c.pix.y - 180) * g.pixelArcsec < 6)).toBe(true);
    });

    it('preserves sensitivity in one quiet noise tile surrounded by louder tiles', () => {
        const g = { ...grid, width: 361, height: 361 };
        const a = noise(g), b = noise(g);
        injectSnr(a, b, g, 60, 180, 10);
        for (let y = 160; y < 200; y++) {
            for (let x = 40; x < 80; x++) {
                a[y * g.width + x]! *= 0.1;
                b[y * g.width + x]! *= 0.1;
            }
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), g, []);
        expect(r.candidates.some((c) => Math.hypot(c.pix.x - 60, c.pix.y - 180) * g.pixelArcsec < 6)).toBe(true);
    });

    it('links a four-frame track and rejects mismatched grids', () => {
        const g = { ...grid, width: 721, height: 721 };
        const times = [0, 2.1, 98, 100];
        const templateData = noise(g);
        const sky = new Float32Array(g.width * g.height);
        staticSky(sky, new Float32Array(sky.length), g);
        for (let i = 0; i < sky.length; i++) {
            templateData[i]! += sky[i]!;
        }
        const visit = times.map((minutes, i) => {
            const data = noise(g);
            for (let p = 0; p < sky.length; p++) {
                data[p]! += sky[p]!;
            }
            injectSnr(templateData, data, g, 100 + 400 * (minutes / 60) / g.pixelArcsec, 350, 8);
            return frame(data, g, `v${i}`, 60010 + minutes / 1440);
        });
        const templates = [frame(templateData, g, 't0', 60000), frame(noise(g), g, 't1', 60000, 2.01)];
        const r = findTracklets(visit, templates, g, []);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0]?.track).toHaveLength(4);
        expect(r.candidates[0]!.speedArcsecPerHour).toBeGreaterThan(360);
        expect(r.candidates[0]!.speedArcsecPerHour).toBeLessThan(440);
        expect(r.candidates[0]!.paDeg).toBeGreaterThan(265);
        expect(r.candidates[0]!.paDeg).toBeLessThan(275);
        expect(r.candidates[0]!.frames).toContain('t0');
        expect(() => findTracklets(visit, [frame(noise(grid), grid, 'bad', 60000)], g, [])).toThrow(/grid/i);
    }, 30000);

    it('does not link unrelated jumps and masks invalid edges', () => {
        const positions = [[30, 35], [83, 50], [40, 85], [85, 80]];
        const template = noise(grid);
        const visit = positions.map(([x, y], i) => {
            const data = noise(grid);
            injectSnr(template, data, grid, x!, y!, 8);
            return frame(data, grid, `v${i}`, 60010 + i * 0.03);
        });
        const r = findTracklets(visit, [frame(template, grid, 't', 60000)], grid, []);
        expect(r.candidates).toHaveLength(0);
        const a = noise(grid), b = noise(grid);
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < 20; x++) {
                a[y * grid.width + x] = NaN;
            }
        }
        point(b, grid, 23, 60, 30);
        const edge = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(edge.candidates.length).toBeGreaterThan(0);
        expect(edge.candidates.every((c) => c.kind === 'unknown')).toBe(true);
        expect(edge.candidates.some((c) => /image edge|missing image pixels/.test(c.reason))).toBe(true);
        expect([...r.notes, ...edge.notes].every((s) => !/discover|detected|found an asteroid/i.test(s))).toBe(true);
    });

    it('keeps a valid three-frame track when another frame has nearby clutter', () => {
        const g = { ...grid, width: 361, height: 361 };
        const template = noise(g);
        const visit = [0, 20, 40, 60].map((minutes, i) => {
            const data = noise(g);
            const x = 100 + 80 * (minutes / 60) / g.pixelArcsec;
            injectSnr(template, data, g, x, 180 + (i === 1 ? 5 : 0), 30);
            return frame(data, g, `v${i}`, 60010 + minutes / 1440);
        });
        const r = findTracklets(visit, [frame(template, g, 't', 60000)], g, []);
        expect(r.candidates.some((c) => c.track?.length === 3 && !c.frames.includes('v1'))).toBe(true);
    });

    it('still links a real four-frame mover among 20 clutter spots per frame', () => {
        const g = { ...grid, width: 241, height: 241 };
        const template = noise(g);
        const visit = [0, 2.1, 98, 100.1].map((minutes, i) => {
            const data = noise(g);
            for (let j = 0; j < 20; j++) {
                injectSnr(template, data, g, 15 + random() * (g.width - 30), 15 + random() * (g.height - 30), 6 + random() * 10);
            }
            // Brighter than the clutter, so the 15-spot cap keeps it.
            injectSnr(template, data, g, 60 + 100 * (minutes / 60) / g.pixelArcsec, 120, 25);
            return frame(data, g, `v${i}`, 60010 + minutes / 1440);
        });
        const r = findTracklets(visit, [frame(template, g, 't', 60000)], g, []);
        expect(r.notes.join(' ')).toMatch(/at least 4 frames/);
        const movers = r.candidates.filter((c) => c.kind === 'mover');
        expect(movers).toHaveLength(1);
        expect(movers[0]!.track).toHaveLength(4);
        expect(Math.abs(movers[0]!.speedArcsecPerHour! - 100)).toBeLessThan(10);
    });

    for (const spots of [40, 80]) {
        it(`links 24 large frames with ${spots} spots each in under 1.5 s (finding 12)`, () => {
            const g = { ...grid, width: 721, height: 721 };
            const template = noise(g);
            const visit = Array.from({ length: 24 }, (_, i) => {
                const data = noise(g);
                for (let j = 0; j < spots; j++) {
                    point(data, g, 15 + random() * (g.width - 30), 15 + random() * (g.height - 30), 8 + random() * 20);
                }
                return frame(data, g, `v${i}`, 60010 + i / 720);
            });
            const start = performance.now();
            findTracklets(visit, [frame(template, g, 'template', 60000)], g, []);
            const elapsed = performance.now() - start;
            console.log(`24 frames x ${spots} spots: ${elapsed.toFixed(0)} ms`);
            expect(elapsed).toBeLessThan(1500);
        }, 60000);
    }

    it('processes 24 large frames within a generous timing limit', () => {
        const g = { ...grid, width: 721, height: 721 };
        const template = frame(noise(g), g, 'template', 60000);
        const visit = Array.from({ length: 24 }, (_, i) => frame(noise(g), g, `v${i}`, 60010 + i / 720));
        const start = performance.now();
        findTracklets(visit, [template], g, []);
        const elapsed = performance.now() - start;
        console.log(`24-frame processing: ${elapsed.toFixed(0)} ms`);
        expect(elapsed).toBeLessThan(3000);
    }, 30000);
});

describe('real snapshot changes', () => {
    const diskFetch = (async (url: string) => {
        const path = process.cwd() + '/public' + String(url).replace(/^https?:\/\/[^/]+/, '');
        return new Response(readFileSync(path));
    }) as unknown as typeof fetch;

    for (const id of ['rwaur', 'epsindb', 'barnard'] as const) {
        it(`compares first and last visits for ${id}`, async () => {
            const target = targetById(id)!;
            const source = createSnapshotSource({ fetch: diskFetch, baseUrl: '' });
            const result = await source.load({ center: target.astrometry, fovDeg: 0.12, detector: target.detector, target: id });
            const visits = groupByVisit(result.frames.map((entry) => entry.frame));
            expect(visits.length).toBeGreaterThan(1);
            const first = visits[0]!, last = visits[visits.length - 1]!;
            const mid = (visit: RegriddedFrame[]): number => (visit[0]!.frame.tMin + visit[visit.length - 1]!.frame.tMax) / 2;
            const lastFrame = last[last.length - 1]!.frame;
            const lastMjd = (lastFrame.tMin + lastFrame.tMax) / 2;
            const track = gridSkyToPix(result.grid, positionAt(target.astrometry, lastMjd));
            const stars = [mid(first), mid(last)].flatMap((date, index) => result.stars.map((s) => ({ ...gridSkyToPix(result.grid, positionAt({
                ra: s.ra, dec: s.dec, epochJyear: s.epochJyear, pmRa: s.pmRa ?? 0, pmDec: s.pmDec ?? 0,
            }, date)), id: s.sourceId, visit: index === 0 ? 'earlier' as const : 'later' as const,
                properMotion: Boolean(s.pmRa || s.pmDec) })));
            const a = stackVisit(first), b = stackVisit(last);
            const changes = compareVisits({ data: a.data, lambda: first[0]!.lambdaAtCenter, mjd: mid(first),
                obsIds: first.map((f) => f.frame.obsId) },
            { data: b.data, lambda: last[0]!.lambdaAtCenter, mjd: mid(last), obsIds: last.map((f) => f.frame.obsId) },
            result.grid, stars);
            const distance = (p: { x: number; y: number }): number => Math.hypot(p.x - track.x, p.y - track.y) * result.grid.pixelArcsec;
            console.log(`${id}: ${changes.candidates.length} candidates, rejected ${JSON.stringify(changes.rejected)}`);
            for (const c of changes.candidates) {
                console.log(`  ${c.kind} sign=${c.sign} snr=${c.snr.toFixed(1)} distance=${distance(c.pix).toFixed(1)}″ ${c.reason}`);
                expect(c.reason).not.toMatch(/%/);
                if (c.kind === 'mover' && c.gaiaMatch) {
                    const shift = c.reason.match(/listed motion of about ([\d.]+)″/);
                    expect(shift).not.toBeNull();
                    expect(Number(shift![1])).toBeGreaterThanOrEqual(3);
                }
            }
            if (id === 'rwaur') {
                const best = changes.candidates.find((c) => c.gaiaMatch && distance(c.pix) < 6);
                expect(best).toBeDefined();
                expect(distance(best!.pix)).toBeLessThan(6);
                expect(best!.sign).toBe(1);
                expect(best!.reason).not.toMatch(/%/);
            }
            if (id === 'epsindb') {
                const mover = changes.candidates.find((c) => c.kind === 'mover' && distance(c.pix) < 15);
                expect(mover).toBeDefined();
                const shift = Number(mover!.reason.match(/listed motion of about ([\d.]+)″/)?.[1]);
                expect(shift).toBeGreaterThanOrEqual(4);
                expect(shift).toBeLessThanOrEqual(8);
            }
        }, 60000);
    }
});

describe('change finder, registration and ambiguous changes', () => {
    beforeEach(() => { seed = 918273; });
    const P = grid.pixelArcsec;

    it('rejects two steady stars 11″ apart under a 1.4″ wobble, 8 directions (Opus High 1)', () => {
        for (let k = 0; k < 8; k++) {
            const t = k * Math.PI / 4, wx = 1.4 * Math.cos(t) / P, wy = 1.4 * Math.sin(t) / P;
            const a = noise(grid), b = noise(grid);
            const x1 = 60 - 5.5 / P, x2 = 60 + 5.5 / P;
            point(a, grid, x1, 60, 3000); point(a, grid, x2, 60, 1500);
            point(b, grid, x1 + wx, 60 + wy, 3000); point(b, grid, x2 + wx, 60 + wy, 1500);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
            expect(r.candidates.every((c) => c.kind === 'unknown'), `${k * 45}°`).toBe(true);
            if (k === 0) {
                expect(r.notes.join(' ')).toMatch(/spots consistent with a shift of up to 1\.5″/);
            }
        }
    });

    it('rejects steady stars whose wobble differs slightly between them, at sub-pixel positions (-ba round 8)', () => {
        // Each star's fitted centroid moves a little differently (sub-pixel rounding, PSF-shape wobble), not one
        // common shift: still no candidate.
        const cases: [number, number, number, number, number, number][] = [
            [1.4, 0, 1.2, 0.3, 3000, 1500], [0, 1.4, 0.2, 1.2, 3000, 1500], [-1.2, 0.5, -1.4, 0.3, 5000, 400],
            [1.0, -1.0, 0.8, -1.2, 2000, 2000], [0.9, 0.9, 1.1, 0.7, 4000, 800], [1.4, 0, 1.0, 0.6, 3000, 1500],
            [0, 1.4, 0.3, 1.1, 3000, 1500], [0.9, 0.9, 1.3, 0.4, 4000, 800], [-1.2, 0.5, -1.4, 0.2, 5000, 400],
            [1.0, -1.0, 0.7, -1.2, 2000, 2000],
        ];
        const found: string[] = [];
        const unknownCounts: number[] = [];
        for (const [x1d, y1d, x2d, y2d, f1, f2] of cases) {
            for (const [sep, phase] of [[11, 0.3], [9, 0.45], [14, 0.1]]) {
                const a = noise(grid), b = noise(grid);
                const x1 = 60 + phase! - sep! / 2 / P, x2 = 60 + phase! + sep! / 2 / P, y = 60.2;
                point(a, grid, x1, y, f1); point(a, grid, x2, y, f2);
                point(b, grid, x1 + x1d / P, y + y1d / P, f1); point(b, grid, x2 + x2d / P, y + y2d / P, f2);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y, id: 'a' }, { x: x2, y, id: 'b' }]);
                unknownCounts.push(r.candidates.filter((c) => c.kind === 'unknown').length);
                found.push(...r.candidates.filter((c) => c.kind !== 'unknown').map((c) => `${x1d},${y1d}/${x2d},${y2d} ${sep}″: ${c.reason}`));
            }
        }
        expect(found).toEqual([]);
        console.log(`False movers, 30 steady-wobble fields: ${found.length}`);
        console.log(`Steady differing-wobble unknowns, in case/separation order: ${unknownCounts.join(', ')}`);
    });

    it('quotes no percentage and no "appeared" for an uncatalogued mover 15-24″ from the edge (Opus High 3, G1)', () => {
        const claims: string[] = [];
        for (const edge of [15, 18, 21, 24]) {
            for (const step of [8, 12]) {
                const a = noise(grid), b = noise(grid);
                point(a, grid, edge / P, 60, 1000); point(b, grid, (edge + step) / P, 60, 1000);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
                claims.push(...r.candidates.filter((c) => /\d\s*%/.test(c.reason) || /appeared|earlier visit shows none above its noise/.test(c.reason))
                    .map((c) => `${edge}″ +${step}″: ${c.reason}`));
            }
        }
        expect(claims).toEqual([]);
    });

    it('does not offer "the other got fainter" when one star brightens beside a steady wobbling one (Argon H1)', () => {
        const a = noise(grid), b = noise(grid);
        const x1 = 60, x2 = 60 + 10 / P, w = 1.2 / P;
        point(a, grid, x1, 60, 1000); point(b, grid, x1 + w, 60, 2500);
        point(a, grid, x2, 60, 1500); point(b, grid, x2 + w, 60, 1500);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
        expect(r.candidates.some((c) => near(x1, 60, c, 6))).toBe(true);
        expect(r.candidates.map((c) => c.reason).filter((s) => /^Either|the other fainter|opposite at a nearby/.test(s))).toEqual([]);
    });

    it('does not offer the either/or for two catalogue stars 0.5″ apart that a source crosses (Argon M5)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60 - 3 / P, 60, 1000); point(b, grid, 60 + 3.5 / P, 60, 1000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 'a' }, { x: 60 + 0.5 / P, y: 60, id: 'b' }]);
        expect(r.candidates.map((c) => c.reason).filter((s) => /0\.5″ apart/.test(s))).toEqual([]);
    });

    it('does not say "appeared" for a new source 20″ from a catalogue star (Argon L7)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 3000); point(b, grid, 60, 60, 3000);
        point(b, grid, 60 + 20 / P, 60, 300);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }]);
        const spot = r.candidates.filter((c) => near(60 + 20 / P, 60, c, 6));
        expect(spot).toHaveLength(1);
        expect(spot[0]!.reason).not.toMatch(/appeared|earlier visit shows none above its noise|\d+% (brighter|fainter)/);
    });

    it('does not call two catalogue stars 2.9″ apart a mover when they swap brightness under a 1.4″ wobble (Codex round 7)', () => {
        const movers: string[] = [];
        for (let k = 0; k < 8; k++) {
            const t = k * Math.PI / 4, wx = 1.4 * Math.cos(t) / P, wy = 1.4 * Math.sin(t) / P;
            const a = noise(grid), b = noise(grid);
            const x1 = 60 - 1.45 / P, x2 = 60 + 1.45 / P;
            point(a, grid, x1, 60, 3000); point(a, grid, x2, 60, 30);
            point(b, grid, x1 + wx, 60 + wy, 30); point(b, grid, x2 + wx, 60 + wy, 3000);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
            movers.push(...r.candidates.filter((c) => c.kind === 'mover').map((c) => `${k * 45}°: ${c.reason}`));
        }
        expect(movers).toEqual([]);
    });

    it('does not say "appeared" for a source that was there before on a background with no scatter (Codex round 7)', () => {
        const a = new Float32Array(grid.width * grid.height), b = noise(grid);
        point(a, grid, 60, 60, 2000); point(b, grid, 60, 60, 3000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(r.candidates.map((c) => c.reason).filter((s) => /appeared|earlier visit shows none above its noise/.test(s))).toEqual([]);
    });

});

describe('round 8 measurement guards', () => {
    beforeEach(() => { seed = 918273; });
    const P = grid.pixelArcsec;

    it('rejects the 100-to-1 steady pair at 5.9″ with earlier wobble (Argon 1)', () => {
        const a = noise(grid), b = noise(grid);
        for (const [x, amp] of [[60, 5000], [60 + 5.9 / P, 50]]) {
            point(a, grid, x! - 1.4 / P, 60, amp!);
            point(b, grid, x!, 60, amp!);
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid,
            [{ x: 60, y: 60, id: 'a' }, { x: 60 + 5.9 / P, y: 60, id: 'b' }]);
        expect(r.candidates).toHaveLength(0);
        expect(r.rejected.residual).toBeGreaterThan(0);
    });

    it('keeps real brightening, a nearby new source and a 5″ mover, with and without wobble', () => {
        for (const wobble of [0, 1.4]) {
            for (const scenario of ['brightening', 'new', 'mover']) {
                const a = noise(grid), b = noise(grid), w = wobble / P;
                if (scenario === 'brightening') {
                    point(a, grid, 60, 60, 2000); point(b, grid, 60 + w, 60, 3000);
                } else if (scenario === 'new') {
                    point(a, grid, 60, 60, 2000); point(b, grid, 60 + w, 60, 2000);
                    point(b, grid, 60 + (8 + wobble) / P, 60, 1000);
                } else {
                    point(a, grid, 60, 60, 1000); point(b, grid, 60 + (5 + wobble) / P, 60, 1000);
                }
                const stars = scenario === 'mover' ? [] : [{ x: 60, y: 60, id: 'a' }];
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
                const expectedX = 60 + (wobble + (scenario === 'new' ? 8 : scenario === 'mover' ? 5 : 0)) / P;
                const c = r.candidates.find((c) => near(expectedX, 60, c, 6));
                expect(c, `${scenario}, ${wobble}″`).toBeDefined();
                expect(c!.snr).toBeGreaterThan(20);
                if (scenario === 'mover') {
                    expect(c!.kind).toBe('unknown');
                    expect(c!.reading).toBe('pair');
                } else {
                    expect(c!.sign).toBe(1);
                }
            }
        }
    });

    it('keeps a real brightening and a new source between two stars that wobble differently (-ba round 8)', () => {
        const reasons: string[] = [];
        for (const [x1d, y1d, x2d, y2d] of [[0, 0, 0, 0], [1.4, 0, 1.0, 0.6], [0.9, 0.9, 1.3, 0.4]]) {
            for (const scenario of ['brightening', 'fading', 'new']) {
                const a = noise(grid), b = noise(grid);
                const x1 = 60.1 - 7 / P, x2 = 60.1 + 7 / P, y = 60.2;
                point(a, grid, x1, y, 2000); point(a, grid, x2, y, 1500);
                point(b, grid, x1 + x1d! / P, y + y1d! / P, scenario === 'brightening' ? 3000 : scenario === 'fading' ? 1000 : 2000);
                point(b, grid, x2 + x2d! / P, y + y2d! / P, 1500);
                if (scenario === 'new') {
                    point(b, grid, x2, y + 8 / P, 1000);
                }
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y, id: 'a' }, { x: x2, y, id: 'b' }]);
                const [ex, ey] = scenario === 'new' ? [x2, y + 8 / P] : [x1, y];
                const c = r.candidates.find((c) => near(ex, ey, c, 6));
                expect(c, `${scenario}, ${x1d},${y1d}/${x2d},${y2d}`).toBeDefined();
                expect(c!.snr).toBeGreaterThan(20);
                expect(c!.sign).toBe(scenario === 'fading' ? -1 : 1);
                reasons.push(...r.candidates.map((c) => c.reason));
            }
        }
        expect(reasons.filter((s) => /detected a|confirmed|proves|discovery|\d\s*%/i.test(s))).toEqual([]);
    });

    it('never words a reason or note as a detection, confirmation, proof or discovery (-ba round 8)', () => {
        // Every reason and note is a literal in changes.ts, so check the source as well as the outputs above.
        const source = readFileSync(`${process.cwd()}/src/lib/changes.ts`, 'utf8');
        const literals = source.match(/'[^'\n]*'|`[^`]*`/g) ?? [];
        expect(literals.filter((s: string) => /detected a|confirmed|proves|discovery|%/i.test(s))).toEqual([]);
    });

    it('hedges a catalogue brightening beside an uncatalogued fade (Codex 3)', () => {
        for (const sign of [1, -1]) {
            const a = noise(grid), b = noise(grid);
            point(a, grid, 60, 60, sign === 1 ? 2000 : 3000);
            point(b, grid, 60, 60, sign === 1 ? 3000 : 2000);
            point(sign === 1 ? a : b, grid, 60 + 16 / P, 60, 500);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 'a' }]);
            const c = r.candidates.find((c) => c.gaiaMatch);
            expect(c).toBeDefined();
            expect(c!.kind).toBe('unknown');
            expect(c!.sign).toBe(sign);
            expect(c!.reason).toMatch(sign === 1
                ? /^Brighter at this catalogue star, with a fainter spot 16\.\d″ away: either the star changed, a source moved/
                : /^Fainter at this catalogue star, with a brighter spot 16\.\d″ away: either the star changed, a source moved/);
        }
    });

    it('does not say appeared for a negative earlier hole (Codex 4)', () => {
        for (const laterAmp of [0, 300]) {
            const a = noise(grid), b = noise(grid);
            point(a, grid, 60, 60, -300);
            point(b, grid, 60, 60, laterAmp);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
            expect(r.candidates).toHaveLength(1);
            expect(r.candidates[0]!.reason).toMatch(/^The two visits differ here/);
            expect(r.candidates[0]!.reason).not.toMatch(/appeared|earlier visit shows none above its noise/);
        }
    });

    it('does not say appeared for a marginal earlier source (Argon 4b)', () => {
        const a = noise(grid), b = noise(grid);
        // This fixture's earlier aperture is 4.82 times its ring-derived noise.
        point(a, grid, 60, 60, 2.6); point(b, grid, 60, 60, 300);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0]!.reason).toMatch(/^The two visits differ here/);
        expect(r.candidates[0]!.reason).not.toMatch(/appeared|earlier visit shows none above its noise/);
    });

    it('reports fallback noise for all-zero error maps (Codex 5)', () => {
        for (const invalidBin of [false, true]) {
            const a = noise(grid), b = noise(grid);
            point(b, grid, 60, 60, 300);
            const va = new Float32Array(a.length), vb = va.slice();
            if (invalidBin) {
                va[60 * grid.width + 60] = -4;
                vb[60 * grid.width + 60] = 5;
            }
            const r = compareVisits({ ...image(a, 'a'), variance: va }, { ...image(b, 'b'), variance: vb }, grid, []);
            expect(r.candidates).toHaveLength(1);
            expect(r.notes.join(' ')).toMatch(/Error maps unusable; noise from the difference image only/);
            expect(r.notes.join(' ')).not.toMatch(/Noise estimated using the frames' pixel uncertainty maps/);
        }
    });

    it('rejects an invalid variance input even when its sum is positive (Argon 5)', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 30);
        const va = new Float32Array(a.length).fill(0.001), vb = va.slice();
        for (let y = 52; y < 68; y++) {
            for (let x = 52; x < 68; x++) {
                va[y * grid.width + x] = -4;
                vb[y * grid.width + x] = 5;
            }
        }
        const invalid = compareVisits({ ...image(a, 'a'), variance: va }, { ...image(b, 'b'), variance: vb }, grid, []);
        for (let i = 0; i < va.length; i++) {
            if (va[i]! < 0) {
                va[i] = NaN; vb[i] = NaN;
            }
        }
        const missing = compareVisits({ ...image(a, 'a'), variance: va }, { ...image(b, 'b'), variance: vb }, grid, []);
        expect(invalid.candidates).toHaveLength(1);
        expect(invalid.candidates[0]!.snr).toBe(missing.candidates[0]!.snr);
        expect(invalid.notes.join(' ')).toMatch(/Noise estimated using the frames' pixel uncertainty maps/);
    });

    it('bounds duplicate ids by elapsed time (Argon 6)', () => {
        for (const days of [1, NaN, Infinity]) {
            const a = noise(grid), b = noise(grid);
            const x1 = 60 - 5 / P, x2 = 60 + 5 / P;
            point(a, grid, x1, 60, 2000); point(a, grid, x2, 60, 100);
            point(b, grid, x1, 60, 100); point(b, grid, x2, 60, 2000);
            const r = compareVisits(image(a, 'a'), image(b, 'b', 60000 + days), grid,
                [{ x: x1, y: 60, id: 'same' }, { x: x2, y: 60, id: 'same' }]);
            expect(r.candidates.length).toBeGreaterThan(0);
            expect(r.candidates.filter((c) => c.kind === 'mover'), `${days} days`).toHaveLength(0);
        }
    });

    it('reports separate nonzero rejection notes without a catalogue', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 1000); point(b, grid, 60, 60, 1050);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.candidates).toHaveLength(0);
        expect(r.notes.join(' ')).toMatch(/\d+ small differences? (at catalogue stars )?(is|are) not listed/);
        expect(r.notes.join(' ')).not.toMatch(/steady stars|0 shadows|0 spots/);
    });

    it('returns NaN sigma for constant data and a one-pixel grid', () => {
        expect(significance(new Float32Array(grid.width * grid.height), grid).sigma).toBeNaN();
        expect(significance(new Float32Array([3]), { ...grid, width: 1, height: 1 }).sigma).toBeNaN();
    });
});

describe('round 8 presence and shadow ordering', () => {
    beforeEach(() => { seed = 918273; });

    it('requires the later aperture to be positive above its own noise', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 300);
        // A balanced ring has large pixel scatter but no binned difference signal. The later aperture's
        // sum is less than one of its own noise units, even though the central difference is significant.
        for (let by = 0; by < 30; by++) {
            for (let bx = 0; bx < 30; bx++) {
                const r = Math.hypot(bx * 4 + 1.5 - 60, by * 4 + 1.5 - 60) * grid.pixelArcsec;
                if (r < 26 || r > 35) {
                    continue;
                }
                for (let y = by * 4; y < (by + 1) * 4; y++) {
                    for (let x = bx * 4; x < (bx + 1) * 4; x++) {
                        b[y * grid.width + x]! += ((x + y) % 2 ? 1 : -1) * 1000;
                    }
                }
            }
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0]!.reason).toMatch(/^The two visits differ here/);
        expect(r.candidates[0]!.reason).not.toMatch(/appeared|earlier visit shows none above its noise/);
    });

    it('keeps a weak catalogue change separate from the explanation of a stronger spot', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 48, 60, 3000); point(a, grid, 60, 60, 80); point(b, grid, 68, 60, 300);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }], { matchArcsec: 1 });
        expect(r.candidates).toHaveLength(3);
        expect(r.candidates.some((c) => near(68, 60, c, 6))).toBe(true);
        expect(r.candidates.map((c) => c.reason).join(' ')).not.toMatch(/that also changed|whose image shifted/);
        expect(r.candidates.some((c) => c.reason.startsWith('A weaker change near a stronger change'))).toBe(true);
        expect(r.notes.join(' ')).not.toMatch(/0 small|0 spots|0 shadows/);
    });
});

describe('round 8 pair and nearby-star guards', () => {
    beforeEach(() => { seed = 918273; });
    const P = grid.pixelArcsec;

    it('checks wobble before pushing an either-or pair', () => {
        const a = noise(grid), b = noise(grid);
        const x1 = 60 - 2 / P, x2 = 60 + 2 / P;
        point(a, grid, x1, 60, 1000); point(a, grid, x2, 60, 100);
        point(b, grid, x1 + 1.4 / P, 60, 1000); point(b, grid, x2 + 1.4 / P, 60, 100);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid,
            [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }], { minShiftArcsec: 0.1 });
        expect(r.candidates).toHaveLength(0);
        expect(r.notes.join(' ')).toMatch(/2 spots consistent with a shift of up to 1\.5″/);
    });

    it('describes a brighter-star blend without claiming its image shifted (A3)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 1000); point(b, grid, 60, 60, 1000);
        point(a, grid, 52, 60, 300); point(b, grid, 68, 60, 300);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }]);
        expect(r.candidates).toHaveLength(2);
        for (const c of r.candidates) {
            expect(c.kind).toBe('unknown');
            expect(c.reason).toMatch(/^The two visits differ \d+\.\d″ from a brighter catalogue star whose light overlaps here/);
            expect(c.reason).not.toContain('whose image shifted');
        }
    });
});

describe('round 8 edge-opposite guard', () => {
    beforeEach(() => { seed = 918273; });

    it('uses the single-star sentence when an opposite spot was rejected at the edge (C3)', () => {
        const a = noise(grid), b = noise(grid), P = grid.pixelArcsec;
        point(a, grid, 15 / P, 60, 500);
        point(a, grid, 27 / P, 60, 2000); point(b, grid, 27 / P, 60, 3000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 27 / P, y: 60, id: 'a' }]);
        expect(r.candidates.some((c) => c.kind === 'unknown' && /image edge|missing image pixels/.test(c.reason))).toBe(true);
        const c = r.candidates.find((c) => c.gaiaMatch);
        expect(c).toBeDefined();
        expect(c!.kind).toBe('unknown');
        expect(c!.reason).toMatch(/^A catalogue star here reads brighter in the later visit/);
        expect(c!.reason).not.toMatch(/fainter spot|opposite/);
    });
});

describe('round 8 shadow chain guard', () => {
    beforeEach(() => { seed = 918273; });

    it('retains chained weak changes in both spatial orders', () => {
        const P = grid.pixelArcsec;
        for (const direction of [1, -1]) {
            const a = noise(grid), b = noise(grid), x = direction === 1 ? 40 : 80;
            point(b, grid, x, 60, 3000);
            point(a, grid, x + direction * 20 / P, 60, 400);
            point(b, grid, x + direction * 40 / P, 60, 50);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
            expect(r.candidates, `direction ${direction}`).toHaveLength(3);
            expect(r.candidates.some((c) => near(x, 60, c, 6))).toBe(true);
            expect(r.candidates.filter((c) => c.reason.startsWith('A weaker change near a stronger change'))).toHaveLength(2);
        }
    });
});

describe('round 9 wobble and coverage guards', () => {
    beforeEach(() => { seed = 918273; });
    const P = grid.pixelArcsec;
    const measured = (r: ReturnType<typeof compareVisits>): string => JSON.stringify({
        candidates: r.candidates.map((c) => ({ kind: c.kind, snr: c.snr, sign: c.sign, pix: c.pix, reason: c.reason })),
        rejected: r.rejected, notes: r.notes,
    });

    it('deduplicates date entries before the four-anchor limit in a steady three-star field (A2 slots)', () => {
        const a = noise(grid).map((v) => v * 0.001), b = noise(grid);
        const stars = [];
        for (const [i, dx, dy] of [[0, 1.4, 0], [1, -1.2, 0.3], [2, 0.2, -1.3]]) {
            const x = 60.3 + (i! - 1) * 4 / P, y = 60.2;
            point(a, grid, x, y, 1000); point(b, grid, x + dx! / P, y + dy! / P, 1000);
            stars.push({ x: x - 0.05 / P, y, id: `s${i}` }, { x: x + 0.05 / P, y, id: `s${i}` });
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
        expect(r.candidates.every((c) => c.kind === 'unknown'), measured(r)).toBe(true);
        expect(r.notes.join(' '), measured(r)).not.toContain('small difference');
    });


    it('converges on two steady stars 4″ apart with opposing wobbles (C1)', () => {
        const a = noise(grid), b = noise(grid), x1 = 60.3 - 2 / P, x2 = 60.3 + 2 / P, y = 60.2;
        point(a, grid, x1, y, 2000); point(a, grid, x2, y, 2000);
        point(b, grid, x1 + 1.4 / P, y, 2000); point(b, grid, x2 - 1.2 / P, y + 0.3 / P, 2000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y, id: 'a' }, { x: x2, y, id: 'b' }]);
        expect(r.candidates.every((c) => c.kind === 'unknown'), measured(r)).toBe(true);
    });

    it('does not lend a rejected wobble or a rising core to an opposite explanation (C3)', () => {
        const a = noise(grid), b = noise(grid), x1 = 60.3 - 3 / P, x2 = 60.3 + 3 / P, y = 60.2;
        point(a, grid, x1, y, 1000); point(a, grid, x2, y, 3000);
        point(b, grid, x1 - 1.4 / P, y, 2500); point(b, grid, x2 - 1.4 / P, y, 3000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y, id: 'a' }, { x: x2, y, id: 'b' }]);
        expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
        expect(r.candidates.map((c) => c.reason), measured(r)).not.toEqual(expect.arrayContaining([
            expect.stringMatching(/opposite at a nearby|with a fainter spot|other fainter/),
        ]));
    });

    it('hedges a single-source shift close to the wobble bound, with and without a catalogue (A4)', () => {
        let retained = 0;
        for (const catalogued of [false, true]) {
            for (const offset of [1.6, 1.7, 1.8, 2.0]) {
                const a = noise(grid), b = noise(grid);
                point(a, grid, 60.3, 60.2, 100); point(b, grid, 60.3 + offset / P, 60.2, 100);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, catalogued ? [{ x: 60.3, y: 60.2, id: 's' }] : [],
                    { minShiftArcsec: 0.1 });
                expect(r.candidates.filter((c) => c.kind === 'mover'), `${catalogued}, ${offset}: ${measured(r)}`).toHaveLength(0);
                for (const c of r.candidates) {
                    retained++;
                    expect(c.kind, measured(r)).toBe('unknown');
                    expect(c.reason, measured(r)).toMatch(/^Two close spots changed in opposite ways; a small shift of one source, a slow mover/);
                }
            }
        }
        expect(retained).toBeGreaterThan(0);
    });

    it('keeps an unresolved shift below the default mover cutoff and quotes no distance (A4 cutoff, Codex r11c)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60.3, 60.2, 300); point(b, grid, 60.3 + 2 / P, 60.2, 300);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60.3, y: 60.2, id: 's' }]);
        expect(r.candidates, measured(r)).toHaveLength(1);
        expect(r.candidates[0]!.kind).toBe('unknown');
        // A 2″ shift gives peaks about 11″ apart, so no number is printed.
        expect(r.candidates[0]!.reason, measured(r)).toMatch(/^Two close spots changed in opposite ways/);
        expect(r.candidates[0]!.reason).not.toMatch(/\d″/);
    });

    it('checks ordinary wobble before pairing an uncatalogued dipole with a low shift cutoff (A4 ordinary)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 2000); point(b, grid, 60 + 1.4 / P, 60, 2000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [], { minShiftArcsec: 0.1 });
        expect(r.candidates, measured(r)).toHaveLength(1);
        expect(r.candidates[0]!.kind).toBe('unknown');
        expect(r.candidates[0]!.reason).toMatch(/small shift of one source/);
    });

    it('blocks opposite changes on two catalogue stars without ids (A5)', () => {
        const a = noise(grid), b = noise(grid), x1 = 60 - 7.5 / P, x2 = 60 + 7.5 / P;
        point(a, grid, x1, 60, 1000); point(b, grid, x2, 60, 1000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60 }, { x: x2, y: 60 }], { dipoleArcsec: 20 });
        expect(r.candidates, measured(r)).toHaveLength(1);
        expect(r.candidates[0]!.kind, measured(r)).toBe('unknown');
        expect(r.candidates[0]!.reason, measured(r)).toMatch(/^Either a source moved between two catalogue stars 15\.0″ apart/);
    });

    it('validates the whole patch before discarding a new source 8″ from a steady star (C2)', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(a, grid, x, y, 3000); point(b, grid, x, y, 3000); point(b, grid, x + 8 / P, y, 300);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 's' }]);
        const c = r.candidates.find((c) => near(x + 8 / P, y, c, 6));
        expect(c, measured(r)).toBeDefined();
        expect(c!.snr).toBeGreaterThan(20);
        expect(c!.kind).toBe('unknown');
    });

    it('does not discard a wobbling-star patch with a faint new source (C2 patch)', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(a, grid, x, y, 1000); point(b, grid, x + 0.7 / P, y, 1000);
        point(b, grid, x + 12 / P, y, 10);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 's' }]);
        expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
        expect(r.notes.join(' '), measured(r)).not.toContain('spots consistent with a shift');
    });

    it('keeps a marginal new source when only noise was present earlier (C2 blank sky)', () => {
        const a = noise(grid), b = noise(grid);
        injectSnr(a, b, grid, 60, 60, 5.2);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.candidates.some((c) => near(60, 60, c, 6)), measured(r)).toBe(true);
    });

    it('keeps the measured 5.2-sigma blank-sky change that noise shifting used to erase (C2 noise)', () => {
        // Fixed noise realisation 18; the original code erases this source as wobble.
        for (let n = 0; n < 18; n++) {
            noise(grid); noise(grid);
        }
        const a = noise(grid), b = noise(grid);
        injectSnr(a, b, grid, 60, 60, 5.2);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        const c = r.candidates.find((c) => near(60, 60, c, 6));
        expect(c, measured(r)).toBeDefined();
        expect(c!.snr).toBeCloseTo(5.1566, 3);
        expect(c!.kind).toBe('unknown');
    });

    it('does not explain a distant lobe by shifting a source outside the matching radius (C2 source)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 300, 16); point(b, grid, 60 + 1.4 / P, 60, 300, 16);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [], { minFracChange: 0 });
        expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
        expect(r.notes.join(' '), measured(r)).not.toContain('spots consistent with a shift');
    });

    it('requires a clear improvement before crossing the cutoff (C2 half)', () => {
        for (let n = 0; n < 10; n++) {
            noise(grid); noise(grid);
        }
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60.3, 60.2, 20); point(b, grid, 60.3, 60.2, 16);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid,
            [{ x: 60.3, y: 60.2, id: 's' }, { x: 60.3 + 0.1 / P, y: 60.2, id: 's' }]);
        expect(r.candidates.some((c) => c.sign === -1), measured(r)).toBe(true);
    });

    it('checks the measured core sign with two kept opposing catalogue spots (C6)', () => {
        const a = noise(grid), b = noise(grid), x1 = 60.3 - 3 / P, x2 = 60.3 + 3 / P, y = 60.2;
        point(a, grid, x1, y, 1000); point(a, grid, x2, y, 3000);
        point(b, grid, x1 - 1.4 / P, y, 2500); point(b, grid, x2 - 1.4 / P, y, 3000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y, id: 'a' }, { x: x2, y, id: 'b' }]);
        expect(r.candidates, measured(r)).toHaveLength(2);
        const positive = r.candidates.find((c) => c.sign === 1)!;
        const negative = r.candidates.find((c) => c.sign === -1)!;
        // These conditions reach the blended-core guard: neither the distance nor the strength check excludes it.
        expect(positive.gaiaMatch && negative.gaiaMatch).toBe(true);
        expect(negative.snr * 5).toBeGreaterThan(positive.snr);
        expect(Math.hypot(positive.pix.x - negative.pix.x, positive.pix.y - negative.pix.y) * P).toBeGreaterThan(6);
        expect(positive.kind, measured(r)).toBe('unknown');
        expect(negative.kind, measured(r)).toBe('unknown');
    });

    it('keeps a new source beside one isolated missing pixel (C4)', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 300); a[60 * grid.width + 67] = NaN;
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.rejected.edge, measured(r)).toBe(0);
        expect(r.candidates.some((c) => near(60, 60, c, 6)), measured(r)).toBe(true);
    });

    it('rejects wobble despite an isolated missing pixel in its interpolation stencil (A7 wobble)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 2000); point(b, grid, 60 + 1.4 / P, 60, 2000);
        a[60 * grid.width + 67] = NaN;
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }], { edgeArcsec: 0 });
        expect(r.candidates, measured(r)).toHaveLength(0);
        expect(r.notes.join(' '), measured(r)).toMatch(/spots consistent with a shift/);
    });

    it('still applies the small-change floor beside one missing pixel (A7 floor)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 1000); point(b, grid, 60, 60, 1050);
        a[60 * grid.width + 67] = NaN;
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }], { edgeArcsec: 0 });
        expect(r.candidates, measured(r)).toHaveLength(0);
        expect(r.notes.join(' '), measured(r)).toMatch(/small differences? at catalogue stars (is|are) not listed/);
    });

    it('keeps an isolated fade when the same catalogue star is supplied at both dates (A2)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60.3, 60.2, 2000); point(b, grid, 60.3, 60.2, 1600);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid,
            [{ x: 60.3, y: 60.2, id: 's' }, { x: 60.3 + 0.1 / P, y: 60.2, id: 's' }]);
        expect(r.candidates.some((c) => c.sign === -1 && near(60.3, 60.2, c, 6)), measured(r)).toBe(true);
    });

    it('keeps a smaller fade at a lowered floor despite two date entries for one star (A2 fade)', () => {
        for (const amp of [150, 200, 250]) {
            const a = noise(grid), b = noise(grid);
            point(a, grid, 60.3, 60.2, amp); point(b, grid, 60.3, 60.2, 0.95 * amp);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid,
                [{ x: 60.3 - 0.05 / P, y: 60.2, id: 's' }, { x: 60.3 + 0.05 / P, y: 60.2, id: 's' }],
                { minFracChange: 0.01 });
            expect(r.candidates.some((c) => c.sign === -1), `${amp}: ${measured(r)}`).toBe(true);
        }
    });

    it('does not let four faint catalogue entries displace influential wobbling anchors (A8)', () => {
        const a = noise(grid), b = noise(grid), x1 = 60.3 - 2 / P, x2 = 60.3 + 2 / P, y = 60.2;
        point(a, grid, x1, y, 2000); point(a, grid, x2, y, 2000);
        point(b, grid, x1 + 1.4 / P, y, 2000); point(b, grid, x2 - 1.2 / P, y + 0.3 / P, 2000);
        const faint = [-2, -1, 1, 2].map((dy, i) => ({ x: 60.3 - 8 / P, y: y + dy / P, id: `f${i}` }));
        for (const s of faint) {
            point(a, grid, s.x, s.y, 1); point(b, grid, s.x, s.y, 1);
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [...faint, { x: x1, y, id: 'a' }, { x: x2, y, id: 'b' }]);
        expect(r.candidates.every((c) => c.kind === 'unknown'), measured(r)).toBe(true);
        expect(r.notes.join(' '), measured(r)).not.toContain('small difference');
    });

    for (const scenario of ['mover', 'new']) {
        it(`keeps a ${scenario} blended with a brighter steady catalogue star as unknown (A3/A9)`, () => {
            const a = noise(grid), b = noise(grid), x = 60, y = 60;
            point(a, grid, x, y, 5000); point(b, grid, x, y, 5000);
            if (scenario === 'mover') {
                point(a, grid, x, y + 9 / P, 400); point(b, grid, x + 6 / P, y + 9 / P, 400);
            } else {
                point(b, grid, x + 9 / P, y, 400);
            }
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 's' }]);
            expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
            expect(r.candidates.every((c) => c.kind === 'unknown'), measured(r)).toBe(true);
            expect(r.candidates.every((c) => /^(The two visits differ \d+\.\d″ from a brighter catalogue star whose light overlaps here|Two close spots changed in opposite ways)/.test(c.reason)), measured(r)).toBe(true);
        });
    }

    it('keeps new sources just beyond the matching radius of a brighter star (A3 close)', () => {
        for (const separation of [6.5, 7, 7.4]) {
            const a = noise(grid), b = noise(grid), x = 60 + separation / P;
            point(a, grid, 60, 60, 5000); point(b, grid, 60, 60, 5000); point(b, grid, x, 60, 400);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }]);
            const c = r.candidates.find((c) => near(x, 60, c, 3));
            expect(c, `${separation}″: ${measured(r)}`).toBeDefined();
            expect(c!.kind).toBe('unknown');
            expect(c!.reason).toMatch(/^The two visits differ \d+\.\d″ from a brighter catalogue star whose light overlaps here/);
        }
    });

    it('keeps a faint new source between steady catalogue cores instead of inventing inward shifts (C2 cores)', () => {
        for (const amplitude of [8, 10, 15]) {
            const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
            const stars = [-10, 10].map((dx, i) => ({ x: x + dx / P, y, id: `s${i}` }));
            for (const s of stars) {
                point(a, grid, s.x, s.y, 500); point(b, grid, s.x, s.y, 500);
            }
            point(b, grid, x, y, amplitude);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
            const c = r.candidates.find((c) => near(x, y, c, 6));
            expect(c, `${amplitude}: ${measured(r)}`).toBeDefined();
            expect(c!.kind).toBe('unknown');
        }
    });

    it('keeps asymmetric marginal new sources beside steady catalogue cores (C2 asymmetric)', () => {
        for (const separation of [8, 10, 12]) {
            for (const second of [false, true]) {
                const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
                const stars = [{ x, y, id: 'a' }];
                point(a, grid, x, y, 5000); point(b, grid, x, y, 5000);
                if (second) {
                    stars.push({ x: x - 16 / P, y, id: 'b' });
                    point(a, grid, x - 16 / P, y, 500); point(b, grid, x - 16 / P, y, 500);
                }
                point(b, grid, x + separation / P, y, 10);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
                const c = r.candidates.find((c) => near(x + separation / P, y, c, 6));
                expect(c, `${separation}″, second ${second}: ${measured(r)}`).toBeDefined();
                expect(c!.kind).toBe('unknown');
            }
        }
    });

    it('does not treat a new source between closer steady stars as core registration evidence (C2 tails)', () => {
        for (const [offset, amplitude] of [[8, 7], [9, 12]]) {
            seed = 918273;
        for (let trial = 0; trial < 3; trial++) {
            const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
            const stars = [-offset!, offset!].map((dx, i) => ({ x: x + dx / P, y, id: `s${i}` }));
            for (const s of stars) {
                point(a, grid, s.x, s.y, 500); point(b, grid, s.x, s.y, 500);
            }
            point(b, grid, x, y, amplitude!);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
            const c = r.candidates.find((c) => near(x, y, c, 6));
            expect(c, `${offset}″, ${amplitude}, ${trial}: ${measured(r)}`).toBeDefined();
            expect(c!.kind).toBe('unknown');
        }
        }
    });
});

describe('round 10b source identity and blends', () => {
    beforeEach(() => { seed = 918273; });
    const measured = (r: ReturnType<typeof compareVisits>): string => JSON.stringify({ candidates: r.candidates, notes: r.notes, rejected: r.rejected });
    it('does not call two id-less stars swapping light a mover', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2, d = 2 / grid.pixelArcsec;
        point(a, grid, x - d, y, 3000); point(a, grid, x + d, y, 30);
        point(b, grid, x - d, y, 30); point(b, grid, x + d, y, 3000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x - d, y }, { x: x + d, y }]);
        expect(r.candidates.some((c) => c.kind === 'unknown' && /either/i.test(c.reason)), measured(r)).toBe(true);
        expect(r.candidates.some((c) => c.kind === 'mover'), measured(r)).toBe(false);
    });
    it('keeps a new source that the core fallback can explain', () => {
        seed = 918318;
        const a = noise(grid), b = noise(grid), x = 59.572, y = 60.468;
        const stars = [{ x: 65.0447, y: 58.5119, id: 'a' }, { x: 54.0993, y: 62.4241, id: 'b' }];
        for (const s of stars) { point(a, grid, s.x, s.y, 500); point(b, grid, s.x, s.y, 500); }
        point(b, grid, x, y, 6);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
        expect(r.candidates.some((c) => c.kind === 'unknown' && near(x, y, c, 8)), measured(r)).toBe(true);
        expect(r.candidates.some((c) => /beside catalogue stars; a small image shift could also cause/.test(c.reason)), measured(r)).toBe(true);
    });
    for (const [offset, amplitude] of [[7.5, 7], [10, 25]]) {
        it(`keeps a midpoint source between steady stars ${offset} arcsec away`, () => {
            const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2, d = offset! / grid.pixelArcsec;
            const stars = [{ x: x - d, y, id: 'a' }, { x: x + d, y, id: 'b' }];
            for (const s of stars) { point(a, grid, s.x, y, 500); point(b, grid, s.x, y, 500); }
            point(b, grid, x, y, amplitude!);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
            expect(r.candidates.some((c) => c.kind === 'unknown' && near(x, y, c, 8)), measured(r)).toBe(true);
            if (offset === 10) {
                expect(r.candidates.some((c) => /near brighter catalogue stars whose light overlaps here, so this reading may be their light/.test(c.reason)), measured(r)).toBe(true);
            }
        });
    }
    it('does not call a single-star-dominated aperture a multi-star blend', () => {
        for (const laterAmplitude of [1200, 5000]) {
            seed = 918273;
            const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
            const stars = [{ x, y, id: 'bright' }, { x: x + 18 / grid.pixelArcsec, y, id: 'faint' }];
            point(a, grid, x, y, 1000); point(b, grid, x, y, laterAmplitude);
            point(a, grid, stars[1]!.x, y, 10); point(b, grid, stars[1]!.x, y, 10);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
            expect(r.candidates.some((c) => near(x, y, c, 6)), measured(r)).toBe(true);
            expect(r.candidates.every((c) => !c.reason.includes('brighter catalogue stars whose light overlaps')), measured(r)).toBe(true);
        }
    });
});

describe('visit candidate sentences and caveats', () => {
    it('names only the single-frame visit and keeps the caveat separate', () => {
        for (const [aCount, bCount, caveat] of [
            [1, 1, 'Each visit has fewer than 3 frames, so a detector hit cannot be ruled out.'],
            [1, 2, 'Each visit has fewer than 3 frames, so a detector hit cannot be ruled out.'],
            [2, 1, 'Each visit has fewer than 3 frames, so a detector hit cannot be ruled out.'],
            [2, 2, 'Each visit has fewer than 3 frames, so a detector hit cannot be ruled out.'],
            [2, 3, 'The earlier visit has fewer than 3 frames, so a detector hit cannot be ruled out.'],
            [3, 2, 'The later visit has fewer than 3 frames, so a detector hit cannot be ruled out.'],
            [3, 3, undefined],
        ] as const) {
            seed = 918273;
            const a = noise(grid), b = noise(grid);
            point(b, grid, 60, 60, 100);
            const r = compareVisits({ ...image(a, 'a'), obsIds: Array(aCount).fill('a') },
                { ...image(b, 'b'), obsIds: Array(bCount).fill('b') }, grid, []);
            expect(r.candidates.length).toBeGreaterThan(0);
            for (const c of r.candidates) {
                expect(c.caveat).toBe(caveat);
                expect(c.sentence).toBe(c.reason);
                expect(c.sentence).not.toMatch(/one frame|artefacts not ruled out/);
            }
            expect(r.notes.join(' ')).not.toMatch(/one frame|artefacts not ruled out/);
        }
    });
    it('describes measured light and displacement without claiming discovery', () => {
        const a = noise(grid), b = noise(grid);
        point(b, grid, 60, 60, 100);
        const appeared = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(appeared.candidates[0]!.sentence).toBe('Light here in the later visit; the earlier visit shows none above its noise (candidate).');
        const movedA = noise(grid), movedB = noise(grid);
        point(movedA, grid, 50, 60, 300); point(movedB, grid, 56, 60, 300);
        const moved = compareVisits(image(movedA, 'a'), image(movedB, 'b'), grid, []);
        const mover = moved.candidates.find((c) => c.reading === 'pair');
        expect(mover).toBeDefined();
        expect(mover!.sentence).toMatch(/^Two nearby spots changed in opposite ways/);
    });
    it('exposes the visit metadata and output-grid reading apertures for FLAGS', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 50, 60, 300); point(b, grid, 56, 60, 300);
        const r = compareVisits(image(a, 'early', 60000), image(b, 'late', 60030), grid, []);
        expect(r.visits).toEqual({ earlier: { obsIds: ['early'], mjd: 60000 }, later: { obsIds: ['late'], mjd: 60030 } });
        const mover = r.candidates.find((c) => c.reading === 'pair');
        expect(mover).toBeDefined();
        expect(mover!.lightVisit).toBe('later');
        expect(mover!.x).toBe(mover!.pix.x);
        expect(mover!.y).toBe(mover!.pix.y);
        expect(mover!.radiusPix).toBeCloseTo(12 / grid.pixelArcsec);
        expect(mover!.lightEnds?.map((end) => end.visit)).toEqual(['earlier', 'later']);
        expect(mover!.lightEnds?.every((end) => Number.isFinite(end.x) && Number.isFinite(end.y) && end.radiusPix > 0)).toBe(true);
        const vanishedA = noise(grid), vanishedB = noise(grid);
        point(vanishedA, grid, 60, 60, 100);
        const vanished = compareVisits(image(vanishedA, 'early'), image(vanishedB, 'late'), grid, []);
        expect(vanished.candidates[0]!.lightVisit).toBe('earlier');
        expect(vanished.candidates[0]!.sentence).toMatch(/^Light here in the earlier visit; the later visit shows none above its noise/);
    });
    it('notes a blank centre only when neither visit has a five-sigma central source', () => {
        seed = 918273;
        const a = noise(grid), b = noise(grid);
        const blank = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        const note = 'No source above 5 times the noise at the centre of the view in either visit.';
        expect(blank.notes).toContain(note);
        point(a, grid, 60, 60, 100); point(b, grid, 60, 60, 100);
        expect(compareVisits(image(a, 'a'), image(b, 'b'), grid, []).notes).not.toContain(note);
        const missing = noise(grid), other = noise(grid);
        missing[60 * grid.width + 60] = NaN;
        expect(compareVisits(image(missing, 'a'), image(other, 'b'), grid, []).notes).not.toContain(note);
    });
});

describe('round 10 brightness uncertainty', () => {
    beforeEach(() => { seed = 918273; });
    const measured = (r: ReturnType<typeof compareVisits>): string => JSON.stringify({ candidates: r.candidates, notes: r.notes, rejected: r.rejected });

    it('hedges equal-flux stars with different image widths', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(a, grid, x, y, 120 * (10.5 / 14.5) ** 2, 14.5);
        point(b, grid, x, y, 120, 10.5);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 'star' }]);
        expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
        expect(r.candidates[0]!.kind, measured(r)).toBe('unknown');
        expect(r.candidates[0]!.reason, measured(r)).toMatch(/sharper/);
    });

    it('hedges a noisy equal-flux star that becomes broader', () => {
        seed = 5;
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(a, grid, x, y, 10 * (14.5 / 10.5) ** 2, 10.5);
        point(b, grid, x, y, 10, 14.5);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 'star' }]);
        expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
        expect(r.candidates.every((c) => c.kind === 'unknown'), measured(r)).toBe(true);
    });

    it('does not claim image sharpness changed when a neighbouring source appears', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(a, grid, x, y, 100); point(b, grid, x, y, 100);
        point(b, grid, x + 4 / grid.pixelArcsec, y, 50);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 'star' }]);
        expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
        expect(r.candidates.every((c) => !c.reason.includes('its image is sharper')), measured(r)).toBe(true);
    });

    it('retains a compact change when its profile ring reaches the edge', () => {
        const a = noise(grid), b = noise(grid);
        b[60 * grid.width + 10]! += 200;
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
        expect(r.candidates.every((c) => c.kind === 'unknown'), measured(r)).toBe(true);
    });

    it('retains a significant change at the image edge as unknown', () => {
        const a = noise(grid), b = noise(grid), x = 7, y = 60;
        point(b, grid, x, y, 100);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.candidates.some((c) => c.kind === 'unknown' && near(x, y, c, 8)), measured(r)).toBe(true);
    });

    it('retains a marginal source occupying one measurement bin', () => {
        seed = 72;
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(b, grid, x, y, 5);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.candidates.some((c) => c.kind === 'unknown' && near(x, y, c, 6)), measured(r)).toBe(true);
    });

    for (const visit of ['earlier', 'later']) {
        for (const side of [1, 2]) {
            for (const catalogued of [true, false]) {
                it(`hedges a ${side}x${side} spike in the ${visit} visit ${catalogued ? 'on a star' : 'in blank sky'}`, () => {
                    const a = noise(grid), b = noise(grid), x = 60, y = 60;
                    if (catalogued) { point(a, grid, x, y, 50); point(b, grid, x, y, 50); }
                    for (let dy = 0; dy < side; dy++) {
                        for (let dx = 0; dx < side; dx++) { (visit === 'earlier' ? a : b)[(y + dy) * grid.width + x + dx]! += 200; }
                    }
                    const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, catalogued ? [{ x, y, id: 'star' }] : []);
                    expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
                    expect(r.candidates[0]!.kind, measured(r)).toBe('unknown');
                    expect(r.candidates[0]!.reason, measured(r)).toMatch(/narrow/);
                });
            }
        }
    }
});

describe('round 10 retained changes', () => {
    beforeEach(() => { seed = 918273; });
    const P = grid.pixelArcsec;
    const measured = (r: ReturnType<typeof compareVisits>): string => JSON.stringify({ candidates: r.candidates, notes: r.notes, rejected: r.rejected });

    it('keeps a fading star beside a wobbling star', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(a, grid, x, y, 400); point(b, grid, x + 1 / P, y, 400);
        point(a, grid, x + 16 / P, y, 80); point(b, grid, x + 16 / P, y, 56);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid,
            [{ x, y, id: 'a' }, { x: x + 16 / P, y, id: 'b' }]);
        expect(r.candidates.some((c) => c.sign === -1 && near(x + 16 / P, y, c, 8)), measured(r)).toBe(true);
    });

    it('keeps a dipole diluted by two steady catalogue stars', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        const stars = [1, 11].map((dx, i) => ({ x: x + dx / P, y, id: `s${i}` }));
        for (const s of stars) { point(a, grid, s.x, y, 200); point(b, grid, s.x, y, 200); }
        point(a, grid, x, y, 15); point(b, grid, x + 10 / P, y, 15);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
        expect(r.candidates, measured(r)).toHaveLength(1);
        expect(r.candidates[0]!.kind, measured(r)).toBe('unknown');
        expect(r.candidates[0]!.reason, measured(r)).toMatch(/^Two close spots changed in opposite ways/);
    });

    it('keeps an unresolved dipole blended with one catalogue star', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(a, grid, x, y, 80); point(b, grid, x, y, 80);
        point(a, grid, x - 3 / P, y, 40); point(b, grid, x + 3 / P, y, 40);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 's' }]);
        expect(r.candidates.some((c) => c.kind === 'unknown'), measured(r)).toBe(true);
    });

    it('keeps a new source beside a mildly wobbling bright star', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(a, grid, x, y, 200); point(b, grid, x + 0.45 / P, y, 200);
        point(a, grid, x, y + 20 / P, 50); point(b, grid, x, y + 20 / P, 50);
        point(b, grid, x + 9 / P, y, 6.5);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid,
            [{ x, y, id: 'a' }, { x, y: y + 20 / P, id: 'b' }]);
        expect(r.candidates.some((c) => c.kind === 'unknown' && near(x + 9 / P, y, c, 8)), measured(r)).toBe(true);
    });

    it('keeps a weak source near a much stronger change', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(b, grid, x, y, 60); point(b, grid, x + 22 / P, y, 8);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        for (const c of r.candidates.filter((item) => /weaker change near a stronger change/.test(item.sentence))) {
            expect(c.reading).toBe('differs');
        }
        expect(r.candidates.some((c) => c.kind === 'unknown' && near(x + 22 / P, y, c, 6)), measured(r)).toBe(true);
    });

    it('discloses when the candidate limit omits a weaker change', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(b, grid, x, y, 60); point(b, grid, x + 22 / P, y, 8);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [], { maxCandidates: 1 });
        expect(r.candidates).toHaveLength(1);
        expect(r.notes.join(' '), measured(r)).toMatch(/1 additional candidate not shown/);
        expect(r.notes.join(' '), measured(r)).not.toMatch(/weaker change.*kept as candidates/);
    });
});

describe('round 10 missing pixels', () => {
    beforeEach(() => { seed = 918273; });
    const P = grid.pixelArcsec;
    const measured = (r: ReturnType<typeof compareVisits>): string => JSON.stringify({ candidates: r.candidates, notes: r.notes, rejected: r.rejected });

    it('keeps a paired reading when a later pixel cannot be compared', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        const stars = [{ x, y, id: 'a' }, { x: x + 14 / P, y, id: 'b' }];
        point(a, grid, x, y, 300); point(b, grid, x + 1.4 / P, y, 300);
        point(a, grid, stars[1]!.x, y, 150); point(b, grid, stars[1]!.x, y, 150);
        point(b, grid, x + 8 / P, y + 4 / P, 12);
        b[60 * grid.width + Math.round(x + 5)] = NaN;
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars, { edgeArcsec: 0 });
        expect(r.candidates, measured(r)).toHaveLength(1);
        expect(r.candidates[0]).toMatchObject({ kind: 'unknown', reading: 'pair' });
    });

    it('does not assert a brightening when a hole hides a wobble lobe', () => {
        const a = noise(grid), b = noise(grid), x = 60, y = 60;
        point(a, grid, x, y, 150); point(b, grid, x + 0.8 / P, y, 150);
        const hx = Math.round(x - 4 / P);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) { b[(y + dy) * grid.width + hx + dx] = NaN; }
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 's' }]);
        expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
        expect(r.candidates.every((c) => c.kind === 'unknown'), measured(r)).toBe(true);
    });

    it('does not assert a brightening when a stencil pixel is missing', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        point(a, grid, x, y, 300); point(b, grid, x, y, 300);
        point(b, grid, x + 5.5 / P, y, 12);
        a[60 * grid.width + 61] = NaN;
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 's' }], { minFracChange: 0.01 });
        expect(r.candidates.length, measured(r)).toBeGreaterThan(0);
        expect(r.candidates.every((c) => c.kind === 'unknown'), measured(r)).toBe(true);
    });

    it('can fit two finite star amplitudes when each interpolation stencil has a hole', () => {
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2;
        const second = x + 7 / P;
        point(a, grid, x, y, 100); point(a, grid, second, y, 70);
        point(b, grid, x + 0.8 / P, y, 100); point(b, grid, second, y, 70);
        a[60 * grid.width + Math.floor(x) + 1] = NaN;
        a[60 * grid.width + Math.floor(second) + 1] = NaN;
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 'a' }, { x: second, y, id: 'b' }]);
        expect(r.notes.join(' '), measured(r)).toMatch(/spot consistent with a shift/);
    });
});

describe('round 10 crowded field', () => {
    it('keeps both ends together when crowded neighbours block a confident pair', () => {
        seed = 918273;
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2, P = grid.pixelArcsec;
        const stars = [{ x, y, id: 'a' }, { x: x + 6 / P, y, id: 'b' },
            { x: x + 4 / P, y: y + 7 / P, id: 'c' }, { x: x + 4 / P, y: y - 7 / P, id: 'd' }];
        point(a, grid, x, y, 30); point(b, grid, x, y, 100);
        point(a, grid, x + 6 / P, y, 100); point(b, grid, x + 6 / P, y, 30);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0]).toMatchObject({ kind: 'unknown', reading: 'pair' });
        expect(r.candidates[0]!.ends).toHaveLength(2);
        expect(r.candidates[0]!.sentence).toContain('small shift of one source');
    });
    it('hedges instead of claiming a particular neighbour in a crowded field', () => {
        seed = 918273;
        const a = noise(grid), b = noise(grid), x = 60, y = 60, P = grid.pixelArcsec;
        point(a, grid, x, y, 100); point(b, grid, x, y, 150);
        const stars = [8, 12, 16, 20].map((dx, i) => ({ x: x + dx / P, y, id: `s${i}` }));
        for (const s of stars) { point(a, grid, s.x, s.y, 40); point(b, grid, s.x, s.y, 40); }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
        expect(r.candidates.some((c) => c.kind === 'unknown' && c.reason.includes('crowded')), JSON.stringify(r)).toBe(true);
    });
    it('bounds work on 80 nearby catalogue entries', () => {
        seed = 918273;
        const a = noise(grid), b = noise(grid), x = 60.3, y = 60.2, P = grid.pixelArcsec;
        point(a, grid, x, y, 300); point(b, grid, x + 1 / P, y, 300);
        point(b, grid, x + 10 / P, y, 30);
        const stars = Array.from({ length: 80 }, (_, i) => ({
            x: x + (4 + 24 * Math.sqrt((i + 0.5) / 80)) / P * Math.cos(i * 2.4),
            y: y + (4 + 24 * Math.sqrt((i + 0.5) / 80)) / P * Math.sin(i * 2.4), id: `s${i}`,
        }));
        const start = performance.now(), exp = Math.exp;
        let exponentialCalls = 0;
        Math.exp = (value: number): number => { exponentialCalls++; return exp(value); };
        try {
            compareVisits(image(a, 'a'), image(b, 'b'), grid, stars);
        } finally {
            Math.exp = exp;
        }
        expect(performance.now() - start).toBeLessThan(2500);
        // The uncapped fit performs hundreds of thousands of Gaussian evaluations here; this bound
        // catches that regression without depending on machine load or clock jitter.
        expect(exponentialCalls).toBeLessThan(100000);
    });
});

describe('round 10 count and catalogue wording', () => {
    beforeEach(() => { seed = 918273; });
    it('does not warn about confusion for one id-less star', () => {
        const r = compareVisits(image(noise(grid), 'a'), image(noise(grid), 'b'), grid, [{ x: 60, y: 60 }]);
        expect(r.notes.join(' ')).not.toContain('Catalogue stars have no ids');
    });
    it('does not warn about widely separated id-less stars', () => {
        const r = compareVisits(image(noise(grid), 'a'), image(noise(grid), 'b'), grid, [{ x: 40, y: 60 }, { x: 80, y: 60 }]);
        expect(r.notes.join(' ')).not.toContain('Catalogue stars have no ids');
    });
    it('warns about nearby id-less stars', () => {
        const r = compareVisits(image(noise(grid), 'a'), image(noise(grid), 'b'), grid, [{ x: 60, y: 60 }, { x: 65, y: 60 }]);
        expect(r.notes.join(' ')).toContain('Catalogue stars have no ids');
    });
    it('uses singular for one rejected wobble spot', () => {
        let found = false;
        for (const amplitude of [50, 75, 100, 150, 200]) {
            for (const shift of [0.4, 0.6, 0.8, 1]) {
                seed = 918273;
                const a = noise(grid), b = noise(grid), x = 60, y = 60, P = grid.pixelArcsec;
                point(a, grid, x, y, amplitude); point(b, grid, x + shift / P, y, amplitude);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 's' }]);
                expect(r.notes.join(' ')).not.toContain('1 spots');
                found ||= r.notes.some((note) => note.startsWith('1 spot consistent'));
            }
        }
        expect(found).toBe(true);
    });
});

describe('round 10 neighbour ordering', () => {
    it('does not call a faint catalogue entry brighter because it sits on a bright source wing', () => {
        seed = 918273;
        const a = noise(grid), b = noise(grid), x = 60, y = 60, P = grid.pixelArcsec;
        point(a, grid, x, y, 100); point(b, grid, x, y, 120);
        const faint = { x: x + 6.5 / P, y, id: 'faint' };
        point(a, grid, faint.x, y, 5); point(b, grid, faint.x, y, 5);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [faint]);
        expect(r.candidates.length, JSON.stringify(r)).toBeGreaterThan(0);
        expect(r.candidates.every((c) => !c.reason.includes('brighter catalogue star')), JSON.stringify(r)).toBe(true);
    });
    it('does not change the explanation when catalogue entries are reversed', () => {
        for (const source of [30, 100, 300]) {
            for (const brightAmp of [80, 200, 500]) {
                for (const dist of [10, 15, 19]) {
                    seed = 918273;
                    const a = noise(grid), b = noise(grid), x = 60, y = 60, P = grid.pixelArcsec;
                    point(a, grid, x, y, source); point(b, grid, x, y, source * 1.2);
                    const faint = { x: x + 6.5 / P, y, id: 'faint' }, bright = { x: x + dist / P, y, id: 'bright' };
                    for (const [s, amp] of [[faint, 5], [bright, brightAmp]] as const) {
                        point(a, grid, s.x, s.y, amp); point(b, grid, s.x, s.y, amp);
                    }
                    const first = compareVisits(image(a, 'a'), image(b, 'b'), grid, [faint, bright]);
                    const second = compareVisits(image(a, 'a'), image(b, 'b'), grid, [bright, faint]);
                    expect(first.candidates.map((c) => c.reason), `${source}, ${brightAmp}, ${dist}: ${JSON.stringify(first)}`)
                        .toEqual(second.candidates.map((c) => c.reason));
                }
            }
        }
    });
});

describe('round 10 single-lobe shifts', () => {
    it('does not call a sub-pixel shift a sure brightness change', () => {
        for (const phase of [0, 0.25, 0.5, 0.75]) {
            for (const amplitude of [50, 80, 120]) {
                seed = 918273;
                const a = noise(grid), b = noise(grid), P = grid.pixelArcsec, x = 60 + phase, y = 60.2;
                point(a, grid, x, y, amplitude); point(b, grid, x + 0.45 / P, y, amplitude);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x, y, id: 's' }]);
                expect(r.candidates.every((c) => c.kind === 'unknown'), `${phase}, ${amplitude}: ${JSON.stringify(r)}`).toBe(true);
            }
        }
    });
});
