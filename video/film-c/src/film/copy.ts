// Every word the film puts on screen besides the captions (captions.ts), in one place.
// Facts are from BUILD-PLAN.md's fact-checked demo section and VIDEO-PLAN.md.
// Cut r7a (15 Nov): false, because the film has no AI sound effects yet (the ElevenLabs key had no sound-effects
// access). Set to true only after experiments/sfx_r7.py has filled sfx-r7/ and mix_r7.py has remade score.wav.
// The mark, the end card and the file comment must name the effects model if, and only if, the film plays them.
export const HAS_SFX: boolean = false;
const AI_IMAGES = "AI images: OpenAI gpt-image-2";
const AI_VOICE = "AI voice: ElevenLabs eleven_multilingual_v2";
const AI_SFX = "AI sound effects: ElevenLabs eleven_text_to_sound_v3";
export const COPY = {
  name: "Slowsky", // CLAUDE.md: product name (Sam, 14 Nov)
  line: "Watch the sky change.", // tagline (Sam, 14 Nov)
  cta: "slowsky.clupai.com", // Sam's pick, 15 Nov (was slowsky.vercel.app)
  who: "Sam · Team Clupai · Melbourne", // VIDEO-PLAN.md title card
  challenge: "Challenge: Planet X and SPHEREx",
  credits: "Data: NASA SPHEREx via IRSA (NASA/IPAC). Gaia: ESA/Gaia/DPAC.",
  // Model ids from the records (15 Nov): video/experiments/ai-logs/*.json ("model") and HANDOFF.md (voice line).
  aiImages: AI_IMAGES,
  aiVoice: AI_VOICE,
  // r7: video/experiments/sfx_r7.py (model id in ai-logs/sfx-r7.json)
  aiSfx: HAS_SFX ? AI_SFX : "",
  real: "Real NASA SPHEREx data",
  rwaur: "RW Aurigae: about 1.5× brighter in a year",
  barnard: "Barnard's Star: the ring is where Gaia predicts it",
  wise: "WISE 0855: shows only in the longest band, D6", // research: D6 mean peaks on it, D2 on a nearby star
  search: "Barnard's Star",
  colours: "102",
  volunteers: "3,000+",
  ai: HAS_SFX ? `${AI_IMAGES} · ${AI_VOICE} · ${AI_SFX}` : `${AI_IMAGES} · ${AI_VOICE}`, // guide: SI images and video need a visible watermark
  test: "DRAFT",
};
