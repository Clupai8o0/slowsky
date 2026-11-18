import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import { C } from "../../brand/tokens";
import { AiBackground } from "../kit/AiArt";
import { lerp, ramp, rand } from "../kit/anim";
import { HIT, SCENES } from "../timing";
import { Stacked, uiBlink, uiFrames } from "../kit/Ui";

// Scene 7, a calm bridge into the end card. "Now anyone can join the hunt."
// The real page on a phone (a 390x844 capture at 3x, scrolled to the sky as "Skip to the sky" does) rises in a
// plain thin frame on the right on HIT.now; its picture blinks by hard cuts at the product's own speed.
// The night Earth pulls back slowly. From HIT.now, soft lights rise one by one from city clusters up past the
// blue rim into the stars, as if people everywhere are joining. Then the picture sinks to dark blue so the end
// card's sky can rise out of it.

const { from: FROM, to: TO } = SCENES.s7;
const ZOOM: [number, number] = [1.16, 1.04];
const PAN: [number, number, number, number] = [-20, 30, 0, 0];

// City clusters on bg_world, in 1920x1080 picture coordinates (the painting is 1536x864, scaled 1.25).
const CITIES = [
  { x: 590, y: 520 }, // north-west Europe
  { x: 700, y: 650 }, // Italy
  { x: 875, y: 470 }, // eastern Europe
  { x: 560, y: 690 }, // Iberia
  { x: 925, y: 660 }, // Turkey
];

const LIGHTS = CITIES.map((c, i) => ({
  ...c,
  start: HIT.now + i * 2 + Math.floor(rand(700 + i) * 2),
  rise: c.y - (130 + rand(710 + i) * 180), // px: every light ends up in the stars above the rim
  sway: (rand(720 + i) - 0.5) * 120,
}));
const RISE = 16; // frames

const PHONE = uiFrames("phone", "barnard");
const PH = 744; // screen height of the phone capture
const PW = (PH * PHONE[0].viewport.width) / PHONE[0].viewport.height;
const PAD = 9;
const PHX = 1300;
const PHY = 80;

export const S7: React.FC<{ f: number }> = ({ f }) => {
  const fadeIn = ramp(f, FROM, FROM + 6);
  const sink = ramp(f, TO - 12, TO - 1, Easing.inOut(Easing.cubic)); // towards dark blue at the end
  const phoneIn = ramp(f, HIT.now - 6, HIT.now + 12, Easing.out(Easing.cubic));
  const lift = lerp(f, HIT.now, TO + 10, 0, 18); // a slow rise that carries on into the end card's crossfade
  const idx = uiBlink(f, HIT.now + 4, PHONE.length, 0);
  const phoneOut = 1 - ramp(f, TO - 6, TO + 3, Easing.in(Easing.cubic)); // gone before the end card's sky rises

  // Same move as the painting, so the lights stay on their cities.
  const t = Math.min(1, Math.max(0, (f - FROM) / (TO - FROM)));
  const s = ZOOM[0] + (ZOOM[1] - ZOOM[0]) * t;
  const px = PAN[0] + (PAN[2] - PAN[0]) * t;
  const py = PAN[1] + (PAN[3] - PAN[1]) * t;

  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <AiBackground name="bg_world" f={f} from={FROM} to={TO} zoom={ZOOM} pan={PAN} />
      <AbsoluteFill style={{ transform: `translate(${px}px, ${py}px) scale(${s})` }}>
        <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <defs>
            <filter id="s7soft" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation={6} />
            </filter>
            {LIGHTS.map((l, i) => (
              <linearGradient
                key={i}
                id={`s7trail${i}`}
                gradientUnits="userSpaceOnUse"
                x1={l.x}
                y1={l.y}
                x2={l.x + l.sway}
                y2={l.y - l.rise}
              >
                <stop offset="0%" stopColor={C.amber} stopOpacity={0} />
                <stop offset="45%" stopColor={C.amber} stopOpacity={0.35} />
                <stop offset="100%" stopColor={C.acc} stopOpacity={0.9} />
              </linearGradient>
            ))}
          </defs>
          {LIGHTS.map((l, i) => {
            if (f < l.start) {
              return null;
            }
            const p = ramp(f, l.start, l.start + RISE, Easing.out(Easing.quad));
            const hx = l.x + l.sway * p;
            const hy = l.y - l.rise * p;
            const cx = l.x + l.sway * 0.1;
            const cy = l.y - l.rise * 0.6 * p;
            const trailO = 0.9 * (1 - 0.6 * ramp(f, l.start + RISE, l.start + RISE + 14));
            const base = ramp(f, l.start, l.start + 6) * (1 - 0.5 * ramp(f, l.start + 6, l.start + 20));
            const tw = 0.75 + 0.25 * Math.sin(f * 0.35 + i * 1.7);
            return (
              <g key={i}>
                <circle cx={l.x} cy={l.y} r={10} fill={C.amber} opacity={0.5 * base} filter="url(#s7soft)" />
                <circle cx={l.x} cy={l.y} r={2.5} fill="#ffe3b0" opacity={base} />
                <path
                  d={`M ${l.x} ${l.y} Q ${cx} ${cy} ${hx} ${hy}`}
                  fill="none"
                  stroke={`url(#s7trail${i})`}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  opacity={trailO}
                />
                <circle cx={hx} cy={hy} r={12} fill={C.acc} opacity={0.6 * tw} filter="url(#s7soft)" />
                <circle cx={hx} cy={hy} r={3.6} fill={C.ink} opacity={tw} />
              </g>
            );
          })}
        </svg>
      </AbsoluteFill>
      {/* sink towards dark blue under the phone, so the end card can rise around it */}
      <div style={{ position: "absolute", inset: 0, background: "#050a1f", opacity: 0.8 * sink }} />

      {/* the real page on a phone, in a plain thin frame (square corners, not a drawn handset) */}
      <div
        style={{
          position: "absolute",
          left: PHX,
          top: PHY + (1 - phoneIn) * 40 - lift,
          width: PW + PAD * 2,
          height: PH + PAD * 2,
          padding: PAD,
          boxSizing: "border-box",
          borderRadius: 4,
          background: "#060914",
          boxShadow: "0 0 0 1px rgba(195,206,255,.42), 0 30px 80px rgba(0,0,0,.65), 0 0 120px rgba(26,47,122,.6)",
          opacity: phoneIn * phoneOut,
          transform: `scale(${1 - 0.04 * (1 - phoneOut)})`,
        }}
      >
        <div style={{ position: "relative", width: PW, height: PH, overflow: "hidden" }}>
          <Stacked srcs={PHONE.map((p) => p.file)} index={idx} style={{ left: 0, top: 0, width: PW, height: PH }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
