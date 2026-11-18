import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { C } from "../../brand/tokens";
import { MONO } from "../../brand/fonts";
import { blinkIndex, pop, rand } from "./anim";

// ---------- Starfield: drawn stars that drift and twinkle. The Shell draws one behind every scene. ----------

const STARS = Array.from({ length: 260 }, (_, i) => ({
  x: rand(i * 3 + 1) * 1920,
  y: rand(i * 3 + 2) * 1080,
  r: 0.6 + rand(i * 3 + 3) ** 3 * 2.6,
  depth: 0.2 + rand(i * 7 + 5) * 0.8, // nearer stars drift faster
  tw: rand(i * 11 + 9) * Math.PI * 2,
}));

export const Starfield: React.FC<{ f: number; drift?: number; opacity?: number; warp?: number }> = ({
  f,
  drift = 0.35,
  opacity = 1,
  warp = 0,
}) => (
  <AbsoluteFill style={{ opacity }}>
    <svg width={1920} height={1080}>
      <defs>
        <radialGradient id="bloom" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={C.glow} stopOpacity={0.55} />
          <stop offset="60%" stopColor={C.navy} stopOpacity={0.25} />
          <stop offset="100%" stopColor={C.bg} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect width={1920} height={1080} fill="url(#bloom)" />
      {STARS.map((s, i) => {
        const x = (((s.x - f * drift * s.depth * 2) % 1920) + 1920) % 1920;
        const tw = 0.55 + 0.45 * Math.sin(f * 0.12 + s.tw);
        // warp: stars stretch away from the centre (a fast push through space)
        const dx = x - 960;
        const dy = s.y - 540;
        const len = warp * s.depth * 0.25;
        return (
          <line
            key={i}
            x1={x}
            y1={s.y}
            x2={x + dx * len}
            y2={s.y + dy * len}
            stroke={i % 9 === 0 ? C.acc : C.ink}
            strokeWidth={s.r * 1.6}
            strokeLinecap="round"
            opacity={tw * (0.35 + 0.65 * s.depth)}
          />
        );
      })}
    </svg>
  </AbsoluteFill>
);

// ---------- SkyFrame: real SPHEREx pixels (stand-ins from research/ until live captures exist) ----------

// Live captures from slowsky.vercel.app (v0.1, 14 Nov 15:14 NPT) by video/experiments/capture_live.py: the
// product's own sky view, Gaia rings as shipped. The research stand-ins moved to video/experiments/.
export type SkyKey = "epsindib" | "rwaur" | "barnard" | "wise" | "rdra";
export const SKY_FRAMES: Record<SkyKey, number> = { epsindib: 4, rwaur: 3, barnard: 3, wise: 4, rdra: 3 };

// Shows frame `index` of a target, or blinks through them when index is undefined. Pixels stay crisp
// (nearest-neighbour), because they are the data.
export const SkyFrame: React.FC<{
  sky: SkyKey;
  size: number;
  f: number;
  index?: number;
  hold?: number;
  filter?: string;
  style?: React.CSSProperties;
}> = ({ sky, size, f, index, hold = 10, filter, style }) => {
  const i = index ?? blinkIndex(f, SKY_FRAMES[sky], hold);
  return (
    <Img
      src={staticFile(`sky/${sky}_${i}.png`)}
      style={{ width: size, height: size, imageRendering: "pixelated", objectFit: "cover", filter, ...style }}
    />
  );
};

// ---------- GaiaRing: an amber ring that pops in where Gaia predicts a star ----------

export const GaiaRing: React.FC<{ f: number; at: number; x: number; y: number; r: number; label?: string }> = ({
  f,
  at,
  x,
  y,
  r,
  label,
}) => {
  const p = pop(f, at);
  if (p <= 0) {
    return null;
  }
  return (
    <div style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2 }}>
      <svg width={r * 2} height={r * 2} style={{ overflow: "visible" }}>
        <circle cx={r} cy={r} r={r * p} fill="none" stroke={C.ring} strokeWidth={3} />
        <circle cx={r} cy={r} r={r * (1 + (1 - Math.min(1, p)) * 0.8)} fill="none" stroke={C.amber} strokeOpacity={0.3 * (1 - Math.min(1, p))} strokeWidth={2} />
      </svg>
      {label ? (
        <div
          style={{
            position: "absolute",
            left: r * 2 + 12,
            top: r - 14,
            fontFamily: MONO,
            fontSize: 22,
            color: C.amber,
            whiteSpace: "nowrap",
            opacity: Math.min(1, p),
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};
