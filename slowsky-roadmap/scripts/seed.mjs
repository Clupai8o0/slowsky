// Create the tables and load data/seed.mjs. Safe to run again: existing items keep their status
// and progress, every other field is reset to data/seed.mjs, and the first log lines are only
// written into an empty log.
// Run: npm run seed   (reads DATABASE_URL from .env.local)
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { upsertQuery, validateItem } from '../api/_lib.js';
import { items, updates } from '../data/seed.mjs';

async function main()
{
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) {
        throw new Error('DATABASE_URL is not set (run vercel env pull .env.local)');
    }
    const sql = neon(url);

    const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
    const statements = schema
        .split(/;\s*(?:\n|$)/)
        .map((part) => part.replace(/^\s*--.*$/gm, '').trim())
        .filter(Boolean);
    for (const statement of statements) {
        await sql.query(statement);
    }

    const valid = items.map(validateItem);
    const ids = new Set(valid.map((item) => item.id));
    if (ids.size !== valid.length) {
        throw new Error('Duplicate ids in data/seed.mjs');
    }
    // partial = false: every field comes from data/seed.mjs; status and progress are kept.
    await sql.transaction(valid.map((item) => upsertQuery(sql, item, true, false)));

    const [{ count }] = await sql`select count(*)::int as count from updates`;
    if (count === 0) {
        await sql.transaction(updates.map((u) => sql`
            insert into updates (item_id, author, status, progress, note, at)
            values (${u.item_id}, ${u.author}, ${u.status}, ${u.progress}, ${u.note}, ${u.at})`));
    }
    const [{ total }] = await sql`select count(*)::int as total from items`;
    console.log(`items: ${total}, seeded log lines: ${count === 0 ? updates.length : 0}`);
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
