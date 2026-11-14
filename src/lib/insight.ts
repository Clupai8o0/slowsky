import { TARGETS } from './targets.js';
import { ASK_CANNOT } from './insight-prompt.js';

export const ASK_ENABLED = false;

export interface InsightFacts {
    targetId: string;
    ra: number; dec: number; lambdaUm: number;
    visits: { mjd: number; frames: number }[];
    lightCurve?: { points: { mjd: number; relative: number; snr: number }[]; refScatter: number[]; dropped: number };
    difference?: { peakSigma: number };
    motion?: { arcsec: number; days: number };
    snapshot: boolean;
}
export interface InsightNote { text: string; model: string; dropped: number; cached: boolean; remaining?: number }
export interface InsightAnswer extends InsightNote { kind: 'answer' | 'none'; cached: false; picked: number[]; lines: number[]; trust: number[] }
export interface InsightStatus { enabled: boolean; locked: boolean; unlocked: boolean; model?: string; remaining?: number; busy?: boolean; retryAfter?: number }
export type InsightErrorCode = 'off' | 'locked' | 'invalid' | 'busy' | 'unverified' | 'failed';
export class InsightError extends Error {
    readonly code: InsightErrorCode;
    readonly retryAfter?: number;
    readonly reason?: string;
    constructor(code: InsightErrorCode, retryAfter?: number, reason?: string)
    {
        super(code);
        this.name = 'InsightError';
        this.code = code;
        this.retryAfter = retryAfter;
        this.reason = reason;
    }
}
const CONSTANT_CONTEXT: readonly { value: number; context: RegExp }[] = [
    ...[0.75, 5, 5.0, 1.083, 1.875, 3.05, 3.3, 4.05, 4.27, 4.67].map((value) => ({ value, context: /(?:\bmicrons?\b|µm\b)/i })),
    { value: 6.2, context: /\barcsec(?:onds?)?\b/i },
];
// Mission counts are allowed only with their own nouns, optionally after an adjective.
const MISSION_COUNTS = [{ value: 102, nouns: /^(?:[a-z]+\s+)?(?:colours?|colors?|wavelengths?|bands?|channels?)\b/i }, { value: 6, nouns: /^(?:[a-z]+\s+)?detectors?\b/i }];
export const CONSTANTS: readonly number[] = [...CONSTANT_CONTEXT, ...MISSION_COUNTS].map(({ value }) => value);
function object(value: unknown, keys: string[]): Record<string, unknown>
{
    if (value === null || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.keys(value).some((key) => !keys.includes(key))) {
        throw new InsightError('invalid');
    }
    return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number, integer = false): number
{
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
        throw new InsightError('invalid');
    }
    return value;
}
function array(value: unknown, min: number, max: number): unknown[]
{
    if (!Array.isArray(value) || value.length < min || value.length > max) {
        throw new InsightError('invalid');
    }
    return value;
}
export function validateFacts(value: unknown): InsightFacts
{
    const v = object(value, ['targetId', 'ra', 'dec', 'lambdaUm', 'visits', 'lightCurve', 'difference', 'motion', 'snapshot']);
    if (typeof v.targetId !== 'string' || (v.targetId !== 'custom' && !TARGETS.some((t) => t.id === v.targetId)) || typeof v.snapshot !== 'boolean') {
        throw new InsightError('invalid');
    }
    const result: InsightFacts = { targetId: v.targetId, ra: number(v.ra, 0, 360), dec: number(v.dec, -90, 90), lambdaUm: number(v.lambdaUm, 0.7, 5.1), visits: array(v.visits, 1, 12).map((entry) => {
        const visit = object(entry, ['mjd', 'frames']);
        return { mjd: number(visit.mjd, 60000, 70000), frames: number(visit.frames, 1, 500, true) };
    }), snapshot: v.snapshot };
    if ('lightCurve' in v) {
        const lc = object(v.lightCurve, ['points', 'refScatter', 'dropped']);
        result.lightCurve = { points: array(lc.points, 1, 60).map((entry) => {
            const point = object(entry, ['mjd', 'relative', 'snr']);
            return { mjd: number(point.mjd, 60000, 70000), relative: number(point.relative, 0, 100), snr: number(point.snr, -1000, 100000) };
        }), refScatter: array(lc.refScatter, 0, 8).map((n) => number(n, 0, 10)), dropped: number(lc.dropped, 0, 5000, true) };
    }
    if ('difference' in v) {
        const d = object(v.difference, ['peakSigma']);
        result.difference = { peakSigma: number(d.peakSigma, -10000, 10000) };
    }
    if ('motion' in v) {
        const m = object(v.motion, ['arcsec', 'days']);
        result.motion = { arcsec: number(m.arcsec, 0, 100000), days: number(m.days, 0, 4000) };
    }
    return result;
}
export function validateQuestion(value: unknown): string
{
    if (typeof value !== 'string' || Array.from(value).length > 1000) { throw new InsightError('invalid'); }
    const normalized = value.replace(/[\u00ad\u200c\u200d\ufe0e\ufe0f\u200e\u200f\u061c]/gu, '').replace(/[«»‹›]/gu, '"');
    if (/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}<>＜＞〈〉⟨⟩﹤﹥]|&(?:lt;|gt;|#)/iu.test(normalized) || !/[\p{L}\p{N}]/u.test(normalized)) { throw new InsightError('invalid'); }
    const trimmed = normalized.trim();
    const length = Array.from(trimmed).length;
    if (length < 3 || length > 200) { throw new InsightError('invalid'); }
    return trimmed.replace(/\s+/gu, ' ');
}
export const CHANGE_LINE_STARTS = ['Brightness relative to the reference stars', 'Largest change from the median brightness', 'Difference image at the target', 'Shift in position'] as const;
export const TRUST_LINE_STARTS = ['Lowest signal-to-noise among the points', 'Reference stars:', 'Visits:'] as const;
// Brightness includes its caveats; a difference without time order includes a faint-point caveat and visits.
export function askRows(sheet: string[], picked: number[]): { lines: number[]; trust: number[] }
{
    const selected = new Set(picked);
    if (picked.some((n) => [CHANGE_LINE_STARTS[1], CHANGE_LINE_STARTS[2]].some((start) => sheet[n - 1]?.startsWith(start)))) {
        const time = sheet.findIndex((line) => line.startsWith(CHANGE_LINE_STARTS[0]));
        if (time >= 0) { selected.add(time + 1); }
    }
    const matches = (n: number, starts: readonly string[]) => starts.some((start) => sheet[n - 1]?.startsWith(start));
    const brightness = [...selected].some((n) => matches(n, [CHANGE_LINE_STARTS[0], CHANGE_LINE_STARTS[1]]));
    const other = [...selected].some((n) => matches(n, [CHANGE_LINE_STARTS[2], CHANGE_LINE_STARTS[3]]));
    const difference = [...selected].some((n) => matches(n, [CHANGE_LINE_STARTS[2]]));
    const lines = sheet.flatMap((_, i) => selected.has(i + 1) && (!(brightness || other) || !matches(i + 1, TRUST_LINE_STARTS)) ? [i + 1] : []);
    const trust = brightness ? sheet.flatMap((line, i) => TRUST_LINE_STARTS.some((start) => line.startsWith(start)) ? [i + 1] : []) : other ? (difference ? [TRUST_LINE_STARTS[0], TRUST_LINE_STARTS[2]] : [TRUST_LINE_STARTS[2]]).flatMap((start) => sheet.flatMap((line, i) => line.startsWith(start) && (start !== TRUST_LINE_STARTS[0] || /\bbelow 1\b/i.test(line)) ? [i + 1] : [])) : [];
    return { lines, trust };
}
export function joinRows(sheet: string[], lines: number[]): string
{
    return lines.map((n) => {
        const line = sheet[n - 1]!;
        return /[.!?]$/.test(line) ? line : `${line}.`;
    }).join(' ');
}
export function factSheet(f: InsightFacts): string[]
{
    const name = TARGETS.find((t) => t.id === f.targetId)?.name;
    const times = f.visits.map((v) => v.mjd);
    const match = name?.match(/^(\w+) J(\d{4}\d*(?:\.\d+)?)([-+−])(\d{4}\d*(?:\.\d+)?)$/i);
    const short = match ? `, also written ${match[1]} ${match[2]!.slice(0, 4)}${match[3]}${match[4]!.slice(0, 4)}` : '';
    const frames = f.visits.map((v) => v.frames === 500 ? 'at least 500' : String(v.frames)).join(', ');
    const span = f.visits.length > 1 ? ` Time from first to last visit: ${(Math.max(...times) - Math.min(...times)).toFixed(1)} days.` : '';
    const lines = [`Target: ${name ?? 'a position typed in by the visitor'}${short}.`, `Position: RA ${f.ra.toFixed(4)} deg, Dec ${f.dec.toFixed(4)} deg.`, `Wavelength: ${f.lambdaUm.toFixed(3)} micron.`, `Visits: ${f.visits.length >= 12 ? 'at least 12' : f.visits.length}. Frames in each visit: ${frames}.${span}`];
    if (f.lightCurve) {
        const lc = f.lightCurve;
        const kept = lc.points.filter((p) => p.snr >= 1);
        const values = kept.sort((a, b) => a.mjd - b.mjd).map((p) => p.relative);
        if (values.length >= 2) {
            const sorted = [...values].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
            lines.push(`Brightness relative to the reference stars, in time order: ${values.map((n) => n.toFixed(2)).join(', ')}.${kept.length < lc.points.length ? ' Points too faint to measure are left out.' : ''}`);
            if (values.length >= 3 && median !== 0) {
                const below = median - sorted[0]!;
                const above = sorted[sorted.length - 1]! - median;
                // Compare the printed percents: 0.81, 1.00, 1.19 is a tie.
                const down = (below / median * 100).toFixed(0);
                const up = (above / median * 100).toFixed(0);
                const amount = below > above ? down : up;
                const description = amount === '0' ? 'less than 1 percent' : `${amount} percent ${down === up ? 'either side' : below > above ? 'below it' : 'above it'}`;
                lines.push(`Largest change from the median brightness: ${description}.`);
            }
        }
        const snr = Math.min(...lc.points.map((p) => p.snr));
        const flooredSnr = Math.floor(snr);
        const snrText = snr < 1 ? 'below 1' : flooredSnr > 100 ? 'more than 100' : String(flooredSnr);
        const scatter = lc.refScatter.filter(Number.isFinite);
        lines.push(`Lowest signal-to-noise among the points: ${snrText}. This counts sky noise only, so the real uncertainty is larger.`, scatter.length ? `Reference stars: ${scatter.length} with available scatter. Scatter of each: ${scatter.map((n) => (n * 100).toFixed(1)).join(', ')} percent.` : 'Reference stars: scatter unavailable.', `Frames left out because their wavelength did not match: ${lc.dropped}.`);
    }
    if (f.difference) {
        const peak = Math.abs(f.difference.peakSigma);
        if (peak.toFixed(1) === '0.0') {
            lines.push('Difference image at the target: no change above the noise.');
        } else {
            const value = Number(peak.toFixed(1)) > 100 ? 'more than 100' : peak.toFixed(1);
            const caution = Number(peak.toFixed(1)) >= 5 ? ' A bright star leaves marks this strong from a tiny misalignment, and a star that moved leaves a bright side and a dark side.' : '';
            lines.push(`Difference image at the target: strongest pixel ${value} sigma, ${f.difference.peakSigma >= 0 ? 'brighter' : 'fainter'} there in the later visit.${caution}`);
        }
    }
    if (f.motion) {
        const shift = f.motion.arcsec.toFixed(1);
        lines.push(`Shift in position: ${shift === '0.0' ? 'none measured' : `${shift} arcsec`} over ${f.motion.days.toFixed(1)} days.`);
    }
    lines.push(`Frames came from: ${f.snapshot ? 'a saved copy' : "NASA's live archive"}.`);
    return lines;
}
type Bound = 'min' | 'max' | undefined;
type NumberFact = { value: number; printed: string; integer: boolean; unit: string; words: RegExp; nouns?: RegExp; required?: RegExp; bound?: Bound; boundText?: string; constant?: boolean; medianDirection?: 'above' | 'below' | 'either' | 'less'; scatter?: { count: string; values: string[] }; snr?: string; readings?: string[]; frames?: boolean };
function medianSentence(value: string, fact: NumberFact): boolean
{
    const referent = '(?:it|the median|its median)';
    const ending = fact.medianDirection === 'less' ? `less than 1 percent(?: from ${referent})?`
        : fact.medianDirection === 'either' ? `${fact.value} percent either side(?: of ${referent})?`
        : `${fact.value} percent ${fact.medianDirection} ${referent}`;
    return new RegExp(`^(?:the|its) largest change from (?:the|its) median(?: brightness)? (?:is|was) ${ending}\\.$`, 'i').test(value.trim());
}
function scatterSentence(value: string, scatter: NonNullable<NumberFact['scatter']>): boolean
{
    if (!scatter.count) { return false; }
    const escaped = scatter.values.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const list = escaped.length === 1 ? escaped[0] : `${escaped.slice(0, -1).join(', ')}(?:${escaped.length > 2 ? ',?' : ''} and|,) ${escaped[escaped.length - 1]}`;
    const singular = scatter.count === '1';
    return new RegExp(`^the(?: ${scatter.count})? (?:reference|comparison) ${singular ? 'star (?:scatters by|has a scatter of)' : 'stars (?:scatter by|have a scatter of)'} ${list} percent\\.$`, 'i').test(value.trim());
}
// The direction of a bound written just before a number: "more than 100" is a floor, "below 1" a ceiling.
function boundBefore(text: string, ai: boolean): Bound
{
    if (ai && /\bno more than\s*$/i.test(text)) { return 'max'; }
    if (ai && /\bno (?:fewer|less) than\s*$/i.test(text)) { return 'min'; }
    if ((ai ? /\b(?:more than|over|above|greater than|higher than|exceeds?|exceeding|in excess of|at least|no fewer than|no less than|a minimum of)\s*$/i : /\b(?:more than|at least)\s*$/i).test(text)) { return 'min'; }
    if ((ai ? /\b(?:below|under|less than|lower than|fewer than|smaller than|at most|no more than|a maximum of|up to|as many as|as few as|nearly|almost|close to|roughly|about|around|approximately|some)\s*$/i : /\b(?:below|less than)\s*$/i).test(text)) { return 'max'; }
    return undefined;
}
const countNouns: [RegExp, RegExp, RegExp?][] = [
    [/^Visits$/i, /^(?:visits?|epochs?|passes?|observations?)$/i],
    [/^Frames in each visit$/i, /^(?:frames?|images?|exposures?)$/i, /\b(?:visits?|each|per|every)\b/i],
    [/^Frames left out\b/i, /^(?:frames?|images?|exposures?)$/i, /left out|exclud|discard|remov|dropp|skipp|mismatch|not match|did not match|too far/i],
    [/^Reference stars$/i, /^(?:stars?|references?|comparisons?)$/i],
];
const meanings: [RegExp, string][] = [
    [/^Position\b/i, 'position|coordinat|located|lies|sits|centred|centered|ra(?!\\p{L})|dec(?!\\p{L})|right ascension|declination'],
    [/^Wavelength\b/i, 'wavelength|micron|µm|um(?!\\p{L})|band|channel|colour|color|infrared'],
    [/^Visits\b/i, 'visit|epoch|pass|return|observ'],
    [/^Frames in each visit\b/i, 'frame|image|exposure'],
    [/^Time from first to last visit\b/i, 'visit|span|apart|baseline|over|across|within|between|period|separat|later|after|first|last|cover|shift|mov'],
    [/^Brightness relative\b/i, 'bright|flux|relative|ratio|level|value|reading|measure|point|went|rise|rose|climb|drop|fell|fall|dip|chang|from|increas|decreas|dim|fade|light'],
    [/^Largest change\b/i, 'chang|differ|bright|dim|faint|fade|fading|rise|rose|drop|fell|fall|dip|swing|jump|median|largest|peak|increas|decreas|light|went|up(?!\\p{L})|down|above it|below it|either side|grew|gain|lost|vari'],
    [/^Lowest signal-to-noise\b/i, 'signal|noise|s/n|snr'],
    [/^Reference stars\b/i, 'reference|comparison|control|star'],
    [/^Scatter of each\b/i, 'scatter|spread|reference|comparison|control|steady|stable'],
    [/^Frames left out\b/i, 'left out|exclud|discard|remov|dropp|skipp|mismatch|not match|did not match|too far'],
    [/^Difference image\b/i, 'differenc|subtract|residual|sigma|σ|significan|image|standard deviation'],
    [/^Shift in position\b/i, 'shift|mov|motion|position|drift|displac|travel|cross|slid|proper'],
];
const numberList = /(?<![\w.])[-−]?\d+(?:\.\d+)?(?:\s*(?:,\s*(?:(?:and|or)\s+)?|\s+(?:and\s+then|and|or|to|then)\s+)[-−]?\d+(?:\.\d+)?)*/g;
const unitAtStart = /^\s*-?\s*(percent\b|per\s+cent\b|%|micrometres?\b|micrometers?\b|microns?\b|µm\b|um\b|arcseconds?\b|arcsec\b|″|degrees?\b|deg\b|°|standard\s+deviations?\b|sigma\b|σ|days?\b)/i;
function normalizedUnit(unit: string): string
{
    const value = unit.toLowerCase();
    if (value === '%' || value === 'percent' || /^per\s+cent$/.test(value)) { return 'percent'; }
    if (/^(micron|micromet|µm|um)/.test(value)) { return 'micron'; }
    if (/^(arcsec|″)/.test(value)) { return 'arcsec'; }
    if (/^(deg|°)/.test(value)) { return 'deg'; }
    if (/^(sigma|σ|standard)/.test(value)) { return 'sigma'; }
    if (/^day/.test(value)) { return 'days'; }
    return '';
}
function lists(value: string): { start: number; end: number; values: string[]; unit: string; follower: string }[]
{
    return Array.from(value.matchAll(numberList)).map((match) => {
        const raw = match[0].trimEnd();
        const end = match.index + raw.length;
        const after = value.slice(end);
        const unit = after.match(unitAtStart)?.[1] ?? '';
        return { start: match.index, end, values: raw.match(/[-−]?\d+(?:\.\d+)?/g) ?? [], unit: normalizedUnit(unit), follower: after };
    });
}
function sheetFacts(sheet: string[]): NumberFact[]
{
    const result: NumberFact[] = [];
    for (const line of sheet) {
        const segments = Array.from(line.matchAll(/(?:^|\.\s+)([^:]+):\s*(.*?)(?=\.\s+[A-Za-z][^:]*:|\.$|$)/g));
        for (const segment of segments) {
            const label = segment[1]!.trim();
            if (/^Target$/i.test(label)) { continue; }
            const stems = meanings.find(([pattern]) => pattern.test(label))?.[1] ?? (label.match(/[a-z]{4,}/gi) ?? []).join('|');
            if (!stems) { continue; }
            const words = new RegExp(`(?:^|[^\\p{L}])(?:${stems})`, 'iu');
            const count = countNouns.find(([pattern]) => pattern.test(label));
            const direction = /^Largest change from the median brightness$/i.test(label) ? segment[2]!.match(/(?:\b(above|below) it|\b(either) side|\b(less) than\s+1 percent)\.?$/i) : null;
            const medianDirection = (direction?.[1] ?? direction?.[2] ?? direction?.[3])?.toLowerCase() as NumberFact['medianDirection'];
            for (const list of lists(segment[2]!)) {
                const bound = boundBefore(segment[2]!.slice(0, list.start), true);
                const boundText = segment[2]!.slice(0, list.start).match(/\b(?:more than|at least|below|less than|nearly|almost|close to|roughly|about|around|approximately|some|a minimum of|a maximum of|up to|as many as|as few as|no more than|no fewer than|no less than|at most)\s*$/i)?.[0].trim().toLowerCase();
                const scatterCount = line.match(/^Reference stars:\s*(\d+) with available scatter\./i)?.[1];
                const scatter = /^Scatter of each$/i.test(label) ? { count: scatterCount ?? '', values: list.values } : undefined;
                const snr = /^Lowest signal-to-noise\b/i.test(label) ? segment[2]!.match(/^(?:(?:below|more than|at least|less than)\s+)?\d+(?:\.\d+)?/i)?.[0] : undefined;
                const readings = /^Brightness relative\b/i.test(label) ? list.values : undefined;
                list.values.forEach((value, i) => { result.push({ value: Number(value.replace('−', '-')), printed: value, integer: !value.includes('.'), unit: list.unit, words, nouns: count?.[1], required: count?.[2], bound: i === 0 ? bound : undefined, boundText: i === 0 ? boundText : undefined, medianDirection, scatter, snr, readings, frames: /^Frames in each visit$/i.test(label) }); });
            }
        }
    }
    for (const entry of CONSTANT_CONTEXT) {
        const context = entry.context.source;
        const noun = entry.context.test('micron') ? 'micron' : 'arcsec';
        result.push({ value: entry.value, printed: String(entry.value), integer: Number.isInteger(entry.value), unit: noun === 'micron' || noun === 'arcsec' ? noun : '', words: new RegExp(context, 'i'), constant: true });
    }
    return result;
}
// Context matching cannot detect a real number moved to the wrong subject with the same words.
// The server always uses labelled: true; the default preserves the older second-layer checks.
export function checkNote(text: string, sheet: string[], opts: { labelled?: boolean } = {}): { text: string; dropped: number }
{
    if (text.length > 8000) {
        const prefix = text.slice(0, 8000);
        const ends = [...text.slice(0, 8001).matchAll(/(?<!\b(?:viz|e\.g|i\.e|approx|cf|vs|etc))[.!?](?=\s)/gi)];
        text = ends.length ? prefix.slice(0, ends[ends.length - 1]!.index! + 1) : '';
    }
    const facts = sheetFacts(sheet);
    const visitCount = Number(sheet.join('\n').match(/^Visits:\s*(?:at least\s+)?(\d+)\./m)?.[1] ?? 3);
    const exactLine = sheet.join('\n').match(/^Visits:\s*(\d+)\./m)?.[1];
    const exactVisits = exactLine === undefined ? null : Number(exactLine);
    const target = sheet.join('\n').match(/^Target:\s*(.+)\.$/m)?.[1];
    const dash = '[-\\u2010-\\u2015\\u2212]';
    const names: string[] = [];
    if (target) {
        for (const name of target.split(/,\s*also written\s*/i)) {
            const variants = [name, name.replace(/\bJ(?=\d)/i, ''), name.replace(/(\s)(?=\d)/, '$1J')];
            for (const variant of variants) {
                names.push(variant);
                const prefix = variant.split(new RegExp(dash))[0]!.trim();
                if (prefix.length >= 4 && prefix !== variant) { names.push(prefix); }
                // The designation alone, without the catalogue word. Its own prefixes are not names: "0855" is a number.
                const bare = variant.replace(/^[A-Za-z]+\s+(?=J?\d)/, '');
                if (bare !== variant && bare.length >= 8) { names.push(bare); }
            }
        }
    }
    const escapedNames = [...new Set(names)].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(new RegExp(dash, 'g'), dash));
    const namePattern = escapedNames.length ? new RegExp('(?<!\\w)(?:' + escapedNames.join('|') + ')(?!\\w)', 'gi') : undefined;
    const foreign = /^(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|weeks?|months?|nm|mm|cm|metres?|meters?|kilometres?|kilometers?|miles?|arcmin|arcminutes?|mas|milliarcsec(?:onds?)?|radians?|celsius|fahrenheit|kg|grams?|watts?|hz|ev|photons?|electrons?|counts?|pixels?|times|x|trillion)\b/i;
    const countingNoun = /^(?:visits?|epochs?|passes?|frames?|images?|exposures?|points?|readings?|values?|measurements?|observations?|stars?|references?|comparisons?|channels?|bands?|colours?|colors?|wavelengths?|detectors?|times?)$/i;
    const frameValues = sheet.join(' ').match(/Frames in each visit:\s*([^.]*)/i)?.[1]?.match(/\d+/g) ?? [];
    const equalFrames = frameValues.length > 0 && frameValues.every((item) => item === frameValues[0]);
    const change = sheet.join(' ').match(/Largest change from the median brightness:\s*(less than 1|\d+(?:\.\d+)?) percent/i)?.[1];
    const scatterText = sheet.join(' ').match(/Scatter of each:\s*([\d.,\s]+)\s*percent/i)?.[1];
    const scatterValues = scatterText?.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const readingValues = facts.find((fact) => fact.readings)?.readings ?? [];
    const hasShift = sheet.some((line) => /^Shift in position:\s*\d/i.test(line));
    const referenceLine = sheet.find((line) => /^Reference stars:/i.test(line));
    const noReferences = !referenceLine || /^Reference stars:\s*(?:0\b|none\b)/i.test(referenceLine);
    const noScatter = Boolean(referenceLine && /^Reference stars:\s*scatter unavailable\b/i.test(referenceLine));
    const hasChange = sheet.some((line) => /^(?:Brightness relative to the reference stars, in time order|Difference image at the target):/i.test(line));
    const differenceLine = sheet.find((line) => /^Difference image at the target:/i.test(line));
    const caution = differenceLine?.match(/^Difference image at the target: .+?\.\s+(.+\.)$/i)?.[1];
    const changeSeen = Boolean((change && change !== 'less than 1') || (readingValues.length === 2 && Number(readingValues[0]) !== Number(readingValues[1])) || (differenceLine && !/no change above the noise/i.test(differenceLine)));
    // A difference line counts as a notable change only at 3 sigma or more. The bar is ours: a weaker strongest pixel is what noise alone gives.
    const differenceSigma = differenceLine?.match(/strongest pixel (more than 100|\d+(?:\.\d+)?) sigma/i)?.[1];
    const differenceNotable = Boolean(differenceSigma && (differenceSigma === 'more than 100' || Number(differenceSigma) >= 3));
    const brightnessSeen = Boolean((change && change !== 'less than 1') || (readingValues.length === 2 && Number(readingValues[0]) !== Number(readingValues[1])));
    const firstReading = Number(readingValues[0]);
    const changePercent = change ? (change === 'less than 1' ? null : Number(change)) : readingValues.length === 2 && firstReading > 0 ? Math.abs(Number(readingValues[1]) - firstReading) / Math.abs(firstReading) * 100 : null;
    const changeNotable = differenceNotable || (brightnessSeen && (!scatterValues.length || (changePercent !== null && changePercent > Math.max(...scatterValues) + 1e-10)));
    // An endpoint sentence hides a middle reading that lies outside the endpoints.
    const endsHide = readingValues.length > 2 && readingValues.slice(1, -1).map(Number).some((v) => v > Math.max(Number(readingValues[0]), Number(readingValues.at(-1))) || v < Math.min(Number(readingValues[0]), Number(readingValues.at(-1))));
    const fewer = sheet.some((line) => /Points too faint to measure are left out/i.test(line));
    let medianKept = false;
    let scatterKept = false;
    const hasTwoVisits = /^Visits:\s*(?:at least\s+)?(\d+)\./im.exec(sheet.join('\n'));
    function nextForm(value: string): boolean
    {
        const sentence = value.toLowerCase();
        if (sentence === 'wait for another visit to see whether the change repeats.' || sentence === 'change the colour to see whether the change shows at another wavelength.') { return hasChange && changeNotable; }
        if (sentence === 'compare the target with the reference stars in the same frames.') { return /^Reference stars:\s*[1-9]\d* with available scatter\b/i.test(referenceLine ?? ''); }
        if (sentence === 'look at subtract to see what is left at the target.') { return Boolean(hasTwoVisits && Number(hasTwoVisits[1]) >= 2); }
        return [
            'switch on flagged pixels to see whether one sits on the target.',
            'step through the frames in blink to see whether one frame stands out.',
            'switch on brightest gaia stars to see whether a catalogue star lies at the target.',
            'change the colour to look at another wavelength.',
        ].includes(sentence);
    }
    function readingForm(value: string, values: string[]): boolean
    {
        const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const lead = exactVisits === null || fewer ? '' : `(?:over ${exactVisits} visits,? )?`;
        const first = values[0]!;
        const last = values[values.length - 1]!;
        const all = values.length === 2 ? `${escape(first)},? (?:and )?${escape(last)}` : `${values.slice(0, -1).map(escape).join(', ')}(?:,? and|,) ${escape(last)}`;
        if (new RegExp(`^${lead}in time order,? the brightness (?:relative to the reference stars )?(?:is|was|reads|read) ${all}\\.$`, 'i').test(value)) { return true; }
        const ends = value.match(new RegExp(`^${lead}the brightness went from ${escape(first)} to ${escape(last)}(?: (?:between|from) the first (?:visit )?(?:and|to) the last(?: visit)?)?\\.$`, 'i'));
        if (ends && Number(first) !== Number(last)) {
            return !endsHide;
        }
        const rank = value.match(new RegExp(`^${lead}the (first|last|highest|lowest) reading (?:is|was) (-?\\d+(?:\\.\\d+)?)\\.$`, 'i'));
        if (rank) {
            const key = rank[1]!.toLowerCase();
            if (endsHide && (key === 'first' || key === 'last')) { return false; }
            const extreme = key === 'highest' ? Math.max(...values.map(Number)) : Math.min(...values.map(Number));
            const expected = key === 'first' ? first : key === 'last' ? last : values.find((v) => Number(v) === extreme);
            return rank[2] === expected && (key === 'first' || key === 'last' || values.filter((v) => Number(v) === extreme).length === 1);
        }
        return first === last && !endsHide && new RegExp(`^${lead}the first and last readings are (?:both|the same,) ${escape(first)}\\.$`, 'i').test(value);
    }
    function directionInvalid(value: string): boolean
    {
        const verdict = /\b(?:variable|variability|var(?:y|ies|ied|ying)|real|genuine|intrinsic\w*|astrophysical|active|activity|certain(?:ly)?|definite(?:ly)?|evidence|significan\w*|confirm\w*|flare\w*|flaring|outburst\w*|burst\w*|erupt\w*|pulsat\w*|eclips\w*|occult\w*|microlens\w*|transit\w*|companion\w*|\w*planet\w*|binary|supernova\w*|nova\w*|quasar\w*|agn|periodic\w*|detected|detection\w*|proves|proof)\b|\bnot\s+(?:an?\s+)?(?:noise|artefact|artifact|chance)\b/i;
        if (verdict.test(value)) { return true; }
        if (readingValues.length >= 2 && readingForm(value, readingValues)) { return false; }
        if (/^the change is (?:several times larger than|larger than|no larger than) that scatter(?:, so it may be noise)?\.$|^there are no reference stars to compare the change with(?:, so the change counts for little)?\.$|^the reference stars' scatter is unavailable, so there is nothing to compare the change with(?:, so the change counts for little)?\.$/i.test(value)) { return false; }
        value = value.replace(/\b(?:brighter|fainter)(?: there)? in the later visit\b|\bno change above the noise\b/gi, '');
        if (/\b(?:mov(?:ed|es|ing)|shift(?:ed|s|ing)|drift(?:ed|s|ing)|motion|displaced|wander\w*|travel\w*|position changed)\b/i.test(value) && !hasShift) { return true; }
        if (/\b(?:scatter|noise|noisy|errors?)\b/i.test(value) && /\b(?:target|itself|object)\b|(?<!reference )(?<!comparison )\bstar\b/i.test(value)) { return true; }
        const up = /\b(?:rose|rises?|risen|rising|increas\w*|brighten\w*|brighter|climb\w*|grew|grow\w*|gain\w*|jump\w*|spik\w*|surg\w*|soar\w*|strengthen\w*|peak\w*|went up|go(?:es)? up)\b/i.test(value);
        const down = /\b(?:fell|falls?|falling|fallen|drop\w*|decreas\w*|fad(?:e|ed|es|ing)|fainter|dimm\w*|darken\w*|weaken\w*|declin\w*|dip\w*|lost|loss|went down|go(?:es)? down)\b/i.test(value);
        const negated = /\b(?:not|no|never|nothing|neither|nor|without)\b|n't\b/i.test(value);
        const level = /\b(?:level|flat|steady|stable|unchanged|constant|stayed|held|stayed the same|the same at every \w+)\b/i.test(value) || (negated && /\b(?:chang\w*|var\w*)\b/i.test(value));
        if (!up && !down && !level) { return false; }
        if (negated && (up || down)) { return true; }
        if (readingValues.length < 2 || !scatterValues.length || (up && down) || (level && (up || down))) { return true; }
        const readings = readingValues.map(Number);
        const first = readings[0]!;
        const last = readings[readings.length - 1]!;
        if (Math.min(...readings) <= 0) { return true; }
        const percent = (last - first) / first * 100;
        const scatter = Math.max(...scatterValues);
        if (up) { return !(percent > scatter); }
        if (down) { return !(-percent > scatter); }
        const range = (Math.max(...readings) - Math.min(...readings)) / Math.min(...readings) * 100;
        return range > scatter || range > 1 + 1e-10;
    }
    function comparisonInvalid(value: string): boolean
    {
        if (sheet.some((line) => {
            const difference = line.match(/^Difference image at the target: (.+?\.)(?:\s|$)/i)?.[1];
            return difference && value.toLowerCase() === `difference image at the target: ${difference}`.toLowerCase();
        })) { return false; }
        if (noReferences && /^there are no reference stars to compare the change with(?:, so the change counts for little)?\.$/i.test(value)) { return false; }
        if (noScatter && /^the reference stars' scatter is unavailable, so there is nothing to compare the change with(?:, so the change counts for little)?\.$/i.test(value)) { return false; }
        if (/^(?:the|its) largest change from (?:the|its) median\b/i.test(value)) { return false; }
        const scatterWord = /\b(?:scatter|spread|reference[\s-]stars?|references|comparison(?:[\s-]stars?)?|other stars|neighbou?rs?|(?<!signal-to-)noise|errors?|uncertaint\w*|precision|jitter|wobble|chance)\b/i.test(value);
        const changeWord = /\b(?:change|rise|fall|drop|dip|jump|signal(?![\s-]+to[\s-]+noise)|difference|variation|brightening|fading|dimming)\b|\b(?:target|star|brightness)\b.*\b(?:var(?:y|ies|ied)|changed)\b/i.test(value);
        const comparative = /\b(?:larger|smaller|bigger|greater|less|more|times|beyond|within|exceeds?|above|below|clear|compared|comparable|similar|dwarfs?|towers?|lost|buried|swamp\w*|drown\w*|size)\b|\bmay be noise\b/i.test(value);
        if (!(scatterWord && (changeWord || comparative)) && !(changeWord && comparative)) { return false; }
        if (noReferences || noScatter) { return true; }
        if (!change || !scatterValues.length) { return true; }
        const c = change === 'less than 1' ? 1 : Number(change);
        const s = Math.max(...scatterValues);
        if (/^the change is several times larger than that scatter\.$/i.test(value)) { return change === 'less than 1' || c < 3 * s; }
        if (/^the change is no larger than that scatter, so it may be noise\.$/i.test(value)) { return change === 'less than 1' ? s < 1 : c > s; }
        if (/^the change is larger than that scatter\.$/i.test(value)) { return change === 'less than 1' || c <= s; }
        return true;
    }
    // Closed forms are constructed from printed facts, never from a number found elsewhere on the sheet.
    function closedForm(value: string): boolean
    {
        if (/^this is a candidate only\.$/i.test(value)) { return changeNotable || hasShift; }
        if (readingValues.length >= 2 && readingForm(value, readingValues)) { return true; }
        if (facts.some((fact) => fact.medianDirection && medianSentence(value, fact))) { return true; }
        if (facts.some((fact) => fact.scatter && scatterSentence(value, fact.scatter))) { return true; }
        if (/^the change is (?:several times larger than that scatter|larger than that scatter|no larger than that scatter, so it may be noise)\.$/i.test(value)) { return medianKept && scatterKept && !comparisonInvalid(value); }
        if (/^there are no reference stars to compare the change with(?:, so the change counts for little)?\.$/i.test(value)) { return noReferences && changeSeen; }
        if (/^the reference stars' scatter is unavailable, so there is nothing to compare the change with(?:, so the change counts for little)?\.$/i.test(value)) { return noScatter && changeSeen; }
        if (/^there are fewer than 3 visits, so the change counts for little\.$/i.test(value)) { return exactVisits !== null && exactVisits < 3 && changeSeen; }
        const snr = sheet.join('\n').match(/^Lowest signal-to-noise among the points:\s*((?:(?:below|more than) )?\d+(?:\.\d+)?)\./im)?.[1];
        if (/^the lowest signal-to-noise is small, so the change counts for little\.$/i.test(value)) { return changeSeen && Boolean(snr && (snr === 'below 1' || (!snr.includes('than') && Number(snr) < 3))); }
        if (/^there is nothing measured to interpret yet\.$/i.test(value)) { return !sheet.some((line) => /^(?:Brightness relative to the reference stars, in time order|Difference image at the target|Shift in position):/i.test(line)); }
        const forms: string[] = [];
        if (snr) { forms.push(`The lowest signal-to-noise among the points is ${snr}.`); }
        for (const line of sheet) {
            const wavelength = line.match(/^Wavelength: (.+)\.$/i)?.[1];
            if (wavelength) { forms.push(`The wavelength is ${wavelength}.`); }
            const visit = line.match(/^Visits: (.+?)\. Frames in each visit: (.+?)\.(?: Time from first to last visit: (.+?)\.)?$/i);
            if (visit) {
                forms.push(visit[1] === '1' ? 'There was 1 visit.' : `There were ${visit[1]} visits.`, `The frames in each visit were ${visit[2]}.`);
                if (visit[3]) { forms.push(`The time from first to last visit was ${visit[3]}.`); }
            }
            const left = line.match(/^Frames left out because their wavelength did not match: (.+)\.$/i)?.[1];
            if (left) { forms.push(`Frames left out because their wavelength did not match: ${left}.`); }
            const shift = line.match(/^Shift in position: (.+)\.$/i)?.[1];
            if (shift) { forms.push(`The shift in position was ${shift}.`); }
            const difference = line.match(/^Difference image at the target: (.+?\.)(?:\s|$)/i)?.[1];
            if (difference) { forms.push(`Difference image at the target: ${difference}`); }
            if (difference && caution) { forms.push(caution); }
            const position = line.match(/^Position: (.+)\.$/i)?.[1];
            if (position) { forms.push(`The position is ${position}.`); }
            const targetName = line.match(/^Target: (.+)\.$/i)?.[1];
            if (targetName) { forms.push(`The target is ${targetName}.`); }
            const source = line.match(/^Frames came from: (.+)\.$/i)?.[1];
            if (source) { forms.push(`The frames came from ${source}.`); }
        }
        return forms.some((form) => form.toLowerCase() === value.toLowerCase());
    }
    function unsupportedNumbers(value: string): boolean
    {
        for (const list of lists(value)) {
            const before = value.slice(0, list.start).match(/[\p{L}]+(?:\/[\p{L}]+)?|[%″°]/gu) ?? [];
            const after = value.slice(list.end).match(/[\p{L}]+(?:\/[\p{L}]+)?|[%″°]/gu) ?? [];
            const context = [...before.slice(-8), ...after.slice(0, 3)].join(' ');
            const follower = list.follower.trimStart().replace(/^-\s*/, '');
            const nounFollower = follower;
            const followingWords = nounFollower.match(/^[a-z]+(?:-[a-z]+)*(?:\s+[a-z]+(?:-[a-z]+)*)?/i)?.[0].split(/\s+/) ?? [];
            const referenceCount = /\breference stars,?\s*$/i.test(value.slice(0, list.start)) && /^with available scatter\b/i.test(follower);
            const frameList = /^the frames in each visit were /i.test(value) && closedForm(value);
            const frameLeft = /^frames left out because their wavelength did not match:/i.test(value) && closedForm(value);
            const noun = referenceCount ? 'stars' : frameList || frameLeft ? 'frames' : list.unit ? undefined : countingNoun.test(followingWords[0] ?? '') ? followingWords[0] : /^(?:in|on|at|by|over|under|above|below|across|through|from|to|of|for|and|or|the)$/i.test(followingWords[0] ?? '') ? undefined : countingNoun.test(followingWords[1] ?? '') ? followingWords[1] : undefined;
            const prefix = value.slice(0, list.start);
            const lead = boundBefore(prefix, true);
            const unitlessBlocked = Boolean(list.unit) || /^[°′″$€£±×^/]/.test(follower) || /^[A-Z]/.test(follower) || foreign.test(follower);
            for (const [index, raw] of list.values.entries()) {
                const val = Number(raw.replace('−', '-'));
                const bound = index === 0 ? lead : undefined;
                const integer = !raw.includes('.');
                if (integer && !lead && !/^\s*(?:detectors?|colou?rs?|channels?|bands?|wavelengths?)?\s*(?:or more|or fewer|or less|and more|plus)\b/i.test(follower) && MISSION_COUNTS.some((entry) => entry.value === val && entry.nouns.test(follower))) { continue; }
                if (!facts.some((fact) => {
                    if (/\b(?:signal[\s-]+to[\s-]+noise|s\/n|snr)\b/i.test(value) && !fact.snr) { return false; }
                    if (fact.bound && fact.bound !== bound) { return false; }
                    const initialOver = /^over\s*$/i.test(prefix) && /^(?:days?|visits?)\s*(?:,|(?:the|its|this)\s+[a-z]+)/i.test(follower);
                    const preposition = /\b(?:\d+(?:\.\d+)?|days?|arcsec(?:onds?)?|visits?|frames?|points?|readings?|observations?)\s+over\s*$/i.test(prefix) || initialOver;
                    const overUnit = fact.unit === 'days' || Boolean(noun && /^(?:visits?|epochs?|passes?|observations?)$/i.test(noun));
                    if (bound && !fact.bound && !(preposition && overUnit)) { return false; }
                    const noteBound = prefix.match(/\b(?:more than|at least|below|less than|nearly|almost|close to|roughly|about|around|approximately|some|a minimum of|a maximum of|up to|as many as|as few as|no more than|no fewer than|no less than|at most)\s*$/i)?.[0].trim().toLowerCase();
                    if ((noteBound && (index === 0 || !frameList) && noteBound !== fact.boundText) || /^\s*(?:(?:reference|comparison)\s+)?(?:frames?|images?|observations?|epochs?|points?|stars?|visits?|days?|arcsec(?:onds?)?|percent|microns?|um|deg|sigma)?\s*(?:or more|or fewer|or less|and more|plus|or so|at most|at least)\b/i.test(follower)) { return false; }
                    if (fact.value !== val || (fact.printed !== raw && !(fact.constant && fact.value === 5 && raw === '5.0')) || !fact.words.test(fact.required && noun ? value : context)) { return false; }
                    if (fact.constant && facts.some((other) => !other.constant && other.unit === list.unit && other.value === val && other.printed !== raw) && !/\b(?:helium|hydrogen|water|ice|pahs|carbon dioxide|carbon monoxide)\b/i.test(context)) { return false; }
                    if (fact.scatter && !scatterSentence(value, fact.scatter)) { return false; }
                    if (fact.medianDirection && !medianSentence(value, fact)) { return false; }
                    if (fact.frames && /\b(?:each|every|per)\s+visit\b/i.test(value) && !equalFrames && !frameList) { return false; }
                    if (fact.nouns && !noun) { return false; }
                    if (noun && (!fact.nouns?.test(noun) || (fact.required && !fact.required.test(value)))) { return false; }
                    if (fact.unit) { return list.unit === fact.unit; }
                    if (unitlessBlocked) { return false; }
                    if (fact.snr && value.toLowerCase() !== `the lowest signal-to-noise${/among the points/i.test(value) ? ' among the points' : ''} ${/\bwas\b/i.test(value) ? 'was' : 'is'}${/\bonly\b/i.test(value) ? ' only' : ''} ${fact.snr.toLowerCase()}.`) { return false; }
                    if (fact.readings && !readingForm(value, fact.readings)) { return false; }
                    return true;
                })) { return true; }
            }
        }
        const fromTo = value.match(/\bfrom\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)/i);
        if (fromTo && (/\b(?:rose|rise|increased|brightened|climbed|grew|up)\b/i.test(value) && Number(fromTo[2]) <= Number(fromTo[1]) || /\b(?:fell|dropped|decreased|faded|dimmed|declined|down)\b/i.test(value) && Number(fromTo[2]) >= Number(fromTo[1]))) { return true; }
        return false;
    }
    function invalid(value: string): boolean
    {
        if (/[<>]|:\/\/|www\./i.test(value) || (/\d/.test(value) && /\b(?:years?|yrs?|yearly|annual|annually|annum|decade|century)\b/i.test(value))) { return true; }
        if (namePattern) { value = value.replace(namePattern, 'NAME'); }
        if (/^[\s"'“”‘’\-–—•([{]*\p{Ll}/u.test(value) || comparisonInvalid(value) || directionInvalid(value)) { return true; }
        if (Array.from(value.matchAll(/\b(?:[A-Za-z]+\d\w*|\d+[A-Za-z]\w*)\s+(?:(?:reference|comparison)\s+)?([a-z]+)\b/gi)).some((match) => countingNoun.test(match[1]!))) { return true; }
        if (/\b(?:upwards of|just over|just under|more or less|circa|approx\.?|an estimated|almost exactly|barely|close on|at minimum|at maximum)\s+\d|[~≈≥≤]\s*\d|\d[^.!?]*\b(?:give or take|or thereabouts|maybe more|if not more|or so)\b/i.test(value)) { return true; }
        if (/\b[OBAFGKMLTY]\d(?:\.\d)?(?:IV|I{1,3}|V)?[a-z]*\b/.test(value)) { return true; }
        value = value.replace(/\b(?:CO2|H2O|H2|CH4|2MASS|W[1-4]|DR[1-3]|QR3)\b/gi, 'NAME').replace(/−/g, '-');
        // The sheet gives time in days only and never a magnitude, so any other time unit, or a magnitude, is the
        // model's own knowledge: "about a year", "a fortnight later", "by a full magnitude", "a few months apart".
        if (/\b(?:magnitudes?|mags?|minutes|seconds|hours?|hourly|weeks?|weekly|fortnights?|months?|monthly|years?|yrs?|yearly|annual|annually|decades?|centur(?:y|ies)|millenni(?:um|a))\b/i.test(value)) { return true; }
        // "A degree of caution" is not an angle.
        value = value.replace(/\b(?:a|some|any)\s+degree\s+of\b/gi, 'some');
        const unitWords = '(?:percent|per\\s+cent|%|sigma|σ|standard\\s+deviations?|arcsec(?:onds?)?|″|degrees?|deg|°|microns?|micrometres?|micrometers?|µm|um|days?)';
        if (new RegExp(`\\b(?:a couple|a few|several|a handful|some|many|dozens)(?:\\s+of)?\\s+${unitWords}(?![\\p{L}])`, 'iu').test(value)) { return true; }
        value = value.replace(new RegExp(`\\b(?:one|a|an)(?=[\\s-]+${unitWords}(?![\\p{L}]))`, 'giu'), '1');
        // The prompt's own trust rule, "fewer than 3 visits", is true only when the sheet counts fewer than 3.
        if (exactVisits !== null && exactVisits < 3) { value = value.replace(/\bfewer\s+than\s+(?:3|three)\s+visits\b/gi, 'few visits'); }
        // A name, or any token that mixes letters and digits, is never a quantity: "It moved WISE J085510.83 arcsec."
        for (const token of value.matchAll(/(?<![\w.])(?:NAME|[A-Za-z]+\d\w*(?:\.\d+)?)(?![\w])/g)) {
            const after = value.slice(token.index + token[0].length);
            if (unitAtStart.test(after) || foreign.test(after.trimStart().replace(/^-\s*/, ''))) { return true; }
        }
        const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
        const ordinal = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+visits?\b/gi;
        return /discover/i.test(value)
            || /\b(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)[\s-]+(?:nearest|closest|brightest|faintest|largest|smallest|coldest|coolest|hottest|fastest|most|least)\b/i.test(value)
            || /\b[\p{L}-]*(?:hundredth|thousandth|millionth|billionth)s?\b/iu.test(value)
            || Array.from(value).some((char) => /\p{N}/u.test(char) && !/[0-9]/.test(char))
            || /(?<![0-9])\.\d/.test(value)
            || /\d[eE][\d+-]|\d\s*[/^]\s*\d|\d\s*[-\u2010-\u2015\u2212]\s*\d|\d(?:st|nd|rd|th)\b/i.test(value)
            || /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|dozens?|half|halves|halve|halved|halving|twice|double(?![ -]check)|doubled|doubles|doubling|triple|tripled|triples|tripling|quadruple|quadrupled|quadruples|quadrupling|quarters?|\w+-?fold|(?:a|one)[\s-]+(?:third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?!\s+(?:visit|frame|point|reading|value|epoch|look|pass|image|exposure|time)s?\b)|thirds|fourths|fifths|sixths|sevenths|eighths|ninths|tenths)\b/i.test(value)
            || /\d(?:\.\d+)?(?:\s*|\s*-\s*)(?:light[ -]?years?|ly|pc|parsecs?|kpc|au|km|kelvin|years?|yrs?|myr|gyr|mag|magnitudes?|jy|mjy|solar|jupiter|earth|msun|mjup|rsun|lsun|mass(?:es)?)\b/i.test(value)
            || /\d(?:\.\d+)?(?:\s*|\s*-\s*)K\b/.test(value)
            || /\d\s*\/|\/\s*\d/.test(value)
            || /\d(?:\.\d+)?(?:\s*-?\s*(?:[a-zµ]+|%|″|°|σ))?\s+(?:per|a|an|each|every)\s+(?:days?|visits?|frames?|years?|months?|weeks?|hours?|minutes?|seconds?|epochs?|pixels?|channels?)\b/i.test(sheet.some((line) => /Frames in each visit:/i.test(line)) ? value.replace(/\bframes?\s+(?:per|in each|each|a)\s+visits?\b/gi, 'frames visit') : value)
            || /\d(?:\.\d+)?\s*-?\s*(?:[a-zµ]+|%|″|°|σ)\s*\//i.test(value)
            || /\d(?:\.\d+)?\s+(?:out\s+of|of|in)\s+(?:(?:the|its|their|all|every)\s+)*(?:\d|a\s+kind\b)/i.test(value)
            || /\b(?:factor\s+of|orders?\s+of\s+magnitude)\b/i.test(value)
            || /\b(?:January|February|April|June|July|August|September|October|November|December)\b/i.test(value)
            || /\bMarch\b/.test(value)
            || /(?:\d\s+May\b|\bMay\s+\d)/.test(value)
            || Array.from(value.matchAll(ordinal)).some((match) => ordinals.indexOf(match[1]!.toLowerCase()) + 1 > visitCount
                && !/^\s+(?:would|could|will|should|might)\b/i.test(value.slice(match.index + match[0].length))
                && !/\b(?:would|could|will|should|might|next|later|another|one more|wait|until|await)(?:\s+[\p{L}-]+){0,4}\s*$/iu.test(value.slice(0, match.index)))
            || unsupportedNumbers(value);
    }
    let dropped = 0;
    let count = 0;
    let measuredCount = 0;
    let activeLabel = '';
    const paragraphs: string[] = [];
    const rawLines = text.split(/\r?\n/);
    if (opts.labelled) {
        const groups = new Map<string, { label: string; bodies: string[] }>();
        const preamble: string[] = [];
        let group: { label: string; bodies: string[] } | undefined;
        for (const raw of rawLines) {
            const line = raw.trim();
            if (!line) { continue; }
            const match = line.match(/^(?:\*\*)?(What this shows|How far to trust it|What to check next)\s*(?:\*\*)?\s*:(?:\*\*)?/i);
            if (match) {
                const key = match[1]!.toLowerCase();
                group = groups.get(key);
                if (!group) { group = { label: ({ 'what this shows': 'What this shows:', 'how far to trust it': 'How far to trust it:', 'what to check next': 'What to check next:' } as Record<string, string>)[key]!, bodies: [] }; groups.set(key, group); }
            }
            const body = line.slice(match?.[0].length ?? 0).trim();
            if (body) { (group ? group.bodies : preamble).push(body); }
        }
        rawLines.splice(0, rawLines.length, ...preamble, ...[...groups.values()].map(({ label, bodies }) => `${label} ${bodies.join(' ')}`));
    }
    for (const raw of rawLines) {
        const line = raw.trim();
        if (!line) { continue; }
        const labelMatch = line.match(/^(?:\*\*)?(What this shows|How far to trust it|What to check next)\s*(?:\*\*)?\s*:(?:\*\*)?/i);
        const label = labelMatch ? `${labelMatch[1]}:` : '';
        if (label) { activeLabel = label; }
        const body = line.slice(labelMatch?.[0].length ?? 0).trim();
        const chunks = body.match(/.*?(?:[.!?](?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
        const sentences: string[] = [];
        for (const chunk of chunks) {
            if (sentences.length && /\b(?:viz|e\.g|i\.e|approx|cf|vs|etc)\.$/i.test(sentences[sentences.length - 1]!)) { sentences[sentences.length - 1] += ` ${chunk}`; }
            else { sentences.push(chunk); }
        }
        if (invalid(label)) {
            dropped += sentences.length;
            continue;
        }
        let previousKeptDifference = false;
        const kept = sentences.filter((sentence, index) => {
            const labeled = `${label} ${sentence}`;
            const pairs = [['(', ')'], ['[', ']'], ['{', '}'], ['“', '”']];
            const unbalanced = pairs.some(([left, right]) => sentence.split(left!).length !== sentence.split(right!).length) || (sentence.match(/"/g)?.length ?? 0) % 2 !== 0;
            const closed = /^(?:What this shows|How far to trust it):$/i.test(activeLabel);
            const next = /^What to check next:$/i.test(activeLabel);
            const lower = sentence.toLowerCase();
            const differenceForm = /^difference image at the target:/i.test(sentence);
            const cautionMissing = closed && caution !== undefined && ((differenceForm && sentences[index + 1]?.toLowerCase() !== caution.toLowerCase()) || (lower === caution.toLowerCase() && !previousKeptDifference));
            const sheetWarning = closed && caution !== undefined && lower === caution.toLowerCase() && previousKeptDifference;
            if (!/[.!?]$/.test(sentence) || unbalanced || cautionMissing || (opts.labelled && !activeLabel) || (closed && !closedForm(sentence)) || (next && !nextForm(sentence)) || (!sheetWarning && invalid(sentence)) || (/\d/.test(labeled) && /\b(?:years?|yearly|annual|annually|annum|decade|century)\b/i.test(labeled))) {
                dropped++;
                previousKeptDifference = false;
                return false;
            }
            previousKeptDifference = differenceForm;
            count++;
            if (closed && !/^this is a candidate only\.$/i.test(sentence)) { measuredCount++; }
            if (closed && facts.some((fact) => fact.medianDirection && medianSentence(sentence, fact))) { medianKept = true; }
            if (closed && facts.some((fact) => fact.scatter && scatterSentence(sentence, fact.scatter))) { scatterKept = true; }
            return true;
        });
        if (kept.length) { paragraphs.push([label, ...kept].filter(Boolean).join(' ')); }
    }
    if (count < 2 || (opts.labelled && measuredCount === 0)) { throw new InsightError('unverified'); }
    return { text: paragraphs.join('\n'), dropped };
}
const cache = new Map<string, InsightNote>();
export async function insightStatus(opts: { passcode?: string; fetcher?: typeof fetch } = {}): Promise<InsightStatus>
{
    try {
        const headers: Record<string, string> = {};
        if (opts.passcode !== undefined) { headers['X-Insight-Passcode'] = opts.passcode; }
        const response = await (opts.fetcher ?? fetch)('/api/insight', { headers });
        if (response.status === 429 || (response.status === 503 && (await response.json().catch(() => null))?.error === 'busy')) {
            const raw = response.headers.get('Retry-After');
            return { enabled: true, locked: false, unlocked: false, busy: true, ...(raw !== null && /^\d+$/.test(raw) ? { retryAfter: Number(raw) } : {}) };
        }
        if (!response.ok) { throw new Error('status'); }
        const value: unknown = await response.json();
        if (!value || typeof value !== 'object' || !('enabled' in value) || typeof value.enabled !== 'boolean' || !('locked' in value) || typeof value.locked !== 'boolean' || !('unlocked' in value) || typeof value.unlocked !== 'boolean') { throw new Error('status'); }
        const v = value as InsightStatus;
        return { enabled: v.enabled, locked: v.locked, unlocked: v.unlocked, ...(typeof v.model === 'string' ? { model: v.model } : {}), ...(typeof v.remaining === 'number' && Number.isFinite(v.remaining) ? { remaining: v.remaining } : {}) };
    } catch { return { enabled: false, locked: false, unlocked: false }; }
}
export async function insightEnabled(fetcher: typeof fetch = fetch): Promise<boolean>
{
    try {
        const response = await fetcher('/api/insight');
        return response.status === 200 && (await response.json()).enabled === true;
    } catch { return false; }
}
type InsightOptions = { signal?: AbortSignal; fetcher?: typeof fetch; passcode?: string };
export async function fetchInsight(facts: InsightFacts, opts: InsightOptions = {}): Promise<InsightNote>
{
    const clean = validateFacts(facts);
    const key = JSON.stringify(clean);
    const hit = cache.get(key);
    if (hit) { return { ...hit, cached: true }; }
    const note = await requestInsight(clean, opts);
    if (cache.size >= 50) { cache.delete(cache.keys().next().value!); }
    cache.set(key, note);
    return { ...note };
}
export async function askInsight(facts: InsightFacts, question: string, opts: InsightOptions = {}): Promise<InsightAnswer>
{
    const clean = validateFacts(facts);
    const normalized = validateQuestion(question);
    const answer = await requestInsight(clean, opts, normalized);
    return answer;
}
async function requestInsight(clean: InsightFacts, opts: InsightOptions, question: string): Promise<InsightAnswer>;
async function requestInsight(clean: InsightFacts, opts: InsightOptions): Promise<InsightNote>;
async function requestInsight(clean: InsightFacts, opts: InsightOptions, question?: string): Promise<InsightNote | InsightAnswer>
{
    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (opts.passcode !== undefined) { headers['X-Insight-Passcode'] = opts.passcode; }
        const response = await (opts.fetcher ?? fetch)('/api/insight', { method: 'POST', headers, body: JSON.stringify({ facts: clean, ...(question !== undefined ? { question } : {}) }), signal: opts.signal });
        if (!response.ok) {
            let code: InsightErrorCode = response.status === 503 || (question !== undefined && response.status === 404) ? 'off' : response.status === 401 ? 'locked' : response.status === 400 || response.status === 413 ? 'invalid' : response.status === 429 ? 'busy' : response.status === 422 ? 'unverified' : 'failed';
            const rawRetry = response.headers.get('Retry-After');
            const retryAfter = rawRetry !== null && /^\d+$/.test(rawRetry) ? Number(rawRetry) : undefined;
            let reason: string | undefined;
            try { const body: unknown = await response.json(); if (body && typeof body === 'object') { if ('reason' in body && typeof body.reason === 'string') { reason = body.reason; } if (response.status === 503 && 'error' in body && body.error === 'busy') { code = 'busy'; } } } catch { /* Error bodies are optional. */ }
            throw new InsightError(code, retryAfter, reason);
        }
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || typeof (data as InsightNote).text !== 'string' || typeof (data as InsightNote).model !== 'string' || typeof (data as InsightNote).dropped !== 'number') { throw new InsightError('failed'); }
        if (question !== undefined && (data as InsightNote).cached !== false) { throw new InsightError('failed'); }
        const note: InsightNote = { text: (data as InsightNote).text, model: (data as InsightNote).model, dropped: (data as InsightNote).dropped, cached: (data as InsightNote).cached === true, ...(typeof (data as InsightNote).remaining === 'number' ? { remaining: (data as InsightNote).remaining } : {}) };
        if (question !== undefined) {
            const sheet = factSheet(clean);
            const { picked, lines, trust, kind } = data as InsightAnswer;
            const valid = (rows: unknown, ordered = true): rows is number[] => Array.isArray(rows) && rows.every((n, i) => Number.isInteger(n) && n >= 1 && n <= sheet.length && (!ordered || i === 0 || n > rows[i - 1])) && new Set(rows).size === rows.length;
            if (!valid(picked) || picked.length > 3 || !valid(lines) || !valid(trust, false)) { throw new InsightError('failed'); }
            if (kind === 'none') {
                if (picked.length || lines.length || trust.length || note.text !== ASK_CANNOT) { throw new InsightError('failed'); }
            } else if (kind === 'answer') {
                const expected = askRows(sheet, picked);
                if (!picked.length || !lines.length || picked.some((n) => !lines.includes(n) && !trust.includes(n)) || note.text !== joinRows(sheet, lines) || JSON.stringify(expected.lines) !== JSON.stringify(lines) || JSON.stringify(expected.trust) !== JSON.stringify(trust)) { throw new InsightError('failed'); }
            } else { throw new InsightError('failed'); }
            return { ...note, picked, lines, trust, kind, cached: false };
        }
        return note;
    } catch (error) {
        if (opts.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) { throw error; }
        if (error instanceof InsightError) { throw error; }
        throw new InsightError('failed');
    }
}
