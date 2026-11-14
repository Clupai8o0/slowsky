# Slowsky

Slowsky is a web page for watching the infrared sky change. You type a sky position, or pick one of five preset
targets, and it shows how that patch of sky looked on each visit by NASA's SPHEREx telescope, in date order, from
real NASA frames. SPHEREx is a NASA space telescope that maps the whole sky in infrared light and comes back to
each part of it again and again, so the same spot is pictured on many dates.

Live site: https://slowsky.vercel.app (code: https://github.com/Clupai8o0/slowsky).

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
  - **Subtract** compares two visits that you pick from two lists, A (earlier) and B (later). It starts on the
    first and the last visit. Here a visit is a run of the frames on show, each taken less than 10 days after the
    one before, so it can hold more than one frame. This grouping is not the same as the one step 4 below uses
    to choose the frames. A visit with more than one frame is averaged first. **B − A** shows B minus A: blue marks
    more light in A, orange more light in B, and black about the same (a change smaller than about 2.5 times the
    picture's typical scatter) or a pixel that is blank in either visit. **A + B** adds the two visits pixel by
    pixel instead, so light in both adds up and light in only one counts once; a pixel that is blank in either
    visit shows black. When all the frames fall in one visit, Subtract shows the last frame minus the first.
- Play, pause and step through frames with the buttons, the space bar, the arrow keys or `[` and `]`, or click
  a frame in the strip of small dated pictures.
- Change the colour: a slider picks a wavelength from 0.75 to 5.00 µm (all infrared). It also picks which of
  SPHEREx's six detectors the frames come from.
- Change the field of view: 0.1°, 0.25°, 0.5° or 1°.
- For a preset target, see a marker where the target should be on each frame's date (a ring for Barnard's Star
  and Epsilon Indi B, corner marks for the others).
- See rings that mark stars from ESA's Gaia DR3 catalogue that are brighter than G magnitude 19, and turn them off
  or on. Live views fetch up to the 400 brightest within 0.2° of the centre; the offline copy holds those within
  0.1°. Each frame rings only the 40 brightest of the stars in the picture. Subtract shows no Gaia rings.
- On a live view in Blink, switch on **Flagged pixels** to paint the pixels that the frame's own quality layer marks
  (cosmic-ray hits, for example), and read how many pixels are flagged and which three kinds are most common.
- On a live view in Stack, switch on **False colour** to see one picture made from two wavelengths: the one on
  screen and a partner (4.60 µm when the one on screen is below 2.42 µm, otherwise 1.25 µm). Blue means brighter at
  the shorter wavelength, orange brighter at the longer one. It is a picture for looking, not a measurement: the
  two wavelengths were not taken at the same times, areas where not every frame has usable pixels are hatched
  instead of coloured, and the page lists these limits under the picture (`src/lib/falsecolour.ts`,
  `src/lib/falsecolour-view.ts`).
- In Blink on the 0.1° or 0.25° field, switch on **Older picture** to flip the sky between the 2MASS K survey
  picture (taken between June 1997 and February 2001) and the SPHEREx frame on screen. On the 0.25° field
  Barnard's Star sits away from its ring in the older picture, and a bracket marks where its catalogue motion puts
  it in those years; on the 0.1° field that spot is outside the view, and the page says so. It is a picture for
  looking, not a measurement: it comes from a different telescope at a different wavelength (2.16 µm), its
  brightness cannot be compared with SPHEREx, and the night it was taken on is not known (`src/lib/epoch.ts`,
  `src/ui/epoch-view.ts`).
- On a live view, read **Candidate changes**: a list of spots where the light differs between the first and the
  last visit, each marked on the sky with a numbered dashed ring. The two visits are compared only when their
  wavelengths differ by no more than 0.02 µm. The page reads the archive's error map for each frame of the two
  visits to judge how far a spot stands out from the noise. It leaves out a spot when, in a frame of a checked
  visit, the brightest of up to four detector pixels at or beside the brightest point within 12″ of it carries one
  of the archive's TRANSIENT, OUTLIER, NONFUNC or SUR_ERROR flags, and it says how many it left out. (The page
  maps that point onto the detector and takes a two-by-two block of detector pixels: on each axis, the pixel at or
  just before the point and the one after it. Pixels outside the part of the frame the page loaded are left out, so
  at its last row or column the block is smaller. The page reads the flags of the brightest pixel of that block
  that holds a value, whether or not it adds any light at the point: when the point sits exactly on a pixel, the
  others add none. The centre of the pixel it reads can lie outside the 12″ circle, by up to about one and a half
  detector pixels, about 9″.) The list opens with at
  most 8 spots that have no Gaia catalogue star
  within 6″; the rest stay behind a button, because a small shift between two pictures of a star can look like a
  change. Every line is a candidate only: the page cannot tell a real change in the sky from a detector hit, a
  sharper star image in one visit or a small shift between the two pictures, and it says so above the list. A
  saved copy lists nothing, because it is not checked against the error maps and flags (`src/lib/changes.ts`,
  `src/ui/changes-view.ts`, `src/ui/flag-screen.ts`).
- Read each frame's details: when it was taken, its wavelength at the spot, detector, data release, file name,
  and links to the original FITS file and to the archive's own page.
- Copy a link that reopens the exact view: position, field, colour, frame and mode, and in Subtract the two
  visits and whether they are subtracted or added.
- Use it on a phone: on a narrow screen the page becomes one column, and its web app manifest lets you add it to
  the home screen.

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
   Frames from one detector are grouped into visits: a visit takes in every frame that starts up to 10 days after
   its first one. For each visit, the page keeps the one frame whose wavelength at the spot is closest to the
   chosen value, and only if the chosen value is within half the bandwidth that the frame's own wavelength table
   gives for that spot (the narrow slice of colour that spot sees,
   not the detector's whole range). Visits with no such frame are left out, and a note on the page says how many.
   This keeps colour differences between frames small. Near a strong spectral line even that small difference can
   matter.
5. **Moving targets.** For a preset target, its proper motion is applied for each frame's own date, so the marker
   and the wavelength check follow the star.
6. **Lining up.** The page removes zodiacal light, the glow of sunlit dust in the solar system (the archive's own
   model of it is in each file). Then it resamples every frame onto one grid with north up, using the sky mapping
   stored in each file's header.
7. **Drawing.** All frames, and the Stack picture, are drawn with one brightness scale, so a frame that looks
   brighter has higher values in the data. Higher values are not always a real change in the sky (see Limits).
   Subtract's A + B picture gets a brightness scale of its own, and B − A uses the blue and orange scale.
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
npm run smoke    # browser check of the five presets with the archive blocked
```

`npm run smoke` builds the site, serves it and opens it in headless Chromium. It needs Python 3 with Playwright and
its Chromium installed.

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
VizieR mirror as a fallback. Names and target positions come from the SIMBAD database through the CfA mirror.
The older picture is from the Two Micron All Sky Survey (2MASS; University of Massachusetts and IPAC/Caltech,
funded by NASA and the National Science Foundation), as image tiles made by CDS (CNRS/Unistra) and served by IRSA.
The full list, with licences and credit lines: [DATA-LICENSES.md](DATA-LICENSES.md).
Where each fact on the page and in this file comes from: [SOURCES.md](SOURCES.md).

## AI tools used

| Tool | Maker | Used for |
|---|---|---|
| Claude Code (Claude Fable, Opus, Sonnet and Haiku models) | Anthropic | Writing and reviewing code, tests, planning help, page text drafts; checking the facts in this file and on the page against their sources and writing [SOURCES.md](SOURCES.md) |
| Claude API (Claude Opus 5.5) | Anthropic | Inside the site: the server route `api/insight.ts` writes the optional research note from the page's own measurements. The note is labelled as written by AI and sits behind a passcode; the route stays off until it is set up. Before a note is shown, a checker (`checkNote` in `src/lib/insight.ts`) keeps only sentences that match a fixed list of sentence forms, filled in with the words and numbers of the fact sheet built from the page's own measurements, under three fixed headings; it drops every other sentence. It keeps "This is a candidate only" only when the sheet shows a shift in position or a notable change, and the advice to wait for another visit only for a notable change: a difference of 3 sigma or more (our own bar), or a brightness change that is larger than every reference-star scatter on the sheet or has no scatter to be compared with. It is a filter, not a proof: it checks the note against the sheet, not the measurements themselves |
| Codex (GPT-6.1 Sol and Terra models) | OpenAI | Writing and reviewing code; checking the source list |
| Gemini (Argon and Carbon models, through Antigravity) | Google | Writing and reviewing code; reviewing the facts and wording in this file and on the page |
| Grok 4.7 (through Grok Build) | xAI | Reviewing code; checking the source list |
| ElevenLabs | ElevenLabs | AI voice in the demo video |
| GPT Image | OpenAI | Decorative images in the demo film, marked "AI-generated images" on screen; never sky data |
| Change sort hint (a small neural network, `public/models/change-classifier.json`) | Trained in this repo with PyTorch, by scripts that Codex and Claude wrote | Nothing yet: it is switched off and the site does not use it (see "In the repository but not switched on") |

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
  motion (Stack uses the average of the frames' dates). The source keeps only stars that were on the field in 2016, so a fast star
  that walked in from just outside it since then has no ring. Live views ask the catalogue only for stars within
  0.2° of the centre, and skip the rings if the catalogue is slow to answer.
- The page tries a brightness curve only for RW Aurigae and WISE 0855; the other three presets never get one. The
  curve divides the target by two to four Gaia comparison stars in the field, of G magnitude 9 to 15 (a range we
  chose ourselves). While more than two remain, the page drops one whose brightness scatters more than three times
  as much as the others'; beyond that they are not checked for steadiness, so a variable one shows up as wobble.
  The curve appears only when at least two such stars are slow-moving and sit clear of the target, of other nearby
  stars and of the picture's edge. Of those two targets, only RW Aurigae has two in the offline copy; WISE 0855's
  field has fewer, so it gets a curve only on a live view whose field holds enough. The shaded band shows how much those comparison stars wobble; a faint target can wobble more.
  It is a rough check, not calibrated photometry.
- For Barnard's Star the page measures how far the star moved between two frames and shows the distance its
  catalogue proper motion predicts beside it. The prediction leaves out parallax (the small back-and-forth shift
  caused by Earth's orbit round the Sun), and the star's bright core is hard to centre, so the two numbers can differ.
- The offline copy has only the five preset targets, one detector each, and a field of at most 0.1°.
- Each view uses one detector. A star found by name is placed at its catalogue position, and its marker moves only
  for the presets. Gaia rings move in every view.
- Bad-pixel flags are shown only when you switch them on, on live frames in Blink. The pictures, the brightness
  curve and the motion check do not use them, so hot pixels and cosmic-ray hits show as they are, and one can upset
  a point on the brightness curve. Only the Candidate changes list uses them: it leaves some spots out and adds a caution to others (next point).
- The Candidate changes list compares only the first and the last visit, at one wavelength, and it cannot confirm
  any spot it lists. When a visit has fewer than 3 frames the page cannot rule out a detector hit, and it says so.
  An OVERFLOW flag near a spot does not remove it: the line says the reading there can be unreliable, and a line
  that said which visit is brighter no longer says so.
  The Flagged pixels layer leaves out three kinds: SOURCE (set on every pixel mapped to a known source, so it would cover
  the stars themselves), FULLSAMPLE (for information only) and GHOST_FPA (not in use at present). The TRANSIENT
  flag marks cosmic-ray hits, and near a very bright star it can also mark charge spilling into neighbouring
  pixels, so a flagged pixel beside a bright star is not always a cosmic ray. Hits in the first ten seconds of
  an exposure may go unflagged, so an unflagged pixel is not proof of a clean one.
- The picture's brightness scale is for viewing. The brightness curve is relative to nearby stars, not in physical
  units. The centre of R Draconis is too bright for the camera in every saved frame, and Barnard's Star's in most
  of them, so neither gets a curve.
- Stack is a plain average of all frames, pixel by pixel, with nothing thrown out, so a cosmic-ray hit or a trail
  in one frame still shows, only fainter. A pixel that is blank in some frames is the average of the frames that
  have it. Subtract compares two visits at a time (the first and last frame when there is only one visit). A
  visit with several frames is a plain average of them too, so a spot that was in only one of its frames can
  still show.

## In the repository but not switched on

These parts are in the code but switched off on the site, so a visitor cannot use them (`FEATURES` in
`src/ui/slots.ts`; Flagged pixels, False colour, Older picture and Candidate changes are on). A preview build can
switch the first two on with `VITE_PREVIEW_FEATURES`. The sort hint is not connected to the page, so its switch
shows nothing.

- A sentence that reads the colour at one spot of the False colour picture (`fcReading`). It stays off: the page
  shows the picture and does not measure a colour.
- For R Draconis, the light in a ring around its too-bright centre, look by look, as a line or a table
  (`src/lib/halo.ts`, `src/ui/halo-view.ts`).
- A machine-learning sort hint for each candidate change, described below.
- A Spectrum panel: after a press it reads one spot's 102 colours from the SPHEREx all-sky cube in the public
  archive and draws a small chart (`src/lib/cube.ts`, `src/ui/spectrum-view.ts`). While it is switched off the
  page does not show it and reads nothing from the cube. A preview build can switch it on in the same way.

**The change sort hint.** A small neural network (`public/models/change-classifier.json`, run by
`src/lib/classify.ts`). Its card is `public/models/change-classifier.card.json`; its test results are in `models/`.

- What it looks at: a 15 × 15 pixel square around one candidate change, from the earlier picture, the later one and
  their difference.
- What it would say: which of four kinds of change the spot looks most like, among the fake changes it was trained
  on: a moving spot, a spot whose light went up or down, a camera or processing effect, or plain noise. It does not
  say what the spot is, and it does not look for planets.
- What it learned from: only fake changes added to single real SPHEREx frames (DR1 and QR3) of the five preset
  fields (`scripts/ml_stamps.py`, `scripts/ml_train_cnn.py`). It never saw two real dates or a real moving object,
  and no person labelled anything. It has not been tried on a real asteroid.
- How well it does, on fake changes only: it missed many faint moving spots. In tests that kept one field out of
  training at a time, it labelled 55% of the fake movers whose peak was 3 to 5 times the noise as moving.
- When it gives no label: when its input is broken; when the change near the centre of the square is too faint;
  when any pixel of the difference is more than twice as strong as the strongest change in training; when the
  picture's values are too large to check; when its three inputs do not agree; when the difference is only an
  even offset or an even slope across the square; when its top two answers score about the same; or when a much
  stronger change sits away from the centre of the square.
- Nothing on the site loads the model or shows its answer. `src/ui/ml-hint.ts` holds the words it would show, and
  is written to show the model's own label beside each one (`HELPER_LABEL` in `src/lib/classify.ts`):
  "Experimental sort hint, trained only on fake changes added to single frames. Never tested on real two-date
  changes. Not a verdict."

## Licence

Code: MIT, see [LICENSE](LICENSE). The data keeps its own terms, see [DATA-LICENSES.md](DATA-LICENSES.md).
