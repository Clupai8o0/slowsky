// The picture is drawn at the rate it plays at, FPS (24), so the Studio shows the real length and every frame
// number is a real moment. A beat is 15 frames (96 BPM at 24 fps) and a bar 4 beats (60 frames). Another
// beat is another FRAMES_PER_BEAT (12 is 120 BPM, 16 is 90), a whole number so every beat starts on a frame,
// and means re-timing timing.ts in whole bars. To play the same frames faster or slower, change only FPS
// (20, 24, 25 or 30) and run render.sh score again. render.sh reads both from here: keep them plain numbers.
export const FPS = 24;
export const FRAMES_PER_BEAT = 15;
export const BPM = (60 * FPS) / FRAMES_PER_BEAT;
export const FRAMES_PER_BAR = FRAMES_PER_BEAT * 4;

export const beat = (n: number) => Math.round(n * FRAMES_PER_BEAT);
export const bar = (n: number) => Math.round(n * FRAMES_PER_BAR);

// Characters move "on twos": each drawing holds 2 frames (12 drawings a second) while the camera and effects
// run at the full 24. A hit on an odd frame keys off the frame itself, not onTwos(f), or it shows a frame late.
export const onTwos = (frame: number) => frame - (frame % 2);
export const onThrees = (frame: number) => frame - (frame % 3);
