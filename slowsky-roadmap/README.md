# Slowsky build roadmap

Private tracker for team Clupai's NASA Space Apps 2026 build (product: Slowsky). Not the product itself.

- Web: a timeline, version cards, Sam's steps and a progress feed. Tap any item to move its status or add a note.
- Data: Neon Postgres (Vercel Marketplace, region sin1). Tables in `db/schema.sql`; roadmap data in `data/seed.mjs`.
- Access: one shared key (`ROADMAP_KEY`). The page takes it once from `#key=…` in the link and keeps it on the device.

## Post progress from any session

```sh
python3 ~/Documents/projects/slowsky-roadmap/bin/roadmap.py status
python3 ~/Documents/projects/slowsky-roadmap/bin/roadmap.py update f-s3 --status doing --progress 40 --note "header test passes"
python3 ~/Documents/projects/slowsky-roadmap/bin/roadmap.py note "v0.1 deployed"
python3 ~/Documents/projects/slowsky-roadmap/bin/roadmap.py add f-s3 feature "S3 range reader" --due 2026-11-14T13:00
```

`add` on an existing id is an edit: only the fields you give change (send `null` in a `--file` item to clear one).

The CLI reads `~/.config/slowsky-roadmap/config.json` (`{"url": …, "key": …}`), or `SLOWSKY_ROADMAP_URL` and
`SLOWSKY_ROADMAP_KEY`. Set `ROADMAP_AUTHOR` (or `--author`) so the feed shows who posted.

## API

All routes need `Authorization: Bearer <key>` and send or take JSON.

| Route | Does |
|---|---|
| `GET /api/roadmap` | every item plus the latest 1500 updates (`updates_limit`) |
| `POST /api/update` | `{note, author?, id?, status?, progress?}`; logs a note and moves one item |
| `POST /api/items` | `{items: [...], keepProgress?}`; adds up to 500 items, or edits only the fields sent; status and progress only with `keepProgress: false` |

## Run and deploy

```sh
npm install
vercel env pull .env.local     # DATABASE_URL and ROADMAP_KEY
npm run seed                   # creates tables; re-running keeps status and progress
vercel deploy --prod
```

Times are Nepal time (NPT, UTC+05:45) unless shown otherwise. The API reads a time with no zone as NPT.
`npm run seed` resets every field of the seeded items to `data/seed.mjs` except status and progress.
