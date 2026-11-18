# Slowsky UI revamp: brief for the design debate

## What Slowsky is
A free web app (NASA Space Apps 2026) that lets anyone watch the infrared sky change, using real frames from
NASA's SPHEREx telescope. You pick a target (a star), see small real cutouts of the sky from several visits
months apart, and flip between them ("blink") to see a star move or change brightness. You can change the
infrared colour (wavelength, 0.75 to 5 µm; human eyes stop at about 0.70 µm). Judges and the public use it
for a minute or two, mostly on a laptop, some on a phone.

## The current UI (v0.3, live; screenshots in current/w1440-barnard.png and current/w390-barnard.png)
Dark only, three columns at 1440 px:
- Left: "01 Choose a target" list (Barnard's Star "Moves fastest across our sky", RW Aurigae "Changes its
  brightness", Epsilon Indi B "Dim at some colours", WISE 0855-0714 "The coldest brown dwarf known",
  R Draconis "Centre too bright to measure"), a search box "Any star, or RA, Dec", then "What to look for":
  a title ("Barnard's Star, walking north"), coordinates, two tiny diagrams (sky position, motion arrow
  "10.4″ a year, north"), and several paragraphs incl. "What this can't tell you".
- Centre: "02" the sky image (real pixels, gold rings = Gaia stars, a gold ring where the target should be),
  "Frame 3 of 3 · 24 Aug 2026", checkboxes (Brightest Gaia stars, Flagged pixels, False colour, Older
  picture, Where the star should be on this date), field size picker, prev / pause / next, mode buttons
  Blink / Stack / Subtract, a one-line hint, then a filmstrip of 3 dated thumbnails.
- Right: "Saved copy" status, "Go live" and "Copy link" buttons, "03 Change the colour": big "0.85 µm",
  "Detector 1 of 6", a wavelength slider 0.4 to 5 µm, a note, "Candidate changes" panel, "This frame"
  table (taken, frame, colour, detector, release, field, scale, file, moved, measured, FITS link).
- Phone: the same content stacked in one long column.
Known pain: lots of small monospace labels and checkboxes at once; first-time users don't know where to
look first; the explanation is split across left and right columns; jargon (detector, release, FITS, flagged
pixels, Gaia DR3) is visible before it is useful; dark only.

## The ask (from the owner)
Revamp the whole UI with a SaaS-like approach (think clean product apps: Linear, Vercel, Stripe, Notion,
Plausible), light mode by default with a dark mode, NOT dark-only. **Main goal: easier on the user.**

## Hard constraints
- NEVER pills: no capsule-shaped buttons, badges, tags, search bars, toggles/switches or chips anywhere.
  Corners 0 to 4 px. Use underlines, square segmented controls, framed panels.
- Don't overuse dividers: separate with space and type first; lines only where they do a job.
- The sky image is real data: always real SPHEREx pixels, dark, never recoloured for decoration.
- No NASA/ESA/agency logos. No new factual claims beyond the ones above.
- Must still offer every current feature somewhere (progressive disclosure is fine).
- Works at 1440, 1024, 768, 390 and 320 px. Keyboard and screen-reader friendly.
- Font: Geist + Geist Mono. Logo: a square of 10 blue-to-orange stripes with one white star.

## Added by the owner mid-debate: loading and motion
**Loads must feel a lot smoother and transitioned.** Today frames pop in, panels jump and colour changes
reload with no feedback. Every direction must say how it handles: first load (skeletons shaped like the real
layout, no layout shift, sky fades in), target switch (crossfade, keep layout stable), frame stepping and blink
(crossfade or instant cut, which and why), wavelength change (old frame stays until the new one is ready, then
fades; visible progress), panels opening (height/opacity, 150-250 ms, ease-out), and reduced motion (respect
`prefers-reduced-motion`: no autoplay, no slides, fades only or instant).
