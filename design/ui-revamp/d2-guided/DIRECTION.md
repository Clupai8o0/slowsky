# Direction 2: Guided tour (one column, one step at a time)
Core idea: a calm single-column story. The plate stays pinned near the top (sticky, shrinking smoothly from
large to medium as you scroll) and short numbered steps below it each introduce ONE control at the moment it is
needed. An "Explore freely" button reveals the full control dock at any time.
- Top bar: logo + "Slowsky", a target dropdown/menu (square, lists the five with COPY.short and thumbnails,
  plus "Any star, or RA, Dec"), progress dots replaced by a thin "Step 2 of 4" text indicator, theme button.
- Hero: headline (COPY.headline) above the plate; the plate already blinking; "Watch the gold ring" style
  sentence under it built from COPY.show.
- Steps (cards in the column, each with a short title, one sentence from copy.js, and its one live control
  that drives the pinned plate): 1 Watch it move (play/pause + date scrubber with hover-peek), 2 Try another
  colour (wavelength bar with detector bands and the "your eyes" edge; simulated load with STAGE_TEXT stages),
  3 Compare all dates (Blink | Stack | Subtract with MODE_HINT morphing), 4 What this can't tell you (COPY.not,
  plus overlays as square checkboxes), 5 Visit another star (interactive sky map of all five targets: hover =
  hook, click = switch and scroll back to the top smoothly).
- Each step animates in as it enters the viewport (fade + 6 px rise, staggered), and the active step is
  highlighted; the plate reacts (e.g. step 3 switches mode).
- "Explore freely" opens a full-width dock (not a side panel) with every control at once.
- Phone: same column; plate pinned at the top at ~45 % height; steps scroll under it.

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
