// Lane: WCS (Sonnet, test-gated). TAN-SIP both ways, matching astropy to 0.01 px.
import type { FitsHeader, Wcs, WcsParams } from './types';
import { NotImplemented } from './notimpl';

export function wcsFromHeader(header: FitsHeader): WcsParams
{
    throw new NotImplemented(`wcsFromHeader(${header.cards.size} cards)`);
}

// pixToSky applies SIP A/B; skyToPix applies AP/BP and then refines by iteration.
export function makeWcs(params: WcsParams): Wcs
{
    throw new NotImplemented(`makeWcs(${params.crval.join(',')})`);
}
