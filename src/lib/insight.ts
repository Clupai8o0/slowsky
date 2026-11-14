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
// Pair brightness with signal, references and visits, and difference or motion with visits.
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
    const trustSet = new Set(sheet.flatMap((line, i) => (brightness ? TRUST_LINE_STARTS : other ? [TRUST_LINE_STARTS[2]] : []).some((start) => line.startsWith(start)) ? [i + 1] : []));
    const lines = sheet.flatMap((_, i) => selected.has(i + 1) && (!(brightness || other) || !matches(i + 1, TRUST_LINE_STARTS)) ? [i + 1] : []);
    const trust = sheet.flatMap((_, i) => trustSet.has(i + 1) ? [i + 1] : []);
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
                // Compare the printed percents: 0.81, 1.00, 1.19 is a tie, not "19 percent brighter".
                const down = (below / median * 100).toFixed(0);
                const up = (above / median * 100).toFixed(0);
                const amount = below > above ? down : up;
                const description = amount === '0' ? 'less than 1 percent' : `${amount} percent ${down === up ? 'either side' : below > above ? 'dimmer' : 'brighter'}`;
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
type NumberFact = { value: number; integer: boolean; unit: string; words: RegExp; nouns?: RegExp; required?: RegExp; bound?: Bound };
// The direction of a bound written just before a number: "more than 100" is a floor, "below 1" a ceiling.
function boundBefore(text: string, ai: boolean): Bound
{
    if ((ai ? /\b(?:more than|over|above|greater than|higher than|exceeds?|exceeding|in excess of|at least)\s*$/i : /\b(?:more than|at least)\s*$/i).test(text)) { return 'min'; }
    if ((ai ? /\b(?:below|under|less than|lower than|fewer than|smaller than|at most)\s*$/i : /\b(?:below|less than)\s*$/i).test(text)) { return 'max'; }
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
    [/^Largest change\b/i, 'chang|differ|bright|dim|faint|fade|fading|rise|rose|drop|fell|fall|dip|swing|jump|median|largest|peak|increas|decreas|light|went|up(?!\\p{L})|down|grew|gain|lost|vari'],
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
            for (const list of lists(segment[2]!)) {
                const bound = boundBefore(segment[2]!.slice(0, list.start), false);
                list.values.forEach((value, i) => { result.push({ value: Number(value.replace('−', '-')), integer: !value.includes('.'), unit: list.unit, words, nouns: count?.[1], required: count?.[2], bound: i === 0 ? bound : undefined }); });
            }
        }
    }
    for (const entry of CONSTANT_CONTEXT) {
        const context = entry.context.source;
        const noun = entry.context.test('micron') ? 'micron' : 'arcsec';
        result.push({ value: entry.value, integer: Number.isInteger(entry.value), unit: noun === 'micron' || noun === 'arcsec' ? noun : '', words: new RegExp(context, 'i') });
    }
    return result;
}
// Context matching cannot detect a real number moved to the wrong subject with the same words.
export function checkNote(text: string, sheet: string[]): { text: string; dropped: number }
{
    const facts = sheetFacts(sheet);
    const visitCount = Number(sheet.join('\n').match(/^Visits:\s*(?:at least\s+)?(\d+)\./m)?.[1] ?? 3);
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
    function unsupportedNumbers(value: string): boolean
    {
        for (const list of lists(value)) {
            const before = value.slice(0, list.start).match(/[\p{L}]+(?:\/[\p{L}]+)?|[%″°]/gu) ?? [];
            const after = value.slice(list.end).match(/[\p{L}]+(?:\/[\p{L}]+)?|[%″°]/gu) ?? [];
            const context = [...before.slice(-8), ...after.slice(0, 3)].join(' ');
            const follower = list.follower.trimStart().replace(/^-\s*/, '');
            const nounFollower = follower.replace(/^of\s+(?:the|its|their|these|those)\s+/i, '');
            const followingWords = nounFollower.match(/^[a-z]+(?:-[a-z]+)*(?:\s+[a-z]+(?:-[a-z]+)*)?/i)?.[0].split(/\s+/) ?? [];
            const noun = list.unit ? undefined : followingWords.find((word) => countingNoun.test(word));
            const lead = boundBefore(value.slice(0, list.start), true);
            const unitlessBlocked = Boolean(list.unit) || /^[°′″$€£±×^/]/.test(follower) || /^[A-Z]/.test(follower) || foreign.test(follower);
            for (const [index, raw] of list.values.entries()) {
                const val = Number(raw.replace('−', '-'));
                const bound = index === 0 ? lead : undefined;
                const integer = !raw.includes('.');
                if (integer && MISSION_COUNTS.some((entry) => entry.value === val && entry.nouns.test(follower))) { continue; }
                if (!facts.some((fact) => {
                    if (fact.bound && fact.bound !== bound) { return false; }
                    if (fact.value !== val || (integer && !fact.integer) || !fact.words.test(fact.required && noun ? value : context)) { return false; }
                    if (noun && (!fact.nouns?.test(noun) || (fact.required && !fact.required.test(value)))) { return false; }
                    if (fact.unit) { return list.unit === fact.unit; }
                    if (unitlessBlocked) { return false; }
                    return true;
                })) { return true; }
            }
        }
        return false;
    }
    function invalid(value: string): boolean
    {
        if (/[<>]|:\/\/|www\./i.test(value) || (/\d/.test(value) && /\b(?:years?|yrs?|yearly|annual|annually|annum|decade|century)\b/i.test(value))) { return true; }
        if (namePattern) { value = value.replace(namePattern, 'NAME'); }
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
        value = value.replace(/\bfewer\s+than\s+(?:3|three)\s+visits\b/gi, 'few visits');
        // A name, or any token that mixes letters and digits, is never a quantity: "It moved WISE J085510.83 arcsec."
        for (const token of value.matchAll(/(?<![\w.])(?:NAME|[A-Za-z][\w.]*\d[\w.]*)(?![\w])/g)) {
            const after = value.slice(token.index + token[0].length);
            if (unitAtStart.test(after) || foreign.test(after.trimStart().replace(/^-\s*/, ''))) { return true; }
        }
        const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
        const ordinal = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+visits?\b/gi;
        const rank = /\b(second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)[\s-]+(brightest|faintest)\s+reading\s+was\s+([-−]?\d+(?:\.\d+)?)\b/i;
        const ranked = value.match(rank);
        if (ranked) {
            const readings = sheet.find((line) => /^Brightness relative to the reference stars, in time order:/i.test(line))?.split(':')[1];
            const values = readings ? lists(readings).flatMap((list) => list.values.map(Number)).sort((a, b) => ranked[2]!.toLowerCase() === 'brightest' ? b - a : a - b) : [];
            if (values[ordinals.indexOf(ranked[1]!.toLowerCase())] !== Number(ranked[3]!.replace('−', '-'))) { return true; }
            value = value.replace(rank, `reading was ${ranked[3]}`);
        }
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
                && !/\b(?:would|could|will|should|might|next|later|another|one more)(?:\s+[\p{L}-]+){0,4}\s*$/iu.test(value.slice(0, match.index)))
            || unsupportedNumbers(value);
    }
    let dropped = 0;
    let count = 0;
    const paragraphs: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) { continue; }
        const colon = line.indexOf(':');
        const label = colon >= 0 && colon < 30 && line.slice(colon, colon + 3) !== '://' ? line.slice(0, colon + 1) : '';
        const body = line.slice(label.length).trim();
        const sentences = body.match(/.*?(?:[.!?](?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
        if (invalid(label)) {
            dropped += sentences.length;
            continue;
        }
        const kept = sentences.filter((sentence) => {
            const labeled = `${label} ${sentence}`;
            if (invalid(sentence) || (/\d/.test(labeled) && /\b(?:years?|yearly|annual|annually|annum|decade|century)\b/i.test(labeled))) {
                dropped++;
                return false;
            }
            count++;
            return true;
        });
        if (kept.length) { paragraphs.push([label, ...kept].filter(Boolean).join(' ')); }
    }
    if (count < 2) { throw new InsightError('unverified'); }
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
            const valid = (rows: unknown): rows is number[] => Array.isArray(rows) && rows.every((n, i) => Number.isInteger(n) && n >= 1 && n <= sheet.length && (i === 0 || n > rows[i - 1]));
            if (!valid(picked) || picked.length > 3 || !valid(lines) || !valid(trust)) { throw new InsightError('failed'); }
            if (kind === 'none') {
                if (picked.length || lines.length || trust.length || note.text !== ASK_CANNOT) { throw new InsightError('failed'); }
            } else if (kind === 'answer') {
                const expected = askRows(sheet, picked);
                if (!picked.length || !lines.length || note.text !== joinRows(sheet, lines) || JSON.stringify(expected.lines) !== JSON.stringify(lines) || JSON.stringify(expected.trust) !== JSON.stringify(trust)) { throw new InsightError('failed'); }
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
