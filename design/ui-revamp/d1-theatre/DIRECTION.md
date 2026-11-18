# Direction 1: Theatre (single centred stage + sheets)
Core idea: one centred stage. The sky plate blinks on arrival in the middle of the page; one sentence and the
caveat sit right under it; everything else slides up as a sheet over the page, never beside the sky.
- Top bar: logo + "Slowsky", search ("Any star, or RA, Dec", square field, ⌘K opens it as a centred command
  palette with the five targets and their hooks), Copy link, theme button.
- Target ribbon under the bar: five square-cornered cards (name + COPY.short + a tiny real thumbnail), active one
  underlined in accent; arrow keys move between them.
- Stage: plate as large as fits (max ~620 px), headline above, COPY.show-derived one-liner + COPY.not as a muted
  caveat line under. Gold ring at the centre, draws itself on load; hover loupe; press-and-hold = first visit.
- Dock under the plate, one unified bar: Prev / Play / Next, a date scrubber with the visits as ticks and
  hover-peek thumbnails, Blink | Stack | Subtract, and the wavelength bar (detector bands, "your eyes" edge).
- Sheets (bottom sheet sliding up to ~60 % height, plate stays visible above): "What to look for" (with the
  interactive sky map and the animated motion diagram), "Overlays & field", "This frame" (obsId, date, frames
  in visit, detector, µm range, a FITS link placeholder). Opened from a row of underlined text buttons under the dock.
- Phone: the same column; the dock becomes sticky at the bottom; sheets are full-width.

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
