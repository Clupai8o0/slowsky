# Direction 3: Contact sheet (time laid out as space)
Core idea: show every visit side by side at the same scale, like a photographer's contact sheet, so the change
is visible before anyone presses Play; then one large comparison stage below lets you blink any two dates.
- Top bar: logo + "Slowsky", target selector as an underlined tab row of the five targets (COPY.display) with
  COPY.short as the line under the active tab, search field (square), theme button.
- Contact strip: all visits of the target in one row (real frames, equal size, dated captions with frames-in-
  visit count), a gold ring at the same sky position in each, so the star visibly sits at different places
  relative to the ring. Wraps to 2-3 per row on smaller screens; horizontal scroll with snap on phones only.
- Click any two frames to pick a pair (A = first click, B = second; clear square markers "A" and "B"); the
  stage below blinks A against B (hard cut, 800 ms). Default pair: first vs last visit, already blinking.
- Stage: big plate with the pair blinking, a large A/B date readout that flips with the cut, Blink | Stack |
  Subtract (Stack and Subtract use all visits; MODE_HINT under), loupe, press-and-hold for A.
- Under the stage, three compact cards in a row (stack on phone): "What to look for" (COPY.show + animated
  motion diagram), "Where in the sky" (interactive map of all five targets), "Colour" (wavelength bar with
  detector bands; current target's band highlighted from frames.js lam; other bands show a simulated load
  with STAGE_TEXT, labelled mockup). COPY.not sits as a caveat line directly under the stage.
- Loading: each contact frame has its own skeleton and fades in staggered left to right.

## Your job
Build this direction as a working, polished, interactive HTML mockup in THIS folder:
`index.html` + `app.css` + `app.js` (load order: base.css, app.css; frames.js, copy.js, base.js, app.js).
Read BRIEF.md and CONTRACT.md first; CONTRACT.md rules are hard rules (no pills, no side panels, motion rules,
blink hard-cuts, only copy.js words and frames.js numbers, no external requests, works from file://).
Do not edit base.css, base.js, frames.js, copy.js or img/; extend in app.css / app.js.
All five targets must work (switching, blinking, modes, overlays). Light by default; dark must look as good.
Quality bar: Linear / Vercel / Stripe level polish: calm, spacious, crisp type (Geist), real hierarchy.
Code style: K&R braces (function definitions put the brace on its own line; always brace if/else bodies).
When done, reply with a short list: what you built, which interactions exist, anything you could not do.
