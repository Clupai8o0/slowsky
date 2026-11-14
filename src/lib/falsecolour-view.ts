import { colourAt, falseColourLegend, falseColourRgba, FalseColourError, pairStretch, type ColourAt } from './falsecolour';
import { frameBackground, stackVisit } from './stack';
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
            ? 'The two colours were not taken at the same times, so anything that moved or changed in between shows a false tint.' : '';
    const method = Number.isFinite(reading.short) || Number.isFinite(reading.long)
        ? `The reading adds up a small circle of pixels and takes off the sky just around it, so it need not match the tint of the middle pixels. ${COLOUR_DISCLAIMER}` : COLOUR_DISCLAIMER;
    return { labels, note: legend.note, warning, reading: centre, method };
}

export function colourSentence(lambdaShort: number, lambdaLong: number, reading: ColourAt, times?: [[number, number][], [number, number][]], incomplete: [boolean, boolean] = [false, false]): string
{
    return Object.values(colourParts(lambdaShort, lambdaLong, reading, times, incomplete)).filter(Boolean).join(' ');
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
        const { frames, leftOut } = chooseColourFrames(result.frames.map(item => item.frame));
        if (frames.length === 0) {
            throw new FalseColourError('Picture has no finite pixel values');
        }
        const lambda = frames.reduce((sum, frame) => sum + frame.lambdaAtCenter, 0) / frames.length;
        const common = new Uint8Array(frames[0]!.data.length).fill(1);
        let unpainted = false;
        for (let i = 0; i < common.length; i++) {
            if (frames.some(frame => !Number.isFinite(frame.data[i]))) {
                common[i] = 0;
                unpainted = true;
            }
        }
        const masked = frames.map(frame => ({ ...frame, data: Float32Array.from(frame.data, (value, i) => common[i] ? value : NaN) }));
        const { data } = stackVisit(masked, { background: 'median' });
        return { lambda, data, frames: masked, times: frameTimes(frames), leftOut, unpainted };
    }).sort((x, y) => x.lambda - y.lambda);
    const short = bands[0]!;
    const long = bands[1]!;
    // The shared scale is judged only on pixels painted in both bands. Each band's own sky level taken over its
    // own painted area would differ when the two areas differ, and tint a picture that is the same in both bands.
    const shownShort = Float32Array.from(short.data, (value, i) => Number.isFinite(long.data[i]) ? value : NaN);
    const shownLong = Float32Array.from(long.data, (value, i) => Number.isFinite(short.data[i]) ? value : NaN);
    const stretch = pairStretch(shownShort, shownLong);
    const rgba = falseColourRgba(shownShort, shownLong, stretch.sShort, stretch.sLong);
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
            return { failure: '', strong: 0, outCount: 0, oneLook: false, datesUnknown: false, varying: false, unconfirmed: false };
        }
        const measurements = band.frames.map(frame => aperture(frame.data, grid.width, grid.height, at,
            { ...radii, noiseScale: resampleNoiseScale(grid.pixelArcsec) }));
        const strong = measurements.filter(ap => ap.valid && ap.sum > 0 && ap.snr >= MIN_COLOUR_SNR).length;
        if (!stackSeen[i]) {
            return { failure: strong >= 2 ? 'changed' : '', strong, outCount: 0, oneLook: false, datesUnknown: false, varying: false, unconfirmed: false };
        }
        if (measurements.some(ap => !ap.valid || !Number.isFinite(ap.sum) || !Number.isFinite(ap.noise) || ap.noise <= 0)) {
            return { failure: 'uncheckable', strong, outCount: 0, oneLook: false, datesUnknown: false, varying: false, unconfirmed: false };
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
            strong, outCount: failed.length, oneLook, datesUnknown, varying: !agrees && holdsAlone, unconfirmed: agrees && holds && !holdsAlone };
    });
    const peakDistances = bandList.map((band, i) => {
        if (!available[i] || !stackSeen[i] || checks[i]!.failure) { return NaN; }
        let brightest = -Infinity;
        let distance = NaN;
        const offsets = band.frames.length === 2 ? band.frames.map(frame => frameBackground(frame.data)) : [];
        for (let y = Math.max(0, Math.ceil(at.y - radii.radius)); y <= Math.min(grid.height - 1, Math.floor(at.y + radii.radius)); y++) {
            for (let x = Math.max(0, Math.ceil(at.x - radii.radius)); x <= Math.min(grid.width - 1, Math.floor(at.x + radii.radius)); x++) {
                const d = Math.hypot(x - at.x, y - at.y);
                const p = y * grid.width + x;
                const value = offsets.length === 2 ? Math.min(Math.fround(band.frames[0]!.data[p]! - offsets[0]!), Math.fround(band.frames[1]!.data[p]! - offsets[1]!)) : band.data[p]!;
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
        return distance;
    });
    const disagrees = checks.map(check => Boolean(check.failure));
    const roundedDistance = (value: number) => Number(value.toFixed(2));
    const displaced = bandList.map((band, i) => {
        if (band.frames.length < 2 || !available[i] || !stackSeen[i] || disagrees[i]) { return false; }
        const peaks = band.frames.filter(frame => {
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
        return peaks.some((a, j) => peaks.slice(j + 1).some(b => roundedDistance(Math.hypot(a.x - b.x, a.y - b.y) * grid.pixelArcsec) > OFF_CENTRE_ARCSEC));
    });
    // Only a band that counts as seen has light whose place means something: in noise the brightest pixel falls anywhere.
    const offCentre = peakDistances.map((d, i) => Boolean(available[i] && stackSeen[i] && !disagrees[i]) && roundedDistance(d) > OFF_CENTRE_ARCSEC);
    const singleSeen = bandList.map((band, i) => available[i] && stackSeen[i] && band.frames.length === 1);
    if (disagrees.some(Boolean) || singleSeen.some(Boolean) || offCentre.some(Boolean) || displaced.some(Boolean)
        || checks.some((check, i) => check.varying || check.unconfirmed || (bandList[i]!.frames.length === 2 && stackSeen[i]) || (check.oneLook && !check.failure && stackSeen[i]))) {
        const descriptions = bandList.map((band, i) => {
            const wavelength = `${band.lambda.toFixed(2)} µm`;
            if (!available[i]) {
                return `${wavelength} cannot be measured here (${noNoise[i] ? 'the noise could not be judged' : 'blank pixels'})`;
            }
            const peak = offCentre[i] ? `, its brightest point is not at the centre, brightest ${peakDistances[i]!.toFixed(2)}″ from the centre` : '';
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
                const moved = displaced[i] ? '; its brightest point sits in different places in different frames' : '';
                const dates = checks[i]!.datesUnknown ? `; not all of its ${band.frames.length} frames have usable dates` : checks[i]!.oneLook
                    ? `; ${band.frames.length === 2 ? 'both frames come' : `all ${band.frames.length} frames come`} from one visit` : '';
                return `${wavelength} shows light that differs between frames by more than a steady source would give (strong in ${checks[i]!.strong} of ${band.frames.length} frames); it may have changed or moved, or be a detector effect${moved}${dates}`;
            }
            if (stackSeen[i]) {
                const ratio = i === 0 ? reading.snrShort : reading.snrLong;
                const oneLook = checks[i]!.oneLook ? checks[i]!.datesUnknown
                    ? `, not all of its ${band.frames.length} frames have usable dates, so something passing through or a detector effect cannot be ruled out`
                    : `, ${band.frames.length === 2 ? 'both frames come' : `all ${band.frames.length} frames come`} from one visit, so something passing through or a detector effect cannot be ruled out` : '';
                const unconfirmed = checks[i]!.unconfirmed ? `, too weak without its strongest ${checks[i]!.oneLook ? 'frame' : 'visit'} to count on its own, so it could not be confirmed at a second date` : '';
                const twoVisits = band.frames.length === 2 && !checks[i]!.oneLook ? ', only 2 frames, so a moving source or two detector hits cannot be ruled out' : '';
                const moved = displaced[i] ? ', its brightest point sits in different places in different frames' : '';
                return `seen at ${wavelength} (signal-to-noise ${snr(ratio)}${singleSeen[i] ? ', one frame only, so a detector hit cannot be ruled out' : ''}${oneLook}${unconfirmed}${twoVisits}${moved}${peak})`;
            }
            return `no clear signal at ${wavelength} (clear means at least ${MIN_COLOUR_SNR} times the noise)`;
        });
        parts.reading = `At the centre: ${descriptions.join('; ')}.`;
    }
    const ids = new Set<string>();
    const catalogue = [a, b].flatMap(result => result.stars ?? []).filter(star => {
        if (!Number.isFinite(star.pix.x) || !Number.isFinite(star.pix.y)) { return false; }
        const id = typeof star.sourceId === 'string' ? star.sourceId.trim() : '';
        if (!id) { return true; }
        if (ids.has(id)) { return false; }
        ids.add(id);
        return true;
    });
    if (parts.method !== COLOUR_DISCLAIMER) {
        parts.method = parts.method.replace(` ${COLOUR_DISCLAIMER}`, '');
        parts.method += " Each frame's middle value is taken off as sky, so a glow that fills most of the view can be removed with it.";
        if (bandList.some(band => band.frames.length >= 2)) {
            parts.method += ` Frames taken less than ${SAME_LOOK_DAYS} days apart count as one visit.`;
        }
        if (bandList.some((band, i) => band.frames.length >= 2 && available[i] && stackSeen[i] && !disagrees[i] && !checks[i]!.varying)) {
            parts.method += ` Position is compared only between frames with a signal-to-noise of at least ${PEAK_SNR}.`;
        }
        const radius = (radii.radius * grid.pixelArcsec).toFixed(1);
        const hasCatalogue = [a, b].some(result => result.stars != null && !result.notes.includes('Gaia stars are not available for this view.'));
        if (!catalogue.length && !hasCatalogue) {
            parts.method += ` The reading adds up all light within ${radius}″ of the centre, so it can include a neighbour.`;
        } else {
            const times = [...new Set([...short.times, ...long.times].map(([start, end]) => (start + end) / 2).filter(Number.isFinite))];
            // Include the boundary, allowing for round-off in the sky-to-grid projection.
            const distances = catalogue.map(star => {
                const points = times.length ? times.map(mjd => gridSkyToPix(grid, starAt(star, mjd))) : [star.pix];
                const values = points.map(p => Math.hypot(p.x - at.x, p.y - at.y)).filter(Number.isFinite);
                return { min: Math.min(...values), max: Math.max(...values) };
            })
                .filter(d => d.min <= radii.radius + 1e-9).sort((x, y) => x.min - y.min);
            // The page's list is cut to the brighter Gaia stars (gaia.ts), so "none on the list" is not "nothing there".
            const crossing = (distance: { min: number; max: number }) => distance.min <= radii.radius + 1e-9 && distance.max > radii.radius + 1e-9;
            const stars = distances.length === 0 ? 'none of the Gaia stars this page loads lies inside that circle'
                : distances.length === 1 ? crossing(distances[0]!)
                    ? `1 of the Gaia stars this page loads passes through that circle, ${((distances[0]!.min * grid.pixelArcsec).toFixed(1) === (distances[0]!.max * grid.pixelArcsec).toFixed(1)) ? `about ${(distances[0]!.min * grid.pixelArcsec).toFixed(1)}″ from the centre, on the edge of that circle` : `between ${(distances[0]!.min * grid.pixelArcsec).toFixed(1)}″ and ${(distances[0]!.max * grid.pixelArcsec).toFixed(1)}″ from the centre over the frame dates`}`
                    : `1 of the Gaia stars this page loads lies inside that circle, ${distanceText(distances[0]!, grid.pixelArcsec)}`
                    : distances.some(crossing)
                        ? `${distances.length} of the Gaia stars this page loads lie inside or pass through that circle over the frame dates, the nearest ${distanceText(distances[0]!, grid.pixelArcsec)}`
                        : `${distances.length} of the Gaia stars this page loads lie inside that circle, the nearest ${distanceText(distances[0]!, grid.pixelArcsec)}`;
            parts.method += ` The reading adds up all light within ${radius}″ of the centre; ${stars}. That list holds only the brighter stars, so a fainter star or a source seen only in infrared can still be inside.`;
        }
        parts.method += ` ${COLOUR_DISCLAIMER}`;
    } else if (bandList.some(band => band.frames.length >= 2)) {
        parts.method = `Frames taken less than ${SAME_LOOK_DAYS} days apart count as one visit. ${COLOUR_DISCLAIMER}`;
    }
    const label = (name: string, band: typeof short) => {
        const suffix = band.leftOut ? `; ${band.leftOut} more left out (${band.leftOut === 1 ? 'it does' : 'they do'} not share enough of this view with the frames used)` : '';
        return `${name}, ${band.times.length} ${band.times.length === 1 ? 'frame' : 'frames'}, ${dates(band.times)}${suffix}.`;
    };
    const legend = falseColourLegend(short.lambda, long.lambda);
    parts.labels = `${label(legend.blue, short)} ${label(legend.red, long)}`;
    if (short.unpainted || long.unpainted) {
        parts.note += ' A pixel is painted only where every frame used for both colours covers it.';
    }
    if (short.frames.length < 3 || long.frames.length < 3) {
        const wavelengths = bandList.filter(band => band.frames.length < 3).map(band => `${band.lambda.toFixed(2)} µm`).join(' and ');
        parts.note += ` With fewer than 3 frames at ${wavelengths}, a detector hit in a single frame cannot be rejected from the picture.`;
    }
    if (bandList.some(band => band.frames.length >= 3)) {
        const wavelengths = bandList.filter(band => band.frames.length >= 3).map(band => `${band.lambda.toFixed(2)} µm`).join(' and ');
        parts.note += ` With 3 or more frames at ${wavelengths}, a value that stands out in only one or a few of them may be left out there or averaged in, so something that flared or moved may be missing from this picture or look steady in it.`;
    }
    return { rgba, width: grid.width, height: grid.height, parts, sentence: Object.values(parts).filter(Boolean).join(' ') };
}
