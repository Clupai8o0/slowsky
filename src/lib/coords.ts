// Lane: parsers (Haiku). Coordinate input: decimal or sexagesimal, and names.
import type { Astrometry, SkyCoord } from './types';
import { NotImplemented } from './notimpl';

// Accepts "56.75 24.1", "56.75, +24.1", "03h47m00s +24d07m00s", "03 47 00 +24 07 00".
// Returns null for anything it cannot read. Never guesses hours vs degrees silently:
// a sexagesimal RA is hours, a decimal RA is degrees.
export function parseCoords(text: string): SkyCoord | null
{
    throw new NotImplemented(`parseCoords(${text})`);
}

export function formatRa(raDeg: number): string
{
    throw new NotImplemented(`formatRa(${raDeg})`);
}

export function formatDec(decDeg: number): string
{
    throw new NotImplemented(`formatDec(${decDeg})`);
}

// Great-circle distance in degrees.
export function separationDeg(a: SkyCoord, b: SkyCoord): number
{
    throw new NotImplemented(`separationDeg(${a.ra},${b.ra})`);
}

// Name lookup through the CfA SIMBAD mirror (simbad.cfa.harvard.edu, TAP sync, CORS open).
// CDS itself is down since 9 Nov 2026. Returns proper motion when SIMBAD has it.
export async function resolveName(name: string, signal?: AbortSignal): Promise<Astrometry>
{
    void signal;
    throw new NotImplemented(`resolveName(${name})`);
}
