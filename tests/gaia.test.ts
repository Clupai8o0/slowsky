import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    GaiaError, fetchGaia, parallaxLimitArcsec, parseStsciCsv, parseVizierTsv, ringsAt, shiftReadout, starAt, stsciConeUrl, vizierConeUrl,
} from '../src/lib/gaia';
import type { GaiaRow } from '../src/lib/gaia';
import { separationDeg } from '../src/lib/coords';
import { gridPixToSky, gridSkyToPix } from '../src/lib/regrid';
import { positionAt } from '../src/lib/targets';
import type { Astrometry, OutputGrid } from '../src/lib/types';

const BARNARD_ID = '4472832130942575872';
const BARNARD_ROW = `${BARNARD_ID}\t269.44850252544\t+04.73942005111\t-801.551\t10362.394\t546.9759\t8.193974`;
const BARNARD: GaiaRow = {
    sourceId: BARNARD_ID, ra: 269.44850252544, dec: 4.73942005111, g: 8.193974,
    pmRa: -801.551, pmDec: 10362.394, parallax: 546.9759, epochJyear: 2016,
};
const MJD_2016 = 57388.5;

function stsciText(): string
{
    return [
        '# Gaia DR3 cone search',
        '# generated for the test',
        'parallax,source_id,phot_g_mean_mag,dec,ra,pmdec,pmra,ref_epoch,designation',
        `546.9759,${BARNARD_ID},8.193974,4.73942005111,269.44850252544,10362.394,-801.551,2016.0,Gaia DR3 1`,
        ',1000000000000000002,15.5,4.7,269.5,,,2016.0,"Gaia, DR3 2"',
        '1.0,1000000000000000003,19.4,4.8,269.6,1.0,2.0,2016.0,faint',
        '1.0,1000000000000000004,,4.8,269.6,1.0,2.0,2016.0,nog',
        '1.0,1000000000000000005,12.0,,269.6,1.0,2.0,2016.0,nodec',
    ].join('\n');
}

function vizierText(rows: string[]): string
{
    return [
        '#\n# VizieR mirror\n#',
        'Source\tRA_ICRS\tDE_ICRS\tpmRA\tpmDE\tPlx\tGmag',
        '\tdeg\tdeg\tmas/yr\tmas/yr\tmas\tmag',
        '---\t---\t---\t---\t---\t---\t---',
        ...rows,
        '',
        '#END',
    ].join('\n');
}

function reply(body: string, status = 200): Response
{
    return new Response(body, { status });
}

afterEach(() => {
    vi.useRealTimers();
});

describe('URLs', () => {
    it('match the documented forms', () => {
        const c = { ra: 269.4485, dec: 4.7394 };
        expect(stsciConeUrl(c, 0.05)).toBe('https://gsss.stsci.edu/webservices/vo/CatalogSearch.aspx'
            + '?CAT=GAIADR3&RA=269.448500&DEC=4.739400&SR=0.050000&FORMAT=CSV');
        expect(vizierConeUrl(c, 0.05)).toBe('https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=I/355/gaiadr3'
            + '&-c=269.448500%20%2B4.739400&-c.rd=0.050000'
            + '&-out=Source,RA_ICRS,DE_ICRS,pmRA,pmDE,Plx,Gmag&-out.max=unlimited&Gmag=%3C19');
        expect(vizierConeUrl(c, 0.05, 15)).toContain('&Gmag=%3C15');
    });

    it('keep the minus sign of a negative Dec', () => {
        const url = vizierConeUrl({ ra: 10, dec: -4.5 }, 0.05);
        expect(url).toContain('&-c=10.000000%20-4.500000&');
        expect(url).not.toContain('%2B');
        expect(stsciConeUrl({ ra: 10, dec: -4.5 }, 0.05)).toContain('DEC=-4.500000');
    });

    it('reject a bad RA, Dec or radius', () => {
        const ok = { ra: 10, dec: 10 };
        expect(() => stsciConeUrl({ ra: 360, dec: 0 }, 0.05)).toThrow(GaiaError);
        expect(() => stsciConeUrl({ ra: -1, dec: 0 }, 0.05)).toThrow(GaiaError);
        expect(() => vizierConeUrl({ ra: 10, dec: 90.5 }, 0.05)).toThrow(GaiaError);
        expect(() => vizierConeUrl({ ra: 10, dec: Number.NaN }, 0.05)).toThrow(GaiaError);
        expect(() => stsciConeUrl(ok, 0)).toThrow(GaiaError);
        expect(() => stsciConeUrl(ok, 0.21)).toThrow(GaiaError);
        expect(() => vizierConeUrl(ok, 0.2)).not.toThrow();
    });

    it('never write a small radius as 0', () => {
        const ok = { ra: 10, dec: 10 };
        expect(stsciConeUrl(ok, 0.00001)).toContain('&SR=0.000010&');
        expect(vizierConeUrl(ok, 0.00001)).toContain('&-c.rd=0.000010&');
        expect(() => stsciConeUrl(ok, 1e-7)).toThrow(GaiaError);
        expect(() => vizierConeUrl(ok, 1e-7)).toThrow(GaiaError);
    });
});

describe('parseStsciCsv', () => {
    it('finds columns by name, skips faint and broken rows, leaves off empty fields', () => {
        const rows = parseStsciCsv(stsciText());
        expect(rows).toHaveLength(2);
        const [barnard, quiet] = rows;
        expect(barnard?.sourceId).toBe(BARNARD_ID);
        expect(barnard?.sourceId).toHaveLength(19);
        expect(barnard).toMatchObject({ ra: 269.44850252544, dec: 4.73942005111, g: 8.193974,
            pmRa: -801.551, pmDec: 10362.394, parallax: 546.9759, epochJyear: 2016 });
        expect(quiet?.sourceId).toBe('1000000000000000002');
        expect(quiet).not.toHaveProperty('pmRa');
        expect(quiet).not.toHaveProperty('pmDec');
        expect(quiet).not.toHaveProperty('parallax' + 'X');
        expect(Object.values(quiet ?? {}).every((v) => v !== undefined && !Number.isNaN(v))).toBe(true);
    });

    it('respects gMax and defaults the epoch', () => {
        expect(parseStsciCsv(stsciText(), 10)).toHaveLength(1);
        const text = 'source_id,ra,dec,phot_g_mean_mag\n7,1.5,2.5,11\n';
        expect(parseStsciCsv(text)[0]).toEqual({ sourceId: '7', ra: 1.5, dec: 2.5, g: 11, epochJyear: 2016 });
    });

    it('throws when a needed column or the header is missing, and gives [] for header only', () => {
        expect(() => parseStsciCsv('source_id,ra,phot_g_mean_mag\n1,2,3')).toThrow(GaiaError);
        expect(() => parseStsciCsv('# only comments\n')).toThrow(GaiaError);
        expect(parseStsciCsv('# c\nsource_id,ra,dec,phot_g_mean_mag\n')).toEqual([]);
    });
});

describe('parseVizierTsv', () => {
    it('reads the Barnard row', () => {
        const rows = parseVizierTsv(vizierText([BARNARD_ROW]));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(BARNARD);
        expect(rows[0]?.sourceId).toBe(BARNARD_ID);
    });

    it('leaves off blank proper motions and stops at the blank line', () => {
        const blank = '1000000000000000002\t10.5\t-2.5\t          \t          \t          \t15.2';
        const rows = parseVizierTsv(vizierText([BARNARD_ROW, blank]));
        expect(rows).toHaveLength(2);
        expect(rows[1]).not.toHaveProperty('pmRa');
        expect(rows[1]).not.toHaveProperty('pmDec');
        expect(rows[1]).not.toHaveProperty('parallax');
        expect(rows[1]?.g).toBe(15.2);
        expect(parseVizierTsv(vizierText([]))).toEqual([]);
    });

    it('throws without a header', () => {
        expect(() => parseVizierTsv('# nothing here\n\n')).toThrow(GaiaError);
    });
});

describe('fetchGaia', () => {
    const c = { ra: 269.4485, dec: 4.7394 };
    const vizierGood = (): Response => reply(vizierText([BARNARD_ROW]));

    it('uses STScI when it answers', async () => {
        const fetcher = vi.fn(async () => reply(stsciText())) as unknown as typeof fetch;
        const out = await fetchGaia(c, 0.05, { fetcher });
        expect(out.from).toBe('stsci');
        expect(out.rows.map((r) => r.g)).toEqual([8.193974, 15.5]);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(vi.mocked(fetcher).mock.calls[0]?.[1]).toEqual({ signal: expect.any(AbortSignal) });
    });

    it('falls back to VizieR on a 503', async () => {
        const fetcher = vi.fn(async (url: RequestInfo | URL) => {
            return String(url).includes('stsci') ? reply('down', 503) : vizierGood();
        }) as unknown as typeof fetch;
        const out = await fetchGaia(c, 0.05, { fetcher });
        expect(out.from).toBe('vizier-cfa');
        expect(out.rows).toHaveLength(1);
    });

    it('sends the requested strict brightness cut to the VizieR fallback', async () => {
        const fetcher = vi.fn(async (url: RequestInfo | URL) => {
            return String(url).includes('stsci') ? reply('down', 503) : vizierGood();
        }) as unknown as typeof fetch;
        await fetchGaia(c, 0.05, { fetcher, gMax: 15 });
        const url = new URL(String(vi.mocked(fetcher).mock.calls[1]?.[0]));
        expect(url.searchParams.get('Gmag')).toBe('<15');
    });

    it('falls through when STScI has 0 rows', async () => {
        const fetcher = vi.fn(async (url: RequestInfo | URL) => {
            return String(url).includes('stsci') ? reply('source_id,ra,dec,phot_g_mean_mag\n') : vizierGood();
        }) as unknown as typeof fetch;
        expect((await fetchGaia(c, 0.05, { fetcher })).from).toBe('vizier-cfa');
    });

    it('describes two empty responses without claiming either service failed', async () => {
        const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes('stsci')
            ? reply('source_id,ra,dec,phot_g_mean_mag\n') : reply(vizierText([]))) as unknown as typeof fetch;
        await expect(fetchGaia(c, 0.05, { fetcher })).rejects.toThrow(
            'No Gaia star was found in this area by either service.');
    });

    it('distinguishes an empty response from a failed service', async () => {
        for (const failing of ['stsci', 'vizier']) {
            const fetcher = vi.fn(async (url: RequestInfo | URL) => {
                const isStsci = String(url).includes('stsci');
                if (isStsci === (failing === 'stsci')) {
                    return reply('down', 503);
                }
                return reply(isStsci ? 'source_id,ra,dec,phot_g_mean_mag\n' : vizierText([]));
            }) as unknown as typeof fetch;
            const err = await fetchGaia(c, 0.05, { fetcher }).catch((e: unknown) => e) as Error;
            expect(err.message).toContain('503');
            expect(err.message).toContain('returned no stars');
            expect(err.message.match(/failed/g)).toHaveLength(1);
        }
    });

    it('throws a GaiaError naming both failures', async () => {
        const fetcher = vi.fn(async (url: RequestInfo | URL) => {
            return String(url).includes('stsci') ? reply('nope', 500) : reply('not a table');
        }) as unknown as typeof fetch;
        const err = await fetchGaia(c, 0.05, { fetcher }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(GaiaError);
        expect((err as Error).message).toContain('STScI');
        expect((err as Error).message).toContain('VizieR');
        expect((err as Error).message).toContain('500');
    });

    it('stops at once on an aborted signal and never calls VizieR', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetcher = vi.fn(async () => vizierGood()) as unknown as typeof fetch;
        await expect(fetchGaia(c, 0.05, { fetcher, signal: controller.signal })).rejects.toBe(controller.signal.reason);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('stops without fallback when the abort comes during the STScI call', async () => {
        const controller = new AbortController();
        const urls: string[] = [];
        const fetcher = ((url: RequestInfo | URL) => {
            urls.push(String(url));
            return new Promise<Response>(() => undefined);
        }) as unknown as typeof fetch;
        const pending = fetchGaia(c, 0.05, { fetcher, signal: controller.signal });
        const caught = pending.catch((e: unknown) => e);
        controller.abort();
        expect(await caught).toBe(controller.signal.reason);
        expect(urls).toHaveLength(1);
    });

    it('falls through after timeoutMs when STScI never answers', async () => {
        vi.useFakeTimers();
        const urls: string[] = [];
        const fetcher = ((url: RequestInfo | URL) => {
            urls.push(String(url));
            return String(url).includes('stsci') ? new Promise<Response>(() => undefined) : Promise.resolve(vizierGood());
        }) as unknown as typeof fetch;
        const pending = fetchGaia(c, 0.05, { fetcher, timeoutMs: 1000 });
        await vi.advanceTimersByTimeAsync(999);
        expect(urls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(2);
        const out = await pending;
        expect(out.from).toBe('vizier-cfa');
        expect(urls).toHaveLength(2);
    });

    it('sorts brightest first and caps at maxRows', async () => {
        const lines = ['source_id,ra,dec,phot_g_mean_mag'];
        for (let i = 0; i < 10; i++) {
            lines.push(`${i + 1},10,10,${18 - ((i * 7) % 10)}`);
        }
        const fetcher = vi.fn(async () => reply(lines.join('\n'))) as unknown as typeof fetch;
        const out = await fetchGaia(c, 0.05, { fetcher, maxRows: 4 });
        expect(out.rows).toHaveLength(4);
        const gs = out.rows.map((r) => r.g);
        expect(gs).toEqual([...gs].sort((a, b) => a - b));
        expect(gs[0]).toBe(9);
    });
});

describe('starAt', () => {
    it("moves Barnard's Star by its proper motion", () => {
        const mjd = 61000;
        const moved = starAt(BARNARD, mjd);
        const years = 2000 + (mjd - 51544.5) / 365.25 - 2016;
        const expectedArcsec = Math.hypot(-801.551, 10362.394) / 1000 * years;
        const actualArcsec = separationDeg(BARNARD, moved) * 3600;
        expect(Math.abs(actualArcsec / expectedArcsec - 1)).toBeLessThan(0.005);
        expect(actualArcsec / years).toBeGreaterThan(10.39 * 0.995);
        expect(actualArcsec / years).toBeLessThan(10.39 * 1.005);
        expect(moved.dec).toBeGreaterThan(BARNARD.dec);
        expect(moved.ra).toBeLessThan(BARNARD.ra);
        const northArcsec = (moved.dec - BARNARD.dec) * 3600;
        const westArcsec = (BARNARD.ra - moved.ra) * Math.cos(BARNARD.dec * Math.PI / 180) * 3600;
        expect(northArcsec).toBeGreaterThan(10 * westArcsec);
        const a: Astrometry = { ra: BARNARD.ra, dec: BARNARD.dec, epochJyear: 2016, pmRa: -801.551,
            pmDec: 10362.394, parallax: 546.9759 };
        const ref = positionAt(a, mjd);
        expect(Math.abs(moved.ra - ref.ra)).toBeLessThan(1e-9);
        expect(Math.abs(moved.dec - ref.dec)).toBeLessThan(1e-9);
    });

    it('leaves a star without proper motion where it is', () => {
        const still: GaiaRow = { sourceId: '1', ra: 10, dec: 20, g: 15, epochJyear: 2016 };
        expect(starAt(still, 61000)).toEqual({ ra: 10, dec: 20 });
        expect(starAt({ ...still, pmRa: 5 }, 61000)).toEqual({ ra: 10, dec: 20 });
    });
});

describe('parallaxLimitArcsec', () => {
    it('gives the maximum two-visit parallax displacement', () => {
        expect(parallaxLimitArcsec(546.98)).toBeCloseTo(1.09396, 8);
        expect(parallaxLimitArcsec(0)).toBe(0);
        expect(parallaxLimitArcsec(-1)).toBe(0);
        expect(parallaxLimitArcsec(Number.NaN)).toBe(0);
    });
});

describe('ringsAt', () => {
    const grid: OutputGrid = {
        center: { ra: BARNARD.ra, dec: BARNARD.dec }, fovDeg: 300 / 3600, pixelArcsec: 1.5, width: 200, height: 200,
    };
    const still: GaiaRow = { sourceId: '2', ra: BARNARD.ra, dec: BARNARD.dec + 20 / 3600, g: 14, epochJyear: 2016 };
    const far: GaiaRow = { sourceId: '3', ra: BARNARD.ra, dec: BARNARD.dec + 1, g: 12, epochJyear: 2016 };

    it('puts the ring at the centre in 2016 and about 69 px north ten years later', () => {
        const rows = [BARNARD, still, far];
        const early = ringsAt(rows, grid, MJD_2016);
        expect(early.map((r) => r.sourceId)).toEqual([BARNARD_ID, '2']);
        expect(early[0]?.pix.x).toBeCloseTo(99.5, 0);
        expect(early[0]?.pix.y).toBeCloseTo(99.5, 0);
        const late = ringsAt(rows, grid, MJD_2016 + 10 * 365.25);
        const ring = late.find((r) => r.sourceId === BARNARD_ID);
        // 0.8 arcsec per year west is about 5.3 px on this grid (x grows west).
        expect(Math.abs((ring?.pix.x ?? 0) - (99.5 + 5.3))).toBeLessThan(1);
        expect(Math.abs((ring?.pix.y ?? 0) - (99.5 - 69.3))).toBeLessThan(1);
        expect(early[0]?.moves).toBe(true);
        expect(early[1]?.moves).toBe(false);
    });
});

describe('shiftReadout', () => {
    const a: Astrometry = { ra: BARNARD.ra, dec: BARNARD.dec, epochJyear: 2016, pmRa: -801.551, pmDec: 10362.394 };
    const grid: OutputGrid = {
        center: { ra: a.ra, dec: a.dec }, fovDeg: 600 / 3600, pixelArcsec: 3, width: 200, height: 200,
    };
    // Pixel of a sky position, found by inverting gridPixToSky with Newton steps (the grid is nearly linear).
    function pixelOf(c: { ra: number; dec: number }): { x: number; y: number }
    {
        let p = { x: 99.5, y: 99.5 };
        for (let i = 0; i < 5; i++) {
            const s = gridPixToSky(grid, p);
            const dx = ((c.ra - s.ra) * Math.cos(a.dec * Math.PI / 180) * 3600) / grid.pixelArcsec;
            const dy = ((c.dec - s.dec) * 3600) / grid.pixelArcsec;
            p = { x: p.x - dx, y: p.y - dy };
        }
        return p;
    }
    const t1 = MJD_2016;
    const t2 = MJD_2016 + 3 * 365.25;
    const first = { mjd: t1, pix: pixelOf(positionAt(a, t1)) };
    const second = { mjd: t2, pix: pixelOf(positionAt(a, t2)) };

    it('agrees with the prediction when the pixels come from it', () => {
        const r = shiftReadout(a, grid, first, second);
        expect(r.days).toBeCloseTo(3 * 365.25, 6);
        expect(r.offsetArcsec).toBeLessThan(0.01);
        expect(Math.abs(r.measuredArcsec - r.predictedArcsec)).toBeLessThan(0.01);
        expect(r.predictedArcsec).toBeCloseTo(3 * 10.39, 0);
        expect(Math.abs(r.measuredPaDeg - r.predictedPaDeg)).toBeLessThan(0.1);
        expect(r.predictedPaDeg).toBeGreaterThan(340);
        expect(r.predictedPaDeg).toBeLessThan(360);
    });

    it('sees a 2 px east nudge as 2 x pixelArcsec', () => {
        const nudged = { mjd: second.mjd, pix: { x: second.pix.x - 2, y: second.pix.y } };
        const r = shiftReadout(a, grid, first, nudged);
        expect(Math.abs(r.offsetArcsec / (2 * grid.pixelArcsec) - 1)).toBeLessThan(0.01);
    });

    it('throws when the dates are equal or reversed', () => {
        expect(() => shiftReadout(a, grid, first, { mjd: first.mjd, pix: second.pix })).toThrow(GaiaError);
        expect(() => shiftReadout(a, grid, second, first)).toThrow(GaiaError);
    });

    it('stays right next to the pole, where RA changes fast', () => {
        // 3.6 arcsec from the north pole, moving 10 arcsec a year due east: RA changes by tens of degrees.
        const polar: Astrometry = { ra: 40, dec: 89.999, epochJyear: 2016, pmRa: 10000, pmDec: 0 };
        const polarGrid: OutputGrid = {
            center: { ra: polar.ra, dec: polar.dec }, fovDeg: 600 / 3600, pixelArcsec: 3, width: 200, height: 200,
        };
        const m1 = MJD_2016;
        const m2 = MJD_2016 + 365.25;
        const p2 = positionAt(polar, m2);
        expect(Math.abs(p2.ra - polar.ra)).toBeGreaterThan(30);
        const r = shiftReadout(polar, polarGrid,
            { mjd: m1, pix: gridSkyToPix(polarGrid, positionAt(polar, m1)) },
            { mjd: m2, pix: gridSkyToPix(polarGrid, p2) });
        expect(r.predictedArcsec).toBeCloseTo(10, 2);
        expect(Math.abs(r.predictedPaDeg - 90)).toBeLessThan(0.1);
        expect(Math.abs(r.measuredArcsec - 10)).toBeLessThan(0.01);
        expect(Math.abs(r.measuredPaDeg - 90)).toBeLessThan(0.1);
        expect(r.offsetArcsec).toBeLessThan(0.01);
    });
});
