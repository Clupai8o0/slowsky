import React from "react";
import { Composition, registerRoot } from "remotion";
import "../brand/fonts";
import { S6 } from "../film/s6/Scene";
import { soloScene } from "../film/Shell";
import { FILM } from "../lib/formats";

// Scene 6 alone, so a half-saved file in another scene can't break this bundle.
const Solo = soloScene("s6", S6);
const Root: React.FC = () => <Composition id="Film-S6" component={Solo} {...FILM} />;

registerRoot(Root);
