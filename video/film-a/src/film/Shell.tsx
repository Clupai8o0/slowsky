import React from "react";
import { AbsoluteFill, getInputProps, interpolate, useCurrentFrame } from "remotion";
import { BODY, MONO } from "../brand/fonts";
import { C } from "../brand/tokens";
import { COPY } from "./copy";
import { Captions } from "./kit/Captions";
import { Starfield } from "./kit/Sky";
import { SCENES, SceneId } from "./timing";

const MASTER = Boolean((getInputProps() as { master?: boolean }).master);

// The page every scene is drawn on: the background, a drifting starfield behind every scene, and on top the
// burned-in captions and the style-test mark. Scenes draw only their own layer between those.
export const FilmShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Starfield f={f} />
      {children}
      <Captions f={f} />
      {/* The draft mark: on in drafts and scene renders, off in the master (render.sh master passes master: true). */}
      {MASTER ? null : (
        <div style={{ position: "absolute", right: 24, top: 18, fontFamily: MONO, fontSize: 18, color: "rgba(255,255,255,.4)" }}>
          {COPY.test}
        </div>
      )}
      {/* Space Apps guide: SI-generated images and video must carry a visible watermark. Always on, 26 px, one line
          in the top 60 px, naming both models (Sam, 15 Nov), on a soft corner shade (a gradient, no box) so a bright
          painting never washes it out. Geist, not Geist Mono: the mono line would run too long at this size. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1400,
          height: 150,
          background: "radial-gradient(ellipse 100% 100% at 0% 0%, rgba(2,4,12,.62) 0%, rgba(2,4,12,.38) 45%, rgba(2,4,12,0) 100%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 24,
          top: 14,
          height: 34,
          lineHeight: "34px",
          fontFamily: BODY,
          fontWeight: 500,
          fontSize: 26,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          color: "rgba(236,239,255,.92)",
          textShadow: "0 0 10px rgba(0,0,0,.85), 0 1px 3px rgba(0,0,0,.95)",
        }}
      >
        {COPY.ai}
      </div>
    </AbsoluteFill>
  );
};

// Every cut is a push-through crossfade: the outgoing scene stays mounted OVER frames past its end, under the
// next scene (drawn on top, fading in), and keeps moving forward (a small push) while it fades, so the camera
// never stops and the cut never dips to the dark page.
const OVER = 10;
const CROSS: SceneId[] = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
// s6 hands over to s7 on the same painting with the same camera, so it fades without the push.
const STILL: SceneId[] = ["s6"];

// Mounts a scene inside its own frames (plus the crossfade tail).
export const SceneGate: React.FC<{ id: SceneId; children: React.ReactNode }> = ({ id, children }) => {
  const f = useCurrentFrame();
  const s = SCENES[id];
  if (f >= s.from && f < s.to) {
    return <>{children}</>;
  }
  if (CROSS.includes(id) && f >= s.to && f < s.to + OVER) {
    const o = interpolate(f, [s.to + 2, s.to + OVER], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const k = interpolate(f, [s.to - 1, s.to + OVER], [1, STILL.includes(id) ? 1 : 1.035], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return <AbsoluteFill style={{ opacity: o, transform: `scale(${k})`, transformOrigin: "50% 46%" }}>{children}</AbsoluteFill>;
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
