import { colourAt, falseColourLegend, falseColourRgba, pairStretch, type ColourAt } from './falsecolour';
import { stackVisit } from './stack';
import { mjdToDate, type SkyResult } from './source';
import type { RegriddedFrame } from './types';

export class ColourGridError extends Error {}

// One second is our own tolerance for comparing frame time intervals, in MJD days.
const SAME_TIME_TOLERANCE_DAYS = 1 / 86400;
const MIN_COLOUR_SNR = 3;

function frameTimes(frames: RegriddedFrame[]): [number, number][]
{
    return frames.map(({ frame }) => [frame.tMin, frame.tMax] as [number, number])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function dates(times: [number, number][]): string
{
    if (times.length === 0 || times.some(([start, end]) => !Number.isFinite(start) || !Number.isFinite(end))) {
        return 'dates unavailable';
    }
    const days = [...new Set(times.map(([start, end]) => mjdToDate((start + end) / 2)))].sort();
    if (days.length === 1) {
        return days[0]!;
    }
    return days.length === 2 ? `${days[0]} and ${days[1]}` : `${days[0]} to ${days[days.length - 1]}`;
}

function sameTimes(a: [number, number][], b: [number, number][]): boolean
{
    return a.length === b.length && a.every((time, i) => time.every((t, j) =>
        Number.isFinite(t) && Number.isFinite(b[i]![j]) && Math.abs(t - b[i]![j]!) <= SAME_TIME_TOLERANCE_DAYS));
}

// One decimal below 10, whole numbers from 10 up. Rounded first, so 9.96 prints "10", not "10.0".
function snr(value: number): string
{
    const one = value.toFixed(1);
    return Number(one) < 10 ? one : value.toFixed(0);
}

// Two decimals with a sign. A value that rounds to zero prints "0.00", never "-0.00".
function signed(index: number): string
{
    const size = Math.abs(index).toFixed(2);
    if (Number(size) === 0) {
        return size;
    }
    return `${index > 0 ? '+' : '−'}${size}`;
}

export interface ColourParts {
    labels: string;
    note: string;
    warning: string;
    reading: string;
    method: string;
}

export function colourParts(lambdaShort: number, lambdaLong: number, reading: ColourAt, times?: [[number, number][], [number, number][]], incomplete: [boolean, boolean] = [false, false]): ColourParts
{
    const legend = falseColourLegend(lambdaShort, lambdaLong);
    const seenShort = !incomplete[0] && (reading.seen === 'short' || reading.seen === 'both');
    const seenLong = !incomplete[1] && (reading.seen === 'long' || reading.seen === 'both');
    reading = { ...reading, short: incomplete[0] ? NaN : reading.short, long: incomplete[1] ? NaN : reading.long,
        seen: seenShort && seenLong ? 'both' : seenShort ? 'short' : seenLong ? 'long' : 'neither',
        valid: reading.valid && !incomplete[0] && !incomplete[1] };
    let centre: string;
    let indexPrinted = false;
    if (!Number.isFinite(reading.short) || !Number.isFinite(reading.long)) {
        const finiteShort = Number.isFinite(reading.short);
        const finiteLong = Number.isFinite(reading.long);
        const reason = (band: number) => incomplete[band] ? 'some frames have blank pixels here' : 'blank pixels';
        if (finiteShort !== finiteLong) {
            const finiteLambda = finiteShort ? lambdaShort : lambdaLong;
            const blankLambda = finiteShort ? lambdaLong : lambdaShort;
            const seen = reading.seen === (finiteShort ? 'short' : 'long');
            const signal = seen ? `seen at ${finiteLambda.toFixed(2)} µm (signal-to-noise ${snr(finiteShort ? reading.snrShort : reading.snrLong)})`
                : `no clear signal at ${finiteLambda.toFixed(2)} µm (clear means at least ${MIN_COLOUR_SNR} times the noise)`;
            centre = `At the centre: ${signal}; ${blankLambda.toFixed(2)} µm cannot be measured here (${reason(finiteShort ? 1 : 0)}).`;
        } else if (incomplete[0] || incomplete[1]) {
            centre = `At the centre: ${lambdaShort.toFixed(2)} µm cannot be measured here (${reason(0)}); ${lambdaLong.toFixed(2)} µm cannot be measured here (${reason(1)}).`;
        } else {
            centre = 'At the centre: cannot be measured here (blank pixels).';
        }
    } else if (reading.seen === 'both' && reading.valid && Number.isFinite(reading.index)) {
        indexPrinted = true;
        centre = `At the centre: seen at both wavelengths, colour index ${signed(reading.index)} (signal-to-noise ${snr(reading.snrShort)} at ${lambdaShort.toFixed(2)} µm and ${snr(reading.snrLong)} at ${lambdaLong.toFixed(2)} µm).`;
    } else if (reading.seen === 'short' || reading.seen === 'long') {
        const isShort = reading.seen === 'short';
        const seen = isShort ? lambdaShort : lambdaLong;
        const other = isShort ? lambdaLong : lambdaShort;
        centre = `At the centre: seen at ${seen.toFixed(2)} µm only (signal-to-noise ${snr(isShort ? reading.snrShort : reading.snrLong)}); no clear signal at ${other.toFixed(2)} µm (clear means at least ${MIN_COLOUR_SNR} times the noise).`;
    } else {
        centre = `At the centre: no clear signal at either wavelength (clear means at least ${MIN_COLOUR_SNR} times the noise).`;
    }
    const band = (label: string, entries: [number, number][]) => `${label}, ${entries.length} ${entries.length === 1 ? 'frame' : 'frames'}, ${dates(entries)}.`;
    const labels = times ? `${band(legend.blue, times[0])} ${band(legend.red, times[1])}` : `${legend.blue}. ${legend.red}.`;
    const missingTimes = times?.some(entries => entries.length === 0 || entries.some(time => time.some(t => !Number.isFinite(t))));
    const warning = missingTimes ? 'The frame dates are unavailable, so the two colours may have been taken at different times.'
        : times && !sameTimes(times[0], times[1])
            ? 'The two colours were not taken at the same times, so anything that moved or changed in between shows a false tint.' : '';
    const indexMethod = indexPrinted ? 'The colour index is (long − short) / (long + short) of the two brightness sums. ' : '';
    return { labels, note: legend.note, warning, reading: centre, method: `${indexMethod}The reading adds up a small circle of pixels and takes off the sky just around it, so it need not match the tint of the middle pixels.` };
}

export function colourSentence(lambdaShort: number, lambdaLong: number, reading: ColourAt, times?: [[number, number][], [number, number][]], incomplete: [boolean, boolean] = [false, false]): string
{
    return Object.values(colourParts(lambdaShort, lambdaLong, reading, times, incomplete)).filter(Boolean).join(' ');
}

function coverage(frames: RegriddedFrame[], width: number, height: number, radius: number, annulusIn: number, annulusOut: number): { covered: RegriddedFrame[]; partial: boolean }
{
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const counts = frames.map(() => 0);
    let measured = 0;
    for (let y = Math.max(0, Math.ceil(cy - annulusOut)); y <= Math.min(height - 1, Math.floor(cy + annulusOut)); y++) {
        for (let x = Math.max(0, Math.ceil(cx - annulusOut)); x <= Math.min(width - 1, Math.floor(cx + annulusOut)); x++) {
            const d = (x - cx) ** 2 + (y - cy) ** 2;
            if (!(d <= radius ** 2 || (d >= annulusIn ** 2 && d <= annulusOut ** 2))) {
                continue;
            }
            const present = frames.map(frame => Number.isFinite(frame.data[y * width + x]));
            if (present.some(Boolean)) {
                measured++;
                present.forEach((finite, i) => { if (finite) { counts[i]!++; } });
            }
        }
    }
    return { covered: measured ? frames.filter((_, i) => counts[i] === measured) : [],
        partial: counts.some(count => count > 0 && count < measured) };
}

export function falseColourView(a: SkyResult, b: SkyResult, radii: { radius: number; annulusIn: number; annulusOut: number }): { rgba: Uint8ClampedArray; width: number; height: number; sentence: string; parts: ColourParts }
{
    const grid = a.grid;
    const grids = [b.grid, ...a.frames.map(item => item.frame.grid), ...b.frames.map(item => item.frame.grid)];
    if (grids.some(other => grid.width !== other.width || grid.height !== other.height || grid.pixelArcsec !== other.pixelArcsec
        || grid.center.ra !== other.center.ra || grid.center.dec !== other.center.dec)) {
        throw new ColourGridError();
    }
    const bands = [a, b].map(result => {
        const frames = result.frames.map(item => item.frame);
        const { covered, partial } = coverage(frames, grid.width, grid.height, radii.radius, radii.annulusIn, radii.annulusOut);
        const wavelengths = !partial && covered.length ? covered : frames;
        const lambda = wavelengths.reduce((sum, frame) => sum + frame.lambdaAtCenter, 0) / wavelengths.length;
        const { data } = stackVisit(frames, { clipSigma: Infinity, background: 'none' });
        return { lambda, data, partial, times: frameTimes(wavelengths) };
    }).sort((x, y) => x.lambda - y.lambda);
    const short = bands[0]!;
    const long = bands[1]!;
    const stretch = pairStretch(short.data, long.data);
    const rgba = falseColourRgba(short.data, long.data, stretch.sShort, stretch.sLong);
    const reading = colourAt(short.data, long.data, grid.width, grid.height,
        { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 }, { pixelArcsec: grid.pixelArcsec, ...radii, minSnr: MIN_COLOUR_SNR });
    const incomplete: [boolean, boolean] = [Number.isFinite(reading.short) && short.partial, Number.isFinite(reading.long) && long.partial];
    const parts = colourParts(short.lambda, long.lambda, reading, [short.times, long.times], incomplete);
    return { rgba, width: grid.width, height: grid.height, parts, sentence: Object.values(parts).filter(Boolean).join(' ') };
}
