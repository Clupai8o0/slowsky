import { LENGTH } from "../film/timing";
import { FPS } from "./beat";

export const FILM = { durationInFrames: LENGTH, fps: FPS, width: 1920, height: 1080 } as const;
// The same frames on a vertical page, for TikTok, Reels and Shorts.
export const REEL = { durationInFrames: LENGTH, fps: FPS, width: 1080, height: 1920 } as const;
