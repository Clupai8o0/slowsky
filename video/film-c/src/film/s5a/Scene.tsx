import React from "react";
import { AbsoluteFill } from "remotion";
import { BODY, MONO } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { COPY } from "../copy";
import { AiBackground } from "../kit/AiArt";
import { lerp, ramp } from "../kit/anim";
import {
  HALO,
  Finish,
  IO,
  LandingRing,
  M,
  T,
  TOP,
  Ticks,
  arrive,
  glide,
} from "../kit/look";
import { SKY_FRAMES, SkyFrame, SkyKey } from "../kit/Sky";
import { HIT, SCENES } from "../timing";

// Scene 5, the proof: "These are real SPHEREx pixels."
// Beat 1 (HIT.these): the spectrum block of scene 4 becomes one big tile of real pixels (RW Aurigae), which
// starts to blink with hard cuts, as the product does. Beat 2 (HIT.real): the label lands, an amber ring closes in
// on the star and hands over to the product's own Gaia ring, the brightness meter climbs to x1.5. Beat 3
// ("SPHEREx"): two more targets arrive at the left. The last ~20 frames only blink and drift.
// Pixels are never tinted or smoothed, and sit above the grain and vignette.

const { from: FROM, to: TO } = SCENES.s5;
const HOLD = 8; // frames per blink frame

// Hero tile (right) and where it starts: the spectrum block of scene 4, as it sits on screen at its last frame.
const HERO = 660;
const HX = 1920 - M - HERO; // 1080
const HY = TOP;
const START = { cx: 1500, cy: 360, size: 330 };
const END = { cx: HX + HERO / 2, cy: HY + HERO / 2, size: HERO };

// The product's Gaia ring sits at the centre of each capture (measured on the 784 px frames: r ~ 14 px).
const RING = { x: 0.5, y: 0.503, r: 0.019 };

// Small tiles (left column, under the hero's label).
const SMALL = 270;
const SY = 470;
const SAT = HIT.real + 9; // "SPHEREx"
type Small = { sky: SkyKey; x: number; at: number; label: string };
const SMALLS: Small[] = [
  { sky: "barnard", x: M, at: SAT, label: COPY.barnard },
  { sky: "wise", x: M + SMALL + 70, at: SAT + 5, label: COPY.wise },
];

const split = (text: string) => {
  const i = text.indexOf(":");
  return i >= 0 ? [text.slice(0, i), text.slice(i + 1).trim()] : [text, ""];
};

// Which frame a tile shows: frame 0 until `at`, then hard cuts every HOLD frames.
const frameAt = (f: number, at: number, n: number) =>
  f < at ? 0 : Math.floor((f - at) / HOLD) % n;

// A framed tile of real pixels. The panel (opaque black) carries the opacity `o` and the exit scale `k`; the
// pixels fade only against that panel (`po`), never against a painting. The ticks carry across the cut.
const Tile: React.FC<{
  sky: SkyKey;
  size: number;
  index: number;
  o: number;
  po: number;
  k: number;
  ticks: number;
}> = ({ sky, size, index, o, po, k, ticks }) => (
  <div style={{ position: "absolute", inset: 0 }}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#000",
        lineHeight: 0,
        opacity: o,
        transform: `scale(${k})`,
        boxShadow:
          "0 0 0 1px rgba(195,206,255,.4), 0 30px 80px rgba(0,0,0,.55)",
      }}
    >
      {po > 0 ? (
        <div style={{ opacity: po }}>
          <SkyFrame sky={sky} size={size} f={0} index={index} />
        </div>
      ) : null}
    </div>
    <Ticks size={size} o={ticks} />
  </div>
);

export const S5: React.FC<{ f: number }> = ({ f }) => {
  const fade = arrive(f, FROM, FROM + 6);
  // camera: one slow, constant drift and push over the whole scene
  const cam = `translate(${lerp(f, FROM, TO + 10, 10, -10)}px, ${lerp(f, FROM, TO + 10, 4, -4)}px) scale(${lerp(f, FROM, TO + 10, 1, 1.03)})`;

  // hero: glides out of the spectrum block into place, landing on "These"
  const g = glide(f, FROM, HIT.these + 2);
  const cx = START.cx + (END.cx - START.cx) * g;
  const cy = START.cy + (END.cy - START.cy) * g;
  const size = START.size + (END.size - START.size) * g;
  const heroIdx = frameAt(f, HIT.these, SKY_FRAMES.rwaur);
  const ticks = arrive(f, HIT.these - 2, HIT.these + 8);
  // Exit before the crossfade into scene 6 (Shell, from TO): pixels fade into their panels, then the panels go
  // as whole objects; only the corner ticks carry across the cut.
  const pixOut = 1 - ramp(f, TO - 8, TO - 5);
  const panelOut = 1 - ramp(f, TO - 5, TO - 1);
  const exitK = 1 - 0.06 * ramp(f, TO - 8, TO - 1);
  const bloom = (0.4 + 0.6 * g) * panelOut;
  // the hero's pixels arrive once this scene is fully over scene 4 (its fade ends at FROM + 6)
  const heroPix = arrive(f, FROM + 6, FROM + 12) * pixOut;

  // labels and meter
  const badge = arrive(f, HIT.real - 2, HIT.real + 8);
  const head = arrive(f, HIT.these + 2, HIT.these + 14);
  // the meter never shows before its line ("about 1.5× brighter in a year") is fully in
  const meterIn = arrive(f, HIT.these + 14, HIT.these + 22);
  const mg = lerp(f, HIT.real + 2, HIT.real + 30, 0, 1);
  const mv = 1 + 0.5 * IO(mg);
  const gaia = arrive(f, HIT.real, HIT.real + 8) * pixOut;
  const counterIn = arrive(f, HIT.these + 4, HIT.these + 12) * pixOut;
  const [rwHead, rwRest] = split(COPY.rwaur);
  const meterEnd = rwRest.split(" ").slice(0, 2).join(" "); // "about 1.5×", word for word from the line above

  const ringX = HX + RING.x * HERO;
  const ringY = HY + RING.y * HERO;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AiBackground
        name="bg_sky"
        f={f}
        from={FROM}
        to={TO}
        zoom={[1.06, 1.12]}
        pan={[10, 0, -20, -8]}
        opacity={0.38}
      />
      <Finish f={f} />
      <AbsoluteFill style={{ transform: cam, transformOrigin: "60% 45%" }}>
        {/* a soft blue bloom behind the hero, as in the product's player */}
        <div
          style={{
            position: "absolute",
            left: cx - size,
            top: cy - size,
            width: size * 2,
            height: size * 2,
            background: `radial-gradient(closest-side, ${C.glow}cc, rgba(26,47,122,0))`,
            opacity: bloom,
          }}
        />

        {/* hero tile */}
        <div
          style={{
            position: "absolute",
            left: cx - size / 2,
            top: cy - size / 2,
            width: size,
            height: size,
          }}
        >
          <Tile
            sky="rwaur"
            size={size}
            index={heroIdx}
            o={Math.min(1, g * 1.6) * panelOut}
            po={heroPix}
            k={exitK}
            ticks={ticks}
          />
        </div>
        <LandingRing
          f={f}
          at={HIT.real + 2}
          x={ringX}
          y={ringY}
          r0={150}
          r1={RING.r * HERO}
        />
        <div
          style={{
            position: "absolute",
            left: ringX + 30,
            top: ringY - 56,
            fontFamily: MONO,
            fontSize: T.small,
            color: C.amber,
            opacity: gaia,
            transform: `translateY(${(1 - gaia) * 6}px)`,
            textShadow: HALO,
          }}
        >
          Gaia
        </div>
        {/* frame counter over the hero's top right corner */}
        <div
          style={{
            position: "absolute",
            left: HX,
            width: HERO,
            top: HY - 46,
            textAlign: "right",
            fontFamily: MONO,
            fontSize: T.small,
            letterSpacing: "0.04em",
            color: C.acc,
            opacity: counterIn,
          }}
        >
          {`frame ${heroIdx + 1} / ${SKY_FRAMES.rwaur}`}
        </div>

        {/* left column: the label, the hero's name and its meter */}
        <div
          style={{
            position: "absolute",
            left: M,
            top: TOP,
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: MONO,
            fontSize: T.label,
            letterSpacing: "0.04em",
            color: C.ink,
            opacity: badge,
            transform: `translateY(${(1 - badge) * -10}px)`,
            textShadow: HALO,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              background: C.acc,
              boxShadow: `0 0 14px ${C.acc}`,
            }}
          />
          {COPY.real}
        </div>
        <div
          style={{
            position: "absolute",
            left: M,
            top: TOP + 62,
            width: HX - M - 80,
            opacity: head,
            transform: `translateY(${(1 - head) * 12}px)`,
            textShadow: HALO,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontSize: T.body,
              fontWeight: 500,
              color: C.ink,
              lineHeight: 1.2,
            }}
          >
            {rwHead}
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontSize: T.sub,
              fontWeight: 300,
              color: C.muted,
              lineHeight: 1.4,
            }}
          >
            {rwRest}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: M,
            top: TOP + 196,
            width: 460,
            height: 40,
            opacity: meterIn,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 14,
              width: 360,
              height: 10,
              borderRadius: 0,
              background: "rgba(195,206,255,.1)",
              boxShadow: "inset 0 0 0 1px rgba(195,206,255,.28)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 14,
              width: 360 * (mv / 1.5),
              height: 10,
              borderRadius: 0,
              background: `linear-gradient(90deg, ${C.acc}, ${C.ink})`,
              boxShadow: `0 0 ${8 + 12 * mg}px rgba(195,206,255,${0.35 + 0.4 * mg})`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 240 - 1,
              top: 6,
              width: 2,
              height: 26,
              background: C.muted,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 384,
              top: 0,
              fontFamily: MONO,
              fontSize: T.label,
              lineHeight: "38px",
              color: C.ink,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {meterEnd}
          </div>
        </div>

        {/* two more targets */}
        {SMALLS.map((s) => {
          const a = arrive(f, s.at, s.at + 12);
          const [h, rest] = split(s.label);
          return (
            <React.Fragment key={s.sky}>
              <div
                style={{
                  position: "absolute",
                  left: s.x,
                  top: SY,
                  width: SMALL,
                  height: SMALL,
                  transform: `translateY(${(1 - a) * 30}px)`,
                }}
              >
                <Tile
                  sky={s.sky}
                  size={SMALL}
                  index={frameAt(f, s.at, SKY_FRAMES[s.sky])}
                  o={arrive(f, s.at, s.at + 5) * panelOut}
                  po={arrive(f, s.at + 4, s.at + 8) * pixOut}
                  k={exitK}
                  ticks={a}
                />
              </div>
              <div
                style={{
                  position: "absolute",
                  left: s.x,
                  top: SY + SMALL + 18,
                  width: SMALL + 90,
                  opacity: arrive(f, s.at + 4, s.at + 14),
                  fontFamily: BODY,
                  fontSize: T.small,
                  lineHeight: 1.3,
                  textShadow: HALO,
                }}
              >
                <div style={{ color: C.ink, fontWeight: 500 }}>{h}</div>
                <div style={{ color: C.muted, fontWeight: 300 }}>{rest}</div>
              </div>
            </React.Fragment>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
