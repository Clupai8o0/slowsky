import { parseHeader } from './fits';
import { healpixPosition } from './healpix';
import type { FitsHeader, SkyCoord } from './types';

export class CubeError extends Error {
    constructor(message: string, options?: ErrorOptions)
    {
        super(message, options);
        this.name = 'CubeError';
    }
}

export interface CubeSpot {
    tile: string;
    url: string;
    x: number;
    y: number;
}

export interface CubeSpectrum {
    lambda: Float64Array;
    surfaceBrightness: Float32Array;
    noise: Float32Array;
    reasons: ('no data' | null)[];
    notes: string[];
    background: Float32Array;
    unit: string;
    spot: CubeSpot;
    bytesRead: number;
    caption: string;
}

// IRSA's DR1 directory documentation + HiPS cube tutorial, checked 2026-11-14:
// https://irsa.ipac.caltech.edu/spherex-archive-documentation/spherex-data-access/#browsable-directories
// https://caltech-ipac.github.io/irsa-tutorials/spherex-hipscube/
const ROOT = 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/dr1/hips5_cube';
export const CUBE_FOLDER = 'hips_20261026';
export const CUBE_UNIT = 'MJy/sr';
export const CUBE_QUANTITY = 'surface brightness, mean of 3 × 3 pixels minus the local background';
export const CUBE_CAPTION = 'Quick look from the one-year all-sky cube. Each wavelength was observed on a different date, so a star that varies can look jagged. Not for measurement.';
const cache = new Map<string, { image: Hdu; primary: Hdu; lambda: Float64Array }>();

export function clearCubeCache(): void
{
    cache.clear();
}

export async function findCubeFolder(fetcher: typeof fetch = globalThis.fetch): Promise<string>
{
    try {
        const response = await fetcher('https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/?list-type=2&prefix=dr1/hips5_cube/&delimiter=/');
        if (!response.ok) {
            return CUBE_FOLDER;
        }
        const body = await response.text();
        if (!/<ListBucketResult(?:\s|>)/.test(body) || !body.trimEnd().endsWith('</ListBucketResult>')
            || /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(body)) {
            return CUBE_FOLDER;
        }
        const folders = [...body.matchAll(/<Prefix>dr1\/hips5_cube\/(hips_(\d{4})(\d{2})(\d{2}))\/<\/Prefix>/g)]
            .filter(match => {
                // Only a real calendar date counts: a name like hips_99999999 would make every tile read fail.
                const [year, month, day] = [Number(match[2]), Number(match[3]), Number(match[4])];
                const date = new Date(Date.UTC(year, month - 1, day));
                return year >= 2025 && year <= 2099 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
            })
            .map(match => match[1]!);
        return folders.sort().at(-1) ?? CUBE_FOLDER;
    } catch {
        return CUBE_FOLDER;
    }
}
const TILE_ORDER = 5;
// Real tiles need about 12 header blocks from the start of the file to the wavelength table.
const HEADER_BLOCK_BUDGET = 40;
const TILE_WIDTH = 512;
const BLOCK = 2880;

/** Coordinates must already be at the cube epoch (use targets.positionAt). */
export function cubeSpot(c: SkyCoord, folder = CUBE_FOLDER): CubeSpot
{
    try {
        const { cell, dx, dy } = healpixPosition(c, TILE_ORDER);
        return {
            tile: `Npix${cell}`,
            url: `${ROOT}/${folder}/Norder${TILE_ORDER}/Dir${Math.floor(cell / 10000) * 10000}/Npix${cell}_cube.fits`,
            // HiPS raster axes are the rotated face axes, with centres at integers.
            x: TILE_WIDTH * dy - 0.5,
            y: TILE_WIDTH * (1 - dx) - 0.5
        };
    } catch (cause) {
        throw new CubeError('Invalid cube sky position', { cause });
    }
}

interface Hdu {
    header: FitsHeader;
    dataStart: number;
    dataBytes: number;
}

function integer(value: number, label: string, minimum = 0): number
{
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new CubeError(`Invalid ${label}: ${value}`);
    }
    return value;
}

function optionalNumber(h: FitsHeader, key: string, fallback: number): number
{
    return h.get(key) === undefined ? fallback : h.num(key);
}

function median(values: number[]): number
{
    if (values.length === 0) {
        return NaN;
    }
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
}

function sample(view: DataView, offset: number, bitpix: number): number
{
    // FITS numerical data are big endian; never use the machine's native order.
    switch (bitpix) {
        case 8: return view.getUint8(offset);
        case 16: return view.getInt16(offset, false);
        case 32: return view.getInt32(offset, false);
        case -32: return view.getFloat32(offset, false);
        case -64: return view.getFloat64(offset, false);
        default: throw new CubeError(`Unsupported BITPIX ${bitpix}`);
    }
}

function tableArray(h: FitsHeader, data: Uint8Array, name: string): Float64Array
{
    let offset = 0;
    const fields = integer(h.num('TFIELDS'), 'table fields', 1);
    for (let column = 1; column <= fields; column++) {
        const form = /^(\d*)([IJEDBAKLXCM])$/.exec(String(h.get(`TFORM${column}`)).trim());
        if (!form) {
            throw new CubeError('Unsupported WCS-WAVE table format');
        }
        const count = integer(Number(form[1] || '1'), 'table repeat', 1);
        const code = form[2]!;
        const sizes: Record<string, number> = { I: 2, J: 4, E: 4, D: 8, B: 1, A: 1, K: 8, L: 1, X: 1 / 8, C: 8, M: 16 };
        const length = Math.ceil(count * sizes[code]!);
        if (h.get(`TTYPE${column}`) === name) {
            if (!['I', 'J', 'E', 'D', 'B'].includes(code) || offset + length > data.length) {
                throw new CubeError(`Invalid WCS-WAVE column ${name}`);
            }
            const bitpix = ({ I: 16, J: 32, E: -32, D: -64, B: 8 } as Record<string, number>)[code]!;
            const scale = optionalNumber(h, `TSCAL${column}`, 1);
            const zero = optionalNumber(h, `TZERO${column}`, 0);
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            return Float64Array.from({ length: count }, (_, i) => sample(view, offset + i * sizes[code]!, bitpix) * scale + zero);
        }
        offset += length;
    }
    throw new CubeError(`Missing WCS-WAVE column ${name}`);
}

function wavelengths(image: FitsHeader, wave: Hdu, data: Uint8Array, depth: number): Float64Array
{
    if (image.get('CTYPE3') !== 'WAVE-TAB' || wave.header.num('NAXIS2') !== 1) {
        throw new CubeError('Unsupported cube spectral WCS');
    }
    const indices = tableArray(wave.header, data, String(image.get('PS3_2')));
    const values = tableArray(wave.header, data, String(image.get('PS3_1')));
    if (indices.length !== values.length || indices.length < 2) {
        throw new CubeError('Invalid WCS-WAVE vector sizes');
    }
    for (let i = 0; i < indices.length; i++) {
        if (!Number.isFinite(indices[i]) || !Number.isFinite(values[i]) || (i > 0 && indices[i]! <= indices[i - 1]!)) {
            throw new CubeError('Invalid WCS-WAVE samples');
        }
    }
    const unit = String(image.get('CUNIT3')).trim().toLowerCase();
    const factor = ({ um: 1, micron: 1, m: 1e6, nm: 1e-3 } as Record<string, number>)[unit];
    if (factor === undefined) {
        throw new CubeError(`Unsupported wavelength unit ${unit}`);
    }
    return Float64Array.from({ length: depth }, (_, plane) => {
        const index = image.num('CRVAL3') + (plane + 1 - image.num('CRPIX3')) * image.num('CDELT3') * optionalNumber(image, 'PC3_3', 1);
        if (index < indices[0]! || index > indices.at(-1)!) {
            throw new CubeError(`Wavelength index outside lookup for plane ${plane}`);
        }
        let left = 0;
        while (left < indices.length - 2 && index > indices[left + 1]!) {
            left++;
        }
        return (values[left]! + (values[left + 1]! - values[left]!) * (index - indices[left]!) / (indices[left + 1]! - indices[left]!)) * factor;
    });
}

function verifyGrid(h: FitsHeader, c: SkyCoord, spot: CubeSpot): void
{
    if (h.get('CTYPE1') !== 'RA---HPX' || h.get('CTYPE2') !== 'DEC--HPX' || h.num('CRVAL1') !== 0
        || h.num('CRVAL2') !== 0 || h.num('PV2_1') !== 4 || h.num('PV2_2') !== 3) {
        throw new CubeError('Unsupported cube sky WCS');
    }
    const z = Math.sin(c.dec * Math.PI / 180);
    const lon = ((c.ra % 360) + 540) % 360 - 180;
    const sigma = Math.sqrt(3) * Math.cos(c.dec * Math.PI / 180) / Math.sqrt(1 + Math.abs(z));
    const meridian = 90 * Math.floor((lon + 180) / 90) - 135;
    const px = Math.abs(z) <= 2 / 3 ? lon : meridian + (lon - meridian) * sigma;
    const py = Math.abs(z) <= 2 / 3 ? 67.5 * z : Math.sign(z) * 45 * (2 - sigma);
    const a = h.num('PC1_1') * h.num('CDELT1');
    const b = h.num('PC1_2') * h.num('CDELT1');
    const d = h.num('PC2_1') * h.num('CDELT2');
    const e = h.num('PC2_2') * h.num('CDELT2');
    const determinant = a * e - b * d;
    for (const turn of [-360, 0, 360]) {
        const x = h.num('CRPIX1') - 1 + (e * (px + turn) - b * py) / determinant;
        const y = h.num('CRPIX2') - 1 + (a * py - d * (px + turn)) / determinant;
        if (Math.abs(x - spot.x) < 1e-6 && Math.abs(y - spot.y) < 1e-6) {
            return;
        }
    }
    throw new CubeError('Cube header sky grid disagrees with the HiPS tile layout');
}

export async function readCubeSpectrum(c: SkyCoord, opts: {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    boxPx?: number;
    concurrency?: number;
    folder?: string;
} = {}): Promise<CubeSpectrum>
{
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener('abort', forwardAbort, { once: true });
    let bytesRead = 0;
    const fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);

    async function range(start: number, length: number): Promise<Uint8Array>
    {
        controller.signal.throwIfAborted();
        const response = await fetcher(spot.url, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal: controller.signal });
        if (response.status !== 206) {
            await response.body?.cancel().catch(() => undefined);
            throw new CubeError(`Range requires 206, received ${response.status}`);
        }
        const chunks: Uint8Array[] = [];
        let received = 0;
        const reader = response.body?.getReader();
        if (reader) {
            const cancel = (): void => {
                void reader.cancel(controller.signal.reason).catch(() => undefined);
            };
            controller.signal.addEventListener('abort', cancel, { once: true });
            try {
                while (true) {
                    controller.signal.throwIfAborted();
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    received += value.byteLength;
                    if (received > length) {
                        throw new CubeError(`Wrong range length: expected ${length}, received more`);
                    }
                    chunks.push(value);
                }
            } catch (cause) {
                await reader.cancel().catch(() => undefined);
                throw cause;
            } finally {
                controller.signal.removeEventListener('abort', cancel);
                reader.releaseLock();
            }
        }
        controller.signal.throwIfAborted();
        if (received !== length) {
            throw new CubeError(`Wrong range length: expected ${length}, received ${received}`);
        }
        const result = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        bytesRead += length;
        return result;
    }

    let initial: Uint8Array | undefined;
    let headerBlocks = 0;
    async function hdu(start: number): Promise<Hdu>
    {
        const blocks: Uint8Array[] = [];
        for (let block = 0; block < 45; block++) {
            // One budget for every header of the read: a forged chain of long headers stops early.
            if (++headerBlocks > HEADER_BLOCK_BUDGET) {
                throw new CubeError(`Cube FITS headers exceed ${HEADER_BLOCK_BUDGET} blocks`);
            }
            const offset = start + block * BLOCK;
            const data = initial && offset + BLOCK <= initial.length ? initial.slice(offset, offset + BLOCK) : await range(offset, BLOCK);
            blocks.push(data);
            let ended = false;
            for (let card = 0; card < BLOCK; card += 80) {
                if (new TextDecoder('ascii').decode(data.subarray(card, card + 8)) === 'END     ') {
                    ended = true;
                    break;
                }
            }
            if (ended) {
                const raw = new Uint8Array(blocks.length * BLOCK);
                blocks.forEach((part, i) => raw.set(part, i * BLOCK));
                const header = parseHeader(raw);
                const axes = integer(header.num('NAXIS'), 'NAXIS');
                let elements = axes === 0 ? 0 : 1;
                for (let axis = 1; axis <= axes; axis++) {
                    elements = integer(elements * integer(header.num(`NAXIS${axis}`), `NAXIS${axis}`), 'axis product');
                }
                const dataBytes = integer((elements * Math.abs(header.num('BITPIX')) / 8 + optionalNumber(header, 'PCOUNT', 0))
                    * optionalNumber(header, 'GCOUNT', 1), 'HDU data size');
                return { header, dataStart: start + raw.length, dataBytes };
            }
        }
        throw new CubeError('Cube FITS header exceeds 45 blocks');
    }

    let spot: CubeSpot;
    try {
        if (opts.signal?.aborted) {
            forwardAbort();
        }
        controller.signal.throwIfAborted();
        // A 5 x 5 box holds no pixel 3 px from the centre, so it would have no background at all.
        const boxPx = integer(opts.boxPx ?? 11, 'boxPx', 7);
        if (boxPx % 2 !== 1 || boxPx > 31) {
            throw new CubeError('boxPx must be odd, between 7 and 31');
        }
        const concurrency = Math.min(8, integer(opts.concurrency ?? 8, 'concurrency', 1));
        spot = cubeSpot(c, opts.folder);
        let image: Hdu;
        let primary: Hdu;
        let loadWave: () => Promise<Float64Array>;
        const cached = cache.get(spot.url);
        if (cached) {
            cache.delete(spot.url);
            cache.set(spot.url, cached);
            image = cached.image;
            primary = cached.primary;
            loadWave = async () => cached.lambda;
        } else {
            initial = await range(0, 3 * BLOCK);
            primary = await hdu(0);
            const imageStart = primary.dataStart + Math.ceil(primary.dataBytes / BLOCK) * BLOCK;
            image = await hdu(imageStart);
            if (image.header.get('EXTNAME') !== 'IMAGE') {
                throw new CubeError('Missing IMAGE HDU');
            }
            const imageHdu = image;
            loadWave = async (): Promise<Float64Array> => {
                let start = integer(imageHdu.dataStart + Math.ceil(imageHdu.dataBytes / BLOCK) * BLOCK, 'next HDU');
                for (let index = 0; index < 10; index++) {
                    const current = await hdu(start);
                    if (current.header.get('EXTNAME') === imageHdu.header.get('PS3_0')) {
                        if (current.dataBytes > 65536) {
                            throw new CubeError('Unbounded WCS-WAVE HDU');
                        }
                        const lambda = wavelengths(imageHdu.header, current, await range(current.dataStart, current.dataBytes), integer(imageHdu.header.num('NAXIS3'), 'plane count', 1));
                        cache.set(spot.url, { image: imageHdu, primary, lambda });
                        if (cache.size > 8) {
                            cache.delete(cache.keys().next().value!);
                        }
                        return lambda;
                    }
                    start = integer(current.dataStart + Math.ceil(current.dataBytes / BLOCK) * BLOCK, 'next HDU');
                }
                throw new CubeError('Missing WCS-WAVE HDU');
            };
        }
        const h = image.header;
        const width = integer(h.num('NAXIS1'), 'image width', 1);
        const height = integer(h.num('NAXIS2'), 'image height', 1);
        const depth = integer(h.num('NAXIS3'), 'plane count', 1);
        if (width !== TILE_WIDTH || height !== TILE_WIDTH || depth !== 102 || h.num('ORDER') !== TILE_ORDER
            || `Npix${h.num('NPIX')}` !== spot.tile || h.num('NAXIS') !== 3) {
            throw new CubeError('Unsupported DR1 cube dimensions or tile identity');
        }
        verifyGrid(h, c, spot);
        const bitpix = h.num('BITPIX');
        if (![8, 16, 32, -32, -64].includes(bitpix)) {
            throw new CubeError(`Unsupported IMAGE BITPIX ${bitpix}`);
        }
        const pixelBytes = Math.abs(bitpix) / 8;
        const scale = optionalNumber(h, 'BSCALE', 1);
        const zero = optionalNumber(h, 'BZERO', 0);
        const blank = bitpix > 0 ? h.get('BLANK') : undefined;
        const unit = h.get('BUNIT');
        if (typeof unit !== 'string' || unit.length === 0) {
            throw new CubeError('Missing cube BUNIT');
        }
        const cx = Math.max(0, Math.min(width - 1, Math.floor(spot.x + 0.5)));
        const cy = Math.max(0, Math.min(height - 1, Math.floor(spot.y + 0.5)));
        const half = (boxPx - 1) / 2;
        const x0 = Math.max(0, cx - half);
        const x1 = Math.min(width, cx + half + 1);
        const y0 = Math.max(0, cy - half);
        const y1 = Math.min(height, cy + half + 1);
        const clipped = x0 !== cx - half || y0 !== cy - half || x1 !== cx + half + 1 || y1 !== cy + half + 1;
        const length = ((y1 - y0 - 1) * width + x1 - x0) * pixelBytes;
        const surfaceBrightness = new Float32Array(depth).fill(NaN);
        const noise = new Float32Array(depth).fill(NaN);
        const reasons: ('no data' | null)[] = Array(depth).fill('no data');
        const blankCard = primary.header.get('BLANKCH') ?? h.get('BLANKCH');
        const blankPlanes = new Set<number>();
        if (typeof blankCard === 'string' && /^D[1-6]:\d{2}(?:,D[1-6]:\d{2})*$/.test(blankCard.trim())) {
            const parts = blankCard.trim().split(',');
            if (parts.every(part => Number(part.slice(3)) >= 1 && Number(part.slice(3)) <= 17)) {
                for (const part of parts) {
                    blankPlanes.add((Number(part[1]) - 1) * 17 + Number(part.slice(3)) - 1);
                }
            }
        }
        const background = new Float32Array(depth).fill(NaN);
        let next = 0;
        let failure: CubeError | undefined;

        async function worker(): Promise<void>
        {
            while (!controller.signal.aborted && next < depth) {
                const plane = next++;
                if (blankPlanes.has(plane)) {
                    continue;
                }
                try {
                    const offset = image!.dataStart + (plane * width * height + y0 * width + x0) * pixelBytes;
                    const data = await range(offset, length);
                    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
                    const sky: number[] = [];
                    let sum = 0;
                    let count = 0;
                    let missingCenter = false;
                    for (let y = y0; y < y1; y++) {
                        for (let x = x0; x < x1; x++) {
                            const raw = sample(view, ((y - y0) * width + x - x0) * pixelBytes, bitpix);
                            const value = raw === blank ? NaN : raw * scale + zero;
                            if (!Number.isFinite(value)) {
                                if (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1) {
                                    missingCenter = true;
                                }
                                continue;
                            }
                            if (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1) {
                                sum += value;
                                count++;
                            }
                            if ((x - cx) ** 2 + (y - cy) ** 2 >= 9) {
                                sky.push(value);
                            }
                        }
                    }
                    const bg = median(sky);
                    background[plane] = bg;
                    if (sky.length >= 8) {
                        noise[plane] = 1.4826 * median(sky.map(value => Math.abs(value - bg)));
                    }
                    if (!missingCenter && count === 9 && Number.isFinite(bg)) {
                        surfaceBrightness[plane] = sum / count - bg;
                        reasons[plane] = null;
                    }
                } catch (cause) {
                    failure ??= new CubeError(`Cube plane ${plane} failed${opts.signal?.aborted ? ' (aborted)' : ''}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
                    controller.abort(failure);
                }
            }
        }

        const [lambda] = await Promise.all([loadWave(), Promise.all(Array.from({ length: concurrency }, () => worker()))]);
        if (failure) {
            throw failure;
        }
        controller.signal.throwIfAborted();
        const noData = reasons.filter(reason => reason !== null).length;
        const centreCut = cx < 1 || cy < 1 || cx > width - 2 || cy > height - 2;
        const notes: string[] = [];
        if (noData > 0) {
            notes.push('A colour has no data where the cube is blank in any of the 3 × 3 pixels at the spot.');
        }
        if (centreCut) {
            notes.push('The spot is on the edge of a sky tile, so its 3 × 3 pixels are cut off and no plane can be measured here');
        } else if (clipped) {
            notes.push('The spot is near the edge of a sky tile, so the background ring around it is cut short.');
        }
        return { lambda, surfaceBrightness, background, noise, reasons, notes, unit, spot, bytesRead, caption: CUBE_CAPTION };
    } catch (cause) {
        controller.abort(cause);
        if (cause instanceof CubeError) {
            throw cause;
        }
        throw new CubeError(`Cube read failed${opts.signal?.aborted ? ' (aborted)' : ''}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    } finally {
        opts.signal?.removeEventListener('abort', forwardAbort);
    }
}

export const LINES: readonly { um: number; label: string }[] = [
    { um: 1.083, label: 'He I' },
    { um: 1.875, label: 'Paschen α' },
    { um: 3.05, label: 'H2O ice' },
    { um: 3.3, label: 'CH4 and PAH' },
    { um: 4.05, label: 'Brackett α' },
    { um: 4.27, label: 'CO2 ice' },
    { um: 4.67, label: 'CO ice' }
];
