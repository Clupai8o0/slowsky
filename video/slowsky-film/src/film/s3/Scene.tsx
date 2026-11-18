import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import { C } from "../../brand/tokens";
import { BODY, DISPLAY, MONO } from "../../brand/fonts";
import { COPY } from "../copy";
import { AiBackground } from "../kit/AiArt";
import { lerp, pop, ramp } from "../kit/anim";
import { SKY_FRAMES, SkyFrame } from "../kit/Sky";
import { HIT, SCENES } from "../timing";

// Scene 3. "Slowsky: pick a star, / and watch the sky change."
// HIT.name: the wordmark rises in the middle of the painted sky, then glides to the left column while a
// search underline draws beneath it. "Barnard's Star" types in, finishing on HIT.star. HIT.watch: the real
// sky panel opens on the right and blinks. The last ~20 frames only blink and drift.

const { from: FROM, to: TO } = SCENES.s3;
const INK = "233,236,255";
const ACC = "195,206,255";

// Final layout: text column on the left, the sky panel on the right.
const COL_X = 300; // left edge of the text column
const FIELD_W = 640;
const FIELD_Y = 570; // underline
const PANEL = 500;
const PANEL_X = 1120;
const PANEL_Y = 210;
const HOLD = 10; // blink hold (frames)

const Magnifier: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <circle cx={10.5} cy={10.5} r={6.5} fill="none" stroke={color} strokeWidth={1.8} />
    <line x1={15.5} y1={15.5} x2={21} y2={21} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </svg>
);

export const S3: React.FC<{ f: number }> = ({ f }) => {
  const fade = ramp(f, FROM, FROM + 6); // the cut out is a crossfade (Shell SceneGate)
  const cam = lerp(f, FROM, TO, 1, 1.03);

  // Wordmark: rises letter by letter at centre on HIT.name, then glides left and shrinks.
  const glide = ramp(f, HIT.name + 12, HIT.name + 30, Easing.inOut(Easing.cubic));
  const markX = lerp(glide, 0, 1, 960, COL_X);
  const markY = lerp(glide, 0, 1, 470, 420);
  const markS = lerp(glide, 0, 1, 1, 0.74);
  const align = lerp(glide, 0, 1, 50, 0); // translateX %: centred -> left-aligned
  const dotP = pop(f, HIT.name, 14, 120);
  const dotGlow = 0.75 + 0.25 * Math.sin(f * 0.18);

  // Search field: one underline drawing left to right under the wordmark.
  const lineP = ramp(f, HIT.name + 18, HIT.name + 34, Easing.inOut(Easing.cubic));
  const iconO = ramp(f, HIT.name + 24, HIT.name + 32);
  const typeStart = HIT.star - 16;
  const PER = 16 / COPY.search.length; // whole name in ~16 frames
  const n = f < typeStart ? 0 : Math.min(COPY.search.length, Math.floor((f - typeStart) / PER) + 1);
  const typing = f >= typeStart && n < COPY.search.length;
  const caretOn = typing || Math.floor(f / 7) % 2 === 0;
  const caretO = iconO * (1 - ramp(f, HIT.watch + 2, HIT.watch + 8));

  // HIT.watch: a light runs along the underline, then the panel opens.
  const run = ramp(f, HIT.watch - 2, HIT.watch + 8, Easing.inOut(Easing.quad));
  const runO = f >= HIT.watch - 2 ? 1 - ramp(f, HIT.watch + 6, HIT.watch + 14) : 0;
  const open = ramp(f, HIT.watch + 2, HIT.watch + 16, Easing.inOut(Easing.cubic));
  const counterO = ramp(f, HIT.watch + 12, HIT.watch + 20);
  const frameNo = Math.floor(f / HOLD) % SKY_FRAMES.barnard;
  const glowO = 0.35 + 0.45 * open;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AiBackground name="bg_sky" f={f} from={FROM} to={TO} zoom={[1.05, 1.12]} pan={[30, 10, -40, -14]} opacity={0.92} />
      {/* darken the left so text reads */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(90deg, rgba(4,6,15,.55) 0%, rgba(4,6,15,.15) 45%, rgba(4,6,15,0) 70%)",
        }}
      />

      <AbsoluteFill style={{ transform: `scale(${cam})`, transformOrigin: "55% 45%" }}>
        {/* wordmark */}
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

        {/* search field: an underline, a magnifier, the typed name */}
        <div style={{ position: "absolute", left: COL_X, top: FIELD_Y - 64, width: FIELD_W, height: 64 }}>
          <div style={{ position: "absolute", left: 4, top: 14, opacity: iconO }}>
            <Magnifier size={32} color={run > 0 ? C.ink : C.muted} />
          </div>
          <div
            style={{
              position: "absolute",
              left: 58,
              top: 6,
              display: "flex",
              alignItems: "center",
              height: 48,
              fontFamily: BODY,
              fontWeight: 300,
              fontSize: 46,
              color: C.ink,
              whiteSpace: "nowrap",
            }}
          >
            <span>{COPY.search.slice(0, n)}</span>
            <span
              style={{
                display: "inline-block",
                width: 2,
                height: 42,
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
              height: 1.5,
              background: `rgba(${ACC},${0.45 + 0.4 * runO})`,
            }}
          />
          {/* the light that runs along the line on "watch" */}
          {runO > 0 ? (
            <div
              style={{
                position: "absolute",
                left: FIELD_W * run - 90,
                bottom: -2,
                width: 180,
                height: 5,
                background: `radial-gradient(closest-side, rgba(${INK},.95), rgba(${ACC},0))`,
                opacity: runO,
              }}
            />
          ) : null}
        </div>

        {/* the real sky panel */}
        {open > 0 ? (
          <>
            <div
              style={{
                position: "absolute",
                left: PANEL_X - 220,
                top: PANEL_Y - 220,
                width: PANEL + 440,
                height: PANEL + 440,
                background: `radial-gradient(closest-side, ${C.glow}aa, transparent)`,
                opacity: glowO,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: PANEL_X,
                top: PANEL_Y,
                width: PANEL,
                height: PANEL,
                overflow: "hidden",
                background: C.bg,
                opacity: open,
                transform: `scale(${0.92 + 0.08 * open})`,
                lineHeight: 0,
              }}
            >
              <SkyFrame sky="barnard" size={PANEL} f={f} hold={HOLD} />
            </div>
            <div
              style={{
                position: "absolute",
                left: PANEL_X - 1,
                top: PANEL_Y - 1,
                width: PANEL,
                height: PANEL,
                opacity: open,
                transform: `scale(${0.92 + 0.08 * open})`,
                border: `1px solid rgba(${ACC},.45)`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: PANEL_X,
                top: PANEL_Y + PANEL + 18,
                fontFamily: MONO,
                fontSize: 20,
                letterSpacing: "0.04em",
                color: C.acc,
                opacity: counterO,
              }}
            >
              {`frame ${frameNo + 1} / ${SKY_FRAMES.barnard}`}
            </div>
          </>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
