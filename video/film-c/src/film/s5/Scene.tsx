import React from "react";
import { AbsoluteFill } from "remotion";
import { BODY, MONO } from "../../brand/fonts";
import { C } from "../../brand/tokens";
import { COPY } from "../copy";
import { AiBackground } from "../kit/AiArt";
import { lerp, ramp } from "../kit/anim";
import { HALO, Finish, IO, M, Rect, T, Ticks, arrive, glide } from "../kit/look";
import { HIT, SCENES } from "../timing";
import { Box, Shot, Stacked, UiCrop, uiFrames } from "../kit/Ui";

// Scene 5, the proof: "These are real SPHEREx pixels."
// The spectrum block of scene 4 becomes the real picture from the product (RW Aurigae, as the page drew it: its
// pixels, Gaia rings and target marks) at the right (match cut, A's layout). On "These" the camera leans in on the
// star; its line from COPY lands at the left. From "real" the picture alternates between the page's FIRST and LAST
// frames (a year apart) by hard cuts, each held long enough to register, and beside it the page's own read-out
// ("Frame N of 3 · date") cuts with it. The square-ended meter under the line steps between 1× and "about 1.5×" in
// time with the cuts (it only appears once the line is fully in). The last ~20 frames only alternate and drift.

const { from: FROM, to: TO } = SCENES.s5;
const SHOTS = uiFrames("desk2x", "rwaur");
const FIRST = 0;
const LAST = SHOTS.length - 1;
const ALT = HIT.real; // first hard cut, on "real"
const HOLD = 14; // frames each of the two frames is held

// Hero (right) and where it starts: the spectrum block of scene 4, as it sits on screen at its last frame.
const HERO = 780;
const HX = 1920 - M - HERO; // 960
const HY = 1080 - 170 - HERO; // 130: the picture ends at 910, above the caption band
const START = { cx: 1500, cy: 360, size: 330 };
const END = { cx: HX + HERO / 2, cy: HY + HERO / 2, size: HERO };
const ZOOM = 1.7; // the lean-in on the star: 780 px x 1.7 = 1326 screen px of a 1568 px capture (never enlarged)

// Which of the two frames shows: FIRST until ALT, then hard cuts every HOLD frames.
const lastOn = (f: number) => f >= ALT && Math.floor((f - ALT) / HOLD) % 2 === 0;

// The page's read-out: the frame label and its date (the page's `.sk-read` line), and the Gaia key (toggle and its
// "Gaia DR3" source link, `.sk-gk`). Widths are the widest across the shots, so the crops do not change size at a
// hard cut, and they end where the page's own text ends (manifest boxes; older manifests fall back to fixed widths).
const READ_W = Math.max(...SHOTS.map((s) => (s.boxes.readout?.width ?? 194) + 20));
const GAIA_W = Math.max(...SHOTS.map((s) => (s.boxes.gaiaKey?.width ?? s.boxes.gaia?.width ?? 204) + 12));
const readBox = (s: Shot): Box => {
  const b = s.boxes.readout ?? s.boxes.frameLabel;
  return { x: b.x - 10, y: b.y - 9, width: READ_W, height: b.height + 18 };
};
const gaiaBox = (s: Shot): Box | null => {
  const g = s.boxes.gaiaKey ?? s.boxes.gaia;
  return g ? { x: g.x - 6, y: g.y - 4, width: GAIA_W, height: g.height + 8 } : null;
};

// The left column: the label on the picture's top line, the line and meter under it, the page's read-out crops
// centred on the picture's middle line.
const k0 = SHOTS[0].viewport.dsf;
const g0 = gaiaBox(SHOTS[0]);
const CROPS_H = readBox(SHOTS[0]).height * k0 + (g0 ? 18 + g0.height * k0 : 0);
const CROPS_Y = Math.round(HY + HERO / 2 - CROPS_H / 2);

// The exit: the picture, its column and its crops leave as one object over 6 frames, ending on the cut; the corner
// ticks stay and carry across into scene 6 (s5ExitRect).
const EXIT_A = TO - 6;
const camAtF = (f: number) => ({
  dx: lerp(f, FROM, TO + 10, 8, -8),
  dy: lerp(f, FROM, TO + 10, 3, -3),
  k: lerp(f, FROM, TO + 10, 1, 1.025),
});
// The ticks' rect on screen at the cut (the hero has landed: END), with the scene camera applied.
export const s5ExitRect = (): Rect => {
  const c = camAtF(TO);
  const ox = 1920 * 0.6;
  const oy = 1080 * 0.45;
  const r = { x: END.cx - END.size / 2 - 10, y: END.cy - END.size / 2 - 10, w: END.size + 20, h: END.size + 20 };
  return { x: ox + c.dx + (r.x - ox) * c.k, y: oy + c.dy + (r.y - oy) * c.k, w: r.w * c.k, h: r.h * c.k };
};

const split = (text: string) => {
  const i = text.indexOf(":");
  return i >= 0 ? [text.slice(0, i), text.slice(i + 1).trim()] : [text, ""];
};

export const S5: React.FC<{ f: number }> = ({ f }) => {
  const fade = arrive(f, FROM, FROM + 6);
  // camera: one slow, constant drift and push over the whole scene (overlays and tiles move together)
  const cc = camAtF(f);
  const cam = `translate(${cc.dx}px, ${cc.dy}px) scale(${cc.k})`;

  // hero: glides out of the spectrum block into place, landing on "These"
  const g = glide(f, FROM, HIT.these + 2);
  const cx = START.cx + (END.cx - START.cx) * g;
  const cy = START.cy + (END.cy - START.cy) * g;
  const size = START.size + (END.size - START.size) * g;
  const zoom = 1 + (ZOOM - 1) * glide(f, HIT.these, HIT.these + 22);
  const idx = lastOn(f) ? LAST : FIRST;
  const ticks = f < TO ? arrive(f, HIT.these - 2, HIT.these + 8) : 0; // scene 6 draws them from the cut on

  // Exit before the crossfade into scene 6 (Shell, from TO): pixels fade into their panel, then the panel and the
  // read-out crops leave as whole objects (scale and opacity); only the corner ticks carry across the cut.
  const pixOut = 1; // the picture leaves with its panel, as one object (no empty panel is held)
  const panelOut = 1 - ramp(f, EXIT_A, TO, IO);
  const exitK = 1 - 0.06 * ramp(f, EXIT_A, TO, IO);
  const leave = 1 - ramp(f, EXIT_A, TO); // the left column leaves with the panel, not into scene 6
  const bloom = (0.4 + 0.6 * g) * panelOut;
  // the pixels arrive once this scene is fully over scene 4 (its fade ends at FROM + 6), on an opaque panel
  const heroPix = arrive(f, FROM + 6, FROM + 12) * pixOut;

  // labels, meter and read-out
  const badge = arrive(f, HIT.real - 2, HIT.real + 8);
  const head = arrive(f, HIT.these + 2, HIT.these + 14);
  const meterIn = arrive(f, HIT.these + 14, HIT.these + 22); // never before its line is fully in
  // the bar answers each cut in 5 frames: up to "about 1.5×" on the last frame, back to 1× on the first
  const cutAt = ALT + Math.max(0, Math.floor((f - ALT) / HOLD)) * HOLD;
  const step = arrive(f, cutAt, cutAt + 5);
  const mv = f < ALT ? 0 : lastOn(f) ? step : 1 - step;
  const readIn = arrive(f, HIT.these + 8, HIT.these + 16);
  const cropO = readIn * (1 - ramp(f, EXIT_A, TO));
  const cropK = 1 - 0.05 * ramp(f, EXIT_A, TO, IO);
  const [rwHead, rwRest] = split(COPY.rwaur);
  const meterEnd = rwRest.split(" ").slice(0, 2).join(" "); // "about 1.5×", word for word from the line above
  const shot = SHOTS[idx];
  const g2 = gaiaBox(shot);
  const k = shot.viewport.dsf; // crops at 1:1 capture pixels

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AiBackground name="bg_sky" f={f} from={FROM} to={TO} zoom={[1.06, 1.12]} pan={[10, 0, -20, -8]} opacity={0.38} />
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

        {/* hero: the product's real picture on an opaque panel */}
        <div style={{ position: "absolute", left: cx - size / 2, top: cy - size / 2, width: size, height: size }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              background: "#000",
              opacity: Math.min(1, g * 1.6) * panelOut,
              transform: `scale(${exitK})`,
              boxShadow: "0 0 0 1px rgba(195,206,255,.4), 0 30px 80px rgba(0,0,0,.55)",
            }}
          >
            {heroPix > 0 ? (
              <div style={{ position: "absolute", inset: 0, opacity: heroPix, transform: `scale(${zoom})`, transformOrigin: "50% 50%" }}>
                <Stacked
                  srcs={SHOTS.map((s) => s.picture ?? s.file)}
                  index={idx}
                  style={{ left: 0, top: 0, width: size, height: (size * shot.boxes.picture.height) / shot.boxes.picture.width }}
                />
              </div>
            ) : null}
          </div>
          <Ticks size={size} o={ticks} />
        </div>

        {/* left column: the label, the star's line, its meter, the page's read-out */}
        <div
          style={{
            position: "absolute",
            left: M,
            top: HY,
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: MONO,
            fontSize: T.label,
            letterSpacing: "0.04em",
            color: C.ink,
            opacity: badge * leave,
            transform: `translateY(${(1 - badge) * -10}px)`,
            textShadow: HALO,
          }}
        >
          <span style={{ width: 10, height: 10, background: C.acc, boxShadow: `0 0 14px ${C.acc}` }} />
          {COPY.real}
        </div>
        <div
          style={{
            position: "absolute",
            left: M,
            top: HY + 62,
            width: HX - M - 80,
            opacity: head * leave,
            transform: `translateY(${(1 - head) * 12}px)`,
            textShadow: HALO,
          }}
        >
          <div style={{ fontFamily: BODY, fontSize: T.body, fontWeight: 500, color: C.ink, lineHeight: 1.2 }}>{rwHead}</div>
          <div style={{ fontFamily: BODY, fontSize: T.sub, fontWeight: 300, color: C.muted, lineHeight: 1.4 }}>{rwRest}</div>
        </div>

        {/* meter: 1× at the tick, "about 1.5×" at the end; it steps with the picture's hard cuts */}
        <div style={{ position: "absolute", left: M, top: HY + 196, width: 520, height: 40, opacity: meterIn * leave }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 14,
              width: 360,
              height: 10,
              background: "rgba(195,206,255,.1)",
              boxShadow: "inset 0 0 0 1px rgba(195,206,255,.28)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 14,
              width: 240 + 120 * mv,
              height: 10,
              background: `linear-gradient(90deg, ${C.acc}, ${C.ink})`,
              boxShadow: `0 0 ${8 + 12 * mv}px rgba(195,206,255,${0.35 + 0.4 * mv})`,
            }}
          />
          <div style={{ position: "absolute", left: 239, top: 6, width: 2, height: 26, background: C.muted }} />
          <div
            style={{
              position: "absolute",
              left: 384,
              top: 0,
              fontFamily: MONO,
              fontSize: T.label,
              lineHeight: "38px",
              color: C.ink,
              opacity: 0.55 + 0.45 * mv,
              whiteSpace: "nowrap",
            }}
          >
            {meterEnd}
          </div>
        </div>

        {/* crops of the real page: its frame read-out (with the date) and its Gaia key, cut with the picture */}
        <div
          style={{
            position: "absolute",
            left: M,
            top: CROPS_Y,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            opacity: cropO,
            transform: `translateY(${(1 - readIn) * 10}px) scale(${cropK})`,
            transformOrigin: "0 0",
          }}
        >
          <UiCrop shots={SHOTS} index={idx} box={readBox(shot)} k={k} style={{ background: C.bg, boxShadow: "0 0 0 1px rgba(195,206,255,.22)", borderRadius: 2 }} />
          {g2 ? <UiCrop shots={SHOTS} index={idx} box={g2} k={k} style={{ background: C.bg, boxShadow: "0 0 0 1px rgba(195,206,255,.22)", borderRadius: 2 }} /> : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
