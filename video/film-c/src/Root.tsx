import React from "react";
import { Composition, Folder } from "remotion";
import "./brand/fonts";
import { Film, SCENE_VIEWS } from "./film/Film";
import { soloScene } from "./film/Shell";
import { SCENE_IDS } from "./film/timing";
import { FILM } from "./lib/formats";

const SOLOS = SCENE_IDS.map((id) => ({ id, View: soloScene(id, SCENE_VIEWS[id]) }));

// Everything, for the Studio (npm run studio). Renders go through src/entries/<name>.tsx instead, one bundle
// a cut or a scene, so a half-saved scene can't break another's render.
export const RemotionRoot: React.FC = () => (
  <Folder name="Film">
    <Composition id="Film" component={Film} {...FILM} />
    {SOLOS.map(({ id, View }) => (
      <Composition key={id} id={`Film-${id.toUpperCase()}`} component={View} {...FILM} />
    ))}
  </Folder>
);
