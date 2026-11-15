import { AI_LINE, AI_LINK, CONTROL_HELP, GLOSSARY, HELP_INTRO, HELP_TITLE, TERM_ORDER, type ControlId, type TermId } from './help';

function escapeHtml(text: string): string
{
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function helpButtonHtml(): string
{
    return `<button type="button" class="sk-btn2 sk-help-open" data-act="help" aria-haspopup="dialog" aria-label="${escapeHtml(HELP_TITLE)}"><span class="sk-help-wide" aria-hidden="true">${escapeHtml(HELP_TITLE)}</span><span class="sk-help-short" aria-hidden="true">Help</span></button>`;
}

export function helpAltButtonHtml(): string
{
    return `<button type="button" class="sk-help-alt" data-act="help" aria-haspopup="dialog" aria-label="${escapeHtml(HELP_TITLE)}">Help</button>`;
}

export function helpDialogHtml(): string
{
    const terms = TERM_ORDER.map((id) => `<dt>${escapeHtml(GLOSSARY[id].term)}</dt><dd>${escapeHtml(GLOSSARY[id].long)}</dd>`).join('');
    return `<dialog class="sk-help" aria-labelledby="sk-help-title"><div class="sk-help-head"><h2 id="sk-help-title">${escapeHtml(HELP_TITLE)}</h2><button type="button" class="sk-btn2" data-help-close>Close</button></div><p>${escapeHtml(HELP_INTRO)}</p><section><h3>The controls</h3><dl data-help-controls></dl></section><section><h3>Words used here</h3><dl>${terms}</dl></section><p>${escapeHtml(AI_LINE)} <a href="${escapeHtml(AI_LINK)}" target="_blank" rel="noopener">Source list</a></p></dialog>`;
}

export function glossFor(text: string, ids: readonly TermId[]): string[]
{
    // Case does not matter: "Catalogue star" at the start of a sentence is the same term.
    const lower = text.toLowerCase();
    return ids.filter((id) => lower.includes(GLOSSARY[id].find.toLowerCase())).map((id) => GLOSSARY[id].short);
}

export function syncGloss(host: HTMLElement, ids: readonly TermId[]): void
{
    const old = [...host.children].filter((el) => el.classList.contains('sk-gloss'));
    const text = [...host.childNodes].filter((node) => !old.includes(node as Element)).map((node) => node.textContent ?? '').join('');
    const lines = glossFor(text, ids);
    old.forEach((el) => el.remove());
    if (lines.length) {
        const p = host.ownerDocument.createElement('p');
        p.className = 'sk-gloss';
        for (const line of lines) {
            const span = host.ownerDocument.createElement('span');
            span.textContent = line;
            p.append(span);
        }
        host.append(p);
    }
}

export function mountHelp(root: HTMLElement): void
{
    // Two buttons open the guide: the one beside the wordmark, and one beside Focus for when that panel is folded.
    const openers = [...root.querySelectorAll<HTMLButtonElement>('[data-act="help"]')];
    let opener = openers[0]!;
    const dialog = root.querySelector<HTMLDialogElement>('.sk-help')!;
    const list = dialog.querySelector<HTMLElement>('[data-help-controls]')!;
    const optional: Partial<Record<ControlId, string>> = {
        gaia: '[data-act="gaia"]', flags: '[data-act="flags"]', falseColour: '[data-act="falsecolour"]', epoch: '[data-act="epoch"]',
        changes: '[data-ref="changes"]', spectrum: '[data-ref="spec"]', aiNote: '[data-ref="ai"]',
    };
    const ids: ControlId[] = ['target', 'blink', 'stack', 'subtract', 'colour', 'field', 'gaia', 'flags', 'falseColour', 'epoch', 'changes', 'spectrum', 'aiNote'];
    function close(): void
    {
        if (typeof dialog.close === 'function' && dialog.open) {
            dialog.close();
        } else {
            dialog.removeAttribute('open');
            opener.focus();
        }
    }
    function open(from: HTMLButtonElement): void
    {
        opener = from;
        list.replaceChildren();
        for (const id of ids) {
            const selector = optional[id];
            const element = selector ? root.querySelector<HTMLElement>(selector) : null;
            if (selector && (!element || element.closest('[hidden]'))) {
                continue;
            }
            const dt = root.ownerDocument.createElement('dt');
            const dd = root.ownerDocument.createElement('dd');
            dt.textContent = CONTROL_HELP[id].name;
            dd.textContent = CONTROL_HELP[id].line;
            list.append(dt, dd);
        }
        if (typeof dialog.showModal === 'function') {
            dialog.showModal();
        } else {
            // A browser with no <dialog>: show it as a fixed panel on top of the page.
            dialog.classList.add('sk-help-plain');
            dialog.setAttribute('open', '');
            dialog.querySelector<HTMLButtonElement>('[data-help-close]')?.focus();
        }
    }
    for (const button of openers) {
        button.addEventListener('click', () => open(button));
    }
    dialog.querySelector('[data-help-close]')?.addEventListener('click', close);
    dialog.addEventListener('close', () => opener.focus());
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
    dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) {
            return;
        }
        // A click on the guide's own padding also lands on the dialog, so only a click outside its box closes it.
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
            close();
        }
    });
    dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape' && typeof dialog.showModal !== 'function') { event.preventDefault(); close(); } });
}
