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

function point(data: Float32Array, g: OutputGrid, x: number, y: number, amplitude: number): void
{
    const s = 12 / 2.35482 / g.pixelArcsec;
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
        expect(change!.reason).toBe(`Changed at S/N ${change!.snr.toFixed(1)}; brightness change could not be measured here (candidate).`);
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
            const stars = result.stars.map((s) => gridSkyToPix(result.grid, positionAt({
                ra: s.ra, dec: s.dec, epochJyear: s.epochJyear, pmRa: s.pmRa ?? 0, pmDec: s.pmDec ?? 0,
            }, mid(last))));
            const a = stackVisit(first), b = stackVisit(last);
            const changes = compareVisits({ data: a.data, lambda: first[0]!.lambdaAtCenter, mjd: mid(first),
                obsIds: first.map((f) => f.frame.obsId) },
            { data: b.data, lambda: last[0]!.lambdaAtCenter, mjd: mid(last), obsIds: last.map((f) => f.frame.obsId) },
            result.grid, stars);
            const distance = (p: { x: number; y: number }): number => Math.hypot(p.x - track.x, p.y - track.y) * result.grid.pixelArcsec;
            console.log(`${id}: ${changes.candidates.length} candidates, rejected ${JSON.stringify(changes.rejected)}`);
            for (const c of changes.candidates) {
                console.log(`  ${c.kind} sign=${c.sign} snr=${c.snr.toFixed(1)} frac=${c.fracChange} distance=${distance(c.pix).toFixed(1)}″`);
                expect(c.fracChange === undefined || c.fracChange >= -1).toBe(true);
                expect(c.reason).not.toMatch(/fainter by (1\d\d|[2-9]\d\d)%|\d{3,}% fainter/);
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
                expect(changes.candidates.some((c) => c.kind === 'mover' && distance(c.pix) < 15)).toBe(true);
            }
            expect(changes.candidates.length).toBeLessThanOrEqual(12);
        }, 60000);
    }
});
