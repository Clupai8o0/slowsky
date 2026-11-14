// Library only: no page or DOM integration. JPEG/PNG samples are display
// intensities after the publisher's stretch, never calibrated SPHEREx fluxes.
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
    epochLabel: string;
}

// Snapshot of the live properties response; probe details in tests/fixtures/epoch.
// All values, including the credit and its URL, are verbatim from:
// https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/K/properties
// t_min=50600, t_max=51941 (MJD UTC) -> 1997-06-01, 2001-02-01.
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
    creditUrl: 'http://www.ipac.caltech.edu/2mass/',
    epochLabel: '2MASS survey: 1997-06-01–2001-02-01',
});

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
    maxTiles?: number;
}

export type EpochResult = {
    ok: true;
    width: number;
    height: number;
    pixels: Float32Array;
    band: string;
    order: number;
    // 'fits' means BSCALE/BZERO-applied tile values; no physical unit is implied.
    // 'display' is the publisher's stretched JPEG/PNG intensity, never flux.
    values: 'display' | 'fits';
    source: { name: string; propertiesUrl: string; credit: string; creditUrl: string; format: EpochSource['format'] };
    epoch: { label: string };
    missing: EpochMissing[];
} | {
    ok: false;
    reason: 'no-tiles' | 'fetch' | 'decode' | 'empty';
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
    maxTiles = 16): { order: number; tiles: EpochTile[] }
{
    validate(grid, source, maxTiles);
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
    for (; order >= 0; order--) {
        const cells = new Set<number>();
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                cells.add(skyToHealpix(inFrame(gridPixToSky(grid, { x, y }), source), order));
            }
        }
        if (cells.size <= maxTiles) {
            const extension = source.format === 'jpeg' ? 'jpg' : source.format;
            const base = source.baseUrl.replace(/\/+$/, '');
            return { order, tiles: [...cells].sort((a, b) => a - b).map((npix) => ({ npix,
                url: `${base}/Norder${order}/Dir${Math.floor(npix / 10000) * 10000}/Npix${npix}.${extension}` })) };
        }
    }
    return { order: 0, tiles: [] };
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
    const fail = (reason: 'no-tiles' | 'fetch' | 'decode' | 'empty', detail: string,
        missing: EpochMissing[] = []): EpochResult => ({ ok: false, reason, detail, missing });
    if (opts.signal?.aborted) {
        return fail('fetch', 'Request aborted');
    }
    let plan: ReturnType<typeof planEpochTiles>;
    try {
        if (!Number.isFinite(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) || (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) <= 0) {
            throw new RangeError('Invalid timeout');
        }
        plan = planEpochTiles(grid, source, opts.maxTiles ?? 16);
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
    if (missing.length > plan.tiles.length / 2) {
        return fail(missing.some((m) => m.reason === 'fetch') ? 'fetch' : 'decode', 'More than half the tiles are missing', missing);
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
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            const sky = inFrame(gridPixToSky(grid, { x, y }), source);
            const cell = skyToHealpix(sky, pixelOrder);
            const sample = healpixTilePixel(cell, plan.order, source.tileWidth, source.format);
            const value = tiles.get(sample.npix)?.[sample.y * source.tileWidth + sample.x] ?? NaN;
            if (Number.isFinite(value)) {
                pixels[y * grid.width + x] = value;
                lo = Math.min(lo, value);
                hi = Math.max(hi, value);
            }
        }
    }
    if (!(hi > lo)) {
        return fail('empty', 'The picture has no varying finite pixels', missing);
    }
    return { ok: true, width: grid.width, height: grid.height, pixels, band: source.band, order: plan.order,
        values: source.format === 'fits' ? 'fits' : 'display',
        source: { name: source.name, propertiesUrl: source.propertiesUrl, credit: source.credit, creditUrl: source.creditUrl, format: source.format },
        epoch: { label: source.epochLabel }, missing };
}
