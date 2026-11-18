# Slowsky: project page draft

## 1. Cover note for Sam

**Address (Sun 15 Nov): the live link is https://slowsky.clupai.com** (Sam's pick). https://slowsky.vercel.app serves
the same build and stays up. Every link below now names slowsky.clupai.com.

**v0.3.5 and v0.3.6 update (Sun 15 Nov, 10:52 NPT): all six are live.**

- Sam said "Turn on all six". Five are live since v0.3.5 (`b0d352f`): **Spectrum**, **Tonight's sky**, **Save picture**,
  the **comet card** and **touch gestures**.
- The sixth, the **Planet Nine chart**, is **live since 10:49 NPT as v0.3.6 (`3ffb94c`)**, checked on
  https://slowsky.clupai.com and https://slowsky.vercel.app at desktop, phone and 320 px widths. Its row in the
  "What it does" table is now a plain row (the `ONLY IF` marker is gone). Delete that row only if the site is rolled
  back to v0.3.5, which you can tell because the card titled "Planet Nine: how faint, how deep?" under the comet card
  (foot of the left panel; near the foot of the page on a phone) is no longer there.
- "What it does" has six new table rows and the Spectrum paragraph (moved up from "In progress"). "In progress" no longer
  lists the Spectrum or the Tonight's sky line. The words follow the README at the commits above.
- The Summary is unchanged (200 words): it does not name the six. To name one, swap out another sentence.
- **The screenshots in `submission/screenshots/` were taken before these six were on.** They are still true pictures
  of the page, but they do not show the new panels. The film shows none of the six either. **Film cut r7a is on the
  Drive link since 10:53 NPT** (the uploader logged it at 05:07:54 UTC, same file id): the end card now says slowsky.clupai.com and the narration is new takes of the same
  words, same AI voice and model. It has **no AI sound effects**, so the on-screen AI line quoted in this draft
  ("AI images: OpenAI gpt-image-2 · AI voice: ElevenLabs eleven_multilingual_v2") is still exactly what the film shows.
  If a later cut adds AI sound effects, the lead will say so here and list the lines to change. The Drive link stays the same.
- Appendix rows 43 and 81 and the "(v0.3 update 4)" note were written while these were off; the appendix is not for pasting.
- `DECISIONS.md` needs Sam's own line for each of the six. AI tools do not write that file.
- No new outside fact: every sentence added here is taken from the README, whose claims are in `SOURCES.md`.

**v0.3.4 update (Sun 15 Nov, 08:57 NPT), matched to the product repo at `e8372da` (live, tag `v0.3.4`):**

- Page text: only the wording about the edge of the Gaia star list changed, to follow the README: a spot with no listed star within 6 arcseconds that lies outside the circle, or within 6 arcseconds of its edge, is marked as not checked ("How it works" item 10, Limits, source row 93). The Summary is untouched (200 words).
- Why: Codex's final review of v0.3.3 found 5 more issues in the Candidate changes list (1 serious: the wavelength check was smeared at the edge of a frame's coverage). All 5 are fixed and live, with 3 small ones Gemini found while reviewing the fix. Codex's second review of the fix: ship.
- The rest of the page text still holds: the wavelength rule ("average wavelengths of the two visits' frames differ by more than 0.02 µm") is the same rule, now worked out pixel by pixel.
- No new outside fact.
- Gemini checked the three changed lines against the README (08:59 NPT). It raised two points; both were checked against the code and the lines stand: the circle only applies when it does not reach the picture's corners, so nothing is marked on the 0.1° and 0.25° fields (`findChanges` in `src/lib/change-input.ts`), and "a faint catalogue star can be missing" is the page's own note when the star list is cut short.

**v0.3.3 update (Sun 15 Nov, 08:00 NPT), matched to the product repo at `fa2de42` (tag `v0.3.3`):**

- Candidate changes now states two more limits in its notes, and the page text follows the README's new paragraph: "How it works" item 10, the Limits list and source rows 92 and 93. Nothing else changed; the Summary is untouched (200 words).
- Why: the final Codex review found that on the 0.5° and 1° fields the list could show spots where the two visits were really at different wavelengths, and spots that were never checked against the Gaia star list without saying so. Both are fixed and live.
- No new outside fact: the wavelength changing across each frame is already sourced in `SOURCES.md` (Bock et al. 2025), and the 400 brightest stars within 0.2° is already in the README.
- Checked by Gemini against the README (08:14 NPT): 5 wording fixes are in. Item 10 now says "average wavelengths of the two visits' frames", "the brightest point within 12 arcseconds", "no star in the loaded Gaia star list", and gives the circle as 0.2° on the 0.5° and 1° fields; the Limits line no longer says a note covers both limits (a spot outside the circle is marked on its own line; a note says when the star list was cut short); rows 75, 76, 92 and 93 follow.

**v0.3.2 update (Sun 15 Nov, 06:39 NPT), matched to the product repo at `f4757f2`:**

- Added the plain-language guide ("What am I looking at?", "Help" on a phone and beside Focus) and its short word notes to "What it does" (new table row and a screenshot marker), "Who it helps", "What is new" and the "Plain words" row in "Design choices".
- Summary: added "A plain-language guide explains each control." and cut "each marked with a number" from the Candidate changes sentence. Now 200 words, 1,158 characters (Python `split` and `len`, recounted 06:41 after the lead moved the guide sentence up and changed the last "It" to "Slowsky", so the last line cannot be read as being about the guide). Put the cut words back only if you drop another 5.
- AI tools table: ElevenLabs and GPT Image now carry their model names (`eleven_multilingual_v2`, `gpt-image-2`) and "the film names the model on screen", as the README has them. The Claude Code row adds the site icon, as the README does.
- The old "marked AI-generated images" line is gone. Under the table, the film's new on-screen line is quoted, with a pointer to `SOURCES.md` "AI-generated content" and the guide's closing AI line.
- AI note: the "In progress" line and the AI note block now say its heading names the model. Both still describe the note as off until set up.
- Source rows 52 and 54 updated; rows 82 to 91 added.
- v0.3.2 went live at 06:45 NPT (tag `v0.3.2`, commit `25644b2`), so the guide lines describe the public page.
- Gemini checked the guide, AI label, AI note and film lines against the README and `SOURCES.md` (06:42): 0 contradictions, 0 uses of "discovery" or the like, no model the README does not name. It found 3 lines true on the page but missing from the README ("Help" on a phone, the "Help" button beside Focus, the short notes on the page). The README now says all three (`25644b2`).
- Left out: the guide's drafting model by version (`SOURCES.md` says Claude Fable 5.2; the README names only "Claude Fable"), so the page says nothing about which model drafted it.
- AI note block and source row 47 reworded (06:40, by the lead) to the README's Claude API row: the checker keeps only fixed sentence forms filled from the fact sheet. The block is still only for when the note is on.
- Check: the film you upload must be the cut that shows the new mark. The page now quotes it.
- The guide lines assume v0.3.2 stays live at submit (it is live now). If it is rolled back, move them to "In progress" and undo the Summary swap.

**v0.3 update 2 (Sun 15 Nov, about 04:30 NPT), matched to the product repo at `8e95a2b`:**

- Added **Candidate changes** (now on) to the Summary, "What it does", "How it works", "What is new" and "Limits", with a screenshot marker, and took it out of "In progress".
- The change list goes public with the v0.3 deploy on Sunday morning. If that deploy does not happen, move the Candidate changes lines back to "In progress".
- Reworded the flags row in "Design choices": the change list now uses the archive's flags to leave some spots out and caution others.
- Added the "Tonight's sky" line (off) to "In progress". The Spectrum and AI note lines are unchanged.
- Sort hint line (04:20, matched to `58ac816`): it is now connected to the change list behind a switch that stays off, and the line says why, as the README does.
- Summary is 199 words and 1,134 characters (recounted 04:21 after the Gemini check); to make room it drops "its frames sit in a public archive" and shortens the Older picture and frame-details phrases.
- Source rows 29, 43 and 45 updated; rows 73 to 81 added. No Gemini check on the new lines yet.

**v0.3 update (Sun 15 Nov, about 01:45 NPT), matched to the product repo at `44e7b57`:**

- Added **False colour** and **Older picture** (both now on) to the Summary, "What it does", "How it works", "What is new", "Design choices", "Limits" and the source table, with a screenshot marker for each.
- Moved False colour out of "In progress"; added two parts the README lists as off: the colour-reading sentence and the spectrum reader.
- Added 2MASS: its IRSA page to NASA Data, the CDS-made tiles served by IRSA to Partner data, and a credit line under "Data and credits".
- Flagged pixels now also says the page counts the flagged pixels and names the three most common kinds, as the README does.
- The new lines have not had a Gemini check yet, and the two new 2MASS links were not opened (no network in this pass).

**Earlier notes:**

- This is the text for the Space Apps project form, field by field, ready to edit and paste. Sections 3 and 4 are the paste text; section 6 is not.
- Field names, order and limits come from `research/24-submission-form-fields.md` (last read 00:49 NPT, 14 Nov). The form changed on 13 Nov, so check the live form before pasting.
- Fill these: `[SAM: team members]`, `[SAM: demo link]`, `[SAM: SI ticks]`, `[SAM: both checkboxes]`, `[SAM: screenshots]`, `[SAM: Barnard numbers]`, `[SAM: confirm pre-kick-off line]`, `[SAM: film images]`, `[SAM: passcode here]`.
- Decide these: the "In progress, not yet public" list (delete or move lines at submit) and the AI note block (keep only if the note is on).
- Before submit: `DECISIONS.md` in the repo is still empty, yet the README says it is your log. Fill it, or a judge who clicks will find nothing.
- Every claim in the paste text has a source in the section 6 table. Nothing names a model that the README does not name.
- Checked twice by Gemini (18:13 NPT, 14 Nov): once against `SOURCES.md`, once against the README. Its fixes are in: survey depth with its conditions, the Gaia ring limits, the brightness curve (RW Aurigae only in the saved copy), "visit" defined, flag limits, and the Gaia service moved out of the NASA table.
- The README now describes the AI note's number checker (added 18:40, 14 Nov), and `SOURCES.md` already says no person has gone through it line by line. So everything the page says is also in the repo.

---

## 2. Form fields, in the form's order

### Project Name (one line, no limit)

Slowsky

### Summary (plain text, 1,500 characters max; the form suggests 50 to 200 words)

Paste section 3 below.

### Project Demonstration (URL; a video of 30 s or less, or at most 7 slides; must open without login)

`[SAM: demo link]` (the 29.5 s film once uploaded, or the 3-slide deck in section 5 for the interim submit). Open it in a private window before you submit.

### Project (URL; must be public)

https://slowsky.clupai.com

(Code: https://github.com/Clupai8o0/slowsky. Put the repo link at the top of Details too, since this field takes one URL.)

### Project Details (rich text with images, no limit)

Paste section 4 below. Images: JPG, PNG or GIF, 10 MB max each. `[SAM: screenshots]` marks where each one goes.

### Use of Super Intelligence (SI) (multi-select, at least one; judges do not see this field)

`[SAM: SI ticks]` Suggested, from what the README and the build plan record:

- Ideation or Brainstorming (the build plan says AI drafted plan options; tick it to be safe)
- Research or Information Gathering (AI checked the page's facts against sources)
- Coding, Debugging, or Troubleshooting
- Writing, Editing, or Translation
- Presentation, Video, or Audio (ElevenLabs voice in the film)
- Visual Design or Image Creation (only if GPT Image pictures stay in the film)
- Building SI/ML Into the Project (only if the AI note is on at submit)

### NASA Data (link rows: link text + URL, up to 25)

| Link text | URL |
|---|---|
| SPHEREx Data Release 1 (DR1) Spectral Images, doi:10.26131/IRSA678 | https://doi.org/10.26131/IRSA678 |
| SPHEREx Quick Release Spectral Images QR3, doi:10.26131/IRSA662 | https://doi.org/10.26131/IRSA662 |
| NASA/IPAC Infrared Science Archive (IRSA): SPHEREx | https://irsa.ipac.caltech.edu/Missions/spherex.html |
| IRSA cloud access: SPHEREx frames in the public S3 bucket nasa-irsa-spherex | https://irsa.ipac.caltech.edu/cloud_access/ |
| SPHEREx Explanatory Supplement (frame layers and quality flags) | https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp_QR.pdf |
| SPHEREx DR1 overview | https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html |
| SPHEREx Quick Release overview | https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html |
| SPHEREx instrument page (detectors and bands) | https://spherex.caltech.edu/page/instrument |
| NASA Science: zodiacal light | https://science.nasa.gov/universe/stories/quick-reads/be-glad-you-dont-have-to-dust-in-space/ |
| NASA Science: visible light | https://science.nasa.gov/ems/09_visiblelight/ |
| NASA Science glossary | https://science.nasa.gov/universe/glossary/ |
| IRSA: Two Micron All Sky Survey (2MASS), source of the Older picture | https://irsa.ipac.caltech.edu/Missions/2mass.html |

### Space Agency Partner & Other Data (optional; link rows, up to 25)

| Link text | URL |
|---|---|
| ESA Gaia DR3 (credit: ESA, Gaia DPAC; CC BY-NC 3.0 IGO), doi:10.5270/esa-qa4lep3 | https://www.cosmos.esa.int/web/gaia/dr3 |
| STScI's Gaia cone search service (gsss.stsci.edu), which serves the Gaia DR3 rows for the star rings | https://archive.stsci.edu/missions-and-data/gaia |
| Gaia data licence | https://www.cosmos.esa.int/web/gaia-users/license |
| ESA: proper motion | https://www.esa.int/Science_Exploration/Space_Science/Gaia/Proper_motion |
| ESA: parallax | https://www.esa.int/Science_Exploration/Space_Science/Gaia/Parallax |
| SIMBAD database, CfA mirror (names and target positions; Wenger et al. 2000) | https://simbad.cfa.harvard.edu/simbad/ |
| VizieR, CfA mirror (fallback for Gaia rows) | https://vizier.cfa.harvard.edu/viz-bin/VizieR |
| 2MASS K image tiles (HiPS) for the Older picture, made by CDS (CNRS/Unistra) and served by IRSA | https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/K/properties |
| Bock et al. 2025, SPHEREx mission paper | https://arxiv.org/abs/2511.02985 |
| SPHEREx spectral images paper (arXiv:2511.15823) | https://arxiv.org/abs/2511.15823 |
| Brown, Holman & Batygin 2024, Planet Nine search limits | https://arxiv.org/abs/2401.17977 |
| Luhman 2014, WISE 0855−0714 | https://arxiv.org/abs/1404.6501 |
| Coldest brown dwarf paper (arXiv:2311.17316) | https://arxiv.org/abs/2311.17316 |
| King et al. 2010, Epsilon Indi B | https://arxiv.org/abs/0911.3143 |
| Slowsky source code (MIT) | https://github.com/Clupai8o0/slowsky |
| Slowsky data licences and credits | https://github.com/Clupai8o0/slowsky/blob/main/DATA-LICENSES.md |
| Slowsky sources for every fact on the page | https://github.com/Clupai8o0/slowsky/blob/main/SOURCES.md |
| Astropy (Astropy Collaboration 2013, 2018, 2022) | https://www.astropy.org/acknowledging.html |
| Geist fonts (SIL Open Font License 1.1) | https://github.com/Clupai8o0/slowsky/blob/main/src/ui/fonts/OFL.txt |
| Vite, Vitest, TypeScript, Anthropic SDK (licences in DATA-LICENSES.md) | https://github.com/Clupai8o0/slowsky/blob/main/package.json |
| Claude (Anthropic): Claude Code and the Claude API | https://www.anthropic.com/claude |
| Codex (OpenAI) | https://openai.com/codex |
| Gemini through Antigravity (Google) | https://antigravity.google |
| Grok Build (xAI) | https://x.ai |
| ElevenLabs (AI voice in the demo film) | https://elevenlabs.io |
| GPT Image (OpenAI; decorative images in the demo film) `[SAM: film images]` | https://openai.com |
| Remotion (video editing for the demo film) | https://www.remotion.dev |

`[SAM: every link here answered when checked at 18:15 NPT on 14 Nov, except openai.com, openai.com/codex and x.ai, which refuse automated checks; open those three in a browser. The Gaia DOI link itself (doi.org/10.5270/esa-qa4lep3) led to an ESA page that answered "not found" today, so the row links ESA's DR3 page and keeps the DOI in the text.]`

### Agree to Terms and Conditions (checkbox, needed even to save)

`[SAM: both checkboxes]` Yours to tick after reading the terms.

### Confirm All Work is Original (checkbox, needed even to save)

`[SAM: both checkboxes]` Tick only once both link lists above are complete.

---

## 3. Summary (paste into the Summary field)

NASA's SPHEREx telescope photographs the whole sky in infrared light, coming back to each part many times. In Slowsky you type a sky position or a star name, or pick one of the challenge's five test targets, and it plays the real SPHEREx frames of that spot one after another, in date order, near one wavelength. Blink makes movement easier to spot. Stack averages the frames so faint things show. Subtract compares two visits you choose. On a live view, False colour makes one picture from two wavelengths, Flagged pixels marks the archive's own quality flags, and Candidate changes lists spots where the light differs between the first and the last visit. Older picture flips to a 2MASS survey picture from 1997 to 2001. Rings from ESA's Gaia catalogue mark the brighter known stars and follow each star's drift. Each frame lists its date, detector, wavelength and original file, and every view is a link you can share. A live view reads only the bytes it needs from NASA's public storage; the test targets open from a small saved copy. A plain-language guide explains each control. You need nothing but a browser. Slowsky does not decide what a change is.

---

## 4. Details (paste into the Project Details field)

**Live:** https://slowsky.clupai.com · **Code (MIT):** https://github.com/Clupai8o0/slowsky
Team Clupai, Melbourne. `[SAM: team members]` Challenge: Planet X and SPHEREx.

The build began on 14 Nov 2026, after kick-off. Before kick-off we only read about the mission and explored the data; none of that work was copied into the product. `[SAM: confirm pre-kick-off line]`

### What it does

[SCREENSHOT: the full page on RW Aurigae in Blink, with the frame strip, the Gaia rings and the "What to look for" card visible]

SPHEREx is a NASA space telescope. It maps the whole sky in infrared light (0.75 to 5 µm; the eye stops at about 0.70 µm) in 102 colour channels, and it maps it four times in two years. So each spot has pictures from many dates. A **frame** is one of those pictures. Slowsky puts the frames of one spot side by side in time.

| You can | What the challenge asks for (our paraphrase) |
|---|---|
| Type RA and Dec (sky coordinates, like longitude and latitude; decimal, or hours-minutes-seconds and degrees) or a star name | Entering the coordinates of a patch of sky |
| Watch the frames play in date order (**Blink**), or step through them with buttons, keys or the strip of small dated pictures | Showing a series of images of that patch as a short video |
| Open Barnard's Star, RW Aurigae, Epsilon Indi B, WISE 0855−0714 or R Draconis in one click, each with a note on what to look for and what the view cannot tell you | "Test your tool on Barnard's Star" |
| Average all frames into one picture (**Stack**) so faint things show | Adding together the data from the detector arrays (partly: one detector and one colour per view) |
| Pick two visits, A and B, and show **B − A** or **A + B** (**Subtract**) | Adding or subtracting images taken at different times |
| Choose a field of view of 0.1°, 0.25°, 0.5° or 1° | Letting users choose the field of view |
| Turn on rings for the brighter stars in ESA's Gaia DR3 catalogue, moved to each frame's date (Blink and Stack) | Overlaying data from other telescopes, such as Gaia |
| Copy a link that reopens the exact view: position, field, colour, frame and mode | Opening the tool with coordinates in the URL |
| Read each frame's date, wavelength, detector, data release and file name, with links to the original file | Showing metadata such as contamination flags |
| On a live view in Blink, switch on **Flagged pixels** to paint the pixels the frame's own quality layer marks, such as cosmic-ray hits, and read how many are flagged and the three most common kinds | same as above |
| Pick a wavelength from 0.75 to 5.00 µm with a slider, which also picks one of SPHEREx's six detectors | A creative way to show the 102 infrared bands |
| On a live view in Stack, switch on **False colour**: one picture from the wavelength on screen and a partner (4.60 µm when the one on screen is below 2.42 µm, otherwise 1.25 µm). Blue means brighter at the shorter wavelength, orange brighter at the longer one | same as above |
| In Blink on the 0.1° or 0.25° field, switch on **Older picture** to flip between the SPHEREx frame and the 2MASS K survey picture, taken between June 1997 and February 2001. On the 0.25° field a bracket marks where Barnard's Star's catalogue motion puts it in those years | Overlaying data from other telescopes |
| On a live view, read **Candidate changes**: a list of spots where the light differs between the first and the last visit, each marked on the sky with a numbered ring | Making it easy to see how the sky changes over time and to spot what moved |
| Below the colour step, press **Read the spectrum here** in the **Spectrum** panel: the page reads the light at the centre of the view in SPHEREx's 102 colours from the archive's all-sky cube and draws a small chart. Nothing is read before the press. It is a quick look, not a measurement | A creative way to show the 102 infrared bands |
| Read the **Tonight's sky** line under the sky map: when the spot on screen stands highest in tonight's dark hours as seen from Melbourne, about how high, and facing which way. It says where the spot is in the sky, never whether anything can be seen there | Our own addition, not asked for |
| In Subtract, press **Save picture**: one PNG, drawn in the browser, with the earlier visit, the later visit and their difference side by side, the data credit, a line saying the code was written with AI tools and a line saying a difference is a candidate only. The page itself sends the picture nowhere | Adding or subtracting images taken at different times |
| Look at the **Comet 3I/ATLAS across the CO₂ band** card at the foot of the left panel: twelve small pictures of the interstellar comet from SPHEREx frames taken on 14 Dec 2025, and a chart of its core's brightness by wavelength. The numbers are raw image values with rough sums of our own, not a calibrated measurement of the comet | A creative way to show the infrared bands |
| On a touchscreen, swipe on the sky picture to step through frames, and press and hold on a later frame to see the first frame until you let go | Showing a series of images of that patch as a short video |
| Look at the **Planet Nine: how faint, how deep?** chart under the comet card: published estimates of how bright Planet Nine would be and one example from this repo's own model, beside how deep SPHEREx and three optical searches reach. The rows are in different bands, so it is a rough comparison, not a search result | Planet X: how faint it would be, beside how deep the surveys reach |
| New to astronomy? Press **What am I looking at?** ("Help" on a phone) for a plain-language guide: one line on each control and a short list of the words the page uses. When the targets panel is folded, a "Help" button beside Focus opens the same guide. Short notes beside the colour slider, the Gaia rings and the Older picture explain µm, Gaia and 2MASS, and the Candidate changes list explains S/N, catalogue star and the ″ (arcsecond) mark when they appear | A public-facing tool that makes it easy for anyone to see how the sky changes |

[SCREENSHOT: the "What am I looking at?" guide open, showing the control lines and the word list]

[SCREENSHOT: a live view in Stack with False colour on, showing the blue and orange picture, any hatched area and the limits listed under the picture]

[SCREENSHOT: Barnard's Star in Blink on the 0.25° field with Older picture on, showing the 2MASS picture, the star's ring, the bracket and the credit note]

[SCREENSHOT: a live view with the Candidate changes list open, showing the numbered rings on the sky, the list and the "candidate only" warning above it]

It also draws a rough brightness curve for RW Aurigae. WISE 0855 gets one only on a live view whose field holds at least two suitable comparison stars; its saved copy has too few. The other three presets never get one. On a phone, the page becomes one column you can add to your home screen.

**Spectrum.** Below the colour step, a button reads the light at the centre of the view in SPHEREx's 102 colours and draws a small chart. It reads the SPHEREx DR1 all-sky cube (doi:10.26131/IRSA679) from the same public archive, and nothing is read before the press. In our six reads on 15 Nov 2026 a read took 34 to 36 seconds and about 2.1 MB. The chart is a quick look, not a measurement: the colours of one spot were not all observed at the same time, a neighbour inside the same 12.9 arcsec pixels can change what is read, some colours can be blank (Barnard's Star had data in 9 of 102 in our read), and stripes from Earth's airglow can sit near 1.083 µm. The labels mark where known features fall, not that a feature is there.

### How it works

[SCREENSHOT: the frame details panel for one frame, showing date, wavelength, detector, release and the FITS link]

1. **Position.** You give a sky position. For the five presets, Slowsky stores each target's catalogue position and **proper motion** (the slow drift of a star or brown dwarf across the sky, year by year).
2. **Frame lookup.** A small server function asks NASA's Infrared Science Archive (IRSA) which SPHEREx frames cover the spot. The function exists because IRSA's search does not accept calls from other websites' pages. It lets through only the DR1 and QR3 releases.
3. **Only the needed bytes.** The frames are FITS files (the standard astronomy image format) in NASA's public Amazon S3 bucket. The browser reads each file's header, its wavelength table and only the part that covers the view, from the image and from the layers stored with it (the zodiacal-light model; the quality layer when Flagged pixels is on; and, for Candidate changes, the quality layer and the error map). It never downloads a whole file.
4. **Same wavelength.** In a SPHEREx frame, each part of the detector sees a slightly different **wavelength** (colour of light). Slowsky groups one detector's frames into **visits**: a visit takes in every frame that starts up to 10 days after its first one. For each visit, it keeps the one frame whose wavelength at the spot is closest to your choice, and only if your choice falls within half that spot's bandwidth. It leaves out other visits and says how many. Near a strong spectral line even that small difference can matter. (Subtract groups the frames on show a little differently: each taken less than 10 days after the one before.)
5. **Moving targets.** For a preset, Slowsky moves the target by its proper motion to each frame's own date.
6. **Lining up.** It removes zodiacal light (the glow of sunlit dust in the solar system), using the archive's own model in each file. Then it puts every frame on one north-up grid, using the sky mapping in each file's header.
7. **Drawing.** All frames and the Stack picture share one brightness scale, so a frame that looks brighter has higher values in the data (after the zodiacal light is removed). Higher values are not always a real change in the sky; see Limits.
8. **Saved copy first.** The five presets open at once from a small saved copy of real SPHEREx frames that ships with the site (24 frames per target). **Go live** reads the same target fresh from the archive. If the archive does not answer, a preset falls back to the saved copy. The status line says which one you see.
9. **Older picture.** When you switch it on, the page reads IRSA's copy of the 2MASS K image tiles. No 2MASS pixels are stored with the site.
10. **Candidate changes.** On a live view, the page compares the first and the last visit, and only when their wavelengths differ by no more than 0.02 µm. SPHEREx's wavelength changes across each frame, so two visits that match at the centre can differ away from it: wherever the average wavelengths of the two visits' frames differ by more than 0.02 µm, that part of the picture is left out, and a note gives the share left out. It reads the archive's error map for each frame of the two visits, to judge how far a spot stands out from the noise. It leaves out a spot when, in a frame of a checked visit, the brightest of up to four detector pixels at or beside the brightest point within 12 arcseconds of it carries one of the archive's TRANSIENT, OUTLIER, NONFUNC or SUR_ERROR flags (quality marks the archive sets on a pixel, for example for a cosmic-ray hit), and it says how many it left out. The list opens with at most 8 spots that have no star in the loaded Gaia star list within 6 arcseconds (a tiny angle); the rest stay behind a button, because a small shift between two pictures of a star can look like a change. The loaded Gaia star list holds at most the 400 brightest stars, and on the 0.5° and 1° fields it covers only a circle of radius 0.2° around the centre, so a spot with no listed star within 6 arcseconds that lies outside that circle, or within 6 arcseconds of its edge, is marked as not checked against the list and comes last; a note says when the star list was cut short. A saved copy lists nothing, because it is not checked against the error maps and flags.

### Who it helps

[SCREENSHOT: the page on a phone, one column, showing Barnard's Star]

- **People with no astronomy background.** The guide gives one line on each control and a short list of the words the page uses, in plain language.
- **Volunteers and amateur astronomers.** The challenge page says volunteers comparing sky images found most of the known comets and brown dwarfs. Slowsky gives them SPHEREx frames for any spot without software to install.
- **Teachers and students.** The five presets each say what to look for and what the picture cannot show. A class can open the same view from one link.
- **Anyone checking a result.** Every frame links to its original file and the archive's own page, so you can go back to the source.

### What is new

[SCREENSHOT: Subtract on RW Aurigae, B − A, with the A and B visit lists open]

What Slowsky adds to a plain blink viewer:

- **Colour-matched frames.** A SPHEREx frame sees each spot at one wavelength. Slowsky picks one frame per visit at matched wavelength, so a colour difference does not pass for a brightness change.
- **Reading the archive in place.** The browser reads small pieces of NASA's own files from S3. No copy of the archive sits on our server.
- **Honest target cards.** Each preset card has a "What this can't tell you" line beside "What to look for".
- **Gaia rings that move.** Each ring sits where that star should be on that frame's date, from its catalogue motion.
- **Works when the archive is slow.** The saved copy of the five presets keeps the demo working if IRSA is down.
- **Two colours in one picture.** False colour shows where a spot is brighter at the shorter or the longer wavelength, and lists its own limits under the picture.
- **Then and now for Barnard's Star.** Older picture flips to a 2MASS picture from 1997 to 2001. On the 0.25° field the star sits away from its ring there, and a bracket marks where its catalogue motion puts it in those years.
- **A change list that screens itself.** Candidate changes leaves out spots with certain archive flags, such as TRANSIENT (cosmic-ray hits), and puts spots next to known Gaia stars behind a button. It says above the list that every line is a candidate only.
- **A guide for newcomers.** "What am I looking at?" explains each control and the page's words in plain language. Each fact in it is listed with its source in `SOURCES.md`, under "Help text".

### Design choices

[SCREENSHOT: a target card showing "What to look for", "Measured here" and "What this can't tell you"]

| Choice | Why |
|---|---|
| One wavelength and one detector per view | Frames at different colours would look like a change in brightness |
| One brightness scale for all frames | A brighter frame then means higher values in the data |
| North up on one grid | Most stars stay put from frame to frame, so one that moves stands out |
| The word "candidate" for anything that stands out | A change can be noise, a satellite trail or a camera artefact |
| Flags never change the pictures, the brightness curve or the motion check; only the Candidate changes list uses them | The list leaves out spots with certain flags and cautions others. Everywhere else you see the archive's own quality marks and judge them yourself |
| False colour and Older picture are pictures for looking, not measurements | False colour's two wavelengths were not taken at the same times. The older picture is from another telescope at another wavelength, so its brightness cannot be compared with SPHEREx |
| Saved copy first for the presets | A live read takes time (our rough timing: 20 to 45 seconds) |
| Plain words, with a guide and short notes for the terms | The page is for people with no astronomy background |
| A link for every view | You can send a class or a friend the exact picture you saw |

### How we checked it

[SCREENSHOT: Barnard's Star in Blink, frame details showing the "Moved, looks 1 to N … expected" row and the "Measured here" row]

Tests run with `npm test`. Three are gates that every change must pass:

| Gate | What it checks | Pass mark |
|---|---|---|
| WCS (sky mapping) | Slowsky's pixel-to-sky mapping against astropy, at 9 points on each of two real frames, both directions | within 0.01 pixel |
| S3 cutout | A box of pixels read from S3, summed, against astropy's value. This one needs the network, so it runs with `LIVE=1 npm test`; plain `npm test` checks that a reply that is not a partial read is refused | within 1 part in 1,000 |
| Regrid | Simulated field stars across epochs, against each other and their true position | within 0.3 pixel |

- Other tests cover the archive proxy, the saved copy, coordinate input, the player, stacking and the link format.
- A browser test (`npm run smoke`) opens the five presets in headless Chromium with the archive blocked.
- **Barnard's Star.** The page measures how far the star moved between two frames and shows the shift its catalogue proper motion predicts beside it. The two can differ: the prediction leaves out parallax (the small yearly shift from Earth's orbit), and the star's bright core is hard to centre. `[SAM: Barnard numbers: read them off the live Barnard card and add them here, or delete this note]`
- **Older picture facts.** Its dates (June 1997 to February 2001) and its wavelength band come from the 2MASS tile set's own description file at IRSA, read on 14 Nov 2026.
- **Facts on the page.** `SOURCES.md` lists every fact in the README, the page and the target cards with its source. Claude opened the sources it could reach and matched the claims. Gemini, a model from another maker, then read the claims and the list as text and marked anything it judged wrong. Codex and Grok each rechecked part of the list against its sources. AI tools ran these checks; no person has yet gone through the list line by line.

### Limits

[SCREENSHOT: R Draconis in Blink, showing its centre (painted white, because the camera has no value there) and its card's "What this can't tell you" line]

- Slowsky shows changes between frames. It does not decide what a change is. Anything that stands out is a candidate for a closer look.
- **It is not a planet finder.** Optical surveys (ZTF, DES and Pan-STARRS1) have together ruled out about 78% of Planet Nine's predicted range, and what is left is faint, around V magnitude 22 (Brown, Holman & Batygin 2024). SPHEREx reaches 19.5 to 19.9 AB magnitude (5 sigma) below 3.8 µm, and 17.8 to 18.8 from 3.8 to 5 µm, only after its two-year survey, with four observations in each channel at a typical sky brightness away from the Milky Way's plane (Bock et al. 2025). One frame is shallower still; that part is our own reasoning, not a number from the paper. These are different bands, so this is a rough comparison.
- A live view reads at most 60 frames and says so. It picks them by estimating each frame's wavelength at the spot from the archive's list (about 10 pixels off), or spreads them evenly in time when it cannot. At very busy spots, such as near the ecliptic poles, the archive can cut its frame list short, and the page says so.
- Gaia rings mark only stars brighter than G magnitude 19, and at most the 40 brightest in each picture. A live view fetches Gaia stars only within 0.2° of the centre, and the saved copy holds those within 0.1°, so the outer part of a wide field has no rings. Blink and Stack show them; Subtract does not. A live view skips them if the catalogue is slow to answer.
- Gaia rings start from the catalogue's 2016.0 positions, so a fast star that walked into the field since then has no ring.
- The target marker moves with proper motion only for the five presets. A star found by name stays at its catalogue position.
- The brightness curve divides the target by two to four Gaia comparison stars of G magnitude 9 to 15 (a range we chose). They are barely checked for steadiness, so a variable one shows as wobble. It is a rough check, not calibrated photometry.
- Stack and Subtract use plain averages, so a cosmic-ray hit in one frame still shows, only fainter.
- False colour is a picture for looking, not a measurement. Its two wavelengths were not taken at the same times, and areas where not every frame has usable pixels are hatched instead of coloured. The page lists these limits under the picture.
- The older picture is also for looking, not measuring. It comes from a different telescope at a different wavelength (2.16 µm), its brightness cannot be compared with SPHEREx, and the night it was taken is not known. On the 0.1° field Barnard's Star's older spot is outside the view, and the page says so.
- Flagged pixels leaves out three kinds of flag (SOURCE, FULLSAMPLE and GHOST_FPA). A flagged pixel beside a very bright star can be spilled charge and not a cosmic ray, and hits in the first ten seconds of an exposure may go unflagged.
- Candidate changes compares only the first and the last visit, at one wavelength, and it cannot confirm any spot it lists. It cannot tell a real change in the sky from a detector hit, a sharper star image in one visit or a small shift between the two pictures, and it says so above the list. When a visit has fewer than 3 frames, the page cannot rule out a detector hit, and it says so. The Gaia star list holds at most the 400 brightest stars in a circle around the centre (at most 0.2° in radius). So on a wide field a spot with no listed star within 6 arcseconds that lies outside that circle, or within 6 arcseconds of its edge, is marked as not checked against it, and a faint catalogue star can be missing from the list; a note says when the star list was cut short.
- The change list's flag check has limits too. An OVERFLOW flag near a spot does not remove it: the line says the reading there can be unreliable, and no longer says which visit is brighter. The TRANSIENT flag can miss hits in the first ten seconds of an exposure, so an unflagged spot is not proof of a clean one.
- The centre of R Draconis is too bright for the camera in all 24 saved frames, and Barnard's Star's in 22 of 24. The camera stores no value there.
- The saved copy holds only the five presets, one detector each, at most 0.1° across.

### In progress, not yet public

`[SAM: delete lines for anything still off at submit; move lines up for anything switched on]`

These parts are in the code but switched off on the public site, so a visitor cannot use them.

- A sentence that reads the colour at one spot of the False colour picture. It stays off because the page shows the picture and does not measure a colour.
- For R Draconis, the light in a ring around its too-bright centre, look by look.
- A machine-learning sort hint for each candidate change, trained only on fake changes added to real frames. It is connected to the Candidate changes list behind a switch, and that switch stays off: the squares the page would hand it are not the kind it learned from, and two AI reviews (Gemini and Claude Opus) said its lines could mislead. With the switch off, the site does not load the model and shows nothing from it.
- A short AI-written note about the view, which stays off until it is set up. When it is on, its heading reads "AI-generated" followed by the name of the model that wrote it. `[SAM: delete this line if you keep the AI note block below]`

`[INCLUDE ONLY IF THE AI NOTE IS ON]`

**AI note.** A button asks Claude Opus 5.5, through the Claude API, to write a short reading of the view from the numbers the page itself measured. Its heading reads "AI-generated" followed by the model's name (for example "AI-generated: Claude Opus 5.5"), and the page says it can be wrong. Before you see it, a checker keeps only sentences that match a fixed list of sentence forms, filled in with the words and numbers of the fact sheet built from the page's own measurements, and drops every other sentence. It is a filter, not a proof: it checks the note against the fact sheet, not the measurements themselves. The note sits behind a passcode: `[SAM: passcode here]`

`[END OF AI NOTE BLOCK]`

### Tools

[SCREENSHOT: the GitHub repo page showing the README and the MIT licence]

| Part | Tools |
|---|---|
| Web page | TypeScript, Vite, HTML canvas; Geist fonts |
| Hosting and the archive proxy | Vercel (static site plus server functions in `api/`) |
| Tests | Vitest; Playwright with headless Chromium for the smoke test |
| Saved-copy and model scripts | Python with astropy, numpy, pyvo and requests; PyTorch for the sort hint |
| Demo film (made outside the code repository) | Remotion (editing), ElevenLabs (AI voice) |

### AI tools used

AI tools helped write the code. Sam chose the idea and makes every product decision; `DECISIONS.md` in the repo is his own log, and AI tools do not write in it.

| Tool | Maker | Used for |
|---|---|---|
| Claude Code (Claude Fable, Opus, Sonnet and Haiku models) | Anthropic | Writing and reviewing code and tests, planning help, page text drafts; drawing the site icon as SVG code (decoration, not data); checking the facts against their sources and writing `SOURCES.md` |
| Claude API (Claude Opus 5.5) | Anthropic | The optional AI note inside the site (off until set up); when it is on, its heading names the model |
| Codex (GPT-6.1 Sol and Terra models) | OpenAI | Writing and reviewing code; checking the source list |
| Gemini (Argon and Carbon models, through Antigravity) | Google | Writing and reviewing code; reviewing the facts and wording |
| Grok 4.7 (through Grok Build) | xAI | Reviewing code; checking the source list |
| ElevenLabs (model `eleven_multilingual_v2`) | ElevenLabs | AI voice in the demo film; the film names the model on screen |
| GPT Image (model `gpt-image-2`) | OpenAI | Decorative images in the demo film; the film names the model on screen. Never sky data `[SAM: film images]` |
| Change sort hint (a small neural network) | Trained in this repo with PyTorch, by scripts Codex and Claude wrote | Nothing yet: switched off |

All sky pictures on the site and in the film are real SPHEREx pixels.

The demo film shows one line on screen: "AI images: OpenAI gpt-image-2 · AI voice: ElevenLabs eleven_multilingual_v2". Its end credits repeat both. Each AI-made item, with the model that made it and where the record of the request is kept, is listed in `SOURCES.md` under "AI-generated content". The guide on the page ends with a line that says the code, the wording and the icon were made with AI tools, and links to that list.

### Data and credits

[SCREENSHOT: the page footer showing the credit line and the Gaia DR3 link]

- **SPHEREx DR1** spectral images, doi:10.26131/IRSA678, and **QR3** spectral images, doi:10.26131/IRSA662, from the NASA/IPAC Infrared Science Archive.
- **Gaia DR3**, doi:10.5270/esa-qa4lep3, credit: ESA, Gaia DPAC, under CC BY-NC 3.0 IGO, read through STScI's Gaia cone search service.
- **SIMBAD** (Wenger et al. 2000, A&AS 143, 9) for names and target positions, and **VizieR** as a fallback for Gaia rows, both through their CfA mirrors.
- **2MASS** (Two Micron All Sky Survey; University of Massachusetts and IPAC/Caltech, funded by NASA and the National Science Foundation; Skrutskie et al. 2006, AJ 131, 1163) for the Older picture, as image tiles made by CDS (CNRS/Unistra) and served by IRSA.

This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.

This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology.

This work has made use of data from the European Space Agency (ESA) mission Gaia ( https://www.cosmos.esa.int/gaia ), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium ). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.

This work made use of Astropy: a community-developed core Python package and an ecosystem of tools and resources for astronomy (Astropy Collaboration, 2013, 2018, 2022).

Full licences: `DATA-LICENSES.md`. Every fact and its source: `SOURCES.md`.

### Where this page answers each judging criterion

| Criterion | Where to look |
|---|---|
| Impact | Who it helps; a link for every view; no install |
| Creativity | What is new; Design choices |
| Validity | How we checked it; Limits; How it works |
| Relevance | What it does (each row names what the challenge asks for); Data and credits |
| Presentation | Summary; screenshots; the demo film |

---

## 5. Three slides for the interim deck

**Slide 1. Slowsky: watch SPHEREx's sky change**
- Type a position or a star name; real SPHEREx frames play in date order.
- Team Clupai, Melbourne. Challenge: Planet X and SPHEREx.
- slowsky.clupai.com
Screenshot: the full page on RW Aurigae in Blink.

**Slide 2. Real NASA frames, read in the browser**
- Only the needed bytes come from NASA's public S3 storage.
- One frame per visit at matched wavelength; one north-up grid.
- Gaia rings move to each frame's date.
Screenshot: Barnard's Star frame details with the "expected" and "Measured here" rows.

**Slide 3. Blink, Stack, Subtract**
- Five challenge targets in one click, each with what it cannot show.
- Subtract two visits you pick; every view is a shareable link.
- Anything that stands out is a candidate, not a result.
Screenshot: Subtract on RW Aurigae, B − A.

---

## 6. Appendix (not for pasting): claims and sources

README = `slowsky/README.md`; SOURCES = `slowsky/SOURCES.md`; DL = `slowsky/DATA-LICENSES.md`; challenge = `docs/challenges/planet-x-and-spherex.md`.

| # | Claim | Source | Locator |
|---|---|---|---|
| 1 | SPHEREx is a NASA space telescope mapping the whole sky in infrared, revisiting each part | README; SOURCES | README intro; SOURCES "SPHEREx and its camera", row "Maps the whole sky" (Bock 2025 abstract) |
| 2 | 0.75 to 5 µm, all infrared | SOURCES | rows "Covers 0.75 to 5.0 µm", "The whole range is infrared" |
| 3 | 102 colour channels | SOURCES | row "Has 102 spectral channels" |
| 4 | Four maps of the whole sky in two years | SOURCES | row "Maps the whole sky and comes back" |
| 5 | Six detectors; slider 0.75 to 5.00 µm picks the detector | SOURCES; README | row "SPHEREx has six detectors"; README "What you can do" |
| 6 | Frames are public in an archive / S3 bucket `nasa-irsa-spherex` | SOURCES | "Where the data lives", first row |
| 7 | Search by RA/Dec (decimal or h-m-s) or star name via SIMBAD | README | "What you can do", bullet 2 |
| 8 | Five presets with "what to look for" and "what it cannot tell you" | README; `src/ui/app.ts` lines 248-258 | "What you can do", bullet 1 |
| 9 | Blink, Stack (average), Subtract (pick A and B; B − A or A + B) | README | "What you can do", "Watch the frames three ways" |
| 10 | FOV 0.1°, 0.25°, 0.5°, 1° | README | "What you can do" |
| 11 | Gaia DR3 rings, moved to each frame's date by proper motion | README | "What you can do" and Limits (Gaia rings from 2016.0) |
| 12 | Link reopens position, field, colour, frame and mode | README | "What you can do", Copy a link |
| 13 | Frame details: date, wavelength, detector, release, file name, links to FITS and archive page | README | "What you can do", Read each frame's details |
| 14 | Flagged pixels on live views in Blink, quality layer, cosmic-ray hits; count of flagged pixels and the three most common kinds | README; SOURCES; `src/ui/slots.ts` `DEFAULT_FEATURES` (flags: true) | README "What you can do"; SOURCES row on quality layer |
| 15 | Rough brightness curve for RW Aurigae, WISE 0855 when enough stars | README; `src/ui/app.ts` line 351 (not behind a switch) | README Limits, brightness curve bullet; SOURCES "What the page does", curve row |
| 16 | Phone: one column, add to home screen | README | "What you can do", last bullet |
| 17 | Proper motion definition | SOURCES | row "Proper motion is the slow drift" (ESA) |
| 18 | Server function because IRSA search does not accept cross-site calls; only DR1 and QR3 pass | README; SOURCES; `api/sia.ts` line 1 | README "How it works" step 2; SOURCES "Where the data lives" row 2 |
| 19 | Reads header, wavelength table and needed rows by range requests; never a whole file | README | "How it works" step 3 |
| 20 | Each part of the detector sees a slightly different wavelength; one frame per visit within half the bandwidth | README; SOURCES | step 4; SOURCES rows "Each part of the detector", "For each visit the page keeps" |
| 21 | Zodiacal light = sunlit dust glow; model in each file | README; SOURCES | step 6; SOURCES rows "Zodiacal light is", "Each file carries a zodiacal light model" |
| 22 | North-up grid from header sky mapping | README | step 6 |
| 23 | One brightness scale for all frames | README | step 7 |
| 24 | Saved copy, 24 frames per target; Go live; fallback; status line | README; SOURCES | step 8 and the line below it; SOURCES "What the page does" row 1 |
| 25 | Volunteers comparing images found many known comets and brown dwarfs | challenge | Background, paragraph 2 |
| 26 | No copy of the archive on our server | README | step 3 (reads from S3) and step 2 (server only passes the search) |
| 27 | Live read timing 20 to 45 s, written as our rough timing | README; SOURCES | README step 8; SOURCES "Not confirmed" (own timing) |
| 28 | Changes can be noise, trails or artefacts; candidate wording | README | Limits, bullet 1 |
| 29 | Flags never change the pictures, the brightness curve or the motion check; only the Candidate changes list uses them, to leave some spots out and caution others (v0.3 update 2: reworded) | README; SOURCES | Limits, bad-pixel bullet ("Only the Candidate changes list uses them"); SOURCES "What the page does", flags row |
| 30 | Test gates: WCS 0.01 px at 9 points on two frames; S3 1 in 1000; regrid 0.3 px | README | "Tests" |
| 31 | Other tests; smoke test with archive blocked in headless Chromium | README | "Tests" and "Run it" |
| 32 | Barnard measured vs predicted shown; prediction omits parallax; bright core hard to centre | README; `src/ui/app.ts` lines 1274-1279 | Limits, Barnard bullet |
| 33 | Parallax definition | SOURCES | row "Parallax is a small shift" (ESA) |
| 34 | Fact-check process (Claude, then Gemini; Codex and Grok rechecked part of the list; no person line by line) | SOURCES; README | SOURCES "How this list was made" (Claude and Gemini); README "AI tools used" (Codex and Grok checked the source list) |
| 35 | Planet Nine: 78% ruled out, V 22 left (Brown, Holman & Batygin 2024) | README; SOURCES | README Limits bullet 2; SOURCES "Planet Nine comparison" row 1 |
| 36 | SPHEREx 19.5 to 19.9 AB below 3.8 µm after two years; one frame shallower; rough comparison | README; SOURCES | README Limits bullet 2; SOURCES row 2 of that table and "Not confirmed" (single frame is own reasoning) |
| 37 | At most 60 frames; busy spots near the ecliptic poles cut short | README; SOURCES | Limits bullets 3-4; SOURCES rows "Live loading reads at most 60", "The archive can cut" |
| 38 | Gaia 2016.0 positions; fast star walking in has no ring | README; SOURCES | Limits; SOURCES row "Gaia DR3 positions are given for 2016.0" |
| 39 | Curve uses 2 to 4 Gaia comparison stars; rough check | README | Limits, curve bullet |
| 40 | Stack and Subtract are plain averages | README | Limits, last bullet |
| 41 | R Draconis centre saturated in every saved frame; Barnard in most | README; SOURCES | Limits; SOURCES row (24 of 24, 22 of 24) |
| 42 | Saved copy: five presets, one detector, at most 0.1° | README | Limits |
| 43 | Switched-off parts: False colour reading sentence, R Dra ring, sort hint, Spectrum panel, "Tonight's sky" line (v0.3 update 2: change list moved out, it is on) | README | "In the repository but not switched on" (lead line: Flagged pixels, False colour, Older picture and Candidate changes are on) |
| 44 | Sort hint trained only on fake changes added to real frames; connected to the change list behind a switch that stays off, because the squares the page would hand it are not the kind it learned from and two AI reviews (Gemini, Claude Opus) said its lines could mislead; with the switch off the site does not load the model (v0.3 update 3, matched to `58ac816`) | README | "The change sort hint": "What it learned from", "Where it stands", "Why it stays off" |
| 45 | Spectrum panel exists and is switched off; while off the page does not show it and reads nothing from the cube | README | "In the repository but not switched on", bullet 4 (Spectrum panel) |
| 46 | AI note: Claude Opus 5.5 via Claude API, labelled AI, passcode, off until set up | README | "AI tools used", Claude API row; `src/ui/ai-note.ts` line 16 |
| 47 | AI note checker keeps only sentences that match a fixed list of sentence forms filled from the fact sheet, and drops the rest; a filter, not a proof | README | "AI tools used", Claude API row; `src/lib/insight.ts` `checkNote` (line 279) |
| 48 | Tools: TypeScript, Vite, Vitest, Anthropic SDK; astropy, numpy, pyvo, requests; Geist fonts | DL | "Code dependencies", "Fonts" |
| 49 | Canvas drawing | `src/ui/app.ts`, `src/ui/slots.ts` (`getContext('2d')`) | code |
| 50 | Vercel hosting and server functions; Playwright and Chromium smoke test; PyTorch for the hint | README | "Run it" (vercel dev, smoke) and AI table (PyTorch) |
| 51 | Remotion for the film | `VIDEO-PLAN.md` | "Edit" row |
| 52 | AI tools table, with the model names `eleven_multilingual_v2` and `gpt-image-2`, "the film names the model on screen", and the site icon in the Claude Code row (v0.3.2: updated) | README | "AI tools used" (rows copied; wording trimmed), lines 182, 187 and 188 |
| 53 | "AI tools helped write the code"; Sam chose the idea; DECISIONS.md is his log | README | intro paragraph 3; text under the AI table |
| 54 | GPT Image used in the film; the film shows "AI images: OpenAI gpt-image-2 · AI voice: ElevenLabs eleven_multilingual_v2" on screen and its end credits repeat both (v0.3.2: was "AI-generated images") | SOURCES; README | SOURCES "AI-generated content", "Labels", bullet 4 (line 241); README AI table, GPT Image and ElevenLabs rows. Film images: SOURCES "AI-generated content" table, "Demo film images" row (nine images) |
| 55 | DOIs DR1 IRSA678, QR3 IRSA662, Gaia 10.5270/esa-qa4lep3 | SOURCES; BUILD-PLAN "References and licences" | SOURCES rows "DR1 is", "QR3 is", "Gaia DR3 is doi" |
| 56 | SPHEREx, IRSA, Gaia, Astropy sentences | `research/26-credits-verbatim.md` | §2.1, §2.2, §2.8, §2.19 (verbatim) |
| 57 | Gaia credit "ESA, Gaia DPAC", CC BY-NC 3.0 IGO | SOURCES | rows "Gaia credit line" and "Gaia DR3 is under CC BY-NC 3.0 IGO" |
| 58 | Build began 14 Nov after kick-off | README | intro paragraph 3 |
| 59 | Pre-kick-off work was reading and data exploration only, nothing copied | workspace `CLAUDE.md` (rules) and `BUILD-PLAN.md` (email item 2) | not in README |
| 60 | Live site and public MIT repo open | WebFetch today, 14 Nov: https://slowsky.vercel.app (loads), https://github.com/Clupai8o0/slowsky (public, MIT) | fetched today |
| 61 | "What it does" table, right column: paraphrases of the challenge page, one short quote (Barnard's Star row) | challenge | Objectives, Potential Considerations |
| 62 | False colour: live view, Stack; wavelength on screen plus a partner (4.60 µm below 2.42 µm, else 1.25 µm); blue brighter at shorter, orange at longer | README | "What you can do", False colour bullet (no SOURCES row: the page's own design, in `src/lib/falsecolour.ts`) |
| 63 | False colour is for looking, not measuring; two wavelengths not taken at the same times; hatched where not every frame has usable pixels; limits listed under the picture | README | "What you can do", False colour bullet |
| 64 | Older picture: Blink, 0.1° or 0.25° field; flips between 2MASS K and the SPHEREx frame | README | "What you can do", Older picture bullet |
| 65 | 2MASS picture taken between June 1997 and February 2001; the night is not known | README; SOURCES | README Older picture bullet; SOURCES "Older picture (2MASS K)", row 1: https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/K/properties (`t_min`, `t_max`) |
| 66 | Older picture is K band at 2.16 µm, another telescope; brightness not comparable with SPHEREx | README; SOURCES | README Older picture bullet; SOURCES "Older picture (2MASS K)", row 2: same properties file (`em_min`, `em_max`) |
| 67 | 0.25° field: Barnard's Star sits away from its ring; bracket marks where its catalogue motion puts it in 1997 to 2001; on 0.1° that spot is outside the view and the page says so | README | "What you can do", Older picture bullet |
| 68 | Tiles read from IRSA's copy when switched on; no 2MASS pixels stored with the site | DL | "Where each one is used", 2MASS bullet |
| 69 | 2MASS: University of Massachusetts and IPAC/Caltech, funded by NASA and NSF; Skrutskie et al. 2006, AJ 131, 1163 | README; SOURCES; DL | README "Data and credits"; SOURCES "Older picture (2MASS K)", row 3: https://irsa.ipac.caltech.edu/Missions/2mass.html ("Acknowledgement"); DL note 3, 2MASS line |
| 70 | Tiles made by CDS (CNRS/Unistra), served by IRSA | README; SOURCES; DL | README "Data and credits"; SOURCES "Older picture (2MASS K)", row 4: properties file (`obs_copyright`, `baseUrl`); DL data table, 2MASS row |
| 71 | Older picture's dates and band read from the tile set's description file on 14 Nov 2026 | SOURCES | "Older picture (2MASS K)", line under the heading |
| 72 | Colour-reading sentence (`fcReading`) stays off: the page shows the picture and does not measure a colour | README | "In the repository but not switched on", bullet 1 |
| 73 | Candidate changes: on a live view, a list of spots where the light differs between the first and the last visit, each marked on the sky with a numbered ring | README | "What you can do", Candidate changes bullet, sentence 1 ("numbered dashed ring") |
| 74 | The two visits are compared only when their wavelengths differ by no more than 0.02 µm; the page reads the error map for each frame of the two visits to judge how far a spot stands out from the noise | README | Candidate changes bullet, sentences 2 and 3 |
| 75 | A spot is left out when the brightest of up to four detector pixels at or beside the brightest point within 12″ of it carries a TRANSIENT, OUTLIER, NONFUNC or SUR_ERROR flag (a quality mark the archive sets on a pixel, for example for a cosmic-ray hit); the page says how many it left out | README; SOURCES | Candidate changes bullet, sentence 4 (same wording); SOURCES "What the page does", flags row (`mountChanges`, `src/ui/flag-screen.ts`) and the quality-layer row (Explanatory Supplement, Table 16: TRANSIENT is set for a transient such as a cosmic-ray hit) |
| 76 | The list opens with at most 8 spots that have no star in the loaded Gaia star list within 6″ (README: "no Gaia catalogue star within 6″", then the two limits of that list, row 93); the rest stay behind a button, because a small shift between two pictures of a star can look like a change | README | Candidate changes bullet, sentence after the bracket |
| 77 | Every line is a candidate only; the page cannot tell a real change from a detector hit, a sharper star image in one visit or a small shift between the pictures, and says so above the list; a saved copy lists nothing, because it is not checked against the error maps and flags | README | Candidate changes bullet, last two sentences |
| 78 | The list compares only the first and the last visit, at one wavelength, and cannot confirm any spot; fewer than 3 frames in a visit means a detector hit cannot be ruled out, and the page says so | README | Limits, Candidate changes bullet, sentences 1 and 2 |
| 79 | An OVERFLOW flag near a spot does not remove it; the line says the reading can be unreliable and no longer says which visit is brighter | README | Limits, Candidate changes bullet, sentence 3 |
| 80 | The TRANSIENT flag can miss hits in the first ten seconds of an exposure, so an unflagged pixel is not proof of a clean one | README; SOURCES | Limits, Candidate changes bullet (Flagged pixels part); SOURCES "SPHEREx and its camera", quality-layer row (Explanatory Supplement, Table 16). The README says it of the flag itself, not of the list by name; the list reads the same flag |
| 81 | "Tonight's sky" line (`upTonight`): off; when the spot stands highest in tonight's dark hours from Melbourne, how high and which way; says where the spot is, never whether anything can be seen | README | "In the repository but not switched on", last bullet. The page text says only "switched off on the site", as the README does; the wait for a `DECISIONS.md` line is in a note to Sam, not in the page text (Gemini check, 04:21) |
| 82 | (v0.3.2) "What am I looking at?" opens a plain-language guide: one line on each control and a short list of the words the page uses | README; `src/ui/help.ts` | README "What you can do", bullet 1 (line 16); `help.ts` `HELP_TITLE` (line 11), `CONTROL_HELP` (lines 19-33), `GLOSSARY` (lines 41-108) |
| 83 | (v0.3.2) The button reads "Help" on a phone; a "Help" button beside Focus opens the same guide when the targets panel is folded | `src/ui/help-view.ts`; `src/ui/styles.css` | `help-view.ts` lines 8-16 (both buttons) and line 51; `styles.css` lines 701-703 (short label under 480 px wide) and 452-460 (beside Focus when the left panel is folded, wide layout) |
| 84 | (v0.3.2) Short notes beside the colour slider, the Gaia rings and the Older picture explain µm, Gaia and 2MASS; the Candidate changes list explains S/N, catalogue star and ″ when they appear | `src/ui/app.ts`; `src/ui/slots.ts`; `src/ui/help-view.ts` | `app.ts` lines 347 (µm), 308 (Gaia), 312 (2MASS); `slots.ts` line 527 (`syncGloss` with S/N, catalogue star, arcsecond); `help-view.ts` `glossFor` (line 24) adds a note only for a word found in the text. Not in the README |
| 85 | (v0.3.2) Each fact in the guide is listed with its source | SOURCES | "Help text" (line 152) |
| 86 | (v0.3.2) Challenge asks for a public-facing tool that makes it easy for anyone to see how the sky changes | challenge | Objectives, line 27 (paraphrase) |
| 87 | (v0.3.2) When the AI note is on, its heading reads "AI-generated" followed by the model's name, e.g. "AI-generated: Claude Opus 5.5"; the note is off until set up | SOURCES; README; code | SOURCES "Labels", bullet 1 (line 233); README AI table, Claude API row; `src/ui/ai-note.ts` line 543; "can be wrong": `src/ui/help.ts` line 32 |
| 88 | (v0.3.2) Each AI-made item is listed with the model that made it and where the record of the request is kept | README; SOURCES | README line 191; SOURCES "AI-generated content" (line 181), table column "Record" |
| 89 | (v0.3.2) The guide ends with a line that says the code, the wording and the icon were made with AI tools, and links to that list | SOURCES; code | SOURCES "Labels", bullet 3 (line 239); `src/ui/help.ts` `AI_LINE`, `AI_LINK` (lines 113-115); `src/ui/help-view.ts` line 21 |
| 90 | (v0.3.2) Claude Code drew the site icon as SVG code; decoration, not data | README; SOURCES | README line 182; SOURCES "AI-generated content", "Site icon" row (line 193) |
| 91 | (v0.3.2) Design row "Plain words, with a guide and short notes for the terms"; who it helps: people with no astronomy background | README; code | README "What you can do", bullet 1 ("New to astronomy?"); rows 82 and 84 |
| 92 | (v0.3.3) Wherever the average wavelengths of the two visits' frames differ by more than 0.02 µm, that part of the picture is left out of the comparison, and a note gives the share left out | README; SOURCES; code | README "What you can do", Candidate changes bullet ("The list states two more limits in its notes"); SOURCES "Each part of the detector sees a slightly different wavelength" (Bock et al. 2025); `compareVisits` in `src/lib/changes.ts` |
| 93 | (v0.3.3; edge wording v0.3.4) The loaded Gaia star list holds at most the 400 brightest stars, and on the 0.5° and 1° fields it covers only a circle of radius 0.2° around the centre (the radius is the smaller of 0.2° and 0.7071 times the field, `src/lib/source.ts` line 592); a spot with no listed star within 6 arcseconds that lies outside it, or within 6 arcseconds of its edge, is marked as not checked against the list and comes last, and a note says when the star list was cut short | README; code | Same README paragraph; `findChanges` in `src/lib/change-input.ts`; `plainListNotes` in `src/lib/changes.ts` |

### Cut for lack of a source

- Any claim that Slowsky is the first or only tool of its kind. No source; "What is new" lists what it does instead.
- "Easy to update with new releases." The releases are one list in `api/sia.ts`, but the README gives no new-release recipe. Cut from the challenge table.
- Measured and predicted numbers for Barnard's Star. The README and SOURCES give none; the page computes them live.
- The 0.66 px Gaia-vs-centroid figure from research note 06. Pre-kick-off research, not in the product's files.
- "AI wrote most of the code." The README says "AI tools helped write the code"; the draft matches that.

### Sam should check

- (v0.3) The 2MASS credit under "Data and credits" is in our own words, as `DATA-LICENSES.md` gives it. IRSA's 2MASS page has the official acknowledgement sentence; paste it in if you want the exact wording.
- (v0.3) The two new 2MASS links were not opened in this pass. Open them before submit.
- (v0.3) The 2MASS rows name CDS, as the README and `DATA-LICENSES.md` do. The SIMBAD and VizieR rows still do not (see below).
- (v0.3) The 2MASS IRSA page is in NASA Data (NASA-funded, served by IRSA); the CDS-made tiles are in Partner data. Move the tiles row if you prefer.
- (v0.3 update 2) The Summary is 199 words (1,134 characters): inside the form's suggested 50 to 200 words and under the 1,500-character cap (counted with Python `split` and `len`, Sun 15 Nov 04:21 NPT; Candidate changes added).
- (v0.3 update 3) Gemini checked every line about Candidate changes, flags, Tonight's sky, the sort hint and the Summary against the README at `58ac816`: 42 backed, 5 said more than the README, 2 not in it, none wrong. All 7 were reworded to the README's own words ("one after another", "near one wavelength", "makes movement easier to spot", the four-pixel flag rule, "the part that covers the view", and "switched off on the site").
- (v0.3 update 4) Two more features are built on their own branches, switched off, and are NOT in this page or the README on main: "Save picture" (a PNG of A, B and B − A with credits) and a comet 3I/ATLAS card (twelve frames across the CO₂ band). Each waits for your own line in `DECISIONS.md`. If you log one, tell the build session: it merges the branch, adds the README and SOURCES lines, and adds a line here.
- (v0.3.2) The Summary is 200 words (1,158 characters): at the top of the form's suggested 50 to 200 words and under the 1,500-character cap (Python `split` and `len`, Sun 15 Nov 06:39 NPT; guide added, "each marked with a number" cut).
- (v0.3.2) The AI note block's checker sentence predates the README's new description of `checkNote` (fixed sentence forms). Reword it from the README's Claude API row if you keep the block.
- (v0.3.2) The guide row in "What it does" and the screenshot marker under it describe the live v0.3.2 page. If v0.3.2 is not live at submit, move the guide lines to "In progress".
- The live form still matches research/24 (fields, order, the 1,500-character Summary cap).
- `DECISIONS.md` is empty. The README and this page both point judges to it.
- The SIMBAD and VizieR acknowledgement sentences (research/26 §2.13) name CDS Strasbourg, which this brief said not to mention. The page lists both by name, paper and CfA link only. Add the sentences if you want them.
- The Gaia credit reads "ESA, Gaia DPAC" here, as on the site and in the README (source: ESA's archive terms). Gaia's own credit page (research/26 §2.8) writes "ESA/Gaia/DPAC". Either is used; the draft now matches the site.
- The AI note block describes the checker (fixed sentence forms filled from the fact sheet). The README describes it the same way (Claude API row), and it is in the code (`checkNote` in `src/lib/insight.ts`).
- The brightness curve (RW Aurigae) is public in the code and the README, though it was not on the brief's list of public parts. Delete its line in "What it does" if you prefer.
- The README's 20 to 45 s live-read time is listed under "Not confirmed" in SOURCES, and the page itself says "about 30 s".
- GPT Image: keep its row only if those pictures stay in the final film.
- The "What it does" table paraphrases the challenge page and keeps one short quote (the Barnard's Star row). Check the paraphrases against the live challenge page.
