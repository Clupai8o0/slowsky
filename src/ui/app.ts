// Slowsky UI shell. Three columns read left to right as three steps:
// 1 pick a target (left), 2 watch it change (the sky, centre), 3 try another colour (right).
// Nothing is drawn over the sky except the data itself and the simulated-sky warning.
// The UI only talks to SkySource.
import './fonts/fonts.css';
import './styles.css';
import targetsJson from '../data/targets.json';
import type { Detector, SkyCoord, Target, TargetId, ViewState } from '../lib/types';
import type { SkyProgress, SkyRequest, SkyResult, SkySource } from '../lib/source';
import { createLiveSource, createSnapshotSource } from '../lib/source';
import { NotImplemented } from '../lib/notimpl';
import { drawFrame, frameDelayMs, renderRgba, sharedStretch, stepIndex } from '../lib/player';
import { decodeView, encodeView } from '../lib/urlstate';
import { positionAt } from '../lib/targets';
import { formatDec, formatRa, parseCoords, resolveName } from '../lib/coords';
import { createDemoSource } from './demo-source';
import { diffScale, renderDiverging, type DiffScale } from './compose';
import { stackVisit, subtract, StackError } from '../lib/stack';
import { initLayout } from './layout';
import { COPY, CUSTOM_COPY, DETECTORS, MODE_HINT, ORDER, STAGE_TEXT } from './copy';

type Mode = 'blink' | 'stack' | 'diff';
type SourceKind = 'live' | 'snapshot' | 'demo';

const TARGETS = targetsJson as unknown as Target[];
const FOVS = [0.1, 0.25, 0.5, 1];
const DEFAULT_FOV = 0.1; // big SPHEREx pixels, and a mover's step is easy to see
const DEFAULT_TARGET: TargetId = 'barnard';
// Middle of SPHEREx's looks so far (1 Jan 2026). Fast movers are centred where they are then, not in 2000:
// Barnard's Star has walked 4′ north since, which is off the edge of a 0.1° field.
const SKY_EPOCH_MJD = 61041;
// Gaia lists hundreds of stars in a 0.1° field, most too faint to see here. Ring only the brightest.
const GAIA_RINGS = 40;
const FPS = 1.5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8l10.2-6.4z" fill="currentColor" stroke="none"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.8" y="5.5" width="3.6" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5.5" width="3.6" height="13" rx="1" fill="currentColor" stroke="none"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/></svg>',
};

interface State {
    target?: TargetId;
    center: SkyCoord;
    label: string; // name shown for a custom spot
    fovDeg: number;
    detector: Detector;
    lambda?: number;
    mode: Mode;
    index: number;
    playing: boolean;
    gaia: boolean;
    live: boolean; // read a target live from the archive instead of the saved copy
    wantFrame?: string; // obsId from a shared link, applied after load
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function mjdToDate(mjd: number): Date
{
    return new Date((mjd - 40587) * 86400000);
}

function niceDate(mjd: number): string
{
    const d = mjdToDate(mjd);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function monthYear(mjd: number): string
{
    const d = mjdToDate(mjd);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function detectorOf(lambda: number): Detector
{
    for (let i = 0; i < DETECTORS.length; i++) {
        if (lambda <= (DETECTORS[i] as [number, number])[1] + 1e-9) {
            return (i + 1) as Detector;
        }
    }
    return 6;
}

function targetById(id: TargetId): Target | undefined
{
    return TARGETS.find((t) => t.id === id);
}

function matchTarget(text: string): TargetId | undefined
{
    const norm = (s: string) => s.toLowerCase().replace(/[’'\s−-]/g, '');
    const q = norm(text);
    if (!q) {
        return undefined;
    }
    for (const id of ORDER) {
        const names = [id, COPY[id].display, targetById(id)?.name ?? ''].map(norm).filter(Boolean);
        if (names.some((n) => n === q || n.startsWith(q) || q.startsWith(n))) {
            return id;
        }
    }
    return undefined;
}

function isNotImplemented(e: unknown): boolean
{
    return e instanceof NotImplemented || (e instanceof Error && e.name === 'NotImplemented');
}

// Full SPHEREx range on the colour slider, and the axis drawn under it (visible light on the left).
const LAM_MIN = (DETECTORS[0] as [number, number])[0];
const LAM_MAX = (DETECTORS[DETECTORS.length - 1] as [number, number])[1];
const AXIS_MIN = 0.4;
const axisPct = (lam: number) => ((lam - AXIS_MIN) / (LAM_MAX - AXIS_MIN)) * 100;

function shell(): string
{
    const targets = ORDER.map((id) => `<button type="button" data-target="${id}" aria-pressed="false"><b>${esc(COPY[id].display)}</b><small>${esc(COPY[id].short)}</small></button>`).join('');
    const fovs = FOVS.map((f) => `<option value="${f}">${f}°</option>`).join('');
    const ticks = [0.4, 1, 2, 3, 4, 5].map((t) => `<span style="left:${axisPct(t).toFixed(2)}%">${t}</span>`).join('');
    return `
<aside class="sk-rail sk-left" id="sk-left">
  <button type="button" class="sk-tab" data-act="fold-left" aria-controls="sk-left" aria-expanded="true"><i aria-hidden="true"></i><span>01 Choose a target</span></button>
  <div class="sk-brand"><span class="sk-word"><i aria-hidden="true"></i>slowsky</span><span class="sk-tag">Watch the sky change.</span><span class="sk-sub2">Infrared frames from NASA’s SPHEREx</span></div>
  <section class="sk-mod sk-m-pick" aria-labelledby="sk-h1">
    <h2 class="sk-mh" id="sk-h1"><i>01</i>Choose a target</h2>
    <nav class="sk-tg" aria-label="Targets">${targets}</nav>
    <form class="sk-search" data-ref="search" role="search"><span class="ic">${ICON.search}</span><input name="q" placeholder="Any star, or RA, Dec" autocomplete="off" aria-label="Search the sky: a star name, or RA and Dec"></form>
  </section>
  <section class="sk-mod sk-m-about" aria-labelledby="sk-h4">
    <h2 class="sk-mh" id="sk-h4">What to look for</h2>
    <p class="sk-h" data-bind="headline"></p>
    <p class="sk-coord"><span data-bind="name"></span><span data-bind="coords"></span></p>
    <p class="sk-body" data-bind="show"></p>
    <p class="sk-body mute"><span class="sk-sub">What this can’t tell you.</span> <span data-bind="not"></span></p>
  </section>
</aside>
<div class="sk-gut sk-gut-l">
  <div class="sk-split" data-side="left" role="separator" aria-orientation="vertical" tabindex="0" aria-controls="sk-left" aria-label="Resize the targets panel. Arrow keys resize, Enter folds" aria-valuemin="0" aria-valuemax="420" aria-valuenow="0"></div>
  <button type="button" class="sk-fold" data-act="fold-left" aria-controls="sk-left" aria-expanded="true" aria-label="Fold the targets panel" title="Fold or open the targets panel"><span class="ic">${ICON.prev}</span></button>
</div>
<main class="sk-mid">
  <section class="sk-mod sk-m-watch" aria-labelledby="sk-h2">
    <div class="sk-mhrow">
      <h2 class="sk-mh" id="sk-h2"><i>02</i>Watch it change</h2>
      <p class="sk-read"><b data-bind="frame"></b><span data-bind="when"></span></p>
      <button type="button" class="sk-focus" data-act="focus" aria-pressed="false" title="Fold both panels (F)"><span class="ic">${ICON.focus}</span><span>Focus</span></button>
    </div>
    <div class="sk-sky" data-ref="sky">
      <canvas class="sk-glow" data-ref="glow" width="24" height="24" aria-hidden="true"></canvas>
      <canvas class="sk-img" data-ref="canvas" role="img" aria-label="Sky image"></canvas>
      <svg class="sk-ov" data-ref="ov" aria-hidden="true" preserveAspectRatio="none"></svg>
      <div class="sk-bar" data-ref="bar" aria-hidden="true"><b data-bind="bar"></b><i></i></div>
      <div class="sk-sim" data-ref="sim" hidden>Simulated sky · not real data</div>
      <div class="sk-load" data-ref="load" hidden><p data-bind="stage"></p><div class="sk-prog"><i data-ref="prog"></i></div></div>
      <div class="sk-err" data-ref="err" hidden><p data-bind="err"></p><button type="button" class="sk-btn2" data-act="retry">Try again</button></div>
    </div>
    <div class="sk-legrow">
      <div class="sk-leg">
        <button type="button" class="sk-key g" data-act="gaia" aria-pressed="true"><i class="box" aria-hidden="true"></i><i class="ring" aria-hidden="true"></i>Brightest Gaia stars</button>
        <span class="sk-key t" data-bind="trackLeg"></span>
        <span class="sk-key d"><i class="b"></i>there then<i class="o"></i>there now</span>
      </div>
      <label class="sk-fov">Field <select data-ref="fov" aria-label="Field of view">${fovs}</select></label>
    </div>
    <div class="sk-player">
      <div class="sk-tr">
        <button type="button" class="sk-btn" data-act="prev" aria-label="Previous frame"><span class="ic">${ICON.prev}</span></button>
        <button type="button" class="sk-btn go" data-act="play" aria-label="Play"></button>
        <button type="button" class="sk-btn" data-act="next" aria-label="Next frame"><span class="ic">${ICON.next}</span></button>
      </div>
      <div class="sk-seg" role="group" aria-label="View"><button type="button" data-mode="blink">Blink</button><button type="button" data-mode="stack">Stack</button><button type="button" data-mode="diff">Subtract</button></div>
    </div>
    <p class="sk-hint" data-bind="hint"></p>
    <div class="sk-strip" data-ref="strip" role="group" aria-label="Frames in date order"></div>
  </section>
</main>
<div class="sk-gut sk-gut-r">
  <div class="sk-split" data-side="right" role="separator" aria-orientation="vertical" tabindex="0" aria-controls="sk-right" aria-label="Resize the colour panel. Arrow keys resize, Enter folds" aria-valuemin="0" aria-valuemax="420" aria-valuenow="0"></div>
  <button type="button" class="sk-fold" data-act="fold-right" aria-controls="sk-right" aria-expanded="true" aria-label="Fold the colour panel" title="Fold or open the colour panel"><span class="ic">${ICON.next}</span></button>
</div>
<aside class="sk-rail sk-right" id="sk-right">
  <button type="button" class="sk-tab" data-act="fold-right" aria-controls="sk-right" aria-expanded="true"><span>03 Colour and frame</span></button>
  <div class="sk-status"><p><span class="dot" aria-hidden="true"></span><span data-bind="statusShort">Connecting to the archive</span></p><div class="sk-acts"><button type="button" class="sk-btn2 sk-golive" data-act="live" data-ref="golive" hidden><i aria-hidden="true"></i>Go live</button><button type="button" class="sk-btn2" data-act="copy"><span class="ic">${ICON.link}</span>Copy link</button></div></div>
  <section class="sk-mod sk-m-colour" aria-labelledby="sk-h3">
    <h2 class="sk-mh" id="sk-h3"><i>03</i>Change the colour</h2>
    <div class="sk-readout"><p><b data-bind="lam"></b><small>µm</small></p><span data-bind="det"></span></div>
    <div class="sk-spec">
      <div class="sk-axis"><i class="vis" style="width:${axisPct(0.7).toFixed(2)}%" title="Visible light"></i>
        <input class="sk-rng" type="range" data-ref="lam" min="${LAM_MIN}" max="${LAM_MAX}" step="0.01" style="left:${axisPct(LAM_MIN).toFixed(2)}%;width:${(100 - axisPct(LAM_MIN)).toFixed(2)}%" aria-label="Wavelength in micrometres"></div>
      <div class="sk-ticks" aria-hidden="true">${ticks}</div>
      <div class="sk-axl" aria-hidden="true"><span>your eyes</span><span>SPHEREx · µm</span></div>
    </div>
    <p class="sk-body mute">All of this is infrared: your eyes stop at 0.70 µm. Drag, then let go to load that colour.</p>
  </section>
  <section class="sk-mod sk-m-details" aria-labelledby="sk-h5">
    <h2 class="sk-mh" id="sk-h5">This frame</h2>
    <dl data-ref="dl"></dl>
    <ul class="sk-notes" data-ref="notes"></ul>
  </section>
  <footer class="sk-credit"><p data-bind="status"></p><p data-bind="credits"></p></footer>
</aside>
<p class="sk-sr" aria-live="polite" data-ref="live"></p>
<div class="sk-toast" data-ref="toast" role="status"></div>`;
}

export function mount(root: HTMLElement): void
{
    root.classList.add('sk');
    root.innerHTML = shell();
    const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    const qa = <T extends Element>(sel: string) => [...root.querySelectorAll(sel)] as T[];
    const ref = <T extends Element>(name: string) => q<T>(`[data-ref="${name}"]`);
    const canvas = ref<HTMLCanvasElement>('canvas');
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const glow = ref<HTMLCanvasElement>('glow');
    const glowCtx = glow.getContext('2d') as CanvasRenderingContext2D;
    const ov = ref<SVGSVGElement>('ov');
    const strip = ref<HTMLElement>('strip');
    const lamInput = ref<HTMLInputElement>('lam');
    const fovSelect = ref<HTMLSelectElement>('fov');
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const params = new URLSearchParams(location.search);
    const demoOnly = params.get('demo') === '1';

    const st: State = {
        center: { ra: 0, dec: 0 },
        label: '',
        fovDeg: DEFAULT_FOV,
        detector: 1,
        mode: 'blink',
        index: 0,
        playing: false,
        gaia: true,
        live: false,
    };
    let result: SkyResult | null = null;
    let sourceKind: SourceKind = 'live';
    let liveFailed = false; // the saved copy is showing because the live archive did not answer
    let stretch: ReturnType<typeof sharedStretch> | null = null;
    let composed: { stack?: Float32Array; diff?: Float32Array; scale?: DiffScale } = {};
    let timer = 0;
    let ctrl: AbortController | null = null;
    let lamDraft: number | null = null;
    let lookup: AbortController | null = null; // pending name lookup; any newer navigation cancels it

    function bind(key: string, text: string): void
    {
        for (const el of qa<HTMLElement>(`[data-bind="${key}"]`)) {
            el.textContent = text;
        }
    }

    function toast(msg: string): void
    {
        const el = ref<HTMLElement>('toast');
        el.textContent = msg;
        el.setAttribute('data-show', '');
        window.clearTimeout(Number(el.dataset.t));
        el.dataset.t = String(window.setTimeout(() => el.removeAttribute('data-show'), 2200));
    }

    // ---------- loading ----------

    function setTarget(id: TargetId): void
    {
        const t = targetById(id);
        if (!t) {
            return;
        }
        st.target = id;
        st.center = positionAt(t.astrometry, SKY_EPOCH_MJD);
        st.detector = t.detector;
        st.lambda = undefined;
        st.live = false;
        st.label = COPY[id].display;
        void load();
    }

    function setSpot(center: SkyCoord, label: string): void
    {
        st.target = undefined;
        st.center = center;
        st.label = label;
        st.lambda = undefined;
        void load();
    }

    async function loadFrom(kind: SourceKind, req: SkyRequest): Promise<SkyResult>
    {
        const src: SkySource = kind === 'demo' ? createDemoSource() : kind === 'live' ? createLiveSource() : createSnapshotSource();
        return src.load(req);
    }

    async function load(): Promise<void>
    {
        lookup?.abort();
        lookup = null;
        ctrl?.abort();
        ctrl = new AbortController();
        const signal = ctrl.signal;
        play(false);
        // Drop the previous view so nothing (play, strip, details) acts on frames of another spot.
        result = null;
        stretch = null;
        composed = {};
        strip.innerHTML = '';
        ov.innerHTML = '';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        paintGlow();
        ref<HTMLElement>('dl').innerHTML = '';
        ref<HTMLElement>('notes').innerHTML = '';
        lamInput.disabled = true;
        ref<HTMLElement>('err').hidden = true;
        ref<HTMLElement>('load').hidden = false;
        root.dataset.loading = 'true';
        progress({ stage: 'search', done: 0, total: 1 });
        renderText();
        const req: SkyRequest = {
            center: st.center,
            fovDeg: st.fovDeg,
            detector: st.detector,
            lambda: st.lambda,
            target: st.target,
            signal,
            onProgress: progress,
        };
        // The five targets open from the saved copy at once (a live read takes 20-45 s);
        // "Read live" or another colour on another detector goes to the archive.
        const saved = st.target ? targetById(st.target) : undefined;
        const savedFirst = !st.live && saved !== undefined && st.detector === saved.detector;
        const order: SourceKind[] = demoOnly ? ['demo'] : savedFirst ? ['snapshot', 'live'] : ['live', 'snapshot'];
        let res: SkyResult | null = null;
        let got: SourceKind = 'live';
        let lastErr: unknown = null;
        let allMissing = true;
        let failedLive = false;
        let spare: SkyResult | null = null; // a saved copy without the linked frame, used if live fails
        for (const kind of order) {
            try {
                res = await loadFrom(kind, req);
                got = kind;
                if (kind === 'snapshot' && savedFirst) {
                    const wanted = st.wantFrame;
                    if (res.frames.length === 0 || (wanted !== undefined && !res.frames.some((f) => f.frame.frame.obsId === wanted))) {
                        spare = res.frames.length > 0 ? res : null;
                        res = null;
                        continue;
                    }
                }
                break;
            } catch (e) {
                if (signal.aborted) {
                    return;
                }
                lastErr = e;
                allMissing = allMissing && isNotImplemented(e);
                failedLive ||= kind === 'live';
                // A spot that is not one of the five targets has no saved copy.
                if (kind === 'live' && !st.target && !isNotImplemented(e)) {
                    break;
                }
            }
        }
        if (!res && spare) {
            res = spare;
            got = 'snapshot';
        }
        if (!res && allMissing && !demoOnly) {
            // The live and saved sources are not built yet: show the simulated sky, clearly labelled.
            try {
                res = await loadFrom('demo', req);
                got = 'demo';
            } catch (e) {
                if (signal.aborted) {
                    return;
                }
                lastErr = e;
            }
        }
        if (signal.aborted) {
            return;
        }
        ref<HTMLElement>('load').hidden = true;
        delete root.dataset.loading;
        lamInput.disabled = false;
        if (!res || res.frames.length === 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            paintGlow();
            renderText();
            const why = res ? 'SPHEREx has no frames of this spot at this colour yet.' : `Couldn’t load the frames. ${lastErr instanceof Error ? lastErr.message : ''}`;
            bind('err', why);
            ref<HTMLElement>('err').hidden = false;
            return;
        }
        result = res;
        sourceKind = got;
        liveFailed = failedLive;
        st.lambda = res.lambda;
        st.detector = detectorOf(res.lambda);
        stretch = sharedStretch(res.frames);
        composed = {};
        st.index = 0;
        if (st.wantFrame) {
            const k = res.frames.findIndex((f) => f.frame.frame.obsId === st.wantFrame);
            st.index = Math.max(0, k);
            st.wantFrame = undefined;
        }
        if (st.mode !== 'blink') {
            compose();
        }
        canvas.width = res.grid.width;
        canvas.height = res.grid.height;
        ov.setAttribute('viewBox', `0 0 ${res.grid.width} ${res.grid.height}`);
        buildStrip();
        draw();
        writeUrl();
        if (!reduceMotion && st.mode === 'blink' && res.frames.length > 1) {
            play(true);
        }
    }

    function progress(p: SkyProgress): void
    {
        const n = Math.max(p.total, 1);
        bind('stage', `${STAGE_TEXT[p.stage]}${p.total > 1 ? ` · ${Math.min(p.done + 1, n)} of ${n}` : ''}`);
        const stages = ['search', 'headers', 'pixels', 'regrid'];
        const frac = (stages.indexOf(p.stage) + Math.min(p.done / n, 1)) / stages.length;
        ref<HTMLElement>('prog').style.width = `${Math.round(frac * 100)}%`;
    }

    // ---------- drawing ----------

    function compose(): void
    {
        if (!result) {
            return;
        }
        const regs = result.frames.map((f) => f.frame);
        try {
            // Stack here spans every look, so no clipping: a moving star should smear, not vanish.
            if (st.mode === 'stack' && !composed.stack) {
                composed.stack = stackVisit(regs, { clipSigma: Infinity, background: 'none' }).data;
            }
            if (st.mode === 'diff' && !composed.diff) {
                const first = regs[0];
                const last = regs[regs.length - 1];
                if (first && last) {
                    composed.diff = subtract(last.data, first.data).data;
                    composed.scale = diffScale(composed.diff);
                }
            }
        } catch (e) {
            if (!(e instanceof StackError)) {
                throw e;
            }
            // Fall back to Blink for real, so the readout, legend and URL match what is drawn.
            toast(`These frames can’t be combined, so this shows them one by one. ${e.message}`);
            st.mode = 'blink';
            writeUrl();
        }
    }

    function draw(): void
    {
        if (!result || !stretch) {
            return;
        }
        const f = result.frames[st.index];
        if (!f) {
            return;
        }
        if (st.mode !== 'blink') {
            compose();
        }
        const data = st.mode === 'stack' ? composed.stack : st.mode === 'diff' ? composed.diff : undefined;
        if (!data) {
            drawFrame(ctx, f, stretch);
        } else {
            const img = ctx.createImageData(result.grid.width, result.grid.height);
            if (st.mode === 'stack') {
                renderRgba(data, stretch, img.data);
            } else {
                renderDiverging(data, composed.scale ?? { floor: 0, limit: 1 }, img.data);
            }
            ctx.putImageData(img, 0, 0);
        }
        paintGlow();
        overlay();
        renderText();
        renderFrameState();
    }

    // A tiny copy of the sky, blurred by CSS behind the image: the glow follows what is on screen.
    function paintGlow(): void
    {
        glowCtx.clearRect(0, 0, glow.width, glow.height);
        if (canvas.width > 0 && canvas.height > 0) {
            glowCtx.drawImage(canvas, 0, 0, glow.width, glow.height);
        }
    }

    function overlay(): void
    {
        if (!result) {
            return;
        }
        const parts: string[] = [];
        const kind = st.target ? COPY[st.target].kind : 'field';
        const ring = (x: number, y: number, r: number, cls: string) =>
            `<circle cx="${(x + 0.5).toFixed(2)}" cy="${(y + 0.5).toFixed(2)}" r="${r}" class="${cls}" fill="none" vector-effect="non-scaling-stroke"/>`;
        const scale = result.grid.width / 60;
        if (st.gaia && st.mode !== 'diff') {
            const bright = [...result.stars].sort((p, q) => p.g - q.g).slice(0, GAIA_RINGS);
            for (const s of bright) {
                parts.push(ring(s.pix.x, s.pix.y, Math.max(2.4, scale * 0.9), 'gaia'));
            }
        }
        const track = result.track;
        const frames = result.frames;
        // The track point for a frame is the one nearest its date (the track need not have one point per frame).
        const at = (k: number) => {
            const t = frames[k]?.frame.frame.tMin;
            if (!track || !track.length || t === undefined) {
                return undefined;
            }
            return track.reduce((best, p) => (Math.abs(p.mjd - t) < Math.abs(best.mjd - t) ? p : best));
        };
        if (track && track.length && frames.length) {
            const ks = st.mode === 'blink' ? [st.index] : st.mode === 'stack' ? frames.map((_, i) => i) : [0, frames.length - 1];
            if (kind === 'mover' || kind === 'spectrum') {
                for (const p of new Set(ks.map(at))) {
                    if (p) {
                        parts.push(ring(p.pix.x, p.pix.y, Math.max(2.8, scale), 'track'));
                    }
                }
            } else {
                const p = at(st.mode === 'blink' ? st.index : 0);
                if (p) {
                    const a = Math.max(5, scale * 1.8);
                    const b = a * 0.4;
                    const x = p.pix.x + 0.5;
                    const y = p.pix.y + 0.5;
                    const corner = (sx: number, sy: number) =>
                        `<path d="M${x + sx * a} ${y + sy * (a - b)}V${y + sy * a}H${x + sx * (a - b)}" class="mark" fill="none" vector-effect="non-scaling-stroke"/>`;
                    parts.push(corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, 1));
                }
            }
        }
        ov.innerHTML = parts.join('');
    }

    function buildStrip(): void
    {
        if (!result || !stretch) {
            strip.innerHTML = '';
            return;
        }
        const { width, height } = result.grid;
        const firstVisit = result.frames[0]?.frame.frame.tMin ?? 0;
        strip.innerHTML = result.frames.map((f, i) => {
            const t = f.frame.frame.tMin;
            const months = Math.round((t - firstVisit) / 30.44);
            return `<button type="button" data-k="${i}" aria-label="Frame ${i + 1}: ${niceDate(t)}"><canvas width="${width}" height="${height}"></canvas>
                <small><b>${monthYear(t)}</b>${i === 0 ? 'first look' : `+${months} mo`}</small></button>`;
        }).join('');
        const s = stretch;
        qa<HTMLButtonElement>('.sk-strip button').forEach((b, i) => {
            const c = b.querySelector('canvas');
            const f = result?.frames[i];
            if (c && f) {
                drawFrame(c.getContext('2d') as CanvasRenderingContext2D, f, s);
            }
        });
    }

    function renderFrameState(): void
    {
        qa<HTMLButtonElement>('.sk-strip button').forEach((b, i) => {
            if (st.mode === 'blink' && i === st.index) {
                b.setAttribute('aria-current', 'true');
            } else {
                b.removeAttribute('aria-current');
            }
        });
    }

    // The slider track shows the six detectors; the one in use is lit.
    function paintTrack(active: Detector): void
    {
        const span = LAM_MAX - LAM_MIN;
        const stops: string[] = [];
        DETECTORS.forEach(([lo, hi], i) => {
            const a = (((lo - LAM_MIN) / span) * 100).toFixed(2);
            const b = (((hi - LAM_MIN) / span) * 100).toFixed(2);
            const c = i + 1 === active ? 'var(--trk-on)' : 'var(--trk)';
            stops.push(`transparent ${a}%`, `${c} ${a}%`, `${c} ${b}%`, `transparent ${b}%`);
        });
        lamInput.style.setProperty('--track', `linear-gradient(90deg, ${stops.join(', ')})`);
    }

    // Scale bar sized in pixels from the sky's on-screen width.
    function sizeBar(): void
    {
        if (!result) {
            return;
        }
        const skyPx = ref<HTMLElement>('sky').clientWidth;
        const fovArcsec = result.grid.pixelArcsec * result.grid.width;
        // The source may show less than was asked for (the saved copy caps at 0.1°), so size from the grid.
        const bar = result.grid.fovDeg >= 0.5 ? 600 : 60;
        ref<HTMLElement>('bar').style.width = `${Math.max(12, (bar / fovArcsec) * skyPx).toFixed(1)}px`;
        bind('bar', `${bar / 60}′`);
    }

    function renderText(): void
    {
        root.dataset.mode = st.mode;
        root.dataset.gaia = String(st.gaia);
        root.dataset.source = sourceKind;
        ref<HTMLElement>('sim').hidden = !(result && sourceKind === 'demo');
        ref<HTMLElement>('golive').hidden = !(result && sourceKind === 'snapshot' && st.target);
        const copy = st.target ? COPY[st.target] : null;
        bind('name', copy ? copy.display : st.label);
        bind('coords', `${formatRa(st.center.ra)}  ${formatDec(st.center.dec)}`);
        bind('headline', copy ? copy.headline : CUSTOM_COPY.headline);
        bind('show', copy ? copy.show : CUSTOM_COPY.show);
        bind('not', copy ? copy.not : CUSTOM_COPY.not);
        bind('hint', MODE_HINT[st.mode]);
        bind('trackLeg', copy && (copy.kind === 'mover' || copy.kind === 'spectrum') ? `Where ${copy.display} should be on this date` : '');
        root.dataset.trackleg = copy && (copy.kind === 'mover' || copy.kind === 'spectrum') ? 'true' : 'false';
        for (const b of qa<HTMLButtonElement>('[data-target]')) {
            b.setAttribute('aria-pressed', String(b.dataset.target === st.target));
        }
        for (const b of qa<HTMLButtonElement>('[data-mode]')) {
            b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode));
        }
        const play = q<HTMLButtonElement>('[data-act="play"]');
        play.innerHTML = `<span class="ic">${st.playing ? ICON.pause : ICON.play}</span>`;
        play.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
        const gaiaBtn = q<HTMLButtonElement>('[data-act="gaia"]');
        gaiaBtn.setAttribute('aria-pressed', String(st.gaia));
        // No catalogue stars came back: hide the toggle rather than offer an empty one.
        gaiaBtn.hidden = !result || result.stars.length === 0;
        fovSelect.value = String(st.fovDeg);
        bind('det', `Detector ${lamDraft === null ? st.detector : detectorOf(lamDraft)} of 6`);

        const band = DETECTORS[st.detector - 1] as [number, number];
        const lam = lamDraft ?? st.lambda ?? (band[0] + band[1]) / 2;
        if (lamDraft === null) {
            lamInput.value = lam.toFixed(2);
        }
        bind('lam', lam.toFixed(2));
        paintTrack(lamDraft === null ? st.detector : detectorOf(lam));

        if (!result) {
            bind('frame', '');
            bind('when', '');
            return;
        }
        const n = result.frames.length;
        const f = result.frames[st.index];
        const lf = result.locked[st.index];
        const first = result.frames[0]?.frame.frame;
        const last = result.frames[n - 1]?.frame.frame;
        if (st.mode === 'blink' && f) {
            bind('frame', `Frame ${st.index + 1} of ${n}`);
            bind('when', niceDate(f.frame.frame.tMin));
        } else if (st.mode === 'stack' && first && last) {
            bind('frame', `All ${n} frames, averaged`);
            bind('when', `${monthYear(first.tMin)} to ${monthYear(last.tMin)}`);
        } else if (first && last) {
            bind('frame', 'Last look minus first');
            bind('when', `${monthYear(last.tMin)} minus ${monthYear(first.tMin)}`);
        }
        sizeBar();

        if (f && lf) {
            const rec = f.frame.frame;
            const rows: [string, string][] = [
                ['Taken', `${mjdToDate(rec.tMin).toISOString().slice(0, 16).replace('T', ' ')} UTC`],
                ['Frame', `${st.index + 1} of ${n}`],
                ['Colour here', `${lf.lambda.toFixed(3)} µm (${lf.dLambda >= 0 ? '+' : '−'}${Math.abs(lf.dLambda).toFixed(3)})`],
                ['Detector', `D${rec.detector}`],
                ['Release', rec.collection],
                ['Field', `${Number(result.grid.fovDeg.toFixed(3))}° · ${result.grid.width} × ${result.grid.height} px`],
                ['Scale', `${result.grid.pixelArcsec.toFixed(2)}″ per pixel`],
                ['File', rec.obsId],
            ];
            if (rec.pipelineVersion) {
                rows.push(['Pipeline', rec.pipelineVersion]);
            }
            let html = rows.map(([k, v]) => `<dt>${k}</dt><dd title="${esc(v)}">${esc(v)}</dd>`).join('');
            const links: string[] = [];
            if (rec.url) {
                links.push(`<a href="${esc(rec.url)}" rel="noopener" target="_blank">FITS file</a>`);
            }
            if (rec.irsaUrl) {
                links.push(`<a href="${esc(rec.irsaUrl)}" rel="noopener" target="_blank">IRSA</a>`);
            }
            if (links.length) {
                html += `<dt>Open</dt><dd>${links.join(' · ')}</dd>`;
            }
            ref<HTMLElement>('dl').innerHTML = html;
        }
        bind('statusShort', sourceKind === 'live' ? 'Live from NASA’s SPHEREx archive'
            : sourceKind === 'snapshot' ? 'Saved copy' : 'Simulated sky · not real data');
        const status = sourceKind === 'live' ? 'Live: read straight from NASA’s SPHEREx archive on Amazon S3.'
            : sourceKind === 'snapshot' ? (liveFailed ? 'Saved copy of NASA SPHEREx frames (the live archive did not answer).'
                : 'Saved copy of real NASA SPHEREx frames, so it opens at once. Go live reads them from the archive (about 30 s).')
                : 'Simulated sky for building the page. Not real data.';
        bind('status', status);
        const credits = ['NASA SPHEREx via IRSA (NASA/IPAC).', ...(sourceKind === 'demo' ? [] : result.credits)];
        bind('credits', [...new Set(credits)].join(' '));
        ref<HTMLElement>('notes').innerHTML = result.notes.map((t) => `<li>${esc(t)}</li>`).join('');
        ref<HTMLElement>('live').textContent = `${q<HTMLElement>('[data-bind="frame"]').textContent}, ${q<HTMLElement>('[data-bind="when"]').textContent}`;
        canvas.setAttribute('aria-label', `Sky image. ${ref<HTMLElement>('live').textContent}, ${lam.toFixed(2)} µm`);
    }

    // ---------- playback ----------

    function tick(): void
    {
        if (!result) {
            return;
        }
        st.index = stepIndex(st.index, result.frames.length, 1);
        draw();
        timer = window.setTimeout(tick, frameDelayMs(FPS));
    }

    function play(on: boolean): void
    {
        window.clearTimeout(timer);
        st.playing = on && !!result && result.frames.length > 1;
        if (st.playing) {
            if (st.mode !== 'blink') {
                st.mode = 'blink';
                draw();
            }
            timer = window.setTimeout(tick, frameDelayMs(FPS));
        }
        renderText();
        if (!on) {
            writeUrl();
        }
    }

    function step(dir: number): void
    {
        if (!result) {
            return;
        }
        st.mode = 'blink';
        play(false);
        st.index = stepIndex(st.index, result.frames.length, dir);
        draw();
        writeUrl();
    }

    // ---------- URL ----------

    function view(withFrame: boolean): ViewState
    {
        const v: ViewState = { center: st.center, fovDeg: st.fovDeg, detector: st.detector };
        if (st.lambda !== undefined) {
            v.lambda = st.lambda;
        }
        if (st.target) {
            v.target = st.target;
        }
        const f = result?.frames[st.index];
        if (withFrame && f && st.mode === 'blink') {
            v.frame = f.frame.frame.obsId;
        }
        return v;
    }

    function linkFor(withFrame: boolean): string
    {
        const extra = `${st.mode !== 'blink' ? `&m=${st.mode}` : ''}${st.gaia ? '' : '&g=0'}${demoOnly ? '&demo=1' : ''}`;
        return `${location.origin}${location.pathname}?${encodeView(view(withFrame))}${extra}`;
    }

    function writeUrl(): void
    {
        history.replaceState(null, '', linkFor(!st.playing));
    }

    // ---------- events ----------

    root.addEventListener('click', (e) => {
        const b = (e.target as Element).closest('button');
        if (!b || !root.contains(b)) {
            return;
        }
        if (b.dataset.target) {
            setTarget(b.dataset.target as TargetId);
        } else if (b.dataset.mode) {
            st.mode = b.dataset.mode as Mode;
            if (st.mode !== 'blink') {
                play(false);
            }
            draw();
            writeUrl();
        } else if (b.dataset.k !== undefined) {
            st.mode = 'blink';
            play(false);
            st.index = Number(b.dataset.k);
            draw();
            writeUrl();
        } else if (b.dataset.act === 'play') {
            play(!st.playing);
        } else if (b.dataset.act === 'prev' || b.dataset.act === 'next') {
            step(b.dataset.act === 'next' ? 1 : -1);
        } else if (b.dataset.act === 'gaia') {
            st.gaia = !st.gaia;
            overlay();
            renderText();
            writeUrl();
        } else if (b.dataset.act === 'copy') {
            const url = linkFor(true);
            navigator.clipboard?.writeText(url).then(() => toast('Link copied. It opens this exact view.'), () => toast(url));
        } else if (b.dataset.act === 'retry') {
            void load();
        } else if (b.dataset.act === 'live') {
            st.live = true;
            void load();
        }
    });

    lamInput.addEventListener('input', () => {
        lamDraft = Number(lamInput.value);
        bind('lam', lamDraft.toFixed(2));
        bind('det', `Detector ${detectorOf(lamDraft)} of 6`);
        paintTrack(detectorOf(lamDraft));
    });
    lamInput.addEventListener('change', () => {
        st.lambda = Number(lamInput.value);
        st.detector = detectorOf(st.lambda);
        lamDraft = null;
        void load();
    });
    new ResizeObserver(() => sizeBar()).observe(ref<HTMLElement>('sky'));
    fovSelect.addEventListener('change', () => {
        st.fovDeg = Number(fovSelect.value);
        void load();
    });

    ref<HTMLFormElement>('search').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const input = form.querySelector('input') as HTMLInputElement;
        const text = input.value.trim();
        if (!text) {
            return;
        }
        const id = matchTarget(text);
        if (id) {
            input.value = '';
            input.blur();
            setTarget(id);
            return;
        }
        const c = parseCoords(text);
        if (c) {
            input.value = '';
            input.blur();
            setSpot(c, `${formatRa(c.ra)} ${formatDec(c.dec)}`);
            return;
        }
        toast(`Looking up “${text}”…`);
        lookup?.abort();
        const mine = new AbortController();
        lookup = mine;
        try {
            const a = await resolveName(text, mine.signal);
            if (mine.signal.aborted) {
                return;
            }
            input.value = '';
            input.blur();
            // Same as the listed targets: centre where the star is in SPHEREx's time, not in the catalogue's epoch.
            setSpot(positionAt(a, SKY_EPOCH_MJD), text);
        } catch {
            if (mine.signal.aborted) {
                return;
            }
            toast('Couldn’t find that. Try a star name, or RA and Dec like 269.45, 4.69.');
        }
    });

    const layout = initLayout(root);

    document.addEventListener('keydown', (e) => {
        const el = e.target as HTMLElement;
        if (el.closest?.('input, textarea, select, [contenteditable], [role=separator]') || e.metaKey || e.ctrlKey || e.altKey) {
            return;
        }
        if ((e.key === 'f' || e.key === 'F') && matchMedia('(min-width: 1081px)').matches) {
            layout.toggleFocus();
            return;
        }
        if (e.key === ' ' && !el.closest?.('button, summary, a, label')) {
            e.preventDefault();
            play(!st.playing);
        } else if (e.key === 'ArrowRight' || e.key === ']') {
            step(1);
        } else if (e.key === 'ArrowLeft' || e.key === '[') {
            step(-1);
        }
    });

    // ---------- start ----------

    const shared = decodeView(location.search);
    if (shared) {
        st.center = shared.center;
        st.fovDeg = FOVS.includes(shared.fovDeg) ? shared.fovDeg : DEFAULT_FOV;
        st.detector = shared.detector;
        st.lambda = shared.lambda;
        st.target = shared.target;
        st.wantFrame = shared.frame;
        const m = params.get('m');
        st.mode = m === 'stack' || m === 'diff' ? m : 'blink';
        st.gaia = params.get('g') !== '0';
        st.label = shared.target ? COPY[shared.target].display : `${formatRa(shared.center.ra)} ${formatDec(shared.center.dec)}`;
        void load();
    } else {
        setTarget(DEFAULT_TARGET);
    }
}
