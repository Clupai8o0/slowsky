import React from "react";
import { Composition, registerRoot } from "remotion";
import "../brand/fonts";
import { S7 } from "../film/s7/Scene";
import { soloScene } from "../film/Shell";
import { FILM } from "../lib/formats";

// Scene 7 alone, so a half-saved file in another scene can't break this bundle.
const Solo = soloScene("s7", S7);
const Root: React.FC = () => <Composition id="Film-S7" component={Solo} {...FILM} />;

registerRoot(Root);
