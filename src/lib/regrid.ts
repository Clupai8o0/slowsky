// Lane: regrid (Sonnet, test-gated). Detector cutout to a north-up grid.
import type { Cutout, OutputGrid, SkyCoord, Wcs } from './types';
import { NotImplemented } from './notimpl';

// Picks a grid size so 1 SPHEREx pixel is at least minScreenPx screen pixels,
// capped at maxSide.
export function gridForView(center: SkyCoord, fovDeg: number, minScreenPx: number, maxSide: number): OutputGrid
{
    throw new NotImplemented(`gridForView(${center.ra}, ${fovDeg}, ${minScreenPx}, ${maxSide})`);
}

// Values are taken from cutout.image - cutout.zodi when zodi is present.
// Outside the detector the output is NaN.
export function regridNorthUp(cutout: Cutout, wcs: Wcs, grid: OutputGrid): Float32Array
{
    throw new NotImplemented(`regridNorthUp(${cutout.width}x${cutout.height}, ${wcs.params.naxis}, ${grid.width})`);
}
