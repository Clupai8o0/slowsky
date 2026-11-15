// The "tool" frame around the sky (d4 layout, 15 Nov): top bar, tool rail, inspector tabs, target picker,
// undo and redo, zoom and pan, loupe, guide tour, tool labels, theme and the hover-help line.
// It only moves the page's own controls about; app.ts still owns the data and every reading of it.

export const HISTORY_LIMIT = 60;
export const HISTORY_GROUP_MS = 450;

// Undo steps. Changes closer together than HISTORY_GROUP_MS fold into one step, so a drag or a run of
// quick clicks is undone at once. The same view twice in a row is one step.
export class History<T>
{
    private past: string[] = [];
    private future: string[] = [];
    private last = 0;

    constructor(private readonly limit = HISTORY_LIMIT, private readonly groupMs = HISTORY_GROUP_MS)
    {
    }

    get canUndo(): boolean
    {
        return this.past.length > 1;
    }

    get canRedo(): boolean
    {
        return this.future.length > 0;
    }

    record(snap: T, now = Date.now()): boolean
    {
        const s = JSON.stringify(snap);
        const top = this.past[this.past.length - 1];
        if (s === top) {
            return false;
        }
        if (top !== undefined && this.past.length > 1 && now - this.last < this.groupMs) {
            this.past[this.past.length - 1] = s;
        } else {
            this.past.push(s);
            if (this.past.length > this.limit + 1) {
                this.past.shift();
            }
        }
        this.last = now;
        this.future = [];
        return true;
    }

    // Replace the newest step without dropping redo: a load that finishes fills in the step it started.
    amend(snap: T): void
    {
        const s = JSON.stringify(snap);
        if (this.past.length) {
            this.past[this.past.length - 1] = s;
        } else {
            this.past.push(s);
        }
    }

    undo(): T | undefined
    {
        if (!this.canUndo) {
            return undefined;
        }
        this.future.push(this.past.pop() as string);
        this.last = 0;
        return JSON.parse(this.past[this.past.length - 1] as string) as T;
    }

    redo(): T | undefined
    {
        const s = this.future.pop();
        if (s === undefined) {
            return undefined;
        }
        this.past.push(s);
        this.last = 0;
        return JSON.parse(s) as T;
    }
}

export interface View
{
    zoom: number;
    panX: number; // fraction of the stage width
    panY: number;
}

export const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8];

export function clampPan(v: View): View
{
    // A zoomed picture can move until its edge reaches the stage's edge, no further.
    const max = (v.zoom - 1) / 2;
    const c = (x: number) => Math.max(-max, Math.min(max, x));
    return { zoom: v.zoom, panX: c(v.panX), panY: c(v.panY) };
}

export function zoomStep(z: number, dir: 1 | -1): number
{
    if (dir > 0) {
        return ZOOMS.find((s) => s > z + 1e-6) ?? ZOOMS[ZOOMS.length - 1]!;
    }
    return [...ZOOMS].reverse().find((s) => s < z - 1e-6) ?? 1;
}

export interface TourStep
{
    sel: string;
    title: string;
    text: string;
    tab?: string; // inspector tab to open first
}

// One stop per area of the page. Wording matches CONTROL_HELP and the guide.
export const TOUR: readonly TourStep[] = [
    { sel: '[data-ref="stage"]', title: 'The sky', text: 'Real SPHEREx pixels of one small patch of sky. Each frame was taken on a different date.' },
    { sel: '.tb-target', title: 'Pick a target', text: 'Five saved targets, or search any star name or RA, Dec. ⌘K or Ctrl+K opens this from anywhere.' },
    { sel: '.tb-ws', title: 'Sky library or My frames', text: 'Sky library reads NASA’s archive. My frames runs your own FITS, PNG or JPG files through the same steps, in this browser.' },
    { sel: '.tb-mode', title: 'Blink, Stack, Subtract', text: 'Blink plays the frames in date order. Stack averages them. Subtract takes one visit away from another, so what changed stands out.' },
    { sel: '[data-act="play"]', title: 'Play', text: 'Plays the frames in date order. Space pauses; the arrow keys step one frame.' },
    { sel: '.tb-speed', title: 'Speed', text: 'Half, normal or double speed.' },
    { sel: '[data-ref="strip"]', title: 'Dates', text: 'One small picture per frame, in date order. Press one to show it.' },
    { sel: '.tb-colour', title: 'Colour', text: 'SPHEREx sees 102 infrared colours. Drag, then let go to load that colour. Your eyes stop at 0.70 µm.' },
    { sel: '[data-tool="ring"]', title: 'Ring', text: 'The gold ring is where the target’s catalogue motion puts it on this date. It is a prediction, not a measurement.' },
    { sel: '[data-tool="trail"]', title: 'Trail', text: 'Dots where the ring would be on the other dates.' },
    { sel: '[data-act="gaia"]', title: 'Gaia stars', text: 'Rings on the brightest stars in ESA’s Gaia catalogue, moved to each frame’s date.' },
    { sel: '[data-tool="loupe"]', title: 'Loupe', text: 'Magnifies the real pixels under the pointer.' },
    { sel: '[data-tool="hold"]', title: 'Compare', text: 'Hold to see the first frame; let go to come back.' },
    { sel: '[data-tool="zoomin"]', title: 'Zoom and fit', text: 'Zoom in, scroll or pinch on the sky, and drag to pan. Fit or double-click brings the whole picture back.' },
    { sel: '[data-tool="inspect"]', title: 'Inspector', text: 'Tabs for the target, this frame, candidate changes, charts and extras such as the comet 3I/ATLAS.', tab: 'info' },
    { sel: '[data-act="undo"]', title: 'Undo and redo', text: 'Go back a step: a target, view, date, zoom, ring, trail, loupe or Gaia change. ⌘Z or Ctrl+Z.' },
    { sel: '[data-act="help"]', title: 'Guide', text: 'Every control and every word this page uses, in plain language. G opens it.' },
    { sel: '[data-act="labels"]', title: 'Tool labels', text: 'Shows or hides the labels under the tools. Hover any control for a line of help at the foot of the page.' },
];

// Inspector tabs whose cards can all be switched off. Candidates and Charts then say so in a line; the AI note
// tab goes away, because on a site where the note is switched off it has nothing to offer (and never will).
export const TAB_CARDS: Readonly<Record<string, readonly string[]>> = Object.freeze({ cands: ['changes'], charts: ['curve', 'halo', 'spec'], ai: ['ai'] });
export const HIDE_EMPTY_TABS: readonly string[] = ['ai'];

export interface TabState
{
    tab: string;
    empty: boolean; // every card on the tab is hidden
    hide: boolean; // the tab itself is hidden
}

export function tabStates(cardHidden: (ref: string) => boolean): TabState[]
{
    return Object.entries(TAB_CARDS).map(([tab, cards]) => {
        const empty = cards.every(cardHidden);
        return { tab, empty, hide: empty && HIDE_EMPTY_TABS.includes(tab) };
    });
}

export interface ToolApi
{
    isLoading(): boolean;
    onView(view: View): void; // zoom or pan changed
    onLayers(ring: boolean, trail: boolean): void;
    loupeOn(on: boolean): void;
    holdStart(): void;
    holdEnd(): void;
    canHold(): boolean;
    coordAt(fx: number, fy: number): string | null; // fractions of the picture, 0..1
    undo(): void;
    redo(): void;
    setWs(ws: 'sky' | 'mine'): void;
    files(list: FileList | File[]): void;
    coachText(): string;
}

export interface Tool
{
    view: View;
    ring: boolean;
    trail: boolean;
    loupe: boolean;
    setView(v: View, quiet?: boolean): void;
    setLayers(ring: boolean, trail: boolean, loupe: boolean): void;
    openTab(tab: string): void;
    openInspector(on: boolean): void;
    setHistory(canUndo: boolean, canRedo: boolean): void;
    setWs(ws: 'sky' | 'mine'): void;
    closePicker(): void;
    say(text: string): void;
}

const store = {
    get(k: string): string | null
    {
        try {
            return localStorage.getItem(k);
        } catch {
            return null;
        }
    },
    set(k: string, v: string): void
    {
        try {
            localStorage.setItem(k, v);
        } catch {
            // private window: the setting lasts this visit only
        }
    },
};

export function mountTool(root: HTMLElement, api: ToolApi): Tool
{
    const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    const qa = <T extends Element>(sel: string) => [...root.querySelectorAll(sel)] as T[];
    const ref = <T extends Element>(name: string) => q<T>(`[data-ref="${name}"]`);
    const doc = root.ownerDocument;
    const sky = ref<HTMLElement>('sky');
    const zoomBox = ref<HTMLElement>('zoom');
    const insp = ref<HTMLElement>('insp');
    const work = ref<HTMLElement>('work');
    const picker = ref<HTMLElement>('picker');
    const help = ref<HTMLElement>('statusHelp');
    const coord = ref<HTMLButtonElement>('coord');
    const loupeEl = ref<HTMLElement>('loupe');
    const loupeCanvas = loupeEl.querySelector('canvas') as HTMLCanvasElement;
    const picture = ref<HTMLCanvasElement>('canvas');

    const tool: Tool = {
        view: { zoom: 1, panX: 0, panY: 0 },
        ring: true,
        trail: false,
        loupe: false,
        setView,
        setLayers,
        openTab,
        openInspector,
        setHistory,
        setWs,
        closePicker,
        say,
    };

    // ---------- theme and labels: saved per browser ----------
    const theme = store.get('slowsky.theme') === 'light' ? 'light' : 'dark';
    setTheme(theme);
    function setTheme(t: 'light' | 'dark'): void
    {
        root.dataset.theme = t;
        doc.documentElement.dataset.theme = t;
        const b = q<HTMLButtonElement>('[data-act="theme"]');
        b.setAttribute('aria-label', t === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
        doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0a0c12' : '#f5f6f8');
    }
    const labels = store.get('slowsky.labels') !== 'off';
    setLabels(labels);
    function setLabels(on: boolean): void
    {
        root.classList.toggle('tb-labels', on);
        const b = q<HTMLButtonElement>('[data-act="labels"]');
        b.setAttribute('aria-pressed', String(on));
        b.dataset.help = on ? 'Labels under every tool: on. Press to hide them once you know the tools.'
            : 'Labels under every tool: off. Press to show them again.';
    }

    // ---------- boot: the picture frame holds the loading mark until the first view is ready ----------
    root.classList.add('tb-booting');
    const loadWatch = new MutationObserver(() => {
        const loading = !!root.dataset.loading;
        if (!loading && root.classList.contains('tb-booting')) {
            root.classList.remove('tb-booting');
            root.classList.add('tb-booted');
            maybeCoach();
        }
        if (loading && searched) {
            searched = false;
            closePicker();
        }
        if (!loading) {
            qa<HTMLElement>('.is-busy').forEach((el) => el.classList.remove('is-busy'));
        } else if (lastControl && Date.now() - lastControlAt < 600 && root.contains(lastControl)) {
            lastControl.classList.add('is-busy');
        }
    });
    loadWatch.observe(root, { attributes: true, attributeFilter: ['data-loading'] });
    let lastControl: HTMLElement | null = null;
    let lastControlAt = 0;
    const markControl = (el: HTMLElement | null) => {
        lastControl = el;
        lastControlAt = Date.now();
    };
    root.addEventListener('change', (e) => markControl((e.target as HTMLElement).closest('label, .tb-colour') as HTMLElement | null ?? e.target as HTMLElement), true);

    // ---------- hover help: one line at the foot of the page ----------
    const helpFor = (el: Element | null): string => {
        const h = el?.closest('[data-help]') as HTMLElement | null;
        return h?.dataset.help ?? '';
    };
    const idle = 'Hover or focus any control for a line of help. G opens the guide.';
    help.textContent = idle;
    function say(text: string): void
    {
        help.textContent = text || idle;
    }
    root.addEventListener('pointerover', (e) => say(helpFor(e.target as Element)));
    root.addEventListener('focusin', (e) => say(helpFor(e.target as Element)));

    // ---------- inspector ----------
    function openInspector(on: boolean): void
    {
        insp.hidden = !on;
        work.classList.toggle('tb-inspecting', on);
        q<HTMLButtonElement>('[data-tool="inspect"]').setAttribute('aria-pressed', String(on));
    }
    function openTab(tab: string): void
    {
        openInspector(true);
        selectTab(tab);
    }
    function selectTab(tab: string): void
    {
        qa<HTMLButtonElement>('.tb-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
        qa<HTMLElement>('[data-panel]').forEach((p) => {
            p.hidden = p.dataset.panel !== tab;
        });
        store.set('slowsky.tab', tab);
    }
    const tabKeys = (e: KeyboardEvent) => {
        const tabs = qa<HTMLButtonElement>('.tb-tabs [data-tab]').filter((b) => !b.hidden);
        const i = tabs.indexOf(e.target as HTMLButtonElement);
        if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) {
            return;
        }
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
        openTab(next.dataset.tab!);
        next.focus();
        e.preventDefault();
        e.stopPropagation();
    };
    q<HTMLElement>('.tb-tabs').addEventListener('keydown', tabKeys);
    // Wide screens open the inspector on the Target tab, so every card is one press away; phones keep it shut.
    // Phones show it inline, below the sky, so nothing is hidden there either.
    if (matchMedia('(min-width: 1101px), (max-width: 899px)').matches) {
        openTab(store.get('slowsky.tab') ?? 'info');
    } else {
        openTab('info');
        openInspector(false);
    }

    // A tab whose cards are all switched off for this view says so, instead of showing nothing; see TAB_CARDS.
    const syncEmpty = () => {
        for (const t of tabStates((c) => ref<HTMLElement>(c)?.hidden !== false)) {
            const note = ref<HTMLElement>(`${t.tab}None`);
            const showNote = t.empty && !t.hide;
            if (note && note.hidden !== !showNote) {
                note.hidden = !showNote;
            }
            const button = q<HTMLButtonElement>(`.tb-tabs [data-tab="${t.tab}"]`);
            if (button.hidden !== t.hide) {
                button.hidden = t.hide;
            }
            if (t.hide && button.getAttribute('aria-selected') === 'true') {
                selectTab('info');
            }
        }
    };
    const emptyWatch = new MutationObserver(syncEmpty);
    for (const cards of Object.values(TAB_CARDS)) {
        for (const c of cards) {
            const el = ref<HTMLElement>(c);
            if (el) {
                emptyWatch.observe(el, { attributes: true, attributeFilter: ['hidden'] });
            }
        }
    }
    syncEmpty();

    // ---------- target picker (⌘K) ----------
    let pickerFrom: HTMLElement | null = null;
    let searched = false; // a search was sent from the picker: close it once that search starts loading
    function openPicker(): void
    {
        pickerFrom = doc.activeElement as HTMLElement | null;
        picker.hidden = false;
        searched = false;
        const input = picker.querySelector('input') as HTMLInputElement;
        input.value = '';
        filterPicker('');
        input.focus();
    }
    function closePicker(): void
    {
        if (picker.hidden) {
            return;
        }
        picker.hidden = true;
        pickerFrom?.focus?.();
    }
    function filterPicker(text: string): void
    {
        const t = text.trim().toLowerCase();
        for (const b of picker.querySelectorAll<HTMLButtonElement>('[data-target]')) {
            b.hidden = !!t && !b.textContent!.toLowerCase().includes(t);
        }
    }
    picker.addEventListener('input', (e) => filterPicker((e.target as HTMLInputElement).value));
    picker.addEventListener('click', (e) => {
        if (e.target === picker) {
            closePicker();
        } else if ((e.target as Element).closest('[data-target]')) {
            closePicker();
        }
    });
    picker.addEventListener('keydown', (e) => {
        const list = [...picker.querySelectorAll<HTMLButtonElement>('[data-target]')].filter((b) => !b.hidden);
        const i = list.indexOf(doc.activeElement as HTMLButtonElement);
        e.stopPropagation(); // keys in the picker never reach the page's own shortcuts
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            closePicker();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closePicker();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = list.length;
            if (n) {
                const next = e.key === 'ArrowDown' ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1);
                list[next]!.focus();
            }
        } else if (e.key === 'Tab') {
            // Focus stays in the dialog while it is open.
            const f = [picker.querySelector('input') as HTMLElement, ...list];
            const at = f.indexOf(doc.activeElement as HTMLElement);
            e.preventDefault();
            f[(at + (e.shiftKey ? f.length - 1 : 1)) % f.length]!.focus();
        }
    });
    // A search that resolves closes the picker (app.ts loads the spot); a failed one leaves it open with the toast.
    picker.querySelector('form')!.addEventListener('submit', () => {
        searched = true;
    });

    // ---------- workspace: Sky library or My frames ----------
    function setWs(ws: 'sky' | 'mine'): void
    {
        qa<HTMLButtonElement>('[data-ws]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ws === ws)));
        root.dataset.ws = ws;
    }

    // ---------- zoom and pan ----------
    function setView(v: View, quiet = false): void
    {
        tool.view = clampPan({ zoom: Math.max(1, Math.min(ZOOMS[ZOOMS.length - 1]!, v.zoom)), panX: v.panX, panY: v.panY });
        zoomBox.style.transform = tool.view.zoom === 1 ? ''
            : `translate(${(tool.view.panX * 100).toFixed(3)}%, ${(tool.view.panY * 100).toFixed(3)}%) scale(${tool.view.zoom})`;
        sky.classList.toggle('tb-zoomed', tool.view.zoom > 1);
        ref<HTMLElement>('zoomLabel').textContent = `${Number(tool.view.zoom.toFixed(1))}×`;
        if (!quiet) {
            api.onView(tool.view);
        }
    }
    function zoomAt(z: number, fx = 0.5, fy = 0.5): void
    {
        // Keep the point under the pointer where it is.
        const v = tool.view;
        const k = z / v.zoom;
        const ox = fx - 0.5;
        const oy = fy - 0.5;
        setView({ zoom: z, panX: ox - (ox - v.panX) * k, panY: oy - (oy - v.panY) * k });
    }
    const frac = (e: { clientX: number; clientY: number }) => {
        const r = sky.getBoundingClientRect();
        return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
    };
    // The picture's own fraction under a point, through the zoom and pan.
    const picFrac = (e: { clientX: number; clientY: number }) => {
        const { fx, fy } = frac(e);
        const v = tool.view;
        return { x: (fx - 0.5 - v.panX) / v.zoom + 0.5, y: (fy - 0.5 - v.panY) / v.zoom + 0.5 };
    };
    sky.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && Math.abs(e.deltaY) < 1) {
            return;
        }
        e.preventDefault();
        const { fx, fy } = frac(e);
        const z = Math.max(1, Math.min(8, tool.view.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))));
        zoomAt(z < 1.02 ? 1 : z, fx, fy);
    }, { passive: false });
    sky.addEventListener('dblclick', (e) => {
        if ((e.target as Element).closest('button, a')) {
            return;
        }
        setView({ zoom: 1, panX: 0, panY: 0 });
    });
    let drag: { id: number; x: number; y: number; px: number; py: number } | null = null;
    sky.addEventListener('pointerdown', (e) => {
        if (tool.view.zoom <= 1 || e.button !== 0 || (e.target as Element).closest('button, a')) {
            return;
        }
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: tool.view.panX, py: tool.view.panY };
        sky.setPointerCapture(e.pointerId);
        sky.classList.add('tb-panning');
    });
    sky.addEventListener('pointermove', (e) => {
        const p = picFrac(e);
        const inside = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
        coord.textContent = inside ? (api.coordAt(p.x, p.y) ?? '—') : '—';
        if (tool.loupe) {
            paintLoupe(e, p.x, p.y, inside);
        }
        if (drag && e.pointerId === drag.id) {
            const r = sky.getBoundingClientRect();
            setView({ zoom: tool.view.zoom, panX: drag.px + (e.clientX - drag.x) / r.width, panY: drag.py + (e.clientY - drag.y) / r.height });
        }
    });
    const endDrag = () => {
        drag = null;
        sky.classList.remove('tb-panning');
    };
    sky.addEventListener('pointerup', endDrag);
    sky.addEventListener('pointercancel', endDrag);
    sky.addEventListener('pointerleave', () => {
        loupeEl.hidden = true;
    });
    coord.addEventListener('click', () => {
        const t = coord.textContent ?? '';
        if (t && t !== '—') {
            void navigator.clipboard?.writeText(t);
            say(`Copied ${t}`);
        }
    });

    // ---------- loupe: 2x of the real pixels, no smoothing ----------
    function paintLoupe(e: PointerEvent, x: number, y: number, inside: boolean): void
    {
        if (!inside || !picture.width) {
            loupeEl.hidden = true;
            return;
        }
        // False colour and the older picture cover the SPHEREx canvas; the loupe only magnifies SPHEREx pixels.
        if (ref<HTMLElement>('fc').hidden === false || ref<HTMLElement>('epoch').hidden === false) {
            loupeEl.hidden = true;
            say('The loupe magnifies SPHEREx pixels only. Turn off False colour or Older picture to use it.');
            return;
        }
        loupeEl.hidden = false;
        const r = sky.getBoundingClientRect();
        const lx = Math.min(r.width - 160, Math.max(10, e.clientX - r.left + 20));
        const ly = Math.min(r.height - 160, Math.max(10, e.clientY - r.top - 170));
        loupeEl.style.left = `${lx}px`;
        loupeEl.style.top = `${Math.max(10, ly)}px`;
        const c = loupeCanvas.getContext('2d') as CanvasRenderingContext2D;
        c.imageSmoothingEnabled = false;
        // The loupe shows twice the on-screen scale of the picture.
        const shown = (r.width * tool.view.zoom) / picture.width;
        const span = 150 / (shown * 2);
        c.fillStyle = '#05070d';
        c.fillRect(0, 0, 150, 150);
        c.drawImage(picture, x * picture.width - span / 2, y * picture.height - span / 2, span, span, 0, 0, 150, 150);
    }

    // ---------- layers ----------
    function setLayers(ring: boolean, trail: boolean, loupe: boolean): void
    {
        tool.ring = ring;
        tool.trail = trail;
        tool.loupe = loupe;
        q('[data-tool="ring"]').setAttribute('aria-pressed', String(ring));
        q('[data-tool="trail"]').setAttribute('aria-pressed', String(trail));
        q('[data-tool="loupe"]').setAttribute('aria-pressed', String(loupe));
        sky.classList.toggle('tb-loupe-on', loupe);
        if (!loupe) {
            loupeEl.hidden = true;
        }
    }

    // ---------- hold to compare ----------
    const holdBtn = q<HTMLButtonElement>('[data-tool="hold"]');
    let holding = false;
    const holdOn = () => {
        if (!api.canHold()) {
            say('Compare works in Blink, on a later frame, once the frames have loaded.');
            return;
        }
        holding = true;
        holdBtn.classList.add('held');
        api.holdStart();
    };
    const holdOff = () => {
        if (holding) {
            holding = false;
            holdBtn.classList.remove('held');
            api.holdEnd();
        }
    };
    holdBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        holdOn();
    });
    holdBtn.addEventListener('pointerup', holdOff);
    holdBtn.addEventListener('pointerleave', holdOff);
    holdBtn.addEventListener('pointercancel', holdOff);
    holdBtn.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            holdOn();
        }
    });
    holdBtn.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
            holdOff();
        }
    });

    // ---------- coach and tour ----------
    const coach = ref<HTMLElement>('coach');
    function maybeCoach(): void
    {
        if (store.get('slowsky.coach') === 'done') {
            return;
        }
        ref<HTMLElement>('coachText').textContent = api.coachText();
        coach.hidden = false;
    }
    let tourAt = -1;
    let mark: HTMLElement | null = null;
    let tip: HTMLElement | null = null;
    function endTour(): void
    {
        tourAt = -1;
        mark?.remove();
        tip?.remove();
        mark = null;
        tip = null;
        doc.removeEventListener('keydown', tourKeys, true);
    }
    function tourKeys(e: KeyboardEvent): void
    {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            endTour();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            showStep(tourAt + 1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            showStep(Math.max(0, tourAt - 1));
        }
    }
    function showStep(i: number): void
    {
        const steps = TOUR.filter((s) => {
            const el = root.querySelector<HTMLElement>(s.sel);
            return !!el && !el.hidden && el.getClientRects().length > 0;
        });
        if (i >= steps.length) {
            endTour();
            return;
        }
        const s = steps[i]!;
        tourAt = i;
        if (s.tab) {
            openTab(s.tab);
        }
        const el = root.querySelector<HTMLElement>(s.sel)!;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        if (!mark) {
            mark = doc.createElement('div');
            mark.className = 'tb-tourmark';
            tip = doc.createElement('div');
            tip.className = 'tb-tourtip';
            tip.setAttribute('role', 'dialog');
            tip.setAttribute('aria-live', 'polite');
            root.append(mark, tip);
            doc.addEventListener('keydown', tourKeys, true);
        }
        mark.style.cssText = `left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`;
        tip!.innerHTML = '';
        const b = doc.createElement('b');
        b.textContent = s.title;
        const p = doc.createElement('p');
        p.textContent = s.text;
        const row = doc.createElement('div');
        row.className = 'row';
        const n = doc.createElement('span');
        n.textContent = `${i + 1} / ${steps.length}`;
        const skip = doc.createElement('button');
        skip.type = 'button';
        skip.className = 'tb-btn ghost sm';
        skip.textContent = 'Close';
        skip.addEventListener('click', endTour);
        const next = doc.createElement('button');
        next.type = 'button';
        next.className = 'tb-btn tb-primary sm';
        next.textContent = i + 1 < steps.length ? 'Next' : 'Done';
        next.addEventListener('click', () => showStep(i + 1));
        row.append(n, skip, next);
        tip!.append(b, p, row);
        const w = 270;
        const vw = doc.documentElement.clientWidth;
        const vh = doc.documentElement.clientHeight;
        let left = r.right + 14;
        let top = r.top;
        if (left + w > vw - 8) {
            left = Math.max(8, Math.min(vw - w - 8, r.left));
            top = r.bottom + 14;
        }
        if (top + 170 > vh) {
            top = Math.max(8, r.top - 180);
        }
        tip!.style.cssText = `left:${left}px;top:${top}px;width:${w}px`;
        next.focus();
    }

    // ---------- guide: a search box over the guide's lists ----------
    const dialog = root.querySelector<HTMLDialogElement>('dialog.sk-help');
    if (dialog) {
        const box = doc.createElement('input');
        box.type = 'text';
        box.className = 'tb-gsearch';
        box.placeholder = 'Search the guide';
        box.setAttribute('aria-label', 'Search the guide');
        dialog.querySelector('.sk-help-head')?.after(box);
        const none = doc.createElement('p');
        none.className = 'sk-body mute';
        none.textContent = 'Nothing in the guide matches that.';
        none.hidden = true;
        box.after(none);
        box.addEventListener('input', () => {
            const t = box.value.trim().toLowerCase();
            let shown = 0;
            dialog.querySelectorAll('dt').forEach((dt) => {
                const dd = dt.nextElementSibling as HTMLElement | null;
                const hit = !t || (dt.textContent + ' ' + (dd?.textContent ?? '')).toLowerCase().includes(t);
                (dt as HTMLElement).hidden = !hit;
                if (dd) {
                    dd.hidden = !hit;
                }
                shown += hit ? 1 : 0;
            });
            none.hidden = shown > 0;
        });
    }

    // ---------- buttons ----------
    root.addEventListener('click', (e) => {
        const b = (e.target as Element).closest('button');
        if (!b || !root.contains(b)) {
            if (!(e.target as Element).closest('.tb-about, [data-act="about"]')) {
                ref<HTMLElement>('about').hidden = true;
            }
            return;
        }
        if (b.closest('.tb-tools, .tb-bar, .tb-time')) {
            markControl(b);
        }
        const t = b.dataset.tool;
        const act = b.dataset.act;
        if (b.dataset.tab) {
            openTab(b.dataset.tab);
        } else if (b.dataset.ws === 'sky' || b.dataset.ws === 'mine') {
            api.setWs(b.dataset.ws);
        } else if (t === 'loupe') {
            setLayers(tool.ring, tool.trail, !tool.loupe);
            api.loupeOn(tool.loupe);
        } else if (t === 'ring' || t === 'trail') {
            setLayers(t === 'ring' ? !tool.ring : tool.ring, t === 'trail' ? !tool.trail : tool.trail, tool.loupe);
            api.onLayers(tool.ring, tool.trail);
        } else if (t === 'cands') {
            openTab('cands');
        } else if (t === 'zoomin') {
            zoomAt(zoomStep(tool.view.zoom, 1));
        } else if (t === 'fit') {
            setView({ zoom: 1, panX: 0, panY: 0 });
        } else if (t === 'inspect') {
            openInspector(insp.hidden === true);
        } else if (t === 'focus') {
            const on = !root.classList.contains('tb-focus');
            root.classList.toggle('tb-focus', on);
            b.setAttribute('aria-pressed', String(on));
            if (on) {
                openInspector(false);
            }
        } else if (act === 'insp-close') {
            openInspector(false);
        } else if (act === 'picker') {
            openPicker();
        } else if (act === 'undo') {
            api.undo();
        } else if (act === 'redo') {
            api.redo();
        } else if (act === 'labels') {
            const on = !root.classList.contains('tb-labels');
            setLabels(on);
            store.set('slowsky.labels', on ? 'on' : 'off');
            say(b.dataset.help ?? '');
        } else if (act === 'theme') {
            const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
            setTheme(next);
            store.set('slowsky.theme', next);
        } else if (act === 'about') {
            const a = ref<HTMLElement>('about');
            a.hidden = !a.hidden;
            b.setAttribute('aria-expanded', String(!a.hidden));
        } else if (act === 'upload') {
            ref<HTMLInputElement>('file').click();
        } else if (act === 'tour') {
            coach.hidden = true;
            store.set('slowsky.coach', 'done');
            showStep(0);
        } else if (act === 'coach-close') {
            coach.hidden = true;
            store.set('slowsky.coach', 'done');
        }
    });
    ref<HTMLInputElement>('file').addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        if (input.files && input.files.length) {
            api.files([...input.files]);
        }
        input.value = '';
    });

    // ---------- drop files anywhere on the workspace ----------
    const drop = ref<HTMLElement>('drop');
    let dragDepth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    work.addEventListener('dragenter', (e) => {
        if (hasFiles(e)) {
            dragDepth++;
            drop.hidden = false;
        }
    });
    work.addEventListener('dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) {
            drop.hidden = true;
        }
    });
    work.addEventListener('dragover', (e) => {
        if (hasFiles(e)) {
            e.preventDefault();
        }
    });
    work.addEventListener('drop', (e) => {
        dragDepth = 0;
        drop.hidden = true;
        if (e.dataTransfer?.files.length) {
            e.preventDefault();
            api.files([...e.dataTransfer.files]);
        }
    });

    // ---------- keys ----------
    doc.addEventListener('keydown', (e) => {
        if (root.querySelector('dialog[open]') || tourAt >= 0) {
            return;
        }
        const el = e.target as HTMLElement;
        const typing = !!el.closest?.('input, textarea, select, [contenteditable]');
        const mod = e.metaKey || e.ctrlKey;
        if (mod && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            if (picker.hidden) {
                openPicker();
            } else {
                closePicker();
            }
            return;
        }
        if (!picker.hidden) {
            return;
        }
        if (mod && !typing && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            if (e.shiftKey) {
                api.redo();
            } else {
                api.undo();
            }
            return;
        }
        if (mod && !typing && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault();
            api.redo();
            return;
        }
        if (typing || mod || e.altKey || e.repeat) {
            return;
        }
        const k = e.key.toLowerCase();
        const click = (sel: string) => q<HTMLButtonElement>(sel)?.click();
        if (k === 'b') {
            click('[data-mode="blink"]');
        } else if (k === 's') {
            click('[data-mode="stack"]');
        } else if (k === 'd') {
            click('[data-mode="diff"]');
        } else if (k === 'l') {
            click('[data-tool="loupe"]');
        } else if (k === 'r') {
            click('[data-tool="ring"]');
        } else if (k === 'i') {
            click('[data-tool="inspect"]');
        } else if (k === 'f') {
            click('[data-tool="focus"]');
        } else if (k === 't') {
            click('[data-act="theme"]');
        } else if (k === 'g') {
            click('[data-act="help"]');
        } else if (k === '+' || k === '=') {
            click('[data-tool="zoomin"]');
        } else if (k === '-') {
            zoomAt(zoomStep(tool.view.zoom, -1));
        } else if (k === '0') {
            click('[data-tool="fit"]');
        } else if (k === 'h') {
            holdOn();
            const up = (ev: KeyboardEvent) => {
                if (ev.key.toLowerCase() === 'h') {
                    holdOff();
                    doc.removeEventListener('keyup', up);
                }
            };
            doc.addEventListener('keyup', up);
        } else if (k === 'escape') {
            if (!ref<HTMLElement>('about').hidden) {
                ref<HTMLElement>('about').hidden = true;
            } else if (!insp.hidden && !matchMedia('(min-width: 1101px)').matches) {
                openInspector(false);
            }
        }
    });

    function setHistory(canUndo: boolean, canRedo: boolean): void
    {
        q<HTMLButtonElement>('[data-act="undo"]').disabled = !canUndo;
        q<HTMLButtonElement>('[data-act="redo"]').disabled = !canRedo;
    }

    return tool;
}
