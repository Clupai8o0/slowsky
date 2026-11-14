import { describe, expect, it } from 'vitest';
import { ASK_ENABLED, factSheet, InsightError, validateFacts, type InsightAnswer, type InsightFacts } from '../src/lib/insight';
import { mountAsk, type AskPanelDeps } from '../src/ui/ask-panel';
import { askViewHtml } from '../src/ui/ask-view';

class FakeEl {
    parent: FakeEl | null = null;
    children: FakeEl[] = [];
    attrs = new Map<string, string>();
    listeners = new Map<string, (e: { preventDefault(): void }) => unknown>();
    hidden = false;
    disabled = false;
    className = '';
    id = '';
    htmlFor = '';
    type = '';
    maxLength = -1;
    autocomplete = '';
    enterKeyHint = '';
    placeholder = '';
    value = '';
    private own = '';
    private rawHtml = '';

    constructor(readonly tag: string, readonly doc: FakeDoc) {}

    get textContent(): string
    {
        return this.own + this.children.map((c) => c.textContent).join('');
    }

    set textContent(v: string)
    {
        this.own = v;
        this.rawHtml = '';
        this.children = [];
    }

    get innerHTML(): string
    {
        return this.rawHtml;
    }

    set innerHTML(v: string)
    {
        if (this.attrs.get('data-ask') !== 'out') {
            throw new Error(`innerHTML used on <${this.tag}>`);
        }
        this.rawHtml = v;
        this.own = '';
        this.children = [];
    }

    setAttribute(k: string, v: string): void
    {
        this.attrs.set(k, v);
    }

    getAttribute(k: string): string | null
    {
        return this.attrs.get(k) ?? null;
    }

    append(...nodes: FakeEl[]): void
    {
        for (const n of nodes) {
            n.parent = this;
            this.children.push(n);
        }
    }

    after(...nodes: FakeEl[]): void
    {
        if (!this.parent) {
            throw new Error('after() without parent');
        }
        const siblings = this.parent.children;
        const idx = siblings.indexOf(this);
        if (idx < 0) {
            throw new Error('element not in parent');
        }
        for (const n of nodes) {
            n.parent = this.parent;
        }
        siblings.splice(idx + 1, 0, ...nodes);
    }

    addEventListener(type: string, fn: (e: { preventDefault(): void }) => unknown): void
    {
        this.doc.listenerCount++;
        this.listeners.set(type, fn);
    }

    async fire(type: string): Promise<boolean>
    {
        let prevented = false;
        await this.listeners.get(type)?.({
            preventDefault(): void
            {
                prevented = true;
            },
        });
        return prevented;
    }

    focus(): void
    {
        this.doc.activeElement = this;
    }

    querySelector(sel: string): FakeEl | null
    {
        const attrMatch = /^\[([a-z-]+)="([^"]+)"\]$/.exec(sel);
        const attrName = attrMatch?.[1];
        const attrVal = attrMatch?.[2];
        for (const child of this.children) {
            const matched = attrName !== undefined
                ? child.attrs.get(attrName) === attrVal
                : child.tag === sel;
            if (matched) {
                return child;
            }
            const nested = child.querySelector(sel);
            if (nested) {
                return nested;
            }
        }
        return null;
    }

    serialize(): string
    {
        const attrText = [...this.attrs.entries()].map(([k, v]) => `${k}="${v}"`).join(' ');
        const props = [this.className, this.id, this.htmlFor, this.placeholder, this.value, attrText].filter(Boolean).join(' ');
        return `<${this.tag} ${props}>${this.own}${this.rawHtml}${this.children.map((c) => c.serialize()).join('')}</${this.tag}>`;
    }
}

class FakeDoc {
    activeElement: FakeEl | null = null;
    listenerCount = 0;
    createdCount = 0;
    panel: FakeEl;
    aiOut: FakeEl;
    aiGiven: FakeEl;

    constructor()
    {
        this.panel = new FakeEl('section', this);
        this.aiOut = new FakeEl('div', this);
        this.aiOut.setAttribute('data-ai', 'out');
        this.aiGiven = new FakeEl('details', this);
        this.aiGiven.setAttribute('data-ai', 'given');
        this.panel.append(this.aiOut, this.aiGiven);
    }

    createElement(tag: string): FakeEl
    {
        this.createdCount++;
        return new FakeEl(tag, this);
    }

    createTextNode(text: string): FakeEl
    {
        const t = new FakeEl('#text', this);
        t.textContent = text;
        return t;
    }
}

const FACTS_A: InsightFacts = {
    targetId: 'barnard',
    ra: 269.4521,
    dec: 4.6934,
    lambdaUm: 1.25,
    visits: [
        { mjd: 61000, frames: 3 },
        { mjd: 61180, frames: 2 },
    ],
    lightCurve: {
        points: [
            { mjd: 61000, relative: 1.0, snr: 45 },
            { mjd: 61090, relative: 1.12, snr: 42 },
            { mjd: 61180, relative: 1.25, snr: 50 },
        ],
        refScatter: [0.02, 0.03],
        dropped: 0,
    },
    difference: { peakSigma: 4.2 },
    snapshot: true,
};

const FACTS_B: InsightFacts = {
    targetId: 'custom',
    ra: 12.5,
    dec: -34.2,
    lambdaUm: 3.3,
    visits: [{ mjd: 61010, frames: 4 }],
    snapshot: false,
};

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

type AskFn = NonNullable<AskPanelDeps['ask']>;

function answerReply(lines: number[], trust: number[], text = 'Model sentence never shown'): InsightAnswer
{
    return {
        kind: 'answer',
        text,
        model: 'claude-opus-5-5',
        dropped: 0,
        cached: false,
        picked: lines.slice(0, 3),
        lines,
        trust,
    };
}

function noneReply(): InsightAnswer
{
    return {
        kind: 'none',
        text: 'The AI did not match this question to any measured line on this page.',
        model: 'claude-opus-5-5',
        dropped: 0,
        cached: false,
        picked: [],
        lines: [],
        trust: [],
    };
}

function must<T>(value: T | null | undefined, name: string): T
{
    if (value === null || value === undefined) {
        throw new Error(`Missing ${name}`);
    }
    return value;
}

function setup(askImpl?: AskFn)
{
    const doc = new FakeDoc();
    const calls: { facts: InsightFacts; question: string; passcode?: string; signal?: AbortSignal }[] = [];
    const ask: AskFn = async (facts, question, opts) => {
        calls.push({
            facts,
            question,
            ...(opts?.passcode !== undefined ? { passcode: opts.passcode } : {}),
            ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
        });
        if (askImpl) {
            return askImpl(facts, question, opts);
        }
        return answerReply([5, 6], [4, 7, 8]);
    };
    const askPanel = mountAsk(doc.panel as unknown as HTMLElement, {
        enabled: true,
        ask,
        doc: doc as never,
    });
    const form = must(doc.panel.querySelector('[data-ask="form"]'), 'form');
    const q = must(doc.panel.querySelector('[data-ask="q"]'), 'q');
    const out = must(doc.panel.querySelector('[data-ask="out"]'), 'out');
    const btn = must(form.querySelector('button'), 'button');
    const label = must(form.querySelector('label'), 'label');
    const hint = must(form.querySelector('p'), 'hint');
    return { doc, askPanel, calls, form, q, out, btn, label, hint };
}

describe('mountAsk', () => {
    it('has ASK_ENABLED false by default and adds no element, listener, or request when off', () => {
        expect(ASK_ENABLED).toBe(false);
        expect(validateFacts(FACTS_A)).toEqual(FACTS_A);
        expect(validateFacts(FACTS_B)).toEqual(FACTS_B);

        const doc = new FakeDoc();
        let called = false;
        const askPanel = mountAsk(doc.panel as unknown as HTMLElement, {
            ask: async () => {
                called = true;
                return noneReply();
            },
            doc: doc as never,
        });
        expect(doc.createdCount).toBe(0);
        expect(doc.listenerCount).toBe(0);
        expect(doc.panel.children).toEqual([doc.aiOut, doc.aiGiven]);

        askPanel.sync({ ready: true, facts: FACTS_A, passcode: 'moon' });
        askPanel.sync({ ready: false, facts: null });
        expect(doc.createdCount).toBe(0);
        expect(doc.listenerCount).toBe(0);
        expect(doc.panel.querySelector('[data-ask="form"]')).toBeNull();
        expect(called).toBe(false);
    });

    it('builds the form once right after [data-ai="out"] and stays hidden until ready with facts', () => {
        const { doc, askPanel, form, q, out, btn, label, hint } = setup();
        expect(doc.panel.children).toEqual([doc.aiOut, form, doc.aiGiven]);
        expect(form.className).toBe('sk-ask-form');
        expect(label.textContent).toBe('Ask about this view');
        expect(q.getAttribute('maxlength')).toBe('200');
        expect(q.getAttribute('autocomplete')).toBe('off');
        expect(q.getAttribute('enterkeyhint')).toBe('send');
        expect(q.placeholder).toBe('For example: did it get brighter?');
        expect(btn.className).toBe('sk-btn2');
        expect(btn.textContent).toBe('Ask');
        expect(hint.textContent).toBe("The AI only picks lines from this page's measurements. It does not write an answer of its own.");
        expect(out.innerHTML).toBe('');
        expect(form.hidden).toBe(true);

        const createdAfterMount = doc.createdCount;
        askPanel.sync({ ready: false, facts: FACTS_A });
        expect(form.hidden).toBe(true);

        askPanel.sync({ ready: true, facts: null });
        expect(form.hidden).toBe(true);

        askPanel.sync({ ready: true, facts: FACTS_A });
        expect(form.hidden).toBe(false);
        expect(doc.createdCount).toBe(createdAfterMount);
    });

    it('rejects an invalid question locally, sends nothing, shows invalid text, and keeps the button enabled', async () => {
        const { askPanel, calls, form, q, out, btn } = setup();
        askPanel.sync({ ready: true, facts: FACTS_A });

        for (const bad of ['', '   ', 'hi', '<script>alert(1)</script>', '???']) {
            q.value = bad;
            const prevented = await form.fire('submit');
            expect(prevented).toBe(true);
            expect(calls).toHaveLength(0);
            expect(out.innerHTML).toBe(askViewHtml({ kind: 'invalid' }));
            expect(btn.disabled).toBe(false);
        }
    });

    it('calls ask once with the sent facts, trimmed question, and passcode, and renders only askViewHtml of the sent sheet', async () => {
        const gate = deferred<InsightAnswer>();
        const { askPanel, calls, form, q, out, btn } = setup(() => gate.promise);
        askPanel.sync({ ready: true, facts: FACTS_A, passcode: 'moon-pass' });

        q.value = '   Did   it get brighter?  ';
        const pending = form.fire('submit');
        expect(btn.disabled).toBe(true);
        expect(out.innerHTML).toBe(askViewHtml({ kind: 'loading' }));
        expect(calls).toHaveLength(1);
        expect(calls[0]?.facts).toBe(FACTS_A);
        expect(calls[0]?.question).toBe('Did it get brighter?');
        expect(calls[0]?.passcode).toBe('moon-pass');
        expect(calls[0]?.signal?.aborted).toBe(false);

        gate.resolve(answerReply([5, 6], [4, 7, 8], 'Invented sky claim from model'));
        await pending;

        expect(out.innerHTML).toBe(askViewHtml({
            kind: 'answer',
            sheet: factSheet(FACTS_A),
            lines: [5, 6],
            trust: [4, 7, 8],
        }));
        expect(out.innerHTML).not.toContain('Invented sky claim');
        expect(btn.disabled).toBe(false);
    });

    it('renders none, locked, invalid, busy (with retryAfter and daily), failed, and bad line numbers, re-enabling the button each time', async () => {
        let nextOutcome: () => Promise<InsightAnswer> = async () => noneReply();
        const { askPanel, form, q, out, btn } = setup(() => nextOutcome());
        askPanel.sync({ ready: true, facts: FACTS_A });
        q.value = 'How many visits are there?';

        await form.fire('submit');
        expect(out.innerHTML).toBe(askViewHtml({ kind: 'none' }));
        expect(btn.disabled).toBe(false);

        nextOutcome = async () => {
            throw new InsightError('locked');
        };
        await form.fire('submit');
        expect(out.innerHTML).toBe(askViewHtml({ kind: 'locked' }));
        expect(btn.disabled).toBe(false);

        nextOutcome = async () => {
            throw new InsightError('invalid');
        };
        await form.fire('submit');
        expect(out.innerHTML).toBe(askViewHtml({ kind: 'invalid' }));
        expect(btn.disabled).toBe(false);

        nextOutcome = async () => {
            throw new InsightError('busy', 25);
        };
        await form.fire('submit');
        expect(out.innerHTML).toBe(askViewHtml({ kind: 'busy', retryAfter: 25 }));
        expect(btn.disabled).toBe(false);

        nextOutcome = async () => {
            throw new InsightError('busy', undefined, 'daily');
        };
        await form.fire('submit');
        expect(out.innerHTML).toBe(askViewHtml({ kind: 'busy', reason: 'daily' }));
        expect(btn.disabled).toBe(false);

        for (const err of [new InsightError('failed'), new InsightError('off'), new InsightError('unverified'), new Error('network')]) {
            nextOutcome = async () => {
                throw err;
            };
            await form.fire('submit');
            expect(out.innerHTML).toBe(askViewHtml({ kind: 'failed' }));
            expect(btn.disabled).toBe(false);
        }

        // Bad line number rejected by askViewHtml falls back to failed.
        nextOutcome = async () => answerReply([999], []);
        await form.fire('submit');
        expect(out.innerHTML).toBe(askViewHtml({ kind: 'failed' }));
        expect(btn.disabled).toBe(false);
    });

    it('aborts an in-flight request, drops its reply, clears output, and keeps the typed question when facts change', async () => {
        const gate = deferred<InsightAnswer>();
        const { askPanel, calls, form, q, out, btn } = setup(() => gate.promise);
        askPanel.sync({ ready: true, facts: FACTS_A });

        q.value = 'What wavelength is this?';
        const pending = form.fire('submit');
        expect(calls[0]?.signal?.aborted).toBe(false);

        // Identical facts keep the request and output alive.
        askPanel.sync({ ready: true, facts: { ...FACTS_A } });
        expect(calls[0]?.signal?.aborted).toBe(false);
        expect(out.innerHTML).toBe(askViewHtml({ kind: 'loading' }));

        // Different facts abort immediately, clear output, re-enable button, and keep input value.
        askPanel.sync({ ready: true, facts: FACTS_B });
        expect(calls[0]?.signal?.aborted).toBe(true);
        expect(out.innerHTML).toBe('');
        expect(btn.disabled).toBe(false);
        expect(q.value).toBe('What wavelength is this?');

        // Even if the stale promise resolves later (or if facts switched back to A), the reply is dropped.
        askPanel.sync({ ready: true, facts: FACTS_A });
        gate.resolve(answerReply([3], []));
        await pending;
        expect(out.innerHTML).toBe('');
        expect(btn.disabled).toBe(false);
    });

    it('clears the output, aborts any in-flight request, hides the form, and keeps the question when ready becomes false', async () => {
        let gate = deferred<InsightAnswer>();
        const { askPanel, calls, form, q, out, btn } = setup(() => gate.promise);
        askPanel.sync({ ready: true, facts: FACTS_A });

        q.value = 'Did it move?';
        const first = form.fire('submit');
        gate.resolve(answerReply([1, 2], []));
        await first;
        expect(out.innerHTML).toContain('sk-ask-rows');

        askPanel.sync({ ready: false, facts: null });
        expect(form.hidden).toBe(true);
        expect(out.innerHTML).toBe('');
        expect(q.value).toBe('Did it move?');

        // Also aborts while a request is in flight when ready turns false.
        gate = deferred<InsightAnswer>();
        askPanel.sync({ ready: true, facts: FACTS_A });
        const second = form.fire('submit');
        expect(btn.disabled).toBe(true);
        askPanel.sync({ ready: false, facts: null });
        expect(calls[1]?.signal?.aborted).toBe(true);
        expect(btn.disabled).toBe(false);
        expect(out.innerHTML).toBe('');
        gate.resolve(answerReply([1], []));
        await second;
        expect(out.innerHTML).toBe('');
    });

    it('aborts the first request on a second submit, shows nothing for an aborted request, and keeps the button state accurate', async () => {
        const gate1 = deferred<InsightAnswer>();
        const gate2 = deferred<InsightAnswer>();
        let n = 0;
        const { askPanel, calls, form, q, out, btn } = setup(() => (n++ === 0 ? gate1.promise : gate2.promise));
        askPanel.sync({ ready: true, facts: FACTS_A });

        q.value = 'First question?';
        const first = form.fire('submit');
        expect(calls).toHaveLength(1);
        expect(btn.disabled).toBe(true);

        q.value = 'Second question?';
        const second = form.fire('submit');
        expect(calls).toHaveLength(2);
        expect(calls[0]?.signal?.aborted).toBe(true);
        expect(calls[1]?.signal?.aborted).toBe(false);

        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        gate1.reject(abortErr);
        await first;
        await flush();

        // Second request is still running: loading remains and button stays disabled.
        expect(btn.disabled).toBe(true);
        expect(out.innerHTML).toBe(askViewHtml({ kind: 'loading' }));

        gate2.resolve(answerReply([3], []));
        await second;
        expect(out.innerHTML).toBe(askViewHtml({ kind: 'answer', sheet: factSheet(FACTS_A), lines: [3], trust: [] }));
        expect(btn.disabled).toBe(false);

        // A single request that rejects with AbortError shows nothing and re-enables the button.
        const abortOnly = setup(async () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            throw err;
        });
        abortOnly.askPanel.sync({ ready: true, facts: FACTS_A });
        abortOnly.q.value = 'Aborted question?';
        await abortOnly.form.fire('submit');
        expect(abortOnly.out.innerHTML).toBe('');
        expect(abortOnly.btn.disabled).toBe(false);
    });

    it('never puts the passcode in the panel HTML, attributes, or text', async () => {
        const secret = 'super-secret-passcode-789';
        let mode: 'answer' | 'locked' | 'failed' = 'answer';
        const { doc, askPanel, form, q } = setup(async () => {
            if (mode === 'locked') {
                throw new InsightError('locked');
            }
            if (mode === 'failed') {
                throw new InsightError('failed');
            }
            return answerReply([1, 3], []);
        });

        askPanel.sync({ ready: true, facts: FACTS_A, passcode: secret });
        expect(doc.panel.serialize()).not.toContain(secret);

        q.value = 'What is the wavelength?';
        await form.fire('submit');
        expect(doc.panel.serialize()).not.toContain(secret);

        mode = 'locked';
        await form.fire('submit');
        expect(doc.panel.serialize()).not.toContain(secret);

        mode = 'failed';
        await form.fire('submit');
        expect(doc.panel.serialize()).not.toContain(secret);
    });
});
