import { describe, expect, it, vi } from 'vitest';
import { chooseColourFrames, colourParts, colourSentence, falseColourView } from '../src/lib/falsecolour-view';
import { colourAt, falseColourRgba, FalseColourError, pairStretch, type ColourAt } from '../src/lib/falsecolour';
import { stackVisit } from '../src/lib/stack';
import * as stack from '../src/lib/stack';
import { aperture } from '../src/lib/photometry';
import { gridPixToSky } from '../src/lib/regrid';
import type { SkyResult } from '../src/lib/source';
import type { OutputGrid, RegriddedFrame } from '../src/lib/types';
import text from '../src/lib/falsecolour-view.ts?raw';
import slotText from '../src/ui/slots.ts?raw';

const both: ColourAt = { short: 4, long: 10, snrShort: 14.3, snrLong: 30.7, index: 0.423, seen: 'both', valid: true };
const grid: OutputGrid = { center: { ra: 1, dec: 2 }, fovDeg: 0.1, pixelArcsec: 6.15, width: 31, height: 31 };
const radii = { radius: 2, annulusIn: 4, annulusOut: 7 };

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

describe('reliable colour readings', () => {
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
        expect(result.parts.reading).not.toMatch(/colour index [−+\d]/);
    });

    it('does not count a clear two-frame stack when only one frame agrees', () => {
        const hit = frame(4.6);
        for (const i of [15 * 31 + 15, 15 * 31 + 16, 16 * 31 + 15, 16 * 31 + 16]) { hit.data[i] = 5000; }
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([hit, frame(4.6)]), radii);
        expect(result.parts.reading).toContain('4.60 µm shows a signal in only 1 of 2 frames, so it is not counted as seen');
        expect(result.parts.reading).not.toMatch(/colour index [−+\d]/);
    });

    it('says nothing about where the light is for a band that is not counted as seen', () => {
        // A one-frame hit two pixels from the centre: the stack is clear, but only 1 of 2 frames agrees.
        const hit = frame(4.6);
        for (const i of [15 * 31 + 17, 16 * 31 + 17]) { hit.data[i] = 5000; }
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([hit, frame(4.6)]), radii);
        expect(result.parts.reading).toContain('4.60 µm shows a signal in only 1 of 2 frames, so it is not counted as seen');
        expect(result.parts.reading).not.toContain('brightest');
        expect(result.parts.reading).not.toContain('not centred');
    });

    it('reports zero agreeing frames when only their average crosses the threshold', () => {
        const first = sourceFrame(4.6, 15, 40);
        const second = sourceFrame(4.6, 15, 40);
        for (let i = 0; i < second.data.length; i++) {
            if (i !== 15 * 31 + 15) { second.data[i] = -second.data[i]! + 0.3 * first.data[i]!; }
        }
        const result = falseColourView(sky([sourceFrame(1.25), sourceFrame(1.25)]), sky([first, second]), radii);
        expect(result.parts.reading).toContain('4.60 µm shows a signal in only 0 of 2 frames, so it is not counted as seen');
    });

    it('keeps a real source in all three frames with its previous SNR within 1%', () => {
        const short = [sourceFrame(1.25), sourceFrame(1.25), sourceFrame(1.25)];
        const long = [sourceFrame(4.6), sourceFrame(4.6), sourceFrame(4.6)];
        const before = colourAt(stackVisit(short, { background: 'none', clipSigma: Infinity }).data, stackVisit(long, { background: 'none', clipSigma: Infinity }).data, 31, 31, { x: 15, y: 15 }, { pixelArcsec: grid.pixelArcsec, ...radii });
        const result = falseColourView(sky(short), sky(long), radii);
        expect(result.parts.reading).toContain('seen at both wavelengths, colour index');
        const reported = Number(result.parts.reading.match(/signal-to-noise ([\d.]+) at/)![1]);
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

    it('describes Gaia stars, including a star on the circle edge, and missing lists', () => {
        const s = sky([sourceFrame(1.25)]);
        const l = sky([sourceFrame(4.6)]);
        const star = (x: number, y: number) => ({ sourceId: `${x},${y}`, ...gridPixToSky(grid, { x, y }), g: 15, epochJyear: 2016, pix: { x, y } });
        const method = () => falseColourView(s, l, radii).parts.method;
        expect(method()).toContain('within 12″ of the centre; none of the Gaia stars this page loads lies inside that circle. That list holds only the brighter stars, so a fainter star or a source seen only in infrared can still be inside.');
        l.stars = [star(16, 15)];
        expect(method()).toContain('1 of the Gaia stars this page loads lies inside that circle, 6.2″ from the centre. That list holds only the brighter stars');
        l.stars = [star(17, 15), star(16, 15), star(15.1, 15)];
        expect(method()).toContain('3 of the Gaia stars this page loads lie inside that circle, the nearest 0.6″ from the centre. That list holds only the brighter stars');
        s.notes.push('Gaia stars are not available for this view.');
        l.notes.push('Gaia stars are not available for this view.');
        l.stars = [];
        expect(method()).toContain('within 12″ of the centre, so it can include a neighbour');
    });

    it('withholds the index when the brightest pixel is 9 arcseconds away but not at 3', () => {
        const g = { ...grid, pixelArcsec: 3 };
        const make = (lambda: number, x: number) => ({ ...sourceFrame(lambda, x, 1000), grid: g });
        const makeSky = (frames: RegriddedFrame[]) => ({ ...sky(frames), grid: g });
        const r = { radius: 4, annulusIn: 5, annulusOut: 7 };
        const long = [make(4.6, 15), make(4.6, 15), make(4.6, 15)];
        const far = falseColourView(makeSky([make(1.25, 18), make(1.25, 18), make(1.25, 18)]), makeSky(long), r);
        expect(far.parts.reading).toContain('brightest 9.0″ from the centre');
        expect(far.parts.reading).toContain('no colour index is given because the light is not centred at 1.25 µm');
        const near = falseColourView(makeSky([make(1.25, 16), make(1.25, 16), make(1.25, 16)]), makeSky(long), r);
        expect(near.parts.reading).toMatch(/colour index [−+\d]/);
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
        expect(result.parts.labels).toContain('Blue: 1.20 µm (the shorter wavelength), 1 frame, 2023-02-25; 1 more left out (they cover less of this view).');
        expect(result.parts.warning).toBe('');
        expect(result.parts.note).not.toContain('left unpainted');
        const secondBlank = frame(1.9, 60200);
        secondBlank.data.fill(NaN);
        expect(falseColourView(sky([frame(1.2), blank, secondBlank]), sky([frame(4.6)]), radii).parts.labels)
            .toContain('1 frame, 2023-02-25; 2 more left out (they cover less of this view).');
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
        expect(result.parts.note).toContain('parts not covered by every frame are left unpainted');
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
        expect(parts.reading).toBe('At the centre: seen at both wavelengths (signal-to-noise 5.0 at 1.25 µm and 4.0 at 4.60 µm); no colour index could be formed.');
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
        expect(bothFlat.parts.method).toBe('');
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
    it('omits the method when neither band can be measured', () => {
        const parts = colourParts(1.25, 4.6, { ...both, short: NaN, long: NaN, seen: 'neither', valid: false });
        expect(parts.method).toBe('');
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
            [both, 'At the centre: seen at both wavelengths, colour index +0.42 (signal-to-noise 14 at 1.25 µm and 31 at 4.60 µm).'],
            [{ ...both, seen: 'short', valid: false }, 'At the centre: seen at 1.25 µm only (signal-to-noise 14); no clear signal at 4.60 µm (clear means at least 3 times the noise).'],
            [{ ...both, long: NaN, seen: 'short' }, 'At the centre: seen at 1.25 µm (signal-to-noise 14); 4.60 µm cannot be measured here (blank pixels).'],
            [{ ...both, short: NaN, long: NaN }, 'At the centre: cannot be measured here (blank pixels).'],
        ];
        for (const [reading, expected] of cases) {
            const parts = colourParts(1.25, 4.6, reading);
            expect(Object.keys(parts)).toEqual(['labels', 'note', 'warning', 'reading', 'method']);
            expect(Object.values(parts).filter(Boolean).join(' ')).toBe(colourSentence(1.25, 4.6, reading));
            expect(parts.reading).toBe(expected);
            expect(parts.method.includes('The colour index is')).toBe(reading === both);
            expect(parts.warning).toBe('');
        }
        const result = falseColourView(sky([frame(1.25)]), sky([frame(4.6)]), radii);
        expect(Object.values(result.parts).filter(Boolean).join(' ')).toBe(result.sentence);
        const oldParts = colourParts(1.25, 4.6, colourAt(frame(1.25).data, frame(4.6).data, 31, 31, { x: 15, y: 15 }, { pixelArcsec: grid.pixelArcsec, ...radii, minSnr: 3 }), [[at(60000)], [at(60000)]]);
        expect(result.parts).toEqual({ ...oldParts,
            note: oldParts.note + ' With fewer than 3 frames, a detector hit in a single frame cannot be rejected from the picture.',
            method: oldParts.method + ' The reading adds up all light within 12″ of the centre; none of the Gaia stars this page loads lies inside that circle. That list holds only the brighter stars, so a fainter star or a source seen only in infrared can still be inside.',
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

    it('places the reading before its method and only explains an index when printed', () => {
        const withIndex = colourSentence(1.25, 4.6, both, [[at(60000)], [at(60001)]]);
        expect(withIndex.indexOf('The two colours were not taken')).toBeLessThan(withIndex.indexOf('At the centre:'));
        expect(withIndex.indexOf('At the centre:')).toBeLessThan(withIndex.indexOf('The colour index is'));
        expect(withIndex.indexOf('The colour index is')).toBeLessThan(withIndex.indexOf('The reading adds up'));
        expect(withIndex.endsWith('tint of the middle pixels.')).toBe(true);
        const noIndex = colourSentence(1.25, 4.6, { ...both, seen: 'short', valid: false });
        expect(noIndex).not.toContain('The colour index is');
        expect(noIndex.indexOf('At the centre:')).toBeLessThan(noIndex.indexOf('The reading adds up'));
    });
    it('formats both bands, the signed index and measured wavelengths', () => {
        const text = colourSentence(1.234, 4.567, both);
        expect(text).toContain('Blue: 1.23 µm');
        expect(text).toContain('Orange: 4.57 µm');
        expect(text).toContain('At the centre: seen at both wavelengths, colour index +0.42 (signal-to-noise 14 at 1.23 µm and 31 at 4.57 µm).');
        expect(text).toContain('(long − short) / (long + short)');
        expect(colourSentence(1.234, 4.567, { ...both, index: -0.125 })).toContain('index −0.13 (');
    });

    it('prints an index that rounds to zero without a sign', () => {
        for (const index of [-0.004, 0.004, 0, -0]) {
            const text = colourSentence(1.25, 4.6, { ...both, index });
            expect(text).toContain('colour index 0.00 (');
        }
        expect(colourSentence(1.25, 4.6, { ...both, index: -0.005 })).toContain('colour index −0.01 (');
        expect(colourSentence(1.25, 4.6, { ...both, index: 0.006 })).toContain('colour index +0.01 (');
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
        expect(text + slots).not.toMatch(/discovery|detected a|confirmed|proves/i);
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
        expect(short + long).not.toMatch(/colour index [−+\d]/);
        expect(colourSentence(1.25, 4.6, { ...both, short: NaN, long: NaN, seen: 'neither', valid: false }))
            .toContain('At the centre: cannot be measured here (blank pixels).');
    });

    it('explains how the reading relates to the picture', () => {
        expect(colourSentence(1.25, 4.6, both)).toContain('The reading adds up a small circle of pixels and takes off the sky just around it, so it need not match the tint of the middle pixels.');
    });
});
