// Library only: no page or DOM integration. JPEG/PNG samples are display
// intensities after the publisher's stretch, never calibrated SPHEREx fluxes.
// Page: hatch NaN as visible no data, never black; offer only 0.1 and 0.25 degree
// views; never compute speed or brightness change from the two pictures. Live
// tiles: catalogue stars are 0.05–0.55 arcsec from Gaia positions at 2000.0;
// Barnard's Star is at its year-2000 position, 267.5 arcsec from its 2026 position.
import { parseHeader } from './fits';
import { healpixTilePixel, icrsToGalactic, skyToHealpix } from './healpix';
import { gridPixToSky } from './regrid';
import type { OutputGrid, SkyCoord } from './types';

const DEFAULT_TIMEOUT_MS = 10000;

export interface EpochSource {
    baseUrl: string;
    propertiesUrl: string;
    name: string;
    band: string;
    hipsOrder: number;
    tileWidth: number;
    format: 'fits' | 'jpeg' | 'png';
    frame: 'equatorial' | 'galactic';
    credit: string;
    creditUrl: string;
    creditUrlAsPublished: string;
    hipsCredit: string;
    hipsCreator: string;
    emMin: number;
    emMax: number;
    epochLabel: string;
    fromMonth: string;
    toMonth: string;
    nightKnown: boolean;
}

// Snapshot of the live properties response; probe details in tests/fixtures/epoch.
// Properties are from:
// https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/K/properties
// t_min=50600, t_max=51941 (MJD UTC); the properties state months only.
// The label is the survey span, NOT a date assigned to this particular field.
export const TWO_MASS_K: Readonly<EpochSource> = Object.freeze({
    baseUrl: 'https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/K',
    propertiesUrl: 'https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/K/properties',
    name: '2MASS K (2.16um)',
    band: 'K',
    hipsOrder: 9,
    tileWidth: 512,
    format: 'jpeg',
    frame: 'equatorial',
    credit: 'University of Massachusetts & IPAC/Caltech',
    // The published HTTP URL redirected here and answered 200 on 2026-11-14.
    creditUrl: 'https://www.ipac.caltech.edu/2mass/',
    creditUrlAsPublished: 'http://www.ipac.caltech.edu/2mass/',
    hipsCredit: 'CNRS/Unistra',
    hipsCreator: 'Oberto A. (CDS)',
    emMin: 2.015E-6,
    emMax: 2.303E-6,
    epochLabel: '2MASS K band, taken between June 1997 and February 2001',
    fromMonth: '1997-06',
    toMonth: '2001-02',
    nightKnown: false,
});

/** Page copy explaining the limits of the older survey image. */
export const EPOCH_NOTE = 'The older picture is a stretched survey image, not a measurement: its brightness cannot be compared with SPHEREx, and the night or nights it was taken on are not known.';

/** Page credit for the survey and its resampled HiPS tiles. */
export const EPOCH_CREDIT = `2MASS: ${TWO_MASS_K.credit}. HiPS tiles: ${TWO_MASS_K.hipsCredit}, served by IRSA.`;

export interface EpochTile {
    npix: number;
    url: string;
}

export interface EpochMissing extends EpochTile {
    reason: 'fetch' | 'decode';
    detail: string;
}

export interface EpochDecoded {
    width: number;
    height: number;
    // Row-major, top down: one intensity, RGB, or RGBA per pixel. Alpha 0 is empty.
    data: ArrayLike<number>;
}

export interface EpochOptions {
    source?: EpochSource;
    fetch?: typeof fetch;
    decode?: (bytes: Uint8Array) => EpochDecoded | Promise<EpochDecoded>;
    signal?: AbortSignal;
    // Covers fetch, response body and an asynchronous decoder (default 10 s).
    timeoutMs?: number;
    maxTiles?: number; // Default 24.
    maxStepDown?: number; // Default 1 order.
    maxPixels?: number; // Default 400000 output pixels.
    allowPartial?: boolean; // Default false.
}

export type EpochResult = {
    ok: true;
    width: number;
    height: number;
    // NaN means no data; paint it as no data, never as black.
    // JPEG sky outside survey coverage is plain 0 and indistinguishable from dark sky.
    pixels: Float32Array;
    band: string;
    order: number;
    wantedOrder: number;
    pixelArcsec: number;
    coarser: boolean;
    covered: number;
    holes: boolean;
    // 'fits' means BSCALE/BZERO-applied tile values; no physical unit is implied.
    // 'display' is the publisher's stretched JPEG/PNG intensity, never flux.
    values: 'display' | 'fits';
    source: { name: string; propertiesUrl: string; credit: string; creditUrl: string; format: EpochSource['format'] };
    epoch: { label: string; fromMonth: string; toMonth: string; nightKnown: boolean };
    missing: EpochMissing[];
} | {
    ok: false;
    reason: 'no-tiles' | 'fetch' | 'decode' | 'empty' | 'too-large';
    detail: string;
    missing: EpochMissing[];
};

function validate(grid: OutputGrid, source: EpochSource, maxTiles: number): void
{
    if (!Number.isSafeInteger(grid.width) || grid.width < 1 || !Number.isSafeInteger(grid.height)
        || grid.height < 1 || !Number.isSafeInteger(grid.width * grid.height)
        || !Number.isFinite(grid.pixelArcsec) || grid.pixelArcsec <= 0
        || !Number.isFinite(grid.center.ra) || !Number.isFinite(grid.center.dec) || Math.abs(grid.center.dec) > 90
        || !Number.isSafeInteger(maxTiles) || maxTiles < 1) {
        throw new RangeError('Invalid epoch grid or tile cap');
    }
    if (!Number.isInteger(source.hipsOrder) || source.hipsOrder < 0
        || !Number.isInteger(Math.log2(source.tileWidth)) || source.tileWidth < 1
        || source.hipsOrder + Math.log2(source.tileWidth) > 24
        || !['equatorial', 'galactic'].includes(source.frame) || !['fits', 'jpeg', 'png'].includes(source.format)) {
        throw new RangeError('Invalid epoch source geometry');
    }
}

function inFrame(c: SkyCoord, source: EpochSource): SkyCoord
{
    return source.frame === 'galactic' ? icrsToGalactic(c) : c;
}

/** Tiles containing all output sample centres, sorted by NESTED index.
 * Resolution is sqrt(solid angle per pixel), HiPS 1.0 section 4.2.1.1.
 * The tile cap may force a coarser order. An impossible cap returns no tiles.
 */
export function planEpochTiles(grid: OutputGrid, source: EpochSource = TWO_MASS_K,
    maxTiles = 24, maxStepDown = 1): { order: number; wanted: number; tiles: EpochTile[] }
{
    validate(grid, source, maxTiles);
    if (!Number.isSafeInteger(maxStepDown) || maxStepDown < 0) {
        throw new RangeError('Invalid epoch step limit');
    }
    const basePixel = Math.sqrt(Math.PI / 3) * 180 / Math.PI * 3600 / source.tileWidth;
    let order = source.hipsOrder;
    let bestDistance = Infinity;
    for (let candidate = 0; candidate <= source.hipsOrder; candidate++) {
        const pixel = basePixel / 2 ** candidate;
        const distance = Math.abs(pixel - grid.pixelArcsec);
        if (pixel <= 2 * grid.pixelArcsec && distance < bestDistance) {
            order = candidate;
            bestDistance = distance;
        }
    }
    const wanted = order;
    for (; order >= Math.max(0, wanted - maxStepDown); order--) {
        const cells = new Set<number>();
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                cells.add(skyToHealpix(inFrame(gridPixToSky(grid, { x, y }), source), order));
            }
        }
        if (cells.size <= maxTiles) {
            const extension = source.format === 'jpeg' ? 'jpg' : source.format;
            const base = source.baseUrl.replace(/\/+$/, '');
            return { order, wanted, tiles: [...cells].sort((a, b) => a - b).map((npix) => ({ npix,
                url: `${base}/Norder${order}/Dir${Math.floor(npix / 10000) * 10000}/Npix${npix}.${extension}` })) };
        }
    }
    return { order: Math.max(0, wanted - maxStepDown), wanted, tiles: [] };
}

function fitsTile(bytes: Uint8Array, width: number): Float32Array
{
    // The existing range reader requires HTTP 206 and only reads float32 IMAGE
    // extensions. HiPS uses a complete primary image; reuse its header parser.
    const header = parseHeader(bytes);
    if (header.get('SIMPLE') !== true || header.num('NAXIS') !== 2
        || header.num('NAXIS1') !== width || header.num('NAXIS2') !== width) {
        throw new Error('Invalid FITS tile dimensions');
    }
    const bitpix = header.num('BITPIX');
    if (![8, 16, 32, -32, -64].includes(bitpix)) {
        throw new Error('Unsupported FITS tile BITPIX');
    }
    let end = 0;
    const text = new TextDecoder('ascii');
    for (let offset = 0; offset + 80 <= bytes.length; offset += 80) {
        if (text.decode(bytes.subarray(offset, offset + 8)).trim() === 'END') {
            end = Math.ceil((offset + 80) / 2880) * 2880;
            break;
        }
    }
    const count = width * width;
    const step = Math.abs(bitpix) / 8;
    if (!end || bytes.length < end + count * step) {
        throw new Error('Truncated FITS tile');
    }
    const scale = header.get('BSCALE') === undefined ? 1 : header.num('BSCALE');
    const zero = header.get('BZERO') === undefined ? 0 : header.num('BZERO');
    const blank = bitpix > 0 ? header.get('BLANK') : undefined;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pixels = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const offset = end + i * step;
        const raw = bitpix === 8 ? view.getUint8(offset) : bitpix === 16 ? view.getInt16(offset, false)
            : bitpix === 32 ? view.getInt32(offset, false) : bitpix === -32 ? view.getFloat32(offset, false)
                : view.getFloat64(offset, false);
        pixels[i] = raw === blank || !Number.isFinite(raw) ? NaN : raw * scale + zero;
    }
    return pixels;
}

function imageTile(image: EpochDecoded, width: number): Float32Array
{
    if (image.width !== width || image.height !== width) {
        throw new Error('Wrong tile dimensions');
    }
    const count = width * width;
    const channels = image.data.length / count;
    if (![1, 3, 4].includes(channels)) {
        throw new Error('Wrong tile data length');
    }
    const pixels = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const offset = i * channels;
        pixels[i] = channels === 4 && !(image.data[offset + 3]! > 0) ? NaN
            : channels === 1 ? image.data[offset]!
                : (image.data[offset]! + image.data[offset + 1]! + image.data[offset + 2]!) / 3;
    }
    return pixels;
}

async function loadTile(tile: EpochTile, source: EpochSource, opts: EpochOptions): Promise<Float32Array | EpochMissing>
{
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let phase: 'fetch' | 'decode' = 'fetch';
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort();
    opts.signal?.addEventListener('abort', abort, { once: true });
    const stopped = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Tile stopped')), { once: true });
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
    });
    let httpStatus: number | undefined;
    try {
        if (opts.signal?.aborted) {
            controller.abort();
        }
        const work = async () => {
            controller.signal.throwIfAborted();
            const response = await (opts.fetch ?? globalThis.fetch)(tile.url, { signal: controller.signal, mode: 'cors' });
            if (!response.ok) {
                httpStatus = response.status;
                void response.body?.cancel().catch(() => {});
                throw new Error('HTTP failure');
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            controller.signal.throwIfAborted();
            phase = 'decode';
            if (source.format === 'fits') {
                return fitsTile(bytes, source.tileWidth);
            }
            if (!opts.decode) {
                throw new Error('Image decoder required');
            }
            return imageTile(await opts.decode(bytes), source.tileWidth);
        };
        return await Promise.race([work(), stopped]);
    } catch {
        // Never surface arbitrary network/decoder exception text to page copy.
        return { ...tile, reason: phase, detail: timedOut ? 'Tile timeout'
            : opts.signal?.aborted ? 'Request aborted' : httpStatus !== undefined ? `HTTP ${httpStatus}`
                : phase === 'fetch' ? 'Tile request failed' : 'Tile could not be decoded' };
    } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', abort);
    }
}

export async function readEpoch(grid: OutputGrid, opts: EpochOptions = {}): Promise<EpochResult>
{
    const source = opts.source ?? TWO_MASS_K;
    const fail = (reason: 'no-tiles' | 'fetch' | 'decode' | 'empty' | 'too-large', detail: string,
        missing: EpochMissing[] = []): EpochResult => ({ ok: false, reason, detail, missing });
    if (opts.signal?.aborted) {
        return fail('fetch', 'Request aborted');
    }
    let plan: ReturnType<typeof planEpochTiles>;
    try {
        if (!Number.isFinite(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) || (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) <= 0) {
            throw new RangeError('Invalid timeout');
        }
        const maxPixels = opts.maxPixels ?? 400000;
        if (!Number.isSafeInteger(maxPixels) || maxPixels < 1) {
            throw new RangeError('Invalid pixel limit');
        }
        validate(grid, source, opts.maxTiles ?? 24);
        if (grid.width * grid.height > maxPixels) {
            return fail('too-large', 'This view is too large for the older picture');
        }
        plan = planEpochTiles(grid, source, opts.maxTiles ?? 24, opts.maxStepDown ?? 1);
    } catch {
        return fail('no-tiles', 'Invalid grid, source or tile limits');
    }
    if (!plan.tiles.length) {
        return fail('no-tiles', 'The tile cap cannot cover this grid');
    }
    const replies = await Promise.all(plan.tiles.map((tile) => loadTile(tile, source, opts)));
    const missing = replies.filter((r): r is EpochMissing => !(r instanceof Float32Array));
    if (opts.signal?.aborted) {
        return fail('fetch', 'Request aborted', missing);
    }
    const missingReason = missing.some((m) => m.reason === 'fetch') ? 'fetch' : 'decode';
    if (missing.length && !opts.allowPartial) {
        return fail(missingReason, 'Some tiles are missing', missing);
    }
    const tiles = new Map<number, Float32Array>();
    for (let i = 0; i < replies.length; i++) {
        const reply = replies[i]!;
        if (reply instanceof Float32Array) {
            tiles.set(plan.tiles[i]!.npix, reply);
        }
    }
    const pixels = new Float32Array(grid.width * grid.height).fill(NaN);
    const pixelOrder = plan.order + Math.log2(source.tileWidth);
    let lo = Infinity;
    let hi = -Infinity;
    let finite = 0;
    for (let y = 0; y < grid.height; y++) {
        if (y > 0 && y % 32 === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        if (opts.signal?.aborted) {
            return fail('fetch', 'Request aborted', missing);
        }
        for (let x = 0; x < grid.width; x++) {
            const sky = inFrame(gridPixToSky(grid, { x, y }), source);
            const cell = skyToHealpix(sky, pixelOrder);
            const sample = healpixTilePixel(cell, plan.order, source.tileWidth, source.format);
            const value = tiles.get(sample.npix)?.[sample.y * source.tileWidth + sample.x] ?? NaN;
            if (Number.isFinite(value)) {
                pixels[y * grid.width + x] = value;
                finite++;
                lo = Math.min(lo, value);
                hi = Math.max(hi, value);
            }
        }
    }
    const covered = finite / pixels.length;
    if (opts.allowPartial && covered < 0.5) {
        return missing.length ? fail(missingReason, 'Some tiles are missing', missing)
            : fail('empty', 'Less than half the picture has data', missing);
    }
    if (!(hi > lo)) {
        return fail('empty', 'The picture has no varying finite pixels', missing);
    }
    return { ok: true, width: grid.width, height: grid.height, pixels, band: source.band, order: plan.order,
        wantedOrder: plan.wanted, pixelArcsec: Math.sqrt(Math.PI / 3) * 180 / Math.PI * 3600 / source.tileWidth / 2 ** plan.order,
        coarser: plan.order < plan.wanted, covered, holes: covered < 1,
        values: source.format === 'fits' ? 'fits' : 'display',
        source: { name: source.name, propertiesUrl: source.propertiesUrl, credit: source.credit, creditUrl: source.creditUrl, format: source.format },
        epoch: { label: source.epochLabel, fromMonth: source.fromMonth, toMonth: source.toMonth, nightKnown: source.nightKnown }, missing };
}
