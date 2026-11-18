# Slowsky workspace archive

This branch holds the hackathon workspace around Slowsky (NASA Space Apps 2026, Melbourne, 14 to 15 Nov 2026).
It is an archive. It is not the product. The product code is on `main`.

## What is here

| Folder | What |
|---|---|
| `scraper/`, `data/`, `docs/` | Scraper for the Space Apps site, the scraped challenge data, and the docs built from it |
| `research/scripts/`, `research/data/` | Data exploration scripts and the small manifests (the FITS cache is left out; it can be fetched again from IRSA) |
| `design/` | UI revamp prototypes, screenshots and design briefs |
| `submission/` | Project page draft and screenshots |
| `video/` | Demo film projects (Remotion), renders, voice samples and AI image experiments |
| `slowsky-roadmap/` | The private build tracker site (no keys) |
| `slowsky-local-branches.bundle` | Every local branch that was never pushed, plus uncommitted work saved as `archive/wip/*` commits |

## Left out

- `node_modules` and the Python venv (install again from the lock files).
- Paper PDFs (copyrighted; links are in the research notes).
- The SPHEREx FITS cache and previews.
- Older screenshot rounds of the film (`ui-r2`, `ui-r3`).
- Build logs and private run notes.

## Restore the local branches

```sh
git clone https://github.com/Clupai8o0/slowsky.git && cd slowsky
git fetch origin workspace-archive
git show origin/workspace-archive:slowsky-local-branches.bundle > /tmp/local.bundle
git fetch /tmp/local.bundle 'refs/heads/*:refs/heads/*'
```

## AI use

The demo film uses AI-generated images (GPT Image) as decoration and an AI voice (ElevenLabs).
The sky images are real SPHEREx data.
Code and reviews used Claude, Codex, Gemini and Grok, as the product README says.
