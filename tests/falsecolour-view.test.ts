import { describe, expect, it } from 'vitest';
import { colourSentence } from '../src/lib/falsecolour-view';
import type { ColourAt } from '../src/lib/falsecolour';
import text from '../src/lib/falsecolour-view.ts?raw';
import slotText from '../src/ui/slots.ts?raw';

const both: ColourAt = { short: 4, long: 10, snrShort: 14.3, snrLong: 30.7, index: 0.423, seen: 'both', valid: true };

describe('false colour sentence', () => {
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
            .toContain('At the centre: seen at 4.60 µm only (signal-to-noise 31); 1.25 µm cannot be measured here (blank pixels).');
        const blankLong = colourSentence(1.25, 4.6, { ...both, long: NaN, seen: 'short', valid: false });
        expect(blankLong).toContain('At the centre: seen at 1.25 µm only (signal-to-noise 14); 4.60 µm cannot be measured here (blank pixels).');
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
        expect(short).toContain('At the centre: seen at 1.25 µm only (signal-to-noise 20); 4.60 µm cannot be measured here (blank pixels).');
        const long = colourSentence(1.25, 4.6, { ...both, short: NaN, seen: 'long', valid: false, snrLong: 20 });
        expect(long).toContain('At the centre: seen at 4.60 µm only (signal-to-noise 20); 1.25 µm cannot be measured here (blank pixels).');
        expect(short + long).not.toMatch(/colour index [−+\d]/);
        expect(colourSentence(1.25, 4.6, { ...both, short: NaN, long: NaN, seen: 'neither', valid: false }))
            .toContain('At the centre: cannot be measured here (blank pixels).');
    });

    it('explains how the reading relates to the picture', () => {
        expect(colourSentence(1.25, 4.6, both)).toContain('The reading adds up a small circle of pixels and takes off the sky just around it, so it need not match the tint of the middle pixels.');
    });
});
