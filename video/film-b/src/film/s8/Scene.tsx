import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import { BODY, DISPLAY, MONO } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { COPY } from "../copy";
import { AiBackground } from "../kit/AiArt";
import { lerp, ramp, rand } from "../kit/anim";
import { SCENES } from "../timing";

// Scene 8: the end card. The Milky Way arch rises in with a slow push; forty drawn stars fly in and settle
// into the Slowsky wordmark inside the arch; the line, the URL and the credits follow, then everything holds.
// While the last caption is up (its first ~22 frames) all text stays above y 860.

const { from: FROM, to: TO } = SCENES.s8;
const MARK_Y = 360; // wordmark centre line
const DOT_X = 613;
const DOT_R = 15;

// Star targets: 10 into the dot, the rest across the wordmark's box and a loose halo around it.
const STARS = Array.from({ length: 40 }, (_, i) => {
  const r = (k: number) => rand(8000 + i * 13 + k);
  let tx: number;
  let ty: number;
  if (i < 10) {
    tx = DOT_X + (r(1) - 0.5) * 16;
    ty = MARK_Y + (r(2) - 0.5) * 16;
  } else if (i < 30) {
    tx = 670 + r(1) * 640;
    ty = MARK_Y - 60 + r(2) * 120;
  } else {
    const a = r(1) * Math.PI * 2;
    tx = 965 + Math.cos(a) * (430 + r(2) * 60);
    ty = MARK_Y + Math.sin(a) * (120 + r(3) * 40);
  }
  const a0 = r(4) * Math.PI * 2;
  return {
    sx: 960 + Math.cos(a0) * (700 + r(5) * 500),
    sy: 540 + Math.sin(a0) * (420 + r(6) * 300),
    tx,
    ty,
    halo: i >= 30,
    start: FROM + r(7) * 5,
    dur: 8 + r(8) * 4,
    size: 2 + r(9) * 2.5,
    tw: r(10) * Math.PI * 2,
  };
});

// Stars fade out while they pass under the AI watermark (Shell, top left), so the mark always reads.
const clearOfMark = (x: number, y: number) => {
  const inX = Math.min(1, Math.max(0, (560 - x) / 60));
  const inY = Math.min(1, Math.max(0, (90 - y) / 40));
  return 1 - inX * inY;
};

export const S8: React.FC<{ f: number }> = ({ f }) => {
  const bgIn = ramp(f, FROM, FROM + 14);
  const dot = ramp(f, FROM + 4, FROM + 12);
  const mark = ramp(f, FROM + 6, FROM + 16);
  const glow = ramp(f, FROM + 10, FROM + 26);
  const line = ramp(f, FROM + 14, FROM + 23);
  const cta = ramp(f, FROM + 19, FROM + 28);
  const cred = ramp(f, FROM + 26, FROM + 35);
  const ctaGlow = cta * 0.5;
  return (
    <AbsoluteFill>
      {/* the arch rises in and keeps a slow push to the last frame */}
      <AiBackground name="bg_end" f={f} from={FROM} to={TO} zoom={[1.08, 1.13]} pan={[0, 40, 0, 0]} opacity={bgIn} />

      {/* soft bloom behind the mark */}
      <div
        style={{
          position: "absolute",
          left: 960 - 600,
          top: MARK_Y - 260,
          width: 1200,
          height: 520,
          borderRadius: "50%",
          background: "radial-gradient(closest-side, rgba(26,47,122,.6), rgba(26,47,122,0))",
          opacity: 0.3 + 0.7 * glow,
        }}
      />
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        {STARS.map((s, i) => {
          const p = ramp(f, s.start, s.start + s.dur, Easing.inOut(Easing.cubic));
          if (f < s.start) {
            return null;
          }
          // a slight curve on the way in
          const bend = Math.sin(p * Math.PI) * 60 * (i % 2 === 0 ? 1 : -1);
          const x = lerp(p, 0, 1, s.sx, s.tx) + bend * 0.6;
          const y = lerp(p, 0, 1, s.sy, s.ty) + bend * 0.3;
          const tw = 0.6 + 0.4 * Math.sin(f * 0.14 + s.tw);
          // stars inside the mark fade into the letters once it forms; halo stars stay and twinkle
          const keep = (s.halo ? 0.75 * tw : 1 - mark) * clearOfMark(x, y);
          const trail = (1 - p) * 30;
          const dx = s.tx - s.sx;
          const dy = s.ty - s.sy;
          const d = Math.hypot(dx, dy) || 1;
          return (
            <g key={i} opacity={Math.min(1, ramp(f, s.start, s.start + 2)) * keep}>
              {trail > 1 ? (
                <line
                  x1={x - (dx / d) * trail}
                  y1={y - (dy / d) * trail}
                  x2={x}
                  y2={y}
                  stroke={C.acc}
                  strokeWidth={s.size}
                  strokeLinecap="round"
                  opacity={0.5}
                />
              ) : null}
              <circle cx={x} cy={y} r={s.size} fill={i < 10 ? C.acc : C.ink} />
              <circle cx={x} cy={y} r={s.size * 3} fill={C.acc} opacity={0.18} />
            </g>
          );
        })}
      </svg>

      {/* wordmark */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: MARK_Y - 100,
          height: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 34,
        }}
      >
        <div
          style={{
            width: DOT_R * 2,
            height: DOT_R * 2,
            borderRadius: DOT_R,
            background: C.acc,
            opacity: dot,
            transform: `scale(${0.4 + 0.6 * dot})`,
            boxShadow: `0 0 ${18 + 30 * glow}px ${C.acc}, 0 0 ${50 * glow}px rgba(91,108,255,.8)`,
          }}
        />
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 500,
            fontSize: 168,
            letterSpacing: "-0.02em",
            color: C.ink,
            lineHeight: 1,
            opacity: mark,
            filter: `blur(${(1 - mark) * 8}px)`,
            textShadow: `0 0 ${20 + 30 * glow}px rgba(195,206,255,${0.25 + 0.35 * glow})`,
          }}
        >
          {COPY.name}
        </div>
      </div>

      {/* tagline */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 500,
          textAlign: "center",
          fontFamily: BODY,
          fontWeight: 300,
          fontSize: 42,
          color: C.ink,
          opacity: line,
          transform: `translateY(${(1 - line) * 14}px)`,
          textShadow: "0 1px 8px rgba(0,0,0,.7)",
        }}
      >
        {COPY.line}
      </div>

      {/* URL */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 584,
          textAlign: "center",
          fontFamily: MONO,
          fontWeight: 500,
          fontSize: 44,
          color: C.amber,
          opacity: cta,
          transform: `translateY(${(1 - cta) * 14}px)`,
          textShadow: `0 0 22px rgba(255,179,71,${ctaGlow})`,
        }}
      >
        {COPY.cta}
      </div>

      {/* credits: low over the dark hills, after the last caption has gone */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 930,
          textAlign: "center",
          fontFamily: BODY,
          fontWeight: 400,
          fontSize: 23,
          lineHeight: 1.6,
          color: C.muted,
          opacity: cred,
          textShadow: "0 1px 6px rgba(0,0,0,.9)",
        }}
      >
        <div>{COPY.credits}</div>
        <div>Team Clupai · Melbourne</div>
      </div>
    </AbsoluteFill>
  );
};
