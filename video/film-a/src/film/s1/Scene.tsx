import React from "react";
import { AbsoluteFill } from "remotion";
import { BODY, DISPLAY } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { COPY } from "../copy";
import { ramp } from "../kit/anim";
import { AiBackground } from "../kit/AiArt";
import { Finish, T } from "../kit/look";
import { SCENES } from "../timing";

// Scene 1, the 0.8 s cold open (no voice): Earth's night limb with a slow push, the challenge as the title and
// the team line as a small label above it. The label carries on into scene 2 (WhoLabel) and fades out there,
// so it can be read even though this scene is short.

const { from: FROM, to: TO } = SCENES.s1;

export const WHO_TOP = 384;
const WHO_SIZE = 44; // ~60% of the challenge line (T.title 72)

// The team line, also drawn by scene 2 at the same place while it fades out.
export const WhoLabel: React.FC<{ opacity: number; rise?: number }> = ({
  opacity,
  rise = 0,
}) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      top: WHO_TOP + rise,
      textAlign: "center",
      fontFamily: BODY,
      fontWeight: 400,
      fontSize: WHO_SIZE,
      lineHeight: 1.1,
      letterSpacing: "0.01em",
      color: C.acc,
      opacity,
      textShadow: "0 0 12px rgba(0,0,0,.9), 0 1px 3px rgba(0,0,0,.9)",
    }}
  >
    {COPY.who}
  </div>
);

export const S1: React.FC<{ f: number }> = ({ f }) => {
  // Both lines are on screen, fully readable, from frame 0 (the film opens on them). Only the painting fades
  // up from the page, and the challenge line's letter spacing closes a little as the camera pushes.
  const fadeIn = ramp(f, FROM - 1, FROM + 3);
  const t = ramp(f, FROM, TO);

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: fadeIn }}>
        <AiBackground
          name="bg_title"
          f={f}
          from={FROM}
          to={TO}
          zoom={[1.04, 1.08]}
          pan={[0, 0, 0, 10]}
        />
        <Finish f={f} />
      </AbsoluteFill>
      {/* both lines at full strength from frame 0, outside the painting's fade */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: WHO_TOP + 70,
          textAlign: "center",
          fontFamily: DISPLAY,
          fontWeight: 300,
          fontSize: T.title,
          color: C.ink,
          letterSpacing: `${-0.01 + (1 - t) * 0.02}em`,
          textShadow: "0 0 30px rgba(4,6,15,.9)",
        }}
      >
        {COPY.challenge}
      </div>
      {/* not faded out with the rest: it carries over into scene 2 */}
      <WhoLabel opacity={1} />
    </AbsoluteFill>
  );
};
