import React from "react";
import { Composition, registerRoot } from "remotion";
import "../brand/fonts";
import { Film } from "../film/Film";
import { FILM } from "../lib/formats";

// The whole film with its score. scripts/render.sh draft and master render it.
const Root: React.FC = () => <Composition id="Film" component={Film} {...FILM} />;

registerRoot(Root);
