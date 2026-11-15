# Sources

Where the facts in this repo come from. Licences and credit lines are in [DATA-LICENSES.md](DATA-LICENSES.md).

## How this list was made

- On 14 Nov 2026 an AI model (Claude Opus 5.5) opened the source pages it could reach and matched the claims in
  the README, the page text, the target cards and the AI prompt against them.
- Pages it could not reach, and values read by eye from a figure, are listed under "Not confirmed" below.
- A second model from another maker (Gemini Argon) then read the claims and this list as pasted text, with no web
  access, and marked what it judged wrong or unsupported.
- Claude (in Claude Code) then checked each of those marks against a fetched page or this repo's own files before
  anything was changed.
- Codex (GPT-6.1) checked, in two passes, that each row points at files that really carry the claim.
- Codex and Grok 4.7 then each opened the sources for 15 of the rows themselves. Neither found a source that
  failed to support its row. Rows they found only partly supported were reworded or given a second source.
- Where a check questioned a number (the brightness of WISE 0855, and the conditions behind SPHEREx's depth),
  the paper's own table or figure caption settled it.
- On 15 Nov 2026 the help text was added and checked the same way: Claude Opus 5.5 with the sources open, then
  Gemini Argon as a first-time reader (see "Help text").
- These checks were run by AI tools. No person has gone through this list line by line.
- On 15 Nov 2026 Claude Opus 5.5 opened the pages for the "Spectrum (SPHEREx all-sky cube)" rows (the DR1
  overview, Explanatory Supplement version 2.1 of 10 Nov 2026, IRSA's cloud and data access pages, the HiPS cube
  tutorial, the NIST tables and the arXiv papers) and checked each row against them. The same day two more AI
  tools checked those rows: Gemini Argon read them against the README and the page text, and Codex opened the
  pages again. What they questioned was reworded (the zodiacal-light model, the helium airglow line, "can
  change", the label count), and our own reads are marked as ours.
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
| Native pixel of 6.15 arcsec used in the code | `src/ui/measure.ts`, `src/ui/demo-source.ts`, `src/lib/source.ts`, `src/lib/regrid.ts`, `src/lib/photometry.ts`, `src/lib/halo.ts`, `src/lib/flags-view.ts`, `src/lib/falsecolour-view.ts` | [Explanatory Supplement][supp], Table 2 | 6.15 × 6.15 arcsec |
| Detectors have 2040 × 2040 active pixels | `src/lib/source.ts`, `src/lib/flags.ts` | [Explanatory Supplement][supp] | 2040 × 2040 active pixels |
| Each part of the detector sees a slightly different wavelength | `README.md` | [Bock et al. 2025][bock], section IV.2.5 | The filter's wavelength changes smoothly across the field of view |
| Each exposure sees a given spot at one wavelength only, so frames are compared only when their wavelengths match | `README.md` (step 4), `src/ui/copy.ts` ("matched closely in colour"), `src/lib/insight-prompt.ts`, `src/lib/lock.ts` | [Bock et al. 2025][bock], section IV.2.5 | A source's wavelength in an exposure depends on where it falls on the filter. The matching rule is our own, in `src/lib/lock.ts` |
| Each file carries a zodiacal light model as its own layer, not yet subtracted from the image | `README.md`, `src/lib/types.ts` | [arXiv:2511.15823][l2], sections IV.2 and V.1 | The image layers are IMAGE, FLAGS, VARIANCE, ZODI, PSF and WCS-WAVE. The zodiacal model is its own layer and is not subtracted from IMAGE |
| Zodiacal light is the glow of sunlit dust in the solar system | `README.md` | [NASA Science, zodiacal light][zodi] | Sunlight scattered by dust in the inner solar system |
| Image values are in MJy/sr | `src/lib/types.ts` | [arXiv:2511.15823][l2], section V.1 | The unit of the spectral image |
| Each frame has a quality layer that marks pixels by kind, such as cosmic-ray hits; the page's Flagged pixels layer leaves out SOURCE, FULLSAMPLE and GHOST_FPA | `README.md`, `src/ui/slots.ts` | [Explanatory Supplement][supp], Table 16 (version 2.0, 25 Aug 2026) | TRANSIENT is set for a transient such as a cosmic-ray hit, and can also mark charge spilling over from a very bright neighbouring source; hits in the first ten seconds of an exposure may go unflagged. SOURCE is set on a pixel mapped to a known source. FULLSAMPLE marks the small region read out in full and is purely informational. GHOST_FPA is not in use at present. Leaving those three out of the layer is this page's own choice |
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
| Gaia DR3 is doi:10.5270/esa-qa4lep3 | `src/ui/app.ts` (link title) | [doi.org][gaiadoi], [ESA][gaiadr3] | The DOI is registered to ESA's archive page for DR3. On 14 Nov 2026 that ESA page answered "not found", so the page links ESA's own DR3 page and gives the DOI in the link's title |
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
| They are dim at the colours that methane and water absorb | `README.md`, `src/ui/copy.ts` | [King et al. 2010][king], spectrum figures | The water and methane bands are marked on the spectra |
| WISE 0855−0714 is the coldest brown dwarf known | `README.md`, `src/ui/copy.ts` | [arXiv:2311.17316][w0855jwst], abstract; [Luhman 2014][luhman], abstract | Both call it the coldest known brown dwarf (papers from 2014 and 2023) |
| WISE 0855 is a near neighbour ("the coldest neighbour") | `src/ui/copy.ts` | [Luhman 2014][luhman], title and abstract | About 2.2 parsecs from the Sun, from a parallax of 0.454 arcsec; the fourth-largest parallax of any known star or brown dwarf at the time |
| WISE 0855 is far brighter at 4.5 µm than at 3.6 µm, with almost no light at shorter wavelengths | `src/ui/copy.ts` | [Luhman 2014][luhman], Table 1 | Magnitude 17.44 at 3.6 µm and 13.89 at 4.5 µm; only upper limits at J, Ks and W1 |
| R Draconis is a giant star that swells and shrinks | `src/ui/copy.ts` | [SIMBAD at CfA][simbad]; [NASA, Mira variables][mira]; [CSIRO, pulsating variables][atnf] | SIMBAD lists it as a Mira variable (type Mi*), spectral type M4.5-6+e. The NASA page, which is about another Mira variable (R Aquarii), says stars of this kind are red giants that pulse over cycles of about 80 to 1000 days, with large changes in brightness. CSIRO's teaching page says pulsating stars change in brightness because their outer layers expand and contract, and that the radius of Mira itself changes by about 20%. Neither page is about R Draconis itself |
| R Draconis' centre is too bright for the camera in every saved frame; Barnard's Star's in most | `README.md` | Our own count in `public/snapshot/` | Blank centre in 24 of 24 frames for R Draconis, 22 of 24 for Barnard's Star |
| R Draconis' centre is too bright for the camera in every saved frame | `src/ui/copy.ts` | Our own count in `public/snapshot/` | Blank centre in 24 of 24 frames |
| Barnard's Star's centre may be too bright for the camera | `src/ui/copy.ts` | Our own count in `public/snapshot/` | Blank centre in 22 of 24 frames |
| RW Aur B, 1.5 arcsec from A, is the brighter one in Gaia | `src/ui/measure.ts` | Gaia DR3 TAP query, 14 Nov 2026 | Both stars' rows |
| Human eyes stop at 0.70 µm | `src/ui/app.ts` | [NASA Science][visible] | The eye sees from 380 to 700 nanometres |
| Parallax is a small shift caused by Earth's orbit round the Sun | `README.md` | [ESA, parallax][esaplx] | A nearby star seems to move against far stars as Earth goes round the Sun; for the nearest stars the shift is under 1 arcsec |

## Wavelengths on the AI note checker's fixed list

The AI note cannot print these. Its checker keeps only fixed sentence forms filled in from the fact sheet, and none of
them names a spectral feature. The numbers stay on the checker's list of known figures (`CONSTANT_CONTEXT` in
`src/lib/insight.ts`), so their sources stay here.

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| Helium at 1.083 µm | `src/lib/insight.ts` | [Explanatory Supplement][supp] | The helium line at 1.083 µm, which the supplement says comes from Earth's atmosphere |
| Hydrogen at 1.875 and 4.05 µm | `src/lib/insight.ts` | [NIST hydrogen table][nist]; [Explanatory Supplement][supp] | NIST lists these two lines only in its air-wavelength table, at 18751.01 and 40511.6 Å; its vacuum table stops in the ultraviolet. The supplement gives Brackett α at 4.052 µm |
| Water ice near 3.05, carbon dioxide ice at 4.27, carbon monoxide ice at 4.67 µm | `src/lib/insight.ts` | [arXiv:2603.22135][ices] | The three ice features at these wavelengths |
| PAHs at 3.3 µm | `src/lib/insight.ts` | [arXiv:2503.21876][pah], abstract | The 3.3 µm PAH band |

## Spectrum (SPHEREx all-sky cube)

The Spectrum panel (`src/lib/cube.ts`, `src/lib/spectrum-chart.ts`, `src/ui/spectrum-view.ts`) and the README's
lines about it. Checked on 15 Nov 2026 against the pages linked here.

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| The all-sky cube is part of SPHEREx DR1 and covers the whole sky in 102 colours | `README.md`, `src/ui/spectrum-view.ts` (`idle`, `linkEnd` "(SPHEREx DR1 all-sky cube, doi:10.26131/IRSA679)"), `src/lib/cube.ts` (the 102-plane check) | [DR1 overview][dr1]; [Explanatory Supplement 2.1][supp21], section 2.5 | DR1 includes an all-sky cube with full-sky coverage in the 102 nominal channels. The supplement says the cube uses channels 1 to 17 of each of the six detectors, 102 in all |
| The cube was made from the first year of calibrated frames ("first-year all-sky cube") | `src/lib/cube.ts` (`CUBE_CAPTION`, on the page), `README.md` | [Explanatory Supplement 2.1][supp21], sections 1.4, 2.1 and 2.5 | The cubes were built in the Year 1 reprocessing from the Year 1/DR1 calibrated images, over 1.2 million of them, leaving out about 2000 with bad artefacts. Year 1 is surveys 1 and 2, from the first 12.5 months of science operations |
| Each pixel of each colour is the average of the good frame pixels that landed on it, after the archive's zodiacal-light model was subtracted | `README.md` | [Explanatory Supplement 2.1][supp21], sections 2.5 and 3.4 | The ZODI layer is subtracted before the cube is made; input pixels with any of a list of bad flags are rejected; each output pixel is the sum of the input values divided by their count |
| The sky is cut into 12,288 tiles of 512 × 512 pixels of 12.9 arcsec, each tile one FITS file with 102 planes | `README.md`, `src/lib/cube.ts` (`TILE_ORDER`, `TILE_WIDTH`, the size check) | [Explanatory Supplement 2.1][supp21], sections 2.5 and 2.5.1; [IRSA HiPS cube tutorial][hipscube] | HEALPix order 5 tiles, 12,288 of about 1.8° × 1.8°, 512 × 512 pixels of 12.9 arcsec each; the IMAGE layer is a 512 × 512 × 102 cube |
| The values are surface brightness in MJy/sr | `README.md`, `src/lib/cube.ts` (`CUBE_UNIT`; the page prints the file's own `BUNIT`) | [Explanatory Supplement 2.1][supp21], section 2.5.1 | IMAGE holds surface brightness in MJy/sr |
| The colours run from 0.75 to 4.99 µm (the range the summary line can print) | `src/lib/spectrum-chart.ts` (the summary), `README.md` (our reads) | [Explanatory Supplement 2.1][supp21], Tables 29 and 34 | Channel 1 of band 1 is centred at 0.753 µm and channel 17 of band 6 at 4.989 µm. The page reads each plane's wavelength from the tile's own WCS-WAVE table |
| Two colours near 2.4 µm, the ones next to the instrument's beam splitter, are blank everywhere in this cube | `README.md`, `src/lib/cube.ts` (`BLANKCH`) | [Explanatory Supplement 2.1][supp21], section 2.5.2 and Tables 31 and 32; [IRSA HiPS cube tutorial][hipscube] | The two channels next to the dichroic beam splitter (band 3 channel 17 at 2.399 µm, band 4 channel 1 at 2.445 µm) hold no data in the Year 1 cube and are listed in `BLANKCH` |
| The tiles sit in the public bucket `nasa-irsa-spherex`, under `dr1/hips5_cube/` | `README.md`, `src/lib/cube.ts` (`ROOT`, `CUBE_FOLDER`) | [IRSA cloud access][cloud]; [SPHEREx data access][access], "Browsable directories"; our own listing of the bucket, 15 Nov 2026 | Bucket `nasa-irsa-spherex`, region us-east-1, S3 prefix `dr1` for DR1; the browsable path is `hips5_cube/hips_20261026/Norder5/Dir…/`. On 15 Nov 2026 the bucket listed one folder under `dr1/hips5_cube/`: `hips_20261026` |
| The cube is for a quick look, not for measurement ("Not for measurement.") | `src/lib/cube.ts` (`CUBE_CAPTION`), `README.md` | [IRSA HiPS cube tutorial][hipscube], section 6.3; [Explanatory Supplement 2.1][supp21], sections 2.5.1 and 3.4.1 | The tutorial warns that a spectrum taken from the cube "should only be used for visualization" and points to IRSA's spectrophotometry tool for science. The supplement says the cube's wavelength table is fit for visualization, and recommends the single calibrated frames for precision photometry |
| A spot's colours were not all observed at the same time, so a star that varies can look jagged | `src/lib/cube.ts` (`CUBE_CAPTION`), `README.md` | [Explanatory Supplement 2.1][supp21], sections 1.3 and 1.4; [SPHEREx Ices overview][ices], sections III and V.2 and appendix A.2 | Each detector has a filter whose wavelength changes across it, and full spectra come from successive exposures at offset pointings. The Ices paper says a spectrum is built up over days or weeks: a few neighbouring wavelength steps in a row, the next ones hours or days later, and variability on those timescales can add false features. The cube then averages each colour over Year 1. "Jagged" is our own word for that |
| Airglow from Earth's atmosphere leaves stripes in the cube, most of all at the helium line at 1.083 µm; bright lines in nebulae such as Brackett α at 4.05 µm do too | `README.md` (Limits) | [Explanatory Supplement 2.1][supp21], section 2.5.2; [IRSA HiPS cube tutorial][hipscube], section 6 | The supplement names the helium line at 1.083 µm as the most significant airglow stripe, and Brackett α at 4.052 µm from nebulae as a source of stripes. The tutorial names Pa-α, PAH 3.3 µm and Br-α as lines near which the cube shows striping |
| Label "He I" at 1.083 µm | `src/lib/cube.ts` (`LINES`) | [NIST helium table][nisthe]; [Explanatory Supplement 2.1][supp21], sections 2.3 and 2.5.2 | NIST lists He I lines at 10829.09, 10830.25 and 10830.34 Å (air), which round to 1.083 µm. The supplement calls the 1.083 µm helium line atmospheric |
| Label "Paschen α" at 1.875 µm | `src/lib/cube.ts` (`LINES`) | [NIST hydrogen table][nist]; [Murgia et al. 2026][hii], introduction | NIST lists the H I line at 18751.01 Å (air) without naming its series; the SPHEREx Galactic plane paper names Paschen α at 1.87 µm |
| Label "H2O ice" at 3.05 µm, "CO2 ice" at 4.27 µm, "CO ice" at 4.67 µm | `src/lib/cube.ts` (`LINES`) | [SPHEREx Ices overview][ices], Figure 6 caption | H2O at 3.05 µm, CO2 at 4.27 µm and CO at 4.67 µm among the main ice features SPHEREx covers. The abstract alone gives no wavelengths |
| Label "CH4 and PAH" at 3.3 µm | `src/lib/cube.ts` (`LINES`) | [Noll et al. 2000][ch4], abstract; [arXiv:2503.21876][pah], title and abstract; [Murgia et al. 2026][hii], abstract | Noll et al. name "the strong nu(3) methane band at 3.3 microns", seen in brown dwarfs. The other two name the 3.3 µm PAH emission band |
| Label "Brackett α" at 4.05 µm | `src/lib/cube.ts` (`LINES`) | [NIST hydrogen table][nist]; [Explanatory Supplement 2.1][supp21], section 2.5.2; [Murgia et al. 2026][hii], abstract | NIST lists H I at 40511.6 Å (air). The supplement gives Brackett α at 4.052 µm, and the Galactic plane paper maps Brackett α at 4.05 µm |
| The cube's DOI is doi:10.26131/IRSA679, not DR1's image DOI | `DATA-LICENSES.md`, `README.md` | [DR1 overview][dr1] | IRSA asks for 10.26131/IRSA678 for the DR1 spectral images and 10.26131/IRSA679 for the Spectral All-Sky Cube, with the SPHEREx acknowledgement |

## Planet Nine comparison

The README's "Limits" section uses these. The chart (`src/lib/planetx-chart.ts`, numbers from `src/lib/planetx.ts`) is on the page, under the comet card.

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

## Older picture (2MASS K)

All read from the HiPS properties file on 14 Nov 2026, as `src/lib/epoch.ts` records them (`TWO_MASS_K`).

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| The older picture was taken between June 1997 and February 2001 | `src/ui/epoch-view.ts` (the note, the tag `Then: 2MASS, 1997 to 2001`, the bracket legend) | [2MASS K HiPS properties][2massk], `t_min`, `t_max` | t_min 50600 and t_max 51941 (MJD), which are 1 June 1997 and 1 February 2001; months only, not the night of any one field |
| It is the K band, at 2.16 µm | `src/ui/epoch-view.ts` (the note) | [2MASS K HiPS properties][2massk], `em_min`, `em_max`; the survey name in `src/lib/epoch.ts` | 2.015 to 2.303 µm; the library names the survey `2MASS K (2.16um)` |
| 2MASS is a joint project of the University of Massachusetts and IPAC/Caltech, funded by NASA and the National Science Foundation | `README.md` (Data and credits), `DATA-LICENSES.md` | [IRSA's 2MASS page][2mass], "Acknowledgement" | The standard acknowledgement, which names both institutions and both funders; the survey paper is Skrutskie et al. 2006, AJ 131, 1163 |
| Credit: 2MASS, University of Massachusetts & IPAC/Caltech; HiPS tiles CNRS/Unistra, served by IRSA | `src/ui/epoch-view.ts` (the note, built by `epochCredit` in `src/lib/epoch.ts`) | [2MASS K HiPS properties][2massk], `obs_copyright`; tile host from `baseUrl` | The survey's credit holder and its web page; the tiles come from `irsa.ipac.caltech.edu` |

## Comet card

Opened by Claude Opus 5.5 on 15 Nov 2026. The card's numbers come from `scripts/bake_comet.py` and
`public/comet/3i-atlas.json`, not from these pages.

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| 3I/ATLAS is the same object as comet C/2025 N1 (ATLAS) | `src/lib/comet.ts` (title), `README.md` | [MPEC 2025-N12][mpec3i]; [IRSA MOST query][most3i] | The circular's title pairs the two names; MOST answers the name "3I" with "ATLAS (C/2025 N1)" |
| SPHEREx took twelve detector-5 frames of it on 14 Dec 2025, from 04:26 to 07:46 UTC | `src/lib/comet.ts` (caption, labels), `README.md` | [IRSA MOST query][most3i] | Frame list with start times and DR1 file paths; the bake keeps the visits 0685, 0698 and 0712 |
| The SPHEREx team reports carbon dioxide gas glowing at 4.25 to 4.27 µm in this comet | `src/lib/comet.ts` (`CO2_BAND_UM`, caption) | [Lisse et al. 2026 abstract][lisse26] | Lists CO₂ gas emission at 4.25 to 4.27 µm in the December 2025 SPHEREx data |
| The SPHEREx team reported a carbon dioxide coma around 3I/ATLAS | `src/lib/comet.ts` (caption, `COMET_PAPERS`), `README.md` | [Lisse et al. 2025 abstract][lisse25]; [Lisse et al. 2026 abstract][lisse26] | August 2025: a resolved CO₂ gas coma about 3 arcmin in radius; December 2025: the CO₂ coma still reaches about 3 arcmin |
| Lisse et al. 2025 is RNAAS 9, 242; Lisse et al. 2026 is RNAAS 10, 26 | `src/lib/comet.ts` (`COMET_PAPERS`), `README.md` | [Crossref 10.3847/2515-5172/ae0293][cr25]; [Crossref 10.3847/2515-5172/ae3f95][cr26] | Journal, volume and article number for each DOI |

## What the page does (from this repo's own code and files)

| Claim | Where in this repo | Backed by |
|---|---|---|
| The snapshot holds 24 frames for each of the 5 targets | `README.md` | `public/snapshot/manifest.json` (frameCount 24 for each target); `scripts/bake.py` keeps at most 24 |
| Snapshot cutouts are 112 × 112 pixels | `README.md` | `scripts/bake.py` (the 112-pixel box); `tests/snapshot.test.ts` checks each file's size |
| Snapshot Gaia stars are brighter than magnitude 19, within 0.1° | `README.md` | `scripts/bake.py` (search radius 0.1, rows with G of 19 or more dropped) |
| The Gaia cone search uses the catalogue's 2016.0 positions, so a fast star that walked in since then has no ring | `README.md` | `src/lib/gaia.ts` (the cone is sent as is, and rows keep their 2016.0 epoch); `scripts/bake.py` does the same |
| Live views ask the Gaia catalogue only for stars within 0.2° of the centre | `README.md` | `src/lib/gaia.ts` and `src/lib/source.ts` (0.2° is the widest cone allowed; it applies to the 2016.0 catalogue positions, before stars are moved to a frame's date) |
| Gaia stars are brighter than G magnitude 19; live views fetch the 400 brightest at most, and each frame rings only the 40 brightest in the picture | `README.md` | `src/lib/gaia.ts` (rows with G of 19 or more are dropped; the list is sorted by brightness and cut at 400); `src/lib/source.ts` (keeps only stars inside the picture); `src/ui/app.ts` (`GAIA_RINGS = 40`) and `src/ui/measure.ts` (`ringsOn` sorts by brightness and keeps that many) |
| Gaia rows are read through STScI's cone service, with the CfA VizieR mirror as a fallback | `README.md`, `DATA-LICENSES.md` | `src/lib/gaia.ts` (STScI is asked first; the VizieR mirror at `vizier.cfa.harvard.edu` only if that fails or returns nothing); `scripts/bake.py` (the same order when the saved copy is made) |
| The same-wavelength rule, the target's motion, the lining up and the drawing run on the saved copy just as on live frames | `README.md` | `scripts/bake.py` (saves raw cut-outs of the image, the zodiacal model and the variance, with the header and wavelength table); `src/lib/source.ts` (the snapshot source hands those frames to the same assembly step as live frames) |
| Frames from one detector are grouped into visits; a visit takes in every frame that starts up to 10 days after its first one | `README.md` | `src/lib/wavelength.ts` (`groupVisits`); `src/lib/source.ts` (a gap of 10 days by default); `tests/wavelength.test.ts` |
| For each visit the page keeps the one frame closest to the chosen wavelength, and only when that wavelength is within half the bandwidth at the spot | `README.md`, `src/ui/copy.ts` ("matched closely in colour") | `src/lib/lock.ts`; `src/lib/source.ts` (the limit is half of the bandwidth that the frame's wavelength table gives at the spot, by default) |
| The brightness curve is tried only for RW Aurigae and WISE 0855, and divides the target by two to four Gaia comparison stars, dropping one that scatters more than three times as much as the others while more than two remain; of those two targets, only RW Aurigae has two in the offline copy | `README.md` | `src/ui/app.ts` (a curve only for the `variable` and `cold` targets in `src/ui/copy.ts`); `src/ui/measure.ts` (`curveFor` keeps at most 4 slow-moving stars clear of the target, of nearby stars and of the edge, draws no curve with fewer than 2, and removes the worst star while its scatter is over 3 times the median of the others and more than 2 remain); `tests/measure.test.ts`; `curveFor` run on `public/snapshot/` on 14 Nov 2026 |
| The archive can cut its frame list short at busy spots, and the page then says so | `README.md` | `src/lib/sia.ts` (at most 2000 rows per query; an overflowing query is retried as 4 time windows, and still-full windows mark the list cut short); `src/lib/source.ts` (the note to the user); `tests/sia.test.ts` |
| On a 502, 503 or 504 answer from IRSA the server function tries up to three times; when its own answer is still 502 or 503, the page asks again, up to twice, after 1 and 2 seconds | `README.md` | `api/sia.ts` (`RETRY_DELAYS_MS`: waits of 0.5 s and 1.5 s between three tries, inside a 25 s limit); `src/lib/sia.ts` (`SIA_PAGE_RETRY_DELAYS_MS`; a 504 is not asked again, because it means the server function's own time limit ran out); `tests/sia.test.ts` |
| Live loading reads at most 60 frames per view | `README.md` | `src/lib/source.ts` (60 headers by default) |
| The Flagged pixels layer reads flags only when switched on, on live frames in Blink; its note gives the number of flagged pixels and the three most common kinds. The Candidate changes list reads flags by itself on a live view, to leave some spots out and caution others. The pictures, the brightness curve and the motion check do not use them | `README.md` | `src/ui/slots.ts` (`mountFlags` reads them for the layer; `mountChanges` reads them for the change list, through `readFrameFlags` and `screen` in `src/ui/flag-screen.ts`); `src/lib/flags.ts` (reads the FLAGS layer and the flag names from the file itself); `src/lib/flags-view.ts` (the mask, the counts and the sentence); `tests/flags.test.ts`, `tests/flags-view.test.ts`, `tests/slots.test.ts` |

## Help text

The plain-language guide and its word list (`src/ui/help.ts`), written on 15 Nov 2026. Claude Opus 5.5 opened each
source below. Gemini Argon read the sentences as a first-time reader, with no web access, and marked what could
mislead. Several sentences were reworded after the two checks. Both checks were run by AI tools; no person has re-checked each row. What the guide says about the page's own controls was
checked against this repo's code and the rows under "What the page does".

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| SPHEREx is a NASA space telescope that surveys the whole sky | `src/ui/help.ts` (intro) | [NASA SPHEREx mission page][spherexnasa] | An all-sky survey in optical and near-infrared light |
| Eyes see light from about 0.4 to 0.7 µm | `src/ui/help.ts` (µm) | [NASA Science][visible] | The eye sees from 380 to 700 nanometres |
| SPHEREx photographs 0.75 to 5.0 µm in 102 colours, from just past the reddest light eyes can see out into the infrared | `src/ui/help.ts` (µm, Change the colour, Spectrum) | [Bock et al. 2025][bock], abstract | 102 bands from 0.75 to 5 µm. NASA's mission page calls the range optical and near-infrared, and NASA's glossary starts infrared at 0.78 µm, so the short end is just past what eyes see rather than strictly infrared |
| A micrometre is a thousandth of a millimetre | `src/ui/help.ts` (µm) | [NIST SI prefixes][nistsi] | Micro means one millionth, so 1 µm is a millionth of a metre, which is a thousandth of a millimetre |
| Infrared is light with longer waves than red light, which eyes cannot see | `src/ui/help.ts` (infrared) | [NASA Science, infrared waves][nasair] | Infrared lies past the red end of visible light, and the eye cannot see it |
| Cool objects such as brown dwarfs give off most of their light as infrared; brown dwarfs are sometimes called failed stars and never get hot enough to shine the way stars do | `src/ui/help.ts` (infrared) | [JPL, coldest brown dwarfs][jplbd] | Cold brown dwarfs emit most of their light at infrared wavelengths, and are not hot enough for the nuclear burning that powers stars; a caption there calls one a "failed star". That page is about the coldest ones |
| An arcsecond is 1/3600 of a degree | `src/ui/help.ts` (″) | [Chandra X-ray Center, angular scale][chandrascale] | 60 arcminutes to a degree and 60 arcseconds to an arcminute. The centre is run for NASA by the Smithsonian Astrophysical Observatory |
| The full Moon is about half a degree, roughly 1,800″, across | `src/ui/help.ts` (″) | [Chandra X-ray Center, angular scale][chandrascale] | The Sun and Moon are about half a degree across. 1,800″ is our own arithmetic (0.5 × 3600) |
| A SPHEREx pixel is about 6″ wide | `src/ui/help.ts` (″, pixel) | [Bock et al. 2025][bock], abstract; [Explanatory Supplement][supp], Table 2 | 6.2″ pixels in the abstract, 6.15″ in the supplement |
| Gaia is an ESA space telescope that measured the positions, motions and brightness of more than a billion stars | `src/ui/help.ts` (Gaia) | [Gaia DR3 page][gaiadr3]; [ESA, Gaia][esagaia] | DR3 gives positions and brightness for about 1.8 billion sources, and motions for about 1.47 billion |
| Gaia DR3 is the third version of Gaia's star list | `src/ui/help.ts` (Gaia) | [Gaia DR3 page][gaiadr3] | "Gaia Data Release 3", after DR1 and DR2 |
| Most, not all, Gaia stars have a measured motion | `src/ui/help.ts` (catalogue star) | [Gaia DR3 page][gaiadr3]; `src/lib/change-input.ts` | About 344 million DR3 sources have a position only. The page keeps those stars and takes their motion as zero |
| 2MASS photographed the whole sky in infrared light between 1997 and 2001 | `src/ui/help.ts` (2MASS, Older picture) | [IPAC, about 2MASS][2massabout]; [IRSA's 2MASS page][2mass] | Observations ran from June 1997 to February 2001 and covered the whole sky in three near-infrared bands |
| 2MASS used two telescopes on the ground, one in Arizona and one in Chile | `src/ui/help.ts` (2MASS) | [IPAC, about 2MASS][2massabout] | Two 1.3 m telescopes, at Mt. Hopkins, Arizona, and at CTIO, Chile |
| One SPHEREx frame is one exposure of about two minutes | `src/ui/help.ts` (frame) | Our own reading of `public/snapshot/*/index.json` | Each frame's end time is 0.00133 days (about 115 s) after its start |
| An S/N figure can read too high beside a bright star, and figures above 50 show as "S/N > 50" | `src/ui/help.ts` (S/N) | `src/lib/changes.ts` | The code's own notes say the figure can be several times too high near anything bright, and its text for the figure caps at "S/N > 50" |
| A cosmic ray is a fast particle from space | `src/ui/help.ts` (Flagged pixels) | [NASA Goddard, cosmic rays][gsfccr] | Cosmic rays are charged particles that travel through space at close to the speed of light. That one can strike a SPHEREx detector and get a pixel flagged is in the row on the cosmic-ray flag above |
| The Spectrum chart reads the spot at the centre of the view from the SPHEREx all-sky map | `src/ui/help.ts` (Spectrum) | `src/ui/spectrum-view.ts` | The panel's own text says it reads the centre spot, colour by colour, from the SPHEREx all-sky cube |
| A target can be one of the listed ones, a star name or a sky position | `src/ui/help.ts` (Choose a target) | `src/ui/app.ts` | The target list and its search box ("Any star, or RA, Dec") |

## AI-generated content

This list names every part of the site and the demo film that an AI tool made, the model that made it, and where
the record of the request is kept. The sky pictures on the page are real SPHEREx data, and every number on the
page comes from this repo's own code and data, not from an AI tool.

The tools themselves, with their makers, are listed in the README under [AI tools used](README.md#ai-tools-used).

| What | Where you see it | Tool and model | What it was asked to do | Record |
|---|---|---|---|---|
| AI note | The AI note panel on the page, when it is switched on | Claude API; model `claude-opus-5-5` by default (the server setting `INSIGHT_MODEL` can name another, and the note names the model the API reports) | Write a short note from the page's own fact sheet, under three fixed headings. A checker (`checkNote` in `src/lib/insight.ts`) drops any sentence that does not match the sheet. The note stays off until the site owner sets it up | Instructions: `src/lib/insight-prompt.ts`, sent by `api/insight.ts`. Checker: `src/lib/insight.ts` |
| Help text and page wording | Help text (`src/ui/help.ts`); other page text | Help text: Claude Fable 5.2 (`claude-fable-5-2`) in Claude Code, 15 Nov 2026, fact-checked by Claude Opus 5.5 (with web access) and Gemini Argon. Other page text: drafted with Claude Code; model per sentence not recorded | Draft plain-language wording for the page | `src/ui/help.ts` (the result). The prompts are not recorded in this repo |
| Site icon | Browser tab, home-screen icon | Claude Opus 5.5 (`claude-opus-5-5`) in Claude Code, 15 Nov 2026 | Draw an icon as SVG code. It drew four options and Sam chose one: ten blue-to-orange stripes and one white star. It is decoration, not data. The PNG files are the same icon at three sizes | `public/icon.svg` (the result); `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`. The prompt is in the Claude Code session log, not in this repo |
| Code | The whole site | Claude Code (Claude Fable, Opus, Sonnet and Haiku models), Codex (GPT-6.1 Sol and Terra), Gemini (Argon and Carbon); Grok 4.7 for review only. Which model wrote each file is not recorded | Write and review code and tests | This repo's commit history and the README table |
| Demo film images | The demo film's backgrounds and picture elements: `bg_title`, `bg_pluto`, `el_plates`, `bg_sky`, `bg_survey`, `el_telescope`, `bg_world`, `el_browndwarf`, `bg_end` (all nine are used in the film's scene code) | OpenAI GPT Image, model `gpt-image-2`, high quality | Paint decorative pictures in one shared style. They are never sky data | Prompts below. Kept with the film's working files (`video/experiments/gen_assets.sh` and one log per image in `video/experiments/ai-logs/`), not in this repo |
| Demo film voice | The demo film's narration | ElevenLabs, model `eleven_multilingual_v2`, voice Adam Stone ("Smooth, Deep and Relaxed") | Read the six narration lines aloud. Re-recorded on 15 Nov 2026 with the same voice and model: three or more takes per line, one kept, picked by measurement (length, pauses, and a speech-to-text check that every word is there) | Kept with the film's working files (`video/experiments/voice_lines_r7.py`; the first takes: `voice_lines.py`), not in this repo |
| Demo film script and animation code | The demo film's scenes, captions and on-screen text | Claude in Claude Code (a main session and Opus subagents); exact model ids not recorded. The narration words were first drafted with Claude Code in the film plan on 14 Nov 2026. Parts of the code were reviewed with Codex (OpenAI) | Build the film's scenes and timing in code | Kept with the film's working files (`VIDEO-PLAN.md`, `video/film-c/HANDOFF.md`, `src/film/copy.ts`), not in this repo |
| Change sort hint | Nowhere: it is switched off | A small neural network, trained in this repo with PyTorch by scripts that Codex and Claude wrote. It is not generative AI and writes no text or pictures | Trained, not prompted: to label each spot in the change list by kind of change. It is not used | `public/models/change-classifier.json` (the network) and `public/models/change-classifier.card.json` (its description) |

### Prompts

**AI note.** The full instructions are in `src/lib/insight-prompt.ts`. They tell the model to write a short note
from the fact sheet only, using fixed sentence forms.

**Demo film images.** Each image was asked for with its own text, followed by the same style text. The style text,
as the record holds it:

> Painterly cinematic digital illustration, like a premium planetarium picture book. Deep navy and indigo palette
> with soft periwinkle-blue glow and small warm amber accents. Soft volumetric light, fine film grain, gentle
> gradients, calm and full of awe. No text, no letters, no numbers, no logos, no insignia, no flags, no people, no
> faces.

| Image | Shape | Its own text, as the record holds it |
|---|---|---|
| `bg_title` | 16:9 | View from low orbit at night: the curved limb of Earth along the bottom third with a thin glowing blue atmosphere line and faint city lights, a deep calm starfield above with a faint Milky Way band. The upper middle is dark open space. |
| `bg_pluto` | 16:9 | Inside a quiet 1930s observatory at night: dark wood panelling, a brass and wood blink comparator machine on a desk in the left third lit by one warm desk lamp, the open dome slit above showing stars. The centre and right are calm and dark. |
| `bg_sky` | 16:9 | Deep space backdrop: soft indigo nebula wisps and a gentle blue bloom in the centre, sparse fine stars, very calm and mostly dark, made to sit behind an interface. |
| `bg_survey` | 16:9 | Earth seen from space on the left, half in night with a thin blue atmosphere; behind it the band of the Milky Way sweeps diagonally across a deep navy sky; the right half is calm and dark. |
| `bg_world` | 16:9 | The night side of Earth seen from orbit, continents traced by warm amber city lights, a thin blue atmospheric rim, stars above; the globe fills the lower two thirds. |
| `bg_end` | 16:9 | A wide night sky above a dark low horizon of gentle hills, the Milky Way arching across, deep navy and indigo, quiet and spacious, the centre kept dark and open. |
| `el_telescope` | 1:1 | A small stylised space telescope floating alone: three nested conical shields stacked like a funnel opening upward, sitting on a compact hexagonal body, rim-lit by cool blue light. Isolated on a pure black background, nothing else in frame. |
| `el_plates` | 16:9 | Two old square glass astronomical photographic plates side by side, negative images with tiny black star dots on pale grey-cream glass, chipped aged edges. Isolated on a pure black background, nothing else in frame. |
| `el_browndwarf` | 1:1 | A brown dwarf: a dim glowing sphere with deep red, maroon and brown cloud bands, like a small failed star, with a faint red glow. Isolated on a pure black background, nothing else in frame. |

**Demo film voice.** The voice read these lines: "Pluto was found by blinking two photos." "Slow sky: pick a star,
and watch the sky change." "NASA's SPHEREx maps the sky in a hundred and two infrared colours." "These are real
SPHEREx pixels." "Volunteers found over three thousand brown dwarf candidates." "Now anyone can join the hunt."

**Site icon, help text, code and film code.** The prompts are in the coding tools' own session logs, not in this repo.

### Labels

- The AI note's heading shows "AI-generated" and, whenever a note is on screen, the model's name after it (for
  example "AI-generated: Claude Opus 5.5"). The name comes from the model the server reports. The line under each
  note starts "Written by AI from the measurements on this page."
- An answer to a typed question is made of the page's own measured lines; the AI model only chooses which lines to
  show. It is labelled "Chosen by AI (model name) from the measurements on this page." Typed questions are switched
  off on the live page.
- The guide on the page ("What am I looking at?") ends with a line saying the code, the wording and the icon were
  made with AI tools, and links to this list.
- The demo film carries one line on screen: "AI images: OpenAI gpt-image-2 · AI voice: ElevenLabs
  eleven_multilingual_v2". Its end credits repeat both.
- The text written for the video description names the same two models.

## Software

The licences in [DATA-LICENSES.md](DATA-LICENSES.md) were read from each package's own metadata on 14 Nov 2026:
`package.json` in `node_modules/` for the npm packages, the PyPI record for the Python packages, and
`src/ui/fonts/OFL.txt` for the fonts.

## Not confirmed, or our own choice

- **Comparison-star limits** (README, Limits). The G 9 and G 15 cuts in `src/ui/measure.ts` are our own. No source gives a
  saturation magnitude for SPHEREx.
- **Planet Nine brightness ranges.** The two ranges in `src/lib/planetx.ts` were read by eye from Figure 9 of
  Brown & Batygin 2021. They cannot be checked from the paper's text.
- **Comparing optical limits with SPHEREx depths.** The surveys' limits are optical and SPHEREx's are infrared.
  Setting them side by side is our own rough comparison; no paper cited here makes it.
- **One frame is shallower.** The single-frame depth in `src/lib/planetx.ts` is our own estimate: the
  four-observation depth minus 0.75 mag. No source gives it.
- **"Near a strong spectral line even that small difference can matter"** (README, step 4). This is our own
  reasoning about frames matched to within half the bandwidth at the spot. No source cited here says it.
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
- **Code comments not checked against a source.** The wavelength-grid note in `src/lib/fits.ts`.
- **The Spectrum panel's read: our own method and timings.** The 3 × 3 pixel mean minus the median of the pixels 3
  or more pixels away in an 11 × 11 patch, the noise band (1.4826 times the median absolute deviation of those
  background pixels) and the rule that a colour has no value where any of the nine pixels is blank, or every background
  pixel is, are our own choices, in `src/lib/cube.ts`. No source prescribes them; IRSA's tutorial uses its own aperture and annulus.
- **The Spectrum panel's cost.** About 2 MB and about half a minute per read (`src/ui/spectrum-view.ts`, README).
  These come from our own six reads on a live build on 15 Nov 2026 (Barnard's Star, RW Aurigae and WISE 0855−0714,
  each at desktop and phone size): 34 to 36 seconds, 110 requests and 2.09 MB each. They depend on the connection.
- **The Spectrum panel's example results.** Barnard's Star with 9 of 102 colours, RW Aurigae with 85, and WISE
  0855−0714 with 100, where the read at its position was a flat line near zero with one high value near 1.1 µm
  (README, Limits): our own reads of 15 Nov 2026, not repeated by anyone else. Why the counts differ, and what
  the high value is, are not checked here, and we do not claim it is light from that object.
- **"A star that moves, or a neighbour inside the same pixels, can change what is read"** (`src/ui/spectrum-view.ts`,
  README). Our own reasoning from the cube's 12.9 arcsec pixels and its year of averaged frames; no source says it.

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
[supp21]: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf
[hipscube]: https://caltech-ipac.github.io/irsa-tutorials/spherex-hipscube/
[access]: https://irsa.ipac.caltech.edu/spherex-archive-documentation/spherex-data-access/
[nisthe]: https://physics.nist.gov/PhysRefData/Handbook/Tables/heliumtable2.htm
[hii]: https://arxiv.org/abs/2603.23620
[ch4]: https://arxiv.org/abs/astro-ph/0007449
[pah]: https://arxiv.org/abs/2503.21876
[ps1]: https://arxiv.org/abs/2401.17977
[orbit]: https://arxiv.org/abs/2108.09868
[ztf]: https://arxiv.org/abs/2110.13117
[des]: https://arxiv.org/abs/2203.07642
[wise]: https://irsa.ipac.caltech.edu/data/WISE/docs/release/All-Sky/expsup/sec4_4h.html
[earth]: https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html
[masiero]: https://arxiv.org/abs/1109.4096
[d4]: https://arxiv.org/abs/2506.12854
[2massk]: https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/K/properties
[2mass]: https://irsa.ipac.caltech.edu/Missions/2mass.html
[mpec3i]: https://minorplanetcenter.net/mpec/K25/K25N12.html
[most3i]: https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most?catalog=spherex&input_type=name_input&obj_name=3I&obj_type=Comet&obs_begin=2025+12+13&obs_end=2025+12+16&output_mode=Brief
[lisse25]: https://arxiv.org/abs/2508.15469
[lisse26]: https://arxiv.org/abs/2601.06759
[cr25]: https://api.crossref.org/works/10.3847/2515-5172/ae0293
[cr26]: https://api.crossref.org/works/10.3847/2515-5172/ae3f95
[spherexnasa]: https://science.nasa.gov/mission/spherex/
[nistsi]: https://www.nist.gov/pml/owm/metric-si-prefixes
[nasair]: https://science.nasa.gov/ems/07_infraredwaves/
[jplbd]: https://www.jpl.nasa.gov/news/coldest-brown-dwarfs-blur-star-planet-lines/
[chandrascale]: https://chandra.si.edu/photo/scale.html
[esagaia]: https://www.esa.int/Science_Exploration/Space_Science/Gaia
[2massabout]: https://www.ipac.caltech.edu/2mass/overview/about2mass.html
[gsfccr]: https://imagine.gsfc.nasa.gov/science/toolbox/cosmic_rays1.html
