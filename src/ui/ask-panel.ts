// The "Ask about this view" box inside the AI panel. The visitor types a question, the language model only
// picks line numbers from this page's measured fact sheet, and askViewHtml prints those measured lines.
import { ASK_ENABLED, askInsight, factSheet, InsightError, validateQuestion, type InsightFacts } from '../lib/insight';
import { askViewHtml, type AskViewState } from './ask-view';

export type Doc = Pick<Document, 'createElement' | 'createTextNode'> & { activeElement: Element | null };

export interface AskPanelDeps {
    enabled?: boolean; // defaults to ASK_ENABLED; tests pass true
    ask?: typeof askInsight;
    doc?: Doc; // the same fake-document type ai-note.ts uses
}

export interface AskPanel {
    // Called by the AI note whenever its state changes (P2). `facts` null means: nothing to ask about.
    sync(state: { ready: boolean; facts: InsightFacts | null; passcode?: string }): void;
}

function isAbort(err: unknown): boolean
{
    return Boolean(err && typeof err === 'object' && 'name' in err && (err as { name: unknown }).name === 'AbortError');
}

export function mountAsk(panel: HTMLElement, deps: AskPanelDeps = {}): AskPanel
{
    const enabled = deps.enabled ?? ASK_ENABLED;
    if (!enabled) {
        return {
            sync(): void
            {
                // Switched off: no DOM, no listeners, no requests.
            },
        };
    }
    const ask = deps.ask ?? askInsight;
    const doc: Doc = deps.doc ?? document;
    const anchor = panel.querySelector('[data-ai="out"]');
    if (!anchor) {
        return {
            sync(): void
            {
                // Missing mount target.
            },
        };
    }

    const form = doc.createElement('form');
    form.className = 'sk-ask-form';
    form.setAttribute('data-ask', 'form');
    form.hidden = true;

    const label = doc.createElement('label');
    label.className = 'sk-ask-label';
    label.htmlFor = 'sk-ask-q';
    label.textContent = 'Ask about this view';

    const row = doc.createElement('div');
    row.className = 'sk-ask-row';

    const input = doc.createElement('input');
    input.id = 'sk-ask-q';
    input.type = 'text';
    input.setAttribute('data-ask', 'q');
    input.maxLength = 200;
    input.setAttribute('maxlength', '200');
    input.autocomplete = 'off';
    input.setAttribute('autocomplete', 'off');
    input.enterKeyHint = 'send';
    input.setAttribute('enterkeyhint', 'send');
    input.placeholder = 'For example: did it get brighter?';

    const btn = doc.createElement('button');
    btn.type = 'submit';
    btn.className = 'sk-btn2';
    btn.textContent = 'Ask';

    const hint = doc.createElement('p');
    hint.className = 'sk-ask-hint';
    hint.textContent = "The AI only picks lines from this page's measurements. It does not write an answer of its own.";

    const out = doc.createElement('div');
    out.setAttribute('data-ask', 'out');

    row.append(input, btn);
    form.append(label, row, hint, out);
    anchor.after(form);

    let ready = false;
    let currentFacts: InsightFacts | null = null;
    let currentKey = '';
    let passcode: string | undefined;
    let ctrl: AbortController | null = null;

    function render(state: AskViewState): void
    {
        try {
            out.innerHTML = askViewHtml(state);
        } catch {
            out.innerHTML = askViewHtml({ kind: 'failed' });
        }
    }

    function reset(): void
    {
        ctrl?.abort();
        ctrl = null;
        btn.disabled = false;
        out.innerHTML = '';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!ready || !currentFacts) {
            return;
        }
        ctrl?.abort();
        ctrl = null;
        btn.disabled = false;

        let question: string;
        try {
            question = validateQuestion(input.value);
        } catch {
            render({ kind: 'invalid' });
            return;
        }

        const reqFacts = currentFacts;
        const sentKey = currentKey;
        const sentFacts = JSON.parse(sentKey) as InsightFacts;
        const sentPass = passcode;
        const c = new AbortController();
        ctrl = c;
        if (doc.activeElement === btn) {
            input.focus();
        }
        btn.disabled = true;
        render({ kind: 'loading' });

        try {
            const answer = await ask(reqFacts, question, {
                signal: c.signal,
                ...(sentPass !== undefined ? { passcode: sentPass } : {}),
            });
            if (c.signal.aborted || ctrl !== c || !ready || currentKey !== sentKey) {
                if (ctrl === c) {
                    out.innerHTML = '';
                }
                return;
            }
            if (answer.kind === 'answer') {
                render({ kind: 'answer', sheet: factSheet(sentFacts), lines: answer.lines, trust: answer.trust });
            } else if (answer.kind === 'none') {
                render({ kind: 'none' });
            } else {
                render({ kind: 'failed' });
            }
        } catch (err) {
            if (ctrl !== c) {
                return;
            }
            if (c.signal.aborted || isAbort(err)) {
                out.innerHTML = '';
                return;
            }
            if (!ready || currentKey !== sentKey) {
                out.innerHTML = '';
                return;
            }
            if (err instanceof InsightError) {
                if (err.code === 'locked') {
                    render({ kind: 'locked' });
                } else if (err.code === 'invalid') {
                    render({ kind: 'invalid' });
                } else if (err.code === 'busy') {
                    render({
                        kind: 'busy',
                        ...(err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {}),
                        ...(err.reason !== undefined ? { reason: err.reason } : {}),
                    });
                } else {
                    render({ kind: 'failed' });
                }
            } else {
                render({ kind: 'failed' });
            }
        } finally {
            if (ctrl === c) {
                ctrl = null;
                btn.disabled = false;
            }
        }
    });

    return {
        sync(state: { ready: boolean; facts: InsightFacts | null; passcode?: string }): void
        {
            const active = state.ready && state.facts !== null;
            const nextKey = active && state.facts ? JSON.stringify(state.facts) : '';
            if (!active || nextKey !== currentKey) {
                reset();
            }
            ready = active;
            currentFacts = active ? state.facts : null;
            currentKey = nextKey;
            passcode = state.passcode;
            form.hidden = !active;
        },
    };
}
