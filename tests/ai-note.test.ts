import { describe, expect, it } from 'vitest';
import { busyText, disclaimer, factsInput, leftText, modelName, mountAiNote, MSG, PASS_KEY, RECHECK_MS, retryText, visitGroups, type AiNoteDeps, type NoteView } from '../src/ui/ai-note';
import { InsightError, type InsightStatus } from '../src/lib/insight';
import { buildFacts } from '../src/lib/insight-facts';
import { validateFacts } from '../src/lib/insight';
import type { SkyResult } from '../src/lib/source';
import type { FrameRecord, OutputGrid, RegriddedFrame } from '../src/lib/types';
import type { Shift } from '../src/ui/measure';
import { mountAsk } from '../src/ui/ask-panel';
import type { InsightAnswer, InsightNote } from '../src/lib/insight';

const N = 40;
const grid: OutputGrid = { center: { ra: 10, dec: 20 }, fovDeg: (N * 6) / 3600, pixelArcsec: 6, width: N, height: N };

function frame(mjd: number, peak = 0): RegriddedFrame
{
    const data = new Float32Array(N * N);
    for (let i = 0; i < data.length; i++) {
        data[i] = 1 + 0.05 * Math.sin(i * 12.9898 + mjd * 0.37);
    }
    data[(N / 2) * N + N / 2] = 1 + peak;
    const rec = { obsId: `F${mjd}`, collection: 'spherex_dr1', release: 'DR1', detector: 1, url: '', tMin: mjd, tMax: mjd + 0.01 } as unknown as FrameRecord;
    return { frame: rec, grid, data, lambdaAtCenter: 1.2, bandwidthAtCenter: 0.02 };
}

function sky(mjds: number[], source: 'live' | 'snapshot' = 'snapshot'): SkyResult
{
    const frames = mjds.map((m, i) => ({ frame: frame(m, i === mjds.length - 1 ? 5 : 0), label: '' }));
    return {
        source, grid, frames, lambda: 1.2, stars: [], credits: [], notes: [],
        locked: frames.map((f) => ({ frame: f.frame.frame, lambda: 1.2, dLambda: 0 })),
    };
}

describe('visitGroups', () => {
    it('chains frames under 10 days apart into one visit, in date order', () => {
        const g = visitGroups(sky([61195, 61000, 61004, 61008, 61190]));
        expect(g.map((v) => v.length)).toEqual([3, 2]);
        expect(g[0]![0]!.frame.tMin).toBe(61000);
    });
});

describe('factsInput', () => {
    it('builds facts the insight library accepts, from the frames on screen', () => {
        const res = sky([61000, 61003, 61180]);
        const facts = buildFacts(factsInput({ result: res, targetId: 'barnard', center: { ra: 269.45, dec: 4.74 }, curve: null }));
        expect(validateFacts(facts)).toEqual(facts);
        expect(facts.targetId).toBe('barnard');
        expect(facts.snapshot).toBe(true);
        expect(facts.visits.map((v) => v.frames)).toEqual([2, 1]);
        expect(facts.lambdaUm).toBe(1.2);
        expect(facts.difference?.peakSigma).toBeGreaterThan(3);
        expect(facts.motion).toBeUndefined();
    });

    it('marks a typed-in spot as custom and a live read as not the saved copy', () => {
        const input = factsInput({ result: sky([61000, 61180], 'live'), center: { ra: 1, dec: 2 }, curve: null });
        expect(input.targetId).toBe('custom');
        expect(input.snapshot).toBe(false);
    });

    it('sends a measured shift only when it clears its own error', () => {
        const res = sky([61000, 61180]);
        const base: Shift = { from: 0, to: 1, predictedArcsec: 5, errArcsec: 2, significant: true, measured: { measuredArcsec: 4.6 } as Shift['measured'] };
        expect(factsInput({ result: res, center: grid.center, curve: null, shift: base }).shift).toEqual({ measuredArcsec: 4.6, days: 180 });
        expect(factsInput({ result: res, center: grid.center, curve: null, shift: { ...base, significant: false } }).shift).toBeUndefined();
        expect(factsInput({ result: res, center: grid.center, curve: null, shift: { ...base, measured: null } }).shift).toBeUndefined();
        expect(factsInput({ result: res, center: grid.center, curve: null, shift: { ...base, errArcsec: 3 } }).shift).toBeUndefined();
    });

    it('leaves the difference out with a single frame', () => {
        expect(factsInput({ result: sky([61000]), center: grid.center, curve: null }).difference).toBeUndefined();
    });
});

describe('panel wording', () => {
    it('counts notes left in plain words', () => {
        expect(leftText(1)).toBe('1 AI note left today');
        expect(leftText(3)).toBe('3 AI notes left today');
    });

    it('says why it is busy', () => {
        expect(busyText({ reason: 'daily' })).toBe('Today’s AI notes are used up. Try again tomorrow.');
        expect(busyText({ retryAfter: 20 })).toBe('Too many requests. Try again in 20 s.');
        expect(busyText({})).toBe('Too many requests. Try again in a minute.');
        expect(retryText(90)).toBe('Try again in 90 s.');
        expect(retryText(91)).toBe('Try again in 2 min.');
        expect(retryText(900)).toBe('Try again in 15 min.');
    });
});

describe('AI label', () => {
    it('names the model in plain words', () => {
        expect(modelName('claude-opus-5-5')).toBe('Claude Opus 5.5');
        expect(modelName('claude-sonnet-5-5-20261101')).toBe('Claude Sonnet 5.5');
        expect(modelName('claude-haiku-5')).toBe('Claude Haiku 5');
        expect(modelName('claude-opus-4-20250514')).toBe('Claude Opus 4');
        expect(modelName(undefined)).toBe('Claude');
        expect(modelName('<b>x</b>')).toBe('Claude');
    });

    it('always says it is AI-written and not a measurement', () => {
        expect(disclaimer('claude-opus-5-5')).toBe('Written by AI (Claude Opus 5.5) from the measurements on this page. It can be wrong and is not a measurement: check it against the numbers.');
    });
});

// ---------- mountAiNote, driven through a small hand-made stand-in for the panel's elements ----------

class FakeEl {
    parent: FakeEl | null = null;
    attrs = new Map<string, string>();
    raw = '';
    hidden = false;
    disabled = false;
    value = '';
    children: FakeEl[] = [];
    classes = new Set<string>();
    listeners = new Map<string, (e: unknown) => unknown>();
    private own = '';
    constructor(readonly tag: string, readonly doc: FakeDoc, readonly ai?: string) {}
    get textContent(): string
    {
        return this.own + this.children.map((c) => c.textContent).join('');
    }
    set textContent(v: string)
    {
        this.own = v;
        this.children = [];
    }
    get innerHTML(): string { return this.raw; }
    set innerHTML(v: string)
    {
        if (this.attrs.get('data-ask') !== 'out') { throw new Error('innerHTML used'); }
        this.raw = v;
    }
    setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
    removeAttribute(k: string): void { this.attrs.delete(k); }
    after(node: FakeEl): void
    {
        if (!this.parent) { throw new Error('missing parent'); }
        node.parent = this.parent;
        this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node);
    }
    classList = {
        toggle: (name: string, force?: boolean) => {
            const on = force ?? !this.classes.has(name);
            if (on) {
                this.classes.add(name);
            } else {
                this.classes.delete(name);
            }
            return on;
        },
        contains: (name: string) => this.classes.has(name),
    };
    append(...nodes: FakeEl[]): void
    {
        for (const node of nodes) { node.parent = this; }
        this.children.push(...nodes);
    }
    replaceChildren(...nodes: FakeEl[]): void
    {
        this.own = '';
        this.children = nodes;
    }
    addEventListener(type: string, fn: (e: unknown) => unknown): void
    {
        this.listeners.set(type, fn);
    }
    fire(type: string): Promise<unknown>
    {
        return Promise.resolve(this.listeners.get(type)?.({ preventDefault() {} }));
    }
    focus(): void
    {
        this.doc.activeElement = this;
    }
    select(): void {}
    querySelector(sel: string): FakeEl | null
    {
        if (sel === 'h2') {
            return this.doc.head;
        }
        const m = /data-ai="(\w+)"/.exec(sel);
        if (m) { return this.doc.parts.get(m[1]!) ?? null; }
        const attr = /data-ask="(\w+)"/.exec(sel);
        for (const child of this.children) {
            if ((attr && child.attrs.get('data-ask') === attr[1]) || child.tag === sel) { return child; }
            const found = child.querySelector(sel);
            if (found) { return found; }
        }
        return null;
    }
}

class FakeDoc {
    activeElement: FakeEl | null = null;
    parts = new Map<string, FakeEl>();
    head: FakeEl;
    panel: FakeEl;
    constructor()
    {
        this.head = new FakeEl('h2', this);
        this.panel = new FakeEl('section', this);
        this.panel.hidden = true;
        for (const k of ['lock', 'pass', 'go', 'out', 'msg', 'left', 'disc', 'given', 'givenList']) {
            const el = new FakeEl(k, this, k);
            this.parts.set(k, el);
            this.panel.append(el);
        }
        this.el('go').textContent = 'Write an AI note';
        this.el('lock').hidden = true;
        this.el('go').hidden = true;
        this.el('given').hidden = true;
    }
    el(k: string): FakeEl
    {
        return this.parts.get(k)!;
    }
    createElement(tag: string): FakeEl
    {
        return new FakeEl(tag, this);
    }
    createTextNode(text: string): FakeEl
    {
        const t = new FakeEl('#text', this);
        t.textContent = text;
        return t;
    }
}

class MemStore {
    map = new Map<string, string>();
    getItem(k: string): string | null
    {
        return this.map.get(k) ?? null;
    }
    setItem(k: string, v: string): void
    {
        this.map.set(k, v);
    }
    removeItem(k: string): void
    {
        this.map.delete(k);
    }
}

const NOTE_TEXT = 'What this shows: a star.\nHow far to trust it: well.\nWhat to check next: <img src=x onerror=alert(1)>';
const OPEN: InsightStatus = { enabled: true, locked: false, unlocked: false, remaining: 5 };
const LOCKED: InsightStatus = { enabled: true, locked: true, unlocked: false };

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
{
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function noteView(mjd = 61000): NoteView
{
    return { result: sky([mjd, mjd + 3, mjd + 180]), targetId: 'barnard', center: { ra: 269.45, dec: 4.74 }, curve: null };
}

type StatusFn = NonNullable<AiNoteDeps['status']>;
type FetchFn = NonNullable<AiNoteDeps['fetch']>;

function setup(opts: { status?: StatusFn; fetch?: FetchFn; store?: MemStore | null } = {})
{
    const doc = new FakeDoc();
    const store = opts.store === undefined ? new MemStore() : opts.store;
    const fetchCalls: { passcode?: string; signal?: AbortSignal }[] = [];
    const fetchNote: FetchFn = opts.fetch ?? (async (_f, o) => {
        fetchCalls.push(o ?? {});
        return { text: NOTE_TEXT, model: 'claude-opus-5-5', dropped: 0, cached: false, remaining: 4 };
    });
    const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
        status: opts.status ?? (async () => OPEN),
        fetch: async (f, o) => {
            fetchCalls.push(o ?? {});
            return fetchNote(f, o);
        },
        storage: store,
        doc: doc as never,
    });
    return { doc, ai, store, fetchCalls };
}

describe('mountAiNote', () => {
    it('stays hidden while the route is off, and with no view', async () => {
        const off = setup({ status: async () => ({ enabled: false, locked: false, unlocked: false }) });
        await flush();
        off.ai.update(noteView());
        expect(off.doc.panel.hidden).toBe(true);
        const on = setup();
        await flush();
        on.ai.update(null);
        expect(on.doc.panel.hidden).toBe(true);
        on.ai.update(noteView());
        expect(on.doc.panel.hidden).toBe(false);
    });

    it('writes the note as text, lists what the AI was given, and leaves storage alone', async () => {
        const { doc, ai, fetchCalls } = setup();
        await flush();
        ai.update(noteView());
        await doc.el('go').fire('click');
        expect(doc.el('out').textContent).toContain('<img src=x onerror=alert(1)>');
        expect(doc.el('given').hidden).toBe(false);
        expect(doc.el('givenList').children.length).toBeGreaterThan(3);
        expect(doc.el('givenList').textContent).toContain('Visits: 2.');
        expect(doc.el('disc').textContent).toContain('Claude Opus 5.5');
        expect(doc.el('left').textContent).toBe('4 AI notes left today');
        expect(fetchCalls.at(-1)?.passcode).toBeUndefined();
    });

    it('drops the note, and aborts the request, when the view changes', async () => {
        const d = deferred<{ text: string; model: string; dropped: number; cached: boolean }>();
        let signal: AbortSignal | undefined;
        const { doc, ai } = setup({ fetch: (_f, o) => {
            signal = o?.signal;
            return d.promise;
        } });
        await flush();
        ai.update(noteView());
        const pending = doc.el('go').fire('click');
        ai.update(noteView(61010));
        expect(signal?.aborted).toBe(true);
        d.resolve({ text: NOTE_TEXT, model: 'm', dropped: 0, cached: false });
        await pending;
        expect(doc.el('out').textContent).toBe('');
        expect(doc.el('go').disabled).toBe(false);
    });

    it('clears a written note on a new view, and keeps it while the view is the same', async () => {
        const { doc, ai } = setup();
        await flush();
        const v = noteView();
        ai.update(v);
        await doc.el('go').fire('click');
        ai.update({ ...v });
        expect(doc.el('out').textContent).not.toBe('');
        ai.update({ ...v, center: { ra: 1, dec: 2 } });
        expect(doc.el('out').textContent).toBe('');
        expect(doc.el('given').hidden).toBe(true);
    });

    it('keeps the count when a cached note comes back', async () => {
        const { doc, ai } = setup({ fetch: async () => ({ text: NOTE_TEXT, model: 'm', dropped: 0, cached: true, remaining: 9 }) });
        await flush();
        ai.update(noteView());
        await doc.el('go').fire('click');
        expect(doc.el('left').textContent).toBe('5 AI notes left today');
    });

    it('unlocks into sessionStorage only, never localStorage', async () => {
        const session = new MemStore();
        const local = new MemStore();
        const g = globalThis as unknown as Record<string, unknown>;
        const before = { s: g.sessionStorage, l: g.localStorage };
        g.sessionStorage = session;
        g.localStorage = local;
        try {
            const doc = new FakeDoc();
            const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
                status: async (o) => (o?.passcode === 'moon' ? { enabled: true, locked: true, unlocked: true } : LOCKED),
                fetch: async () => ({ text: NOTE_TEXT, model: 'm', dropped: 0, cached: false }),
                doc: doc as never,
            });
            await flush();
            ai.update(noteView());
            expect(doc.el('lock').hidden).toBe(false);
            doc.el('pass').value = 'moon';
            await doc.el('lock').fire('submit');
            expect(session.getItem(PASS_KEY)).toBe('moon');
            expect(local.map.size).toBe(0);
            expect(doc.el('go').hidden).toBe(false);
        } finally {
            g.sessionStorage = before.s;
            g.localStorage = before.l;
        }
    });

    it('clears a wrong passcode, from a failed Unlock, a stale saved one, and a 401', async () => {
        const store = new MemStore();
        store.setItem(PASS_KEY, 'old');
        const { doc, ai } = setup({ store, status: async () => LOCKED });
        await flush();
        expect(store.getItem(PASS_KEY)).toBeNull();
        ai.update(noteView());
        doc.el('pass').value = 'nope';
        await doc.el('lock').fire('submit');
        expect(doc.el('msg').textContent).toBe('Wrong passcode.');
        expect(store.getItem(PASS_KEY)).toBeNull();

        const s2 = new MemStore();
        s2.setItem(PASS_KEY, 'was-right');
        const b = setup({ store: s2, status: async () => ({ enabled: true, locked: true, unlocked: true }), fetch: async () => {
            throw new InsightError('locked');
        } });
        await flush();
        b.ai.update(noteView());
        await b.doc.el('go').fire('click');
        expect(s2.getItem(PASS_KEY)).toBeNull();
        expect(b.doc.el('msg').textContent).toBe('Wrong passcode.');
        expect(b.doc.el('lock').hidden).toBe(false);
    });

    it('clears a saved passcode that a later Unlock shows is wrong', async () => {
        const store = new MemStore();
        store.setItem(PASS_KEY, 'old');
        let n = 0;
        const { doc, ai } = setup({ store, status: async () => (n++ === 0 ? { enabled: true, locked: false, unlocked: false, busy: true } : LOCKED), fetch: async () => {
            throw new InsightError('locked');
        } });
        await flush();
        expect(store.getItem(PASS_KEY)).toBe('old'); // a busy reply says nothing about the passcode
        ai.update(noteView());
        doc.el('pass').value = 'nope';
        await doc.el('lock').fire('submit');
        expect(store.getItem(PASS_KEY)).toBeNull();
        expect(doc.el('msg').textContent).toBe('Wrong passcode.');
    });

    it('asks for the passcode when none was sent', async () => {
        const { doc, ai } = setup({ status: async () => ({ enabled: true, locked: false, unlocked: false, busy: true, retryAfter: 60 }), fetch: async () => {
            throw new InsightError('locked');
        } });
        await flush();
        ai.update(noteView());
        await doc.el('go').fire('click');
        expect(doc.el('msg').textContent).toBe('Enter the passcode.');
        expect(doc.el('lock').hidden).toBe(false);
    });

    it('lets only the latest Unlock answer count', async () => {
        const answers = new Map<string, ReturnType<typeof deferred<InsightStatus>>>();
        const { doc, ai } = setup({ status: (o) => {
            if (!o?.passcode) {
                return Promise.resolve(LOCKED);
            }
            const d = deferred<InsightStatus>();
            answers.set(o.passcode, d);
            return d.promise;
        } });
        await flush();
        ai.update(noteView());
        doc.el('pass').value = 'nope';
        const first = doc.el('lock').fire('submit');
        doc.el('pass').value = 'moon';
        const second = doc.el('lock').fire('submit');
        await flush();
        answers.get('moon')!.resolve({ enabled: true, locked: true, unlocked: true });
        await second;
        answers.get('nope')!.resolve(LOCKED);
        await first;
        expect(doc.el('go').hidden).toBe(false);
        expect(doc.el('msg').textContent).not.toBe('Wrong passcode.');
    });

    it('ignores a first status answer that lands after an Unlock', async () => {
        const firstAnswer = deferred<InsightStatus>();
        let n = 0;
        const { doc, ai } = setup({ status: (o) => (n++ === 0 ? firstAnswer.promise : Promise.resolve(o?.passcode === 'moon' ? { enabled: true, locked: true, unlocked: true } : LOCKED)) });
        ai.update(noteView());
        doc.el('pass').value = 'moon';
        await doc.el('lock').fire('submit');
        firstAnswer.resolve(LOCKED);
        await flush();
        expect(doc.el('go').hidden).toBe(false);
    });

    it('shows busy once, then clears it on the next view', async () => {
        const { doc, ai } = setup({ status: async () => ({ enabled: true, locked: false, unlocked: false, busy: true, retryAfter: 900 }) });
        await flush();
        ai.update(noteView());
        expect(doc.el('msg').textContent).toBe('Too many requests. Try again in 15 min.');
        ai.update(noteView(61010));
        expect(doc.el('msg').textContent).toBe('');
    });

    it('says the daily cap is used up without blaming the visitor, and hides the count', async () => {
        const { doc, ai } = setup({ fetch: async () => {
            throw new InsightError('busy', undefined, 'daily');
        } });
        await flush();
        ai.update(noteView());
        await doc.el('go').fire('click');
        expect(doc.el('msg').textContent).toBe('Today’s AI notes are used up. Try again tomorrow.');
        expect(doc.el('left').hidden).toBe(true);
    });

    it('keeps the panel through a network blip on Unlock', async () => {
        const doc = new FakeDoc();
        let fail = false;
        const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
            status: async (o) => {
                try {
                    await o!.fetcher!('/api/insight');
                } catch {
                    return { enabled: false, locked: false, unlocked: false };
                }
                return LOCKED;
            },
            fetcher: async () => {
                if (fail) {
                    throw new TypeError('network');
                }
                return new Response('{}', { status: 200 });
            },
            storage: new MemStore(),
            doc: doc as never,
        });
        await flush();
        ai.update(noteView());
        fail = true;
        doc.el('pass').value = 'moon';
        await doc.el('lock').fire('submit');
        expect(doc.panel.hidden).toBe(false);
        expect(doc.el('msg').textContent).toBe('Couldn’t reach the server. Try again.');
    });

    it('after an "off" reply, re-checks before hiding and follows what the route says', async () => {
        const off = async () => {
            throw new InsightError('off');
        };
        const store = new MemStore();
        store.setItem(PASS_KEY, 'old');
        let n = 0;
        const a = setup({ store, fetch: off, status: async () => (n++ === 0 ? { enabled: true, locked: true, unlocked: true } : LOCKED) });
        await flush();
        a.ai.update(noteView());
        await a.doc.el('go').fire('click');
        expect(store.getItem(PASS_KEY)).toBeNull();
        expect(a.doc.el('lock').hidden).toBe(false);
        expect(a.doc.el('msg').textContent).toBe('Wrong passcode.');

        let m = 0;
        const b = setup({ fetch: off, status: async () => (m++ === 0 ? OPEN : { enabled: true, locked: false, unlocked: false, busy: true, retryAfter: 900 }) });
        await flush();
        b.ai.update(noteView());
        await b.doc.el('go').fire('click');
        expect(b.doc.el('msg').textContent).toBe('Too many requests. Try again in 15 min.');
        expect(b.doc.panel.hidden).toBe(false);

        let k = 0;
        const c = setup({ fetch: off, status: async () => (k++ === 0 ? OPEN : { enabled: false, locked: false, unlocked: false }) });
        await flush();
        c.ai.update(noteView());
        await c.doc.el('go').fire('click');
        expect(c.doc.panel.hidden).toBe(true);
    });

    it('counts a reply that drops mid-body as unreachable', async () => {
        const doc = new FakeDoc();
        let drop = false;
        const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
            status: async (o) => {
                try {
                    const r = await o!.fetcher!('/api/insight');
                    return (await r.json()) as InsightStatus;
                } catch {
                    return { enabled: false, locked: false, unlocked: false };
                }
            },
            fetcher: async () => {
                if (!drop) {
                    return new Response(JSON.stringify(LOCKED), { status: 200 });
                }
                const stream = new ReadableStream({ pull(c) {
                    c.error(new TypeError('connection reset'));
                } });
                return new Response(stream, { status: 200 });
            },
            storage: new MemStore(),
            doc: doc as never,
        });
        await flush();
        ai.update(noteView());
        drop = true;
        doc.el('pass').value = 'moon';
        await doc.el('lock').fire('submit');
        expect(doc.panel.hidden).toBe(false);
        expect(doc.el('msg').textContent).toBe('Couldn’t reach the server. Try again.');
    });

    it('says a failed note can be retried', async () => {
        const { doc, ai } = setup({ fetch: async () => {
            throw new InsightError('failed');
        } });
        await flush();
        ai.update(noteView());
        await doc.el('go').fire('click');
        expect(doc.el('msg').textContent).toBe('Couldn’t write the note. Try again.');
        expect(doc.el('go').disabled).toBe(false);
    });
});

describe('mountAiNote, review round 2', () => {
    // A status function shaped like insightStatus: it reads through the fetcher and calls a failure "off".
    const viaFetcher: StatusFn = async (o) => {
        try {
            const r = await o!.fetcher!('/api/insight');
            return r.ok ? ((await r.json()) as InsightStatus) : { enabled: false, locked: false, unlocked: false };
        } catch {
            return { enabled: false, locked: false, unlocked: false };
        }
    };

    it('tries the status again on a later view when the first check never reached the server', async () => {
        const doc = new FakeDoc();
        let clock = 1_000;
        let down = true;
        let calls = 0;
        const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
            status: viaFetcher,
            fetcher: async () => {
                calls++;
                if (down) {
                    throw new TypeError('network');
                }
                return new Response(JSON.stringify(OPEN), { status: 200 });
            },
            storage: new MemStore(),
            doc: doc as never,
            now: () => clock,
        });
        await flush();
        ai.update(noteView());
        expect(doc.panel.hidden).toBe(true);
        expect(calls).toBe(1);
        down = false;
        clock += RECHECK_MS - 1;
        ai.update(noteView());
        await flush();
        expect(calls).toBe(1);
        clock += 1;
        ai.update(noteView());
        ai.update(noteView());
        await flush();
        expect(calls).toBe(2);
        expect(doc.panel.hidden).toBe(false);
    });

    it('counts any 5xx as unreachable, on load and on Unlock', async () => {
        for (const code of [502, 520]) {
            const doc = new FakeDoc();
            let reply = code;
            let clock = 0;
            const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
                status: viaFetcher,
                fetcher: async () => new Response(reply === 200 ? JSON.stringify(LOCKED) : '{}', { status: reply }),
                storage: new MemStore(),
                doc: doc as never,
                now: () => clock,
            });
            await flush();
            ai.update(noteView());
            expect(doc.panel.hidden, String(code)).toBe(true);
            reply = 200;
            clock += RECHECK_MS;
            ai.update(noteView());
            await flush();
            expect(doc.panel.hidden, String(code)).toBe(false);
            reply = code;
            doc.el('pass').value = 'moon';
            await doc.el('lock').fire('submit');
            expect(doc.panel.hidden, String(code)).toBe(false);
            expect(doc.el('msg').textContent, String(code)).toBe(MSG.unreachable);
        }
    });

    it('asks for a passcode on an empty Unlock without calling the server, and empties the field after one', async () => {
        let calls = 0;
        const { doc, ai } = setup({ status: async (o) => {
            calls++;
            return o?.passcode === 'moon' ? { enabled: true, locked: true, unlocked: true } : LOCKED;
        } });
        await flush();
        ai.update(noteView());
        await doc.el('lock').fire('submit');
        expect(doc.el('msg').textContent).toBe(MSG.enter);
        expect(calls).toBe(1);
        doc.el('pass').value = 'moon';
        await doc.el('lock').fire('submit');
        expect(doc.el('pass').value).toBe('');
        expect(doc.el('lock').hidden).toBe(true);
    });

    it('shows the label, the disclaimer and this view\'s facts with every note', async () => {
        const { doc, ai } = setup({ fetch: async () => ({ text: 'What this shows: a star.\nA plain line with no label.', model: 'claude-opus-5-5', dropped: 0, cached: false }) });
        await flush();
        ai.update(noteView());
        await doc.el('go').fire('click');
        expect(doc.el('disc').hidden).toBe(false);
        expect(doc.el('out').children.map((c) => c.textContent)).toEqual(['What this shows: a star.', 'A plain line with no label.']);
        expect(doc.el('givenList').textContent).toContain('Visits: 2.');
        const one: NoteView = { result: sky([61000]), targetId: 'barnard', center: { ra: 269.45, dec: 4.74 }, curve: null };
        ai.update(one);
        await doc.el('go').fire('click');
        expect(doc.el('givenList').textContent).toContain('Visits: 1.');
        expect(doc.el('givenList').textContent).not.toContain('Visits: 2.');
    });

    it('treats a new measured shift alone as a new view', async () => {
        const { doc, ai } = setup();
        await flush();
        const v = noteView();
        ai.update(v);
        await doc.el('go').fire('click');
        expect(doc.el('out').textContent).not.toBe('');
        ai.update({ ...v, shift: { significant: true } as unknown as Shift });
        expect(doc.el('out').textContent).toBe('');
    });

    it('hides the panel when the view has no facts to send', async () => {
        const { doc, ai } = setup();
        await flush();
        ai.update({ result: sky([]), targetId: 'barnard', center: { ra: 269.45, dec: 4.74 }, curve: null });
        expect(doc.panel.hidden).toBe(true);
    });

    it('drops an "off" re-check that ends after the view changed', async () => {
        const d = deferred<InsightStatus>();
        let n = 0;
        const { doc, ai } = setup({
            fetch: async () => {
                throw new InsightError('off');
            },
            status: async () => (n++ === 0 ? OPEN : d.promise),
        });
        await flush();
        ai.update(noteView());
        const pending = doc.el('go').fire('click');
        await flush();
        ai.update(noteView(61010));
        d.resolve({ enabled: true, locked: false, unlocked: false, busy: true, retryAfter: 60 });
        await pending;
        expect(doc.el('msg').textContent).toBe('');
        expect(doc.el('go').disabled).toBe(false);
        expect(doc.panel.hidden).toBe(false);
    });

    it('re-checks only on a new view, never while an Unlock is out, and lets the Unlock answer', async () => {
        const doc = new FakeDoc();
        let clock = 0;
        let down = true;
        let calls = 0;
        const gate = deferred<void>();
        const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
            status: async (o) => {
                calls++;
                try {
                    await o!.fetcher!('/api/insight');
                } catch {
                    return { enabled: false, locked: false, unlocked: false };
                }
                if (o?.passcode === 'moon') {
                    await gate.promise;
                    return { enabled: true, locked: true, unlocked: true };
                }
                return LOCKED;
            },
            fetcher: async () => {
                if (down) {
                    throw new TypeError('network');
                }
                return new Response('{}', { status: 200 });
            },
            storage: new MemStore(),
            doc: doc as never,
            now: () => clock,
        });
        await flush();
        const v = noteView();
        ai.update(v);
        clock += RECHECK_MS * 3;
        ai.update(v);
        ai.update({ ...v });
        await flush();
        expect(calls).toBe(1); // the same view never polls
        down = false;
        ai.update(noteView());
        await flush();
        expect(calls).toBe(2);
        expect(doc.el('lock').hidden).toBe(false);
        doc.el('pass').value = 'moon';
        const pending = doc.el('lock').fire('submit');
        await flush();
        clock += RECHECK_MS;
        ai.update(noteView());
        await flush();
        expect(calls).toBe(3); // the panel is on, so no re-check joins the Unlock
        gate.resolve();
        await pending;
        expect(doc.el('lock').hidden).toBe(true);
        expect(doc.el('go').hidden).toBe(false);
    });
});

describe('mountAiNote onState', () => {
    it('updates the shared allowance with question wording only when enabled', async () => {
        for (const askOn of [false, true]) {
            const doc = new FakeDoc();
            const ai = mountAiNote(doc.panel as unknown as HTMLElement, { status: async () => OPEN, storage: new MemStore(), doc: doc as never, askOn });
            await flush();
            ai.update(noteView());
            ai.setRemaining(1);
            expect(doc.el('left').textContent).toBe(askOn ? '1 AI note or question left today' : '1 AI note left today');
            ai.setRemaining(3);
            expect(doc.el('left').textContent).toBe(askOn ? '3 AI notes or questions left today' : '3 AI notes left today');
        }
    });

    it('relocks with the right message, clears a saved passcode and announces the unlock', async () => {
        for (const saved of [false, true]) {
            const states: Parameters<NonNullable<AiNoteDeps['onState']>>[0][] = [];
            const store = new MemStore();
            if (saved) { store.setItem(PASS_KEY, 'moon'); }
            const doc = new FakeDoc();
            const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
                status: async (o) => o?.passcode === 'moon' ? { enabled: true, locked: true, unlocked: true } : OPEN,
                storage: store, doc: doc as never, onState: (s) => states.push(s),
            });
            await flush();
            ai.update(noteView());
            ai.relock();
            expect(store.getItem(PASS_KEY)).toBeNull();
            expect(doc.el('lock').hidden).toBe(false);
            expect(doc.el('msg').textContent).toBe(saved ? MSG.wrong : MSG.enter);
            expect(states.at(-1)?.ready).toBe(false);
            doc.el('pass').value = 'moon';
            await doc.el('lock').fire('submit');
            expect(states.at(-1)?.ready).toBe(true);
        }
    });

    it('announces lock state after a note request is rejected', async () => {
        const states: boolean[] = [];
        const doc = new FakeDoc();
        const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
            status: async () => OPEN, fetch: async () => { throw new InsightError('locked'); },
            storage: new MemStore(), doc: doc as never, onState: (s) => states.push(s.ready),
        });
        await flush();
        ai.update(noteView());
        expect(states.at(-1)).toBe(true);
        await doc.el('go').fire('click');
        expect(states.at(-1)).toBe(false);
    });
    it('fires with ready: false while locked and ready: true with facts after unlock', async () => {
        const states: Parameters<NonNullable<AiNoteDeps['onState']>>[0][] = [];
        const doc = new FakeDoc();
        const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
            status: async (o) => (o?.passcode === 'moon' ? { enabled: true, locked: true, unlocked: true } : LOCKED),
            storage: new MemStore(),
            doc: doc as never,
            onState: (s) => states.push(s),
        });
        await flush();
        const v = noteView();
        ai.update(v);
        expect(states.at(-1)).toEqual({ ready: false, facts: null, passcode: undefined });
        doc.el('pass').value = 'moon';
        await doc.el('lock').fire('submit');
        expect(states.at(-1)).toEqual({ ready: true, facts: buildFacts(factsInput(v)), passcode: 'moon' });
        ai.update(null);
        expect(states.at(-1)).toEqual({ ready: false, facts: null, passcode: 'moon' });
    });

    it('leaves AI note behaviour unchanged when onState is omitted', async () => {
        const doc = new FakeDoc();
        const ai = mountAiNote(doc.panel as unknown as HTMLElement, {
            status: async (o) => (o?.passcode === 'moon' ? { enabled: true, locked: true, unlocked: true } : LOCKED),
            fetch: async () => ({ text: NOTE_TEXT, model: 'claude-opus-5-5', dropped: 0, cached: false }),
            storage: new MemStore(),
            doc: doc as never,
        });
        await flush();
        ai.update(noteView());
        expect(doc.el('lock').hidden).toBe(false);
        expect(doc.el('go').hidden).toBe(true);
        doc.el('pass').value = 'moon';
        await doc.el('lock').fire('submit');
        expect(doc.el('lock').hidden).toBe(true);
        expect(doc.el('go').hidden).toBe(false);
        await doc.el('go').fire('click');
        expect(doc.el('out').textContent).toContain('What this shows: a star.');
    });
});

describe('note and question coordination', () => {
    function pair(note: FetchFn, question: () => Promise<InsightAnswer>)
    {
        const doc = new FakeDoc();
        const store = new MemStore();
        store.setItem(PASS_KEY, 'old');
        let ai: ReturnType<typeof mountAiNote>;
        const ask = mountAsk(doc.panel as unknown as HTMLElement, {
            enabled: true, doc: doc as never, ask: question,
            onRequestStart: () => ai.startRequest(),
            onRemaining: (n, request) => ai.setRemaining(n, request),
            onLocked: (request) => ai.relock(request),
        });
        ai = mountAiNote(doc.panel as unknown as HTMLElement, {
            askOn: true, doc: doc as never, storage: store,
            status: async () => ({ enabled: true, locked: true, unlocked: true, remaining: 5 }),
            fetch: note, onState: (state) => ask.sync(state),
        });
        return { doc, store, ai, form: doc.panel.querySelector('[data-ask="form"]')!, input: doc.panel.querySelector('[data-ask="q"]')! };
    }

    const noteReply = (remaining: number): InsightNote => ({ text: NOTE_TEXT, model: 'm', dropped: 0, cached: false, remaining });
    const answer = (remaining: number): InsightAnswer => ({ ...noteReply(remaining), cached: false, kind: 'none', picked: [], lines: [], trust: [] });

    it('aborts the old note on question lock and accepts a new lock after unlock', async () => {
        const old = deferred<InsightNote>();
        const next = deferred<InsightNote>();
        const question = deferred<InsightAnswer>();
        let call = 0;
        let oldSignal: AbortSignal | undefined;
        const { doc, store, ai, form, input } = pair((_facts, opts) => {
            if (call++ === 0) {
                oldSignal = opts?.signal;
                return old.promise;
            }
            return next.promise;
        }, () => question.promise);
        await flush();
        ai.update(noteView());
        const pendingNote = doc.el('go').fire('click');
        input.value = 'What changed?';
        const pendingQuestion = form.fire('submit');
        question.reject(new InsightError('locked'));
        await pendingQuestion;
        expect(oldSignal?.aborted).toBe(true);
        doc.el('pass').value = 'new';
        await doc.el('lock').fire('submit');
        old.reject(new InsightError('locked'));
        await pendingNote;
        expect(store.getItem(PASS_KEY)).toBe('new');
        expect(doc.el('lock').hidden).toBe(true);
        expect(doc.el('go').disabled).toBe(false);
        const fresh = doc.el('go').fire('click');
        next.reject(new InsightError('locked'));
        await fresh;
        expect(doc.el('lock').hidden).toBe(false);
        expect(doc.el('msg').textContent).toBe(MSG.wrong);
        expect(store.getItem(PASS_KEY)).toBeNull();
    });

    for (const questionFirst of [false, true]) {
        it(`orders allowance by request start when ${questionFirst ? 'question' : 'note'} starts first`, async () => {
            const n = deferred<InsightNote>();
            const q = deferred<InsightAnswer>();
            const { doc, ai, form, input } = pair(() => n.promise, () => q.promise);
            await flush();
            ai.update(noteView());
            input.value = 'What changed?';
            let pendingNote: Promise<unknown>;
            let pendingQuestion: Promise<unknown>;
            if (questionFirst) {
                pendingQuestion = form.fire('submit');
                pendingNote = doc.el('go').fire('click');
                n.resolve(noteReply(3));
                await pendingNote;
                q.resolve(answer(4));
                await pendingQuestion;
            } else {
                pendingNote = doc.el('go').fire('click');
                pendingQuestion = form.fire('submit');
                q.resolve(answer(3));
                await pendingQuestion;
                n.resolve(noteReply(4));
                await pendingNote;
            }
            expect(doc.el('left').textContent).toBe('3 AI notes or questions left today');
        });
    }

    it('allows an older count to lower the display and a later request to raise it', async () => {
        const n = deferred<InsightNote>();
        const q = deferred<InsightAnswer>();
        let questions = 0;
        const { doc, ai, form, input } = pair(() => n.promise, () => (questions++ === 0 ? q.promise : Promise.resolve(answer(6))));
        await flush();
        ai.update(noteView());
        input.value = 'What changed?';
        const pendingNote = doc.el('go').fire('click');
        const pendingQuestion = form.fire('submit');
        q.resolve(answer(4));
        await pendingQuestion;
        n.resolve(noteReply(3));
        await pendingNote;
        expect(doc.el('left').textContent).toBe('3 AI notes or questions left today');
        await form.fire('submit');
        expect(doc.el('left').textContent).toBe('6 AI notes or questions left today');
    });

    it('ignores a question from before a note lock and unlock', async () => {
        const n = deferred<InsightNote>();
        const q = deferred<InsightAnswer>();
        const { doc, store, ai, form, input } = pair(() => n.promise, () => q.promise);
        await flush();
        ai.update(noteView());
        input.value = 'What changed?';
        const pendingQuestion = form.fire('submit');
        const pendingNote = doc.el('go').fire('click');
        n.reject(new InsightError('locked'));
        await pendingNote;
        doc.el('pass').value = 'new';
        await doc.el('lock').fire('submit');
        q.reject(new InsightError('locked'));
        await pendingQuestion;
        expect(store.getItem(PASS_KEY)).toBe('new');
        expect(doc.el('lock').hidden).toBe(true);
    });

    it('drops a pending question when the view changes', async () => {
        const q = deferred<InsightAnswer>();
        const { doc, ai, form, input } = pair(async () => noteReply(4), () => q.promise);
        await flush();
        ai.update(noteView());
        input.value = 'What changed?';
        const pending = form.fire('submit');
        ai.update(noteView(61010));
        q.resolve(answer(1));
        await pending;
        expect(doc.el('left').textContent).toBe('5 AI notes or questions left today');
        expect(doc.panel.querySelector('[data-ask="out"]')!.innerHTML).toBe('');
    });
});
