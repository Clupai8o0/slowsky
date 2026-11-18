import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../../brand/tokens";
import { AiBackground } from "../kit/AiArt";
import { ramp, rand } from "../kit/anim";
import { Finish, IO, OUT, arrive } from "../kit/look";
import { HIT, SCENES } from "../timing";
import { VOL, WORLD_ORIGIN, s6Push } from "../s6/Scene";
import { Stacked, uiBlink, uiPlaying } from "../kit/Ui";

// Scene 7, a calm bridge into the end card: "Now anyone can join the hunt."
// The same night Earth and the same camera as scene 6, carried on without a break (film A). Its volunteer lights
// stay on; from HIT.now a few of them, left of the phone, lift off past the blue rim into the stars. As the scene
// opens, the real page on a phone (a 390x900 capture at 3x since r6, was 390x844; scrolled to the sky as "Skip to the sky" does, shot
// while the page's own player ran) rises in the right 40% of the frame, about 900 px tall in a plain thin frame:
// the frame lands, the capture arrives on its opaque panel, and it blinks by hard cuts at the player's own speed.
// It leaves as one object (scale and opacity) in 6 frames, gone before the end card's crossfade starts, so no
// real pixel ghosts over the end card. The painting then sinks to dark blue, out of which the end card rises.

const { from: FROM, to: TO } = SCENES.s7;
const START = s6Push(SCENES.s6.to);
const RATE = (s6Push(SCENES.s6.to) - s6Push(SCENES.s6.from)) / (SCENES.s6.to - SCENES.s6.from);

// The phone: the playing set if capture_ui.py made one (its control shows Pause), else the paused set. It is the
// subject of the right 40% of the frame: about 900 px tall with its frame, centred in that band, at rest on whole
// pixels (no drift), so its 3x capture stays sharp.
const PHONE = uiPlaying("phone", "barnard").frames;
const VW = PHONE[0].viewport.width;
const VH = PHONE[0].viewport.height;
const PAD = 9;
// r3: the capture is cropped (never repainted) at a clean row boundary: it ends 10 CSS px above the page's status
// row (`.sk-status`, the Saved copy / Go live / Copy link row; r6: just below the 900 px view, so the crop is ~890), i.e. after the
// thumbnail strip and its labels. From the manifest, so a re-capture moves the crop with the layout.
const CROP_H = Math.min(VH, Math.min(...PHONE.map((p) => p.boxes.status.y)) - 10);
const PH = 880; // screen height of the cropped capture (880 / ~800 CSS px = 1.1 screen px per CSS px, under its 3x)
const SC = PH / CROP_H;
const PW = Math.round(VW * SC);
const BAND_L = 1920 * 0.6; // the right 40% of the frame
// centred in the band, then 40 px right so the caption's line ("Now anyone can join the hunt.") keeps a clear gap
const PHX = Math.round(BAND_L + (1920 - BAND_L - (PW + PAD * 2)) / 2 + 40);
const PHY = Math.round(540 - 10 - (PH + PAD * 2) / 2);
const IN_A = FROM + 1; // it arrives with the scene: whole by FROM + 9
const IN_B = FROM + 9;
const PIX_A = FROM + 3; // the blink starts once the phone is whole
const OUT_A = TO - 8; // the phone (panel and capture together) leaves in 6 frames, gone at TO - 2, before the
const OUT_B = TO - 2; // end card's crossfade starts at TO

// Lights that rise, spread across the lit land LEFT of the phone (indices into scene 6's volunteer lights, sorted
// by x), so none rises behind it.
const CLEAR_X = PHX - 120;
const BY_X = VOL.map((v, i) => ({ ...v, i }))
  .filter((v) => v.x < CLEAR_X)
  .sort((a, b) => a.x - b.x);
const PICK = [0.06, 0.18, 0.3, 0.42, 0.54, 0.66, 0.8, 0.92].map((q) => BY_X[Math.floor(q * (BY_X.length - 1))]);
const RISERS = PICK.map((v, j) => ({
  x: v.x,
  y: v.y,
  start: HIT.now - 2 + Math.round(j * 1.5 + rand(700 + j) * 2),
  rise: 240 + rand(710 + j) * 200,
  sway: (rand(720 + j) - 0.5) * 120 - 30, // leaning left, away from the phone
}));
const RISE = 18;

export const S7: React.FC<{ f: number }> = ({ f }) => {
  const fadeIn = ramp(f, FROM, FROM + 4);
  const push = START + RATE * (f - FROM); // the same constant push as scene 6
  const sink = ramp(f, TO - 14, TO + 4, IO);

  // phone: the panel rises and lands, the capture arrives on it, blinks by hard cuts, and leaves as a whole
  const panelIn = arrive(f, IN_A, IN_B);
  // it arrives as one object (panel and capture together, 2 frames), mirroring its exit: no empty panel is shown
  const pix = 1;
  const panelO = ramp(f, IN_A, IN_A + 2);
  const gone = ramp(f, OUT_A, OUT_B, IO);
  const phoneK = (0.94 + 0.06 * panelIn) * (1 - 0.08 * gone);
  const idx = uiBlink(f, PIX_A, PHONE.length, 0);
  const phoneOn = f >= IN_A && f < OUT_B;

  return (
    <>
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${push})`, transformOrigin: WORLD_ORIGIN }}>
        <AiBackground name="bg_world" f={f} from={FROM} to={TO} zoom={[1, 1]} />
        <Finish f={f} />
        <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <defs>
            <radialGradient id="s7vol" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.acc} stopOpacity={0.8} />
              <stop offset="100%" stopColor={C.acc} stopOpacity={0} />
            </radialGradient>
            <filter id="s7soft" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation={6} />
            </filter>
            {RISERS.map((l, i) => (
              <linearGradient key={i} id={`s7trail${i}`} gradientUnits="userSpaceOnUse" x1={l.x} y1={l.y} x2={l.x + l.sway} y2={l.y - l.rise}>
                <stop offset="0%" stopColor={C.acc} stopOpacity={0} />
                <stop offset="100%" stopColor={C.acc} stopOpacity={0.9} />
              </linearGradient>
            ))}
          </defs>

          {/* scene 6's volunteer lights, still on */}
          {VOL.map((v, i) => {
            const tw = 0.6 + 0.4 * Math.sin(f * v.sp + v.tw);
            const r = v.big ? 16 : 10;
            return (
              <g key={i}>
                <circle cx={v.x} cy={v.y} r={r} fill="url(#s7vol)" opacity={tw} />
                <circle cx={v.x} cy={v.y} r={v.big ? 2.6 : 1.9} fill="#ffffff" opacity={0.7 + 0.3 * tw} />
              </g>
            );
          })}

          {/* lights lifting off into the stars */}
          {RISERS.map((l, i) => {
            if (f < l.start) {
              return null;
            }
            const p = ramp(f, l.start, l.start + RISE, OUT);
            const hx = l.x + l.sway * p;
            const hy = l.y - l.rise * p;
            const cx = l.x + l.sway * 0.1;
            const cy = l.y - l.rise * 0.6 * p;
            const trailO = 0.85 * (1 - 0.7 * ramp(f, l.start + RISE, l.start + RISE + 12));
            const tw = 0.75 + 0.25 * Math.sin(f * 0.3 + i * 1.7);
            return (
              <g key={i}>
                <path d={`M ${l.x} ${l.y} Q ${cx} ${cy} ${hx} ${hy}`} fill="none" stroke={`url(#s7trail${i})`} strokeWidth={2.5} strokeLinecap="round" opacity={trailO} />
                <circle cx={hx} cy={hy} r={12} fill={C.acc} opacity={0.6 * tw} filter="url(#s7soft)" />
                <circle cx={hx} cy={hy} r={3.4} fill={C.ink} opacity={tw} />
              </g>
            );
          })}
        </svg>
      </div>
      {/* sink to dark blue so the end card can rise */}
      <div style={{ position: "absolute", inset: 0, background: "#050a1f", opacity: 0.9 * sink }} />

    </AbsoluteFill>
      {/* the real page on a phone, in a plain thin frame (square corners, not a drawn handset); drawn outside the
          scene's fade-in, so its pixels never mix with the painting under the crossfade */}
      {phoneOn ? (
        <div
          style={{
            position: "absolute",
            left: PHX,
            top: PHY + Math.round((1 - panelIn) * 40),
            width: PW + PAD * 2,
            height: PH + PAD * 2,
            padding: PAD,
            boxSizing: "border-box",
            borderRadius: 4,
            background: "#060914",
            boxShadow: "0 0 0 1px rgba(195,206,255,.42), 0 30px 80px rgba(0,0,0,.65), 0 0 120px rgba(26,47,122,.6)",
            opacity: panelO * (1 - gone),
            transform: phoneK === 1 ? undefined : `scale(${phoneK})`,
            transformOrigin: "50% 50%",
          }}
        >
          <div style={{ position: "relative", width: PW, height: PH, overflow: "hidden", background: C.bg }}>
            {pix > 0 ? (
              <div style={{ position: "absolute", inset: 0, opacity: pix }}>
                <Stacked srcs={PHONE.map((p) => p.file)} index={idx} style={{ left: 0, top: 0, width: PW, height: VH * SC, maxWidth: "none" }} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
};
