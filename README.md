# Slowsky

Slowsky is a web page for watching the infrared sky change. You type a sky position, or pick one of five preset
targets, and it shows how that patch of sky looked on each visit by NASA's SPHEREx telescope, in date order, from
real NASA frames. SPHEREx is a NASA space telescope that maps the whole sky in infrared light and comes back to
each part of it again and again, so the same spot is pictured on many dates.

Built by team Clupai (Melbourne) for the NASA Space Apps Challenge 2026, challenge "Planet X and SPHEREx".
The build began on 14 Nov 2026, after kick-off. AI tools helped write the code; the table under
"AI tools used" names them.

## What you can do

- Pick a preset target: Barnard's Star (moves fastest across our sky), RW Aurigae (changes its brightness),
  Epsilon Indi B (dim at the colours that methane and water absorb), WISE 0855−0714 (the coldest brown dwarf
  known) or R Draconis (its centre is too bright for the camera in every saved frame). Each one comes with a short
  note on what to look for and what the view cannot tell you.
- Search any other spot: type RA and Dec (decimal degrees, or hours-minutes-seconds and degrees), or a star name.
  Names are looked up in the SIMBAD catalogue.
- Watch the frames three ways:
  - **Blink** plays the frames one after another, so things that move or change are easier to spot.
  - **Stack** averages all frames into one. Faint things show up; moving things smear.
  - **Subtract** shows the last frame minus the first. Blue was there then, orange is there now.
- Play, pause and step through frames with the buttons, the space bar, the arrow keys or `[` and `]`, or click
  a frame in the strip of small dated pictures.
- Change the colour: a slider picks a wavelength from 0.75 to 5.00 µm (all infrared). It also picks which of
  SPHEREx's six detectors the frames come from.
- Change the field of view: 0.1°, 0.25°, 0.5° or 1°.
- For a preset target, see a marker where the target should be on each frame's date (a ring for Barnard's Star
  and Epsilon Indi B, corner marks for the others).
- See rings that mark stars from ESA's Gaia DR3 catalogue that are brighter than G magnitude 19 (live: within 0.2°
  of the centre, the 400 brightest at most; offline copy: within 0.1° of the centre), and turn them off or on.
- On a live view in Blink, switch on **Flags** to paint the pixels that the frame's own quality layer marks
  (cosmic-ray hits, for example), and read how many pixels are flagged and which three kinds are most common.
- Read each frame's details: when it was taken, its wavelength at the centre, detector, data release, file name,
  and links to the original FITS file and to the archive's own page.
- Copy a link that reopens the exact view: position, field, colour, frame and mode.

## How it works

1. **Position.** The page starts from a sky position. For the presets, positions and proper motions (the slow
   drift of a star across the sky, year by year) are stored in `src/data/targets.json`.
2. **Frame lookup.** It asks NASA's Infrared Science Archive (IRSA) for the SPHEREx frames that cover the spot.
   The question goes through a small server function, `api/sia.ts`, because IRSA's search service does not accept
   calls from other websites' pages. Only the DR1 and QR3 releases are allowed through.
3. **Only the needed bytes.** The frames are FITS files in NASA's public storage on Amazon S3 (bucket
   `nasa-irsa-spherex`). The page reads the file header, the wavelength table, and then only the rows of the image
   that cover the view, using HTTP range requests. It never downloads a whole file.
4. **Same-wavelength rule.** In a SPHEREx frame, each part of the detector sees a slightly different wavelength.
   Frames taken within 10 days of each other count as one visit. For each visit, the page keeps the one frame whose
   wavelength at the spot is closest to the chosen value, and only if the chosen value is within half the
   bandwidth that the frame's own wavelength table gives for that spot (the narrow slice of colour that spot sees,
   not the detector's whole range). Visits with no such frame are left out, and a note on the page says how many.
   This keeps colour differences between frames small. Near a strong spectral line even that small difference can
   matter.
5. **Moving targets.** For a preset target, its proper motion is applied for each frame's own date, so the marker
   and the wavelength check follow the star.
6. **Lining up.** The page removes zodiacal light, the glow of sunlit dust in the solar system (the archive's own
   model of it is in each file). Then it resamples every frame onto one grid with north up, using the sky mapping
   stored in each file's header.
7. **Drawing.** All frames are drawn with one brightness scale, so a frame that looks brighter has higher values
   in the data. Higher values are not always a real change in the sky (see Limits).
8. **Saved copy first.** A live read takes 20 to 45 seconds, so the five preset targets open from a snapshot: a
   small copy of real SPHEREx frames saved with the site in `public/snapshot/`. Steps 4 to 7 run on it just as on
   live frames; the lookup and the byte reads were done when the copy was made. **Go live**
   reads the same target from the archive. Any other spot, or a colour on another detector, is read live. If the
   archive does not answer, a preset falls back to the snapshot. The status line says which source you are
   looking at.

The snapshot holds 24 frames for each of the 5 targets, as 112 × 112 pixel cutouts on one detector per target,
plus Gaia DR3 stars brighter than magnitude 19 within 0.1° (counts from `public/snapshot/manifest.json` and the
files in each target folder).

## Run it

```sh
npm install
npm run dev      # local site
npm test         # unit tests and test gates
npm run build    # typecheck and production build
```

`npm run dev` does not serve the server function in `api/`, so live search fails there and the preset targets load
from the snapshot. To try the live path on your own machine, run the site with the Vercel CLI (`vercel dev`).
Adding `?demo=1` to the address shows a simulated sky, clearly labelled "not real data", which was used to build
the page.

To rebuild the snapshot (needs Python 3 and the network):

```sh
python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt
scripts/.venv/bin/python scripts/targets.py          # refresh positions and proper motions from SIMBAD
scripts/.venv/bin/python scripts/bake.py --force     # fetch frames and Gaia stars again
```

Without `--force`, `bake.py` skips any target that already has an `index.json` and bakes only the missing targets.
To repair a target with a missing frame file, run it with `--force`. It stops if the snapshot would reach 30 MB.
More on the scripts: [scripts/README.md](scripts/README.md).

## Tests

`npm test` runs every file in `tests/`. Three of them are gates that every change must pass:

- **WCS:** the page's sky mapping matches astropy within 0.01 pixel at 9 points on each of two real frames, in
  both directions (`tests/wcs.test.ts`).
- **S3 cutout:** a box of pixels read from S3 sums to astropy's value within 1 part in 1000
  (`tests/live/s3.live.test.ts`, runs only with `LIVE=1 npm test` because it needs the network). A range request
  that does not come back as a partial reply is refused (`tests/fits.test.ts`, runs every time).
- **Regrid:** simulated field stars land within 0.3 pixel of each other and of their true position across
  epochs (`tests/regrid.test.ts`).

Other tests cover the archive proxy, the snapshot files, coordinate input, the player, stacking and the link
format.

## Data and credits

The frames are from NASA's SPHEREx mission (DR1 and QR3), served by the NASA/IPAC Infrared Science Archive.
Star rings use ESA's Gaia DR3 (credit: ESA, Gaia DPAC), read through STScI's Gaia cone service with the CfA
VizieR mirror as a fallback. Names and target positions come from the SIMBAD database through the CfA mirror. The full list, with licences and credit lines: [DATA-LICENSES.md](DATA-LICENSES.md).
Where each fact on the page and in this file comes from: [SOURCES.md](SOURCES.md).

## AI tools used

| Tool | Maker | Used for |
|---|---|---|
| Claude Code (Claude Fable, Opus, Sonnet and Haiku models) | Anthropic | Writing and reviewing code, tests, planning help, page text drafts; checking the facts in this file and on the page against their sources and writing [SOURCES.md](SOURCES.md) |
| Claude API (Claude Opus 5.5) | Anthropic | Inside the site: the server route `api/insight.ts` writes the optional research note from the page's own measurements. The note is labelled as written by AI and sits behind a passcode; the route stays off until it is set up |
| Codex (GPT-6.1 Sol and Terra models) | OpenAI | Writing and reviewing code; checking the source list |
| Gemini (Argon and Carbon models, through Antigravity) | Google | Writing and reviewing code; reviewing the facts and wording in this file and on the page |
| Grok 4.7 (through Grok Build) | xAI | Reviewing code; checking the source list |
| ElevenLabs | ElevenLabs | AI voice in the demo video |
| GPT Image | OpenAI | Decorative images, if used, marked where they appear |

Sam chose the idea and makes every product decision. `DECISIONS.md` is his own log of them; AI tools do not write
in it.

## Limits

- Slowsky shows changes between frames. It does not decide what a change is. A change can be noise, a satellite
  trail or a camera artefact, so anything that stands out is a candidate for a closer look, not a result.
- It is not a planet finder. Do not expect it to show Planet Nine or any other unknown planet. Optical searches by
  ZTF, DES and Pan-STARRS1 have together ruled out about 78% of its predicted range, and what is left is faint,
  around V 22 (Brown, Holman & Batygin 2024, arXiv:2401.17977). SPHEREx reaches 19.5 to 19.9 AB (5 sigma) below 3.8 µm
  only after its two-year survey, with four observations in each spectral channel at a typical sky brightness
  away from the Milky Way's plane (Bock et al. 2025, arXiv:2511.02985). One frame is shallower still; that part
  is our own reasoning, not a number from the paper. These are different bands, so this is a rough comparison,
  not a limit this repo computes.
- Live loading reads many files from the archive and takes 20 to 45 seconds. It reads at most 60 frames per view
  and says so when it does. To choose them it guesses each frame's wavelength at the spot from the frame's corner
  positions in the archive list (about 10 pixels off), then reads the frames nearest the chosen wavelength.
  When a frame has no corner positions, or the guess does not check out against the first header, frames are
  spread evenly in time as before.
- At very busy spots, such as near the ecliptic poles, the archive can cut its frame list short. The page then
  says some visits may be missing.
- Gaia rings are moved from the stars' catalogue positions for 2016.0 to each frame's date using the stars' proper
  motion (Stack uses the middle date). The source keeps only stars that were on the field in 2016, so a fast star
  that walked in from just outside it since then has no ring. Live views ask the catalogue only for stars within
  0.2° of the centre, and skip the rings if the catalogue is slow to answer.
- The brightness curve (RW Aurigae and WISE 0855; none is drawn for Epsilon Indi B) divides the target by two to
  four Gaia comparison stars in the field, of G magnitude 9 to 15 (a range we chose ourselves). They are not
  checked for steadiness, so a variable one shows up as wobble. The curve appears only when the field holds at least two such stars; in the offline copy that is
  RW Aurigae only. The shaded band shows how much those comparison stars wobble; a faint target can wobble more.
  It is a rough check, not calibrated photometry.
- For Barnard's Star the page measures how far the star moved between two frames and shows the distance its
  catalogue proper motion predicts beside it. The prediction leaves out parallax (the small back-and-forth shift
  caused by Earth's orbit round the Sun), and the star's bright core is hard to centre, so the two numbers can differ.
- The offline copy has only the five preset targets, one detector each, and a field of at most 0.1°.
- Each view uses one detector. A star found by name is placed at its catalogue position, and its marker moves only
  for the presets. Gaia rings move in every view.
- Bad-pixel flags are only shown, and only when you switch them on, on live frames in Blink. No measurement uses
  them, so hot pixels and cosmic-ray hits show as they are, and one can upset a point on the brightness curve.
  The Flags layer leaves out three kinds: SOURCE (set on every pixel mapped to a known source, so it would cover
  the stars themselves), FULLSAMPLE (for information only) and GHOST_FPA (not in use at present). The TRANSIENT
  flag marks cosmic-ray hits, and near a very bright star it can also mark charge spilling into neighbouring
  pixels, so a flagged pixel beside a bright star is not always a cosmic ray. Hits in the first ten seconds of
  an exposure may go unflagged, so an unflagged pixel is not proof of a clean one.
- The picture's brightness scale is for viewing. The brightness curve is relative to nearby stars, not in physical
  units. The centre of R Draconis is too bright for the camera in every saved frame, and Barnard's Star's in most
  of them, so neither gets a curve.
- Stack is a plain average of all frames. Subtract compares only the first and last frame.

## Licence

Code: MIT, see [LICENSE](LICENSE). The data keeps its own terms, see [DATA-LICENSES.md](DATA-LICENSES.md).
