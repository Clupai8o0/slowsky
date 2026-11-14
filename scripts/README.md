# Build-time scripts

Python, run on a laptop, never on the server. Each writes small JSON or binary fixtures that are committed;
raw downloads go to `data-raw/` (git-ignored).

```sh
python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt
```

| Script | Writes | Lane |
|---|---|---|
| `targets.py` | `src/data/targets.json` (5 official targets: position, epoch, proper motion, source) | fixtures |
| `fixtures.py` | `tests/fixtures/` (one real DR1 header, a small box of pixels, astropy WCS and wave values) | fixtures |
| `bake.py` | `public/snapshot/` (frame lists, raw cutouts, Gaia rows for the 5 targets) | snapshot bake |

## Browser smoke test

`smoke.py` opens the built app in headless Chromium and checks the five preset targets. It exits 0 only if every check passes, so run it before each deploy.

```sh
python3 scripts/smoke.py --mode offline            # the gate: archive and /api/ blocked, snapshot must work
python3 scripts/smoke.py --base https://<preview> --mode both   # a deployed preview, offline and live
```

Needs Playwright for Python with Chromium (not in `requirements.txt`). Without `--base` it runs `npm run build` and serves `dist/` with `vite preview` on a free port from 5210, then stops it. Each target needs a "Frame N of M" label, a non-blank canvas, no page or console errors, the snapshot notice (offline), and a frame change on Next. Screenshots go to `--out` (default a temp folder).
