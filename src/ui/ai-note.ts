// The AI note panel: a button-started, plain-text reading of the view, written by a language model from the
// numbers the page measured. It is never a measurement, so it lives in its own framed panel with a fixed
// disclaimer, and it hides itself when the server route is off.
import { fetchInsight, InsightError, insightStatus, type InsightFacts, type InsightStatus } from '../lib/insight';
import { buildFacts, type FactsInput } from '../lib/insight-facts';
import { subtract } from '../lib/stack';
import type { SkyResult } from '../lib/source';
import type { RegriddedFrame, SkyCoord } from '../lib/types';
import type { Curve, Shift } from './measure';
import { frameMjd } from './measure';

export const PASS_KEY = 'slowsky.insight.passcode';
export const DISCLAIMER = 'Written by Claude (Anthropic) from the numbers on this page. It can be wrong. It is not a measurement.';

// Frames less than `gapDays` apart are one visit, chained, in date order (the same rule as visitsOf).
export function visitGroups(result: SkyResult, gapDays = 10): RegriddedFrame[][]
{
    const frames = result.frames.map((f) => f.frame)
        .filter((f) => Number.isFinite(frameMjd(f)))
        .sort((a, b) => frameMjd(a) - frameMjd(b));
    const out: RegriddedFrame[][] = [];
    let prev = -Infinity;
    for (const f of frames) {
        const d = frameMjd(f);
        const last = out[out.length - 1];
        if (last && d - prev < gapDays) {
            last.push(f);
        } else {
            out.push([f]);
        }
        prev = d;
    }
    return out;
}

export interface NoteView {
    result: SkyResult;
    targetId?: string;
    center: SkyCoord;
    curve: Curve | null;
    shift?: Shift | null;
}

// Everything sent comes from what this page measured: the frames' times, the light curve the card uses,
// last minus first at the target, and the measured shift only when it clears its own error.
export function factsInput(v: NoteView): FactsInput
{
    const { result } = v;
    const input: FactsInput = {
        targetId: v.targetId ?? 'custom',
        center: v.center,
        lambdaUm: result.lambda,
        visits: visitGroups(result),
        snapshot: result.source === 'snapshot',
    };
    if (v.curve) {
        input.lightCurve = v.curve.lc;
    }
    const regs = result.frames.map((f) => f.frame);
    const first = regs[0];
    const last = regs[regs.length - 1];
    if (first && last && regs.length > 1) {
        try {
            const at = result.track?.[result.track.length - 1]?.pix;
            input.difference = { data: subtract(last.data, first.data).data, grid: result.grid, ...(at ? { at } : {}) };
        } catch {
            // Frames that can't be subtracted just leave the difference out.
        }
    }
    const sh = v.shift;
    if (sh && sh.significant && sh.measured) {
        const a = regs[sh.from];
        const b = regs[sh.to];
        if (a && b) {
            input.shift = { measuredArcsec: sh.measured.measuredArcsec, days: Math.abs(frameMjd(b) - frameMjd(a)) };
        }
    }
    return input;
}

export function leftText(n: number): string
{
    return n === 1 ? '1 AI note left today' : `${n} AI notes left today`;
}

export function busyText(e: { retryAfter?: number; reason?: string }): string
{
    if (e.reason === 'daily') {
        return 'You have used today’s AI notes.';
    }
    return e.retryAfter !== undefined ? `Too many requests. Try again in ${e.retryAfter} s.` : 'Too many requests. Try again in a minute.';
}

const LABELS = ['What this shows:', 'How far to trust it:', 'What to check next:'];

// Plain text in, DOM nodes out: every string goes through textContent, never innerHTML.
export function renderNote(box: HTMLElement, text: string): void
{
    box.replaceChildren();
    for (const line of text.split('\n')) {
        const s = line.trim();
        if (!s) {
            continue;
        }
        const p = document.createElement('p');
        const label = LABELS.find((l) => s.startsWith(l));
        if (label) {
            const b = document.createElement('b');
            b.textContent = label;
            p.append(b, document.createTextNode(` ${s.slice(label.length).trim()}`));
        } else {
            p.textContent = s;
        }
        box.append(p);
    }
}

function readPass(): string | undefined
{
    try {
        return sessionStorage.getItem(PASS_KEY) ?? undefined;
    } catch {
        return undefined;
    }
}

function writePass(v: string | undefined): void
{
    try {
        if (v === undefined) {
            sessionStorage.removeItem(PASS_KEY);
        } else {
            sessionStorage.setItem(PASS_KEY, v);
        }
    } catch {
        // Private mode without storage: the passcode lasts until reload.
    }
}

export interface AiNote {
    // Call when the view changes: drops the old note (it described other frames) and shows or hides the panel.
    update(view: NoteView | null): void;
}

export function mountAiNote(panel: HTMLElement, deps: { status?: typeof insightStatus; fetch?: typeof fetchInsight } = {}): AiNote
{
    const status = deps.status ?? insightStatus;
    const fetchNote = deps.fetch ?? fetchInsight;
    const q = <T extends Element>(name: string) => panel.querySelector(`[data-ai="${name}"]`) as T;
    const lock = q<HTMLFormElement>('lock');
    const pass = q<HTMLInputElement>('pass');
    const go = q<HTMLButtonElement>('go');
    const out = q<HTMLElement>('out');
    const msg = q<HTMLElement>('msg');
    const left = q<HTMLElement>('left');
    let st: InsightStatus | null = null;
    let view: NoteView | null = null;
    let ctrl: AbortController | null = null;
    let memPass: string | undefined; // used only when sessionStorage is unavailable
    let goLabel = go.textContent ?? '';

    function passcode(): string | undefined
    {
        return readPass() ?? memPass;
    }

    function setLeft(n: number | undefined): void
    {
        left.textContent = n === undefined ? '' : leftText(n);
        left.hidden = n === undefined;
    }

    // `quiet` keeps a line for screen readers only, e.g. "written" when the note itself is on screen.
    function setMsg(text: string, quiet = false): void
    {
        msg.textContent = text;
        msg.hidden = !text;
        msg.classList.toggle('sk-sr', quiet);
    }

    function showLock(text: string): void
    {
        lock.hidden = false;
        go.hidden = true;
        setMsg(text);
    }

    function show(): void
    {
        panel.hidden = !(st && st.enabled && view);
        if (panel.hidden || !st) {
            return;
        }
        if (st.locked && !st.unlocked) {
            lock.hidden = false;
            go.hidden = true;
        } else {
            lock.hidden = true;
            go.hidden = false;
        }
    }

    function clearNote(): void
    {
        ctrl?.abort();
        ctrl = null;
        out.replaceChildren();
        out.hidden = true;
        go.disabled = false;
        go.textContent = goLabel;
        setMsg(st?.busy ? busyText(st) : '');
    }

    lock.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = pass.value;
        if (!v) {
            return;
        }
        const s = await status({ passcode: v });
        if (s.busy) {
            setMsg(busyText(s));
            return;
        }
        if (!s.enabled) {
            st = s;
            show();
            return;
        }
        if (!s.unlocked) {
            showLock('Wrong passcode.');
            pass.select();
            return;
        }
        writePass(v);
        memPass = v;
        pass.value = '';
        st = s;
        setMsg('');
        setLeft(s.remaining);
        show();
        go.focus();
    });

    go.addEventListener('click', async () => {
        if (!view) {
            return;
        }
        let facts: InsightFacts;
        try {
            facts = buildFacts(factsInput(view));
        } catch {
            setMsg('No AI note for this view.');
            return;
        }
        ctrl?.abort();
        const c = new AbortController();
        ctrl = c;
        go.disabled = true;
        go.textContent = 'Writing the note…';
        setMsg('Writing an AI note. This takes 5 to 10 seconds.');
        out.hidden = true;
        try {
            const note = await fetchNote(facts, { signal: c.signal, passcode: passcode() });
            if (c.signal.aborted) {
                return;
            }
            renderNote(out, note.text);
            out.hidden = false;
            setMsg('AI note written.', true);
            if (note.remaining !== undefined) {
                setLeft(note.remaining);
            }
        } catch (err) {
            if (c.signal.aborted) {
                return;
            }
            const code = err instanceof InsightError ? err.code : 'failed';
            if (code === 'off') {
                st = { enabled: false, locked: false, unlocked: false };
                show();
            } else if (code === 'locked') {
                writePass(undefined);
                memPass = undefined;
                if (st) {
                    st = { ...st, locked: true, unlocked: false };
                }
                showLock('Wrong passcode.');
            } else if (code === 'busy') {
                setMsg(busyText(err as InsightError));
            } else {
                setMsg('No AI note for this view.');
            }
        } finally {
            if (ctrl === c) {
                ctrl = null;
                go.disabled = false;
                go.textContent = goLabel;
            }
        }
    });

    void status({ passcode: passcode() }).then((s) => {
        st = s;
        setLeft(s.remaining);
        if (s.busy) {
            setMsg(busyText(s));
        }
        show();
    });

    goLabel = go.textContent ?? '';
    return {
        update(v: NoteView | null): void
        {
            const changed = v?.result !== view?.result || v?.targetId !== view?.targetId;
            view = v;
            if (changed) {
                clearNote();
            }
            show();
        },
    };
}
