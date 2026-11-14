// Lane: WCS (Sonnet). WCS-WAVE lookup and the wavelength lock.
import type { FrameRecord, PixelCoord, WaveGrid, WaveSample } from './types';
import { NotImplemented } from './notimpl';

// Bilinear lookup in the 9x9 grid, matching astropy's -TAB result.
export function sampleWave(grid: WaveGrid, p: PixelCoord): WaveSample
{
    throw new NotImplemented(`sampleWave(${p.x},${p.y}, ${grid.xs.length})`);
}

// A visit is a run of frames on one detector within maxGapDays of each other.
export function groupVisits(frames: FrameRecord[], maxGapDays: number): FrameRecord[][]
{
    throw new NotImplemented(`groupVisits(${frames.length}, ${maxGapDays})`);
}
