import { describe, expect, it } from 'vitest';
import { chooseColourFrames, colourParts as makeColourParts, colourSentence as makeColourSentence, falseColourView as makeFalseColourView, pictureOnlyParts, screenColourFrames } from '../src/lib/falsecolour-view';
import { colourAt, falseColourRgba as makeFalseColourRgba, FalseColourError, NO_COLOUR_HATCH, pairStretch, type ColourAt } from '../src/lib/falsecolour';
import { frameBackground, stackVisit } from '../src/lib/stack';
import { aperture, resampleNoiseScale } from '../src/lib/photometry';
import { gridPixToSky, regridNorthUp } from '../src/lib/regrid';
import { makeWcs } from '../src/lib/wcs';
import type { SkyResult } from '../src/lib/source';
import type { Cutout, OutputGrid, RegriddedFrame } from '../src/lib/types';
import text from '../src/lib/falsecolour-view.ts?raw';
import slotText from '../src/ui/slots.ts?raw';

declare const process: { env: Record<string, string | undefined> };
const both: ColourAt = { short: 4, long: 10, snrShort: 14.3, snrLong: 30.7, index: 0.423, seen: 'both', valid: true };
const grid: OutputGrid = { center: { ra: 1, dec: 2 }, fovDeg: 0.1, pixelArcsec: 6.15, width: 31, height: 31 };
const radii = { radius: 2, annulusIn: 4, annulusOut: 7 };
const readings: string[] = [];
// One visit of six frames that agree within noise, yet lean on the first (an input from the round 9 review).
const ONE_VISIT_LEANING = [4.5, 1.25, 1.25, 1.25, 1.25, 1.25];

describe('round 9h picture safeguards', () => {
    it('uses the lower two-frame value for a strong isolated hit without hatching', () => {
        const a = sourceFrame(1.25, 15, 1000);
        const b = sourceFrame(1.25, 15, 1000);
        b.data[15 * 31 + 15] = 4000;
        const combined = screenColourFrames([a, b]).data[15 * 31 + 15]!;
        expect(combined).toBeCloseTo(a.data[15 * 31 + 15]! - frameBackground(a.data), 3);
        expect(Number.isFinite(combined)).toBe(true);
    });
    it('screens an isolated two-frame hit, including at the reading aperture', () => {
        const a = sourceFrame(1.25, 15, 1000);
        const b = sourceFrame(1.25, 15, 1000);
        b.data[15 * 31 + 15] = 1500;
        const result = falseColourView(sky([a, b]), sky([sourceFrame(4.6, 15, 1000)]), radii);
        expect(result.parts.reading).toContain('1.25 µm shows light that differs between frames');
        expect(result.parts.note).toContain('Hatched areas have no colour: the frames do not all cover them. The grey picture shows through the hatching.');
    });

    it('uses the median rather than the clipped mean of three frames', () => {
        const frames = [100, 110, 125].map(level => sourceFrame(1.25, 15, level));
        expect(screenColourFrames(frames).data[15 * 31 + 15]).toBe(110 - frameBackground(frames[1]!.data));
    });

    it('keeps sky removal and detector-hit cautions visible without a reading', () => {
        const out = makeFalseColourView(sky([sourceFrame(1.25)]), sky([sourceFrame(4.6)]), radii);
        expect(out.parts.note).toContain("Each frame's middle value is taken off as sky, so a glow that fills most of the view can be removed with it.");
        expect(out.parts.warning).toContain('a detector hit can show as a coloured point');
        expect(out.parts.method).not.toContain('middle value');
    });

    it('returns picture-only parts without reading or reading method', () => {
        const out = falseColourView(sky([sourceFrame(1.25)]), sky([sourceFrame(4.6)]), radii);
        const parts = pictureOnlyParts(out.parts);
        expect(parts.reading).toBe('');
        expect(parts.method).toBe('The colours in the picture are for looking; this page does not measure a colour.');
        expect(parts.labels).toBe(out.parts.labels);
        expect(parts.warning).toBe(out.parts.warning);
        expect(parts.note).toBe(out.parts.note);
        expect(Object.values(parts).join(' ')).not.toMatch(/At the centre|signal-to-noise|seen at/);
    });

    it('rejects a strong extended hit in two frames', () => {
        const a = measuredFrame(1.25, 0, 121);
        const b = measuredFrame(1.25, 0, 7919);
        for (let y = 14; y <= 16; y++) {
            for (let x = 14; x <= 16; x++) {
                a.data[y * 31 + x] = 500;
            }
        }
        const out = screenColourFrames([a, b]);
        expect(out.data[15 * 31 + 15]).toBeCloseTo(b.data[15 * 31 + 15]! - frameBackground(b.data), 4);
    });

    it('keeps a 1150-sigma steady core with 3% scatter that five spreads alone would remove', () => {
        const a = measuredFrame(1.25, 1150, 121);
        const b = { ...a, data: a.data.slice() };
        const p = 15 * 31 + 15;
        b.data[p] = a.data[p]! * 1.03;
        expect(aperture(a.data, 31, 31, { x: 15, y: 15 }, { ...radii, noiseScale: resampleNoiseScale(grid.pixelArcsec) }).snr).toBeCloseTo(1150, 2);
        expect(Number.isFinite(screenColourFrames([a, b]).data[p])).toBe(true);
    });

    it.each([[1100, 1000], [2000, 1135.7143]])('combines changes according to their size: second value %s', (value, expected) => {
        const a = sourceFrame(1.25, 15, 900);
        const b = sourceFrame(1.25, 15, value);
        expect(screenColourFrames([a, b]).data[15 * 31 + 15]).toBeCloseTo(expected, 3);
    });

    it('hatches a value-500 detector hit 20″ from the centre instead of painting a blue star', () => {
        const random = studyRandom(9);
        const a = [studyFrame(random, 1.25, 0, 0, 0, 1, true), studyFrame(random, 1.25, 1, 0, 0)];
        const b = [studyFrame(random, 4.6, 0, 0, 0), studyFrame(random, 4.6, 1, 0, 0)];
        const out = makeFalseColourView(studySky(a), studySky(b), studyRadii);
        let blue = 0;
        let hatched = 0;
        for (let p = 0; p < out.rgba.length; p += 4) {
            if (out.rgba[p + 2]! > 200 && out.rgba[p]! < 60) {
                blue++;
            }
            if (Math.abs(out.rgba[p + 1]! - (out.rgba[p]! + out.rgba[p + 2]!) / 2) > 8) {
                hatched++;
            }
        }
        expect(blue).toBe(0);
        expect(hatched).toBe(0);
    });

    it('withholds a picture when the bands have no shared finite pixels', () => {
        const a = sourceFrame(1.25);
        const b = sourceFrame(4.6);
        for (let p = 0; p < a.data.length; p++) {
            if (p % 31 < 15) {
                b.data[p] = NaN;
            } else {
                a.data[p] = NaN;
            }
        }
        expect(() => falseColourView(sky([a]), sky([b]), radii)).toThrow('False colour is not shown for this view: the frames at the two wavelengths give a colour to less than half of it.');
    });

    it('uses transparent gaps between diagonal hatch lines, and none for agreed coverage', () => {
        const [r, g, b, alpha] = NO_COLOUR_HATCH;
        expect(Math.abs(g - (r + b) / 2)).toBeGreaterThan(8);
        expect(alpha).toBe(255);
        const lin = { lo: 0, hi: 1, kind: 'linear' } as const;
        const missing = falseColourRgba(new Float32Array(32).fill(NaN), new Float32Array(32), lin, lin, undefined, 8);
        for (let p = 0; p < 32; p++) {
            expect(Array.from(missing.slice(p * 4, p * 4 + 4))).toEqual((p % 8 + Math.floor(p / 8)) % 4 === 0 ? NO_COLOUR_HATCH : [0, 0, 0, 0]);
        }
        const out = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([sourceFrame(4.6), sourceFrame(4.6)]), radii);
        for (let p = 0; p < out.rgba.length; p += 4) {
            expect(Math.abs(out.rgba[p + 1]! - (out.rgba[p]! + out.rgba[p + 2]!) / 2)).toBeLessThanOrEqual(1);
            expect(out.rgba[p + 3]).toBe(255);
        }
    });
});

// Round 9h calibration: cropped central 65 x 65 pixels on the page's 1.5375″ grid. Detector pixels are 6.15″,
// with an integrated Gaussian PSF of FWHM 5″, independent detector noise, random roll and subpixel phase.
// Re-run with FC_R9H_STUDY=1 and the scoped gate. Counts describe the final screened median pictures.
const studyGrid: OutputGrid = { center: { ra: 150, dec: 2 }, fovDeg: 65 * 1.5375 / 3600, pixelArcsec: 1.5375, width: 65, height: 65 };
const studyRadii = { radius: 8, annulusIn: 12, annulusOut: 24 };

function studyRandom(seed: number)
{
    let state = seed >>> 0;
    const uniform = () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return ((state >>>= 0) + 1) / 4294967297;
    };
    return { uniform, gaussian: () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform()) };
}

function studyFrame(random: ReturnType<typeof studyRandom>, lambda: number, visit: number, dx: number, flux: number, noise = 1, hit = false): RegriddedFrame
{
    const size = 26;
    const roll = random.uniform() * 2 * Math.PI;
    const cx = 12 + random.uniform();
    const cy = 12 + random.uniform();
    const scale = 6.15 / 3600;
    const cd: [[number, number], [number, number]] = [
        [-scale * Math.cos(roll), scale * Math.sin(roll)], [scale * Math.sin(roll), scale * Math.cos(roll)],
    ];
    const wcs = makeWcs({ crpix: [cx + 1, cy + 1], crval: [150, 2], cd, naxis: [size, size] });
    const xStar = cx + dx * Math.cos(roll) / 6.15;
    const yStar = cy - dx * Math.sin(roll) / 6.15;
    const erf = (x: number) => {
        const t = 1 / (1 + 0.3275911 * Math.abs(x));
        const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
        return x >= 0 ? y : -y;
    };
    const phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
    const sigma = 5 / 2.3548 / 6.15;
    const skyLevel = 5 * random.gaussian();
    const image = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        const fy = phi((y + 0.5 - yStar) / sigma) - phi((y - 0.5 - yStar) / sigma);
        for (let x = 0; x < size; x++) {
            const fx = phi((x + 0.5 - xStar) / sigma) - phi((x - 0.5 - xStar) / sigma);
            image[y * size + x] = skyLevel + noise * random.gaussian() + flux * fx * fy;
        }
    }
    if (hit) {
        const x = Math.round(cx + 20 * Math.cos(roll) / 6.15);
        const y = Math.round(cy - 20 * Math.sin(roll) / 6.15);
        image[y * size + x] = image[y * size + x]! + 500;
    }
    const record = { detector: 1, tMin: 60000 + visit * 30, tMax: 60000.001 + visit * 30 } as RegriddedFrame['frame'];
    const cutout = { frame: record, box: { x0: 0, y0: 0, x1: size, y1: size }, width: size, height: size, image, wcs: wcs.params, header: {} } as unknown as Cutout;
    return { frame: record, grid: studyGrid, data: regridNorthUp(cutout, wcs, studyGrid), lambdaAtCenter: lambda, bandwidthAtCenter: 0.01 };
}

function studySky(frames: RegriddedFrame[]): SkyResult
{
    return { ...sky(frames), grid: studyGrid };
}

function studyBox(data: Float32Array, skyLevel = 0): number
{
    let sum = 0;
    // Twelve picture pixels span three 6.15″ detector pixels.
    for (let y = 26; y < 38; y++) {
        for (let x = 26; x < 38; x++) {
            sum += data[y * 65 + x]! - skyLevel;
        }
    }
    return sum;
}

describe('round 9j pair combination', () => {
    it('uses five robust spreads to keep ordinary noise as a mean', () => {
        const a = sourceFrame(1.25);
        const b = sourceFrame(1.25);
        for (let i = 0; i < a.data.length; i++) {
            a.data[i] = i % 2 ? 1 : -1;
            b.data[i] = -a.data[i]!;
        }
        a.data[480] = 6;
        b.data[480] = -6;
        expect(screenColourFrames([a, b]).data[480]).toBeCloseTo(0, 5);
    });

    it('blends linearly between the mean and the lower value', () => {
        const a = sourceFrame(1.25);
        const b = sourceFrame(1.25);
        a.data.fill(0);
        b.data.fill(0);
        a.data[480] = 100;
        b.data[480] = 160;
        expect(screenColourFrames([a, b]).data[480]).toBeCloseTo(127.85714, 4);
        a.data[481] = 0;
        b.data[481] = NaN;
        const result = screenColourFrames([a, b]).data;
        expect(result[481]).toBeNaN();
        expect(result[482]).toBe(0);
    });

    it('states the two-frame warning and coverage note exactly, but never warns for three frames', () => {
        const pair = makeFalseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([sourceFrame(4.6), sourceFrame(4.6), sourceFrame(4.6)]), radii);
        expect(pair.parts.warning).toBe('With only two frames at 1.25 µm, the lower of the two values is used wherever they disagree, so something present in only one of them is missing from this picture. A detector hit at the same place in both, or a faint one, can still show as a coloured point.');
        expect(pair.parts.note).toContain('Hatched areas have no colour: the frames do not all cover them. The grey picture shows through the hatching.');
        expect(pair.parts.note).not.toContain('differ there by more than');
        const three = makeFalseColourView(sky([sourceFrame(1.25), sourceFrame(1.25), sourceFrame(1.25)]), sky([sourceFrame(4.6), sourceFrame(4.6), sourceFrame(4.6)]), radii);
        expect(three.parts.warning).not.toContain('With only two frames');
    });
    it('keeps covered stars and measures their 3 by 3 detector-pixel brightness', () => {
        const rows: { snr: number; medianLoss: number; worstLoss: number; within10: number }[] = [];
        for (const [snr, flux] of [[11, 38], [29, 100], [115, 400], [1150, 4000]]) {
            const losses: number[] = [];
            for (let draw = 0; draw < 75; draw++) {
                const random = studyRandom(0x9a170 + (4 * draw + [11, 29, 115, 1150].indexOf(snr!)) * 7919);
                const a = studyFrame(random, 1.25, 0, 0, flux!);
                const b = studyFrame(random, 1.25, 1, 0, flux!);
                const combined = screenColourFrames([a, b]).data;
                expect(combined.every(Number.isFinite)).toBe(true);
                const mean = (studyBox(a.data, frameBackground(a.data)) + studyBox(b.data, frameBackground(b.data))) / 2;
                losses.push(1 - studyBox(combined) / mean);
            }
            losses.sort((a, b) => a - b);
            rows.push({ snr: snr!, medianLoss: losses[37]!, worstLoss: Math.max(...losses), within10: losses.filter(loss => Math.abs(loss) <= 0.1).length });
        }
        console.log('R9J brightness', JSON.stringify(rows));
        expect(rows.reduce((sum, row) => sum + row.within10, 0)).toBeGreaterThanOrEqual(285);
    }, 300000);

    it('drops isolated 500-unit hits of one and four pixels across three seeds', () => {
        for (const seed of [31, 932, 12019]) {
            for (const side of [1, 2]) {
                const random = studyRandom(seed);
                const a = studyFrame(random, 1.25, 0, 0, 0);
                const b = studyFrame(random, 1.25, 1, 0, 0);
                const baseline = screenColourFrames([a, b]).data;
                for (let y = 32; y < 32 + side; y++) {
                    for (let x = 32; x < 32 + side; x++) {
                        a.data[y * 65 + x] = a.data[y * 65 + x]! + 500;
                    }
                }
                const result = screenColourFrames([a, b]).data;
                for (let y = 32; y < 32 + side; y++) {
                    for (let x = 32; x < 32 + side; x++) {
                        expect(Math.abs(result[y * 65 + x]! - baseline[y * 65 + x]!)).toBeLessThan(25);
                    }
                }
            }
        }
    });

    it('drops the peak of a star present in only one frame', () => {
        for (const seed of [87, 879, 8791]) {
            const random = studyRandom(seed);
            const a = studyFrame(random, 1.25, 0, 0, 400);
            const b = studyFrame(random, 1.25, 1, 0, 0);
            const out = screenColourFrames([a, b]).data;
            expect(Math.max(...out)).toBeLessThan(0.1 * (Math.max(...a.data) - frameBackground(a.data)));
        }
    });

    it('leaves noise-only sky unbiased', () => {
        for (const seed of [73, 731, 7319]) {
            const random = studyRandom(seed);
            const a = studyFrame(random, 1.25, 0, 0, 0);
            const b = studyFrame(random, 1.25, 1, 0, 0);
            const out = screenColourFrames([a, b]).data;
            const mean = out.reduce((sum, value) => sum + value, 0) / out.length;
            const sd = Math.sqrt(out.reduce((sum, value) => sum + (value - mean) ** 2, 0) / out.length);
            expect(Math.abs(mean)).toBeLessThan(0.1 * sd);
        }
    });

    // The colour map is continuous: define grey as red and blue within 10% of the brighter channel.
    it('studies tint from two frames versus three', () => {
        let greyPeak = 0;
        let greyBox = 0;
        for (let draw = 0; draw < 100; draw++) {
            const random = studyRandom(0x51a90 + draw * 7919);
            const short = [0, 1].map(i => studyFrame(random, 1.25, i, 0, 400));
            const long = [0, 1, 2].map(i => studyFrame(random, 4.6, i, 0, 400));
            const rgba = makeFalseColourView(studySky(short), studySky(long), studyRadii).rgba;
            let brightest = -1;
            let peakRed = 0;
            let peakBlue = 0;
            let boxRed = 0;
            let boxBlue = 0;
            for (let y = 26; y < 38; y++) {
                for (let x = 26; x < 38; x++) {
                    const i = (y * 65 + x) * 4;
                    const red = rgba[i]!;
                    const blue = rgba[i + 2]!;
                    boxRed += red;
                    boxBlue += blue;
                    if (red + blue > brightest) {
                        brightest = red + blue;
                        peakRed = red;
                        peakBlue = blue;
                    }
                }
            }
            const grey = (red: number, blue: number) => Math.abs(red - blue) <= 0.1 * Math.max(red, blue);
            greyPeak += grey(peakRed, peakBlue) ? 1 : 0;
            greyBox += grey(boxRed, boxBlue) ? 1 : 0;
        }
        console.log('R9J tint', JSON.stringify({ greyPeak, greyBox }));
        expect(greyBox).toBeGreaterThanOrEqual(90);
    }, 300000);
});

describe('round 9i picture boundaries', () => {
    it('keeps a realistic bright star core when frames have different detector phases', () => {
        for (let draw = 0; draw < 30; draw++) {
            const random = studyRandom(0x9a170 + (4 * draw + 3) * 7919);
            const a = studyFrame(random, 1.25, 0, 0, 4000);
            const b = studyFrame(random, 1.25, 1, 0, 4000);
            expect(Number.isFinite(screenColourFrames([a, b]).data[32 * 65 + 32])).toBe(true);
        }
    });

    it('keeps noise where the five-spread guard is larger than the fraction', () => {
        const random = studyRandom(9203);
        const a = studyFrame(random, 1.25, 0, 0, 0);
        const b = studyFrame(random, 1.25, 1, 0, 0);
        const result = screenColourFrames([a, b]);
        expect(Number.isFinite(result.data[32 * 65 + 32])).toBe(true);
    });
    it.each([0, 49, 51])('requires at least half the pixels coloured (%s%% overlap)', percent => {
        const a = sourceFrame(1.25);
        const b = sourceFrame(4.6);
        const n = a.data.length;
        const outside = Math.floor(n / 4);
        const shared = Math.floor(n * percent / 100);
        for (let p = 0; p < n; p++) {
            if (p < outside) {
                a.data[p] = NaN;
            } else if (p >= outside + shared) {
                b.data[p] = NaN;
            }
        }
        if (percent < 50) {
            expect(() => makeFalseColourView(sky([a]), sky([b]), radii)).toThrow('False colour is not shown for this view: the frames at the two wavelengths give a colour to less than half of it.');
        } else {
            const result = makeFalseColourView(sky([a]), sky([b]), radii);
            expect(result.rgba).toHaveLength(n * 4);
        }
    });

    it('requires both values at the pixel, not its neighbours', () => {
        const a = sourceFrame(1.25);
        const b = sourceFrame(1.25);
        for (let y = 13; y <= 17; y++) {
            for (let x = 13; x <= 17; x++) {
                if (y < 15 || (y === 15 && x !== 15 && x <= 16)) {
                    b.data[y * 31 + x] = NaN;
                }
            }
        }
        expect(Number.isFinite(screenColourFrames([a, b]).data[15 * 31 + 15])).toBe(true);
        expect(screenColourFrames([a, b]).data[13 * 31 + 13]).toBeNaN();
    });

    it('rejects a 500-value 4 by 4 detector hit at the centre and 20 arcseconds out', () => {
        for (const x0 of [30, 43]) {
            const random = studyRandom(845 + x0);
            const a = studyFrame(random, 1.25, 0, 0, 0);
            const b = studyFrame(random, 1.25, 1, 0, 0);
            for (let y = 30; y < 34; y++) {
                for (let x = x0; x < x0 + 4; x++) {
                    a.data[y * 65 + x] = a.data[y * 65 + x]! + 500;
                }
            }
            const screened = screenColourFrames([a, b]);
            for (let y = 30; y < 34; y++) {
                for (let x = x0; x < x0 + 4; x++) {
                    expect(screened.data[y * 65 + x]).toBeCloseTo(b.data[y * 65 + x]! - frameBackground(b.data), 4);
                }
            }
        }
    });

    it('removes colour within 6 arcseconds of a bright star in only one frame', () => {
        const random = studyRandom(1941);
        const a = studyFrame(random, 1.25, 0, 0, 400);
        const b = studyFrame(random, 1.25, 1, 0, 0);
        const out = screenColourFrames([a, b]);
        for (let y = 28; y <= 36; y++) {
            for (let x = 28; x <= 36; x++) {
                if (Math.hypot(x - 32, y - 32) * 1.5375 <= 6) {
                    expect(out.data[y * 65 + x]).toBeLessThan(0.1 * Math.max(...a.data));
                }
            }
        }
    });
});

describe('round 9h placement rules', () => {
    // Shared light at each possible peak keeps the pixel agreement screen satisfied while changing the brightest
    // point. This isolates placement from the independent pixel screen, which otherwise refuses these first.
    const placed = (lambda: number, xs: number[], noiseFactors = xs.map(() => 1)) => xs.map((x, i) => {
        const f = frame(lambda, 60000 + i * 30);
        f.grid = { ...grid, pixelArcsec: 1.5375 };
        f.data = Float32Array.from(f.data, value => value * noiseFactors[i]!);
        for (const column of [...new Set(xs)]) {
            f.data[15 * 31 + column] = column === x ? 10500 : 10000;
        }
        return f;
    });
    const read = (xs: number[], noise?: number[]) => {
        const l = placed(4.6, xs, noise);
        const s = placed(1.25, xs.map(() => 15));
        return makeFalseColourView({ ...sky(s), grid: s[0]!.grid }, { ...sky(l), grid: l[0]!.grid },
            { radius: 8, annulusIn: 9, annulusOut: 13 }).parts.reading;
    };

    it('judges exactly two placed frames among three by the two-place rule', () => {
        const reading = read([10, 20, 15], [1, 1, 8]);
        expect(reading).toContain('the two frames strong enough to place it do not agree on where it is brightest');
        expect(reading).not.toContain('seen at 4.60 µm');
        expect(reading).not.toContain('only 2 frames');
    });

    it('refuses all-off-centre placed frames even when their median picture peaks centrally', () => {
        const l = placed(4.6, [10, 20, 10]);
        for (const f of l) {
            f.data[15 * 31 + 15] = 10250;
            f.data[20 * 31 + 15] = 10000;
        }
        // Spread three peaks around the centre so no outer point wins a majority; all are >6.15″ out.
        l[2]!.data[15 * 31 + 10] = 10000;
        l[2]!.data[20 * 31 + 15] = 10500;
        const s = placed(1.25, [15, 15, 15]);
        const reading = makeFalseColourView({ ...sky(s), grid: s[0]!.grid }, { ...sky(l), grid: l[0]!.grid },
            { radius: 8, annulusIn: 9, annulusOut: 13 }).parts.reading;
        expect(reading).toContain('every frame strong enough to place it is brightest away from the centre');
        expect(reading).toContain('not counted as seen at the centre');
        expect(reading).not.toContain('seen at 4.60 µm');
        expect(reading).not.toMatch(/brightest [\d.]+″/);
    });

    it.each([[[12, 15, 18]], [[12, 12, 18, 18]]])('checks the widest pair across the median: %j', xs => {
        expect(read(xs)).toContain('its brightest point sits in different places in different frames');
    });

    it('uses one detector pixel plus one picture pixel, not two detector pixels, for 3+ placed frames', () => {
        expect(read([12, 15, 18])).toContain('different places');
    });

    it('refuses two placed peaks with gap 6.88″, below stillLimit and above one detector pixel', () => {
        const l = placed(4.6, [13, 17]);
        l[1]!.data[15 * 31 + 17] = 10000;
        l[1]!.data[17 * 31 + 17] = 10500;
        l[0]!.data[17 * 31 + 17] = 10000;
        const s = placed(1.25, [15, 15]);
        const reading = makeFalseColourView({ ...sky(s), grid: s[0]!.grid }, { ...sky(l), grid: l[0]!.grid },
            { radius: 8, annulusIn: 9, annulusOut: 13 }).parts.reading;
        expect(reading).toContain('its two frames do not agree on where it is brightest');
        expect(reading).not.toContain('seen at 4.60 µm');
    });
});

describe('round 9h reproducible studies', () => {
    it.skipIf(process.env.FC_R9H_STUDY !== '1')('measures R4 final reading outcomes', () => {
        const rows: Record<string, { clean: number; hedged: number; different: number; notCounted: number; noReading: number }> = {};
        const cases = [
            ['a: 2 placed / 3', [-7.5, 7.5, 0]], ['b: line of 3', [-4.61, 0, 4.61]],
            ['c: two and two', [-4.5, -4.5, 4.5, 4.5]], ['d: four evenly', [-4.6, -4.6 / 3, 4.6 / 3, 4.6]],
            ['e: six evenly', [-5, -3, -1, 1, 3, 5]], ['f: two opposite', [-4.61, 4.61]], ['g: centre then east', [0, 9.23]],
            ...[2, 3, 6, 20].map(n => [`h: steady ${n}`, Array<number>(n).fill(0)] as const),
        ] as const;
        for (const [cell, positions] of cases) {
            const counts = { clean: 0, hedged: 0, different: 0, notCounted: 0, noReading: 0 };
            const draws = cell.startsWith('h:') ? 300 : 120;
            for (let draw = 0; draw < draws; draw++) {
                const random = studyRandom(0x9a170 + cases.findIndex(item => item[0] === cell) * 104729 + draw * 7919);
                const flux = cell.startsWith('h:') ? [38, 100, 400, 4000][draw % 4]!
                    : cell.startsWith('f:') || cell.startsWith('g:') ? [100, 400, 4000][draw % 3]! : 100;
                const s = positions.map((_, i) => studyFrame(random, 1.25, i, 0, 2000));
                const l = positions.map((p, i) => studyFrame(random, 4.6, i, p, flux, cell.startsWith('a:') && i === 2 ? 4 : 1));
                if (cell.startsWith('a:')) {
                    // This input specifically requires the third frame to be too noisy to place, rather than a
                    // nominal SNR of 7 which sometimes scatters above 10. Keep all 120 accepted draws reproducible.
                    while (aperture(l[2]!.data, 65, 65, { x: 32, y: 32 },
                        { ...studyRadii, noiseScale: resampleNoiseScale(1.5375) }).snr >= 10) {
                        l[2] = studyFrame(random, 4.6, 2, 0, flux, 4);
                    }
                }
                const reading = makeFalseColourView(studySky(s), studySky(l), studyRadii).parts.reading;
                const seen = reading.includes('seen at 4.60 µm') || reading.includes('seen at both wavelengths');
                const different = reading.includes('different places') || reading.includes('do not agree on where');
                const noReading = reading.includes('4.60 µm cannot be measured');
                if (noReading) {
                    counts.noReading++;
                }
                if (!seen) {
                    counts.notCounted++;
                } else if (different) {
                    counts.different++;
                } else if (reading.includes('only 2 frames')) {
                    counts.hedged++;
                } else {
                    counts.clean++;
                }
            }
            rows[cell] = counts;
        }
        console.log('R9H_R4 seed=0x9a170; row*104729 + draw*7919', JSON.stringify(rows));
        expect(rows['a: 2 placed / 3']!.clean + rows['a: 2 placed / 3']!.hedged).toBe(0);
        expect(rows['g: centre then east']!.clean + rows['g: centre then east']!.hedged).toBe(0);
    }, 300000);

    it.skipIf(process.env.FC_R9H_STUDY !== '1')('measures P2 loss and a bright core with 3% scatter', () => {
        let lost = 0;
        let total = 0;
        let coresLost = 0;
        let fiveSpreadCoreLoss = 0;
        for (let draw = 0; draw < 100; draw++) {
            const random = studyRandom(0x2c170 + draw * 7919);
            // Identical PSF, independent Gaussian noise and 3% flux scatter. Includes a bright SNR ~1150 core.
            const make = (lambda: number) => {
                const f = studyFrame(studyRandom(41), lambda, 0, 0, 0);
                const amplitude = 1 + 0.03 * random.gaussian();
                for (let y = 0; y < 65; y++) {
                    for (let x = 0; x < 65; x++) {
                        let signal = 0;
                        for (const [sx, sy, peak] of [[32, 32, 1700], [9, 9, 40], [56, 12, 20], [8, 51, 10]]) {
                            signal += peak! * Math.exp(-((x - sx!) ** 2 + (y - sy!) ** 2) / (2 * 3 ** 2));
                        }
                        f.data[y * 65 + x] = random.gaussian() + amplitude * signal;
                    }
                }
                return f;
            };
            const frames = [make(1.25), make(1.25)];
            const difference = Array.from(frames[0]!.data, (v, p) => v - frames[1]!.data[p]!);
            const middle = (xs: number[]) => { const s = xs.sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
            const mid = middle([...difference]);
            const spread = 1.4826 * middle(difference.map(d => Math.abs(d - mid)));
            if (Math.abs(difference[32 * 65 + 32]! - mid) > 5 * spread) {
                fiveSpreadCoreLoss++;
            }
            const screened = screenColourFrames(frames);
            lost += screened.data.reduce((sum, value) => sum + (Number.isFinite(value) ? 0 : 1), 0);
            total += screened.data.length;
            coresLost += Number.isFinite(screened.data[32 * 65 + 32]) ? 0 : 1;
        }
        console.log('R9H_P2 seed=0x2c170 + draw*7919', JSON.stringify({ lost, total, percent: 100 * lost / total, coresLost, fiveSpreadCoreLoss }));
        expect(lost / total).toBeLessThan(0.001);
        expect(coresLost).toBe(0);
    }, 300000);
});

function falseColourRgba(short: Float32Array, long: Float32Array, sShort: Parameters<typeof makeFalseColourRgba>[2],
    sLong: Parameters<typeof makeFalseColourRgba>[3], out?: Uint8ClampedArray, width = grid.width): Uint8ClampedArray
{
    return makeFalseColourRgba(short, long, sShort, sLong, out, width);
}

function colourParts(...args: Parameters<typeof makeColourParts>): ReturnType<typeof makeColourParts>
{
    const result = makeColourParts(...args);
    readings.push(Object.values(result).join(' '));
    return result;
}

function colourSentence(...args: Parameters<typeof makeColourSentence>): string
{
    const result = makeColourSentence(...args);
    readings.push(result);
    return result;
}

function falseColourView(...args: Parameters<typeof makeFalseColourView>): ReturnType<typeof makeFalseColourView>
{
    // The sentence rules are tested on coarse made-up grids with sources exactly on pixels, so the wide-view gate is
    // lifted here; the gate has its own tests, which call makeFalseColourView with its default.
    const result = args.length < 4 ? makeFalseColourView(args[0], args[1], args[2], Infinity) : makeFalseColourView(...args);
    readings.push(result.sentence);
    return result;
}

function frame(lambda: number, start = 60000, end = start + 0.001, skyLevel = 0): RegriddedFrame
{
    const data = new Float32Array(grid.width * grid.height);
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            data[y * grid.width + x] = skyLevel + ((x * 13 + y * 7) % 11 - 5);
        }
    }
    return { frame: { detector: 1, tMin: start, tMax: end } as RegriddedFrame['frame'], grid, data, lambdaAtCenter: lambda, bandwidthAtCenter: 0.01 };
}

function sky(frames: RegriddedFrame[]): SkyResult
{
    return { source: 'live', grid, frames: frames.map(item => ({ frame: item, label: '' })), locked: [], lambda: frames[0]!.lambdaAtCenter, stars: [], credits: [], notes: [] };
}

function at(mjd: number): [number, number]
{
    return [mjd, mjd + 0.001];
}

function sourceFrame(lambda: number, x = 15, level = 100, offset = 0): RegriddedFrame
{
    const f = frame(lambda, 60000, 60000.001, offset);
    f.data[15 * 31 + x] = offset + level;
    return f;
}

function measuredFrame(lambda: number, targetSnr: number, seed: number, scale = 1): RegriddedFrame
{
    const f = frame(lambda);
    let state = seed;
    for (let i = 0; i < f.data.length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        f.data[i] = scale * (state / 0x100000000 - 0.5);
    }
    const ap = aperture(f.data, 31, 31, { x: 15, y: 15 }, { ...radii, noiseScale: resampleNoiseScale(grid.pixelArcsec) });
    f.data[15 * 31 + 15] = f.data[15 * 31 + 15]! + targetSnr * ap.noise - ap.sum;
    return f;
}

function lookFrames(values: number[], days: number[], lambda = 4.6): RegriddedFrame[]
{
    return values.map((value, i) => {
        const f = measuredFrame(lambda, value, 700 + i * 104729);
        const ap = aperture(f.data, 31, 31, { x: 15, y: 15 }, { ...radii, noiseScale: resampleNoiseScale(grid.pixelArcsec) });
        f.data = Float32Array.from(f.data, x => x / ap.noise);
        f.frame = { ...f.frame, tMin: 60000 + days[i]!, tMax: 60000 + days[i]! + 0.001 };
        return f;
    });
}

function simulation(seed: number)
{
    let state = seed >>> 0;
    const uniform = () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return ((state >>>= 0) + 1) / 4294967297;
    };
    const gaussian = () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
    const make = (lambda: number, n: number, perFrame: number, hit = 0, days?: number[], scatter = 0): RegriddedFrame[] => Array.from({ length: n }, (_, i) => {
        const f = frame(lambda, 60000 + (days?.[i] ?? i * 30));
        for (let j = 0; j < f.data.length; j++) { f.data[j] = gaussian(); }
        // Nominal aperture noise, including the same resampling factor as the reading.
        const nominalNoise = Math.sqrt(13 * (1 + Math.PI / 2 * 13 / 100)) * resampleNoiseScale(grid.pixelArcsec);
        f.data[15 * 31 + 15] = f.data[15 * 31 + 15]! + (perFrame * (1 + (scatter ? scatter * gaussian() : 0)) + (i === 0 ? hit : 0)) * nominalNoise;
        return f;
    });
    return { make };
}

function runCell(n: number, source: number, hit: number, draws: number, seed: number)
{
    const random = simulation(seed);
    let seen = 0;
    for (let i = 0; i < draws; i++) {
        const reading = falseColourView(sky(random.make(1.25, n, source)), sky(random.make(4.6, n, source, hit)), radii).parts.reading;
        if (reading.includes('seen at 4.60 µm') || reading.includes('seen at both wavelengths')) { seen++; }
    }
    return { seen, draws };
}

describe('seeded reading simulations', () => {
    it('checks noise, a strong steady source, and a one-frame hit over 100 draws each', () => {
        const noise = runCell(2, 0, 0, 100, 301);
        const steady = runCell(4, 10, 0, 100, 302);
        const hit = runCell(2, 3, 12, 100, 303);
        expect(noise.seen).toBe(0);
        expect(steady.seen).toBe(100);
        expect(hit.seen).toBe(0);
    });

    it.skipIf(process.env.FC_STUDY !== '1')('runs the extended fixed-seed study', () => {
        const steady: Record<string, unknown> = {};
        const hits: Record<string, unknown> = {};
        const noise: Record<string, unknown> = {};
        const scatter: Record<string, unknown> = {};
        for (const n of [2, 4, 12]) {
            const random = simulation(1000 + n);
            const cells = Array.from({ length: 5 }, () => ({ seen: 0, draws: 0 }));
            const targets = [3.25, 3.75, 4.5, 6.5, 10];
            for (let draw = 0; cells.some(cell => cell.draws < 400); draw++) {
                if (draw > 100000) { throw new Error('Study could not fill the SNR bins'); }
                const target = targets[draw % targets.length]! / Math.sqrt(n);
                const a = random.make(1.25, n, target);
                const b = random.make(4.6, n, target);
                const data = stackVisit(b).data;
                const snr = aperture(data, 31, 31, { x: 15, y: 15 }, { ...radii, noiseScale: resampleNoiseScale(grid.pixelArcsec) }).snr;
                const bin = snr < 3 ? -1 : snr < 3.5 ? 0 : snr < 4 ? 1 : snr < 5 ? 2 : snr < 8 ? 3 : 4;
                if (bin < 0 || cells[bin]!.draws >= 400) { continue; }
                const reading = falseColourView(sky(a), sky(b), radii).parts.reading;
                const cell = cells[bin]!;
                cell.draws++;
                if (reading.includes('seen at 4.60 µm') || reading.includes('seen at both wavelengths')) { cell.seen++; }
            }
            steady[n] = cells;
            noise[n] = runCell(n, 0, 0, 400, 2000 + n);
            for (const source of [0, 3, 10]) {
                for (const hit of [12, 30, 100]) {
                    hits[`${n}/${source}/${hit}`] = runCell(n, source, hit, 400, 3000 + n * 1000 + source * 100 + hit);
                }
            }
        }
        for (const source of [10, 50]) {
            const random = simulation(5100 + source);
            let lost = 0;
            for (let i = 0; i < 400; i++) {
                const reading = falseColourView(sky(random.make(1.25, 12, source, 0, undefined, 0.03)), sky(random.make(4.6, 12, source, 0, undefined, 0.03)), radii).parts.reading;
                if (!reading.includes('seen at 4.60 µm') && !reading.includes('seen at both wavelengths')) { lost++; }
            }
            scatter[source] = { lost, draws: 400 };
        }
        for (const source of [0, 3, 10]) {
            for (const hit of [12, 30, 100]) {
                const random = simulation(8000 + source * 100 + hit);
                const cell = { seen: 0, draws: 400 };
                const days = [0, 2, 4, 200];
                for (let i = 0; i < cell.draws; i++) {
                    const reading = falseColourView(sky(random.make(1.25, 4, source, 0, days)), sky(random.make(4.6, 4, source, hit, days)), radii).parts.reading;
                    if (reading.includes('seen at 4.60 µm') || reading.includes('seen at both wavelengths')) { cell.seen++; }
                }
                hits[`visit/${source}/${hit}`] = cell;
            }
        }
        console.log('FC_STUDY', JSON.stringify({ steady, hits, noise, scatter }));
    }, 300000);

    it.skipIf(process.env.FC_STUDY !== '1')('times a 721-square picture', () => {
        const large = { ...grid, width: 721, height: 721 };
        const make = (lambda: number) => Array.from({ length: 4 }, (_, i) => {
            const f = frame(lambda, 60000 + i * 30);
            const data = Float32Array.from({ length: 721 * 721 }, (_, p) => (p * 13 + Math.floor(p / 721) * 7 + i) % 17);
            data[360 * 721 + 360] = 1000;
            return { ...f, grid: large, data };
        });
        const a = { ...sky(make(1.25)), grid: large };
        const b = { ...sky(make(4.6)), grid: large };
        const start = performance.now();
        const result = falseColourView(a, b, radii);
        console.log('FC_BENCH_MS', Math.round(performance.now() - start));
        expect(result.rgba.length).toBe(721 * 721 * 4);
    }, 30000);

    it.skipIf(process.env.FC_STUDY !== '1')('prints representative readings', () => {
        const reference = sky([sourceFrame(1.25, 15, 1000), sourceFrame(1.25, 15, 1000)]);
        const paired = falseColourView(reference, sky(lookFrames([1.12, 1.29, 1177.54, 1689.28], [0, 190, 360, 366])), radii);
        const hit = [sourceFrame(4.6, 15, 1000), sourceFrame(4.6, 15, 1000)];
        hit[0]!.data[15 * 31 + 17] = 5000;
        const g = { ...grid, pixelArcsec: 5 };
        const makeSky = (frames: RegriddedFrame[]) => ({ ...sky(frames.map(f => ({ ...f, grid: g }))), grid: g });
        const hit3 = [sourceFrame(4.6, 15, 1000), sourceFrame(4.6, 15, 1000)];
        hit3[0]!.data[15 * 31 + 17] = 3000;
        const brightShort = [sourceFrame(1.25, 15, 2000), sourceFrame(1.25, 15, 2000)];
        const g2 = { ...grid, pixelArcsec: 5.5 };
        const makeSky2 = (frames: RegriddedFrame[]) => ({ ...sky(frames.map(f => ({ ...f, grid: g2 }))), grid: g2 });
        const factor = resampleNoiseScale(g2.pixelArcsec) / resampleNoiseScale(grid.pixelArcsec);
        const hit100 = lookFrames([10 * factor, 10 * factor], [0, 30]);
        hit100[0]!.data[15 * 31 + 17] = hit100[0]!.data[15 * 31 + 17]! + 100 * factor;
        const moved = [sourceFrame(4.6, 13, 1000), sourceFrame(4.6, 17, 1000)];
        const steady = lookFrames([4, 4, 4, 4], [0, 3, 200, 203]);
        console.log('FC_READINGS', JSON.stringify({
            grouped: paired.parts.reading,
            hit: falseColourView(reference, sky(hit), radii).parts.reading,
            hit3: falseColourView(makeSky(brightShort), makeSky(hit3), radii).parts.reading,
            hit100: falseColourView(makeSky2(lookFrames([59 * factor, 59 * factor], [0, 30], 1.25)), makeSky2(hit100), radii).parts.reading,
            weak: falseColourView(reference, sky(lookFrames([30, 2.2], [0, 30])), radii).parts.reading,
            moved: falseColourView(makeSky([sourceFrame(1.25, 15, 1000), sourceFrame(1.25, 15, 1000)]), makeSky(moved), radii).parts.reading,
            steady: falseColourView(sky(lookFrames([4, 4, 4, 4], [0, 3, 200, 203], 1.25)), sky(steady), radii).parts.reading,
        }));
    });

    it.skipIf(process.env.FC_REPORT !== '1')('prints round 8b readings', () => {
        const read = (shortValues: number[], longValues: number[], days: number[]) => falseColourView(sky(lookFrames(shortValues, days, 1.25)), sky(lookFrames(longValues, days)), radii).parts.reading;
        const g = { ...grid, pixelArcsec: 4 };
        const short = lookFrames([30, 30, 30], [0, 1, 200], 1.25).map(f => ({ ...f, grid: g }));
        const long = [sourceFrame(4.6, 14, 1000), sourceFrame(4.6, 14, 1000), sourceFrame(4.6, 16, 1800)].map((f, i) => ({ ...f, grid: g, frame: { ...f.frame, tMin: 60000 + [0, 1, 200][i]!, tMax: 60000.001 + [0, 1, 200][i]! } }));
        const noisy = lookFrames([2, 25], [0, 200]);
        noisy[0]!.data = Float32Array.from(noisy[0]!.data, value => value * 15);
        const d4 = [0, 200, 400, 600];
        console.log('FC_REPORT', JSON.stringify({
            t1a: read([100, 98], [100, 98], [0, 6]),
            t1b: read([100, 99, 98], [100, 99, 98], [0, 6, 12]),
            t1b2: read([99, 100, 98], [99, 100, 98], [0, 6, 12]),
            t1c: read([10, 10, 10, 10], [22, 10, 10, 10.5], [0, 2, 4, 200]),
            t1d: read([50, 50, 50], [50, 0, 49], [0, 1, 200]),
            t1e: falseColourView(sky(lookFrames([30, 30], [0, 200], 1.25)), sky(noisy), radii).parts.reading,
            t1f: read([100, 100, 100, 100], [100.1, 100, 100, 70], d4),
            t1g: read([100, 98], [100, 98], [0, NaN]),
            t1h: falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii).parts.reading,
            t2: read([10, 10, 10, 10], [1.12, 1.29, 1177.54, 1689.28], [0, 190, 360, 366]),
            t7: read([10, 10, 10, 10], [1.12, 1.29, 1177.54, 1689.28], [0, 160, 360, 560]),
            t3: read([3.3, 3.3, 3.3, 3.3], [3.3, 3.3, 3.3, 3.3], [0, 3, 200, 203]),
            t4steady: read([100, 100, 100, 100], [100, 101, 102, 103], d4),
            t4hit: read([100, 100, 100, 100], [100, 100, 100, 160], d4),
            t4dip: read([100, 100, 100, 100], [100, 100, 100, 70], d4),
        }));
    });
});

describe('round 9 reading', () => {
    it('identifies the carrying visit that actually fails its threshold', () => {
        const days = [0, 1, 200, 201, 400];
        const values = [1.4, 23.4, 3.3, 24.8, 25.6];
        const scales = [25.118864315095795, 0.12589254117941673, 0.15848931924611134, 31.622776601683793, 1.2589254117941673];
        const frames = lookFrames(values, days).map((f, i) => ({ ...f, data: Float32Array.from(f.data, v => v * scales[i]!) }));
        const reading = falseColourView(sky(lookFrames([20, 20, 20, 20, 20], days, 1.25)), sky(frames), radii).parts.reading;
        expect(reading).toContain('does not hold up without the 2 frames of its strongest visit');
    });
    it('keeps the earliest frame when carrying scores tie', () => {
        const days = [0, 1, 200];
        const frames = lookFrames([4, 0, 4], days);
        frames[2]!.data = frames[0]!.data.slice();
        const reading = falseColourView(sky(lookFrames([20, 20, 20], days, 1.25)), sky(frames), radii).parts.reading;
        expect(reading).toContain('4.60 µm shows light that differs between frames');
        expect(reading).toContain('strong in 2 of 3 frames');
    });
    it('uses the number of frames for the agreement threshold', () => {
        const days = [0, 1, 200, 201];
        const reading = falseColourView(sky(lookFrames([10, 10, 10, 10], days, 1.25)), sky(lookFrames([10, 10, 13.7, 13.7], days)), radii).parts.reading;
        expect(reading).toContain('seen at both wavelengths');
        expect(reading).not.toContain('differs between frames');
    });
    it.skipIf(process.env.FC_R9_REPORT !== '1')('prints requested readings', () => {
        const read = (shortValues: number[], shortDays: number[], longValues: number[], longDays: number[]) => falseColourView(sky(lookFrames(shortValues, shortDays, 1.25)), sky(lookFrames(longValues, longDays)), radii).parts.reading;
        console.log('R9_REPORT', JSON.stringify({
            steady: read([4, 4, 4, 4], [0, 3, 200, 203], [4, 4, 4, 4], [0, 3, 200, 203]),
            single: read([30, 30, 30, 30], [0, 1, 200, 201], [30], [0]),
            disagreement: read([10, 10, 10, 10], [0, 160, 360, 560], [1.12, 1.29, 1177.54, 1689.28], [0, 160, 360, 560]),
            carrying: read(Array(12).fill(4), [...Array.from({ length: 11 }, (_, i) => i), 200], [...Array(11).fill(4), 1], [...Array.from({ length: 11 }, (_, i) => i), 200]),
            visit: read([30, 30], [0, 1], [30, 30], [0, 1]),
            neither: read([0, 0], [0, 200], [0, 0], [0, 200]),
            requested: read([30, 30, 30, 30], [0, 1, 2, 200], [33, 33, 33, 3], [0, 1, 2, 200]),
            mutant3: read([10, 10, 10, 10], [0, 1, 200, 201], [10, 10, 13.7, 13.7], [0, 1, 200, 201]),
        }));
    });
    it('does not print an index for representative inputs', () => {
        const cases = [[4, 4, 4, 4], [1.12, 1.29, 1177.54, 1689.28], [0, 0, 0, 0]];
        for (const values of cases) {
            const days = [0, 1, 200, 201];
            expect(falseColourView(sky(lookFrames([4, 4, 4, 4], days, 1.25)), sky(lookFrames(values, days)), radii).sentence).not.toMatch(/index/i);
        }
        expect(colourSentence(1.25, 4.6, both)).not.toMatch(/index/i);
    });

    it('describes disagreement without counting the band as seen', () => {
        const days = [0, 160, 360, 560];
        const reading = falseColourView(sky(lookFrames([10, 10, 10, 10], days, 1.25)), sky(lookFrames([1.12, 1.29, 1177.54, 1689.28], days)), radii).parts.reading;
        expect(reading).toContain('4.60 µm shows light that differs between frames by more than a steady source would give (strong in 2 of 4 frames); it may have changed or moved, or be a detector effect');
        expect(reading).not.toContain('seen at 4.60 µm');
    });

    it('warns when the strongest visit carries a steady signal', () => {
        const days = [...Array.from({ length: 11 }, (_, i) => i), 200];
        const values = [...Array(11).fill(4), 1];
        const reading = falseColourView(sky(lookFrames(Array(12).fill(4), days, 1.25)), sky(lookFrames(values, days)), radii).parts.reading;
        expect(reading).toContain('but without its strongest visit the rest is below 3 times the noise, so the other visits do not give a clear signal');
        expect(reading).not.toContain('too weak');
    });

    it('distinguishes two visits, one visit, and missing dates', () => {
        const read = (days: number[]) => falseColourView(sky(lookFrames(days.map(() => 30), days, 1.25)), sky(lookFrames(days.map(() => 30), days)), radii).parts.reading;
        expect(read([0, 200])).toContain('only 2 frames, so a moving source or two detector hits cannot be ruled out');
        expect(read([0, 1])).toContain('both frames come from one visit');
        expect(read([0, 1, 2])).toContain('all 3 frames come from one visit');
        expect(read([0, NaN])).toContain('not all of its 2 frames have usable dates');
    });

    it('only describes position comparisons when a multi-frame band is seen', () => {
        const days = [0, 200];
        const method = falseColourView(sky(lookFrames([0, 0], days, 1.25)), sky(lookFrames([0, 0], days)), radii).parts.method;
        expect(method).toContain('Frames taken less than 10 days apart count as one visit.');
        expect(method).not.toContain('Position is compared');
    });

    it('gives the single-frame caveat at thirty sigma', () => {
        const reading = falseColourView(sky(lookFrames([30, 30, 30, 30], [0, 1, 200, 201], 1.25)), sky(lookFrames([30], [0])), radii).parts.reading;
        expect(reading).toContain('seen at 4.60 µm (signal-to-noise 30, one frame only, so a detector hit cannot be ruled out)');
    });

    it('does not call a steady eight-sigma stack unconfirmed', () => {
        const days = [0, 3, 200, 203];
        const reading = falseColourView(sky(lookFrames([3.3, 3.3, 3.3, 3.3], days, 1.25)), sky(lookFrames([3.3, 3.3, 3.3, 3.3], days)), radii).parts.reading;
        expect(reading).toContain('seen at both wavelengths');
        expect(reading).not.toContain('the other visits do not give a clear signal');
    });

    it('does not blame chance noise for three strong displaced signals removed by stacking', () => {
        const frames = lookFrames([12, 12, 12], [0, 200, 400]);
        for (let i = 0; i < frames.length; i++) {
            const f = frames[i]!;
            const centre = 15 * 31 + 15;
            const target = 15 * 31 + 14 + i;
            if (target !== centre) {
                const value = f.data[centre]!;
                f.data[centre] = f.data[target]!;
                f.data[target] = value;
            }
        }
        const reading = falseColourView(sky(lookFrames([12, 12, 12], [0, 200, 400], 1.25)), sky(frames), radii).parts.reading;
        expect(reading).toContain('4.60 µm shows a signal in 3 of 3 frames but not in the combined picture');
        expect(reading).not.toContain('chance noise alone');
    });

    it('handles Gaia stars at the boundary and places a star with an unusable saved pixel from its sky position', () => {
        const first = sourceFrame(1.25);
        const later = sourceFrame(4.6);
        later.frame = { ...later.frame, tMin: 60200, tMax: 60200.001 };
        const a = sky([first]);
        const b = sky([later]);
        const coord = gridPixToSky(grid, { x: 15, y: 17 });
        const star = { sourceId: 'edge', ...coord, g: 15, epochJyear: 2000 + (60000.0005 - 51544.5) / 365.25, pmRa: 0, pmDec: -547.875, pix: { x: 15, y: 17 } };
        a.stars = [star];
        expect(falseColourView(a, b, radii).parts.method).toContain('passes through that circle, between 12.3″ and 12.6″');
        a.stars = [{ ...star, pmDec: -36.525 }];
        expect(falseColourView(a, b, radii).parts.method).toContain('about 12.3″ from the centre, on the edge of that circle');
        a.stars = [{ ...star, pix: { x: NaN, y: NaN } }];
        const method = falseColourView(a, b, radii).parts.method;
        expect(method).toContain('passes through that circle, between 12.3″ and 12.6″');
        expect(method).not.toContain('none of the Gaia stars');
        expect(method).not.toContain('NaN');
    });
});

describe('reliable colour readings', () => {
    it('does not count chained dates as separate visits and withholds their index', () => {
        for (const values of [[100, 99, 98], [99, 100, 98]]) {
            const days = [0, 6, 12];
            const reading = falseColourView(sky(lookFrames(values, days, 1.25)), sky(lookFrames(values, days)), radii).parts.reading;
            expect(reading).toContain('its 3 frames span 12 days with no gap of 10 days or more between them, so they are not counted as separate visits');
            expect(reading).not.toContain('second date');
            expect(reading).not.toMatch(/colour index [−+\d]|within 10 days of each other/);
        }
    });

    it('checks individual frames in visits and checks dips as well as peaks', () => {
        const days = [0, 2, 4, 200];
        const read = (values: number[]) => falseColourView(sky(lookFrames([10, 10, 10, 10], days, 1.25)), sky(lookFrames(values, days)), radii).parts.reading;
        for (const values of [[22, 10, 10, 10.5], [10, 10, 10, 4]]) {
            expect(read(values)).toContain('differs between frames by more than a steady source would give');
            expect(read(values)).toContain('4.60 µm shows light that differs between frames by more than a steady source would give');
            expect(read(values)).not.toMatch(/index/i);
        }
    });

    it('uses conservative wording for missing dates', () => {
        const reading = falseColourView(sky(lookFrames([100, 98], [0, NaN], 1.25)), sky(lookFrames([100, 98], [0, NaN])), radii).parts.reading;
        expect(reading).toContain('not all of its 2 frames have usable dates');
        expect(reading).toContain('so something passing through or a detector effect cannot be ruled out');
        expect(reading).not.toContain('10 days');
    });

    it('withholds an index for two strong frames from one visit', () => {
        const days = [0, 6];
        const reading = falseColourView(sky(lookFrames([100, 98], days, 1.25)), sky(lookFrames([100, 98], days)), radii).parts.reading;
        expect(reading).toContain('both frames come from one visit');
        expect(reading).toContain('so something passing through or a detector effect cannot be ruled out');
        expect(reading).not.toMatch(/index/i);
    });

    it('reports a dip when the remaining visit still supports the source', () => {
        const days = [0, 1, 200];
        const reading = falseColourView(sky(lookFrames([50, 50, 50], days, 1.25)), sky(lookFrames([50, 0, 49], days)), radii).parts.reading;
        expect(reading).not.toContain('seen at 4.60 µm');
        expect(reading).toContain('differs between frames');
        expect(reading).not.toMatch(/index/i);
    });

    it('checks the highest signal-to-noise frame as well as the largest sum', () => {
        const frames = lookFrames([2, 25], [0, 200]);
        frames[0]!.data = Float32Array.from(frames[0]!.data, value => value * 15);
        const reading = falseColourView(sky(lookFrames([30, 30], [0, 200], 1.25)), sky(frames), radii).parts.reading;
        expect(reading).toContain('4.60 µm shows a signal that falls below the limit');
        expect(reading).not.toMatch(/index/i);
    });

    it('reports a thirty-percent dip even with three steady frames', () => {
        const days = [0, 200, 400, 600];
        const reading = falseColourView(sky(lookFrames([100, 100, 100, 100], days, 1.25)), sky(lookFrames([100.1, 100, 100, 70], days)), radii).parts.reading;
        expect(reading).not.toContain('seen at 4.60 µm');
        expect(reading).toContain('differs between frames');
        expect(reading).not.toMatch(/index/i);
    });

    it('keeps a steady bright source and flags both a rise and a dip in four visits', () => {
        const days = [0, 200, 400, 600];
        const short = sky(lookFrames([100, 100, 100, 100], days, 1.25));
        const read = (values: number[]) => falseColourView(short, sky(lookFrames(values, days)), radii).parts.reading;
        expect(read([100, 101, 102, 103])).toMatch(/seen at (?:both wavelengths|1\.25 µm)/);
        for (const values of [[100, 100, 100, 160], [100, 100, 100, 70]]) {
            expect(read(values)).toContain('differs between frames');
            expect(read(values)).not.toMatch(/index/i);
        }
    });

    it('keeps a faint steady source in two visits after median stacking', () => {
        const values = [3.3, 3.3, 3.3, 3.3];
        const days = [0, 3, 200, 203];
        const reading = falseColourView(sky(lookFrames(values, days, 1.25)), sky(lookFrames(values, days)), radii).parts.reading;
        expect(reading).toMatch(/seen at (?:both wavelengths|1\.25 µm)/);
        expect(reading).not.toContain('readings differ');
        expect(reading).not.toContain('one visit');
        expect(Number(reading.match(/signal-to-noise ([\d.]+)/)![1])).toBeGreaterThan(6);
        expect(Number(reading.match(/signal-to-noise ([\d.]+)/)![1])).toBeLessThan(9);
    });

    it('allows the stated slowly rising agreement limit and uses the higher mean in its floor', () => {
        const days = Array.from({ length: 12 }, (_, i) => i * 30);
        const baseline = Array(12).fill(10);
        const mild = [...baseline];
        mild[0] = 13.9;
        const many = falseColourView(sky(lookFrames(baseline, days, 1.25)), sky(lookFrames(mild, days)), radii).parts.reading;
        expect(many).toMatch(/seen at (?:both wavelengths|1\.25 µm)/);
        const two = falseColourView(sky(lookFrames([100, 100], [0, 200], 1.25)), sky(lookFrames([100, 118], [0, 200])), radii).parts.reading;
        expect(two).toMatch(/seen at (?:both wavelengths|1\.25 µm)/);
    });

    it('uses the rounded off-centre limit', () => {
        const g = { ...grid, pixelArcsec: 6.152 };
        const make = (lambda: number, x: number) => ({ ...sourceFrame(lambda, x, 1000), grid: g });
        const result = falseColourView({ ...sky([make(1.25, 16)]), grid: g }, { ...sky([make(4.6, 15)]), grid: g }, radii);
        expect(result.parts.reading).not.toContain('brightest 6.15″ from the centre');
        expect(result.parts.reading).toMatch(/seen at (?:both wavelengths|1\.25 µm)/);
        const later = make(4.6, 16);
        later.frame = { ...later.frame, tMin: 60200, tMax: 60200.001 };
        const centred = make(4.6, 15);
        const reference = [make(1.25, 15), { ...make(1.25, 15), frame: later.frame }];
        const moved = falseColourView({ ...sky(reference), grid: g }, { ...sky([centred, later]), grid: g }, radii).parts.reading;
        expect(moved).not.toContain('different places in different frames');
    });

    it('joins displacement and disagreement in one explanation', () => {
        const g = { ...grid, pixelArcsec: 4 };
        const short = lookFrames([30, 30, 30], [0, 1, 200], 1.25).map(f => ({ ...f, grid: g }));
        const long = [sourceFrame(4.6, 14, 1000), sourceFrame(4.6, 14, 1000), sourceFrame(4.6, 16, 1800)].map((f, i) => ({ ...f, grid: g, frame: { ...f.frame, tMin: 60000 + [0, 1, 200][i]!, tMax: 60000.001 + [0, 1, 200][i]! } }));
        const reading = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii).parts.reading;
        expect(reading).not.toContain('seen at 4.60 µm');
        expect(reading).toContain('its brightest point sits in different places in different frames');
        expect(reading).toContain('4.60 µm shows light that differs between frames');
    });

    it('compares positions in three strong frames but ignores weak peaks', () => {
        const g = { ...grid, pixelArcsec: 4 };
        const make = (lambda: number, xs: number[], level: number) => xs.map((x, i) => {
            const f = sourceFrame(lambda, x, level);
            return { ...f, grid: g, frame: { ...f.frame, tMin: 60000 + [0, 1, 200][i]!, tMax: 60000.001 + [0, 1, 200][i]! } };
        });
        const short = make(1.25, [15, 15, 15], 1000);
        const long = make(4.6, [14, 14, 16], 1000);
        const reading = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii).parts.reading;
        expect(reading).toContain('its brightest point sits in different places in different frames');
        expect(reading).not.toMatch(/index/i);
        const weak = lookFrames([5, 5], [0, 200]);
        for (let i = 0; i < 2; i++) {
            weak[i]!.data[15 * 31 + (i ? 16 : 14)] = weak[i]!.data[15 * 31 + 15]!;
            weak[i]!.data[15 * 31 + 15] = 0;
        }
        const weakReading = falseColourView(sky(lookFrames([5, 5], [0, 200], 1.25)), sky(weak), radii).parts.reading;
        expect(weakReading).not.toContain('different places');
        // The two-frame combination can remove disjoint weak peaks before placement.
        expect(weakReading).toContain('4.60 µm shows a signal in 2 of 2 frames but not in the combined picture');
    });
    it('groups the strongest frames by look before counting a signal', () => {
        const values = [1.12, 1.29, 1177.54, 1689.28];
        const frames = lookFrames(values, [0, 190, 360, 366]);
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky(frames), radii);
        expect(result.parts.reading).toContain('without the 2 frames of its strongest visit');
        expect(result.parts.reading).not.toMatch(/index/i);
    });

    it('withholds the index when a bright frame disagrees with a steady source', () => {
        const frames = [sourceFrame(4.6, 15, 1000), sourceFrame(4.6, 15, 1000)];
        frames[0]!.data[15 * 31 + 17] = 5000;
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky(frames), radii);
        expect(result.parts.reading).toContain('4.60 µm shows light that differs between frames');
        expect(result.parts.reading).not.toMatch(/index/i);
    });

    it('explains a brightness disagreement even if the other band is faint', () => {
        const frames = [sourceFrame(4.6, 15, 1000), sourceFrame(4.6, 15, 1000)];
        frames[0]!.data[15 * 31 + 17] = 5000;
        const reading = falseColourView(sky([frame(1.25)]), sky(frames), radii).parts.reading;
        expect(reading).toContain('4.60 µm shows light that differs between frames');
    });

    it('warns when all frames are from one look', () => {
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([sourceFrame(4.6), sourceFrame(4.6)]), radii);
        expect(result.parts.reading).toContain('both frames come from one visit');
    });

    it('lists stars from both catalogues without double counting ids', () => {
        const a = sky([sourceFrame(1.25)]);
        const b = sky([sourceFrame(4.6)]);
        const star = (sourceId: string, x: number) => ({ sourceId, ...gridPixToSky(grid, { x, y: 15 }), g: 15, epochJyear: 2016, pix: { x, y: 15 } });
        a.stars = [star('one', 15)];
        b.stars = [star('one', 25), star('two', 16)];
        expect(falseColourView(a, b, radii).parts.method).toContain('2 of the Gaia stars');
    });

    it('reports differing readings when separate visits still support the source', () => {
        const reference = sky([sourceFrame(1.25, 15, 1000), sourceFrame(1.25, 15, 1000)]);
        const weak = falseColourView(reference, sky(lookFrames([1.12, 1.29, 1177.54, 1689.28], [0, 160, 360, 560])), radii).parts.reading;
        expect(weak).not.toContain('seen at 4.60 µm');
        expect(weak).toContain('differs between frames');
        expect(weak).not.toMatch(/index/i);
        const supported = falseColourView(reference, sky(lookFrames([5, 5, 1177, 1689], [0, 160, 360, 560])), radii).parts.reading;
        expect(supported).not.toContain('seen at 4.60 µm');
        expect(supported).toContain('differs between frames by more than a steady source would give');
        expect(supported).not.toMatch(/index/i);
    });

    it('keeps steady independent looks and applies the five percent floor', () => {
        const reference = sky(lookFrames([10, 10, 10, 10], [0, 3, 200, 203], 1.25));
        const steady = falseColourView(reference, sky(lookFrames([1000, 1010, 1020, 1030], [0, 3, 200, 203])), radii).parts.reading;
        expect(steady).toMatch(/seen at (?:both wavelengths|1\.25 µm)/);
        expect(steady).not.toContain('readings differ');
        expect(steady).not.toContain('all 4 frames');
        const variable = falseColourView(reference, sky(lookFrames([100, 100, 100, 160], [0, 3, 200, 203])), radii).parts.reading;
        expect(variable).not.toContain('seen at 4.60 µm');
        expect(variable).toContain('differs between frames');
        expect(variable).not.toMatch(/index/i);
        const faint = falseColourView(sky(lookFrames([4, 4, 4, 4], [0, 3, 200, 203], 1.25)), sky(lookFrames([4, 4, 4, 4], [0, 3, 200, 203])), radii).parts.reading;
        expect(faint).toMatch(/seen at (?:both wavelengths|1\.25 µm)/);
        expect(faint).not.toContain('all 4 frames');
    });

    it('uses a strict ten-day boundary and excludes a non-finite time', () => {
        const reference = sky([sourceFrame(1.25, 15, 1000), sourceFrame(1.25, 15, 1000)]);
        const read = (days: number[]) => falseColourView(reference, sky(lookFrames([1, 1, 100, 110], days)), radii).parts.reading;
        expect(read([0, 100, 200, 209.99])).toContain('without the 2 frames of its strongest visit');
        expect(read([0, 100, 200, 210])).toContain('differs between frames');
        expect(read([0, 100, NaN, 210])).toContain('not all of its 4 frames have usable dates');
    });

    it('rejects a thirty-sigma frame paired with a 2.2-sigma frame', () => {
        const reading = falseColourView(sky([sourceFrame(1.25, 15, 1000)]), sky(lookFrames([30, 2.2], [0, 30])), radii).parts.reading;
        expect(reading).toContain('4.60 µm shows a signal that does not hold up without its strongest frame');
        expect(reading).not.toMatch(/index/i);
    });

    it('checks all three frames even when the stack is clear', () => {
        const reading = falseColourView(sky([sourceFrame(1.25)]), sky(lookFrames([3, 1.8, 1.2], [0, 30, 60])), radii).parts.reading;
        expect(reading).toContain('no clear signal at 4.60 µm');
        expect(reading).not.toMatch(/index/i);
    });

    it('rejects a one-frame source even when both frames are one look', () => {
        const reading = falseColourView(sky([sourceFrame(1.25)]), sky(lookFrames([30, 0], [0, 3])), radii).parts.reading;
        expect(reading).toContain('no clear signal at 4.60 µm');
        expect(reading).not.toContain('seen at 4.60 µm');
    });

    it('does not count 2 frames whose equal sources sit 20″ apart as seen', () => {
        const g = { ...grid, pixelArcsec: 5 };
        const short = [sourceFrame(1.25, 15, 1000), sourceFrame(1.25, 15, 1000)].map(f => ({ ...f, grid: g }));
        const long = [sourceFrame(4.6, 13, 1000), sourceFrame(4.6, 17, 1000)].map(f => ({ ...f, grid: g }));
        const reading = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii).parts.reading;
        expect(reading).toContain('4.60 µm shows a signal in 2 of 2 frames but not in the combined picture');
        expect(reading).not.toContain('seen at 4.60 µm');
        expect(reading).not.toMatch(/index/i);
    });

    it.each([[1000, 500], [100, 3000]] as const)('withholds an index for an offset hit of %i with source %i', (source, hit) => {
        const g = { ...grid, pixelArcsec: 5 };
        const short = [sourceFrame(1.25, 15, source), sourceFrame(1.25, 15, source)].map(f => ({ ...f, grid: g }));
        const long = [sourceFrame(4.6, 15, source), sourceFrame(4.6, 15, source)].map(f => ({ ...f, grid: g }));
        long[0]!.data[15 * 31 + 17] = hit;
        const reading = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii).parts.reading;
        expect(reading).not.toMatch(/index/i);
    });

    it('withholds the biased index for a three-times-brighter hit ten arcseconds away', () => {
        const g = { ...grid, pixelArcsec: 5 };
        const a = [sourceFrame(1.25, 15, 2000), sourceFrame(1.25, 15, 2000)].map(f => ({ ...f, grid: g }));
        const b = [sourceFrame(4.6, 15, 1000), sourceFrame(4.6, 15, 1000)].map(f => ({ ...f, grid: g }));
        b[0]!.data[15 * 31 + 17] = 3000;
        const reading = falseColourView({ ...sky(a), grid: g }, { ...sky(b), grid: g }, radii).parts.reading;
        expect(reading).toContain('4.60 µm shows light that differs between frames');
        expect(reading).not.toMatch(/index/i);
    });

    it('withholds the biased index for a hundred-sigma hit beside a ten-sigma source', () => {
        const g = { ...grid, pixelArcsec: 5.5 };
        const factor = resampleNoiseScale(g.pixelArcsec) / resampleNoiseScale(grid.pixelArcsec);
        for (let draw = 0; draw < 40; draw++) {
            const make = (lambda: number, snr: number) => [0, 1].map(i => {
                const f = measuredFrame(lambda, snr * factor, 4000 + draw * 101 + i * 104729);
                f.frame = { ...f.frame, tMin: 60000 + i * 30, tMax: 60000 + i * 30 + 0.001 };
                return { ...f, grid: g };
            });
            const a = make(1.25, 59);
            const b = make(4.6, 10);
            const noise = aperture(b[0]!.data, 31, 31, { x: 15, y: 15 }, { ...radii, noiseScale: resampleNoiseScale(g.pixelArcsec) }).noise;
            b[0]!.data[15 * 31 + 17] = b[0]!.data[15 * 31 + 17]! + 100 * noise;
            const reading = falseColourView({ ...sky(a), grid: g }, { ...sky(b), grid: g }, radii).parts.reading;
            expect(reading).not.toMatch(/index/i);
            expect(reading).toContain('4.60 µm shows light that differs between frames');
        }
    });

    it('does not count 2 frames with a hit beside a centred source as seen, each frame with its own sky', () => {
        const g = { ...grid, pixelArcsec: 5 };
        const long = [sourceFrame(4.6, 15, 1000, 0), sourceFrame(4.6, 15, 1000, 10000)].map(f => ({ ...f, grid: g }));
        long[0]!.data[15 * 31 + 17] = 3000;
        long[0]!.data[15 * 31 + 14] = -3000;
        long[1]!.data[15 * 31 + 17] = 10000;
        long[1]!.data[15 * 31 + 14] = 10000;
        const short = [sourceFrame(1.25, 15, 1000), sourceFrame(1.25, 15, 1000)].map(f => ({ ...f, grid: g }));
        const reading = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii).parts.reading;
        // One frame is brightest at the hit, 10″ out, and the other at the centre: with 2 frames nothing says which is right.
        expect(reading).toContain('4.60 µm shows a signal in 2 of 2 frames but not in the combined picture');
        expect(reading).not.toContain('from the centre');
        expect(reading).not.toContain('seen at 4.60 µm');
    });

    it('uses the sign when counting individually strong frames', () => {
        const frames = lookFrames([30, -30, 0, 0, 0], [0, 30, 60, 90, 120]);
        const reading = falseColourView(sky([sourceFrame(1.25)]), sky(frames), radii).parts.reading;
        expect(reading).not.toContain('shows a signal in 2 of 5 frames');
    });

    it('keeps dates paired after choosing the most complete frame first', () => {
        const frames = lookFrames([100, 1, 100, 1], [360, 0, 366, 190]);
        frames[1]!.data[0] = NaN;
        const reading = falseColourView(sky([sourceFrame(1.25)]), sky(frames), radii).parts.reading;
        expect(reading).toContain('without the 2 frames of its strongest visit');
    });

    it('prints the actual off-centre limit and rounded distance', () => {
        const g = { ...grid, pixelArcsec: 6.16 };
        const short = [sourceFrame(1.25, 16, 1000), sourceFrame(1.25, 16, 1000)].map(f => ({ ...f, grid: g }));
        const long = [sourceFrame(4.6, 15, 1000), sourceFrame(4.6, 15, 1000)].map(f => ({ ...f, grid: g }));
        const result = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii);
        expect(result.parts.reading).toContain('brightest 6.16″ from the centre');
        expect(result.parts.reading).toContain('is not counted as seen at the centre');
    });

    it.each([false, true])('uses both bands and all frame dates for a moving Gaia star, reversed: %s', reverse => {
        const early = sourceFrame(1.25);
        const late = sourceFrame(4.6);
        late.frame = { ...late.frame, tMin: 60050, tMax: 60050.001 };
        const a = sky([early]);
        const b = sky([late]);
        const coord = gridPixToSky(grid, { x: 15, y: 15 });
        a.stars = [{ sourceId: 'moving', ...coord, g: 15, epochJyear: 2000 + (60000.0005 - 51544.5) / 365.25, pmRa: 0, pmDec: 100000, pix: { x: 15, y: 15 } }];
        const result = reverse ? falseColourView(b, a, radii) : falseColourView(a, b, radii);
        expect(result.parts.method).toContain('between 0.0″ and 13.7″ from the centre over the frame dates');
    });

    it('does not merge stars without usable ids', () => {
        const a = sky([sourceFrame(1.25)]);
        const b = sky([sourceFrame(4.6)]);
        const star = { sourceId: '', ...gridPixToSky(grid, { x: 15, y: 15 }), g: 15, epochJyear: 2016, pix: { x: 15, y: 15 } };
        a.stars = [star];
        b.stars = [{ ...star }];
        expect(falseColourView(a, b, radii).parts.method).toContain('2 of the Gaia stars');
    });

    it('only names bands with at least three frames in the clipping note', () => {
        const two = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([sourceFrame(4.6), sourceFrame(4.6)]), radii);
        expect(two.parts.note).not.toContain('3 or more frames');
        const three = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([sourceFrame(4.6), sourceFrame(4.6), sourceFrame(4.6)]), radii);
        expect(three.parts.note).toContain('With 3 or more frames at 4.60 µm');
    });

    it('reports an unpainted pixel when only the long band lacks coverage', () => {
        const long = sourceFrame(4.6);
        long.data[0] = NaN;
        expect(falseColourView(sky([sourceFrame(1.25)]), sky([long]), radii).parts.note)
            .toContain('Hatched areas have no colour: the frames do not all cover them. The grey picture shows through the hatching.');
    });

    it.each([
        ['ten faint', Array(10).fill(2.2), 36, 7.0],
        ['twelve faint', Array(12).fill(1.4), 196, 7.6],
        ['two at 2.8', [2.8, 2.8], 123, null],
        ['three steady', [5, 5, 5], 123, null],
    ])('keeps %s frames when the signal holds without the strongest', (_name, values, seed, expectedStack) => {
        const frames = values.map((v: number, i: number) => measuredFrame(4.6, v, seed + i * 104729));
        if (expectedStack !== null) {
            const ap = aperture(stackVisit(frames).data, 31, 31, { x: 15, y: 15 }, { ...radii, noiseScale: resampleNoiseScale(grid.pixelArcsec) });
            expect(ap.snr).toBeCloseTo(expectedStack, 0);
        }
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25), sourceFrame(1.25)]), sky(frames), radii);
        expect(result.parts.reading).toContain('seen at 4.60 µm');
        expect(result.parts.reading).not.toMatch(/index/i);
    });

    it('keeps frames of different depth when both support the source', () => {
        const frames = [measuredFrame(4.6, 14.2, 50, 0.2), measuredFrame(4.6, 2.8, 63)];
        const reading = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky(frames), radii).parts.reading;
        expect(reading).toContain('seen at 4.60 µm');
        expect(reading).toContain('and without its strongest frame the rest is below 3 times the noise');
        expect(reading).not.toMatch(/index/i);
    });

    it('uses resampling noise in the leave-one-out check', () => {
        const frames = [measuredFrame(4.6, 8, 50), measuredFrame(4.6, 1.6, 63)];
        const reading = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky(frames), radii).parts.reading;
        expect(reading).toContain('4.60 µm shows a signal that does not hold up without its strongest frame');
    });

    it('reports when a frame has no measurable noise', () => {
        const flat = frame(4.6);
        flat.data.fill(0);
        flat.data[15 * 31 + 15] = 100;
        const reading = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([sourceFrame(4.6), flat]), radii).parts.reading;
        expect(reading).toContain('4.60 µm could not be checked frame by frame, so it is not counted as seen');
    });

    it.each([3, 10])('does not count a one-frame hit among %i frames', n => {
        const frames = Array.from({ length: n }, (_, i) => measuredFrame(4.6, i === 0 ? 30 : 0, 500 + i * 104729));
        const reading = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky(frames), radii).parts.reading;
        expect(reading).not.toMatch(/index/i);
        expect(reading).toContain('no clear signal at 4.60 µm');
    });

    it('reports two strong frames that disappear in their average', () => {
        const frames = [0, 0, 0, 20, 20].map((v, i) => measuredFrame(4.6, v, 456 + i * 104729));
        for (const f of frames) {
            const noise = aperture(f.data, 31, 31, { x: 15, y: 15 }, { ...radii, noiseScale: resampleNoiseScale(grid.pixelArcsec) }).noise;
            f.data = Float32Array.from(f.data, value => value / noise);
        }
        for (const f of frames.slice(3)) { f.frame = { ...f.frame, tMin: 60010, tMax: 60010.001 }; }
        const reading = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25), sourceFrame(1.25)]), sky(frames), radii).parts.reading;
        expect(reading).toContain('4.60 µm shows a signal in 2 of 5 frames but not in the combined picture, which leaves out values that stand out in only some frames, so it is not counted as seen (chance noise alone can do this; it may have changed or moved, or be detector hits)');
    });

    it('says the 2 frames do not agree when 1 of them has a hit next to a centred source', () => {
        const g = { ...grid, pixelArcsec: 3.85 };
        const short = [sourceFrame(1.25, 15, 1000), sourceFrame(1.25, 15, 1000)].map(f => ({ ...f, grid: g }));
        const long = [sourceFrame(4.6, 15, 1000), sourceFrame(4.6, 15, 1000)].map(f => ({ ...f, grid: g }));
        long[0]!.data[15 * 31 + 17] = 5000;
        const result = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii);
        expect(result.parts.reading).not.toMatch(/index/i);
        expect(result.parts.reading).toContain('its two frames do not agree on where it is brightest');
        expect(result.parts.reading).not.toContain('from the centre');
        expect(result.parts.reading).not.toContain('does not move');
        expect(result.parts.reading).not.toContain('seen at 4.60 µm');
    });

    it('finds an off-centre peak even if the other colour is blank there', () => {
        const g = { ...grid, pixelArcsec: 3 };
        const short = [sourceFrame(1.25, 18, 1000), sourceFrame(1.25, 18, 1000), sourceFrame(1.25, 18, 1000)].map(f => ({ ...f, grid: g }));
        const long = [sourceFrame(4.6), sourceFrame(4.6), sourceFrame(4.6)].map(f => ({ ...f, grid: g }));
        long[0]!.data[15 * 31 + 18] = NaN;
        const result = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, { radius: 4, annulusIn: 5, annulusOut: 7 });
        expect(result.parts.reading).toContain('brightest 9.00″ from the centre');
        expect(result.parts.reading).not.toContain('no colour index is given because');
    });

    it('reports the seen off-centre band without blaming it for an unseen band', () => {
        const g = { ...grid, pixelArcsec: 3 };
        const a = [sourceFrame(1.25, 18, 1000), sourceFrame(1.25, 18, 1000), sourceFrame(1.25, 18, 1000)].map(f => ({ ...f, grid: g }));
        const b = [frame(4.6), frame(4.6), frame(4.6)].map(f => ({ ...f, grid: g }));
        const result = falseColourView({ ...sky(a), grid: g }, { ...sky(b), grid: g }, { radius: 4, annulusIn: 5, annulusOut: 7 });
        expect(result.parts.reading).toContain('brightest 9.00″ from the centre');
        expect(result.parts.reading).toContain('no clear signal at 4.60 µm');
        expect(result.parts.reading).not.toContain('no colour index is given because');
    });

    it('names the two-frame limit and explains the sky removal', () => {
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25), sourceFrame(1.25)]), sky([sourceFrame(4.6), sourceFrame(4.6)]), radii);
        expect(result.parts.warning).toContain('With only two frames at 4.60 µm');
        expect(result.parts.note).toContain('With 3 or more frames at 1.25 µm, the middle value of the frames is used at each pixel');
        expect(result.parts.note).toContain("Each frame's middle value is taken off as sky");
        expect(result.parts.method).toContain('Frames taken less than 10 days apart count as one visit.');
    });

    it('warns that clipping may remove a flare among three frames', () => {
        const short = [sourceFrame(1.25, 15, 900), sourceFrame(1.25, 15, 900), sourceFrame(1.25, 15, 900)];
        const long = [sourceFrame(4.6, 15, 900), sourceFrame(4.6, 15, 900), sourceFrame(4.6, 15, 4500)];
        const result = falseColourView(sky(short), sky(long), radii);
        expect(result.parts.note).toContain('With 3 or more frames at 1.25 µm and 4.60 µm, the middle value of the frames is used at each pixel, so something present in fewer than half of the frames is missing from this picture, and something present in most of them looks steady.');
        expect(result.parts.note).not.toContain('the two frames at one wavelength');
    });

    it('clips a one-frame spike while keeping the clipped pixels painted', () => {
        const frames = [frame(4.6), frame(4.6), frame(4.6)];
        for (const i of [15 * 31 + 15, 15 * 31 + 16, 16 * 31 + 15, 16 * 31 + 16]) {
            frames[0]!.data[i] = 5000;
            frames[1]!.data[i] = 0;
            frames[2]!.data[i] = 1;
        }
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25), sourceFrame(1.25)]), sky(frames), radii);
        const p = 4 * (15 * 31 + 15);
        expect(result.rgba[p + 3]).toBe(255);
        expect(result.rgba[p]).toBeLessThan(100);
        expect(result.parts.reading).not.toContain('seen at both');
        expect(result.parts.reading).not.toMatch(/index/i);
    });

    it('does not count a clear two-frame stack when only one frame agrees', () => {
        const hit = frame(4.6);
        for (const i of [15 * 31 + 15, 15 * 31 + 16, 16 * 31 + 15, 16 * 31 + 16]) { hit.data[i] = 5000; }
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([hit, frame(4.6)]), radii);
        expect(result.parts.reading).toContain('no clear signal at 4.60 µm');
        expect(result.parts.reading).not.toMatch(/index/i);
    });

    it('says nothing about where the light is for a band that is not counted as seen', () => {
        // A one-frame hit two pixels from the centre: the stack is clear, but only 1 of 2 frames agrees.
        const hit = frame(4.6);
        for (const i of [15 * 31 + 17, 16 * 31 + 17]) { hit.data[i] = 5000; }
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([hit, frame(4.6)]), radii);
        expect(result.parts.reading).toContain('no clear signal at 4.60 µm');
        expect(result.parts.reading).not.toContain('brightest');
        expect(result.parts.reading).not.toContain('not centred');
    });

    it('rejects a stack that fails the leave-one-out threshold', () => {
        const first = sourceFrame(4.6, 15, 40);
        const second = sourceFrame(4.6, 15, 40);
        for (let i = 0; i < second.data.length; i++) {
            if (i !== 15 * 31 + 15) { second.data[i] = -second.data[i]! + 0.3 * first.data[i]!; }
        }
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([first, second]), radii);
        expect(result.parts.reading).toContain('4.60 µm shows a signal that falls below the limit once its strongest frame is left out, so it is not counted as seen');
    });

    it('keeps a real source in all three frames with its previous SNR within 1%', () => {
        const short = [sourceFrame(1.25), sourceFrame(1.25), sourceFrame(1.25)];
        const long = [sourceFrame(4.6), sourceFrame(4.6), sourceFrame(4.6)];
        const before = colourAt(stackVisit(short, { background: 'none', clipSigma: Infinity }).data, stackVisit(long, { background: 'none', clipSigma: Infinity }).data, 31, 31, { x: 15, y: 15 }, { pixelArcsec: grid.pixelArcsec, ...radii });
        const result = falseColourView(sky(short), sky(long), radii);
        expect(result.parts.reading).toContain('all 3 frames come from one visit');
        expect(result.parts.reading).not.toMatch(/index/i);
        const reported = Number(result.parts.reading.match(/signal-to-noise ([\d.]+)/)![1]);
        expect(Math.abs(reported - before.snrShort) / before.snrShort).toBeLessThan(0.01);
    });

    it('warns when a seen band has only one frame', () => {
        const result = falseColourView(sky([sourceFrame(1.25)]), sky([sourceFrame(4.6)]), radii);
        expect(result.parts.reading).toContain('one frame only, so a detector hit cannot be ruled out');
        expect(result.parts.warning).toContain('a detector hit can show as a coloured point');
    });

    it('keeps a nebula grey and brighter than sky with different frame skies', () => {
        const make = (lambda: number, offset: number, blank: boolean) => {
            const f = frame(lambda);
            for (let y = 0; y < 31; y++) {
                for (let x = 0; x < 31; x++) { f.data[y * 31 + x] = blank && x >= 27 ? NaN : offset + (y === 0 && x >= 20 && x < 26 ? 200 : x < 13 ? 50 : 0); }
            }
            return f;
        };
        const short = [make(1.25, 10, false), make(1.25, 100, true), make(1.25, 200, false)];
        const pixelIndex = 15 * 31 + 5;
        short[0]!.data[pixelIndex] = 5010;
        short[1]!.data[pixelIndex] = 149;
        short[2]!.data[pixelIndex] = 251;
        const result = falseColourView(sky(short), sky([make(4.6, 30, false), make(4.6, 70, true), make(4.6, 90, false)]), radii);
        const nebula = result.rgba.slice(4 * (15 * 31 + 5), 4 * (15 * 31 + 5) + 4);
        const skyPixel = result.rgba[4 * (15 * 31 + 20)]!;
        expect(Math.abs(nebula[0]! - nebula[2]!)).toBeLessThanOrEqual(2);
        expect(nebula[0]).toBeGreaterThan(skyPixel);
    });

    it('explains why a glow covering most of the view loses its tint', () => {
        const render = (fraction: number) => {
            const short = [frame(1.25), frame(1.25), frame(1.25)];
            const long = [frame(4.6), frame(4.6), frame(4.6)];
            for (const f of long) {
                for (let i = 0; i < Math.floor(f.data.length * fraction); i++) { f.data[i] = f.data[i]! + 30; }
            }
            return falseColourView(sky(short), sky(long), radii);
        };
        const small = render(0.25);
        const large = render(0.73);
        expect(small.rgba[0]! - small.rgba[2]!).toBeGreaterThan(large.rgba[0]! - large.rgba[2]!);
        expect(large.parts.note).toContain('a glow that fills most of the view can be removed with it');
    });

    it('describes Gaia stars, including a star on the circle edge, and missing lists', () => {
        const s = sky([sourceFrame(1.25)]);
        const l = sky([sourceFrame(4.6)]);
        const star = (x: number, y: number) => ({ sourceId: `${x},${y}`, ...gridPixToSky(grid, { x, y }), g: 15, epochJyear: 2016, pix: { x, y } });
        const method = () => falseColourView(s, l, radii).parts.method;
        expect(method()).toContain('none of the Gaia stars this page loads lies inside that circle');
        l.stars = [star(16, 15)];
        expect(method()).toContain('1 of the Gaia stars this page loads lies inside that circle, 6.2″ from the centre. That list holds only the brighter stars');
        l.stars = [star(17, 15), star(16, 15), star(15.1, 15)];
        expect(method()).toContain('3 of the Gaia stars this page loads lie inside that circle, the nearest 0.6″ from the centre. That list holds only the brighter stars');
        s.notes.push('Gaia stars are not available for this view.');
        l.notes.push('Gaia stars are not available for this view.');
        l.stars = [];
        expect(method()).toContain('within 12.3″ of the centre, so it can include a neighbour');
        delete (l as Partial<SkyResult>).stars;
        delete (s as Partial<SkyResult>).stars;
        expect(method()).toContain('within 12.3″ of the centre, so it can include a neighbour');
    });

    it('checks each star at each frame date, even if it leaves the image', () => {
        const first = sourceFrame(1.25);
        const later = sourceFrame(4.6);
        later.frame = { ...later.frame, tMin: 62000, tMax: 62000.001 };
        const s = sky([first]);
        const l = sky([later]);
        const coord = gridPixToSky(grid, { x: 15, y: 15 });
        s.stars = [{ sourceId: 'moving', ...coord, g: 15, epochJyear: 2000 + (60000.0005 - 51544.5) / 365.25, pmRa: 0, pmDec: 100000, pix: { x: 0, y: 0 } }];
        l.stars = [{ sourceId: 'other', ...coord, g: 15, epochJyear: 2016, pix: { x: 0, y: 0 } }];
        expect(falseColourView(s, l, radii).parts.method).toContain('2 of the Gaia stars this page loads lie inside or pass through that circle');
        l.stars = [];
        expect(falseColourView(s, l, radii).parts.method).toContain('1 of the Gaia stars this page loads passes through that circle, between 0.0″ and');
    });

    it('prints the largest Gaia distance when the range is small', () => {
        const first = sourceFrame(1.25);
        const later = sourceFrame(4.6);
        later.frame = { ...later.frame, tMin: 60200, tMax: 60200.001 };
        const s = sky([first]);
        const l = sky([later]);
        const coord = gridPixToSky(grid, { x: 15, y: 16 });
        s.stars = [{ sourceId: 'slow', ...coord, g: 15, epochJyear: 2000 + (60000.0005 - 51544.5) / 365.25, pmRa: 0, pmDec: -365.25, pix: { x: 15, y: 16 } }];
        expect(falseColourView(s, l, radii).parts.method).toContain('6.4″ from the centre');
    });

    it('projects Gaia coordinates without proper motion and prints consistent radius and distance', () => {
        const g = { ...grid, pixelArcsec: 1.54 };
        const a = { ...sky([{ ...sourceFrame(1.25, 15, 1000), grid: g }]), grid: g };
        const b = { ...sky([{ ...sourceFrame(4.6, 15, 1000), grid: g }]), grid: g };
        a.stars = [{ sourceId: 'stationary', ...gridPixToSky(g, { x: 22.95, y: 15 }), g: 15, epochJyear: 2016, pix: { x: 0, y: 0 } }];
        const method = falseColourView(a, b, { radius: 8, annulusIn: 9, annulusOut: 12 }).parts.method;
        expect(method).toContain('within 12.3″ of the centre; 1 of the Gaia stars this page loads lies inside that circle, 12.2″ from the centre');
    });

    it('withholds the index when the brightest pixel is 9 arcseconds away but not at 3', () => {
        const g = { ...grid, pixelArcsec: 3 };
        const make = (lambda: number, x: number) => ({ ...sourceFrame(lambda, x, 1000), grid: g });
        const makeSky = (frames: RegriddedFrame[]) => ({ ...sky(frames), grid: g });
        const r = { radius: 4, annulusIn: 5, annulusOut: 7 };
        const long = [make(4.6, 15), make(4.6, 15), make(4.6, 15)];
        const far = falseColourView(makeSky([make(1.25, 18), make(1.25, 18), make(1.25, 18)]), makeSky(long), r);
        expect(far.parts.reading).toContain('brightest 9.00″ from the centre');
        expect(far.parts.reading).toContain('is not counted as seen at the centre');
        expect(far.parts.method).not.toContain("each colour's brightest point");
        const near = falseColourView(makeSky([make(1.25, 16), make(1.25, 16), make(1.25, 16)]), makeSky(long), r);
        expect(near.parts.reading).not.toContain('brightest 3.00″');
        expect(near.parts.reading).toContain('seen at 1.25 µm');
        const visits = (frames: RegriddedFrame[]) => frames.map((f, i) => ({ ...f, frame: { ...f.frame, tMin: 60000 + i * 30, tMax: 60000.001 + i * 30 } }));
        const separate = falseColourView(makeSky(visits([make(1.25, 16), make(1.25, 16), make(1.25, 16)])), makeSky(visits(long)), r);
        expect(separate.parts.reading).toMatch(/seen at (?:both wavelengths|1\.25 µm)/);
    });
});

describe('one frame set per band', () => {
    it('keeps 85% overlap and leaves out 70%, breaking ties by time and input order', () => {
        const first = frame(1.2, 60000);
        const same = frame(1.2, 60000);
        const late = frame(1.2, 60001);
        const keep = frame(1.2, 60002);
        const omit = frame(1.2, 60003);
        keep.data.fill(NaN, 817);
        omit.data.fill(NaN, 673);
        const chosen = chooseColourFrames([late, first, same, keep, omit]);
        expect(chosen.frames).toEqual([first, same, late, keep]);
        expect(chosen.leftOut).toBe(1);
        expect(chooseColourFrames([first, omit, keep]).frames).toEqual([first, keep]);
        const differentGap = frame(1.2, 60004);
        differentGap.data.fill(NaN, 0, 145);
        expect(chooseColourFrames([first, keep, differentGap]).frames).toEqual([first, keep]);
        const boundary = frame(1.2, 60005);
        boundary.data.fill(NaN, 769);
        expect(chooseColourFrames([first, boundary]).frames).toEqual([first, boundary]);
        boundary.data[768] = NaN;
        expect(chooseColourFrames([first, boundary]).frames).toEqual([first]);
    });

    it('describes equal-coverage frames left out because their areas differ', () => {
        const a = frame(1.25);
        const b = frame(1.25);
        for (let i = 0; i < 200; i++) { a.data[i] = NaN; b.data[b.data.length - 1 - i] = NaN; }
        const result = falseColourView(sky([a, b]), sky([frame(4.6)]), radii);
        expect(result.parts.labels).toContain('1 more left out (it does not share enough of this view with the frames used)');
    });

    it('rejects an all-blank band with the existing picture error', () => {
        const blank = frame(1.2);
        blank.data.fill(NaN);
        expect(chooseColourFrames([blank])).toEqual({ frames: [], leftOut: 1 });
        expect(() => falseColourView(sky([blank]), sky([frame(4.6)]), radii)).toThrow(FalseColourError);
        expect(() => falseColourView(sky([blank]), sky([frame(4.6)]), radii)).toThrow('Picture has no finite pixel values');
    });

    it('omits a blank frame from wavelength, count, date and warning', () => {
        const blank = frame(1.8, 60100);
        blank.data.fill(NaN);
        const result = falseColourView(sky([frame(1.2), blank]), sky([frame(4.6)]), radii);
        expect(result.parts.labels).toContain('Blue: 1.20 µm (the shorter wavelength), 1 frame, 2023-02-25; 1 more left out (it does not share enough of this view with the frames used).');
        expect(result.parts.warning).not.toContain('not taken at the same times');
        expect(result.parts.note).not.toContain('A pixel is painted only where every frame of both colours covers it.');
        const secondBlank = frame(1.9, 60200);
        secondBlank.data.fill(NaN);
        expect(falseColourView(sky([frame(1.2), blank, secondBlank]), sky([frame(4.6)]), radii).parts.labels)
            .toContain('1 frame, 2023-02-25; 2 more left out (they do not share enough of this view with the frames used).');
    });

    it('does not paint the nebula strip orange', () => {
        const full = frame(1.2);
        const strip = frame(1.2);
        const long = frame(4.6);
        for (let y = 0; y < 31; y++) {
            for (let x = 0; x < 31; x++) {
                const i = y * 31 + x;
                full.data[i] = long.data[i] = x < 8 ? 60 : 10;
                strip.data[i] = x < 8 ? 60 : NaN;
            }
        }
        const result = falseColourView(sky([full, strip]), sky([long]), radii);
        const pixel = result.rgba.slice(4 * (15 * 31 + 2), 4 * (15 * 31 + 2) + 4);
        expect(pixel[3] === 0 || (pixel[0] === pixel[1] && pixel[1] === pixel[2])).toBe(true);
        expect(result.parts.labels).toContain('1 more left out');
    });

    it('judges the shared scale only where both bands are painted', () => {
        const short = frame(1.2);
        const long = frame(4.6);
        for (let y = 0; y < 31; y++) {
            for (let x = 0; x < 31; x++) {
                const i = y * 31 + x;
                long.data[i] = x < 15 ? 60 : 10;
                short.data[i] = x >= 26 ? NaN : long.data[i]!;
            }
        }
        const result = falseColourView(sky([short]), sky([long]), radii);
        for (const x of [5, 20]) {
            const pixel = result.rgba.slice(4 * (15 * 31 + x), 4 * (15 * 31 + x) + 4);
            expect(pixel[3]).toBe(255);
            expect(pixel[0] === pixel[1] && pixel[1] === pixel[2]).toBe(true);
        }
        expect(result.rgba[4 * (15 * 31 + 28) + 3]).toBe(0);
    });

    it('subtracts frame medians over their common area', () => {
        const full = frame(1.2);
        const edge = frame(1.2);
        const long = frame(4.6);
        for (let y = 0; y < 31; y++) {
            for (let x = 0; x < 31; x++) {
                const i = y * 31 + x;
                full.data[i] = long.data[i] = x < 15 ? 60 : 10;
                edge.data[i] = x >= 26 ? NaN : full.data[i]!;
            }
        }
        const maskedFull = { ...full, data: Float32Array.from(full.data, (v, i) => Number.isFinite(edge.data[i]) ? v : NaN) };
        const expected = stackVisit([maskedFull, edge], { background: 'median' }).data;
        // The scale is judged where both bands are painted, so the long band is masked the same way here.
        const longStack = stackVisit([long], { background: 'median' }).data;
        const longShown = Float32Array.from(longStack, (value, i) => Number.isFinite(expected[i]) ? value : NaN);
        const stretch = pairStretch(expected, longShown);
        const expectedSky = frameBackground(maskedFull.data);
        expect(frameBackground(edge.data)).toBe(expectedSky);
        const result = falseColourView(sky([full, edge]), sky([long]), radii);
        expect(screenColourFrames([maskedFull, edge]).data).toEqual(expected);
        expect(result.parts.labels).toContain('2 frames');
        expect(result.rgba).toEqual(falseColourRgba(expected, longShown, stretch.sShort, stretch.sLong));
    });

    it('compares time sets, ignoring duplicates within tolerance', () => {
        const duplicate = frame(1.2, 60000 + 0.5 / 86400);
        const same = falseColourView(sky([frame(1.2), duplicate]), sky([frame(4.6)]), radii);
        expect(same.parts.warning).not.toContain('not taken at the same times');
        const other = falseColourView(sky([frame(1.2), frame(1.2, 60100)]), sky([frame(4.6)]), radii);
        expect(other.parts.warning).toContain('not taken at the same times');
        const unavailable = frame(1.2, NaN, NaN);
        expect(falseColourView(sky([unavailable]), sky([frame(4.6)]), radii).parts.warning).toContain('frame dates are unavailable');
    });

    it('warns for different chosen dates even when a discarded frame matches', () => {
        const short = frame(1.2, 60000);
        const absent = frame(1.2, 60100);
        absent.data.fill(NaN);
        const result = falseColourView(sky([short, absent]), sky([frame(4.6, 60000), frame(4.6, 60100)]), radii);
        expect(result.parts.warning).toContain('not taken at the same times');
    });

    it('measures painted circles and hatches a missing circle pixel', () => {
        const full = frame(1.2);
        const missing = frame(1.2);
        missing.data[15 * 31 + 15] = NaN;
        const result = falseColourView(sky([full, missing]), sky([frame(4.6)]), radii);
        expect(result.parts.reading).toContain('1.20 µm cannot be measured here (blank pixels)');
        expect(result.rgba[4 * (15 * 31 + 15) + 3]).toBe(0);
        expect(result.parts.note).toContain('Hatched areas have no colour: the frames do not all cover them. The grey picture shows through the hatching.');
        const covered = falseColourView(sky([full, frame(1.2)]), sky([frame(4.6)]), radii);
        expect(covered.parts.reading).not.toContain('cannot be measured');
    });

    it('reports flat long-band noise while retaining the valid short band', () => {
        const flat = frame(4.6);
        flat.data.fill(10);
        flat.data[15 * 31 + 15] = 100;
        const result = falseColourView(sky([frame(1.2)]), sky([flat]), radii);
        expect(result.parts.reading).toContain('4.60 µm cannot be measured here (the noise could not be judged)');
        expect(result.parts.reading).toContain('1.20 µm');
    });

    it('treats an invalid aperture with non-finite noise as blank pixels', () => {
        const missing = frame(4.6);
        for (let y = 0; y < 31; y++) {
            for (let x = 0; x < 31; x++) {
                const d = (x - 15) ** 2 + (y - 15) ** 2;
                if (d >= 16 && d <= 49) { missing.data[y * 31 + x] = NaN; }
            }
        }
        const measured = aperture(missing.data, 31, 31, { x: 15, y: 15 }, radii);
        expect(measured.valid).toBe(false);
        expect(Number.isFinite(measured.noise)).toBe(false);
        const result = falseColourView(sky([frame(1.2)]), sky([missing]), radii);
        expect(result.parts.reading).toContain('4.60 µm cannot be measured here (blank pixels)');
        expect(result.parts.reading).not.toContain('noise could not be judged');
    });

    it('prints both readings when an index cannot be formed', () => {
        const parts = colourParts(1.25, 4.6, { short: 10, long: -2, snrShort: 5, snrLong: 4, index: NaN, seen: 'both', valid: false });
        expect(parts.reading).toBe('At the centre: seen at both wavelengths (signal-to-noise 5.0 at 1.25 µm and 4.0 at 4.60 µm).');
        expect(parts.method).not.toContain('The colour index is');
    });
});

describe('false colour view coverage', () => {
    it('labels the chosen frames and measures only their shared circle', () => {
        const cover = frame(1.2, 60000);
        const blank = frame(1.3, 60100);
        for (let y = 0; y < 31; y++) {
            for (let x = 0; x < 31; x++) {
                const d = (x - 15) ** 2 + (y - 15) ** 2;
                if (d <= 4 || (d >= 16 && d <= 49)) {
                    blank.data[y * 31 + x] = NaN;
                }
            }
        }
        const result = falseColourView(sky([cover, blank]), sky([frame(4.6)]), radii);
        expect(result.parts.labels).toContain('Blue: 1.25 µm (the shorter wavelength), 2 frames, 2023-02-25 and 2023-06-05.');
        expect(result.parts.warning).toContain('The two colours were not taken at the same times');
        expect(result.parts.reading).toContain('1.25 µm cannot be measured here (blank pixels).');
        const plural = falseColourView(sky([cover, blank, blank]), sky([frame(4.6)]), radii);
        expect(plural.parts.labels).toContain('1.27 µm (the shorter wavelength), 3 frames');
        expect(plural.parts.reading).toContain('1.27 µm cannot be measured here (blank pixels).');
    });

    it('removes frame skies before combining and hatches missing pixels', () => {
        const high = frame(1.25);
        const low = frame(1.25);
        high.data.fill(100);
        low.data.fill(0);
        for (let y = 0; y < 31; y++) {
            for (let x = 0; x < 31; x++) {
                if ((x - 15) ** 2 + (y - 15) ** 2 <= 4) {
                    low.data[y * 31 + x] = NaN;
                }
            }
        }
        const long = frame(4.6);
        const masked = { ...high, data: Float32Array.from(high.data, (v, i) => Number.isFinite(low.data[i]) ? v : NaN) };
        const expected = screenColourFrames([masked, low]).data;
        for (let i = 0; i < expected.length; i++) {
            if (!Number.isFinite(low.data[i])) { expected[i] = NaN; } else { expect(expected[i]).toBe(0); }
        }
        const longStack = Float32Array.from(screenColourFrames([long]).data, (v, i) => Number.isFinite(expected[i]) ? v : NaN);
        const stretch = pairStretch(expected, longStack);
        expect(falseColourView(sky([high, low]), sky([long]), radii).rgba)
            .toEqual(falseColourRgba(expected, longStack, stretch.sShort, stretch.sLong));
        const frames = [frame(1.25, 60000, 60000.001, 100), frame(1.25, 60000, 60000.001, 0)];
        const old = stackVisit(frames, { clipSigma: Infinity, background: 'none' }).data;
        const next = stackVisit(frames, { clipSigma: Infinity, background: 'median' }).data;
        const oldAp = aperture(old, 31, 31, { x: 15, y: 15 }, radii);
        const newAp = aperture(next, 31, 31, { x: 15, y: 15 }, radii);
        expect(newAp.sum).toBeCloseTo(oldAp.sum);
        expect(newAp.noise).toBeCloseTo(oldAp.noise);
        const result = falseColourView(sky(frames), sky([long]), radii);
        const oldLong = stackVisit([long], { clipSigma: Infinity, background: 'none' }).data;
        const oldReading = colourAt(old, oldLong, 31, 31, { x: 15, y: 15 }, { pixelArcsec: grid.pixelArcsec, ...radii, minSnr: 3 });
        expect(oldReading.seen).toBe('neither');
        // Neither band is seen, so nothing is said about where the brightest pixel is: in noise it falls anywhere.
        expect(result.parts.reading).toBe('At the centre: no clear signal at either wavelength (clear means at least 3 times the noise).');
        expect(result.parts.reading).not.toContain('reading uses');
    });

    it('reports a flat sky ring as unjudgeable noise for either band', () => {
        const flat = frame(1.25);
        flat.data.fill(10);
        flat.data[15 * 31 + 15] = 100;
        const normal = frame(4.6);
        const result = falseColourView(sky([flat]), sky([normal]), radii);
        expect(result.parts.reading).toContain('1.25 µm cannot be measured here (the noise could not be judged)');
        const flatLong = { ...flat, lambdaAtCenter: 4.6 };
        const bothFlat = falseColourView(sky([flat]), sky([flatLong]), radii);
        expect(bothFlat.parts.reading).toContain('4.60 µm cannot be measured here (the noise could not be judged)');
        expect(bothFlat.parts.method).toContain('this page does not measure a colour');
        expect(bothFlat.sentence).toBe(Object.values(bothFlat.parts).filter(Boolean).join(' '));
    });

    it('allows a missing inner ring pixel when aperture accepts the ring', () => {
        const partial = frame(4.6);
        partial.data[15 * 31 + 19] = NaN;
        expect(falseColourView(sky([frame(1.25)]), sky([frame(4.6), partial]), radii).parts.reading)
            .not.toContain('cannot be measured');
    });

    it.each(['circle missing', 'complementary'] as const)('rejects mismatched frame identities: %s', mode => {
        const high = frame(1.25, 60000, 60000.001, 100);
        const low = frame(1.25);
        for (let y = 0; y < 31; y++) {
            for (let x = 0; x < 31; x++) {
                const circle = (x - 15) ** 2 + (y - 15) ** 2 <= 4;
                if (circle) {
                    low.data[y * 31 + x] = NaN;
                } else if (mode === 'complementary') {
                    high.data[y * 31 + x] = NaN;
                }
            }
        }
        expect(falseColourView(sky([high, low]), sky([frame(4.6)]), radii).sentence)
            .toContain('1.25 µm cannot be measured here (blank pixels)');
    });

    it('uses all frames for wavelengths and dates, including when partial', () => {
        const cover = frame(1.2, 60000);
        const absent = frame(1.8, 60010);
        for (let y = 0; y < 31; y++) {
            for (let x = 0; x < 31; x++) {
                const d = (x - 15) ** 2 + (y - 15) ** 2;
                if (d <= 4 || (d >= 16 && d <= 49)) {
                    absent.data[y * 31 + x] = NaN;
                }
            }
        }
        const long = frame(4.6, 60000);
        const covered = falseColourView(sky([cover, absent]), sky([long]), radii).sentence;
        expect(covered).toContain('Blue: 1.50 µm (the shorter wavelength), 2 frames, 2023-02-25 and 2023-03-07.');
        expect(covered).toContain('The two colours were not taken');
        absent.data[15 * 31 + 20] = 3;
        const partial = falseColourView(sky([cover, absent]), sky([long]), radii).sentence;
        expect(partial).toContain('Blue: 1.50 µm (the shorter wavelength), 2 frames, 2023-02-25 and 2023-03-07.');
        expect(partial).toContain('The two colours were not taken');
    });

    it.each([[17, 15, 'circle edge'], [22, 15, 'outer edge'], [21, 15, 'outer ring']] as const)
    ('handles a frame with a blank at the %s,%s %s', (x, y, _edge) => {
        const partial = frame(4.6);
        partial.data[y * 31 + x] = NaN;
        const result = falseColourView(sky([frame(1.25)]), sky([frame(4.6), partial]), radii);
        expect(result.rgba[4 * (y * 31 + x) + 3]).toBe((x + y) % 4 === 0 ? 255 : 0);
        if (_edge === 'circle edge') {
            expect(result.parts.reading).toContain('4.60 µm cannot be measured here (blank pixels)');
        } else {
            expect(result.parts.reading).not.toContain('cannot be measured');
        }
    });

    it('ignores a gap pixel', () => {
        const a = frame(1.25);
        const b = frame(1.25);
        b.data[15 * 31 + 18] = NaN;
        const result = falseColourView(sky([a, b]), sky([frame(4.6)]), radii);
        expect(result.parts.reading).not.toContain('cannot be measured');
        expect(result.rgba[4 * (15 * 31 + 18) + 3]).toBe(0);
    });

    it('ignores a ring pixel blank in every frame', () => {
        const a = frame(1.25);
        const b = frame(1.25);
        a.data[15 * 31 + 20] = NaN;
        b.data[15 * 31 + 20] = NaN;
        const result = falseColourView(sky([a, b]), sky([frame(4.6)]), radii);
        expect(result.parts.reading).not.toContain('cannot be measured');
        expect(result.rgba[4 * (15 * 31 + 20) + 3]).toBe(0);
    });

    it('uses the half-pixel centre on an even grid', () => {
        const evenGrid = { ...grid, width: 30, height: 30 };
        const convert = (f: RegriddedFrame): RegriddedFrame => ({ ...f, grid: evenGrid, data: new Float32Array(900).fill(1) });
        const a = convert(frame(1.25));
        const b = convert(frame(1.25));
        b.data[14 * 30 + 13] = NaN;
        const makeSky = (frames: RegriddedFrame[]) => ({ ...sky(frames), grid: evenGrid });
        expect(falseColourView(makeSky([a, b]), makeSky([convert(frame(4.6))]), radii).sentence)
            .toContain('1.25 µm cannot be measured here (blank pixels)');
    });

    it.each(['short', 'long'] as const)('retains the seen band when %s has a blank circle pixel', partialBand => {
        const short = frame(1.25);
        const long = frame(4.6);
        for (let y = 13; y <= 17; y++) {
            for (let x = 13; x <= 17; x++) {
                if ((x - 15) ** 2 + (y - 15) ** 2 <= 4) {
                    short.data[y * 31 + x] = 100;
                    long.data[y * 31 + x] = 100;
                }
            }
        }
        const partial = { ...(partialBand === 'short' ? short : long), data: (partialBand === 'short' ? short : long).data.slice() };
        partial.data[15 * 31 + 15] = NaN;
        const result = falseColourView(sky(partialBand === 'short' ? [short, partial] : [short]), sky(partialBand === 'long' ? [long, partial] : [long]), radii);
        expect(result.parts.reading).toMatch(partialBand === 'short'
            // The source is a flat disc on the centre: equal values count as the one nearest the centre, so it is not called off-centre.
            ? /^At the centre: 1\.25 µm cannot be measured here \(blank pixels\); seen at 4\.60 µm \(signal-to-noise [\d.]+, one frame only, so a detector hit cannot be ruled out\)\.$/
            : /^At the centre: seen at 1\.25 µm \(signal-to-noise [\d.]+, one frame only, so a detector hit cannot be ruled out\); 4\.60 µm cannot be measured here \(blank pixels\)\.$/);
    });

    it('counts and compares every painted frame', () => {
        const first = frame(1.25, 60000);
        const second = frame(1.25, 60001);
        const blank = frame(1.25, 60010);
        for (let y = 0; y < 31; y++) {
            for (let x = 0; x < 31; x++) {
                const d = (x - 15) ** 2 + (y - 15) ** 2;
                if (d <= 4 || (d >= 16 && d <= 49)) {
                    blank.data[y * 31 + x] = NaN;
                }
            }
        }
        const sentence = falseColourView(sky([first, second, blank]), sky([frame(4.6, 60000), frame(4.6, 60001)]), radii).sentence;
        expect(sentence).toContain('Blue: 1.25 µm (the shorter wavelength), 3 frames, 2023-02-25 to 2023-03-07.');
        expect(sentence).toContain('2023-03-07');
        expect(sentence).toContain('The two colours were not taken at the same times');
        expect(sentence).toContain('1.25 µm cannot be measured here (blank pixels).');
    });

    it('avoids a false signal caused by mixed frame coverage in the sky ring', () => {
        const low = frame(1.25, 60000, 60000.001, 0);
        const high = frame(1.25, 60000, 60000.001, 100);
        const long = frame(4.6);
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                const d2 = (x - 15) ** 2 + (y - 15) ** 2;
                if (d2 >= radii.annulusIn ** 2 && d2 <= radii.annulusOut ** 2 && x >= 13) {
                    high.data[y * grid.width + x] = NaN;
                }
            }
        }
        const stacked = stackVisit([low, high], { clipSigma: Infinity, background: 'none' }).data;
        expect(colourAt(stacked, long.data, grid.width, grid.height, { x: 15, y: 15 }, { pixelArcsec: grid.pixelArcsec, ...radii }).seen).toBe('short');
        const incomplete = falseColourView(sky([low, high]), sky([long]), radii);
        expect(incomplete.sentence).not.toContain('1.25 µm cannot be measured here');
        expect(incomplete.sentence).not.toContain('seen at 1.25 µm');
        const maskedLow = { ...low, data: Float32Array.from(low.data, (v, i) => Number.isFinite(high.data[i]) ? v : NaN) };
        const maskedHigh = { ...high, data: Float32Array.from(high.data, (v, i) => Number.isFinite(low.data[i]) ? v : NaN) };
        const corrected = screenColourFrames([maskedLow, maskedHigh]).data;
        for (let i = 0; i < corrected.length; i++) {
            if (!Number.isFinite(high.data[i])) { corrected[i] = NaN; }
        }
        const correctedLong = Float32Array.from(screenColourFrames([long]).data, (v, i) => Number.isFinite(corrected[i]) ? v : NaN);
        const stretch = pairStretch(corrected, correctedLong);
        expect(incomplete.rgba).toEqual(falseColourRgba(corrected, correctedLong, stretch.sShort, stretch.sLong));
        const outside = frame(1.25, 60000, 60000.001, 100);
        outside.data[0] = NaN;
        expect(falseColourView(sky([low, outside]), sky([long]), radii).parts.reading).not.toContain('cannot be measured');
        const blank = frame(4.6);
        blank.data[15 * grid.width + 15] = NaN;
        const mixed = falseColourView(sky([low, high]), sky([blank]), radii).sentence;
        expect(mixed).toContain('4.60 µm cannot be measured here (blank pixels)');
        expect(mixed).not.toContain('1.25 µm cannot be measured here');
    });
});

describe('false colour sentence', () => {
    it.each([NaN, Infinity, -Infinity])('does not print a non-finite signal-to-noise value %s', value => {
        const sentence = colourSentence(1.25, 4.6, { ...both, snrShort: value, snrLong: value });
        expect(sentence).not.toMatch(/NaN|Infinity|undefined/);
        expect(sentence).toContain('the noise could not be judged');
        expect(sentence).not.toMatch(/index/i);
    });
    it('omits the method when neither band can be measured', () => {
        const parts = colourParts(1.25, 4.6, { ...both, short: NaN, long: NaN, seen: 'neither', valid: false });
        expect(parts.method).toContain('this page does not measure a colour');
        expect(colourSentence(1.25, 4.6, { ...both, short: NaN, long: NaN, seen: 'neither', valid: false }))
            .toBe(Object.values(parts).filter(Boolean).join(' '));
    });
    it.each([[true, false], [false, true]] as [boolean, boolean][])('honours partial flags on finite readings %s %s without mutation', (short, long) => {
        const input = { ...both };
        const result = colourSentence(1.25, 4.6, input, undefined, [short, long]);
        expect(result).toContain(short
            ? 'seen at 4.60 µm (signal-to-noise 31); 1.25 µm cannot be measured here (blank pixels)'
            : 'seen at 1.25 µm (signal-to-noise 14); 4.60 µm cannot be measured here (blank pixels)');
        expect(input).toEqual(both);
    });

    it('returns independently usable parts that join to the same sentence', () => {
        const cases: [ColourAt, string][] = [
            [both, 'At the centre: seen at both wavelengths (signal-to-noise 14 at 1.25 µm and 31 at 4.60 µm).'],
            [{ ...both, seen: 'short', valid: false }, 'At the centre: seen at 1.25 µm only (signal-to-noise 14); no clear signal at 4.60 µm (clear means at least 3 times the noise).'],
            [{ ...both, long: NaN, seen: 'short' }, 'At the centre: seen at 1.25 µm (signal-to-noise 14); 4.60 µm cannot be measured here (blank pixels).'],
            [{ ...both, short: NaN, long: NaN }, 'At the centre: cannot be measured here (blank pixels).'],
        ];
        for (const [reading, expected] of cases) {
            const parts = colourParts(1.25, 4.6, reading);
            expect(Object.keys(parts)).toEqual(['labels', 'note', 'warning', 'reading', 'method']);
            expect(Object.values(parts).filter(Boolean).join(' ')).toBe(colourSentence(1.25, 4.6, reading));
            expect(parts.reading).toBe(expected);
            expect(parts.method).toContain('this page does not measure a colour');
            expect(parts.warning).toBe('');
        }
        const result = falseColourView(sky([frame(1.25)]), sky([frame(4.6)]), radii);
        expect(Object.values(result.parts).filter(Boolean).join(' ')).toBe(result.sentence);
        const oldParts = colourParts(1.25, 4.6, colourAt(frame(1.25).data, frame(4.6).data, 31, 31, { x: 15, y: 15 }, { pixelArcsec: grid.pixelArcsec, ...radii, minSnr: 3 }), [[at(60000)], [at(60000)]]);
        expect(result.parts).toEqual({ ...oldParts,
            note: oldParts.note + " Each frame's middle value is taken off as sky, so a glow that fills most of the view can be removed with it. Hatched areas have no colour: the frames do not all cover them. The grey picture shows through the hatching.",
            warning: 'With only one frame at 1.25 µm and 4.60 µm, a detector hit can show as a coloured point.',
            method: oldParts.method.replace(' The colours in the picture are for looking; this page does not measure a colour.', '') + " The reading adds up all light within 12.3″ of the centre; none of the Gaia stars this page loads lies inside that circle. That list holds only the brighter stars, so a fainter star or a source seen only in infrared can still be inside. The colours in the picture are for looking; this page does not measure a colour.",
        });
        expect(result.parts.warning).not.toContain('not taken at the same times');
        expect(colourParts(1.25, 4.6, both, [[], [at(60000)]]).warning).toContain('frame dates are unavailable');
    });
    it('distinguishes a weak finite band from a blank band in either order', () => {
        expect(colourSentence(1.25, 4.6, { ...both, short: 10, snrShort: 2.5, long: NaN, seen: 'neither', valid: false }))
            .toContain('At the centre: no clear signal at 1.25 µm (clear means at least 3 times the noise); 4.60 µm cannot be measured here (blank pixels).');
        expect(colourSentence(1.25, 4.6, { ...both, short: NaN, long: 10, snrLong: 2.5, seen: 'neither', valid: false }))
            .toContain('At the centre: no clear signal at 4.60 µm (clear means at least 3 times the noise); 1.25 µm cannot be measured here (blank pixels).');
    });

    it('uses midpoint dates for one, two and more distinct dates', () => {
        const label = (times: [number, number][]) => colourSentence(1.25, 4.6, both, [times, times]);
        expect(label([[60000.9995, 60001.0007963]])).toContain('1 frame, 2023-02-26.');
        expect(label([at(60000), at(60000.5)])).toContain('2 frames, 2023-02-25.');
        expect(label([at(60000), at(60002)])).toContain('2 frames, 2023-02-25 and 2023-02-27.');
        expect(label([at(60002), at(60000), at(60001)])).toContain('3 frames, 2023-02-25 to 2023-02-27.');
    });

    it('prints unavailable dates and zero frames for empty times', () => {
        expect(colourSentence(1.25, 4.6, both, [[], [at(60000)]]))
            .toContain('Blue: 1.25 µm (the shorter wavelength), 0 frames, dates unavailable.');
    });

    it('places the reading before its method', () => {
        const withIndex = colourSentence(1.25, 4.6, both, [[at(60000)], [at(60001)]]);
        expect(withIndex.indexOf('The two colours were not taken')).toBeLessThan(withIndex.indexOf('At the centre:'));
        expect(withIndex.indexOf('At the centre:')).toBeLessThan(withIndex.indexOf('The reading adds up'));
        expect(withIndex.endsWith('The colours in the picture are for looking; this page does not measure a colour.')).toBe(true);
        const noIndex = colourSentence(1.25, 4.6, { ...both, seen: 'short', valid: false });
        expect(noIndex).not.toContain('The colour index is');
        expect(noIndex.indexOf('At the centre:')).toBeLessThan(noIndex.indexOf('The reading adds up'));
    });
    it('formats both bands, the signed index and measured wavelengths', () => {
        const text = colourSentence(1.234, 4.567, both);
        expect(text).toContain('Blue: 1.23 µm');
        expect(text).toContain('Orange: 4.57 µm');
        expect(text).toContain('At the centre: seen at both wavelengths (signal-to-noise 14 at 1.23 µm and 31 at 4.57 µm).');
        expect(text).not.toMatch(/index/i);
    });

    it('describes both bands regardless of the calculated value', () => {
        for (const index of [-0.004, 0.004, 0, -0]) {
            const text = colourSentence(1.25, 4.6, { ...both, index });
            expect(text).toContain('seen at both wavelengths');
            expect(text).not.toMatch(/index/i);
        }
    });

    it('rounds signal-to-noise before choosing one decimal or none', () => {
        const text = colourSentence(1.25, 4.6, { ...both, snrShort: 9.96, snrLong: 9.94 });
        expect(text).toContain('(signal-to-noise 10 at 1.25 µm and 9.9 at 4.60 µm)');
        expect(colourSentence(1.25, 4.6, { ...both, snrShort: 10.4, snrLong: 3 })).toContain('(signal-to-noise 10 at 1.25 µm and 3.0 at 4.60 µm)');
    });

    it.each(['short', 'long'] as const)('describes %s only without an index', seen => {
        const text = colourSentence(1.25, 4.6, { ...both, seen, valid: false, snrShort: 9, snrLong: 9.14 });
        expect(text).toContain(seen === 'short'
            ? 'seen at 1.25 µm only (signal-to-noise 9.0); no clear signal at 4.60 µm (clear means at least 3 times the noise).'
            : 'seen at 4.60 µm only (signal-to-noise 9.1); no clear signal at 1.25 µm (clear means at least 3 times the noise).');
        expect(text).not.toContain('colour index +');
    });

    it('distinguishes noise from blank apertures', () => {
        expect(colourSentence(1.25, 4.6, { ...both, seen: 'neither', valid: false }))
            .toContain('At the centre: no clear signal at either wavelength (clear means at least 3 times the noise).');
        expect(colourSentence(1.25, 4.6, { ...both, short: NaN, seen: 'long', valid: false }))
            .toContain('At the centre: seen at 4.60 µm (signal-to-noise 31); 1.25 µm cannot be measured here (blank pixels).');
        const blankLong = colourSentence(1.25, 4.6, { ...both, long: NaN, seen: 'short', valid: false });
        expect(blankLong).toContain('At the centre: seen at 1.25 µm (signal-to-noise 14); 4.60 µm cannot be measured here (blank pixels).');
        expect(blankLong).not.toContain('colour index +');
    });

    it('keeps public strings free of overclaims', () => {
        const slots = slotText.split('// False colour.')[1]!.split('// R Draconis')[0]!;
        expect(text + slots).not.toMatch(/discovery|detected a|proves/i);
    });

    it('labels both signal-to-noise values with their wavelengths', () => {
        expect(colourSentence(1.234, 4.567, both)).toContain('(signal-to-noise 14 at 1.23 µm and 31 at 4.57 µm)');
    });

    it('explains the clear-signal threshold for one or neither band', () => {
        expect(colourSentence(1.25, 4.6, { ...both, seen: 'short', valid: false, snrLong: 2 }))
            .toContain('no clear signal at 4.60 µm (clear means at least 3 times the noise).');
        expect(colourSentence(1.25, 4.6, { ...both, seen: 'neither', valid: false, snrShort: 2, snrLong: 1 }))
            .toContain('At the centre: no clear signal at either wavelength (clear means at least 3 times the noise).');
    });

    it('preserves the seen band when the other aperture is blank', () => {
        const short = colourSentence(1.25, 4.6, { ...both, long: NaN, seen: 'short', valid: false, snrShort: 20 });
        expect(short).toContain('At the centre: seen at 1.25 µm (signal-to-noise 20); 4.60 µm cannot be measured here (blank pixels).');
        const long = colourSentence(1.25, 4.6, { ...both, short: NaN, seen: 'long', valid: false, snrLong: 20 });
        expect(long).toContain('At the centre: seen at 4.60 µm (signal-to-noise 20); 1.25 µm cannot be measured here (blank pixels).');
        expect(short + long).not.toMatch(/index/i);
        expect(colourSentence(1.25, 4.6, { ...both, short: NaN, long: NaN, seen: 'neither', valid: false }))
            .toContain('At the centre: cannot be measured here (blank pixels).');
    });

    it('explains how the reading relates to the picture', () => {
        expect(colourSentence(1.25, 4.6, both)).toContain('The reading adds up a small circle of pixels and takes off the sky just around it, so it need not match the tint of the middle pixels.');
    });
});

describe('round 9b: fixes from the real-frame probe and the round 9 reviews', () => {
    it('does not count light that peaks away from the centre as seen there', () => {
        const g = { ...grid, pixelArcsec: 3 };
        const make = (lambda: number, x: number) => ({ ...sourceFrame(lambda, x, 1000), grid: g });
        const makeSky = (frames: RegriddedFrame[]) => ({ ...sky(frames), grid: g });
        const r = { radius: 4, annulusIn: 5, annulusOut: 7 };
        const reading = falseColourView(makeSky([make(1.25, 18), make(1.25, 18), make(1.25, 18)]),
            makeSky([make(4.6, 15), make(4.6, 15), make(4.6, 15)]), r).parts.reading;
        expect(reading).toContain('1.25 µm shows light here that is brightest 9.00″ from the centre, so it may belong to a neighbouring source and is not counted as seen at the centre');
        expect(reading).not.toContain('seen at 1.25 µm');
        expect(reading).toContain('seen at 4.60 µm');
    });

    it('does not speak of a second date when every frame comes from one visit', () => {
        const days = [0, 1, 2, 3, 4, 5];
        const reading = falseColourView(sky(lookFrames([30, 30, 30, 30, 30, 30], days, 1.25)),
            sky(lookFrames(ONE_VISIT_LEANING, days)), radii).parts.reading;
        expect(reading).toContain('no clear signal at 4.60 µm');
        expect(reading).not.toContain('second date');
    });

    it('says none, not "not all", when no frame has a usable date', () => {
        const read = (days: number[]) => falseColourView(sky(lookFrames(days.map(() => 30), days, 1.25)), sky(lookFrames(days.map(() => 30), days)), radii).parts.reading;
        expect(read([NaN, NaN])).toContain('none of its 2 frames has a usable date');
        expect(read([NaN, NaN])).not.toContain('not all of its');
        expect(read([0, NaN])).toContain('not all of its 2 frames have usable dates');
    });

    it('leaves out the visit sentence when the centre cannot be measured in either colour', () => {
        const blank = (lambda: number, day: number) => {
            const f = lookFrames([30], [day], lambda)[0]!;
            for (let y = 13; y <= 17; y++) {
                for (let x = 13; x <= 17; x++) { f.data[y * 31 + x] = NaN; }
            }
            return f;
        };
        const result = falseColourView(sky([blank(1.25, 0), blank(1.25, 200)]), sky([blank(4.6, 0), blank(4.6, 200)]), radii);
        expect(result.parts.reading).toBe('At the centre: cannot be measured here (blank pixels).');
        expect(result.parts.method).not.toContain('count as one visit');
        expect(result.parts.method).toContain('this page does not measure a colour');
    });

    it('keeps a Gaia star whose motion cannot be worked out at its catalogue place', () => {
        const s = sky([sourceFrame(1.25)]);
        const l = sky([sourceFrame(4.6)]);
        l.stars = [{ sourceId: 'no-motion', ...gridPixToSky(grid, { x: 16, y: 15 }), g: 15, epochJyear: 2016, pmRa: NaN, pmDec: NaN, pix: { x: 16, y: 15 } }];
        const method = falseColourView(s, l, radii).parts.method;
        expect(method).toContain('1 of the Gaia stars this page loads lies inside that circle, 6.2″ from the centre');
        expect(method).not.toContain('none of the Gaia stars');
    });
});

describe('round 9c: fixes from the second review of round 9', () => {
    it('says what a brightest point that moves between frames may mean', () => {
        const g = { ...grid, pixelArcsec: 4 };
        const make = (lambda: number, xs: number[]) => xs.map((x, i) => {
            const f = sourceFrame(lambda, x, 1000);
            return { ...f, grid: g, frame: { ...f.frame, tMin: 60000 + [0, 1, 200][i]!, tMax: 60000.001 + [0, 1, 200][i]! } };
        });
        const reading = falseColourView({ ...sky(make(1.25, [15, 15, 15])), grid: g }, { ...sky(make(4.6, [14, 14, 16])), grid: g }, radii).parts.reading;
        expect(reading).toBe('At the centre: seen at 1.25 µm (signal-to-noise 27); seen at 4.60 µm (signal-to-noise 27; its brightest point sits in different places in different frames, so it may be a moving source, more than one source or a detector hit).');
    });

    it('places a Gaia star from its sky position when its saved pixel is unusable', () => {
        const s = sky([sourceFrame(1.25)]);
        const l = sky([sourceFrame(4.6)]);
        l.stars = [{ sourceId: 'no-pix', ...gridPixToSky(grid, { x: 15, y: 15 }), g: 15, epochJyear: 2016, pmRa: 0, pmDec: 0, pix: { x: NaN, y: NaN } }];
        const method = falseColourView(s, l, radii).parts.method;
        expect(method).toContain('1 of the Gaia stars this page loads lies inside that circle');
        expect(method).not.toContain('none of the Gaia stars');
        expect(method).not.toContain('could not be placed');
    });

    it('never says "none" about a Gaia star it could not place', () => {
        const s = sky([sourceFrame(1.25)]);
        const l = sky([sourceFrame(4.6)]);
        l.stars = [{ sourceId: 'nowhere', ra: NaN, dec: NaN, g: 15, epochJyear: 2016, pmRa: 0, pmDec: 0, pix: { x: NaN, y: NaN } }];
        const method = falseColourView(s, l, radii).parts.method;
        expect(method).toContain('none of the Gaia stars this page could place lies inside that circle');
        expect(method).toContain('1 of the stars on that list could not be placed in this picture, so it may be inside too.');
        expect(method).not.toContain('this page loads lies inside');
    });

    it('gives two weak frames at two dates one clause, not two', () => {
        const reading = falseColourView(sky(lookFrames([30, 30], [0, 200], 1.25)), sky(lookFrames([3, 3], [0, 200])), radii).parts.reading;
        expect(reading).toContain('seen at 4.60 µm');
        expect(reading).toContain('only 2 frames, and at least one of them alone is below 3 times the noise, so it is not clear at both dates; a moving source or two detector hits cannot be ruled out)');
        expect(reading).not.toContain('too weak');
        expect(reading.split('4.60 µm')[1]!.match(/, so /g)).toHaveLength(1);
    });

    it('does not call months of closely spaced frames one visit', () => {
        const read = (days: number[]) => falseColourView(sky(lookFrames(days.map(() => 30), days, 1.25)), sky(lookFrames(days.map(() => 30), days)), radii).parts.reading;
        const chained = read([0, 9, 18]);
        expect(chained).toContain('its 3 frames span 18 days with no gap of 10 days or more between them, so they are not counted as separate visits and something passing through or a detector effect cannot be ruled out');
        expect(chained).not.toContain('from one visit');
        expect(read([0, 4, 9])).toContain('all 3 frames come from one visit, so something passing through or a detector effect cannot be ruled out');
    });

    it('explains the position comparison when the only band it ran on is one whose frames differ', () => {
        const days = [0, 160, 360, 560];
        const result = falseColourView(sky(lookFrames([10], [0], 1.25)), sky(lookFrames([1.12, 1.29, 1177.54, 1689.28], days)), radii);
        expect(result.parts.reading).toContain('4.60 µm shows light that differs between frames');
        expect(result.parts.method).toContain('Position is compared only between frames with a signal-to-noise of at least 10.');
    });
});

describe('round 9c: fixes from the recheck of round 9b', () => {
    it('keeps the hedge when chained frames lean on one frame', () => {
        const days = [0, 5, 10];
        const reading = falseColourView(sky(lookFrames([30, 30, 30], days, 1.25)), sky(lookFrames([5.5, 1.9, 1.9], days)), radii).parts.reading;
        expect(reading).toContain('no clear signal at 4.60 µm');
    });

    it('says both when off-centre light also sits in different places in different frames', () => {
        const g = { ...grid, pixelArcsec: 4 };
        const make = (lambda: number, xs: number[]) => xs.map((x, i) => {
            const f = sourceFrame(lambda, x, 3000);
            return { ...f, grid: g, frame: { ...f.frame, tMin: 60000 + [0, 200, 400][i]!, tMax: 60000.001 + [0, 200, 400][i]! } };
        });
        const reading = falseColourView({ ...sky(make(1.25, [17, 17, 13])), grid: g }, { ...sky(make(4.6, [15, 15, 15])), grid: g }, radii).parts.reading;
        // 16″ between the frames' brightest points, and the combined picture is brightest away from the centre.
        expect(reading).toBe('At the centre: 1.25 µm shows light here that is brightest 8.00″ from the centre in the combined picture, and its brightest point sits in different places in different frames; it may be a moving source, a neighbouring one or a detector hit, and it is not counted as seen at the centre; seen at 4.60 µm (signal-to-noise 80).');
        // 8″ between them: still no remark about coarse pixels, because the combined picture itself is off the centre.
        const near = falseColourView({ ...sky(make(1.25, [17, 17, 15])), grid: g }, { ...sky(make(4.6, [15, 15, 15])), grid: g }, radii).parts.reading;
        expect(near).toBe('At the centre: 1.25 µm shows light here that is brightest 8.00″ from the centre in the combined picture, and its brightest point sits in different places in different frames; it may be a moving source, a neighbouring one or a detector hit, and it is not counted as seen at the centre; seen at 4.60 µm (signal-to-noise 80).');
    });

    it('keeps the entry that can be placed when a star is listed twice', () => {
        const s = sky([sourceFrame(1.25)]);
        const l = sky([sourceFrame(4.6)]);
        const good = { sourceId: 'twice', ...gridPixToSky(grid, { x: 15, y: 15 }), g: 15, epochJyear: 2016, pmRa: 0, pmDec: 0, pix: { x: 15, y: 15 } };
        s.stars = [{ ...good, ra: NaN, dec: NaN, pix: { x: NaN, y: NaN } }];
        l.stars = [good];
        const method = falseColourView(s, l, radii).parts.method;
        expect(method).toContain('1 of the Gaia stars this page loads lies inside that circle');
        expect(method).not.toContain('could not be placed');
    });

    it('places a star at its catalogue position when no frame date and no saved pixel can be used', () => {
        const undated = (lambda: number) => lookFrames([30], [NaN], lambda);
        const s = sky(undated(1.25));
        const l = sky(undated(4.6));
        l.stars = [{ sourceId: 'undated', ...gridPixToSky(grid, { x: 15, y: 15 }), g: 15, epochJyear: 2016, pmRa: 5000, pmDec: 0, pix: { x: NaN, y: NaN } }];
        const method = falseColourView(s, l, radii).parts.method;
        expect(method).toContain('1 of the Gaia stars this page loads lies inside that circle');
        expect(method).not.toContain('could not be placed');
    });
});

it('never prints index in any reading produced by the fixture and case helpers', () => {
    expect(readings.length).toBeGreaterThan(0);
    for (const reading of readings) {
        expect(reading).not.toMatch(/index/i);
    }
});

describe('round 9d: fixes from the review of round 9c', () => {
    const g3 = { ...grid, pixelArcsec: 3 };
    const r3 = { radius: 4, annulusIn: 5, annulusOut: 7 };
    const dated = (lambda: number, xs: number[], levels: number[], days: number[], g = g3) => xs.map((x, i) => {
        const f = sourceFrame(lambda, x, levels[i]!);
        return { ...f, grid: g, frame: { ...f.frame, tMin: 60000 + days[i]!, tMax: 60000.001 + days[i]! } };
    });
    const view = (s: RegriddedFrame[], l: RegriddedFrame[], g = g3, r = r3) => falseColourView({ ...sky(s), grid: g }, { ...sky(l), grid: g }, r).parts;

    it('says where changing light is when it is away from the centre', () => {
        const days = [0, 200, 400, 600];
        const reading = view(dated(1.25, [15, 15, 15, 15], [2000, 2000, 2000, 2000], days), dated(4.6, [18, 18, 18, 18], [2000, 2000, 2000, 8000], days)).reading;
        expect(reading).toContain('it may have changed or moved, or be a detector effect; it is brightest 9.00″ from the centre, so it may belong to a neighbouring source');
    });

    it.each([2000, 8000, 40000])('prints no distance when 2 frames show the light at different places (level %i)', (level) => {
        const reading = view(dated(1.25, [15, 15], [2000, 2000], [0, 200]), dated(4.6, [13, 17], [level, level], [0, 200])).reading;
        expect(reading).not.toContain('12.00″');
        expect(reading).toContain('4.60 µm shows a signal in 2 of 2 frames but not in the combined picture');
        expect(reading).not.toContain('seen at 4.60 µm');
    });

    it('takes the pixel nearest the centre when a frame has two equally bright pixels', () => {
        const g = { ...grid, pixelArcsec: 4 };
        const days = [0, 200, 400];
        const frames = dated(4.6, [15, 15, 15], [3000, 3000, 3000], days, g);
        // The third frame has an equal pixel 8″ away, inside the circle, that is scanned before the centre one.
        frames[2]!.data[15 * 31 + 13] = frames[2]!.data[15 * 31 + 15]!;
        frames[0]!.data[15 * 31 + 13] = frames[0]!.data[15 * 31 + 15]! - 1;
        frames[1]!.data[15 * 31 + 13] = frames[1]!.data[15 * 31 + 15]! - 1;
        const reading = view(dated(1.25, [15, 15, 15], [3000, 3000, 3000], days, g), frames, g, radii).reading;
        expect(reading).toContain('4.60 µm');
        expect(reading).not.toContain('different places');
    });

    it('prints the position sentence only when the comparison ran', () => {
        // The 4.60 µm band fails the frame-by-frame check, so no positions were compared in it; 1.25 µm has one frame.
        const parts = falseColourView(sky([sourceFrame(1.25)]), sky(lookFrames([100, 1, 100, 1], [360, 0, 366, 190])), radii).parts;
        expect(parts.reading).toContain('without the 2 frames of its strongest visit, so it is not counted as seen');
        expect(parts.method).not.toContain('Position is compared');
    });

    it('prints the visit sentence only for a measurable band with 2 or more frames', () => {
        const blank = dated(4.6, [15, 15], [100, 100], [0, 1]);
        blank.forEach(f => { f.data[15 * 31 + 15] = NaN; });
        const parts = view(dated(1.25, [15], [100], [0]), blank);
        expect(parts.method).not.toContain('count as one visit');
    });

    it('places an undated star at its saved pixel before its catalogue position', () => {
        const undated = (lambda: number) => lookFrames([30], [NaN], lambda);
        const s = sky(undated(1.25));
        const l = sky(undated(4.6));
        l.stars = [{ sourceId: 'saved', ...gridPixToSky(grid, { x: 25, y: 25 }), g: 15, epochJyear: 2016, pmRa: 0, pmDec: 0, pix: { x: 15, y: 15 } }];
        const method = falseColourView(s, l, radii).parts.method;
        expect(method).toContain('1 of the Gaia stars this page loads lies inside that circle');
    });

    it('does not place disjoint weak peaks removed from the combined picture', () => {
        const weak = lookFrames([5, 5], [0, 200]);
        for (let i = 0; i < 2; i++) {
            weak[i]!.data[15 * 31 + (i ? 17 : 13)] = weak[i]!.data[15 * 31 + 15]!;
            weak[i]!.data[15 * 31 + 15] = 0;
        }
        const reading = falseColourView(sky(lookFrames([5, 5], [0, 200], 1.25)), sky(weak), radii).parts.reading;
        expect(reading).toContain('4.60 µm shows a signal in 2 of 2 frames but not in the combined picture');
    });

    it('drops the coarse-pixel excuse from a seen band when the gap is too wide for it', () => {
        const days = [0, 200, 400];
        const g = { ...grid, pixelArcsec: 4 };
        const wide = view(dated(1.25, [15, 15, 15], [3000, 3000, 3000], days, g), dated(4.6, [15, 15, 19], [3000, 3000, 3000], days, g), g, { radius: 4, annulusIn: 5, annulusOut: 7 }).reading;
        expect(wide).toBe('At the centre: seen at 1.25 µm (signal-to-noise 32); seen at 4.60 µm (signal-to-noise 32; its brightest point sits in different places in different frames, so it may be a moving source, more than one source or a detector hit).');
    });
});

describe('round 9e: the two-frame rule after the reviews of round 9d', () => {
    const gridOf = (pixelArcsec: number): OutputGrid => ({ ...grid, pixelArcsec });
    const wide = { radius: 4, annulusIn: 5, annulusOut: 7 };
    const dated = (lambda: number, xs: number[], levels: number[], days: number[], g: OutputGrid) => xs.map((x, i) => {
        const f = sourceFrame(lambda, x, levels[i]!);
        return { ...f, grid: g, frame: { ...f.frame, tMin: 60000 + days[i]!, tMax: 60000.001 + days[i]! } };
    });
    const read = (s: RegriddedFrame[], l: RegriddedFrame[], g: OutputGrid, r = radii) => falseColourView({ ...sky(s), grid: g }, { ...sky(l), grid: g }, r).parts.reading;
    const long = (reading: string) => reading.slice(reading.indexOf('4.60 µm') < reading.indexOf('seen at 4.60 µm') || !reading.includes('seen at 4.60 µm') ? reading.indexOf('4.60 µm') : reading.indexOf('seen at 4.60 µm'));
    const NOT_COUNTED = '4.60 µm shows a signal in 2 of 2 frames but not in the combined picture, which leaves out values that stand out in only some frames, so it is not counted as seen (chance noise alone can do this; it may have changed or moved, or be detector hits)';

    it('does not count spread-out light 9″ either side of the centre in 2 strong frames as seen', () => {
        // Each frame holds one source about 8″ wide (FWHM), 9″ west in one and 9″ east in the other. Their edges
        // overlap at the centre, which round 9d read as light shared by both frames and counted as seen.
        const g = gridOf(3);
        const blob = (lambda: number, x0: number, day: number) => {
            const f = frame(lambda, 60000 + day, 60000.001 + day);
            for (let y = 0; y < 31; y++) {
                for (let x = 0; x < 31; x++) {
                    f.data[y * 31 + x] = f.data[y * 31 + x]! + 5000 * Math.exp(-((x - x0) ** 2 + (y - 15) ** 2) / (2 * 1.13 ** 2));
                }
            }
            return { ...f, grid: g };
        };
        const reading = read([blob(1.25, 15, 0), blob(1.25, 15, 200)], [blob(4.6, 12, 0), blob(4.6, 18, 200)], g, wide);
        expect(long(reading)).toContain('its two frames do not agree on where it is brightest');
        expect(long(reading)).toContain('not counted as seen at the centre');
    });

    it('screens two frames with different bright pixels before judging their places', () => {
        const g = gridOf(4);
        const reading = read(dated(1.25, [15, 15], [2000, 2000], [0, 200], g), dated(4.6, [14, 16], [2000, 2000], [0, 200], g), g);
        expect(long(reading)).toBe(`${NOT_COUNTED}.`);
    });

    it('screens differing bright pixels on either side of the old placement limit', () => {
        // 2″ pixels: the limit is 6.15″ + 2″ = 8.15″. 4 pixels apart is 8″, inside it; 5 pixels is 10″, past it,
        // although neither frame is brightest more than 6.15″ from the centre.
        const g = gridOf(2);
        const s = dated(1.25, [15, 15], [2000, 2000], [0, 200], g);
        const at = long(read(s, dated(4.6, [13, 17], [2200, 2000], [0, 200], g), g, wide));
        expect(at).toBe(`${NOT_COUNTED}.`);
        for (const levels of [[2200, 2000], [2000, 2200]]) {
            expect(long(read(s, dated(4.6, [12, 17], levels, [0, 200], g), g, wide))).toBe(`${NOT_COUNTED}.`);
        }
        // 6.15″ pixels, one pixel either side: the gap equals the limit and each frame is exactly 6.15″ out.
        const edge = gridOf(6.15);
        const equal = long(read(dated(1.25, [15, 15], [2000, 2000], [0, 200], edge), dated(4.6, [14, 16], [2200, 2000], [0, 200], edge), edge, wide));
        expect(equal).toBe(`${NOT_COUNTED}.`);
    });

    it('measures 3 frames from the middle of them and offers them no coarse-pixel remark', () => {
        const g = gridOf(2);
        const days = [0, 200, 400];
        const s = dated(1.25, [15, 15, 15], [3000, 3000, 3000], days, g);
        // 4″ either side of the middle frame: the widest pair is 8″ apart, but no frame is more than 6.15″ from the middle.
        const even = read(s, dated(4.6, [13, 15, 17], [3000, 3000, 3000], days, g), g, wide);
        expect(even).toContain('4.60 µm shows a signal in 3 of 3 frames but not in the combined picture');
        // Two frames agree and the third is 8″ from them: that frame is the odd one out.
        const odd = read(s, dated(4.6, [13, 13, 17], [3000, 3000, 3000], days, g), g, wide);
        expect(long(odd)).toContain('its brightest point sits in different places in different frames, so it may be a moving source, more than one source or a detector hit).');
        expect(odd).not.toContain('does not move');
        const past = read(s, dated(4.6, [12, 12, 17], [3000, 3000, 3000], days, g), g, wide);
        expect(long(past)).toContain('its brightest point sits in different places in different frames, so it may be a moving source, more than one source or a detector hit).');
        expect(past).not.toContain('does not move');
    });

    it('measures 4 frames from the point midway between the middle two', () => {
        const g = gridOf(2);
        const days = [0, 200, 400, 600];
        const s = dated(1.25, [15, 15, 15, 15], [3000, 3000, 3000, 3000], days, g);
        // Middle of 13, 14, 16, 17 is 15: the farthest frame is 4″ from it, and the widest pair is 8″ apart.
        expect(read(s, dated(4.6, [17, 13, 16, 14], [3000, 3000, 3000, 3000], days, g), g, wide)).not.toContain('different places');
        // Middle of 13, 13, 14, 18 is 13.5: the last frame is 9″ from it.
        expect(long(read(s, dated(4.6, [13, 18, 14, 13], [3000, 3000, 3000, 3000], days, g), g, wide))).toContain('its brightest point sits in different places in different frames, so it may be a moving source, more than one source or a detector hit).');
    });

    it('offers no remark for 3 frames when one of them is brightest more than 6.15″ from the centre', () => {
        // The gap is 8″, inside the limit, but the third frame is brightest 8″ out: a still source at the centre cannot do that.
        const g = gridOf(2);
        const days = [0, 200, 400];
        const s = dated(1.25, [15, 15, 15], [3000, 3000, 3000], days, g);
        const reading = long(read(s, dated(4.6, [15, 15, 19], [3000, 3000, 3000], days, g), g, wide));
        expect(reading).toContain('seen at 4.60 µm (');
        expect(reading).toContain('its brightest point sits in different places in different frames, so it may be a moving source, more than one source or a detector hit).');
        expect(reading).not.toContain('does not move');
    });

    it('finds the odd frame out of 3 whatever their order', () => {
        const g = gridOf(4.35);
        const days = [0, 200, 400];
        const s = dated(1.25, [15, 15, 15], [3000, 3000, 3000], days, g);
        for (const xs of [[18, 14, 14], [14, 18, 14], [14, 14, 18]]) {
            expect(long(read(s, dated(4.6, xs, [3000, 3000, 3000], days, g), g, wide))).toContain('its brightest point sits in different places in different frames, so it may be a moving source, more than one source or a detector hit).');
        }
        // One pixel (4.35″) either side of the middle frame, in any order: 8.70″ between the outer two, but nothing odd.
        for (const xs of [[14, 15, 16], [16, 14, 15], [15, 16, 14]]) {
            expect(read(s, dated(4.6, xs, [3000, 3000, 3000], days, g), g, wide)).not.toContain('different places');
        }
    });

    it('speaks of different places only past one detector pixel', () => {
        const days = [0, 200, 400];
        const one = (pixelArcsec: number) => {
            const g = gridOf(pixelArcsec);
            return read(dated(1.25, [15, 15, 15], [3000, 3000, 3000], days, g), dated(4.6, [15, 15, 16], [3000, 3000, 3000], days, g), g);
        };
        expect(one(6.15)).not.toContain('different places');
        // One frame is then brightest 6.16″ from the centre, so the remark about a still source is not offered.
        expect(one(6.16)).toContain('its brightest point sits in different places in different frames, so it may be a moving source, more than one source or a detector hit).');
    });

    it('gives mirror-image pairs of unequal frames the same sentence, with no remark about coarse pixels', () => {
        const g = gridOf(3);
        const s = dated(1.25, [15, 15], [2000, 2000], [0, 200], g);
        const a = long(read(s, dated(4.6, [13, 17], [2000, 8000], [0, 200], g), g, wide));
        const b = long(read(s, dated(4.6, [13, 17], [8000, 2000], [0, 200], g), g, wide));
        expect(a).toBe(`${NOT_COUNTED}.`);
        expect(b).toBe(a);
    });

    it('prints no distance for changing light whose 2 frames are far apart, even when the combined picture is off the centre', () => {
        const g = gridOf(3);
        const s = dated(1.25, [15, 15], [2000, 2000], [0, 200], g);
        const reading = long(read(s, dated(4.6, [13, 18], [2000, 8000], [0, 200], g), g, wide));
        expect(reading).toBe(`${NOT_COUNTED}.`);
    });

    it('reads changing light with one frame at the centre and one 8″ out the same way whichever is brighter, with no remark', () => {
        const g = gridOf(4);
        const s = dated(1.25, [15, 15], [2000, 2000], [0, 200], g);
        const CHANGING = `${NOT_COUNTED}.`;
        expect(long(read(s, dated(4.6, [15, 17], [1000, 4000], [0, 200], g), g))).toBe(CHANGING);
        expect(long(read(s, dated(4.6, [15, 17], [4000, 1000], [0, 200], g), g))).toBe(CHANGING);
    });
});

describe('round 9f: the two-frame rule after the reviews of round 9e', () => {
    const gridOf = (pixelArcsec: number): OutputGrid => ({ ...grid, pixelArcsec });
    const wide = { radius: 4, annulusIn: 5, annulusOut: 7 };
    const broad = { radius: 8, annulusIn: 9, annulusOut: 13 };
    const dated = (lambda: number, xs: number[], levels: number[], days: number[], g: OutputGrid) => xs.map((x, i) => {
        const f = sourceFrame(lambda, x, levels[i]!);
        return { ...f, grid: g, frame: { ...f.frame, tMin: 60000 + days[i]!, tMax: 60000.001 + days[i]! } };
    });
    const read = (s: RegriddedFrame[], l: RegriddedFrame[], g: OutputGrid, r = radii) => falseColourView({ ...sky(s), grid: g }, { ...sky(l), grid: g }, r).parts.reading;
    const long = (reading: string) => reading.slice(reading.indexOf('4.60 µm') < reading.indexOf('seen at 4.60 µm') || !reading.includes('seen at 4.60 µm') ? reading.indexOf('4.60 µm') : reading.indexOf('seen at 4.60 µm'));
    const NOT_COUNTED = '4.60 µm shows a signal in 2 of 2 frames but not in the combined picture, which leaves out values that stand out in only some frames, so it is not counted as seen (chance noise alone can do this; it may have changed or moved, or be detector hits)';

    const NO_READING = (shown: string) => `No reading is given at the centre of this view: each pixel of the picture is ${shown}″ wide, too coarse to tell light at the centre from light beside it. Choose a narrower view for a reading.`;
    const DISCLAIMER = 'The colours in the picture are for looking; this page does not measure a colour.';
    const gated = (s: RegriddedFrame[], l: RegriddedFrame[], g: OutputGrid, r = wide) => makeFalseColourView({ ...sky(s), grid: g }, { ...sky(l), grid: g }, r);

    it('gives no reading at the centre on the 0.5° and 1° views, whose pixels are too coarse to place the light', () => {
        // The page's 0.5° view has 2.4965″ pixels and its 1° view 4.9931″ pixels.
        for (const [px, shown] of [[2.4965, '2.50'], [4.9931, '4.99']] as const) {
            const g = gridOf(px);
            const out = gated(dated(1.25, [15, 15], [2000, 2000], [0, 200], g), dated(4.6, [15, 15], [2000, 2000], [0, 200], g), g);
            expect(out.parts.reading).toBe(NO_READING(shown));
            expect(out.parts.method).toBe(DISCLAIMER);
            expect(out.sentence).toContain(NO_READING(shown));
            expect(out.sentence).not.toContain('At the centre:');
            expect(out.sentence).not.toContain('seen at');
            expect(out.sentence).not.toContain('signal-to-noise');
        }
    });

    it('gives no reading for light one coarse pixel either side of the centre on the 1° view (review of round 9e)', () => {
        // Light 8″ either side lands on the pixels 4.99″ either side, so the two frames look 9.99″ apart, not 16″.
        const g = gridOf(4.9931);
        const s = dated(1.25, [15, 15], [2000, 2000], [0, 200], g);
        const l = dated(4.6, [14, 16], [2200, 2000], [0, 200], g);
        // With the gate lifted the disjoint peaks are removed by the pair combination.
        const lifted = long(read(s, l, g, wide));
        expect(lifted).toBe(`${NOT_COUNTED}.`);
        expect(gated(s, l, g).parts.reading).toBe(NO_READING('4.99'));
    });

    it('keeps the reading on the 0.1° and 0.25° views (1.5375″ pixels), and draws the line just above 1.6″', () => {
        for (const px of [1.5375, 1.6]) {
            const g = gridOf(px);
            const s = dated(1.25, [15, 15], [20000, 20000], [0, 200], g);
            const l = dated(4.6, [15, 15], [20000, 20000], [0, 200], g);
            const out = gated(s, l, g, broad);
            expect(out.parts.reading).toBe(read(s, l, g, broad));
            expect(out.parts.reading.startsWith('At the centre: ')).toBe(true);
            expect(out.parts.method).not.toBe(DISCLAIMER);
        }
        const g = gridOf(1.61);
        expect(gated(dated(1.25, [15, 15], [20000, 20000], [0, 200], g), dated(4.6, [15, 15], [20000, 20000], [0, 200], g), g, broad).parts.reading).toBe(NO_READING('1.61'));
    });

    it('still paints the picture and keeps the labels when no reading is given', () => {
        const g = gridOf(4.9931);
        const s = dated(1.25, [15, 15], [2000, 2000], [0, 200], g);
        const l = dated(4.6, [15, 15], [2000, 2000], [0, 200], g);
        const out = gated(s, l, g);
        const liftedOut = falseColourView({ ...sky(s), grid: g }, { ...sky(l), grid: g }, wide);
        expect(Array.from(out.rgba)).toEqual(Array.from(liftedOut.rgba));
        expect(out.parts.labels).toBe(liftedOut.parts.labels);
        expect(out.parts.note).toBe(liftedOut.parts.note);
        expect(out.parts.warning).toBe(liftedOut.parts.warning);
    });

    it('places a frame only when its own signal-to-noise reaches 10', () => {
        // Three frames at 4″ per pixel: two with light 4″ left of the centre, the third with light 4″ right of it. The
        // third counts as a place only at a signal-to-noise of 10 or more; below that the other two agree.
        const g = gridOf(4);
        const spot = (x: number, snr: number, seed: number, day: number): RegriddedFrame => {
            const f = measuredFrame(4.6, 0, seed);
            const at = 15 * 31 + x;
            f.data[15 * 31 + 15] = 0;
            f.data[at] = 0;
            const ap = aperture(f.data, 31, 31, { x: 15, y: 15 }, { ...radii, noiseScale: resampleNoiseScale(g.pixelArcsec) });
            f.data[at] = snr * ap.noise - ap.sum;
            return { ...f, grid: g, frame: { ...f.frame, tMin: 60000 + day, tMax: 60000.001 + day } };
        };
        const short = lookFrames([30, 30, 30], [0, 1, 200], 1.25).map(f => ({ ...f, grid: g }));
        const reading = (third: number) => read(short, [spot(14, 12, 91, 0), spot(14, 12, 197, 1), spot(16, third, 311, 200)], g);
        const placed = 'At the centre: seen at 1.25 µm (signal-to-noise 26); seen at 4.60 µm (signal-to-noise 15; its brightest point sits in different places in different frames, so it may be a moving source, more than one source or a detector hit).';
        expect(reading(12)).toBe(placed);
        expect(reading(10.01)).toBe(placed);
        expect(reading(9.99)).toBe('At the centre: seen at both wavelengths (signal-to-noise 26 at 1.25 µm and 15 at 4.60 µm).');
    });

    it('does not count a source at the centre in one frame and 9.23″ away in the other, whichever frame is brighter', () => {
        // The page's own 1.5375″ pixels: 6 pixels is 9.23″. Round 9e read this as seen, or as 9.23″ off, by a 1% difference.
        const g = gridOf(1.5375);
        const s = dated(1.25, [15, 15], [20000, 20000], [0, 200], g);
        for (const levels of [[20000, 20200], [20200, 20000], [20000, 20000]]) {
            expect(long(read(s, dated(4.6, [15, 21], levels, [0, 200], g), g, broad))).toBe(`${NOT_COUNTED}.`);
        }
    });

    it('does not count a gap a still source can give when one frame is brightest more than 6.15″ from the centre', () => {
        // 5 pixels is 7.69″, exactly the limit (6.15″ + 1.5375″), but the second frame is brightest 7.69″ from the centre.
        const g = gridOf(1.5375);
        const s = dated(1.25, [15, 15], [20000, 20000], [0, 200], g);
        for (const levels of [[20000, 20200], [20200, 20000]]) {
            expect(long(read(s, dated(4.6, [15, 20], levels, [0, 200], g), g, broad))).toBe(`${NOT_COUNTED}.`);
        }
        // The same gap either side of the centre (3.08″ and 4.61″ out) is one a still source can give.
        const near = long(read(s, dated(4.6, [13, 18], [20200, 20000], [0, 200], g), g, broad));
        expect(near).toBe(`${NOT_COUNTED}.`);
    });

    it('keeps the distance for 2 frames that agree on a place away from the centre', () => {
        const g = gridOf(4);
        const s = dated(1.25, [15, 15], [2000, 2000], [0, 200], g);
        expect(long(read(s, dated(4.6, [17, 17], [2000, 2000], [0, 200], g), g))).toBe('4.60 µm shows light here that is brightest 8.00″ from the centre, so it may belong to a neighbouring source and is not counted as seen at the centre.');
    });

    it('does not list a moving source and detector hits twice for 2 frames from one visit', () => {
        const g = gridOf(4);
        const reading = long(read(dated(1.25, [15, 15], [2000, 2000], [0, 1], g), dated(4.6, [14, 16], [2000, 2000], [0, 1], g), g));
        expect(reading).toBe(`${NOT_COUNTED}.`);
    });

    it('adds only what is new for 3 frames from one visit whose brightest points are far apart', () => {
        const g = gridOf(2);
        const days = [0, 1, 2];
        const reading = long(read(dated(1.25, [15, 15, 15], [3000, 3000, 3000], days, g), dated(4.6, [12, 12, 17], [3000, 3000, 3000], days, g), g, wide));
        expect(reading).toContain('all 3 frames come from one visit, so something passing through or a detector effect cannot be ruled out; its brightest point sits in different places in different frames, so it may also be more than one source).');
    });
});

describe('round 9g: tests for two untested edits', () => {
    const g = { ...grid, pixelArcsec: 1.6 };
    const wide = { radius: 4, annulusIn: 5, annulusOut: 7 };
    const dated = (lambda: number, xs: number[], levels: number[], days: number[]) => xs.map((x, i) => {
        const f = sourceFrame(lambda, x, levels[i]!);
        return { ...f, grid: g, frame: { ...f.frame, tMin: 60000 + days[i]!, tMax: 60000.001 + days[i]! } };
    });
    const NOTE = 'False colour, not what an eye would see. Both pictures share one brightness scale after each '
        + "one's own sky level is taken off: blue means brighter at the shorter wavelength, orange means brighter at the "
        + 'longer one, grey means about the same. Coloured rims around bright stars can come from the two pictures not '
        + "being equally sharp. Each frame's middle value is taken off as sky, so a glow that fills most of the view can be removed with it. "
        + 'Hatched areas have no colour: the frames do not all cover them. The grey picture shows through the hatching. '
        + 'With 3 or more frames at 1.25 µm and 4.60 µm, the middle value of the '
        + 'frames is used at each pixel, so something present in fewer than half of the frames is missing from this '
        + 'picture, and something present in most of them looks steady.';
    const METHOD = 'The reading adds up a small circle of pixels and takes off the sky just around it, so it need not '
        + 'match the tint of the middle pixels. Frames taken less than 10 days apart count as one visit. Position is '
        + 'compared only between frames with a signal-to-noise of at least 10. The reading adds up all light within '
        + '6.4″ of the centre; none of the Gaia stars this page loads lies inside that circle. That list holds only the '
        + 'brighter stars, so a fainter star or a source seen only in infrared can still be inside. The colours in the '
        + 'picture are for looking; this page does not measure a colour.';

    // The per-pixel median now removes all four disjoint peaks before their positions can be compared.
    it('does not read disjoint peaks removed by the four-frame median', () => {
        const days = [0, 30, 60, 100];
        const s = dated(1.25, [15, 15, 15, 15], [4700, 4700, 4700, 4700], days);
        const l = dated(4.6, [17, 12, 18, 13], [4700, 4700, 4700, 4700], days);
        const out = falseColourView({ ...sky(s), grid: g }, { ...sky(l), grid: g }, wide);
        const expected = {
            labels: 'Blue: 1.25 µm (the shorter wavelength), 4 frames, 2023-02-25 to 2023-06-05. Orange: 4.60 µm (the longer wavelength), 4 frames, 2023-02-25 to 2023-06-05.',
            note: NOTE,
            warning: '',
            reading: 'At the centre: seen at 1.25 µm (signal-to-noise 20); 4.60 µm shows a signal in 4 of 4 frames but not in the combined picture, which leaves out values that stand out in only some frames, so it is not counted as seen (it may have changed or moved, or be detector hits).',
            method: METHOD,
        };
        expect(out.parts).toEqual(expected);
        expect(out.sentence).toBe(`${expected.labels} ${expected.note} ${expected.reading} ${expected.method}`);
    });

    // Two peaks pass SNR 10 while the third does not; their 6.4″ gap exceeds the new two-placed-frame limit.
    it('refuses two placed frames among three at 6.4″ separation', () => {
        const days = [0, 50, 100];
        const s = dated(1.25, [15, 15, 15], [4700, 4700, 4700], days);
        const l = dated(4.6, [15, 19, 15], [2800, 2800, 2100], days);
        const out = falseColourView({ ...sky(s), grid: g }, { ...sky(l), grid: g }, wide);
        const expected = {
            labels: 'Blue: 1.25 µm (the shorter wavelength), 3 frames, 2023-02-25 to 2023-06-05. Orange: 4.60 µm (the longer wavelength), 3 frames, 2023-02-25 to 2023-06-05.',
            note: NOTE,
            warning: '',
            reading: 'At the centre: seen at 1.25 µm (signal-to-noise 20); 4.60 µm shows light here, but the two frames strong enough to place it do not agree on where it is brightest, so it may be a moving source, a neighbouring one or a detector hit, and it is not counted as seen at the centre.',
            method: METHOD,
        };
        expect(out.parts.reading).not.toContain('which can happen even when the source does not move');
        expect(out.parts).toEqual(expected);
        expect(out.sentence).toBe(`${expected.labels} ${expected.note} ${expected.reading} ${expected.method}`);
    });
});
