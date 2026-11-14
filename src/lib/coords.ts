// Lane: parsers (Haiku). Coordinate input: decimal or sexagesimal, and names.
import type { Astrometry, SkyCoord } from './types';

const SIMBAD_TAP = 'https://simbad.cfa.harvard.edu/simbad/sim-tap/sync';

// One number as written, with its sign ('', '+' or '-') and explicit unit marker.
const TOKEN = /([+-]?)\s*(\d+(?:\.\d*)?|\.\d+)([hdms°′″'"]*)/gi;

interface Token {
    sign: string;
    digits: string;
    unit: string;
}

// Accepts "56.75 24.1", "56.75, +24.1", "03h47m00s +24d07m00s", "03 47 00 +24 07 00".
// Returns null for anything it cannot read. Never guesses hours vs degrees silently:
// an unmarked sexagesimal RA is hours, a decimal RA is degrees; explicit units take precedence.
export function parseCoords(text: string): SkyCoord | null
{
    const s = text.trim().replace(/[−–—]/g, '-');
    const groups = splitGroups(s);
    if (groups === null) {
        return null;
    }
    const ra = component(groups[0] ?? [], 'ra');
    const dec = component(groups[1] ?? [], 'dec');
    if (ra === null || dec === null) {
        return null;
    }
    return { ra, dec };
}

function tokensOf(part: string): Token[] | null
{
    const tokens: Token[] = [];
    for (const m of part.matchAll(TOKEN)) {
        tokens.push({ sign: m[1] ?? '', digits: m[2] ?? '', unit: (m[3] ?? '').toLowerCase() });
    }
    const leftover = part.replace(TOKEN, '');
    if (tokens.length === 0 || !/^[\s:]*$/.test(leftover)) {
        return null;
    }
    return tokens;
}

// Splits the text into the RA and Dec groups. A comma splits first. Otherwise a signed number starts
// the Dec group. Without signs, the number count decides (2, 4 or 6 numbers split in half).
function splitGroups(s: string): Token[][] | null
{
    const comma = s.indexOf(',');
    if (comma >= 0) {
        const left = tokensOf(s.slice(0, comma));
        const right = tokensOf(s.slice(comma + 1));
        return left && right ? [left, right] : null;
    }
    const tokens = tokensOf(s);
    if (tokens === null) {
        return null;
    }
    const signed: Token[][] = [];
    for (const t of tokens) {
        const last = signed[signed.length - 1];
        if (t.sign !== '' || last === undefined) {
            signed.push([t]);
        } else {
            last.push(t);
        }
    }
    if (signed.length === 2) {
        return signed;
    }
    const n = tokens.length;
    if (n !== 2 && n !== 4 && n !== 6) {
        return null;
    }
    const half = n / 2;
    return [tokens.slice(0, half), tokens.slice(half)];
}

// One coordinate: 1-3 numbers, with explicit units or positional sexagesimal. Sign only on the first number.
function component(group: Token[], kind: 'ra' | 'dec'): number | null
{
    const first = group[0];
    if (first === undefined || group.length > 3) {
        return null;
    }
    for (const t of group.slice(1)) {
        if (t.sign !== '') {
            return null;
        }
    }
    const units = group.map((t) => t.unit).join('');
    const degrees = /[d°′″'"]/.test(units);
    if (kind === 'ra' && degrees && units.includes('h')) {
        return null;
    }
    const hours = kind === 'ra' && !degrees && (group.length > 1 || /[hms]/.test(units));
    const values = group.map((t) => Number(t.digits));
    let value = 0;
    let previousRank = -1;
    for (let i = 0; i < group.length; i++) {
        const unit = group[i]?.unit ?? '';
        const rank = unit === '' ? i : 'hd°'.includes(unit) ? 0 : "m′'".includes(unit) ? 1 : 's″"'.includes(unit) ? 2 : -1;
        const part = values[i] ?? NaN;
        if (unit.length > 1 || rank <= previousRank || (rank > 0 && part >= 60)
            || (i < group.length - 1 && !Number.isInteger(part))) {
            return null;
        }
        value += part / 60 ** rank;
        previousRank = rank;
    }
    value *= (first.sign === '-' ? -1 : 1) * (hours ? 15 : 1);
    if (kind === 'ra') {
        return value >= 0 && value < 360 ? value : null;
    }
    return Math.abs(value) <= 90 ? value : null;
}

// "05h07m49.50s", RA in hours, two decimals of a second.
export function formatRa(raDeg: number): string
{
    const dayHundredths = 86400 * 100;
    const wrapped = ((raDeg % 360) + 360) % 360;
    const total = Math.round((wrapped / 15) * 3600 * 100) % dayHundredths;
    const h = Math.floor(total / 360000);
    const m = Math.floor((total % 360000) / 6000);
    const rest = total % 6000;
    const s = Math.floor(rest / 100);
    const frac = rest % 100;
    return `${pad(h, 2)}h${pad(m, 2)}m${pad(s, 2)}.${pad(frac, 2)}s`;
}

// "+30°24′05.0″", one decimal of an arcsecond.
export function formatDec(decDeg: number): string
{
    const tenths = Math.round(Math.abs(decDeg) * 36000);
    const negative = decDeg < 0 && tenths > 0;
    const d = Math.floor(tenths / 36000);
    const m = Math.floor((tenths % 36000) / 600);
    const rest = tenths % 600;
    const s = Math.floor(rest / 10);
    const frac = rest % 10;
    return `${negative ? '-' : '+'}${pad(d, 2)}°${pad(m, 2)}′${pad(s, 2)}.${frac}″`;
}

function pad(n: number, width: number): string
{
    return String(n).padStart(width, '0');
}

// Great-circle distance in degrees (haversine).
export function separationDeg(a: SkyCoord, b: SkyCoord): number
{
    const toRad = Math.PI / 180;
    const dRa = (b.ra - a.ra) * toRad;
    const dDec = (b.dec - a.dec) * toRad;
    const h = Math.sin(dDec / 2) ** 2
        + Math.cos(a.dec * toRad) * Math.cos(b.dec * toRad) * Math.sin(dRa / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / toRad;
}

interface SimbadTable {
    metadata: { name: string }[];
    data: (string | number | null)[][];
}

// Name lookup through the CfA SIMBAD mirror (simbad.cfa.harvard.edu, TAP sync, CORS open).
// CDS itself is down since 9 Nov 2026. Returns proper motion when SIMBAD has it.
export async function resolveName(name: string, signal?: AbortSignal): Promise<Astrometry>
{
    const text = name.trim().replace(/\s+/g, ' ');
    if (text === '') {
        throw new Error('Enter an object name');
    }
    const body = new URLSearchParams({
        REQUEST: 'doQuery',
        LANG: 'ADQL',
        FORMAT: 'json',
        QUERY: buildAdql(text),
    });
    const res = await fetch(SIMBAD_TAP, { method: 'POST', body, signal });
    if (!res.ok) {
        throw new Error(`SIMBAD lookup failed (HTTP ${res.status})`);
    }
    const table = (await res.json()) as SimbadTable;
    const row = table.data[0];
    if (row === undefined) {
        throw new Error(`"${text}" is not in SIMBAD`);
    }
    const ra = cell(table, row, 'ra');
    const dec = cell(table, row, 'dec');
    if (ra === null || dec === null) {
        throw new Error(`SIMBAD has no position for "${text}"`);
    }
    return {
        ra,
        dec,
        epochJyear: 2000.0,
        pmRa: cell(table, row, 'pmra') ?? 0,
        pmDec: cell(table, row, 'pmdec') ?? 0,
    };
}

// The name as typed, then the forms SIMBAD stores it under ("RW Aur" is "V* RW Aur").
function candidatesFor(text: string): string[]
{
    return [...new Set([text, `V* ${text}`, `* ${text}`, `NAME ${text}`])];
}

function buildAdql(text: string): string
{
    const ids = candidatesFor(text)
        .map((id) => `'${id.replace(/'/g, "''")}'`)
        .join(', ');
    return 'SELECT TOP 1 main_id, ra, dec, pmra, pmdec FROM basic '
        + 'JOIN ident ON oidref = oid '
        + `WHERE ident.id IN (${ids})`;
}

function cell(table: SimbadTable, row: (string | number | null)[], column: string): number | null
{
    const index = table.metadata.findIndex((m) => m.name === column);
    const value = index < 0 ? null : row[index];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
