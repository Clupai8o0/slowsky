import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import { MONO } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { COPY } from "../copy";
import { AiBackground, AiElement } from "../kit/AiArt";
import { Finish, M, T, TOP } from "../kit/look";
import { lerp, pop, ramp, rand } from "../kit/anim";
import { HIT, SCENES } from "../timing";
import { LIGHTS } from "./lights";

// Scene 6: "Volunteers found over 3,000 / brown dwarf candidates."
// bg_world (night Earth, amber cities). Volunteer lights twinkle on over the cities while a counter runs to
// 3,000+ on "thousand"; on "brown" a painted brown dwarf rises over the limb, faint lines run up to it.

const FROM = SCENES.s6.from;
const TO = SCENES.s6.to;

const VOL_A = HIT.volunteers;
const VOL_B = HIT.thousand + 4;
// Spots sit on lit city pixels of bg_world (video/experiments/s6_lights.py), never on dark land or sea.
export const VOL = LIGHTS.map(([x, y], i) => {
  return {
    x,
    y,
    at: VOL_A + Math.floor(rand(i * 13 + 6) ** 1.3 * (VOL_B - VOL_A)),
    tw: rand(i * 13 + 7) * Math.PI * 2,
    sp: 0.12 + rand(i * 13 + 8) * 0.12,
    big: rand(i * 13 + 9) > 0.85,
  };
});

// The Earth's limb (screen px): a big circle, so the dwarf can rise from behind it.
const LIMB_X = 975;
const LIMB_Y = 1956;
const LIMB_R = 1600;

// Brown dwarf
const BD_SIZE = 600; // image px; the sphere is ~63% of it
const BD_X = 1250;
const BD_Y0 = 520;
const BD_Y1 = 280;
const BD_A = HIT.brown;
const BD_B = HIT.brown + 34;

// Lines from a few volunteer lights up to the dwarf.
const LINKS = [3, 17, 29, 44, 61, 78, 96, 120].map((k, j) => ({ v: VOL[k], at: HIT.brown + 10 + j * 2 }));

// The camera on the night Earth; scene 7 carries it on from where this scene ends (same painting, same origin).
export const WORLD_ORIGIN = "55% 60%";
export const s6Push = (f: number) => lerp(f, FROM, TO, 1.02, 1.07);

const fmt = (n: number) => n.toLocaleString("en-US");

export const S6: React.FC<{ f: number }> = ({ f }) => {
  const fade = ramp(f, FROM, FROM + 6); // the cut out is a crossfade (Shell SceneGate)
  const push = s6Push(f);

  // counter
  const cT = ramp(f, VOL_A + 4, HIT.thousand, Easing.inOut(Easing.cubic));
  const cVal = Math.round((cT * 3000) / 10) * 10;
  const cText = f >= HIT.thousand ? COPY.volunteers : fmt(cVal);
  const cIn = ramp(f, VOL_A, VOL_A + 10);
  const land = pop(f, HIT.thousand, 10, 200);
  const breath = f >= HIT.thousand ? 0.5 + 0.5 * Math.sin((f - HIT.thousand) * 0.09) : 0;
  const cScale = f >= HIT.thousand ? 1 + 0.06 * Math.sin(Math.min(1, land) * Math.PI) : 1;

  // brown dwarf
  const rise = ramp(f, BD_A, BD_B, Easing.out(Easing.cubic));
  const bdY = BD_Y0 + (BD_Y1 - BD_Y0) * rise;
  const bdOp = ramp(f, BD_A, BD_A + 12);
  const bdRot = lerp(f, BD_A, TO, -6, 2);
  const bdCx = BD_X;
  const bdCy = bdY;

  const limbMask = `radial-gradient(circle ${LIMB_R}px at ${LIMB_X}px ${LIMB_Y}px, transparent ${LIMB_R - 4}px, #000 ${LIMB_R + 10}px)`;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${push})`, transformOrigin: WORLD_ORIGIN }}>
        <AiBackground name="bg_world" f={f} from={FROM} to={TO} zoom={[1, 1]} />
        <Finish f={f} />

        {/* brown dwarf, rising from behind the limb */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            maskImage: limbMask,
            WebkitMaskImage: limbMask,
            mixBlendMode: "screen",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: bdCx - BD_SIZE * 0.7,
              top: bdCy - BD_SIZE * 0.7,
              width: BD_SIZE * 1.4,
              height: BD_SIZE * 1.4,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(200,70,40,0.22) 0%, rgba(140,40,30,0.08) 45%, rgba(0,0,0,0) 70%)",
              opacity: bdOp,
            }}
          />
          <AiElement
            name="el_browndwarf"
            blend={false}
            style={{
              left: bdCx - BD_SIZE / 2,
              top: bdCy - BD_SIZE / 2,
              width: BD_SIZE,
              height: BD_SIZE,
              opacity: bdOp,
              transform: `rotate(${bdRot}deg)`,
              filter: "brightness(1.5) saturate(1.1)",
            }}
          />
        </div>

        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <radialGradient id="s6vol" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.acc} stopOpacity={0.8} />
              <stop offset="100%" stopColor={C.acc} stopOpacity={0} />
            </radialGradient>
          </defs>

          {/* lines from city lights up to the dwarf */}
          {LINKS.map((l, i) => {
            const p = ramp(f, l.at, l.at + 16, Easing.inOut(Easing.cubic));
            if (p <= 0) {
              return null;
            }
            const tx = bdCx + (l.v.x - bdCx) * 0.08;
            const ty = bdCy + BD_SIZE * 0.2;
            return (
              <line
                key={i}
                x1={l.v.x}
                y1={l.v.y}
                x2={l.v.x + (tx - l.v.x) * p}
                y2={l.v.y + (ty - l.v.y) * p}
                stroke="#ffb08a"
                strokeOpacity={0.32}
                strokeWidth={1.6}
                strokeLinecap="round"
              />
            );
          })}

          {/* volunteer lights */}
          {VOL.map((v, i) => {
            const p = pop(f, v.at, 9, 170);
            if (p <= 0) {
              return null;
            }
            const tw = 0.6 + 0.4 * Math.sin(f * v.sp + v.tw);
            const r = v.big ? 16 : 10;
            return (
              <g key={i}>
                <circle cx={v.x} cy={v.y} r={r * p} fill="url(#s6vol)" opacity={tw} />
                <circle cx={v.x} cy={v.y} r={(v.big ? 2.6 : 1.9) * Math.min(1.2, p)} fill="#ffffff" opacity={0.7 + 0.3 * tw} />
              </g>
            );
          })}
        </svg>

        {/* counter */}
        <div
          style={{
            position: "absolute",
            left: M,
            top: TOP,
            width: 700,
            fontFamily: MONO,
            fontSize: T.number,
            lineHeight: 1,
            color: C.ink,
            textShadow: `0 0 ${40 + 16 * breath}px ${C.glow}, 0 0 20px ${C.bg}`,
            fontVariantNumeric: "tabular-nums",
            opacity: cIn,
            transform: `translateY(${(1 - cIn) * 14}px) scale(${cScale})`,
            transformOrigin: "0% 50%",
          }}
        >
          {cText}
        </div>
      </div>
    </AbsoluteFill>
  );
};
