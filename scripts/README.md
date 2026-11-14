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
