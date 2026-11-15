import {describe, it, expect, beforeAll, afterAll, vi} from 'vitest';
// @ts-expect-error Node built-ins are provided by the Vitest host.
import * as fsHost from 'node:fs/promises';
const {readFile, readdir} = fsHost as {readFile(path: URL): Promise<Uint8Array>; readdir(path: URL): Promise<string[]>};
// @ts-expect-error Node built-ins are provided by the Vitest host.
import {gzipSync} from 'node:zlib';
// @ts-expect-error Node built-ins are provided by the Vitest host.
import {performance} from 'node:perf_hooks';
// @ts-expect-error Node built-ins are provided by the Vitest host.
import {Buffer} from 'node:buffer';
// @ts-expect-error Node built-ins are provided by the Vitest host.
import process from 'node:process';
import {SlowskyEngine as engine, type UploadFile, type Candidate, type Stage, type StageInfo} from '../src/lib/upload-engine';

class TestImageData {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number)
    {
    }
}

beforeAll(() => vi.stubGlobal('ImageData', TestImageData));
afterAll(() => vi.unstubAllGlobals());

function card(key: string, value?: string | number | boolean)
{
    let text = key.padEnd(8);
    if (value !== undefined) {
        const formatted = typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` :
            typeof value === 'boolean' ? (value ? 'T' : 'F') : String(value);
        text += '= ' + formatted;
    }
    return text.padEnd(80).slice(0, 80);
}

function imageHdu({width = 3, height = 2, bitpix = -32, values = [1, 2, 3, 4, 5, 6] as [number, number, number, number, number, number],
    primary = true, header = {}}: {width?: number; height?: number; bitpix?: number; values?: ArrayLike<number>; primary?: boolean; header?: Record<string, string | number | boolean>} = {})
{
    const entries: [string, string | number | boolean][] = [[primary ? 'SIMPLE' : 'XTENSION', primary ? true : 'IMAGE'],
        ['BITPIX', bitpix], ['NAXIS', width ? 2 : 0]];
    if (width) {
        entries.push(['NAXIS1', width], ['NAXIS2', height]);
    }
    if (!primary) {
        entries.push(['PCOUNT', 0], ['GCOUNT', 1]);
    }
    entries.push(...Object.entries(header));
    const text = entries.map(([key, value]) => card(key, value)).join('') + card('END');
    const head = Buffer.from(text.padEnd(Math.ceil(text.length / 2880) * 2880));
    const length = width * height * Math.abs(bitpix) / 8;
    const data = Buffer.alloc(Math.ceil(length / 2880) * 2880);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // `values` are in display order (row 0 = top). FITS stores row 1 at the bottom, so write rows bottom-up;
    // the engine flips them back, and tests keep reading data[y * width + x] with y down.
    for (let i = 0; i < width * height; i++) {
        const offset = i * Math.abs(bitpix) / 8;
        const v = values[(height - 1 - Math.floor(i / width)) * width + (i % width)]!;
        if (bitpix === 8) {
            view.setUint8(offset, v);
        } else if (bitpix === 16) {
            view.setInt16(offset, v, false);
        } else if (bitpix === 32) {
            view.setInt32(offset, v, false);
        } else if (bitpix === -32) {
            view.setFloat32(offset, v, false);
        } else if (bitpix === -64) {
            view.setFloat64(offset, v, false);
        }
    }
    return Buffer.concat([head, data]);
}

function compressedHdu()
{
    const entries = {XTENSION: 'BINTABLE', BITPIX: 8, NAXIS: 2, NAXIS1: 8,
        NAXIS2: 1, PCOUNT: 16, GCOUNT: 1, ZIMAGE: true, EXTNAME: 'IMAGE'};
    const text = Object.entries(entries).map(([k, v]) => card(k, v)).join('') + card('END');
    return Buffer.concat([Buffer.from(text.padEnd(2880)), Buffer.alloc(2880)]);
}

function file(bytes: BlobPart | number[] | Uint8Array, name = 'frame.fits', lastModified?: number): UploadFile
{
    const blob = new Blob([Array.isArray(bytes) || bytes instanceof Uint8Array ? new Uint8Array(bytes) : bytes]);
    Object.defineProperty(blob, 'name', {value: name});
    if (lastModified !== undefined) {
        Object.defineProperty(blob, 'lastModified', {value: lastModified});
    }
    return blob;
}

function random(seed: number)
{
    return function ()
    {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed + 0.5) / 4294967296;
    };
}

const stars: [number, number, number][] = [[15.3, 16.7, 90] as [number, number, number], [39.7, 19.2, 75] as [number, number, number], [68.2, 14.6, 65] as [number, number, number],
    [99.1, 21.3, 85] as [number, number, number], [22.4, 45.6, 100] as [number, number, number], [48.2, 38.8, 70] as [number, number, number], [78.7, 44.1, 95] as [number, number, number],
    [109.2, 54.5, 80] as [number, number, number], [13.6, 79.2, 60] as [number, number, number], [42.3, 87.4, 110] as [number, number, number], [75.8, 82.6, 90] as [number, number, number],
    [103.1, 92.7, 75] as [number, number, number]];

function field({width = 128, height = 112, dx = 0, dy = 0, sky = 100, seed = 7,
    sources = stars, noise = 1}: {width?: number; height?: number; dx?: number; dy?: number; sky?: number; seed?: number; sources?: [number, number, number][]; noise?: number} = {})
{
    const rand = random(seed);
    const data = new Float32Array(width * height);
    for (let i = 0; i < data.length; i++) {
        data[i]! = sky + noise * Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
    }
    for (const [sx, sy, amplitude] of sources) {
        const cx = sx + dx;
        const cy = sy + dy;
        for (let y = Math.max(0, Math.floor(cy - 7)); y <= Math.min(height - 1, Math.ceil(cy + 7)); y++) {
            for (let x = Math.max(0, Math.floor(cx - 7)); x <= Math.min(width - 1, Math.ceil(cx + 7)); x++) {
                data[y * width + x]! += amplitude * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 1.4 ** 2));
            }
        }
    }
    return data;
}

function fitsField(data: ArrayLike<number>, name = 'field.fits', width = 128, height = 112, header = {})
{
    return file(imageHdu({width, height, values: data, header}), name);
}

function pictureImage(values: ArrayLike<number>)
{
    const data = new Uint8ClampedArray(values.length * 4);
    for (let i = 0; i < values.length; i++) {
        data[i * 4]! = data[i * 4 + 1]! = data[i * 4 + 2]! = values[i]!;
        data[i * 4 + 3]! = 255;
    }
    return {width: 128, height: 112, data};
}

function close(actual: number, expected: number, tolerance = 1e-5)
{
    expect(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`).toBeTruthy();
}


describe('upload engine', () => {

    it('FITS big-endian types, scaling, blanks and dates', async function ()
    {
        for (const bitpix of [-32, 16, 8, 32, -64] as [number, number, number, number, number]) {
            const values = bitpix === 16 ? [-32768, -32767, -1, 0, 1, 32767] as [number, number, number, number, number, number] : [1, 2, 3, 4, 5, 6] as [number, number, number, number, number, number];
            const header = {BSCALE: 2, BZERO: bitpix === 16 ? 32768 : 3,
                'DATE-OBS': '2025-01-02T03:04:05.123', BUNIT: 'MJy/sr', INSTRUME: 'SPHEREx', DETECTOR: 1};
            const frame = await engine.readFile(file(imageHdu({bitpix, values, header})));
            expect(frame.width).toBe(3);
            expect(frame.height).toBe(2);
            expect(frame.kind).toBe('fits');
            expect(frame.data instanceof Float32Array).toBeTruthy();
            expect(Array.from(frame.data)).toEqual(values.map(v => v * 2 + header.BZERO));
            expect(frame.date!.toISOString()).toBe('2025-01-02T03:04:05.123Z');
            expect(frame.dateSource).toBe('DATE-OBS');
            expect(frame.unit).toBe('MJy/sr');
            expect(frame.meta.instrument).toBe('SPHEREx');
            expect(frame.meta.detector).toBe(1);
        }
        const blank = await engine.readFile(file(imageHdu({bitpix: 16, values: [1, -99, 3, 4, 5, 6] as [number, number, number, number, number, number], header: {BLANK: -99}})));
        expect(Number.isNaN(blank.data[1]!)).toBeTruthy();
        for (const key of ['MJD-OBS', 'MJD-AVG']) {
            const frame = await engine.readFile(file(imageHdu({header: {[key]: 51544.5}})));
            expect(frame.date!.toISOString()).toBe('2000-01-01T12:00:00.000Z');
            expect(frame.dateSource).toBe('MJD-OBS');
        }
        const fallback = await engine.readFile(file(imageHdu({header: {'DATE-OBS': 'invalid'}}), 'fallback.fits', 0));
        expect(fallback.dateSource).toBe('file');
        expect(fallback.date!.getTime()).toBe(0);
        const undated = await engine.readFile(file(imageHdu()));
        expect(undated.date).toBe(null);
        expect(undated.dateSource).toBe('none');
    });

    it('IMAGE preference, primary metadata, ZIMAGE skip, ZODI and gzip', async function ()
    {
        const bytes = Buffer.concat([
            imageHdu({values: [99, 99, 99, 99, 99, 99] as [number, number, number, number, number, number], header: {'DATE-OBS': '2025-02-03', INSTRUME: 'SPHEREx'}}),
            compressedHdu(),
            imageHdu({primary: false, header: {EXTNAME: 'IMAGE', BUNIT: 'MJy/sr'}, values: [10, 20, 30, 40, 50, 60] as [number, number, number, number, number, number]}),
            imageHdu({primary: false, header: {EXTNAME: 'ZODI'}, values: [1, 2, 3, 4, 5, 6] as [number, number, number, number, number, number]})
        ]);
        const plain = await engine.readFile(file(bytes));
        expect(Array.from(plain.data)).toEqual([9, 18, 27, 36, 45, 54] as [number, number, number, number, number, number]);
        expect(plain.meta.hdu).toBe(2);
        expect(plain.date!.toISOString()).toBe('2025-02-03T00:00:00.000Z');
        expect(plain.meta.instrument).toBe('SPHEREx');
        expect(plain.warnings.some(w => /ZIMAGE.*not supported/i.test(w))).toBeTruthy();
        expect(plain.warnings.includes("Zodiacal light model removed (from the file's ZODI plane)")).toBeTruthy();
        for (const name of ['frame.fits.gz', 'magic.fits']) {
            const zipped = await engine.readFile(file(gzipSync(bytes), name));
            expect(Array.from(zipped.data)).toEqual(Array.from(plain.data));
            expect(zipped.date!.getTime()).toBe(plain.date!.getTime());
        }
        await expect(engine.readFile(file(Buffer.concat([imageHdu({width: 0}), compressedHdu()])))).rejects.toThrow(/ZIMAGE|tile.compressed/i);
        await expect(engine.readFile(file(bytes.subarray(0, 100)))).rejects.toThrow(/truncated|header/i);
    });

    it('PNG/JPG replaceable decoder, luminance, alpha mask and warning', async function ()
    {
        const original = engine.decodeImage;
        engine.decodeImage = async function ()
        {
            return {width: 2, height: 1, data: new Uint8ClampedArray([100, 50, 20, 255, 9, 8, 7, 0] as [number, number, number, number, number, number, number, number])};
        };
        try {
            for (const name of ['display.png', 'display.JPG']) {
                const frame = await engine.readFile(file(new Uint8Array([1, 2, 3] as [number, number, number]), name, 1234));
                close(frame.data[0]!, 0.2126 * 100 + 0.7152 * 50 + 0.0722 * 20);
                expect(Number.isNaN(frame.data[1]!)).toBeTruthy();
                expect(frame.kind).toBe(name.endsWith('png') ? 'png' : 'jpg');
                expect(frame.dateSource).toBe('file');
                expect(frame.unit).toBe(null);
                expect(frame.warnings.includes('Display image: brightness is already stretched, so changes are rough')).toBeTruthy();
            }
        } finally {
            engine.decodeImage = original;
        }
    });

    it('translation voting and centroid refinement recover known subpixel shifts', async function ()
    {
        for (const [dx, dy] of [[3.4, -2.2] as [number, number], [-5.7, 4.3] as [number, number], [0.35, 0.4] as [number, number]]) {
            const session = await engine.process([fitsField(field(), 'ref.fits'),
                fitsField(field({dx, dy, seed: 19}), 'moved.fits')]);
            expect(session.shifts[1]!.ok).toBe(true);
            expect(session.shifts[1]!.method).toBe('stars');
            close(session.shifts[1]!.dx, -dx, 0.3);
            close(session.shifts[1]!.dy, -dy, 0.3);
            const s = session.shifts[1]!;
            const edgeX = s.dx < 0 ? session.width - 1 : 0;
            expect(Number.isNaN(session.frames[1]!.data[50 * session.width + edgeX]!)).toBeTruthy();
            const index = 46 * 128 + 22;
            close(session.frames[1]!.data[index]!, session.frames[0]!.data[index]!, 12);
        }
    });

    it('hot pixels align; one missing neighbour must not blank the star', async function ()
    {
        const hot = [[20, 20] as [number, number], [90, 30] as [number, number], [60, 80] as [number, number], [100, 95] as [number, number], [30, 70] as [number, number], [75, 15] as [number, number]];
        const withHot = (data: Float32Array) => {
            for (const [x, y] of hot) {
                data[y * 128 + x]! += 5000;
            }
            return data;
        };
        const few = [[40, 40, 300] as [number, number, number], [85, 60, 250] as [number, number, number], [55, 85, 280] as [number, number, number], [25, 95, 260] as [number, number, number]];
        const session = await engine.process([fitsField(withHot(field({sources: few})), 'ref.fits'),
            fitsField(withHot(field({sources: few, dx: 6.3, dy: -4.6, seed: 19})), 'moved.fits')]);
        expect(session.shifts[1]!.ok).toBe(true);
        close(session.shifts[1]!.dx, -6.3, 0.5);
        close(session.shifts[1]!.dy, 4.6, 0.5);

        const data = field({dx: 0.25, dy: 0, seed: 19});
        const ref = field();
        const peak = ref.indexOf(Math.max(...ref));
        data[peak + 1]! = NaN;
        const one = await engine.process([fitsField(ref, 'ref.fits'), fitsField(data, 'blank.fits')]);
        expect(one.shifts[1]!.ok).toBe(true);
        expect(Number.isFinite(one.frames[1]!.data[peak]!), 'one missing neighbour must not blank the star').toBeTruthy();
        expect(one.frames[1]!.edgeMask![peak]).toBe(1);
    });

    it('starless frames fail honestly, including WCS-bearing frames', async function ()
    {
        const flat = new Float32Array(128 * 112).fill(50);
        const wcs = {CRVAL1: 10, CRVAL2: 20, CRPIX1: 64, CRPIX2: 56, CDELT1: 0.01, CDELT2: 0.01};
        const session = await engine.process([fitsField(field()), fitsField(flat, 'starless.fits', 128, 112, wcs)]);
        expect(session.frames[1]!.meta.hasWcs).toBe(true);
        expect(session.shifts[1]!.ok).toBe(false);
        expect(session.shifts[1]!.method).toBe('stars');
        expect(session.shifts[1]!.dx).toBe(0);
        expect(session.shifts[1]!.dy).toBe(0);
        expect(session.frames[1]!.data.every(v => v === 0)).toBeTruthy();
        expect(session.notes.includes("Couldn't line up starless.fits; shown as is")).toBeTruthy();
    });

    it('quantized PNG stars with equal-height peaks still align', async function ()
    {
        const width = 80;
        function quantized(dx: number)
        {
            const data = new Uint8ClampedArray(width * width * 4);
            for (let y = 0; y < width; y++) {
                for (let x = 0; x < width; x++) {
                    let value = 0;
                    for (const [sx, sy] of [[15.5, 15.5] as [number, number], [48.5, 20.5] as [number, number], [27.5, 53.5] as [number, number]]) {
                        value += 240 * Math.exp(-((x - sx - dx) ** 2 + (y - sy) ** 2) / 4);
                    }
                    const offset = (y * width + x) * 4;
                    data[offset]! = data[offset + 1]! = data[offset + 2]! = Math.round(value);
                    data[offset + 3]! = 255;
                }
            }
            return {width, height: width, data};
        }
        const session = await engine.process([file([], 'ref.png'), file([], 'shifted.png')], {
            decodeImage: async input => quantized(input.name === 'ref.png' ? 0 : 3)
        });
        expect(session.shifts[1]!.ok).toBe(true);
        close(session.shifts[1]!.dx, -3, 0.3);
        close(session.shifts[1]!.dy, 0, 0.3);
    });

    it('browser-style asynchronous cancellation runs between processing stages', async function ()
    {
        const controller = new AbortController();
        const seen: (Stage | 'error')[] = [];
        await expect(engine.process([fitsField(field()), fitsField(field(), 'second.fits')], {
            signal: controller.signal,
            onJob: function (i, name)
            {
                seen.push(name);
                if (name === 'size') {
                    setTimeout(() => controller.abort(), 0);
                }
            }
        })).rejects.toMatchObject({name: 'AbortError'});
        expect(seen.includes('ready')).toBe(false);
    });

    it('date ordering, centre cropping, stage reporting and aborts', async function ()
    {
        const events: {i: number; stage: string; info: StageInfo}[] = [];
        const session = await engine.process([
            fitsField(new Float32Array(48).fill(5), 'undated.fits', 8, 6),
            fitsField(new Float32Array(16).fill(9), 'late.fits', 4, 4, {'DATE-OBS': '2026-02-01'}),
            fitsField(Float32Array.from({length: 36}, (_, i) => i), 'early.fits', 6, 6, {'DATE-OBS': '2025-02-01'})
        ], {onJob: (i, stage, info) => events.push({i, stage, info})});
        expect(Array.from(session.frames, f => f.name)).toEqual(['early.fits', 'late.fits', 'undated.fits']);
        expect(session.ref).toBe(0);
        expect(session.width).toBe(4);
        expect(session.height).toBe(4);
        // Centre crop of the 6x6 ramp starts at (1,1); its median is 17.5.
        close(session.frames[0]!.data[0]!, 7 - 17.5);
        expect(session.notes.some(note => /crop/i.test(note))).toBeTruthy();
        expect(Array.from(engine.STAGES)).toEqual(['read', 'header', 'decode', 'size', 'align', 'stretch', 'ready']);
        for (let i = 0; i < 3; i++) {
            expect(events.filter(event => event.i === i).map(event => event.stage)).toEqual(Array.from(engine.STAGES));
            expect(events.filter(event => event.i === i).every(event => event.info.name)).toBeTruthy();
        }
        for (const stopStage of engine.STAGES) {
            const controller = new AbortController();
            const seen: (Stage | 'error')[] = [];
            await expect(engine.process([fitsField(field())], {signal: controller.signal,
                onJob: function (i, stage)
                {
                    seen.push(stage);
                    if (stage === stopStage) {
                        controller.abort();
                    }
                }})).rejects.toMatchObject({name: 'AbortError'});
            expect(seen.at(-1)).toBe(stopStage);
        }
        const already = new AbortController();
        already.abort();
        await expect(engine.process([fitsField(field())], {signal: already.signal})).rejects.toMatchObject({name: 'AbortError'});
        await expect(engine.process([])).rejects.toThrow(/file|frame/i);
    });

    it('median background removal and one reference asinh stretch prevent fake brightening', async function ()
    {
        // Exactly representable values keep the +50 experiment free of float rounding differences.
        const data = Float32Array.from(field(), v => Math.round(v * 16) / 16);
        data[0]! = NaN;
        const offset = Float32Array.from(data, v => v + 50);
        const session = await engine.process([fitsField(data), fitsField(offset, 'offset.fits')]);
        const original = engine.render(session, 0, {mode: 'blink'});
        const shiftedSky = engine.render(session, 1, {mode: 'blink'});
        expect(original instanceof TestImageData).toBeTruthy();
        expect(original.data).toEqual(shiftedSky.data);
        const sorted = Array.from(session.frames[0]!.data).filter(Number.isFinite).sort((a, b) => a - b);
        function percentile(p: number)
        {
            const index = (sorted.length - 1) * p;
            const low = Math.floor(index);
            return sorted[low]! + (sorted[Math.ceil(index)]! - sorted[low]!) * (index - low);
        }
        close(session.stretch.lo, percentile(0.01));
        close(session.stretch.hi, percentile(0.997));
        const position = 10;
        const t = Math.max(0, Math.min(1, (session.frames[0]!.data[position]! - session.stretch.lo) /
            (session.stretch.hi - session.stretch.lo)));
        const expected = Math.round(255 * Math.asinh(10 * t) / Math.asinh(10));
        expect(original.data[position * 4]!).toBe(expected);
        expect(original.data[3]!).toBe(0);
        expect(engine.candidates(session, 0, 1).length).toBe(0);
    });

    it('frames in different units are not combined', async function ()
    {
        const values = [1, 2, 3, 4, 5, 6] as [number, number, number, number, number, number];
        const jy = file(imageHdu({values, header: {BUNIT: 'Jy', 'DATE-OBS': '2025-01-01'}}), 'a.fits');
        const mjy = file(imageHdu({values: values.map(v => v * 1000), header: {BUNIT: 'mJy', 'DATE-OBS': '2025-06-01'}}), 'b.fits');
        const same = file(imageHdu({values, header: {BUNIT: 'J y', 'DATE-OBS': '2025-03-01'}}), 'c.fits');
        const errors: string[] = [];
        const session = await engine.process([jy, mjy, same], {align: false,
            onJob: (i, stage, info) => { if (stage === 'error') { errors.push(info.name); } }});
        expect([...session.frames].map(f => f.name)).toEqual(['a.fits', 'c.fits']);
        expect(session.failed.length).toBe(1);
        expect(session.failed[0]!.error).toMatch(/mJy/);
        expect(errors).toEqual(['b.fits']);
    });

    it('stack is a NaN-aware mean; subtraction uses signed orange and blue', async function ()
    {
        const makeFrame = (data: number[]) => ({data: new Float32Array(data), width: 3, height: 2});
        // b - a = [NaN, NaN, 5, -2, 0, 0]: median 0, so the zero pixels stay near-black after median centring.
        const session = {frames: [makeFrame([NaN, 2, 3, 4, 4, 6]), makeFrame([5, NaN, 8, 2, 4, 6])],
            width: 3, height: 2, ref: 0, stretch: {lo: 0, hi: 10}};
        const stack = engine.render(session, 0, {mode: 'stack'});
        const mean = {...session, frames: [makeFrame([5, 2, 5.5, 3, 4, 6] as [number, number, number, number, number, number])]};
        expect(stack.data).toEqual(engine.render(mean, 0, {mode: 'blink'}).data);
        const diff = engine.render(session, 0, {mode: 'subtract', a: 0, b: 1});
        expect(diff.data[3]!).toBe(0);
        expect(diff.data[8]! > diff.data[10]!, 'positive difference is orange').toBeTruthy();
        expect(diff.data[14]! > diff.data[12]!, 'negative difference is blue').toBeTruthy();
        expect(diff.data[20]! < 20 && diff.data[21]! < 20 && diff.data[22]! < 20).toBeTruthy();
        expect(() => engine.render(session, 8)).toThrow(/index|frame/i);
        // A + B: the mean of the two visits on the same stretch; a blank pixel in either stays blank.
        const sum = engine.render(session, 0, {mode: 'sum', a: 0, b: 1});
        const sumMean = {...session, frames: [makeFrame([NaN, NaN, 5.5, 3, 4, 6])]};
        expect(sum.data).toEqual(engine.render(sumMean, 0, {mode: 'blink'}).data);
        expect(sum.data[3]!, 'blank in A stays blank').toBe(0);
    });

    it('20 sigma brightening ranks first, faintening has its sign, noise gives no candidates', async function ()
    {
        const changed: [number, number, number][] = [...stars, [62.2, 62.4, 20 * Math.sqrt(2)]];
        const session = await engine.process([fitsField(field()), fitsField(field({sources: changed, seed: 987}), 'bright.fits')]);
        const candidates = engine.candidates(session, 0, 1, {k: 5});
        expect(candidates.length > 0).toBeTruthy();
        const top = candidates[0]!;
        expect(top.sign).toBe('brighter');
        close(top.x, 62.2, 1);
        close(top.y, 62.4, 1);
        expect(top.peak / top.sigma > 10).toBeTruthy();
        expect(top.pixels >= 2).toBeTruthy();
        expect(engine.candidates(session, 1, 0)[0]!.sign).toBe('fainter');
        for (let i = 1; i < candidates.length; i++) {
            const score = (c: Candidate) => Math.abs(c.peak / c.sigma) * Math.sqrt(Math.min(c.pixels, 9));
            expect((candidates[i]!.edge && !candidates[i - 1]!.edge) ||
                (candidates[i]!.edge === candidates[i - 1]!.edge && score(candidates[i - 1]!) >= score(candidates[i]!))).toBeTruthy();
        }
        const noise = await engine.process([fitsField(field({sources: [], seed: 1})),
            fitsField(field({sources: [], seed: 2}), 'noise.fits')]);
        expect(engine.candidates(noise, 0, 1, {k: 5}).length).toBe(0);
    });

    it('fractional alignment shares the blur without hiding a 20 sigma brightening', async function ()
    {
        const bright = stars.map(([x, y, amplitude]): [number, number, number] => [x, y, amplitude * 10]);
        const reference = fitsField(field({sources: bright}), 'ref.fits');
        const moved = fitsField(field({sources: bright, dx: 0.5, dy: 0.5, seed: 19}), 'moved.fits');
        const unchanged = await engine.process([reference, moved]);
        close(unchanged.shifts[1]!.dx, -0.5, 0.1);
        close(unchanged.shifts[1]!.dy, -0.5, 0.1);
        expect(engine.candidates(unchanged, 0, 1, {k: 5}).length, 'interpolation must not turn unchanged bright stars into candidates').toBe(0);
        const changed = await engine.process([reference, fitsField(field({dx: 0.5, dy: 0.5, seed: 19,
            sources: [...bright, [62.2, 62.4, 20 * Math.sqrt(2)]]}), 'bright.fits')]);
        const top = engine.candidates(changed, 0, 1, {k: 5})[0]!;
        expect(top, 'a real change must survive the shared smoothing').toBeTruthy();
        close(top.x, 62.2, 1);
        close(top.y, 62.4, 1);
        expect(top.sign).toBe('brighter');
        expect(top.peak / top.sigma > 5).toBeTruthy();
    });

    it('a faint mover beside two blank pixels survives smoothing and is marked edge', async function ()
    {
        const moved = field({dx: 0.5, dy: 0.5, seed: 19, sources: [...stars, [60, 60, 12]]});
        moved[60 * 128 + 60]! = NaN;
        moved[61 * 128 + 61]! = NaN;
        const session = await engine.process([fitsField(field(), 'ref.fits'), fitsField(moved, 'moved.fits')]);
        const mover = engine.candidates(session, 0, 1).find(c => Math.hypot(c.x - 60, c.y - 60) < 3);
        expect(mover).toBeTruthy();
        expect(mover!.edge).toBe(true);
    });

    it('smoothing renormalizes partial kernels but leaves large gaps blank', async function ()
    {
        const reference = field({noise: 0});
        const moved = field({noise: 0, dx: 0.5, dy: 0.5});
        for (const data of [reference, moved]) {
            for (let y = 50; y <= 70; y++) {
                for (let x = 50; x <= 70; x++) {
                    data[y * 128 + x]! = 120;
                }
            }
            data[60 * 128 + 61]! = NaN;
            for (let y = 90; y <= 100; y++) {
                for (let x = 50; x <= 60; x++) {
                    data[y * 128 + x]! = NaN;
                }
            }
        }
        const session = await engine.process([fitsField(reference), fitsField(moved)]);
        for (const frame of session.frames) {
            close(frame.data[60 * 128 + 60]!, 20, 0.01);
            expect(frame.edgeMask![60 * 128 + 60]).toBe(1);
            expect(Number.isNaN(frame.data[95 * 128 + 55]!)).toBe(true);
        }
    });

    it('tiny accepted shifts preserve original pixels without softening', async function ()
    {
        const reference = fitsField(field({noise: 0}), 'ref.fits');
        const moved = fitsField(field({noise: 0, dx: 0.004, dy: -0.004}), 'tiny.fits');
        const session = await engine.process([reference, moved]);
        const original = await engine.process([reference, moved], {align: false});
        expect(session.shifts[1]!.ok).toBe(true);
        expect(Math.abs(session.shifts[1]!.dx)).toBeGreaterThan(0.001);
        expect(Math.abs(session.shifts[1]!.dx)).toBeLessThan(0.05);
        expect(Math.abs(session.shifts[1]!.dy)).toBeLessThan(0.05);
        expect(session.frames.every((frame, f) => frame.data.every((value, i) =>
            Object.is(value, original.frames[f]!.data[i]!)))).toBe(true);
        expect(session.notes.some(note => note.includes('softened'))).toBe(false);
    });

    it('failed alignment leaves its frame unsmoothed beside a fractional match', async function ()
    {
        const failed = fitsField(field({sources: [], seed: 123}), 'unaligned.fits');
        const alone = await engine.process([failed]);
        const session = await engine.process([fitsField(field(), 'ref.fits'),
            fitsField(field({dx: 0.5, dy: 0.5, seed: 19}), 'moved.fits'), failed]);
        expect(session.shifts[1]!.ok && session.shifts[1]!.dx !== Math.round(session.shifts[1]!.dx)).toBeTruthy();
        expect(session.shifts[2]!.ok).toBe(false);
        expect(session.notes.includes("Couldn't line up unaligned.fits; shown as is")).toBeTruthy();
        expect(session.notes.filter(note => note.includes('detection numbers') && note.includes('softened')).length).toBe(1);
        expect(session.notes.some(note => note.includes('different softening') && note.includes('Subtract'))).toBe(true);
        expect(engine.difference(session, 0, 2).every(Number.isNaN)).toBe(true);
        expect(engine.candidates(session, 0, 2)).toEqual([]);
        expect(session.frames[2]!.data.every((value, i) => Object.is(value, alone.frames[0]!.data[i]!)), 'failed frames retain their original sky-subtracted samples').toBeTruthy();
    });

    it('matched-star flux scales pictures, preserves FITS units and needs five matches', async function ()
    {
        const reference = field({sky: 10, sources: stars.map(([x, y, a]): [number, number, number] => [x, y, a * 0.7])});
        const changed = reference.slice();
        const extra = field({sky: 0, noise: 0, sources: [[62.2, 62.4, 30] as [number, number, number]]});
        for (let i = 0; i < changed.length; i++) {
            changed[i]! = 2 * (changed[i]! + extra[i]!);
        }
        const session = await engine.process([file([], 'ref.png'), file([], 'gain.jpg')], {
            decodeImage: async input => {
                const values = input.name === 'ref.png' ? reference : changed;
                const data = new Uint8ClampedArray(values.length * 4);
                for (let i = 0; i < values.length; i++) {
                    data[i * 4]! = data[i * 4 + 1]! = data[i * 4 + 2]! = values[i]!;
                    data[i * 4 + 3]! = 255;
                }
                return {width: 128, height: 112, data};
            }
        });
        expect(session.frames[0]!.scale).toBe(1);
        close(session.frames[1]!.scale, 2, 0.02);
        expect(session.notes.includes('gain.jpg was made 50% dimmer so its stars match ref.png'), session.notes.join(' | ')).toBeTruthy();
        const top = engine.candidates(session, 0, 1)[0]!;
        close(top.x, 62.2, 1);
        close(top.y, 62.4, 1);
        const physical = await engine.process([fitsField(reference, 'ref.fits'),
            fitsField(Float32Array.from(reference, v => 2 * v), 'gain.fits')], {align: false});
        expect(physical.frames[1]!.scale, 'physical values must never be divided by the measured ratio').toBe(1);
        close(physical.frames[1]!.data[20 * 128 + 40]!, 2 * physical.frames[0]!.data[20 * 128 + 40]!);
        expect(physical.notes.includes('gain.fits is 100% brighter overall than ref.fits; Subtract may mark every star')).toBeTruthy();
        const dimmer = await engine.process([fitsField(reference, 'ref.fits'),
            fitsField(Float32Array.from(reference, v => 0.8 * v), 'dim.fits')], {align: false});
        expect(dimmer.notes.includes('dim.fits is 20% fainter overall than ref.fits; Subtract may mark every star')).toBeTruthy();
        const similar = await engine.process([fitsField(reference, 'ref.fits'),
            fitsField(Float32Array.from(reference, v => 1.05 * v), 'similar.fits')], {align: false});
        expect(similar.notes.some(note => /overall/.test(note))).toBe(false);
        const few = field({sources: stars.slice(0, 4)});
        const insufficient = await engine.process([fitsField(few, 'few.fits'),
            fitsField(Float32Array.from(few, v => 2 * v), 'few-gain.fits')]);
        expect(insufficient.frames[1]!.scale).toBe(1);
        expect(insufficient.notes.some(note => /overall/.test(note))).toBe(false);
    });

    it('too few brightness stars warn for PNG, JPG and FITS without scaling', async function ()
    {
        const note = 'Too few stars to match brightness between dates, so Subtract may mark every star.';
        for (const count of [4, 0] as [number, number]) {
            const reference = field({sky: 10, sources: stars.slice(0, count).map(([x, y]): [number, number, number] => [x, y, 45])});
            const changed = Float32Array.from(reference, value => 2 * value);
            for (const kind of ['png', 'jpg', 'fits']) {
                const inputs = kind === 'fits' ? [fitsField(reference, 'ref.fits'), fitsField(changed, 'gain.fits')]
                    : [file([], 'ref.' + kind), file([], 'gain.' + kind)];
                const session = await engine.process(inputs, {align: count === 0, decodeImage: async input =>
                    pictureImage(input.name!.startsWith('ref') ? reference : changed)});
                expect(session.frames[1]!.scale).toBe(1);
                if (count > 0) {
                    close(session.frames[1]!.data[17 * 128 + 15]! / session.frames[0]!.data[17 * 128 + 15]!, 2, 0.05);
                } else {
                    expect(session.shifts[1]!.ok, 'a failed alignment also leaves brightness unmeasured').toBe(false);
                }
                expect(session.notes.includes(note), kind + ' must report an unmeasured brightness match').toBeTruthy();
                expect(session.notes.some(value => /so its stars match/.test(value))).toBe(false);
            }
        }
    });

    it('picture brightness match skips clipped stars, not merely the brightest ones', async function ()
    {
        const picture = (values: Float32Array, name: string): [UploadFile, Float32Array] => [file([], name), values];
        const decodeFrom = (map: Map<string | undefined, Float32Array>) => async (input: UploadFile) => {
            const values = map.get(input.name)!;
            const data = new Uint8ClampedArray(values.length * 4);
            for (let i = 0; i < values.length; i++) {
                data[i * 4]! = data[i * 4 + 1]! = data[i * 4 + 2]! = values[i]!;
                data[i * 4 + 3]! = 255;
            }
            return {width: 128, height: 112, data};
        };
        const run = async (pairs: [UploadFile, Float32Array][]) => engine.process(pairs.map(([f]) => f), {decodeImage: decodeFrom(new Map(pairs.map(([f, v]) => [f.name, v])))});
        // Unclipped: five stars of 45 to 65, and a twice-as-bright copy whose brightest pixel is about 150.
        const faint = field({sky: 10, sources: stars.slice(0, 5).map(([x, y], n): [number, number, number] => [x, y, 45 + 5 * n])});
        const unclipped = await run([picture(faint, 'ref.png'), picture(Float32Array.from(faint, v => 2 * v), 'twice.png')]);
        close(unclipped.frames[1]!.scale, 2, 0.05);
        // Clipped: in the brighter copy seven of twelve stars hit 255 and must not vote, or the ratio is pulled toward 1.
        const mixed = field({sky: 10, sources: stars.slice(0, 12).map(([x, y], n): [number, number, number] => [x, y, n < 7 ? 200 : 50])});
        const clipped = await run([picture(mixed, 'ref.png'), picture(Float32Array.from(mixed, v => Math.min(255, 2 * v)), 'clip.png')]);
        close(clipped.frames[1]!.scale, 2, 0.05);
        // Colour: a clipped red channel (255, 0, 0) has a grey value of only 54, but is still clipped.
        const red = async (values: Float32Array, name: string): Promise<[UploadFile, Float32Array]> => [file([], name), values];
        const redRun = async (pairs: [UploadFile, Float32Array][]) => engine.process(pairs.map(([f]) => f), {decodeImage: async input => {
            const values = new Map(pairs.map(([f, v]) => [f.name, v])).get(input.name)!;
            const data = new Uint8ClampedArray(values.length * 4);
            for (let i = 0; i < values.length; i++) {
                data[i * 4]! = values[i]!;
                data[i * 4 + 3]! = 255;
            }
            return {width: 128, height: 112, data};
        }});
        const redStars = field({sky: 10, sources: stars.slice(0, 12).map(([x, y], n): [number, number, number] => [x, y, n < 7 ? 220 : 50])});
        const redSession = await redRun([await red(redStars, 'ref.png'),
            await red(Float32Array.from(redStars, v => Math.min(255, 2 * v)), 'red.png')]);
        close(redSession.frames[1]!.scale, 2, 0.05);
    });

    it('clipped source footprints are excluded only from comparison after alignment and brightness scaling', async function ()
    {
        const sources = stars.map(([x, y], i): [number, number, number] => [x, y, i === 0 ? 600 : 45]);
        const images = [pictureImage(field({sky: 10, sources})),
            pictureImage(field({sky: 10, sources: [...sources, [62.2, 62.4, 20] as [number, number, number]], dx: 0.5, dy: 0.5, seed: 19}).map(v => 2 * v))];
        const session = await engine.process([file([], 'ref.png'), file([], 'gain.jpg')], {
            decodeImage: async input => images[input.name === 'ref.png' ? 0 : 1]!
        });
        close(session.frames[1]!.scale, 2, 0.08);
        const comparison = engine.difference(session, 0, 1);
        for (let f = 0; f < session.frames.length; f++) {
            const frame = session.frames[f]!;
            const shift = session.shifts[f]!;
            expect(frame.clipped!.some(value => value), 'each picture has a clipped source').toBeTruthy();
            for (let y = 10; y < 24; y++) {
                for (let x = 9; x < 23; x++) {
                    const left = Math.floor(x - shift.dx);
                    const top = Math.floor(y - shift.dy);
                    let mixed = false;
                    for (let yy = top - 4; yy <= Math.ceil(y - shift.dy) + 4; yy++) {
                        for (let xx = left - 4; xx <= Math.ceil(x - shift.dx) + 4; xx++) {
                            mixed = mixed || !!frame.clipped![yy * 128 + xx]!;
                        }
                    }
                    if (mixed) {
                        expect(Number.isFinite(frame.data[y * 128 + x]!)).toBe(true);
                        expect(Number.isNaN(comparison[y * 128 + x]!)).toBe(true);
                    }
                }
            }
        }
        expect(session.notes.includes('Pixels too bright for the camera were left out of the comparison.')).toBeTruthy();
        const found = engine.candidates(session, 0, 1);
        expect(found.length > 0).toBeTruthy();
        close(found[0]!.x, 62.2, 1);
        close(found[0]!.y, 62.4, 1);
        expect(found.some(c => Math.hypot(c.x - 15.3, c.y - 16.7) < 5 && !c.edge), 'blank clipping footprints cannot become confident candidates').toBe(false);
    });

    it('mostly clipped pictures retain opaque white cores in Blink Stack and Sum', async function ()
    {
        const values = new Float32Array(128 * 112).fill(255);
        values.fill(10, 0, 1000);
        const session = await engine.process([file([], 'a.png'), file([], 'b.jpg')], {
            align: false, decodeImage: async () => pictureImage(values)
        });
        expect(session.frames.every(f => f.data.every(Number.isFinite))).toBe(true);
        for (const mode of ['blink', 'stack', 'sum']) {
            expect(Array.from(engine.render(session, 0, {mode}).data.slice(4000, 4004))).toEqual([255, 255, 255, 255]);
        }
        expect(Number.isNaN(engine.difference(session, 0, 1)[1000]!)).toBe(true);
        expect(engine.candidates(session, 0, 1)).toEqual([]);
    });

    it('brightness apertures reject clipped Gaussian taps before taking the median', async function ()
    {
        const sources = stars.map(([x, y]): [number, number, number] => [Math.round(x), Math.round(y), 55]);
        const reference = pictureImage(field({sky: 10, sources}));
        const changed = pictureImage(field({sky: 10, seed: 19, dx: 0.5, dy: 0.5,
            sources: sources.map(([x, y, a], i): [number, number, number] => [x, y, a * (i < 7 ? 1.1 : 2)])}));
        // These red-only clipped samples sit outside the 9x9 apertures but inside their Gaussian support.
        for (const [x, y] of sources.slice(0, 7)) {
            const i = ((y + 1) * 128 + x + 8) * 4;
            changed.data[i]! = 255;
            changed.data[i + 1]! = changed.data[i + 2]! = 0;
        }
        const session = await engine.process([file([], 'ref.png'), file([], 'gain.jpg')], {
            decodeImage: async input => input.name === 'ref.png' ? reference : changed
        });
        expect(session.frames[1]!.clipped!.reduce((sum, value) => sum + value, 0)).toBe(7);
        expect(session.shifts[1]!.ok && session.shifts[1]!.dx !== Math.round(session.shifts[1]!.dx)).toBeTruthy();
        close(session.frames[1]!.scale, 2, 0.08);
        expect(session.notes.some(note => /Too few stars/.test(note)), 'five clean apertures still supply a median').toBe(false);
    });

    it('candidate rank rewards supported changes and caps the area bonus at nine pixels', function ()
    {
        const width = 48;
        const data = Float32Array.from({length: width * width}, (_, i) => i % 3 - 1);
        data[5 * width + 5]! = 40;
        for (let y = 10; y < 12; y++) {
            for (let x = 10; x < 12; x++) {
                data[y * width + x]! = 24;
            }
        }
        for (let y = 20; y < 31; y++) {
            for (let x = 20; x < 31; x++) {
                data[y * width + x]! = 12;
            }
        }
        const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
        const found = engine.candidates(session, 0, 1);
        expect(Array.from(found, c => c.pixels)).toEqual([4, 1, 121] as [number, number, number]);
        expect(Array.from(found, c => c.peak)).toEqual([24, 40, 12] as [number, number, number]);
        expect(found.every(c => c.sigma === found[0]!.sigma)).toBeTruthy();
    });

    it('a bridge splits into candidates at separate local maxima for either sign', function ()
    {
        const width = 32;
        for (const sign of [1, -1] as [number, number]) {
            const data = Float32Array.from({length: width * width}, (_, i) => i % 3 - 1);
            for (let step = 0; step <= 4; step++) {
                data[(10 + step) * width + 10 + step]! = sign * (step === 0 ? 40 : step === 4 ? 30 : 12);
            }
            const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
            const found = engine.candidates(session, 0, 1);
            expect(found.length).toBe(2);
            expect(found.reduce((sum, c) => sum + c.pixels, 0)).toBe(5);
            close(found[0]!.x, 10, 0.75);
            close(found[0]!.y, 10, 0.75);
            close(found[1]!.x, 14, 0.75);
            close(found[1]!.y, 14, 0.75);
            expect(found.every(c => c.sign === (sign > 0 ? 'brighter' : 'fainter'))).toBeTruthy();
        }
        const data = Float32Array.from({length: width * width}, (_, i) => i % 3 - 1);
        const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
        for (const [x, y, value] of [[10, 10, 100] as [number, number, number], [11, 11, 12] as [number, number, number], [12, 12, 90] as [number, number, number], [13, 12, 12] as [number, number, number], [14, 12, 80] as [number, number, number]]) {
            data[y * width + x]! = value;
        }
        expect(Array.from(engine.candidates(session, 0, 1), c => c.peak), 'nearby suppressed basins stay with the brighter seed; surviving peaks keep their seed heights').toEqual([100, 80] as [number, number]);
        for (let i = 0; i < data.length; i++) {
            data[i]! = i % 3 - 1;
        }
        for (let y = 10; y <= 20; y++) {
            data[y * width + 10]! = data[y * width + 20]! = 30;
        }
        for (let x = 10; x <= 20; x++) {
            data[20 * width + x]! = 30;
        }
        const plateau = engine.candidates(session, 0, 1);
        expect(plateau.length, 'a connected flat plateau is one maximum').toBe(1);
        expect(plateau[0]!.pixels).toBe(31);
    });

    it('prominent peaks keep their own basins, seed heights and edge flags', function ()
    {
        const width = 32;
        const shoulder = [[10, 10, 40] as [number, number, number], [11, 10, 38] as [number, number, number], [12, 11, 36] as [number, number, number], [13, 12, 34] as [number, number, number], [14, 12, 32] as [number, number, number], [15, 11, 10] as [number, number, number]];
        for (const sign of [1, -1] as [number, number]) {
            const data = Float32Array.from({length: width * width}, (_, i) => i % 3 - 1);
            for (const [x, y, value] of [...shoulder, [16, 10, 20] as [number, number, number]]) {
                data[y * width + x]! = sign * value;
            }
            data[13 * width + 14]! = NaN;
            const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
            const found = engine.candidates(session, 0, 1);
            expect(found.length).toBe(2);
            const faint = found.find(c => c.peak === sign * 20)!;
            expect(faint, 'the second peak reports its seed value, never the brighter shoulder').toBeTruthy();
            expect(faint.x).toBe(16);
            expect(faint.y).toBe(10);
            expect(faint.pixels).toBe(1);
            expect(faint.edge, 'a blank touching the primary shoulder belongs only to that basin').toBe(false);
            const primary = found.find(c => c.peak === sign * 40)!;
            const flux = shoulder.reduce((sum, [, , value]) => sum + value, 0);
            close(primary.x, shoulder.reduce((sum, [x, , value]) => sum + x * value, 0) / flux);
            close(primary.y, shoulder.reduce((sum, [, y, value]) => sum + y * value, 0) / flux);
            expect(primary.pixels).toBe(shoulder.length);
            expect(primary.edge).toBe(true);
        }
    });

    it('noise on the flat top of a saturated star does not split it into many candidates', function ()
    {
        const width = 96;
        let seed = 7;
        const random = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };
        const noise = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
        let worst = 0;
        for (let trial = 0; trial < 10; trial++) {
            const data = new Float32Array(width * width);
            for (let y = 0; y < width; y++) {
                for (let x = 0; x < width; x++) {
                    const star = 200 * Math.exp(-((x - 48) ** 2 + (y - 48) ** 2) / 50);
                    data[y * width + x]! = Math.min(star, 30) + noise();
                }
            }
            const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
            const near = engine.candidates(session, 0, 1).filter(c => (c.x - 48) ** 2 + (c.y - 48) ** 2 < 100);
            worst = Math.max(worst, near.length);
        }
        expect(worst, 'one saturated star is one candidate').toBe(1);
    });

    it('border and masked neighbours flag candidates and rank below interior changes of similar strength', async function ()
    {
        const width = 32;
        const data = Float32Array.from({length: width * width}, (_, i) => i % 2 ? 1 : -1);
        data[0]! = 60;
        data[10 * width + 10]! = 25;
        data[20 * width + 20]! = 50;
        data[20 * width + 21]! = NaN;
        // A shifted-in margin has no finite samples and must not produce candidates of its own.
        for (let y = 0; y < width; y++) {
            data[y * width + width - 1]! = NaN;
        }
        const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
        const found = engine.candidates(session, 0, 1);
        expect(found.length).toBe(3);
        expect(Array.from(found, c => c.edge)).toEqual([false, true, true]);
        expect(found[0]!.x).toBe(10);
        expect(found[1]!.x).toBe(0);
        expect(found[2]!.x).toBe(20);
        const bright = stars.map(([x, y, amplitude]): [number, number, number] => [x, y, amplitude * 10]);
        const reference = field({sources: bright});
        reference[17 * 128 + 15]! = NaN;
        const masked = await engine.process([fitsField(reference, 'masked.fits'),
            fitsField(field({sources: bright, dx: 0.5, dy: 0.5, seed: 19}), 'moved.fits')]);
        expect(masked.frames[0]!.edgeMask![17 * 128 + 15], 'smoothing must flag reconstructed gaps').toBe(1);
        const affected = engine.candidates(masked, 0, 1).filter(c => Math.hypot(c.x - 15, c.y - 17) < 5);
        expect(affected.length > 0, 'keep incomplete-support detections for inspection').toBeTruthy();
        expect(affected.every(c => c.edge), 'smoothing must retain missing-support provenance').toBeTruthy();
    });

    it('candidate connectivity, limit and NaN-edge flags', async function ()
    {
        const width = 96;
        const height = 96;
        const a = field({width, height, sources: [], seed: 41, sky: 0});
        const b = field({width, height, sources: [], seed: 42, sky: 0});
        for (let y = 10; y <= 70; y += 10) {
            for (let x = 10; x <= 70; x += 10) {
                b[y * width + x]! += 30;
            }
        }
        const session = {width, height, frames: [{data: a}, {data: b}]};
        expect(engine.candidates(session, 0, 1).length).toBe(20);
        b.fill(0);
        a.fill(0);
        // Alternating +/-1 noise has a nonzero MAD.
        for (let i = 0; i < b.length; i++) {
            b[i]! = i % 2 ? 1 : -1;
        }
        b[20 * width + 20]! = 30;
        b[21 * width + 21]! = 25;
        b[40 * width + 40]! = 40;
        b[40 * width + 41]! = NaN;
        b[0]! = 50;
        const blobs = engine.candidates(session, 0, 1);
        expect(blobs.length).toBe(3);
        expect(blobs[0]!.pixels).toBe(2);
        expect(blobs[0]!.edge).toBe(false);
        expect(blobs.slice(1).every(blob => blob.edge)).toBeTruthy();
        // The difference is measured from its own median (+1 here: the outliers tip the alternating noise), so 30 - 1.
        expect(blobs[0]!.peak).toBe(29);
    });

    it('real SPHEREx cutouts: exact shapes, header dates, units and honest alignment', async function ()
    {
        const names = (await readdir(new URL('./fixtures/upload/', import.meta.url))).filter(name => /\.fits$/i.test(name)).sort();
        expect(names.length, 'all three real cutouts must be present').toBe(3);
        const expectedDates = ['2025-05-18T09:31:00.088Z', '2025-11-29T19:05:52.495Z', '2026-05-23T23:30:27.510Z'];
        const files = await Promise.all(names.map(async name => file(await readFile(new URL('./fixtures/upload/' + name, import.meta.url)), name)));
        for (let i = 0; i < files.length; i++) {
            const frame = await engine.readFile(files[i]!);
            expect(frame.width).toBe(58);
            expect(frame.height).toBe(59);
            expect(frame.date!.toISOString()).toBe(expectedDates[i]!);
            expect(frame.dateSource).toBe('DATE-OBS');
            expect(frame.unit).toBe('MJy / sr');
            expect(frame.meta.bunit).toBe('MJy / sr');
            expect(frame.meta.hdu).toBe(1);
            expect(frame.meta.hasWcs).toBe(true);
            expect(frame.warnings.includes("Zodiacal light model removed (from the file's ZODI plane)")).toBeTruthy();
        }
        const session = await engine.process([...files].reverse());
        expect(Array.from(session.frames, frame => frame.date!.toISOString())).toEqual(expectedDates);
        for (let i = 0; i < session.frames.length; i++) {
            const frame = session.frames[i]!;
            const shift = session.shifts[i]!;
            if (shift.ok) {
                expect(Math.hypot(shift.dx, shift.dy) < 8, 'accepted real cutout shift must be small').toBeTruthy();
            } else {
                expect(shift.dx).toBe(0);
                expect(shift.dy).toBe(0);
                expect(session.notes.includes(`Couldn't line up ${frame.name}; shown as is`)).toBeTruthy();
            }
            console.log(`REAL ${frame.width}x${frame.height} ${frame.date!.toISOString()} ${frame.unit} shift=(${shift.dx.toFixed(3)},${shift.dy.toFixed(3)}) ${shift.ok ? 'ok' : 'failed'} ${shift.method}`);
        }
        const top = engine.candidates(session, 0, 2).slice(0, 3);
        expect(top[0]!.pixels > 100 && Math.abs(top[0]!.peak / top[0]!.sigma) > 1000, 'the moving star, whose saturated centre is blank, still ranks first').toBeTruthy();
        console.log('REAL top 3 (first to last): ' + JSON.stringify(top.map(c => ({x: +c.x.toFixed(2), y: +c.y.toFixed(2),
            peak: +c.peak.toFixed(3), sigma: +c.sigma.toFixed(3), sign: c.sign, pixels: c.pixels}))));
    });

    it('2040x2040 float32 frame processing performance', async function ()
    {
        const width = 2040;
        const values = field({width, height: width, sources: stars, seed: 123});
        const input = fitsField(values, 'large.fits', width, width);
        const start = performance.now();
        const session = await engine.process([input]);
        const elapsed = performance.now() - start;
        expect(session.frames[0]!.data.length).toBe(width * width);
        expect(elapsed < 2000, `processing took ${elapsed.toFixed(0)} ms (budget 2000 ms)`).toBeTruthy();
        const renderStart = performance.now();
        const pixels = engine.render(session, 0, {mode: 'blink'});
        expect(pixels.data.length).toBe(width * width * 4);
        console.log(`PERF 2040x2040: process=${elapsed.toFixed(0)} ms, render=${(performance.now() - renderStart).toFixed(0)} ms (Node ${process.version})`);
    });


});
