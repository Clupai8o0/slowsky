import { Easing, interpolate, spring } from "remotion";
import { FPS } from "../../lib/beat";

// Shared motion helpers. Every scene draws from the FILM frame f (see Shell.tsx).

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// 0 -> 1 between frames a and b, eased out.
export const ramp = (f: number, a: number, b: number, easing = Easing.out(Easing.cubic)) =>
  interpolate(f, [a, b], [0, 1], { ...clamp, easing });

// 0 -> 1 in and back to 0 out: fades a thing in over [a, a+inLen] and out over [b-outLen, b].
export const inOut = (f: number, a: number, b: number, inLen = 8, outLen = 8) =>
  Math.min(ramp(f, a, a + inLen), 1 - ramp(f, b - outLen, b, Easing.in(Easing.cubic)));

// A springy 0 -> 1 that starts at frame `at` (overshoots a little, settles).
export const pop = (f: number, at: number, damping = 12, stiffness = 160) =>
  f < at ? 0 : spring({ frame: f - at, fps: FPS, config: { damping, stiffness, mass: 0.6 } });

// Linear map with clamping.
export const lerp = (f: number, a: number, b: number, from: number, to: number) =>
  interpolate(f, [a, b], [from, to], clamp);

// Deterministic pseudo-random in [0, 1) from an integer seed (stable across renders).
export const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// Which of n frames a blink shows at film frame f, switching every `hold` frames.
export const blinkIndex = (f: number, n: number, hold = 10) => Math.floor(f / hold) % n;
