// Made by video/experiments/voice_lines.py (HIT: voice_lines_r7.py, round 7): the film's frames, the one place they are written down.
// scripts/render.sh reads LENGTH and every scene's range from here. Each scene starts 8 frames before its
// voice line and holds through the breath after it. 24 fps; 708 frames = 29.5 s (limit 30.0 s).
export const LENGTH = 708;

export type SceneId = "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8";

export const SCENES: Record<SceneId, { from: number; to: number; name: string }> = {
  s1: { from: 0, to: 20, name: "Title: Team Clupai, Melbourne" },
  s2: { from: 20, to: 124, name: "Pluto was found by blinking two photos" },
  s3: { from: 124, to: 258, name: "Slowsky: pick a star, watch the sky change" },
  s4: { from: 258, to: 405, name: "SPHEREx maps the sky in 102 infrared colours" },
  s5: { from: 405, to: 486, name: "These are real SPHEREx pixels (Gaia rings on top)" },
  s6: { from: 486, to: 604, name: "Volunteers found 3,000+ brown dwarf candidates" },
  s7: { from: 604, to: 646, name: "Now anyone can join the hunt" },
  s8: { from: 646, to: 708, name: "End card" },
};

export const SCENE_IDS = Object.keys(SCENES) as SceneId[];

// Moments the picture lands on (film frames): first frame of the named spoken word.
export const HIT = {
  pluto: 24,
  blinking: 61,
  name: 132,
  star: 164,
  watch: 186,
  nasa: 266,
  colours: 328,
  these: 413,
  real: 430,
  volunteers: 494,
  thousand: 535,
  brown: 548,
  now: 612,
  hunt: 650,
} as const;
