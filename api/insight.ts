// The AI note is written by Anthropic's Claude from numbers this app measured. See README, "AI tools used".
import Anthropic from '@anthropic-ai/sdk';
import { checkNote, factSheet, InsightError, validateFacts } from '../src/lib/insight';
import { SYSTEM_PROMPT, userMessage } from '../src/lib/insight-prompt';

declare const process: { env: Record<string, string | undefined> };

export interface Completion { text: string; refused: boolean; model: string }
export interface InsightDeps {
    apiKey: string | undefined;
    model: string;
    complete: (system: string, user: string, signal: AbortSignal) => Promise<Completion>;
    now: () => number;
}
type Answer = { text: string; model: string; dropped: number };
const answers = new Map<string, Answer>();
const clients = new Map<string, number[]>();
let calls: number[] = [];
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
function hourlyLimit(): number
{
    const value = Number(process.env.INSIGHT_MAX_PER_HOUR);
    return Number.isInteger(value) && value > 0 ? value : 120;
}
export function createHandlers(deps: InsightDeps): { GET(r: Request): Promise<Response>; POST(r: Request): Promise<Response> }
{
    return {
        async GET(_request: Request): Promise<Response> {
            return json({ enabled: Boolean(deps.apiKey), model: deps.model });
        },
        async POST(request: Request): Promise<Response> {
            if (!deps.apiKey) { return failure(503, 'off'); }
            const site = request.headers.get('sec-fetch-site');
            const origin = request.headers.get('origin');
            try {
                if ((site !== null && site !== 'same-origin') || (origin !== null && new URL(origin).host !== new URL(request.url).host)) { return failure(403, 'forbidden'); }
            } catch { return failure(403, 'forbidden'); }
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
            if (hit) { return json(hit, 200, { 'X-Robots-Tag': 'noindex' }); }
            const now = deps.now();
            calls = calls.filter((time) => time > now - 3600000);
            for (const [client, times] of clients) {
                const recent = times.filter((time) => time > now - 60000);
                if (recent.length) { clients.set(client, recent); } else { clients.delete(client); }
            }
            const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
            const recent = clients.get(client) ?? [];
            if (recent.length >= 6 || calls.length >= hourlyLimit()) {
                const wait = Math.max(recent.length >= 6 ? recent[0]! + 60000 - now : 0, calls.length >= hourlyLimit() ? calls[0]! + 3600000 - now : 0);
                return failure(429, 'busy', { 'Retry-After': String(Math.max(1, Math.ceil(wait / 1000))) });
            }
            if (!clients.has(client) && clients.size >= 5000) {
                return failure(429, 'busy', { 'Retry-After': '60' });
            }
            recent.push(now);
            clients.set(client, recent);
            calls.push(now);
            const sheet = factSheet(facts);
            const controller = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const timeout = new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 25000);
                });
                const completion = await Promise.race([deps.complete(SYSTEM_PROMPT, userMessage(sheet), controller.signal), timeout]);
                if (completion.refused) { return failure(502, 'no_note'); }
                const checked = checkNote(completion.text, sheet);
                const answer = { ...checked, model: completion.model };
                if (answers.size >= 200) { answers.delete(answers.keys().next().value!); }
                answers.set(key, answer);
                return json(answer, 200, { 'X-Robots-Tag': 'noindex' });
            } catch (error) {
                if (error instanceof InsightError && error.code === 'unverified') { return failure(422, 'unverified'); }
                return failure(502, 'failed');
            } finally { if (timer !== undefined) { clearTimeout(timer); } }
        },
    };
}
export function anthropicComplete(apiKey: string, model: string): InsightDeps['complete']
{
    const client = new Anthropic({ apiKey, timeout: 25000, maxRetries: 1 });
    return async (system, user, signal) => {
        try {
            const opus = model === 'claude-opus-5-5';
            const stream = client.beta.messages.stream({ model, max_tokens: 1500, output_config: { effort: 'low' }, system, messages: [{ role: 'user', content: user }], ...(opus ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}) }, { signal });
            const message = await stream.finalMessage();
            return { text: message.content.filter((block) => block.type === 'text').map((block) => block.text).join(''), refused: message.stop_reason === 'refusal', model: message.model };
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
    return createHandlers({ apiKey, model, complete: anthropicComplete(apiKey ?? '', model), now: Date.now });
}
export function GET(request: Request): Promise<Response> { return handlers().GET(request); }
export function POST(request: Request): Promise<Response> { return handlers().POST(request); }
export function OPTIONS(): Response { return new Response(null, { status: 204 }); }
