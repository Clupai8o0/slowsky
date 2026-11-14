import { LINES, type CubeSpectrum } from './cube';

export interface SpectrumChartOptions {
    width?: number;
    height?: number;
    markLambda?: number;
}

const DEFAULT_WIDTH = 720;
const MIN_WIDTH = 320;
const MAX_WIDTH = 4000;
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 3000;

const PLOT_LEFT = 64;
const PLOT_RIGHT_MARGIN = 20;
const PLOT_TOP = 36;
const PLOT_BOTTOM_MARGIN = 38;

const CHAR_WIDTH_PX = 6.2;
const LABEL_GAP_PX = 4;

const INK = 'var(--ink, #eef1f6)';
const MUTE = 'var(--mute, #9aa1b1)';
const GOLD = 'var(--gold, #ffc861)';

interface ValidChannel {
    index: number;
    lambda: number;
    value: number;
    noise: number;
}

interface AnalyzedSpectrum {
    totalCount: number;
    valid: ValidChannel[];
    runs: ValidChannel[][];
    lambdaRange: [number, number] | null;
}

interface YAxis {
    min: number;
    max: number;
    ticks: number[];
}

function round1(value: number): number
{
    if (!Number.isFinite(value)) {
        return 0;
    }
    const rounded = Math.round(value * 10) / 10;
    return rounded === 0 ? 0 : rounded;
}

function fmt(value: number): string
{
    const rounded = round1(value);
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function escapeXml(value: string): string
{
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizeDimension(requested: number | undefined, fallback: number, minimum: number, maximum: number): number
{
    if (requested === undefined || !Number.isFinite(requested)) {
        return fallback;
    }
    return round1(Math.max(minimum, Math.min(maximum, requested)));
}

function spotIdPrefix(spot: CubeSpectrum['spot']): string
{
    const encode = (value: string): string => {
        let encoded = '';
        for (let i = 0; i < value.length; i++) {
            encoded += value.charCodeAt(i).toString(16).padStart(4, '0');
        }
        return encoded;
    };
    const coord = (value: number | undefined): string => Object.is(value, -0) ? '-0' : String(value);
    return `spectrum-${encode(typeof spot?.tile === 'string' ? spot.tile : '')}-${encode(coord(spot?.x))}-${encode(coord(spot?.y))}`;
}

export function formatNumber(value: number, style: 'fixed' | 'significant' | 'tick'): string
{
    if (Object.is(value, -0)) { return '0'; }
    let result: string;
    if (style === 'fixed') {
        result = value.toFixed(2);
    } else if (style === 'significant') {
        result = Math.abs(value) >= 1000 && Math.abs(value) < 1e6
            ? String(Number(value.toPrecision(3))) : value.toPrecision(3);
    } else if (value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)) {
        result = value.toExponential().replace(/\.?0+e/, 'e').replace('e+', 'e');
    } else {
        result = String(Number(value.toPrecision(10)));
    }
    if (Number(result) === 0 && result.startsWith('-')) {
        return '0';
    }
    return result;
}

function formatSigFigs3(value: number): string
{
    return formatNumber(value, 'significant');
}

function formatTickLabel(tick: number): string
{
    return formatNumber(tick, 'tick');
}

function xTicks(min: number, max: number, width: number): number[]
{
    if (min === max) {
        return Number.isInteger(min) ? [min] : [];
    }
    const span = max - min;
    if (!Number.isFinite(span) || span <= 0) {
        return [];
    }
    const initialExp = span >= 1 ? Math.max(0, Math.floor(Math.log10(span)) - 2) : Math.floor(Math.log10(span)) - 2;
    const exponents = Array.from({ length: 6 }, (_, i) => initialExp + i);
    if (span >= 1 && initialExp === 0) {
        exponents.push(-2, -1);
    }
    for (const exp of exponents) {
        for (const factor of [1, 2, 5]) {
            const step = factor * 10 ** exp;
            if (!Number.isFinite(step) || step <= 0) {
                continue;
            }
            const first = Math.ceil(min / step - 1e-10);
            const last = Math.floor(max / step + 1e-10);
            const count = last - first + 1;
            if (!Number.isFinite(count) || count < 2 || count > 12) {
                continue;
            }
            const ticks: number[] = [];
            let fits = true;
            for (let i = 0; i < count; i++) {
                const tick = Number(((first + i) * step).toPrecision(15));
                const previous = ticks[ticks.length - 1];
                if (previous !== undefined) {
                    // Reject duplicate labels and try a coarser step.
                    if (tick <= previous || formatTickLabel(tick) === formatTickLabel(previous)) {
                        fits = false;
                        break;
                    }
                    const gap = (lambdaToX(tick, 0, width, [min, max]) - lambdaToX(previous, 0, width, [min, max]));
                    const labelWidth = (formatTickLabel(tick).length + formatTickLabel(previous).length) * CHAR_WIDTH_PX / 2;
                    if (gap < labelWidth + 8.1) {
                        fits = false;
                        break;
                    }
                }
                ticks.push(tick);
            }
            if (fits && ticks.length >= 2) {
                return ticks;
            }
        }
    }
    return [];
}

function analyzeSpectrum(spec: CubeSpectrum): AnalyzedSpectrum
{
    const totalCount = Math.min(
        spec.lambda.length,
        spec.surfaceBrightness.length,
        spec.noise.length,
        spec.reasons.length
    );
    const valid: ValidChannel[] = [];
    const runs: ValidChannel[][] = [];
    let currentRun: ValidChannel[] = [];
    let minLambda = Infinity;
    let maxLambda = -Infinity;

    for (let i = 0; i < totalCount; i++) {
        const lam = spec.lambda[i];
        const val = spec.surfaceBrightness[i];
        const rawNoise = spec.noise[i];
        const reason = spec.reasons[i];

        if (typeof lam === 'number' && Number.isFinite(lam)) {
            if (lam < minLambda) {
                minLambda = lam;
            }
            if (lam > maxLambda) {
                maxLambda = lam;
            }
        }

        if (reason === null && typeof lam === 'number' && Number.isFinite(lam)
            && typeof val === 'number' && Number.isFinite(val)) {
            const effNoise = typeof rawNoise === 'number' && Number.isFinite(rawNoise) && rawNoise >= 0
                ? rawNoise
                : 0;
            const channel: ValidChannel = { index: i, lambda: lam, value: val, noise: effNoise };
            valid.push(channel);
            currentRun.push(channel);
        } else if (currentRun.length > 0) {
            runs.push(currentRun);
            currentRun = [];
        }
    }
    if (currentRun.length > 0) {
        runs.push(currentRun);
    }

    const lambdaRange: [number, number] | null = minLambda <= maxLambda ? [minLambda, maxLambda] : null;
    return { totalCount, valid, runs, lambdaRange };
}

function stepValue(mantissa: number, exp: number): number
{
    return exp >= 0 ? mantissa * (10 ** exp) : mantissa / (10 ** (-exp));
}

function tickAtIndex(index: number, mantissa: number, exp: number): number
{
    if (index === 0) {
        return 0;
    }
    const raw = exp >= 0 ? index * mantissa * (10 ** exp) : (index * mantissa) / (10 ** (-exp));
    return Number(raw.toPrecision(12));
}

function ticksInBounds(yMin: number, yMax: number, mantissa: number, exp: number): {
    ticks: number[];
    firstIndex: number;
    lastIndex: number;
}
{
    const step = stepValue(mantissa, exp);
    if (!Number.isFinite(step) || step <= 0) {
        return { ticks: [], firstIndex: 0, lastIndex: -1 };
    }
    const eps = 1e-9 * step;
    const firstIndex = Math.ceil((yMin - eps) / step);
    const lastIndex = Math.floor((yMax + eps) / step);
    if (!Number.isFinite(firstIndex) || !Number.isFinite(lastIndex)
        || lastIndex < firstIndex || lastIndex - firstIndex > 20) {
        return { ticks: [], firstIndex: 0, lastIndex: -1 };
    }
    const ticks: number[] = [];
    for (let offset = 0; offset <= lastIndex - firstIndex; offset++) {
        const idx = firstIndex + offset;
        if (offset > 0 && idx <= firstIndex + offset - 1) {
            break;
        }
        ticks.push(tickAtIndex(idx, mantissa, exp));
    }
    return { ticks, firstIndex, lastIndex };
}

function computeYAxis(valid: ValidChannel[]): YAxis
{
    let minLow = Infinity;
    let maxHigh = -Infinity;
    for (const channel of valid) {
        const low = channel.value - channel.noise;
        const high = channel.value + channel.noise;
        if (low < minLow) {
            minLow = low;
        }
        if (high > maxHigh) {
            maxHigh = high;
        }
    }

    if (minLow === maxHigh) {
        const padding = minLow === 0 ? 1 : Math.abs(minLow) * 0.05;
        minLow -= padding;
        maxHigh += padding;
    }
    const rawMin = Math.min(0, minLow);
    const rawMax = Math.max(0, maxHigh);
    const span = rawMax - rawMin;
    if (!Number.isFinite(span) || span <= 0) {
        return { min: 0, max: 1, ticks: [0, 0.5, 1] };
    }

    let yMin = rawMin < 0 ? rawMin - 0.05 * span : 0;
    let yMax = rawMax + 0.05 * span;
    const paddedSpan = yMax - yMin;
    if (!Number.isFinite(paddedSpan) || paddedSpan <= 0) {
        return { min: 0, max: 1, ticks: [0, 0.5, 1] };
    }

    const baseExp = Math.floor(Math.log10(paddedSpan));
    const mantissas = [1, 2, 2.5, 5];
    let bestTicks: number[] | null = null;
    let bestScore = -Infinity;
    let bestTwo: {
        ticks: number[];
        firstIndex: number;
        lastIndex: number;
        mantissa: number;
        exp: number;
        extra: number;
    } | null = null;

    for (let exp = baseExp - 2; exp <= baseExp + 1; exp++) {
        for (const mantissa of mantissas) {
            const candidate = ticksInBounds(yMin, yMax, mantissa, exp);
            const count = candidate.ticks.length;
            if (count === 3 || count === 4) {
                const coverage = (candidate.ticks[count - 1]! - candidate.ticks[0]!) / paddedSpan;
                const score = (count === 4 ? 0.15 : 0) + coverage;
                if (score > bestScore) {
                    bestScore = score;
                    bestTicks = candidate.ticks;
                }
            } else if (count === 2) {
                const lowNext = tickAtIndex(candidate.firstIndex - 1, mantissa, exp);
                const highNext = tickAtIndex(candidate.lastIndex + 1, mantissa, exp);
                const extra = Math.min(highNext - yMax, yMin < 0 ? yMin - lowNext : Infinity);
                if (bestTwo === null || extra < bestTwo.extra) {
                    bestTwo = { ...candidate, mantissa, exp, extra };
                }
            }
        }
    }

    if (bestTicks !== null) {
        return { min: yMin, max: yMax, ticks: bestTicks };
    }

    if (bestTwo !== null) {
        const lowNext = tickAtIndex(bestTwo.firstIndex - 1, bestTwo.mantissa, bestTwo.exp);
        const highNext = tickAtIndex(bestTwo.lastIndex + 1, bestTwo.mantissa, bestTwo.exp);
        const canExtendDown = yMin < 0;
        const downExtra = yMin - lowNext;
        const upExtra = highNext - yMax;
        if (!canExtendDown || upExtra <= downExtra) {
            yMax = highNext;
            return { min: yMin, max: yMax, ticks: [...bestTwo.ticks, highNext] };
        }
        yMin = lowNext;
        return { min: yMin, max: yMax, ticks: [lowNext, ...bestTwo.ticks] };
    }

    const mid = yMin + paddedSpan / 2;
    return { min: yMin, max: yMax, ticks: [round1(yMin), round1(mid), round1(yMax)] };
}

export function lambdaToX(lambda: number, plotLeft: number, plotWidth: number, range: [number, number]): number
{
    const left = typeof plotLeft === 'number' && Number.isFinite(plotLeft) ? plotLeft : 0;
    const width = typeof plotWidth === 'number' && Number.isFinite(plotWidth) && plotWidth > 0 ? plotWidth : 0;
    const [lo, hi] = range;
    if (typeof lo !== 'number' || typeof hi !== 'number' || !Number.isFinite(lo) || !Number.isFinite(hi)) {
        return left;
    }
    if (lambda === Infinity) {
        return left + width;
    }
    if (typeof lambda !== 'number' || !Number.isFinite(lambda)) {
        return left;
    }
    if (hi <= lo) {
        if (lambda < lo) {
            return left;
        }
        if (lambda > lo) {
            return left + width;
        }
        return left + width / 2;
    }
    const t = (lambda - lo) / (hi - lo);
    const clamped = Math.max(0, Math.min(1, t));
    return left + clamped * width;
}

export function spectrumChartText(spec: CubeSpectrum): {
    title: string;
    summary: string;
    caption: string;
    notes: string[];
}
{
    const { totalCount, valid, lambdaRange } = analyzeSpectrum(spec);
    const caption = typeof spec.caption === 'string' ? spec.caption : '';
    const notes = Array.isArray(spec.notes) ? spec.notes : [];
    const title = lambdaRange !== null
        ? `Spectrum at this spot, ${formatNumber(lambdaRange[0], 'fixed')} to ${formatNumber(lambdaRange[1], 'fixed')} µm`
        : 'Spectrum at this spot';

    if (valid.length === 0 || lambdaRange === null) {
        return {
            title,
            summary: 'No colours have data at this spot.',
            caption,
            notes
        };
    }

    let brightest = valid[0]!;
    for (let i = 1; i < valid.length; i++) {
        const candidate = valid[i]!;
        if (candidate.value > brightest.value) {
            brightest = candidate;
        }
    }

    const validCount = valid.length;
    const noDataCount = totalCount - validCount;
    const unitRaw = typeof spec.unit === 'string' ? spec.unit.trim() : '';
    const unitPart = unitRaw.length > 0 ? ` ${unitRaw}` : '';
    const first = Math.min(...valid.map(channel => channel.lambda));
    const last = Math.max(...valid.map(channel => channel.lambda));
    const range = validCount === 1 ? `at ${formatNumber(first, 'fixed')}` : `from ${formatNumber(first, 'fixed')} to ${formatNumber(last, 'fixed')}`;
    const countPhrase = `${validCount} of ${totalCount} ${totalCount === 1 ? 'colour' : 'colours'} ${validCount === 1 ? 'has' : 'have'} data, ${range} µm.`;
    const brightestPhrase = `Highest value at ${formatNumber(brightest.lambda, 'fixed')} µm: ${formatSigFigs3(brightest.value)}${unitPart}.`;
    const noDataPhrase = noDataCount > 0
        ? ` ${noDataCount} ${noDataCount === 1 ? 'colour has' : 'colours have'} no data.`
        : '';

    return {
        title,
        summary: `${countPhrase} ${brightestPhrase}${noDataPhrase}`,
        caption,
        notes
    };
}

export function spectrumChartSvg(spec: CubeSpectrum, opts: SpectrumChartOptions = {}): string
{
    const width = normalizeDimension(opts.width, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
    const height = normalizeDimension(opts.height, DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT);
    const plotLeft = PLOT_LEFT;
    const plotRight = width - PLOT_RIGHT_MARGIN;
    const plotWidth = plotRight - plotLeft;
    const plotTop = PLOT_TOP;
    const plotBottom = height - PLOT_BOTTOM_MARGIN;
    const plotHeight = plotBottom - plotTop;

    const text = spectrumChartText(spec);
    const idPrefix = spotIdPrefix(spec.spot);
    const titleId = `${idPrefix}-title`;
    const descId = `${idPrefix}-desc`;
    const unitText = typeof spec.unit === 'string' ? spec.unit : '';

    const { valid, runs, lambdaRange } = analyzeSpectrum(spec);

    if (lambdaRange === null) {
        return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${titleId} ${descId}" viewBox="0 0 ${fmt(width)} ${fmt(height)}" font-family="inherit"><title id="${titleId}">${escapeXml(text.title)}</title><desc id="${descId}">${escapeXml(text.summary)}</desc><text x="${fmt(width / 2)}" y="${fmt(height / 2)}" text-anchor="middle" dominant-baseline="middle" fill="${MUTE}" font-size="13" font-family="inherit">No data at this spot</text></svg>`;
    }

    const [xMin, xMax] = lambdaRange;
    const xAxisParts: string[] = [];
    for (const m of xTicks(xMin, xMax, plotWidth)) {
        const tx = round1(lambdaToX(m, plotLeft, plotWidth, lambdaRange));
        xAxisParts.push(`<line data-x-tick="true" x1="${fmt(tx)}" y1="${fmt(plotBottom)}" x2="${fmt(tx)}" y2="${fmt(plotBottom + 5)}" stroke="${MUTE}" stroke-width="1"/>`);
        xAxisParts.push(`<text data-x-tick-label="true" x="${fmt(tx)}" y="${fmt(plotBottom + 17)}" text-anchor="middle" fill="${MUTE}" font-size="11" font-family="inherit">${formatTickLabel(m)}</text>`);
    }
    xAxisParts.push(`<text data-axis-title="x" x="${fmt(plotLeft + plotWidth / 2)}" y="${fmt(plotBottom + 33)}" text-anchor="middle" fill="${MUTE}" font-size="12" font-family="inherit">wavelength, µm</text>`);

    const yTitleMid = fmt(plotTop + plotHeight / 2);
    const yTitleSvg = unitText.length > 0
        ? `<text data-axis-title="y" x="14" y="${yTitleMid}" text-anchor="middle" transform="rotate(-90 14 ${yTitleMid})" fill="${MUTE}" font-size="12" font-family="inherit">${escapeXml(unitText)}</text>`
        : '';

    const axisLines = `<line data-axis="y" x1="${fmt(plotLeft)}" y1="${fmt(plotTop)}" x2="${fmt(plotLeft)}" y2="${fmt(plotBottom)}" stroke="${MUTE}" stroke-width="1"/><line data-axis="x" x1="${fmt(plotLeft)}" y1="${fmt(plotBottom)}" x2="${fmt(plotRight)}" y2="${fmt(plotBottom)}" stroke="${MUTE}" stroke-width="1"/>`;

    if (valid.length === 0) {
        const emptyText = `<text x="${fmt(plotLeft + plotWidth / 2)}" y="${fmt(plotTop + plotHeight / 2)}" text-anchor="middle" dominant-baseline="middle" fill="${MUTE}" font-size="13" font-family="inherit">No data at this spot</text>`;
        return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${titleId} ${descId}" viewBox="0 0 ${fmt(width)} ${fmt(height)}" font-family="inherit"><title id="${titleId}">${escapeXml(text.title)}</title><desc id="${descId}">${escapeXml(text.summary)}</desc>${axisLines}${xAxisParts.join('')}${yTitleSvg}${emptyText}</svg>`;
    }

    const yAxis = computeYAxis(valid);
    const ySpan = yAxis.max - yAxis.min;
    const yFor = (val: number): number => {
        if (!Number.isFinite(val) || ySpan <= 0) {
            return plotBottom;
        }
        return plotBottom - ((val - yAxis.min) / ySpan) * plotHeight;
    };

    const yAxisParts: string[] = [];
    for (const tick of yAxis.ticks) {
        const ty = round1(yFor(tick));
        yAxisParts.push(`<line data-y-tick="true" x1="${fmt(plotLeft - 5)}" y1="${fmt(ty)}" x2="${fmt(plotLeft)}" y2="${fmt(ty)}" stroke="${MUTE}" stroke-width="1"/>`);
        yAxisParts.push(`<text data-y-tick-label="true" x="${fmt(plotLeft - 8)}" y="${fmt(ty)}" text-anchor="end" dominant-baseline="middle" fill="${MUTE}" font-size="11" font-family="inherit">${formatTickLabel(tick)}</text>`);
    }

    // 1. Noise band: one filled shape per run of valid channels.
    const bandParts: string[] = [];
    for (const run of runs) {
        if (run.length >= 2 && run.some(ch => ch.noise > 0)) {
            const upper = run.map(ch => {
                const px = lambdaToX(ch.lambda, plotLeft, plotWidth, lambdaRange);
                const py = yFor(ch.value + ch.noise);
                return `${fmt(px)},${fmt(py)}`;
            });
            const lower: string[] = [];
            for (let i = run.length - 1; i >= 0; i--) {
                const ch = run[i]!;
                const px = lambdaToX(ch.lambda, plotLeft, plotWidth, lambdaRange);
                const py = yFor(ch.value - ch.noise);
                lower.push(`${fmt(px)},${fmt(py)}`);
            }
            bandParts.push(`<polygon data-band="true" points="${upper.concat(lower).join(' ')}" fill="${INK}" fill-opacity="0.18"/>`);
        }
    }

    // 2. Line: breaks at every no-data channel.
    const lineParts: string[] = [];
    for (const run of runs) {
        if (run.length >= 2) {
            const d = run.map((ch, idx) => {
                const px = lambdaToX(ch.lambda, plotLeft, plotWidth, lambdaRange);
                const py = yFor(ch.value);
                return `${idx === 0 ? 'M' : 'L'}${fmt(px)} ${fmt(py)}`;
            }).join(' ');
            lineParts.push(`<path data-line="true" d="${d}" fill="none" stroke="${INK}" stroke-width="1.25"/>`);
        }
    }

    // 3. Dots: one per valid channel.
    const dotParts: string[] = [];
    for (const ch of valid) {
        const px = lambdaToX(ch.lambda, plotLeft, plotWidth, lambdaRange);
        const py = yFor(ch.value);
        dotParts.push(`<circle data-dot="true" cx="${fmt(px)}" cy="${fmt(py)}" r="1.6" fill="${INK}"/>`);
    }

    // 4. Zero line, only when the Y range goes below zero.
    const zeroLineSvg = yAxis.min < 0 && yAxis.max > 0
        ? `<line data-zero="true" x1="${fmt(plotLeft)}" y1="${fmt(yFor(0))}" x2="${fmt(plotRight)}" y2="${fmt(yFor(0))}" stroke="${MUTE}" stroke-width="1"/>`
        : '';

    // 5. Feature ticks and non-overlapping labels.
    const featureParts: string[] = [];
    let lastFeatureRight = -Infinity;
    for (const feature of LINES) {
        if (feature.um >= xMin && feature.um <= xMax) {
            const tickX = round1(lambdaToX(feature.um, plotLeft, plotWidth, lambdaRange));
            const estWidth = feature.label.length * CHAR_WIDTH_PX;
            const minCenter = estWidth / 2 + 2;
            const maxCenter = width - estWidth / 2 - 2;
            if (minCenter <= maxCenter) {
                const labelX = round1(Math.max(minCenter, Math.min(maxCenter, tickX)));
                const leftEdge = labelX - estWidth / 2;
                const rightEdge = labelX + estWidth / 2;
                if (leftEdge >= 0 && rightEdge <= width && leftEdge >= lastFeatureRight + LABEL_GAP_PX) {
                    featureParts.push(`<line data-feature-tick="true" x1="${fmt(tickX)}" y1="${fmt(plotTop - 5)}" x2="${fmt(tickX)}" y2="${fmt(plotTop)}" stroke="${MUTE}" stroke-width="1"/>`);
                    featureParts.push(`<text data-feature-label="true" x="${fmt(labelX)}" y="${fmt(plotTop - 8)}" text-anchor="middle" fill="${MUTE}" font-size="11" font-family="inherit">${escapeXml(feature.label)}</text>`);
                    lastFeatureRight = rightEdge;
                }
            }
        }
    }

    // 6. Active wavelength marker when finite and inside the X range.
    let markSvg = '';
    if (typeof opts.markLambda === 'number' && Number.isFinite(opts.markLambda)
        && opts.markLambda >= xMin && opts.markLambda <= xMax) {
        const markX = round1(lambdaToX(opts.markLambda, plotLeft, plotWidth, lambdaRange));
        const markLabel = 'showing now';
        const markEstWidth = markLabel.length * CHAR_WIDTH_PX;
        const markLabelX = round1(Math.max(markEstWidth / 2 + 2, Math.min(width - markEstWidth / 2 - 2, markX)));
        markSvg = `<line data-mark-lambda="true" x1="${fmt(markX)}" y1="${fmt(plotTop)}" x2="${fmt(markX)}" y2="${fmt(plotBottom)}" stroke="${GOLD}" stroke-width="1.2"/><text data-mark-label="true" x="${fmt(markLabelX)}" y="13" text-anchor="middle" fill="${GOLD}" font-size="11" font-family="inherit">${markLabel}</text>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${titleId} ${descId}" viewBox="0 0 ${fmt(width)} ${fmt(height)}" font-family="inherit"><title id="${titleId}">${escapeXml(text.title)}</title><desc id="${descId}">${escapeXml(text.summary)}</desc>${axisLines}${xAxisParts.join('')}${yAxisParts.join('')}${yTitleSvg}${bandParts.join('')}${lineParts.join('')}${dotParts.join('')}${zeroLineSvg}${featureParts.join('')}${markSvg}</svg>`;
}
