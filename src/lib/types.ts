// Module contract for Slowsky. Every lane builds against these types.
// Change a type here only with a note in the PR, because other lanes import it.
//
// Conventions used everywhere:
// - Sky positions are ICRS degrees. RA in [0, 360), Dec in [-90, 90].
// - Pixel positions are 0-based, x = FITS axis 1 (column), y = FITS axis 2 (row),
//   pixel centre at integer values (astropy origin=0). The WCS module owns the +1
//   from FITS CRPIX, nobody else adds or subtracts it.
// - Times are MJD (UTC days). Wavelengths are micrometres (µm) in code; the SIA
//   service talks metres, and only sia.ts converts.
// - Image values are MJy/sr as stored in the IMAGE HDU. Display uses IMAGE - ZODI.
// - Live regridded frames expose detector context for other lanes, including FLAGS overlays.

import type { FlagsLayout } from './flags';

// ---------- sky and targets ----------

export interface SkyCoord {
    ra: number;
    dec: number;
}

export interface PixelCoord {
    x: number;
    y: number;
}

// Astrometry for a moving target. Proper motion pmRa includes the cos(dec) factor
// (Gaia convention), both in mas/yr. epochJyear is the epoch of ra/dec (e.g. 2016.0).
export interface Astrometry extends SkyCoord {
    epochJyear: number;
    pmRa: number;
    pmDec: number;
    parallax?: number; // mas
    radialVelocity?: number; // km/s
}

export type TargetId = 'barnard' | 'rwaur' | 'epsindb' | 'wise0855' | 'rdra';

export interface Target {
    id: TargetId;
    name: string;
    astrometry: Astrometry;
    // Where the numbers came from (script name and run time), shown in frame details.
    source: string;
    // Detector the card opens on (1-6).
    detector: Detector;
}

// ---------- frames (one SIA row = one detector image) ----------

export type Release = 'dr1' | 'qr3'; // R7 only. QR2 is refused everywhere.
export type Detector = 1 | 2 | 3 | 4 | 5 | 6;

export interface FrameRecord {
    // SIA obs_id plus 'D' and the detector, as in the file name: 2025W36_1A_0095_1D1.
    // SIA's own obs_id has no detector, and all 6 detectors share it, so never key on it alone.
    obsId: string;
    collection: string; // spherex_dr1, spherex_dr1_deep, spherex_qr3, spherex_qr3_deep
    release: Release;
    detector: Detector; // from energy_bandpassname 'SPHEREx-D1' .. 'SPHEREx-D6'
    // https S3 URL of the FITS file, from the SIA cloud_access JSON
    // {"aws": {"bucket_name": "nasa-irsa-spherex", "key": "...", "region": "us-east-1"}}:
    // https://<bucket>.s3.<region>.amazonaws.com/<key>. Only bucket nasa-irsa-spherex is accepted.
    url: string;
    // SIA access_url: IRSA's own server (no CORS, no use from the browser). Shown as a link only.
    irsaUrl?: string;
    tMin: number; // MJD
    tMax: number; // MJD
    lambdaMin: number; // µm, whole detector (SIA em_min is metres)
    lambdaMax: number; // µm, whole detector
    center?: SkyCoord; // s_ra, s_dec
    // s_region: sky positions of the 4 detector corners, in pixel order (0,0), (nx,0), (nx,ny), (0,ny).
    // Lets the live loader guess where a star falls, and so its wavelength, before reading the header.
    footprint?: SkyCoord[];
    estSizeBytes?: number; // approximate: SIA access_estsize is kilobytes, times 1024. FitsIndex has the exact size.
    pipelineVersion?: string; // filled from the FITS header once read
}

export interface FrameQuery {
    center: SkyCoord;
    radiusDeg: number; // the target must be inside the frame
    detector?: Detector;
    lambda?: number; // µm, only frames whose band covers it
    timeRange?: [number, number]; // MJD
}

// ---------- FITS over HTTP range reads ----------

export type CardValue = string | number | boolean | null;

export interface FitsHeader {
    cards: Map<string, CardValue>; // keyword -> value, last one wins
    history: string[];
    get(key: string): CardValue | undefined;
    num(key: string): number; // throws if missing or not a number
}

export interface HduInfo {
    index: number;
    name: string; // EXTNAME, or PRIMARY
    headerStart: number; // byte offset in the file
    dataStart: number;
    dataBytes: number; // unpadded data length
    header: FitsHeader;
}

// The HDUs of a SPHEREx L2 file, in order:
// PRIMARY, IMAGE (float32), FLAGS (RICE_1 BINTABLE in R7), VARIANCE, ZODI, EPSF, WCS-WAVE.
export interface FitsIndex {
    url: string;
    sizeBytes: number;
    hdus: HduInfo[];
    hdu(name: string): HduInfo; // throws if missing
}

// A rectangle of detector pixels, 0-based, inclusive start, exclusive end.
export interface PixelBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export interface Cutout {
    frame: FrameRecord;
    box: PixelBox; // where it sits on the detector
    width: number;
    height: number;
    image: Float32Array; // IMAGE, row-major, width*height
    zodi?: Float32Array; // ZODI, same shape
    variance?: Float32Array;
    flags?: Int32Array;
    wcs: WcsParams; // for the full detector; use box.x0/y0 to map
    wave?: WaveGrid;
    header: FitsHeader; // IMAGE header
}

export interface RangeReader {
    // Reads headers only (never pixel data) and returns the HDU layout.
    index(url: string, signal?: AbortSignal): Promise<FitsIndex>;
    // Reads only the rows the box needs. Must check the 206 status and body length,
    // and abort on anything else (S3 hides Content-Range from JS).
    readFloat32(index: FitsIndex, hduName: string, box: PixelBox, signal?: AbortSignal): Promise<Float32Array>;
    readWaveGrid(index: FitsIndex, signal?: AbortSignal): Promise<WaveGrid>;
}

// ---------- WCS ----------

// TAN with SIP distortion, straight from the IMAGE header.
export interface SipCoeffs {
    order: number;
    // coeffs[p][q] multiplies u^p v^q
    coeffs: number[][];
}

export interface WcsParams {
    crpix: [number, number]; // FITS 1-based, as in the header
    crval: [number, number]; // degrees
    cd: [[number, number], [number, number]]; // degrees per pixel
    a?: SipCoeffs;
    b?: SipCoeffs;
    ap?: SipCoeffs;
    bp?: SipCoeffs;
    naxis: [number, number];
}

export interface Wcs {
    params: WcsParams;
    pixToSky(p: PixelCoord): SkyCoord;
    skyToPix(c: SkyCoord): PixelCoord;
}

// ---------- wavelength ----------

// The WCS-WAVE table: a 9x9 grid (9x14 on detector 3) of (lambda, bandwidth) over the detector,
// looked up bilinearly. Lambda changes mostly along y.
export interface WaveGrid {
    xs: number[]; // 9 pixel positions, 0-based
    ys: number[]; // 9 pixel positions, 0-based
    lambda: number[][]; // [iy][ix], µm
    bandwidth: number[][]; // [iy][ix], µm
}

export interface WaveSample {
    lambda: number; // µm
    bandwidth: number; // µm
}

// ---------- regrid and display ----------

// A north-up, east-left TAN grid centred on the view.
export interface OutputGrid {
    center: SkyCoord;
    fovDeg: number;
    pixelArcsec: number; // native SPHEREx pixel is about 6.15 arcsec
    width: number;
    height: number;
}

// Where a live frame was cut from, so a later layer can read the same detector pixels.
export interface FrameContext {
    wcs: Wcs;
    box: PixelBox; // the detector box the IMAGE cutout used
    url: string; // the frame file
    flags?: { layout: FlagsLayout; names: { bit: number; name: string }[] };
}

export interface RegriddedFrame {
    frame: FrameRecord;
    grid: OutputGrid;
    data: Float32Array; // NaN where the detector does not cover
    // Relative noise map on the same grid as data, not a calibrated variance (see regridVariance).
    // NaN wherever data is NaN, and also where the file's variance was invalid.
    variance?: Float32Array;
    lambdaAtCenter: number; // µm, from the wave grid at the view centre
    bandwidthAtCenter: number;
    context?: FrameContext; // live source only; the saved copy leaves it out
}

export interface Stretch {
    lo: number;
    hi: number;
    kind: 'asinh' | 'linear';
}

// ---------- player ----------

export interface PlayerFrame {
    frame: RegriddedFrame;
    label: string; // date and wavelength shown on screen
}

export interface PlayerState {
    index: number;
    playing: boolean;
    fps: number; // capped, see player.ts
    stretch: Stretch;
}

// ---------- URL state ----------

export interface ViewState {
    center: SkyCoord;
    fovDeg: number;
    detector: Detector;
    lambda?: number; // µm, wavelength lock
    target?: TargetId;
    frame?: string; // obsId of the frame on screen
}
