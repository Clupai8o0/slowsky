// Lane: player logic (Opus glue). Frame timing and drawing; the controls live in src/ui.
import type { PlayerFrame, Stretch } from './types';
import { NotImplemented } from './notimpl';

export const MAX_FPS = 4;

// One stretch shared by every frame, so brightness changes are real.
export function sharedStretch(frames: PlayerFrame[]): Stretch
{
    throw new NotImplemented(`sharedStretch(${frames.length})`);
}

export function drawFrame(ctx: CanvasRenderingContext2D, f: PlayerFrame, s: Stretch): void
{
    throw new NotImplemented(`drawFrame(${ctx.canvas.width}, ${f.label}, ${s.kind})`);
}
