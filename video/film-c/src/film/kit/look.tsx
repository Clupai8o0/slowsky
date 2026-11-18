import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import { C } from "../../brand/tokens";
import { ramp } from "./anim";

// One look for the whole film: one easing family, one type scale, one margin system, and the finish (grain and
// vignette) that sits over the paintings. Real sky pixels are always drawn ABOVE the finish, never under it.

// Easing: strong ease-out for arrivals, ease-in-out for camera and glides. Springs only where a thing lands.
export const OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const IO = Easing.bezier(0.65, 0, 0.35, 1);

export const arrive = (f: number, a: number, b: number) => ramp(f, a, b, OUT);
export const glide = (f: number, a: number, b: number) => ramp(f, a, b, IO);

// Type scale (px at 1920x1080).
export const T = {
  hero: 168, // the wordmark on the end card
  display: 124, // the wordmark in the product scene
  number: 140, // big counters (102, 3,000+)
  title: 72, // the title card's challenge line
  body: 40, // search text, tagline, the hero label
  sub: 28, // second lines of labels
  label: 24, // mono labels
  small: 22, // credits, frame counters
} as const;

// Margins: one left/right margin and one top line for the content block of every scene.
export const M = 180;
export const TOP = 150;
export const SAFE_BOTTOM = 860; // captions live below this

// The text halo used on every label over art.
export const HALO = "0 0 14px rgba(2,4,12,.85), 0 1px 3px rgba(0,0,0,.9)";

// Film finish over a painting: a soft vignette and a fine, deterministic grain (its seed steps every 2 frames).
export const Finish: React.FC<{ f: number; vignette?: number; grain?: number }> = ({ f, vignette = 0.55, grain = 0.07 }) => {
  const seed = Math.floor(f / 2) % 24;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 75% 70% at 50% 46%, rgba(4,6,15,0) 55%, rgba(4,6,15,${vignette}) 100%)`,
        }}
      />
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: grain }}>
        <filter id={`grain${seed}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency={0.85} numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width={1920} height={1080} filter={`url(#grain${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

// Corner ticks around a square frame (the "viewfinder" shared by the product panel and the real-pixel tiles).
// `h` (optional) for a non-square frame; the default keeps the square every older call draws.
export const Ticks: React.FC<{ size: number; o: number; len?: number; color?: string; h?: number }> = ({ size, o, len = 24, color = C.acc, h }) => {
  const d = -10;
  const s = size - d;
  const t = (h ?? size) - d;
  const L = len;
  const paths = [
    `M ${d} ${d + L} L ${d} ${d} L ${d + L} ${d}`,
    `M ${s - L} ${d} L ${s} ${d} L ${s} ${d + L}`,
    `M ${s} ${t - L} L ${s} ${t} L ${s - L} ${t}`,
    `M ${d + L} ${t} L ${d} ${t} L ${d} ${t - L}`,
  ];
  return (
    <svg width={size} height={h ?? size} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      {paths.map((p, i) => (
        <path key={i} d={p} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" opacity={o} />
      ))}
    </svg>
  );
};

// An amber ring that closes in on a point and hands over to the product's own Gaia ring (already in the
// capture): it shrinks from `r0` to `r1` by frame `at` and fades as it lands, so no ring is drawn twice.
export const LandingRing: React.FC<{ f: number; at: number; x: number; y: number; r0: number; r1: number; len?: number }> = ({
  f,
  at,
  x,
  y,
  r0,
  r1,
  len = 14,
}) => {
  if (f < at - len || f > at + 10) {
    return null;
  }
  const p = ramp(f, at - len, at, OUT);
  const r = r0 + (r1 - r0) * p;
  const o = ramp(f, at - len, at - len + 4) * (1 - ramp(f, at, at + 10));
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
      <circle cx={x} cy={y} r={r} fill="none" stroke={C.amber} strokeWidth={3} opacity={o} />
      <circle cx={x} cy={y} r={r + 10 * (1 - p)} fill="none" stroke={C.amber} strokeWidth={8} opacity={o * 0.18} />
    </svg>
  );
};

// ---------- A frame carried across a cut ----------
// When a real capture leaves, its frame (corner ticks, or a thin outline) stays and travels into the next scene's
// first element, so the cut never shows a few frames of bare painting. The outgoing scene draws it up to its last
// frame; the incoming scene draws it from its first frame (outside its own fade), from the same screen rect.

export type Rect = { x: number; y: number; w: number; h: number };

export const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
});

// Scale a screen rect about a screen point (a CSS scale with that transform origin).
export const scaleRect = (r: Rect, k: number, ox: number, oy: number): Rect => ({
  x: ox + (r.x - ox) * k,
  y: oy + (r.y - oy) * k,
  w: r.w * k,
  h: r.h * k,
});

export const CarryFrame: React.FC<{ r: Rect; o: number; kind: "ticks" | "line"; len?: number }> = ({ r, o, kind, len = 24 }) => {
  if (o <= 0) {
    return null;
  }
  if (kind === "line") {
    return (
      <div
        style={{
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.w,
          height: r.h,
          borderRadius: 3,
          boxShadow: "0 0 0 1.5px rgba(195,206,255,.55), 0 0 28px rgba(91,108,255,.35)",
          opacity: o,
          pointerEvents: "none",
        }}
      />
    );
  }
  const L = Math.min(len, r.w / 3, r.h / 3);
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const paths = [
    `M ${x0} ${y0 + L} L ${x0} ${y0} L ${x0 + L} ${y0}`,
    `M ${x1 - L} ${y0} L ${x1} ${y0} L ${x1} ${y0 + L}`,
    `M ${x1} ${y1 - L} L ${x1} ${y1} L ${x1 - L} ${y1}`,
    `M ${x0 + L} ${y1} L ${x0} ${y1} L ${x0} ${y1 - L}`,
  ];
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
      {paths.map((p, i) => (
        <path key={i} d={p} fill="none" stroke={C.acc} strokeWidth={2.5} strokeLinecap="round" opacity={o} />
      ))}
    </svg>
  );
};

// A soft dark backing under the caption band (a gradient, no shape: never a pill), for moments when the caption
// would sit on a bright part of a real capture.
export const CaptionShade: React.FC<{ o: number }> = ({ o }) =>
  o > 0 ? (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 760,
        width: 1920,
        height: 320,
        background: "radial-gradient(ellipse 55% 60% at 50% 72%, rgba(2,4,12,.78) 0%, rgba(2,4,12,.5) 50%, rgba(2,4,12,0) 100%)",
        opacity: o,
        pointerEvents: "none",
      }}
    />
  ) : null;
