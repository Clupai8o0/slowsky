import React from "react";
import { Composition, registerRoot } from "remotion";
import "../brand/fonts";
import { S2 } from "../film/s2/Scene";
import { soloScene } from "../film/Shell";
import { FILM } from "../lib/formats";

// Scene 2 alone, so a half-saved file in another scene can't break this bundle.
const Solo = soloScene("s2", S2);
const Root: React.FC = () => <Composition id="Film-S2" component={Solo} {...FILM} />;

registerRoot(Root);
