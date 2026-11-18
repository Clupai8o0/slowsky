import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolateColors,
  staticFile,
} from "remotion";
import { MONO } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { COPY } from "../copy";
import { AiBackground, AiElement } from "../kit/AiArt";
import { CarryFrame, Finish, IO, T, lerpRect } from "../kit/look";
import { s3ExitRect } from "../s3/Scene";
import { lerp, ramp } from "../kit/anim";
import { HIT, SCENES } from "../timing";

// Scene 4: "NASA's SPHEREx maps the sky / in 102 infrared colours."
// bg_survey (Earth at left, Milky Way band) with a slow push. The painted telescope glides along a faint orbit
// (HIT.nasa) and its scan beam widens across the sky to the right, toward the place the spectrum will form; the
// front crosses that place and leaves a pale trail of scanned light. On "colours" the trail resolves, left to
// right, into 102 thin colour bands and a counter runs to 102: nothing pops, the spectrum is the sweep resolving.

const FROM = SCENES.s4.from;
const TO = SCENES.s4.to;

// Earth in screen px (bg_survey covers 1920x1080 at 1.25x): centre and orbit radius.
const EX = 196;
const EY = 800;
const OR = 700;
const deg = (d: number) => (d * Math.PI) / 180;
const orbitAt = (a: number) => ({
  x: EX + OR * Math.cos(deg(a)),
  y: EY + OR * Math.sin(deg(a)),
});
const ARC_A = -80;
const ARC_B = -8;
const ARC = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const p = orbitAt(ARC_A + ((ARC_B - ARC_A) * i) / 60);
    pts.push(`${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
  return pts.join(" ");
})();
const TEL = 290; // telescope image size (px)

// The sweep: from just after "NASA's" until "colours". Fast out of the telescope, slowing as it crosses the
// spectrum's place (one bezier from the ease-out family).
const SWEEP_A = HIT.nasa + 8;
const SWEEP_B = HIT.colours;
const SWEEP_EASE = Easing.bezier(0.3, 0.72, 0.4, 1);

// Spectrum veil
const N = 102;
const VX0 = 1090;
const VX1 = 1790;
const VY0 = 210;
const VY1 = 520;
const VEIL_A = HIT.colours;
const VEIL_B = HIT.colours + 24;

const rampColor = (t: number) =>
  interpolateColors(
    t,
    C.ramp.map((_, i) => i / (C.ramp.length - 1)),
    C.ramp as unknown as string[],
  );
const STRIPES = Array.from({ length: N }, (_, i) => rampColor(i / (N - 1)));

// The carried frame: scene 3's picture outline, which closes onto the place the telescope appears (HIT.nasa), so
// the cut has no bare painting. Screen coords of the telescope at HIT.nasa, with this scene's push applied.
const CARRY_FROM = s3ExitRect();
const CARRY_TO = (() => {
  const tp = orbitAt(-60);
  const k = 1.02 + (1.08 - 1.02) * ((HIT.nasa - FROM) / (TO - FROM));
  const ox = 1920 * 0.3;
  const oy = 1080 * 0.45;
  const x = ox + (tp.x - ox) * k;
  const y = oy + (tp.y - oy) * k;
  const s = TEL * 0.72 * k;
  return { x: x - s / 2, y: y - s / 2, w: s, h: s };
})();

export const S4: React.FC<{ f: number }> = ({ f }) => {
  const fade = ramp(f, FROM, FROM + 10); // r4: 10 frames (was 6: the picture snapped in at 42% on its 2nd frame), matching SceneGate's 10-frame tail
  const push = lerp(f, FROM, TO, 1.02, 1.08);

  // telescope on its orbit
  const telIn = ramp(f, HIT.nasa, HIT.nasa + 14);
  const arcDraw = ramp(f, HIT.nasa, HIT.nasa + 28, Easing.inOut(Easing.cubic));
  const ang = lerp(f, HIT.nasa, TO, -60, -40);
  const tp = orbitAt(ang);
  const telRot = (ang + 90) * 0.7;
  const labelIn = ramp(f, HIT.nasa + 13, HIT.nasa + 25);

  // the scan beam: a vertical front that leaves the telescope's mouth, widens on its way to the spectrum's
  // place, then crosses it (VX0 -> VX1) by "colours"
  const mouth = {
    x: tp.x + Math.sin(deg(telRot)) * TEL * 0.3,
    y: tp.y - Math.cos(deg(telRot)) * TEL * 0.3,
  };
  const s = ramp(f, SWEEP_A, SWEEP_B, SWEEP_EASE);
  const sweeping = f >= SWEEP_A - 2 && f <= VEIL_B + 10;
  const X0 = mouth.x + 40;
  const fx = X0 + (VX1 - X0) * s;
  const reach = Math.max(0, Math.min(1, (fx - X0) / (VX0 - X0))); // 0 at the mouth, 1 at the spectrum's edge
  const VC = (VY0 + VY1) / 2;
  const front = { x: fx, y: mouth.y + (VC - mouth.y) * IO(reach) };
  const half = 36 + ((VY1 - VY0) / 2 + 16 - 36) * IO(reach);
  const frontOp =
    ramp(f, SWEEP_A - 2, SWEEP_A + 6) * (1 - ramp(f, VEIL_A, VEIL_A + 12));
  const sweepPct = (fx / 1920) * 100;
  const paintOp =
    ramp(f, SWEEP_A, SWEEP_A + 8) *
    (0.85 - 0.25 * ramp(f, SWEEP_B, SWEEP_B + 30));
  // the pale trail of scanned light inside the spectrum's place; the colour bands replace it on "colours"
  const trailW = Math.max(0, Math.min(VX1, fx) - VX0);
  const trailOp =
    ramp(f, SWEEP_A + 10, SWEEP_A + 20) * (1 - ramp(f, VEIL_A + 4, VEIL_B + 4));

  // spectrum veil
  const head = lerp(f, VEIL_A, VEIL_B, 0, N + 10);
  const count = Math.min(
    N,
    Math.max(0, Math.round(lerp(f, VEIL_A, VEIL_B, 0, N))),
  );
  const countIn = ramp(f, VEIL_A, VEIL_A + 8);
  const endsIn = ramp(f, VEIL_A + 12, VEIL_A + 24);
  const w = (VX1 - VX0) / N;

  const carry = lerpRect(CARRY_FROM, CARRY_TO, ramp(f, FROM, HIT.nasa + 1, IO));
  const carryO = 1 - ramp(f, HIT.nasa - 1, HIT.nasa + 9);
  return (
    <>
    <AbsoluteFill style={{ opacity: fade }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${push})`,
          transformOrigin: "30% 45%",
        }}
      >
        <AiBackground
          name="bg_survey"
          f={f}
          from={FROM}
          to={TO}
          zoom={[1, 1]}
        />
        <Finish f={f} />

        {/* painted Milky Way: the same art, brightened, revealed band-only behind the sweep */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: paintOp,
            maskImage: `linear-gradient(90deg, #000 0%, #000 ${sweepPct - 6}%, transparent ${sweepPct + 1}%)`,
            WebkitMaskImage: `linear-gradient(90deg, #000 0%, #000 ${sweepPct - 6}%, transparent ${sweepPct + 1}%)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              maskImage:
                "linear-gradient(42deg, transparent 36%, #000 47%, #000 56%, transparent 66%)",
              WebkitMaskImage:
                "linear-gradient(42deg, transparent 36%, #000 47%, #000 56%, transparent 66%)",
            }}
          >
            <Img
              src={staticFile("ai/bg_survey.png")}
              style={{
                position: "absolute",
                inset: 0,
                width: 1920,
                height: 1080,
                objectFit: "cover",
                mixBlendMode: "screen",
                filter: "brightness(1.5) saturate(1.5) hue-rotate(-12deg)",
              }}
            />
          </div>
        </div>

        <svg
          width={1920}
          height={1080}
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <linearGradient
              id="s4front"
              gradientUnits="userSpaceOnUse"
              x1={front.x}
              y1={front.y - half}
              x2={front.x}
              y2={front.y + half}
            >
              <stop offset="0%" stopColor={C.acc} stopOpacity={0} />
              <stop offset="50%" stopColor="#ffffff" stopOpacity={0.9} />
              <stop offset="100%" stopColor={C.acc} stopOpacity={0} />
            </linearGradient>
            <linearGradient
              id="s4beam"
              gradientUnits="userSpaceOnUse"
              x1={mouth.x}
              y1={mouth.y}
              x2={front.x}
              y2={front.y}
            >
              <stop offset="0%" stopColor={C.acc} stopOpacity={0.55} />
              <stop offset="100%" stopColor={C.acc} stopOpacity={0.16} />
            </linearGradient>
            <filter id="s4soft" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={8} />
            </filter>
            <filter id="s4haze" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation={3} />
            </filter>
            <linearGradient id="s4veil" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity={0} />
              <stop offset="30%" stopColor="#fff" stopOpacity={1} />
              <stop offset="70%" stopColor="#fff" stopOpacity={1} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </linearGradient>
            <mask
              id="s4veilmask"
              maskUnits="userSpaceOnUse"
              x={VX0 - 20}
              y={VY0 - 20}
              width={VX1 - VX0 + 40}
              height={VY1 - VY0 + 40}
            >
              <rect
                x={VX0 - 20}
                y={VY0}
                width={VX1 - VX0 + 40}
                height={VY1 - VY0}
                fill="url(#s4veil)"
              />
            </mask>
          </defs>

          {/* faint orbit */}
          <path
            d={ARC}
            fill="none"
            stroke={C.acc}
            strokeOpacity={0.28}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeDasharray="2 10"
            pathLength={1000}
            style={{ strokeDashoffset: 0 }}
            opacity={arcDraw}
          />

          {/* scan beam and front */}
          {sweeping ? (
            <g opacity={frontOp}>
              <path
                d={`M${mouth.x},${mouth.y} L${front.x},${front.y - half * 0.9} L${front.x},${front.y + half * 0.9} Z`}
                fill="url(#s4beam)"
                filter="url(#s4soft)"
                opacity={0.95}
              />
              <line
                x1={front.x}
                y1={front.y - half}
                x2={front.x}
                y2={front.y + half}
                stroke="url(#s4front)"
                strokeWidth={10}
                filter="url(#s4soft)"
              />
              <line
                x1={front.x}
                y1={front.y - half}
                x2={front.x}
                y2={front.y + half}
                stroke="url(#s4front)"
                strokeWidth={1.6}
              />
            </g>
          ) : null}

          {/* the trail of scanned light the front leaves where the spectrum will form */}
          {trailW > 0 && trailOp > 0 ? (
            <g mask="url(#s4veilmask)" opacity={trailOp}>
              <rect
                x={VX0}
                y={VY0}
                width={trailW}
                height={VY1 - VY0}
                fill={C.acc}
                opacity={0.12}
                filter="url(#s4haze)"
              />
              {Array.from(
                { length: Math.floor(trailW / ((VX1 - VX0) / N)) },
                (_, i) => (
                  <rect
                    key={i}
                    x={VX0 + i * ((VX1 - VX0) / N) + 1.6}
                    y={VY0 + 40}
                    width={1.6}
                    height={VY1 - VY0 - 80}
                    fill={C.ink}
                    opacity={0.16}
                  />
                ),
              )}
            </g>
          ) : null}

          {/* spectrum veil: 102 thin bands */}
          {f >= VEIL_A ? (
            <g mask="url(#s4veilmask)" style={{ mixBlendMode: "screen" }}>
              <g filter="url(#s4haze)" opacity={0.18}>
                {STRIPES.map((col, i) => {
                  const g = Math.max(0, Math.min(1, (head - i) / 8));
                  return g > 0 ? (
                    <rect
                      key={i}
                      x={VX0 + i * w}
                      y={VY0}
                      width={w}
                      height={VY1 - VY0}
                      fill={col}
                      opacity={g}
                    />
                  ) : null;
                })}
              </g>
              {STRIPES.map((col, i) => {
                const g = Math.max(0, Math.min(1, (head - i) / 8));
                if (g <= 0) {
                  return null;
                }
                const shimmer = 0.75 + 0.25 * Math.sin(f * 0.12 + i * 0.35);
                const h = (VY1 - VY0) * (0.4 + 0.6 * g);
                return (
                  <rect
                    key={i}
                    x={VX0 + i * w + w * 0.25}
                    y={(VY0 + VY1) / 2 - h / 2}
                    width={w * 0.5}
                    height={h}
                    fill={col}
                    opacity={g * shimmer}
                  />
                );
              })}
            </g>
          ) : null}
        </svg>

        {/* the telescope */}
        <AiElement
          name="el_telescope"
          style={{
            left: tp.x - TEL / 2,
            top: tp.y - TEL / 2,
            width: TEL,
            height: TEL,
            opacity: telIn,
            transform: `rotate(${telRot}deg)`,
            filter: "brightness(1.35)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: tp.x + TEL * 0.42,
            top: tp.y - 14,
            fontFamily: MONO,
            fontSize: 22,
            letterSpacing: 4,
            color: C.acc,
            opacity: labelIn * 0.85,
            transform: `translateX(${(1 - labelIn) * -10}px)`,
            textShadow: `0 0 12px ${C.bg}`,
          }}
        >
          SPHEREx
        </div>

        {/* wavelength ends and the counter */}
        {[
          {
            text: "0.75 µm",
            left: VX0,
            align: "left" as const,
            color: rampColor(0),
          },
          {
            text: "5.0 µm",
            left: VX1 - 200,
            align: "right" as const,
            color: rampColor(1),
          },
        ].map((l) => (
          <div
            key={l.text}
            style={{
              position: "absolute",
              left: l.left,
              top: VY1 + 10,
              width: 200,
              textAlign: l.align,
              fontFamily: MONO,
              fontSize: 24,
              color: l.color,
              opacity: endsIn,
              transform: `translateY(${(1 - endsIn) * 8}px)`,
            }}
          >
            {l.text}
          </div>
        ))}
        <div
          style={{
            position: "absolute",
            left: (VX0 + VX1) / 2 - 250,
            top: VY1 + 50,
            width: 500,
            textAlign: "center",
            fontFamily: MONO,
            fontSize: T.number,
            lineHeight: 1,
            color: C.ink,
            textShadow: `0 0 40px ${C.glow}, 0 0 18px ${C.bg}`,
            fontVariantNumeric: "tabular-nums",
            opacity: countIn,
          }}
        >
          {f >= VEIL_B ? COPY.colours : String(count)}
        </div>
      </div>
    </AbsoluteFill>
    {/* drawn outside this scene's fade: it is already whole when the cut starts */}
    {f < HIT.nasa + 9 ? <CarryFrame r={carry} o={carryO} kind="line" /> : null}
    </>
  );
};
