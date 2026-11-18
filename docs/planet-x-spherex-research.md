---
id: 20261112-planet-x-spherex-research
title: Planet X and SPHEREx — feasibility research
type: note
tags: [project, career, spaceapps]
created: 2026-11-12
related: ["[[10-projects/spaceapps-2026/index]]"]
---

# Planet X and SPHEREx — feasibility research

Researched 12 Nov 2026, late morning Kathmandu time (Asia/Kathmandu), for a solo ~33-hour Space Apps weekend. Kick-off is Sat 14 Nov 09:00 Melbourne; submit by about 13:00 Sun 15 Nov Nepal time because of the Kathmandu–Kunming flight. Official challenge page: [Planet X and SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/).

**Short verdict:** Data access is better than it first looked. IRSA will give you cutouts of the same sky position from multiple epochs with a simple HTTP call, and the likely demo target (WISE 0855) already has three visits about six months apart. A blink-comparator web app is a realistic weekend MVP. It is still riskier than the FIRMS hot-spots backup, mainly because IRSA was flaky today, SPHEREx images are awkward FITS files, and the official long-form brief was not retrievable. If you want this challenge, pre-cache PNG cutouts for a few targets tonight and keep the scope tight. If you want the higher chance of a finished submission before the flight, pick Harmonization of MODIS and VIIRS Hot Spots.

## 1. Official challenge statement

The official page at spaceappschallenge.org returned HTTP 500 throughout this research. Wayback Machine only has captures from 20 Sep and 8 Oct 2026, which is before full statements went out on 28 Oct, and those snapshots are a JS shell with little body text ([Wayback, 8 Oct](https://web.archive.org/web/20261008052008/https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/)). The official “data and resources” lists are due to open Fri 13 Nov, per [HackAthlone](https://hackathlone.com/challenges) and [Space Data Atlas](https://spacedata.swapniltamse.com/) — that is tomorrow, and they were not available today.

The official GraphQL API at `https://api.spaceappschallenge.org/graphql` does work (introspection is disabled). Challenge id `aWQ6NTUxMjA=` (“id:55120”) returns this official excerpt, skill tags, and difficulty:

> Since 2025, NASA’s SPHEREx mission has been mapping the entire sky every six months in 102 bands of near-infrared light, returning images of more than a billion objects. Comets, asteroids, stars, brown dwarfs, and even new planets reveal themselves by shifting position between images, but no one person can sift through all that data alone. Your challenge is to create a public-facing web tool to display images of the sky from SPHEREx mission, making it easy for anyone to quickly see how they change over time.

- Difficulty: **Advanced** only
- Subjects: Astrophysics, Planets & Moons, Software

The same excerpt is mirrored on [NASA Space Apps UAE](https://nasaspaceapps.ae/challenges) and [Space Apps Rohnert Park](https://edeon.sonoma.edu/nasaspaceapps-26/). I could not find GraphQL fields for the long body, objectives, considerations, or official resource list (I probed many names; only `id`, `title`, `excerpt`, `skills`, `categories`, `event`, and `featuredImage` resolved).

**What I do not have, and should not invent:** the official long-form objectives, “potential considerations,” and the official NASA resource list. Re-check the official page on Friday 13 Nov, or after the 500s stop.

**Independent paraphrase, not official text.** [Space Data Atlas](https://spacedata.swapniltamse.com/challenges/planet-x-and-spherex/) says it was refreshed against the full statements on 29 Oct 2026, and also says its summaries are paraphrased. Useful extras on that page, which may come from the official statement but are unverified as verbatim:

- Build a public web tool that shows SPHEREx all-sky images and makes it easy to see comets, asteroids and brown dwarfs move between visits.
- SPHEREx data are Quick Release products and will change; check the [IRSA SPHEREx page](https://irsa.ipac.caltech.edu/Missions/spherex.html) for the latest release.
- Suggested first-hour targets: WISE 0855 (RA 08h55m10.8s, Dec −7d14m42.5s), Barnard's Star, Epsilon Indi B, RW Aurigae, R Draconis; blink visits and compare the brown dwarf with its AllWISE position.
- Suggested data (curated by Atlas, not the official list): SPHEREx QR images via IRSA TAP/SIA, AllWISE TAP, JPL Horizons, JPL Small-Body Database. The Horizons starter code on that page is clearly from the lunar-landing challenge, so do not treat Horizons as a confirmed Planet X resource.

## 2. How SPHEREx data is available now

Primary hub: [IRSA SPHEREx](https://irsa.ipac.caltech.edu/Missions/spherex.html). Docs: [QR overview](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html), [archive data access (28 Sep 2026)](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/), [cutout tool](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html), [cutouts tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/).

### Releases and public epochs (as of this research)

- Mission launched 11 Mar 2025; nominal operations from 1 May 2025 ([Data Explorer help](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/searching.html)).
- QR1 started July 2025, was replaced by QR2 in Oct 2025, and was retired Feb 2026. QR3 began Sept 2026. Cite [10.26131/IRSA652](https://www.ipac.caltech.edu/doi) (QR2) or [10.26131/IRSA662](https://www.ipac.caltech.edu/doi/10.26131/IRSA662) (QR3).
- QR3 is Level 2 calibrated spectral images from the mission’s third and fourth full-sky surveys, with improved PSF and other calibrations versus QR2 (QR3 DOI text).
- Data are ingested weekly. New files show up first in browsable directories, the Data Explorer, and some TAP queries; SIA can lag about a day. The Data Explorer help says the newest archive data can be up to about a week old. That lag is not exact: TAP’s latest QR3 time today was 5 Oct 2026, more than a week behind 12 Nov.

A TAP query I ran today on `spherex.obscore`, grouping by collection:

| Collection | Image count | First obs (UTC) | Last obs (UTC) |
|---|---:|---|---|
| spherex_qr2 (wide) | 1,097,080 | 2025-04-24 | 2026-07-20 |
| spherex_qr2_deep | 270,250 | 2025-04-24 | 2026-07-20 |
| spherex_qr3 (wide) | 192,961 | 2026-07-20 | 2026-10-05 |
| spherex_qr3_deep | 47,182 | 2026-07-20 | 2026-10-04 |

So two public processing generations are live, covering about 1.5 years and (for a typical sky position) **about three six-month survey passes**, with QR3 adding a later 2026 slice. A fourth pass for a given position may not be in the archive yet.

**WISE 0855 example (RA 133.795, Dec −7.245), detector D1, queried today.** TAP returned 36 D1 images, all in `spherex_qr2`, none in QR3. They cluster into three epochs:

1. 6 May 2025 (four dithers a couple of minutes apart)
2. 31 Oct and 3 Nov 2025 (many dithers over a few hours, plus a second day)
3. 1–5 May 2026 (many dithers)

That is exactly the “same patch, six months later” pattern the challenge wants. A fourth visit would be due around Nov 2026 and was not in TAP today.

### APIs and cutouts — yes, simple HTTP works

No login was required for the TAP, SIA, or cutout calls I made.

- **TAP:** `https://irsa.ipac.caltech.edu/TAP/sync`  
  List visits (tested, HTTP 200, 36 D1 rows for WISE 0855):

```
https://irsa.ipac.caltech.edu/TAP/sync?FORMAT=csv&QUERY=SELECT obs_id, obs_collection, t_min, t_max, energy_bandpassname, access_url FROM spherex.obscore WHERE CONTAINS(POINT('ICRS', 133.795, -7.245), s_region) = 1 AND energy_bandpassname = 'SPHEREx-D1' ORDER BY t_min
```

  `access_url` values are datalink pages (e.g. `https://irsa.ipac.caltech.edu/datalink/links/spherex?ID=ivo://irsa.ipac/spherex_qr2?2025W19_1B_0241_1/D1`), not the FITS file itself. For direct file URLs, use SIA `access_url` or the `spherex.artifact` URI (see the [cutouts tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/)):

```
SELECT 'https://irsa.ipac.caltech.edu/' || a.uri || '?center=133.795,-7.245&size=0.1' AS cutout_url, p.time_bounds_lower
FROM spherex.artifact a
JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', 133.795, -7.245), p.poly)
  AND p.energy_bandpassname = 'SPHEREx-D1'
ORDER BY p.time_bounds_lower
```

  That query also worked today and returned concrete cutout URLs such as:

  `https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W19_1B/l2b-v20-2025-242/1/level2_2025W19_1B_0241_1D1_spx_l2b-v20-2025-242.fits?center=133.795,-7.245&size=0.1`

- **SIA v2:** `https://irsa.ipac.caltech.edu/SIA?` with `COLLECTION=spherex_qr2` (or `spherex_qr2_deep`, `spherex_qr3`, `spherex_qr3_deep`). Example (tested, HTTP 200, 278 rows around WISE 0855, radius 0.05 deg):

```
https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr2&POS=circle+133.795+-7.245+0.05&RESPONSEFORMAT=CSV
```

  SIA `access_url` is a direct on-prem IBE FITS URL. Append `?center=RA,DEC&size=DEG` for a cutout. `COLLECTION=spherex_qr3` at this position returned zero rows, which matches TAP. SIA `access_estsize` was about 71,635 for every QR2 row; in the SIA standard that column is in kilobytes, so a full Spectral Image MEF is roughly **70 MB**. IRSA’s cutout docs also say full MEFs can be “several hundred megabytes.” Use cutouts, not full files, in the app.

- **Cutout by URL:** append `center=RA,DEC` and `size` in degrees to an on-premises IBE URL ([docs example](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html), QR2 path from the user guide). I downloaded this documented example today:

```
curl -o cutout.fits "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W19_2B/l2b-v20-2025-247/3/level2_2025W19_2B_0073_2D3_spx_l2b-v20-2025-247.fits?center=156.09328159,-41.64466331&size=0.05"
```

  Result: HTTP 200, `Content-Type: application/fits`, **5,071,680 bytes** in 8.6 s, valid FITS starting with `SIMPLE`. Extensions: `IMAGE`, `FLAGS`, `VARIANCE`, `ZODI`, `PSF`, `WCS-WAVE` (same six science HDUs as the tutorial; plus a primary header). The IMAGE HDU was 29×29 pixels at `size=0.05` deg, about 6.2″/pixel, which matches the known SPHEREx plate scale. A first attempt at this URL returned `503 Server busy, retry later.` A later WISE 0855 `size=0.1` download also hit 503 after several earlier IRSA calls, so **rate-limit and retry** are part of the design.

- **Browsable directories:** `https://irsa.ipac.caltech.edu/data/SPHEREx/` with `qr2/` and `qr3/` trees. Spectral images live under `level2/[Planning Period]/l2b-v[Version]-[Processing Date]/[Detector]/`.
- **AWS cloud copy:** documented; SIA rows include a `cloud_access` JSON field with `bucket_name: nasa-irsa-spherex`. Not needed for a weekend MVP.
- **Python:** `astroquery.ipac.irsa` and `pyvo`, as in the official notebooks.
- **GUI tools you can use, but should not try to replace:** [SPHEREx Data Explorer](https://irsa.ipac.caltech.edu/applications/spherex/), Spectrophotometry, Mosaic, Cutout, Source Discovery, and [MOST (Moving Object Search Tool)](https://irsa.ipac.caltech.edu/applications/MOST/instructions.html), which can find SPHEREx images covering a known solar-system object.

### Important science caveats for a blink tool

- SPHEREx uses a linear variable filter, so **wavelength changes across the detector**. Two visits of “D1” at the same sky position may not be the same wavelength. Stars can look different even if they have not moved. For an MVP, stick to one detector (D1 is the shortest near-IR and the most star-like), pick one frame per epoch, and say this limitation out loud in the demo.
- Each “visit” is really a cluster of dithers a few minutes apart. Cluster by date (or by planning week in the `obs_id`, e.g. `2025W19` vs `2025W44` vs `2026W18`) and use one representative frame, or you will drown in nearly identical images.
- Quick Release products are reprocessed and can change.

## 3. Browser-side options and existing viewers

- **Do not try to out-build the official Data Explorer.** Your unique product is a public, anybody-can-use **blink / change-over-time** tool, not a general archive browser.
- **CDS HiPS + Aladin Lite.** QR2 all-sky HiPS per detector, e.g. [D1](https://alasky.cds.unistra.fr/SPHEREx/D1), also D2–D6; registry entry [CDS/P/SPHEREx/QR2/D1](https://dc.g-vo.org/rr/q/lp/custom/CDS/P/SPHEREx/QR2/D1). A ready-made viewer is [spherex-hips.web.app](https://spherex-hips.web.app/). D3 `properties` (retrieved earlier today; a later fetch timed out) showed `hips_release_date = 2026-05-26`, `hips_tile_format = png fits`, `hips_order = 7`, `t_min/t_max` MJD 60789–61165 (24 Apr 2025 to 5 May 2026). **These are single mosaics, not multi-epoch.** Use them as a sky map for picking a position, not as the blink itself.
- **Aladin Lite** ([docs](https://cds-astro.github.io/aladin-lite/HiPS.js.html), [github](https://github.com/cds-astro/aladin-lite)) is the right library for that context map.
- **JS9 / fitsjs:** possible for in-browser FITS, but SPHEREx files are multi-extension with a spectral WCS and a PSF extension. Getting a clean, stretched image in the browser is more work than converting the IMAGE HDU to PNG on the server with Python (`astropy.io.fits` + a simple scale). That is the safer weekend path.
- **CORS:** an OPTIONS request to the IBE cutout URL returned HTTP 405 (`Allow: GET`) and no `Access-Control-Allow-Origin` in the headers I saw. A GET with an `Origin` header then 503’d. Treat **browser-direct FITS fetch as unverified and probably blocked**. Proxy TAP and cutouts through Next.js API routes.

## 4. Recommended weekend MVP

**Product:** “Blink the SPHEREx sky” — a public Next.js app where anyone picks a position (or a demo target) and watches that patch change across survey passes.

**Scope that fits ~33 hours, solo:**

1. Tonight (before kick-off), pre-download one D1 cutout per epoch for WISE 0855 and, if time, Barnard's Star / Epsilon Indi B. Convert IMAGE HDUs to stretched PNGs and ship them in the repo so the demo works even if IRSA is busy on Sunday.
2. Next.js UI: target picker, three (or N) frames, auto-blink and a manual slider. Label each frame with UTC date. Optional: an Aladin Lite HiPS map to click a position.
3. Live path (nice to have, not required for a submit): API route runs the TAP query, clusters visits by epoch, proxies one cutout per epoch, converts FITS → PNG with Python, returns images. Retry on 503. Cache aggressively.
4. Stretch if the core is done by Saturday evening: overlay AllWISE sources (IRSA TAP, `allwise_p3as_psd`) and known solar-system objects via [SkyBoT conesearch](https://ssp.imcce.fr/webservices/skybot/api/conesearch/) at each epoch. A difference image is a further stretch; alignment and the changing wavelength make it easy to get wrong.
5. Do not spend time on all 102 bands, source discovery, or orbit fitting.

**Architecture:** Next.js + TypeScript front end; a small server route (Next.js route handler calling a short Python script, or a Vercel Python function) for TAP + cutout + FITS-to-PNG. No need for a database if you pre-cache the demo targets.

**Fallback if IRSA or FITS work goes sideways Saturday morning:** switch to Harmonization of MODIS and VIIRS Hot Spots and use the NASA FIRMS CSV API, which you already researched in September. The pre-cached Planet X PNGs can still be a slim backup demo, but do not split the weekend across both challenges.

### Top risks

1. **IRSA reliability.** TLS drops and `503 Server busy, retry later` happened several times today. Pre-cache demo images.
2. **Wavelength and alignment.** Two epochs may not be the same bandpass or orientation. Blink first; only difference-image if frames register cleanly.
3. **Dither explosion.** Dozens of images per position; cluster them or the UI will be unusable.
4. **Official brief still unseen.** Friday’s resource list or considerations might change the expected deliverable. Read them as soon as the official page works.
5. **Time.** You are solo and must submit by ~13:00 Sunday Nepal time. A polished blink of three pre-chosen targets beats a half-finished all-sky explorer.

## 5. Planet X vs Harmonization of MODIS and VIIRS Hot Spots

| | Planet X and SPHEREx | MODIS / VIIRS Hot Spots |
|---|---|---|
| Official pitch | Public tool to show how SPHEREx sky images change over time | Web app that harmonizes two fire-hotspot records into a burning-activity calendar |
| Data | IRSA TAP/SIA + FITS cutouts (proven today) | NASA FIRMS CSV API (already researched, simple tables) |
| Demo moment | Blink WISE 0855 and watch a brown dwarf move | Black Summer / Victorian fires on a map and calendar |
| Technical risk | Medium: FITS, WCS, wavelength, IRSA 503s | Low–medium: CSV and a web map |
| Fit for 33 hours solo | Yes, if scoped to a blink MVP and pre-cached | Yes, and more forgiving if something breaks Sunday |
| Story for Melbourne judges | Space telescope, Planet X, living sky | Local bushfire relevance, clearly useful |

**Pick:** If you want the more memorable, more “Space Apps” demo and you pre-cache the cutouts tonight, take **Planet X**. If you want the safer path to a complete submission before the flight, take **hot spots**. I would not start Planet X cold on Saturday morning with no cached frames.

## Sources

- Official (partial): [challenge page](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/) (500 during this research), GraphQL `https://api.spaceappschallenge.org/graphql` (excerpt, Advanced, tags), [UAE list](https://nasaspaceapps.ae/challenges), [Rohnert Park list](https://edeon.sonoma.edu/nasaspaceapps-26/), [Wayback 8 Oct 2026](https://web.archive.org/web/20261008052008/https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/), [HackAthlone schedule](https://hackathlone.com/challenges)
- Independent paraphrase: [Space Data Atlas challenge page](https://spacedata.swapniltamse.com/challenges/planet-x-and-spherex/), [Atlas repo](https://github.com/swapniltamse/space-data-atlas)
- IRSA: [mission page](https://irsa.ipac.caltech.edu/Missions/spherex.html), [QR overview](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html), [data access guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/), [cutout docs](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html), [cutouts notebook](https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/), [QR3 DOI](https://www.ipac.caltech.edu/doi/10.26131/IRSA662), [Data Explorer](https://irsa.ipac.caltech.edu/applications/spherex/), [search help](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/searching.html), [MOST](https://irsa.ipac.caltech.edu/applications/MOST/instructions.html)
- HiPS / viewers: [CDS D1 HiPS](https://alasky.cds.unistra.fr/SPHEREx/D1), [registry](https://dc.g-vo.org/rr/q/lp/custom/CDS/P/SPHEREx/QR2/D1), [spherex-hips.web.app](https://spherex-hips.web.app/), [Aladin Lite](https://github.com/cds-astro/aladin-lite)
- Overlays: [SkyBoT conesearch](https://ssp.imcce.fr/webservices/skybot/api/conesearch/), IRSA AllWISE TAP
- Live queries and one successful cutout download were run from this research session on 12 Nov 2026
