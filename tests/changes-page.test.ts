import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findChanges } from '../src/lib/change-input';
import { gridPixToSky, gridSkyToPix } from '../src/lib/regrid';
import type { GaiaStar, SkyResult } from '../src/lib/source';
import { positionAt } from '../src/lib/targets';
import type { FrameRecord, OutputGrid, RegriddedFrame } from '../src/lib/types';
// The page's change list goes through changesFor (src/ui/slots.ts), which must ask for the plain list only.
import { changesFor, PAGE_CHANGE_OPTIONS } from '../src/ui/slots';
// Fixtures as in tests/change-input.test.ts.

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

function point(data: Float32Array, x: number, y: number, amplitude: number): void
{
    const s = 12 / 2.35482 / grid.pixelArcsec;
    for (let j = Math.max(0, Math.floor(y - 4 * s)); j <= Math.min(grid.height - 1, Math.ceil(y + 4 * s)); j++) {
        for (let i = Math.max(0, Math.floor(x - 4 * s)); i <= Math.min(grid.width - 1, Math.ceil(x + 4 * s)); i++) {
            data[j * grid.width + i]! += amplitude * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (2 * s * s));
        }
    }
}

function frame(id: string, mjd: number, lambda = 2, data = noise(grid)): RegriddedFrame
{
    const record: FrameRecord = { obsId: id, collection: 'spherex_dr1', release: 'dr1', detector: 1,
        url: '', tMin: mjd, tMax: mjd + 0.01, lambdaMin: 1, lambdaMax: 3 };
    return { frame: record, grid, data, lambdaAtCenter: lambda, bandwidthAtCenter: 0.1 };
}

function sky(frames: RegriddedFrame[], stars: GaiaStar[] = []): SkyResult
{
    return { source: 'snapshot', grid, frames: frames.map((f) => ({ frame: f, label: f.frame.obsId })),
        locked: [], lambda: 2, stars, credits: [], notes: [] };
}

function star(sourceId: string, ra = grid.center.ra, dec = grid.center.dec): GaiaStar
{
    return { sourceId, ra, dec, g: 10, epochJyear: 2016, pix: gridSkyToPix(grid, { ra, dec }) };
}


describe('page change list is the plain list', () => {
    beforeEach(() => { seed = 918273; });

    it('passes plain: true on every page call', () => {
        const find = vi.fn((..._a: Parameters<typeof findChanges>) => findChanges(..._a));
        const a = noise(grid), b = noise(grid);
        point(b, 60, 60, 3000);
        changesFor(sky([frame('a', 60000, 2, a), frame('b', 60030, 2, b)]), find);
        expect(find).toHaveBeenCalledTimes(1);
        expect(find.mock.calls[0]![2]).toEqual({ plain: true });
        expect(PAGE_CHANGE_OPTIONS).toEqual({ plain: true });
    });

    it('only ever lists kind unknown with reading moreLater or lessLater, on the cases the classifier names', () => {
        const firstMjd = 60000, lastMjd = firstMjd + 365.25;
        // A Barnard-shaped mover with listed motion (classifier: mover / moved).
        const pos = gridPixToSky(grid, { x: 57, y: 60 });
        const moving = { ...star('barnard', pos.ra, pos.dec), epochJyear: 2000 + (firstMjd + 0.005 - 51544.5) / 365.25, pmRa: -10300, pmDec: 0 };
        const later = gridSkyToPix(grid, positionAt({ ra: moving.ra, dec: moving.dec, epochJyear: moving.epochJyear,
            pmRa: moving.pmRa, pmDec: moving.pmDec }, lastMjd + 0.005));
        const a = noise(grid), b = noise(grid);
        point(a, 57, 60, 3000); point(b, later.x, later.y, 3000);
        // A catalogue star that fades (classifier: fainter), and new light away from any star (classifier: laterOnly).
        const fade = gridPixToSky(grid, { x: 25, y: 25 });
        point(a, 25, 25, 3000); point(b, 25, 25, 800);
        point(b, 95, 95, 2500);
        const frames = [frame('a', firstMjd, 2, a), frame('b', lastMjd, 2, b)];
        const stars = [moving, star('fade', fade.ra, fade.dec)];
        const page = changesFor(sky(frames, stars))!;
        expect(page.ran).toBe(true);
        expect(page.candidates.length).toBeGreaterThanOrEqual(3);
        for (const c of page.candidates) {
            expect(c.kind).toBe('unknown');
            expect(['moreLater', 'lessLater']).toContain(c.reading);
            expect(c.ends).toHaveLength(1);
        }
        // The classifier would have named some of them, so this is the plain path, not a quiet input.
        const classified = findChanges(sky(frames, stars)).candidates;
        expect(classified.some((c) => c.kind !== 'unknown' || !['moreLater', 'lessLater'].includes(c.reading as string))).toBe(true);
    });
});
