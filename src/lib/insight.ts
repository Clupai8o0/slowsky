import { TARGETS } from './targets';

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
export interface InsightStatus { enabled: boolean; locked: boolean; unlocked: boolean; model?: string; remaining?: number }
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
export const CONSTANTS: readonly number[] = [0.75, 5, 5.0, 102, 6, 6.2, 1.083, 1.875, 3.05, 3.3, 4.05, 4.27, 4.67];
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
export function factSheet(f: InsightFacts): string[]
{
    const name = TARGETS.find((t) => t.id === f.targetId)?.name;
    const times = f.visits.map((v) => v.mjd);
    const lines = [`Target: ${name ?? 'a position typed in by the visitor'}.`, `Position: RA ${f.ra.toFixed(4)} deg, Dec ${f.dec.toFixed(4)} deg.`, `Wavelength: ${f.lambdaUm.toFixed(3)} micron.`, `Visits: ${f.visits.length}. Frames in each visit: ${f.visits.map((v) => v.frames).join(', ')}. Time from first to last visit: ${(Math.max(...times) - Math.min(...times)).toFixed(1)} days.`];
    if (f.lightCurve) {
        const lc = f.lightCurve;
        const values = [...lc.points].sort((a, b) => a.mjd - b.mjd).map((p) => p.relative);
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
        const furthest = values.reduce((a, b) => Math.abs(b - median) > Math.abs(a - median) ? b : a);
        lines.push(`Brightness relative to the reference stars, in time order: ${values.map((n) => n.toFixed(2)).join(', ')}.`);
        if (median !== 0) {
            const change = (furthest / median - 1) * 100;
            lines.push(`Largest change from the median brightness: ${Math.abs(change).toFixed(0)} percent ${change <= 0 ? 'dimmer' : 'brighter'}.`);
        }
        lines.push(`Lowest signal-to-noise among the points: ${Math.min(...lc.points.map((p) => p.snr)).toFixed(0)}.`, lc.refScatter.length ? `Reference stars: ${lc.refScatter.length}. Scatter of each: ${lc.refScatter.map((n) => (n * 100).toFixed(1)).join(', ')} percent.` : 'Reference stars: none, so the brightness change has no control.', `Frames left out because their wavelength did not match: ${lc.dropped}.`);
    }
    if (f.difference) {
        lines.push(`Difference image at the target: ${Math.abs(f.difference.peakSigma).toFixed(1)} sigma, ${f.difference.peakSigma >= 0 ? 'brighter' : 'fainter'} in the later visit.`);
    }
    if (f.motion) {
        lines.push(`Shift in position: ${f.motion.arcsec.toFixed(1)} arcsec over ${f.motion.days.toFixed(1)} days.`);
    }
    lines.push(`Frames came from: ${f.snapshot ? 'the baked snapshot' : "NASA's live archive"}.`);
    return lines;
}
export function checkNote(text: string, sheet: string[]): { text: string; dropped: number }
{
    const allowed = new Set([...CONSTANTS, ...sheet.flatMap((line) => (line.match(/\d+(?:\.\d+)?/g) ?? []).map(Number))]);
    const unitPattern = /(\d+(?:\.\d+)?)\s*(percent\b|times\b|sigma\b|x\b|%|×|σ)/gi;
    function unitKey(value: string, unit: string): string
    {
        const kind = unit.toLowerCase();
        return `${Number(value)}:${kind === '%' ? 'percent' : kind === 'x' || kind === '×' ? 'times' : kind === 'σ' ? 'sigma' : kind}`;
    }
    const units = new Set(sheet.flatMap((line) => Array.from(line.matchAll(unitPattern), (match) => unitKey(match[1]!, match[2]!))));
    function invalid(value: string): boolean
    {
        return /discover/i.test(value)
            || Array.from(value).some((char) => /\p{Nd}/u.test(char) && !/[0-9]/.test(char))
            || /(?<![0-9])\.\d/.test(value)
            || /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|half|twice|double|triple)\b/i.test(value)
            || (value.match(/\d+(?:\.\d+)?/g) ?? []).some((n) => !allowed.has(Number(n)))
            || Array.from(value.matchAll(unitPattern)).some((match) => !units.has(unitKey(match[1]!, match[2]!)));
    }
    let dropped = 0;
    let count = 0;
    const paragraphs: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) { continue; }
        const colon = line.indexOf(':');
        const label = colon >= 0 && colon < 30 ? line.slice(0, colon + 1) : '';
        const body = line.slice(label.length).trim();
        const sentences = body.match(/.*?(?:[.!?](?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
        if (invalid(label)) {
            dropped += sentences.length;
            continue;
        }
        const kept = sentences.filter((sentence) => {
            if (invalid(sentence)) {
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
export async function fetchInsight(facts: InsightFacts, opts: { signal?: AbortSignal; fetcher?: typeof fetch; passcode?: string } = {}): Promise<InsightNote>
{
    const clean = validateFacts(facts);
    const key = JSON.stringify(clean);
    const hit = cache.get(key);
    if (hit) { return { ...hit, cached: true }; }
    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (opts.passcode !== undefined) { headers['X-Insight-Passcode'] = opts.passcode; }
        const response = await (opts.fetcher ?? fetch)('/api/insight', { method: 'POST', headers, body: JSON.stringify({ facts: clean }), signal: opts.signal });
        if (!response.ok) {
            const code: InsightErrorCode = response.status === 503 ? 'off' : response.status === 401 ? 'locked' : response.status === 400 || response.status === 413 ? 'invalid' : response.status === 429 ? 'busy' : response.status === 422 ? 'unverified' : 'failed';
            const rawRetry = response.headers.get('Retry-After');
            const retryAfter = rawRetry !== null && /^\d+$/.test(rawRetry) ? Number(rawRetry) : undefined;
            let reason: string | undefined;
            try { const body: unknown = await response.json(); if (body && typeof body === 'object' && 'reason' in body && typeof body.reason === 'string') { reason = body.reason; } } catch { /* Error bodies are optional. */ }
            throw new InsightError(code, retryAfter, reason);
        }
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || typeof (data as InsightNote).text !== 'string' || typeof (data as InsightNote).model !== 'string' || typeof (data as InsightNote).dropped !== 'number') { throw new InsightError('failed'); }
        const note: InsightNote = { text: (data as InsightNote).text, model: (data as InsightNote).model, dropped: (data as InsightNote).dropped, cached: (data as InsightNote).cached === true, ...(typeof (data as InsightNote).remaining === 'number' ? { remaining: (data as InsightNote).remaining } : {}) };
        if (cache.size >= 50) { cache.delete(cache.keys().next().value!); }
        cache.set(key, note);
        return { ...note };
    } catch (error) {
        if (opts.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) { throw error; }
        if (error instanceof InsightError) { throw error; }
        throw new InsightError('failed');
    }
}
