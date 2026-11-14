import { describe, expect, it } from 'vitest';
import { colourParts, colourSentence, falseColourView } from '../src/lib/falsecolour-view';
import { colourAt, falseColourRgba, pairStretch, type ColourAt } from '../src/lib/falsecolour';
import { stackVisit } from '../src/lib/stack';
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

describe('false colour view coverage', () => {
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
            .toContain('1.25 µm cannot be measured here (some frames have blank pixels here)');
    });

    it('uses covering frames for wavelengths and dates, and all frames when partial', () => {
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
        expect(covered).toContain('Blue: 1.20 µm (the shorter wavelength), 1 frame, 2023-02-25.');
        expect(covered).not.toContain('The two colours were not taken');
        absent.data[15 * 31 + 20] = 3;
        const partial = falseColourView(sky([cover, absent]), sky([long]), radii).sentence;
        expect(partial).toContain('Blue: 1.50 µm (the shorter wavelength), 2 frames, 2023-02-25 and 2023-03-07.');
        expect(partial).toContain('The two colours were not taken');
    });

    it.each([[17, 15, 'circle edge'], [22, 15, 'outer edge'], [21, 15, 'outer ring']] as const)
    ('rejects a partial frame with a blank at the %s,%s %s', (x, y, _edge) => {
        const partial = frame(4.6);
        partial.data[y * 31 + x] = NaN;
        expect(falseColourView(sky([frame(1.25)]), sky([frame(4.6), partial]), radii).sentence)
            .toContain('4.60 µm cannot be measured here (some frames have blank pixels here)');
    });

    it('ignores a gap pixel', () => {
        const a = frame(1.25);
        const b = frame(1.25);
        b.data[15 * 31 + 18] = NaN;
        expect(falseColourView(sky([a, b]), sky([frame(4.6)]), radii).sentence)
            .not.toContain('some frames have blank pixels here');
    });

    it('ignores a ring pixel blank in every frame', () => {
        const a = frame(1.25);
        const b = frame(1.25);
        a.data[15 * 31 + 20] = NaN;
        b.data[15 * 31 + 20] = NaN;
        expect(falseColourView(sky([a, b]), sky([frame(4.6)]), radii).sentence)
            .not.toContain('some frames have blank pixels here');
    });

    it('uses the half-pixel centre on an even grid', () => {
        const evenGrid = { ...grid, width: 30, height: 30 };
        const convert = (f: RegriddedFrame): RegriddedFrame => ({ ...f, grid: evenGrid, data: new Float32Array(900).fill(1) });
        const a = convert(frame(1.25));
        const b = convert(frame(1.25));
        b.data[14 * 30 + 13] = NaN;
        const makeSky = (frames: RegriddedFrame[]) => ({ ...sky(frames), grid: evenGrid });
        expect(falseColourView(makeSky([a, b]), makeSky([convert(frame(4.6))]), radii).sentence)
            .toContain('1.25 µm cannot be measured here (some frames have blank pixels here)');
    });

    it.each(['short', 'long'] as const)('retains the seen band when %s is partial in a two-signal image', partialBand => {
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
        partial.data[15 * 31 + 20] = NaN;
        const result = falseColourView(sky(partialBand === 'short' ? [short, partial] : [short]), sky(partialBand === 'long' ? [long, partial] : [long]), radii);
        expect(result.parts.reading).toMatch(partialBand === 'short'
            ? /^At the centre: seen at 4\.60 µm \(signal-to-noise [\d.]+\); 1\.25 µm cannot be measured here \(some frames have blank pixels here\)\.$/
            : /^At the centre: seen at 1\.25 µm \(signal-to-noise [\d.]+\); 4\.60 µm cannot be measured here \(some frames have blank pixels here\)\.$/);
    });

    it('counts and compares only frames covering the measured pixels', () => {
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
        expect(sentence).toContain('Blue: 1.25 µm (the shorter wavelength), 2 frames, 2023-02-25 and 2023-02-26.');
        expect(sentence).not.toContain('2023-03-07');
        expect(sentence).not.toContain('The two colours were not taken at the same times');
    });

    it('rejects a false signal caused by incomplete sky-ring coverage without changing the tint', () => {
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
        expect(incomplete.sentence).toContain('1.25 µm cannot be measured here (some frames have blank pixels here).');
        expect(incomplete.sentence).not.toContain('seen at 1.25 µm');
        const stretch = pairStretch(stacked, long.data);
        expect(incomplete.rgba).toEqual(falseColourRgba(stacked, long.data, stretch.sShort, stretch.sLong));
        const outside = frame(1.25, 60000, 60000.001, 100);
        outside.data[0] = NaN;
        expect(falseColourView(sky([low, outside]), sky([long]), radii).sentence).not.toContain('some frames have blank pixels here');
        const blank = frame(4.6);
        blank.data[15 * grid.width + 15] = NaN;
        const mixed = falseColourView(sky([low, high]), sky([blank]), radii).sentence;
        expect(mixed).toContain('1.25 µm cannot be measured here (some frames have blank pixels here); 4.60 µm cannot be measured here (blank pixels).');
    });
});

describe('false colour sentence', () => {
    it.each([[true, false], [false, true]] as [boolean, boolean][])('honours partial flags on finite readings %s %s without mutation', (short, long) => {
        const input = { ...both };
        const result = colourSentence(1.25, 4.6, input, undefined, [short, long]);
        expect(result).toContain(short
            ? 'seen at 4.60 µm (signal-to-noise 31); 1.25 µm cannot be measured here (some frames have blank pixels here)'
            : 'seen at 1.25 µm (signal-to-noise 14); 4.60 µm cannot be measured here (some frames have blank pixels here)');
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
        expect(result.parts).toEqual(colourParts(1.25, 4.6,
            colourAt(frame(1.25).data, frame(4.6).data, 31, 31, { x: 15, y: 15 }, { pixelArcsec: grid.pixelArcsec, ...radii, minSnr: 3 }),
            [[at(60000)], [at(60000)]]));
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
