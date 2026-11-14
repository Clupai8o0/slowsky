import { describe, expect, it } from 'vitest';
import { LINES, type CubeSpectrum } from '../src/lib/cube';
import { lambdaToX, spectrumChartSvg, spectrumChartText } from '../src/lib/spectrum-chart';

const LAMBDAS_20 = [
    0.75, 0.95, 1.15, 1.35, 1.62,
    1.85, 2.05, 2.30, 2.55, 2.80,
    3.05, 3.30, 3.55, 3.80, 4.05,
    4.25, 4.45, 4.65, 4.85, 5.00
];

const VALUES_20 = [
    2.5, 3.0, 4.5, 6.25, 12.5,
    9.0, 7.5, 6.0, 5.5, 4.75,
    3.25, 4.0, 3.5, 3.0, 2.75,
    2.25, 2.0, 1.75, 1.5, 1.25
];

function makeSpectrum(overrides: Partial<CubeSpectrum> = {}): CubeSpectrum
{
    const n = LAMBDAS_20.length;
    return {
        lambda: Float64Array.from(LAMBDAS_20),
        surfaceBrightness: Float32Array.from(VALUES_20),
        noise: Float32Array.from({ length: n }, () => 0.5),
        reasons: Array.from({ length: n }, () => null),
        notes: ['0 planes have no data at the centre'],
        background: Float32Array.from({ length: n }, () => 1.0),
        unit: 'MJy/sr',
        spot: {
            tile: 'Npix1234',
            url: 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/dr1/hips5_cube/hips_20261026/Norder5/Dir0/Npix1234_cube.fits',
            x: 255.5,
            y: 128.5
        },
        bytesRead: 4096,
        caption: 'Quick look from the one-year all-sky cube. Not for measurement.',
        ...overrides
    };
}

function assertCleanSvg(svg: string): void
{
    expect(svg).toMatch(/^<svg\b[^>]*viewBox="0 0 [\d.]+ [\d.]+"/);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-labelledby="');
    expect(svg).toContain('<title ');
    expect(svg).toContain('<desc ');
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(svg).not.toMatch(/\b(discover|detect|confirm|prove)\b/i);
    expect(svg).not.toMatch(/<(?:linearGradient|radialGradient|filter)\b/);

    const stack: string[] = [];
    for (const match of svg.matchAll(/<\/?([\w-]+)\b[^>]*>/g)) {
        if (match[0].startsWith('</')) {
            expect(stack.pop()).toBe(match[1]);
        } else if (!match[0].endsWith('/>')) {
            stack.push(match[1]!);
        }
    }
    expect(stack).toEqual([]);

    for (const match of svg.matchAll(/\brx="([^"]+)"/g)) {
        expect(Number(match[1])).toBeLessThanOrEqual(2);
    }

    for (const match of svg.matchAll(/\b(?:x|y|x1|y1|x2|y2|cx|cy|r)="([^"]+)"/g)) {
        expect(match[1]).toMatch(/^-?\d+(?:\.\d)?$/);
    }

    for (const match of svg.matchAll(/\bd="([^"]+)"/g)) {
        for (const num of match[1]!.matchAll(/-?\d+(?:\.\d+)?/g)) {
            expect(num[0]).toMatch(/^-?\d+(?:\.\d)?$/);
        }
    }

    for (const match of svg.matchAll(/\bpoints="([^"]+)"/g)) {
        for (const num of match[1]!.matchAll(/-?\d+(?:\.\d+)?/g)) {
            expect(num[0]).toMatch(/^-?\d+(?:\.\d)?$/);
        }
    }

    for (const match of svg.matchAll(/<text\b([^>]*)>/g)) {
        const attrs = match[1]!;
        const size = Number(attrs.match(/\bfont-size="([\d.]+)"/)![1]);
        expect(size).toBeGreaterThanOrEqual(11);
        expect(size).toBeLessThanOrEqual(13);
        expect(attrs).toContain('font-family="inherit"');
    }
}

describe('spectrumChart', () => {
    it('renders axes, round Y ticks, band, line, dots and features in back-to-front order', () => {
        const spec = makeSpectrum();
        const svg = spectrumChartSvg(spec, { markLambda: 2.5 });
        assertCleanSvg(svg);

        expect([...svg.matchAll(/<line data-axis=/g)]).toHaveLength(2);
        const xTickLabels = [...svg.matchAll(/<text data-x-tick-label="true"[^>]*>([^<]+)<\/text>/g)].map(m => m[1]);
        expect(xTickLabels).toEqual(['1', '2', '3', '4', '5']);
        expect(svg).toContain('>wavelength, µm</text>');
        expect(svg).toContain('>MJy/sr</text>');

        const yTicks = [...svg.matchAll(/<text data-y-tick-label="true"[^>]*>([^<]+)<\/text>/g)].map(m => Number(m[1]));
        expect(yTicks.length).toBeGreaterThanOrEqual(3);
        expect(yTicks.length).toBeLessThanOrEqual(4);
        const step = yTicks[1]! - yTicks[0]!;
        expect(step).toBeGreaterThan(0);
        const normStep = Number((step / (10 ** Math.floor(Math.log10(step) + 1e-12))).toPrecision(6));
        expect([1, 2, 2.5, 5]).toContain(normStep);

        expect([...svg.matchAll(/<polygon data-band="true"/g)]).toHaveLength(1);
        expect([...svg.matchAll(/<path data-line="true"/g)]).toHaveLength(1);
        expect([...svg.matchAll(/<circle data-dot="true"/g)]).toHaveLength(20);
        expect(svg).not.toContain('data-zero="true"');

        const orderTokens = [
            svg.indexOf('data-band="true"'),
            svg.indexOf('data-line="true"'),
            svg.indexOf('data-dot="true"'),
            svg.indexOf('data-feature-tick="true"'),
            svg.indexOf('data-mark-lambda="true"')
        ];
        for (const idx of orderTokens) {
            expect(idx).toBeGreaterThan(0);
        }
        expect(orderTokens).toEqual([...orderTokens].sort((a, b) => a - b));
    });

    it('reports exact counts, range, brightest channel, caption and notes in spectrumChartText', () => {
        const reasons: ('no data' | null)[] = Array.from({ length: 20 }, (_, i) => (i === 3 || i === 11 ? 'no data' : null));
        const spec = makeSpectrum({ reasons });
        const text = spectrumChartText(spec);

        expect(text.title).toBe('Spectrum at this spot, 0.75 to 5.00 µm');
        expect(text.summary).toBe('18 of 20 colours have data, from 0.75 to 5.00 µm. Brightest at 1.62 µm: 12.5 MJy/sr. 2 colours have no data.');
        expect(text.caption).toBe(spec.caption);
        expect(text.notes).toBe(spec.notes);
        expect(JSON.stringify(text)).not.toMatch(/\b(discover|detect|confirm|prove)\b/i);
        expect(JSON.stringify(text)).not.toMatch(/NaN|Infinity|undefined/);

        const svg = spectrumChartSvg(spec);
        expect(svg).toContain(`<title id="spectrum-Npix1234-255p5-128p5-title">${text.title}</title>`);
        expect(svg).toContain(`<desc id="spectrum-Npix1234-255p5-128p5-desc">${text.summary}</desc>`);
    });

    it('handles no valid channels (with wavelength range and with zero-length arrays)', () => {
        const allMasked = makeSpectrum({
            reasons: Array.from({ length: 20 }, () => 'no data')
        });
        const maskedText = spectrumChartText(allMasked);
        expect(maskedText.title).toBe('Spectrum at this spot, 0.75 to 5.00 µm');
        expect(maskedText.summary).toBe('No colours have data at this spot.');

        const maskedSvg = spectrumChartSvg(allMasked);
        assertCleanSvg(maskedSvg);
        expect([...maskedSvg.matchAll(/<line data-axis=/g)]).toHaveLength(2);
        expect(maskedSvg).toContain('>No data at this spot</text>');
        expect(maskedSvg).not.toContain('<path ');
        expect(maskedSvg).not.toContain('<circle ');

        const emptySpec = makeSpectrum({
            lambda: new Float64Array(0),
            surfaceBrightness: new Float32Array(0),
            noise: new Float32Array(0),
            reasons: [],
            background: new Float32Array(0)
        });
        const emptyText = spectrumChartText(emptySpec);
        expect(emptyText.title).toBe('Spectrum at this spot');
        expect(emptyText.summary).toBe('No colours have data at this spot.');

        const emptySvg = spectrumChartSvg(emptySpec);
        assertCleanSvg(emptySvg);
        expect(emptySvg).not.toContain('data-axis=');
        expect(emptySvg).toContain('>No data at this spot</text>');
    });

    it('renders one dot and no line when only one channel is valid', () => {
        const reasons: ('no data' | null)[] = Array.from({ length: 20 }, (_, i) => (i === 7 ? null : 'no data'));
        const singleInTwenty = makeSpectrum({ reasons });
        const svg = spectrumChartSvg(singleInTwenty);
        assertCleanSvg(svg);
        expect([...svg.matchAll(/<circle data-dot="true"/g)]).toHaveLength(1);
        expect([...svg.matchAll(/<path\b/g)]).toHaveLength(0);

        const oneElement = makeSpectrum({
            lambda: Float64Array.from([2.5]),
            surfaceBrightness: Float32Array.from([4.0]),
            noise: Float32Array.from([0.25]),
            reasons: [null]
        });
        const oneSvg = spectrumChartSvg(oneElement);
        assertCleanSvg(oneSvg);
        expect([...oneSvg.matchAll(/<circle data-dot="true"/g)]).toHaveLength(1);
        expect([...oneSvg.matchAll(/<path\b/g)]).toHaveLength(0);
    });

    it('breaks line paths across gaps so path count equals runs of 2 or more valid channels', () => {
        // Runs of valid channels: [0..4] (5), [6] (1, lone channel), [8..12] (5), [15..19] (5) -> 3 runs >= 2, 16 dots.
        const gaps = new Set([5, 7, 13, 14]);
        const reasons: ('no data' | null)[] = Array.from({ length: 20 }, (_, i) => (gaps.has(i) ? 'no data' : null));
        const spec = makeSpectrum({ reasons });
        const svg = spectrumChartSvg(spec);
        assertCleanSvg(svg);

        expect([...svg.matchAll(/<path data-line="true"/g)]).toHaveLength(3);
        expect([...svg.matchAll(/<polygon data-band="true"/g)]).toHaveLength(3);
        expect([...svg.matchAll(/<circle data-dot="true"/g)]).toHaveLength(16);
    });

    it('handles NaN, Infinity, negative values, bad noise, unequal array lengths, and bad dimensions', () => {
        const sb = Float32Array.from(VALUES_20);
        sb[0] = NaN;
        sb[1] = Infinity;
        sb[2] = -Infinity;
        sb[3] = -1.5; // valid negative value -> triggers zero line
        const lam = Float64Array.from(LAMBDAS_20);
        lam[4] = NaN;
        const noise = Float32Array.from({ length: 16 }, (_, i) => {
            if (i === 5) {
                return NaN;
            }
            if (i === 6) {
                return -3.0;
            }
            if (i === 7) {
                return Infinity;
            }
            return 0.4;
        });

        // Unequal lengths: lambda=20, surfaceBrightness=20, noise=16, reasons=18 -> shortest is 16.
        const spec = makeSpectrum({
            lambda: lam,
            surfaceBrightness: sb,
            noise,
            reasons: Array.from({ length: 18 }, () => null)
        });

        const text = spectrumChartText(spec);
        // Out of first 16 channels, indices 0, 1, 2, 4 are non-finite -> 12 valid of 16.
        expect(text.summary).toContain('12 of 16 colours have data');
        expect(text.summary).toContain('4 colours have no data.');
        expect(JSON.stringify(text)).not.toMatch(/NaN|Infinity|undefined/);

        const svg = spectrumChartSvg(spec);
        assertCleanSvg(svg);
        expect([...svg.matchAll(/<circle data-dot="true"/g)]).toHaveLength(12);
        expect(svg).toContain('data-zero="true"');

        // Zero line sits between dots and feature ticks in back-to-front order.
        expect(svg.indexOf('data-dot="true"')).toBeLessThan(svg.indexOf('data-zero="true"'));
        expect(svg.indexOf('data-zero="true"')).toBeLessThan(svg.indexOf('data-feature-tick="true"'));

        // Dimension clamping for NaN, negative and tiny values.
        const minSvg = spectrumChartSvg(spec, { width: 320, height: 180 });
        for (const bad of [
            { width: NaN, height: NaN },
            { width: -200, height: -50 },
            { width: 120, height: 90 },
            { width: Infinity, height: 0 }
        ]) {
            const clamped = spectrumChartSvg(spec, bad);
            assertCleanSvg(clamped);
            expect(clamped).toBe(minSvg);
        }
    });

    it('draws markLambda only when finite and inside the wavelength range', () => {
        const spec = makeSpectrum();

        const insideSvg = spectrumChartSvg(spec, { markLambda: 3.05 });
        assertCleanSvg(insideSvg);
        expect([...insideSvg.matchAll(/data-mark-lambda="true"/g)]).toHaveLength(1);
        expect(insideSvg).toContain('>showing now</text>');
        expect(insideSvg).toContain('var(--gold, #ffc861)');

        for (const badMark of [0.4, 5.5, NaN, Infinity, -Infinity]) {
            const outSvg = spectrumChartSvg(spec, { markLambda: badMark });
            assertCleanSvg(outSvg);
            expect(outSvg).not.toContain('data-mark-lambda="true"');
            expect(outSvg).not.toContain('showing now');
        }
    });

    it.each([320, 480, 720, 1080])('keeps feature labels non-overlapping at width %i and filters ticks to range', width => {
        const spec = makeSpectrum();
        const svg = spectrumChartSvg(spec, { width });
        assertCleanSvg(svg);

        const ticks = [...svg.matchAll(/<line data-feature-tick="true"/g)];
        expect(ticks).toHaveLength(LINES.length);

        const labels = [...svg.matchAll(/<text data-feature-label="true" x="([\d.]+)"[^>]*>([^<]+)<\/text>/g)].map(m => {
            const x = Number(m[1]);
            const text = m[2]!.replace(/&(?:amp|lt|gt|quot);/g, 'x');
            const half = (text.length * 6.2) / 2;
            return { x, text, left: x - half, right: x + half };
        });
        expect(labels.length).toBeGreaterThan(0);
        for (let i = 0; i < labels.length; i++) {
            const cur = labels[i]!;
            expect(cur.left).toBeGreaterThanOrEqual(0);
            expect(cur.right).toBeLessThanOrEqual(width);
            if (i > 0) {
                const prev = labels[i - 1]!;
                expect(prev.right).toBeLessThan(cur.left);
            }
        }

        // Narrow wavelength range [1.5, 3.5] should only include LINES inside [1.5, 3.5].
        const narrowLambdas = Array.from({ length: 20 }, (_, i) => 1.5 + (i / 19) * 2.0);
        const narrowSpec = makeSpectrum({ lambda: Float64Array.from(narrowLambdas) });
        const narrowSvg = spectrumChartSvg(narrowSpec, { width });
        assertCleanSvg(narrowSvg);
        const expectedInRange = LINES.filter(line => line.um >= 1.5 && line.um <= 3.5);
        expect([...narrowSvg.matchAll(/<line data-feature-tick="true"/g)]).toHaveLength(expectedInRange.length);
        for (const outLine of LINES.filter(line => line.um < 1.5 || line.um > 3.5)) {
            expect(narrowSvg).not.toContain(`>${outLine.label}</text>`);
        }
    });

    it('escapes XML special characters in unit and spot fields', () => {
        const spec = makeSpectrum({
            unit: '<b>&"',
            spot: {
                tile: 'Npix<9>&" NaN',
                url: 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/dr1/hips5_cube/test.fits',
                x: NaN,
                y: Infinity
            }
        });
        const svg = spectrumChartSvg(spec);
        assertCleanSvg(svg);
        expect(svg).toContain('&lt;b&gt;&amp;&quot;');
        expect(svg).not.toContain('<b>');
    });

    it('is deterministic and derives distinct accessible IDs from different spots', () => {
        const specA = makeSpectrum();
        const specB = makeSpectrum({
            spot: { ...specA.spot, tile: 'Npix9999', x: 12.0, y: 34.0 }
        });

        const first = spectrumChartSvg(specA, { width: 640, height: 240, markLambda: 2.2 });
        const second = spectrumChartSvg(specA, { width: 640, height: 240, markLambda: 2.2 });
        expect(first).toBe(second);

        const other = spectrumChartSvg(specB, { width: 640, height: 240, markLambda: 2.2 });
        const idA = first.match(/aria-labelledby="([^"]+)"/)![1];
        const idB = other.match(/aria-labelledby="([^"]+)"/)![1];
        expect(idA).not.toBe(idB);
    });

    it('maps and clamps wavelengths accurately in lambdaToX', () => {
        expect(lambdaToX(0.75, 64, 600, [0.75, 4.75])).toBe(64);
        expect(lambdaToX(4.75, 64, 600, [0.75, 4.75])).toBe(664);
        expect(lambdaToX(2.75, 64, 600, [0.75, 4.75])).toBeCloseTo(364);
        expect(lambdaToX(0.2, 64, 600, [0.75, 4.75])).toBe(64);
        expect(lambdaToX(9.9, 64, 600, [0.75, 4.75])).toBe(664);
        expect(lambdaToX(NaN, 64, 600, [0.75, 4.75])).toBe(64);
        expect(lambdaToX(Infinity, 64, 600, [0.75, 4.75])).toBe(664);
    });
});
