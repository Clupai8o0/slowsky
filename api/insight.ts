// The AI note is written by Anthropic's Claude from numbers this app measured. See README, "AI tools used".
import Anthropic from '@anthropic-ai/sdk';
import { checkNote, factSheet, InsightError, validateFacts } from '../src/lib/insight';
import { SYSTEM_PROMPT, userMessage } from '../src/lib/insight-prompt';

declare const process: { env: Record<string, string | undefined> };

export interface Completion { text: string; refused: boolean; model: string; stopReason?: string | null }
const MAX_GUESSES = 10;
const MAX_ATTEMPTS = 60;
const MAX_KEYS = 20000;
export interface LimitStore {
    hit(key: string, windowMs: number, now: number): Promise<number>;
    count(key: string, windowMs: number, now: number): Promise<number>;
}
export function memoryStore(): LimitStore
{
    const guesses = new Map<string, { count: number; end: number }>();
    const notes = new Map<string, { count: number; end: number }>();
    function entriesFor(key: string): typeof guesses
    {
        return key.startsWith('try:') || key.startsWith('bad:') ? guesses : notes;
    }
    function lookup(key: string, windowMs: number, now: number): string
    {
        return `${key}:${Math.floor(now / windowMs)}`;
    }
    return {
        async hit(key, windowMs, now) {
            const name = lookup(key, windowMs, now);
            const entries = entriesFor(key);
            const entry = entries.get(name);
            if (!entry && entries.size >= MAX_KEYS) {
                for (const [oldName, old] of entries) { if (old.end <= now) { entries.delete(oldName); } }
                if (entries.size >= MAX_KEYS) { entries.delete(entries.keys().next().value!); }
            }
            const count = (entry?.count ?? 0) + 1;
            entries.set(name, { count, end: (Math.floor(now / windowMs) + 1) * windowMs });
            return count;
        },
        async count(key, windowMs, now) { return entriesFor(key).get(lookup(key, windowMs, now))?.count ?? 0; },
    };
}
export function upstashStore(url: string, token: string, fetcher: typeof fetch = fetch): LimitStore
{
    const base = url.replace(/\/+$/, '');
    async function call(path: string, body: unknown): Promise<unknown> {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 2000); });
            const response = await Promise.race([fetcher(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }), timeout]);
            if (response.status !== 200) { throw new Error('store failure'); }
            return await Promise.race([response.json(), timeout]);
        } finally { if (timer !== undefined) { clearTimeout(timer); } }
    }
    function result(value: unknown, nullable: boolean): number {
        if (!value || typeof value !== 'object' || !('result' in value)) { throw new Error('store failure'); }
        const item: unknown = value.result;
        if (nullable && item === null) { return 0; }
        const n = typeof item === 'number' ? item : typeof item === 'string' && /^\d+$/.test(item) ? Number(item) : NaN;
        if (!Number.isSafeInteger(n) || n < 0) { throw new Error('store failure'); }
        return n;
    }
    return {
        async hit(key, windowMs, now) {
            const k = `${key}:${Math.floor(now / windowMs)}`;
            const data = await call('/pipeline', [['INCR', k], ['PEXPIRE', k, String(windowMs * 2)]]);
            if (!Array.isArray(data) || data.length !== 2 || result(data[1], false) !== 1) { throw new Error('store failure'); }
            return result(data[0], false);
        },
        async count(key, windowMs, now) { return result(await call('', ['GET', `${key}:${Math.floor(now / windowMs)}`]), true); },
    };
}
export interface InsightDeps {
    apiKey: string | undefined;
    model: string;
    complete: (system: string, user: string, signal: AbortSignal) => Promise<Completion>;
    now: () => number;
    store: LimitStore;
    passcode: string | undefined;
    open: boolean;
    maxPerUserDay: number;
    maxPerDay: number;
    maxPerHour: number;
}
type Answer = { text: string; model: string; dropped: number };
const answers = new Map<string, Answer>();
const envUrl = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? process.env.UPSTASH_REDIS_REST_URL : process.env.KV_REST_API_URL;
const envToken = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? process.env.UPSTASH_REDIS_REST_TOKEN : process.env.KV_REST_API_TOKEN;
// In-memory limits are per server instance and reset on a cold start.
const serverStore = envUrl && envToken ? upstashStore(envUrl, envToken) : memoryStore();
const limit = 4096;
function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response
{
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
}
function failure(status: number, error: string, extra: Record<string, string> = {}): Response
{
    return json({ error }, status, extra);
}
async function readBody(request: Request): Promise<string | null>
{
    const length = request.headers.get('content-length');
    if (length && Number(length) > limit) { return null; }
    const reader = request.body?.getReader();
    if (!reader) { return ''; }
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) { break; }
        size += value.length;
        if (size > limit) { await reader.cancel(); return null; }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(bytes);
}
async function hash(value: string): Promise<string>
{
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function setting(name: string, fallback: number): number
{
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
function networkAddress(ip: string): string
{
    if (!ip.includes(':')) { return ip; }
    try {
        const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
        const halves = normalized.split('::');
        const left = halves[0] ? halves[0].split(':') : [];
        const right = halves[1] ? halves[1].split(':') : [];
        const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
        const words = parts.map((part) => parseInt(part, 16));
        if (words.length !== 8) { return ip; }
        if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
            return `${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`;
        }
        return words.slice(0, 4).map((word) => word.toString(16)).join(':');
    } catch { return ip; }
}
class StoreFailure extends Error {}
export function createHandlers(deps: InsightDeps): { GET(r: Request): Promise<Response>; POST(r: Request): Promise<Response> }
{
    const minute = 60000, hour = 3600000, day = 86400000, guessWindow = 900000;
    const enabled = Boolean(deps.apiKey && (deps.passcode || deps.open));
    async function counter(method: 'hit' | 'count', key: string, window: number, now: number): Promise<number> {
        try { return await deps.store[method](key, window, now); } catch { throw new StoreFailure(); }
    }
    function retry(window: number, now: number): number { return Math.max(1, Math.ceil(((Math.floor(now / window) + 1) * window - now) / 1000)); }
    async function visitor(request: Request): Promise<string> {
        const ip = request.headers.get('x-real-ip')?.trim() || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
        return (await hash(`${networkAddress(ip)}|${deps.passcode ?? ''}`)).slice(0, 16);
    }
    async function access(request: Request, id: string, now: number): Promise<'ok' | 'locked' | 'busy'> {
        if (!deps.passcode) { return 'ok'; }
        const supplied = request.headers.get('x-insight-passcode') ?? '';
        if (!supplied && request.method === 'GET') { return 'locked'; }
        if (await counter('hit', `try:${id}`, guessWindow, now) > MAX_ATTEMPTS) { return 'busy'; }
        if (await counter('count', `bad:${id}`, guessWindow, now) >= MAX_GUESSES) { return 'busy'; }
        const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied)), crypto.subtle.digest('SHA-256', new TextEncoder().encode(deps.passcode))]);
        let diff = 0;
        const x = new Uint8Array(a), y = new Uint8Array(b);
        for (let i = 0; i < x.length; i++) { diff |= x[i]! ^ y[i]!; }
        if (diff === 0) { return 'ok'; }
        if (supplied) { await counter('hit', `bad:${id}`, guessWindow, now); }
        return 'locked';
    }
    const handlers = {
        async GET(request: Request): Promise<Response> {
            if (!enabled) { return json({ enabled: false, locked: false, unlocked: false, model: deps.model }); }
            const now = deps.now(), id = await visitor(request), state = await access(request, id, now);
            if (state === 'busy') { return failure(429, 'busy', { 'Retry-After': String(retry(guessWindow, now)) }); }
            const unlocked = state === 'ok';
            return json({ enabled: true, locked: Boolean(deps.passcode), unlocked, model: deps.model, ...(unlocked ? { remaining: Math.max(0, deps.maxPerUserDay - await counter('count', `user-day:${id}`, day, now)) } : {}) });
        },
        async POST(request: Request): Promise<Response> {
            if (!enabled) { return failure(503, 'off'); }
            const site = request.headers.get('sec-fetch-site');
            const origin = request.headers.get('origin');
            try {
                if ((site !== null && site !== 'same-origin') || (origin !== null && new URL(origin).host !== new URL(request.url).host)) { return failure(403, 'forbidden'); }
            } catch { return failure(403, 'forbidden'); }
            const now = deps.now(), id = await visitor(request), state = await access(request, id, now);
            if (state === 'busy') { return failure(429, 'busy', { 'Retry-After': String(retry(guessWindow, now)) }); }
            if (state === 'locked') { return failure(401, 'locked'); }
            if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) { return failure(400, 'invalid'); }
            let facts;
            try {
                const body = await readBody(request);
                if (body === null) { return failure(413, 'too_large'); }
                const parsed: unknown = JSON.parse(body);
                if (!parsed || typeof parsed !== 'object' || !('facts' in parsed)) { return failure(400, 'invalid'); }
                facts = validateFacts(parsed.facts);
            } catch { return failure(400, 'invalid'); }
            const key = await hash(JSON.stringify(facts));
            const hit = answers.get(key);
            if (hit) { return json({ ...hit, cached: true }, 200, { 'X-Robots-Tag': 'noindex' }); }
            const limits = [
                { key: `user-minute:${id}`, window: minute, max: 6 },
                { key: `user-day:${id}`, window: day, max: deps.maxPerUserDay },
                { key: 'global-hour', window: hour, max: deps.maxPerHour },
                { key: 'global-day', window: day, max: deps.maxPerDay },
            ];
            const hits: number[] = [];
            for (const [i, item] of limits.entries()) {
                const count = await counter('hit', item.key, item.window, now);
                hits.push(count);
                if (count > item.max) {
                    return json({ error: 'busy', ...(i === 1 || i === 3 ? { reason: 'daily' } : {}) }, 429, { 'Retry-After': String(retry(item.window, now)) });
                }
            }
            const sheet = factSheet(facts);
            const controller = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const timeout = new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 25000);
                });
                const completion = await Promise.race([deps.complete(SYSTEM_PROMPT, userMessage(sheet), controller.signal), timeout]);
                if (completion.refused) { return failure(502, 'no_note'); }
                const endings = completion.stopReason === 'max_tokens' ? [...completion.text.matchAll(/[.!?](?=\s|$)/g)] : [];
                const text = completion.stopReason === 'max_tokens' ? completion.text.slice(0, (endings.at(-1)?.index ?? -1) + 1).trimEnd() : completion.text;
                const checked = checkNote(text, sheet);
                const answer = { ...checked, model: completion.model };
                if (answers.size >= 200) { answers.delete(answers.keys().next().value!); }
                answers.set(key, answer);
                return json({ ...answer, cached: false, remaining: Math.max(0, deps.maxPerUserDay - hits[1]!) }, 200, { 'X-Robots-Tag': 'noindex' });
            } catch (error) {
                if (error instanceof InsightError && error.code === 'unverified') { return failure(422, 'unverified'); }
                return failure(502, 'failed');
            } finally { if (timer !== undefined) { clearTimeout(timer); } }
        },
    };
    async function safe(run: () => Promise<Response>): Promise<Response>
    {
        try { return await run(); } catch (error) {
            if (!(error instanceof StoreFailure)) { throw error; }
            console.warn('Insight limit store unavailable');
            return failure(503, 'busy', { 'Retry-After': '60' });
        }
    }
    return { GET: (request) => safe(() => handlers.GET(request)), POST: (request) => safe(() => handlers.POST(request)) };
}
export function anthropicComplete(apiKey: string, model: string): InsightDeps['complete']
{
    const client = new Anthropic({ apiKey, timeout: 25000, maxRetries: 1 });
    return async (system, user, signal) => {
        try {
            const opus = model === 'claude-opus-5-5';
            const stream = client.beta.messages.stream({ model, max_tokens: 1500, output_config: { effort: 'low' }, system, messages: [{ role: 'user', content: user }], ...(opus ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}) }, { signal });
            const message = await stream.finalMessage();
            return { text: message.content.filter((block) => block.type === 'text').map((block) => block.text).join(''), refused: message.stop_reason === 'refusal', model: message.model, stopReason: message.stop_reason };
        } catch (error) {
            if (error instanceof Anthropic.APIError) { throw new Error('upstream failure'); }
            throw error;
        }
    };
}
function handlers(): ReturnType<typeof createHandlers>
{
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const model = process.env.INSIGHT_MODEL || 'claude-opus-5-5';
    const passcode = process.env.INSIGHT_PASSCODE?.trim() || undefined;
    return createHandlers({ apiKey, model, complete: anthropicComplete(apiKey ?? '', model), now: Date.now, store: serverStore, passcode, open: process.env.INSIGHT_OPEN === '1', maxPerUserDay: setting('INSIGHT_MAX_PER_USER_DAY', 20), maxPerDay: setting('INSIGHT_MAX_PER_DAY', 300), maxPerHour: setting('INSIGHT_MAX_PER_HOUR', 120) });
}
export function GET(request: Request): Promise<Response> { return handlers().GET(request); }
export function POST(request: Request): Promise<Response> { return handlers().POST(request); }
export function OPTIONS(): Response { return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } }); }
