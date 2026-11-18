import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import { C } from "../../brand/tokens";
import { DISPLAY } from "../../brand/fonts";
import { COPY } from "../copy";
import { AiBackground } from "../kit/AiArt";
import { lerp, pop, ramp } from "../kit/anim";
import { HIT, SCENES } from "../timing";
import { CamKey, camAt, camScale, camTransform, Pointer, Stacked, toScreen, uiBlink, uiFrames, uiTargetId } from "../kit/Ui";

// Scene 3. "Slowsky: pick a star, / and watch the sky change." One continuous camera over the real page.
// HIT.name: the wordmark rises over the painted sky, then shrinks into the page's own wordmark as the real page
// (a 2x capture, so the camera never enlarges it past its pixels) resolves around it. HIT.star: the camera
// travels to the target list; a drawn pointer (an overlay) clicks the real Barnard's Star button. HIT.watch:
// the camera pushes in on the real picture, which blinks between its real frames by hard cuts at the product's
// own speed; the rest of the page dims. The last ~20 frames only blink and drift.

const { from: FROM, to: TO } = SCENES.s3;
const ACC = "195,206,255";
const FRAMES = uiFrames("desk2x", "barnard");
const SRCS = FRAMES.map((s) => s.file);
const B = FRAMES[0].boxes;
const PAGE_W = FRAMES[0].viewport.width;
const PAGE_H = FRAMES[0].viewport.height;
const BTN = B.targetButtons?.[uiTargetId("desk2x", "barnard")] ?? B.targets;
const BRAND = B.brand ?? { x: B.targets.x, y: 28, width: 120, height: 22 };

// Camera keys (page CSS px). The capture is 2x, so w >= 960 keeps every screen pixel at or under 1 capture pixel.
const k0 = 0.68; // whole page in a frame, held clear of the AI mark (top) and the captions (bottom)
const k1 = 0.72;
const pageCy = (k: number) => PAGE_H / 2 + (PAGE_H / 2 - 462) / k; // page centre sits at screen y 462
const listW = 960;
const listTop = B.targets.y - 72; // the list's heading stays below the AI mark
const focus = {
  x0: B.picture.x - 14,
  y0: Math.min(B.picture.y, B.frameLabel.y) - 16,
  x1: Math.max(B.transport.x + B.transport.width, B.picture.x + B.picture.width) + 14,
  y1: B.picture.y + B.picture.height + 14,
};
const watchW = Math.max(960, (focus.x1 - focus.x0) + 300);
const watchCx = (focus.x0 + focus.x1) / 2;
// picture top lands ~90 px below the top of the screen
const watchCy = (k: number) => focus.y0 + 16 - 90 / k + 540 / k;

const KEYS: CamKey[] = [
  { at: HIT.name + 14, cx: PAGE_W / 2, cy: pageCy(k0), w: 1920 / k0 },
  { at: HIT.star - 8, cx: PAGE_W / 2, cy: pageCy(k1), w: 1920 / k1 },
  { at: HIT.star + 10, cx: listW / 2, cy: listTop + 270, w: listW },
  { at: HIT.watch - 2, cx: listW / 2 + 8, cy: listTop + 272, w: listW + 24 },
  { at: HIT.watch + 18, cx: watchCx, cy: watchCy(1920 / watchW), w: watchW },
  { at: TO, cx: watchCx - 6, cy: watchCy(1920 / watchW) + 4, w: watchW - 40 },
];

const GLIDE_A = HIT.name + 16;
const GLIDE_B = HIT.star - 8;
const CLICK = HIT.star + 12;
const BLINK = HIT.watch + 6;

export const S3: React.FC<{ f: number }> = ({ f }) => {
  const fade = ramp(f, FROM, FROM + 6); // the cut out is a crossfade (Shell SceneGate)
  const cam = camAt(f, KEYS);
  const k = camScale(cam);

  // Wordmark: letters rise at the centre on HIT.name, then shrink into the page's own wordmark.
  const glide = ramp(f, GLIDE_A, GLIDE_B, Easing.inOut(Easing.cubic));
  const camEnd = camAt(GLIDE_B, KEYS);
  const brandS = toScreen(camEnd, BRAND.x, BRAND.y + BRAND.height / 2);
  const brandScale = (BRAND.height * 0.78 * camScale(camEnd)) / 168; // cap-to-cap, roughly the page's type size
  const markX = lerp(glide, 0, 1, 960, brandS.x);
  const markY = lerp(glide, 0, 1, 462, brandS.y);
  const markS = Math.exp(lerp(glide, 0, 1, 0, Math.log(brandScale)));
  const align = lerp(glide, 0, 1, 50, 0);
  const markO = 1 - ramp(f, GLIDE_B - 8, GLIDE_B);
  const dotP = pop(f, HIT.name, 14, 120);
  const dotGlow = 0.75 + 0.25 * Math.sin(f * 0.18);

  // The page resolves in behind the shrinking wordmark.
  const pageIn = ramp(f, GLIDE_A + 7, GLIDE_B + 2, Easing.inOut(Easing.cubic)); // after the mark has shrunk off the picture
  const bgDim = 0.35 + 0.4 * pageIn;

  // Pointer: arrives on "star", clicks the Barnard's Star button, leaves on "watch".
  const btn = toScreen(cam, BTN.x + BTN.width * 0.72, BTN.y + BTN.height * 0.55); // right of the name, on empty button
  const arrive = ramp(f, HIT.star - 2, CLICK - 1, Easing.out(Easing.cubic));
  const px = btn.x + (1 - arrive) * 520;
  const py = btn.y + (1 - arrive) * 300;
  const pO = ramp(f, HIT.star - 2, HIT.star + 4) * (1 - ramp(f, HIT.watch - 4, HIT.watch + 4));
  const press = ramp(f, CLICK, CLICK + 3) * (1 - ramp(f, CLICK + 4, CLICK + 9));
  const ripple = f >= CLICK ? ramp(f, CLICK, CLICK + 14) : 0;
  const frameO = ramp(f, CLICK, CLICK + 6) * (1 - ramp(f, HIT.watch + 2, HIT.watch + 10));

  // On "watch": the rest of the page dims around the picture and its controls.
  const dim = 0.68 * ramp(f, HIT.watch, HIT.watch + 16, Easing.inOut(Easing.cubic));
  const idx = uiBlink(f, BLINK, FRAMES.length, 0);

  const b0 = toScreen(cam, BTN.x, BTN.y);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AiBackground name="bg_sky" f={f} from={FROM} to={TO} zoom={[1.05, 1.12]} pan={[30, 10, -40, -14]} opacity={0.92} />
      <div style={{ position: "absolute", inset: 0, background: `rgba(4,6,15,${bgDim})` }} />

      {/* the real page, under one continuous camera */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: PAGE_W,
          height: PAGE_H,
          transformOrigin: "0 0",
          transform: camTransform(cam),
          opacity: pageIn,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: C.bg,
            boxShadow: `0 0 0 ${1.5 / k}px rgba(${ACC},.38), 0 ${30 / k}px ${90 / k}px rgba(0,0,0,.6), 0 0 ${160 / k}px rgba(26,47,122,.55)`,
          }}
        />
        <Stacked srcs={SRCS} index={idx} style={{ left: 0, top: 0, width: PAGE_W, height: PAGE_H }} />
        {/* dim outside the area in focus (a frame around the picture and its controls) */}
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
            gap: 36,
            fontFamily: DISPLAY,
            fontWeight: 300,
            fontSize: 168,
            letterSpacing: "-0.03em",
            color: C.ink,
            whiteSpace: "nowrap",
            opacity: markO,
            textShadow: "0 2px 30px rgba(4,6,15,.6)",
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              background: C.acc,
              transform: `scale(${dotP})`,
              boxShadow: `0 0 ${36 * dotGlow}px ${12 * dotGlow}px rgba(${ACC},.55), 0 0 110px 36px ${C.glow}`,
            }}
          />
          <div style={{ display: "flex" }}>
            {COPY.name.split("").map((ch, i) => {
              const p = ramp(f, HIT.name + 2 + i * 2, HIT.name + 14 + i * 2);
              return (
                <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - p) * 28}px)`, opacity: p }}>
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
