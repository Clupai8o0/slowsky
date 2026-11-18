#!/bin/sh
# AI picture elements and backgrounds for the Slowsky film (GPT Image only in this folder).
# Every one is decoration, never data; the film carries a visible "AI-generated images" mark.
cd "$(dirname "$0")/../slowsky-film/public/ai" || exit 1
S="Painterly cinematic digital illustration, like a premium planetarium picture book. Deep navy and indigo palette with soft periwinkle-blue glow and small warm amber accents. Soft volumetric light, fine film grain, gentle gradients, calm and full of awe. No text, no letters, no numbers, no logos, no insignia, no flags, no people, no faces."
g() { media-gen image "$2 $S" --provider gpt --quality high --aspect "$3" --out "$1.png" > "$1.json" 2> "$1.log" & }
g bg_title "View from low orbit at night: the curved limb of Earth along the bottom third with a thin glowing blue atmosphere line and faint city lights, a deep calm starfield above with a faint Milky Way band. The upper middle is dark open space." 16:9
g bg_pluto "Inside a quiet 1930s observatory at night: dark wood panelling, a brass and wood blink comparator machine on a desk in the left third lit by one warm desk lamp, the open dome slit above showing stars. The centre and right are calm and dark." 16:9
g bg_sky "Deep space backdrop: soft indigo nebula wisps and a gentle blue bloom in the centre, sparse fine stars, very calm and mostly dark, made to sit behind an interface." 16:9
g bg_survey "Earth seen from space on the left, half in night with a thin blue atmosphere; behind it the band of the Milky Way sweeps diagonally across a deep navy sky; the right half is calm and dark." 16:9
g bg_world "The night side of Earth seen from orbit, continents traced by warm amber city lights, a thin blue atmospheric rim, stars above; the globe fills the lower two thirds." 16:9
g bg_end "A wide night sky above a dark low horizon of gentle hills, the Milky Way arching across, deep navy and indigo, quiet and spacious, the centre kept dark and open." 16:9
g el_telescope "A small stylised space telescope floating alone: three nested conical shields stacked like a funnel opening upward, sitting on a compact hexagonal body, rim-lit by cool blue light. Isolated on a pure black background, nothing else in frame." 1:1
g el_plates "Two old square glass astronomical photographic plates side by side, negative images with tiny black star dots on pale grey-cream glass, chipped aged edges. Isolated on a pure black background, nothing else in frame." 16:9
g el_browndwarf "A brown dwarf: a dim glowing sphere with deep red, maroon and brown cloud bands, like a small failed star, with a faint red glow. Isolated on a pure black background, nothing else in frame." 1:1
wait
grep -h estimated_usd *.json | sed 's/.*"estimated_usd":\([0-9.]*\).*/\1/' | paste -sd+ - | bc
