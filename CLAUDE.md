# Slowsky (NASA Space Apps 2026, Planet X and SPHEREx)

Product repo, started 14 Nov 2026 at kick-off. Plan and research live in
`~/Documents/projects/spaceapps-melbourne-2026` (`BUILD-PLAN.md`, `research/INDEX.md`). Read them for facts only.

## Rules

- **Nothing from the workspace's `research/` is copied in** (code, data, previews, numbers). Write fresh, download fresh.
- **AI tools:** only Claude and Codex write or review code here (folder treated as confidential; the Terms ban
  Chinese-owned entities). Never DeepSeek, Kimi, Qwen, GLM or MiniMax. Every tool used is named in `README.md`.
- `DECISIONS.md` is Sam's, in his own words. AI never fills it in.
- Every number on a target card comes from code or bakes run in this repo.
- Repo and deploys are **private until Sam says go public**: GitHub repo private; Vercel deploys by CLI as preview
  only (Vercel Authentication on); no Git integration yet, because pushes to main would make production deploys.
- Last Submit Sun 15 Nov 12:30 NPT. Tag and freeze then.

## Data facts

- Frames: SPHEREx DR1 + QR3 only ("R7"). QR2 is refused everywhere (different calibration).
- File URLs come from SIA/TAP `access_url`, never built by hand. SIA has no CORS, so the browser goes through `/api/sia`.
- S3 `nasa-irsa-spherex`: CORS `*`, Range reads. JS cannot see Content-Range, so check status 206 and body length.
- L2 file HDUs: PRIMARY, IMAGE (float32 MJy/sr), FLAGS (RICE_1 tile-compressed BINTABLE), VARIANCE, ZODI, EPSF,
  WCS-WAVE (9x9 lambda/bandwidth grid). Display uses IMAGE - ZODI.
- WCS is TAN-SIP; ignoring SIP costs pixels. Apply proper motion to each frame's own time.
- CDS is down: use `simbad.cfa.harvard.edu`, `vizier.cfa.harvard.edu`, IRSA or ESA HiPS. JPL APIs may not be
  embedded in a website.
- Network calls from Bash need the sandbox off; use `/usr/bin/curl`.

## Layout and owners

| Path | What | Owner |
|---|---|---|
| `src/lib/types.ts` | Module contract; change only with a note | scaffold (session -8d) |
| `src/lib/*.ts` | One module per lane; stubs throw `NotImplemented` | lanes, see BUILD-PLAN "Who builds what" |
| `src/ui/`, landing, styles | UI shell | design session (spaceapps-melbourne-2026-12) |
| `api/sia.ts` | Allowlisted SIA passthrough | SIA lane |
| `scripts/` | Python build-time scripts (astropy, pyvo) | fixtures and bake lanes |
| `tests/` | Vitest; each lane commits its gate test | each lane |

Conventions in `src/lib/types.ts`: ICRS degrees, 0-based pixels (astropy origin=0), MJD, wavelengths in µm.

## Gates (each exits 0 or 1)

- WCS within 0.01 px of astropy at 9 points, both ways.
- S3 cutout sum matches astropy to 1e-3; a bad range aborts.
- Regrid: field stars within 0.3 px across epochs.

## Commands

- `npm test`, `npm run typecheck`, `npm run build`.
- Preview deploy: `vercel deploy` (not `--prod` until Sam says go public).
- Progress: `ROADMAP_AUTHOR=<session> python3 ~/Documents/projects/slowsky-roadmap/bin/roadmap.py update <id> ...`.

## Style

K&R braces: function definitions take the brace on its own line; control statements keep it on the same line and
always have braces.
