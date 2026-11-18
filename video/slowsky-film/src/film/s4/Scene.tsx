import React from "react";
import { AbsoluteFill, Easing, Img, interpolateColors, staticFile } from "remotion";
import { MONO } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { COPY } from "../copy";
import { AiBackground, AiElement } from "../kit/AiArt";
import { lerp, ramp } from "../kit/anim";
import { HIT, SCENES } from "../timing";

// Scene 4: "NASA's SPHEREx maps the sky / in 102 infrared colours."
// bg_survey (Earth at left, Milky Way band) with a slow push. The painted telescope glides along a faint orbit,
// a soft sweep paints the Milky Way, then 102 thin colour bands veil the dark sky and a counter runs to 102.

const FROM = SCENES.s4.from;
const TO = SCENES.s4.to;

// Earth in screen px (bg_survey covers 1920x1080 at 1.25x): centre and orbit radius.
const EX = 196;
const EY = 800;
const OR = 700;
const deg = (d: number) => (d * Math.PI) / 180;
const orbitAt = (a: number) => ({ x: EX + OR * Math.cos(deg(a)), y: EY + OR * Math.sin(deg(a)) });
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
const TEL = 250; // telescope image size (px)

// Milky Way axis in screen px, and the sweep's gradient positions (132deg gradient, see the mask below).
const MW_A = { x: 380, y: 0 };
const MW_B = { x: 1500, y: 1000 };
const SWEEP_A = HIT.nasa + 26;
const SWEEP_B = HIT.colours - 2;

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
    C.ramp as unknown as string[]
  );
const STRIPES = Array.from({ length: N }, (_, i) => rampColor(i / (N - 1)));

export const S4: React.FC<{ f: number }> = ({ f }) => {
  const fade = ramp(f, FROM, FROM + 6); // the cut out is a crossfade (Shell SceneGate)
  const push = lerp(f, FROM, TO, 1.02, 1.08);

  // telescope on its orbit
  const telIn = ramp(f, HIT.nasa, HIT.nasa + 14);
  const arcDraw = ramp(f, HIT.nasa, HIT.nasa + 28, Easing.inOut(Easing.cubic));
  const ang = lerp(f, HIT.nasa, TO, -60, -40);
  const tp = orbitAt(ang);
  const telRot = (ang + 90) * 0.7;
  const labelIn = ramp(f, HIT.nasa + 13, HIT.nasa + 25);

  // sweep along the Milky Way
  const s = ramp(f, SWEEP_A, SWEEP_B, Easing.inOut(Easing.sin));
  const sweeping = f >= SWEEP_A - 2 && f <= SWEEP_B + 8;
  const sweepPct = 8 + 82 * s; // % along the 132deg gradient line
  const front = { x: MW_A.x + (MW_B.x - MW_A.x) * (0.03 + 0.97 * s), y: MW_A.y + (MW_B.y - MW_A.y) * (0.03 + 0.97 * s) };
  const frontOp = ramp(f, SWEEP_A - 2, SWEEP_A + 6) * (1 - ramp(f, SWEEP_B - 4, SWEEP_B + 8));
  const paintOp = ramp(f, SWEEP_A, SWEEP_A + 8) * (0.85 - 0.25 * ramp(f, SWEEP_B, SWEEP_B + 30));
  // perpendicular to the band, for the front line and beam footprint
  const nx = -0.666;
  const ny = 0.746;
  const half = 170;
  const mouth = { x: tp.x + Math.sin(deg(telRot)) * TEL * 0.3, y: tp.y - Math.cos(deg(telRot)) * TEL * 0.3 };

  // spectrum veil
  const head = lerp(f, VEIL_A, VEIL_B, 0, N + 10);
  const count = Math.min(N, Math.max(0, Math.round(lerp(f, VEIL_A, VEIL_B, 0, N))));
  const countIn = ramp(f, VEIL_A, VEIL_A + 8);
  const endsIn = ramp(f, VEIL_A + 12, VEIL_A + 24);
  const w = (VX1 - VX0) / N;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${push})`, transformOrigin: "30% 45%" }}>
        <AiBackground name="bg_survey" f={f} from={FROM} to={TO} zoom={[1, 1]} />

        {/* painted Milky Way: the same art, brightened, revealed band-only behind the sweep */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: paintOp,
            maskImage: `linear-gradient(132deg, #000 0%, #000 ${sweepPct - 6}%, transparent ${sweepPct + 2}%)`,
            WebkitMaskImage: `linear-gradient(132deg, #000 0%, #000 ${sweepPct - 6}%, transparent ${sweepPct + 2}%)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              maskImage: "linear-gradient(42deg, transparent 36%, #000 47%, #000 56%, transparent 66%)",
              WebkitMaskImage: "linear-gradient(42deg, transparent 36%, #000 47%, #000 56%, transparent 66%)",
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

        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <linearGradient id="s4front" gradientUnits="userSpaceOnUse" x1={front.x - nx * half} y1={front.y - ny * half} x2={front.x + nx * half} y2={front.y + ny * half}>
              <stop offset="0%" stopColor={C.acc} stopOpacity={0} />
              <stop offset="50%" stopColor="#ffffff" stopOpacity={0.9} />
              <stop offset="100%" stopColor={C.acc} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="s4beam" gradientUnits="userSpaceOnUse" x1={mouth.x} y1={mouth.y} x2={front.x} y2={front.y}>
              <stop offset="0%" stopColor={C.acc} stopOpacity={0.4} />
              <stop offset="100%" stopColor={C.acc} stopOpacity={0.05} />
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
            <mask id="s4veilmask" maskUnits="userSpaceOnUse" x={VX0 - 20} y={VY0 - 20} width={VX1 - VX0 + 40} height={VY1 - VY0 + 40}>
              <rect x={VX0 - 20} y={VY0} width={VX1 - VX0 + 40} height={VY1 - VY0} fill="url(#s4veil)" />
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
                d={`M${mouth.x},${mouth.y} L${front.x - nx * half * 0.9},${front.y - ny * half * 0.9} L${front.x + nx * half * 0.9},${front.y + ny * half * 0.9} Z`}
                fill="url(#s4beam)"
                filter="url(#s4soft)"
                opacity={0.55}
              />
              <line
                x1={front.x - nx * half}
                y1={front.y - ny * half}
                x2={front.x + nx * half}
                y2={front.y + ny * half}
                stroke="url(#s4front)"
                strokeWidth={10}
                filter="url(#s4soft)"
              />
              <line
                x1={front.x - nx * half}
                y1={front.y - ny * half}
                x2={front.x + nx * half}
                y2={front.y + ny * half}
                stroke="url(#s4front)"
                strokeWidth={1.6}
              />
            </g>
          ) : null}

          {/* spectrum veil: 102 thin bands */}
          {f >= VEIL_A ? (
            <g mask="url(#s4veilmask)" style={{ mixBlendMode: "screen" }}>
              <g filter="url(#s4haze)" opacity={0.18}>
                {STRIPES.map((col, i) => {
                  const g = Math.max(0, Math.min(1, (head - i) / 8));
                  return g > 0 ? (
                    <rect key={i} x={VX0 + i * w} y={VY0} width={w} height={VY1 - VY0} fill={col} opacity={g} />
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
          { text: "0.75 µm", left: VX0, align: "left" as const, color: rampColor(0) },
          { text: "5.0 µm", left: VX1 - 200, align: "right" as const, color: rampColor(1) },
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
            fontSize: 132,
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
  );
};
