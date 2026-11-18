# Slowsky as a tool: build spec (d4-tool)

Owner's verdict on the last three mockups: "this looks like a wiki page, not a tool". Owner's new ask: "allow uploading
stuff and getting those processed". This mockup answers both. Plain HTML/CSS/JS, opens from `file://`, no network.

## What "tool, not wiki" means here (the design rules)
- **Full-screen app, no page scroll on desktop.** Fixed frame: top bar 48 px, workspace (fills), timeline 136 px,
  status bar 26 px. The sky is the biggest thing on screen. Phones (< 900 px) may scroll; see Phone.
- **No paragraphs in the chrome.** Text lives in tooltips, the status bar, the inspector and the first-run card.
  Labels are 12-13 px, numbers in mono. Dense like Figma, Lightroom or a video editor, not like an article.
- **Direct manipulation.** Scrub the timeline, drag the colour track, drag/zoom the sky, hold to compare, drop files.
- **One floating inspector** (closed by default, `I` toggles). No fixed side columns.
- Square controls, 0-4 px corners, never pills. Circles only for the gold target ring and small dots.
- Light by default, dark via the theme button (`T`). The workspace backdrop stays a neutral tone in both themes.

## Files
| File | Owner | What |
|---|---|---|
| `index.html`, `app.css` | Claude Opus (done) | The shell: every element and id below. Builders may add elements but keep ids and layout. |
| `engine.js` | Codex | Upload processing: FITS/PNG/JPG reading, alignment, stretch, stack, subtract, candidates. No DOM except canvas/ImageData. |
| `engine.test.mjs` | Codex | Node tests for engine.js (synthetic frames + real local SPHEREx cutouts). |
| `app.js` | Gemini | All UI wiring for both workspaces, using base.js `SkyPlayer` for the library and `SlowskyEngine` for uploads. |
| `base.js`, `base.css`, `frames.js`, `copy.js`, `help.js`, `img/`, `fonts/` | shared | Same as before; do not edit `copy.js`/`help.js`/`frames.js`. |

## Two workspaces (top bar segmented control `#ws-sky` / `#ws-mine`)
1. **Sky library**: the five saved targets (`ORDER`, `FRAMES`, `COPY`). Real SPHEREx pixels, already aligned on a
   north-up grid centred on each target's predicted position at 2026.0. Never shift, recolour or crossfade them.
2. **My frames**: the visitor's own files, processed in the browser by `engine.js`. Nothing leaves the device. The
   empty state (`#empty`) offers "Choose files", drag-and-drop anywhere on the workspace, and "Try sample files"
   (feeds the saved Barnard's Star PNGs through the same engine so a visitor without files can see the pipeline).

Both workspaces share the stage, timeline, modes, toolbar, inspector and status bar.

## Engine API (`window.SlowskyEngine`, engine.js, plain script, no modules)
```
SlowskyEngine.readFile(file: File|Blob, opts?) -> Promise<Frame>
SlowskyEngine.process(files: File[], {onJob(jobIndex, stage, info), signal}) -> Promise<Session>
SlowskyEngine.render(session, index, {mode:'blink'|'stack'|'subtract', a, b}) -> ImageData   // display pixels
SlowskyEngine.candidates(session, a, b, {k = 5}) -> Candidate[]
SlowskyEngine.STAGES = ['read', 'header', 'decode', 'size', 'align', 'stretch', 'ready']
```
- `Frame`: `{name, kind:'fits'|'png'|'jpg', width, height, data: Float32Array (linear values, NaN = no data),
  date: Date|null, dateSource:'DATE-OBS'|'MJD-OBS'|'file'|'none', unit: string|null, meta: {detector?, instrument?,
  bunit?, hasWcs, hdu}, warnings: string[]}`.
- FITS: parse blocks of 2880 bytes; walk HDUs; use the first image HDU with NAXIS=2 and data, preferring EXTNAME
  `IMAGE`. Support BITPIX 8/16/32/-32/-64 with BSCALE/BZERO, big-endian. If the file is gzip (`.gz` or magic 1f 8b),
  inflate with `DecompressionStream('gzip')`. Tile-compressed images (ZIMAGE BINTABLE) are not supported: say so in
  a warning and skip that HDU. If an HDU named `ZODI` with the same shape exists, subtract it from IMAGE and add
  the warning "Zodiacal light model removed (from the file's ZODI plane)".
- PNG/JPG: decode via `createImageBitmap` + canvas, luminance = 0.2126R + 0.7152G + 0.0722B; warning "Display
  image: brightness is already stretched, so changes are rough".
- Dates: FITS `DATE-OBS` (ISO), else `MJD-OBS`/`MJD-AVG`, else `file.lastModified` (dateSource 'file'), else none.
- `Session`: `{frames: Frame[] (sorted by date, undated last), ref: index of the reference frame (the first), width,
  height, shifts: [{dx, dy, ok, method}], stretch: {lo, hi}, notes: string[]}`.
- **Size**: frames of different sizes are centre-cropped to the smallest common size (note it).
- **Align**: translation only. Find up to 40 brightest local maxima (after median background removal) per frame,
  vote on pairwise offsets against the reference (integer histogram, then refine by centroid mean), accept if at
  least 3 stars agree within 1.5 px. Apply the shift with bilinear sampling; pixels shifted in from outside are NaN.
  If alignment fails, keep the frame unshifted and note "Couldn't line up <name>; shown as is". If FITS frames
  carry WCS (CRVAL/CRPIX/CD or CDELT), the star method still decides, but record `method:'stars'` either way.
- **Background**: per frame subtract the median (NaN-safe) before stretch and maths, so a brighter sky on one date
  does not look like everything brightened.
- **Stretch**: ONE shared stretch for all frames: lo/hi = 1st and 99.7th percentiles of the reference frame, asinh
  with softening 10. Never auto-stretch each frame on its own: that fakes flicker.
- **Stack** = NaN-aware mean of all frames, same stretch. **Subtract** = frame b − frame a on the linear data; show
  orange (243,152,58) where b is brighter, blue (92,150,240) where a is brighter, scaled by the robust sigma (MAD)
  of the difference, near-black for no change.
- **Candidates**: on b − a, robust sigma via MAD; connected pixels above k·sigma (default 5) form a blob; return
  `{x, y, peak, sigma, sign:'brighter'|'fainter', pixels}` sorted by |peak/sigma|, at most 20. Skip blobs that touch
  NaN edges. These are only candidates: the UI must say so (CONTROL_HELP.changes).
- `onJob(i, stage, info)` fires for each file and stage so the UI can show the per-file pipeline. Respect
  `signal.aborted` between stages.
- Numbers the UI shows come from the engine (shift px, sigma, sizes), never made up.

## Shell ids (index.html) the app wires up
Top bar: `#ws-sky`, `#ws-mine` (workspace segmented), `#target-btn` (opens `#picker`, a command palette with
`#picker-input` and `#picker-list`; also ⌘K and `/`), `#mode` (segmented: `[data-mode=blink|stack|subtract]`),
`#upload-btn`, `#file-input` (hidden, multiple, accept .fits,.fit,.fts,.gz,.png,.jpg,.jpeg), `#help-btn`,
`#share-btn`, theme `[data-theme-toggle]`.
Workspace `#work`: stage `#stage` > `#sky` (SkyPlayer root, square, fit to the workspace) > `#overlay` (SVG for
ring `#ring`, trail `#trail`, candidate markers `#cands`), `#loupe`. HUD: `#hud-id` (`#hud-name`, `#hud-date`,
`#hud-visit`, `#hud-src`), `#tools` (floating toolbar: `[data-tool=loupe|ring|trail|hold|zoom|fit|inspect|find]`),
`#hud-scale` (`#scale-bar`, `#scale-label`, `#hud-lam`), `#minimap` (5 dots, `[data-target]`), `#caveat`
(`#caveat-text`), `#coach` (first-run card: `#coach-title`, `#coach-intro`, `#coach-tour`, `#coach-close`),
`#empty` (My frames empty state: `#empty-choose`, `#empty-sample`), `#drop` (drag overlay), `#jobs` (processing
queue card: `#jobs-list`, `#jobs-cancel`), `#inspector` (tabs `[data-tab=info|frame|cands|ai]`, panels
`#tab-info`, `#tab-frame`, `#tab-cands`, `#tab-ai`, `#inspector-close`), `#toast` (square, inline status).
Timeline `#timeline`: `#prev`, `#play`, `#next`, `#speed` (`[data-speed=0.5|1|2]`), `#ab` (A/B pair readout for
Subtract), track `#track-dates` (`#dates-axis`, `#dates-thumbs`, `#playhead`, `#peek`), track `#track-colour`
(`#colour-bands`, `#colour-eyes`, `#colour-thumb`, `#colour-readout`).
Status bar `#status`: `#status-help` (help line), `#status-load` (`#status-stage`, `#status-bar`), `#status-coord`,
`#status-ai` (opens `#about` popover with AI_LINE + link to AI_LINK), `#status-mock`.

## Behaviour (app.js)
- **First load**: library, Barnard's Star, blinking at once (hard cut, ~800 ms per frame), unless reduced motion
  (then the latest frame and a Play button). The coach card shows `HELP_TITLE` + `HELP_INTRO` on first visit
  (localStorage), with "Show me around" (3 coach marks: timeline, modes, upload) and "Got it".
- **Help everywhere without paragraphs**: every control has a tooltip (name, shortcut, its `CONTROL_HELP` line). The
  status bar's left side always shows the help line of the hovered/focused control, else the active mode's
  `CONTROL_HELP` line. Glossary terms in that line (frame, pixel, µm, infrared, candidate, noise...) are dotted
  buttons opening a square popover with `GLOSSARY[id].short`. `?` / `#help-btn` toggles labels under every toolbar
  icon.
- **Target switch** (picker, minimap, ⌘K): old plate dims to 60 % under the status progress line, new plate
  crossfades in 250 ms with scale 1.04 → 1; ring draws itself. `#caveat-text` = `COPY[id].not`.
- **Blink/stepping**: hard cut always. Date, visit counter, playhead and ring move WITH the committed pixels.
- **Dates track**: visits placed by real date along the axis (gaps show); thumbnails; hover = peek (`#peek` shows
  that frame small with date); click = jump; drag playhead = scrub. In Subtract, click sets A then B (markers).
- **Colour track**: 0.40-5.00 µm, six detector bands from `DETECTORS`, `#colour-eyes` at ≤ 0.70 µm labelled "your
  eyes". Drag = live readout; the saved band is real, other bands keep the frame and show the `STAGE_TEXT` stages
  in the status bar, then "Mockup: the live app loads this colour" (no fake pixels).
- **Sky**: wheel/pinch zoom (1x-2x, never past the PNG's pixels), drag to pan, double-click = fit. Loupe (`L`):
  square 2x. Hold (`H` or press-and-hold): show the first visit, release returns. Cursor RA/Dec (approximate, from
  the 6′ north-up plate centred on the 2026.0 position) in `#status-coord`, click to copy.
- **My frames**: Upload button, drop anywhere, or sample. `#jobs` lists each file with its stage chips (square) and
  a 2 px progress line; errors stay listed with the reason and Retry. When done, the session behaves like a target:
  same timeline (dates from the files; undated files get "no date"), modes, loupe, hold. Subtract enables `find`:
  candidates drawn as numbered square markers and listed in `#tab-cands` as "Candidate n · brighter later · 6.2σ"
  with the `CONTROL_HELP.changes` line on top. Engine notes and warnings go to `#tab-frame`.
- **Inspector**: Info (COPY headline/show/not, coordinates click-to-copy, proper motion numbers from frames.js),
  Frame (date, obsId or file name, size, detector or file kind, shift applied, warnings), Candidates, AI note
  ("Written by AI (model name goes here). Mockup placeholder..." under `CONTROL_HELP.aiNote.line`).
- Keyboard: Space play, ←/→ step, B/S/D modes, L loupe, H hold, I inspector, U upload, T theme, ⌘K or / picker,
  Esc closes. Shortcuts never fire while typing in an input.
- Reduced motion: no autoplay, no zoom/slide/shimmer, fades ≤ 100 ms, frame steps always hard cut.

## Phone (< 900 px)
Top bar: logo, target button, upload icon, `⋯` menu (workspace, help, share, theme). Workspace becomes a square sky
at full width; HUD shrinks to name+date and scale; toolbar becomes a horizontal strip under the sky; mode segmented
moves above the timeline; timeline tracks stack; status bar becomes a help line under the timeline; inspector and
jobs become bottom sheets. 44 px touch targets. No sideways scroll at 390 and 320.

## Words and honesty
Words from `copy.js` and `help.js` only, plus short UI labels (button names, "Choose files", "Try sample files",
"Files stay in this browser", "no date", stage names). Results say "candidate", never "discovery", "found",
"detected" or "new object". The footer/status shows "Mockup" and `AI_LINE` via `#status-ai`.
