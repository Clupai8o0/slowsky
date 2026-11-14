import type { CardValue, FitsHeader, FitsIndex, HduInfo, RangeReader } from './types';

const BLOCK = 2880;
const FIRST_READ = 11 * BLOCK;
const decoder = new TextDecoder('ascii');

function quoted(text: string): string
{
    let value = '';
    for (let i = 1; i < text.length; i++) {
        if (text[i] === "'") {
            if (text[i + 1] === "'") {
                value += "'";
                i++;
            } else {
                return value.trimEnd();
            }
        } else {
            value += text[i];
        }
    }
    throw new Error('Unterminated FITS string');
}

export function parseHeader(bytes: Uint8Array): FitsHeader
{
    const cards = new Map<string, CardValue>();
    const history: string[] = [];
    let continuation: string | undefined;
    let ended = false;
    for (let offset = 0; offset + 80 <= bytes.length; offset += 80) {
        const card = decoder.decode(bytes.subarray(offset, offset + 80));
        let key = card.slice(0, 8).trim();
        if (key === 'END') {
            ended = true;
            break;
        }
        if (key === 'HISTORY') {
            history.push(card.slice(8).trimEnd().trimStart());
            continue;
        }
        if (key === 'COMMENT' || key === '') {
            cards.set(key, card.slice(8).trim());
            continue;
        }
        if (key === 'CONTINUE') {
            if (continuation === undefined) {
                throw new Error('Orphan CONTINUE card');
            }
            const part = quoted(card.slice(8).trimStart());
            cards.set(continuation, String(cards.get(continuation)).slice(0, -1) + part);
            if (!part.endsWith('&')) {
                continuation = undefined;
            }
            continue;
        }
        continuation = undefined;
        const equals = key === 'HIERARCH' ? card.indexOf('=') : 8;
        if (equals < 0 || card[equals] !== '=') {
            cards.set(key, card.slice(8).trim());
            continue;
        }
        if (key === 'HIERARCH') {
            key = card.slice(8, equals).trim();
        }
        const text = card.slice(equals + 1).trimStart();
        let value: CardValue;
        if (text.startsWith("'")) {
            value = quoted(text);
            if (value.endsWith('&')) {
                continuation = key;
            }
        } else {
            const token = text.split('/')[0]!.trim();
            if (token === 'T' || token === 'F') {
                value = token === 'T';
            } else if (token === '') {
                value = null;
            } else {
                value = Number(token.replace(/[dD]/g, 'E'));
                if (!Number.isFinite(value)) {
                    throw new Error(`Invalid FITS value for ${key}`);
                }
            }
        }
        cards.set(key, value);
    }
    if (!ended) {
        throw new Error('FITS header missing END');
    }
    return {
        cards,
        history,
        get(key)
        {
            return cards.get(key);
        },
        num(key)
        {
            const value = cards.get(key);
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                throw new Error(`Missing or nonnumeric FITS keyword ${key}`);
            }
            return value;
        }
    };
}

export interface RangeReaderOptions {
    fetch?: typeof fetch;
    maxParallel?: number;
    maxBytes?: number;
    // Fallback when neither Content-Range nor HEAD exposes the file size.
    sizeBytes?: number | ((url: string) => number | undefined);
}

function padded(size: number): number
{
    return Math.ceil(size / BLOCK) * BLOCK;
}

function integer(value: number, label: string, minimum = 0): number
{
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
    return value;
}

function chunkUrl(url: string, chunk: number): string
{
    const parsed = new URL(url);
    if (['nasa-irsa-spherex.s3.us-east-1.amazonaws.com', 'nasa-irsa-spherex.s3.amazonaws.com'].includes(parsed.hostname)) {
        parsed.hostname = chunk % 2 === 0 ? 'nasa-irsa-spherex.s3.us-east-1.amazonaws.com' : 'nasa-irsa-spherex.s3.amazonaws.com';
    }
    return parsed.href;
}

export function createRangeReader(opts: RangeReaderOptions = {}): RangeReader
{
    const fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const maxParallel = integer(opts.maxParallel ?? 12, 'maxParallel', 1);
    const maxBytes = integer(opts.maxBytes ?? 16 * 1024 * 1024, 'maxBytes', 1);
    const cache = new Map<string, FitsIndex>();

    function budget(bytes: number): void
    {
        integer(bytes, 'read size');
        if (bytes > maxBytes) {
            throw new Error(`Read exceeds maxBytes (${bytes} > ${maxBytes})`);
        }
    }

    async function range(url: string, start: number, length: number, signal?: AbortSignal, allowShort = false)
    {
        signal?.throwIfAborted();
        budget(length);
        const response = await fetcher(url, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal });
        if (response.status !== 206) {
            try {
                await response.body?.cancel();
            } catch {
                // Report the status even when cancellation fails.
            }
            throw new Error(`Range request requires 206, received ${response.status}`);
        }
        let data: Uint8Array;
        const reader = response.body?.getReader();
        if (reader) {
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    size += value.byteLength;
                    if (size > length) {
                        try {
                            await reader.cancel();
                        } catch {
                            // Report the invalid range even when cancellation fails.
                        }
                        throw new Error(`Wrong range body length: expected ${length}, received ${size}`);
                    }
                    chunks.push(value);
                }
            } finally {
                reader.releaseLock();
            }
            data = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                data.set(chunk, offset);
                offset += chunk.byteLength;
            }
        } else {
            data = new Uint8Array(await response.arrayBuffer());
        }
        signal?.throwIfAborted();
        if (data.length !== length && !(allowShort && data.length < length)) {
            throw new Error(`Wrong range body length: expected ${length}, received ${data.length}`);
        }
        return { data, response };
    }

    return {
        async index(url, signal)
        {
            signal?.throwIfAborted();
            const cached = cache.get(url);
            if (cached) {
                return cached;
            }
            const probe = await range(url, 0, FIRST_READ, signal, true);
            const total = probe.response.headers.get('Content-Range')?.match(/\/(\d+)$/)?.[1];
            let size = total === undefined ? undefined : Number(total);
            if (size === undefined) {
                try {
                    const head = await fetcher(url, { method: 'HEAD', signal });
                    const length = head.headers.get('Content-Length');
                    if (head.ok && length !== null) {
                        size = Number(length);
                    }
                } catch (error) {
                    signal?.throwIfAborted();
                    if (opts.sizeBytes === undefined) {
                        throw error;
                    }
                }
            }
            size ??= typeof opts.sizeBytes === 'function' ? opts.sizeBytes(url) : opts.sizeBytes;
            if (size === undefined) {
                throw new Error('File size unavailable; supply sizeBytes');
            }
            integer(size, 'file size', BLOCK);
            if (probe.data.length !== Math.min(FIRST_READ, size)) {
                throw new Error(`Wrong range body length: expected ${Math.min(FIRST_READ, size)}, received ${probe.data.length}`);
            }
            const hdus: HduInfo[] = [];
            let start = 0;
            let used = probe.data.length;
            budget(used);
            let window = probe.data;
            let windowStart = 0;
            while (start < size) {
                let have = start >= windowStart && start < windowStart + window.length ? window.subarray(start - windowStart) : new Uint8Array(0);
                let scanned = 0;
                let headerBytes = 0;
                while (headerBytes === 0) {
                    for (; scanned + 80 <= have.length; scanned += 80) {
                        if (decoder.decode(have.subarray(scanned, scanned + 8)).trim() === 'END') {
                            headerBytes = padded(scanned + 80);
                            break;
                        }
                    }
                    if (headerBytes > 0) {
                        break;
                    }
                    const next = start + have.length;
                    const length = Math.min(Math.max(FIRST_READ, have.length), size - next);
                    if (length <= 0) {
                        throw new Error('Truncated FITS header');
                    }
                    used += length;
                    budget(used);
                    const { data } = await range(url, next, length, signal);
                    const joined = new Uint8Array(have.length + data.length);
                    joined.set(have);
                    joined.set(data, have.length);
                    have = joined;
                    window = joined;
                    windowStart = start;
                }
                const bytes = have.subarray(0, headerBytes);
                const header = parseHeader(bytes);
                const axes = integer(header.num('NAXIS'), 'NAXIS');
                const bitpix = header.num('BITPIX');
                if (![8, 16, 32, 64, -32, -64].includes(bitpix)) {
                    throw new Error('Unsupported BITPIX');
                }
                let pixels = axes === 0 ? 0 : 1;
                const groups = header.get('GROUPS') === true;
                if (groups && (axes < 2 || header.num('NAXIS1') !== 0)) {
                    throw new Error('Invalid random-groups axes');
                }
                for (let axis = groups ? 2 : 1; axis <= axes; axis++) {
                    pixels *= integer(header.num(`NAXIS${axis}`), `NAXIS${axis}`);
                }
                const pcount = integer(header.get('PCOUNT') === undefined ? 0 : header.num('PCOUNT'), 'PCOUNT');
                const gcount = integer(header.get('GCOUNT') === undefined ? 1 : header.num('GCOUNT'), 'GCOUNT', 1);
                const dataBytes = integer(Math.abs(bitpix) / 8 * gcount * (pixels + pcount), 'HDU size');
                const dataStart = start + bytes.length;
                if (dataStart + padded(dataBytes) > size) {
                    throw new Error('HDU exceeds file size');
                }
                hdus.push({ index: hdus.length, name: String(header.get('EXTNAME') ?? (hdus.length === 0 ? 'PRIMARY' : `HDU${hdus.length}`)), headerStart: start, dataStart, dataBytes, header });
                start = dataStart + padded(dataBytes);
            }
            const index: FitsIndex = {
                url, sizeBytes: size, hdus,
                hdu(name)
                {
                    const hdu = hdus.find(item => item.name === name);
                    if (!hdu) {
                        throw new Error(`Missing HDU ${name}`);
                    }
                    return hdu;
                }
            };
            cache.set(url, index);
            return index;
        },
        async readFloat32(index, name, box, signal)
        {
            signal?.throwIfAborted();
            const hdu = index.hdu(name);
            const h = hdu.header;
            if (h.num('BITPIX') !== -32 || h.num('NAXIS') !== 2 || (h.get('XTENSION') !== 'IMAGE' && !(hdu.index === 0 && h.get('SIMPLE') === true))) {
                throw new Error('Expected float32 IMAGE HDU');
            }
            const width = integer(h.num('NAXIS1'), 'width', 1);
            const height = integer(h.num('NAXIS2'), 'height', 1);
            for (const value of Object.values(box)) {
                integer(value, 'box coordinate');
            }
            if (box.x1 <= box.x0 || box.y1 <= box.y0 || box.x1 > width || box.y1 > height) {
                throw new Error('Invalid pixel box');
            }
            const rows = box.y1 - box.y0;
            budget(rows * width * 4);
            const output = new Float32Array((box.x1 - box.x0) * rows);
            const count = Math.min(maxParallel, rows);
            const controller = new AbortController();
            const abort = () => controller.abort(signal?.reason);
            signal?.addEventListener('abort', abort, { once: true });
            const scale = h.get('BSCALE') === undefined ? 1 : h.num('BSCALE');
            const zero = h.get('BZERO') === undefined ? 0 : h.num('BZERO');
            try {
                await Promise.all(Array.from({ length: count }, async (_, chunk) => {
                    const first = Math.floor(chunk * rows / count);
                    const last = Math.floor((chunk + 1) * rows / count);
                    const { data } = await range(chunkUrl(index.url, chunk), hdu.dataStart + (box.y0 + first) * width * 4, (last - first) * width * 4, controller.signal);
                    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
                    for (let row = first; row < last; row++) {
                        for (let x = box.x0; x < box.x1; x++) {
                            output[row * (box.x1 - box.x0) + x - box.x0] = view.getFloat32(((row - first) * width + x) * 4, false) * scale + zero;
                        }
                    }
                }));
            } catch (error) {
                controller.abort();
                throw error;
            } finally {
                signal?.removeEventListener('abort', abort);
            }
            return output;
        },
        async readWaveGrid(index, signal)
        {
            const hdu = index.hdu('WCS-WAVE');
            const h = hdu.header;
            if (h.get('XTENSION') !== 'BINTABLE' || h.num('NAXIS2') !== 1 || h.num('TFIELDS') !== 3 || h.get('TTYPE1') !== 'X' || h.get('TFORM1') !== '9J' || h.get('TTYPE2') !== 'Y' || h.get('TFORM2') !== '9J' || h.get('TTYPE3') !== 'VALUES' || h.get('TFORM3') !== '162E' || String(h.get('TDIM3')).replace(/\s/g, '') !== '(2,9,9)' || h.num('NAXIS1') !== 720) {
                throw new Error('Unsupported WCS-WAVE table layout');
            }
            budget(hdu.dataBytes);
            const { data } = await range(index.url, hdu.dataStart, hdu.dataBytes, signal);
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            // frame1.wave.json starts at FITS pixel 1 and ends at 2040: subtract
            // one to match its astropy origin=0 samples at pixels 0 and 2039.
            const xs = Array.from({ length: 9 }, (_, i) => view.getInt32(i * 4, false) - 1);
            const ys = Array.from({ length: 9 }, (_, i) => view.getInt32(36 + i * 4, false) - 1);
            const lambda = Array.from({ length: 9 }, (_, y) => Array.from({ length: 9 }, (_, x) => view.getFloat32(72 + (y * 9 + x) * 8, false)));
            const bandwidth = Array.from({ length: 9 }, (_, y) => Array.from({ length: 9 }, (_, x) => view.getFloat32(76 + (y * 9 + x) * 8, false)));
            return { xs, ys, lambda, bandwidth };
        }
    };
}
