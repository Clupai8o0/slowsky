import { colourAt, falseColourLegend, falseColourRgba, FalseColourError, pairStretch, type ColourAt } from './falsecolour';
import { stackVisit } from './stack';
import { aperture, resampleNoiseScale } from './photometry';
import { ringsAt } from './gaia';
import { mjdToDate, type SkyResult } from './source';
import type { RegriddedFrame } from './types';

export class ColourGridError extends Error {}

// One second is our own tolerance for comparing frame time intervals, in MJD days.
const SAME_TIME_TOLERANCE_DAYS = 1 / 86400;
const MIN_COLOUR_SNR = 3;
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

export function colourParts(lambdaShort: number, lambdaLong: number, reading: ColourAt, times?: [[number, number][], [number, number][]], incomplete: [boolean, boolean] = [false, false], noNoise: [boolean, boolean] = [false, false]): ColourParts
{
    const legend = falseColourLegend(lambdaShort, lambdaLong);
    const unavailable = [incomplete[0] || noNoise[0], incomplete[1] || noNoise[1]];
    const seenShort = !unavailable[0] && (reading.seen === 'short' || reading.seen === 'both');
    const seenLong = !unavailable[1] && (reading.seen === 'long' || reading.seen === 'both');
    reading = { ...reading, short: unavailable[0] ? NaN : reading.short, long: unavailable[1] ? NaN : reading.long,
        seen: seenShort && seenLong ? 'both' : seenShort ? 'short' : seenLong ? 'long' : 'neither',
        valid: reading.valid && !unavailable[0] && !unavailable[1] };
    let centre: string;
    let indexPrinted = false;
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
    } else if (reading.seen === 'both' && reading.valid && Number.isFinite(reading.index)) {
        indexPrinted = true;
        centre = `At the centre: seen at both wavelengths, colour index ${signed(reading.index)} (signal-to-noise ${snr(reading.snrShort)} at ${lambdaShort.toFixed(2)} µm and ${snr(reading.snrLong)} at ${lambdaLong.toFixed(2)} µm).`;
    } else if (reading.seen === 'both') {
        centre = `At the centre: seen at both wavelengths (signal-to-noise ${snr(reading.snrShort)} at ${lambdaShort.toFixed(2)} µm and ${snr(reading.snrLong)} at ${lambdaLong.toFixed(2)} µm); no colour index could be formed.`;
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
    const method = Number.isFinite(reading.short) || Number.isFinite(reading.long)
        ? `${indexMethod}The reading adds up a small circle of pixels and takes off the sky just around it, so it need not match the tint of the middle pixels.` : '';
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
    const agreement = bandList.map((band, i) => {
        if (!available[i] || !stackSeen[i] || band.frames.length === 1) {
            return band.frames.length === 1 && stackSeen[i] ? 1 : 0;
        }
        return band.frames.reduce((count, frame) => {
            const ap = aperture(frame.data, grid.width, grid.height, at, { ...radii, noiseScale: resampleNoiseScale(grid.pixelArcsec) });
            return count + (ap.valid && ap.sum > 0 && ap.snr >= MIN_COLOUR_SNR ? 1 : 0);
        }, 0);
    });
    const peakDistances = bandList.map((band, i) => {
        if (!available[i]) { return NaN; }
        let brightest = -Infinity;
        let distance = NaN;
        for (let y = Math.max(0, Math.ceil(at.y - radii.radius)); y <= Math.min(grid.height - 1, Math.floor(at.y + radii.radius)); y++) {
            for (let x = Math.max(0, Math.ceil(at.x - radii.radius)); x <= Math.min(grid.width - 1, Math.floor(at.x + radii.radius)); x++) {
                const d = Math.hypot(x - at.x, y - at.y);
                const value = band.data[y * grid.width + x]!;
                if (d > radii.radius || !Number.isFinite(value) || !Number.isFinite(shownShort[y * grid.width + x]) || !Number.isFinite(shownLong[y * grid.width + x])) {
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
    const disagrees = bandList.map((band, i) => available[i] && stackSeen[i] && band.frames.length >= 2 && agreement[i]! < 2);
    // Only a band that counts as seen has light whose place means something: in noise the brightest pixel falls anywhere.
    const offCentre = peakDistances.map((d, i) => Boolean(available[i] && stackSeen[i] && !disagrees[i]) && d > OFF_CENTRE_ARCSEC);
    const singleSeen = bandList.map((band, i) => available[i] && stackSeen[i] && band.frames.length === 1);
    if (disagrees.some(Boolean) || singleSeen.some(Boolean) || offCentre.some(Boolean)) {
        const descriptions = bandList.map((band, i) => {
            const wavelength = `${band.lambda.toFixed(2)} µm`;
            if (!available[i]) {
                return `${wavelength} cannot be measured here (${noNoise[i] ? 'the noise could not be judged' : 'blank pixels'})`;
            }
            const peak = offCentre[i] ? `, brightest ${peakDistances[i]!.toFixed(1)}″ from the centre` : '';
            if (disagrees[i]) {
                return `${wavelength} shows a signal in only ${agreement[i]} of ${band.frames.length} frames, so it is not counted as seen${peak}`;
            }
            if (stackSeen[i]) {
                const ratio = i === 0 ? reading.snrShort : reading.snrLong;
                return `seen at ${wavelength} (signal-to-noise ${snr(ratio)}${singleSeen[i] ? ', one frame only, so a detector hit cannot be ruled out' : ''}${peak})`;
            }
            return `no clear signal at ${wavelength} (clear means at least ${MIN_COLOUR_SNR} times the noise${peak})`;
        });
        const seenBoth = stackSeen.every(Boolean) && available.every(Boolean) && !disagrees.some(Boolean);
        const offLabels = bandList.filter((_, i) => offCentre[i]).map(band => `${band.lambda.toFixed(2)} µm`).join(' and ');
        const index = seenBoth && reading.valid && Number.isFinite(reading.index) && !offCentre.some(Boolean)
            ? `; colour index ${signed(reading.index)}` : offCentre.some(Boolean)
                ? `; no colour index is given because the light is not centred at ${offLabels}` : '';
        parts.reading = `At the centre: ${descriptions.join('; ')}${index}.`;
        if (!index.startsWith('; colour index ')) {
            parts.method = parts.method.replace('The colour index is (long − short) / (long + short) of the two brightness sums. ', '');
        }
    }
    const catalogue = [a, b].find(result => result.stars?.length > 0)
        ?? [a, b].find(result => Array.isArray(result.stars) && !result.notes.includes('Gaia stars are not available for this view.'));
    if (parts.method) {
        const radius = (radii.radius * grid.pixelArcsec).toFixed(0);
        if (!catalogue) {
            parts.method += ` The reading adds up all light within ${radius}″ of the centre, so it can include a neighbour.`;
        } else {
            const times = [...short.times, ...long.times].flat().filter(Number.isFinite);
            const mjd = times.length ? (Math.min(...times) + Math.max(...times)) / 2 : NaN;
            const positions = Number.isFinite(mjd) ? ringsAt(catalogue.stars, grid, mjd).map(ring => ring.pix) : catalogue.stars.map(star => star.pix);
            // Include the boundary, allowing for round-off in the sky-to-grid projection.
            const distances = positions.map(p => Math.hypot(p.x - at.x, p.y - at.y)).filter(d => d <= radii.radius + 1e-9).sort((x, y) => x - y);
            const stars = distances.length === 0 ? 'no catalogued Gaia star lies inside that circle'
                : distances.length === 1 ? `1 catalogued Gaia star lies inside that circle, ${(distances[0]! * grid.pixelArcsec).toFixed(1)}″ from the centre`
                    : `${distances.length} catalogued Gaia stars lie inside that circle, the nearest ${(distances[0]! * grid.pixelArcsec).toFixed(1)}″ from the centre`;
            parts.method += ` The reading adds up all light within ${radius}″ of the centre; ${stars}.`;
        }
    }
    const label = (name: string, band: typeof short) => {
        const suffix = band.leftOut ? `; ${band.leftOut} more left out (they cover less of this view)` : '';
        return `${name}, ${band.times.length} ${band.times.length === 1 ? 'frame' : 'frames'}, ${dates(band.times)}${suffix}.`;
    };
    const legend = falseColourLegend(short.lambda, long.lambda);
    parts.labels = `${label(legend.blue, short)} ${label(legend.red, long)}`;
    if (short.unpainted || long.unpainted) {
        parts.note += ' In each band, parts not covered by every frame are left unpainted.';
    }
    if (short.frames.length < 3 || long.frames.length < 3) {
        parts.note += ' With fewer than 3 frames, a detector hit in a single frame cannot be rejected from the picture.';
    }
    return { rgba, width: grid.width, height: grid.height, parts, sentence: Object.values(parts).filter(Boolean).join(' ') };
}
