import React from "react";
import { Composition, registerRoot } from "remotion";
import "../brand/fonts";
import { S5 } from "../film/s5/Scene";
import { soloScene } from "../film/Shell";
import { FILM } from "../lib/formats";

// Scene 5 alone, so a half-saved file in another scene can't break this bundle.
const Solo = soloScene("s5", S5);
const Root: React.FC = () => <Composition id="Film-S5" component={Solo} {...FILM} />;

registerRoot(Root);
