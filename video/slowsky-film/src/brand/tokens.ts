// Slowsky's colours, copied from the "Depth" direction of the UI prototype
// (~/Documents/projects/slowsky-design/index.html, CSS variables --ink, --acc, --mute, --amb, --ring).
// The background navy and the glow are read off its screenshot (shots/v3-desk.png).
export const C = {
  bg: "#04060f", // page background
  navy: "#0a1230", // panel / glow base
  glow: "#1a2f7a", // the blue bloom behind the player
  ink: "#e9ecff", // --ink
  acc: "#c3ceff", // --acc (periwinkle)
  muted: "#8f97ba", // --mute
  amber: "#ffb347", // --amb (Gaia rings, highlights)
  ring: "rgba(255,179,71,.85)",
  // SPHEREx's 102 colours run 0.75-5.0 um (infrared). Shown as a false-colour ramp, blue (short) to red (long).
  ramp: ["#5b6cff", "#3fb6ff", "#38e0c6", "#9be15d", "#ffd84d", "#ff9f43", "#ff5e5b", "#d63a7a"],
} as const;
