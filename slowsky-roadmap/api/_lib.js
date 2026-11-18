// Shared helpers for the roadmap API. Files starting with "_" are not deployed as routes.
import { neon } from '@neondatabase/serverless';
import { createHash, timingSafeEqual } from 'node:crypto';

export const STATUSES = ['todo', 'doing', 'done', 'blocked', 'cut'];
export const KINDS = ['version', 'feature', 'block', 'milestone', 'step', 'idea'];
export const TIERS = ['core', 'weekend', 'if-ahead', 'roadmap'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class HttpError extends Error
{
    constructor(status, message)
    {
        super(message);
        this.status = status;
    }
}

let cached = null;

export function db()
{
    if (!cached) {
        const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
        if (!url) {
            throw new HttpError(500, 'Database is not configured');
        }
        cached = neon(url);
    }
    return cached;
}

export function json(data, status = 200)
{
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
}

function digest(value)
{
    return createHash('sha256').update(String(value)).digest();
}

// One shared key for reading and writing. Sent as "Authorization: Bearer <key>".
export function requireKey(request)
{
    const expected = process.env.ROADMAP_KEY;
    if (!expected || expected.length < 16) {
        throw new HttpError(500, 'ROADMAP_KEY is not configured');
    }
    const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') || '');
    const given = match ? match[1] : '';
    if (!given || !timingSafeEqual(digest(given), digest(expected))) {
        throw new HttpError(401, 'Wrong or missing key');
    }
}

// JSON only: a plain HTML form cannot send it cross-site without a CORS preflight.
export async function readJson(request, maxBytes)
{
    const type = request.headers.get('content-type') || '';
    if (!type.toLowerCase().startsWith('application/json')) {
        throw new HttpError(415, 'Send JSON');
    }
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new HttpError(413, 'Body too large');
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new HttpError(400, 'Bad JSON');
    }
}

export function handle(fn)
{
    return async (request) => {
        try {
            return await fn(request);
        } catch (err) {
            if (err instanceof HttpError) {
                return json({ error: err.message }, err.status);
            }
            if (err && err.code === '23514') {
                // A table check failed, e.g. an edit moved start_at past the stored due_at.
                return json({ error: `Rejected by a data rule (${err.constraint || 'check'}): start must be before due` }, 400);
            }
            if (err && err.code === '23503') {
                return json({ error: 'That item id does not exist' }, 400);
            }
            console.error(err);
            return json({ error: 'Server error' }, 500);
        }
    };
}

export function text(value, field, max, { required = false } = {})
{
    if (value === undefined || value === null || value === '') {
        if (required) {
            throw new HttpError(400, `${field} is required`);
        }
        return null;
    }
    if (typeof value !== 'string') {
        throw new HttpError(400, `${field} must be text`);
    }
    const trimmed = value.trim();
    if (required && trimmed === '') {
        throw new HttpError(400, `${field} is required`);
    }
    if (trimmed.length > max) {
        throw new HttpError(400, `${field} is longer than ${max} characters`);
    }
    return trimmed === '' ? null : trimmed;
}

export function itemId(value, field = 'id')
{
    const id = text(value, field, 64, { required: true });
    if (!ID_RE.test(id)) {
        throw new HttpError(400, `${field} must be lower-case letters, digits and dashes`);
    }
    return id;
}

export function status(value)
{
    if (value === undefined || value === null || value === '') {
        return null;
    }
    if (!STATUSES.includes(value)) {
        throw new HttpError(400, `status must be one of ${STATUSES.join(', ')}`);
    }
    return value;
}

// A JSON number, or a string of digits. Booleans, arrays and objects are refused, since Number()
// would turn false or [] into 0 and [75] into 75.
function wholeNumber(value)
{
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
        return Number(value);
    }
    return NaN;
}

export function progress(value)
{
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const n = wholeNumber(value);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
        throw new HttpError(400, 'progress must be a whole number from 0 to 100');
    }
    return n;
}

// A time with no zone is Nepal time (NPT, +05:45), as the CLI and README say. JS would read it
// in the server's zone (UTC on Vercel), which would put it 5 h 45 m late.
function time(value, field)
{
    if (value === undefined || value === null || value === '') {
        return null;
    }
    if (typeof value !== 'string') {
        throw new HttpError(400, `${field} must be an ISO date-time`);
    }
    let text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        text += 'T00:00';
    }
    text = text.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
    if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) {
        text += '+05:45';
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.exec(text);
    // Date.parse would roll 30 Feb over to 2 Mar, so check the calendar parts too.
    const valid = m && Number(m[4]) < 24 && Number(m[5]) < 60 && Number(m[6] || 0) < 60
        && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDate() === Number(m[3])
        && Number(m[2]) >= 1 && Number(m[2]) <= 12 && !Number.isNaN(Date.parse(text));
    if (!valid) {
        throw new HttpError(400, `${field} must be an ISO date-time, e.g. 2026-11-15T07:00+05:45`);
    }
    return new Date(text).toISOString();
}

const OPTIONAL = ['detail', 'version', 'tier', 'lane', 'owner', 'start_at', 'due_at', 'status', 'progress', 'gate', 'sort'];

// Checks one item. item.sent records which optional fields the caller gave, so an edit can leave
// the others alone (see upsertQuery).
export function validateItem(raw)
{
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new HttpError(400, 'Each item must be an object');
    }
    const kind = text(raw.kind, 'kind', 20, { required: true });
    if (!KINDS.includes(kind)) {
        throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
    }
    const tier = text(raw.tier, 'tier', 20);
    if (tier !== null && !TIERS.includes(tier)) {
        throw new HttpError(400, `tier must be one of ${TIERS.join(', ')}`);
    }
    const sort = raw.sort === undefined || raw.sort === null ? 0 : wholeNumber(raw.sort);
    if (!Number.isInteger(sort) || Math.abs(sort) > 1e6) {
        throw new HttpError(400, 'sort must be a whole number');
    }
    const sent = {};
    for (const key of OPTIONAL) {
        sent[key] = Object.prototype.hasOwnProperty.call(raw, key);
    }
    const item = {
        id: itemId(raw.id),
        kind,
        title: text(raw.title, 'title', 200, { required: true }),
        detail: text(raw.detail, 'detail', 4000) ?? '',
        version: text(raw.version, 'version', 20),
        tier,
        lane: text(raw.lane, 'lane', 40),
        owner: text(raw.owner, 'owner', 80),
        start_at: time(raw.start_at, 'start_at'),
        due_at: time(raw.due_at, 'due_at'),
        status: status(raw.status) ?? 'todo',
        progress: progress(raw.progress),
        gate: text(raw.gate, 'gate', 1000),
        sort,
        sent,
    };
    if (item.progress === null) {
        // Done means 100%, as in /api/update.
        item.progress = item.status === 'done' ? 100 : 0;
        sent.progress = sent.progress || (sent.status && item.status === 'done');
    }
    if (item.start_at && item.due_at && item.start_at > item.due_at) {
        throw new HttpError(400, `${item.id}: start_at is after due_at`);
    }
    return item;
}

// Upsert one item. A new item gets every field (defaults where none was given). An existing item
// gets kind, title and only the optional fields the caller sent, so `roadmap.py add` can move one
// due time without wiping the rest. Status and progress change only when keepProgress is false.
// partial = false (the seed script) writes every field, so data/seed.mjs stays the source.
export function upsertQuery(sql, item, keepProgress, partial = true)
{
    const sent = (key) => !partial || Boolean(item.sent && item.sent[key]);
    const st = !keepProgress && sent('status');
    const pr = !keepProgress && sent('progress');
    return sql`
        insert into items (id, kind, title, detail, version, tier, lane, owner, start_at, due_at, status, progress, gate, sort)
        values (${item.id}, ${item.kind}, ${item.title}, ${item.detail}, ${item.version}, ${item.tier}, ${item.lane},
                ${item.owner}, ${item.start_at}, ${item.due_at}, ${item.status}, ${item.progress}, ${item.gate}, ${item.sort})
        on conflict (id) do update set
            kind = excluded.kind,
            title = excluded.title,
            detail = case when ${sent('detail')}::boolean then excluded.detail else items.detail end,
            version = case when ${sent('version')}::boolean then excluded.version else items.version end,
            tier = case when ${sent('tier')}::boolean then excluded.tier else items.tier end,
            lane = case when ${sent('lane')}::boolean then excluded.lane else items.lane end,
            owner = case when ${sent('owner')}::boolean then excluded.owner else items.owner end,
            start_at = case when ${sent('start_at')}::boolean then excluded.start_at else items.start_at end,
            due_at = case when ${sent('due_at')}::boolean then excluded.due_at else items.due_at end,
            status = case when ${st}::boolean then excluded.status else items.status end,
            progress = case when ${pr}::boolean then excluded.progress else items.progress end,
            gate = case when ${sent('gate')}::boolean then excluded.gate else items.gate end,
            sort = case when ${sent('sort')}::boolean then excluded.sort else items.sort end,
            updated_at = now()`;
}
