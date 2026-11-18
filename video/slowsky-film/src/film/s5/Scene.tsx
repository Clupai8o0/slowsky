import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import { BODY, MONO } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { COPY } from "../copy";
import { AiBackground } from "../kit/AiArt";
import { lerp, pop, ramp } from "../kit/anim";
import { SkyFrame, SkyKey } from "../kit/Sky";
import { HIT, SCENES } from "../timing";

// Scene 5: the proof beat. Three framed panels of real SPHEREx pixels arrive on "These" and settle, a square
// label lands on "real", a "Gaia" tag names the product's own amber rings (in the captures), RW Aurigae's meter climbs, then the panels only blink.
// Pixels are shown untinted (WISE 0855 in plain grey): they are the data.

const { from: FROM, to: TO } = SCENES.s5;
const SIZE = 420;
const GAP = 84;
const LEFT = (1920 - (SIZE * 3 + GAP * 2)) / 2;
const TOP = 236;

type Panel = { sky: SkyKey; at: number; label: string; ring: number };
const PANELS: Panel[] = [
  { sky: "rwaur", at: HIT.these - 4, label: COPY.rwaur, ring: 28 },
  { sky: "barnard", at: HIT.these, label: COPY.barnard, ring: 33 },
  { sky: "wise", at: HIT.these + 4, label: COPY.wise, ring: 24 },
];

const GAIA_AT = HIT.real + 8;

const Ticks: React.FC<{ size: number; o: number }> = ({ size, o }) => {
  const L = 22;
  const d = -8;
  const s = size - d;
  const paths = [
    `M ${d} ${d + L} L ${d} ${d} L ${d + L} ${d}`,
    `M ${s - L} ${d} L ${s} ${d} L ${s} ${d + L}`,
    `M ${s} ${s - L} L ${s} ${s} L ${s - L} ${s}`,
    `M ${d + L} ${s} L ${d} ${s} L ${d} ${s - L}`,
  ];
  return (
    <svg width={size} height={size} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      {paths.map((p, i) => (
        <path key={i} d={p} fill="none" stroke={C.acc} strokeWidth={2.5} strokeLinecap="round" opacity={o} />
      ))}
    </svg>
  );
};

// Thin vertical meter beside RW Aurigae: climbs from x1.0 to x1.5 after "real".
const Meter: React.FC<{ f: number }> = ({ f }) => {
  const H = 280;
  const W = 12;
  const show = ramp(f, HIT.these + 4, HIT.these + 14);
  const g = ramp(f, HIT.real + 2, HIT.real + 30, Easing.inOut(Easing.cubic));
  const v = 1 + 0.5 * g;
  const fill = (v / 1.5) * H;
  return (
    <div style={{ position: "absolute", left: LEFT - 52, top: TOP + (SIZE - H) / 2, width: W, height: H, opacity: show }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 2, background: "rgba(195,206,255,.08)", boxShadow: "inset 0 0 0 1px rgba(195,206,255,.25)" }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: W,
          height: fill,
          borderRadius: 2,
          background: `linear-gradient(to top, ${C.acc}, ${C.ink})`,
          boxShadow: `0 0 ${10 + 14 * g}px rgba(195,206,255,${0.4 + 0.4 * g})`,
        }}
      />
      <div style={{ position: "absolute", left: -4, width: W + 8, top: H - (1 / 1.5) * H, height: 2, background: C.muted }} />
      <div
        style={{
          position: "absolute",
          left: -14,
          width: 40,
          top: H - fill - 32,
          textAlign: "center",
          fontFamily: MONO,
          fontSize: 20,
          color: C.ink,
          whiteSpace: "nowrap",
        }}
      >
        ×{v.toFixed(1)}
      </div>
    </div>
  );
};

const Label: React.FC<{ text: string; o: number }> = ({ text, o }) => {
  const i = text.indexOf(":");
  const head = i >= 0 ? text.slice(0, i) : text;
  const rest = i >= 0 ? text.slice(i + 1).trim() : "";
  return (
    <div
      style={{
        opacity: o,
        transform: `translateY(${(1 - o) * 10}px)`,
        fontFamily: BODY,
        fontSize: 24,
        lineHeight: 1.35,
        textAlign: "center",
        textShadow: "0 1px 6px rgba(0,0,0,.8)",
      }}
    >
      <div style={{ color: C.ink, fontWeight: 500 }}>{head}</div>
      <div style={{ color: C.muted, fontWeight: 300 }}>{rest}</div>
    </div>
  );
};

export const S5: React.FC<{ f: number }> = ({ f }) => {
  const fade = ramp(f, FROM, FROM + 6); // the cut out is a crossfade (Shell SceneGate)
  const t = (f - FROM) / (TO - FROM);
  const cam = `translate(${lerp(f, FROM, TO, 8, -8)}px, ${lerp(f, FROM, TO, 3, -3)}px) scale(${1 + 0.04 * t})`;
  const badge = pop(f, HIT.real, 11, 200);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AiBackground name="bg_sky" f={f} from={FROM} to={TO} zoom={[1.04, 1.1]} pan={[10, 0, -10, -6]} opacity={0.4} />
      <AbsoluteFill style={{ transform: cam, transformOrigin: "50% 45%" }}>
        {/* "real" label: square corners, lands on the word */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 128,
            display: "flex",
            justifyContent: "center",
            opacity: Math.min(1, badge),
            transform: `translateY(${(1 - Math.min(1, badge)) * -16}px) scale(${0.7 + 0.3 * badge})`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "10px 22px",
              borderRadius: 2,
              background: "rgba(10,18,48,.72)",
              boxShadow: `inset 0 0 0 1px rgba(195,206,255,.5), 0 0 30px rgba(91,108,255,.35)`,
              fontFamily: MONO,
              fontSize: 26,
              letterSpacing: "0.04em",
              color: C.ink,
            }}
          >
            <span style={{ width: 9, height: 9, background: C.acc, boxShadow: `0 0 12px ${C.acc}` }} />
            {COPY.real}
          </div>
        </div>

        {PANELS.map((p, i) => {
          const s = pop(f, p.at, 15, 200);
          const enter = Math.min(1, s);
          const x = LEFT + i * (SIZE + GAP);
          const lbl = ramp(f, p.at + 6, p.at + 16);
          const ringAt = GAIA_AT + i * 3;
          const gaiaLbl = ramp(f, ringAt + 5, ringAt + 11);
          const c = SIZE / 2;
          return (
            <React.Fragment key={p.sky}>
              <div
                style={{
                  position: "absolute",
                  left: x,
                  top: TOP,
                  width: SIZE,
                  height: SIZE,
                  opacity: enter,
                  transform: `translateY(${(1 - s) * 50}px) scale(${0.94 + 0.06 * s})`,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    overflow: "hidden",
                    borderRadius: 2,
                    background: "#000",
                    boxShadow: `0 0 0 1px rgba(195,206,255,.45), 0 0 26px rgba(91,108,255,.35), 0 0 70px rgba(4,6,15,.8)`,
                  }}
                >
                  <SkyFrame sky={p.sky} size={SIZE} f={f} hold={10} />
                </div>
                <Ticks size={SIZE} o={enter} />
                <div
                  style={{
                    position: "absolute",
                    left: c + 18,
                    top: c - 40,
                    fontFamily: MONO,
                    fontSize: 16,
                    color: C.amber,
                    opacity: gaiaLbl,
                  }}
                >
                  Gaia
                </div>
              </div>
              <div style={{ position: "absolute", left: x - 10, width: SIZE + 20, top: TOP + SIZE + 24 }}>
                <Label text={p.label} o={lbl} />
              </div>
            </React.Fragment>
          );
        })}
        <Meter f={f} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
