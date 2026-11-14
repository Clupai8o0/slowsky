// Empty, feature-flagged slots for modules built in their own lanes, so those lanes edit this file and never
// the shared UI. Both are off by default: a slot shows only when its flag is on AND its render returns true.
// - spectrum: a panel under the colour step, for src/lib/spectrum-chart.ts. Ships only once the owner logs it
//   in DECISIONS.md.
// - flags: a "Flags" toggle in the sky legend and a layer over the sky, for src/lib/flags-view.ts.
import type { SkyResult } from '../lib/source';

export const FEATURES = { spectrum: false, flags: false };

export interface SlotView {
    result: SkyResult;
    targetId?: string;
    index: number; // the frame on screen, in result.frames
    mode: 'blink' | 'stack' | 'diff';
}

// Called on every render (each frame while playing): cache by `view.result` and return quickly.
// Fill `box` with textContent or trusted SVG only. Return true when there is something to show.
export function renderSpectrum(box: HTMLElement, view: SlotView): boolean
{
    void box;
    void view;
    return false;
}

// `box` covers the sky image exactly (same box as the overlay). It is called while the layer is switched off
// too, so the Flags key can show only when there is a mask. Return true when there is something to show.
export function renderFlags(box: HTMLElement, view: SlotView): boolean
{
    void box;
    void view;
    return false;
}
