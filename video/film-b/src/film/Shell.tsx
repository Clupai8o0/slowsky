import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { MONO } from "../brand/fonts";
import { C } from "../brand/tokens";
import { COPY } from "./copy";
import { Captions } from "./kit/Captions";
import { Starfield } from "./kit/Sky";
import { SCENES, SceneId } from "./timing";

// The page every scene is drawn on: the background, a drifting starfield behind every scene, and on top the
// burned-in captions and the style-test mark. Scenes draw only their own layer between those.
export const FilmShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Starfield f={f} />
      {children}
      <Captions f={f} />
      <div style={{ position: "absolute", right: 24, top: 18, fontFamily: MONO, fontSize: 18, color: "rgba(255,255,255,.4)" }}>
        {COPY.test}
      </div>
      {/* Space Apps guide: SI-generated images and video must carry a visible watermark. Always on. */}
      <div style={{ position: "absolute", left: 24, top: 18, fontFamily: MONO, fontSize: 18, color: "rgba(233,236,255,.62)", textShadow: "0 1px 3px rgba(0,0,0,.9)" }}>
        {COPY.ai}
      </div>
    </AbsoluteFill>
  );
};

// Scenes whose cut out is a crossfade: they stay mounted OVER frames past their end, under the next scene
// (drawn on top, fading in), and fade away there, so the cut never dips to the dark page. s1 fades to dark
// on purpose (the title); s7 crossfades so its phone carries into the end card.
const OVER = 10;
const CROSS: SceneId[] = ["s2", "s3", "s4", "s5", "s6", "s7"];

// Mounts a scene inside its own frames (plus the crossfade tail).
export const SceneGate: React.FC<{ id: SceneId; children: React.ReactNode }> = ({ id, children }) => {
  const f = useCurrentFrame();
  const s = SCENES[id];
  if (f >= s.from && f < s.to) {
    return <>{children}</>;
  }
  if (CROSS.includes(id) && f >= s.to && f < s.to + OVER) {
    const o = interpolate(f, [s.to + 2, s.to + OVER], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
  }
  return null;
};

// A scene is drawn from the film frame f, never from a frame counted from its own start, so its numbers
// match timing.ts and the contact sheets.
export type SceneView = React.FC<{ f: number }>;

export const soloScene = (id: SceneId, View: SceneView): React.FC => {
  const Solo: React.FC = () => {
    const f = useCurrentFrame();
    return (
      <FilmShell>
        <SceneGate id={id}>
          <View f={f} />
        </SceneGate>
      </FilmShell>
    );
  };
  return Solo;
};
