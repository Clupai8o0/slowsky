import React from "react";
import { Composition, registerRoot } from "remotion";
import "../brand/fonts";
import { S1 } from "../film/s1/Scene";
import { soloScene } from "../film/Shell";
import { FILM } from "../lib/formats";

// Scene 1 alone, so a half-saved file in another scene can't break this bundle.
const Solo = soloScene("s1", S1);
const Root: React.FC = () => <Composition id="Film-S1" component={Solo} {...FILM} />;

registerRoot(Root);
