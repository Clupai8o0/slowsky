// Live Gaia DR3 cone searches from two browser-friendly servers, proper motion to the
// date of the frame on screen, and the measured-against-predicted shift numbers.
// No DOM globals: this runs in a Web Worker.
import { gridPixToSky, gridSkyToPix } from './regrid';
import { positionAt } from './targets';
import type { Astrometry, OutputGrid, PixelCoord, SkyCoord } from './types';

export interface GaiaRow {
    sourceId: string; // kept as text: it does not fit a JS number
    ra: number;
    dec: number; // deg, at epochJyear
    g: number; // G magnitude
    pmRa?: number;
    pmDec?: number; // mas/yr; pmRa includes cos(dec)
    parallax?: number; // mas
    epochJyear: number; // 2016.0 when the reply does not say
}

export type GaiaOrigin = 'stsci' | 'vizier-cfa';

export class GaiaError extends Error
{
}

const DEFAULT_G_MAX = 19;
const DEFAULT_EPOCH = 2016;
const MIN_RADIUS_DEG = 0.000001;
const MAX_RADIUS_DEG = 0.2;

function checkCone(c: SkyCoord, radiusDeg: number): void
{
    if (!Number.isFinite(c.ra) || c.ra < 0 || c.ra >= 360) {
        throw new GaiaError(`RA ${c.ra} is outside 0 to 360 degrees.`);
    }
    if (!Number.isFinite(c.dec) || c.dec < -90 || c.dec > 90) {
        throw new GaiaError(`Dec ${c.dec} is outside -90 to 90 degrees.`);
    }
    // The lower limit keeps the radius from rounding to 0 in the URLs (6 decimals).
    if (!Number.isFinite(radiusDeg) || radiusDeg < MIN_RADIUS_DEG || radiusDeg > MAX_RADIUS_DEG) {
        throw new GaiaError(`Radius ${radiusDeg} must be from ${MIN_RADIUS_DEG} to ${MAX_RADIUS_DEG} degrees.`);
    }
}

export function stsciConeUrl(c: SkyCoord, radiusDeg: number): string
{
    checkCone(c, radiusDeg);
    const e = encodeURIComponent;
    return 'https://gsss.stsci.edu/webservices/vo/CatalogSearch.aspx?CAT=GAIADR3'
        + `&RA=${e(c.ra.toFixed(6))}&DEC=${e(c.dec.toFixed(6))}&SR=${e(radiusDeg.toFixed(6))}&FORMAT=CSV`;
}

export function vizierConeUrl(c: SkyCoord, radiusDeg: number, gMax: number = DEFAULT_G_MAX): string
{
    checkCone(c, radiusDeg);
    const e = encodeURIComponent;
    const dec = (c.dec >= 0 ? '+' : '') + c.dec.toFixed(6);
    return 'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=I/355/gaiadr3'
        + `&-c=${e(c.ra.toFixed(6) + ' ' + dec)}&-c.rd=${e(radiusDeg.toFixed(6))}`
        + '&-out=Source,RA_ICRS,DE_ICRS,pmRA,pmDE,Plx,Gmag&-out.max=unlimited'
        // Match the strict g < gMax cut applied to the STScI response.
        + `&Gmag=${e('<' + String(gMax))}`;
}

function optionalNumber(cell: string | undefined): number | undefined
{
    if (cell === undefined) {
        return undefined;
    }
    const t = cell.trim();
    if (t === '') {
        return undefined;
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
}

function buildRow(sourceId: string, ra: number | undefined, dec: number | undefined, g: number | undefined,
    pmRa: number | undefined, pmDec: number | undefined, parallax: number | undefined,
    epoch: number | undefined): GaiaRow | null
{
    if (sourceId === '' || ra === undefined || dec === undefined || g === undefined) {
        return null;
    }
    const row: GaiaRow = { sourceId, ra, dec, g, epochJyear: epoch ?? DEFAULT_EPOCH };
    if (pmRa !== undefined) {
        row.pmRa = pmRa;
    }
    if (pmDec !== undefined) {
        row.pmDec = pmDec;
    }
    if (parallax !== undefined) {
        row.parallax = parallax;
    }
    return row;
}

function splitCsvLine(line: string): string[]
{
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line.charAt(i);
        if (quoted) {
            if (ch === '"') {
                if (line.charAt(i + 1) === '"') {
                    cell += '"';
                    i++;
                } else {
                    quoted = false;
                }
            } else {
                cell += ch;
            }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === ',') {
            cells.push(cell);
            cell = '';
        } else {
            cell += ch;
        }
    }
    cells.push(cell);
    return cells;
}

export function parseStsciCsv(text: string, gMax: number = DEFAULT_G_MAX): GaiaRow[]
{
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
    const headerLine = lines[0];
    if (headerLine === undefined) {
        throw new GaiaError('The STScI reply has no header line.');
    }
    const names = splitCsvLine(headerLine).map((n) => n.trim());
    const col = (name: string): number => names.indexOf(name);
    const need = ['source_id', 'ra', 'dec', 'phot_g_mean_mag'];
    for (const name of need) {
        if (col(name) < 0) {
            throw new GaiaError(`The STScI reply has no ${name} column.`);
        }
    }
    const iId = col('source_id');
    const iRa = col('ra');
    const iDec = col('dec');
    const iG = col('phot_g_mean_mag');
    const iPmRa = col('pmra');
    const iPmDec = col('pmdec');
    const iPlx = col('parallax');
    const iEpoch = col('ref_epoch');
    const rows: GaiaRow[] = [];
    for (const line of lines.slice(1)) {
        const cells = splitCsvLine(line);
        const at = (i: number): string | undefined => (i < 0 ? undefined : cells[i]);
        const g = optionalNumber(at(iG));
        if (g === undefined || g >= gMax) {
            continue;
        }
        const row = buildRow((at(iId) ?? '').trim(), optionalNumber(at(iRa)), optionalNumber(at(iDec)), g,
            optionalNumber(at(iPmRa)), optionalNumber(at(iPmDec)), optionalNumber(at(iPlx)),
            optionalNumber(at(iEpoch)));
        if (row !== null) {
            rows.push(row);
        }
    }
    return rows;
}

export function parseVizierTsv(text: string): GaiaRow[]
{
    const lines = text.split(/\r?\n/);
    let h = -1;
    for (let i = 0; i < lines.length; i++) {
        if ((lines[i] ?? '').startsWith('Source\tRA_ICRS\t')) {
            h = i;
            break;
        }
    }
    if (h < 0) {
        throw new GaiaError('The VizieR reply has no header line.');
    }
    const names = (lines[h] ?? '').split('\t').map((n) => n.trim());
    const col = (name: string): number => names.indexOf(name);
    for (const name of ['Source', 'RA_ICRS', 'DE_ICRS', 'Gmag']) {
        if (col(name) < 0) {
            throw new GaiaError(`The VizieR reply has no ${name} column.`);
        }
    }
    const iId = col('Source');
    const iRa = col('RA_ICRS');
    const iDec = col('DE_ICRS');
    const iG = col('Gmag');
    const iPmRa = col('pmRA');
    const iPmDec = col('pmDE');
    const iPlx = col('Plx');
    const rows: GaiaRow[] = [];
    for (let i = h + 3; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (line.trim() === '') {
            break;
        }
        if (line.startsWith('#')) {
            continue;
        }
        const cells = line.split('\t');
        const at = (k: number): string | undefined => (k < 0 ? undefined : cells[k]);
        const row = buildRow((at(iId) ?? '').trim(), optionalNumber(at(iRa)), optionalNumber(at(iDec)),
            optionalNumber(at(iG)), optionalNumber(at(iPmRa)), optionalNumber(at(iPmDec)),
            optionalNumber(at(iPlx)), DEFAULT_EPOCH);
        if (row !== null) {
            rows.push(row);
        }
    }
    return rows;
}

function abortReason(signal: AbortSignal): unknown
{
    if (signal.reason !== undefined) {
        return signal.reason;
    }
    const err = new Error('The request was aborted.');
    err.name = 'AbortError';
    return err;
}

// Fetches text, giving up after timeoutMs or when the caller's signal aborts.
async function getText(url: string, fetcher: typeof fetch, timeoutMs: number, signal?: AbortSignal): Promise<string>
{
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const limit = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new GaiaError(`no answer within ${Math.round(timeoutMs / 1000)} s`));
        }, timeoutMs);
        if (signal !== undefined) {
            onAbort = () => {
                controller.abort();
                reject(abortReason(signal));
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
    try {
        const work = (async () => {
            const res = await fetcher(url, { signal: controller.signal });
            if (res.status !== 200) {
                throw new GaiaError(`the server answered HTTP ${res.status}`);
            }
            return res.text();
        })();
        work.catch(() => undefined);
        return await Promise.race([work, limit]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
        if (signal !== undefined && onAbort !== undefined) {
            signal.removeEventListener('abort', onAbort);
        }
    }
}

function describe(e: unknown): string
{
    return e instanceof Error ? e.message : String(e);
}

export async function fetchGaia(c: SkyCoord, radiusDeg: number, opts: {
    signal?: AbortSignal; fetcher?: typeof fetch; gMax?: number; maxRows?: number; timeoutMs?: number;
} = {}): Promise<{ rows: GaiaRow[]; from: GaiaOrigin }>
{
    const gMax = opts.gMax ?? DEFAULT_G_MAX;
    const maxRows = opts.maxRows ?? 400;
    const timeoutMs = opts.timeoutMs ?? 8000;
    const fetcher = opts.fetcher ?? fetch;
    const signal = opts.signal;
    const stsciUrl = stsciConeUrl(c, radiusDeg);
    const vizierUrl = vizierConeUrl(c, radiusDeg, gMax);
    const finish = (rows: GaiaRow[], from: GaiaOrigin): { rows: GaiaRow[]; from: GaiaOrigin } => {
        const sorted = rows.slice().sort((a, b) => a.g - b.g);
        return { rows: sorted.slice(0, Math.max(0, maxRows)), from };
    };
    if (signal?.aborted) {
        throw abortReason(signal);
    }
    let first: string | undefined;
    try {
        const rows = parseStsciCsv(await getText(stsciUrl, fetcher, timeoutMs, signal), gMax);
        if (rows.length > 0) {
            return finish(rows, 'stsci');
        }
    } catch (e) {
        if (signal?.aborted) {
            throw abortReason(signal);
        }
        first = describe(e);
    }
    let second: string | undefined;
    try {
        const rows = parseVizierTsv(await getText(vizierUrl, fetcher, timeoutMs * 1.5, signal));
        if (rows.length > 0) {
            return finish(rows, 'vizier-cfa');
        }
    } catch (e) {
        if (signal?.aborted) {
            throw abortReason(signal);
        }
        second = describe(e);
    }
    if (first === undefined && second === undefined) {
        throw new GaiaError('No Gaia star was found in this area by either service.');
    }
    const stsciResult = first === undefined ? 'STScI returned no stars' : `STScI failed (${first})`;
    const vizierResult = second === undefined ? 'the VizieR mirror at CfA returned no stars'
        : `the VizieR mirror at CfA failed (${second})`;
    throw new GaiaError(`No Gaia stars: ${stsciResult} and ${vizierResult}.`);
}

// Parallax is not modelled: two visits can differ by up to twice the parallax,
// about 1.09 arcsec for Barnard's Star.
export function parallaxLimitArcsec(parallaxMas: number): number
{
    return Number.isFinite(parallaxMas) && parallaxMas > 0 ? 2 * parallaxMas / 1000 : 0;
}

export function starAt(row: GaiaRow, mjd: number): SkyCoord
{
    if (row.pmRa === undefined || row.pmDec === undefined) {
        return { ra: row.ra, dec: row.dec };
    }
    const a: Astrometry = {
        ra: row.ra, dec: row.dec, epochJyear: row.epochJyear, pmRa: row.pmRa, pmDec: row.pmDec,
    };
    if (row.parallax !== undefined) {
        a.parallax = row.parallax;
    }
    return positionAt(a, mjd);
}

export interface Ring {
    sourceId: string;
    g: number;
    pix: PixelCoord;
    moves: boolean;
}

export function ringsAt(rows: GaiaRow[], grid: OutputGrid, mjd: number): Ring[]
{
    const rings: Ring[] = [];
    for (const row of rows) {
        const pix = gridSkyToPix(grid, starAt(row, mjd));
        if (!(pix.x >= -0.5 && pix.x <= grid.width - 0.5 && pix.y >= -0.5 && pix.y <= grid.height - 0.5)) {
            continue;
        }
        rings.push({
            sourceId: row.sourceId, g: row.g, pix,
            moves: row.pmRa !== undefined && row.pmDec !== undefined,
        });
    }
    return rings;
}

export interface ShiftReadout {
    days: number;
    predictedArcsec: number;
    predictedPaDeg: number; // from proper motion alone
    measuredArcsec: number;
    measuredPaDeg: number; // from the two measured pixel positions
    offsetArcsec: number; // length of (measured minus predicted) on the sky
}

export function shiftReadout(a: Astrometry, grid: OutputGrid,
    first: { mjd: number; pix: PixelCoord }, second: { mjd: number; pix: PixelCoord }): ShiftReadout
{
    if (!(second.mjd > first.mjd)) {
        throw new GaiaError('The second date must be later than the first.');
    }
    const p1 = positionAt(a, first.mjd);
    const p2 = positionAt(a, second.mjd);
    const m1 = gridPixToSky(grid, first.pix);
    const m2 = gridPixToSky(grid, second.pix);
    // Every position is projected onto one tangent plane, touching the sky at the first
    // predicted position (gnomonic projection), in arcsec east and north. Plain RA and Dec
    // differences go wrong next to a pole.
    const rad = Math.PI / 180;
    const ra0 = p1.ra * rad;
    const dec0 = p1.dec * rad;
    const plane = (c: SkyCoord): { east: number; north: number } => {
        const dRa = c.ra * rad - ra0;
        const dec = c.dec * rad;
        const d = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(dRa);
        if (!(d > 0)) {
            throw new GaiaError('The positions are too far apart to compare.');
        }
        const k = 3600 / rad / d;
        return {
            east: Math.cos(dec) * Math.sin(dRa) * k,
            north: (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(dRa)) * k,
        };
    };
    const vector = (from: SkyCoord, to: SkyCoord): { east: number; north: number } => {
        const f = plane(from);
        const t = plane(to);
        return { east: t.east - f.east, north: t.north - f.north };
    };
    const pa = (v: { east: number; north: number }): number => {
        if (v.east === 0 && v.north === 0) {
            return 0;
        }
        const deg = Math.atan2(v.east, v.north) * 180 / Math.PI;
        return (deg + 360) % 360;
    };
    const predicted = vector(p1, p2);
    const measured = vector(m1, m2);
    return {
        days: second.mjd - first.mjd,
        predictedArcsec: Math.hypot(predicted.east, predicted.north),
        predictedPaDeg: pa(predicted),
        measuredArcsec: Math.hypot(measured.east, measured.north),
        measuredPaDeg: pa(measured),
        offsetArcsec: Math.hypot(measured.east - predicted.east, measured.north - predicted.north),
    };
}
