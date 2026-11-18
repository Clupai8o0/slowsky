import React from "react";
import { AbsoluteFill } from "remotion";
import { BODY } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { CAPTIONS } from "../captions";
import { ramp } from "./anim";

// Burned-in English captions (required by the 2026 guide), drawn once by the Shell across every cut.
// White on a dark pill, bottom centre; the word being spoken lights up.
export const Captions: React.FC<{ f: number }> = ({ f }) => {
  const c = CAPTIONS.find((x) => f >= x.from && f < x.to);
  if (!c) {
    return null;
  }
  const a = Math.min(ramp(f, c.from, c.from + 4), 1 - ramp(f, c.to - 3, c.to));
  // The shown text may differ from the spoken words (102, 3,000), so light words only when they match 1:1.
  const parts = c.text.split(" ");
  const oneToOne = parts.length === c.words.length;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 64 }}>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 500,
          fontSize: 50,
          lineHeight: 1.2,
          // No background shape (Sam: never pills): a soft dark halo keeps the words readable over any art.
          color: C.ink,
          textShadow: "0 0 18px rgba(2,4,12,0.95), 0 0 6px rgba(2,4,12,0.9), 0 2px 3px rgba(0,0,0,0.9)",
          opacity: a,
          transform: `translateY(${(1 - a) * 10}px)`,
          maxWidth: 1500,
          textAlign: "center",
        }}
      >
        {parts.map((p, i) => {
          const w = oneToOne ? c.words[i] : undefined;
          const lit = !w || f >= w.from;
          return (
            <span key={i} style={{ opacity: lit ? 1 : 0.45 }}>
              {p}
              {i < parts.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
