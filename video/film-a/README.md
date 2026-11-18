# Promo video

A Remotion project for a promo film. It is drawn at 24 fps, the rate it plays at, on a beat of 15 frames
(96 BPM), and its music is built on the film's own hit frames, so every hit lands on its frame.

Needs Node 18 or later, ffmpeg, and Python 3 with numpy and Pillow (set `PYTHON` to one that has them, if
`python3` doesn't).

## Commands

| What | Command |
|---|---|
| Install | `npm install`, then `sh scripts/render.sh score` (the music is built, not committed) |
| Typecheck | `npm run typecheck` |
| The music, `public/audio/score.wav` | `sh scripts/render.sh score` (options: `--key A`, `--minor`, `--mp3`) |
| One frame at full size | `sh scripts/render.sh still 90` makes `out/Film-90.png` |
| One scene and its contact sheet | `sh scripts/render.sh scene 2` |
| The whole film, small, with sound | `sh scripts/render.sh draft` |
| The finished film, checked | `sh scripts/render.sh master` makes `out/Film.mp4`, a poster and two sheets |
| A second render, compared | `cp out/Film.mp4 out/Film-A.mp4`, `sh scripts/render.sh master` again, then `python3 scripts/blockcheck.py out/Film-A.mp4 out/Film.mp4` |
| A web copy under 14 MB | `sh scripts/web.sh out/Film.mp4 out/Film-web.mp4` |
| The Studio, to look around | `npm run studio` |

`draft` prints the loudness and true peak of its sound, which is the master's sound: fix the mix there. `master`
checks the frame count, the loudness (about -14 LUFS, what YouTube, TikTok and Instagram play at) and the true
peak (at or under -1 dBTP), and exits 1 if one fails. `blockcheck.py` exits 1 when a frame differs between the two
renders (a texture can go missing in one): look at that frame with `render.sh still`, and render the bad one again.
Each render uses 3 browser tabs; when several run at once, give each `CONCURRENCY=2`.

## Where things are

| File | Holds |
|---|---|
| `src/film/timing.ts` | the length, each scene's frames and the music's hits |
| `src/lib/beat.ts` | the frame rate and the frames in a beat |
| `src/film/copy.ts` | every word on screen |
| `src/brand/` | the colours and fonts |
| `src/film/s1/Scene.tsx` ... | one scene a folder, each drawn from the film frame `f` |
| `src/entries/` | one bundle a cut or scene, so a broken scene can't break another's render |
| `scripts/render.sh` | every render; the other scripts are the tools it calls |

## Placeholders

The brand, the words and scenes 2 and 3 start as placeholders, each marked `PLACEHOLDER`. Replace each one and
delete its marker: `render.sh master` won't finish a cut while any are left.

## Changing the timing

Edit `LENGTH` and `SCENES` in `src/film/timing.ts` in whole bars (4 beats: 60 frames, 2.5 s, at 15 frames a
beat), and `HIT` on beats, then run `sh scripts/render.sh score` again. Put the hits the music turns on (the drums
coming in, the lift) on the first frame of a bar; `score` prints where each section starts. The scenes, the score
and every render read their frames from there.

## Changing the speed

Change `FPS` in `src/lib/beat.ts` to 20, 24, 25 or 30, then run `sh scripts/render.sh score` again. Every frame
and hit stays where it is; the music follows at 60 × `FPS` ÷ `FRAMES_PER_BEAT` BPM (at 15 a beat: 80, 96, 100 or
120), and the film plays for `LENGTH` ÷ `FPS` seconds (480 frames: 24, 20, 19.2 or 16 s). The same hits and flags give
the same tune, so the film keeps its own music. Don't stretch the old sound instead: its beats would drift off the
frames. If `public/audio/score.wav` is your own track, not one `score` made, don't run `score` (it would write a new
tune over it): re-time the track with the skill's `scripts/respace.py`, as in its render guide, section 7.
