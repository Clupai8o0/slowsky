// POST /api/update: log a progress note, optionally moving one item's status and progress.
// Body: { "note": "...", "author": "...", "id": "item-id"?, "status": "doing"?, "progress": 40? }
import { HttpError, db, handle, itemId, json, progress, readJson, requireKey, status, text } from './_lib.js';

export const POST = handle(async (request) => {
    requireKey(request);
    const body = await readJson(request, 20000);
    const note = text(body.note, 'note', 2000, { required: true });
    const author = text(body.author, 'author', 80) ?? 'unknown';
    const id = body.id === undefined || body.id === null || body.id === '' ? null : itemId(body.id);
    const newStatus = status(body.status);
    let newProgress = progress(body.progress);
    if (newStatus === 'done' && newProgress === null) {
        newProgress = 100;
    }
    if (id === null && (newStatus !== null || newProgress !== null)) {
        throw new HttpError(400, 'status and progress need an item id');
    }

    const sql = db();
    // One statement, so the item change and its log line land together or not at all.
    const rows = await sql`
        with changed as (
            update items
               set status = coalesce(${newStatus}::text, status),
                   progress = coalesce(${newProgress}::int, progress),
                   updated_at = now()
             where id = ${id}::text
         returning *
        ), logged as (
            insert into updates (item_id, author, status, progress, note)
            select ${id}::text, ${author}::text, ${newStatus}::text, ${newProgress}::int, ${note}::text
             where ${id}::text is null or exists (select 1 from changed)
         returning *
        )
        select (select row_to_json(changed) from changed) as item_row,
               (select row_to_json(logged) from logged) as update_row`;
    const row = rows[0];
    if (!row || !row.update_row) {
        throw new HttpError(404, `No item with id ${id}`);
    }
    return json({ item: row.item_row, update: row.update_row }, 201);
});
