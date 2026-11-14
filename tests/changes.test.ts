import { beforeEach, describe, expect, it } from 'vitest';
import { compareVisits, findTracklets, significance } from '../src/lib/changes';
// @ts-expect-error Node types are not included in the browser project.
import { readFileSync } from 'node:fs';
import { createSnapshotSource } from '../src/lib/source';
import { groupByVisit, stackVisit } from '../src/lib/stack';
import { gridSkyToPix } from '../src/lib/regrid';
import { positionAt, targetById } from '../src/lib/targets';
import type { FrameRecord, OutputGrid, RegriddedFrame } from '../src/lib/types';

declare const process: { cwd(): string };

const grid: OutputGrid = { center: { ra: 20, dec: 30 }, fovDeg: 0.1, pixelArcsec: 1.5375, width: 121, height: 121 };

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
                        expect(r.candidates.every((c) => c.fracChange === undefined && c.kind === 'unknown'
                            && /^Either a source moved|either both stars changed or a source moved between them|could not be measured/
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
                .toMatch(/Wavelengths: unknown/);
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
        const r = compareVisits(image(a, 'a', 60000, 2.001), image(b, 'b', 60001, 2.002), grid, []);
        expect(r.notes.join(' ')).toMatch(/2\.001.*2\.002.*µm/);
        expect(r.notes.join(' ')).toContain('each visit is one frame; artefacts not ruled out');
        expect(r.candidates[0]?.reason).toContain('each visit is one frame; artefacts not ruled out');
        expect(r.candidates[0]?.reason).toContain('S/N > 50');
        expect(r.candidates[0]?.reason).toContain('appeared here (candidate)');
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
        point(a, grid, 60, 60, 200); point(b, grid, 60, 60, 150);
        for (let q = 0; q < 12; q++) {
            point(b, grid, 60 + 6 * Math.cos(q * Math.PI / 6), 60 + 6 * Math.sin(q * Math.PI / 6), 10);
        }
        const r = compareVisits(image(a, 'a'), { ...image(b, 'b'), obsIds: ['b', 'b2'] }, grid, [{ x: 60, y: 60 }]);
        const negative = r.candidates.find((c) => c.sign === -1);
        expect(negative).toBeDefined();
        expect(negative!.fracChange).toBeUndefined();
        expect(negative!.reason).toMatch(/could not be measured/);
        for (const c of r.candidates) {
            if (c.fracChange !== undefined) {
                expect(Math.sign(c.fracChange)).toBe(c.sign);
            }
            expect(c.sign === -1 && /brighter/.test(c.reason)).toBe(false);
            expect(c.sign === 1 && /fainter/.test(c.reason)).toBe(false);
        }
    });

    it('says a new source appeared (finding 14)', () => {
        const a = noise(grid), b = noise(grid);
        injectSnr(a, b, grid, 60, 60, 20);
        const r = compareVisits({ ...image(a, 'a'), obsIds: ['a', 'a2'] }, { ...image(b, 'b'), obsIds: ['b', 'b2'] }, grid, []);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0]!.reason).toContain('appeared here (candidate)');
        expect(r.candidates[0]!.reason).not.toMatch(/could not be measured/);
        expect(r.candidates[0]!.reason).not.toContain('artefacts not ruled out');
    });

    it('writes S/N > 50 in every kind of reason (finding 9)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 30, 30, 200); point(b, grid, 30, 30, 120);           // fade, catalogue star
        point(a, grid, 90, 30, 300); point(b, grid, 96, 30, 300);           // mover, 9″
        point(b, grid, 60, 90, 300);                                         // appeared
        const stars = [{ x: 30, y: 30 }, { x: 90, y: 30 }, { x: 96, y: 30 }];
        const r = compareVisits({ ...image(a, 'a'), obsIds: ['a', 'a2'] }, { ...image(b, 'b'), obsIds: ['b', 'b2'] }, grid, stars);
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
        expect([...kinds].sort()).toEqual(['brightness', 'mover', 'mover-track', 'unknown']);
        for (const c of all.filter((c) => c.snr > 50)) {
            expect(c.reason).toContain('S/N > 50');
            expect(c.reason).not.toMatch(/S\/N (5\d|[6-9]\d|\d{3,})/);
        }
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
            count += compareVisits({ ...image(a, 'a'), variance }, { ...image(b, 'b'), variance }, grid, []).candidates.length;
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
            blind += r.candidates.length;
            understated += compareVisits({ ...image(a, 'a'), variance: lowVariance },
                { ...image(b, 'b'), variance: lowVariance }, grid, []).candidates.length;
        }
        console.log(`Noisy patch, 30 trials: ${count} correct map, ${blind} no map, ${understated} understated map`);
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

    it('reports rounded cutoff percentages', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 200); point(b, grid, 60, 60, 210);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60 }], { minFracChange: 0.07 });
        expect(r.notes.join(' ')).toContain('under 7% change');
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
        expect(r.candidates.filter((c) => c.kind === 'mover')).toHaveLength(1);
    });

    it('pairs a mover past a nearer edge spot', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 20, 60, 300); point(b, grid, 12, 60, 300);
        point(a, grid, 5, 60, 1000); point(b, grid, 5, 60, 700);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 5, y: 60, id: 's' }]);
        expect(r.candidates.filter((c) => c.kind === 'mover')).toHaveLength(1);
    });

    it('pairs a catalogue mover with its own entry before a nearer uncatalogued spot', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 66, 60, 400); point(b, grid, 60, 60, 400);
        point(a, grid, 60 - 4.5 / grid.pixelArcsec, 62, 150);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 66, y: 60, id: 'm' }, { x: 60, y: 60, id: 'm' }]);
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
            expect(r.candidates).toHaveLength(2);
            expect(r.candidates.every((c) => c.fracChange === undefined || Math.abs(c.fracChange) > 0.45)).toBe(true);
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
        expect(r.candidates.some((c) => /no catalogue star here|appeared/.test(c.reason))).toBe(false);
    });

    it('keeps a brightening star that also shifts 2.9 arcsec', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 1000); point(b, grid, 60 - 2.9 / grid.pixelArcsec, 60, 1150);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }]);
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(r.candidates.some((c) => /no catalogue star here|appeared/.test(c.reason))).toBe(false);
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
                        [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]).candidates.length;
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
            claims += compareVisits(image(a, 'a'), image(b, 'b'), grid, stars).candidates.length;
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
                if (r.candidates.some((c) => c.kind === 'mover' || /Source centroids shifted/.test(c.reason))) {
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
        expect(r.candidates[0]!.fracChange).toBeUndefined();
        expect(r.candidates[0]!.reason).toMatch(/^Either a source moved between two catalogue stars 15\.0″ apart, or one got brighter and the other fainter; these look the same here/);
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
                            if (c.fracChange !== undefined || /\d+% (brighter|fainter)/.test(c.reason) || c.kind === 'mover') {
                                claims.push(`${separation}″ ${starAmplitude}/${moverAmplitude} ${offset}″: ${c.reason}`);
                            }
                        }
                    }
                }
            }
        }
        expect(claims).toEqual([]);
        // Lost: a faint source on 500-count stars 10″ apart whose two positions are only 2-4″ apart (under the
        // 3″ shift needed to pair, and under 10% of the stars' light). A miss, not a wrong label.
        expect(lost.length, lost.join(', ')).toBeLessThanOrEqual(2);
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
            expect(spot[0]!.fracChange, `${d}″`).toBeUndefined();
            expect(spot[0]!.reason, `${d}″`).not.toMatch(/appeared|\d+% (brighter|fainter)/);
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
                if (!c.gaiaMatch && (c.fracChange !== undefined || /appeared/.test(c.reason))) {
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
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60 + 13 / P, y: 60, id: 'm' }, { x: 60, y: 60, id: 'm' }]);
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
    it('rejects a weak wing leftover near a much stronger change', () => {
        const earlier = noise(grid), later = noise(grid);
        point(later, grid, 55, 60, 1000);
        point(earlier, grid, 69, 60, 25);
        const result = compareVisits(image(earlier, 'a'), image(later, 'b'), grid, []);
        expect(result.candidates).toHaveLength(1);
        expect(result.rejected.residual).toBeGreaterThanOrEqual(1);
        expect(result.notes.join(' ')).toMatch(/shadow/i);
    });

    it('does not quantify a change when the later aperture flux is negative', () => {
        const earlier = noise(grid), later = noise(grid);
        point(earlier, grid, 60, 60, 30);
        point(later, grid, 60, 60, -20);
        const result = compareVisits(image(earlier, 'a'), image(later, 'b'), grid, [{ x: 60, y: 60 }]);
        const change = result.candidates.find((c) => near(60, 60, c));
        expect(change).toBeDefined();
        expect(change!.fracChange).toBeUndefined();
        expect(change!.kind).toBe('unknown');
        expect(change!.reason).toContain(`brightness change could not be measured here (candidate).`);
        expect(change!.reason).toContain('each visit is one frame; artefacts not ruled out');
    });

    it('ignores small changes in bright sources and measures substantial changes', () => {
        const earlier = noise(grid), small = noise(grid), large = noise(grid);
        point(earlier, grid, 60, 60, 200);
        point(small, grid, 60, 60, 206);
        point(large, grid, 60, 60, 260);
        const ignored = compareVisits(image(earlier, 'a'), image(small, 'b'), grid, [{ x: 60, y: 60 }]);
        expect(ignored.candidates).toHaveLength(0);
        expect(ignored.rejected.residual).toBeGreaterThanOrEqual(1);
        expect(ignored.notes.join(' ')).toMatch(/small leftovers.*under 10%/);
        const kept = compareVisits(image(earlier, 'a'), image(large, 'b'), grid, [{ x: 60, y: 60 }]);
        expect(kept.candidates[0]?.kind).toBe('brightness');
        expect(kept.candidates[0]!.fracChange).toBeGreaterThan(0.27);
        expect(kept.candidates[0]!.fracChange).toBeLessThan(0.33);
        expect(kept.candidates[0]!.reason).toMatch(/30% brighter/);
        const custom = compareVisits(image(earlier, 'a'), image(small, 'b'), grid, [], { minFracChange: 0.01 });
        expect(custom.candidates[0]?.kind).toBe('unknown');
        expect(custom.candidates[0]?.fracChange).toBeGreaterThan(0.01);
        expect(custom.candidates[0]?.reason).toMatch(/% brighter/);
        const strict = compareVisits(image(earlier, 'a'), image(large, 'b'), grid, [], { minFracChange: 0.4 });
        expect(strict.candidates).toHaveLength(0);
        expect(strict.notes.join(' ')).toContain('under 40% change');
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
        expect(r.candidates.some((c) => c.kind === 'brightness' && c.sign === 1 && c.gaiaMatch && near(x, y, c))).toBe(true);
        const faded = noise(grid), original = noise(grid);
        staticSky(original, faded, grid);
        point(original, grid, x, y, 30);
        point(faded, grid, x, y, 21);
        r = compareVisits(image(original, 'a'), image(faded, 'b'), grid, [{ x, y }]);
        expect(r.candidates.some((c) => c.kind === 'brightness' && c.sign === -1 && near(x, y, c))).toBe(true);
        const before = noise(grid), after = noise(grid);
        staticSky(before, after, grid);
        injectSnr(before, after, grid, x, y, 8);
        r = compareVisits(image(before, 'a'), image(after, 'b'), grid, []);
        expect(r.candidates.some((c) => c.kind === 'unknown' && near(x, y, c))).toBe(true);
        expect(r.candidates.find((c) => near(x, y, c))?.fracChange).toBeUndefined();
        const left = noise(grid), right = noise(grid);
        staticSky(left, right, grid);
        point(left, grid, x - 3, y, 30);
        point(right, grid, x + 3, y, 30);
        r = compareVisits(image(left, 'a'), image(right, 'b'), grid, []);
        expect(r.candidates.filter((c) => c.kind === 'mover')).toHaveLength(1);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates.every((c) => !/discover|detected|found an asteroid/i.test(c.reason))).toBe(true);
    });

    it('measures the noise false-alarm rate on 200 independent fields', () => {
        const g = { ...grid, width: 361, height: 361 };
        let count = 0;
        for (let i = 0; i < 200; i++) {
            count += compareVisits(image(noise(g), 'a'), image(noise(g), 'b'), g, []).candidates.length;
        }
        console.log(`False candidates per trial: ${count / 200} (${count}/200)`);
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
        expect(edge.candidates).toHaveLength(0);
        expect(edge.rejected.edge).toBeGreaterThan(0);
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
            const stars = [mid(first), mid(last)].flatMap((date) => result.stars.map((s) => ({ ...gridSkyToPix(result.grid, positionAt({
                ra: s.ra, dec: s.dec, epochJyear: s.epochJyear, pmRa: s.pmRa ?? 0, pmDec: s.pmDec ?? 0,
            }, date)), id: s.sourceId })));
            const a = stackVisit(first), b = stackVisit(last);
            const changes = compareVisits({ data: a.data, lambda: first[0]!.lambdaAtCenter, mjd: mid(first),
                obsIds: first.map((f) => f.frame.obsId) },
            { data: b.data, lambda: last[0]!.lambdaAtCenter, mjd: mid(last), obsIds: last.map((f) => f.frame.obsId) },
            result.grid, stars);
            const distance = (p: { x: number; y: number }): number => Math.hypot(p.x - track.x, p.y - track.y) * result.grid.pixelArcsec;
            console.log(`${id}: ${changes.candidates.length} candidates, rejected ${JSON.stringify(changes.rejected)}`);
            for (const c of changes.candidates) {
                console.log(`  ${c.kind} sign=${c.sign} snr=${c.snr.toFixed(1)} frac=${c.fracChange} distance=${distance(c.pix).toFixed(1)}″ ${c.reason}`);
                expect(c.fracChange === undefined || c.fracChange >= -1).toBe(true);
                expect(c.reason).not.toMatch(/fainter by (1\d\d|[2-9]\d\d)%|\d{3,}% fainter/);
                if (c.kind === 'mover' && c.gaiaMatch) {
                    const shift = c.reason.match(/shifted ([\d.]+)″/);
                    expect(shift).not.toBeNull();
                    expect(Number(shift![1])).toBeGreaterThanOrEqual(3);
                }
            }
            if (id === 'rwaur') {
                const best = changes.candidates.find((c) => c.kind === 'brightness');
                expect(best).toBeDefined();
                expect(distance(best!.pix)).toBeLessThan(6);
                expect(best!.sign).toBe(1);
                expect(best!.fracChange).toBeGreaterThan(0.25);
                expect(best!.fracChange).toBeLessThan(0.8);
            }
            if (id === 'epsindb') {
                const mover = changes.candidates.find((c) => c.kind === 'mover' && distance(c.pix) < 15);
                expect(mover).toBeDefined();
                const shift = Number(mover!.reason.match(/shifted ([\d.]+)″/)?.[1]);
                expect(shift).toBeGreaterThanOrEqual(4);
                expect(shift).toBeLessThanOrEqual(8);
            }
        }, 60000);
    }
});

// Round 7 (Opus and Argon round 6 reviews): a percentage or a confident label only for an isolated change;
// everything else gets one hedged sentence.
describe('change finder, round 7: no number where a neighbour or an edge is in the aperture', () => {
    beforeEach(() => { seed = 918273; });
    const P = grid.pixelArcsec;
    const pct = /\d+% (brighter|fainter)/;
    const numbered = (r: ReturnType<typeof compareVisits>) => r.candidates
        .filter((c) => c.fracChange !== undefined || pct.test(c.reason)).map((c) => c.reason);

    it('quotes no percentage for two steady stars 11″ apart under a 1.4″ wobble, 8 directions (Opus High 1)', () => {
        const claims: string[] = [];
        for (let k = 0; k < 8; k++) {
            const t = k * Math.PI / 4, wx = 1.4 * Math.cos(t) / P, wy = 1.4 * Math.sin(t) / P;
            const a = noise(grid), b = noise(grid);
            const x1 = 60 - 5.5 / P, x2 = 60 + 5.5 / P;
            point(a, grid, x1, 60, 3000); point(a, grid, x2, 60, 1500);
            point(b, grid, x1 + wx, 60 + wy, 3000); point(b, grid, x2 + wx, 60 + wy, 1500);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
            claims.push(...numbered(r).map((s) => `${k * 45}°: ${s}`));
        }
        expect(claims).toEqual([]);
    });

    it('quotes no percentage and no "appeared" for an uncatalogued mover 15-24″ from the edge (Opus High 3, G1)', () => {
        const claims: string[] = [];
        for (const edge of [15, 18, 21, 24]) {
            for (const step of [8, 12]) {
                const a = noise(grid), b = noise(grid);
                point(a, grid, edge / P, 60, 1000); point(b, grid, (edge + step) / P, 60, 1000);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
                claims.push(...r.candidates.filter((c) => c.fracChange !== undefined || pct.test(c.reason) || /appeared/.test(c.reason))
                    .map((c) => `${edge}″ +${step}″: ${c.reason}`));
            }
        }
        expect(claims).toEqual([]);
    });

    it('quotes no percentage on either star when one brightens 50% beside an equal steady star 12″ away (Opus High 2)', () => {
        const a = noise(grid), b = noise(grid);
        const x1 = 60 - 6 / P, x2 = 60 + 6 / P;
        point(a, grid, x1, 60, 2000); point(b, grid, x1, 60, 3000);
        point(a, grid, x2, 60, 2000); point(b, grid, x2, 60, 2000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(numbered(r)).toEqual([]);
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

    it('quotes no percentage for a mover 5.4″ off the line between two steady stars 8″ apart (Argon H2)', () => {
        const claims: string[] = [];
        for (const off of [4.5, 5.4, 5.9]) {
            for (const amp of [170, 400]) {
                const a = noise(grid), b = noise(grid);
                const xa = 60 - 4 / P, xb = 60 + 4 / P;
                point(a, grid, xa, 60, 1000); point(b, grid, xa, 60, 1000);
                point(a, grid, xb, 60, 1000); point(b, grid, xb, 60, 1000);
                point(a, grid, xa, 60 + off / P, amp); point(b, grid, xb, 60 + off / P, amp);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: xa, y: 60, id: 'a' }, { x: xb, y: 60, id: 'b' }]);
                claims.push(...numbered(r).map((s) => `${off}″ ${amp}: ${s}`));
            }
        }
        expect(claims).toEqual([]);
    });

    it('quotes no percentage for an uncatalogued source that moves 16-22″ (Argon M4)', () => {
        const claims: string[] = [];
        for (const step of [16, 19, 22]) {
            const a = noise(grid), b = noise(grid);
            point(a, grid, 60 - step / 2 / P, 60, 1000); point(b, grid, 60 + step / 2 / P, 60, 1000);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
            claims.push(...numbered(r).map((s) => `${step}″: ${s}`));
        }
        expect(claims).toEqual([]);
    });

    it('quotes no percentage when the earlier background has no scatter (Argon M4, noise 0)', () => {
        const a = new Float32Array(grid.width * grid.height), b = noise(grid);
        point(a, grid, 60, 60, 1e-3);
        point(b, grid, 60, 60, 300);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.candidates.filter((c) => c.fracChange !== undefined).map((c) => c.reason)).toEqual([]);
    });

    it('does not offer the either/or for two catalogue stars 0.5″ apart that a source crosses (Argon M5)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60 - 3 / P, 60, 1000); point(b, grid, 60 + 3.5 / P, 60, 1000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 'a' }, { x: 60 + 0.5 / P, y: 60, id: 'b' }]);
        expect(r.candidates.map((c) => c.reason).filter((s) => /0\.5″ apart/.test(s))).toEqual([]);
    });

    it('quotes no percentage on a faint star 8″ from a 100x brighter one under a 1.4″ wobble (Argon M6)', () => {
        const claims: string[] = [];
        for (let k = 0; k < 8; k++) {
            const t = k * Math.PI / 4, wx = 1.4 * Math.cos(t) / P, wy = 1.4 * Math.sin(t) / P;
            const a = noise(grid), b = noise(grid);
            const x2 = 60 + 8 / P;
            point(a, grid, 60, 60, 5000); point(b, grid, 60 + wx, 60 + wy, 5000);
            point(a, grid, x2, 60, 50); point(b, grid, x2 + wx, 60 + wy, 50);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
            claims.push(...numbered(r).map((s) => `${k * 45}°: ${s}`));
        }
        expect(claims).toEqual([]);
    });

    it('does not say "appeared" for a new source 20″ from a catalogue star (Argon L7)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 3000); point(b, grid, 60, 60, 3000);
        point(b, grid, 60 + 20 / P, 60, 300);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 's' }]);
        const spot = r.candidates.filter((c) => near(60 + 20 / P, 60, c, 6));
        expect(spot).toHaveLength(1);
        expect(spot[0]!.reason).not.toMatch(/appeared|\d+% (brighter|fainter)/);
    });

    it('quotes a percentage beside a steady neighbour only within 15% of the true change, and keeps it for faint ones', () => {
        // Pins the crowd rule's NEIGHBOUR = 0.25 from both sides: at 0.5 a 0.3x neighbour 8″ away lets "41%"
        // through for a 50% change; at 0.05 a 0.1x neighbour already hides a measurable change.
        const wrong: string[] = [];
        for (const ratio of [0.05, 0.1, 0.2, 0.3, 0.4]) {
            for (const d of [8, 12, 18]) {
                const a = noise(grid), b = noise(grid);
                const x1 = 60 - d / 2 / P, x2 = 60 + d / 2 / P;
                point(a, grid, x1, 60, 2000); point(b, grid, x1, 60, 3000);
                point(a, grid, x2, 60, 2000 * ratio); point(b, grid, x2, 60, 2000 * ratio);
                const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
                const quoted = r.candidates.filter((c) => c.fracChange !== undefined);
                for (const c of quoted) {
                    if (!near(x1, 60, c, 6) || Math.abs(c.fracChange! - 0.5) > 0.075) {
                        wrong.push(`${ratio}x at ${d}″: ${c.reason}`);
                    }
                }
                if (ratio <= 0.1 && quoted.length !== 1) {
                    wrong.push(`${ratio}x at ${d}″: percentage lost`);
                }
            }
        }
        expect(wrong).toEqual([]);
    });

    it('quotes no wrong percentage when a faint neighbour 8″ away brightens too (Codex round 7)', () => {
        const a = noise(grid), b = noise(grid);
        const x1 = 60 - 4 / P, x2 = 60 + 4 / P;
        point(a, grid, x1, 60, 2000); point(b, grid, x1, 60, 3000);
        point(a, grid, x2, 60, 200); point(b, grid, x2, 60, 1000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: x1, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(numbered(r)).toEqual([]);
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

    it('adds up neighbours: two at 0.2x each, 8″ either side, hide the percentage (Codex round 7)', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 2000); point(b, grid, 60, 60, 3000);
        for (const x of [60 - 8 / P, 60 + 8 / P]) {
            point(a, grid, x, 60, 400); point(b, grid, x, 60, 400);
        }
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid,
            [{ x: 60, y: 60, id: 'a' }, { x: 60 - 8 / P, y: 60, id: 'l' }, { x: 60 + 8 / P, y: 60, id: 'r' }]);
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(numbered(r)).toEqual([]);
    });

    it('does not say "appeared" for a source that was there before on a background with no scatter (Codex round 7)', () => {
        const a = new Float32Array(grid.width * grid.height), b = noise(grid);
        point(a, grid, 60, 60, 2000); point(b, grid, 60, 60, 3000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, []);
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(r.candidates.map((c) => c.reason).filter((s) => /appeared/.test(s))).toEqual([]);
    });

    it('counts a neighbour listed for both visits once (Codex round 7)', () => {
        const a = noise(grid), b = noise(grid);
        const x2 = 60 + 8 / P;
        point(a, grid, 60, 60, 2000); point(b, grid, 60, 60, 3000);
        point(a, grid, x2, 60, 200); point(b, grid, x2, 60, 200);
        const once = [{ x: 60, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }];
        const twice = [...once, { x: 60 + 0.1 / P, y: 60, id: 'a' }, { x: x2 + 0.1 / P, y: 60, id: 'b' }];
        const quoted = (stars: typeof once) => compareVisits(image(a, 'a'), image(b, 'b'), grid, stars)
            .candidates.filter((c) => c.fracChange !== undefined).length;
        expect(quoted(once)).toBe(1);
        expect(quoted(twice)).toBe(1);
    });

    it('quotes no wrong percentage when a faint neighbour changes a lot but stays faint (Codex round 7)', () => {
        // At 8″ the later-visit level check already hides it; at 7″ and 12″ only the change check does (81%, 74%
        // without it). A neighbour that fades instead is the blend rule's.
        const wrong: string[] = [];
        for (const [d, n0, n1] of [[7, 20, 700], [8, 20, 700], [12, 20, 700], [7, 50, 900], [12, 700, 20], [8, 900, 50]]) {
            const a = noise(grid), b = noise(grid);
            const x2 = 60 + d! / P;
            point(a, grid, 60, 60, 2000); point(b, grid, 60, 60, 3000);
            point(a, grid, x2, 60, n0!); point(b, grid, x2, 60, n1!);
            const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 'a' }, { x: x2, y: 60, id: 'b' }]);
            expect(r.candidates.length, `${d}″`).toBeGreaterThan(0);
            wrong.push(...r.candidates.filter((c) => c.fracChange !== undefined && Math.abs(c.fracChange - 0.5) > 0.075)
                .map((c) => `${d}″: ${c.reason}`));
        }
        expect(wrong).toEqual([]);
    });

    it('still quotes the percentage for an isolated star that brightens 50%', () => {
        const a = noise(grid), b = noise(grid);
        point(a, grid, 60, 60, 2000); point(b, grid, 60, 60, 3000);
        const r = compareVisits(image(a, 'a'), image(b, 'b'), grid, [{ x: 60, y: 60, id: 'a' }]);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0]!.fracChange!).toBeGreaterThan(0.4);
        expect(r.candidates[0]!.fracChange!).toBeLessThan(0.6);
    });
});
