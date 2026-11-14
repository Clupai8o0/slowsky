# Sources

Where the facts in this repo come from. Licences and credit lines are in [DATA-LICENSES.md](DATA-LICENSES.md).

## How this list was made

- On 14 Nov 2026 an AI model (Claude Opus 5.5) opened each source page and matched every factual claim in the
  README, the page text, the target cards and the AI prompt against it.
- A second model from another maker (Gemini Argon) read the same claims on its own and marked the ones it judged
  wrong or overstated. Each of those was settled against a fetched page, never from a model's memory.
- A claim with no source was cut, reworded, or moved to "Not confirmed" below.
- These checks were run by AI tools. No person has gone through this list line by line.
- Numbers the page measures itself (brightness curves, shifts, noise bands) are not here. They come from the code
  in `src/lib/` and its tests.

The last column says what the source gives, in our own words.

## SPHEREx and its camera

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| Covers 0.75 to 5.0 µm in 102 spectral channels | `README.md`, `src/lib/insight-prompt.ts` | [Bock et al. 2025][bock], abstract; [arXiv:2511.15823][l2] | The range and the 102 bands |
| Maps the whole sky and comes back to each part | `README.md` | [Bock et al. 2025][bock] | The sky is fully covered about every 6 months |
| Six detectors: 0.75–1.09, 1.10–1.62, 1.63–2.41, 2.42–3.82, 3.83–4.41, 4.42–5.00 µm | `src/ui/copy.ts`, `README.md` | [SPHEREx instrument page][inst] | Bands 1 to 6 with these limits; six detector arrays |
| Pixels about 6.2 arcsec wide | `src/lib/insight-prompt.ts`, `src/lib/insight-facts.ts` | [Bock et al. 2025][bock], abstract | 6.2 arcsec pixels |
| Native pixel of 6.15 arcsec used in the code | `src/ui/measure.ts`, `src/lib/source.ts` | [Explanatory Supplement][supp], Table 2 | 6.15 × 6.15 arcsec |
| Detectors have 2040 × 2040 active pixels | `src/lib/source.ts`, `src/lib/flags.ts` | [Explanatory Supplement][supp] | 2040 × 2040 active pixels |
| Each part of the detector sees a slightly different wavelength | `README.md`, `src/lib/insight-prompt.ts` | [Bock et al. 2025][bock] | The filter's wavelength changes smoothly across the field |
| Each file carries a zodiacal light model that is not yet subtracted | `README.md`, `src/lib/types.ts` | [arXiv:2511.15823][l2] | The image layers: IMAGE, FLAGS, VARIANCE, ZODI, PSF, WCS-WAVE |
| Image values are in MJy/sr | `src/lib/types.ts` | [arXiv:2511.15823][l2] | The unit of the spectral image |
| A pixel that is too bright has no value and shows white | `src/ui/app.ts` | [Explanatory Supplement][supp] | Early-overflow pixels are stored as NaN |

## Where the data lives

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| Frames sit in the public S3 bucket `nasa-irsa-spherex` | `README.md`, `DATA-LICENSES.md` | [IRSA cloud access][cloud]; our own request to the bucket, 14 Nov 2026 | Bucket name, region us-east-1, no credentials needed; the bucket answers pages on other sites |
| IRSA's frame search does not accept calls from other websites' pages | `README.md` | Our own request to `irsa.ipac.caltech.edu/SIA`, 14 Nov 2026 | The reply carries no cross-origin header |
| DR1 is doi:10.26131/IRSA678 | `DATA-LICENSES.md`, `src/ui/app.ts`, `src/lib/source.ts` | [DR1 overview][dr1] | The DOI of the DR1 spectral images |
| QR3 is doi:10.26131/IRSA662; QR2 is doi:10.26131/IRSA652 | `DATA-LICENSES.md`, `src/ui/app.ts`, `src/lib/source.ts` | [Quick release overview][qr] | Both DOIs |
| IRSA data is public; it asks for an acknowledgement and the dataset DOI | `DATA-LICENSES.md` | [IRSA terms][irsa]; [IRSA acknowledgements][ack] | No usage restrictions on most data; the acknowledgement text |
| Gaia DR3 is under CC BY-NC 3.0 IGO | `DATA-LICENSES.md`, `src/ui/app.ts` | [Gaia licence][gaialic] | The licence name |
| Gaia credit line "ESA, Gaia DPAC"; commercial use needs a request to ESA | `DATA-LICENSES.md`, `README.md`, `src/lib/source.ts` | [ESA archive terms][esdc] | The Gaia credit line and the contact for a commercial licence |
| Gaia DR3 is doi:10.5270/esa-qa4lep3, with positions given for 2016.0 | `src/ui/app.ts`, `src/lib/gaia.ts`, `README.md` | [doi.org][gaiadoi]; [Gaia DR3 page][gaiadr3] | The DOI resolves to ESA's DR3 page; reference epoch 2016.0 |
| SIMBAD is free to use under ODbL; cite Wenger et al. 2000 | `DATA-LICENSES.md` | [SIMBAD at CfA][simbad] | The licence line and the paper to cite |

## The five targets

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| Positions, proper motions, parallaxes and radial velocities | `src/data/targets.json` | [SIMBAD at CfA][simbad], TAP query, 14 Nov 2026 | The stored values match SIMBAD's rows. Barnard's Star also matches Gaia DR3 source 4472832130942575872 |
| Barnard's Star moves fastest across our sky, about 10.4 arcsec a year, towards the north | `README.md`, `src/ui/copy.ts`, `src/ui/app.ts` | [NASA Astrobiology][barnard]; SIMBAD proper motion | NASA calls it likely the fastest star by proper motion. 10.4 arcsec a year is worked out here from SIMBAD's −801.551 and 10362.394 mas a year |
| RW Aurigae is a young star that changes its brightness | `README.md`, `src/ui/copy.ts` | [SIMBAD at CfA][simbad] | Listed as a T Tauri star (type TT*) |
| Epsilon Indi B is two brown dwarfs | `README.md`, `src/ui/copy.ts` | [SIMBAD at CfA][simbad]; [King et al. 2010][king] | Type BD*, spectral types T1 and T6; the paper's title calls them the nearest known brown dwarfs |
| They fade where methane and water absorb light | `src/ui/copy.ts` | [King et al. 2010][king], spectrum figures | The water and methane bands are marked on the spectra |
| WISE 0855−0714 is the coldest brown dwarf known | `README.md`, `src/ui/copy.ts` | [arXiv:2311.17316][w0855jwst], abstract; [Luhman 2014][luhman], abstract | Both call it the coldest known brown dwarf |
| WISE 0855 is far brighter at 4.5 µm than at 3.6 µm, with almost no light at shorter wavelengths | `src/ui/copy.ts` | [Luhman 2014][luhman], Table 1 | Magnitude 17.44 at 3.6 µm and 13.89 at 4.5 µm; only upper limits at J, Ks and W1 |
| R Draconis is a giant star that swells and shrinks | `src/ui/copy.ts` | [SIMBAD at CfA][simbad] | Listed as a Mira variable (type Mi*), spectral type M4.5-6+e |
| R Draconis' centre is too bright in every saved frame, Barnard's Star's in most | `README.md`, `src/ui/copy.ts` | Our own count in `public/snapshot/` | Blank centre in 24 of 24 frames for R Draconis, 22 of 24 for Barnard's Star |
| RW Aur B, 1.5 arcsec from A, is the brighter one in Gaia | `src/ui/measure.ts` | Gaia DR3 TAP query, 14 Nov 2026 | Both stars' rows |
| Human eyes stop at 0.70 µm | `src/ui/app.ts` | [NASA Science][visible] | The eye sees from 380 to 700 nanometres |

## Wavelengths the AI note may name

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| Helium at 1.083 µm | `src/lib/insight-prompt.ts` | [Explanatory Supplement][supp] | The helium line at 1.083 µm |
| Hydrogen at 1.875 and 4.05 µm | `src/lib/insight-prompt.ts` | [NIST hydrogen table][nist]; [Explanatory Supplement][supp] | Lines at 18751.01 and 40511.6 Å in air; Brackett α at 4.052 µm |
| Water ice near 3.05, carbon dioxide ice at 4.27, carbon monoxide ice at 4.67 µm | `src/lib/insight-prompt.ts` | [arXiv:2603.22135][ices] | The three ice features at these wavelengths |
| PAHs at 3.3 µm | `src/lib/insight-prompt.ts` | [arXiv:2503.21876][pah], abstract | The 3.3 µm PAH band |

## Planet Nine comparison

The README's "Limits" section uses these. The chart in `src/lib/planetx.ts` is not on the page.

| Claim | Where in this repo | Source | What the source gives |
|---|---|---|---|
| ZTF, DES and Pan-STARRS1 together rule out about 78% of the predicted range; the rest is mostly near V 22 | `README.md`, `src/lib/planetx.ts` | [Brown, Holman & Batygin 2024][ps1], abstract and section 6 | 78% of their reference population; what is left sits at V 22.0 (+1.1, −1.4) and 550 (+250, −180) AU |
| SPHEREx reaches 19.5 to 19.9 AB below 3.8 µm, and 17.8 to 18.8 AB from 3.8 to 5 µm, after four observations | `README.md`, `src/lib/planetx.ts` | [Bock et al. 2025][bock], abstract and Figure 19 | 5 sigma depth per channel for 4 observations at the median sky, Galactic plane left out |
| Mass 6.2 (+2.2, −1.3) Earth masses, orbit size 380 (+140, −80) AU, albedo 0.2 to 0.75 | `src/lib/planetx.ts` | [Brown & Batygin 2021][orbit], abstract and section 5 | These values, and the radius rule used for 4 to 20 Earth masses |
| Pan-STARRS1 single-visit depths: g 22.0, r 21.8, i 21.5, z 20.9, y 19.7; half complete at V 21.5 | `src/lib/planetx.ts` | [Brown, Holman & Batygin 2024][ps1] | These depths |
| ZTF finds 95% of objects down to about V 20.5 | `src/lib/planetx.ts` | [Brown & Batygin 2022][ztf], abstract (AJ 163, 102) | This depth |
| DES typically reaches r 23.8 | `src/lib/planetx.ts` | [Belyakov et al. 2022][des] | This limit |
| WISE 0855 has W2 = 13.89 ± 0.05 (Vega); AB is 3.339 fainter in W2 | `src/lib/planetx.ts` | [Luhman 2014][luhman], Table 1; [WISE Explanatory Supplement][wise], section IV.4.h, Table 3 | The magnitude and the offset |
| Earth's radius is 6371 km | `src/lib/planetx.ts` | [NASA Earth Fact Sheet][earth] | Volumetric mean radius |
| Size from brightness: D = 1329 km ÷ √albedo × 10^(−H/5) | `src/lib/planetx.ts` | [Masiero et al. 2011][masiero], section 1 | This relation |
| Reflected sunlight falls with the fourth power of distance | `src/lib/planetx.ts` | [arXiv:2506.12854][d4] | This rule |

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
- **RW Aurigae's parallax.** `src/data/targets.json` holds SIMBAD's 15.42 mas, which comes from the 2007
  Hipparcos reduction. Gaia DR3 gives 6.406 ± 0.044 mas for RW Aur B. The value only feeds a marker shift far
  smaller than a pixel.
- **W2's wavelength.** 4.6 µm is confirmed in the WISE supplement; the table number quoted in
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
