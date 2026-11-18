import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {gzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';

// No packages, generated fixtures or files written by these tests.
const source = await readFile(new URL('./engine.js', import.meta.url), 'utf8').catch(() => '');
assert.ok(source, 'engine.js must define the browser engine');
class TestImageData {
    constructor(data, width, height)
    {
        this.data = data;
        this.width = width;
        this.height = height;
    }
}
const context = {Blob, Response, DecompressionStream, ImageData: TestImageData,
    Float32Array, Uint8Array, Uint8ClampedArray, Int32Array, DataView, Date, DOMException, setTimeout};
vm.runInNewContext(source, context, {filename: 'engine.js'});
const engine = context.SlowskyEngine;
assert.ok(engine, 'plain script exports on globalThis');

function card(key, value)
{
    let text = key.padEnd(8);
    if (value !== undefined) {
        const formatted = typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` :
            typeof value === 'boolean' ? (value ? 'T' : 'F') : String(value);
        text += '= ' + formatted;
    }
    return text.padEnd(80).slice(0, 80);
}

function imageHdu({width = 3, height = 2, bitpix = -32, values = [1, 2, 3, 4, 5, 6],
    primary = true, header = {}} = {})
{
    const entries = [[primary ? 'SIMPLE' : 'XTENSION', primary ? true : 'IMAGE'],
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
        const v = values[(height - 1 - Math.floor(i / width)) * width + (i % width)];
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

function file(bytes, name = 'frame.fits', lastModified)
{
    const blob = new Blob([bytes]);
    Object.defineProperty(blob, 'name', {value: name});
    if (lastModified !== undefined) {
        Object.defineProperty(blob, 'lastModified', {value: lastModified});
    }
    return blob;
}

function random(seed)
{
    return function ()
    {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed + 0.5) / 4294967296;
    };
}

const stars = [[15.3, 16.7, 90], [39.7, 19.2, 75], [68.2, 14.6, 65],
    [99.1, 21.3, 85], [22.4, 45.6, 100], [48.2, 38.8, 70], [78.7, 44.1, 95],
    [109.2, 54.5, 80], [13.6, 79.2, 60], [42.3, 87.4, 110], [75.8, 82.6, 90],
    [103.1, 92.7, 75]];

function field({width = 128, height = 112, dx = 0, dy = 0, sky = 100, seed = 7,
    sources = stars, noise = 1} = {})
{
    const rand = random(seed);
    const data = new Float32Array(width * height);
    for (let i = 0; i < data.length; i++) {
        data[i] = sky + noise * Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
    }
    for (const [sx, sy, amplitude] of sources) {
        const cx = sx + dx;
        const cy = sy + dy;
        for (let y = Math.max(0, Math.floor(cy - 7)); y <= Math.min(height - 1, Math.ceil(cy + 7)); y++) {
            for (let x = Math.max(0, Math.floor(cx - 7)); x <= Math.min(width - 1, Math.ceil(cx + 7)); x++) {
                data[y * width + x] += amplitude * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 1.4 ** 2));
            }
        }
    }
    return data;
}

function fitsField(data, name = 'field.fits', width = 128, height = 112, header = {})
{
    return file(imageHdu({width, height, values: data, header}), name);
}

function pictureImage(values)
{
    const data = new Uint8ClampedArray(values.length * 4);
    for (let i = 0; i < values.length; i++) {
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = values[i];
        data[i * 4 + 3] = 255;
    }
    return {width: 128, height: 112, data};
}

function close(actual, expected, tolerance = 1e-5)
{
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

const tests = [];
function test(name, run)
{
    tests.push({name, run});
}

test('FITS big-endian types, scaling, blanks and dates', async function ()
{
    for (const bitpix of [-32, 16, 8, 32, -64]) {
        const values = bitpix === 16 ? [-32768, -32767, -1, 0, 1, 32767] : [1, 2, 3, 4, 5, 6];
        const header = {BSCALE: 2, BZERO: bitpix === 16 ? 32768 : 3,
            'DATE-OBS': '2025-01-02T03:04:05.123', BUNIT: 'MJy/sr', INSTRUME: 'SPHEREx', DETECTOR: 1};
        const frame = await engine.readFile(file(imageHdu({bitpix, values, header})));
        assert.equal(frame.width, 3);
        assert.equal(frame.height, 2);
        assert.equal(frame.kind, 'fits');
        assert.ok(frame.data instanceof Float32Array);
        assert.deepEqual(Array.from(frame.data), values.map(v => v * 2 + header.BZERO));
        assert.equal(frame.date.toISOString(), '2025-01-02T03:04:05.123Z');
        assert.equal(frame.dateSource, 'DATE-OBS');
        assert.equal(frame.unit, 'MJy/sr');
        assert.equal(frame.meta.instrument, 'SPHEREx');
        assert.equal(frame.meta.detector, 1);
    }
    const blank = await engine.readFile(file(imageHdu({bitpix: 16, values: [1, -99, 3, 4, 5, 6], header: {BLANK: -99}})));
    assert.ok(Number.isNaN(blank.data[1]));
    for (const key of ['MJD-OBS', 'MJD-AVG']) {
        const frame = await engine.readFile(file(imageHdu({header: {[key]: 51544.5}})));
        assert.equal(frame.date.toISOString(), '2000-01-01T12:00:00.000Z');
        assert.equal(frame.dateSource, 'MJD-OBS');
    }
    const fallback = await engine.readFile(file(imageHdu({header: {'DATE-OBS': 'invalid'}}), 'fallback.fits', 0));
    assert.equal(fallback.dateSource, 'file');
    assert.equal(fallback.date.getTime(), 0);
    const undated = await engine.readFile(file(imageHdu()));
    assert.equal(undated.date, null);
    assert.equal(undated.dateSource, 'none');
});

test('IMAGE preference, primary metadata, ZIMAGE skip, ZODI and gzip', async function ()
{
    const bytes = Buffer.concat([
        imageHdu({values: [99, 99, 99, 99, 99, 99], header: {'DATE-OBS': '2025-02-03', INSTRUME: 'SPHEREx'}}),
        compressedHdu(),
        imageHdu({primary: false, header: {EXTNAME: 'IMAGE', BUNIT: 'MJy/sr'}, values: [10, 20, 30, 40, 50, 60]}),
        imageHdu({primary: false, header: {EXTNAME: 'ZODI'}, values: [1, 2, 3, 4, 5, 6]})
    ]);
    const plain = await engine.readFile(file(bytes));
    assert.deepEqual(Array.from(plain.data), [9, 18, 27, 36, 45, 54]);
    assert.equal(plain.meta.hdu, 2);
    assert.equal(plain.date.toISOString(), '2025-02-03T00:00:00.000Z');
    assert.equal(plain.meta.instrument, 'SPHEREx');
    assert.ok(plain.warnings.some(w => /ZIMAGE.*not supported/i.test(w)));
    assert.ok(plain.warnings.includes("Zodiacal light model removed (from the file's ZODI plane)"));
    for (const name of ['frame.fits.gz', 'magic.fits']) {
        const zipped = await engine.readFile(file(gzipSync(bytes), name));
        assert.deepEqual(Array.from(zipped.data), Array.from(plain.data));
        assert.equal(zipped.date.getTime(), plain.date.getTime());
    }
    await assert.rejects(engine.readFile(file(Buffer.concat([imageHdu({width: 0}), compressedHdu()]))), /ZIMAGE|tile.compressed/i);
    await assert.rejects(engine.readFile(file(bytes.subarray(0, 100))), /truncated|header/i);
});

test('PNG/JPG replaceable decoder, luminance, alpha mask and warning', async function ()
{
    const original = engine.decodeImage;
    engine.decodeImage = async function ()
    {
        return {width: 2, height: 1, data: new Uint8ClampedArray([100, 50, 20, 255, 9, 8, 7, 0])};
    };
    try {
        for (const name of ['display.png', 'display.JPG']) {
            const frame = await engine.readFile(file(new Uint8Array([1, 2, 3]), name, 1234));
            close(frame.data[0], 0.2126 * 100 + 0.7152 * 50 + 0.0722 * 20);
            assert.ok(Number.isNaN(frame.data[1]));
            assert.equal(frame.kind, name.endsWith('png') ? 'png' : 'jpg');
            assert.equal(frame.dateSource, 'file');
            assert.equal(frame.unit, null);
            assert.ok(frame.warnings.includes('Display image: brightness is already stretched, so changes are rough'));
        }
    } finally {
        engine.decodeImage = original;
    }
});

test('translation voting and centroid refinement recover known subpixel shifts', async function ()
{
    for (const [dx, dy] of [[3.4, -2.2], [-5.7, 4.3], [0.35, 0.4]]) {
        const session = await engine.process([fitsField(field(), 'ref.fits'),
            fitsField(field({dx, dy, seed: 19}), 'moved.fits')]);
        assert.equal(session.shifts[1].ok, true);
        assert.equal(session.shifts[1].method, 'stars');
        close(session.shifts[1].dx, -dx, 0.3);
        close(session.shifts[1].dy, -dy, 0.3);
        const s = session.shifts[1];
        const edgeX = s.dx < 0 ? session.width - 1 : 0;
        assert.ok(Number.isNaN(session.frames[1].data[50 * session.width + edgeX]));
        const index = 46 * 128 + 22;
        close(session.frames[1].data[index], session.frames[0].data[index], 12);
    }
});

test('hot pixels and one NaN do not prevent alignment; missing kernel support stays blank', async function ()
{
    const hot = [[20, 20], [90, 30], [60, 80], [100, 95], [30, 70], [75, 15]];
    const withHot = data => {
        for (const [x, y] of hot) {
            data[y * 128 + x] += 5000;
        }
        return data;
    };
    const few = [[40, 40, 300], [85, 60, 250], [55, 85, 280], [25, 95, 260]];
    const session = await engine.process([fitsField(withHot(field({sources: few})), 'ref.fits'),
        fitsField(withHot(field({sources: few, dx: 6.3, dy: -4.6, seed: 19})), 'moved.fits')]);
    assert.equal(session.shifts[1].ok, true);
    close(session.shifts[1].dx, -6.3, 0.5);
    close(session.shifts[1].dy, 4.6, 0.5);

    const data = field({dx: 0.25, dy: 0, seed: 19});
    const ref = field();
    const peak = ref.indexOf(Math.max(...ref));
    data[peak + 1] = NaN;
    const one = await engine.process([fitsField(ref, 'ref.fits'), fitsField(data, 'blank.fits')]);
    assert.equal(one.shifts[1].ok, true);
    assert.ok(Number.isNaN(one.frames[1].data[peak]), 'a missing neighbour exceeding 2% of the kernel must stay blank');
});

test('starless frames fail honestly, including WCS-bearing frames', async function ()
{
    const flat = new Float32Array(128 * 112).fill(50);
    const wcs = {CRVAL1: 10, CRVAL2: 20, CRPIX1: 64, CRPIX2: 56, CDELT1: 0.01, CDELT2: 0.01};
    const session = await engine.process([fitsField(field()), fitsField(flat, 'starless.fits', 128, 112, wcs)]);
    assert.equal(session.frames[1].meta.hasWcs, true);
    assert.equal(session.shifts[1].ok, false);
    assert.equal(session.shifts[1].method, 'stars');
    assert.equal(session.shifts[1].dx, 0);
    assert.equal(session.shifts[1].dy, 0);
    assert.ok(session.frames[1].data.every(v => v === 0));
    assert.ok(session.notes.includes("Couldn't line up starless.fits; shown as is"));
});

test('quantized PNG stars with equal-height peaks still align', async function ()
{
    const width = 80;
    function quantized(dx)
    {
        const data = new Uint8ClampedArray(width * width * 4);
        for (let y = 0; y < width; y++) {
            for (let x = 0; x < width; x++) {
                let value = 0;
                for (const [sx, sy] of [[15.5, 15.5], [48.5, 20.5], [27.5, 53.5]]) {
                    value += 240 * Math.exp(-((x - sx - dx) ** 2 + (y - sy) ** 2) / 4);
                }
                const offset = (y * width + x) * 4;
                data[offset] = data[offset + 1] = data[offset + 2] = Math.round(value);
                data[offset + 3] = 255;
            }
        }
        return {width, height: width, data};
    }
    const session = await engine.process([file([], 'ref.png'), file([], 'shifted.png')], {
        decodeImage: async input => quantized(input.name === 'ref.png' ? 0 : 3)
    });
    assert.equal(session.shifts[1].ok, true);
    close(session.shifts[1].dx, -3, 0.3);
    close(session.shifts[1].dy, 0, 0.3);
});

test('browser-style asynchronous cancellation runs between processing stages', async function ()
{
    const controller = new AbortController();
    const seen = [];
    await assert.rejects(engine.process([fitsField(field()), fitsField(field(), 'second.fits')], {
        signal: controller.signal,
        onJob: function (i, name)
        {
            seen.push(name);
            if (name === 'size') {
                setTimeout(() => controller.abort(), 0);
            }
        }
    }), {name: 'AbortError'});
    assert.equal(seen.includes('ready'), false);
});

test('date ordering, centre cropping, stage reporting and aborts', async function ()
{
    const events = [];
    const session = await engine.process([
        fitsField(new Float32Array(48).fill(5), 'undated.fits', 8, 6),
        fitsField(new Float32Array(16).fill(9), 'late.fits', 4, 4, {'DATE-OBS': '2026-02-01'}),
        fitsField(Float32Array.from({length: 36}, (_, i) => i), 'early.fits', 6, 6, {'DATE-OBS': '2025-02-01'})
    ], {onJob: (i, stage, info) => events.push({i, stage, info})});
    assert.deepEqual(Array.from(session.frames, f => f.name), ['early.fits', 'late.fits', 'undated.fits']);
    assert.equal(session.ref, 0);
    assert.equal(session.width, 4);
    assert.equal(session.height, 4);
    // Centre crop of the 6x6 ramp starts at (1,1); its median is 17.5.
    close(session.frames[0].data[0], 7 - 17.5);
    assert.ok(session.notes.some(note => /crop/i.test(note)));
    assert.deepEqual(Array.from(engine.STAGES), ['read', 'header', 'decode', 'size', 'align', 'stretch', 'ready']);
    for (let i = 0; i < 3; i++) {
        assert.deepEqual(events.filter(event => event.i === i).map(event => event.stage), Array.from(engine.STAGES));
        assert.ok(events.filter(event => event.i === i).every(event => event.info.name));
    }
    for (const stopStage of engine.STAGES) {
        const controller = new AbortController();
        const seen = [];
        await assert.rejects(engine.process([fitsField(field())], {signal: controller.signal,
            onJob: function (i, stage)
            {
                seen.push(stage);
                if (stage === stopStage) {
                    controller.abort();
                }
            }}), {name: 'AbortError'});
        assert.equal(seen.at(-1), stopStage);
    }
    const already = new AbortController();
    already.abort();
    await assert.rejects(engine.process([fitsField(field())], {signal: already.signal}), {name: 'AbortError'});
    await assert.rejects(engine.process([]), /file|frame/i);
});

test('median background removal and one reference asinh stretch prevent fake brightening', async function ()
{
    // Exactly representable values keep the +50 experiment free of float rounding differences.
    const data = Float32Array.from(field(), v => Math.round(v * 16) / 16);
    data[0] = NaN;
    const offset = Float32Array.from(data, v => v + 50);
    const session = await engine.process([fitsField(data), fitsField(offset, 'offset.fits')]);
    const original = engine.render(session, 0, {mode: 'blink'});
    const shiftedSky = engine.render(session, 1, {mode: 'blink'});
    assert.ok(original instanceof TestImageData);
    assert.deepEqual(original.data, shiftedSky.data);
    const sorted = Array.from(session.frames[0].data).filter(Number.isFinite).sort((a, b) => a - b);
    function percentile(p)
    {
        const index = (sorted.length - 1) * p;
        const low = Math.floor(index);
        return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
    }
    close(session.stretch.lo, percentile(0.01));
    close(session.stretch.hi, percentile(0.997));
    const position = 10;
    const t = Math.max(0, Math.min(1, (session.frames[0].data[position] - session.stretch.lo) /
        (session.stretch.hi - session.stretch.lo)));
    const expected = Math.round(255 * Math.asinh(10 * t) / Math.asinh(10));
    assert.equal(original.data[position * 4], expected);
    assert.equal(original.data[3], 0);
    assert.equal(engine.candidates(session, 0, 1).length, 0);
});

test('frames in different units are not combined', async function ()
{
    const values = [1, 2, 3, 4, 5, 6];
    const jy = file(imageHdu({values, header: {BUNIT: 'Jy', 'DATE-OBS': '2025-01-01'}}), 'a.fits');
    const mjy = file(imageHdu({values: values.map(v => v * 1000), header: {BUNIT: 'mJy', 'DATE-OBS': '2025-06-01'}}), 'b.fits');
    const same = file(imageHdu({values, header: {BUNIT: 'J y', 'DATE-OBS': '2025-03-01'}}), 'c.fits');
    const errors = [];
    const session = await engine.process([jy, mjy, same], {align: false,
        onJob: (i, stage, info) => { if (stage === 'error') { errors.push(info.name); } }});
    assert.deepEqual([...session.frames].map(f => f.name), ['a.fits', 'c.fits']);
    assert.equal(session.failed.length, 1);
    assert.match(session.failed[0].error, /mJy/);
    assert.deepEqual(errors, ['b.fits']);
});

test('stack is a NaN-aware mean; subtraction uses signed orange and blue', async function ()
{
    const makeFrame = data => ({data: new Float32Array(data), width: 3, height: 2});
    // b - a = [NaN, NaN, 5, -2, 0, 0]: median 0, so the zero pixels stay near-black after median centring.
    const session = {frames: [makeFrame([NaN, 2, 3, 4, 4, 6]), makeFrame([5, NaN, 8, 2, 4, 6])],
        width: 3, height: 2, ref: 0, stretch: {lo: 0, hi: 10}};
    const stack = engine.render(session, 0, {mode: 'stack'});
    const mean = {...session, frames: [makeFrame([5, 2, 5.5, 3, 4, 6])]};
    assert.deepEqual(stack.data, engine.render(mean, 0, {mode: 'blink'}).data);
    const diff = engine.render(session, 0, {mode: 'subtract', a: 0, b: 1});
    assert.equal(diff.data[3], 0);
    assert.ok(diff.data[8] > diff.data[10], 'positive difference is orange');
    assert.ok(diff.data[14] > diff.data[12], 'negative difference is blue');
    assert.ok(diff.data[20] < 20 && diff.data[21] < 20 && diff.data[22] < 20);
    assert.throws(() => engine.render(session, 8), /index|frame/i);
    // A + B: the mean of the two visits on the same stretch; a blank pixel in either stays blank.
    const sum = engine.render(session, 0, {mode: 'sum', a: 0, b: 1});
    const sumMean = {...session, frames: [makeFrame([NaN, NaN, 5.5, 3, 4, 6])]};
    assert.deepEqual(sum.data, engine.render(sumMean, 0, {mode: 'blink'}).data);
    assert.equal(sum.data[3], 0, 'blank in A stays blank');
});

test('20 sigma brightening ranks first, faintening has its sign, noise gives no candidates', async function ()
{
    const changed = [...stars, [62.2, 62.4, 20 * Math.sqrt(2)]];
    const session = await engine.process([fitsField(field()), fitsField(field({sources: changed, seed: 987}), 'bright.fits')]);
    const candidates = engine.candidates(session, 0, 1, {k: 5});
    assert.ok(candidates.length > 0);
    const top = candidates[0];
    assert.equal(top.sign, 'brighter');
    close(top.x, 62.2, 1);
    close(top.y, 62.4, 1);
    assert.ok(top.peak / top.sigma > 10);
    assert.ok(top.pixels >= 2);
    assert.equal(engine.candidates(session, 1, 0)[0].sign, 'fainter');
    for (let i = 1; i < candidates.length; i++) {
        const score = c => Math.abs(c.peak / c.sigma) * Math.sqrt(Math.min(c.pixels, 9));
        assert.ok((candidates[i].edge && !candidates[i - 1].edge) ||
            (candidates[i].edge === candidates[i - 1].edge && score(candidates[i - 1]) >= score(candidates[i])));
    }
    const noise = await engine.process([fitsField(field({sources: [], seed: 1})),
        fitsField(field({sources: [], seed: 2}), 'noise.fits')]);
    assert.equal(engine.candidates(noise, 0, 1, {k: 5}).length, 0);
});

test('fractional alignment shares the blur without hiding a 20 sigma brightening', async function ()
{
    const bright = stars.map(([x, y, amplitude]) => [x, y, amplitude * 10]);
    const reference = fitsField(field({sources: bright}), 'ref.fits');
    const moved = fitsField(field({sources: bright, dx: 0.5, dy: 0.5, seed: 19}), 'moved.fits');
    const unchanged = await engine.process([reference, moved]);
    close(unchanged.shifts[1].dx, -0.5, 0.1);
    close(unchanged.shifts[1].dy, -0.5, 0.1);
    assert.equal(engine.candidates(unchanged, 0, 1, {k: 5}).length, 0,
        'interpolation must not turn unchanged bright stars into candidates');
    const changed = await engine.process([reference, fitsField(field({dx: 0.5, dy: 0.5, seed: 19,
        sources: [...bright, [62.2, 62.4, 20 * Math.sqrt(2)]]}), 'bright.fits')]);
    const top = engine.candidates(changed, 0, 1, {k: 5})[0];
    assert.ok(top, 'a real change must survive the shared smoothing');
    close(top.x, 62.2, 1);
    close(top.y, 62.4, 1);
    assert.equal(top.sign, 'brighter');
    assert.ok(top.peak / top.sigma > 5);
});

test('smoothing preserves blanks and never renormalizes missing light', async function ()
{
    const bright = stars.map(([x, y, amplitude]) => [x, y, amplitude * 10]);
    const reference = field({sources: bright, noise: 0});
    const moved = field({sources: bright, noise: 0, dx: 0.5, dy: 0.5});
    for (const data of [reference, moved]) {
        for (let y = 50; y <= 70; y++) {
            for (let x = 50; x <= 70; x++) {
                data[y * 128 + x] = 120;
            }
        }
        data[60 * 128 + 61] = NaN;
    }
    const session = await engine.process([fitsField(reference, 'ref.fits'), fitsField(moved, 'moved.fits')]);
    close(session.shifts[1].dx, -0.5, 0.05);
    close(session.shifts[1].dy, -0.5, 0.05);
    for (const frame of session.frames) {
        assert.ok(Number.isNaN(frame.data[60 * 128 + 61]), 'a blank source sample stays blank even at a fractional shift');
        assert.ok(Number.isNaN(frame.data[60 * 128 + 60]), 'over 2% missing weight must stay blank');
    }
    const total = Array.from({length: 9}, (_, i) => Math.exp(-0.5 * (i - 4) ** 2)).reduce((a, b) => a + b);
    const expected = 20 * (1 - Math.exp(-4.5) / (total * total));
    close(session.frames[0].data[60 * 128 + 58], expected, 2e-5);
    assert.ok(session.frames[0].data[60 * 128 + 58] < 20, 'missing far taps contribute no light');
    for (const frame of session.frames) {
        for (let y = 57; y <= 63; y++) {
            for (let x = 57; x <= 65; x++) {
                assert.ok(!Number.isFinite(frame.data[y * 128 + x]) || frame.data[y * 128 + x] <= 20.00001,
                    'no missing tap may brighten the constant patch around a blank');
            }
        }
    }
});

test('failed alignment leaves its frame unsmoothed beside a fractional match', async function ()
{
    const failed = fitsField(field({sources: [], seed: 123}), 'unaligned.fits');
    const alone = await engine.process([failed]);
    const session = await engine.process([fitsField(field(), 'ref.fits'),
        fitsField(field({dx: 0.5, dy: 0.5, seed: 19}), 'moved.fits'), failed]);
    assert.ok(session.shifts[1].ok && session.shifts[1].dx !== Math.round(session.shifts[1].dx));
    assert.equal(session.shifts[2].ok, false);
    assert.ok(session.notes.includes("Couldn't line up unaligned.fits; shown as is"));
    assert.ok(session.frames[2].data.every((value, i) => Object.is(value, alone.frames[0].data[i])),
        'failed frames retain their original sky-subtracted samples');
});

test('matched-star flux scales pictures, preserves FITS units and needs five matches', async function ()
{
    const reference = field({sky: 10, sources: stars.map(([x, y, a]) => [x, y, a * 0.7])});
    const changed = reference.slice();
    const extra = field({sky: 0, noise: 0, sources: [[62.2, 62.4, 30]]});
    for (let i = 0; i < changed.length; i++) {
        changed[i] = 2 * (changed[i] + extra[i]);
    }
    const session = await engine.process([file([], 'ref.png'), file([], 'gain.jpg')], {
        decodeImage: async input => {
            const values = input.name === 'ref.png' ? reference : changed;
            const data = new Uint8ClampedArray(values.length * 4);
            for (let i = 0; i < values.length; i++) {
                data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = values[i];
                data[i * 4 + 3] = 255;
            }
            return {width: 128, height: 112, data};
        }
    });
    assert.equal(session.frames[0].scale, 1);
    close(session.frames[1].scale, 2, 0.02);
    assert.ok(session.notes.includes('gain.jpg was made 50% dimmer so its stars match ref.png'), session.notes.join(' | '));
    const top = engine.candidates(session, 0, 1)[0];
    close(top.x, 62.2, 1);
    close(top.y, 62.4, 1);
    const physical = await engine.process([fitsField(reference, 'ref.fits'),
        fitsField(Float32Array.from(reference, v => 2 * v), 'gain.fits')], {align: false});
    assert.equal(physical.frames[1].scale, 1, 'physical values must never be divided by the measured ratio');
    close(physical.frames[1].data[20 * 128 + 40], 2 * physical.frames[0].data[20 * 128 + 40]);
    assert.ok(physical.notes.includes('gain.fits is 100% brighter overall than ref.fits; Subtract may mark every star'));
    const dimmer = await engine.process([fitsField(reference, 'ref.fits'),
        fitsField(Float32Array.from(reference, v => 0.8 * v), 'dim.fits')], {align: false});
    assert.ok(dimmer.notes.includes('dim.fits is 20% fainter overall than ref.fits; Subtract may mark every star'));
    const similar = await engine.process([fitsField(reference, 'ref.fits'),
        fitsField(Float32Array.from(reference, v => 1.05 * v), 'similar.fits')], {align: false});
    assert.equal(similar.notes.some(note => /overall/.test(note)), false);
    const few = field({sources: stars.slice(0, 4)});
    const insufficient = await engine.process([fitsField(few, 'few.fits'),
        fitsField(Float32Array.from(few, v => 2 * v), 'few-gain.fits')]);
    assert.equal(insufficient.frames[1].scale, 1);
    assert.equal(insufficient.notes.some(note => /overall/.test(note)), false);
});

test('too few brightness stars warn for PNG, JPG and FITS without scaling', async function ()
{
    const note = 'Too few stars to match brightness between dates, so Subtract may mark every star.';
    for (const count of [4, 0]) {
        const reference = field({sky: 10, sources: stars.slice(0, count).map(([x, y]) => [x, y, 45])});
        const changed = Float32Array.from(reference, value => 2 * value);
        for (const kind of ['png', 'jpg', 'fits']) {
            const inputs = kind === 'fits' ? [fitsField(reference, 'ref.fits'), fitsField(changed, 'gain.fits')]
                : [file([], 'ref.' + kind), file([], 'gain.' + kind)];
            const session = await engine.process(inputs, {align: count === 0, decodeImage: async input =>
                pictureImage(input.name.startsWith('ref') ? reference : changed)});
            assert.equal(session.frames[1].scale, 1);
            if (count > 0) {
                close(session.frames[1].data[17 * 128 + 15] / session.frames[0].data[17 * 128 + 15], 2, 0.05);
            } else {
                assert.equal(session.shifts[1].ok, false, 'a failed alignment also leaves brightness unmeasured');
            }
            assert.ok(session.notes.includes(note), kind + ' must report an unmeasured brightness match');
            assert.equal(session.notes.some(value => /so its stars match/.test(value)), false);
        }
    }
});

test('picture brightness match skips clipped stars, not merely the brightest ones', async function ()
{
    const picture = (values, name) => [file([], name), values];
    const decodeFrom = map => async input => {
        const values = map.get(input.name);
        const data = new Uint8ClampedArray(values.length * 4);
        for (let i = 0; i < values.length; i++) {
            data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = values[i];
            data[i * 4 + 3] = 255;
        }
        return {width: 128, height: 112, data};
    };
    const run = async pairs => engine.process(pairs.map(([f]) => f), {decodeImage: decodeFrom(new Map(pairs.map(([f, v]) => [f.name, v])))});
    // Unclipped: five stars of 45 to 65, and a twice-as-bright copy whose brightest pixel is about 150.
    const faint = field({sky: 10, sources: stars.slice(0, 5).map(([x, y], n) => [x, y, 45 + 5 * n])});
    const unclipped = await run([picture(faint, 'ref.png'), picture(Float32Array.from(faint, v => 2 * v), 'twice.png')]);
    close(unclipped.frames[1].scale, 2, 0.05);
    // Clipped: in the brighter copy seven of twelve stars hit 255 and must not vote, or the ratio is pulled toward 1.
    const mixed = field({sky: 10, sources: stars.slice(0, 12).map(([x, y], n) => [x, y, n < 7 ? 200 : 50])});
    const clipped = await run([picture(mixed, 'ref.png'), picture(Float32Array.from(mixed, v => Math.min(255, 2 * v)), 'clip.png')]);
    close(clipped.frames[1].scale, 2, 0.05);
    // Colour: a clipped red channel (255, 0, 0) has a grey value of only 54, but is still clipped.
    const red = async (values, name) => [file([], name), values];
    const redRun = async pairs => engine.process(pairs.map(([f]) => f), {decodeImage: async input => {
        const values = new Map(pairs.map(([f, v]) => [f.name, v])).get(input.name);
        const data = new Uint8ClampedArray(values.length * 4);
        for (let i = 0; i < values.length; i++) {
            data[i * 4] = values[i];
            data[i * 4 + 3] = 255;
        }
        return {width: 128, height: 112, data};
    }});
    const redStars = field({sky: 10, sources: stars.slice(0, 12).map(([x, y], n) => [x, y, n < 7 ? 220 : 50])});
    const redSession = await redRun([await red(redStars, 'ref.png'),
        await red(Float32Array.from(redStars, v => Math.min(255, 2 * v)), 'red.png')]);
    close(redSession.frames[1].scale, 2, 0.05);
});

test('clipped source footprints stay blank after alignment and brightness scaling', async function ()
{
    const sources = stars.map(([x, y], i) => [x, y, i === 0 ? 600 : 45]);
    const images = [pictureImage(field({sky: 10, sources})),
        pictureImage(field({sky: 10, sources: [...sources, [62.2, 62.4, 20]], dx: 0.5, dy: 0.5, seed: 19}).map(v => 2 * v))];
    const session = await engine.process([file([], 'ref.png'), file([], 'gain.jpg')], {
        decodeImage: async input => images[input.name === 'ref.png' ? 0 : 1]
    });
    close(session.frames[1].scale, 2, 0.08);
    for (let f = 0; f < session.frames.length; f++) {
        const frame = session.frames[f];
        const shift = session.shifts[f];
        assert.ok(frame.clipped.some(value => value), 'each picture has a clipped source');
        for (let y = 10; y < 24; y++) {
            for (let x = 9; x < 23; x++) {
                const left = Math.floor(x - shift.dx);
                const top = Math.floor(y - shift.dy);
                let mixed = false;
                for (let yy = top - 4; yy <= Math.ceil(y - shift.dy) + 4; yy++) {
                    for (let xx = left - 4; xx <= Math.ceil(x - shift.dx) + 4; xx++) {
                        mixed = mixed || !!frame.clipped[yy * 128 + xx];
                    }
                }
                if (mixed) {
                    assert.ok(Number.isNaN(frame.data[y * 128 + x]), 'every clipped Gaussian tap must blank its output');
                }
            }
        }
    }
    assert.ok(session.notes.includes('Pixels too bright for the camera were left out of the comparison.'));
    const found = engine.candidates(session, 0, 1);
    assert.ok(found.length > 0);
    close(found[0].x, 62.2, 1);
    close(found[0].y, 62.4, 1);
    assert.equal(found.some(c => Math.hypot(c.x - 15.3, c.y - 16.7) < 5 && !c.edge), false,
        'blank clipping footprints cannot become confident candidates');
});

test('brightness apertures reject clipped Gaussian taps before taking the median', async function ()
{
    const sources = stars.map(([x, y]) => [Math.round(x), Math.round(y), 55]);
    const reference = pictureImage(field({sky: 10, sources}));
    const changed = pictureImage(field({sky: 10, seed: 19, dx: 0.5, dy: 0.5,
        sources: sources.map(([x, y, a], i) => [x, y, a * (i < 7 ? 1.1 : 2)])}));
    // These red-only clipped samples sit outside the 9x9 apertures but inside their Gaussian support.
    for (const [x, y] of sources.slice(0, 7)) {
        const i = ((y + 1) * 128 + x + 8) * 4;
        changed.data[i] = 255;
        changed.data[i + 1] = changed.data[i + 2] = 0;
    }
    const session = await engine.process([file([], 'ref.png'), file([], 'gain.jpg')], {
        decodeImage: async input => input.name === 'ref.png' ? reference : changed
    });
    assert.equal(session.frames[1].clipped.reduce((sum, value) => sum + value, 0), 7);
    assert.ok(session.shifts[1].ok && session.shifts[1].dx !== Math.round(session.shifts[1].dx));
    close(session.frames[1].scale, 2, 0.08);
    assert.equal(session.notes.some(note => /Too few stars/.test(note)), false, 'five clean apertures still supply a median');
});

test('candidate rank rewards supported changes and caps the area bonus at nine pixels', function ()
{
    const width = 48;
    const data = Float32Array.from({length: width * width}, (_, i) => i % 3 - 1);
    data[5 * width + 5] = 40;
    for (let y = 10; y < 12; y++) {
        for (let x = 10; x < 12; x++) {
            data[y * width + x] = 24;
        }
    }
    for (let y = 20; y < 31; y++) {
        for (let x = 20; x < 31; x++) {
            data[y * width + x] = 12;
        }
    }
    const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
    const found = engine.candidates(session, 0, 1);
    assert.deepEqual(Array.from(found, c => c.pixels), [4, 1, 121]);
    assert.deepEqual(Array.from(found, c => c.peak), [24, 40, 12]);
    assert.ok(found.every(c => c.sigma === found[0].sigma));
});

test('a bridge splits into candidates at separate local maxima for either sign', function ()
{
    const width = 32;
    for (const sign of [1, -1]) {
        const data = Float32Array.from({length: width * width}, (_, i) => i % 3 - 1);
        for (let step = 0; step <= 4; step++) {
            data[(10 + step) * width + 10 + step] = sign * (step === 0 ? 40 : step === 4 ? 30 : 12);
        }
        const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
        const found = engine.candidates(session, 0, 1);
        assert.equal(found.length, 2);
        assert.equal(found.reduce((sum, c) => sum + c.pixels, 0), 5);
        close(found[0].x, 10, 0.75);
        close(found[0].y, 10, 0.75);
        close(found[1].x, 14, 0.75);
        close(found[1].y, 14, 0.75);
        assert.ok(found.every(c => c.sign === (sign > 0 ? 'brighter' : 'fainter')));
    }
    const data = Float32Array.from({length: width * width}, (_, i) => i % 3 - 1);
    const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
    for (const [x, y, value] of [[10, 10, 100], [11, 11, 12], [12, 12, 90], [13, 12, 12], [14, 12, 80]]) {
        data[y * width + x] = value;
    }
    assert.deepEqual(Array.from(engine.candidates(session, 0, 1), c => c.peak), [100, 80],
        'nearby suppressed basins stay with the brighter seed; surviving peaks keep their seed heights');
    for (let i = 0; i < data.length; i++) {
        data[i] = i % 3 - 1;
    }
    for (let y = 10; y <= 20; y++) {
        data[y * width + 10] = data[y * width + 20] = 30;
    }
    for (let x = 10; x <= 20; x++) {
        data[20 * width + x] = 30;
    }
    const plateau = engine.candidates(session, 0, 1);
    assert.equal(plateau.length, 1, 'a connected flat plateau is one maximum');
    assert.equal(plateau[0].pixels, 31);
});

test('prominent peaks keep their own basins, seed heights and edge flags', function ()
{
    const width = 32;
    const shoulder = [[10, 10, 40], [11, 10, 38], [12, 11, 36], [13, 12, 34], [14, 12, 32], [15, 11, 10]];
    for (const sign of [1, -1]) {
        const data = Float32Array.from({length: width * width}, (_, i) => i % 3 - 1);
        for (const [x, y, value] of [...shoulder, [16, 10, 20]]) {
            data[y * width + x] = sign * value;
        }
        data[13 * width + 14] = NaN;
        const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
        const found = engine.candidates(session, 0, 1);
        assert.equal(found.length, 2);
        const faint = found.find(c => c.peak === sign * 20);
        assert.ok(faint, 'the second peak reports its seed value, never the brighter shoulder');
        assert.equal(faint.x, 16);
        assert.equal(faint.y, 10);
        assert.equal(faint.pixels, 1);
        assert.equal(faint.edge, false, 'a blank touching the primary shoulder belongs only to that basin');
        const primary = found.find(c => c.peak === sign * 40);
        const flux = shoulder.reduce((sum, [, , value]) => sum + value, 0);
        close(primary.x, shoulder.reduce((sum, [x, , value]) => sum + x * value, 0) / flux);
        close(primary.y, shoulder.reduce((sum, [, y, value]) => sum + y * value, 0) / flux);
        assert.equal(primary.pixels, shoulder.length);
        assert.equal(primary.edge, true);
    }
});

test('noise on the flat top of a saturated star does not split it into many candidates', function ()
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
                data[y * width + x] = Math.min(star, 30) + noise();
            }
        }
        const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
        const near = engine.candidates(session, 0, 1).filter(c => (c.x - 48) ** 2 + (c.y - 48) ** 2 < 100);
        worst = Math.max(worst, near.length);
    }
    assert.equal(worst, 1, 'one saturated star is one candidate');
});

test('border and masked neighbours flag candidates and rank below interior changes of similar strength', async function ()
{
    const width = 32;
    const data = Float32Array.from({length: width * width}, (_, i) => i % 2 ? 1 : -1);
    data[0] = 60;
    data[10 * width + 10] = 25;
    data[20 * width + 20] = 50;
    data[20 * width + 21] = NaN;
    // A shifted-in margin has no finite samples and must not produce candidates of its own.
    for (let y = 0; y < width; y++) {
        data[y * width + width - 1] = NaN;
    }
    const session = {width, height: width, frames: [{data: new Float32Array(data.length)}, {data}]};
    const found = engine.candidates(session, 0, 1);
    assert.equal(found.length, 3);
    assert.deepEqual(Array.from(found, c => c.edge), [false, true, true]);
    assert.equal(found[0].x, 10);
    assert.equal(found[1].x, 0);
    assert.equal(found[2].x, 20);
    const bright = stars.map(([x, y, amplitude]) => [x, y, amplitude * 10]);
    const reference = field({sources: bright});
    reference[17 * 128 + 15] = NaN;
    const masked = await engine.process([fitsField(reference, 'masked.fits'),
        fitsField(field({sources: bright, dx: 0.5, dy: 0.5, seed: 19}), 'moved.fits')]);
    assert.ok(Number.isNaN(masked.frames[0].data[17 * 128 + 15]), 'smoothing must preserve exact-grid masks');
    const affected = engine.candidates(masked, 0, 1).filter(c => Math.hypot(c.x - 15, c.y - 17) < 5);
    assert.ok(affected.length > 0, 'keep incomplete-support detections for inspection');
    assert.ok(affected.every(c => c.edge), 'smoothing must retain missing-support provenance');
});

test('candidate connectivity, limit and NaN-edge flags', async function ()
{
    const width = 96;
    const height = 96;
    const a = field({width, height, sources: [], seed: 41, sky: 0});
    const b = field({width, height, sources: [], seed: 42, sky: 0});
    for (let y = 10; y <= 70; y += 10) {
        for (let x = 10; x <= 70; x += 10) {
            b[y * width + x] += 30;
        }
    }
    const session = {width, height, frames: [{data: a}, {data: b}]};
    assert.equal(engine.candidates(session, 0, 1).length, 20);
    b.fill(0);
    a.fill(0);
    // Alternating +/-1 noise has a nonzero MAD.
    for (let i = 0; i < b.length; i++) {
        b[i] = i % 2 ? 1 : -1;
    }
    b[20 * width + 20] = 30;
    b[21 * width + 21] = 25;
    b[40 * width + 40] = 40;
    b[40 * width + 41] = NaN;
    b[0] = 50;
    const blobs = engine.candidates(session, 0, 1);
    assert.equal(blobs.length, 3);
    assert.equal(blobs[0].pixels, 2);
    assert.equal(blobs[0].edge, false);
    assert.ok(blobs.slice(1).every(blob => blob.edge));
    // The difference is measured from its own median (+1 here: the outliers tip the alternating noise), so 30 - 1.
    assert.equal(blobs[0].peak, 29);
});

test('real SPHEREx cutouts: exact shapes, header dates, units and honest alignment', async function ()
{
    const names = (await readdir(new URL('./testdata/', import.meta.url))).filter(name => /\.fits$/i.test(name)).sort();
    assert.equal(names.length, 3, 'all three real cutouts must be present');
    const expectedDates = ['2025-05-18T09:31:00.088Z', '2025-11-29T19:05:52.495Z', '2026-05-23T23:30:27.510Z'];
    const files = await Promise.all(names.map(async name => file(await readFile(new URL('./testdata/' + name, import.meta.url)), name)));
    for (let i = 0; i < files.length; i++) {
        const frame = await engine.readFile(files[i]);
        assert.equal(frame.width, 58);
        assert.equal(frame.height, 59);
        assert.equal(frame.date.toISOString(), expectedDates[i]);
        assert.equal(frame.dateSource, 'DATE-OBS');
        assert.equal(frame.unit, 'MJy / sr');
        assert.equal(frame.meta.bunit, 'MJy / sr');
        assert.equal(frame.meta.hdu, 1);
        assert.equal(frame.meta.hasWcs, true);
        assert.ok(frame.warnings.includes("Zodiacal light model removed (from the file's ZODI plane)"));
    }
    const session = await engine.process(files.toReversed());
    assert.deepEqual(Array.from(session.frames, frame => frame.date.toISOString()), expectedDates);
    for (let i = 0; i < session.frames.length; i++) {
        const frame = session.frames[i];
        const shift = session.shifts[i];
        if (shift.ok) {
            assert.ok(Math.hypot(shift.dx, shift.dy) < 8, 'accepted real cutout shift must be small');
        } else {
            assert.equal(shift.dx, 0);
            assert.equal(shift.dy, 0);
            assert.ok(session.notes.includes(`Couldn't line up ${frame.name}; shown as is`));
        }
        console.log(`REAL ${frame.width}x${frame.height} ${frame.date.toISOString()} ${frame.unit} shift=(${shift.dx.toFixed(3)},${shift.dy.toFixed(3)}) ${shift.ok ? 'ok' : 'failed'} ${shift.method}`);
    }
    const top = engine.candidates(session, 0, 2).slice(0, 3);
    assert.ok(top[0].pixels > 100 && Math.abs(top[0].peak / top[0].sigma) > 1000,
        'the moving star, whose saturated centre is blank, still ranks first');
    console.log('REAL top 3 (first to last): ' + JSON.stringify(top.map(c => ({x: +c.x.toFixed(2), y: +c.y.toFixed(2),
        peak: +c.peak.toFixed(3), sigma: +c.sigma.toFixed(3), sign: c.sign, pixels: c.pixels}))));
});

test('2040x2040 float32 frame processing performance', async function ()
{
    const width = 2040;
    const values = field({width, height: width, sources: stars, seed: 123});
    const input = fitsField(values, 'large.fits', width, width);
    const start = performance.now();
    const session = await engine.process([input]);
    const elapsed = performance.now() - start;
    assert.equal(session.frames[0].data.length, width * width);
    assert.ok(elapsed < 2000, `processing took ${elapsed.toFixed(0)} ms (budget 2000 ms)`);
    const renderStart = performance.now();
    const pixels = engine.render(session, 0, {mode: 'blink'});
    assert.equal(pixels.data.length, width * width * 4);
    console.log(`PERF 2040x2040: process=${elapsed.toFixed(0)} ms, render=${(performance.now() - renderStart).toFixed(0)} ms (Node ${process.version})`);
});

let passed = 0;
for (const {name, run} of tests) {
    try {
        await run();
        passed++;
        console.log('PASS ' + name);
    } catch (error) {
        console.error('FAIL ' + name);
        console.error(error);
        process.exitCode = 1;
    }
}
console.log(`${passed}/${tests.length} tests passed`);
