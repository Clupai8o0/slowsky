import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../brand/tokens";
import { BODY, DISPLAY, MONO } from "../../brand/fonts";
import { COPY } from "../copy";
import { AiBackground } from "../kit/AiArt";
import { lerp, ramp } from "../kit/anim";
import {
  HALO,
  Finish,
  LandingRing,
  M,
  T,
  TOP,
  Ticks,
  arrive,
  glide,
} from "../kit/look";
import { SKY_FRAMES, SkyFrame } from "../kit/Sky";
import { HIT, SCENES } from "../timing";
import { PLATE_END } from "../s2/Scene";

// Scene 3, the product: "Slowsky: pick a star, / and watch the sky change."
// Match cut: the 1930 plate of scene 2 becomes the product's sky frame at the same place, which glides right
// while the wordmark rises at the left (HIT.name). The name is typed, a result row appears and a cursor picks it
// (HIT.star): the frame fills with real SPHEREx pixels and an amber ring closes on the star. HIT.watch: the frame
// blinks with hard cuts, as the product does. The last ~20 frames only blink and drift.

const { from: FROM, to: TO } = SCENES.s3;
const ACC = "195,206,255";
const HOLD = 8;

// The sky frame: starts where scene 2's plate sits at its last frame, ends in the right column.
const PANEL = 600;
const START = PLATE_END;
const END = { cx: 1920 - M - PANEL / 2, cy: TOP + PANEL / 2, size: PANEL };
// On "watch" the camera leans in on the frame: it grows to BIG px (bottom kept above the captions).
const BIG = { cx: 1920 - M - 390, cy: 462, size: 780 };
const RING = { x: 0.499, y: 0.507, r: 0.019 }; // the product's Gaia ring in the capture

// Left column
const MARK_TOP = 236;
const FIELD_Y = 520; // underline
const FIELD_W = 680;
const ROW_Y = FIELD_Y + 22;
const ROW_H = 68;

const Magnifier: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <circle
      cx={10.5}
      cy={10.5}
      r={6.5}
      fill="none"
      stroke={color}
      strokeWidth={1.8}
    />
    <line
      x1={15.5}
      y1={15.5}
      x2={21}
      y2={21}
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
    />
  </svg>
);

const Cursor: React.FC<{ press: number }> = ({ press }) => (
  <svg
    width={34}
    height={44}
    viewBox="0 0 34 44"
    style={{
      overflow: "visible",
      transform: `scale(${1 - 0.12 * press})`,
      transformOrigin: "4px 4px",
    }}
  >
    <path
      d="M4 4 L4 36 L12.5 28 L18 40 L23 37.5 L17.5 26 L29 26 Z"
      fill={C.ink}
      stroke={C.bg}
      strokeWidth={2.4}
      strokeLinejoin="round"
    />
  </svg>
);

export const S3: React.FC<{ f: number }> = ({ f }) => {
  const fade = arrive(f, FROM, FROM + 8); // the cut out is a crossfade (Shell SceneGate)
  const cam = lerp(f, FROM, TO + 10, 1, 1.035);

  // the frame: from the plate's place to the right column
  const g = glide(f, FROM + 2, HIT.name + 22);
  const grow = glide(f, HIT.watch - 2, HIT.watch + 20);
  const cx = START.cx + (END.cx - START.cx) * g + (BIG.cx - END.cx) * grow;
  const cy = START.cy + (END.cy - START.cy) * g + (BIG.cy - END.cy) * grow;
  const size =
    START.size + (END.size - START.size) * g + (BIG.size - END.size) * grow;
  // the left column drifts left and dims while the frame grows: the blink is the subject
  const side = `translateX(${-48 * grow}px)`;
  const sideO = 1 - 0.4 * grow;

  // Exit before the crossfade into scene 4 (Shell, from TO): the real pixels fade into the frame's own opaque
  // panel, then the panel goes as a whole object (scale and opacity); only the corner ticks carry across the cut.
  // So real pixels are never seen half-blended with a painting.
  const pixOut = 1 - ramp(f, TO - 8, TO - 5);
  const panelOut = 1 - ramp(f, TO - 5, TO - 1);
  const exitK = 1 - 0.06 * ramp(f, TO - 8, TO - 1);

  // wordmark
  const dotIn = arrive(f, HIT.name - 2, HIT.name + 10);
  const dotGlow = 0.8 + 0.2 * Math.sin(f * 0.16);

  // search field and typing (the whole name in ~16 frames, ending before the pick)
  const lineP = glide(f, HIT.name + 14, HIT.name + 30);
  const iconO = arrive(f, HIT.name + 20, HIT.name + 30);
  const typeStart = HIT.star - 26;
  const PER = 15 / COPY.search.length;
  const n =
    f < typeStart
      ? 0
      : Math.min(COPY.search.length, Math.floor((f - typeStart) / PER) + 1);
  const typing = f >= typeStart && n < COPY.search.length;
  const caretOn = typing || Math.floor(f / 8) % 2 === 0;
  const caretO = iconO * (1 - ramp(f, HIT.star + 2, HIT.star + 8));

  // result row and the cursor that picks it on "star"
  const rowIn = arrive(f, HIT.star - 10, HIT.star - 2);
  const cur = glide(f, HIT.star - 14, HIT.star - 1);
  const curIn =
    arrive(f, HIT.star - 14, HIT.star - 8) *
    (1 - ramp(f, HIT.star + 12, HIT.star + 20));
  const press = f >= HIT.star && f < HIT.star + 5 ? 1 - (f - HIT.star) / 5 : 0;
  const picked = arrive(f, HIT.star, HIT.star + 4);
  const rowOut = 1 - arrive(f, HIT.watch - 4, HIT.watch + 6);
  const curX = lerp(cur, 0, 1, M + FIELD_W + 140, M + 470);
  const curY = lerp(cur, 0, 1, ROW_Y + 210, ROW_Y + ROW_H / 2 + 2);

  // the frame fills with real pixels on the pick, then blinks on "watch"
  // the panel turns opaque just before the pixels arrive, so they only ever fade against it
  const solid = arrive(f, HIT.star - 3, HIT.star + 1);
  const sky = arrive(f, HIT.star + 1, HIT.star + 7) * pixOut;
  const idx =
    f < HIT.watch ? 0 : Math.floor((f - HIT.watch) / HOLD) % SKY_FRAMES.barnard;
  const counterIn = arrive(f, HIT.watch, HIT.watch + 8);
  const counterO = counterIn * pixOut;
  const ringX = cx - size / 2 + RING.x * size;
  const ringY = cy - size / 2 + RING.y * size;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AiBackground
        name="bg_sky"
        f={f}
        from={FROM}
        to={TO}
        zoom={[1.06, 1.14]}
        pan={[30, 10, -50, -16]}
        opacity={0.9}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, rgba(4,6,15,.7) 0%, rgba(4,6,15,.35) 45%, rgba(4,6,15,.1) 75%)",
        }}
      />
      <Finish f={f} />

      <AbsoluteFill
        style={{ transform: `scale(${cam})`, transformOrigin: "50% 45%" }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: side,
            opacity: sideO,
          }}
        >
          {/* wordmark: the dot lands, the letters rise one by one */}
          <div
            style={{
              position: "absolute",
              left: M,
              top: MARK_TOP,
              height: T.display,
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
                const p = arrive(f, HIT.name + i * 2, HIT.name + 14 + i * 2);
                return (
                  <span
                    key={i}
                    style={{
                      display: "inline-block",
                      transform: `translateY(${(1 - p) * 30}px)`,
                      opacity: p,
                    }}
                  >
                    {ch}
                  </span>
                );
              })}
            </div>
          </div>

          {/* search field: an underline, a magnifier, the typed name */}
          <div
            style={{
              position: "absolute",
              left: M,
              top: FIELD_Y - 64,
              width: FIELD_W,
              height: 64,
            }}
          >
            <div
              style={{ position: "absolute", left: 2, top: 14, opacity: iconO }}
            >
              <Magnifier size={32} color={C.muted} />
            </div>
            <div
              style={{
                position: "absolute",
                left: 56,
                top: 6,
                height: 48,
                display: "flex",
                alignItems: "center",
                fontFamily: BODY,
                fontWeight: 300,
                fontSize: T.body,
                color: C.ink,
                whiteSpace: "nowrap",
              }}
            >
              <span>{COPY.search.slice(0, n)}</span>
              <span
                style={{
                  display: "inline-block",
                  width: 2,
                  height: 38,
                  marginLeft: 4,
                  background: C.acc,
                  opacity: caretOn ? caretO : 0,
                }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                width: FIELD_W * lineP,
                height: 2,
                background: `rgba(${ACC},.55)`,
              }}
            />
          </div>

          {/* the result row: a framed rectangle (never a pill), lit when picked */}
          <div
            style={{
              position: "absolute",
              left: M,
              top: ROW_Y,
              width: FIELD_W,
              height: ROW_H,
              borderRadius: 3,
              background: `rgba(10,18,48,${0.7 + 0.2 * picked})`,
              boxShadow: `inset 0 0 0 1px rgba(${ACC},${0.25 + 0.45 * picked}), 0 0 ${30 * picked}px rgba(91,108,255,${0.35 * picked})`,
              opacity: rowIn * rowOut,
              transform: `translateY(${(1 - rowIn) * -10}px)`,
              display: "flex",
              alignItems: "center",
              gap: 18,
              paddingLeft: 22,
              fontFamily: BODY,
              fontSize: T.sub,
              color: C.ink,
            }}
          >
            <svg width={22} height={22}>
              <circle
                cx={11}
                cy={11}
                r={8}
                fill="none"
                stroke={C.amber}
                strokeWidth={2.5}
              />
            </svg>
            {COPY.search}
          </div>
        </div>

        {/* the sky frame */}
        <div
          style={{
            position: "absolute",
            left: cx - size,
            top: cy - size,
            width: size * 2,
            height: size * 2,
            background: `radial-gradient(closest-side, ${C.glow}aa, rgba(26,47,122,0))`,
            opacity: (0.35 + 0.5 * sky) * panelOut,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: cx - size / 2,
            top: cy - size / 2,
            width: size,
            height: size,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              lineHeight: 0,
              background: `rgba(6,10,26,${0.62 + 0.38 * solid})`,
              opacity: panelOut,
              transform: `scale(${exitK})`,
              boxShadow: `0 0 0 1px rgba(${ACC},.45), 0 30px 80px rgba(0,0,0,.5)`,
            }}
          >
            {sky > 0 ? (
              <div style={{ opacity: sky }}>
                <SkyFrame sky="barnard" size={size} f={0} index={idx} />
              </div>
            ) : null}
          </div>
          {/* an empty viewfinder until a star is picked: a small centre cross */}
          <svg
            width={size}
            height={size}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              opacity: 0.5 * (1 - solid),
            }}
          >
            <path
              d={`M ${size / 2 - 16} ${size / 2} H ${size / 2 + 16} M ${size / 2} ${size / 2 - 16} V ${size / 2 + 16}`}
              stroke={C.acc}
              strokeWidth={1.5}
            />
          </svg>
          <Ticks size={size} o={arrive(f, FROM, FROM + 10)} />
        </div>
        <LandingRing
          f={f}
          at={HIT.star + 18}
          x={ringX}
          y={ringY}
          r0={160}
          r1={RING.r * size}
        />
        {/* frame counter and three frame marks, at the sky frame's lower left (under it would reach the captions) */}
        <div
          style={{
            position: "absolute",
            left: cx - size / 2 - 28 - 320,
            top: cy + size / 2 - 22,
            width: 320,
            justifyContent: "flex-end",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: MONO,
            fontSize: T.small,
            letterSpacing: "0.04em",
            color: C.acc,
            opacity: counterO,
            textShadow: HALO,
          }}
        >
          {Array.from({ length: SKY_FRAMES.barnard }, (_, i) => (
            <span
              key={i}
              style={{
                width: 12,
                height: 12,
                background: i === idx ? C.acc : "rgba(195,206,255,.22)",
              }}
            />
          ))}
          <span
            style={{ marginLeft: 10 }}
          >{`frame ${idx + 1} / ${SKY_FRAMES.barnard}`}</span>
        </div>

        {/* the cursor that picks the star */}
        {curIn > 0 ? (
          <div
            style={{
              position: "absolute",
              left: curX,
              top: curY,
              opacity: curIn,
            }}
          >
            <Cursor press={press} />
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
