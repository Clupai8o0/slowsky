import React from "react";
import { Img, staticFile } from "remotion";

// GPT Image art (public/ai/*.png): decoration only, never data. Backgrounds are 1536x864 (16:9); elements are
// painted on pure black, so they composite with mix-blend-mode "screen" (black drops out, light stays).
export type AiKey =
  | "bg_title" // Earth's night limb from orbit, stars above
  | "bg_pluto" // 1930s observatory room: lamp-lit blink comparator at left, dome and telescope at right
  | "bg_sky" // indigo nebula, blue bloom upper right; calm, for interface shots
  | "bg_survey" // Earth at left, Milky Way band sweeping diagonally, right half dark
  | "bg_world" // night-side Earth, amber city lights (Europe/Africa), blue rim, stars above
  | "bg_end" // Milky Way arch over dark hills, centre open
  | "el_telescope" // stylised telescope: three nested cones on a hexagonal body (1:1, on black)
  | "el_plates" // two aged glass plates side by side, pale with dark blotches (16:9, on black)
  | "el_browndwarf"; // red-brown banded sphere (1:1, on black)

// Slow camera move across a background: scale and pan run from `from` to `to` (film frames).
export const AiBackground: React.FC<{
  name: AiKey;
  f: number;
  from: number;
  to: number;
  zoom?: [number, number]; // scale at from / to, e.g. [1.04, 1.12]
  pan?: [number, number, number, number]; // x0, y0, x1, y1 in px
  opacity?: number;
  filter?: string;
}> = ({ name, f, from, to, zoom = [1.04, 1.1], pan = [0, 0, 0, 0], opacity = 1, filter }) => {
  const t = Math.min(1, Math.max(0, (f - from) / Math.max(1, to - from)));
  const s = zoom[0] + (zoom[1] - zoom[0]) * t;
  const x = pan[0] + (pan[2] - pan[0]) * t;
  const y = pan[1] + (pan[3] - pan[1]) * t;
  return (
    <Img
      src={staticFile(`ai/${name}.png`)}
      style={{
        position: "absolute",
        inset: 0,
        width: 1920,
        height: 1080,
        objectFit: "cover",
        transform: `translate(${x}px, ${y}px) scale(${s})`,
        opacity,
        filter,
      }}
    />
  );
};

// An element painted on black, placed and blended so only its light shows.
export const AiElement: React.FC<{ name: AiKey; style?: React.CSSProperties; blend?: boolean }> = ({
  name,
  style,
  blend = true,
}) => (
  <Img
    src={staticFile(`ai/${name}.png`)}
    style={{ position: "absolute", mixBlendMode: blend ? "screen" : undefined, ...style }}
  />
);
