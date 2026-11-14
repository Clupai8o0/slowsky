# Sources

Where the facts in this repo come from. Licences and credit lines are in [DATA-LICENSES.md](DATA-LICENSES.md).

## How this list was made

- On 14 Nov 2026 an AI model (Claude Opus 5.5) opened the source pages it could reach and matched the claims in
  the README, the page text, the target cards and the AI prompt against them.
- Pages it could not reach, and values read by eye from a figure, are listed under "Not confirmed" below.
- A second model from another maker (Gemini Argon) then read the claims and this list as pasted text, with no web
  access, and marked what it judged wrong or unsupported.
- Each of those marks was checked against a fetched page or this repo's own files before anything was changed.
- Codex (GPT-6.1) checked, in two passes, that each row points at files that really carry the claim.
- Codex and Grok 4.7 then each opened the sources for 15 of the rows themselves. Neither found a source that
  failed to support its row. Rows they found only partly supported were reworded or given a second source.
- Where a check questioned a number (the brightness of WISE 0855, and the conditions behind SPHEREx's depth),
  the paper's own table or figure caption settled it.
- These checks were run by AI tools. No person has gone through this list line by line.
- Numbers the page measures itself (brightness curves, shifts, noise bands) are not here. They come from the code
  in `src/lib/` and its tests.

The last column says what the source gives, in our own words.

## SPHEREx and its camera

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| Covers 0.75 to 5.0 µm | `README.md`, `src/lib/insight-prompt.ts` | [Bock et al. 2025][bock], abstract | The 0.75 to 5 µm range |
| Has 102 spectral channels | `src/lib/insight-prompt.ts` | [Bock et al. 2025][bock], abstract; [arXiv:2511.15823][l2], abstract | 102 bands across that range |
| The whole range is infrared | `README.md` ("all infrared"), `src/ui/app.ts`, `src/lib/insight-prompt.ts` | [Bock et al. 2025][bock], abstract; [NASA Science][visible]; [NASA glossary][glossary] | Bock et al. call the survey a near-infrared one over 0.75 to 5 µm. NASA puts the eye's limit at 700 nm. NASA's glossary starts infrared at 0.78 µm, so the 0.75 to 0.78 µm edge depends on which definition is used |
| Maps the whole sky and comes back to each part | `README.md`, `src/lib/insight-prompt.ts` | [Bock et al. 2025][bock], abstract | Four maps of the whole sky in two years |
| SPHEREx has six detectors | `README.md`, `src/ui/app.ts` ("Detector N of 6"), `src/ui/copy.ts`, `src/lib/insight-prompt.ts` | [SPHEREx instrument page][inst] | Six 2K by 2K detector arrays |
| The six detector ranges: 0.75–1.09, 1.10–1.62, 1.63–2.41, 2.42–3.82, 3.83–4.41, 4.42–5.00 µm | `src/ui/copy.ts` | [SPHEREx instrument page][inst], Table 1; [Explanatory Supplement][supp], Table 2 | The instrument page lists bands 1 to 6 with these limits in its 2021 parameter table. These are nominal values (the code calls them that). The supplement's measured edges overlap slightly, for example band 1 runs 0.744 to 1.116 µm and band 2 from 1.099 µm |
| Pixels about 6.2 arcsec wide | `src/lib/insight-prompt.ts`, `src/lib/insight-facts.ts` | [Bock et al. 2025][bock], abstract | 6.2 arcsec pixels |
| Native pixel of 6.15 arcsec used in the code | `src/ui/measure.ts`, `src/ui/demo-source.ts`, `src/lib/source.ts`, `src/lib/regrid.ts`, `src/lib/photometry.ts`, `src/lib/halo.ts`, `src/lib/flags-view.ts` | [Explanatory Supplement][supp], Table 2 | 6.15 × 6.15 arcsec |
| Detectors have 2040 × 2040 active pixels | `src/lib/source.ts`, `src/lib/flags.ts` | [Explanatory Supplement][supp] | 2040 × 2040 active pixels |
| Each part of the detector sees a slightly different wavelength | `README.md` | [Bock et al. 2025][bock], section IV.2.5 | The filter's wavelength changes smoothly across the field of view |
| Each exposure sees a given spot at one wavelength only, so frames are compared only when their wavelengths match | `README.md` (step 4), `src/ui/copy.ts` ("matched closely in colour"), `src/lib/insight-prompt.ts`, `src/lib/lock.ts` | [Bock et al. 2025][bock], section IV.2.5 | A source's wavelength in an exposure depends on where it falls on the filter. The matching rule is our own, in `src/lib/lock.ts` |
| Each file carries a zodiacal light model as its own layer, not yet subtracted from the image | `README.md`, `src/lib/types.ts` | [arXiv:2511.15823][l2], sections IV.2 and V.1 | The image layers are IMAGE, FLAGS, VARIANCE, ZODI, PSF and WCS-WAVE. The zodiacal model is its own layer and is not subtracted from IMAGE |
| Zodiacal light is the glow of sunlit dust in the solar system | `README.md` | [NASA Science, zodiacal light][zodi] | Sunlight scattered by dust in the inner solar system |
| Image values are in MJy/sr | `src/lib/types.ts` | [arXiv:2511.15823][l2], section V.1 | The unit of the spectral image |
| A star too bright for the camera has no value at its centre, and the page paints that blank centre white | `src/ui/app.ts`, `src/ui/compose.ts` | [Explanatory Supplement][supp] | Early-overflow pixels are stored as NaN. Painting them white is this page's own choice: `fillCores` in `src/ui/compose.ts` fills a small blank patch ringed by bright pixels, in Blink and Stack only. Other blank areas stay empty |

## Where the data lives

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| Frames sit in the public S3 bucket `nasa-irsa-spherex` | `README.md`, `DATA-LICENSES.md` | [IRSA cloud access][cloud]; our own request to the bucket, 14 Nov 2026 | Bucket name, region us-east-1, no credentials needed; the bucket answers pages on other sites |
| IRSA's frame search does not accept calls from other websites' pages | `README.md` | Our own request to `irsa.ipac.caltech.edu/SIA`, 14 Nov 2026 | The reply carries no cross-origin header |
| The busiest spots are near the ecliptic poles | `README.md`, `src/lib/sia.ts` | [Bock et al. 2025][bock], abstract and section IV.2.4; [Explanatory Supplement][supp] | SPHEREx makes two deep maps, one at the north ecliptic pole and one near the south ecliptic pole (moved off the pole to keep clear of the Magellanic Clouds). Section IV.2.4 gives over 400 observations per channel at their centres, against about 4 for the rest of the sky |
| DR1 is doi:10.26131/IRSA678 | `DATA-LICENSES.md`, `src/ui/app.ts`, `src/lib/source.ts` | [DR1 overview][dr1] | The DOI of the DR1 spectral images |
| QR3 is doi:10.26131/IRSA662 | `DATA-LICENSES.md`, `src/ui/app.ts`, `src/lib/source.ts` | [Quick release overview][qr] | The QR3 DOI |
| QR2 is doi:10.26131/IRSA652 (named only to say it is not used) | `DATA-LICENSES.md` | [Quick release overview][qr] | The QR2 DOI |
| IRSA data is public; it asks for an acknowledgement and the dataset DOI | `DATA-LICENSES.md` | [IRSA terms][irsa]; [IRSA acknowledgements][ack] | No usage restrictions on most data; the acknowledgement text |
| Gaia DR3 is under CC BY-NC 3.0 IGO | `DATA-LICENSES.md`, `src/ui/app.ts`, `src/lib/source.ts` | [Gaia licence][gaialic] | The licence name |
| Gaia credit line "ESA, Gaia DPAC" | `DATA-LICENSES.md`, `README.md`, `src/ui/app.ts`, `src/lib/source.ts` | [ESA archive terms][esdc] | The Gaia credit line |
| Commercial use of Gaia data needs a request to ESA | `DATA-LICENSES.md` | [ESA archive terms][esdc] | The contact for a commercial licence |
| Gaia DR3 is doi:10.5270/esa-qa4lep3 | `src/ui/app.ts` | [doi.org][gaiadoi] | The DOI resolves to ESA's DR3 page |
| Gaia DR3 positions are given for 2016.0 | `README.md`, `src/lib/gaia.ts`, `src/lib/source.ts` | [Gaia DR3 page][gaiadr3] | Reference epoch 2016.0; DR3 itself came out in June 2022 |
| SIMBAD is free to use under ODbL; cite Wenger et al. 2000 | `DATA-LICENSES.md` | [SIMBAD at CfA][simbad] | The licence line and the paper to cite |

## The five targets

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| Positions for 2000.0, proper motions and parallaxes for all five targets; radial velocities for Barnard's Star, RW Aurigae and R Draconis only | `src/data/targets.json` | [SIMBAD at CfA][simbad], TAP query, 14 Nov 2026 | The stored values match SIMBAD's rows. SIMBAD has no radial velocity for Epsilon Indi B or WISE 0855, and the file has none either |
| Barnard's Star in Gaia | `src/data/targets.json`, `public/snapshot/barnard/gaia.json` | Gaia DR3 TAP query at ESA, 14 Nov 2026 | Gaia DR3 source 4472832130942575872 gives the same proper motion (−801.551, 10362.394 mas a year) and parallax (546.976 mas) as the stored SIMBAD row. Its position is for 2016.0, so it differs from the stored 2000.0 position by the star's motion |
| Barnard's Star moves fastest across our sky | `README.md`, `src/ui/copy.ts` | [ESA, proper motion][esapm]; [NASA Astrobiology][barnard] | ESA names it the star with the largest known proper motion, about 10.3 arcsec a year. NASA words the same point as "likely" |
| Proper motion is the slow drift of a star across the sky, year by year | `README.md` | [ESA, proper motion][esapm] | How far a star shifts across the sky each year, in arcseconds |
| Barnard's Star moves about 10.4 arcsec a year, towards the north | `src/ui/app.ts` (motion arrow), `src/ui/copy.ts` ("walking north") | SIMBAD proper motion | Worked out here from SIMBAD's −801.551 and 10362.394 mas a year: 10.39 arcsec a year, a few degrees west of north |
| RW Aurigae changes its brightness | `README.md`, `src/ui/copy.ts` | [SIMBAD at CfA][simbad]; [NASA, T Tauri stars][ttau] | SIMBAD lists it as a T Tauri star (type TT*). The NASA page, which is about another T Tauri star (HP Tau), says stars of this kind change in brightness, both regularly and irregularly |
| RW Aurigae is a young star | `src/ui/copy.ts` | [SIMBAD at CfA][simbad]; [NASA, T Tauri stars][ttau] | Type TT*. The same NASA page says T Tauri stars tend to be younger than 10 million years |
| Epsilon Indi B is two brown dwarfs | `src/ui/copy.ts` | [SIMBAD at CfA][simbad]; [King et al. 2010][king] | Type BD*, spectral types T1 and T6; the paper's title calls them the nearest known brown dwarfs |
| Brown dwarfs are heavier than planets but too light to shine like stars | `src/ui/copy.ts` | [ESO, Epsilon Indi B][eso0303]; [NASA glossary][glossary] | ESO puts brown dwarfs between the heaviest planets and the lightest stars, too light for the hydrogen fusion that powers stars. NASA's glossary says the same about fusion |
| They fade where methane and water absorb light | `src/ui/copy.ts` | [King et al. 2010][king], spectrum figures | The water and methane bands are marked on the spectra |
| WISE 0855−0714 is the coldest brown dwarf known | `README.md`, `src/ui/copy.ts` | [arXiv:2311.17316][w0855jwst], abstract; [Luhman 2014][luhman], abstract | Both call it the coldest known brown dwarf (papers from 2014 and 2023) |
| WISE 0855 is a near neighbour ("the coldest neighbour") | `src/ui/copy.ts` | [Luhman 2014][luhman], title and abstract | About 2.2 parsecs from the Sun, from a parallax of 0.454 arcsec; the fourth-largest parallax of any known star or brown dwarf at the time |
| WISE 0855 is far brighter at 4.5 µm than at 3.6 µm, with almost no light at shorter wavelengths | `src/ui/copy.ts` | [Luhman 2014][luhman], Table 1 | Magnitude 17.44 at 3.6 µm and 13.89 at 4.5 µm; only upper limits at J, Ks and W1 |
| R Draconis is a giant star that swells and shrinks | `src/ui/copy.ts` | [SIMBAD at CfA][simbad]; [NASA, Mira variables][mira]; [CSIRO, pulsating variables][atnf] | SIMBAD lists it as a Mira variable (type Mi*), spectral type M4.5-6+e. The NASA page, which is about another Mira variable (R Aquarii), says stars of this kind are red giants that pulse over cycles of about 80 to 1000 days, with large changes in brightness. CSIRO's teaching page says pulsating stars change in brightness because their outer layers expand and contract, and that the radius of Mira itself changes by about 20%. Neither page is about R Draconis itself |
| R Draconis' centre is too bright in every saved frame; Barnard's Star's in most | `README.md` | Our own count in `public/snapshot/` | Blank centre in 24 of 24 frames for R Draconis, 22 of 24 for Barnard's Star |
| R Draconis' centre is too bright for the camera in every saved frame | `src/ui/copy.ts` | Our own count in `public/snapshot/` | Blank centre in 24 of 24 frames |
| Barnard's Star's centre may be too bright for the camera | `src/ui/copy.ts` | Our own count in `public/snapshot/` | Blank centre in 22 of 24 frames |
| RW Aur B, 1.5 arcsec from A, is the brighter one in Gaia | `src/ui/measure.ts` | Gaia DR3 TAP query, 14 Nov 2026 | Both stars' rows |
| Human eyes stop at 0.70 µm | `src/ui/app.ts` | [NASA Science][visible] | The eye sees from 380 to 700 nanometres |
| Parallax is a small shift caused by Earth's orbit round the Sun | `README.md` | [ESA, parallax][esaplx] | A nearby star seems to move against far stars as Earth goes round the Sun; for the nearest stars the shift is under 1 arcsec |

## Wavelengths the AI note may name

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| Helium at 1.083 µm | `src/lib/insight-prompt.ts` | [Explanatory Supplement][supp] | The helium line at 1.083 µm, which the supplement says comes from Earth's atmosphere |
| Hydrogen at 1.875 and 4.05 µm | `src/lib/insight-prompt.ts` | [NIST hydrogen table][nist]; [Explanatory Supplement][supp] | NIST lists these two lines only in its air-wavelength table, at 18751.01 and 40511.6 Å; its vacuum table stops in the ultraviolet. The supplement gives Brackett α at 4.052 µm |
| Water ice near 3.05, carbon dioxide ice at 4.27, carbon monoxide ice at 4.67 µm | `src/lib/insight-prompt.ts` | [arXiv:2603.22135][ices] | The three ice features at these wavelengths |
| PAHs at 3.3 µm | `src/lib/insight-prompt.ts` | [arXiv:2503.21876][pah], abstract | The 3.3 µm PAH band |

## Planet Nine comparison

The README's "Limits" section uses these. The chart in `src/lib/planetx.ts` is not on the page.

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| ZTF, DES and Pan-STARRS1 together rule out about 78% of the predicted range; what is left is faint, around V 22 | `README.md`, `src/lib/planetx.ts` | [Brown, Holman & Batygin 2024][ps1], abstract (the 78%) and section VI (what is left) | 78% of their reference population. For what is left, section VI gives a middle value of V 22.0 (+1.1, −1.4) at 550 (+250, −180) AU. The abstract says only that much of it is fainter than V 21 |
| SPHEREx reaches 19.5 to 19.9 AB (5 sigma) below 3.8 µm after four observations in each spectral channel | `README.md`, `src/lib/planetx.ts` | [Bock et al. 2025][bock], abstract and Figure 19 | The abstract gives these depths at 5 sigma after four maps of the whole sky in two years. Figure 19 gives the conditions for the all-sky survey: 4 observations per channel at median sky brightness, with the Galactic plane (latitude within 25°) left out |
| SPHEREx reaches 17.8 to 18.8 AB from 3.8 to 5 µm | `src/lib/planetx.ts` | [Bock et al. 2025][bock], abstract and Figure 19 | Same conditions as the row above |
| Mass 6.2 (+2.2, −1.3) Earth masses, orbit size 380 (+140, −80) AU, albedo 0.2 to 0.75 | `src/lib/planetx.ts` | [Brown & Batygin 2021][orbit], abstract and section 5 | These values, and the radius rule used for 4 to 20 Earth masses |
| Pan-STARRS1 single-visit depths: g 22.0, r 21.8, i 21.5, z 20.9, y 19.7; half complete at V 21.5 | `src/lib/planetx.ts` | [Brown, Holman & Batygin 2024][ps1] | These depths |
| ZTF finds 95% of objects down to about V 20.5 | `src/lib/planetx.ts` | [Brown & Batygin 2022][ztf], abstract (AJ 163, 102) | This depth |
| DES typically reaches r 23.8 | `src/lib/planetx.ts` | [Belyakov et al. 2022][des] | This limit |
| WISE 0855 has W2 = 13.89 ± 0.05 (Vega); AB is 3.339 fainter in W2 | `src/lib/planetx.ts` | [Luhman 2014][luhman], Table 1; [WISE Explanatory Supplement][wise], section IV.4.h, Table 3 | The magnitude and the offset |
| Earth's radius is 6371 km | `src/lib/planetx.ts` | [NASA Earth Fact Sheet][earth] | Volumetric mean radius |
| Size from brightness: D = 1329 km ÷ √albedo × 10^(−H/5) | `src/lib/planetx.ts` | [Masiero et al. 2011][masiero], section 1 | This relation |
| Reflected sunlight falls with the fourth power of distance | `src/lib/planetx.ts` | [arXiv:2506.12854][d4] | This rule |

## What the page does (from this repo's own code and files)

| Claim | Where in this repo | Backed by |
|---|---|---|
| The snapshot holds 24 frames for each of the 5 targets | `README.md` | `public/snapshot/manifest.json` (frameCount 24 for each target); `scripts/bake.py` keeps at most 24 |
| Snapshot cutouts are 112 × 112 pixels | `README.md` | `scripts/bake.py` (the 112-pixel box); `tests/snapshot.test.ts` checks each file's size |
| Snapshot Gaia stars are brighter than magnitude 19, within 0.1° | `README.md` | `scripts/bake.py` (search radius 0.1, rows with G of 19 or more dropped) |
| The Gaia cone search uses the catalogue's 2016.0 positions, so a fast star that walked in since then has no ring | `README.md` | `src/lib/gaia.ts` (the cone is sent as is, and rows keep their 2016.0 epoch); `scripts/bake.py` does the same |
| Live views ask the Gaia catalogue only for stars within 0.2° of the centre | `README.md` | `src/lib/gaia.ts` and `src/lib/source.ts` (0.2° is the widest cone allowed; it applies to the 2016.0 catalogue positions, before stars are moved to a frame's date) |
| Frames taken within 10 days of each other count as one visit | `README.md` | `src/lib/wavelength.ts` (`groupVisits`); `src/lib/source.ts` (a gap of 10 days by default); `tests/wavelength.test.ts` |
| For each visit the page keeps the one frame closest to the chosen wavelength, and only when that wavelength lies inside the frame's band | `README.md`, `src/ui/copy.ts` ("matched closely in colour") | `src/lib/lock.ts`; `src/lib/source.ts` (the limit is half of that frame's own bandwidth by default) |
| The brightness curve divides the target by two to four Gaia comparison stars | `README.md` | `src/ui/measure.ts` (keeps at most 4, and draws no curve with fewer than 2); `tests/measure.test.ts` |
| The archive can cut its frame list short at busy spots, and the page then says so | `README.md` | `src/lib/sia.ts` (at most 2000 rows per query; an overflowing query is retried as 4 time windows, and still-full windows mark the list cut short); `src/lib/source.ts` (the note to the user); `tests/sia.test.ts` |
| Live loading reads at most 60 frames per view | `README.md` | `src/lib/source.ts` (60 headers by default) |

## Software

The licences in [DATA-LICENSES.md](DATA-LICENSES.md) were read from each package's own metadata on 14 Nov 2026:
`package.json` in `node_modules/` for the npm packages, the PyPI record for the Python packages, and
`src/ui/fonts/OFL.txt` for the fonts.

## Not confirmed, or our own choice

- **Comparison-star limits.** The G 9 and G 15 cuts in `src/ui/measure.ts` are our own. No source gives a
  saturation magnitude for SPHEREx.
- **Planet Nine brightness ranges.** The two ranges in `src/lib/planetx.ts` were read by eye from Figure 9 of
  Brown & Batygin 2021. They cannot be checked from the paper's text.
- **Comparing optical limits with SPHEREx depths.** The surveys' limits are optical and SPHEREx's are infrared.
  Setting them side by side is our own rough comparison; no paper cited here makes it.
- **One frame is shallower.** The single-frame depth in `src/lib/planetx.ts` is our own estimate: the
  four-observation depth minus 0.75 mag. No source gives it.
- **"Near a strong spectral line even that small difference can matter"** (README, step 4). This is our own
  reasoning about frames matched to within half a channel. No source cited here says it.
- **The wavelength guess from corner positions being "about 10 pixels off"** (README, Limits). This figure comes
  only from a code comment in `src/lib/source.ts`. No test measures it on real frames. The tests check the method on
  ideal frames, and the code drops the guess when the check frame is more than 40 pixels off.
- **Live loading taking 20 to 45 seconds** (README). This is our own rough timing from loading the presets while
  building the page. No test measures it, and it depends on the connection and on the archive.
- **RW Aurigae's parallax.** `src/data/targets.json` holds SIMBAD's 15.42 mas, which comes from the 2007
  Hipparcos reduction. Gaia DR3 gives 6.406 ± 0.044 mas for RW Aur B. The value only feeds a marker shift far
  smaller than a pixel.
- **W2's wavelength.** 4.6 µm is given in the WISE supplement; the table number quoted in
  `src/lib/planetx.ts` may be off by one.
- **VizieR and the STScI Gaia service.** Their own usage terms could not be reached.
- **Code comments not checked against a source.** The wavelength-grid note in `src/lib/fits.ts` and the caption
  in `src/lib/cube.ts` (not on the page).

[bock]: https://arxiv.org/abs/2511.02985
[l2]: https://arxiv.org/abs/2511.15823
[inst]: https://spherex.caltech.edu/page/instrument
[supp]: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp_QR.pdf
[cloud]: https://irsa.ipac.caltech.edu/cloud_access/
[dr1]: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html
[qr]: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html
[irsa]: https://irsa.ipac.caltech.edu/data_use_terms.html
[ack]: https://irsa.ipac.caltech.edu/ack.html
[gaialic]: https://www.cosmos.esa.int/web/gaia-users/license
[esdc]: https://www.cosmos.esa.int/web/esdc/terms-and-conditions
[gaiadoi]: https://doi.org/10.5270/esa-qa4lep3
[gaiadr3]: https://www.cosmos.esa.int/web/gaia/dr3
[simbad]: https://simbad.cfa.harvard.edu/simbad/
[barnard]: https://astrobiology.nasa.gov/news/barnards-star/
[esapm]: https://www.esa.int/Science_Exploration/Space_Science/Gaia/Proper_motion
[esaplx]: https://www.esa.int/Science_Exploration/Space_Science/Gaia/Parallax
[ttau]: https://science.nasa.gov/image-detail/hubble-hptau-wfc3-1-flat-finalok/
[mira]: https://www.nasa.gov/image-article/watching-volatile-stellar-relationship/
[atnf]: https://www.atnf.csiro.au/outreach/education/senior/astrophysics/variable_pulsating.html
[eso0303]: https://www.eso.org/public/news/eso0303/
[glossary]: https://science.nasa.gov/universe/glossary/
[zodi]: https://science.nasa.gov/universe/stories/quick-reads/be-glad-you-dont-have-to-dust-in-space/
[king]: https://arxiv.org/abs/0911.3143
[w0855jwst]: https://arxiv.org/abs/2311.17316
[luhman]: https://arxiv.org/abs/1404.6501
[visible]: https://science.nasa.gov/ems/09_visiblelight/
[nist]: https://physics.nist.gov/PhysRefData/Handbook/Tables/hydrogentable2.htm
[ices]: https://arxiv.org/abs/2603.22135
[pah]: https://arxiv.org/abs/2503.21876
[ps1]: https://arxiv.org/abs/2401.17977
[orbit]: https://arxiv.org/abs/2108.09868
[ztf]: https://arxiv.org/abs/2110.13117
[des]: https://arxiv.org/abs/2203.07642
[wise]: https://irsa.ipac.caltech.edu/data/WISE/docs/release/All-Sky/expsup/sec4_4h.html
[earth]: https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html
[masiero]: https://arxiv.org/abs/1109.4096
[d4]: https://arxiv.org/abs/2506.12854
