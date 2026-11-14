import { colourAt, falseColourLegend, falseColourRgba, FalseColourError, pairStretch, type ColourAt } from './falsecolour';
import { frameBackground } from './stack';
import { aperture, resampleNoiseScale } from './photometry';
import { starAt } from './gaia';
import { gridSkyToPix } from './regrid';
import { mjdToDate, type SkyResult } from './source';
import type { RegriddedFrame } from './types';

export class ColourGridError extends Error {}

// One second is our own tolerance for comparing frame time intervals, in MJD days.
const SAME_TIME_TOLERANCE_DAYS = 1 / 86400;
const MIN_COLOUR_SNR = 3;
// Frames this close together belong to one visit.
export const SAME_LOOK_DAYS = 10;
// Our own choice: below this a single frame's brightest point is mostly noise.
export const PEAK_SNR = 10;
// The centre reading needs a picture fine enough to place light to within one detector pixel. The 0.1° and 0.25° views
// draw 1.5375″ pixels; the 0.5° and 1° views draw about 2.5″ and 5″ pixels, where light 8″ to 9″ either side of the
// centre can be read as light at the centre (review of round 9e), so no reading is given there.
export const MAX_READING_PIXEL_ARCSEC = 1.6;
// Our own choice, not measured: 3 for two frames, rising slowly because more frames give more chances for one to stand out by chance.
export function agreeSigma(n: number): number
{
    return Math.min(4, 3 + 0.3 * Math.log2(n / 2));
}
// Our own choice, not measured: steady sources read a few percent differently from frame to frame.
export const SEEN_FLOOR = 0.05;
// Our chosen threshold: one native SPHEREx detector pixel, not an instrument limit.
const OFF_CENTRE_ARCSEC = 6.15;
// Our chosen minimum common coverage, relative to the first frame's finite pixels.
const MIN_SHARED_FRACTION = 0.8;
export const PAIR_FRACTION = 0.35;
const MIN_COLOURED_FRACTION = 0.5;
export const TOO_LITTLE_COLOUR = 'False colour is not shown for this view: the frames at the two wavelengths give a colour to less than half of it.';

function median(values: number[]): number
{
    values.sort((a, b) => a - b);
    return (values[Math.floor((values.length - 1) / 2)]! + values[Math.ceil((values.length - 1) / 2)]!) / 2;
}

// Frames already share a finite footprint. Subtract each frame's sky before comparing or combining them.
export function screenColourFrames(frames: RegriddedFrame[]): { data: Float32Array }
{
    const skies = frames.map(frame => frameBackground(frame.data));
    const size = frames[0]!.data.length;
    const data = new Float32Array(size).fill(NaN);
    const differences = frames.length === 2
        ? Array.from(frames[0]!.data, (value, p) => value - skies[0]! - (frames[1]!.data[p]! - skies[1]!)).filter(Number.isFinite) : [];
    const middle = differences.length ? median(differences) : 0;
    const spread = differences.length ? 1.4826 * median(differences.map(value => Math.abs(value - middle))) : 0;
    for (let p = 0; p < size; p++) {
        const values = frames.map((frame, i) => frame.data[p]! - skies[i]!);
        if (values.some(value => !Number.isFinite(value))) {
            continue;
        }
        if (values.length === 2) {
            const a = values[0]!;
            const b = values[1]!;
            const mean = (a + b) / 2;
            const tolerance = Math.max(5 * spread, PAIR_FRACTION * Math.max(Math.abs(a), Math.abs(b)));
            const weight = tolerance === 0 ? 0 : Math.max(0, Math.min(1, Math.abs(a - b) / tolerance - 1));
            data[p] = (1 - weight) * mean + weight * Math.min(a, b);
        } else {
            data[p] = median(values);
        }
    }
    return { data };
}

export function chooseColourFrames(frames: RegriddedFrame[]): { frames: RegriddedFrame[]; leftOut: number }
{
    const candidates = frames.map((frame, index) => ({ frame, index,
        count: frame.data.reduce((count, value) => count + (Number.isFinite(value) ? 1 : 0), 0) }))
        .filter(item => item.count > 0)
        .sort((a, b) => b.count - a.count || a.frame.frame.tMin - b.frame.frame.tMin || a.index - b.index);
    if (candidates.length === 0) {
        return { frames: [], leftOut: frames.length };
    }
    const first = candidates[0]!;
    const chosen = [first.frame];
    const shared = Uint8Array.from(first.frame.data, value => Number.isFinite(value) ? 1 : 0);
    for (const candidate of candidates.slice(1)) {
        let count = 0;
        for (let i = 0; i < shared.length; i++) {
            if (shared[i] && Number.isFinite(candidate.frame.data[i])) {
                count++;
            }
        }
        if (count >= MIN_SHARED_FRACTION * first.count) {
            chosen.push(candidate.frame);
            for (let i = 0; i < shared.length; i++) {
                if (!Number.isFinite(candidate.frame.data[i])) {
                    shared[i] = 0;
                }
            }
        }
    }
    return { frames: chosen, leftOut: frames.length - chosen.length };
}

function frameTimes(frames: RegriddedFrame[]): [number, number][]
{
    return frames.map(({ frame }) => [frame.tMin, frame.tMax] as [number, number]);
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
    const matches = (x: [number, number], y: [number, number]) => x.every((t, i) =>
        Number.isFinite(t) && Number.isFinite(y[i]) && Math.abs(t - y[i]!) <= SAME_TIME_TOLERANCE_DAYS);
    return a.every(x => b.some(y => matches(x, y))) && b.every(y => a.some(x => matches(x, y)));
}

// One decimal below 10, whole numbers from 10 up. Rounded first, so 9.96 prints "10", not "10.0".
function snr(value: number): string
{
    const one = value.toFixed(1);
    return Number(one) < 10 ? one : value.toFixed(0);
}

const COLOUR_DISCLAIMER = 'The colours in the picture are for looking; this page does not measure a colour.';

function distanceText(distance: { min: number; max: number }, pixelArcsec: number): string
{
    const min = distance.min * pixelArcsec;
    const max = distance.max * pixelArcsec;
    return max - min > 0.5 ? `between ${min.toFixed(1)}″ and ${max.toFixed(1)}″ from the centre over the frame dates`
        : `${max.toFixed(1)}″ from the centre`;
}

export interface ColourParts {
    labels: string;
    note: string;
    warning: string;
    reading: string;
    method: string;
}

export function pictureOnlyParts(parts: ColourParts): ColourParts
{
    return { ...parts, reading: '', method: COLOUR_DISCLAIMER };
}

export function colourParts(lambdaShort: number, lambdaLong: number, reading: ColourAt, times?: [[number, number][], [number, number][]], incomplete: [boolean, boolean] = [false, false], noNoise: [boolean, boolean] = [false, false]): ColourParts
{
    const legend = falseColourLegend(lambdaShort, lambdaLong);
    noNoise = [noNoise[0] || !Number.isFinite(reading.snrShort), noNoise[1] || !Number.isFinite(reading.snrLong)];
    const unavailable = [incomplete[0] || noNoise[0], incomplete[1] || noNoise[1]];
    const seenShort = !unavailable[0] && (reading.seen === 'short' || reading.seen === 'both');
    const seenLong = !unavailable[1] && (reading.seen === 'long' || reading.seen === 'both');
    reading = { ...reading, short: unavailable[0] ? NaN : reading.short, long: unavailable[1] ? NaN : reading.long,
        seen: seenShort && seenLong ? 'both' : seenShort ? 'short' : seenLong ? 'long' : 'neither',
        valid: reading.valid && !unavailable[0] && !unavailable[1] };
    let centre: string;
    if (!Number.isFinite(reading.short) || !Number.isFinite(reading.long)) {
        const finiteShort = Number.isFinite(reading.short);
        const finiteLong = Number.isFinite(reading.long);
        const reason = (band: number) => !incomplete[band] && noNoise[band] ? 'the noise could not be judged' : 'blank pixels';
        if (finiteShort !== finiteLong) {
            const finiteLambda = finiteShort ? lambdaShort : lambdaLong;
            const blankLambda = finiteShort ? lambdaLong : lambdaShort;
            const seen = reading.seen === (finiteShort ? 'short' : 'long');
            const signal = seen ? `seen at ${finiteLambda.toFixed(2)} µm (signal-to-noise ${snr(finiteShort ? reading.snrShort : reading.snrLong)})`
                : `no clear signal at ${finiteLambda.toFixed(2)} µm (clear means at least ${MIN_COLOUR_SNR} times the noise)`;
            centre = `At the centre: ${signal}; ${blankLambda.toFixed(2)} µm cannot be measured here (${reason(finiteShort ? 1 : 0)}).`;
        } else if (incomplete[0] || incomplete[1] || noNoise[0] || noNoise[1]) {
            centre = `At the centre: ${lambdaShort.toFixed(2)} µm cannot be measured here (${reason(0)}); ${lambdaLong.toFixed(2)} µm cannot be measured here (${reason(1)}).`;
        } else {
            centre = 'At the centre: cannot be measured here (blank pixels).';
        }
    } else if (reading.seen === 'both') {
        centre = `At the centre: seen at both wavelengths (signal-to-noise ${snr(reading.snrShort)} at ${lambdaShort.toFixed(2)} µm and ${snr(reading.snrLong)} at ${lambdaLong.toFixed(2)} µm).`;
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
            ? 'The two colours were not taken at the same times, so anything that moved or changed in between can show a false tint.' : '';
    const method = Number.isFinite(reading.short) || Number.isFinite(reading.long)
        ? `The reading adds up a small circle of pixels and takes off the sky just around it, so it need not match the tint of the middle pixels. ${COLOUR_DISCLAIMER}` : COLOUR_DISCLAIMER;
    return { labels, note: legend.note, warning, reading: centre, method };
}

export function colourSentence(lambdaShort: number, lambdaLong: number, reading: ColourAt, times?: [[number, number][], [number, number][]], incomplete: [boolean, boolean] = [false, false]): string
{
    return Object.values(colourParts(lambdaShort, lambdaLong, reading, times, incomplete)).filter(Boolean).join(' ');
}

// `maxReadingPixelArcsec` is lifted only by tests of the sentence rules, whose made-up sources sit exactly on pixels.
export function falseColourView(a: SkyResult, b: SkyResult, radii: { radius: number; annulusIn: number; annulusOut: number },
    maxReadingPixelArcsec = MAX_READING_PIXEL_ARCSEC): { rgba: Uint8ClampedArray; width: number; height: number; sentence: string; parts: ColourParts }
{
    const grid = a.grid;
    const grids = [b.grid, ...a.frames.map(item => item.frame.grid), ...b.frames.map(item => item.frame.grid)];
    if (grids.some(other => grid.width !== other.width || grid.height !== other.height || grid.pixelArcsec !== other.pixelArcsec
        || grid.center.ra !== other.center.ra || grid.center.dec !== other.center.dec)) {
        throw new ColourGridError();
    }
    const bands = [a, b].map(result => {
        const { frames, leftOut } = chooseColourFrames(result.frames.map(item => item.frame));
        if (frames.length === 0) {
            throw new FalseColourError('Picture has no finite pixel values');
        }
        const lambda = frames.reduce((sum, frame) => sum + frame.lambdaAtCenter, 0) / frames.length;
        const common = new Uint8Array(frames[0]!.data.length).fill(1);
        for (let i = 0; i < common.length; i++) {
            if (frames.some(frame => !Number.isFinite(frame.data[i]))) {
                common[i] = 0;
            }
        }
        const masked = frames.map(frame => ({ ...frame, data: Float32Array.from(frame.data, (value, i) => common[i] ? value : NaN) }));
        const { data } = screenColourFrames(masked);
        return { lambda, data, frames: masked, times: frameTimes(frames), leftOut };
    }).sort((x, y) => x.lambda - y.lambda);
    const short = bands[0]!;
    const long = bands[1]!;
    // The shared scale is judged only on pixels painted in both bands. Each band's own sky level taken over its
    // own painted area would differ when the two areas differ, and tint a picture that is the same in both bands.
    const shownShort = Float32Array.from(short.data, (value, i) => Number.isFinite(long.data[i]) ? value : NaN);
    const shownLong = Float32Array.from(long.data, (value, i) => Number.isFinite(short.data[i]) ? value : NaN);
    if (shownShort.reduce((count, value) => count + (Number.isFinite(value) ? 1 : 0), 0) < MIN_COLOURED_FRACTION * shownShort.length) {
        throw new FalseColourError(TOO_LITTLE_COLOUR);
    }
    const stretch = pairStretch(shownShort, shownLong);
    const rgba = falseColourRgba(shownShort, shownLong, stretch.sShort, stretch.sLong, undefined, grid.width);
    const reading = colourAt(short.data, long.data, grid.width, grid.height,
        { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 }, { pixelArcsec: grid.pixelArcsec, ...radii, minSnr: MIN_COLOUR_SNR });
    const at = { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 };
    const noiseUnknown = (data: Float32Array) => {
        const result = aperture(data, grid.width, grid.height, at, radii);
        return result.valid && (!Number.isFinite(result.noise) || result.noise <= 0);
    };
    const noNoise: [boolean, boolean] = [noiseUnknown(short.data), noiseUnknown(long.data)];
    const parts = colourParts(short.lambda, long.lambda, reading, [short.times, long.times], [false, false], noNoise);
    const available = [Number.isFinite(reading.short) && !noNoise[0], Number.isFinite(reading.long) && !noNoise[1]];
    const stackSeen = [reading.seen === 'short' || reading.seen === 'both', reading.seen === 'long' || reading.seen === 'both'];
    const bandList = [short, long];
    const checks = bandList.map((band, i) => {
        if (!available[i] || band.frames.length < 2) {
            return { failure: '', strong: 0, outCount: 0, oneLook: false, datesUnknown: false, varying: false, unconfirmed: false, span: 0 };
        }
        const measurements = band.frames.map(frame => aperture(frame.data, grid.width, grid.height, at,
            { ...radii, noiseScale: resampleNoiseScale(grid.pixelArcsec) }));
        const strong = measurements.filter(ap => ap.valid && ap.sum > 0 && ap.snr >= MIN_COLOUR_SNR).length;
        if (!stackSeen[i]) {
            return { failure: strong >= 2 ? 'changed' : '', strong, outCount: 0, oneLook: false, datesUnknown: false, varying: false, unconfirmed: false, span: 0 };
        }
        if (measurements.some(ap => !ap.valid || !Number.isFinite(ap.sum) || !Number.isFinite(ap.noise) || ap.noise <= 0)) {
            return { failure: 'uncheckable', strong, outCount: 0, oneLook: false, datesUnknown: false, varying: false, unconfirmed: false, span: 0 };
        }
        const midpoints = band.times.map(([start, end]) => (start + end) / 2);
        const datesUnknown = midpoints.some(time => !Number.isFinite(time));
        const order = measurements.map((_, j) => j).sort((x, y) => datesUnknown ? x - y : midpoints[x]! - midpoints[y]! || x - y);
        const visits: number[][] = [];
        for (const j of order) {
            const last = visits[visits.length - 1];
            if (!last || (!datesUnknown && midpoints[j]! - midpoints[last[last.length - 1]!]! >= SAME_LOOK_DAYS)) {
                visits.push([j]);
            } else {
                last.push(j);
            }
        }
        const oneLook = visits.length === 1;
        const units = oneLook ? order.map(j => [j]) : visits;
        const best = (score: (j: number) => number) => order.reduce((winner, j) => score(j) > score(winner) ? j : winner, order[0]!);
        const carry = [best(j => measurements[j]!.sum / measurements[j]!.noise), best(j => measurements[j]!.sum)]
            .map(j => units.find(unit => unit.includes(j))!)
            .filter((unit, j, all) => all.indexOf(unit) === j);
        const group = (indices: number[]) => ({
            mean: indices.reduce((total, j) => total + measurements[j]!.sum, 0) / indices.length,
            noise: Math.sqrt(indices.reduce((total, j) => total + measurements[j]!.noise ** 2, 0)) / indices.length,
        });
        const restOf = (unit: number[]) => order.filter(j => !unit.includes(j));
        const passes = (unit: number[], alone: boolean) => {
            const rest = restOf(unit);
            const value = group(rest);
            return value.mean / value.noise >= MIN_COLOUR_SNR * (alone ? 1 : Math.sqrt(rest.length / measurements.length));
        };
        const holds = carry.every(unit => passes(unit, false));
        const holdsAlone = carry.every(unit => passes(unit, true));
        const groups = oneLook ? units : [...units, ...order.map(j => [j])];
        const agrees = groups.every(unit => {
            const rest = restOf(unit);
            if (!rest.length) { return true; }
            const left = group(unit);
            const right = group(rest);
            return Math.abs(left.mean - right.mean) <= agreeSigma(measurements.length)
                * Math.hypot(left.noise, right.noise, SEEN_FLOOR * Math.max(left.mean, right.mean, 0));
        });
        const failed = carry.find(unit => !passes(unit, !agrees)) ?? carry[0]!;
        return { failure: agrees ? (holds ? '' : 'faint') : (holdsAlone ? '' : 'strongest'),
            strong, outCount: failed.length, oneLook, datesUnknown, varying: !agrees && holdsAlone, unconfirmed: agrees && holds && !holdsAlone,
            span: datesUnknown ? NaN : midpoints[order[order.length - 1]!]! - midpoints[order[0]!]! };
    });
    // The brightest pixel inside the circle, and how far from the centre it is, for a picture given pixel by pixel.
    const peakOf = (valueAt: (p: number) => number) => {
        let brightest = -Infinity;
        let distance = NaN;
        for (let y = Math.max(0, Math.ceil(at.y - radii.radius)); y <= Math.min(grid.height - 1, Math.floor(at.y + radii.radius)); y++) {
            for (let x = Math.max(0, Math.ceil(at.x - radii.radius)); x <= Math.min(grid.width - 1, Math.floor(at.x + radii.radius)); x++) {
                const d = Math.hypot(x - at.x, y - at.y);
                const value = valueAt(y * grid.width + x);
                if (d > radii.radius || !Number.isFinite(value)) {
                    continue;
                }
                // Equal values (a flat or clipped top) count as the one nearest the centre, not the first one scanned.
                if (value > brightest || (value === brightest && d * grid.pixelArcsec < distance)) {
                    brightest = value;
                    distance = d * grid.pixelArcsec;
                }
            }
        }
        return { value: brightest, distance };
    };
    const peakDistance = (valueAt: (p: number) => number) => peakOf(valueAt).distance;
    const located = (i: number) => Boolean(available[i] && stackSeen[i] && !checks[i]!.failure);
    // In the combined picture, which is what the page draws: a distance printed from it is true of what the reader sees.
    const peakDistances = bandList.map((band, i) => located(i) ? peakDistance(p => band.data[p]!) : NaN);
    const disagrees = checks.map(check => Boolean(check.failure));
    const roundedDistance = (value: number) => Number(value.toFixed(2));
    // The brightest point of each frame that shows the light strongly enough to place it.
    const framePeaks = bandList.map((band, i) => {
        if (band.frames.length < 2 || !available[i] || !stackSeen[i] || disagrees[i]) { return []; }
        return band.frames.filter(frame => {
            const ap = aperture(frame.data, grid.width, grid.height, at, { ...radii, noiseScale: resampleNoiseScale(grid.pixelArcsec) });
            return ap.valid && Number.isFinite(ap.noise) && ap.noise > 0 && ap.sum / ap.noise >= PEAK_SNR;
        }).map(frame => {
            let best = -Infinity;
            let point = at;
            for (let y = Math.max(0, Math.ceil(at.y - radii.radius)); y <= Math.min(grid.height - 1, Math.floor(at.y + radii.radius)); y++) {
                for (let x = Math.max(0, Math.ceil(at.x - radii.radius)); x <= Math.min(grid.width - 1, Math.floor(at.x + radii.radius)); x++) {
                    const value = frame.data[y * grid.width + x]!;
                    if (Math.hypot(x - at.x, y - at.y) <= radii.radius && Number.isFinite(value)
                        && (value > best || (value === best && Math.hypot(x - at.x, y - at.y) < Math.hypot(point.x - at.x, point.y - at.y)))) {
                        best = value;
                        point = { x, y };
                    }
                }
            }
            return point;
        });
    });
    // With 2 placed frames, the gap; with more, the farthest point from their coordinate median.
    const spreads = framePeaks.map(peaks => {
        if (peaks.length < 2) { return 0; }
        if (peaks.length === 2) { return roundedDistance(Math.hypot(peaks[0]!.x - peaks[1]!.x, peaks[0]!.y - peaks[1]!.y) * grid.pixelArcsec); }
        const middle = (values: number[]) => {
            const sorted = [...values].sort((x, y) => x - y);
            return (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.ceil((sorted.length - 1) / 2)]!) / 2;
        };
        const mid = { x: middle(peaks.map(p => p.x)), y: middle(peaks.map(p => p.y)) };
        return peaks.reduce((far, p) => Math.max(far, roundedDistance(Math.hypot(p.x - mid.x, p.y - mid.y) * grid.pixelArcsec)), 0);
    });
    const widestPairs = framePeaks.map(peaks => {
        let widest = 0;
        for (let i = 0; i < peaks.length; i++) {
            for (let j = i + 1; j < peaks.length; j++) {
                widest = Math.max(widest, roundedDistance(Math.hypot(peaks[i]!.x - peaks[j]!.x, peaks[i]!.y - peaks[j]!.y) * grid.pixelArcsec));
            }
        }
        return widest;
    });
    // For 3+ placed frames, also compare the widest pair so motion across the median cannot hide behind it.
    const stillLimit = roundedDistance(OFF_CENTRE_ARCSEC + grid.pixelArcsec);
    const displaced = spreads.map((spread, i) => spread > OFF_CENTRE_ARCSEC
        || (framePeaks[i]!.length >= 3 && widestPairs[i]! > stillLimit));
    const allOff = framePeaks.map(peaks => peaks.length >= 2 && peaks.every(p =>
        roundedDistance(Math.hypot(p.x - at.x, p.y - at.y) * grid.pixelArcsec) > OFF_CENTRE_ARCSEC));
    // Only a band that counts as seen has light whose place means something: in noise the brightest pixel falls anywhere.
    const stackOff = peakDistances.map((d, i) => located(i) && roundedDistance(d) > OFF_CENTRE_ARCSEC);
    // Two placed frames more than a detector pixel apart cannot establish a place at the centre.
    const apart = spreads.map((gap, i) => framePeaks[i]!.length === 2 && gap > OFF_CENTRE_ARCSEC);
    const offCentre = apart.map((two, i) => two || stackOff[i]! || allOff[i]!);
    const singleSeen = bandList.map((band, i) => available[i] && stackSeen[i] && band.frames.length === 1);
    if (disagrees.some(Boolean) || singleSeen.some(Boolean) || offCentre.some(Boolean) || displaced.some(Boolean)
        || checks.some((check, i) => check.varying || check.unconfirmed || (bandList[i]!.frames.length === 2 && stackSeen[i]) || (check.oneLook && !check.failure && stackSeen[i]))) {
        const noDates = (band: typeof short) => band.times.some(([start, end]) => Number.isFinite((start + end) / 2))
            ? `not all of its ${band.frames.length} frames have usable dates` : `none of its ${band.frames.length} frames has a usable date`;
        // Frames each less than SAME_LOOK_DAYS after the one before can run on for months: say that, not "one visit".
        const chained = (i: number) => checks[i]!.span >= SAME_LOOK_DAYS;
        const oneVisit = (band: typeof short, i: number) => chained(i)
            ? `its ${band.frames.length} frames span ${Math.round(checks[i]!.span)} days with no gap of ${SAME_LOOK_DAYS} days or more between them, so they are not counted as separate visits`
            : `${band.frames.length === 2 ? 'both frames come' : `all ${band.frames.length} frames come`} from one visit`;
        const twoPlaced = (i: number) => bandList[i]!.frames.length > framePeaks[i]!.length
            ? 'the two frames strong enough to place it' : 'its two frames';
        const descriptions = bandList.map((band, i) => {
            const wavelength = `${band.lambda.toFixed(2)} µm`;
            if (!available[i]) {
                return `${wavelength} cannot be measured here (${noNoise[i] ? 'the noise could not be judged' : 'blank pixels'})`;
            }
            if (disagrees[i]) {
                if (checks[i]!.failure === 'uncheckable') {
                    return `${wavelength} could not be checked frame by frame, so it is not counted as seen`;
                }
                if (checks[i]!.failure === 'changed') {
                    const chance = checks[i]!.strong <= 2 ? 'chance noise alone can do this; ' : '';
                    return `${wavelength} shows a signal in ${checks[i]!.strong} of ${band.frames.length} frames but not in the combined picture, which leaves out values that stand out in only some frames, so it is not counted as seen (${chance}it may have changed or moved, or be detector hits)`;
                }
                const excluded = checks[i]!.outCount === 1 ? 'its strongest frame' : `the ${checks[i]!.outCount} frames of its strongest visit`;
                if (checks[i]!.failure === 'faint') {
                    return `${wavelength} shows a signal that falls below the limit once ${excluded} ${checks[i]!.outCount === 1 ? 'is' : 'are'} left out, so it is not counted as seen`;
                }
                return `${wavelength} shows a signal that does not hold up without ${excluded}, so it is not counted as seen (it may have changed or moved, or be a detector effect)`;
            }
            if (checks[i]!.varying) {
                // Light that changes away from the centre is not the target's to claim: say where it is.
                const where = apart[i] ? `; ${twoPlaced(i)} do not agree on where it is brightest`
                    : stackOff[i] ? `; it is brightest ${peakDistances[i]!.toFixed(2)}″ from the centre, so it may belong to a neighbouring source` : '';
                const moved = displaced[i] && !apart[i] ? '; its brightest point sits in different places in different frames' : '';
                const dates = checks[i]!.datesUnknown ? `; ${noDates(band)}` : checks[i]!.oneLook ? `; ${oneVisit(band, i)}` : '';
                return `${wavelength} shows light that differs between frames by more than a steady source would give (strong in ${checks[i]!.strong} of ${band.frames.length} frames); it may have changed or moved, or be a detector effect${where}${moved}${dates}`;
            }
            if (stackSeen[i] && offCentre[i]) {
                // Light that peaks away from the centre is most likely a neighbour's: say where, and claim nothing here.
                if (apart[i]) {
                    // 2 frames only, brightest far apart: no distance is true of both, and nothing says which is right.
                    return `${wavelength} shows light here, but ${twoPlaced(i)} do not agree on where it is brightest, so it may be a moving source, a neighbouring one or a detector hit, and it is not counted as seen at the centre`;
                }
                if (!stackOff[i]) {
                    return `${wavelength} shows light here, but every frame strong enough to place it is brightest away from the centre, so it may belong to a neighbouring source and is not counted as seen at the centre`;
                }
                const place = `${wavelength} shows light here that is brightest ${peakDistances[i]!.toFixed(2)}″ from the centre`;
                return displaced[i]
                    ? `${place} in the combined picture, and its brightest point sits in different places in different frames; it may be a moving source, a neighbouring one or a detector hit, and it is not counted as seen at the centre`
                    : `${place}, so it may belong to a neighbouring source and is not counted as seen at the centre`;
            }
            if (stackSeen[i]) {
                const ratio = i === 0 ? reading.snrShort : reading.snrLong;
                const oneLook = checks[i]!.oneLook ? checks[i]!.datesUnknown
                    ? `, ${noDates(band)}, so something passing through or a detector effect cannot be ruled out`
                    : `, ${oneVisit(band, i)}${chained(i) ? ' and' : ', so'} something passing through or a detector effect cannot be ruled out` : '';
                const two = band.frames.length === 2 && !checks[i]!.oneLook;
                // Say what was measured (the rest falls below the limit), not "too weak" beside a high signal-to-noise.
                // With one visit there is no second date to speak of: say only that it leans on one frame.
                const unconfirmed = !checks[i]!.unconfirmed || two ? '' : checks[i]!.oneLook
                    ? `, and without its strongest frame the rest is below ${MIN_COLOUR_SNR} times the noise`
                    : `, but without its strongest visit the rest is below ${MIN_COLOUR_SNR} times the noise, so the other visits do not give a clear signal`;
                const twoVisits = !two ? '' : checks[i]!.unconfirmed
                    ? `, only 2 frames, and at least one of them alone is below ${MIN_COLOUR_SNR} times the noise, so it is not clear at both dates; a moving source or two detector hits cannot be ruled out`
                    : ', only 2 frames, so a moving source or two detector hits cannot be ruled out';
                // A caution earlier in the sentence already names a moving source and detector hits: do not list them twice.
                const said = Boolean(oneLook || twoVisits);
                const causes = said ? 'more than one source' : 'a moving source, more than one source or a detector hit';
                const moved = !displaced[i] ? '' : `; its brightest point sits in different places in different frames, so it may ${said ? 'also ' : ''}be ${causes}`;
                return `seen at ${wavelength} (signal-to-noise ${snr(ratio)}${singleSeen[i] ? ', one frame only, so a detector hit cannot be ruled out' : ''}${oneLook}${unconfirmed}${twoVisits}${moved})`;
            }
            return `no clear signal at ${wavelength} (clear means at least ${MIN_COLOUR_SNR} times the noise)`;
        });
        parts.reading = `At the centre: ${descriptions.join('; ')}.`;
    }
    const ids = new Set<string>();
    const placeable = (star: { ra: number; dec: number; pix: { x: number; y: number } }) => (Number.isFinite(star.ra) && Number.isFinite(star.dec))
        || (Number.isFinite(star.pix.x) && Number.isFinite(star.pix.y));
    // Of two entries for one star, keep one that can be placed.
    const catalogue = [a, b].flatMap(result => result.stars ?? []).sort((x, y) => Number(placeable(y)) - Number(placeable(x))).filter(star => {
        const id = typeof star.sourceId === 'string' ? star.sourceId.trim() : '';
        if (!id) { return true; }
        if (ids.has(id)) { return false; }
        ids.add(id);
        return true;
    });
    if (parts.method !== COLOUR_DISCLAIMER) {
        parts.method = parts.method.replace(` ${COLOUR_DISCLAIMER}`, '');
        if (bandList.some((band, i) => available[i] && band.frames.length >= 2)) {
            parts.method += ` Frames taken less than ${SAME_LOOK_DAYS} days apart count as one visit.`;
        }
        if (bandList.some((band, i) => band.frames.length >= 2 && available[i] && stackSeen[i] && !disagrees[i])) {
            parts.method += ` Position is compared only between frames with a signal-to-noise of at least ${PEAK_SNR}.`;
        }
        const radius = (radii.radius * grid.pixelArcsec).toFixed(1);
        const hasCatalogue = [a, b].some(result => result.stars != null && !result.notes.includes('Gaia stars are not available for this view.'));
        if (!catalogue.length && !hasCatalogue) {
            parts.method += ` The reading adds up all light within ${radius}″ of the centre, so it can include a neighbour.`;
        } else {
            const times = [...new Set([...short.times, ...long.times].map(([start, end]) => (start + end) / 2).filter(Number.isFinite))];
            // Include the boundary, allowing for round-off in the sky-to-grid projection.
            const placed = catalogue.map(star => {
                const dated = times.map(mjd => gridSkyToPix(grid, starAt(star, mjd))).map(p => Math.hypot(p.x - at.x, p.y - at.y)).filter(Number.isFinite);
                // A star whose motion cannot be worked out still sits where the catalogue put it.
                const fixed = gridSkyToPix(grid, star);
                const values = dated.length ? dated
                    : [Math.hypot(star.pix.x - at.x, star.pix.y - at.y), Math.hypot(fixed.x - at.x, fixed.y - at.y)].filter(Number.isFinite).slice(0, 1);
                return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
            });
            // A star with no usable position at all cannot be ruled out of the circle, so it is counted and said.
            const unplaced = placed.filter(d => d === null).length;
            const distances = placed.filter((d): d is { min: number; max: number } => d !== null && d.min <= radii.radius + 1e-9).sort((x, y) => x.min - y.min);
            // The page's list is cut to the brighter Gaia stars (gaia.ts), so "none on the list" is not "nothing there".
            const crossing = (distance: { min: number; max: number }) => distance.min <= radii.radius + 1e-9 && distance.max > radii.radius + 1e-9;
            const stars = distances.length === 0 ? `none of the Gaia stars this page ${unplaced ? 'could place' : 'loads'} lies inside that circle`
                : distances.length === 1 ? crossing(distances[0]!)
                    ? `1 of the Gaia stars this page loads passes through that circle, ${((distances[0]!.min * grid.pixelArcsec).toFixed(1) === (distances[0]!.max * grid.pixelArcsec).toFixed(1)) ? `about ${(distances[0]!.min * grid.pixelArcsec).toFixed(1)}″ from the centre, on the edge of that circle` : `between ${(distances[0]!.min * grid.pixelArcsec).toFixed(1)}″ and ${(distances[0]!.max * grid.pixelArcsec).toFixed(1)}″ from the centre over the frame dates`}`
                    : `1 of the Gaia stars this page loads lies inside that circle, ${distanceText(distances[0]!, grid.pixelArcsec)}`
                    : distances.some(crossing)
                        ? `${distances.length} of the Gaia stars this page loads lie inside or pass through that circle over the frame dates, the nearest ${distanceText(distances[0]!, grid.pixelArcsec)}`
                        : `${distances.length} of the Gaia stars this page loads lie inside that circle, the nearest ${distanceText(distances[0]!, grid.pixelArcsec)}`;
            parts.method += ` The reading adds up all light within ${radius}″ of the centre; ${stars}. That list holds only the brighter stars, so a fainter star or a source seen only in infrared can still be inside.${unplaced ? ` ${unplaced} of the stars on that list could not be placed in this picture, so ${unplaced === 1 ? 'it' : 'they'} may be inside too.` : ''}`;
        }
        parts.method += ` ${COLOUR_DISCLAIMER}`;
    }
    if (grid.pixelArcsec > maxReadingPixelArcsec) {
        parts.reading = `No reading is given at the centre of this view: each pixel of the picture is ${grid.pixelArcsec.toFixed(2)}″ wide, too coarse to tell light at the centre from light beside it. Choose a narrower view for a reading.`;
        parts.method = COLOUR_DISCLAIMER;
    }
    const label = (name: string, band: typeof short) => {
        const suffix = band.leftOut ? `; ${band.leftOut} more left out (${band.leftOut === 1 ? 'it does' : 'they do'} not share enough of this view with the frames used)` : '';
        return `${name}, ${band.times.length} ${band.times.length === 1 ? 'frame' : 'frames'}, ${dates(band.times)}${suffix}.`;
    };
    const legend = falseColourLegend(short.lambda, long.lambda);
    parts.labels = `${label(legend.blue, short)} ${label(legend.red, long)}`;
    parts.note += " Each frame's middle value is taken off as sky, so a glow that fills most of the view can be removed with it.";
    parts.note += ' Hatched areas have no colour: the frames do not all cover them. The grey picture shows through the hatching.';
    if (bandList.some(band => band.frames.length === 1)) {
        const wavelengths = bandList.filter(band => band.frames.length === 1).map(band => `${band.lambda.toFixed(2)} µm`).join(' and ');
        parts.warning += `${parts.warning ? ' ' : ''}With only one frame at ${wavelengths}, a detector hit can show as a coloured point.`;
    }
    if (bandList.some(band => band.frames.length === 2)) {
        const wavelengths = bandList.filter(band => band.frames.length === 2).map(band => `${band.lambda.toFixed(2)} µm`).join(' and ');
        parts.warning += `${parts.warning ? ' ' : ''}With only two frames at ${wavelengths}, the lower of the two values is used wherever they disagree, so something present in only one of them is missing from this picture. A detector hit at the same place in both, or a faint one, can still show as a coloured point.`;
    }
    if (bandList.some(band => band.frames.length >= 3)) {
        const wavelengths = bandList.filter(band => band.frames.length >= 3).map(band => `${band.lambda.toFixed(2)} µm`).join(' and ');
        parts.note += ` With 3 or more frames at ${wavelengths}, the middle value of the frames is used at each pixel, so something present in fewer than half of the frames is missing from this picture, and something present in most of them looks steady.`;
    }
    return { rgba, width: grid.width, height: grid.height, parts, sentence: Object.values(parts).filter(Boolean).join(' ') };
}
