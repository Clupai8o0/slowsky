// Every word the film puts on screen besides the captions (captions.ts), in one place.
// Facts are from BUILD-PLAN.md's fact-checked demo section and VIDEO-PLAN.md.
export const COPY = {
  name: "Slowsky", // CLAUDE.md: product name (Sam, 14 Nov)
  line: "Watch the sky change.", // tagline (Sam, 14 Nov)
  cta: "slowsky.vercel.app", // public since 15:02 NPT 14 Nov (v0.1)
  who: "Sam · Team Clupai · Melbourne", // VIDEO-PLAN.md title card
  challenge: "Challenge: Planet X and SPHEREx",
  credits: "Data: NASA SPHEREx via IRSA (NASA/IPAC). Gaia: ESA/Gaia/DPAC.",
  voice: "Voice: AI (ElevenLabs)",
  real: "Real NASA SPHEREx data",
  rwaur: "RW Aurigae: about 1.5× brighter in a year",
  barnard: "Barnard's Star: the ring is where Gaia predicts it",
  wise: "WISE 0855: shows only in the longest band, D6", // research: D6 mean peaks on it, D2 on a nearby star
  search: "Barnard's Star",
  colours: "102",
  volunteers: "3,000+",
  ai: "AI-generated images · AI voice (ElevenLabs)", // guide: SI images and video need a visible watermark
  test: "DRAFT",
} as const;
