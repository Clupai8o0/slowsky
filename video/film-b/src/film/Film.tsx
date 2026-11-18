import React from "react";
import { Audio } from "@remotion/media";
import { getStaticFiles, staticFile, useCurrentFrame } from "remotion";
import { S1 } from "./s1/Scene";
import { S2 } from "./s2/Scene";
import { S3 } from "./s3/Scene";
import { S4 } from "./s4/Scene";
import { S5 } from "./s5/Scene";
import { S6 } from "./s6/Scene";
import { S7 } from "./s7/Scene";
import { S8 } from "./s8/Scene";
import { FilmShell, SceneGate, SceneView } from "./Shell";
import { SCENE_IDS, SceneId } from "./timing";

export const SCENE_VIEWS: Record<SceneId, SceneView> = { s1: S1, s2: S2, s3: S3, s4: S4, s5: S5, s6: S6, s7: S7, s8: S8 };

// The voice (ElevenLabs, sped up 1.15x) mixed with the original score, made by video/experiments/render.py.
const SCORE = "audio/score.wav";

export const Film: React.FC = () => {
  const f = useCurrentFrame();
  const scored = getStaticFiles().some((file) => file.name === SCORE);
  return (
    <FilmShell>
      {SCENE_IDS.map((id) => {
        const View = SCENE_VIEWS[id];
        return (
          <SceneGate key={id} id={id}>
            <View f={f} />
          </SceneGate>
        );
      })}
      {scored ? <Audio src={staticFile(SCORE)} /> : null}
    </FilmShell>
  );
};
