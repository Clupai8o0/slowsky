# Slowsky 30 s demo film: brief for scene builders

**The film in one line:** an illustrated, animated 29.5 s explainer for Slowsky, a web tool that blinks real
NASA SPHEREx sky images so anyone can watch stars move and change. The owner rejected a slideshow cut: every
shot must MOVE (camera drift, things drawing on, springing in, morphing). No static cards held longer than ~0.5 s.

## Render contract

- Remotion 4, 1920x1080, 24 fps, 708 frames. Each scene draws from the FILM frame `f` (not a local frame); its
  range is in `src/film/timing.ts`. Voice word timings (film frames) are in `src/film/captions.ts`: land motion
  on the spoken words.
- The Shell already draws: background, a drifting starfield (`kit/Sky.tsx` Starfield), the captions (bottom
  ~200 px: keep key art above y 860), and a "STYLE TEST" mark top right. Don't draw your own captions.
- Shared kit (read, don't edit): `src/film/kit/anim.ts` (ramp, inOut, pop spring, lerp, rand, blinkIndex),
  `src/film/kit/Sky.tsx` (Starfield, SkyFrame = real SPHEREx pixels, GaiaRing), `src/brand/tokens.ts` (colours),
  `src/brand/fonts.ts` (DISPLAY/BODY = Geist, MONO = Geist Mono), `src/film/copy.ts` (words).
  Need a kit change? Say so in your report; don't patch shared files.
- Draw with SVG and CSS in React. Deterministic only (use `rand(seed)`, never Math.random). No external
  images except `staticFile('sky/<key>_<i>.png')` via SkyFrame (real research frames, 472-488 px square-ish).
- Each scene fades/morphs in over its first ~6 frames and out over its last ~4, so cuts feel connected.

## Look

- Slowsky's "Depth" UI: deep navy, blue bloom, periwinkle accent `C.acc`, amber Gaia rings `C.amber`,
  Geist light/regular for text, Geist Mono for read-outs. Calm, precise, a little cinematic. Not SaaS, not editorial.
- Illustration style: clean vector line-art with soft glows (stroke 2-3 px, rounded caps), flat fills, gentle
  gradients. Think planetarium explainer. Lines draw on (stroke-dashoffset), things spring in (pop), slow camera
  push (scale 1 -> 1.05 over a scene).
- Real pixels stay crisp (SkyFrame uses pixelated rendering). Never fake data: drawn stars are clearly
  illustration; anything labelled "real" must be SkyFrame.

## Rules

- No NASA, ESA or mission logos or insignia. A generic drawn telescope/spacecraft is fine (SPHEREx looks like a
  stack of three nested cones over a small body; keep it stylised).
- No people's faces (no historic photos, no likenesses). Simple silhouettes, cursors or dots are fine.
- Words on screen: use `COPY` and the captions. Small decorative mono labels (a year "1930", "0.75 µm",
  "5.0 µm", "frame 1 / 2", coordinates) are fine; NO new factual claims. List every new on-screen string in
  your report.
- Edit only your own scene folders (`src/film/sN/`). You may add files there. Never touch git, other scenes,
  kit, Shell, timing or captions.
- K&R braces; always brace control bodies.

## Check your work

- `npm run typecheck` (from `video/slowsky-film`).
- `CONCURRENCY=2 sh scripts/render.sh scene N` renders your scene and a contact sheet; it prints the paths.
  Look at the sheet and a few stills (`sh scripts/render.sh still <frame>` writes `out/Film-<frame>.png`) with
  the Read tool. Fix what looks off: overlap with captions, empty frames, text clipping, jerky motion.
- Iterate at most 3 renders per scene. Report: what each scene shows beat by beat, new on-screen strings,
  any kit request, and the contact sheet path.

---

# Round 2 (Sam's notes on draft v1, 14 Nov) — these override anything above

Sam's verdict on v1: it "just skips through", the drawn elements "feel too much like just Claude elements",
and **NEVER USE PILLS ANYWHERE** (his capitals).

1. **New timing.** The voice was re-cut with ~1 s of silence between lines. `src/film/timing.ts` has new SCENES
   and a bigger `HIT` table; `src/film/captions.ts` has new word frames. **Import `SCENES` and `HIT` from
   `../timing`; never hard-code a film frame** (write `HIT.blinking + 6`, `SCENES.s2.to - 20`).
2. **Breathing room.** Each scene has 2-3 beats at most. One main beat lands on its `HIT` word, then the
   picture settles and holds: in the last ~20 frames of a scene nothing new appears, only the slow camera and
   gentle loops (twinkle, blink). Fewer things on screen, bigger, with more empty space. Calm, deep, storybook.
3. **AI art leads the look.** `src/film/kit/AiArt.tsx` gives `AiBackground` (full-frame painting with a slow
   push/pan) and `AiElement` (a painting on black, screen-blended). Keys and contents are listed in that file;
   see `public/ai/*.png` (read them). Every scene uses at least one painted background. Your own SVG/CSS is now
   the thin layer on top: rings, labels, light trails, the moving dot, counters. Keep drawn shapes few.
4. **No pills.** No capsule shapes at all: corner radius 0-4 px only, no `borderRadius: 999`/`50%` on anything
   wider than tall. Circles (rings, dots, planets) are fine. Search field = a framed rectangle or an underline.
5. **Real data stays real.** SkyFrame pixels are the only "real" imagery; AI paintings are decoration and must
   never be presented as data. Show SkyFrame pixels with no colour tint (WISE 0855 in plain grey).
6. Captions now have no background box (text with a dark halo) and the Shell draws an always-on AI watermark
   top-left: keep the top-left 640x60 and the bottom 200 px free of key art.
7. Words: no new factual claims; list new on-screen strings. Same render loop: typecheck, `scene N` sheet, a
   few stills, max 3 renders per scene.
