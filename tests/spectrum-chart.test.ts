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
        expect(svg).toContain(`>${text.title}</title>`);
        expect(svg).toContain(`>${text.summary}</desc>`);
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
            { width: -200, height: -50 },
            { width: 120, height: 90 }
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

function smallSpectrum(lambdas: number[], values = lambdas.map(() => 1), noise = values.map(() => 0)): CubeSpectrum
{
    return makeSpectrum({
        lambda: Float64Array.from(lambdas),
        surfaceBrightness: Float32Array.from(values),
        noise: Float32Array.from(noise),
        reasons: values.map(() => null)
    });
}

describe('spectrum chart regression cases', () => {
    it('terminates for huge and tiny wavelengths in a time-limited subprocess', async () => {
        const childProcessModule = 'node:child_process';
        const processModule = 'node:process';
        const { spawnSync } = await import(childProcessModule) as {
            spawnSync: (command: string, args: string[], options: { timeout: number; encoding: string }) => {
                error?: Error; status: number | null; stderr: string;
            };
        };
        const { execPath } = await import(processModule) as { execPath: string };
        const script = `
            const { stripTypeScriptTypes } = require('node:module');
            const fs = require('node:fs');
            let source = fs.readFileSync('src/lib/spectrum-chart.ts', 'utf8');
            source = source.replace(/^import .*from '\\.\\/cube';/m, 'const LINES = [];');
            source = source.replace(/export /g, '');
            const code = stripTypeScriptTypes(source);
            const render = new Function(code + '; return spectrumChartSvg;')();
            for (const lambda of [[1e16], [1e16, 2e16], [1e-9, 2e-9]]) {
                const spec = { lambda, surfaceBrightness: lambda.map(() => 1), noise: lambda.map(() => 0), reasons: lambda.map(() => null), spot: { tile: 't', x: 0, y: 0 }, unit: '', caption: '', notes: [] };
                const output = render(spec);
                if (/NaN|Infinity|undefined/.test(output)) { throw Error('unclean SVG'); }
            }
        `;
        const child = spawnSync(execPath, ['-e', script], { timeout: 3000, encoding: 'utf8' });
        expect(child.error?.message, child.stderr).toBeUndefined();
        expect(child.status, child.stderr).toBe(0);
    }, 5000);

    it.each([320, 720])('spaces X labels and retains enough ticks at width %i', width => {
        for (const range of [[0.75, 5], [100, 119], [0.75, 0.9], [1, 1000], [1.1, 2.1]]) {
            const spec = smallSpectrum(range);
            const svg = spectrumChartSvg(spec, { width });
            assertCleanSvg(svg);
            expect(JSON.stringify(spectrumChartText(spec))).not.toMatch(/NaN|Infinity|undefined/);
            const labels = [...svg.matchAll(/<text data-x-tick-label="true" x="([\d.]+)"[^>]*>([^<]+)<\/text>/g)]
                .map(match => ({ x: Number(match[1]), text: match[2]! }));
            expect(labels.length).toBeGreaterThanOrEqual(2);
            expect(labels.length).toBeLessThanOrEqual(12);
            for (let i = 1; i < labels.length; i++) {
                const prev = labels[i - 1]!;
                const next = labels[i]!;
                expect(next.x - prev.x + 0.01).toBeGreaterThanOrEqual((prev.text.length + next.text.length) * 6.2 / 2 + 8);
            }
            if (range[0] === 0.75 && range[1] === 5) {
                expect(labels.map(label => label.text)).toEqual(['1', '2', '3', '4', '5']);
            }
        }
    });

    it.each([[1.0000000001, 1.0000000002], [1e16, 1e16 + 2], [5, 5.000000001]].map(range => [range]))
    ('never prints the same X label twice for %j', range => {
        for (const width of [320, 720]) {
            const svg = spectrumChartSvg(smallSpectrum(range), { width });
            assertCleanSvg(svg);
            const labels = [...svg.matchAll(/<text data-x-tick-label="true"[^>]*>([^<]+)<\/text>/g)].map(m => m[1]);
            expect(new Set(labels).size).toBe(labels.length);
        }
    });

    it.each([[-5, -5], [3, 3, 3], [0, 0], [-2], [1e-12, 2e-12], [1e9, 2e9], [-5, 2]].map(values => [values]))
    ('keeps dots, lines and noise bands in bounds for %j', values => {
        for (const factor of [0, 0.1]) {
            const spec = smallSpectrum(values.map((_, index) => index + 1), values, values.map(value => Math.abs(value) * factor));
            const svg = spectrumChartSvg(spec);
            assertCleanSvg(svg);
            expect(JSON.stringify(spectrumChartText(spec))).not.toMatch(/NaN|Infinity|undefined/);
            const xs: number[] = [];
            const ys: number[] = [];
            for (const dot of svg.matchAll(/<circle data-dot="true" cx="([^"]+)" cy="([^"]+)"/g)) {
                xs.push(Number(dot[1]));
                ys.push(Number(dot[2]));
            }
            for (const line of svg.matchAll(/<path data-line="true" d="([^"]+)"/g)) {
                for (const point of line[1]!.matchAll(/[ML]([\d.]+) ([\d.]+)/g)) {
                    xs.push(Number(point[1]));
                    ys.push(Number(point[2]));
                }
            }
            for (const band of svg.matchAll(/<polygon data-band="true" points="([^"]+)"/g)) {
                for (const point of band[1]!.matchAll(/([\d.]+),([\d.]+)/g)) {
                    xs.push(Number(point[1]));
                    ys.push(Number(point[2]));
                }
            }
            expect(ys.length).toBeGreaterThanOrEqual(values.length);
            for (const x of xs) {
                expect(x).toBeGreaterThanOrEqual(64);
                expect(x).toBeLessThanOrEqual(700);
            }
            for (const y of ys) {
                expect(y).toBeGreaterThanOrEqual(36);
                expect(y).toBeLessThanOrEqual(222);
            }
        }
    });

    it('uses deterministic valid IDs with full spot precision', () => {
        const spot = { ...makeSpectrum().spot, tile: 'tile "< with spaces', x: 1.01, y: 2 };
        const id = (x: number): string => {
            const svg = spectrumChartSvg(makeSpectrum({ spot: { ...spot, x } }));
            assertCleanSvg(svg);
            return svg.match(/<title id="([^"]+)"/)![1]!;
        };
        expect(id(1.01)).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
        expect(id(1.01)).toBe(id(1.01));
        expect(id(1.01)).not.toBe(id(1.02));
    });

    it.each([[1e308, 4000, 3000], [Infinity, 720, 260], [-Infinity, 720, 260], [NaN, 720, 260], [0, 320, 180], [4001, 4000, 3000]])
    ('clamps or defaults dimensions for %s', (input, width, height) => {
        const spec = makeSpectrum();
        const svg = spectrumChartSvg(spec, { width: input, height: input });
        assertCleanSvg(svg);
        expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
        expect(JSON.stringify(spectrumChartText(spec))).not.toMatch(/NaN|Infinity|undefined/);
    });

    it('never emits negative rounded zero', () => {
        for (const spec of [smallSpectrum([-0.001]), smallSpectrum([0, 1], [-0.0001, -0.0001])]) {
            const output = spectrumChartSvg(spec, { markLambda: -0 }) + JSON.stringify(spectrumChartText(spec));
            assertCleanSvg(spectrumChartSvg(spec, { markLambda: -0 }));
            expect(output).not.toMatch(/-0(?:\.|\D|$)/);
            expect(output).not.toMatch(/NaN|Infinity|undefined/);
        }
    });

    it('keeps the normal fixture identical except for accessible IDs', () => {
        const svg = spectrumChartSvg(makeSpectrum(), { markLambda: 2.5 })
            .replace(/spectrum-[A-Za-z0-9_-]+-(title|desc)/g, 'spectrum-ID-$1');
        let hash = 2166136261;
        for (let i = 0; i < svg.length; i++) {
            hash = Math.imul(hash ^ svg.charCodeAt(i), 16777619);
        }
        expect(hash >>> 0).toBe(428219100);
    });
});
