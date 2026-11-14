import { describe, expect, it, vi } from 'vitest';
import { chooseColourFrames, colourParts as makeColourParts, colourSentence as makeColourSentence, falseColourView as makeFalseColourView } from '../src/lib/falsecolour-view';
import { colourAt, falseColourRgba, FalseColourError, pairStretch, type ColourAt } from '../src/lib/falsecolour';
import { stackVisit } from '../src/lib/stack';
import * as stack from '../src/lib/stack';
import { aperture, resampleNoiseScale } from '../src/lib/photometry';
import { gridPixToSky } from '../src/lib/regrid';
import type { SkyResult } from '../src/lib/source';
import type { OutputGrid, RegriddedFrame } from '../src/lib/types';
import text from '../src/lib/falsecolour-view.ts?raw';
import slotText from '../src/ui/slots.ts?raw';

declare const process: { env: Record<string, string | undefined> };
const both: ColourAt = { short: 4, long: 10, snrShort: 14.3, snrLong: 30.7, index: 0.423, seen: 'both', valid: true };
const grid: OutputGrid = { center: { ra: 1, dec: 2 }, fovDeg: 0.1, pixelArcsec: 6.15, width: 31, height: 31 };
const radii = { radius: 2, annulusIn: 4, annulusOut: 7 };
const readings: string[] = [];
// One visit of six frames that agree within noise, yet lean on the first (an input from the round 9 review).
const ONE_VISIT_LEANING = [4.5, 1.25, 1.25, 1.25, 1.25, 1.25];

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
    const result = makeFalseColourView(...args);
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
        expect(reading).toContain('but without its strongest visit the rest is below 3 times the noise, so it could not be confirmed at a second date');
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
        expect(reading).not.toContain('could not be confirmed');
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

    it('keeps a faint steady source in two visits at about eight sigma', () => {
        const values = [3.3, 3.3, 3.3, 3.3];
        const days = [0, 3, 200, 203];
        const reading = falseColourView(sky(lookFrames(values, days, 1.25)), sky(lookFrames(values, days)), radii).parts.reading;
        expect(reading).toMatch(/seen at (?:both wavelengths|1\.25 µm)/);
        expect(reading).not.toContain('readings differ');
        expect(reading).not.toContain('one visit');
        expect(Number(reading.match(/signal-to-noise ([\d.]+)/)![1])).toBeGreaterThan(7.5);
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
        expect(weakReading).toContain('is not counted as seen at the centre');
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
        expect(result.parts.reading).toContain('differs between frames by more than a steady source would give');
        expect(result.parts.reading).not.toMatch(/index/i);
    });

    it('explains a brightness disagreement even if the other band is faint', () => {
        const frames = [sourceFrame(4.6, 15, 1000), sourceFrame(4.6, 15, 1000)];
        frames[0]!.data[15 * 31 + 17] = 5000;
        const reading = falseColourView(sky([frame(1.25)]), sky(frames), radii).parts.reading;
        expect(reading).toContain('differs between frames by more than a steady source would give');
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
        expect(reading).toContain('4.60 µm shows a signal that does not hold up');
        expect(reading).not.toMatch(/index/i);
    });

    it('checks all three frames even when the stack is clear', () => {
        const reading = falseColourView(sky([sourceFrame(1.25)]), sky(lookFrames([3, 1.8, 1.2], [0, 30, 60])), radii).parts.reading;
        expect(reading).toContain('4.60 µm shows a signal that falls below the limit');
        expect(reading).not.toMatch(/index/i);
    });

    it('rejects a one-frame source even when both frames are one look', () => {
        const reading = falseColourView(sky([sourceFrame(1.25)]), sky(lookFrames([30, 0], [0, 3])), radii).parts.reading;
        expect(reading).toContain('does not hold up without its strongest frame');
        expect(reading).not.toContain('seen at 4.60 µm');
    });

    it('withholds an index when equal sources move between two frames', () => {
        const g = { ...grid, pixelArcsec: 5 };
        const short = [sourceFrame(1.25, 15, 1000), sourceFrame(1.25, 15, 1000)].map(f => ({ ...f, grid: g }));
        const long = [sourceFrame(4.6, 13, 1000), sourceFrame(4.6, 17, 1000)].map(f => ({ ...f, grid: g }));
        const reading = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii).parts.reading;
        expect(reading).toContain('its brightest point sits in different places in different frames');
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
        expect(reading).toContain('differs between frames');
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
            expect(reading).toContain('differs between frames');
        }
    });

    it('distinguishes the two-frame minimum after removing each frame sky', () => {
        const g = { ...grid, pixelArcsec: 5 };
        const long = [sourceFrame(4.6, 15, 1000, 0), sourceFrame(4.6, 15, 1000, 10000)].map(f => ({ ...f, grid: g }));
        long[0]!.data[15 * 31 + 17] = 3000;
        long[0]!.data[15 * 31 + 14] = -3000;
        long[1]!.data[15 * 31 + 17] = 10000;
        long[1]!.data[15 * 31 + 14] = 10000;
        const short = [sourceFrame(1.25, 15, 1000), sourceFrame(1.25, 15, 1000)].map(f => ({ ...f, grid: g }));
        const reading = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii).parts.reading;
        expect(reading).not.toContain('brightest 10.00');
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
            .toContain('A pixel is painted only where every frame used for both colours covers it.');
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
        expect(reading).toContain('does not hold up without its strongest frame');
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

    it('uses the two-frame minimum to ignore a hit next to a centred source', () => {
        const g = { ...grid, pixelArcsec: 3.85 };
        const short = [sourceFrame(1.25, 15, 1000), sourceFrame(1.25, 15, 1000)].map(f => ({ ...f, grid: g }));
        const long = [sourceFrame(4.6, 15, 1000), sourceFrame(4.6, 15, 1000)].map(f => ({ ...f, grid: g }));
        long[0]!.data[15 * 31 + 17] = 5000;
        const result = falseColourView({ ...sky(short), grid: g }, { ...sky(long), grid: g }, radii);
        expect(result.parts.reading).not.toMatch(/index/i);
        expect(result.parts.reading).toContain('differs between frames');
        expect(result.parts.reading).not.toContain('brightest 7.70″ from the centre');
        expect(result.parts.reading).toContain('its brightest point sits in different places');
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
        expect(result.parts.note).toContain('With fewer than 3 frames at 4.60 µm');
        expect(result.parts.note).toContain('With 3 or more frames at 1.25 µm, a value that stands out in only one or a few of them may be left out there or averaged in');
        expect(result.parts.method).toContain("Each frame's middle value is taken off as sky");
        expect(result.parts.method).toContain('Frames taken less than 10 days apart count as one visit.');
    });

    it('warns that clipping may remove a flare among three frames', () => {
        const short = [sourceFrame(1.25, 15, 900), sourceFrame(1.25, 15, 900), sourceFrame(1.25, 15, 900)];
        const long = [sourceFrame(4.6, 15, 900), sourceFrame(4.6, 15, 900), sourceFrame(4.6, 15, 4500)];
        const result = falseColourView(sky(short), sky(long), radii);
        expect(result.parts.note).toContain('With 3 or more frames at 1.25 µm and 4.60 µm, a value that stands out in only one or a few of them may be left out there or averaged in, so something that flared or moved may be missing from this picture or look steady in it.');
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
        expect(result.parts.reading).toContain('4.60 µm shows a signal that does not hold up without its strongest frame, so it is not counted as seen');
        expect(result.parts.reading).not.toMatch(/index/i);
    });

    it('says nothing about where the light is for a band that is not counted as seen', () => {
        // A one-frame hit two pixels from the centre: the stack is clear, but only 1 of 2 frames agrees.
        const hit = frame(4.6);
        for (const i of [15 * 31 + 17, 16 * 31 + 17]) { hit.data[i] = 5000; }
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([hit, frame(4.6)]), radii);
        expect(result.parts.reading).toContain('4.60 µm shows a signal that does not hold up without its strongest frame, so it is not counted as seen');
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
        expect(result.parts.note).toContain('fewer than 3 frames');
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
        expect(nebula[0]).toBe(nebula[2]);
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
        expect(large.parts.method).toContain('a glow that fills most of the view can be removed with it');
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
        expect(result.parts.warning).toBe('');
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
        const calls = vi.spyOn(stack, 'stackVisit');
        const result = falseColourView(sky([full, edge]), sky([long]), radii);
        expect(calls).toHaveBeenCalledWith([maskedFull, edge], { background: 'median' });
        calls.mockRestore();
        expect(result.parts.labels).toContain('2 frames');
        expect(result.rgba).toEqual(falseColourRgba(expected, longShown, stretch.sShort, stretch.sLong));
    });

    it('compares time sets, ignoring duplicates within tolerance', () => {
        const duplicate = frame(1.2, 60000 + 0.5 / 86400);
        const same = falseColourView(sky([frame(1.2), duplicate]), sky([frame(4.6)]), radii);
        expect(same.parts.warning).toBe('');
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

    it('measures painted circles and leaves a missing circle pixel transparent', () => {
        const full = frame(1.2);
        const missing = frame(1.2);
        missing.data[15 * 31 + 15] = NaN;
        const result = falseColourView(sky([full, missing]), sky([frame(4.6)]), radii);
        expect(result.parts.reading).toContain('1.20 µm cannot be measured here (blank pixels)');
        expect(result.rgba[4 * (15 * 31 + 15) + 3]).toBe(0);
        expect(result.parts.note).toContain('A pixel is painted only where every frame used for both colours covers it.');
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

    it('averages without removing frame skies and masks missing pixels', () => {
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
        const expected = stackVisit([high, low], { clipSigma: Infinity, background: 'none' }).data;
        for (let i = 0; i < expected.length; i++) {
            if (!Number.isFinite(low.data[i])) { expected[i] = NaN; } else { expect(expected[i]).toBe(50); }
        }
        const longStack = stackVisit([long], { clipSigma: Infinity, background: 'none' }).data;
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
        expect(result.rgba[4 * (y * 31 + x) + 3]).toBe(0);
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
        const corrected = stackVisit([low, high], { clipSigma: Infinity, background: 'none' }).data;
        for (let i = 0; i < corrected.length; i++) {
            if (!Number.isFinite(high.data[i])) { corrected[i] = NaN; }
        }
        const correctedLong = stackVisit([long], { clipSigma: Infinity, background: 'none' }).data;
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
            note: oldParts.note + ' With fewer than 3 frames at 1.25 µm and 4.60 µm, a detector hit in a single frame cannot be rejected from the picture.',
            method: oldParts.method.replace(' The colours in the picture are for looking; this page does not measure a colour.', '') + " Each frame's middle value is taken off as sky, so a glow that fills most of the view can be removed with it. The reading adds up all light within 12.3″ of the centre; none of the Gaia stars this page loads lies inside that circle. That list holds only the brighter stars, so a fainter star or a source seen only in infrared can still be inside. The colours in the picture are for looking; this page does not measure a colour.",
        });
        expect(result.parts.warning).toBe('');
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
        expect(reading).toContain('all 6 frames come from one visit, so something passing through or a detector effect cannot be ruled out, and without its strongest frame the rest is below 3 times the noise)');
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
        expect(reading).toContain('seen at 4.60 µm');
        expect(reading).toContain('its brightest point sits in different places in different frames, so it may be a moving source or more than one source');
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
        expect(reading).toContain('only 2 frames, and at least one of them alone is below 3 times the noise, so it is not confirmed at a second date; a moving source or two detector hits cannot be ruled out)');
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
        expect(reading).toContain('seen at 4.60 µm (signal-to-noise 3.2, its 3 frames span 10 days with no gap of 10 days or more between them, so they are not counted as separate visits and something passing through or a detector effect cannot be ruled out, and without its strongest frame the rest is below 3 times the noise)');
    });

    it('says both when off-centre light also sits in different places in different frames', () => {
        const g = { ...grid, pixelArcsec: 4 };
        const make = (lambda: number, xs: number[]) => xs.map((x, i) => {
            const f = sourceFrame(lambda, x, 3000);
            return { ...f, grid: g, frame: { ...f.frame, tMin: 60000 + [0, 200, 400][i]!, tMax: 60000.001 + [0, 200, 400][i]! } };
        });
        const reading = falseColourView({ ...sky(make(1.25, [17, 17, 13])), grid: g }, { ...sky(make(4.6, [15, 15, 15])), grid: g }, radii).parts.reading;
        expect(reading).toContain('1.25 µm shows light here that is brightest 8.00″ from the centre and its brightest point sits in different places in different frames, so it may be a moving source or a neighbouring one and is not counted as seen at the centre');
        expect(reading).not.toContain('seen at 1.25 µm');
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
