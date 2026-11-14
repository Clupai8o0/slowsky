// The optional sort hint on a change-list candidate (switch FEATURES.mlHint, off). The model lives in
// src/lib/classify.ts (lane/ml); this file only turns its answer into words. It never shows the model's scores,
// percentages or class names, and always shows the model's own label (HELPER_LABEL) beside the hint.
// The types below match classify()'s return shape, so this file builds before the module lands on main.

export type HintKind = 'mover' | 'brightness' | 'artifact' | 'nothing';
export type HintInput = { kind: HintKind; p?: unknown } | { kind: 'declined'; reason?: string };

// Plain words for each answer. Each says what it is closest to among the fake changes the model was trained on,
// not what the spot is, and asks the visitor to look; "noise" and "camera effect" say the model misses many faint
// movers in its own tests (mover recall 0.55 at S/N 3-5, public/models/change-classifier.card.json), so nobody skips
// a spot on its word.
const LOOK = 'Check both frames yourself.';
const MISSES = 'In its own tests it missed many faint moving spots.';
export const HINT_TEXT: Readonly<Record<HintKind | 'declined', string>> = Object.freeze({
    mover: `Sort hint: closest to the fake moving spots it was trained on. ${LOOK}`,
    brightness: `Sort hint: closest to the fake spots whose light was raised or lowered in training. ${LOOK}`,
    artifact: `Sort hint: closest to the fake camera or processing effects it was trained on. ${MISSES} ${LOOK}`,
    nothing: `Sort hint: closest to the plain noise it was trained on. ${MISSES} ${LOOK}`,
    declined: `Sort hint: not given. The helper skips some spots, such as very faint, very bright, off-centre or close-call ones. ${LOOK}`,
});

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

// The hint sentence; anything unexpected reads as no hint. The model's decline reason is internal and not shown.
export function hintText(c: HintInput | null | undefined): string
{
    const kind = c?.kind;
    return kind !== undefined && Object.prototype.hasOwnProperty.call(HINT_TEXT, kind) ? HINT_TEXT[kind] : HINT_TEXT.declined;
}

// The hint with the model's label under it. `label` is HELPER_LABEL from src/lib/classify.ts.
export function hintHtml(c: HintInput | null | undefined, label: string): string
{
    return `<p class="sk-hintml"><span>${esc(hintText(c))}</span> <small class="mute">${esc(label)}</small></p>`;
}
