// The AI note panel: a button-started, plain-text reading of the view, written by a language model from the
// numbers the page measured. It is never a measurement, so it lives in its own framed panel with a fixed
// disclaimer, and it hides itself when the server route is off.
import { factSheet, fetchInsight, InsightError, insightStatus, type InsightFacts, type InsightStatus } from '../lib/insight';
import { buildFacts, type FactsInput } from '../lib/insight-facts';
import { subtract } from '../lib/stack';
import type { SkyResult } from '../lib/source';
import type { RegriddedFrame, SkyCoord } from '../lib/types';
import type { Curve, Shift } from './measure';
import { frameMjd } from './measure';

export const PASS_KEY = 'slowsky.insight.passcode';
// The line shown with every note, naming the model when the server says which one writes it.
export function disclaimer(model?: string): string
{
    return `Written by AI (${modelName(model)}) from the measurements on this page. It can be wrong and is not a measurement: check it against the numbers.`;
}

// 'claude-opus-5-5' -> 'Claude Opus 5.5'. Anything else Anthropic-shaped falls back to plain 'Claude'.
export function modelName(model?: string): string
{
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:$|-\d{8}$)/.exec(model ?? '');
    if (!m) {
        return 'Claude';
    }
    const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
    return `Claude ${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

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
    if (sh && sh.significant && sh.measured && sh.measured.measuredArcsec >= 2 * sh.errArcsec) {
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

// Seconds up to 90 read as seconds; longer waits read in whole minutes.
export function retryText(seconds?: number): string
{
    if (seconds === undefined || !Number.isFinite(seconds)) {
        return 'Try again in a minute.';
    }
    return seconds > 90 ? `Try again in ${Math.ceil(seconds / 60)} min.` : `Try again in ${Math.max(1, Math.round(seconds))} s.`;
}

// The route says "daily" both for one visitor's cap and for the whole site's, so it never blames the visitor.
export function busyText(e: { retryAfter?: number; reason?: string }): string
{
    if (e.reason === 'daily') {
        return 'Today’s AI notes are used up. Try again tomorrow.';
    }
    return `Too many requests. ${retryText(e.retryAfter)}`;
}

export const MSG = {
    unreachable: 'Couldn’t reach the server. Try again.',
    wrong: 'Wrong passcode.',
    enter: 'Enter the passcode.',
    failed: 'Couldn’t write the note. Try again.',
    unverified: 'No AI note for this view.',
    writing: 'Writing an AI note. This takes 5 to 10 seconds.',
    written: 'AI note written.',
};

const LABELS = ['What this shows:', 'How far to trust it:', 'What to check next:'];

type Doc = Pick<Document, 'createElement' | 'createTextNode'> & { activeElement: Element | null };

// Plain text in, DOM nodes out: every string goes through textContent, never innerHTML.
export function renderNote(box: HTMLElement, text: string, doc: Doc = document): void
{
    box.replaceChildren();
    for (const line of text.split('\n')) {
        const s = line.trim();
        if (!s) {
            continue;
        }
        const p = doc.createElement('p');
        const label = LABELS.find((l) => s.startsWith(l));
        if (label) {
            const b = doc.createElement('b');
            b.textContent = label;
            p.append(b, doc.createTextNode(` ${s.slice(label.length).trim()}`));
        } else {
            p.textContent = s;
        }
        box.append(p);
    }
}

export interface PassStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface AiNote {
    // Call on every render. A new view (frames, target, centre, curve or shift) drops the old note, which
    // described other numbers, and the panel shows only when the route is on and the view has facts to send.
    update(view: NoteView | null): void;
}

export interface AiNoteDeps {
    status?: typeof insightStatus;
    fetch?: typeof fetchInsight;
    fetcher?: typeof fetch; // the network under insightStatus, wrapped to tell "off" from "unreachable"
    storage?: PassStore | null; // defaults to sessionStorage; never localStorage
    doc?: Doc;
    now?: () => number; // ms clock, for spacing out status re-checks
}

// After a status check that never reached the server, a later view change tries again, at most this often.
export const RECHECK_MS = 30_000;

function defaultStore(): PassStore | null
{
    try {
        return globalThis.sessionStorage ?? null;
    } catch {
        return null;
    }
}

export function mountAiNote(panel: HTMLElement, deps: AiNoteDeps = {}): AiNote
{
    const status = deps.status ?? insightStatus;
    const fetchNote = deps.fetch ?? fetchInsight;
    const net: typeof fetch = deps.fetcher ?? ((input, init) => fetch(input, init));
    const store = deps.storage === undefined ? defaultStore() : deps.storage;
    const doc: Doc = deps.doc ?? document;
    const now = deps.now ?? Date.now;
    const q = <T extends Element>(name: string) => panel.querySelector(`[data-ai="${name}"]`) as T;
    const head = panel.querySelector('h2') as HTMLElement;
    const lock = q<HTMLFormElement>('lock');
    const pass = q<HTMLInputElement>('pass');
    const go = q<HTMLButtonElement>('go');
    const out = q<HTMLElement>('out');
    const msg = q<HTMLElement>('msg');
    const left = q<HTMLElement>('left');
    const disc = q<HTMLElement>('disc');
    const given = q<HTMLElement>('given');
    const givenList = q<HTMLElement>('givenList');
    const goLabel = go.textContent ?? '';
    disc.textContent = disclaimer();
    let st: InsightStatus | null = null;
    let view: NoteView | null = null;
    let sig: unknown[] = [];
    let facts: InsightFacts | null | undefined; // undefined: not built yet for this view
    let ctrl: AbortController | null = null;
    let memPass: string | undefined; // used only when sessionStorage is unavailable
    let tries = 0; // status answers: only the latest one counts
    let inflight = 0; // status checks still out
    let notice = ''; // a busy reply that came before any view: shown with the first view, then dropped

    function passcode(): string | undefined
    {
        try {
            return store?.getItem(PASS_KEY) ?? memPass;
        } catch {
            return memPass;
        }
    }

    function savePass(v: string | undefined): void
    {
        memPass = v;
        try {
            if (v === undefined) {
                store?.removeItem(PASS_KEY);
            } else {
                store?.setItem(PASS_KEY, v);
            }
        } catch {
            // Private mode without storage: the in-memory copy lasts until reload.
        }
    }

    // insightStatus reads a network failure as "off". Watch the wire so a blip is not taken for the route
    // being switched off.
    async function check(code?: string): Promise<{ s: InsightStatus; reached: boolean }>
    {
        inflight++;
        try {
            return await checkOnce(code);
        } finally {
            inflight--;
        }
    }

    async function checkOnce(code?: string): Promise<{ s: InsightStatus; reached: boolean }>
    {
        let reached = true;
        const watched: typeof fetch = async (input, init) => {
            try {
                const r = await net(input, init);
                if (r.status >= 500) {
                    reached = false;
                }
                if (r.status === 204 || r.status === 304) {
                    return r;
                }
                // Read the body here, so a connection that drops mid-reply also counts as unreachable.
                const body = await r.text();
                return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
            } catch (e) {
                reached = false;
                throw e;
            }
        };
        const s = await status({ ...(code !== undefined ? { passcode: code } : {}), fetcher: watched });
        return { s, reached: reached || s.busy === true };
    }

    function setLeft(n: number | undefined): void
    {
        left.textContent = n === undefined ? '' : leftText(n);
        left.hidden = n === undefined;
    }

    // The status line stays in the page so screen readers hear each change; empty or `quiet` lines are
    // visually hidden only.
    function setMsg(text: string, quiet = false): void
    {
        msg.textContent = text;
        msg.classList.toggle('sk-sr', quiet || !text);
    }

    function busy(e: { retryAfter?: number; reason?: string }): void
    {
        setMsg(busyText(e));
        if (e.reason === 'daily') {
            setLeft(undefined);
        }
    }

    function locked(): boolean
    {
        return Boolean(st && st.locked && !st.unlocked);
    }

    function factsNow(): InsightFacts | null
    {
        if (facts === undefined) {
            try {
                facts = view ? buildFacts(factsInput(view)) : null;
            } catch {
                facts = null;
            }
        }
        return facts;
    }

    function show(): void
    {
        // Facts are built only once the route is on, so a switched-off site never pays for them.
        panel.hidden = !(st && st.enabled && view && factsNow());
        if (panel.hidden) {
            return;
        }
        lock.hidden = !locked();
        go.hidden = locked();
    }

    function showLock(text: string): void
    {
        const hadFocus = doc.activeElement === go || doc.activeElement === head;
        lock.hidden = false;
        go.hidden = true;
        setMsg(text);
        if (hadFocus) {
            pass.focus();
        }
    }

    function clearNote(): void
    {
        ctrl?.abort();
        ctrl = null;
        out.replaceChildren();
        given.hidden = true;
        givenList.replaceChildren();
        go.disabled = false;
        go.textContent = goLabel;
        setMsg(notice);
        notice = '';
    }

    lock.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = pass.value;
        if (!v) {
            setMsg(MSG.enter);
            return;
        }
        const mine = ++tries;
        const { s, reached } = await check(v);
        if (mine !== tries) {
            return;
        }
        if (!reached) {
            setMsg(MSG.unreachable);
            return;
        }
        if (s.busy) {
            busy(s);
            return;
        }
        if (!s.enabled) {
            st = s;
            show();
            return;
        }
        if (!s.unlocked) {
            savePass(undefined);
            showLock(MSG.wrong);
            pass.select();
            return;
        }
        savePass(v);
        pass.value = '';
        st = s;
        setMsg('');
        setLeft(s.remaining);
        show();
        go.focus();
    });

    go.addEventListener('click', async () => {
        const f = factsNow();
        if (!view || !f) {
            return;
        }
        ctrl?.abort();
        const c = new AbortController();
        ctrl = c;
        if (doc.activeElement === go) {
            head.focus(); // a disabled button drops focus to the page
        }
        go.disabled = true;
        go.textContent = 'Writing the note…';
        setMsg(MSG.writing);
        out.replaceChildren();
        given.hidden = true;
        const sent = passcode();
        try {
            const note = await fetchNote(f, { signal: c.signal, ...(sent !== undefined ? { passcode: sent } : {}) });
            if (c.signal.aborted || ctrl !== c) {
                return;
            }
            renderNote(out, note.text, doc);
            givenList.replaceChildren(...factSheet(f).map((line) => {
                const li = doc.createElement('li');
                li.textContent = line;
                return li;
            }));
            given.hidden = false;
            disc.textContent = disclaimer(note.model);
            setMsg(MSG.written, true);
            // A cached note carries the allowance from when it was written, so it can't update the count.
            if (note.remaining !== undefined && !note.cached) {
                setLeft(note.remaining);
            }
        } catch (err) {
            if (c.signal.aborted || ctrl !== c) {
                return;
            }
            const code = err instanceof InsightError ? err.code : 'failed';
            if (code === 'off') {
                // Only the route's own "off" hides the panel; a gateway error looks the same, so ask again.
                const mine = ++tries;
                const { s, reached } = await check(sent);
                if (mine !== tries || ctrl !== c) {
                    return;
                }
                if (!reached) {
                    setMsg(MSG.unreachable);
                } else if (s.busy) {
                    busy(s);
                } else if (!s.enabled) {
                    st = s;
                    show();
                } else if (s.locked && !s.unlocked) {
                    st = s;
                    if (sent !== undefined) {
                        savePass(undefined);
                    }
                    showLock(sent === undefined ? MSG.enter : MSG.wrong);
                } else {
                    st = s;
                    show();
                    setMsg(MSG.failed);
                }
            } else if (code === 'locked') {
                if (st) {
                    st = { ...st, locked: true, unlocked: false };
                }
                if (sent === undefined) {
                    showLock(MSG.enter);
                } else {
                    savePass(undefined);
                    showLock(MSG.wrong);
                }
            } else if (code === 'busy') {
                busy(err as InsightError);
            } else if (code === 'unverified') {
                setMsg(MSG.unverified);
            } else {
                setMsg(MSG.failed);
            }
        } finally {
            if (ctrl === c) {
                ctrl = null;
                go.disabled = false;
                go.textContent = goLabel;
            }
        }
    });

    // The first status check. If it never reaches the server the panel stays hidden, and a later view change
    // tries again (RECHECK_MS apart, never while another check is out) so one blip at page load does not hide
    // it for the whole visit. It takes no turn of its own: any Unlock or re-check started meanwhile wins.
    let firstFailedAt = -Infinity;
    function firstCheck(): void
    {
        const first = passcode();
        const mine = tries;
        void check(first).then(({ s, reached }) => {
            if (!reached) {
                firstFailedAt = now();
            }
            if (mine !== tries || !reached) {
                return; // a newer check answers, or the panel was never on: stay hidden rather than guess
            }
            onFirst(first, s);
        });
    }

    function onFirst(first: string | undefined, s: InsightStatus): void
    {
        if (first !== undefined && s.enabled && s.locked && !s.unlocked) {
            savePass(undefined); // stale: don't spend a guess on it at every reload
        }
        st = s;
        disc.textContent = disclaimer(s.model);
        setLeft(s.remaining);
        if (s.busy) {
            busy(s); // shown once; the next view or note clears it
            if (!view) {
                notice = busyText(s);
            }
        }
        show();
    }

    firstCheck();

    return {
        update(v: NoteView | null): void
        {
            const next = v ? [v.result, v.targetId, v.center.ra, v.center.dec, v.curve, v.shift] : [];
            const changed = next.length !== sig.length || next.some((x, i) => !Object.is(x, sig[i]));
            if (changed && v && !st && inflight === 0 && now() - firstFailedAt >= RECHECK_MS) {
                firstCheck();
            }
            view = v;
            if (changed) {
                sig = next;
                facts = undefined;
                clearNote();
            }
            show();
        },
    };
}
