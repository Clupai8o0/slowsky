// Lane: fixtures and targets (Codex). Data comes from scripts/targets.py output,
// committed as src/data/targets.json. Never typed in by hand.
import type { Astrometry, SkyCoord } from './types';
import { NotImplemented } from './notimpl';

// Position at a given MJD from proper motion (and parallax when given), linear in time.
export function positionAt(a: Astrometry, mjd: number): SkyCoord
{
    throw new NotImplemented(`positionAt(${a.ra}, ${mjd})`);
}
