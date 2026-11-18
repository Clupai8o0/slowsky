// POST /api/items: add or edit items in bulk.
// Body: { "items": [ {id, kind, title, ...} ], "keepProgress": true }
// keepProgress (default true) leaves an existing item's status and progress alone.
import { HttpError, db, handle, json, readJson, requireKey, upsertQuery, validateItem } from './_lib.js';

export const POST = handle(async (request) => {
    requireKey(request);
    const body = await readJson(request, 500000);
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 500) {
        throw new HttpError(400, 'items must be a list of 1 to 500 items');
    }
    const items = body.items.map(validateItem);
    const ids = new Set(items.map((item) => item.id));
    if (ids.size !== items.length) {
        throw new HttpError(400, 'Duplicate ids in items');
    }
    const keepProgress = body.keepProgress !== false;
    const sql = db();
    await sql.transaction(items.map((item) => upsertQuery(sql, item, keepProgress)));
    return json({ upserted: items.length }, 200);
});
