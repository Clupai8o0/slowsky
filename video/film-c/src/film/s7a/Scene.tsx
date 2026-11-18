import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../brand/tokens";
import { AiBackground } from "../kit/AiArt";
import { ramp, rand } from "../kit/anim";
import { Finish, IO, OUT } from "../kit/look";
import { HIT, SCENES } from "../timing";
import { VOL, WORLD_ORIGIN, s6Push } from "../s6/Scene";

// Scene 7, a calm bridge into the end card: "Now anyone can join the hunt."
// The same night Earth and the same camera as scene 6, carried on without a break (scene 6's counter and brown
// dwarf fade off it). Its volunteer lights stay on; from HIT.now a few of them lift off and rise past the blue
// rim into the stars, as if people everywhere are joining. Then the picture sinks to dark blue, out of which
// the end card's sky rises.

const { from: FROM, to: TO } = SCENES.s7;
const START = s6Push(SCENES.s6.to);
const RATE = (s6Push(SCENES.s6.to) - s6Push(SCENES.s6.from)) / (SCENES.s6.to - SCENES.s6.from);

// Lights that rise, spread across the lit land (indices into scene 6's volunteer lights, sorted by x).
const BY_X = VOL.map((v, i) => ({ ...v, i })).sort((a, b) => a.x - b.x);
const PICK = [0.06, 0.18, 0.3, 0.42, 0.54, 0.66, 0.8, 0.92].map((q) => BY_X[Math.floor(q * (BY_X.length - 1))]);
const RISERS = PICK.map((v, j) => ({
  x: v.x,
  y: v.y,
  start: HIT.now - 2 + Math.round(j * 1.5 + rand(700 + j) * 2),
  rise: 240 + rand(710 + j) * 200,
  sway: (rand(720 + j) - 0.5) * 120,
}));
const RISE = 18;

export const S7: React.FC<{ f: number }> = ({ f }) => {
  const fadeIn = ramp(f, FROM, FROM + 4);
  const push = START + RATE * (f - FROM); // the same constant push as scene 6
  const sink = ramp(f, TO - 14, TO + 4, IO);

  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${push})`, transformOrigin: WORLD_ORIGIN }}>
        <AiBackground name="bg_world" f={f} from={FROM} to={TO} zoom={[1, 1]} />
        <Finish f={f} />
        <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <defs>
            <radialGradient id="s7vol" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.acc} stopOpacity={0.8} />
              <stop offset="100%" stopColor={C.acc} stopOpacity={0} />
            </radialGradient>
            <filter id="s7soft" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation={6} />
            </filter>
            {RISERS.map((l, i) => (
              <linearGradient key={i} id={`s7trail${i}`} gradientUnits="userSpaceOnUse" x1={l.x} y1={l.y} x2={l.x + l.sway} y2={l.y - l.rise}>
                <stop offset="0%" stopColor={C.acc} stopOpacity={0} />
                <stop offset="100%" stopColor={C.acc} stopOpacity={0.9} />
              </linearGradient>
            ))}
          </defs>

          {/* scene 6's volunteer lights, still on */}
          {VOL.map((v, i) => {
            const tw = 0.6 + 0.4 * Math.sin(f * v.sp + v.tw);
            const r = v.big ? 16 : 10;
            return (
              <g key={i}>
                <circle cx={v.x} cy={v.y} r={r} fill="url(#s7vol)" opacity={tw} />
                <circle cx={v.x} cy={v.y} r={v.big ? 2.6 : 1.9} fill="#ffffff" opacity={0.7 + 0.3 * tw} />
              </g>
            );
          })}

          {/* lights lifting off into the stars */}
          {RISERS.map((l, i) => {
            if (f < l.start) {
              return null;
            }
            const p = ramp(f, l.start, l.start + RISE, OUT);
            const hx = l.x + l.sway * p;
            const hy = l.y - l.rise * p;
            const cx = l.x + l.sway * 0.1;
            const cy = l.y - l.rise * 0.6 * p;
            const trailO = 0.85 * (1 - 0.7 * ramp(f, l.start + RISE, l.start + RISE + 12));
            const tw = 0.75 + 0.25 * Math.sin(f * 0.3 + i * 1.7);
            return (
              <g key={i}>
                <path d={`M ${l.x} ${l.y} Q ${cx} ${cy} ${hx} ${hy}`} fill="none" stroke={`url(#s7trail${i})`} strokeWidth={2.5} strokeLinecap="round" opacity={trailO} />
                <circle cx={hx} cy={hy} r={12} fill={C.acc} opacity={0.6 * tw} filter="url(#s7soft)" />
                <circle cx={hx} cy={hy} r={3.4} fill={C.ink} opacity={tw} />
              </g>
            );
          })}
        </svg>
      </div>
      {/* sink to dark blue so the end card can rise */}
      <div style={{ position: "absolute", inset: 0, background: "#050a1f", opacity: 0.9 * sink }} />
    </AbsoluteFill>
  );
};
