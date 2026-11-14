// Sky sources (Opus glue): everything between "show me this patch of sky" and a list of
// frames ready for the player. The UI talks only to SkySource; it never calls SIA, S3 or
// the WCS code itself. Two sources share the interface: live (SIA -> S3 range reads -> WCS ->
// wavelength lock -> regrid) and snapshot (the same steps on frames baked into public/snapshot).
import type { Detector, OutputGrid, PixelCoord, PlayerFrame, SkyCoord, TargetId } from './types';
import type { LockedFrame } from './lock';
import { NotImplemented } from './notimpl';

export type SkyStage = 'search' | 'headers' | 'pixels' | 'regrid';

export interface SkyProgress {
    stage: SkyStage;
    done: number;
    total: number;
}

export interface SkyRequest {
    center: SkyCoord; // centre of the view, fixed on the sky for every frame
    fovDeg: number;
    detector: Detector;
    lambda?: number; // µm; unset = the middle of the range every visit can reach
    target?: TargetId; // known target: its moving position is tracked and marked
    signal?: AbortSignal;
    onProgress?(p: SkyProgress): void;
}

// A Gaia DR3 star for the overlay, with its position already in grid pixels.
export interface GaiaStar {
    sourceId: string;
    ra: number; // deg, at the Gaia epoch
    dec: number;
    g: number; // G magnitude
    pmRa?: number; // mas/yr, includes cos(dec)
    pmDec?: number;
    parallax?: number; // mas
    epochJyear: number; // 2016.0 for DR3
    pix: PixelCoord; // on the output grid, at the Gaia epoch
}

// Where the target is in one frame.
export interface TrackPoint {
    mjd: number;
    ra: number;
    dec: number;
    pix: PixelCoord; // on the output grid
}

export interface SkyResult {
    source: 'live' | 'snapshot';
    grid: OutputGrid;
    frames: PlayerFrame[]; // sorted by time; label = date and wavelength
    locked: LockedFrame[]; // same order as frames: lambda and dLambda per frame
    lambda: number; // the wavelength the frames are locked to, µm
    lambdaRange?: [number, number]; // what every visit can reach, µm
    stars: GaiaStar[]; // empty when no catalogue is available for this view
    track?: TrackPoint[]; // same order as frames; only with a target
    credits: string[]; // data credits to show under the player
    notes: string[]; // plain-language notes, e.g. "2 visits dropped: no frame within 0.02 µm"
}

export interface SkySource {
    load(req: SkyRequest): Promise<SkyResult>;
}

export function createLiveSource(): SkySource
{
    throw new NotImplemented('createLiveSource');
}

export function createSnapshotSource(): SkySource
{
    throw new NotImplemented('createSnapshotSource');
}
