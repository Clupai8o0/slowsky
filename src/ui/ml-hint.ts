// The optional sort hint on a change-list candidate (switch FEATURES.mlHint, off). The model lives in
// src/lib/classify.ts (lane/ml); this file only turns its answer into words. It never shows the model's scores,
// percentages or class names, and always shows the model's own label (HELPER_LABEL) beside the hint.
// The types below match classify()'s return shape, so this file builds before the module lands on main.

export type HintKind = 'mover' | 'brightness' | 'artifact' | 'nothing';
export type HintInput = { kind: HintKind; p?: unknown } | { kind: 'declined'; reason?: string };

// Plain words for each answer. "Looks most like" because it is a sort hint, not a finding.
export const HINT_TEXT: Readonly<Record<HintKind | 'declined', string>> = Object.freeze({
    mover: 'Sort hint: looks most like something that moved between the dates.',
    brightness: 'Sort hint: looks most like a spot that is not equally bright on both dates.',
    artifact: 'Sort hint: looks most like a camera or processing effect.',
    nothing: 'Sort hint: looks most like noise.',
    declined: 'Sort hint: none for this spot.',
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
