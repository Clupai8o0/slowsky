# Data licences and credits

The code is MIT (see [LICENSE](LICENSE)). The data Slowsky shows or ships keeps its own terms, listed here.
Each licence and credit line was checked on the provider's own page on 14 Nov 2026 (the all-sky cube row on
15 Nov 2026), unless marked "not confirmed".

## Data sources

| Source | What Slowsky takes | Licence or terms | Credit line to show | Link |
|---|---|---|---|---|
| SPHEREx DR1, IRSA | Frames, live or snapshot | IRSA terms (1) | SPHEREx, IRSA (3), doi:10.26131/IRSA678 | [DR1][dr1] |
| SPHEREx QR3, IRSA | Frames, live or snapshot | IRSA terms (1) | SPHEREx, IRSA (3), doi:10.26131/IRSA662 | [QR3][qr3] |
| SPHEREx DR1 and QR3 sample files, IRSA | Three frames for **Try real FITS samples** in My frames (`public/samples/`) | IRSA terms (1) | SPHEREx, IRSA (3), doi:10.26131/IRSA678 (two frames) and doi:10.26131/IRSA662 (one frame) | [DR1][dr1], [QR3][qr3] |
| SPHEREx DR1 all-sky cube, IRSA | One spot's spectrum, read live after a press (Spectrum panel) | IRSA terms (1) | SPHEREx, IRSA (3), doi:10.26131/IRSA679 | [DR1][dr1] |
| IRSA SIA search | Lists of frames for a spot | IRSA terms (1) | IRSA line (3) | [Terms][irsa] |
| Gaia DR3, ESA | Star rings, live or snapshot | CC BY-NC 3.0 IGO (2) | "Credit: ESA, Gaia DPAC" | [Licence][gaia] |
| SIMBAD, CfA mirror | Name lookup; target positions | ODbL, per the mirror | SIMBAD line (3) | [SIMBAD][simbad] |
| VizieR, CfA mirror | Gaia rows, bake fallback only | Not confirmed | VizieR line (3) | [VizieR][vizier] |
| 2MASS K image tiles (HiPS), IRSA | The older picture, read live | IRSA terms (1); the tile set's own properties file names no licence | 2MASS line (3); tiles: CNRS/Unistra | [2MASS][2mass] |

Where each one is used:

- SPHEREx frames are read live from the public S3 bucket `nasa-irsa-spherex`. The snapshot in `public/snapshot/`
  holds cutouts of the same files, made by `scripts/bake.py`.
- The all-sky cube tiles are read live from the same bucket, under `dr1/hips5_cube/`, only after a visitor presses
  **Read the spectrum here**. IRSA gives the cube its own DOI (10.26131/IRSA679); DR1's image DOI (IRSA678) does
  not cover it (checked on the DR1 overview page, 15 Nov 2026). No cube pixels are stored in the snapshot.
- `public/samples/` (and the same three files in `tests/fixtures/upload/`, read by `tests/upload-engine.test.ts`) holds
  three SPHEREx level-2 cutouts of Groombridge 1830, 58 × 59 pixels, trimmed to the IMAGE and ZODI planes:
  observations 2025W20_2D_0483_3 and 2025W48_2A_0523_1 (DR1) and 2026W21_2A_0412_1 (QR3), all detector 1. They
  were fetched from IRSA on 15 Nov 2026 during the event; no script in this repo made them. The release of each
  observation comes from IRSA's SIA answer of 15 Nov 2026 (collections `spherex_dr1` and `spherex_qr3`).
- The SIA search runs through `api/sia.ts` in the site, and directly from `scripts/`.
- `tests/fixtures/` holds small SPHEREx DR1 and QR3 cutouts, small byte ranges of all-sky cube tiles
  (`tests/fixtures/cube/`) and IRSA SIA replies used by the tests, under the same IRSA terms. The scripts that
  made them are listed in `scripts/README.md`.
- Gaia DR3 rows (`public/snapshot/*/gaia.json`) were fetched at bake time from STScI's Gaia cone service
  (`gsss.stsci.edu`), with the CfA VizieR mirror as fallback. For live views the page calls the same two services.
- SIMBAD answers name searches typed into the page. `scripts/targets.py` took the five targets' positions and
  proper motions from it into `src/data/targets.json`.
- The older picture is read from IRSA's copy of the 2MASS K HiPS tiles (`irsa.ipac.caltech.edu/data/hips/CDS/2MASS/K`)
  when a visitor switches it on. No 2MASS pixels are stored in this repository or in the snapshot.
- QR2 (doi:10.26131/IRSA652) is never used.

Notes:

1. IRSA names no licence. Its terms page says: "Most data served by IRSA is public, with no usage restrictions."
   It asks for an acknowledgement and the dataset DOI.
2. ESA's archive terms say commercial use needs a request to ESA first (data.licences@esa.int).
   The STScI cone service's own terms: not confirmed. The Gaia rows it returns keep ESA's licence.
3. Credit lines, as each provider words them:
   - SPHEREx: "This publication makes use of data products from the Spectro-Photometer for the History of the
     Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion
     Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space
     Administration."
   - IRSA: "This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National
     Aeronautics and Space Administration and operated by the California Institute of Technology."
   - SIMBAD: "This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France"
     (Wenger et al. 2000, A&AS 143, 9).
   - VizieR: "This research has made use of the VizieR catalogue access tool, CDS, Strasbourg, France
     (DOI: 10.26093/cds/vizier)." Its usage rules sit on a CDS page that could not be reached: not confirmed.
   - 2MASS (in our words, checked 15 Nov 2026): the Two Micron All Sky Survey is a joint project of the University
     of Massachusetts and IPAC/Caltech, funded by NASA and the National Science Foundation (Skrutskie et al. 2006,
     AJ 131, 1163). The full acknowledgement wording is on IRSA's 2MASS page. The page shows the credit that the
     tiles' own properties file gives: "University of Massachusetts & IPAC/Caltech", tiles by CNRS/Unistra.

[dr1]: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html
[qr3]: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html
[irsa]: https://irsa.ipac.caltech.edu/data_use_terms.html
[gaia]: https://www.cosmos.esa.int/web/gaia-users/license
[simbad]: https://simbad.cfa.harvard.edu/simbad/
[vizier]: https://vizier.cfa.harvard.edu/viz-bin/VizieR
[2mass]: https://irsa.ipac.caltech.edu/Missions/2mass.html

## Fonts

| Font | Licence | Notes |
|---|---|---|
| Geist and Geist Mono (The Geist Project Authors) | SIL Open Font License 1.1 | [OFL.txt](src/ui/fonts/OFL.txt) |

The font files in `src/ui/fonts/` are unmodified Latin subsets from fontsource.

## Code dependencies

`package.json` lists one runtime package, used only by the server route that writes the AI note. The rest are
build and test tools. Their own dependencies are in `package-lock.json`.

| Package | Version | Licence | Used for |
|---|---|---|---|
| @anthropic-ai/sdk | 1.8.0 | Apache-2.0 | Calling the Claude API from `api/insight.ts` (server only) |
| typescript | 7.0.2 | Apache-2.0 | Type checking |
| vite | 8.3.8 | MIT | Dev server and build |
| vitest | 5.1.0 | MIT | Tests |

Python packages for the build-time scripts in `scripts/` (versions not pinned; licences from PyPI):

| Package | Licence | Used for |
|---|---|---|
| astropy | BSD-3-Clause | FITS files, sky mapping and time |
| numpy | BSD-3-Clause (some bundled parts 0BSD, MIT, Zlib, CC0-1.0) | Arrays |
| pyvo | BSD-3-Clause | SIA queries in `bake.py` |
| requests | Apache-2.0 | HTTP |

Astropy asks to be cited (Astropy Collaboration 2013, 2018, 2022) in work that uses it.

## AI-made content

The code, tests and page text were written with help from Claude Code, Codex, Gemini and Grok (the full table is
in the README). The optional research note on the site is written by Claude Opus 5.5 from the page's own
measurements and is labelled as written by AI.
The demo video's voice is AI-made (ElevenLabs); any GPT Image pictures are decoration, marked, and never sky data.
