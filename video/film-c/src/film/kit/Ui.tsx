import React from "react";
import { Img, interpolate, staticFile } from "remotion";
import { IO } from "./look";
import manifest from "../../../public/ui/manifest.json";

// Real Slowsky captures (public/ui/, made by scripts/capture_ui.py). Every box comes from the manifest, so a
// re-capture after a layout change needs no code change here or in the scenes. Captures are shown as they are:
// cropped, scaled, framed or dimmed around them, never repainted.

export type Box = { x: number; y: number; width: number; height: number };
export type Boxes = {
  picture: Box;
  transport: Box;
  targets: Box;
  status: Box;
  frameLabel: Box;
  brand?: Box;
  gaia?: Box;
  readout?: Box;
  gaiaKey?: Box;
  targetButtons?: Record<string, Box>;
};
export type Shot = {
  file: string;
  viewport: { width: number; height: number; dsf: number };
  scrollY: number;
  boxes: Boxes;
  frameLabel: string;
  picture?: string;
};
type Capture = { target: string; frames: Shot[]; fullPage: string; frameMs?: number };

const CAPS = manifest.captures as unknown as Record<string, Capture | Shot>;

// The blink frames of one target in one viewport ("desk2x", "phone", "desk"), in the page's own order.
export const uiFrames = (vp: string, key: string): Shot[] => {
  const c = CAPS[`${vp}_${key}`] as Capture | undefined;
  if (!c || !("frames" in c) || c.frames.length === 0) {
    throw new Error(`public/ui/manifest.json has no ${vp}_${key}: run scripts/capture_ui.py`);
  }
  return c.frames;
};

// The same blink, shot while the page's own player ran (its control shows Pause). capture_ui.py makes these for
// the targets in its PLAYING list; without them this falls back to the paused set (then keep the transport out
// of view).
export const uiPlaying = (vp: string, key: string): { frames: Shot[]; playing: boolean } => {
  const c = CAPS[`${vp}_${key}_playing`] as Capture | undefined;
  if (c && "frames" in c && c.frames.length > 0) {
    return { frames: c.frames, playing: true };
  }
  return { frames: uiFrames(vp, key), playing: false };
};

export const uiTargetId = (vp: string, key: string): string => (CAPS[`${vp}_${key}`] as Capture).target;

// The product's own player speed, as measured on the page by capture_ui.py (625 ms a frame on 14 Nov): 15 film
// frames at 24 fps. Falls back to 15 if the manifest has no measurement.
const measured = (CAPS["desk2x_barnard_playing"] as Capture | undefined)?.frameMs;
export const UI_HOLD = measured ? Math.max(8, Math.round((measured * 24) / 1000)) : 15;

// Which frame a blink that starts at `start` shows at film frame f: a hard cut every `hold` frames, no fade.
export const uiBlink = (f: number, start: number, n: number, first = 0, hold = UI_HOLD) =>
  f < start ? first : (first + Math.floor((f - start) / hold)) % n;

// Stacks every frame and shows only one, so switching is a hard cut with nothing left to load.
export const Stacked: React.FC<{ srcs: string[]; index: number; style: React.CSSProperties; crisp?: boolean }> = ({
  srcs,
  index,
  style,
  crisp,
}) => (
  <>
    {srcs.map((s, i) => (
      <Img
        key={s}
        src={staticFile(s)}
        style={{
          position: "absolute",
          display: "block",
          imageRendering: crisp ? "pixelated" : "auto",
          visibility: i === index ? "visible" : "hidden",
          ...style,
        }}
      />
    ))}
  </>
);

// ---------- Camera over a page capture ----------

// A camera looks at a region of the page (page CSS px): its centre and width; the screen is 1920 wide.
export type Cam = { cx: number; cy: number; w: number };
export type CamKey = Cam & { at: number };

// Eased between keys (IO, the film's camera ease from kit/look.tsx), width interpolated in log space so zoom speed reads even.
export const camAt = (f: number, keys: CamKey[]): Cam => {
  if (f <= keys[0].at) {
    return keys[0];
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (f <= b.at) {
      const t = interpolate(f, [a.at, b.at], [0, 1], { easing: IO });
      return {
        cx: a.cx + (b.cx - a.cx) * t,
        cy: a.cy + (b.cy - a.cy) * t,
        w: Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * t),
      };
    }
  }
  return keys[keys.length - 1];
};

export const camScale = (c: Cam) => 1920 / c.w;

// Page point -> screen point under camera c.
export const toScreen = (c: Cam, x: number, y: number) => {
  const k = camScale(c);
  return { x: 960 + (x - c.cx) * k, y: 540 + (y - c.cy) * k };
};

export const camTransform = (c: Cam) => {
  const k = camScale(c);
  return `translate(${960 - c.cx * k}px, ${540 - c.cy * k}px) scale(${k})`;
};

// A drawn pointer: clearly an overlay (flat, outlined), tip at (x, y).
export const Pointer: React.FC<{ x: number; y: number; o: number; press?: number }> = ({ x, y, o, press = 0 }) => (
  <svg
    width={40}
    height={48}
    viewBox="0 0 20 24"
    style={{
      position: "absolute",
      left: x - 3,
      top: y - 2,
      opacity: o,
      overflow: "visible",
      transform: `scale(${1 - 0.12 * press})`,
      transformOrigin: "3px 2px",
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,.6))",
    }}
  >
    <path d="M1.5 1 L1.5 18.5 L6 14.2 L9 21 L12 19.6 L9.1 13 L15 13 Z" fill="#f4f6ff" stroke="#04060f" strokeWidth={1.3} strokeLinejoin="round" />
  </svg>
);

// A crop of a page capture (box in page CSS px), shown at `k` screen px per CSS px, hard-cutting between the
// captures in `shots`. k = dsf shows the capture's own pixels 1:1.
export const UiCrop: React.FC<{ shots: Shot[]; index: number; box: Box; k: number; style?: React.CSSProperties }> = ({
  shots,
  index,
  box,
  k,
  style,
}) => {
  const vw = shots[0].viewport.width;
  const vh = shots[0].viewport.height;
  return (
    <div style={{ position: "relative", width: box.width * k, height: box.height * k, overflow: "hidden", ...style }}>
      <Stacked
        srcs={shots.map((s) => s.file)}
        index={index}
        style={{ left: -box.x * k, top: -box.y * k, width: vw * k, height: vh * k, maxWidth: "none" }}
      />
    </div>
  );
};
