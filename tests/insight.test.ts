import { describe, expect, it, vi } from 'vitest';
import { GET as serverGET, createHandlers as createServerHandlers, memoryStore, networkAddress, pickStore, storeMissing, upstashStore, type InsightDeps, type LimitStore } from '../api/insight';
import { checkNote, factSheet, fetchInsight, insightEnabled, insightStatus, validateFacts, type InsightFacts } from '../src/lib/insight';
import { SYSTEM_PROMPT } from '../src/lib/insight-prompt';
import { TARGETS } from '../src/lib/targets';

const facts: InsightFacts = { targetId: 'custom', ra: 12.34567, dec: -38, lambdaUm: 4.27, visits: [{ mjd: 61000, frames: 3 }, { mjd: 61010, frames: 4 }], lightCurve: { points: [{ mjd: 61000, relative: 1, snr: 20 }, { mjd: 61010, relative: 0.8, snr: 10 }], refScatter: [0.02, 0.03], dropped: 2 }, difference: { peakSigma: -3.4 }, motion: { arcsec: 2.3, days: 10 }, snapshot: true };
const lines = ['Target: a position typed in by the visitor.', 'Position: RA 12.3457 deg, Dec -38.0000 deg.', 'Wavelength: 4.270 micron.', 'Visits: 2. Frames in each visit: 3, 4. Time from first to last visit: 10.0 days.', 'Brightness relative to the reference stars, in time order: 1.00, 0.80.', 'Lowest signal-to-noise among the points: 10. This counts sky noise only, so the real uncertainty is larger.', 'Reference stars: 2 with available scatter. Scatter of each: 2.0, 3.0 percent.', 'Frames left out because their wavelength did not match: 2.', 'Difference image at the target: strongest pixel 3.4 sigma, fainter there in the later visit.', 'Shift in position: 2.3 arcsec over 10.0 days.', 'Frames came from: a saved copy.'];

describe('round 14 labelled notes and next checks', () => {
    const base = 'What this shows: The wavelength is 1.083 micron.\nHow far to trust it: The wavelength is 1.083 micron.';
    const options = { labelled: true };
    const sheet = ['Wavelength: 1.083 micron.', 'Visits: 2.', 'Brightness relative to the reference stars, in time order: 1.00, 1.30.', 'Reference stars: 2 with available scatter. Scatter of each: 1.2, 2.0 percent.'];
    const checks = [
        'Wait for another visit to see whether the change repeats.',
        'Compare the target with the reference stars in the same frames.',
        'Look at Subtract to see what is left at the target.',
        'Switch on Flagged pixels to see whether one sits on the target.',
        'Step through the frames in Blink to see whether one frame stands out.',
        'Switch on Brightest Gaia stars to see whether a catalogue star lies at the target.',
        'Change the colour to see whether the change shows at another wavelength.',
        'Change the colour to look at another wavelength.',
    ];
    it('drops unlabelled sentences and requires a measurement paragraph', () => {
        expect(() => checkNote('First sentence. Second sentence.', sheet, options)).toThrowError(expect.objectContaining({ code: 'unverified' }));
        expect(checkNote(`Preamble sentence.\n${base}`, sheet, options)).toEqual({ text: base, dropped: 1 });
        expect(checkNote(base, sheet, options)).toEqual(checkNote(base, sheet));
        expect(() => checkNote('What this shows This is a candidate only.\nWhat to check next: Switch on Flagged pixels to see whether one sits on the target. Step through the frames in Blink to see whether one frame stands out.', sheet, options)).toThrowError(expect.objectContaining({ code: 'unverified' }));
        expect(() => checkNote(`What to check next: ${checks[3]} ${checks[4]}`, sheet, options)).toThrowError(expect.objectContaining({ code: 'unverified' }));
    });
    it('keeps the eight exact checks and rejects a one-word change', () => {
        for (const sentence of checks) {
            const note = `${base}\nWhat to check next: ${sentence}`;
            expect(checkNote(note, sheet, options).text, sentence).toContain(sentence);
            expect(checkNote(`${base}\nWhat to check next: ${sentence.toUpperCase()}`, sheet, options).text, sentence).toContain(sentence.toUpperCase());
            expect(checkNote(`${base}\nWhat to check next: ${sentence.replace(/\bthe\b/i, 'this')}`, sheet, options).dropped, sentence).toBe(1);
        }
    });
    it('requires a change line, reference stars, and two visits where specified', () => {
        const empty = ['Visits: 1.', 'Wavelength: 1.083 micron.'];
        for (const i of [0, 1, 2, 6]) {
            expect(checkNote(`${base}\nWhat to check next: ${checks[i]}`, empty, options).dropped, checks[i]).toBe(1);
        }
        for (const line of ['Reference stars: 0 with available scatter.', 'Reference stars: none.', 'Reference stars: scatter unavailable.']) {
            expect(checkNote(`${base}\nWhat to check next: ${checks[1]}`, [...empty, line], options).dropped).toBe(1);
        }
        expect(checkNote(`${base}\nWhat to check next: ${checks[2]}`, empty, options).dropped).toBe(1);
        expect(checkNote(`${base}\nWhat to check next: ${checks[2]}`, ['Wavelength: 1.083 micron.', 'Visits: at least 12.'], options).dropped).toBe(0);
        for (const i of [3, 4, 5, 7]) {
            expect(checkNote(`${base}\nWhat to check next: ${checks[i]}`, empty, options).dropped, checks[i]).toBe(0);
        }
        expect(checkNote(`${base}\nWhat to check next: ${checks[0]} ${checks[6]}`, [...empty, 'Difference image at the target: no change above the noise.'], options).dropped).toBe(2);
    });
    it('keeps every quoted sentence form offered by the prompt', () => {
        const full = ['Target: a position typed in by the visitor.', 'Position: RA 12.3457 deg, Dec -38.0000 deg.', 'Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 3, 4, 5. Time from first to last visit: 20.0 days.', 'Brightness relative to the reference stars, in time order: 1.00, 1.00, 1.30.', 'Largest change from the median brightness: 30 percent above it.', 'Lowest signal-to-noise among the points: below 1.', 'Reference stars: 2 with available scatter. Scatter of each: 1.2, 2.0 percent.', 'Frames left out because their wavelength did not match: 2.', 'Difference image at the target: strongest pixel 3.4 sigma, fainter there in the later visit.', 'Shift in position: 2.3 arcsec over 10.0 days.', 'Frames came from: a saved copy.'];
        const fixtures: Record<string, [string, string[]]> = {
            'In time order, the brightness was LIST.': ['In time order, the brightness was 1.00, 1.00, 1.30.', full],
            'The brightness went from FIRST to LAST.': ['The brightness went from 1.00 to 1.30.', full],
            'The first reading was VALUE.': ['The first reading was 1.00.', full],
            'The first and last readings are both VALUE.': ['The first and last readings are both 1.00.', full.map((line) => line.replace('1.00, 1.00, 1.30', '1.00, 1.00, 1.00'))],
            'The largest change from the median brightness is N percent above the median.': ['The largest change from the median brightness is 30 percent above the median.', full],
            'The N reference stars scatter by LIST percent.': ['The 2 reference stars scatter by 1.2 and 2.0 percent.', full],
            'The 1 reference star scatters by VALUE percent.': ['The 1 reference star scatters by 1.2 percent.', full.map((line) => line.replace('2 with available scatter. Scatter of each: 1.2, 2.0', '1 with available scatter. Scatter of each: 1.2'))],
            'The change is several times larger than that scatter.': ['The change is several times larger than that scatter.', full],
            'The change is larger than that scatter.': ['The change is larger than that scatter.', full],
            'The change is no larger than that scatter, so it may be noise.': ['The change is no larger than that scatter, so it may be noise.', full.map((line) => line.replace('30 percent above it', 'less than 1 percent'))],
            'There are no reference stars to compare the change with.': ['There are no reference stars to compare the change with.', full.filter((line) => !line.startsWith('Reference stars:'))],
            "The reference stars' scatter is unavailable, so there is nothing to compare the change with.": ["The reference stars' scatter is unavailable, so there is nothing to compare the change with.", full.map((line) => line.startsWith('Reference stars:') ? 'Reference stars: scatter unavailable.' : line)],
            'The lowest signal-to-noise among the points is VALUE.': ['The lowest signal-to-noise among the points is below 1.', full],
            'There were N visits.': ['There were 3 visits.', full],
            'There was 1 visit.': ['There was 1 visit.', full.map((line) => line.startsWith('Visits:') ? 'Visits: 1. Frames in each visit: 3.' : line)],
            'The frames in each visit were LIST.': ['The frames in each visit were 3, 4, 5.', full],
            'The time from first to last visit was VALUE.': ['The time from first to last visit was 20.0 days.', full],
            'The wavelength is VALUE.': ['The wavelength is 4.270 micron.', full],
            'Frames left out because their wavelength did not match: N.': ['Frames left out because their wavelength did not match: 2.', full],
            'The shift in position was VALUE.': ['The shift in position was 2.3 arcsec over 10.0 days.', full],
            'Difference image at the target: VALUE.': ['Difference image at the target: strongest pixel 3.4 sigma, fainter there in the later visit.', full],
            'The position is VALUE.': ['The position is RA 12.3457 deg, Dec -38.0000 deg.', full],
            'The target is VALUE.': ['The target is a position typed in by the visitor.', full],
            'The frames came from VALUE.': ['The frames came from a saved copy.', full],
            'There are fewer than 3 visits, so the change counts for little.': ['There are fewer than 3 visits, so the change counts for little.', ['Visits: 2.', 'Brightness relative to the reference stars, in time order: 1.00, 1.30.']],
            'The lowest signal-to-noise is small, so the change counts for little.': ['The lowest signal-to-noise is small, so the change counts for little.', full],
            'There is nothing measured to interpret yet.': ['There is nothing measured to interpret yet.', ['Visits: 2.']],
            'This is a candidate only.': ['This is a candidate only.', full],
        };
        const [first, third] = SYSTEM_PROMPT.split('In the third paragraph use 1 or 2 of these sentences, exactly as written.');
        const quoted = (text: string) => [...text.matchAll(/"([A-Za-z][^"]*[.!?])"/g)].map((match) => match[1]!);
        const offered = quoted(first!);
        expect(offered.sort()).toEqual(Object.keys(fixtures).sort());
        for (const form of offered) {
            const [sentence, source] = fixtures[form]!;
            for (const label of ['What this shows', 'How far to trust it']) {
                const median = source.find((line) => line.startsWith('Largest change'))?.includes('less than 1') ? 'The largest change from the median brightness is less than 1 percent from the median.' : 'The largest change from the median brightness is 30 percent above the median.';
                const prerequisites = form.startsWith('The change is ') ? `${median} The 2 reference stars scatter by 1.2 and 2.0 percent. ` : '';
                expect(checkNote(`${label}: ${prerequisites}${sentence} The wavelength is 4.270 micron.\nWhat to check next: ${checks[7]}`, [...source, 'Wavelength: 4.270 micron.'], options).text, form).toContain(sentence);
            }
        }
        for (const form of ['There are no reference stars to compare the change with.', "The reference stars' scatter is unavailable, so there is nothing to compare the change with."]) {
            const [sentence, source] = fixtures[form]!;
            const variant = sentence.slice(0, -1) + ', so the change counts for little.';
            expect(checkNote(`How far to trust it: ${variant}\nWhat to check next: ${checks[7]}`, source, options).text).toContain(variant);
        }
        expect(quoted(third!).sort()).toEqual([...checks].sort());
        for (const sentence of quoted(third!)) {
            expect(checkNote(`What this shows: The wavelength is 4.270 micron.\nHow far to trust it: The wavelength is 4.270 micron.\nWhat to check next: ${sentence}`, full, options).text, sentence).toContain(sentence);
        }
    });
});

describe('round 16 conservative labelled forms', () => {
    const sheet = (readings: string, change?: string, scatter?: string, difference?: string) => [
        'Wavelength: 1.234 micron.',
        `Visits: ${readings.split(', ').length}. Frames in each visit: 3, 3. Time from first to last visit: 12.3 days.`,
        `Brightness relative to the reference stars, in time order: ${readings}.`,
        ...(change ? [`Largest change from the median brightness: ${change}.`] : []),
        ...(scatter ? [`Reference stars: 2 with available scatter. Scatter of each: ${scatter} percent.`] : []),
        ...(difference ? [`Difference image at the target: ${difference}.`] : []),
    ];
    const keeps = (sentence: string, source: string[], next = false) => {
        const note = next
            ? `What this shows: The wavelength is 1.234 micron.\nWhat to check next: ${sentence} Change the colour to look at another wavelength.`
            : `What this shows: ${sentence} The wavelength is 1.234 micron.\nWhat to check next: Change the colour to look at another wavelength.`;
        return checkNote(note, source, { labelled: true }).text.includes(sentence);
    };
    it('J1 rejects asserting endpoint verbs even when the change is large', () => {
        for (const [values, first, last, change] of [['1.00, 1.10, 1.30', '1.00', '1.30', '30 percent above it'], ['1.30, 1.10, 1.00', '1.30', '1.00', '30 percent below it'], ['1.00, 1.30', '1.00', '1.30', undefined]] as const) {
            const source = sheet(values, change, '0.1, 0.2');
            for (const verb of ['rose', 'fell', 'changed']) { expect(keeps(`The brightness ${verb} from ${first} to ${last}.`, source), verb).toBe(false); }
            expect(keeps(`The brightness went from ${first} to ${last}.`, source)).toBe(true);
        }
        const source = sheet('1.00, 1.01, 1.02', '1 percent above it', '1.2, 1.5');
        const text = checkNote('What this shows: The brightness rose from 1.00 to 1.02. The brightness went from 1.00 to 1.02.\nHow far to trust it: The largest change from the median brightness is 1 percent above the median. The 2 reference stars scatter by 1.2 and 1.5 percent. The change is no larger than that scatter, so it may be noise.\nWhat to check next: Change the colour to look at another wavelength.', source, { labelled: true }).text;
        expect(text).not.toMatch(/\b(?:rose|fell|rise|drop|brighten|fade|dim|changed)\b/i);
        expect(text).toContain('The change is no larger than that scatter');
        for (const verb of ['rose', 'fell', 'rise', 'drop', 'brighten', 'fade', 'dim', 'changed']) {
            expect(keeps(`The brightness ${verb} across the visits.`, source), verb).toBe(false);
        }
    });
    it('J2 refuses endpoint ranks that hide a middle extreme', () => {
        const peak = sheet('1.00, 1.50, 1.00', '50 percent above it');
        for (const rank of ['first', 'last']) { expect(keeps(`The ${rank} reading was 1.00.`, peak), rank).toBe(false); }
        expect(keeps('The highest reading was 1.50.', peak)).toBe(true);
        expect(keeps('In time order, the brightness was 1.00, 1.50, 1.00.', peak)).toBe(true);
        const monotonic = sheet('1.00, 1.10, 1.20', '10 percent above it');
        expect(keeps('The first reading was 1.00.', monotonic)).toBe(true);
        expect(keeps('The last reading was 1.20.', monotonic)).toBe(true);
    });
    it('J3 drops duplicated units', () => {
        expect(keeps('The wavelength is 1.234 micron micron.', sheet('1.00, 1.10'))).toBe(false);
    });
    it('K1 requires a notable change: brightness above the scatter, or a difference line of 3 sigma or more', () => {
        const sentences = ['This is a candidate only.', 'Wait for another visit to see whether the change repeats.', 'Change the colour to see whether the change shows at another wavelength.'];
        const cases: [string, string[], boolean][] = [
            ['two inside scatter', sheet('1.00, 1.01', undefined, '2.0'), false],
            ['median inside scatter', sheet('1.00, 1.00, 1.30', '30 percent above it', '50'), false],
            ['median above scatter', sheet('1.00, 1.00, 1.30', '30 percent above it', '5'), true],
            ['no reference stars', sheet('1.00, 1.01'), true],
            ['difference despite flat readings', sheet('1.00, 1.00', undefined, '50', 'strongest pixel 3.4 sigma, brighter there in the later visit'), true],
            ['3.0 sigma difference despite flat readings', sheet('1.00, 1.00', undefined, '50', 'strongest pixel 3.0 sigma, fainter there in the later visit'), true],
            ['more than 100 sigma difference', sheet('1.00, 1.00', undefined, '50', 'strongest pixel more than 100 sigma, brighter there in the later visit'), true],
            ['0.3 sigma difference and flat readings', sheet('1.00, 1.00', undefined, '50', 'strongest pixel 0.3 sigma, brighter there in the later visit'), false],
            ['2.9 sigma difference and flat readings', sheet('1.00, 1.00', undefined, '50', 'strongest pixel 2.9 sigma, brighter there in the later visit'), false],
            ['0.3 sigma difference and a change inside the scatter', sheet('1.00, 1.00, 1.01', 'less than 1 percent', '2.0', 'strongest pixel 0.3 sigma, brighter there in the later visit'), false],
            ['0.3 sigma difference and two readings inside the scatter', sheet('1.00, 1.01', undefined, '2.0', 'strongest pixel 0.3 sigma, brighter there in the later visit'), false],
            ['0.3 sigma difference but brightness above the scatter', sheet('1.00, 1.00, 1.30', '30 percent above it', '5', 'strongest pixel 0.3 sigma, brighter there in the later visit'), true],
            ['two readings from zero inside a printed scatter', sheet('0.00, 0.10', undefined, '2.0'), false],
            ['two readings from below zero: a percent of a negative brightness means nothing', sheet('-0.10, 0.10', undefined, '2.0'), false],
        ];
        for (const [name, source, expected] of cases) {
            for (const [i, sentence] of sentences.entries()) { expect(keeps(sentence, source, i > 0), `${name}: ${sentence}`).toBe(expected); }
        }
        expect(keeps('There are fewer than 3 visits, so the change counts for little.', cases[0]![1])).toBe(true);
        for (const source of [sheet('1.00, 1.01', undefined, '1.0'), sheet('1.00, 1.01', undefined, '0.5, 2.0'), sheet('1.00, 1.01', '1 percent above it', '2.0'), sheet('1.00, 1.00', undefined, '2.0', 'no change above the noise')]) {
            expect(keeps(sentences[0]!, source)).toBe(false);
        }
        expect(keeps(sentences[0]!, [...cases[0]![1], 'Shift in position: 2.0 arcsec over 10.0 days.'])).toBe(true);
        expect(keeps(sentences[0]!, sheet('1.00, 1.01', undefined, '0.5'))).toBe(true);
    });
    it('R1 keeps a scatter comparison only after the median sentence it compares', () => {
        const source = sheet('1.00, 1.00, 1.30', '30 percent above it', '5.0, 6.0');
        const median = 'The largest change from the median brightness is 30 percent above the median.';
        const scatter = 'The 2 reference stars scatter by 5.0 and 6.0 percent.';
        const comparison = 'The change is larger than that scatter.';
        const note = (trust: string) => `What this shows: The wavelength is 1.234 micron.\nHow far to trust it: ${trust}\nWhat to check next: Change the colour to look at another wavelength.`;
        const full = checkNote(note(`${median} ${scatter} ${comparison}`), source, { labelled: true }).text;
        const noMedian = checkNote(note(`${scatter} ${comparison}`), source, { labelled: true }).text;
        expect(full, 'scatter sentence form').toContain(scatter);
        expect(full).toContain(comparison);
        expect(noMedian).toContain(scatter);
        expect(noMedian).not.toContain(comparison);
    });
    it('K2 spells out the restrictions in the prompt', () => {
        for (const instruction of ['Never when the sheet says "at least" or says points were left out.', 'or the sheet has a difference line and it does not say "no change above the noise"', 'copy the whole warning immediately after the difference sentence, in the same paragraph', 'Use only when the sheet has a Largest change line.', 'One: the difference line gives 3 sigma or more.', 'For exactly two readings, take the brightness change as the difference between them as a percent of the first reading.', '"Wait for another visit to see whether the change repeats." Only when there is a notable change.', '"Change the colour to see whether the change shows at another wavelength." Only when there is a notable change.', 'Use only if a shift was measured or there is a notable change.']) {
            expect(SYSTEM_PROMPT).toContain(instruction);
        }
    });
    it('K3 accepts negative ranks and prints canonical labels', () => {
        const source = sheet('-0.10, 0.00, 0.10', '10 percent above it');
        expect(keeps('The lowest reading was -0.10.', source)).toBe(true);
        const result = checkNote('what this shows: The wavelength is 1.234 micron.\nhow far to trust it: The wavelength is 1.234 micron.\nwhat to check next: Change the colour to look at another wavelength.', source, { labelled: true });
        expect(result.text).toBe('What this shows: The wavelength is 1.234 micron.\nHow far to trust it: The wavelength is 1.234 micron.\nWhat to check next: Change the colour to look at another wavelength.');
    });
});

describe('round 13 closed paragraphs', () => {
    const sheet = ['Visits: 3. Frames in each visit: 7, 9, 8. Time from first to last visit: 400.0 days.', 'Brightness relative to the reference stars, in time order: 1.30, 1.00, 1.00.', 'Largest change from the median brightness: 30 percent above it.', 'Lowest signal-to-noise among the points: below 1.', 'Reference stars: 2 with available scatter. Scatter of each: 1.2, 2.0 percent.', 'Shift in position: 10.4 arcsec over 400.0 days.', 'Wavelength: 1.083 micron.'];
    const has = (sentence: string, label = 'What this shows', source = sheet) => {
        const change = source.find((line) => line.startsWith('Largest change'))?.match(/: (.+)\./)?.[1];
        const median = change?.replace('above it', 'above the median').replace('below it', 'below the median').replace('less than 1 percent', 'less than 1 percent from the median');
        const scatter = source.find((line) => line.startsWith('Reference stars:'))?.match(/Scatter of each: (.+) percent\./)?.[1];
        const prefix = sentence.startsWith('The change is ') && median && scatter ? `What this shows: The largest change from the median brightness is ${median}. The 2 reference stars scatter by ${scatter} percent.\n` : '';
        return checkNote(`${prefix}${label}: ${sentence}\nWhat to check next: Switch on Flagged pixels to see whether one sits on the target. Change the colour to look at another wavelength.`, source).text.includes(sentence);
    };
    it.each(['Over 3 visits, the brightness rose.', 'The second visit was the brightest.', 'The last second-brightest reading was 1.00.', 'The brightness fell by 3 of the observations.', 'The wavelength is 1.083 microns or so.', 'The target shifted 10.4 arcseconds at most.', 'There are 2MASS observations of the target.', 'The signal-to-noise is high.', 'That is negligible.', "The swing is swamped by the reference stars' scatter.", 'This is a genuine change.'])('rejects reviewer claim %s', (sentence) => {
        expect(has(sentence)).toBe(false);
        expect(has(sentence, 'How far to trust it')).toBe(false);
    });
    it('checks the named rank, not merely whether the number appears', () => {
        expect(has('The last reading was 1.00.')).toBe(true);
        expect(has('The last reading was 1.30.')).toBe(false);
    });
    it('fences the third paragraph', () => {
        expect(has('The signal-to-noise is high.', 'What to check next')).toBe(false);
        expect(has('Check whether the confirmed flare repeats.', 'What to check next')).toBe(false);
        expect(has('Maybe check the frames.', 'What to check next')).toBe(false);
        expect(has('Check the frames.', 'What to check next')).toBe(false);
    });
    it('distinguishes missing reference stars and unavailable scatter', () => {
        const noScatter = sheet.map((line) => line.startsWith('Reference stars:') ? 'Reference stars: scatter unavailable.' : line);
        expect(has("The reference stars' scatter is unavailable, so there is nothing to compare the change with.", 'How far to trust it', noScatter)).toBe(true);
        expect(has('There are no reference stars to compare the change with.', 'How far to trust it')).toBe(false);
    });
    it.each([
        ['ordered readings', 'In time order, the brightness was 1.30, 1.00, 1.00.', 'In time order, the brightness was 1.00, 1.30, 1.00.'],
        ['endpoints', 'The brightness went from 1.30 to 1.00.', 'The brightness rose from 1.30 to 1.00.'],
        ['rank', 'The first reading was 1.30.', 'The first reading was 1.00.'],
        ['median', 'The largest change from the median brightness is 30 percent above the median.', 'The largest change from the median brightness is 30 percent below the median.'],
        ['scatter', 'The 2 reference stars scatter by 1.2 and 2.0 percent.', 'The 2 reference stars scatter by 1.2 and 1.2 percent.'],
        ['comparison', 'The change is several times larger than that scatter.', 'The change is no larger than that scatter, so it may be noise.'],
        ['signal-to-noise', 'The lowest signal-to-noise among the points is below 1.', 'The lowest signal-to-noise among the points is 1.'],
        ['visits', 'There were 3 visits.', 'There were 2 visits.'],
        ['frames', 'The frames in each visit were 7, 9, 8.', 'The frames in each visit were 7, 8, 9.'],
        ['days', 'The time from first to last visit was 400.0 days.', 'The time from first to last visit was 10.0 days.'],
        ['wavelength', 'The wavelength is 1.083 micron.', 'The wavelength is 1.084 micron.'],
        ['shift', 'The shift in position was 10.4 arcsec over 400.0 days.', 'The shift in position was 10.4 arcsec over 10.0 days.'],
        ['small signal-to-noise', 'The lowest signal-to-noise is small, so the change counts for little.', 'The lowest signal-to-noise is large, so the change counts for little.'],
    ])('validates %s', (_name, good, bad) => {
        expect(has(good), good).toBe(true);
        expect(has(bad), bad).toBe(false);
    });
    it('drops the reviewers’ closed-world claims in both measurement paragraphs', () => {
        const claims = [
            'The star varies.', 'The target varied.', 'This is an exoplanet.', 'This is a genuine change.', 'The change is intrinsic to the star.', 'This is astrophysical.', 'The star is active.', 'It is an eruption.', 'This is a burst.', 'The dip is an occultation.', 'This is microlensing.', 'This is not noise.', 'This is not an artefact.', 'The change is certain.', 'This is evidence of activity.', 'This could only be a flare.', 'It may look small but it is real.', 'If anything, this confirms it.', 'Whether or not one agrees, it is a flare.', 'It could not be anything but a flare.', 'This may be real: it is a flare.', 'Even if small, the change is real.', 'If you look closely, the star is variable.', 'It faded.', 'The brightness dimmed.', 'The star grew brighter.', 'It surged.', 'Over 3 visits, the target varied.', 'Over 3 visits the brightness rose.', 'Over 3 visits, the star moved.', 'The star was brighter at the last visit.', 'The star got fainter.', 'It went up.', 'It weakened.', 'The brightness held.', 'The brightness did not change.', 'It stayed level.', 'Nothing changed.', 'There was no change.', 'The brightness did not rise.', 'The star never brightened.', 'The brightness was the same at every visit.', 'It was constant.', 'It held steady.', 'The target did not vary.', 'Over 400.0 days the star faded.', 'Across 3 visits the brightness stayed level.', 'Over 3 visits the brightness did not change.', 'At 1.083 micron the star faded.', 'The star moved.', 'The star’s position changed.', 'It wandered across the field.', 'The star moved over 400.0 days.', 'The noise comes from the object.', 'The target is noisy.', 'The rise rests on noise in the star.', 'It brightened and stayed bright.', 'The change is within the error bars.', 'The change is far larger than the measurement precision.', 'The second visit was the brightest.', 'The signal-to-noise is high.', 'That is negligible.',
        ];
        expect(claims.length).toBeGreaterThanOrEqual(60);
        for (const label of ['What this shows', 'How far to trust it']) {
            for (const claim of claims) { expect(has(claim, label), `${label}: ${claim}`).toBe(false); }
        }
    });
    it('drops unsupported suggestions that assert a result', () => {
        const claims = ['Check whether the confirmed flare repeats.', 'Look at the real flare.', 'Compare the genuine change.', 'See the intrinsic variation.', 'Watch the astrophysical burst.', 'Try the detected transit.', 'Open the confirmed planet.', 'Switch to the significant outburst.', 'Slide to the proven binary.', 'Step through the certain flare.', 'Use the confirmed companion.', 'Read the evidence of activity.', 'Repeat the detected pulsation.', 'Go to the variable star.', 'Check the target moved over 400.0 days.', 'Look at the star that brightened.', 'Compare the genuine flare.', 'See the confirmed discovery.', 'Watch the detected eclipse.', 'Try the real supernova.'];
        for (const claim of claims) { expect(has(claim, 'What to check next'), claim).toBe(false); }
        for (const claim of ['Check the flare in the second visit.', 'Look at how the star brightened.', 'Compare the real change with the noise.', 'See that the target moved.', 'Watch the star vary.', 'Check the star appears brighter.', 'Check the target glows.', 'Watch the object pulses.', 'Look at the source flickers.', 'Check the galaxy flickers.']) {
            expect(has(claim, 'What to check next'), claim).toBe(false);
        }
        expect(has('Check the frames to see whether the candidate change repeats.', 'What to check next')).toBe(false);
        expect(has('Check galaxies flicker softly.', 'What to check next')).toBe(false);
        expect(has('Check galaxies flicker in daylight.', 'What to check next')).toBe(false);
        expect(has('Check galaxies flicker after dusk.', 'What to check next')).toBe(false);
    });
    it('keeps a complete prompt-shaped note for each measurement situation', () => {
        const scenarios: [string, string[], string, string][] = [
            ['rise', ['1.00', '1.00', '1.30'], '30 percent above it', 'The change is several times larger than that scatter.'],
            ['fall', ['1.30', '1.00', '1.00'], '30 percent above it', 'The change is several times larger than that scatter.'],
            ['flat', ['1.00', '1.00', '1.00'], 'less than 1 percent', 'The change is no larger than that scatter, so it may be noise.'],
            ['peak', ['1.00', '1.30', '1.00'], '30 percent above it', 'The change is several times larger than that scatter.'],
            ['two visits', ['1.00', '1.30'], '', 'There are fewer than 3 visits, so the change counts for little.'],
            ['no reference stars', ['1.00', '1.00', '1.30'], '30 percent above it', 'There are no reference stars to compare the change with.'],
            ['scatter unavailable', ['1.00', '1.00', '1.30'], '30 percent above it', "The reference stars' scatter is unavailable, so there is nothing to compare the change with."],
            ['less than 1 percent', ['1.00', '1.00', '1.01'], 'less than 1 percent', 'The change is no larger than that scatter, so it may be noise.'],
        ];
        for (const [name, values, change, trust] of scenarios) {
            const reference = name === 'no reference stars' ? [] : [name === 'scatter unavailable' ? 'Reference stars: scatter unavailable.' : 'Reference stars: 2 with available scatter. Scatter of each: 1.2, 2.0 percent.'];
            const source = [`Visits: ${values.length}. Frames in each visit: ${values.map(() => '3').join(', ')}.`, `Brightness relative to the reference stars, in time order: ${values.join(', ')}.`, ...(change ? [`Largest change from the median brightness: ${change}.`] : []), ...reference];
            const safeTrust = trust.startsWith('The change is ') ? 'The 2 reference stars scatter by 1.2 and 2.0 percent.' : trust;
            const text = `What this shows: In time order, the brightness was ${values.join(', ')}.\nHow far to trust it: ${safeTrust}\nWhat to check next: Change the colour to look at another wavelength.`;
            const result = checkNote(text, source, { labelled: true });
            expect(result.text.split('\n').map((part) => (part.match(/[.!?](?=\s|$)/g) ?? []).length), name).toEqual([1, 1, 1]);
            expect(result.dropped, name).toBe(0);
        }
        for (const [name, source, show, trust] of [
            ['shift only', ['Shift in position: 10.4 arcsec over 400.0 days.'], 'The shift in position was 10.4 arcsec over 400.0 days.', 'This is a candidate only.'],
            ['nothing measured', ['Visits: 2. Frames in each visit: 3, 4.'], 'There is nothing measured to interpret yet.', 'There were 2 visits.'],
        ] as const) {
            const result = checkNote(`What this shows: ${show}\nHow far to trust it: ${trust}\nWhat to check next: Change the colour to look at another wavelength.`, [...source], { labelled: true });
            expect(result.text.split('\n').map((part) => (part.match(/[.!?](?=\s|$)/g) ?? []).length), name).toEqual([1, 1, 1]);
            expect(result.dropped, name).toBe(0);
        }
    });
    it('checks both endpoints and unique extremes', () => {
        const peak = sheet.map((line) => line.replace('1.30, 1.00, 1.00', '1.00, 1.30, 1.00'));
        expect(has('The first and last readings are both 1.00.', 'What this shows', peak)).toBe(false);
        expect(has('The first and last readings are both 1.30.', 'What this shows', peak)).toBe(false);
        expect(has('The highest reading was 1.30.', 'What this shows', peak)).toBe(true);
        expect(has('The lowest reading was 1.00.', 'What this shows', peak)).toBe(false);
    });
    it('checks frames left out and the difference image against their own lines', () => {
        const source = [...sheet, 'Frames left out because their wavelength did not match: 2.', 'Difference image at the target: strongest pixel 3.4 sigma, brighter there in the later visit.'];
        expect(has('Frames left out because their wavelength did not match: 2.', 'What this shows', source)).toBe(true);
        expect(has('Frames left out because their wavelength did not match: 3.', 'What this shows', source)).toBe(false);
        expect(has('Difference image at the target: strongest pixel 3.4 sigma, brighter there in the later visit.', 'What this shows', source)).toBe(true);
        expect(has('Difference image at the target: strongest pixel 3.4 sigma, fainter there in the later visit.', 'What this shows', source)).toBe(false);
    });
    it('blocks comparison without a Largest change line', () => {
        const two = ['Visits: 2.', 'Brightness relative to the reference stars, in time order: 1.00, 1.00.', 'Reference stars: 1 with available scatter. Scatter of each: 1.2 percent.'];
        expect(has('The change is no larger than that scatter, so it may be noise.', 'How far to trust it', two)).toBe(false);
        expect(has('There are fewer than 3 visits, so the change counts for little.', 'How far to trust it', two)).toBe(false);
    });
    it('runs direction and the full-range level check even with digits', () => {
        const peak = sheet.map((line) => line.replace('1.30, 1.00, 1.00', '1.00, 1.30, 1.00'));
        const pad = ' Safe sentence. Another safe sentence.';
        expect(checkNote('Over 400.0 days the brightness stayed flat.' + pad, peak).dropped).toBe(1);
        expect(checkNote('Over 3 visits the brightness rose.' + pad, sheet).dropped).toBe(1);
    });
    it('applies the paragraph gate to continuation lines', () => {
        const result = checkNote('What this shows: This is a candidate only.\nThe second visit was the brightest.\nHow far to trust it: This is a candidate only.\nThe signal-to-noise is high.\nWhat to check next: Change the colour to look at another wavelength.\nThe flare is real.', sheet);
        expect(result.dropped).toBe(3);
        expect(result.text).not.toContain('brightest');
        expect(result.text).not.toContain('signal-to-noise');
    });
    it('copies the frame source exactly', () => {
        const source = [...sheet, 'Frames came from: a saved copy.'];
        expect(has('The frames came from a saved copy.', 'What this shows', source)).toBe(true);
        expect(has("The frames came from NASA's live archive.", 'What this shows', source)).toBe(false);
    });
    it('compares a larger change and rejects a reversed comparison', () => {
        const source = sheet.map((line) => line.replace('30 percent above it', '3 percent above it'));
        expect(has('The change is larger than that scatter.', 'How far to trust it', source)).toBe(true);
        expect(has('The change is several times larger than that scatter.', 'How far to trust it', source)).toBe(false);
    });
    it('compares a small change and rejects a larger comparison', () => {
        const source = sheet.map((line) => line.replace('30 percent above it', 'less than 1 percent'));
        expect(has('The change is no larger than that scatter, so it may be noise.', 'How far to trust it', source)).toBe(true);
        expect(has('The change is larger than that scatter.', 'How far to trust it', source)).toBe(false);
    });
    it('keeps the sheet’s bounded frame counts, visits, and difference', () => {
        const source = ['Visits: at least 12. Frames in each visit: at least 500, 2.', 'Difference image at the target: strongest pixel more than 100 sigma, brighter there in the later visit.'];
        expect(has('There were at least 12 visits.', 'What this shows', source)).toBe(true);
        expect(has('The frames in each visit were at least 500, 2.', 'What this shows', source)).toBe(true);
        expect(has('Difference image at the target: strongest pixel more than 100 sigma, brighter there in the later visit.', 'What this shows', source)).toBe(true);
    });
});

describe('round 12 regressions', () => {
    const sheet = (readings = '1.30, 1.00, 1.00', change = '30 percent above it', scatter = '1.2, 2.0') => [
        'Visits: 3. Frames in each visit: 7, 9, 8. Time from first to last visit: 400.0 days.',
        `Brightness relative to the reference stars, in time order: ${readings}.`,
        `Largest change from the median brightness: ${change}.`,
        'Lowest signal-to-noise among the points: 30.',
        `Reference stars: 2 with available scatter. Scatter of each: ${scatter} percent.`,
    ];
    const kept = (sentence: string, facts: string[]) => checkNote(`${sentence} Safe sentence. Another safe sentence.`, facts).text.includes(sentence);
    it('H1 accepts only ordered complete readings and truthful endpoints', () => {
        const s = sheet();
        for (const bad of ['The brightness rose to 1.30.', 'In the second visit the brightness was 1.30.', 'After 400.0 days the brightness was 1.30.', 'The brightness rose from 1.30 to 1.00.', 'In time order the brightness was 1.00, 1.30 and 1.00.']) { expect(kept(bad, s), bad).toBe(false); }
        for (const good of ['In time order the brightness was 1.30, 1.00 and 1.00.', 'The brightness went from 1.30 to 1.00.', 'The first reading was 1.30.']) { expect(kept(good, s), good).toBe(true); }
        expect(kept('The first and last readings are both 1.00.', sheet('1.00, 1.30, 1.00'))).toBe(false);
        expect(kept('The highest reading was 1.00.', sheet('1.00, 1.00, 0.80'))).toBe(false);
        for (const bad of ['In the first visit the brightness was 1.30 and the last was 1.00, so it rose.', 'The brightness was unchanged from 1.30 to 1.00.', 'The brightness started at 1.30 and ended at 1.00.', 'From the first visit to the last, the brightness fell from 1.30 to 1.00.']) { expect(kept(bad, s), bad).toBe(false); }
        expect(kept('The brightness went from 1.30 then 1.00.', sheet('1.30, 1.50, 1.00'))).toBe(false);
        expect(kept('The brightness rose from 1.00 to 1.30 by the end.', sheet('1.00, 1.30, 1.00'))).toBe(false);
        expect(kept('Over 3 visits, the brightness went from 1.30 to 1.00 between the first visit and the last visit.', s)).toBe(true);
    });
    it('H2a checks comparisons containing digits', () => {
        expect(kept('Over 3 visits, the change is several times larger than that scatter.', sheet('1.00, 1.00, 1.03', '3 percent above it'))).toBe(false);
        expect(kept('The change is larger than that scatter.', sheet('1.00, 1.00, 1.03', '3 percent above it'))).toBe(true);
    });
    it('H2b closes comparison paraphrases and checks bounded changes', () => {
        for (const word of ['dwarfs', 'towers over', 'stands out clearly against', 'is far bigger than', 'is well beyond', 'is lost in', 'is buried in']) { expect(kept(`The change ${word} the noise.`, sheet())).toBe(false); }
        expect(kept('The change is no larger than that scatter, so it may be noise.', sheet('1.00, 1.00, 1.00', 'less than 1 percent', '0.2, 0.5'))).toBe(false);
        expect(kept('The change is no larger than that scatter, so it may be noise.', sheet('1.00, 1.00, 1.00', 'less than 1 percent', '0.2, 0.3'))).toBe(false);
        expect(kept('The change is no larger than that scatter, so it may be noise.', sheet('1.00, 1.00, 1.00', 'less than 1 percent'))).toBe(true);
        expect(kept('Over 3 visits, the dimming dwarfs the noise.', sheet())).toBe(false);
        for (const bad of ['The change is lost in the scatter.', 'The change is buried in the noise.', 'The change dwarfs the scatter.', "The change swamps the reference stars' scatter."]) { expect(kept(bad, sheet()), bad).toBe(false); }
    });
    it('H2c keeps the fixed no-reference sentence', () => {
        const s = sheet().filter((line) => !line.startsWith('Reference stars:'));
        expect(kept('There are no reference stars to compare the change with.', s)).toBe(true);
        expect(kept('There are no reference stars to compare the change with, so the change counts for little.', [...s, 'Reference stars: 0 with available scatter.'])).toBe(true);
        expect(kept('There are no reference stars, so the change cannot be compared with a reference scatter.', s)).toBe(false);
        expect(kept('The change is larger than that scatter.', s)).toBe(false);
        expect(kept('The change is several times larger than that scatter.', [...s, 'Reference stars: 0 with available scatter. Scatter of each: 1.2, 2.0 percent.'])).toBe(false);
    });
    it('N checks verdicts, direction, motion and target scatter', () => {
        const s = sheet('1.00, 1.00, 1.01', '1 percent above it');
        for (const bad of ['It faded.', 'The star is variable.', 'This is a real change.', 'The change is significant.', 'The star moved.', 'This confirms a flare.', 'The star brightened.', 'That scatter is in the target itself.', 'The 3 visits confirm a flare.']) { expect(kept(bad, s), bad).toBe(false); }
        expect(kept('Check whether this is a flare.', s)).toBe(false);
        expect(kept('The brightness is steady.', s)).toBe(true);
        expect(kept('The star is variable, if the data are reliable.', s)).toBe(false);
        expect(kept('The noise belongs to the star.', s)).toBe(false);
        expect(kept('The brightness rose across the visits.', s)).toBe(false);
        expect(kept('The brightness rose across the visits.', sheet('1.00, 1.00, 1.30'))).toBe(true);
    });
    it('S prevents signal-to-noise borrowing a reading', () => {
        expect(kept('The lowest signal-to-noise was 1.30 in the first reading.', sheet())).toBe(false);
        expect(kept('The lowest signal-to-noise was 3.4 sigma in the difference image.', [...sheet(), 'Difference image at the target: strongest pixel 3.4 sigma.'])).toBe(false);
        expect(kept('The lowest signal-to-noise was 30.', sheet())).toBe(true);
    });
    it('O rejects sentence-initial bounds', () => {
        for (const bad of ['Over 400.0 days passed between the first and last visit.', 'Over 3 visits were needed.']) { expect(kept(bad, sheet()), bad).toBe(false); }
        expect(kept('Over 3 visits, the brightness went from 1.30 to 1.00.', sheet())).toBe(true);
    });
    it('P caps long notes and handles hostile dotted input quickly', () => {
        for (const input of ['A' + '1.a'.repeat(6667), 'a.'.repeat(10000)]) {
            const start = performance.now();
            expect(() => checkNote(`Safe sentence. Another safe sentence. ${input}`, sheet())).not.toThrow();
            expect(performance.now() - start).toBeLessThan(200);
        }
        for (const input of ['A' + '1.a'.repeat(2600), 'a.'.repeat(3900)]) {
            const start = performance.now();
            checkNote(`Safe sentence. Another safe sentence. ${input}.`, sheet());
            expect(performance.now() - start).toBeLessThan(200);
        }
    });
    it('Q accepts a curly apostrophe', () => {
        expect(kept('Look at the second visit’s frames.', sheet())).toBe(true);
    });
    it('M3b rejects approximation and names before counts', () => {
        for (const bad of ['There were 3 visits or so.', 'There were 3 visits at most.', 'There were 3 visits at least.', 'There were upwards of 3 visits.', 'There were just over 3 visits.', 'There were just under 3 visits.', 'The star was compared with 2MASS reference stars.', 'There were 2 reference stars or more.', 'There were 3 observations or more.']) { expect(kept(bad, sheet()), bad).toBe(false); }
        expect(kept('There were exactly 3 visits.', sheet())).toBe(true);
    });
    it('T keeps every paragraph for no references, two visits, equal endpoints and a bounded change', () => {
        const cases = [
            [sheet().filter((line) => !line.startsWith('Reference stars:')), 'In time order the brightness was 1.30, 1.00 and 1.00.', 'There are no reference stars to compare the change with.'],
            [sheet('1.00, 1.30').map((line) => line.replace('Visits: 3.', 'Visits: 2.')), 'In time order the brightness was 1.00 and 1.30.', 'The reference stars scatter by 1.2 and 2.0 percent.'],
            [sheet('1.00, 1.30, 1.00'), 'In time order the brightness was 1.00, 1.30 and 1.00.', 'The reference stars scatter by 1.2 and 2.0 percent.'],
            [sheet('1.00, 1.00, 1.00', 'less than 1 percent'), 'In time order the brightness was 1.00, 1.00 and 1.00.', 'The reference stars scatter by 1.2 and 2.0 percent.'],
        ] as const;
        for (const [facts, summary, trust] of cases) {
            const note = `What this shows: ${summary}\nHow far to trust it: ${trust}\nWhat to check next: Change the colour to look at another wavelength.`;
            expect(checkNote(note, facts).text.split('\n'), note).toHaveLength(3);
        }
    });
});

describe('round 15 measured-note safeguards', () => {
    const base = ['Wavelength: 1.200 micron.', 'Visits: 3. Frames in each visit: 8, 8, 8.', 'Brightness relative to the reference stars, in time order: 1.00, 1.00, 1.30.', 'Largest change from the median brightness: 30 percent above it.', 'Lowest signal-to-noise among the points: 30.', 'Reference stars: 2 with available scatter. Scatter of each: 1.2, 2.0 percent.'];
    const median = 'The largest change from the median brightness is 30 percent above the median.';
    const scatter = 'The 2 reference stars scatter by 1.2, 2.0 percent.';
    const next = 'Change the colour to look at another wavelength.';
    const run = (sentence: string, source = base, label = 'What this shows') => checkNote(`${label}: ${sentence}\nHow far to trust it: The wavelength is 1.200 micron.\nWhat to check next: ${next}`, source, { labelled: true }).text;
    it('rule 1: comparisons require earlier kept median and scatter', () => {
        const comparison = 'The change is several times larger than that scatter.';
        expect(run(comparison)).not.toContain(comparison);
        expect(run(`${median} ${scatter} ${comparison}`)).toContain(comparison);
        expect(run(`${median} ${comparison} ${scatter}`)).not.toContain(comparison);
    });
    it('rule 2: endpoint sentences cannot hide a middle peak', () => {
        const peak = base.map((s) => s.replace('1.00, 1.00, 1.30', '1.00, 1.30, 1.02'));
        expect(run('The brightness went from 1.00 to 1.02.', peak)).not.toContain('went from');
        expect(run('The first and last readings are both 1.00.', peak.map((s) => s.replace('1.30, 1.02', '1.30, 1.00')))).not.toContain('both');
    });
    it('rule 3: directional endpoints must exceed scatter and one percent', () => {
        const small = base.map((s) => s.replace('1.00, 1.00, 1.30', '1.00, 1.00, 1.01'));
        expect(run('The brightness rose from 1.00 to 1.01.', small)).not.toContain('rose from');
        expect(run('The brightness went from 1.00 to 1.01.', small)).toContain('went from');
        const equalScatter = base.map((s) => s.replace('1.00, 1.00, 1.30', '1.00, 1.00, 1.02'));
        expect(run('The brightness rose from 1.00 to 1.02.', equalScatter)).not.toContain('rose from');
    });
    it('rule 4: change-dependent suggestions require a measured change', () => {
        const flat = base.map((s) => s.replace('30 percent above it', 'less than 1 percent'));
        for (const s of ['Wait for another visit to see whether the change repeats.', 'Change the colour to see whether the change shows at another wavelength.']) {
            expect(run(s, flat, 'What to check next')).not.toContain(s);
            expect(run(s, base, 'What to check next')).toContain(s);
        }
    });
    it('rule 5: little and no-comparison claims require a measured change', () => {
        const flat = base.map((s) => s.replace('30 percent above it', 'less than 1 percent').replace('Visits: 3.', 'Visits: 2.').replace('Lowest signal-to-noise among the points: 30.', 'Lowest signal-to-noise among the points: below 1.'));
        const absent = flat.filter((s) => !s.startsWith('Reference stars:'));
        const unavailable = [...absent, 'Reference stars: scatter unavailable.'];
        for (const [s, source] of [
            ['There are fewer than 3 visits, so the change counts for little.', flat],
            ['The lowest signal-to-noise is small, so the change counts for little.', flat],
            ['There are no reference stars to compare the change with.', absent],
            ['There are no reference stars to compare the change with, so the change counts for little.', absent],
            ["The reference stars' scatter is unavailable, so there is nothing to compare the change with.", unavailable],
            ["The reference stars' scatter is unavailable, so there is nothing to compare the change with, so the change counts for little.", unavailable],
        ] as const) { expect(run(s, source)).not.toContain(s); }
    });
    it('rule 6: difference and its warning must be adjacent and both kept', () => {
        const difference = 'Difference image at the target: strongest pixel 7.0 sigma, brighter there in the later visit.';
        const warning = 'A bright star leaves marks this strong from a tiny misalignment, and a star that moved leaves a bright side and a dark side.';
        const source = [...base, `${difference} ${warning}`];
        expect(run(difference, source)).not.toContain(difference);
        expect(run(warning, source)).not.toContain(warning);
        expect(run(`${difference} ${warning}`, source)).toContain(`${difference} ${warning}`);
        expect(run(`${difference.replace('7.0', '8.0')} ${warning}`, source)).not.toContain(warning);
    });
    it('rule 7: candidate requires a measured change or shift and cannot satisfy measurement', () => {
        const flat = base.map((s) => s.replace('30 percent above it', 'less than 1 percent'));
        expect(run('This is a candidate only.', flat)).not.toContain('This is a candidate only.');
        expect(run('This is a candidate only.')).toContain('This is a candidate only.');
        expect(() => checkNote(`What this shows: This is a candidate only.\nWhat to check next: ${next}`, base, { labelled: true })).toThrowError(expect.objectContaining({ code: 'unverified' }));
    });
    it('rule 8: faint points prohibit the over-visits lead', () => {
        const faint = base.map((s) => s.replace('1.00, 1.00, 1.30.', '1.00, 1.00, 1.30. Points too faint to measure are left out.'));
        expect(run('Over 3 visits, in time order, the brightness was 1.00, 1.00, 1.30.', faint)).not.toContain('Over 3 visits');
    });
    it('rule 9: scatter accepts the sheet comma list and and-list', () => {
        expect(run(scatter)).toContain(scatter);
        expect(run('The 2 reference stars scatter by 1.2 and 2.0 percent.')).toContain('1.2 and 2.0');
    });
    it('rule 10: changed is never an accepted endpoint verb', () => {
        const small = base.map((s) => s.replace('1.00, 1.00, 1.30', '1.00, 1.00, 1.01'));
        expect(run('The brightness changed from 1.00 to 1.01.', small)).not.toContain('changed from');
        expect(run('The brightness changed from 1.00 to 1.30.')).not.toContain('changed from');
        const equalScatter = base.map((s) => s.replace('1.00, 1.00, 1.30', '1.00, 1.00, 1.02'));
        expect(run('The brightness changed from 1.00 to 1.02.', equalScatter)).not.toContain('changed from');
    });
    it('rule 11: reference comparison needs available reference scatter', () => {
        const source = base.map((s) => s.startsWith('Reference stars:') ? 'Reference stars: scatter unavailable.' : s);
        const sentence = 'Compare the target with the reference stars in the same frames.';
        expect(run(sentence, source, 'What to check next')).not.toContain(sentence);
        expect(run(sentence, base, 'What to check next')).toContain(sentence);
    });
    it('rule 12: labelled continuation lines group under their active label once', () => {
        const note = `What this shows:\n\nThe wavelength is 1.200 micron.\nHow far to trust it:\n${scatter}\nWhat this shows: ${median}\nWhat to check next: ${next}`;
        const text = checkNote(note, base, { labelled: true }).text;
        expect(text.split('\n')).toEqual([`What this shows: The wavelength is 1.200 micron. ${median}`, `How far to trust it: ${scatter}`, `What to check next: ${next}`]);
    });
    it('rule 13: exactly one visit uses singular grammar', () => {
        const one = base.map((s) => s.startsWith('Visits:') ? 'Visits: 1. Frames in each visit: 8.' : s);
        expect(run('There was 1 visit.', one)).toContain('There was 1 visit.');
        expect(run('There were 1 visits.', one)).not.toContain('There were 1 visits.');
    });
    it('mutant: first and last both must actually match', () => {
        expect(run('The first and last readings are both 1.00.')).not.toContain('readings are both');
    });
    it('mutant: small signal-to-noise needs a small printed value', () => {
        expect(run('The lowest signal-to-noise is small, so the change counts for little.')).not.toContain('is small');
    });
    it('mutant: nothing measured requires no brightness, difference or shift line', () => {
        expect(run('There is nothing measured to interpret yet.')).not.toContain('nothing measured');
    });
    it('mutant: third paragraph requires the complete exact sentence', () => {
        for (const s of ['Change the colour to look at another wavelength!', 'Change the colour to look at another wavelength, and it is real.']) {
            expect(run(s, base, 'What to check next')).not.toContain(s);
        }
    });
    it('checks 20,000-character labelled inputs in under 200 ms', () => {
        for (const input of ['A' + '1.a'.repeat(6667), 'a.'.repeat(10000)]) {
            const start = performance.now();
            checkNote(`What this shows: The wavelength is 1.200 micron.\nWhat to check next: ${next}\n${input}`, base, { labelled: true });
            expect(performance.now() - start).toBeLessThan(200);
        }
    });
    it('keeps all three paragraphs of twelve notes following the new prompt', () => {
        const make = (values: number[], options: { refs?: number[]; visits?: number; shift?: boolean; difference?: number; faint?: boolean; noCurve?: boolean } = {}) => {
            const visits = Array.from({ length: options.visits ?? values.length }, (_, i) => ({ mjd: 61000 + 10 * i, frames: 8 }));
            const points = values.map((relative, i) => ({ mjd: 61000 + 10 * i, relative, snr: options.faint && i === 1 ? 0.5 : 30 }));
            return factSheet({ ...facts, visits, ...(options.noCurve ? { lightCurve: undefined } : { lightCurve: { points, refScatter: options.refs ?? [0.012, 0.02], dropped: 0 } }), difference: options.difference === undefined ? undefined : { peakSigma: options.difference }, motion: options.shift ? { arcsec: 3.2, days: 10 } : undefined });
        };
        const difference = 'Difference image at the target: strongest pixel 7.0 sigma, brighter there in the later visit. A bright star leaves marks this strong from a tiny misalignment, and a star that moved leaves a bright side and a dark side.';
        const cases: [string, string[], string, string, number[]][] = [
            ['rise', make([1, 1, 1.3]), 'The brightness went from 1.00 to 1.30.', scatter, [1, 1, 1]],
            ['fall', make([1.3, 1, 1]), 'The brightness went from 1.30 to 1.00.', scatter, [1, 1, 1]],
            ['flat', make([1, 1, 1]), 'In time order, the brightness was 1.00, 1.00, 1.00.', scatter, [1, 1, 1]],
            ['middle peak', make([1, 1.3, 1]), 'In time order, the brightness was 1.00, 1.30, 1.00.', scatter, [1, 1, 1]],
            ['two visits', make([1, 1.3]), 'The brightness went from 1.00 to 1.30.', 'There are fewer than 3 visits, so the change counts for little.', [1, 1, 1]],
            ['one visit', make([1]), 'There was 1 visit.', 'The lowest signal-to-noise among the points is 30.', [1, 1, 1]],
            ['no reference scatter', make([1, 1, 1.3], { refs: [] }), 'The brightness went from 1.00 to 1.30.', "The reference stars' scatter is unavailable, so there is nothing to compare the change with.", [1, 1, 1]],
            ['less than 1 percent', make([1, 1.004, 1.008]), 'In time order, the brightness was 1.00, 1.00, 1.01.', scatter, [1, 1, 1]],
            ['shift only', make([], { visits: 2, noCurve: true, shift: true }), 'The shift in position was 3.2 arcsec over 10.0 days.', 'There were 2 visits.', [1, 1, 1]],
            ['nothing measured', make([], { visits: 2, noCurve: true }), 'There is nothing measured to interpret yet.', 'There were 2 visits.', [1, 1, 1]],
            ['difference warning', make([], { visits: 2, noCurve: true, difference: 7 }), difference, 'There were 2 visits.', [2, 1, 1]],
            ['faint points', make([1, 0.2, 1.1, 1.3], { faint: true }), 'In time order, the brightness was 1.00, 1.10, 1.30.', scatter, [1, 1, 1]],
        ];
        for (const [name, source, show, trust, counts] of cases) {
            const result = checkNote(`What this shows: ${show}\nHow far to trust it: ${trust}\nWhat to check next: ${next}`, source, { labelled: true });
            expect(result.text.split('\n').map((part) => (part.match(/[.!?](?=\s|$)/g) ?? []).length), name).toEqual(counts);
            expect(result.dropped, name).toBe(0);
        }
    });
});

describe('honest fact sheet', () => {
    const withPoints = (points: { mjd: number; relative: number; snr: number }[]) => ({ ...facts, lightCurve: { ...facts.lightCurve!, points } });
    it('uses printed precision at the bounds', () => {
        // The lowest signal-to-noise is rounded down, so the sheet never shows it better than it is.
        for (const [snr, shown] of [[1, '1'], [1.5, '1'], [1.99, '1'], [99.5, '99'], [100, '100'], [100.4, '100'],
            [100.99, '100'], [101, 'more than 100']] as const) {
            expect(factSheet(withPoints([{ mjd: 61000, relative: 1, snr }])).join(' ')).toContain(`points: ${shown}.`);
        }
        for (const [peakSigma, shown] of [[100, '100.0 sigma'], [100.04, '100.0 sigma'], [5, '5.0 sigma'], [0.04, 'no change above the noise']] as const) {
            expect(factSheet({ ...facts, difference: { peakSigma } }).join(' ')).toContain(shown);
        }
        expect(factSheet({ ...facts, difference: { peakSigma: 5 } }).join(' ')).toContain('A bright star');
        const pts = [1, 1, 1.0051].map((relative, i) => ({ mjd: 61000 + i, relative, snr: 10 }));
        expect(factSheet(withPoints(pts))).toContain('Largest change from the median brightness: 1 percent above it.');
    });
    it('omits the span for a single visit', () => {
        expect(factSheet({ ...facts, visits: [facts.visits[0]!] }).join(' ')).not.toContain('Time from first to last visit');
    });
    it('computes change using only the displayed points', () => {
        const sheet = factSheet(withPoints([0.8, 1, 1.2, 20].map((relative, i) => ({ mjd: 61000 + i, relative, snr: i === 3 ? 0.9 : 10 }))));
        expect(sheet.join(' ')).toContain('0.80, 1.00, 1.20. Points too faint');
        expect(sheet).toContain('Largest change from the median brightness: 20 percent either side.');
    });
    it('bounds signal-to-noise and checks the printed bound', () => {
        const sheet = factSheet(withPoints([{ mjd: 61000, relative: 1, snr: 3582 }]));
        expect(sheet).toContain('Lowest signal-to-noise among the points: more than 100. This counts sky noise only, so the real uncertainty is larger.');
        expect(checkNote('The signal-to-noise is more than 100. Safe sentence. Another safe sentence.', sheet).dropped).toBe(1);
        expect(checkNote('The signal-to-noise is 3582. Safe sentence. Another safe sentence.', sheet).dropped).toBe(1);
        for (const snr of [-0.01, 0, 0.99]) {
            expect(factSheet(withPoints([{ mjd: 61000, relative: 1, snr }])).join(' ')).toContain('points: below 1.');
        }
    });
    it('reports equal deviations, negligible changes, and excludes weak points', () => {
        const pair = [{ mjd: 61000, relative: 0.8, snr: 10 }, { mjd: 61001, relative: 1.2, snr: 10 }];
        expect(factSheet(withPoints(pair)).some((line) => line.startsWith('Largest change'))).toBe(false);
        expect(factSheet(withPoints([...pair, { mjd: 61002, relative: 1, snr: 10 }]))).toContain('Largest change from the median brightness: 20 percent either side.');
        expect(factSheet(withPoints([{ ...pair[0]!, relative: 0.999 }, { ...pair[1]!, relative: 1.001 }, { mjd: 61002, relative: 1, snr: 10 }]))).toContain('Largest change from the median brightness: less than 1 percent.');
        const weak = factSheet(withPoints([...pair, { mjd: 61002, relative: 20, snr: 0.9 }]));
        expect(weak).toContain('Brightness relative to the reference stars, in time order: 0.80, 1.20. Points too faint to measure are left out.');
        expect(weak.some((line) => line.startsWith('Largest change'))).toBe(false);
        const one = factSheet(withPoints([pair[0]!, { ...pair[1]!, snr: 0 }]));
        expect(one.some((line) => /^(Brightness relative|Largest change)/.test(line))).toBe(false);
    });
    it('names the direction of a one-sided change and treats printed ties as ties', () => {
        const pts = (rel: number[]) => withPoints(rel.map((relative, i) => ({ mjd: 61000 + i, relative, snr: 10 })));
        expect(factSheet(pts([1, 1, 0.5]))).toContain('Largest change from the median brightness: 50 percent below it.');
        expect(factSheet(pts([1, 1, 1.5]))).toContain('Largest change from the median brightness: 50 percent above it.');
        expect(factSheet(pts([0.8124, 1, 1.1877]))).toContain('Largest change from the median brightness: 19 percent either side.');
        expect(factSheet(pts([0.9, 1, 1.1004]))).toContain('Largest change from the median brightness: 10 percent either side.');
        for (const values of [[1.3, 1, 1], [1, 1, 1.3], [1, 1, 0.77], [0.81, 1, 1.19]]) {
            expect(factSheet(pts(values)).find((line) => line.startsWith('Largest change'))).not.toMatch(/brighter|dimmer/);
        }
        for (const [values, expected] of [[[1.3, 1, 1], '30 percent above it'], [[1, 1, 0.77], '23 percent below it'], [[0.81, 1, 1.19], '19 percent either side']] as const) {
            const sheet = factSheet(pts([...values]));
            expect(sheet).toContain(`Largest change from the median brightness: ${expected}.`);
            expect(checkNote(`The largest change from the median brightness was ${expected}. Safe sentence. Another safe sentence.`, sheet).dropped).toBe(0);
        }
    });
    it('adds the misalignment caution whenever the printed value is 5.0 or more', () => {
        expect(factSheet({ ...facts, difference: { peakSigma: 4.96 } }).join(' ')).toContain('5.0 sigma, brighter there in the later visit. A bright star');
        expect(factSheet({ ...facts, difference: { peakSigma: 4.94 } }).join(' ')).not.toContain('A bright star');
    });
    it('keeps the direction of a printed bound', () => {
        const pad = 'Safe sentence. Another safe sentence.';
        const big = factSheet(withPoints([{ mjd: 61000, relative: 1, snr: 3582 }]));
        expect(checkNote(`The signal-to-noise is above 100. ${pad}`, big).dropped).toBe(1);
        expect(checkNote(`The signal-to-noise is 100. ${pad}`, big).dropped).toBe(1);
        expect(checkNote(`The signal-to-noise is less than 100. ${pad}`, big).dropped).toBe(1);
        const low = factSheet(withPoints([{ mjd: 61000, relative: 1, snr: 0.4 }]));
        expect(checkNote(`The signal-to-noise is below 1. ${pad}`, low).dropped).toBe(1);
        expect(checkNote(`The signal-to-noise is 1. ${pad}`, low).dropped).toBe(1);
        const small = factSheet(withPoints([{ mjd: 61000, relative: 0.999, snr: 50 }, { mjd: 61001, relative: 1.001, snr: 50 }, { mjd: 61002, relative: 1, snr: 50 }]));
        expect(checkNote(`The largest change from the median was less than 1 percent. ${pad}`, small).dropped).toBe(0);
        expect(checkNote(`The brightness changed by more than 1 percent. ${pad}`, small).dropped).toBe(1);
        expect(checkNote(`The brightness changed by 1 percent. ${pad}`, small).dropped).toBe(1);
        const frames = factSheet({ ...facts, visits: [{ mjd: 61000, frames: 500 }, { mjd: 61010, frames: 7 }] });
        expect(checkNote(`The first visit had at least 500 frames. ${pad}`, frames).dropped).toBe(0);
        expect(checkNote(`The first visit had 500 frames. ${pad}`, frames).dropped).toBe(1);
        expect(checkNote(`The second visit had 7 frames. ${pad}`, frames).dropped).toBe(0);
        const twelve = factSheet({ ...facts, visits: Array.from({ length: 12 }, (_, i) => ({ mjd: 61000 + 20 * i, frames: 2 })) });
        expect(twelve[3]).toMatch(/^Visits: at least 12\. /);
        expect(checkNote(`SPHEREx came back on at least 12 visits. ${pad}`, twelve).dropped).toBe(0);
        expect(checkNote(`SPHEREx came back on 12 visits. ${pad}`, twelve).dropped).toBe(1);
    });
    it('describes the strongest difference pixel with bounds and context', () => {
        expect(factSheet({ ...facts, difference: { peakSigma: -3.4 } })).toContain('Difference image at the target: strongest pixel 3.4 sigma, fainter there in the later visit.');
        expect(factSheet({ ...facts, difference: { peakSigma: 0.01 } })).toContain('Difference image at the target: no change above the noise.');
        expect(factSheet({ ...facts, difference: { peakSigma: 101 } })).toContain('Difference image at the target: strongest pixel more than 100 sigma, brighter there in the later visit. A bright star leaves marks this strong from a tiny misalignment, and a star that moved leaves a bright side and a dark side.');
    });
    it('reports a rounded zero shift and a saved copy', () => {
        const sheet = factSheet({ ...facts, motion: { arcsec: 0.01, days: 10 } });
        expect(sheet).toContain('Shift in position: none measured over 10.0 days.');
        expect(sheet).toContain('Frames came from: a saved copy.');
    });
    it('uses the shown visit count when checking past ordinal claims', () => {
        const sheet = factSheet(facts);
        expect(checkNote('The third visit was brighter. Safe sentence. Another safe sentence.', sheet).dropped).toBe(1);
    });
    it('omits non-finite scatter values', () => {
        const sheet = factSheet({ ...facts, lightCurve: { ...facts.lightCurve!, refScatter: [NaN, 0.02] } });
        expect(sheet.join(' ')).not.toContain('NaN');
        expect(sheet).toContain('Reference stars: 1 with available scatter. Scatter of each: 2.0 percent.');
    });
});

describe('round 10 conservative number checks', () => {
    const pad = 'This is a useful view. Check it again.';
    const check = (sentence: string, sheet: string[]) => checkNote(`${sentence}\n${pad}`, sheet);
    const scatter = ['Reference stars: 2 with available scatter. Scatter of each: 1.2, 2.0 percent.'];
    const median = ['Largest change from the median brightness: 30 percent above it.'];

    it('accepts every closed scatter form and full printed list', () => {
        for (const values of [['1.2'], ['1.2', '2.0'], ['1.2', '2.0', '3.4']]) {
            const n = values.length;
            const sheet = [`Reference stars: ${n} with available scatter. Scatter of each: ${values.join(', ')} percent.`];
            const list = n === 1 ? values[0] : `${values.slice(0, -1).join(', ')} and ${values[n - 1]}`;
            const oxford = n > 2 ? `${values.slice(0, -1).join(', ')}, and ${values[n - 1]}` : list;
            for (const subject of ['reference', 'comparison']) {
                for (const count of ['', ` ${n}`]) {
                    for (const verb of n === 1 ? ['scatters by', 'has a scatter of'] : ['scatter by', 'have a scatter of']) {
                        for (const printed of [list, oxford]) {
                            const sentence = `The${count} ${subject} ${n === 1 ? 'star' : 'stars'} ${verb} ${printed} percent.`;
                            expect(check(sentence, sheet).dropped, sentence).toBe(0);
                        }
                    }
                }
            }
        }
    });
    it('mutant: scatter must match the whole sentence, list, order and count', () => {
        for (const sentence of [
            'The reference stars scatter by 1.2 percent.', 'The reference stars scatter by 2.0 and 1.2 percent.',
            'The 3 reference stars scatter by 1.2 and 2.0 percent.', 'The 2 reference stars show a spread of 1.2 and 2.0 percent.',
            'Its scatter is 1.2 percent, smaller than the reference stars.', "The star's scatter is 1.2 percent compared with the reference stars.",
            'Its scatter is at least 1.2 percent compared with the reference stars.', 'Its scatter is 1.2 percent, unlike the reference stars.',
            'The reference stars scatter by no more than 1.2 and 2.0 percent.', 'The reference stars scatter within 1.2 and 2.0 percent.',
            'The reference stars scatter by only 1.2 and 2.0 percent.', 'The reference stars scatter by just 1.2 and 2.0 percent.',
            'The reference stars have a scatter of around 1.2 and 2.0 percent.',
            'Compared with the reference stars and their scatter, the star swelled by 1.2 percent.',
            'Compared with the reference stars and their scatter, it swelled by 1.2 percent.',
            'Compared with the reference stars and their scatter, it waned by 2.0 percent.',
            'The 2 reference stars scatter by 1.2 and under 2.0 percent.',
            'The 2 reference stars scatter by 1.2 percent and under 2.0 percent.',
            'The reference stars have a scatter of at least 1.2 or 2.0 percent.',
            'The reference stars have a scatter of below 1.2, 2.0 percent.',
            'The star scatters by 1.2 and 2.0 percent against the reference stars.',
            "Barnard's Star shows a scatter of 1.2 and 2.0 percent against the reference stars.",
            "Against the reference stars' scatter, the star swelled by 2.0 percent.",
            'The reference stars scatter by 1.2 and 2.0 percent, while the star faded.',
        ]) { expect(check(sentence, scatter).dropped, sentence).toBe(1); }
    });
    it('mutant: median direction requires its referent', () => {
        expect(check('The largest change from the median brightness is 30 percent above.', median).dropped).toBe(1);
    });
    it('mutant: median requires is or was', () => {
        expect(check('The largest change from the median brightness became 30 percent above it.', median).dropped).toBe(1);
    });
    it('mutant: scatter final full stop is required', () => {
        expect(check('The 2 reference stars scatter by 1.2 and 2.0 percent', scatter).dropped).toBe(1);
    });
    it('mutant: scatter list cannot be reordered or shortened', () => {
        expect(check('The reference stars scatter by 2.0 and 1.2 percent.', scatter).dropped).toBe(1);
        expect(check('The reference stars scatter by 1.2 percent.', scatter).dropped).toBe(1);
    });
    it('mutant: scatter count must match the sheet', () => {
        expect(check('The 3 reference stars scatter by 1.2 and 2.0 percent.', scatter).dropped).toBe(1);
    });
    it('checks unrecognized labels and both fragments of a broken line', () => {
        for (const label of ['Reference stars', 'Fading', 'Sky background', 'At the first visit']) {
            expect(check(`${label}: The largest change from the median brightness is 30 percent above the median.`, median).dropped, label).toBe(1);
        }
        expect(check('The largest change from the median brightness is 30 percent above the median\nat the first visit, before it faded.', median).dropped).toBe(2);
    });
    it('mutant: count facts require a counting noun', () => {
        const sheet = ['Visits: 3. Frames in each visit: 30, 31.', 'Lowest signal-to-noise among the points: 30.', 'Brightness relative to the reference stars, in time order: 1.00, 1.01, 1.00.'];
        for (const sentence of ['The brightness rose by 30 across the frames.', 'The brightness rose by 30 in the frames of each visit.', 'The brightness rose by 30 in frames of each visit.', 'Over 3 visits the brightness rose 3 above the median.', 'The brightness dropped by 1.0 between visits.']) {
            expect(check(sentence, sheet).dropped, sentence).toBe(1);
        }
        for (const sentence of ['The visit had 30 frames.', 'There were 3 visits.']) {
            expect(check(sentence, sheet).dropped, sentence).toBe(0);
        }
    });
    it('mutant: signal-to-noise needs immediate context', () => {
        const sheet = ['Lowest signal-to-noise among the points: 30.'];
        for (const sentence of ['The brightness rose by 30 above the noise.', 'Against the noise, the brightness is 30 above the median.']) {
            expect(check(sentence, sheet).dropped, sentence).toBe(1);
        }
        for (const sentence of ['The lowest signal-to-noise is 30.']) {
            expect(check(sentence, sheet).dropped, sentence).toBe(0);
        }
    });
    it('keeps an elapsed-time preposition', () => {
        const sheet = ['Visits: 3. Frames in each visit: 30, 31.', 'Shift in position: 10.4 arcsec over 20.0 days.'];
        expect(check('It shifted 10.4 arcsec over 20.0 days.', sheet).dropped).toBe(0);
    });
    it('keeps all three paragraphs of eight prompt-shaped notes', () => {
        const scenarios = [
            { values: [1, 1, 1.3], refs: [0.012, 0.02], summary: 'The brightness rose over the visits.', comparison: 'The change is several times larger than that scatter.' },
            { values: [1.3, 1, 1], refs: [0.012, 0.02], summary: 'The brightness fell over the visits.', comparison: 'The change is several times larger than that scatter.' },
            { values: [1, 1, 1], refs: [0.012, 0.02], summary: 'The brightness stayed level over the visits.', comparison: 'The change is no larger than that scatter, so it may be noise.' },
            { values: [0.81, 1, 1.19], refs: [0.012, 0.02], summary: 'The brightness rose across the visits.', comparison: 'The change is several times larger than that scatter.' },
            { values: [0.999, 1, 1.001], refs: [0.012, 0.02], summary: 'The brightness was nearly level over the visits.', comparison: 'The change is no larger than that scatter, so it may be noise.' },
            { values: [1, 1, 1.3], refs: [0.012], summary: 'The brightness rose over the visits.', comparison: 'The change is several times larger than that scatter.' },
            { values: [1, 1, 1.3], refs: [], summary: 'In time order the brightness was 1.00, 1.00 and 1.30.', comparison: 'Reference star scatter is unavailable, so this needs caution.' },
            { values: [1, 1.01], refs: [0.012, 0.02], summary: 'In time order the brightness was 1.00 and 1.01.', comparison: 'The reference stars scatter by 1.2 and 2.0 percent.' },
        ];
        for (const { values, refs, summary, comparison } of scenarios) {
            const sheet = factSheet({ ...facts, visits: values.map((_, i) => ({ mjd: 61000 + i * 10, frames: 3 + i })), lightCurve: { points: values.map((relative, i) => ({ mjd: 61000 + i * 10, relative, snr: 10 })), refScatter: refs, dropped: 0 } });
            const scatterSentence = refs.length === 2 ? 'The 2 reference stars scatter by 1.2 and 2.0 percent. ' : refs.length === 1 ? 'The 1 reference star scatters by 1.2 percent. ' : '';
            const safeSummary = `In time order, the brightness was ${values.map((n) => n.toFixed(2)).join(', ')}.`;
            const safeComparison = refs.length === 0 ? "The reference stars' scatter is unavailable, so there is nothing to compare the change with." : values.length === 2 ? 'There are fewer than 3 visits, so the change counts for little.' : comparison;
            const note = `What this shows: ${safeSummary}\nHow far to trust it: ${scatterSentence}${safeComparison}\nWhat to check next: Change the colour to look at another wavelength.`;
            void summary;
            const result = checkNote(note, sheet);
            expect(result.text.split('\n'), note).toHaveLength(3);
        }
    });
});
const note = 'What this shows: The wavelength is 4.270 micron.\nHow far to trust it: There are fewer than 3 visits, so the change counts for little.';
function createHandlers(deps: Pick<InsightDeps, 'apiKey' | 'model' | 'complete' | 'now'> & Partial<InsightDeps>)
{
    return createServerHandlers({ store: memoryStore(), local: memoryStore(), passcode: undefined, open: true, maxPerUserDay: 20, maxPerDay: 300, maxPerHour: 120, ...deps });
}
function request(value: unknown, headers: Record<string, string> = {}): Request
{
    return new Request('https://example.test/api/insight', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}
describe('round four corpus', () => {
    const sheet = ["Target: Barnard's Star.", 'Position: RA 269.4521 deg, Dec 4.6934 deg.', 'Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 14, 12, 16. Time from first to last visit: 182.5 days.', 'Brightness relative to the reference stars, in time order: 1.00, 0.97, 1.12.', 'Largest change from the median brightness: 12 percent above it.', 'Lowest signal-to-noise among the points: 48.', 'Reference stars: 3. Scatter of each: 1.2, 1.8, 2.5 percent.', 'Frames left out because their wavelength did not match: 0.', 'Difference image at the target: 3.4 sigma, brighter in the later visit.', 'Shift in position: 10.4 arcsec over 182.5 days.', "Frames came from: NASA's live archive."];
    const good = ["Barnard's Star was seen in 3 visits spread over 182.5 days.", 'The visits hold 14, 12 and 16 frames.', 'Its brightness relative to the reference stars went from 1.00 to 0.97 and then 1.12.', 'The largest change from the median brightness is 12 percent above it.', 'The 3 reference stars scatter by 1.2, 1.8 and 2.5 percent, so the 12 percent change stands out.', 'The lowest signal-to-noise among the points is 48.', 'The difference image shows 3.4 sigma at the target, brighter in the later visit.', 'The star shifted 10.4 arcsec over 182.5 days.', 'The frames were taken at 4.270 micron, close to the carbon dioxide ice feature at 4.27 micron.', 'Its position is RA 269.4521 deg, Dec 4.6934 deg.', 'SPHEREx pixels are about 6.2 arcsec wide, so a 10.4 arcsec shift is larger than one pixel.', 'With only 3 visits, the trend is thinly sampled.', 'The 12 percent brightening is larger than the 2.5 percent scatter of the least steady reference star.', 'A shift of 10.4″ in 182.5 days and a 3.4σ difference both point the same way.', 'Compare the frames at 4.270 µm with a second wavelength in Slowsky.', 'This is a candidate change, and CO2 ice absorbs near this wavelength.'];
    const bad = ['SPHEREx returns about every 6 months, so a later visit would test it.', 'The reference stars scatter by 12 percent.', 'The star moved 10.4 arcmin.', 'The star moved 10.4 milliarcsec.', 'The frames were taken at 4.270 nm.', 'Its position is RA 269.4521 hours.', 'It moved 10.4 arcsec per day.', 'It moved 10.4 arcsec a day.', 'It moved 10.4 arcsec/day.', 'Its position is RA 269.4521 deg, Dec -4.6934 deg.', '12 of the 14 frames were left out.', '1 in 3 frames was sharp.', 'The fourth visit was the brightest.', 'It brightened by a factor of 12.', 'The change is an order of magnitude larger than the scatter.', 'The visit was on 14 March.', 'The star is at 48 °C.', 'It lies 182.5 trillion kilometres away.', 'The star is 48 light-years away.', 'The signal-to-noise reached 48 percent.', 'The 3 visits each lasted 3.4 days.', 'The scatter is 2.5 sigma.', 'It brightened 1.12 times.', 'The star moved 16 arcsec.', 'The difference is 12 sigma.', 'There were 48 visits.', 'The brightness fell to 0.97 percent.', 'The wavelength is 3.4 micron.', 'It was 3/W2/12 brighter.', 'It is half as bright.', 'The star is 1 of a kind.'];
    const unsafeMedian = ['Its brightness relative to the reference stars went from 1.00 to 0.97 and then 1.12.', 'The 3 reference stars scatter by 1.2, 1.8 and 2.5 percent, so the 12 percent change stands out.', 'The 12 percent brightening is larger than the 2.5 percent scatter of the least steady reference star.', "Barnard's Star was seen in 3 visits spread over 182.5 days.", 'SPHEREx pixels are about 6.2 arcsec wide, so a 10.4 arcsec shift is larger than one pixel.'];
    it.each(good.filter((sentence) => !unsafeMedian.includes(sentence)))('keeps %s', (sentence) => { expect(checkNote(`${sentence} Plain sentence.`, sheet).dropped).toBe(0); });
    it.each([...bad, ...unsafeMedian])('drops %s', (sentence) => { expect(checkNote(`${sentence} Plain sentence. Another plain sentence.`, sheet).dropped).toBe(1); });
    it('derives and recognizes the actual WISE short name', () => {
        const wise = factSheet({ ...facts, targetId: 'wise0855' });
        expect(wise[0]).toBe('Target: WISE J085510.83-071442.5, also written WISE 0855-0714.');
        for (const sentence of ['WISE 0855−0714 is faint here.', 'WISE J0855-0714 shows no clear change.', 'WISE 0855 is a cold brown dwarf, which is background and not measured here.', 'WISE J085510.83-071442.5 sits near the centre.']) { expect(checkNote(`${sentence} Plain sentence. Another plain sentence.`, wise).dropped, sentence).toBe(sentence.includes('no clear change') ? 1 : 0); }
        for (const sentence of ['WISE 0855−0714 moved 0855 arcsec.', 'It is 0714 days old.', 'Its neighbour WISE 1049−5319 is brighter.']) { expect(checkNote(`${sentence} Plain sentence. Another plain sentence.`, wise).dropped, sentence).toBe(1); }
    });
    it('keeps decimal precision and context attached to each fact', () => {
        for (const sentence of ['Brightness was 1.', 'The scatter is 12 percent.', 'The change was -12 percent.', 'The position is 4.6934 degrees per day.']) {
            expect(checkNote(`${sentence} Plain sentence. Another plain sentence.`, sheet).dropped, sentence).toBe(1);
        }
        expect(checkNote('Brightness was 1.0. Plain sentence. Another plain sentence.', sheet).dropped).toBe(1);
    });
});
describe('round four access', () => {
    it('never lets wrong guesses lock out the correct code', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', now: () => 0, complete: async () => ({ text: note, refused: false, model: 'fake' }) });
        const headers = { 'x-real-ip': 'r4', 'x-insight-passcode': 'wrong' };
        for (let i = 0; i < 30; i++) { expect((await handler.POST(request({ facts }, headers))).status).toBe(401); }
        const blocked = await handler.POST(request({ facts }, headers));
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get('retry-after'))).toBeLessThanOrEqual(900);
        headers['x-insight-passcode'] = 'secret';
        expect(await (await handler.GET(new Request('https://example.test', { headers }))).json()).toMatchObject({ unlocked: true });
        expect((await handler.POST(request({ facts: { ...facts, ra: 21.123 } }, headers))).status).toBe(200);
    });
    it('isolates wrong guesses from the shared store and the right-code brake', async () => {
        let now = 0;
        const store = memoryStore();
        const hit = vi.spyOn(store, 'hit'), count = vi.spyOn(store, 'count'), refund = vi.spyOn(store, 'refund');
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', store, now: () => now, complete: vi.fn() });
        const headers = { 'x-real-ip': 'r4-flood', 'x-insight-passcode': 'wrong' };
        for (let i = 0; i < 1000; i++) {
            const response = i % 2 ? await handler.POST(request({ facts }, headers)) : await handler.GET(new Request('https://example.test', { headers }));
            if (i < 30) { expect(response.status).toBe(i % 2 ? 401 : 200); }
        }
        expect(hit).not.toHaveBeenCalled(); expect(count).not.toHaveBeenCalled(); expect(refund).not.toHaveBeenCalled();
        headers['x-insight-passcode'] = 'x'.repeat(300);
        now = 900000;
        expect(await (await handler.GET(new Request('https://example.test', { headers }))).json()).toMatchObject({ unlocked: false });
        headers['x-insight-passcode'] = 'wrong';
        for (let i = 0; i < 200; i++) { await handler.POST(request({ facts }, headers)); }
        headers['x-insight-passcode'] = 'secret';
        for (let i = 0; i < 120; i++) { expect((await handler.GET(new Request('https://example.test', { headers }))).status).toBe(200); }
        count.mockClear();
        const blocked = await handler.GET(new Request('https://example.test', { headers }));
        expect(blocked.status).toBe(429); expect(blocked.headers.get('retry-after')).toBe('60');
        expect(hit).not.toHaveBeenCalled(); expect(count).not.toHaveBeenCalled(); expect(refund).not.toHaveBeenCalled();
        now = 1800000; headers['x-insight-passcode'] = 'wrong';
        expect((await handler.POST(request({ facts }, headers))).status).toBe(401);
    });
    it('lets correct requests through after wrong guesses', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', now: () => 0, complete: vi.fn() });
        const send = (code: string) => handler.GET(new Request('https://example.test', { headers: { 'x-real-ip': 'r4-parallel', 'x-insight-passcode': code } }));
        for (let i = 0; i < 60; i++) { await send('bad'); }
        for (let i = 0; i < 30; i++) { expect(await (await send('secret')).json()).toMatchObject({ unlocked: true }); }
    });
    it('returns 503 when the local counter fails', async () => {
        const local: LimitStore = { hit: async () => { throw new Error('unavailable'); }, count: async () => 0, refund: async () => {} };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', local, now: () => 0, complete: vi.fn() });
            for (const code of ['wrong', 'secret']) { expect((await handler.GET(new Request('https://example.test', { headers: { 'x-insight-passcode': code } }))).status).toBe(503); }
        } finally { warn.mockRestore(); }
    });
});
describe('round three regressions', () => {
    const complete = async () => ({ text: note, refused: false, model: 'fake' });
    const right = { 'x-insight-passcode': 'secret', 'x-real-ip': 'round-three' };
    it('accommodates a shared venue and does not brake cached open traffic', async () => {
        const local = memoryStore();
        const localHit = vi.spyOn(local, 'hit');
        const locked = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', local, now: () => 0, complete });
        expect((await locked.POST(request({ facts: { ...facts, ra: 72 } }, right))).status).toBe(200);
        for (let i = 0; i < 30; i++) {
            expect((await locked.GET(new Request('https://example.test', { headers: right }))).status).toBe(200);
            expect((await locked.POST(request({ facts: { ...facts, ra: 72 } }, right))).status).toBe(200);
        }
        const openLocal = memoryStore();
        const openHit = vi.spyOn(openLocal, 'hit');
        const open = createHandlers({ apiKey: 'key', model: 'fake', local: openLocal, now: () => 0, complete });
        for (let i = 0; i < 200; i++) { expect((await open.GET(new Request('https://example.test', { headers: right }))).status).toBe(200); }
        expect(openHit).not.toHaveBeenCalled();
        for (let i = 0; i < 200; i++) { expect((await open.POST(request({ facts: { ...facts, ra: 72 } }, right))).status).toBe(200); }
        expect(openHit).not.toHaveBeenCalled();
        expect(localHit).toHaveBeenCalledTimes(61);
    });
    it('deletes a negative refund and checks every store configuration', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ result: -1 })).mockResolvedValueOnce(Response.json({ result: 1 }));
        await upstashStore('https://redis.test', 'token', fetcher).refund('try:id', 1000, 2000);
        expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual(['DEL', 'try:id:2']);
        for (const env of [{ UPSTASH_REDIS_REST_TOKEN: 'token' }, { KV_REST_API_URL: 'https://redis.test' }, { KV_REST_API_TOKEN: 'token' }]) {
            await expect(pickStore(env).hit('x', 1000, 0)).rejects.toThrow();
        }
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([{ result: 1 }, { result: 1 }]));
        try {
            await pickStore({ KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 'token' }).hit('x', 1000, 0);
            expect(fetchSpy.mock.calls[0]![0]).toBe('https://kv.test/pipeline');
        } finally { fetchSpy.mockRestore(); }
    });
    it('evicts the oldest entry when all entries are protected', async () => {
        const store = memoryStore();
        for (let i = 0; i < 20000; i++) { await store.hit(`try:${i}`, 900000, 0); await store.hit(`try:${i}`, 900000, 0); }
        await store.hit('try:new', 900000, 0);
        expect(await store.count('try:0', 900000, 0)).toBe(0);
        expect(store.size()).toBeLessThanOrEqual(20002);
    });
    it('defaults to forty notes per visitor per day', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', 'round-three-default');
        vi.stubEnv('INSIGHT_OPEN', '1');
        vi.stubEnv('INSIGHT_PASSCODE', '');
        vi.stubEnv('INSIGHT_MAX_PER_USER_DAY', '');
        try {
            const response = await serverGET(new Request('https://example.test', { headers: { 'x-insight-passcode': '' } }));
            expect(await response.json()).toMatchObject({ remaining: 40 });
        } finally { vi.unstubAllEnvs(); }
    });
    it('keeps "a third visit", ties hyphenated units and strips names only as whole words', () => {
        const sheet = ['Target: WISE 0855−0714.', 'Visits: 3. Frames: 14. Time from first to last visit: 182.5 days.', 'Shift in position: 10.4 arcsec over 182.5 days.', 'Difference image: 3.4 sigma.'];
        const pad = 'Safe sentence. Another safe sentence.';
        const kept = ['A third visit would settle it.', 'Over the 182.5-day span it moved.', 'A 3.4-sigma change shows.', 'WISE 0855-0714 is faint here.', 'WISE 0855–0714 is faint here.'];
        for (const sentence of kept) { expect(checkNote(`${sentence} ${pad}`, sheet).dropped, sentence).toBe(0); }
        const dropped = ['It moved over a 10.4-day span.', 'A 182.5-sigma change shows.', 'It fell by a third.', 'It is one-third as bright.', 'It lost a third of its light.', 'It is a fifth fainter.'];
        for (const sentence of dropped) { expect(checkNote(`${sentence} ${pad}`, sheet).dropped, sentence).toBe(1); }
        // A short name, or the short first part of one, must not be cut out of the middle of other words.
        for (const name of ['A-1', 'al', 'hal-1']) {
            expect(checkNote(`It is half as bright. ${pad}`, [`Target: ${name}.`, 'Visits: 3.']).dropped, name).toBe(1);
        }
        expect(checkNote(`Half-1 is steady. ${pad}`, ['Target: Half-1.', 'Visits: 3.']).dropped).toBe(1);
    });
    it('checks units and preserves names and catalogue tokens', () => {
        const sheet = ['Target: WISE 0855−0714.', 'Visits: 3. Frames: 14.', 'Shift in position: 10.4 arcsec over 182.5 days.', 'Difference image: 3.4 sigma.'];
        const bad = ['It moved 182.5 arcsec over 10.4 days.', 'It moved 5.1 arcsec per year.', 'The feature sits at 14 micron.', 'It is 3.4 standard deviations brighter.', 'It is 6 lightyears away.', 'Over a 2-year baseline it moved.', "It has a third of the Sun's mass.", 'It weighs 14 Msun.', 'It weighs 3 Earth masses.', 'There are 4 visits.'];
        // The sigma example must be unsupported on this sheet.
        const unsupportedSigma = [...sheet.filter((line) => !line.startsWith('Difference')), 'Measured value: 3.4.'];
        for (const sentence of bad) { expect(checkNote(`${sentence} Safe sentence. Another safe sentence.`, unsupportedSigma).dropped, sentence).toBe(1); }
        const good = ['WISE 0855−0714 is faint here.', 'WISE 0855 stays near the noise.', 'Check the Gaia DR3 position.', 'Carbon dioxide (CO2) ice absorbs near 4.27 micron.', 'Compare with 2MASS.', 'Worth double-checking against the second visit.', 'The third visit is the outlier.', 'The shift is 10.4 arcseconds over 182.5 days.', 'A 3.4 standard deviations change.', 'The pixels are 6.2 arcseconds wide.'];
        for (const sentence of good) { expect(checkNote(`${sentence} Safe sentence. Another safe sentence.`, sheet).dropped, sentence).toBe(0); }
        for (const fraction of ['one third', 'a fifth', 'one fifth', 'a tenth', 'one tenth', 'thirds', 'fifths', 'tenths']) { expect(checkNote(`It is ${fraction} brighter. Safe sentence. Another safe sentence.`, sheet).dropped, fraction).toBe(1); }
    });
    it('pairs unit aliases and lists while rejecting mismatches and unsupported hyphenated units', () => {
        const sheet = ['Target: Example.', 'Visits: 4. Frames: 8.', 'Wavelength: 1.2, 1.4 and 1.6 micron.', 'Shift in position: 10.4 arcsec over 182.5 days.', 'Position: 14 deg.', 'Signal: 3.4 sigma.'];
        const good = ['At 1.2, 1.4 and 1.6 µm it changes.', 'The shift is 10.4 arcseconds over 182.5 day.', 'Position is 14 degrees.', 'The signal is 3.4 standard deviations.', 'There are 4 visits.'];
        const bad = ['There are 3 visits.', 'At 1.2 and 8 µm it changes.', 'Position is 8 degrees.', 'There are 8 visits.', 'It is 6-light-year distant.', 'It is 8-km away.', 'It is 8-Mjup.', 'It is 8-Rsun.', 'It is 8-Lsun.', 'It is 8 masses.'];
        for (const sentence of good) { expect(checkNote(`${sentence} Safe sentence. Another safe sentence.`, sheet).dropped, sentence).toBe(0); }
        for (const sentence of bad) { expect(checkNote(`${sentence} Safe sentence. Another safe sentence.`, sheet).dropped, sentence).toBe(1); }
    });
    it('returns the one-minute retry for the local brake in both handlers', async () => {
        const local = { ...memoryStore(), hit: async () => 121 };
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', local, now: () => 0, complete });
        for (const response of [await handler.GET(new Request('https://example.test', { headers: right })), await handler.POST(request({ facts }, right))]) {
            expect(response.status).toBe(429);
            expect(response.headers.get('retry-after')).toBe('60');
            expect(await response.json()).toEqual({ error: 'busy' });
        }
    });
});
describe('round two regressions', () => {
    it('rejects unsupported number forms and preserves listed quantities', () => {
        const bad = ['½', 'Ⅻ', '①', '²', '5e3', '3/4', '2-5', '3rd', 'halved', 'doubling', 'quadrupled', 'threefold', 'hundreds', 'quarter', 'zero', '6 light years'];
        for (const value of bad) {
            expect(checkNote(`Value ${value}. Safe sentence. Another safe sentence.`, ['Value 6.']).dropped, value).toBe(1);
        }
        expect(checkNote('Double-check the second visit. There are fewer than 3 visits. SPHEREx has 6 detectors. The scatter is 1.2 percent.', ['Visits: 2.', 'Scatter: 1.2, 1.8, 2.5 percent.']).dropped).toBe(0);
        expect(SYSTEM_PROMPT).not.toContain('about every 6 months');
        expect(SYSTEM_PROMPT).toContain('fewer than 3 visits');
        expect(SYSTEM_PROMPT).toContain('Write every number in digits');
        expect(SYSTEM_PROMPT).toContain('copy its printed unit and bound');
        expect(SYSTEM_PROMPT).toContain('exactly 3 short paragraphs');
    });
    it('reports a busy service to the browser', async () => {
        for (const status of [429, 503]) {
            const fetcher = vi.fn(async () => Response.json({ error: 'busy' }, { status, headers: { 'Retry-After': '12' } })) as typeof fetch;
            expect(await insightStatus({ fetcher })).toEqual({ enabled: true, locked: false, unlocked: false, busy: true, retryAfter: 12 });
        }
        await expect(fetchInsight({ ...facts, ra: 77 }, { fetcher: vi.fn(async () => Response.json({ error: 'busy' }, { status: 503 })) as typeof fetch })).rejects.toMatchObject({ code: 'busy' });
    });
    it('fails closed on a half-configured store', async () => {
        const store = pickStore({ UPSTASH_REDIS_REST_URL: 'https://redis.test' });
        await expect(store.hit('key', 1000, 0)).rejects.toThrow();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const complete = vi.fn();
        try {
            const handler = createHandlers({ apiKey: 'key', model: 'fake', store, now: () => 0, complete });
            expect((await handler.POST(request({ facts: { ...facts, ra: 17.777 } }))).status).toBe(503);
            expect(complete).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith('Insight limit store unavailable');
        } finally { warn.mockRestore(); }
    });
    it('keeps unauthenticated GET and invalid POSTs away from both stores', async () => {
        const store = memoryStore(), local = memoryStore();
        const sharedHit = vi.spyOn(store, 'hit'), sharedCount = vi.spyOn(store, 'count'), localHit = vi.spyOn(local, 'hit');
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', store, local, now: () => 0, complete: vi.fn() });
        for (let i = 0; i < 100; i++) { expect((await handler.GET(new Request('https://example.test'))).status).toBe(200); }
        for (const req of [request({ facts }, { 'content-type': 'text/plain' }), new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }), request({ facts: { ...facts, ra: 999 } })]) {
            expect((await handler.POST(req)).status).toBe(400);
        }
        expect(sharedHit).not.toHaveBeenCalled(); expect(sharedCount).not.toHaveBeenCalled(); expect(localHit).not.toHaveBeenCalled();
        expect((await handler.GET(new Request('https://example.test', { headers: { 'x-insight-passcode': 'secret' } }))).status).toBe(200);
    });
    it('brakes locally before the shared store', async () => {
        const store = memoryStore();
        const hit = vi.spyOn(store, 'hit');
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', store, now: () => 0, complete: vi.fn() });
        const replies = await Promise.all(Array.from({ length: 130 }, () => handler.POST(request({ facts }, { 'x-insight-passcode': 'wrong' }))));
        expect(replies.filter((r) => r.status === 401)).toHaveLength(30);
        expect(replies.filter((r) => r.status === 429)).toHaveLength(100);
        expect(hit).not.toHaveBeenCalled();
    });
    it('returns exactly 30 wrong guesses for a serial flood', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', now: () => 0, complete: vi.fn() });
        const replies: number[] = [];
        for (let i = 0; i < 200; i++) { replies.push((await handler.POST(request({ facts }, { 'x-insight-passcode': 'wrong' }))).status); }
        expect(replies.filter((status) => status === 401)).toHaveLength(30);
        expect(replies.filter((status) => status === 429)).toHaveLength(170);
    });
    it('counts GET guesses and preserves the window until it expires', async () => {
        let now = 0;
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', now: () => now, complete: vi.fn() });
        const wrong = () => handler.GET(new Request('https://example.test', { headers: { 'x-insight-passcode': 'wrong' } }));
        for (let i = 0; i < 30; i++) { expect((await wrong()).status).toBe(200); }
        now = 14 * 60000; expect((await wrong()).status).toBe(429);
        now = 16 * 60000; expect((await wrong()).status).toBe(200);
    });
    it.each(['global-hour', 'global-day'])('refunds the visitor after %s refuses', async (global) => {
        const store = memoryStore();
        await store.hit(global, global === 'global-hour' ? 3600000 : 86400000, 0);
        const handler = createHandlers({ apiKey: 'key', model: 'fake', store, now: () => 0, maxPerHour: global === 'global-hour' ? 1 : 100, maxPerDay: global === 'global-day' ? 1 : 100, complete: vi.fn() });
        for (let i = 0; i < 5; i++) { expect((await handler.POST(request({ facts: { ...facts, ra: 40 + i } }))).status).toBe(429); }
        expect(await (await handler.GET(new Request('https://example.test', { headers: { 'x-insight-passcode': '' } }))).json()).toMatchObject({ remaining: 20 });
    });
    it('retains blocked guesses and global limits while bounding and sweeping memory', async () => {
        const store = memoryStore();
        for (let i = 0; i < 31; i++) { await store.hit('try:blocked', 900000, 0); }
        await store.hit('global-day', 86400000, 0);
        for (let i = 0; i < 25000; i++) { await store.hit(`try:${i}`, 900000, 0); }
        expect(await store.count('try:blocked', 900000, 0)).toBe(31);
        expect(await store.count('global-day', 86400000, 0)).toBe(1);
        expect(store.size()).toBeLessThanOrEqual(20002);
        await store.hit('try:new', 900000, 900000);
        expect(store.size()).toBeLessThan(10);
    });
    it('uses a keyed address and supports complete or absent store configuration', async () => {
        expect(await pickStore({}).hit('key', 1000, 0)).toBe(1);
        expect(pickStore({ UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 'token' })).toBeDefined();
        const keys: string[] = [];
        for (const apiKey of ['key-a', 'key-b']) {
            const local = memoryStore();
            const hit = vi.spyOn(local, 'hit').mockImplementation(async (key) => { keys.push(key); return 1; });
            const handler = createHandlers({ apiKey, model: 'fake', passcode: 'secret', local, now: () => 0, complete: vi.fn() });
            await handler.GET(new Request('https://example.test', { headers: { 'x-real-ip': '192.0.2.77', 'x-insight-passcode': 'wrong' } }));
            hit.mockRestore();
        }
        expect(keys[0]).not.toBe(keys[1]); expect(keys.every((key) => !key.includes('192.0.2.77'))).toBe(true);
    });
    it('rejects a bad expiry and sends DECR for a refund', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ result: 1 }, { result: 0 }])).mockResolvedValueOnce(Response.json({ result: 0 }));
        const store = upstashStore('https://redis.test', 'token', fetcher);
        await expect(store.hit('key', 1000, 0)).rejects.toThrow();
        await store.refund('key', 1000, 0);
        expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual(['DECR', 'key:0']);
    });
    it('drops a sentence cut after a possible decimal point', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', now: () => 0, complete: async () => ({ text: note + ' Brightness is 4.', refused: false, model: 'fake', stopReason: 'max_tokens' }) });
        expect(await (await handler.POST(request({ facts: { ...facts, ra: 72.123 } }))).json()).toMatchObject({ text: note });
        const fragment = createHandlers({ apiKey: 'key', model: 'fake', now: () => 0, complete: async () => ({ text: note + ' Brightness is 4. unfinished', refused: false, model: 'fake', stopReason: 'max_tokens' }) });
        expect(await (await fragment.POST(request({ facts: { ...facts, ra: 72.124 } }))).json()).toMatchObject({ text: note });
    });
    it.each(['halve', 'halved', 'halves', 'halving', 'doubled', 'doubles', 'doubling', 'tripled', 'triples', 'tripling', 'quadruple', 'quadrupled', 'quadruples', 'quadrupling', 'twofold', 'hundreds', 'thousands', 'millions', 'billions', 'dozens', 'quarter', 'quarters', 'zero'])('drops number word %s', (word) => {
        expect(checkNote(`It is ${word}. Safe sentence. Another safe sentence.`, []).dropped).toBe(1);
    });
    it.each(['light-year', 'light-years', 'light year', 'light years', 'ly', 'pc', 'parsec', 'parsecs', 'kpc', 'AU', 'km', 'kelvin', 'K', 'year', 'years', 'yr', 'yrs', 'Myr', 'Gyr', 'mag', 'magnitude', 'magnitudes', 'Jy', 'mJy', 'solar', 'Jupiter'])('drops unsupported unit %s', (unit) => {
        expect(checkNote(`It is 6 ${unit} away. Safe sentence. Another safe sentence.`, ['Count: 6.']).dropped).toBe(1);
    });
    it.each(['0.75', '5', '1.083', '1.875', '3.05', '3.3', '4.05', '4.27', '4.67', '102', '6.2', '6', '3'])('requires context for constant %s', (value) => {
        expect(checkNote(`The value is ${value}. Safe sentence. Another safe sentence.`, []).dropped).toBe(1);
    });
    it('does not attach a sheet count to a fabricated percent', () => {
        expect(checkNote('The change is 12 percent. Safe sentence. Another safe sentence.', ['Count: 12.']).dropped).toBe(1);
        expect(checkNote('The scatter is 1.2, 1.8 and 2.5 percent. Another safe sentence.', ['Scatter: 1.2, 1.8, 2.5 percent.']).dropped).toBe(0);
    });
    it('does not evict a browser cache entry on a failed request', async () => {
        const fetcher = vi.fn(async () => Response.json({ text: note, model: 'fake', dropped: 0 })) as unknown as typeof fetch;
        for (let i = 0; i < 50; i++) { await fetchInsight({ ...facts, ra: 200 + i / 100 }, { fetcher }); }
        await expect(fetchInsight({ ...facts, ra: 201 }, { fetcher: vi.fn(async () => new Response('', { status: 500 })) as typeof fetch })).rejects.toMatchObject({ code: 'failed' });
        expect((await fetchInsight({ ...facts, ra: 200 }, { fetcher })).cached).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(50);
    });
});
describe('insight access and allowances', () => {
    it.each([false, true])('bounds parallel guesses, delayed store: %s', async (delayed) => {
        const inner = memoryStore();
        const store: LimitStore = delayed ? {
            hit: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return inner.hit(...args); },
            count: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return inner.count(...args); },
            refund: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return inner.refund(...args); },
        } : inner;
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: vi.fn(), now: () => 0, passcode: 'secret', store });
        const send = () => handler.POST(request({ facts }, { 'x-real-ip': 'guess-parallel', 'x-insight-passcode': 'bad' }));
        const replies = await Promise.all(Array.from({ length: 200 }, send));
        expect(replies.filter((r) => r.status === 401).length).toBe(30);
        expect(replies.every((r) => r.status === 401 || r.status === 429)).toBe(true);
        const serial = createHandlers({ apiKey: 'key', model: 'fake', complete: vi.fn(), now: () => 0, passcode: 'secret' });
        for (let i = 0; i < 30; i++) { expect((await serial.POST(request({ facts }, { 'x-insight-passcode': 'bad' }))).status).toBe(401); }
        expect((await serial.POST(request({ facts }, { 'x-insight-passcode': 'bad' }))).status).toBe(429);
    });
    it('charges shared counters only after visitor counters pass under concurrency', async () => {
        const complete = vi.fn(async () => ({ text: note, refused: false, model: 'fake' }));
        const inner = memoryStore();
        const store: LimitStore = { hit: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return inner.hit(...args); }, count: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return inner.count(...args); }, refund: async (...args) => inner.refund(...args) };
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 18000000, passcode: 'secret', maxPerHour: 21, maxPerDay: 21, store });
        const replies = await Promise.all(Array.from({ length: 300 }, (_, i) => handler.POST(request({ facts: { ...facts, ra: i / 10 } }, { 'x-real-ip': 'parallel-right', 'x-insight-passcode': 'secret' }))));
        expect(replies.filter((r) => r.status === 200).length).toBeLessThanOrEqual(20);
        expect(complete.mock.calls.length).toBeLessThanOrEqual(20);
        expect((await handler.POST(request({ facts: { ...facts, ra: 80 } }, { 'x-real-ip': 'another-visitor', 'x-insight-passcode': 'secret' }))).status).toBe(200);
    });
    it('fails closed on store errors without leaking details', async () => {
        const complete = vi.fn();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'secret');
        try {
            const store = { hit: async () => { throw new Error('secret'); }, count: async () => { throw new Error('secret'); }, refund: async () => { throw new Error('secret'); } };
            const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 0, store });
            const response = await handler.POST(request({ facts: { ...facts, ra: 81 } }));
            expect(response.status).toBe(503);
            expect(await response.json()).toEqual({ error: 'busy' });
            expect(response.headers.get('retry-after')).toBe('60');
            expect(complete).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith('Insight limit store unavailable');
        } finally { warn.mockRestore(); vi.unstubAllEnvs(); }
    });
    it.each([
        ['user-minute:', 21, false], ['user-day:', 21, true], ['global-hour', 121, false], ['global-day', 301, true],
    ])('stops after the %s counter exceeds its limit', async (key, count, daily) => {
        const touched: string[] = [];
        const complete = vi.fn();
        const store: LimitStore = { hit: async (name) => { touched.push(name); return name.startsWith(key) ? count : 1; }, count: async () => 0, refund: async () => {} };
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 0, store });
        const response = await handler.POST(request({ facts: { ...facts, ra: 90 } }));
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ error: 'busy', ...(daily ? { reason: 'daily' } : {}) });
        expect(touched.at(-1)).toMatch(new RegExp(`^${key}`));
        expect(complete).not.toHaveBeenCalled();
    });
    it('keeps note counters usable after 25000 distinct guessers', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: async () => ({ text: note, refused: false, model: 'fake' }), now: () => 0, passcode: 'secret' });
        for (let i = 0; i < 25000; i++) {
            const response = await handler.POST(request({ facts }, { 'x-real-ip': `visitor-${i}`, 'x-insight-passcode': 'bad' }));
            expect(response.status).toBe(401);
        }
        const response = await handler.POST(request({ facts: { ...facts, ra: 82 } }, { 'x-real-ip': 'known', 'x-insight-passcode': 'secret' }));
        expect(response.status).toBe(200);
    }, 60000);
    it('groups IPv6 by /56 and IPv4 mapped addresses by IPv4', async () => {
        expect(networkAddress('2001:db8:1:1201::1')).toBe('2001:db8:1:1200/56');
        expect(networkAddress('2001:db8:1:12ff::2')).toBe(networkAddress('2001:db8:1:1201::1'));
        expect(networkAddress('2001:db8:1:1300::1')).not.toBe(networkAddress('2001:db8:1:1201::1'));
        expect(networkAddress('::ffff:1.2.3.4')).toBe('1.2.3.4');
        expect(networkAddress('not::an::address')).toBe('not::an::address');
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: async () => ({ text: note, refused: false, model: 'fake' }), now: () => 0, maxPerUserDay: 1 });
        const send = (ip: string, ra: number) => handler.POST(request({ facts: { ...facts, ra } }, { 'x-real-ip': ip }));
        expect((await send('2001:db8:1:1201:aaaa::1', 83)).status).toBe(200);
        expect((await send('2001:db8:1:12ff:bbbb::9', 84)).status).toBe(429);
        expect((await send('2001:db8:1:1300::1', 85)).status).toBe(200);
        expect((await send('::ffff:1.2.3.4', 86)).status).toBe(200);
        expect((await send('1.2.3.4', 87)).status).toBe(429);
    });
    it('reports whether access is locked', async () => {
        const base = { apiKey: 'key', model: 'fake', complete: vi.fn(), now: () => 0 };
        expect(await (await createHandlers({ ...base, passcode: 'secret' }).GET(new Request('https://example.test'))).json()).toMatchObject({ locked: true });
        expect(await (await createHandlers({ ...base, open: true }).GET(new Request('https://example.test'))).json()).toMatchObject({ locked: false });
    });
    it('fails closed, locks guesses, and unlocks after the window', async () => {
        let now = 0;
        const complete = vi.fn(async () => ({ text: note, refused: false, model: 'fake' }));
        const base = { apiKey: 'key', model: 'fake', complete, now: () => now };
        expect(await (await createHandlers({ ...base, open: false }).GET(new Request('https://example.test'))).json()).toEqual({ enabled: false, locked: false, unlocked: false, model: 'fake' });
        expect((await (await createHandlers(base).GET(new Request('https://example.test'))).json()).enabled).toBe(true);
        const handler = createHandlers({ ...base, passcode: 'secret' });
        const headers = { 'x-real-ip': '192.0.2.40' };
        expect((await handler.POST(request({ facts }, headers))).status).toBe(401);
        for (let i = 0; i < 29; i++) {
            expect((await handler.POST(request({ facts }, { ...headers, 'x-insight-passcode': 'wrong' }))).status).toBe(401);
        }
        expect(complete).not.toHaveBeenCalled();
        const locked = await handler.POST(request({ facts }, { ...headers, 'x-insight-passcode': 'wrong' }));
        expect(locked.status).toBe(429);
        expect(locked.headers.get('retry-after')).toBe('900');
        expect((await handler.POST(request({ facts: { ...facts, ra: 300 } }, { 'x-real-ip': '192.0.2.41', 'x-insight-passcode': 'secret' }))).status).toBe(200);
        now += 900000;
        expect((await handler.POST(request({ facts: { ...facts, ra: 301 } }, { ...headers, 'x-insight-passcode': 'secret' }))).status).toBe(200);
    });
    it('counts new answers per visitor and day, without charging refusals or cache hits', async () => {
        let now = 0;
        const keys: string[] = [];
        const inner = memoryStore();
        const store = { hit: async (k: string, w: number, n: number) => { keys.push(k); return inner.hit(k, w, n); }, count: async (k: string, w: number, n: number) => { keys.push(k); return inner.count(k, w, n); }, refund: inner.refund };
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: async () => ({ text: note, refused: false, model: 'fake' }), now: () => now, passcode: 'secret', store, maxPerUserDay: 3 });
        const headers = { 'x-real-ip': '192.0.2.42', 'x-insight-passcode': 'secret' };
        for (let i = 0; i < 3; i++) {
            expect(await (await handler.POST(request({ facts: { ...facts, ra: 310 + i } }, headers))).json()).toMatchObject({ remaining: 2 - i, cached: false });
        }
        const refused = await handler.POST(request({ facts: { ...facts, ra: 313 } }, headers));
        expect(await refused.json()).toEqual({ error: 'busy', reason: 'daily' });
        const userDayKey = keys.find((key) => key.startsWith('user-day:'))!;
        expect(await inner.count(userDayKey, 86400000, now)).toBe(4);
        expect(await (await handler.POST(request({ facts: { ...facts, ra: 310 } }, headers))).json()).toMatchObject({ cached: true });
        expect(await (await handler.GET(new Request('https://example.test', { headers }))).json()).toMatchObject({ remaining: 0, unlocked: true });
        const wrong = await (await handler.GET(new Request('https://example.test', { headers: { ...headers, 'x-insight-passcode': 'bad' } }))).json();
        expect(wrong).toMatchObject({ unlocked: false });
        expect(wrong).not.toHaveProperty('remaining');
        for (let i = 0; i < 29; i++) {
            await handler.GET(new Request('https://example.test', { headers: { ...headers, 'x-insight-passcode': 'bad' } }));
        }
        expect((await handler.GET(new Request('https://example.test', { headers }))).status).toBe(200);
        expect(keys.every((k) => !k.includes('192.0.2.42'))).toBe(true);
        expect((await handler.POST(request({ facts: { ...facts, ra: 313 } }, { ...headers, 'x-real-ip': '192.0.2.43' }))).status).toBe(200);
        now += 86400000;
        expect((await handler.POST(request({ facts: { ...facts, ra: 314 } }, headers))).status).toBe(200);
    });
    it('expires fixed windows and uses x-real-ip before the forwarded address', async () => {
        const store = memoryStore();
        expect(await store.hit('a', 1000, 999)).toBe(1);
        expect(await store.count('a', 1000, 1000)).toBe(0);
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: async () => ({ text: note, refused: false, model: 'fake' }), now: () => 400000000, store, maxPerUserDay: 1 });
        const headers = { 'x-real-ip': 'real', 'x-forwarded-for': 'forwarded-a, proxy' };
        expect((await handler.POST(request({ facts: { ...facts, ra: 340 } }, headers))).status).toBe(200);
        expect((await handler.POST(request({ facts: { ...facts, ra: 341 } }, { ...headers, 'x-forwarded-for': 'forwarded-b' }))).status).toBe(429);
    });
    it('enforces the global daily cap', async () => {
        const base = { apiKey: 'key', model: 'fake', complete: async () => ({ text: note, refused: false, model: 'fake' }), now: () => 180000000, maxPerDay: 2 };
        const handler = createHandlers(base);
        for (let i = 0; i < 3; i++) {
            expect((await handler.POST(request({ facts: { ...facts, ra: 320 + i } }, { 'x-real-ip': `test-${i}` }))).status).toBe(i < 2 ? 200 : 429);
        }
    });
    it('uses the Upstash REST protocol and rejects failures', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ result: 4 }, { result: 1 }])).mockResolvedValueOnce(Response.json({ result: null })).mockResolvedValueOnce(new Response('', { status: 500 }));
        const store = upstashStore('https://redis.test/', 'token', fetcher);
        expect(await store.hit('key', 1000, 2500)).toBe(4);
        expect(fetcher.mock.calls[0]![0]).toBe('https://redis.test/pipeline');
        expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual([['INCR', 'key:2'], ['PEXPIRE', 'key:2', '2000']]);
        expect(fetcher.mock.calls[0]![1].headers.Authorization).toBe('Bearer token');
        expect(await store.count('key', 1000, 2500)).toBe(0);
        await expect(store.count('key', 1000, 2500)).rejects.toThrow();
    });
    it('sends browser passcodes only in headers and reports errors', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ enabled: true, locked: true, unlocked: true })).mockResolvedValueOnce(Response.json({ error: 'locked' }, { status: 401 })).mockResolvedValueOnce(Response.json({ error: 'busy', reason: 'daily' }, { status: 429, headers: { 'Retry-After': '12' } }));
        expect((await insightStatus({ passcode: 'secret', fetcher })).unlocked).toBe(true);
        expect(fetcher.mock.calls[0]![1].headers['X-Insight-Passcode']).toBe('secret');
        await expect(fetchInsight({ ...facts, ra: 330 }, { passcode: 'secret', fetcher })).rejects.toMatchObject({ code: 'locked' });
        expect(fetcher.mock.calls[1]![1].body).not.toContain('secret');
        await expect(fetchInsight({ ...facts, ra: 331 }, { fetcher })).rejects.toMatchObject({ code: 'busy', retryAfter: 12, reason: 'daily' });
        expect(fetcher.mock.calls[2]![1].headers).not.toHaveProperty('X-Insight-Passcode');
        expect(await insightStatus({ fetcher: vi.fn(async () => { throw new Error(); }) as typeof fetch })).toEqual({ enabled: false, locked: false, unlocked: false });
    });
});
describe('insight facts and guard', () => {
    it.each(['Value １０.', 'Value .5.', 'There are twenty frames.', 'Value 10 percent.', 'Value 10 times.', 'Value 10x.', 'Value 10×.', 'Value 10 sigma.', 'Value 10σ.', 'Value 10%.'])('drops unsupported numeric form: %s', (bad) => {
        expect(checkNote(`${bad} Safe sentence. Another safe sentence.`, ['Value 10 days.', 'Value 0.5.'])).toEqual({ text: 'Safe sentence. Another safe sentence.', dropped: 1 });
    });
    it('keeps matching units, pronouns, and allowed constants', () => {
        expect(checkNote('The star dimmed by 10 percent. No one frame stands out. Helium is at 1.083 micron.', ['Largest change: 10 percent.'])).toEqual({ text: 'No one frame stands out. Helium is at 1.083 micron.', dropped: 1 });
    });
    it('validates clean copies and rejects invalid shapes and values', () => {
        expect(validateFacts(facts)).toEqual(facts);
        for (const bad of [null, { ...facts, extra: 1 }, { ...facts, lightCurve: { ...facts.lightCurve, extra: 1 } }, { ...facts, targetId: 'unknown' }, { ...facts, ra: 400 }, { ...facts, ra: NaN }, { ...facts, visits: Array(13).fill(facts.visits[0]) }, { ...facts, lightCurve: { ...facts.lightCurve, points: Array(61).fill(facts.lightCurve!.points[0]) } }, { ...facts, dec: '1' }]) {
            expect(() => validateFacts(bad)).toThrow();
        }
    });
    it('formats every fact and handles optional data', () => {
        expect(factSheet(facts)).toEqual(lines);
        const { lightCurve: _lc, difference: _d, motion: _m, ...simple } = facts;
        expect(factSheet(simple)).toHaveLength(5);
        expect(factSheet({ ...simple, targetId: TARGETS[0]!.id })[0]).toBe(`Target: ${TARGETS[0]!.name}.`);
        expect(factSheet({ ...facts, lightCurve: { ...facts.lightCurve!, points: [...facts.lightCurve!.points].reverse() } })).toEqual(lines);
        expect(factSheet({ ...facts, lightCurve: { ...facts.lightCurve!, refScatter: [] } })).toContain('Reference stars: scatter unavailable.');
        const zero = factSheet({ ...facts, lightCurve: { ...facts.lightCurve!, points: [{ mjd: 61000, relative: 0, snr: 1 }] } });
        expect(zero.some((line) => line.startsWith('Largest change'))).toBe(false);
    });
    it('removes unverified sentences and requires two survivors', () => {
        expect(checkNote(note, lines)).toEqual({ text: note, dropped: 0 });
        expect(checkNote('Label: Value 0.85 is real. Invented 9999. Discovery happened. More follows. Safe sentence.', ['Value: 0.85.'])).toEqual({ text: 'More follows. Safe sentence.', dropped: 3 });
        expect(checkNote('Made up 9999: First sentence. Second sentence.\nSafe: Third sentence. Fourth sentence.', [])).toEqual({ text: 'Second sentence.\nSafe: Third sentence. Fourth sentence.', dropped: 1 });
        expect(() => checkNote('One sentence. Invented 9999.', [])).toThrowError(expect.objectContaining({ code: 'unverified' }));
    });
});
describe('insight handler', () => {
    it('rejects unlabelled model output and drops only a preamble', async () => {
        const unlabelled = createHandlers({ apiKey: 'key', model: 'fake', now: () => 0, complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }) });
        const response = await unlabelled.POST(request({ facts: { ...facts, ra: 88.1 } }));
        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({ error: 'unverified' });
        const preamble = createHandlers({ apiKey: 'key', model: 'fake', now: () => 0, complete: async () => ({ text: `Preamble sentence.\n${note}`, refused: false, model: 'fake' }) });
        const kept = await preamble.POST(request({ facts: { ...facts, ra: 88.2 } }));
        expect(kept.status).toBe(200);
        expect(await kept.json()).toMatchObject({ text: note, dropped: 1 });
    });
    it('drops a truncated final fragment', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', now: () => 0, complete: async () => ({ text: note + ' Unfinished value 1.083', refused: false, model: 'fake', stopReason: 'max_tokens' }) });
        expect(await (await handler.POST(request({ facts: { ...facts, ra: 88 } }))).json()).toMatchObject({ text: note });
        const empty = createHandlers({ apiKey: 'key', model: 'fake', now: () => 0, complete: async () => ({ text: 'Unfinished value 1.083', refused: false, model: 'fake', stopReason: 'max_tokens' }) });
        expect((await empty.POST(request({ facts: { ...facts, ra: 91 } }))).status).toBe(422);
    });
    it('checks access and input, filters and caches results', async () => {
        const complete = vi.fn(async (_s: string, _u: string, _signal: AbortSignal) => ({ text: note, refused: false, model: 'fake' }));
        const off = createHandlers({ apiKey: undefined, model: 'fake', complete, now: () => 0 });
        expect(await (await off.GET(new Request('https://example.test'))).json()).toMatchObject({ enabled: false });
        expect((await off.POST(request({ facts }))).status).toBe(503);
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 0 });
        expect((await handler.POST(request({ facts }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
        expect((await handler.POST(request({ facts }, { origin: 'https://elsewhere.test' }))).status).toBe(403);
        expect((await handler.POST(request({ facts }, { 'content-type': 'text/plain' }))).status).toBe(400);
        expect((await handler.POST(request({ facts, pad: 'x'.repeat(5000) }))).status).toBe(413);
        expect((await handler.POST(new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '5000' }, body: '{}' }))).status).toBe(413);
        expect((await handler.POST(new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status).toBe(400);
        const response = await handler.POST(request({ facts }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ text: note, dropped: 0, model: 'fake', cached: false, remaining: 19 });
        for (const line of lines) { expect(complete.mock.calls[0]![1]).toContain(line); }
        expect((await handler.POST(request({ facts }))).status).toBe(200);
        expect(complete).toHaveBeenCalledTimes(1);
    });
    it('enforces per-client limits and recovers after a minute', async () => {
        let now = 100000;
        const complete = vi.fn(async () => ({ text: note, refused: false, model: 'fake' }));
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => now, maxPerUserDay: 40 });
        for (let i = 0; i < 20; i++) { expect((await handler.POST(request({ facts: { ...facts, ra: 100 + i } }, { 'x-forwarded-for': 'limit-test' }))).status).toBe(200); }
        const limited = await handler.POST(request({ facts: { ...facts, ra: 120 } }, { 'x-forwarded-for': 'limit-test' }));
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBeTruthy();
        now += 61000;
        expect((await handler.POST(request({ facts: { ...facts, ra: 120 } }, { 'x-forwarded-for': 'limit-test' }))).status).toBe(200);
    });
    it('does not expose errors and rejects refusals and unverifiable notes', async () => {
        for (const [result, status, code] of [[{ text: '', refused: true, model: 'fake' }, 502, 'no_note'], [new Error('sk-secret upstream text'), 502, 'failed'], [{ text: 'Value 9999. Value 8888.', refused: false, model: 'fake' }, 422, 'unverified']] as const) {
            const handler = createHandlers({ apiKey: 'key', model: 'fake', now: () => 1000000, complete: async () => { if (result instanceof Error) { throw result; } return result; } });
            const response = await handler.POST(request({ facts: { ...facts, ra: code === 'no_note' ? 230 : code === 'failed' ? 231 : 232 } }, { 'x-forwarded-for': code }));
            expect(response.status).toBe(status);
            const body = await response.text();
            expect(body).toContain(code);
            expect(body).not.toContain('sk-secret');
        }
    });
    it('enforces the hourly cap and lets cached answers through', async () => {
        vi.stubEnv('INSIGHT_MAX_PER_HOUR', '1');
        try {
            const handler = createHandlers({ apiKey: 'key', model: 'fake', maxPerHour: 1, now: () => 5000000, complete: async () => ({ text: note, refused: false, model: 'fake' }) });
            const first = { ...facts, ra: 250 };
            expect((await handler.POST(request({ facts: first }, { 'x-forwarded-for': 'hourly-a' }))).status).toBe(200);
            expect((await handler.POST(request({ facts: first }, { 'x-forwarded-for': 'hourly-b' }))).status).toBe(200);
            const limited = await handler.POST(request({ facts: { ...facts, ra: 251 } }, { 'x-forwarded-for': 'hourly-b' }));
            expect(limited.status).toBe(429);
            expect(limited.headers.get('retry-after')).toBe('2200');
        } finally { vi.unstubAllEnvs(); }
    });
    it('aborts a completion which does not settle', async () => {
        vi.useFakeTimers();
        try {
            let signal: AbortSignal | undefined;
            const handler = createHandlers({ apiKey: 'key', model: 'fake', now: () => 9000000, complete: async (_system, _user, s) => { signal = s; return new Promise(() => {}); } });
            const pending = handler.POST(request({ facts: { ...facts, ra: 260 } }));
            await vi.waitFor(() => expect(signal).toBeDefined());
            await vi.advanceTimersByTimeAsync(25000);
            expect((await pending).status).toBe(502);
            expect(signal?.aborted).toBe(true);
        } finally { vi.useRealTimers(); }
    });
});
describe('browser client', () => {
    it('caches notes even when a passcode is sent', async () => {
        const fetcher = vi.fn(async () => Response.json({ text: note, model: 'fake', dropped: 0 })) as unknown as typeof fetch;
        const input = { ...facts, ra: 89 };
        await fetchInsight(input, { passcode: 'secret', fetcher });
        expect((await fetchInsight(input, { passcode: 'secret', fetcher })).cached).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('handles availability and caches notes', async () => {
        expect(await insightEnabled(vi.fn(async () => new Response('', { status: 500 })) as typeof fetch)).toBe(false);
        expect(await insightEnabled(vi.fn(async () => { throw new Error(); }) as typeof fetch)).toBe(false);
        expect(await insightEnabled(vi.fn(async () => Response.json({ enabled: true })) as typeof fetch)).toBe(true);
        const fetcher = vi.fn(async () => Response.json({ text: note, model: 'fake', dropped: 0 })) as unknown as typeof fetch;
        expect((await fetchInsight(facts, { fetcher })).cached).toBe(false);
        expect((await fetchInsight(facts, { fetcher })).cached).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('rethrows an abort', async () => {
        const controller = new AbortController();
        controller.abort();
        const abort = new DOMException('aborted', 'AbortError');
        await expect(fetchInsight({ ...facts, ra: 280 }, { signal: controller.signal, fetcher: vi.fn(async () => { throw abort; }) as typeof fetch })).rejects.toBe(abort);
    });
    it.each([[503, 'off'], [400, 'invalid'], [413, 'invalid'], [429, 'busy'], [422, 'unverified'], [500, 'failed']] as const)('maps status %i', async (status, code) => {
        await expect(fetchInsight({ ...facts, ra: status / 10 }, { fetcher: vi.fn(async () => new Response('', { status })) as typeof fetch })).rejects.toMatchObject({ code });
    });
});

// Sentences a second reviewer (Grok 4.7) got past round 3. Each must fail without the rule that now drops it.
describe('checkNote: names and words used as numbers', () => {
    const pad = 'Safe sentence. Another safe sentence.';
    const barnard = ["Target: Barnard's Star.", 'Position: RA 269.4521 deg, Dec 4.6934 deg.', 'Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 14, 12, 16. Time from first to last visit: 182.5 days.', 'Brightness relative to the reference stars, in time order: 1.00, 0.97, 1.12.', 'Largest change from the median brightness: 12 percent above it.', 'Shift in position: 10.4 arcsec over 182.5 days.'];
    const wise = factSheet({ targetId: 'wise0855', ra: 133.7953, dec: -7.2451, lambdaUm: 4.67, visits: [{ mjd: 61000, frames: 3 }, { mjd: 61010, frames: 4 }, { mjd: 61180, frames: 5 }], motion: { arcsec: 4.1, days: 180 }, snapshot: false });
    function dropped(sentence: string, sheet: string[]): number { return checkNote(`${sentence} ${pad}`, sheet).dropped; }

    it.each([
        'It moved WISE J085510.83 arcsec.', 'The change is WISE J085510.83 percent.', 'It shifted WISE 0855 arcsec.', 'The shift is J085510.83 arcsec.',
        'It moved 0855 arcsec.', 'It shifted 4.1 arcsec over 0855 days.', 'It differs by 2MASS sigma.', 'The excess is W2 percent.', 'It differs by DR3 days.',
        'The rise is WISE J085510.83-fold.', 'The gap is DR2 months.',
    ])('drops a name or catalogue token standing in for a number: %s', (sentence) => {
        expect(dropped(sentence, wise)).toBe(1);
    });
    it.each([
        'WISE J085510.83-071442.5 shifted 4.1 arcsec over 180.0 days.', 'WISE 0855-0714 is a cold brown dwarf.', 'J085510.83-071442.5 is faint here.',
        'WISE J0855-0714 was seen in 3 visits.', 'WISE 0855 is known to be very cold.', 'Check Gaia DR2 for the same star.', 'Gaia DR3 lists no star here.',
        'Water, CO2 and CH4 absorb in this range.',
    ])('keeps a name used as a name: %s', (sentence) => {
        expect(dropped(sentence, wise)).toBe(0);
    });
    it.each([
        'It fell by a third between visits.', 'It fell by a third over 182.5 days.', 'It is a sixth as bright.', 'It dimmed by a seventh.', 'It lost one eighth of its light.',
        'It rose by two ninths.', 'The motion is 10.4 mas.', 'The motion is 10.4 arcmin.', 'The span is 182.5 hours.', 'The span is 16 months.', 'There are 5 frames at 4.270 micron.',
    ])('drops a fraction in words or a unit the sheet never uses: %s', (sentence) => {
        expect(dropped(sentence, barnard)).toBe(1);
    });
    it.each(['In the third visit it was brighter.', 'A third visit shows it brighter again.', "Barnard's Star shifted 10.4 arcsec over 182.5 days."])('checks direction or shift: %s', (sentence) => {
        expect(dropped(sentence, barnard)).toBe(sentence.includes('brighter') ? 1 : 0);
    });
});

describe('checkNote: round five', () => {
    const sheet = ["Target: Barnard's Star.", 'Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 14, 12, 16. Time from first to last visit: 182.5 days.', 'Brightness relative to the reference stars, in time order: 1.00, 0.97, 1.12.', 'Largest change from the median brightness: 12 percent above it.', 'Reference stars: 3.', 'Frames left out because their wavelength did not match: 3.', 'Difference image at the target: 1 sigma, brighter.', 'Shift in position: 10.4 arcsec over 182.5 days.'];
    const pad = 'Safe sentence. Another safe sentence.';
    it.each([
        "Barnard's Star moves about 10.4 arcsec in a year.", 'It shifts 10.4 arcsec annually.', 'That is 10.4 arcsec per annum.',
        'The brightening began 6 months before the first visit.', 'The visits were 3 weeks apart.',
        'At this signal-to-noise the error is a couple of percent.', 'It moved a few arcsec.', 'The scatter is several sigma.', 'The span is a handful of days.', 'Some microns are brighter.', 'Many degrees separate them.', 'Dozens of standard deviations were measured.',
        'It moved one arcsec.', 'The brightness changed one percent.', 'The wavelength is one micron.', 'The position is one degree.', 'The span is one day.',
        'It is the fourth-closest star to the Sun.', 'It is the second brightest star.', 'It changed by a hundredth.', 'It changed by two ten-thousandths.',
        'See <b>this</b> result.', 'See https://example.test for details.', 'See www.example.test for details.',
        'It is an M4 red dwarf.', 'It is a T8 object.', 'It is an L5.5 dwarf.', 'It is an M4V star.',
        'The star was observed in 12 visits.', 'There were 16 visits in all.', 'Only 3 frames passed the wavelength match.', 'The star appears in only 3 frames.',
        'The fourth visit was brighter.', 'SPHEREx has 102 detectors.',
    ])('drops %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        'The visits held 14, 12 and 16 frames.',
        'SPHEREx sees 102 colours, so try another wavelength.', 'SPHEREx has 6 detectors.',
        'The difference image shows one sigma.', 'The difference image shows one standard deviation.',
        'One can see the star.', 'No one knows.', 'One of the visits is brighter.',
        '3 frames were left out.',
    ])('keeps %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(['The visits held 14, 12 and 16 frames.', 'One of the visits is brighter.'].includes(sentence) ? 1 : 0);
    });
    it.each([
        ['The difference image shows one sigma.', 'Difference image: 1 sigma.'],
        ['The difference image shows one standard deviation.', 'Difference image: 1 sigma.'],
        ['The change is one percent.', 'Largest change: 1 percent.'],
        ['The shift is one arcsec.', 'Shift in position: 1 arcsec.'],
        ['The wavelength is one micron.', 'Wavelength: 1 micron.'],
        ['The position is one degree.', 'Position: 1 deg.'],
        ['The shift spans one day.', 'Shift in position: 1 days.'],
    ])('checks one against the matching fact: %s', (sentence, line) => {
        expect(checkNote(`${sentence} ${pad}`, [line]).dropped).toBe(0);
        expect(checkNote(`${sentence} ${pad}`, []).dropped).toBe(1);
    });
    it('allows a spectral token belonging to the target name', () => {
        expect(checkNote(`M4V is the target. ${pad}`, ['Target: M4V.']).dropped).toBe(0);
    });
    it.each([
        [{ VERCEL_ENV: 'production' }, true],
        [{ VERCEL_ENV: 'preview', UPSTASH_REDIS_REST_URL: 'url' }, true],
        [{ VERCEL_ENV: 'preview', KV_REST_API_URL: 'url', KV_REST_API_TOKEN: 'token' }, false],
        [{ VERCEL_ENV: 'development' }, false],
    ])('checks shared store configuration %j', (env, missing) => {
        expect(storeMissing(env)).toBe(missing);
    });
    it('turns both handlers off before accessing any store', async () => {
        const store = { hit: vi.fn(), count: vi.fn(), refund: vi.fn() } as unknown as LimitStore;
        const complete = vi.fn();
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 0, passcode: 'secret', store, local: store, storeMissing: true });
        expect(await (await handler.GET(new Request('https://example.test', { headers: { 'x-insight-passcode': 'secret' } }))).json()).toEqual({ enabled: false, locked: false, unlocked: false, model: 'fake' });
        const response = await handler.POST(request({ facts }, { 'x-insight-passcode': 'secret' }));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'off' });
        expect(store.hit).not.toHaveBeenCalled(); expect(store.count).not.toHaveBeenCalled(); expect(store.refund).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    });
    it('limits uncached correct requests per minute', async () => {
        let now = 120000;
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', now: () => now, maxPerUserDay: 40, complete: async () => ({ text: note, refused: false, model: 'fake' }) });
        const send = (ra: number) => handler.POST(request({ facts: { ...facts, ra } }, { 'x-real-ip': 'round-five-minute', 'x-insight-passcode': 'secret' }));
        for (let i = 0; i < 20; i++) { expect((await send(200 + i)).status).toBe(200); }
        const limited = await send(220);
        expect(limited.status).toBe(429); expect(limited.headers.get('Retry-After')).toBeTruthy();
        now += 60000;
        expect((await send(220)).status).toBe(200);
    });
});

describe('checkNote: round six', () => {
    const sheet = ['Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 14, 12, 16.', 'Brightness relative to the reference stars, in time order: 1.00, 0.97, 1.12.', 'Largest change from the median brightness: 12 percent above it.', 'Difference image at the target: 3.4 sigma.', 'Shift in position: 10.4 arcsec over 182.5 days.'];
    const pad = 'Safe sentence. Another safe sentence.';
    it.each([
        'It moves 10.4 arcsec per yr.', 'It moves 10.4 arcsec a yr.', 'The difference is a one-sigma bump.',
        'The reference stars are steady to about a percent.', 'It shifted about an arcsecond more than predicted.',
        'The star shows up in 3 of its frames.', 'A fourth visit showed it brighter.', 'It is a K0III giant.',
        'The error is a couple of per cent.',
    ])('drops unsupported: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        'The frames were taken in the 4.270 micron band.', 'Water ice absorbs near the 3.05 micron band.',
        'The 4.270 micron images show the star.', 'A 3.4 sigma point at the target is brighter in the later visit.',
        'SPHEREx has 102 spectral channels.',
        'A fourth visit might show it brighter.',
    ])('keeps supported: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(sentence === 'A fourth visit might show it brighter.' ? 1 : 0);
    });
    // Round 10 (F5): the prompt's own "fewer than 3 visits" is kept only when the sheet counts fewer than 3, and a
    // bound the sheet does not give is refused.
    it.each(['There are fewer than 3 visits.', 'There are fewer than three visits.'])('keeps on a 2-visit sheet, drops on 3 or "at least": %s', (sentence) => {
        const two = sheet.map((line) => line.replace('Visits: 3. Frames in each visit: 14, 12, 16.', 'Visits: 2. Frames in each visit: 14, 12.'));
        const atLeast = sheet.map((line) => line.replace('Visits: 3.', 'Visits: at least 2.'));
        expect(checkNote(`${sentence} ${pad}`, two).dropped).toBe(0);
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
        expect(checkNote(`${sentence} ${pad}`, atLeast).dropped).toBe(1);
        expect(checkNote(`${sentence} ${pad}`, ['Scatter: 1.2, 1.8, 2.5 percent.']).dropped).toBe(1);
    });
    it.each([
        'There are fewer than 14 frames in the first visit.', 'There are at least 3 visits.', 'It was seen in more than 3 visits.',
        'The difference is over 3.4 sigma.', 'The difference is under 3.4 sigma.', 'The reading stayed below 1.12.',
    ])('drops a bound the sheet does not give: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each(['It shifted 10.4 arcsec over 182.5 days.', 'There are 3 visits.', 'The first visit has 14 frames.'])('keeps the exact fact: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(0);
    });
    it('checks rank against the readings and requires a future cue for visits', () => {
        for (const sentence of ['The second-brightest reading was 0.97.', 'The fourth-brightest reading was 1.00.', 'A fourth visit showed it brighter.']) {
            expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
        }
        expect(checkNote(`The difference is a one-sigma bump. ${pad}`, ['Difference image: 1 sigma.']).dropped).toBe(0);
        expect(checkNote(`The shift is an arcsecond. ${pad}`, ['Shift in position: 1 arcsec.']).dropped).toBe(0);
        expect(checkNote(`The change is a percent. ${pad}`, ['Largest change: 1 percent.']).dropped).toBe(0);
    });
    it('does not use a visit count as a frame count through a possessive', () => {
        expect(checkNote(`The visit shows the star in 3 of its frames. ${pad}`, ['Visits: 3.']).dropped).toBe(1);
    });
    it.each([
        [{ VERCEL: '1' }, true], [{ VERCEL: '1', VERCEL_ENV: 'development' }, false],
        [{ VERCEL: '1', KV_REST_API_URL: 'url', KV_REST_API_TOKEN: 'token' }, false], [{}, false],
    ])('detects missing store on Vercel: %j', (env, missing) => {
        expect(storeMissing(env)).toBe(missing);
    });
});

describe('checkNote: round seven', () => {
    const sheet = ['Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 14, 12, 16.', 'Brightness relative to the reference stars, in time order: 1.00, 0.97, 1.12.', 'Largest change from the median brightness: 12 percent above it.', 'Reference stars: 3.', 'Frames left out: 3.', 'Difference image at the target: 3.4 sigma.', 'Shift in position: 10.4 arcsec over 182.5 days.'];
    const pad = 'Safe sentence. Another safe sentence.';
    it.each([
        'The visits span about a year.', 'RW Aur faded by about a magnitude.', 'RW Aur fades by a full magnitude in its dimming events.',
        'The visits were a few months apart.', 'The 12 percent rise came a fortnight after the first visit.',
        'eps Indi B shifted 10.4 arcsec over 182.5 days, a week shorter than expected.',
        'Between the visits, 3 full months passed.', 'The 3 visits span decades.', 'The frames were taken minutes apart.',
        'It dims every few hours.', 'The visits were in october.',
    ])('drops a time unit other than days, or a magnitude: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        'The fourth visit was brighter, which could mean a flare.', 'Later on, the star faded and the fourth visit was brighter.',
        'Across the frames, the star was seen in 12 high-cadence visits.', 'The frames were compared with 12 references.',
        'The frames use 16 comparisons.', 'The upper limit is 12 percent.', 'The error is 12 percent upon inspection.',
    ])('drops a number beside the wrong word: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        '3 of the frames were left out.',
        'A later fourth visit could test it.',
        'It would help if a fourth visit were taken.', 'One more visit would help.',
        'There are 3 reference stars.', 'Each of the 3 visits has 14, 12 and 16 frames.', 'The shift may be real.',
    ])('keeps: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(['3 of the frames were left out.', 'The shift may be real.'].includes(sentence) ? 1 : 0);
    });
    it('drops the former candidate paraphrase under the closed median form', () => {
        expect(checkNote(`With a degree of caution, call it a candidate change from the median of 12 percent. ${pad}`, sheet).dropped).toBe(1);
    });
    it.each(["The star's light went up by 12 percent.", 'The brightness was 12 per cent higher.', 'In one visit the star was 12 percent brighter.', 'The brightness went up by 12 percent.', 'The star is 12 percent brighter in the third visit.'])('drops a median distance described as a time change: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
});

describe('checkNote: median distance', () => {
    const makeSheet = (values: number[]) => factSheet({ ...facts, lightCurve: { points: values.map((relative, i) => ({ mjd: 61000 + i, relative, snr: 10 })), refScatter: [0.012, 0.02], dropped: 0 } });
    const flat = makeSheet([1, 1.004, 1]);
    const above = makeSheet([1.3, 1, 1]);
    const below = makeSheet([1, 1, 0.77]);
    const either = makeSheet([0.81, 1, 1.19]);
    const pad = 'Safe sentence. Another safe sentence.';
    it.each([
        [flat, 'The reference star scatter is below 1 percent.'],
        [flat, 'The noise is below 1 percent.'],
        [flat, 'Each frame is accurate to below 1 percent.'],
        [above, 'The reference stars scatter 30 percent above normal.'],
        [flat, 'The comparison scatter is below 1 percent.'],
        [above, 'The noise is 30 percent above normal.'],
        [above, 'The star got 30 percent brighter.'],
        [above, 'The largest change from the median brightness is 30 percent below it.'],
        [above, 'The star faded by 30 percent.'],
        [below, 'It is 23 percent above the median at its largest.'],
        [either, 'The largest change from the median is 19 percent above it.'],
        [flat, 'The largest change from the median is below 1 percent.'],
    ])('drops unsupported %s %s', (sheet, sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        [above, 'The largest change from the median brightness is 30 percent above it.'],
        [below, 'The largest change from the median is 23 percent below it.'],
        [either, 'The largest change from the median is 19 percent either side.'],
        [flat, 'The largest change from the median brightness is less than 1 percent.'],
        [above, 'The brightness went from 1.30 to 1.00.'],
    ])('keeps supported %s %s', (sheet, sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).text).toBe(`${sentence} ${pad}`);
    });
    it.each(['got', 'became', 'grew', 'rose', 'rise', 'rising', 'risen', 'climbed', 'increased', 'brightened', 'gained', 'fell', 'fall', 'falling', 'dropped', 'faded', 'fading', 'dimmed', 'decreased', 'declined', 'lost', 'went'])('drops a median distance with the time word %s', (word) => {
        expect(checkNote(`The median brightness ${word} by 30 percent. ${pad}`, above).dropped).toBe(1);
    });
    it('does not apply the median rule to a number supported by another sheet line', () => {
        const shared = [...above, 'Reference stars: 1 with available scatter. Scatter of each: 30 percent.'];
        const sentence = 'The reference star scatters by 30 percent.';
        expect(checkNote(`${sentence} ${pad}`, shared).text).toBe(`${sentence} ${pad}`);
    });
});

describe('checkNote: round eight', () => {
    const makeSheet = (values: number[], refScatter = [0.012, 0.02]) => factSheet({ ...facts, visits: [{ mjd: 61000, frames: 3 }, { mjd: 61182.5, frames: 4 }], lightCurve: { points: values.map((relative, i) => ({ mjd: 61000 + i, relative, snr: 10 })), refScatter, dropped: 0 } });
    const above = makeSheet([1.3, 1, 1]);
    const below = makeSheet([0.77, 1, 1]);
    const dip = makeSheet([1, 0.7, 1]);
    const either = makeSheet([0.81, 1, 1.19]);
    const flat = makeSheet([1, 1.004, 1]);
    const pad = 'Safe sentence. Another safe sentence.';
    it.each([
        [above, 'The brightness in the third visit is 30 percent above the median.'],
        [above, 'The brightness surged 30 percent above the median.'],
        [above, 'The brightness is now 30 percent above the median.'],
        [above, 'The star jumped 30 percent above the median.'],
        [above, 'The brightness dipped 30 percent from the median.'],
        [below, 'The brightness dims to 23 percent below the median.'],
        [dip, 'By the last visit the brightness was 30 percent below the median.'],
    ])('D1 drops time claim: %s %s', (sheet, sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        [either, 'The reference stars sit 19 percent either side of the median.'],
        [above, 'The difference image shows the target 30 percent above the median.'],
        [flat, "The reference stars' brightness varies by less than 1 percent around the median."],
        [below, 'The noise is 23 percent below the median.'],
        [above, 'The reference stars scatter 30 percent above the median.'],
    ])('D2 drops another subject: %s %s', (sheet, sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it('D2 drops a distant reference to scatter under the closed form', () => {
        const sentence = 'The largest change from the median is 30 percent above it, far more than the 1.2 and 2.0 percent scatter of the reference stars.';
        expect(checkNote(`${sentence} ${pad}`, above).dropped).toBe(1);
    });
    it('D3 distinguishes elapsed time from direction', () => {
        const sentence = 'Over 182.5 days, the largest change from the median brightness is 23 percent below it.';
        expect(checkNote(`${sentence} ${pad}`, below).dropped).toBe(1);
        expect(checkNote(`It is 23 percent over the median at its largest. ${pad}`, below).dropped).toBe(1);
    });
    it('D4 does not use scatter to support a brightness change', () => {
        const shared = [...above, 'Scatter of each: 1.2, 30 percent.'];
        expect(checkNote(`Compared with the reference stars, the target faded by 30 percent. ${pad}`, shared).dropped).toBe(1);
        const sentence = 'The 2 reference stars scatter by 1.2 and 2.0 percent.';
        expect(checkNote(`${sentence} ${pad}`, above).text).toBe(`${sentence} ${pad}`);
    });
    it('C1 does not accept above normal as a largest-change context', () => {
        const sentence = 'The median is irrelevant to an unrelated reading which is 30 percent above normal.';
        expect(checkNote(`${sentence} ${pad}`, above).dropped).toBe(1);
    });
});

describe('checkNote: round nine closed forms', () => {
    const sheets = {
        above: ['Largest change from the median brightness: 1 percent above it.'],
        below: ['Largest change from the median brightness: 1 percent below it.'],
        either: ['Largest change from the median brightness: 1 percent either side.'],
        less: ['Largest change from the median brightness: less than 1 percent.'],
    };
    const pad = 'Safe sentence. Another safe sentence.';
    const check = (sentence: string, sheet: string[]) => checkNote(`${sentence} ${pad}`, sheet).dropped;
    const referents = ['it', 'the median', 'its median'];
    for (const start of ['The', 'Its']) {
        for (const possessive of ['the', 'its']) {
            for (const brightness of ['', ' brightness']) {
                for (const verb of ['is', 'was']) {
                    const prefix = `${start} largest change from ${possessive} median${brightness} ${verb}`;
                    for (const [direction, endings] of Object.entries({
                        above: referents.map((ref) => `1 percent above ${ref}`),
                        below: referents.map((ref) => `1 percent below ${ref}`),
                        either: ['1 percent either side', ...referents.map((ref) => `1 percent either side of ${ref}`)],
                        less: ['less than 1 percent', ...referents.map((ref) => `less than 1 percent from ${ref}`)],
                    })) {
                        for (const ending of endings) {
                            const sentence = `${prefix} ${ending}.`;
                            it(`matches only ${direction}: ${sentence}`, () => {
                                for (const [sheetDirection, sheet] of Object.entries(sheets)) {
                                    expect(check(sentence, sheet), sheetDirection).toBe(sheetDirection === direction ? 0 : 1);
                                }
                            });
                        }
                    }
                }
            }
        }
    }
    it('accepts case and whitespace but requires a final full stop', () => {
        expect(checkNote(`  ITS LARGEST CHANGE FROM ITS MEDIAN WAS 1 PERCENT ABOVE IT.  \n${pad}`, sheets.above).dropped).toBe(0);
        expect(checkNote(`ITS LARGEST CHANGE FROM ITS MEDIAN WAS 1 PERCENT ABOVE IT\n${pad}`, sheets.above).dropped).toBe(1);
    });
    it('rejects a different printed number and noncanonical number spelling', () => {
        for (const number of ['2', '01', '1.0']) {
            expect(check(`The largest change from the median is ${number} percent above it.`, sheets.above), number).toBe(1);
        }
    });
    it('rejects leading, trailing, subject and joined clauses', () => {
        for (const sentence of [
            'For this target, the largest change from the median brightness is 1 percent above the median.',
            'The largest change from the median brightness is 1 percent above the median, far more than the scatter.',
            "The sky background's largest change from the median brightness is 1 percent above the median.",
            'The largest change from the median is 1 percent above it and the largest change from the median is 1 percent above it.',
        ]) { expect(check(sentence, sheets.above), sentence).toBe(1); }
    });
    it('does not restrict independently supported frame and signal-to-noise numbers', () => {
        const shared = [...sheets.above, 'Visits: 2. Frames in each visit: 30, 31.', 'Lowest signal-to-noise among the points: 30.'];
        for (const sentence of ['The first visit had 30 frames.', 'The lowest signal-to-noise is 30.']) {
            expect(check(sentence, shared), sentence).toBe(0);
        }
    });
    const scatter = ['Reference stars: 2 with available scatter. Scatter of each: 1.2, 2.0 percent.'];
    it('accepts the complete reference scatter sentence', () => {
        for (const sentence of ['The 2 reference stars scatter by 1.2 and 2.0 percent.', 'The reference stars have a scatter of 1.2 and 2.0 percent.']) {
            expect(check(sentence, scatter), sentence).toBe(0);
        }
    });
    it('requires both scatter and reference across the whole sentence', () => {
        for (const sentence of ['The reference stars have 2.0 percent.', 'The scatter is 2.0 percent.', 'The target and reference stars scatter by 2.0 percent.']) {
            expect(check(sentence, scatter), sentence).toBe(1);
        }
    });
    it('rejects every scatter bound immediately before the number', () => {
        for (const bound of ['below', 'under', 'above', 'over', 'less than', 'more than', 'at least', 'at most', 'up to']) {
            expect(check(`The reference star scatter is ${bound} 2.0 percent.`, scatter), bound).toBe(1);
        }
    });
    it('rejects scatter change and comparison terms anywhere in the sentence', () => {
        for (const word of ['faded', 'brighter', 'fainter', 'dimmer', 'higher', 'lower', 'changed', 'varied', 'fluctuated', 'peaked', 'differed', 'now']) {
            expect(check(`The reference stars scatter by 2.0 percent and ${word}.`, scatter), word).toBe(1);
        }
    });
    it('rejects reviewer scatter claims even when the verb is outside the word window', () => {
        for (const sentence of ['The reference star scatter is below 2.0 percent.', 'Compared with the reference stars, the target is 30 percent brighter.', 'Compared with the reference stars, the target is 30 percent fainter.', 'Compared with the reference stars, the target changed by 30 percent.', 'Compared with the reference stars, the target varied by 30 percent.', 'The target faded when measured against the steady reference stars by 30 percent.', 'Compared with the reference stars, the target by 30 percent in brightness faded.', 'Compared with the reference stars, the target swelled by 2.0 percent.', 'The target faded, and against the reference stars that change came to 2.0 percent.', 'Against the reference stars, the target is 1.2 percent brighter now.']) {
            expect(check(sentence, scatter), sentence).toBe(1);
        }
    });
    it('rejects the reviewers’ quoted median claims and wrong directions', () => {
        const sheet = ['Largest change from the median brightness: 30 percent above it.'];
        for (const sentence of [
            'The brightness swelled to 30 percent above the median.', 'The brightness is down 30 percent from the median.',
            'The readings sit 30 percent either side of the median.', 'The minimum brightness is 30 percent less than the median.',
            'The largest change from the median brightness is 30 percent down from it.', 'The lowest brightness is 30 percent short of the median.',
            'The brightness is 30 percent under median.', 'The largest change from the median brightness is 30 percent in the reference stars.',
            'The largest change from the median brightness is 30 percent due to noise.', 'The largest change from the median brightness is 30 percent across the frames.',
            'Between epochs, the brightness varied by 30 percent from the median.', 'At the beginning, the brightness was 30 percent above the median.',
            'The brightness peaked at 30 percent above the median during the middle epoch.', 'The sky background brightness is 30 percent above the median.',
            "The sky background's largest change from the median brightness is 30 percent above the median.",
            'The uncertainty in brightness is 30 percent of the median.', 'A nearby companion star is 30 percent brighter than the median.',
            'The largest change from the median is 30 percent above it, far more than the 1.2 and 2.0 percent scatter of the reference stars.',
        ]) { expect(check(sentence, sheet), sentence).toBe(1); }
        expect(check('It exceeds the median by 23 percent.', ['Largest change from the median brightness: 23 percent below it.'])).toBe(1);
        expect(check('The brightness waned to 23 percent below the median.', ['Largest change from the median brightness: 23 percent below it.'])).toBe(1);
        expect(check('The sky background sits 19 percent either side of the median.', ['Largest change from the median brightness: 19 percent either side.'])).toBe(1);
    });
    it('keeps three prompt-shaped notes for rising, falling and flat sheets', () => {
        for (const [values, median] of [[[1, 1, 1.3], '30 percent above the median'], [[1.3, 1, 1], '30 percent above the median'], [[1, 1, 1], 'less than 1 percent from the median']] as const) {
            const sheet = factSheet({ ...facts, visits: [{ mjd: 61000, frames: 3 }, { mjd: 61010, frames: 4 }, { mjd: 61020, frames: 5 }], lightCurve: { points: values.map((relative, i) => ({ mjd: 61000 + i * 10, relative, snr: 10 })), refScatter: [0.012, 0.02], dropped: 0 } });
            const note = `Across 3 visits the brightness was ${values.map((n) => n.toFixed(2)).join(', ')}. The largest change from the median brightness is ${median}. The 2 reference stars scatter by 1.2 and 2.0 percent.`;
            expect(checkNote(note, sheet).dropped).toBeLessThanOrEqual(1);
        }
    });
});
describe('round 11 measurement safeguards', () => {
    const pad = 'Safe sentence. Another safe sentence.';
    const sheet = ['Target: eps Indi B.', 'Visits: 3. Frames in each visit: 7, 9, 8. Time from first to last visit: 400.0 days.', 'Brightness relative to the reference stars, in time order: 1.30, 1.00, 1.00.', 'Largest change from the median brightness: 3 percent above it.', 'Lowest signal-to-noise among the points: below 1.', 'Reference stars: 2 with available scatter. Scatter of each: 1.2, 2.0 percent.', 'Shift in position: 10.4 arcsec over 20.0 days.'];
    const check = (sentence: string, facts = sheet) => checkNote(`${sentence} ${pad}`, facts).dropped;
    it('H1 checks reading order, direction, position and differences', () => {
        for (const s of ['The brightness rose from 1.00 to 1.30.', 'The brightness ended at 1.30.', 'The brightness rose by 1.00.', 'The target brightness scatter was 1.30.']) { expect(check(s), s).toBe(1); }
        expect(check('The brightness peaked at 1.30 at the first visit.', sheet.map((s) => s.replace('1.30, 1.00, 1.00', '1.00, 1.00, 1.30')))).toBe(1);
        expect(check('The brightness went from 1.30 to 1.00.')).toBe(0);
    });
    it('H2 checks number-free comparisons against the largest scatter', () => {
        expect(check('The change is several times larger than that scatter.')).toBe(1);
        expect(check('The change is larger than that scatter.')).toBe(0);
        expect(check('The change is several times larger than that scatter.', sheet.map((s) => s.replace('3 percent above', '6 percent above')))).toBe(0);
        expect(check('The change is comparable to that scatter.')).toBe(1);
    });
    it('M1 preserves the exact lowest signal-to-noise bound and subject', () => {
        expect(check('The lowest signal-to-noise is below 1.')).toBe(0);
        expect(check('The lowest signal-to-noise is 1.')).toBe(1);
        expect(check('The change has a signal-to-noise of 1.')).toBe(1);
    });
    it('M2 distinguishes over as a preposition from a bound', () => {
        for (const s of ['The visits span over 400.0 days.', 'The time is above 400.0 days.', 'It moved over 10.4 arcsec.']) { expect(check(s), s).toBe(1); }
        expect(check('Over 3 visits the brightness went from 1.30 to 1.00.')).toBe(0);
        expect(check('It shifted 10.4 arcsec over 20.0 days.')).toBe(0);
    });
    it('M3 rejects unsupported bounds and approximations', () => {
        for (const s of ['Nearly 3 visits were made.', 'There were up to 9 frames in a visit.', 'There were 9 frames or more in a visit.', 'There were no fewer than 9 frames in a visit.']) { expect(check(s), s).toBe(1); }
        expect(check('There were 3 visits.')).toBe(0);
    });
    it('M4 requires printed numeric precision', () => {
        for (const s of ['There were 3.0 visits.', 'The brightness was 1.3.', 'The lowest signal-to-noise is below 1.0.']) { expect(check(s), s).toBe(1); }
        expect(check('The brightness was 1.30.')).toBe(1);
        expect(check('The first reading was 1.30.')).toBe(0);
        expect(check('The wavelength is 5.0 micron.', [...sheet, 'Wavelength: 5.000 micron.'])).toBe(1);
        expect(check('The wavelength is 5.000 micron.', [...sheet, 'Wavelength: 5.000 micron.'])).toBe(0);
    });
    it('M5 joins abbreviations and rejects unbalanced punctuation', () => {
        expect(check('Target scatter is high, viz. The 2 reference stars scatter by 1.2 and 2.0 percent.')).toBe(1);
        expect(check('It is a flare star (e.g. 50 percent brighter).')).toBe(1);
        expect(check('The target is visible.')).toBe(0);
    });
    it('L1 requires equal frame counts for each visit', () => {
        expect(check('Each visit had 9 frames.')).toBe(1);
        expect(check('Each visit had 9 frames.', sheet.map((s) => s.replace('7, 9, 8', '9, 9, 9')))).toBe(0);
    });
    it('L2 normalizes labels and checks sentence starts after target names', () => {
        expect(checkNote(`**What this shows:** The first reading was 1.30. This is a candidate only.`, sheet).text).toContain('What this shows: The first reading');
        expect(check('- the target brightened.')).toBe(1);
    });
    it('L3 rejects names as counts and accepts the sheet reference-star wording', () => {
        expect(check('It varied across W1 visits and DR2 reference stars.')).toBe(1);
        expect(check('Among the reference stars, 2 with available scatter were used.')).toBe(0);
    });
    it('T rejects a joined scatter sentence with no space', () => {
        expect(check('The 2 reference stars scatter by 1.2 and 2.0 percent.The star faded.')).toBe(1);
    });
    it('H1 mutant: order, repeated positions and direction cannot be bypassed', () => {
        const rising = sheet.map((s) => s.replace('1.30, 1.00, 1.00', '1.00, 1.00, 1.30'));
        for (const sentence of ['The brightness fell from 1.30 to 1.00.', 'In time order the brightness was 1.30, 1.00 and 1.00.', 'The brightness peaked at 1.30 at the first visit.', 'The brightness fell from 1.00 to 1.30.']) { expect(check(sentence, rising), sentence).toBe(1); }
        expect(check('The brightness went from 1.00 to 1.30.', rising)).toBe(0);
        expect(check('In time order the brightness was 1.00, 1.00 and 1.30.', rising)).toBe(0);
    });
    it('H2 mutant: several times means at least three times the largest scatter', () => {
        for (const amount of [1, 3, 5]) { expect(check('The change is several times larger than that scatter.', sheet.map((s) => s.replace('3 percent above', `${amount} percent above`)))).toBe(1); }
        expect(check('The change is several times larger than that scatter.', sheet.map((s) => s.replace('3 percent above', '6 percent above')))).toBe(0);
        expect(check('The change is no larger than that scatter, so it may be noise.', sheet.map((s) => s.replace('3 percent above it', 'less than 1 percent')))).toBe(0);
        expect(check('The change is several times larger than that scatter.', sheet.filter((s) => !s.startsWith('Largest change')))).toBe(1);
        expect(check('The change is well clear of the reference stars.')).toBe(1);
        expect(check('It was measured against nearby reference stars.')).toBe(0);
    });
    it('M1 mutant: the printed signal-to-noise bound is required', () => {
        for (const bound of ['below 1', 'more than 100', 'at least 30', '30']) {
            const facts = sheet.map((s) => s.replace('below 1.', `${bound}.`));
            expect(check(`The lowest signal-to-noise among the points is ${bound}.`, facts), bound).toBe(0);
            expect(check(`The change has a signal-to-noise of ${bound}.`, facts), bound).toBe(1);
            if (bound !== '30') { expect(check(`The lowest signal-to-noise is ${bound.split(' ').at(-1)}.`, facts), bound).toBe(1); }
        }
    });
    it('M2 covers elapsed-time and lower-bound contexts', () => {
        for (const s of ['The visits lasted over 400.0 days.', 'The visits took over 400.0 days.', 'The time was over 400.0 days.', 'It moved above 10.4 arcsec.']) { expect(check(s), s).toBe(1); }
        expect(check('There were 3 visits over 400.0 days.')).toBe(0);
    });
    it('M3 checks all requested approximation and trailing-bound words', () => {
        for (const term of ['nearly', 'almost', 'close to', 'roughly', 'about', 'around', 'approximately', 'some', 'a minimum of', 'a maximum of', 'up to', 'as many as', 'as few as', 'no more than', 'no fewer than', 'no less than', 'at most']) {
            expect(check(`There were ${term} 3 visits.`), term).toBe(1);
        }
        for (const term of ['or more', 'or fewer', 'or less', 'and more', 'plus']) { expect(check(`There were 3 visits ${term}.`), term).toBe(1); }
    });
    it('M5 joins each abbreviation and drops unbalanced chunks', () => {
        for (const abbreviation of ['viz.', 'e.g.', 'i.e.', 'approx.', 'cf.', 'vs.', 'etc.']) {
            expect(check(`The target is ${abbreviation} 50 percent brighter.`), abbreviation).toBe(1);
        }
        expect(checkNote('It is a flare star (e.g. Safe sentence. Another safe sentence. Third safe sentence.', sheet).dropped).toBe(1);
    });
    it('L2 supports both bold label forms and leading punctuation', () => {
        for (const label of ['**What this shows:**', '**What this shows**:', 'What this shows :']) {
            expect(checkNote(`${label} The first reading was 1.30. This is a candidate only.`, sheet).text).toContain('What this shows: The first reading');
        }
        for (const lead of ['- ', '• ', '[', '"']) { expect(check(`${lead}the target brightened.`), lead).toBe(1); }
    });
    it('T keeps three paragraphs in the additional over and bounded-SNR notes', () => {
        const notes = [
            `What this shows: Over 3 visits the brightness went from 1.30 to 1.00.\nHow far to trust it: The 2 reference stars scatter by 1.2 and 2.0 percent.\nWhat to check next: Change the colour to look at another wavelength.`,
            `What this shows: The brightness went from 1.30 to 1.00.\nHow far to trust it: The lowest signal-to-noise among the points is below 1.\nWhat to check next: Change the colour to look at another wavelength.`,
        ];
        for (const note of notes) { const result = checkNote(note, sheet); expect(result.text.split('\n')).toHaveLength(3); expect(result.dropped).toBe(0); }
    });
    it('Gemini concrete probes: mixed contexts and unsupported bounds', () => {
        const facts = ['Visits: 2. Frames in each visit: 30, 31. Time from first to last visit: 20.0 days.', 'Brightness relative to the reference stars, in time order: 1.00, 1.01, 1.00.', 'Largest change from the median brightness: 30 percent above it.', 'Lowest signal-to-noise among the points: 30.', 'Reference stars: 2 with available scatter. Scatter of each: 1.2, 2.0 percent.', 'Shift in position: 10.4 arcsec.'];
        for (const sentence of ['The target brightened across 2.0 visits and beat 2.0 reference stars.', 'The brightness rose by 1.00 across the visits.', 'The flux jumped by 1.01 in the second visit.', 'The time from first to last visit is over 20.0 days and the shift in position is above 10.4 arcsec.', 'Each visit has nearly 30 frames, or a minimum of 30 frames, or 30 frames or more.', 'The 2 reference stars scatter by 1.2 and 30 percent.']) {
            expect(check(sentence, facts), sentence).toBe(1);
        }
        expect(check('The target brightness scatter was 1.2 across the visits.', facts.map((s) => s.replace('1.00, 1.01, 1.00', '1.20, 1.01, 1.00')))).toBe(1);
        expect(check('Among the reference stars, 2 with available scatter were used.', facts)).toBe(0);
    });
});
