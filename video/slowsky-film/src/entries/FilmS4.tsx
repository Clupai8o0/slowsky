import React from "react";
import { Composition, registerRoot } from "remotion";
import "../brand/fonts";
import { S4 } from "../film/s4/Scene";
import { soloScene } from "../film/Shell";
import { FILM } from "../lib/formats";

// Scene 4 alone, so a half-saved file in another scene can't break this bundle.
const Solo = soloScene("s4", S4);
const Root: React.FC = () => <Composition id="Film-S4" component={Solo} {...FILM} />;

registerRoot(Root);
