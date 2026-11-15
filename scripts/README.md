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
| `bake_comet.py` | `public/comet/3i-atlas.json` (twelve 41 x 41 cut-outs of comet 3I/ATLAS from 14 Dec 2025, via IRSA MOST) | comet |
| `make_cube_fixture.py` | `tests/fixtures/cube/` (small byte ranges of the all-sky spectral cube, with reference values) | spectrum |
| `make_flags_fixture.py` | `tests/fixtures/flags/` (a few compressed tiles of one frame's FLAGS layer, with decoded values) | flags |

## Browser smoke test

`smoke.py` opens the built app in headless Chromium and checks the five preset targets. It exits 0 only if every check passes, so run it before each deploy.

```sh
python3 scripts/smoke.py --mode offline            # the gate: archive and /api/ blocked, snapshot must work
python3 scripts/smoke.py --base https://<preview> --mode both   # a deployed preview, offline and live
python3 scripts/smoke.py --self-test               # pure checks only, no browser needed
```

Needs Playwright for Python with Chromium (not in `requirements.txt`). Without `--base` it runs `npm run build` and serves `dist/` with `vite preview` on a free port from 5210, then stops it. Each target needs a "Frame N of M" label, a non-blank canvas, no page or console errors, the snapshot notice (offline), and a frame change on Next. Screenshots go to `--out` (default a temp folder).

Each target must also be the selected one after its click (its button is pressed and the details change), and with playback paused, Next must move to the next frame and change the canvas pixels. Only requests this script aborted on purpose are allowed to fail; any other failed request or console error fails the run. `npm run build` is capped at 300 s, and SIGTERM or Ctrl-C stops the preview server it started. Hidden switches prove the test can fail: `--break snapshot|target|next` (block the snapshot, make target buttons or Next do nothing); each must exit 1.

Live mode (`--mode live`) opens each preset from the saved copy and presses Go live. Proof requires a status starting with `Live:`, no visible error, and a non-blank first frame whose HTTPS FITS link on an allowed SPHEREx S3 host matches a FITS file fetched after the click. The FITS response must be 200, 206 or 304, and the exact `/api/sia` path must respond with 200 or 304. It waits up to `--live-timeout` seconds (default 90), compares the first frame and frame list with the saved copy for the PASS note, and checks Next when multiple frames are available. A fallback to the saved copy fails the target; `--allow-fallback` accepts the archive-unavailable fallback immediately with a note and excludes archive request and console failures from that outcome. `--break live` (hidden) blocks `/api/sia` and S3 and must make live mode exit 1. `--self-test` covers the pure checks only, not browser behavior or live network requests.
