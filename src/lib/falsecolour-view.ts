import { colourAt, falseColourLegend, falseColourRgba, pairStretch, type ColourAt } from './falsecolour';
import { stackVisit } from './stack';
import type { SkyResult } from './source';

export class ColourGridError extends Error {}

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

export function colourSentence(lambdaShort: number, lambdaLong: number, reading: ColourAt): string
{
    const legend = falseColourLegend(lambdaShort, lambdaLong);
    let centre: string;
    if (!Number.isFinite(reading.short) || !Number.isFinite(reading.long)) {
        centre = 'At the centre: cannot be measured here (blank pixels).';
    } else if (reading.seen === 'both' && reading.valid && Number.isFinite(reading.index)) {
        centre = `At the centre: seen at both wavelengths, colour index ${signed(reading.index)} (signal-to-noise ${snr(reading.snrShort)} and ${snr(reading.snrLong)}).`;
    } else if (reading.seen === 'short' || reading.seen === 'long') {
        const isShort = reading.seen === 'short';
        const seen = isShort ? lambdaShort : lambdaLong;
        const other = isShort ? lambdaLong : lambdaShort;
        centre = `At the centre: seen at ${seen.toFixed(2)} µm only (signal-to-noise ${snr(isShort ? reading.snrShort : reading.snrLong)}); nothing above the noise at ${other.toFixed(2)} µm.`;
    } else {
        centre = 'At the centre: nothing stands above the noise at either wavelength.';
    }
    return `${legend.blue}. ${legend.red}. ${legend.note} The colour index is (long − short) / (long + short) of the two brightness sums. ${centre}`;
}

export function falseColourView(a: SkyResult, b: SkyResult): { rgba: Uint8ClampedArray; width: number; height: number; sentence: string }
{
    const grid = a.grid;
    const grids = [b.grid, ...a.frames.map(item => item.frame.grid), ...b.frames.map(item => item.frame.grid)];
    if (grids.some(other => grid.width !== other.width || grid.height !== other.height || grid.pixelArcsec !== other.pixelArcsec
        || grid.center.ra !== other.center.ra || grid.center.dec !== other.center.dec)) {
        throw new ColourGridError();
    }
    const bands = [a, b].map(result => {
        const frames = result.frames.map(item => item.frame);
        const lambda = frames.reduce((sum, frame) => sum + frame.lambdaAtCenter, 0) / frames.length;
        const data = stackVisit(frames, { clipSigma: Infinity, background: 'none' }).data;
        return { lambda, data };
    }).sort((x, y) => x.lambda - y.lambda);
    const short = bands[0]!;
    const long = bands[1]!;
    const stretch = pairStretch(short.data, long.data);
    const rgba = falseColourRgba(short.data, long.data, stretch.sShort, stretch.sLong);
    const reading = colourAt(short.data, long.data, grid.width, grid.height,
        { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 }, { pixelArcsec: grid.pixelArcsec });
    return { rgba, width: grid.width, height: grid.height, sentence: colourSentence(short.lambda, long.lambda, reading) };
}
