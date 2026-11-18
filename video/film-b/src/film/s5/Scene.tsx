import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import { BODY, MONO } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { COPY } from "../copy";
import { AiBackground } from "../kit/AiArt";
import { lerp, ramp } from "../kit/anim";
import { HIT, SCENES } from "../timing";
import { Box, Shot, Stacked, UiCrop, uiBlink, uiFrames } from "../kit/Ui";

// Scene 5: the proof. "These are real SPHEREx pixels." The product's real picture fills most of the frame and
// blinks by hard cuts at the product's own speed, with the product's own Gaia rings and its "where it should be"
// ring. Beside it: the "real" label on HIT.real, the target's line from COPY, and two crops of the real page (its
// frame read-out and its Gaia key), which change with the picture. On "pixels" (HIT.real + 26) a hard cut on the
// beat swaps everything to RW Aurigae; the slow push carries straight through the cut.

const { from: FROM, to: TO } = SCENES.s5;
const P = 780; // picture size on screen
const PX = 170;
const PY = 70;
const COL = 1030; // right column
const CUT = HIT.real + 26; // "pixels."

type Part = { shots: Shot[]; label: string };
const PARTS: Part[] = [
  { shots: uiFrames("desk2x", "barnard"), label: COPY.barnard },
  { shots: uiFrames("desk2x", "rwaur"), label: COPY.rwaur },
];

// The read-out crops: from the frame label to just before the next control, and the Gaia key with its source.
const readBox = (s: Shot): Box => {
  const b = s.boxes.frameLabel;
  return { x: b.x - 10, y: b.y - 9, width: 214, height: b.height + 18 };
};
const gaiaBox = (s: Shot): Box | null => {
  const g = s.boxes.gaia;
  return g ? { x: g.x - 6, y: g.y - 4, width: 216, height: g.height + 8 } : null;
};

const Line: React.FC<{ text: string; o: number }> = ({ text, o }) => {
  const i = text.indexOf(":");
  const head = i >= 0 ? text.slice(0, i) : text;
  const rest = i >= 0 ? text.slice(i + 1).trim() : "";
  return (
    <div style={{ opacity: o, transform: `translateY(${(1 - o) * 12}px)`, fontFamily: BODY, textShadow: "0 1px 6px rgba(0,0,0,.8)" }}>
      <div style={{ color: C.ink, fontWeight: 400, fontSize: 52, letterSpacing: "-0.01em", lineHeight: 1.1 }}>{head}</div>
      <div style={{ color: C.muted, fontWeight: 300, fontSize: 30, lineHeight: 1.35, marginTop: 14, maxWidth: 720 }}>{rest}</div>
    </div>
  );
};

export const S5: React.FC<{ f: number }> = ({ f }) => {
  const fade = ramp(f, FROM, FROM + 6); // the cut out is a crossfade (Shell SceneGate)
  const part = f < CUT ? PARTS[0] : PARTS[1];
  const n = part.shots.length;
  const idx = f < CUT ? uiBlink(f, FROM + 8, n, 0) : uiBlink(f, CUT, n, 0);
  const shot = part.shots[idx];
  const pic = shot.boxes.picture;

  // Arrival (ease-out), then a slow push that runs through the hard cut.
  const arrive = ramp(f, FROM, FROM + 14, Easing.out(Easing.cubic));
  const push = lerp(f, FROM, TO, 0, 0.025);
  const s = 0.965 + 0.035 * arrive + push;

  // After the cut, the camera moves in on RW Aurigae (the picture's centre) so its change can be seen; at most
  // 1.45x of a 784 px picture shown at 780 px, still under the 2x capture's own pixels.
  const zoom = f < CUT ? 1 : 1 + 0.45 * ramp(f, CUT + 2, CUT + 22, Easing.inOut(Easing.cubic));
  const realO = ramp(f, HIT.real - 2, HIT.real + 8, Easing.out(Easing.cubic));
  const lineO = ramp(f, HIT.these + 2, HIT.these + 14, Easing.out(Easing.cubic));
  const readO = ramp(f, HIT.these + 8, HIT.these + 18, Easing.out(Easing.cubic));
  const k = shot.viewport.dsf; // crops at 1:1 capture pixels
  const g = gaiaBox(shot);

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AiBackground name="bg_sky" f={f} from={FROM} to={TO} zoom={[1.04, 1.1]} pan={[10, 0, -10, -6]} opacity={0.35} />
      <div
        style={{
          position: "absolute",
          left: PX - 240,
          top: PY - 240,
          width: P + 480,
          height: P + 480,
          background: `radial-gradient(closest-side, ${C.glow}99, transparent)`,
          opacity: arrive,
        }}
      />

      {/* the real picture (product capture: pixels, Gaia rings and the "should be here" ring as the page drew them) */}
      <div
        style={{
          position: "absolute",
          left: PX,
          top: PY,
          width: P,
          height: P,
          opacity: arrive,
          transform: `scale(${s})`,
          transformOrigin: "50% 50%",
          boxShadow: "0 0 0 1px rgba(195,206,255,.4), 0 0 60px rgba(4,6,15,.8)",
          borderRadius: 2,
          overflow: "hidden",
          background: "#000",
        }}
      >
        {PARTS.map((p, pi) => (
          <div
            key={pi}
            style={{
              position: "absolute",
              inset: 0,
              visibility: p === part ? "visible" : "hidden",
              transform: `scale(${p === part ? zoom : 1})`,
              transformOrigin: "50% 50%",
            }}
          >
            <Stacked
              srcs={p.shots.map((x) => x.picture ?? x.file)}
              index={p === part ? idx : -1}
              style={{ left: 0, top: 0, width: P, height: (P * pic.height) / pic.width }}
            />
          </div>
        ))}
      </div>

      {/* right column */}
      <div style={{ position: "absolute", left: COL, top: 176, width: 820 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 20px",
            borderRadius: 2,
            background: "rgba(10,18,48,.72)",
            boxShadow: "inset 0 0 0 1px rgba(195,206,255,.5), 0 0 30px rgba(91,108,255,.3)",
            fontFamily: MONO,
            fontSize: 26,
            letterSpacing: "0.04em",
            color: C.ink,
            opacity: realO,
            transform: `translateY(${(1 - realO) * -12}px)`,
          }}
        >
          <span style={{ width: 9, height: 9, background: C.acc, boxShadow: `0 0 12px ${C.acc}` }} />
          {COPY.real}
        </div>
        <div style={{ marginTop: 52 }}>
          <Line text={part.label} o={lineO} />
        </div>
        {/* crops of the real page: its frame read-out and its Gaia key, cut with the picture */}
        <div style={{ marginTop: 44, opacity: readO, display: "flex", flexDirection: "column", gap: 18 }}>
          <UiCrop shots={part.shots} index={idx} box={readBox(shot)} k={k} style={{ boxShadow: "0 0 0 1px rgba(195,206,255,.18)", borderRadius: 2 }} />
          {g ? <UiCrop shots={part.shots} index={idx} box={g} k={k} style={{ boxShadow: "0 0 0 1px rgba(195,206,255,.18)", borderRadius: 2 }} /> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
