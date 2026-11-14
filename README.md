# Slowsky

Built for the NASA Space Apps Challenge 2026 (Melbourne), challenge "Planet X and SPHEREx", by team Clupai.

Status: being built during the event, 14 to 15 Nov 2026.

## Run it

```sh
npm install
npm run dev      # local site
npm test         # unit tests and test gates
npm run build    # typecheck and production build
```

Build-time Python scripts live in `scripts/` (see `scripts/README.md`).

## Data

All images come from NASA's SPHEREx mission (DR1 and QR3), read straight from the NASA/IPAC Infrared Science
Archive's public S3 bucket. Licences and credits for every data source: `DATA-LICENSES.md`.

## AI tools used

| Tool | Maker | Used for |
|---|---|---|
| Claude Code (Claude Opus, Sonnet and Haiku models) | Anthropic | Writing and reviewing code, tests, planning help, page text drafts |
| Codex | OpenAI | Writing and reviewing code |
| ElevenLabs | ElevenLabs | AI voice in the demo video |
| GPT Image | OpenAI | Decorative images, if used, marked where they appear |

Sam chose the idea and makes every product decision (see `DECISIONS.md`).

## Licence

Code: MIT (`LICENSE`). Data: see `DATA-LICENSES.md`.
