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
    if (times.some(([start, end]) => !Number.isFinite(start) || !Number.isFinite(end))) {
        return 'dates unavailable';
    }
    const start = mjdToDate(Math.min(...times.map(time => time[0])));
    const end = mjdToDate(Math.max(...times.map(time => time[1])));
    return start === end ? start : `${start} to ${end}`;
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

export function colourSentence(lambdaShort: number, lambdaLong: number, reading: ColourAt, times?: [[number, number][], [number, number][]]): string
{
    const legend = falseColourLegend(lambdaShort, lambdaLong);
    let centre: string;
    if (!Number.isFinite(reading.short) || !Number.isFinite(reading.long)) {
        if (reading.seen === 'short' && Number.isFinite(reading.short) && !Number.isFinite(reading.long)) {
            centre = `At the centre: seen at ${lambdaShort.toFixed(2)} µm only (signal-to-noise ${snr(reading.snrShort)}); ${lambdaLong.toFixed(2)} µm cannot be measured here (blank pixels).`;
        } else if (reading.seen === 'long' && Number.isFinite(reading.long) && !Number.isFinite(reading.short)) {
            centre = `At the centre: seen at ${lambdaLong.toFixed(2)} µm only (signal-to-noise ${snr(reading.snrLong)}); ${lambdaShort.toFixed(2)} µm cannot be measured here (blank pixels).`;
        } else {
            centre = 'At the centre: cannot be measured here (blank pixels).';
        }
    } else if (reading.seen === 'both' && reading.valid && Number.isFinite(reading.index)) {
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
    const missingTimes = times?.some(entries => entries.some(time => time.some(t => !Number.isFinite(t))));
    const warning = missingTimes ? ' The frame dates are unavailable, so the two colours may have been taken at different times.'
        : times && !sameTimes(times[0], times[1])
            ? ' The two colours were not taken at the same times, so anything that moved or changed in between shows a false tint.' : '';
    return `${labels} ${legend.note}${warning} The colour index is (long − short) / (long + short) of the two brightness sums. The reading adds up a small circle of pixels and takes off the sky just around it, so it need not match the tint of the middle pixels. ${centre}`;
}

export function falseColourView(a: SkyResult, b: SkyResult, radii: { radius: number; annulusIn: number; annulusOut: number }): { rgba: Uint8ClampedArray; width: number; height: number; sentence: string }
{
    const grid = a.grid;
    const grids = [b.grid, ...a.frames.map(item => item.frame.grid), ...b.frames.map(item => item.frame.grid)];
    if (grids.some(other => grid.width !== other.width || grid.height !== other.height || grid.pixelArcsec !== other.pixelArcsec
        || grid.center.ra !== other.center.ra || grid.center.dec !== other.center.dec)) {
        throw new ColourGridError();
    }
    const bands = [a, b].map(result => {
        const frames = result.frames.map(item => item.frame);
        const centre = Math.floor(grid.height / 2) * grid.width + Math.floor(grid.width / 2);
        const covered = frames.filter(frame => Number.isFinite(frame.data[centre]));
        const wavelengths = covered.length ? covered : frames;
        const lambda = wavelengths.reduce((sum, frame) => sum + frame.lambdaAtCenter, 0) / wavelengths.length;
        const data = stackVisit(frames, { clipSigma: Infinity, background: 'none' }).data;
        return { lambda, data, times: frameTimes(frames) };
    }).sort((x, y) => x.lambda - y.lambda);
    const short = bands[0]!;
    const long = bands[1]!;
    const stretch = pairStretch(short.data, long.data);
    const rgba = falseColourRgba(short.data, long.data, stretch.sShort, stretch.sLong);
    const reading = colourAt(short.data, long.data, grid.width, grid.height,
        { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 }, { pixelArcsec: grid.pixelArcsec, ...radii, minSnr: MIN_COLOUR_SNR });
    return { rgba, width: grid.width, height: grid.height, sentence: colourSentence(short.lambda, long.lambda, reading, [short.times, long.times]) };
}
