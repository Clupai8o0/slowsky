# Data licences and credits

The code is MIT (see [LICENSE](LICENSE)). The data Slowsky shows or ships keeps its own terms, listed here.
Each licence and credit line was checked on the provider's own page on 14 Nov 2026, unless marked "not confirmed".

## Data sources

| Source | What Slowsky takes | Licence or terms | Credit line to show | Link |
|---|---|---|---|---|
| SPHEREx DR1, IRSA | Frames, live or snapshot | IRSA terms (1) | SPHEREx, IRSA (3), doi:10.26131/IRSA678 | [DR1][dr1] |
| SPHEREx QR3, IRSA | Frames, live or snapshot | IRSA terms (1) | SPHEREx, IRSA (3), doi:10.26131/IRSA662 | [QR3][qr3] |
| IRSA SIA search | Lists of frames for a spot | IRSA terms (1) | IRSA line (3) | [Terms][irsa] |
| Gaia DR3, ESA | Star rings in the snapshot | CC BY-NC 3.0 IGO (2) | "ESA/Gaia/DPAC" | [Licence][gaia] |
| SIMBAD, CfA mirror | Name lookup; target positions | ODbL, per the mirror | SIMBAD line (3) | [SIMBAD][simbad] |
| VizieR, CfA mirror | Gaia rows, bake fallback only | Not confirmed | VizieR line (3) | [VizieR][vizier] |

Where each one is used:

- SPHEREx frames are read live from the public S3 bucket `nasa-irsa-spherex`. The snapshot in `public/snapshot/`
  holds cutouts of the same files, made by `scripts/bake.py`.
- The SIA search runs through `api/sia.ts` in the site, and directly from `scripts/`.
- Gaia DR3 rows (`public/snapshot/*/gaia.json`) were fetched at bake time from STScI's Gaia cone service
  (`gsss.stsci.edu`), with the CfA VizieR mirror as fallback. For live views the page calls the same two services.
- SIMBAD answers name searches typed into the page. `scripts/targets.py` took the five targets' positions and
  proper motions from it into `src/data/targets.json`.
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

[dr1]: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html
[qr3]: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html
[irsa]: https://irsa.ipac.caltech.edu/data_use_terms.html
[gaia]: https://www.cosmos.esa.int/web/gaia-users/license
[simbad]: https://simbad.cfa.harvard.edu/simbad/
[vizier]: https://vizier.cfa.harvard.edu/viz-bin/VizieR

## Fonts

| Font | Licence | Notes |
|---|---|---|
| Geist and Geist Mono (The Geist Project Authors) | SIL Open Font License 1.1 | [OFL.txt](src/ui/fonts/OFL.txt) |

The font files in `src/ui/fonts/` are unmodified Latin subsets from fontsource.

## Code dependencies

`package.json` lists no runtime packages. These are build and test tools; their own dependencies are in
`package-lock.json`.

| Package | Version | Licence | Used for |
|---|---|---|---|
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

The code, tests and page text were written with help from Claude Code and Codex.
The demo video's voice is AI-made (ElevenLabs); any GPT Image pictures are decoration, marked, and never sky data.
