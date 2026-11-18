import React from "react";
import { Composition, registerRoot } from "remotion";
import "../brand/fonts";
import { S3 } from "../film/s3/Scene";
import { soloScene } from "../film/Shell";
import { FILM } from "../lib/formats";

// Scene 3 alone, so a half-saved file in another scene can't break this bundle.
const Solo = soloScene("s3", S3);
const Root: React.FC = () => <Composition id="Film-S3" component={Solo} {...FILM} />;

registerRoot(Root);
