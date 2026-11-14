// Lane: comet. The 3I/ATLAS card: parse and check public/comet/3i-atlas.json (made by scripts/bake_comet.py),
// label each frame, build the chart points and the caption. Pure: no DOM, runs in the page and in workers.

export interface CometFrame {
    obsId: string;
    start: string; // ISO UTC, exposure start
    mjdStart: number;
    wavelength: number; // µm at the comet's pixel, from the frame's WCS-WAVE table
    ra: number;
    dec: number;
    pixel: { x: number; y: number }; // 0-based, in the full frame
    key: string; // S3 key in nasa-irsa-spherex, always dr1/...
    coreMean: number; // MJy/sr, mean of the 3x3 pixels at the predicted position
    borderMedian: number; // MJy/sr, median of the cut-out's 5-pixel border
    cutout: (number | null)[]; // size*size values, row by row (row 0 = lowest y), MJy/sr
}

export interface CometDoc {
    object: string;
    detector: number;
    size: number;
    units: string;
    mostQuery: string;
    madeBy: string;
    madeAt: string;
    note: string;
    frames: CometFrame[]; // sorted by wavelength
}

export interface CometPoint {
    wavelength: number;
    core: number; // plain 3x3 mean
    border: number; // plain border median
    value: number; // core - border, what the chart draws
}

export const COMET_URL = '/comet/3i-atlas.json';
export const COMET_TITLE = 'Comet 3I/ATLAS in CO₂ light';
export const CO2_BAND_UM: readonly [number, number] = [4.25, 4.27]; // Lisse et al. 2026 abstract

export const COMET_PAPERS = Object.freeze([
    Object.freeze({ cite: 'Lisse et al. 2025, RNAAS 9, 242', doi: '10.3847/2515-5172/ae0293', arxiv: '2508.15469' }),
    Object.freeze({ cite: 'Lisse et al. 2026, RNAAS 10, 26', doi: '10.3847/2515-5172/ae3f95', arxiv: '2601.06759' }),
]);

export class CometDataError extends Error
{
    constructor(message: string)
    {
        super(message);
        this.name = 'CometDataError';
    }
}

function fail(why: string): never
{
    throw new CometDataError(why);
}

function obj(v: unknown, what: string): Record<string, unknown>
{
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        fail(`${what} is not an object`);
    }
    return v as Record<string, unknown>;
}

function num(v: unknown, what: string): number
{
    if (typeof v !== 'number' || !Number.isFinite(v)) {
        fail(`${what} is not a finite number`);
    }
    return v;
}

function str(v: unknown, what: string): string
{
    if (typeof v !== 'string' || v.length === 0) {
        fail(`${what} is not a string`);
    }
    return v;
}

function parseFrame(raw: unknown, size: number, i: number): CometFrame
{
    const f = obj(raw, `frame ${i}`);
    const key = str(f.key, `frame ${i} key`);
    if (!key.startsWith('dr1/')) {
        fail(`frame ${i} key is not a DR1 path`);
    }
    const start = str(f.start, `frame ${i} start`);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(start) || Number.isNaN(Date.parse(start))) {
        fail(`frame ${i} start is not an ISO UTC time`);
    }
    const wavelength = num(f.wavelength, `frame ${i} wavelength`);
    if (wavelength < 0.7 || wavelength > 5.1) {
        fail(`frame ${i} wavelength is outside SPHEREx's range`);
    }
    const pixel = obj(f.pixel, `frame ${i} pixel`);
    const cut = f.cutout;
    if (!Array.isArray(cut) || cut.length !== size * size) {
        fail(`frame ${i} cut-out has the wrong size`);
    }
    for (const v of cut) {
        if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {
            fail(`frame ${i} cut-out holds a bad value`);
        }
    }
    return {
        obsId: str(f.obsId, `frame ${i} obsId`),
        start,
        mjdStart: num(f.mjdStart, `frame ${i} mjdStart`),
        wavelength,
        ra: num(f.ra, `frame ${i} ra`),
        dec: num(f.dec, `frame ${i} dec`),
        pixel: { x: num(pixel.x, `frame ${i} pixel x`), y: num(pixel.y, `frame ${i} pixel y`) },
        key,
        coreMean: num(f.coreMean, `frame ${i} coreMean`),
        borderMedian: num(f.borderMedian, `frame ${i} borderMedian`),
        cutout: cut as (number | null)[],
    };
}

// Strict: anything off throws CometDataError, so the card shows nothing rather than a wrong picture.
export function parseComet(raw: unknown): CometDoc
{
    const d = obj(raw, 'file');
    const size = num(d.size, 'size');
    if (!Number.isInteger(size) || size < 5 || size > 101 || size % 2 !== 1) {
        fail('size must be an odd whole number from 5 to 101');
    }
    if (d.units !== 'MJy/sr') {
        fail('units must be MJy/sr');
    }
    if (!Array.isArray(d.frames) || d.frames.length < 2 || d.frames.length > 24) {
        fail('frames must be a list of 2 to 24');
    }
    const frames = d.frames.map((f, i) => parseFrame(f, size, i)).sort((a, b) => a.wavelength - b.wavelength);
    for (let i = 1; i < frames.length; i++) {
        if (!((frames[i] as CometFrame).wavelength > (frames[i - 1] as CometFrame).wavelength)) {
            fail('two frames share a wavelength');
        }
    }
    return {
        object: str(d.object, 'object'),
        detector: num(d.detector, 'detector'),
        size,
        units: 'MJy/sr',
        mostQuery: str(d.mostQuery, 'mostQuery'),
        madeBy: str(d.madeBy, 'madeBy'),
        madeAt: str(d.madeAt, 'madeAt'),
        note: str(d.note, 'note'),
        frames,
    };
}

// "3.96 µm" and "04:26 UTC".
export function frameLabel(f: CometFrame): { wave: string; time: string; aria: string }
{
    const wave = `${f.wavelength.toFixed(2)} µm`;
    const time = `${f.start.slice(11, 16)} UTC`;
    return { wave, time, aria: `${wave}, started ${time} on ${f.start.slice(0, 10)}` };
}

export function cometPoints(doc: CometDoc): CometPoint[]
{
    return doc.frames.map(f => ({ wavelength: f.wavelength, core: f.coreMean, border: f.borderMedian, value: f.coreMean - f.borderMedian }));
}

// One linear scale for every picture: from the darkest border median to the brightest core mean. Brighter
// pixels (field stars) show white, darker ones black.
export function sharedScale(doc: CometDoc): { lo: number; hi: number }
{
    const lo = Math.min(...doc.frames.map(f => f.borderMedian));
    const hi = Math.max(...doc.frames.map(f => f.coreMean));
    return hi > lo ? { lo, hi } : { lo, hi: lo + 1 };
}

// RGBA for a canvas, top row first (the cut-out is stored lowest y first, so it is flipped to show pixel row 0 at the bottom, as
// FITS viewers do; the frame is not turned to north up). Missing pixels are drawn transparent.
export function cutoutRgba(f: CometFrame, size: number, scale: { lo: number; hi: number }): Uint8ClampedArray
{
    const out = new Uint8ClampedArray(size * size * 4);
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            const v = f.cutout[(size - 1 - row) * size + col];
            const o = (row * size + col) * 4;
            if (v === null || v === undefined) {
                continue;
            }
            const g = Math.round(255 * Math.min(1, Math.max(0, (v - scale.lo) / (scale.hi - scale.lo))));
            out[o] = g;
            out[o + 1] = g;
            out[o + 2] = g;
            out[o + 3] = 255;
        }
    }
    return out;
}

function fmt(v: number): string
{
    return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
}

export function spanText(doc: CometDoc): string
{
    const first = doc.frames.reduce((a, f) => Math.min(a, f.mjdStart), Infinity);
    const last = doc.frames.reduce((a, f) => Math.max(a, f.mjdStart), -Infinity);
    const minutes = Math.round((last - first) * 1440);
    return minutes < 90 ? `${minutes} minutes` : `about ${(minutes / 60).toFixed(1)} hours`;
}

// The caption, one sentence per item. Every number comes from the file.
export function cometCaption(doc: CometDoc): string[]
{
    const f0 = doc.frames[0] as CometFrame;
    const fn = doc.frames[doc.frames.length - 1] as CometFrame;
    const pts = cometPoints(doc);
    const top = pts.reduce((a, p) => (p.value > a.value ? p : a));
    const day = new Date(f0.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    return [
        `${doc.frames.length} SPHEREx frames from ${day}, taken over ${spanText(doc)} at wavelengths from ${f0.wavelength.toFixed(2)} to ${fn.wavelength.toFixed(2)} µm.`
            + ' Each frame sees a different wavelength, so the change along the row is colour, not time.',
        'All the pictures share one linear brightness scale, so they can be compared; stars brighter than the top of the scale show white.',
        `The numbers are the mean of the 3×3 pixels at the comet’s predicted position (from IRSA’s Moving Object Search Tool), minus the median of each picture’s border.`
            + ' They are raw pixel values, not a calibrated measurement.',
        `Here the core is brightest at ${top.wavelength.toFixed(2)} µm (${fmt(top.value)} MJy/sr above its border), where carbon dioxide gas glows.`,
        'The SPHEREx team reported this comet’s carbon dioxide coma (Lisse et al. 2025 and 2026); this card only shows their public frames.',
    ];
}

export const COMET_BANNED = /\b(discover(y|ed|ies)?|detect(ed|ion|s)?|confirm(ed|s)?|proves?|proven)\b/i;
