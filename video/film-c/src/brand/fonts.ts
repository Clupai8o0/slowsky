import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

// Slowsky's faces, from the UI prototype's font link (slowsky-design/index.html): Geist for text,
// Geist Mono for read-outs (coordinates, frame counters, wavelengths).
const geist = loadGeist("normal", { weights: ["300", "400", "500", "600"], subsets: ["latin"] });
const mono = loadGeistMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

export const DISPLAY = geist.fontFamily;
export const BODY = geist.fontFamily;
export const MONO = mono.fontFamily;
