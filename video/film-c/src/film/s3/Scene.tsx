import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../brand/tokens";
import { DISPLAY } from "../../brand/fonts";
import { COPY } from "../copy";
import { AiBackground } from "../kit/AiArt";
import { lerp, ramp } from "../kit/anim";
import { CaptionShade, CarryFrame, Finish, IO, Rect, T, Ticks, arrive, glide, scaleRect } from "../kit/look";
import { HIT, SCENES } from "../timing";
import { PLATE_END } from "../s2/Scene";
import { Cam, CamKey, camAt, camScale, camTransform, Pointer, Stacked, UI_HOLD, toScreen, uiBlink, uiFrames, uiPlaying, uiTargetId } from "../kit/Ui";

// Scene 3. "Slowsky: pick a star, / and watch the sky change." One continuous camera over the real page.
// Match cut: scene 2's plate becomes an empty dark panel at the same place, which opens out to the shape of the
// page while the wordmark rises on it (HIT.name). The wordmark shrinks into the page's own wordmark as the real
// page (a 2x capture) resolves on the panel; the whole page holds for a beat, so it reads as a real web tool.
// HIT.star: the camera travels to the target list; a drawn pointer (an overlay) clicks the real Barnard's Star
// button. HIT.watch: the camera settles on the picture and its controls, framed so that its edges fall in the
// page's own gaps (no text is cut). From there the shots are the page PLAYING (its control shows Pause), hard
// cuts at the player's own speed. The last ~20 frames only blink and drift; the page then leaves as one
// object (opacity and a pull-back) while the sky lifts, before the crossfade into scene 4.
// Every camera number comes from the boxes in public/ui/manifest.json (capture_ui.py), so a re-capture after a
// layout change needs no code change.

const { from: FROM, to: TO } = SCENES.s3;
const ACC = "195,206,255";
const PAUSED = uiFrames("desk2x", "barnard");
const PLAY = uiPlaying("desk2x", "barnard");
const B = PAUSED[0].boxes;
const PAGE_W = PAUSED[0].viewport.width;
const PAGE_H = PAUSED[0].viewport.height;
const BTN = B.targetButtons?.[uiTargetId("desk2x", "barnard")] ?? B.targets;
const BRAND = B.brand ?? { x: B.targets.x, y: 28, width: 120, height: 22 };

// --- Camera keys (page CSS px; the capture is 2x, so any scale up to 2 stays at or under its own pixels) ---
// Whole page at k screen px per page px, its top edge at screen y WHOLE_TOP (just under the AI mark). At 0.88 the
// page fills 88% of the frame width, so it reads as a real web tool; the caption band gets a soft backing.
const WHOLE_TOP = 66;
const camWhole = (k: number): Cam => ({ cx: PAGE_W / 2, cy: (540 - WHOLE_TOP) / k, w: 1920 / k });
const K_OPEN = 0.86;
const K_WHOLE = 0.88;
// The target list: the page's top-left corner sits just inside the screen (so the wordmark block is whole, below
// the AI mark), and the list's last row ends above the captions (screen y 850).
const LIST_BOTTOM = B.targets.y + B.targets.height;
const kList = Math.min(2, (850 - 72) / (LIST_BOTTOM - BRAND.y));
const listT = BRAND.y - 72 / kList; // page y at the top of the screen
const listL = B.targets.x - 72 / kList; // page x at the left of the screen
const CAM_LIST: Cam = { cx: listL + 960 / kList, cy: listT + 540 / kList, w: 1920 / kList };
// The picture and its controls: the left edge in the gap between the list column and the picture, the right edge
// just past the transport column (before the right-hand panel), the frame label below the AI mark.
const PLAYING = PLAY.playing; // without a playing set, keep the transport out of view (its control would say Play)
// r6 (v0.3.2): the page added a 3-line Gaia note under the legend (page y ~650-700). The r3-r5 frame (picture.x - 14
// to transport + 16) ended at page y ~680 and sliced it, and the gaps either side of that frame are too narrow to
// widen it. So the frame now spans the page's two column-collapse buttons, whole: its edges sit in the gaps between
// the left column's content (ends at targets right, 348) and the left collapse button (368), and between the right
// collapse button (ends ~1541) and the right column (status.x, 1562). Taller by 16:9, it ends ~30 page px below the
// note. The collapse buttons sit outside the focus box, so they dim with the rest of the page on "watch".
const watchL = B.targets.x + B.targets.width + 10;
const watchR = PLAYING ? B.status.x - 11 : B.picture.x + B.picture.width + 24;
// page px the camera narrows by while it rests on the picture (r3: 36, clipped FOCUS; r4/r5: 16; r6: 8, so the edges
// move 4 px each and stay inside those ~20 px gaps)
const WATCH_PUSH = 8;
const kWatch = Math.min(2, 1920 / (watchR - watchL));
const watchT = B.frameLabel.y - 80 / kWatch;
const CAM_WATCH: Cam = { cx: (watchL + watchR) / 2, cy: watchT + 540 / kWatch, w: 1920 / kWatch };
// the area in focus at the end (the rest of the page dims)
const focus = {
  x0: B.picture.x - 14,
  y0: B.frameLabel.y - 16,
  x1: (PLAYING ? B.transport.x + B.transport.width : B.picture.x + B.picture.width) + 14,
  y1: B.picture.y + B.picture.height + 14,
};

// the list beat's focus: the wordmark block and the target list (the left column)
const LIST_FOCUS = {
  x0: Math.min(BRAND.x, B.targets.x) - 14,
  y0: BRAND.y - 14,
  x1: Math.max(BRAND.x + BRAND.width, B.targets.x + B.targets.width) + 14,
  y1: LIST_BOTTOM + 14,
};

const CLICK = HIT.star + 11;
const BLINK = HIT.watch + 4;
const KEYS: CamKey[] = [
  { at: HIT.name, ...camWhole(K_OPEN) },
  { at: HIT.star - 2, ...camWhole(K_WHOLE) }, // the page's beat: a slow push only
  { at: CLICK + 1, ...CAM_LIST },
  { at: HIT.watch - 2, ...CAM_LIST, cx: CAM_LIST.cx + 6, w: CAM_LIST.w - 12 },
  { at: HIT.watch + 20, ...CAM_WATCH },
  { at: TO + 10, ...CAM_WATCH, w: CAM_WATCH.w - WATCH_PUSH },
];

// --- The exit: the page leaves as one object over 6 frames, ending on the cut ---
const EXIT_A = TO - 6;
const exitScale = (f: number) => 1 - 0.08 * ramp(f, EXIT_A, TO, IO);
// The picture's rect on screen (camera and exit scale applied); its outline is what crosses into scene 4.
const pictureRect = (f: number): Rect => {
  const c = camAt(f, KEYS);
  const a = toScreen(c, B.picture.x, B.picture.y);
  const r = { x: a.x, y: a.y, w: B.picture.width * camScale(c), h: B.picture.height * camScale(c) };
  return scaleRect(r, exitScale(f), 960, 1080 * 0.46);
};
export const s3ExitRect = (): Rect => pictureRect(TO);

// --- The match cut: the plate's square opens out to the page's rectangle at the whole-page camera ---
const OPEN_A = FROM + 2;
const OPEN_B = HIT.name + 6; // r3: the panel opens in 12 frames, so the real page arrives under the wordmark by ~144
const PAGE_RECT = (() => {
  const c = camWhole(K_OPEN);
  const a = toScreen(c, 0, 0);
  const b = toScreen(c, PAGE_W, PAGE_H);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
})();
const PLATE_RECT = { x: PLATE_END.cx - PLATE_END.size / 2, y: PLATE_END.cy - PLATE_END.size / 2, w: PLATE_END.size, h: PLATE_END.size };

// --- Wordmark ---
const GLIDE_A = HIT.name + 16;
const GLIDE_B = HIT.name + 30;
const MARK_Y = WHOLE_TOP + (PAGE_H * K_OPEN) / 2; // the centre of the opened panel

export const S3: React.FC<{ f: number }> = ({ f }) => {
  const fade = arrive(f, FROM, FROM + 6); // the cut out is a crossfade (Shell SceneGate)
  const cam = camAt(f, KEYS);
  const k = camScale(cam);

  // The panel: from the plate's square to the page's rectangle (screen space) by OPEN_B, then it rides the camera.
  const open = glide(f, OPEN_A, OPEN_B);
  const pr = {
    x: lerp(open, 0, 1, PLATE_RECT.x, PAGE_RECT.x),
    y: lerp(open, 0, 1, PLATE_RECT.y, PAGE_RECT.y),
    w: lerp(open, 0, 1, PLATE_RECT.w, PAGE_RECT.w),
    h: lerp(open, 0, 1, PLATE_RECT.h, PAGE_RECT.h),
  };
  const opened = f >= OPEN_B;

  // The capture resolves on the opaque panel (never over the painting) while the wordmark shrinks into its own.
  // r3: it resolves right after the panel opens (HIT.name + 6..12), under the still-centred wordmark, so the real
  // page is seen from ~144 instead of an empty panel; a soft dark pool behind the word keeps the word readable.
  // r4: the page resolves while the panel opens: the opening plate is a window onto the real page at its final
  // place (a crop of the capture, clipped to the panel), so plate -> page reads as one move and the panel is never
  // empty. Fully in as the panel lands (OPEN_B).
  const pageIn = ramp(f, OPEN_A + 1, OPEN_B, IO);
  const clip = opened ? undefined : `inset(${pr.y}px ${1920 - pr.x - pr.w}px ${1080 - pr.y - pr.h}px ${pr.x}px round 3px)`;
  const pool = pageIn * (1 - ramp(f, GLIDE_A, GLIDE_A + 8, IO));

  // Exit before the crossfade into scene 4: the page leaves as a whole object.
  // Short, so the empty panel and the bare sky are not held: a pull-back, and the sky lifts as the page leaves.
  // The page fills the screen at the end, so an emptied panel would read as a flat navy frame: the capture and its
  // panel leave together as one object (opacity and scale), done before the crossfade.
  // The picture's frame stays as a thin outline and carries across the cut into scene 4 (s3ExitRect).
  const capOut = 1;
  const panelOut = 1 - ramp(f, EXIT_A, TO, IO);
  const exitK = exitScale(f);
  const skyLift = ramp(f, EXIT_A, TO + 2, IO);
  const carryO = f < TO ? ramp(f, EXIT_A - 1, EXIT_A + 2) : 0;

  // Wordmark: dot and letters rise at the centre on HIT.name, then it shrinks into the page's own wordmark.
  const g = glide(f, GLIDE_A, GLIDE_B);
  const camEnd = camAt(GLIDE_B, KEYS);
  const brandS = toScreen(camEnd, BRAND.x, BRAND.y + BRAND.height / 2);
  const brandScale = (BRAND.height * 0.78 * camScale(camEnd)) / T.display;
  const markX = lerp(g, 0, 1, 960, brandS.x);
  const markY = lerp(g, 0, 1, MARK_Y, brandS.y);
  const markS = Math.exp(lerp(g, 0, 1, 0, Math.log(brandScale)));
  const align = lerp(g, 0, 1, 50, 0);
  const markO = 1 - ramp(f, GLIDE_B - 8, GLIDE_B);
  const dotIn = arrive(f, HIT.name - 2, HIT.name + 10);
  const dotGlow = 0.8 + 0.2 * Math.sin(f * 0.16);

  // Pointer: arrives on "star" while the camera travels, clicks the Barnard's Star button, leaves on "watch".
  const btn = toScreen(cam, BTN.x + BTN.width * 0.72, BTN.y + BTN.height * 0.55); // right of the name, on the button
  const come = arrive(f, HIT.star, CLICK - 1);
  const px = btn.x + (1 - come) * 420;
  const py = btn.y + (1 - come) * 240;
  const pO = ramp(f, HIT.star, HIT.star + 5) * (1 - ramp(f, HIT.watch - 4, HIT.watch + 4));
  const press = ramp(f, CLICK, CLICK + 3) * (1 - ramp(f, CLICK + 4, CLICK + 9));
  const ripple = f >= CLICK ? arrive(f, CLICK, CLICK + 14) : 0;
  const frameO = arrive(f, CLICK, CLICK + 6) * (1 - ramp(f, HIT.watch + 2, HIT.watch + 10));

  // On "watch": the rest of the page dims around the picture and its controls; the page plays.
  const dim = 0.55 * ramp(f, HIT.watch, HIT.watch + 16, IO);
  // While the list is in view, the rest of the page (the picture, under the captions) dims around it.
  const listDim = 0.62 * ramp(f, CLICK - 6, CLICK + 4, IO) * (1 - ramp(f, HIT.watch - 4, HIT.watch + 6, IO));
  const shade = ramp(f, OPEN_B - 6, OPEN_B + 4) * (1 - ramp(f, HIT.watch + 2, HIT.watch + 14, IO));
  // r4: the page is PLAYING from the moment it appears (the real playing capture, same 2x framing, Pause shown),
  // so the whole page and the list are alive. One blink phase for the scene, chosen so a hard cut still lands on
  // BLINK showing the first frame (as in r3); the page's own pace (UI_HOLD) throughout.
  const n = PLAY.frames.length;
  const phase = BLINK - Math.ceil((BLINK - OPEN_A) / UI_HOLD) * UI_HOLD;
  const shots = PLAYING ? PLAY.frames : PAUSED;
  const idx = PLAYING ? uiBlink(f, phase, n, (n - (Math.round((BLINK - phase) / UI_HOLD) % n)) % n) : f >= BLINK ? uiBlink(f, BLINK, n, 0) : 0;

  const b0 = toScreen(cam, BTN.x, BTN.y);
  const glow = (s: number) => `0 0 0 ${1.5 * s}px rgba(${ACC},.38), 0 ${30 * s}px ${90 * s}px rgba(0,0,0,.6), 0 0 ${160 * s}px rgba(26,47,122,.55)`;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AiBackground name="bg_sky" f={f} from={FROM} to={TO} zoom={[1.06, 1.14]} pan={[30, 10, -50, -16]} opacity={0.9} />
      <div style={{ position: "absolute", inset: 0, background: `rgba(4,6,15,${(0.3 + 0.35 * open) * (1 - 0.6 * skyLift)})` }} />
      <Finish f={f} />

      <div style={{ position: "absolute", inset: 0, opacity: panelOut, transform: `scale(${exitK})`, transformOrigin: "50% 46%" }}>
        {/* the panel, opening from the plate (screen space until it has the page's shape) */}
        {!opened ? (
          <div style={{ position: "absolute", left: pr.x, top: pr.y, width: pr.w, height: pr.h, borderRadius: 3, background: C.bg, boxShadow: glow(1) }} />
        ) : null}

        {/* the real page, under one continuous camera (clipped to the opening panel until it has the page's shape) */}
        {opened || pageIn > 0 ? (
          <div style={{ position: "absolute", inset: 0, clipPath: clip }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: PAGE_W,
              height: PAGE_H,
              transformOrigin: "0 0",
              transform: camTransform(cam),
            }}
          >
            <div style={{ position: "absolute", inset: 0, borderRadius: 3 / k, background: C.bg, boxShadow: glow(1 / k) }} />
            {pageIn * capOut > 0 ? (
              <div style={{ position: "absolute", inset: 0, opacity: pageIn * capOut }}>
                <Stacked srcs={shots.map((s) => s.file)} index={idx} style={{ left: 0, top: 0, width: PAGE_W, height: PAGE_H }} />
              </div>
            ) : null}
            {listDim > 0 ? (
              <div
                style={{
                  position: "absolute",
                  left: LIST_FOCUS.x0,
                  top: LIST_FOCUS.y0,
                  width: LIST_FOCUS.x1 - LIST_FOCUS.x0,
                  height: LIST_FOCUS.y1 - LIST_FOCUS.y0,
                  boxShadow: `0 0 0 4000px rgba(4,6,15,${listDim})`,
                }}
              />
            ) : null}
            {/* dim outside the area in focus (the picture and its controls) */}
            {dim > 0 ? (
              <div
                style={{
                  position: "absolute",
                  left: focus.x0,
                  top: focus.y0,
                  width: focus.x1 - focus.x0,
                  height: focus.y1 - focus.y0,
                  boxShadow: `0 0 0 4000px rgba(4,6,15,${dim})`,
                }}
              />
            ) : null}
          </div>
          </div>
        ) : null}

        {/* the plate's corner ticks, fading as it opens (over the page showing through it) */}
        {!opened ? (
          <div style={{ position: "absolute", left: pr.x, top: pr.y, width: pr.w, height: pr.h, opacity: 1 - open }}>
            <Ticks size={pr.w} h={pr.h} o={1} />
          </div>
        ) : null}
      </div>

      {/* a soft dark pool behind the centred wordmark (dims the page under it only while the word sits there) */}
      {pool > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 960 - 760,
            top: MARK_Y - 260,
            width: 1520,
            height: 520,
            background: "radial-gradient(closest-side, rgba(4,6,15,.82), rgba(4,6,15,.5) 55%, rgba(4,6,15,0))",
            opacity: pool,
          }}
        />
      ) : null}

      {/* the caption band's soft backing while the whole page and the list are in view */}
      <CaptionShade o={shade} />

      {/* the picture's frame, left behind by the leaving page and carried into scene 4 */}
      <CarryFrame r={pictureRect(f)} o={carryO} kind="line" />

      {/* drawn focus frame and pointer: overlays, drawn in screen space */}
      {frameO > 0 ? (
        <div
          style={{
            position: "absolute",
            left: b0.x - 6,
            top: b0.y - 4,
            width: BTN.width * k + 12,
            height: BTN.height * k + 8,
            borderRadius: 3,
            boxShadow: `inset 0 0 0 2px rgba(${ACC},.85), 0 0 24px rgba(91,108,255,.45)`,
            opacity: frameO,
          }}
        />
      ) : null}
      {ripple > 0 && ripple < 1 ? (
        <div
          style={{
            position: "absolute",
            left: px - 10 - 26 * ripple,
            top: py - 10 - 26 * ripple,
            width: 20 + 52 * ripple,
            height: 20 + 52 * ripple,
            borderRadius: "50%",
            border: `2px solid rgba(${ACC},${0.8 * (1 - ripple)})`,
          }}
        />
      ) : null}
      {pO > 0 ? <Pointer x={px} y={py} o={pO} press={press} /> : null}

      {/* the film's wordmark, shrinking into the page's own */}
      {markO > 0 ? (
        <div
          style={{
            position: "absolute",
            left: markX,
            top: markY,
            transform: `translate(-${align}%, -50%) scale(${markS})`,
            transformOrigin: `${align}% 50%`,
            display: "flex",
            alignItems: "center",
            gap: 28,
            fontFamily: DISPLAY,
            fontWeight: 300,
            fontSize: T.display,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: C.ink,
            whiteSpace: "nowrap",
            opacity: markO,
            textShadow: "0 2px 30px rgba(4,6,15,.6)",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              background: C.acc,
              opacity: dotIn,
              transform: `scale(${0.6 + 0.4 * dotIn})`,
              boxShadow: `0 0 ${30 * dotGlow}px ${10 * dotGlow}px rgba(${ACC},.5), 0 0 90px 30px ${C.glow}`,
            }}
          />
          <div style={{ display: "flex" }}>
            {COPY.name.split("").map((ch, i) => {
              const p = arrive(f, HIT.name - 2 + i * 1.5, HIT.name + 8 + i * 1.5);
              return (
                <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - p) * 30}px)`, opacity: p }}>
                  {ch}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
