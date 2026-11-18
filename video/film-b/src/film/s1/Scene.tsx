import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import { DISPLAY, MONO } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { COPY } from "../copy";
import { ramp } from "../kit/anim";
import { AiBackground } from "../kit/AiArt";
import { SCENES } from "../timing";

// Scene 1, the 0.8 s cold open (no voice): Earth's night limb with a slow push, the challenge as the title and
// the team line as a small label above it. The label carries on into scene 2 (WhoLabel) and fades out there,
// so it can be read even though this scene is short.

const { from: FROM, to: TO } = SCENES.s1;

export const WHO_TOP = 372;

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
      fontFamily: MONO,
      fontSize: 28,
      letterSpacing: "0.08em",
      color: C.acc,
      opacity,
      textShadow: "0 0 12px rgba(0,0,0,.9), 0 1px 3px rgba(0,0,0,.9)",
    }}
  >
    {COPY.who}
  </div>
);

export const S1: React.FC<{ f: number }> = ({ f }) => {
  const fadeIn = ramp(f, FROM, FROM + 3);
  const fadeOut = 1 - ramp(f, TO - 4, TO, Easing.in(Easing.cubic));

  // Title settles in over the first 8 frames: blur clears, letter spacing closes.
  const t = ramp(f, FROM, FROM + 7);
  const who = ramp(f, FROM, FROM + 4);

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
        <AiBackground
          name="bg_title"
          f={f}
          from={FROM}
          to={TO}
          zoom={[1.04, 1.08]}
          pan={[0, 0, 0, 10]}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: WHO_TOP + 52,
            textAlign: "center",
            fontFamily: DISPLAY,
            fontWeight: 300,
            fontSize: 80,
            color: C.ink,
            letterSpacing: `${-0.01 + (1 - t) * 0.08}em`,
            opacity: t,
            filter: `blur(${(1 - t) * 8}px)`,
            transform: `translateY(${(1 - t) * 14}px)`,
            textShadow: "0 0 30px rgba(4,6,15,.9)",
          }}
        >
          {COPY.challenge}
        </div>
      </AbsoluteFill>
      {/* not faded out with the rest: it carries over into scene 2 */}
      <WhoLabel opacity={who} rise={(1 - who) * 10} />
    </AbsoluteFill>
  );
};
