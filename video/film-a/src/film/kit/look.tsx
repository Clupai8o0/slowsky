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
export const Ticks: React.FC<{ size: number; o: number; len?: number; color?: string }> = ({ size, o, len = 24, color = C.acc }) => {
  const d = -10;
  const s = size - d;
  const L = len;
  const paths = [
    `M ${d} ${d + L} L ${d} ${d} L ${d + L} ${d}`,
    `M ${s - L} ${d} L ${s} ${d} L ${s} ${d + L}`,
    `M ${s} ${s - L} L ${s} ${s} L ${s - L} ${s}`,
    `M ${d + L} ${s} L ${d} ${s} L ${d} ${s - L}`,
  ];
  return (
    <svg width={size} height={size} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
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
