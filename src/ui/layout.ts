// Side rails: drag the dividers to resize, fold either rail to a thin tab, or fold both for Focus.
// Wide screens only (over 1080 px); the one-column phone layout ignores all of this.

type Side = 'left' | 'right';
interface Saved { lw?: number; rw?: number; left?: boolean; right?: boolean }

const KEY = 'slowsky.layout';
const MIN_W = 220;
const MAX_W = 420;
const MIN_CENTRE = 460;
const STEP = 16;
const FOLDED_W = 40; // matches --lcol and --rcol for a folded rail in styles.css

function read(): Saved
{
    try {
        const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        return v && typeof v === 'object' ? v as Saved : {};
    } catch {
        return {};
    }
}

function write(s: Saved): void
{
    try {
        localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
        // Private mode or storage full: the layout just isn't remembered.
    }
}

export interface Layout {
    toggleFocus(): void;
}

export function initLayout(root: HTMLElement): Layout
{
    const wide = matchMedia('(min-width: 1081px)');
    const saved = read();
    const width: Record<Side, number | undefined> = { left: num(saved.lw), right: num(saved.rw) };
    const folded: Record<Side, boolean> = { left: saved.left === true, right: saved.right === true };
    const split = (s: Side) => root.querySelector(`.sk-split[data-side="${s}"]`) as HTMLElement;
    const focusBtn = root.querySelector('[data-act="focus"]') as HTMLButtonElement;

    function num(v: unknown): number | undefined
    {
        return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined;
    }

    // The widest a rail may be right now: never past MAX_W, and never so wide the centre drops under MIN_CENTRE.
    function maxFor(s: Side): number
    {
        const other: Side = s === 'left' ? 'right' : 'left';
        const cs = getComputedStyle(root);
        const inner = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const guts = [...root.querySelectorAll<HTMLElement>('.sk-gut')].reduce((n, g) => n + g.offsetWidth, 0);
        const room = inner - guts - (folded[other] ? FOLDED_W : current(other)) - MIN_CENTRE;
        return Math.max(MIN_W, Math.min(MAX_W, Math.floor(room)));
    }

    // The width a rail is set to, not what it measures: during the fold animation the two differ.
    function current(s: Side): number
    {
        const w = width[s];
        return w ?? (parseFloat(getComputedStyle(root).getPropertyValue(s === 'left' ? '--lw' : '--rw')) || MIN_W);
    }

    function clamp(s: Side, w: number): number
    {
        return Math.max(MIN_W, Math.min(maxFor(s), Math.round(w)));
    }

    // Saved widths can be too wide for this window together, or once a folded rail opens again: fit both.
    function fit(): void
    {
        if (!wide.matches) {
            return;
        }
        for (const s of ['left', 'right', 'left'] as Side[]) {
            const w = width[s];
            if (w !== undefined) {
                width[s] = clamp(s, w);
            }
        }
    }

    function apply(): void
    {
        for (const s of ['left', 'right'] as Side[]) {
            const w = width[s];
            const prop = s === 'left' ? '--lw' : '--rw';
            if (w === undefined) {
                root.style.removeProperty(prop);
            } else {
                root.style.setProperty(prop, `${w}px`);
            }
            if (folded[s]) {
                root.dataset[s] = 'min';
            } else {
                delete root.dataset[s];
            }
            const open = !folded[s];
            root.querySelectorAll(`[data-act="fold-${s}"]`).forEach((b) => {
                b.setAttribute('aria-expanded', String(open));
            });
            const sp = split(s);
            sp.setAttribute('aria-valuenow', String(open ? Math.round(current(s)) : 0));
            sp.setAttribute('aria-valuemax', String(maxFor(s)));
        }
        const focus = folded.left && folded.right;
        focusBtn.setAttribute('aria-pressed', String(focus));
        focusBtn.lastChild!.textContent = focus ? 'Show panels' : 'Focus';
    }

    function save(): void
    {
        write({ lw: width.left, rw: width.right, left: folded.left, right: folded.right });
    }

    function fold(s: Side, v: boolean): void
    {
        folded[s] = v;
        fit();
        apply();
        save();
    }

    function toggleFocus(): void
    {
        const on = !(folded.left && folded.right);
        folded.left = on;
        folded.right = on;
        fit();
        apply();
        save();
    }

    function setWidth(s: Side, w: number | undefined): void
    {
        folded[s] = false;
        width[s] = w === undefined ? undefined : clamp(s, w);
        apply();
    }

    // ---------- drag ----------
    for (const s of ['left', 'right'] as Side[]) {
        const sp = split(s);
        sp.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !wide.matches) {
                return;
            }
            e.preventDefault();
            sp.setPointerCapture(e.pointerId);
            const x0 = e.clientX;
            const w0 = folded[s] ? MIN_W : current(s);
            root.dataset.drag = '';
            const move = (ev: PointerEvent) => {
                const dx = ev.clientX - x0;
                setWidth(s, w0 + (s === 'left' ? dx : -dx));
            };
            const up = () => {
                sp.removeEventListener('pointermove', move);
                sp.removeEventListener('pointerup', up);
                sp.removeEventListener('pointercancel', up);
                delete root.dataset.drag;
                save();
            };
            sp.addEventListener('pointermove', move);
            sp.addEventListener('pointerup', up);
            sp.addEventListener('pointercancel', up);
        });
        sp.addEventListener('dblclick', () => {
            setWidth(s, undefined);
            save();
        });
        // Keyboard: arrows resize, Home and End jump to the limits, Enter folds. The page's own arrow keys step frames,
        // so these never bubble up to it.
        sp.addEventListener('keydown', (e) => {
            const cur = folded[s] ? MIN_W : current(s);
            const out = s === 'left' ? 1 : -1;
            let next: number | undefined;
            if (e.key === 'ArrowRight') {
                next = cur + STEP * out;
            } else if (e.key === 'ArrowLeft') {
                next = cur - STEP * out;
            } else if (e.key === 'Home') {
                next = MIN_W;
            } else if (e.key === 'End') {
                next = MAX_W;
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                fold(s, !folded[s]);
                return;
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            setWidth(s, next);
            save();
        });
    }

    root.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act^="fold-"], [data-act="focus"]');
        if (!b) {
            return;
        }
        if (b.dataset.act === 'focus') {
            toggleFocus();
        } else {
            const s = b.dataset.act === 'fold-left' ? 'left' : 'right';
            fold(s, !folded[s]);
        }
    });

    // A saved width can be too wide for a smaller window: clamp again whenever the page resizes.
    let raf = 0;
    addEventListener('resize', () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
            fit();
            apply();
        });
    });
    wide.addEventListener('change', () => {
        fit();
        apply();
    });

    fit();
    apply();
    return { toggleFocus };
}
