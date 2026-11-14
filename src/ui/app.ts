// Slowsky UI shell. Three columns read left to right as three steps:
// 1 pick a target (left), 2 watch it change (the sky, centre), 3 try another colour (right).
// Nothing is drawn over the sky except the data itself and the simulated-sky warning.
// The UI only talks to SkySource.
import './fonts/fonts.css';
import './styles.css';
import targetsJson from '../data/targets.json';
import type { Detector, PlayerFrame, SkyCoord, Stretch, Target, TargetId, ViewState } from '../lib/types';
import type { SkyProgress, SkyRequest, SkyResult, SkySource } from '../lib/source';
import { createLiveSource, createSnapshotSource } from '../lib/source';
import { NotImplemented } from '../lib/notimpl';
import { drawFrame, frameDelayMs, renderRgba, sharedStretch, stepIndex } from '../lib/player';
import { decodeView, encodeView } from '../lib/urlstate';
import { positionAt } from '../lib/targets';
import { formatDec, formatRa, parseCoords, resolveName } from '../lib/coords';
import { createDemoSource } from './demo-source';
import { diffScale, fillCores, renderDiverging, type DiffScale } from './compose';
import { stackVisit, subtract, StackError } from '../lib/stack';
import { initLayout } from './layout';
import { coreBlank, curveFor, dotBar, frameMjd, ringsOn, shiftFor, visitsOf, type Curve } from './measure';
import { mountAiNote } from './ai-note';
import { FEATURES, mountChanges, mountFalseColour, mountFlags, renderHalo, renderSpectrum, type LayerState } from './slots';
import { mountEpoch } from './epoch-view';
import { COPY, CUSTOM_COPY, DETECTORS, MODE_HINT, ORDER, STAGE_TEXT } from './copy';
import { combineVisits, defaultPicks, subtractText, headerDates, visitGroups, visitImage, visitLabel, type SubOp, type Visit } from './subtract';

type Mode = 'blink' | 'stack' | 'diff';
type SourceKind = 'live' | 'snapshot' | 'demo';

const TARGETS = targetsJson as unknown as Target[];
const FOVS = [0.1, 0.25, 0.5, 1];
const DEFAULT_FOV = 0.1; // big SPHEREx pixels, and a mover's step is easy to see
const SAVED_FOV = 0.1; // the saved copy holds this field only; a bigger one reads live
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
    // One mark per kind of target, so the list reads at a glance and still works when the panel is folded.
    mover: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l8.5-8.5" stroke-dasharray="1.6 3"/><circle cx="16.5" cy="7.5" r="3"/></svg>',
    variable: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" stroke="none"/></svg>',
    spectrum: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4.5l6.5 13h-13z"/><path d="M14.2 10.5l6.3-2.5M15.4 12.8l5.1-.3M16.5 15.2l4 2"/></svg>',
    cold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v17M4.6 7.75l14.8 8.5M4.6 16.25l14.8-8.5"/><path d="M9.5 5l2.5 2 2.5-2M9.5 19l2.5-2 2.5 2"/></svg>',
    saturated: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/></svg>',
    blink: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z"/><circle cx="12" cy="12" r="2.6"/></svg>',
    stack: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5l8 4-8 4-8-4z"/><path d="M4 12.5l8 4 8-4M4 16.5l8 4 8-4"/></svg>',
    diff: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="12" r="5.6"/><circle cx="15" cy="12" r="5.6"/></svg>',
    look: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r=".6" fill="currentColor"/></svg>',
    curve: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 17.5l5-6 4 3.5 7.5-9"/><path d="M3.5 20.5h17"/></svg>',
    field: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5L18.5 6M4 19.5h16"/><path d="M12.5 19.5a8.5 8.5 0 0 0-2.6-6.1"/></svg>',
    retry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 4.5v4h-4"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/></svg>',
    out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4.5h5.5V10M19.5 4.5L11 13"/><path d="M17.5 14v5.5h-13v-13H10"/></svg>',
    panelL: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/></svg>',
    panelR: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/></svg>',
    focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 4.5h13v15h-13z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/></svg>',
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
    subA: number;
    subB: number;
    subOp: SubOp;
    index: number;
    playing: boolean;
    gaia: boolean;
    live: boolean; // read a target live from the archive instead of the saved copy
    wantFrame?: string; // obsId from a shared link, applied after load
    wantSub?: { a: number | null; b: number | null; op: SubOp | null }; // subtract picks from a shared link, validated after load
}

function parseVisitPick(raw: string | null): number | null
{
    if (raw === null || !/^\d+$/.test(raw)) {
        return null;
    }
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
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

// Each SPHEREx release links to its archive DOI from the Release row (the citation sits in the link's title).
const RELEASE_DOI: Partial<Record<string, { id: string; label: string; cite: string }>> = {
    dr1: { id: '10.26131/IRSA678', label: 'SPHEREx DR1', cite: 'SPHEREx DR1, NASA/IPAC Infrared Science Archive, doi:10.26131/IRSA678' },
    qr3: { id: '10.26131/IRSA662', label: 'SPHEREx QR3', cite: 'SPHEREx QR3, NASA/IPAC Infrared Science Archive, doi:10.26131/IRSA662' },
};

// ---------- small figures ----------
const MAP_W = 132;
const MAP_H = 66;

// RA runs right to left, as on a sky chart; 0h at the right edge.
function mapXY(ra: number, dec: number): [number, number]
{
    return [MAP_W * (1 - (((ra % 360) + 360) % 360) / 360), MAP_H * (0.5 - dec / 180)];
}

// The Milky Way's mid-line (galactic latitude 0) in RA and Dec, as path segments that break where RA wraps.
const PLANE = ((): string => {
    const d2r = Math.PI / 180;
    const raG = 192.85948 * d2r;
    const decG = 27.12825 * d2r;
    const lNcp = 122.93192 * d2r;
    let path = '';
    let last = NaN;
    for (let l = 0; l <= 360; l += 4) {
        const dl = lNcp - l * d2r;
        const dec = Math.asin(Math.cos(decG) * Math.cos(dl)) / d2r;
        const ra = (raG + Math.atan2(Math.sin(dl), -Math.sin(decG) * Math.cos(dl))) / d2r;
        const [x, y] = mapXY(ra, dec);
        path += `${Number.isFinite(last) && Math.abs(x - last) < MAP_W / 2 ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        last = x;
    }
    return path;
})();

function skyMapSvg(ra: number, dec: number): string
{
    const [x, y] = mapXY(ra, dec);
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" width="${MAP_W}" height="${MAP_H}" role="img" aria-label="Position on the whole sky: the gold square, with the Milky Way as a faint band">
<rect x=".5" y=".5" width="${MAP_W - 1}" height="${MAP_H - 1}" rx="2" class="fr"/>
<path d="${PLANE}" class="mw"/>
<path d="M0 ${MAP_H / 2}H${MAP_W}" class="eq"/>
<rect x="${(x - 3).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="6" height="6" rx="1" class="me"/>
</svg>`;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

// Yearly motion as an arrow on a small compass, north up and east left (as the sky image shows it).
function motionSvg(pmRa: number, pmDec: number): { svg: string; text: string }
{
    const pm = Math.hypot(pmRa, pmDec) / 1000; // arcsec a year
    const pa = (Math.atan2(pmRa, pmDec) * 180) / Math.PI;
    const way = COMPASS[Math.round((((pa % 360) + 360) % 360) / 45) % 8]!;
    const S = 66;
    const c = S / 2;
    const len = 17; // the tip stays 3 px clear of the N and E labels inside the frame
    const ux = -pmRa / 1000 / pm;
    const uy = -pmDec / 1000 / pm;
    const tx = c + ux * len;
    const ty = c + uy * len;
    const head = (k: number) => `${(tx - ux * 6 + k * uy * 4).toFixed(1)} ${(ty - uy * 6 - k * ux * 4).toFixed(1)}`;
    // Same outer box as the sky map beside it (66 px tall). N and E sit inside the frame at the ends of the axes,
    // which start past them, and the arrow is short enough never to reach them.
    const svg = `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Moves ${pm.toFixed(1)} arcseconds a year toward the ${way}">
<rect x=".5" y=".5" width="${S - 1}" height="${S - 1}" rx="2" class="fr"/>
<path d="M${c} 16V${S - 8}M16 ${c}H${S - 8}" class="eq"/>
<text x="${c}" y="13" class="lb">N</text><text x="8" y="${c + 4}" class="lb">E</text>
<path d="M${c} ${c}L${tx.toFixed(1)} ${ty.toFixed(1)}" class="ar"/>
<path d="M${head(1)}L${tx.toFixed(1)} ${ty.toFixed(1)}L${head(-1)}" class="ar"/>
<rect x="${c - 2}" y="${c - 2}" width="4" height="4" rx="1" class="me"/>
</svg>`;
    return { svg, text: `${pm.toFixed(1)}″ a year, ${way}` };
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
    const targets = ORDER.map((id) => `<button type="button" data-target="${id}" aria-pressed="false"><span class="ic k">${ICON[COPY[id].kind]}</span><b>${esc(COPY[id].display)}</b><small>${esc(COPY[id].short)}</small></button>`).join('');
    const fovs = FOVS.map((f) => `<option value="${f}">${f}°</option>`).join('');
    const ticks = [0.4, 1, 2, 3, 4, 5].map((t) => `<span style="left:${axisPct(t).toFixed(2)}%">${t}</span>`).join('');
    return `
<button type="button" class="sk-mini sk-mini-l" data-act="fold-left" aria-controls="sk-left" aria-label="Show the targets panel" title="Show the targets panel"><span class="ic">${ICON.panelL}</span><span class="t">Target</span><span class="v" data-bind="name"></span></button>
<button type="button" class="sk-mini sk-mini-r" data-act="fold-right" aria-controls="sk-right" aria-label="Show the colour panel" title="Show the colour panel"><span class="t">Colour</span><span class="v"><span data-bind="lam"></span> µm</span><span class="ic">${ICON.panelR}</span></button>
<aside class="sk-rail sk-left" id="sk-left">
  <a class="sk-skip" href="#sk-h2">Skip to the sky</a>
  <div class="sk-brand"><span class="sk-word"><i aria-hidden="true"></i>slowsky</span><span class="sk-tag">Watch the sky change.</span><span class="sk-sub2">Infrared frames from NASA’s SPHEREx</span></div>
  <section class="sk-mod sk-m-pick" aria-labelledby="sk-h1">
    <h2 class="sk-mh" id="sk-h1"><i>01</i>Choose a target</h2>
    <nav class="sk-tg" aria-label="Targets">${targets}</nav>
    <form class="sk-search" data-ref="search" role="search"><span class="ic">${ICON.search}</span><input name="q" placeholder="Any star, or RA, Dec" autocomplete="off" aria-label="Search the sky: a star name, or RA and Dec"></form>
  </section>
  <section class="sk-mod sk-m-about" aria-labelledby="sk-h4">
    <h2 class="sk-mh" id="sk-h4"><span class="ic">${ICON.look}</span>What to look for</h2>
    <p class="sk-h" data-bind="headline"></p>
    <p class="sk-coord"><span data-bind="name"></span><a class="sk-src" data-ref="coords" target="_blank" rel="noopener"></a></p>
    <div class="sk-figs">
      <figure class="sk-fig"><span data-ref="map"></span><figcaption>Where in the sky</figcaption></figure>
      <figure class="sk-fig" data-ref="pmfig" hidden><span data-ref="pm"></span><figcaption data-bind="pm"></figcaption></figure>
    </div>
    <p class="sk-body" data-bind="show"></p>
    <p class="sk-body sk-fact" data-ref="fact" hidden><span class="sk-sub">Measured here.</span> <span data-bind="fact"></span></p>
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
      <h2 class="sk-mh" id="sk-h2" tabindex="-1"><i>02</i><span class="w">Watch it change</span></h2>
      <p class="sk-read"><b data-bind="frame"></b><span data-bind="when"></span></p>
      <button type="button" class="sk-focus" data-act="focus" aria-pressed="false" title="Fold both panels (F)"><span class="ic">${ICON.focus}</span><span>Focus</span></button>
    </div>
    <div class="sk-sky" data-ref="sky">
      <canvas class="sk-glow" data-ref="glow" width="24" height="24" aria-hidden="true"></canvas>
      <canvas class="sk-img" data-ref="canvas" role="img" aria-label="Sky image"></canvas>
      <div class="sk-slot-layer sk-slot-fc" data-ref="fc" hidden></div>
      <div class="sk-slot-layer sk-slot-ep" data-ref="epoch" aria-hidden="true" hidden></div>
      <svg class="sk-ov" data-ref="ov" aria-hidden="true" preserveAspectRatio="none"></svg>
      <div class="sk-slot-flags" data-ref="flags" hidden></div>
      <div class="sk-slot-layer" data-ref="changesMarks" hidden></div>
      <div class="sk-bar" data-ref="bar" aria-hidden="true"><b data-bind="bar"></b><i></i></div>
      <div class="sk-sim" data-ref="sim" hidden>Simulated sky · not real data</div>
      <button type="button" class="sk-ep-tag" data-act="epoch-tag" data-ref="epochTag" hidden></button>
      <div class="sk-load" data-ref="load" hidden><p data-bind="stage"></p><div class="sk-prog"><i data-ref="prog"></i></div></div>
      <div class="sk-err" data-ref="err" hidden><p data-bind="err" role="alert"></p><button type="button" class="sk-btn2" data-act="retry"><span class="ic">${ICON.retry}</span>Try again</button></div>
    </div>
    <div class="sk-ctrl">
    <div class="sk-legrow">
      <div class="sk-leg">
        <span class="sk-gk"><button type="button" class="sk-key g" data-act="gaia" aria-pressed="true"><i class="box" aria-hidden="true"></i><i class="ring" aria-hidden="true"></i>Brightest Gaia stars</button><a class="sk-src" data-ref="gaiaSrc" href="https://www.cosmos.esa.int/web/gaia/dr3" target="_blank" rel="noopener" title="Rings: ESA, Gaia DPAC; Gaia DR3, doi:10.5270/esa-qa4lep3 (CC BY-NC 3.0 IGO)">Gaia DR3</a></span>
        <button type="button" class="sk-key g f" data-act="flags" data-ref="flagsKey" aria-pressed="false" hidden><i class="box" aria-hidden="true"></i><i class="sw" aria-hidden="true"></i>Flagged pixels</button>
        <button type="button" class="sk-key g c" data-act="falsecolour" data-ref="fcKey" aria-pressed="false" hidden><i class="box" aria-hidden="true"></i><i class="sw" aria-hidden="true"></i>False colour</button>
        <button type="button" class="sk-key g e" data-act="epoch" data-ref="epochKey" aria-pressed="false" hidden><i class="box" aria-hidden="true"></i><i class="sw" aria-hidden="true"></i>Older picture</button>
        <span class="sk-key t" data-bind="trackLeg"></span>
        <span class="sk-key d"><i class="b"></i>more light earlier<i class="o"></i>more light later</span>
      </div>
      <label class="sk-fov"><span class="ic">${ICON.field}</span>Field <select data-ref="fov" aria-label="Field of view">${fovs}</select></label>
    </div>
    <p class="sk-flagnote" data-ref="flagsNote" hidden></p>
    <p class="sk-flagnote" data-ref="fcNote" hidden></p>
    <p class="sk-flagnote sk-ep-note" data-ref="epochNote" hidden></p>
    <div class="sk-player">
      <div class="sk-tr">
        <button type="button" class="sk-btn" data-act="prev" aria-label="Previous frame"><span class="ic">${ICON.prev}</span></button>
        <button type="button" class="sk-btn go" data-act="play" aria-label="Play"></button>
        <button type="button" class="sk-btn" data-act="next" aria-label="Next frame"><span class="ic">${ICON.next}</span></button>
      </div>
      <div class="sk-seg" role="group" aria-label="View"><button type="button" data-mode="blink"><span class="ic">${ICON.blink}</span>Blink</button><button type="button" data-mode="stack"><span class="ic">${ICON.stack}</span>Stack</button><button type="button" data-mode="diff"><span class="ic">${ICON.diff}</span>Subtract</button></div>
    </div>
    <div class="sk-sub" data-ref="sub" hidden>
      <label class="sk-fov">A <select data-ref="subA" aria-label="Earlier visit (A)"></select></label>
      <label class="sk-fov">B <select data-ref="subB" aria-label="Later visit (B)"></select></label>
      <div class="sk-seg2" role="group" aria-label="Combine"><button type="button" data-subop="diff" aria-pressed="true">B − A</button><button type="button" data-subop="sum" aria-pressed="false">A + B</button></div>
    </div>
    <p class="sk-hint" data-bind="hint"></p>
    <div class="sk-strip" data-ref="strip" role="group" aria-label="Frames in date order"></div>
    </div>
  </section>
</main>
<div class="sk-gut sk-gut-r">
  <div class="sk-split" data-side="right" role="separator" aria-orientation="vertical" tabindex="0" aria-controls="sk-right" aria-label="Resize the colour panel. Arrow keys resize, Enter folds" aria-valuemin="0" aria-valuemax="420" aria-valuenow="0"></div>
  <button type="button" class="sk-fold" data-act="fold-right" aria-controls="sk-right" aria-expanded="true" aria-label="Fold the colour panel" title="Fold or open the colour panel"><span class="ic">${ICON.next}</span></button>
</div>
<aside class="sk-rail sk-right" id="sk-right">
  <div class="sk-status"><p><span class="dot" aria-hidden="true"></span><span data-bind="statusShort" aria-live="polite">Connecting to the archive</span></p><div class="sk-acts"><button type="button" class="sk-btn2 sk-golive" data-act="live" data-ref="golive" hidden><i aria-hidden="true"></i>Go live</button><button type="button" class="sk-btn2" data-act="copy"><span class="ic">${ICON.link}</span>Copy link</button></div></div>
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
  <section class="sk-mod sk-m-spec" aria-labelledby="sk-h8" data-ref="spec" hidden>
    <h2 class="sk-mh" id="sk-h8"><span class="ic">${ICON.spectrum}</span>Spectrum</h2>
    <div class="sk-slot-spec" data-ref="specBox"></div>
  </section>
  <section class="sk-mod sk-m-slot sk-m-changes" aria-labelledby="sk-h9" data-ref="changes" hidden>
    <h2 class="sk-mh" id="sk-h9"><span class="ic">${ICON.diff}</span>Candidate changes</h2>
    <div data-ref="changesBox"></div>
  </section>
  <section class="sk-mod sk-m-ai" aria-labelledby="sk-h7" data-ref="ai" data-ai-generated="true" hidden>
    <h2 class="sk-mh" id="sk-h7" tabindex="-1"><span class="ic">${ICON.note}</span>AI note<span class="sk-ai-tag">AI-written</span></h2>
    <p class="sk-body mute">A short reading of this view by a language model, from the numbers this page measured.</p>
    <form class="sk-ai-lock" data-ai="lock" hidden><label><span>Passcode</span><input type="password" autocomplete="off" data-ai="pass" aria-label="AI note passcode"></label><button type="submit" class="sk-btn2">Unlock</button></form>
    <button type="button" class="sk-btn2 sk-ai-go" data-ai="go" hidden>Write an AI note</button>
    <p class="sk-ai-msg sk-sr" data-ai="msg" role="status"></p>
    <div class="sk-ai-out" data-ai="out" aria-live="polite"></div>
    <details class="sk-ai-given" data-ai="given" hidden><summary>What this page told the AI</summary><ul data-ai="givenList"></ul></details>
    <p class="sk-ai-disc" data-ai="disc"></p>
    <p class="sk-ai-left" data-ai="left" hidden></p>
  </section>
  <section class="sk-mod sk-m-curve" aria-labelledby="sk-h6" data-ref="curve" hidden>
    <h2 class="sk-mh" id="sk-h6"><span class="ic">${ICON.curve}</span>Brightness over time</h2>
    <div class="sk-lc" data-ref="lcwrap"><svg data-ref="lc" role="img" preserveAspectRatio="none" viewBox="0 0 300 100"></svg><div class="sk-lcy" data-ref="lcy" aria-hidden="true"></div></div>
    <div class="sk-lcx" data-ref="lcx" aria-hidden="true"></div>
    <p class="sk-body mute" data-bind="lcNote"></p>
  </section>
  <section class="sk-mod sk-m-slot sk-m-halo" aria-labelledby="sk-h10" data-ref="halo" hidden>
    <h2 class="sk-mh" id="sk-h10"><span class="ic">${ICON.curve}</span>Halo over time</h2>
    <div data-ref="haloBox"></div>
  </section>
  <section class="sk-mod sk-m-details" aria-labelledby="sk-h5">
    <h2 class="sk-mh" id="sk-h5"><span class="ic">${ICON.info}</span><span data-bind="dlh">This frame</span></h2>
    <dl data-ref="dl"></dl>
    <ul class="sk-notes" data-ref="notes"></ul>
  </section>
  <footer class="sk-credit"><p data-bind="status"></p></footer>
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
    const aiNote = mountAiNote(ref<HTMLElement>('ai'));
    const flagLayer = mountFlags(ref<HTMLElement>('flags'), () => renderSlots());
    const changesSlot = mountChanges(() => renderSlots());
    const fcLayer = mountFalseColour(ref<HTMLElement>('fc'), () => renderSlots());
    // Older picture (2MASS): off unless FEATURES.epoch; the logic lives in epoch-view.ts. Play switches it off.
    const epochSlot = mountEpoch({ key: ref<HTMLButtonElement>('epochKey'), layer: ref<HTMLElement>('epoch'), tag: ref<HTMLButtonElement>('epochTag'),
        note: ref<HTMLElement>('epochNote'), thenHides: [ref<HTMLElement>('flags')] }, { enabled: FEATURES.epoch, pause: () => play(false) });
    const canvas = ref<HTMLCanvasElement>('canvas');
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const glow = ref<HTMLCanvasElement>('glow');
    const glowCtx = glow.getContext('2d') as CanvasRenderingContext2D;
    const ov = ref<SVGSVGElement>('ov');
    const strip = ref<HTMLElement>('strip');
    const lamInput = ref<HTMLInputElement>('lam');
    const fovSelect = ref<HTMLSelectElement>('fov');
    const subBox = ref<HTMLElement>('sub');
    const subASelect = ref<HTMLSelectElement>('subA');
    const subBSelect = ref<HTMLSelectElement>('subB');
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Narrow screens fold long layer notes (see layerSlot); wide ones show them in full.
    const narrow = matchMedia('(max-width: 1080px)');
    narrow.addEventListener('change', () => {
        root.querySelectorAll<HTMLDetailsElement>('details.sk-more').forEach((d) => {
            d.open = !narrow.matches;
        });
    });
    const params = new URLSearchParams(location.search);
    const demoOnly = params.get('demo') === '1';

    const st: State = {
        center: { ra: 0, dec: 0 },
        label: '',
        fovDeg: DEFAULT_FOV,
        detector: 1,
        mode: 'blink',
        subA: 0,
        subB: 0,
        subOp: 'diff',
        index: 0,
        playing: false,
        gaia: true,
        live: false,
    };
    let result: SkyResult | null = null;
    let visits: Visit[] = [];
    let subAHtml = '';
    let subBHtml = '';
    let sourceKind: SourceKind = 'live';
    // Why the saved copy is showing after a live read: the read failed, or it gave no frames. null = no live read was made.
    let fellBack: 'failed' | 'empty' | null = null;
    let cored = false; // the picture shows a too-bright core painted white
    let reading: SourceKind | null = null; // the source being read right now, for the status line
    let curve: Curve | null = null; // brightness against nearby comparison stars, for targets that change
    let shift: ReturnType<typeof shiftFor> | undefined; // motion from the first look to the last, worked out once per result
    let core: ReturnType<typeof coreBlank> = null; // frames with a saturated (blank) centre, once per result
    let stretch: ReturnType<typeof sharedStretch> | null = null;
    let composed: { stack?: Float32Array; diff?: Float32Array; scale?: DiffScale; sumStretch?: Stretch; subKey?: string } = {};
    let timer = 0;
    let ctrl: AbortController | null = null;
    let lamDraft: number | null = null;
    let flagsOn = false; // the Flags layer over the sky
    let fcOn = false; // the False colour layer over the sky (slot, off until its lane lands)
    let lookup: AbortController | null = null; // pending name lookup; any newer navigation cancels it

    function activeVisits(): { a: Visit; b: Visit } | null
    {
        if (!result || visits.length < 2) {
            return null;
        }
        const a = visits[st.subA];
        const b = visits[st.subB];
        if (!a || !b || st.subA < 0 || st.subB <= st.subA || st.subB >= visits.length) {
            return null;
        }
        return { a, b };
    }

    function clearSubCache(): void
    {
        composed.diff = undefined;
        composed.scale = undefined;
        composed.sumStretch = undefined;
        composed.subKey = undefined;
    }

    function bind(key: string, text: string): void
    {
        for (const el of qa<HTMLElement>(`[data-bind="${key}"]`)) {
            if (el.textContent !== text) {
                el.textContent = text;
            }
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
        swapText();
        void load();
    }

    // One beat of data-swap: styles.css fades the left panel's notes in as they change (opacity only).
    let swapTimer = 0;
    function swapText(): void
    {
        delete root.dataset.swap;
        void root.offsetWidth;
        root.dataset.swap = '';
        clearTimeout(swapTimer);
        swapTimer = window.setTimeout(() => {
            delete root.dataset.swap;
        }, 220);
    }

    function setSpot(center: SkyCoord, label: string): void
    {
        st.target = undefined;
        st.center = center;
        st.label = label;
        st.lambda = undefined;
        swapText();
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
        // Take the shared link's frame and subtract picks once: an aborted load must not leave them for the next view.
        const wantFrame = st.wantFrame;
        st.wantFrame = undefined;
        const wantSub = st.wantSub;
        st.wantSub = undefined;
        lamDraft = null; // a half-dragged colour belongs to the old view
        ctrl?.abort();
        ctrl = new AbortController();
        const signal = ctrl.signal;
        play(false);
        // Drop the previous view so nothing (play, strip, details) acts on frames of another spot.
        result = null;
        visits = [];
        subBox.hidden = true;
        curve = null;
        shift = undefined;
        core = null;
        renderCurve();
        stretch = null;
        composed = {};
        strip.innerHTML = '';
        // The last picture and its rings go at once: a picture of the old spot under the new spot's name is a wrong picture.
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
        if (wantFrame === undefined && wantSub === undefined) {
            // The address bar names the spot being opened, not the last one (no stale f=).
            writeUrl();
        }
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
        const savedFirst = !st.live && saved !== undefined && st.detector === saved.detector && st.fovDeg <= SAVED_FOV + 1e-9;
        const order: SourceKind[] = demoOnly ? ['demo'] : savedFirst ? ['snapshot', 'live'] : ['live', 'snapshot'];
        let res: SkyResult | null = null;
        let got: SourceKind = 'live';
        let lastErr: unknown = null;
        let liveErr: unknown = null; // what the live read failed with: the message is about the archive, not the saved copy
        let allMissing = true;
        let failedLive = false;
        let failedSaved = false;
        let fromLive: SkyResult | null = null; // what the archive answered, frames or none
        let fromSaved: SkyResult | null = null; // what the saved copy answered, frames or none
        for (const kind of order) {
            reading = kind;
            renderText();
            try {
                const out = await loadFrom(kind, req);
                if (kind === 'snapshot') {
                    fromSaved = out;
                    const wanted = wantFrame;
                    // Opening from the saved copy: live is still read when the copy is empty or lacks the linked frame.
                    if (out.frames.length > 0 && !(savedFirst && wanted !== undefined && !out.frames.some((f) => f.frame.frame.obsId === wanted))) {
                        break;
                    }
                } else if (kind === 'live') {
                    fromLive = out;
                    // An empty live answer does not end the search while one of the five targets has a saved copy to try.
                    if (out.frames.length > 0 || !st.target) {
                        break;
                    }
                } else {
                    res = out;
                    got = kind;
                    break;
                }
            } catch (e) {
                if (signal.aborted) {
                    return;
                }
                lastErr = e;
                allMissing = allMissing && isNotImplemented(e);
                if (kind === 'live') {
                    failedLive = true;
                    liveErr = e;
                } else if (kind === 'snapshot') {
                    failedSaved = true;
                }
                // A spot that is not one of the five targets has no saved copy.
                if (kind === 'live' && !st.target && !isNotImplemented(e)) {
                    break;
                }
            }
        }
        // Live frames win. The saved copy stands in when live fails or answers with no frames. With no frames anywhere,
        // the live answer is the one reported.
        if (fromLive && fromLive.frames.length > 0) {
            res = fromLive;
            got = 'live';
        } else if (fromSaved && fromSaved.frames.length > 0) {
            res = fromSaved;
            got = 'snapshot';
        } else if (fromLive) {
            res = fromLive;
            got = 'live';
        } else if (fromSaved) {
            res = fromSaved;
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
        reading = null;
        ref<HTMLElement>('load').hidden = true;
        delete root.dataset.loading;
        lamInput.disabled = false;
        if (!res || res.frames.length === 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ov.innerHTML = '';
            paintGlow();
            renderText();
            // Frames exist, but none could be used: blank in this view, off the detector, or the spot at its edge.
            // Either source's count is proof that they exist.
            const left = (r: SkyResult | null): number => (r ? (r.unusable ?? 0) + (r.missed ?? 0) : 0);
            const none = left(fromLive) + left(fromSaved) > 0;
            const either = failedSaved && st.target ? ' The saved copy on this site could not be loaded either.' : '';
            // A failed live read comes first: what the saved copy lacks says nothing about the archive.
            const why = !res ? `Couldn’t load the frames. ${plainError(liveErr ?? lastErr)}${failedLive ? either : ''}`
                : failedLive ? `Couldn’t read the live SPHEREx archive, and the saved copy has no ${none ? 'frames that could be used for this view' : 'frames'} at this colour. ${plainError(liveErr)}`
                : none ? 'SPHEREx has frames near this spot, but none of them could be used for this view at this colour.'
                : 'SPHEREx has no frames of this spot at this colour yet.';
            bind('err', why);
            ref<HTMLElement>('err').hidden = false;
            writeUrl();
            return;
        }
        result = res;
        visits = visitGroups(res);
        const picks = defaultPicks(visits);
        if (
            picks
            && wantSub
            && wantSub.a !== null
            && wantSub.b !== null
            && wantSub.a >= 0
            && wantSub.a < wantSub.b
            && wantSub.b < visits.length
        ) {
            st.subA = wantSub.a;
            st.subB = wantSub.b;
        } else {
            st.subA = picks ? picks.a : 0;
            st.subB = picks ? picks.b : 0;
        }
        if (wantSub) {
            st.subOp = wantSub.op ?? 'diff';
        }
        core = coreBlank(res);
        sourceKind = got;
        fellBack = got !== 'snapshot' ? null : failedLive ? 'failed' : fromLive ? 'empty' : null;
        if (got === 'snapshot' && st.fovDeg > SAVED_FOV + 1e-9) {
            // Live failed and the saved copy holds only the small field: say what is shown.
            st.fovDeg = SAVED_FOV;
        }
        st.lambda = res.lambda;
        // The frames say which detector they came from; near a band edge the wavelength alone can point at the next one.
        st.detector = res.frames[0]?.frame.frame.detector ?? detectorOf(res.lambda);
        stretch = sharedStretch(res.frames);
        composed = {};
        st.index = 0;
        let hold = false; // a shared link named this frame: open paused on it
        if (wantFrame) {
            const k = res.frames.findIndex((f) => f.frame.frame.obsId === wantFrame);
            st.index = Math.max(0, k);
            hold = k >= 0;
        }
        if (st.mode !== 'blink') {
            compose();
        }
        const kindNow = st.target ? COPY[st.target].kind : 'field';
        curve = kindNow === 'variable' || kindNow === 'cold' ? curveFor(res, st.target ? targetById(st.target)?.astrometry : undefined) : null;
        renderCurve();
        canvas.width = res.grid.width;
        canvas.height = res.grid.height;
        ov.setAttribute('viewBox', `0 0 ${res.grid.width} ${res.grid.height}`);
        buildStrip();
        draw();
        if (!reduceMotion && !hold && st.mode === 'blink' && res.frames.length > 1) {
            play(true);
        }
        // After the play state is set: a playing view links without a frame, a paused one with it.
        writeUrl();
    }

    function progress(p: SkyProgress): void
    {
        const n = Math.max(p.total, 1);
        bind('stage', `${STAGE_TEXT[p.stage]}${p.total > 1 ? ` · ${Math.min(p.done + 1, n)} of ${n}` : ''}`);
        const stages = ['search', 'headers', 'pixels', 'regrid'];
        const frac = (stages.indexOf(p.stage) + Math.min(p.done / n, 1)) / stages.length;
        ref<HTMLElement>('prog').style.setProperty('--p', frac.toFixed(3)); // styles.css fills the line by scaleX
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
            if (st.mode === 'diff') {
                const pair = activeVisits();
                if (pair) {
                    const subKey = `${st.subA}:${st.subB}:${st.subOp}`;
                    if (!composed.diff || composed.subKey !== subKey) {
                        const imgA = visitImage(result, pair.a);
                        const imgB = visitImage(result, pair.b);
                        const combined = combineVisits(imgA, imgB, st.subOp);
                        composed.diff = combined;
                        composed.subKey = subKey;
                        if (st.subOp === 'diff') {
                            composed.scale = diffScale(combined);
                            composed.sumStretch = undefined;
                        } else {
                            const base = result.frames[pair.a.ks[0] ?? 0] ?? result.frames[0];
                            if (base) {
                                const sumFrame: PlayerFrame = {
                                    ...base,
                                    frame: { ...base.frame, grid: result.grid, data: combined },
                                };
                                composed.sumStretch = sharedStretch([sumFrame]);
                            }
                            composed.scale = undefined;
                        }
                    }
                } else if (!composed.diff || composed.subKey !== 'frames') {
                    const first = regs[0];
                    const last = regs[regs.length - 1];
                    if (first && last) {
                        composed.diff = subtract(last.data, first.data).data;
                        composed.scale = diffScale(composed.diff);
                        composed.sumStretch = undefined;
                        composed.subKey = 'frames';
                    }
                }
            }
        } catch (e) {
            if (!(e instanceof StackError)) {
                throw e;
            }
            clearSubCache();
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
        const pair = st.mode === 'diff' ? activeVisits() : null;
        const data = st.mode === 'stack' ? composed.stack : st.mode === 'diff' ? composed.diff : undefined;
        const { width, height } = data ? result.grid : f.frame.grid;
        const img = ctx.createImageData(width, height);
        cored = false;
        if (st.mode === 'diff' && data && (!pair || st.subOp === 'diff')) {
            renderDiverging(data, composed.scale ?? { floor: 0, limit: 1 }, img.data);
        } else {
            const pix = data ?? f.frame.data;
            const useStretch = st.mode === 'diff' && pair && st.subOp === 'sum' ? (composed.sumStretch ?? stretch) : stretch;
            renderRgba(pix, useStretch, img.data);
            // A star too bright for the camera has blank pixels at its core: paint them white, not black.
            // Not in A + B, whose sentence says blank pixels show black.
            const sum = st.mode === 'diff' && pair && st.subOp === 'sum';
            cored = !sum && fillCores(pix, width, height, img.data) > 0;
        }
        ctx.putImageData(img, 0, 0);
        paintGlow();
        overlay();
        renderCurve();
        renderText();
        renderFrameState();
    }

    // The white block behind the chosen view slides to it (styles.css .sk-seg::before) instead of jumping.
    function placeSeg(): void
    {
        const seg = q<HTMLElement>('.sk-seg');
        const on = seg.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (!on || on.offsetWidth === 0) {
            return;
        }
        seg.style.setProperty('--sx', `${on.offsetLeft}px`);
        seg.style.setProperty('--sw', `${on.offsetWidth}px`);
        if (!('ready' in seg.dataset)) {
            void seg.offsetWidth; // place it first, then let later moves animate
            seg.dataset.ready = '';
        }
    }

    // Brightness against nearby comparison stars: one dot per frame, the frame on screen lit. The band is how much
    // the comparison stars wobble against each other, so a change inside it may be noise.
    function renderCurve(): void
    {
        const sec = ref<HTMLElement>('curve');
        const c = curve;
        const pts = c ? c.lc.points.map((p, i) => ({ p, k: c.frameOf[i] ?? -1 })).filter((o) => o.p.valid && Number.isFinite(o.p.relative)) : [];
        if (!result || !c || pts.length < 2) {
            sec.hidden = true;
            return;
        }
        sec.hidden = false;
        const W = 300;
        const H = 100;
        const noise = Number.isFinite(c.noise) ? c.noise : 0;
        const name = st.target ? COPY[st.target].display : 'the target';
        // A catalogued star inside the measuring circle mixes its light in. For a cold brown dwarf with such a star
        // in the circle the chart stays hidden below 4.4 µm, where the brown dwarf is faint (Luhman 2014,
        // arXiv:1404.6501, Table 1); for other targets the note just says so. Nothing here measures which is brighter.
        const blendAt = c.blend ? `A Gaia star (G ${c.blend.g.toFixed(1)}) sits ${(c.blend.px * result.grid.pixelArcsec).toFixed(1)}″ from ${name}` : '';
        const cold = st.target ? COPY[st.target].kind === 'cold' : false;
        const hideChart = c.blend !== null && cold && c.lc.lambda < 4.4;
        ref<HTMLElement>('lcwrap').hidden = hideChart;
        ref<HTMLElement>('lcx').hidden = hideChart;
        if (hideChart) {
            bind('lcNote', `${blendAt}, close enough that its light may reach the measuring circle. No curve is drawn below 4.4 µm; slide the colour to 4.4 µm or longer.`);
            return;
        }
        const ys = pts.map((o) => o.p.relative);
        // Each point's own error: the comparison stars' wobble plus the target's own noise (aperture()'s sky noise
        // on its sum, already scaled for regridded pixels sharing a detector pixel's noise), scaled the same way as
        // the point, so a faint or missing target still gets an honest bar.
        const scales = pts.filter((o) => o.p.relative !== 0 && o.p.ratio !== 0).map((o) => o.p.ratio / o.p.relative).sort((a, b) => a - b);
        const med = scales.length ? scales[Math.floor(scales.length / 2)]! : NaN;
        const err = pts.map((o) => {
            const own = o.p.target.noise / (o.p.refSum * med);
            return dotBar(o.p.relative, noise, own);
        });
        let lo = Math.min(...ys.map((v, i) => v - err[i]!), 1 - noise);
        let hi = Math.max(...ys.map((v, i) => v + err[i]!), 1 + noise);
        const pad = Math.max((hi - lo) * 0.18, 0.01);
        lo -= pad;
        hi += pad;
        const t0 = pts[0]!.p.mjd;
        const t1 = pts[pts.length - 1]!.p.mjd;
        const x = (t: number) => 6 + ((t - t0) / (t1 - t0 || 1)) * (W - 12);
        const y = (v: number) => ((hi - v) / (hi - lo)) * H;
        const on = st.mode === 'blink' ? st.index : -1;
        const dot = (o: { p: { mjd: number; relative: number }; k: number }) =>
            `<path d="M${x(o.p.mjd).toFixed(1)} ${y(o.p.relative).toFixed(1)}h0" class="${o.k === on ? 'on' : ''}" data-k="${o.k}" vector-effect="non-scaling-stroke"/>`;
        ref<SVGSVGElement>('lc').innerHTML =
            `<rect x="0" width="${W}" y="${y(1 + noise).toFixed(1)}" height="${Math.max(0.5, y(1 - noise) - y(1 + noise)).toFixed(1)}" class="band"/>`
            + `<path d="M0 ${y(1).toFixed(1)}H${W}" class="base" vector-effect="non-scaling-stroke"/>`
            + `<polyline points="${pts.map((o) => `${x(o.p.mjd).toFixed(1)},${y(o.p.relative).toFixed(1)}`).join(' ')}" class="line" vector-effect="non-scaling-stroke"/>`
            + `<g class="err">${pts.map((o, i) => `<path d="M${x(o.p.mjd).toFixed(1)} ${y(o.p.relative + err[i]!).toFixed(1)}V${y(o.p.relative - err[i]!).toFixed(1)}" vector-effect="non-scaling-stroke"/>`).join('')}</g>`
            + `<g class="dots">${pts.map(dot).join('')}</g>`;
        const pct = (v: number) => `${v >= 1 ? '+' : '−'}${Math.abs((v - 1) * 100).toFixed(Math.abs(v - 1) < 0.1 ? 1 : 0)}%`;
        ref<HTMLElement>('lcy').innerHTML = `<span style="top:0">${pct(hi)}</span><span style="top:${((hi - 1) / (hi - lo) * 100).toFixed(1)}%">median</span><span style="top:100%">${pct(lo)}</span>`;
        // The band's key sits between the dates, so nobody reads it as the star's own error bar.
        ref<HTMLElement>('lcx').innerHTML = `<span>${monthYear(t0)}</span><span class="b"><i></i>band: ${c.refs} comparison stars</span><span>${monthYear(t1)}</span>`;
        const min = Math.min(...ys);
        const max = Math.max(...ys);
        ref<SVGSVGElement>('lc').setAttribute('aria-label', `Brightness over ${pts.length} looks, readings from ${pct(min)} to ${pct(max)} relative to the median; the scale runs from ${pct(lo)} to ${pct(hi)} to fit the error bars. Estimated comparison noise about ${(noise * 100).toFixed(1)}%.`);
        const off = c.lc.dropped > 0 ? ` ${c.lc.dropped} ${c.lc.dropped === 1 ? 'frame was' : 'frames were'} too far off this colour.` : '';
        const bad = c.lc.points.length - pts.length;
        const left = off + (bad > 0 ? ` ${bad} ${bad === 1 ? 'look' : 'looks'} could not be measured.` : '');
        bind('lcNote', `At ${c.lc.lambda.toFixed(2)} µm, measured against ${c.refs} nearby comparison stars from Gaia. The band shows how much they wobble (±${(noise * 100).toFixed(1)}%); the bar on each dot combines that wobble, scaled to the dot’s value, with the noise of the sky around the star. Noise from the star’s own light, and anything that affects this star alone, is not in the bar, so the real uncertainty may be larger. A change inside its bar may be noise.${left}${blendAt ? ` ${blendAt}, too close for SPHEREx to split, so the curve includes its light.` : ''}`);
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
            // Each star where it was on this frame's date; with every frame averaged (Stack), at their mean date.
            const now = result.frames[st.index];
            const mean = result.frames.reduce((sum, f) => sum + frameMjd(f.frame), 0) / result.frames.length;
            const mjd = st.mode === 'blink' && now ? frameMjd(now.frame) : mean;
            for (const s of ringsOn(result, mjd, GAIA_RINGS)) {
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
            const pair = st.mode === 'diff' ? activeVisits() : null;
            const ks = st.mode === 'blink'
                ? [st.index]
                : st.mode === 'stack'
                    ? frames.map((_, i) => i)
                    : pair
                        ? [...pair.a.ks, ...pair.b.ks]
                        : [0, frames.length - 1];
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
        const pair = st.mode === 'diff' ? activeVisits() : null;
        const n = result ? result.frames.length : 0;
        const subSet = st.mode === 'diff' && n > 0
            ? new Set(pair ? [...pair.a.ks, ...pair.b.ks] : [0, n - 1])
            : null;
        qa<HTMLButtonElement>('.sk-strip button').forEach((b, i) => {
            if (st.mode === 'blink' && i === st.index) {
                b.setAttribute('aria-current', 'true');
            } else {
                b.removeAttribute('aria-current');
            }
            if (subSet && subSet.has(i)) {
                b.setAttribute('data-in-sub', '');
            } else {
                b.removeAttribute('data-in-sub');
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
        ref<HTMLElement>('bar').style.visibility = '';
        const skyPx = ref<HTMLElement>('sky').clientWidth;
        const fovArcsec = result.grid.pixelArcsec * result.grid.width;
        // The source may show less than was asked for (the saved copy caps at 0.1°), so size from the grid.
        const bar = result.grid.fovDeg >= 0.5 ? 600 : 60;
        ref<HTMLElement>('bar').style.width = `${Math.max(12, (bar / fovArcsec) * skyPx).toFixed(1)}px`;
        bind('bar', `${bar / 60}′`);
    }

    // The mover's first-to-last shift, worked out once per result, for the AI note's facts.
    function noteShift(): ReturnType<typeof shiftFor> | undefined
    {
        const t = st.target ? targetById(st.target) : undefined;
        if (!result || !t || COPY[t.id].kind !== 'mover' || result.frames.length < 2) {
            return undefined;
        }
        if (shift === undefined) {
            shift = shiftFor(result, t.astrometry);
        }
        return shift;
    }

    // Feature-flagged slots (src/ui/slots.ts): hidden unless the flag is on and the module has something to show.
    function renderSlots(): void
    {
        const view = result ? { result, targetId: st.target, index: st.index, mode: st.mode, source: sourceKind } : null;
        const spec = ref<HTMLElement>('spec');
        spec.hidden = !(FEATURES.spectrum && view && renderSpectrum(ref<HTMLElement>('specBox'), view));
        const changes = !!(FEATURES.changes && view && changesSlot.render(ref<HTMLElement>('changesBox'), ref<HTMLElement>('changesMarks'), view));
        ref<HTMLElement>('changes').hidden = !changes;
        ref<HTMLElement>('changesMarks').hidden = !changes;
        ref<HTMLElement>('halo').hidden = !(FEATURES.halo && view && renderHalo(ref<HTMLElement>('haloBox'), view));
        layerSlot(fcLayer.update(view, fcOn), fcOn, 'fcKey', 'fc', 'fcNote');
        // FLAGS are read only once the key is switched on (Blink, live frames); a finished read renders again.
        layerSlot(flagLayer.update(view, flagsOn), flagsOn, 'flagsKey', 'flags', 'flagsNote');
        const shown = result?.frames[st.index];
        epochSlot.update(view && shown ? { ...view, when: niceDate(shown.frame.frame.tMin) } : null);
    }

    // A legend toggle with a layer over the sky and a line under the legend (Flags, False colour).
    function layerSlot(fs: LayerState, on: boolean, keyRef: string, layerRef: string, noteRef: string): void
    {
        const key = ref<HTMLButtonElement>(keyRef);
        key.hidden = !fs.key;
        key.setAttribute('aria-pressed', String(on));
        ref<HTMLElement>(layerRef).hidden = !fs.layer;
        const note = ref<HTMLElement>(noteRef);
        // A long note is split: the reading stays in view; how to read it folds away on narrow screens.
        const split = fs.split && fs.split.lead && fs.split.more ? fs.split : undefined;
        const want = split ? `${split.lead}\u0000${split.more}` : fs.note;
        if (note.dataset.shown !== want) {
            note.dataset.shown = want;
            if (split) {
                note.replaceChildren(split.lead, ' ');
                const more = document.createElement('details');
                more.className = 'sk-more';
                more.open = !narrow.matches;
                const sum = document.createElement('summary');
                sum.textContent = 'How to read this colour';
                more.append(sum, split.more);
                note.append(more);
            } else {
                note.textContent = fs.note;
            }
        }
        note.hidden = !(fs.key && fs.note);
    }

    function renderText(): void
    {
        const pair = activeVisits();
        root.dataset.mode = st.mode;
        root.dataset.subop = pair ? st.subOp : 'diff';
        root.dataset.gaia = String(st.gaia);
        root.dataset.source = sourceKind;
        ref<HTMLElement>('sim').hidden = !(result && sourceKind === 'demo');
        ref<HTMLElement>('golive').hidden = !(result && sourceKind === 'snapshot' && st.target);
        aiNote.update(result && sourceKind !== 'demo' ? { result, targetId: st.target, center: st.center, curve, shift: noteShift() } : null);
        renderSlots();
        const copy = st.target ? COPY[st.target] : null;
        bind('name', copy ? copy.display : st.label);
        const coordsA = ref<HTMLAnchorElement>('coords');
        coordsA.textContent = `${formatRa(st.center.ra)}  ${formatDec(st.center.dec)}`;
        // The position's source, on the position: SIMBAD (Harvard mirror; the CDS site is down) by name or by coordinates.
        const simbadName = st.target ? targetById(st.target)?.name : undefined;
        coordsA.href = simbadName
            ? `https://simbad.cfa.harvard.edu/simbad/sim-id?Ident=${encodeURIComponent(simbadName)}`
            : `https://simbad.cfa.harvard.edu/simbad/sim-coo?Coord=${encodeURIComponent(`${st.center.ra.toFixed(5)} ${st.center.dec >= 0 ? '+' : ''}${st.center.dec.toFixed(5)}`)}&Radius=1&Radius.unit=arcmin`;
        coordsA.title = simbadName ? `Position and motion: SIMBAD, ${simbadName}` : 'Look up this position in SIMBAD';
        ref<HTMLElement>('map').innerHTML = skyMapSvg(st.center.ra, st.center.dec);
        // The motion arrow only for stars that visibly walk: over half an arcsecond a year.
        const am = st.target ? targetById(st.target)?.astrometry : undefined;
        const fast = am && Number.isFinite(am.pmRa) && Number.isFinite(am.pmDec) && Math.hypot(am.pmRa, am.pmDec) > 500;
        ref<HTMLElement>('pmfig').hidden = !fast;
        if (fast) {
            const m = motionSvg(am.pmRa, am.pmDec);
            ref<HTMLElement>('pm').innerHTML = m.svg;
            bind('pm', m.text);
        }
        bind('headline', copy ? copy.headline : CUSTOM_COPY.headline);
        const card = cardFacts();
        bind('show', card.show ?? (copy ? copy.show : CUSTOM_COPY.show));
        bind('not', card.not ?? (copy ? copy.not : CUSTOM_COPY.not));
        bind('fact', card.fact ?? '');
        ref<HTMLElement>('fact').hidden = !card.fact;
        bind('hint', st.mode === 'diff' && pair ? subtractText(pair.a, pair.b, st.subOp) : MODE_HINT[st.mode]);
        subBox.hidden = !(st.mode === 'diff' && pair !== null);
        if (pair) {
            const aHtml = visits.slice(0, -1).map((v, i) => `<option value="${i}">${esc(visitLabel(v))}</option>`).join('');
            if (aHtml !== subAHtml) {
                subASelect.innerHTML = aHtml;
                subAHtml = aHtml;
            }
            subASelect.value = String(st.subA);
            const bHtml = visits.slice(st.subA + 1).map((v, off) => {
                const idx = st.subA + 1 + off;
                return `<option value="${idx}">${esc(visitLabel(v))}</option>`;
            }).join('');
            if (bHtml !== subBHtml) {
                subBSelect.innerHTML = bHtml;
                subBHtml = bHtml;
            }
            subBSelect.value = String(st.subB);
            for (const b of qa<HTMLButtonElement>('[data-subop]')) {
                b.setAttribute('aria-pressed', String(b.dataset.subop === st.subOp));
            }
        }
        bind('trackLeg', copy && (copy.kind === 'mover' || copy.kind === 'spectrum') ? `Where ${copy.display} should be on this date` : '');
        root.dataset.trackleg = copy && (copy.kind === 'mover' || copy.kind === 'spectrum') ? 'true' : 'false';
        for (const b of qa<HTMLButtonElement>('[data-target]')) {
            b.setAttribute('aria-pressed', String(b.dataset.target === st.target));
        }
        for (const b of qa<HTMLButtonElement>('[data-mode]')) {
            b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode));
        }
        placeSeg();
        const play = q<HTMLButtonElement>('[data-act="play"]');
        play.innerHTML = `<span class="ic">${st.playing ? ICON.pause : ICON.play}</span>`;
        play.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
        const gaiaBtn = q<HTMLButtonElement>('[data-act="gaia"]');
        gaiaBtn.setAttribute('aria-pressed', String(st.gaia));
        // No catalogue stars came back: hide the toggle rather than offer an empty one.
        gaiaBtn.hidden = !result || result.stars.length === 0;
        ref<HTMLElement>('gaiaSrc').hidden = gaiaBtn.hidden;
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
            ref<HTMLElement>('dl').innerHTML = '';
            ref<HTMLElement>('notes').innerHTML = '';
            ref<HTMLElement>('bar').style.visibility = 'hidden';
            bind('status', reading ? 'Loading frames from NASA’s SPHEREx mission.' : 'No frames are showing.');
            bind('statusShort', reading === 'live' ? 'Reading live from NASA’s archive · about 30 s'
                : reading === 'snapshot' ? 'Opening the saved copy' : reading === 'demo' ? 'Building the simulated sky' : 'Nothing to show');
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
            bind('frame', `Average of ${n}`);
            bind('when', `${monthYear(first.tMin)} – ${monthYear(last.tMin)}`);
        } else if (st.mode === 'diff' && pair) {
            bind('frame', st.subOp === 'sum' ? 'A + B' : 'B − A');
            // No break inside a date, so a narrow header wraps only at the − or +.
            const [da, db] = headerDates(pair.a, pair.b).map((d) => d.replace(/ /g, '\u00a0'));
            bind('when', st.subOp === 'sum' ? `${da} + ${db}` : `${db} − ${da}`);
        } else if (first && last) {
            bind('frame', 'Last − first');
            bind('when', `${monthYear(last.tMin)} − ${monthYear(first.tMin)}`);
        }
        sizeBar();
        bind('dlh', st.mode === 'blink' || n < 2 ? 'This frame' : 'These frames');

        const extraNotes: string[] = [];
        if (cored) {
            extraNotes.push('The white core is a star too bright for the camera there: SPHEREx records no value for those pixels.');
        }
        if (f && lf) {
            // Blink describes the frame on screen; Stack and Subtract describe the frames they combine.
            const diffPair = st.mode === 'diff' ? pair : null;
            const many = st.mode !== 'blink' && (diffPair !== null || n > 1);
            const shown = !many
                ? [st.index]
                : st.mode === 'stack'
                    ? result.frames.map((_, i) => i)
                    : diffPair
                        ? [...diffPair.a.ks, ...diffPair.b.ks]
                        : [0, n - 1];
            const rec = many ? result.frames[shown[0]!]!.frame.frame : f.frame.frame;
            const utc = (mjd: number): string => `${mjdToDate(mjd).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
            const lams = shown.map((i) => result!.locked[i]?.lambda).filter((v): v is number => v !== undefined && Number.isFinite(v));
            const firstA = diffPair ? result.frames[diffPair.a.ks[0]!]?.frame.frame : undefined;
            const firstB = diffPair ? result.frames[diffPair.b.ks[0]!]?.frame.frame : undefined;
            const showsText = st.mode === 'stack'
                ? `Average of all ${n} frames`
                : diffPair
                    ? (st.subOp === 'sum' ? 'Visit A plus visit B' : 'Visit B minus visit A')
                    : `Frame ${n} minus frame 1`;
            const takenText = st.mode === 'stack'
                ? `${niceDate(first!.tMin)} to ${niceDate(last!.tMin)}`
                : diffPair && firstA && firstB
                    ? (st.subOp === 'sum' ? `${utc(firstA.tMin)} + ${utc(firstB.tMin)}` : `${utc(firstB.tMin)} − ${utc(firstA.tMin)}`)
                    : `${utc(last!.tMin)} − ${utc(first!.tMin)}`;
            const rows: [string, string][] = many
                ? [
                    ['Shows', showsText],
                    ['Taken', takenText],
                    ['Colour', lams.length ? `${Math.min(...lams).toFixed(3)} to ${Math.max(...lams).toFixed(3)} µm` : '—'],
                ]
                : [
                    ['Taken', utc(rec.tMin)],
                    ['Frame', `${st.index + 1} of ${n}`],
                    ['Colour here', `${lf.lambda.toFixed(3)} µm (${lf.dLambda >= 0 ? '+' : '−'}${Math.abs(lf.dLambda).toFixed(3)})`],
                ];
            // Stack and Subtract can mix detectors or releases (e.g. QR3 and DR1), so list every one they use.
            const recs = shown.map((i) => result!.frames[i]!.frame.frame);
            const relRecs = recs.filter((r, i) => recs.findIndex((o) => o.collection === r.collection) === i);
            const dets = [...new Set(recs.map((r) => r.detector))].sort((a, b) => a - b);
            rows.push(
                ['Detector', dets.map((d) => `D${d}`).join(', ')],
                ['Release', relRecs.map((r) => r.collection).join(', ')],
                ['Field', `${Number(result.grid.fovDeg.toFixed(3))}° · ${result.grid.width} × ${result.grid.height} px`],
                ['Scale', `${result.grid.pixelArcsec.toFixed(2)}″ per pixel`],
            );
            const firstRec = recs[0]!;
            const lastRec = recs[recs.length - 1]!;
            if (!many) {
                rows.push(['File', rec.obsId]);
            } else if (diffPair) {
                rows.push(['Files', `${recs.length} files: ${firstRec.obsId} to ${lastRec.obsId}`]);
            } else if (st.mode === 'diff') {
                rows.push(['Files', `${last!.obsId} − ${first!.obsId}`]);
            } else {
                rows.push(['Files', `${n}, ${first!.obsId} to ${last!.obsId}`]);
            }
            if (rec.pipelineVersion && !many) {
                rows.push(['Pipeline', rec.pipelineVersion]);
            }
            const t = st.target ? targetById(st.target) : undefined;
            // The motion rows describe two single frames, so they show only in Blink.
            if (t && COPY[t.id].kind === 'mover' && n > 1 && st.mode === 'blink') {
                if (shift === undefined) {
                    shift = shiftFor(result, t.astrometry);
                }
                const sh = shift;
                // Under twice the measuring error the shift can't be seen, so the rows stay out.
                if (sh && sh.significant) {
                    // The expected shift is the solid number. The measured one leans on a centre the camera can't
                    // see well (the core is saturated), so it carries its error and the note says why.
                    rows.push([`Moved, looks 1 to ${sh.to + 1}`, `${sh.predictedArcsec.toFixed(1)}″ expected`]);
                    rows.push(['Measured here', sh.measured ? `${sh.measured.measuredArcsec.toFixed(0)}″ ± ${sh.errArcsec.toFixed(0)}″` : 'could not measure']);
                    extraNotes.push(sh.measured
                        ? 'The star’s core is too bright for the camera to measure, so the measured shift is rough. The expected shift comes from its catalogue motion.'
                        : 'The star’s centre could not be found close enough to where it should be, so only the expected shift from its catalogue motion is shown.');
                }
            }
            const release = relRecs.map((r) => {
                const doi = sourceKind === 'demo' ? undefined : RELEASE_DOI[r.release];
                return doi
                    ? `<a class="sk-src" href="https://doi.org/${doi.id}" target="_blank" rel="noopener" title="${esc(doi.cite)}">${esc(doi.label)}</a>`
                    : esc(r.collection);
            }).join(', ');
            let html = rows.map(([k, v]) => {
                const val = k === 'Release' ? release : esc(v);
                return `<dt>${k}</dt><dd>${val}</dd>`;
            }).join('');
            const links: string[] = [];
            if (many) {
                for (const [r, label] of [[firstRec, 'first'], [lastRec, 'last']] as const) {
                    if (r.url) {
                        links.push(`<a href="${esc(r.url)}" rel="noopener" target="_blank"><span class="ic">${ICON.file}</span>FITS, ${label}</a>`);
                    }
                }
            } else if (rec.url && !many) {
                links.push(`<a href="${esc(rec.url)}" rel="noopener" target="_blank"><span class="ic">${ICON.file}</span>FITS file</a>`);
            }
            if (rec.irsaUrl && !many) {
                links.push(`<a href="${esc(rec.irsaUrl)}" rel="noopener" target="_blank"><span class="ic">${ICON.out}</span>IRSA</a>`);
            }
            if (links.length) {
                html += `<dt>Open</dt><dd>${links.join(' · ')}</dd>`;
            }
            ref<HTMLElement>('dl').innerHTML = html;
        }
        bind('statusShort', sourceKind === 'live' ? 'Live from NASA’s SPHEREx archive'
            : sourceKind === 'snapshot' ? (fellBack === 'failed' ? 'Saved copy · live read failed' : fellBack === 'empty' ? 'Saved copy · live read gave no frames' : 'Saved copy') : 'Simulated sky · not real data');
        const status = sourceKind === 'live' ? 'Live: read straight from NASA’s SPHEREx archive on Amazon S3.'
            : sourceKind === 'snapshot' ? (fellBack === 'failed' ? 'The live read of NASA’s archive failed, so this is the saved copy: real SPHEREx frames stored with this page. Go live tries the archive again.'
                : fellBack === 'empty' ? 'The live read of NASA’s archive gave no frames for this view, so this is the saved copy: real SPHEREx frames stored with this page. Go live tries the archive again.'
                : 'Saved copy: real NASA SPHEREx frames stored with this page, so it opens at once. Go live reads them fresh from the archive (about 30 s).')
                : 'Simulated sky for building the page. Not real data.';
        bind('status', status);
        ref<HTMLElement>('notes').innerHTML = [...extraNotes, ...result.notes].map((t) => `<li>${esc(t)}</li>`).join('');
        const nowShowing = `${q<HTMLElement>('[data-bind="frame"]').textContent}, ${q<HTMLElement>('[data-bind="when"]').textContent}`;
        // While it plays, a frame changes every 0.7 s: announcing each would drown a screen reader. Say it when it stops.
        if (!st.playing) {
            ref<HTMLElement>('live').textContent = nowShowing;
        }
        canvas.setAttribute('aria-label', `Sky image. ${nowShowing}, ${lam.toFixed(2)} µm`);
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

    // The card's measured lines. Every number comes from the frames on screen, never from notes.
    function cardFacts(): { fact?: string; not?: string; show?: string }
    {
        const kind = st.target ? COPY[st.target].kind : 'field';
        if (!result || !st.target) {
            return {};
        }
        const n = result.frames.length;
        const blankText = core && core.blank > 0
            ? `${core.blank === core.of ? `all ${core.of}` : `${core.blank} of ${core.of}`} frame${core.of === 1 ? '' : 's'} here`
            : '';
        if (kind === 'mover') {
            return blankText
                ? { not: `Its centre has no value in ${blankText}, inside a bright glow, the way a star too bright for the camera shows. So its position here is rough.` }
                : { not: 'Its centre may be too bright for the camera, so treat its position with care.' };
        }
        if (kind === 'saturated') {
            return blankText
                ? { not: `Its centre has no value in ${blankText}, inside a bright glow, the way a star too bright for the camera shows. So the centre cannot be measured; the glow around it can.` }
                : { not: 'Its centre may be too bright for the camera, so treat any change at the centre with care.' };
        }
        if (kind === 'variable' && curve) {
            const valid = curve.lc.points.filter((p) => p.valid && Number.isFinite(p.relative));
            const rel = valid.map((p) => p.relative);
            // Ratios only mean something when the star itself is clearly seen in every look: over 3 times aperture()'s
            // sky noise on its sum (scaled for regridded pixels sharing a detector pixel's noise).
            const seen = (p: (typeof valid)[number]): boolean => p.target.noise > 0 && p.target.snr > 3;
            if (rel.length >= 2 && (Math.min(...rel) <= 0 || !valid.every(seen))) {
                return { fact: `Across ${rel.length} looks it is not clearly seen above the sky in at least one, so no change is given.` };
            }
            if (rel.length >= 2) {
                const change = (Math.max(...rel) / Math.min(...rel) - 1) * 100;
                const wobble = Number.isFinite(curve.noise) ? curve.noise * 100 : NaN;
                const inside = Number.isFinite(wobble) && change < 2 * wobble;
                return {
                    fact: `Across ${rel.length} looks its brightest is ${change.toFixed(change < 10 ? 1 : 0)}% above its faintest, against ${curve.refs} comparison stars${Number.isFinite(wobble) ? ` (estimated comparison noise ±${wobble.toFixed(1)}%)` : ''}.${inside ? ' That change is inside the noise.' : ''}`,
                };
            }
            return {};
        }
        if (kind === 'cold') {
            const visits = visitsOf(result).map((v) => `${v.n} in ${monthYear(v.mjd)}`);
            // From earlier telescopes, not measured here, so it sits in the description, not under "Measured here".
            // Luhman 2014 (arXiv:1404.6501, Table 1): [3.6] 17.44, [4.5] 13.89, W2 (4.6 µm) 13.89 mag. Detector 6
            // covers 4.42 to 5.00 µm. Other detectors get no sentence here; the card's own line covers 3.6 vs 4.5 µm.
            const colour = st.detector === 6 ? ' WISE measured its light at 4.6 µm, inside this detector’s range (detector 6 of 6).' : '';
            return {
                show: `${COPY[st.target].show}${colour}`,
                fact: `This view has ${n} look${n === 1 ? '' : 's'}${visits.length > 1 ? `: ${visits.join(', ')}` : ''}.`,
            };
        }
        return {};
    }

    function plainError(e: unknown): string
    {
        const msg = e instanceof Error ? e.message : '';
        // The saved copy is served by this site, so its failures are not the archive's doing.
        if (/saved copy timed out/i.test(msg)) {
            return 'The saved copy on this site took too long to load. Check the connection and try again.';
        }
        if (/snapshot file|saved copy/i.test(msg)) {
            return 'The saved copy on this site could not be loaded. Try again in a minute.';
        }
        if (!msg || /failed to fetch|networkerror|load failed|network/i.test(msg)) {
            return 'The archive did not answer. Check the connection and try again.';
        }
        if (/\b[45]\d\d\b|request failed|http|timed? ?out/i.test(msg)) {
            return 'NASA’s archive is busy or down right now. Try again in a minute.';
        }
        return 'Something went wrong reading the frames. Try again, or pick another spot.';
    }

    function play(on: boolean): void
    {
        window.clearTimeout(timer);
        st.playing = on && !!result && result.frames.length > 1;
        if (on) {
            epochSlot.off(); // the older picture and frame playback are never on together
        }
        if (st.playing) {
            if (st.mode !== 'blink') {
                st.mode = 'blink';
                draw();
            }
            timer = window.setTimeout(tick, frameDelayMs(FPS));
            ref<HTMLElement>('live').textContent = `Playing ${result!.frames.length} frames. Space pauses.`;
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
        // A live view of a target says so, or the link would reopen it from the saved copy (recentred, field capped).
        const live = sourceKind === 'live' && st.target && result ? '&live=1' : '';
        const sub = st.mode === 'diff' && activeVisits() ? `&a=${st.subA}&b=${st.subB}${st.subOp === 'sum' ? '&op=sum' : ''}` : '';
        const extra = `${st.mode !== 'blink' ? `&m=${st.mode}` : ''}${sub}${st.gaia ? '' : '&g=0'}${live}${demoOnly ? '&demo=1' : ''}`;
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
        } else if (b.dataset.subop === 'diff' || b.dataset.subop === 'sum') {
            st.subOp = b.dataset.subop;
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
        } else if (b.dataset.act === 'flags') {
            flagsOn = !flagsOn;
            renderSlots();
        } else if (b.dataset.act === 'falsecolour') {
            fcOn = !fcOn;
            renderSlots();
        } else if (b.dataset.act === 'epoch' || b.dataset.act === 'epoch-tag') {
            if (b.dataset.act === 'epoch') {
                epochSlot.press();
            } else {
                epochSlot.tagPress();
            }
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

    // A dot on a curve (brightness, halo) shows that look in Blink.
    function pickDot(e: Event): void
    {
        const dot = (e.target as Element).closest('[data-k]');
        const k = dot ? Number(dot.getAttribute('data-k')) : NaN;
        if (!result || !Number.isInteger(k) || k < 0 || !result.frames[k]) {
            return;
        }
        st.mode = 'blink';
        play(false);
        st.index = k;
        draw();
        writeUrl();
    }
    ref<SVGSVGElement>('lc').addEventListener('click', pickDot);
    ref<HTMLElement>('haloBox').addEventListener('click', pickDot);

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
    // The visit pickers: B always stays later than A.
    for (const [select, which] of [[subASelect, 'a'], [subBSelect, 'b']] as const) {
        select.addEventListener('change', () => {
            const v = Number(select.value);
            if (!Number.isInteger(v) || v < 0 || v >= visits.length) {
                return;
            }
            if (which === 'a') {
                st.subA = v;
                if (st.subB <= st.subA) {
                    st.subB = st.subA + 1;
                }
            } else {
                st.subB = v;
            }
            draw();
            writeUrl();
        });
    }

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
            // Only numbers, signs and units that parseCoords refused: it reads more than one way ("10 30 20 15").
            // Asked only after the name lookup, since a few real names look like this ("1H 0707-495").
            const numeric = /^[+-]?[\d.]/.test(text) && /^[\d\s.,:;+\-hdms°′″'"]+$/i.test(text);
            toast(numeric
                ? 'Couldn’t find that name or read it as RA and Dec. Write them with a comma between them, like 269.45, 4.69, or with units, like 17h57m +4d41m.'
                : 'Couldn’t find that. Try a star name, or RA and Dec like 269.45, 4.69.');
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

    new ResizeObserver(() => placeSeg()).observe(q<HTMLElement>('.sk-seg'));

    let shared = decodeView(location.search);
    // A link with a preset target but no position (?t=rwaur&lam=1.11) opens that target, at its own position.
    const tParam = params.get('t');
    const preset = !shared && tParam && Object.hasOwn(COPY, tParam) ? targetById(tParam as TargetId) : undefined;
    if (preset) {
        const c = positionAt(preset.astrometry, SKY_EPOCH_MJD);
        const p = new URLSearchParams(location.search);
        p.set('ra', String(c.ra));
        p.set('dec', String(c.dec));
        shared = decodeView(p.toString());
        if (shared && !params.has('det')) {
            shared.detector = preset.detector;
        }
    }
    if (shared) {
        st.center = shared.center;
        // No fov= in the link (?t=barnard): the app's 0.1°, not the URL module's default, so a target opens from the saved copy.
        st.fovDeg = FOVS.includes(Number(params.get('fov') ?? NaN)) && FOVS.includes(shared.fovDeg) ? shared.fovDeg : DEFAULT_FOV;
        st.detector = shared.detector;
        st.lambda = shared.lambda;
        st.target = shared.target;
        st.wantFrame = shared.frame;
        const m = params.get('m');
        st.mode = m === 'stack' || m === 'diff' ? m : 'blink';
        if (st.mode === 'diff' && (params.has('a') || params.has('b') || params.has('op'))) {
            const op = params.get('op');
            st.wantSub = { a: parseVisitPick(params.get('a')), b: parseVisitPick(params.get('b')),
                op: op === 'sum' || op === 'diff' ? op : null };
        }
        st.gaia = params.get('g') !== '0';
        st.live = params.get('live') === '1';
        st.label = shared.target ? COPY[shared.target].display : `${formatRa(shared.center.ra)} ${formatDec(shared.center.dec)}`;
        void load();
    } else {
        setTarget(DEFAULT_TARGET);
    }
}
