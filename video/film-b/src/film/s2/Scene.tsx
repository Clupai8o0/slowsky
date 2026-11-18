import React from "react";
import { AbsoluteFill, Easing, Img, staticFile } from "remotion";
import { MONO } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { AiBackground } from "../kit/AiArt";
import { GaiaRing } from "../kit/Sky";
import { lerp, pop, ramp, rand } from "../kit/anim";
import { HIT, SCENES } from "../timing";
import { WhoLabel } from "../s1/Scene";

// Scene 2. "Pluto was found / by blinking two photos."
// Beat 1 (from SCENES.s2.from): the lamp-lit blink comparator, camera pushing slowly towards it; the team label
// from scene 1 fades out. Beat 2 (after HIT.pluto): two plates rise out of the machine, fanned, and close into
// one stack by HIT.blinking. Beat 3 (HIT.blinking): they swap every HOLD frames with a faint flash; one dot jumps;
// an amber ring marks it ("moved"). Then the shot holds: the last ~20 frames add nothing, only the blink and push.

const { from: FROM, to: TO } = SCENES.s2;
const HOLD = 8;
const RING_AT = HIT.blinking + 2 * HOLD; // after two swaps, once the eye has seen the jump

// Plate size on screen and the crop of el_plates (1536x864) that holds its left plate.
const P = 500;
const SRC = { x: 88, y: 100, w: 662, h: 660 };
const K = P / SRC.w;
const CX = 960;
const CY = 460;
const INK = "#0c1024"; // star dots on a negative plate are dark

// Drawn star dots, identical on both plates. Only the mover differs (MOVE px to the right on plate B).
const DOTS = Array.from({ length: 46 }, (_, i) => ({
  x: 28 + rand(i * 7 + 11) * (P - 56),
  y: 28 + rand(i * 7 + 12) * (P - 56),
  r: 1.1 + rand(i * 7 + 13) ** 2.6 * 3.6,
  o: 0.55 + rand(i * 7 + 14) * 0.4,
})).filter((d) => Math.hypot(d.x - 360, d.y - 140) > 50);
const MOVE = 25;
const MOVER = { x: 344, y: 140 };

const Plate: React.FC<{ which: 0 | 1; flash: number }> = ({ which, flash }) => (
  <div
    style={{
      position: "absolute",
      width: P,
      height: P,
      overflow: "hidden",
      borderRadius: 3,
      background: "#000",
      boxShadow: "0 30px 70px rgba(0,0,0,.65), 0 0 40px rgba(255,190,120,.10)",
    }}
  >
    <Img
      src={staticFile("ai/el_plates.png")}
      style={{
        position: "absolute",
        left: -SRC.x * K,
        top: -SRC.y * K,
        width: 1536 * K,
        height: 864 * K,
        filter: `brightness(${1 + flash * 0.25})`,
      }}
    />
    {/* a frosted veil over the painting's galaxy-like cloud, so the plate reads as plain glass and the
        drawn star dots (and the mover) stand out; the worn edges still show around it */}
    <div
      style={{
        position: "absolute",
        inset: 22,
        borderRadius: 3,
        background: "radial-gradient(ellipse at 45% 45%, rgba(178,182,192,.9) 0%, rgba(160,164,176,.86) 60%, rgba(140,146,160,.7) 100%)",
        boxShadow: "0 0 24px 14px rgba(150,155,168,.55)",
      }}
    />
    <svg width={P} height={P} style={{ position: "absolute", inset: 0 }}>
      {DOTS.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={INK} opacity={d.o} />
      ))}
      <circle cx={MOVER.x + which * MOVE} cy={MOVER.y} r={6.5} fill={INK} />
    </svg>
  </div>
);

export const S2: React.FC<{ f: number }> = ({ f }) => {
  const fade = ramp(f, FROM, FROM + 4); // the cut out is a crossfade (Shell SceneGate)
  const who = 1 - ramp(f, FROM + 4, FROM + 24, Easing.inOut(Easing.cubic));

  // Plates rise out of the machine (lower left), fanned, then close into one stack on "blinking".
  const inA = pop(f, HIT.pluto + 8, 16, 120);
  const inB = pop(f, HIT.pluto + 13, 16, 120);
  const merge = ramp(
    f,
    HIT.blinking - 10,
    HIT.blinking,
    Easing.inOut(Easing.cubic),
  );
  const dim = ramp(f, HIT.pluto + 6, HIT.pluto + 30);

  const machine = { x: 520, y: 760 };
  const place = (k: number, fx: number, fy: number, rot: number) => {
    const x = machine.x + (fx + (CX - fx) * merge - machine.x) * Math.min(1, k);
    const y = machine.y + (fy + (CY - fy) * merge - machine.y) * Math.min(1, k);
    return {
      left: x - P / 2,
      top: y - P / 2,
      transform: `rotate(${rot * (1 - merge)}deg) scale(${0.25 + 0.75 * k})`,
      opacity: Math.min(1, k * 1.6),
    };
  };
  const a = place(inA, CX - 190, CY + 10, -5);
  const b = place(inB, CX + 190, CY - 6, 4);

  // Blink: from HIT.blinking, plate A and B alternate every HOLD frames (A first, so a swap lands on the word).
  const blinking = f >= HIT.blinking;
  const step = blinking ? Math.floor((f - HIT.blinking) / HOLD) : 0;
  const showB = !blinking || step % 2 === 1;
  const flash = blinking ? 1 - ramp(f - HIT.blinking - step * HOLD, 0, 4) : 0;

  // Camera on the plates: a slow push that keeps going through the held end.
  const push = lerp(f, HIT.blinking, TO, 1, 1.05);
  const ringX = CX - P / 2 + MOVER.x + MOVE / 2;
  const ringY = CY - P / 2 + MOVER.y;
  const year = ramp(f, HIT.blinking + 2, HIT.blinking + 12);

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: fade }}>
        <AiBackground
          name="bg_pluto"
          f={f}
          from={FROM}
          to={TO}
          zoom={[1.04, 1.28]}
          pan={[0, 0, 260, -140]}
          filter={`brightness(${1 - dim * 0.55}) blur(${dim * 4}px)`}
        />

        <AbsoluteFill
          style={{
            transform: `scale(${push})`,
            transformOrigin: `${CX}px ${CY}px`,
          }}
        >
          <div style={{ position: "absolute", ...a }}>
            <Plate which={0} flash={blinking && !showB ? flash : 0} />
          </div>
          <div
            style={{
              position: "absolute",
              ...b,
              opacity: showB ? b.opacity : 0,
            }}
          >
            <Plate which={1} flash={blinking ? flash : 0} />
          </div>

          {/* a faint flash over the stack on every swap */}
          {blinking ? (
            <div
              style={{
                position: "absolute",
                left: CX - P / 2,
                top: CY - P / 2,
                width: P,
                height: P,
                borderRadius: 3,
                background: `rgba(255,236,210,${flash * 0.12})`,
                boxShadow: `0 0 ${30 + flash * 40}px rgba(255,214,160,${0.06 + flash * 0.16})`,
              }}
            />
          ) : null}

          <GaiaRing f={f} at={RING_AT} x={ringX} y={ringY} r={34} />
          {pop(f, RING_AT) > 0 ? (
            <div
              style={{
                position: "absolute",
                left: ringX + 46,
                top: ringY - 15,
                fontFamily: MONO,
                fontSize: 24,
                color: C.amber,
                opacity: Math.min(1, pop(f, RING_AT)),
                textShadow:
                  "0 0 8px rgba(0,0,0,.95), 0 1px 3px rgba(0,0,0,.95)",
              }}
            >
              moved
            </div>
          ) : null}

          <div
            style={{
              position: "absolute",
              left: CX - P / 2,
              top: CY + P / 2 + 18,
              fontFamily: MONO,
              fontSize: 22,
              letterSpacing: "0.1em",
              color: C.muted,
              opacity: year,
            }}
          >
            1930
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
      {/* carried over from scene 1 at full strength, outside the scene fade */}
      <WhoLabel opacity={who} />
    </AbsoluteFill>
  );
};
