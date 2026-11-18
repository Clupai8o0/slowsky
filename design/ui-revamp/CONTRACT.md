# Slowsky revamp mockups: build contract (read BRIEF.md first)

Decided after a two-round debate between Codex, Gemini, Grok and Claude Opus, plus the owner's notes.

## Owner's notes (must all show in every mockup)
1. Easier on the user: a first-time visitor sees motion within 2 s and always knows the next thing to try.
2. SaaS-like, light by default, dark mode via a square icon button (`data-theme-toggle`).
3. **No layout with panels down both sides of the sky.** Not three columns, not "big sky + side panel".
4. Loads feel smooth and transitioned. **Every control that loads a frame shows a loading animation** (target,
   frame step, mode, wavelength, field size, overlays that need data, search). The rest of the app transitions
   smoothly too.
5. **The centre moves more**: the sky stage feels alive (see Motion), without ever faking data.
6. **Many elements are interactive**, not just the main controls (see Interactions).

## Files you may use (all in your folder)
- `base.css`: tokens (light/dark), `.btn`, `.seg`, `.check`, `kbd`, `.sky`, skeletons (`.skel`), `.enter`,
  `.swap`, `.reveal`, reduced motion. Use its variables; add your own CSS in `app.css`.
- `base.js`: theme toggle, `icon(name)`, `SkyPlayer(root, targetId, {fade, onChange})` with `.go(i)`,
  `.step(d)`, `.play(on)`, `.setMode('blink'|'stack'|'diff')`, `.setTarget(id)`, `.visit`, `.t`, `.i`.
  It double-buffers frames (old frame stays until the new one decodes) and adds `.loading` to the root while
  waiting. You may extend it in `app.js`.
- `frames.js` (`window.FRAMES`): per target: `name`, `visits[] {file, date, obsId, frames}`, `lam [min,max]` µm,
  `detector`. Images in `img/<target>-<i>.png` are REAL SPHEREx pixels, north up, 6′ across, target centred.
- `copy.js`: the product's own words: `COPY[id].display/short/headline/show/not`, `ORDER`, `MODE_HINT`,
  `STAGE_TEXT` (real loading stages), `DETECTORS` (µm ranges of the six detectors), `FALSE_COLOUR_HINT`.
- `fonts/`, `img/logo.svg` (the new logo).

## Hard rules
- Never pills: no capsule buttons, badges, tags, search bars, chips, switches. Corners 0-4 px. Circles only for
  the gold target ring and small dots.
- Few dividers: separate with space and type; a line only where it does a job.
- Sky pixels are never recoloured, blurred, warped or crossfaded between dates. You may scale/pan the whole
  plate, dim it while loading, and draw overlays on top.
- Words: use `copy.js` text and numbers from `frames.js` only. No new facts, no agency logos. Wavelengths the
  mockup cannot really load are simulated: say "mockup" in a small note in the footer.
- Plain HTML/CSS/JS, no build step, no CDN, no external requests. Open from disk (`file://`) and work.
- Works at 1440, 1024, 768, 390, 320 px wide; no sideways scroll. Keyboard: Space play/pause, ←/→ step,
  B/S/D modes, T theme. Visible focus. 44 px touch targets on phones. `aria-live` for user-requested changes only.

## Motion (all four models agreed; these are the rules)
- One curve `cubic-bezier(.16,1,.3,1)`; 120 ms state, 180-220 ms fades and panels, 250-320 ms target change.
- **Blink and frame stepping hard-cut** (`new SkyPlayer(..., {fade: 0})` while blinking). A crossfade shows the
  star twice and fakes a dip. Hold each frame ~800 ms. The date label, timeline marker and ring move WITH the cut;
  the timeline marker itself may glide (150 ms).
- First load: skeletons shaped like the real layout; plate box reserved (no layout shift); pixels fade in 200 ms.
- Target switch: layout fixed; old plate dims to 60 % under a 2 px progress line; then the new plate crossfades
  in (250 ms) with a slight settle (scale 1.04 → 1); title and sentence swap at the midpoint.
- Wavelength change: readout updates live while dragging; old frame stays with a progress line and the real
  stage words from `STAGE_TEXT`; new frame fades in 200 ms; a newer request cancels older ones.
- "The centre moves more", allowed: the gold ring draws itself (stroke animation) when a target loads; a faint
  dotted trail of earlier ring positions; the plate settles on arrival; a hover loupe; smooth zoom when the
  field size changes; the date scrubber glides; a subtle pulse on the ring while paused. Not allowed: any motion
  that changes pixel values or implies a measurement.
- Panels and sheets: height + opacity, 200 ms open, 150 ms close; focus goes in and returns to the trigger.
- Failure: last good frame stays; "Couldn't load … Retry". No spinner covering the sky.
- `prefers-reduced-motion`: no autoplay (latest frame + square Play), no slides/zooms/shimmer, fades ≤ 100 ms.

## Interactions (include at least six; more is better)
- Drag/scrub the date timeline; hover a date to preview that frame (peek), click to jump.
- Press and hold on the plate to see the first visit; release returns.
- Hover loupe on the plate (2x, square, 4 px corners) showing real pixels under the cursor.
- "Where in the sky" map: an interactive sky strip showing all five targets as dots; hover = name + hook;
  click = switch target. The current one glows.
- Motion diagram that animates in step with the frames (the arrow grows as the date advances).
- Wavelength bar: drag, click a detector band to jump, hover shows the detector's µm range; the visible-light
  edge (0.70 µm, "your eyes") marked.
- Click the coordinates to copy them (inline "Copied" confirmation, no toast pill).
- Overlay toggles that animate their overlay in/out; Blink/Stack/Subtract with the `MODE_HINT` line morphing.
- Theme toggle with a 200 ms colour transition.

## Owner's rules added 15 Nov (hard rules, same weight as the ones above)
- **No pills:** no capsule-shaped buttons, badges or search bars (0-4 px corners only).
- **AI labels:** anything AI-generated stays labelled with the model that made it (the AI note shows
  "Written by AI (<model>)…"; the footer carries `AI_LINE` from `help.js` with its link).
- **Beginner help:** the one-line "What am I looking at?" (`HELP_TITLE` + `HELP_INTRO`) and the plain explanations
  (`CONTROL_HELP[id].line` beside each control, `GLOSSARY[id].short` where a technical word first appears) from
  `help.js` must be in the layout, visible to a first-time visitor without hunting.
- **Honest wording:** results say "candidate", never "discovery" (or "found", "detected", "new object").
