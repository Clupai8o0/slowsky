import React from "react";
import { Composition, registerRoot } from "remotion";
import "../brand/fonts";
import { S8 } from "../film/s8/Scene";
import { soloScene } from "../film/Shell";
import { FILM } from "../lib/formats";

// Scene 8 alone, so a half-saved file in another scene can't break this bundle.
const Solo = soloScene("s8", S8);
const Root: React.FC = () => <Composition id="Film-S8" component={Solo} {...FILM} />;

registerRoot(Root);
