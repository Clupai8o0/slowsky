// GET /api/roadmap: every item plus the latest progress updates (LIMIT; the page says when it is hit).
import { db, handle, json, requireKey } from './_lib.js';

const LIMIT = 1500;

export const GET = handle(async (request) => {
    requireKey(request);
    const sql = db();
    const [items, updates] = await sql.transaction([
        sql`select id, kind, title, detail, version, tier, lane, owner, start_at, due_at, status, progress, gate, sort, updated_at
            from items order by sort, id`,
        sql`select id, item_id, at, author, status, progress, note
            from updates order by at desc, id desc limit ${LIMIT}::int`,
    ], { readOnly: true });
    return json({ now: new Date().toISOString(), items, updates, updates_limit: LIMIT });
});
