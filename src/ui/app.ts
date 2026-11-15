// Slowsky UI shell. Three columns read left to right as three steps:
// 1 pick a target (left), 2 watch it change (the sky, centre), 3 try another colour (right).
// Nothing is drawn over the sky except the data itself and the simulated-sky warning.
// The UI only talks to SkySource.
import './fonts/fonts.css';
import './styles.css';
import './tool.css';
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
import { History, mountTool, type View } from './tool';
import { mountMine } from './mine';
import { gridPixToSky } from '../lib/regrid';
import { coreBlank, curveFor, dotBar, frameMjd, ringsOn, shiftFor, type Curve } from './measure';
import { mountAiNote } from './ai-note';
import { mountAsk } from './ask-panel';
import { AI_LINE, AI_LINK, CONTROL_HELP, GLOSSARY, HELP_INTRO } from './help';
import { helpAltButtonHtml, helpButtonHtml, helpDialogHtml, mountHelp } from './help-view';
import { FEATURES, mountChanges, mountFalseColour, mountFlags, renderHalo, type LayerState } from './slots';
import { mountEpoch } from './epoch-view';
import { mountSpectrum } from './spectrum-view';
import { mountUpTonight } from './uptonight-slot';
import { saveShareCard } from './share-view';
import { releaseCredits } from '../lib/sharecard';
import { mountComet } from './comet-view';
import { mountPlanetX } from './planetx-view';
import { attachGestures } from './gestures';
import { createHoldCompare, HOLD_LINE } from './gesture-hold';
import { COPY, CUSTOM_COPY, DETECTORS, FALSE_COLOUR_HINT, MODE_HINT, ORDER, STAGE_TEXT } from './copy';
import { combineVisits, defaultPicks, subtractText, headerDates, visitGroups, visitImage, visitLabel, visitMonths, type SubOp, type Visit } from './subtract';

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
// Three real SPHEREx cutouts of Groombridge 1830 (IRSA, DR1/QR3), trimmed to the IMAGE and ZODI extensions.
const SAMPLE_FITS = ['20250427_D1_2025W20_2D_0483_3D1.fits', '20251122_D1_2025W48_2A_0523_1D1.fits', '20260503_D1_2026W21_2A_0412_1D1.fits'];
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
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5L4 10l4.5 4.5M4.5 10H15a5 5 0 0 1 0 10h-4"/></svg>',
    redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5.5L20 10l-4.5 4.5M19.5 10H9a5 5 0 0 0 0 10h4"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5V4M7.5 8.5L12 4l4.5 4.5M4 15v5h16v-5"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M7 15h10M7 11.5h6"/></svg>',
    theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>',
    loupe: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="13" height="13" rx="1"/><path d="M16.5 16.5l4 4M10 7v6M7 10h6"/></svg>',
    hold: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="10" height="10" rx="1"/><rect x="10.5" y="9.5" width="10" height="10" rx="1" stroke-dasharray="2.5 2"/></svg>',
    ring: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/></svg>',
    trail: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="18.5" r="1.2" fill="currentColor"/><circle cx="10" cy="14" r="1.2" fill="currentColor"/><circle cx="14.5" cy="9.5" r="1.2" fill="currentColor"/><circle cx="18.5" cy="5.5" r="2.6"/></svg>',
    find: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/><path d="M13.5 7h7M3.5 17h7" stroke-dasharray="2 2"/></svg>',
    gaia: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="4"/><circle cx="17" cy="15.5" r="3"/></svg>',
    flags: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M8 8h3v3H8zM13 13h3v3h-3z" fill="currentColor"/></svg>',
    fc: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="12" r="5.6"/><circle cx="15" cy="12" r="5.6"/></svg>',
    epoch: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2.3"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5M7.5 10.5h6M10.5 7.5v6"/></svg>',
    fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
    inspect: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M15 4v16"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v4.5M12 17.3v.01"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></svg>',
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

export function shell(shareCard = FEATURES.shareCard): string
{
    const targets = ORDER.map((id) => `<button type="button" role="option" data-target="${id}" aria-pressed="false"><span class="ic k">${ICON[COPY[id].kind]}</span><span class="nm"><b>${esc(COPY[id].display)}</b><small>${esc(COPY[id].short)}</small></span></button>`).join('');
    const fovs = FOVS.map((f) => `<option value="${f}">${f}°</option>`).join('');
    const ticks = [0.4, 1, 2, 3, 4, 5].map((t) => `<span style="left:${axisPct(t).toFixed(2)}%">${t}</span>`).join('');
    const tool = (name: string, icon: string, label: string, help: string, extra = '') =>
        `<button type="button" class="tool" data-tool="${name}" ${extra} data-help="${esc(help)}"><span class="ic">${icon}</span><span class="tl">${label}</span></button>`;
    return `
<a class="sk-skip" href="#sk-stage">Skip to the sky</a>
<header class="tb-bar">
  <span class="tb-brand"><span class="sk-word"><i aria-hidden="true"></i>slowsky</span><span class="tb-tag">Watch the sky change</span></span>
  <div class="tb-seg tb-ws" role="tablist" aria-label="Workspace">
    <button type="button" role="tab" data-ws="sky" aria-selected="true" data-help="The saved targets and any spot you search: real SPHEREx pixels from NASA’s archive.">Sky library</button>
    <button type="button" role="tab" data-ws="mine" aria-selected="false" data-help="Your own frames, processed in this browser. They are never uploaded.">My frames <span class="tb-count" data-ref="wsCount"></span></button>
  </div>
  <button type="button" class="tb-target" data-act="picker" aria-haspopup="dialog" aria-controls="tb-picker" data-help="${esc(CONTROL_HELP.target.line)} (⌘K or Ctrl+K)"><span class="ic k" data-ref="targetIcon">${ICON.look}</span><span class="nm" data-bind="name"></span><span class="ic chev">${ICON.chev}</span><kbd>⌘K</kbd></button>
  <span class="tb-gap"></span>
  <div class="tb-hist" role="group" aria-label="History">
    <button type="button" class="tb-icon" data-act="undo" aria-label="Undo" aria-keyshortcuts="Meta+Z Control+Z" data-help="Undo: go back one step, such as a target, view, date or zoom change (⌘Z or Ctrl+Z)." disabled><span class="ic">${ICON.undo}</span></button>
    <button type="button" class="tb-icon" data-act="redo" aria-label="Redo" aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y" data-help="Redo: go forward again (⇧⌘Z or Ctrl+Y)." disabled><span class="ic">${ICON.redo}</span></button>
  </div>
  <div class="tb-seg tb-mode" role="group" aria-label="View"><button type="button" data-mode="blink" data-help="${esc(CONTROL_HELP.blink.line)} (B)">Blink<kbd>B</kbd></button><button type="button" data-mode="stack" data-help="${esc(CONTROL_HELP.stack.line)} (S)">Stack<kbd>S</kbd></button><button type="button" data-mode="diff" data-help="${esc(CONTROL_HELP.subtract.line)} (D)">Subtract<kbd>D</kbd></button></div>
  <button type="button" class="tb-btn sk-golive" data-act="live" data-ref="golive" hidden data-help="Read this target live from NASA’s archive instead of the saved copy (about 30 s)."><i aria-hidden="true"></i>Go live</button>
  <button type="button" class="tb-btn tb-primary tb-upload" data-act="upload" data-help="Add your own FITS, PNG or JPG frames. They stay in this browser."><span class="ic">${ICON.upload}</span><span>Upload</span></button>
  <input type="file" data-ref="file" multiple accept=".fits,.fit,.fts,.gz,.png,.jpg,.jpeg" hidden>
  ${helpButtonHtml()}
  <div class="tb-acts" role="group" aria-label="Labels, link and picture">
    <button type="button" class="tb-icon" data-act="labels" aria-label="Tool labels" aria-pressed="true" data-help="Labels under every tool: on. Press to hide them once you know the tools."><span class="ic">${ICON.tag}</span></button>
    <button type="button" class="tb-icon" data-act="copy" aria-label="Copy link" data-help="Copy a link to this view."><span class="ic">${ICON.link}</span></button>
    ${shareCard ? `<button type="button" class="tb-icon sk-save" data-act="save-picture" aria-label="Save picture: A, B and B − A" data-help="In Subtract: save one picture of A, B and B − A, with the dates and the data credit."><span class="ic">${ICON.file}</span></button>` : ''}
    <button type="button" class="tb-icon" data-act="theme" aria-label="Switch to the light theme" data-help="Dark or light (T)."><span class="ic">${ICON.theme}</span></button>
  </div>
</header>
<main class="tb-work" data-ref="work" aria-label="Workspace">
  <div class="tb-stage" id="sk-stage" tabindex="-1" data-ref="stage">
    <div class="sk-sky" data-ref="sky">
      <div class="tb-zoom" data-ref="zoom">
        <canvas class="sk-glow" data-ref="glow" width="24" height="24" aria-hidden="true"></canvas>
        <canvas class="sk-img" data-ref="canvas" role="img" aria-label="Sky image"></canvas>
        <div class="sk-slot-layer sk-slot-fc" data-ref="fc" hidden></div>
        <div class="sk-slot-layer sk-slot-ep" data-ref="epoch" aria-hidden="true" hidden></div>
        <svg class="sk-ov" data-ref="ov" aria-hidden="true" preserveAspectRatio="none"></svg>
        <div class="sk-slot-flags" data-ref="flags" hidden></div>
        <div class="sk-slot-layer" data-ref="changesMarks" hidden></div>
      </div>
      <div class="sk-bar" data-ref="bar" aria-hidden="true"><b data-bind="bar"></b><i></i></div>
      <div class="sk-sim" data-ref="sim" hidden>Simulated sky · not real data</div>
      <button type="button" class="sk-ep-tag" data-act="epoch-tag" data-ref="epochTag" hidden></button>
      <div class="tb-loupe" data-ref="loupe" hidden><canvas width="150" height="150"></canvas></div>
      <div class="sk-load" data-ref="load" hidden><div class="tb-loadbox"><svg class="tb-orbit" viewBox="0 0 24 24" aria-hidden="true"><circle class="t" cx="12" cy="12" r="8.5"/><circle class="d" cx="12" cy="3.5" r="2"/><circle class="s" cx="12" cy="12" r="2.2"/></svg><p data-bind="stage"></p></div><div class="sk-prog"><i data-ref="prog"></i></div></div>
      <div class="sk-err" data-ref="err" hidden><p data-bind="err" role="alert"></p><button type="button" class="sk-btn2" data-act="retry"><span class="ic">${ICON.retry}</span>Try again</button></div>
    </div>
    <div class="tb-mine" data-ref="mineView" hidden></div>
    <div class="tb-empty" data-ref="empty" hidden>
      <span class="ic big">${ICON.upload}</span>
      <p class="t">Drop frames of the same patch of sky</p>
      <p class="s">FITS (also .gz), PNG or JPG · 2 to 20 files · dates come from FITS headers, or the file date for pictures</p>
      <div class="a"><button type="button" class="tb-btn tb-primary" data-act="upload">Choose files</button><button type="button" class="tb-btn" data-act="samples" data-help="Three real SPHEREx FITS cutouts of Groombridge 1830, a star that drifts quickly across the sky, run through the same steps.">Try real FITS samples</button></div>
      <p class="l"><span class="ic">${ICON.lock}</span>Your files stay in this browser. They are never uploaded.</p>
    </div>
  </div>

  <section class="tb-hud tb-id" aria-label="Current frame">
    <div class="n" data-bind="name"></div>
    <p class="sk-read"><b data-bind="frame"></b><span data-bind="when"></span></p>
    <div class="s" data-bind="statusShort" aria-live="polite">Connecting to the archive</div>
  </section>

  <section class="tb-hud tb-jobs" data-ref="jobs" hidden aria-label="Processing">
    <header><b>Processing</b><span data-ref="jobsCount"></span><button type="button" class="tb-btn sm" data-act="jobs-cancel">Cancel</button></header>
    <ol data-ref="jobsList"></ol>
  </section>

  <nav class="tb-hud tb-tools" aria-label="Tools">
    ${tool('loupe', ICON.loupe, 'Loupe', 'Loupe: magnifies the real pixels under the pointer, 2x (L).', 'aria-pressed="false" aria-keyshortcuts="L"')}
    ${tool('hold', ICON.hold, 'Compare', 'Hold to compare: press and hold to see the first frame; let go to come back (H). Blink only.', 'aria-keyshortcuts="H"')}
    <span class="tool-gap"></span>
    ${tool('ring', ICON.ring, 'Ring', 'Ring: where the target’s catalogue motion puts it on this date (R).', 'aria-pressed="true" aria-keyshortcuts="R"')}
    ${tool('trail', ICON.trail, 'Trail', 'Trail: dots where the ring would be on the other dates.', 'aria-pressed="false"')}
    ${tool('cands', ICON.find, 'Candidates', CONTROL_HELP.changes.line, '')}
    <span class="tool-gap"></span>
    <button type="button" class="tool sk-key" data-act="gaia" aria-pressed="true" data-help="${esc(CONTROL_HELP.gaia.line)}"><span class="ic">${ICON.gaia}</span><span class="tl">Gaia</span></button>
    <button type="button" class="tool sk-key" data-act="flags" data-ref="flagsKey" aria-pressed="false" hidden data-help="${esc(CONTROL_HELP.flags.line)}"><span class="ic">${ICON.flags}</span><span class="tl">Flags</span></button>
    <button type="button" class="tool sk-key" data-act="falsecolour" data-ref="fcKey" aria-pressed="false" hidden data-help="${esc(CONTROL_HELP.falseColour.line)}"><span class="ic">${ICON.fc}</span><span class="tl">False colour</span></button>
    <button type="button" class="tool sk-key" data-act="epoch" data-ref="epochKey" aria-pressed="false" hidden data-help="${esc(CONTROL_HELP.epoch.line)}"><span class="ic">${ICON.epoch}</span><span class="tl">Older picture</span></button>
    <span class="tool-gap"></span>
    ${tool('zoomin', ICON.zoom, 'Zoom', 'Zoom in on the picture (+). Scroll or pinch on the sky also zooms; drag to pan when zoomed.', '')}
    ${tool('fit', ICON.fit, 'Fit', 'Fit the whole picture again (0, or double-click the sky).', '')}
    <span class="tool-gap"></span>
    ${tool('inspect', ICON.inspect, 'Inspect', 'Inspector: the target, this frame, candidates, charts, the AI note and extras (I).', 'aria-pressed="false" aria-keyshortcuts="I"')}
    ${tool('focus', ICON.focus, 'Focus', 'Focus: hide the side cards so the sky has the room (F).', 'aria-pressed="false" aria-keyshortcuts="F"')}
  </nav>

  <section class="tb-hud tb-scale" aria-label="Scale and field">
    <span class="tb-compass" aria-label="North up, east left"><b>N</b>↑ <b>E</b>←</span>
    <span class="tb-lam"><span data-bind="lam"></span> µm</span>
    <label class="sk-fov" data-help="${esc(CONTROL_HELP.field.line)}"><span class="ic">${ICON.field}</span>Field <select data-ref="fov" aria-label="Field of view">${fovs}</select></label>
    <span class="tb-zl" data-ref="zoomLabel" aria-live="off">1×</span>
  </section>

  <section class="tb-hud tb-caveat" aria-label="What this can’t tell you">
    <span class="ic">${ICON.warn}</span><p><span class="sk-sub">What this can’t tell you.</span> <span data-bind="not"></span></p>
  </section>

  <section class="tb-hud tb-map" aria-label="Where in the sky">
    <figure class="sk-fig"><span data-ref="map"></span><figcaption>Where in the sky</figcaption></figure>
  </section>

  <section class="tb-hud tb-coach" data-ref="coach" hidden role="dialog" aria-labelledby="tb-coach-h">
    <p class="k">New here?</p>
    <h2 id="tb-coach-h">What am I looking at?</h2>
    <p data-ref="coachText"></p>
    <div class="a"><button type="button" class="tb-btn tb-primary" data-act="tour">Show me around</button><button type="button" class="tb-btn ghost" data-act="coach-close">Got it</button></div>
  </section>

  <aside class="tb-hud tb-insp" data-ref="insp" hidden aria-label="Inspector">
    <header>
      <div class="tb-tabs" role="tablist" aria-label="Inspector">
        <button type="button" role="tab" data-tab="info" aria-selected="true">Target</button>
        <button type="button" role="tab" data-tab="frame" aria-selected="false">Frame</button>
        <button type="button" role="tab" data-tab="cands" aria-selected="false">Candidates</button>
        <button type="button" role="tab" data-tab="charts" aria-selected="false">Charts</button>
        <button type="button" role="tab" data-tab="ai" aria-selected="false">AI note</button>
        <button type="button" role="tab" data-tab="extras" aria-selected="false">Extras</button>
      </div>
      <button type="button" class="tb-icon sm" data-act="insp-close" aria-label="Close the inspector"><span class="ic">${ICON.close}</span></button>
    </header>
    <div class="tb-panel" data-panel="info" role="tabpanel">
      <section class="sk-mod sk-m-about" aria-labelledby="sk-h4">
        <h2 class="sk-mh" id="sk-h4"><span class="ic">${ICON.look}</span>What to look for</h2>
        <p class="sk-h" data-bind="headline"></p>
        <p class="sk-coord"><span data-bind="name"></span><a class="sk-src" data-ref="coords" target="_blank" rel="noopener"></a></p>
        <div class="sk-figs">
          <figure class="sk-fig" data-ref="pmfig" hidden><span data-ref="pm"></span><figcaption data-bind="pm"></figcaption></figure>
        </div>
        <p class="sk-body sk-up" data-ref="up" hidden></p>
        <p class="sk-body" data-bind="show"></p>
        <p class="sk-body sk-fact" data-ref="fact" hidden><span class="sk-sub">Measured here.</span> <span data-bind="fact"></span></p>
        <p class="sk-body mute"><span class="sk-sub">What this can’t tell you.</span> <span data-bind="not"></span></p>
      </section>
    </div>
    <div class="tb-panel" data-panel="frame" role="tabpanel" hidden>
      <section class="sk-mod sk-m-details" aria-labelledby="sk-h5">
        <h2 class="sk-mh" id="sk-h5"><span class="ic">${ICON.info}</span><span data-bind="dlh">This frame</span></h2>
        <dl data-ref="dl"></dl>
        <ul class="sk-notes" data-ref="notes"></ul>
      </section>
      <p class="sk-gloss sk-gaia-gloss" data-ref="gaiaGloss" hidden>${esc(GLOSSARY.gaia.short)}</p>
      <p class="sk-body"><a class="sk-src" data-ref="gaiaSrc" href="https://www.cosmos.esa.int/web/gaia/dr3" target="_blank" rel="noopener" title="Rings: ESA, Gaia DPAC; Gaia DR3, doi:10.5270/esa-qa4lep3 (CC BY-NC 3.0 IGO)">Gaia DR3</a></p>
      <footer class="sk-credit"><p data-bind="status"></p></footer>
      <div class="tb-minepanel" data-ref="mineNotes"></div>
    </div>
    <div class="tb-panel" data-panel="cands" role="tabpanel" hidden>
      <section class="sk-mod sk-m-slot sk-m-changes" aria-labelledby="sk-h9" data-ref="changes" hidden>
        <h2 class="sk-mh" id="sk-h9"><span class="ic">${ICON.diff}</span>Candidate changes</h2>
        <div data-ref="changesBox"></div>
      </section>
      <div class="tb-minepanel" data-ref="mineCands"></div>
      <p class="sk-body mute" data-ref="candsNone">Candidate changes are listed for a live view in Subtract. Every line is a candidate only, never a discovery.</p>
    </div>
    <div class="tb-panel" data-panel="charts" role="tabpanel" hidden>
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
      <section class="sk-mod sk-m-spec" aria-labelledby="sk-h8" data-ref="spec" hidden>
        <h2 class="sk-mh" id="sk-h8" data-sp="heading"><span class="ic">${ICON.spectrum}</span>Spectrum</h2>
        <div class="sk-sp-body" data-ref="specBox" data-sp="body">
          <p class="sk-body" data-sp="intro"></p>
          <div class="sk-sp-result" data-sp="result" hidden>
            <div class="sk-sp-chart" data-sp="chart"></div>
            <p class="sk-body" data-sp="summary"></p>
            <p class="sk-body" data-sp="reference"></p>
            <p class="sk-body" data-sp="caption"></p>
            <div class="sk-sp-notes" data-sp="notes"></div>
            <p class="sk-body" data-sp="facts"></p>
            <p class="sk-body"><span data-sp="readBytes"></span><a class="sk-sp-link" data-sp="link" target="_blank" rel="noopener"></a><span data-sp="linkEnd"></span></p>
            <p class="sk-body" data-sp="spot"></p>
          </div>
          <p class="sk-body sk-sp-status" data-sp="status" aria-live="polite"></p>
          <div class="sk-sp-actions"><button type="button" class="sk-btn2" data-sp="read"></button><button type="button" class="sk-btn2" data-sp="stop" hidden></button><button type="button" class="sk-btn2" data-sp="clear" hidden></button></div>
          <small class="sk-sp-estimate" data-sp="estimate"></small>
        </div>
      </section>
      <p class="sk-body mute" data-ref="chartsNone">Charts appear here when this view has one: a brightness curve, a halo curve or a spectrum.</p>
    </div>
    <div class="tb-panel" data-panel="ai" role="tabpanel" hidden>
      <section class="sk-mod sk-m-ai" aria-labelledby="sk-h7" data-ref="ai" data-ai-generated="true" hidden>
        <h2 class="sk-mh" id="sk-h7" tabindex="-1"><span class="ic">${ICON.note}</span>AI note<span class="sk-ai-tag" data-ai="tag">AI-generated</span></h2>
        <p class="sk-body mute">A short reading of this view by a language model, from the numbers this page measured.</p>
        <form class="sk-ai-lock" data-ai="lock" hidden><label><span>Passcode</span><input type="password" autocomplete="off" data-ai="pass" aria-label="AI note passcode"></label><button type="submit" class="sk-btn2">Unlock</button></form>
        <button type="button" class="sk-btn2 sk-ai-go" data-ai="go" hidden>Write an AI note</button>
        <p class="sk-ai-msg sk-sr" data-ai="msg" role="status"></p>
        <div class="sk-ai-out" data-ai="out" aria-live="polite"></div>
        <details class="sk-ai-given" data-ai="given" hidden><summary>What this page told the AI</summary><ul data-ai="givenList"></ul></details>
        <p class="sk-ai-disc" data-ai="disc"></p>
        <p class="sk-ai-left" data-ai="left" hidden></p>
      </section>
      <p class="sk-body mute" data-ref="aiNone">The AI note appears here once a view has loaded.</p>
    </div>
    <div class="tb-panel" data-panel="extras" role="tabpanel" hidden>
      <div data-ref="extrasAnchor"></div>
    </div>
  </aside>
  <div class="tb-drop" data-ref="drop" hidden><div><span class="ic big">${ICON.upload}</span><b>Drop to process</b><span>FITS, PNG or JPG · stays in this browser</span></div></div>
</main>

<section class="tb-time sk-ctrl" aria-label="Timeline">
  <div class="tb-transport sk-player">
    <div class="sk-tr">
      <button type="button" class="sk-btn" data-act="prev" aria-label="Previous frame" data-help="Previous frame (←)."><span class="ic">${ICON.prev}</span></button>
      <button type="button" class="sk-btn go" data-act="play" aria-label="Play" data-help="Play or pause the frames in date order (Space)."></button>
      <button type="button" class="sk-btn" data-act="next" aria-label="Next frame" data-help="Next frame (→)."><span class="ic">${ICON.next}</span></button>
    </div>
    <div class="tb-seg tb-speed" role="group" aria-label="Speed"><button type="button" data-speed="0.5" aria-pressed="false" data-help="Half speed.">½×</button><button type="button" data-speed="1" aria-pressed="true" data-help="Normal speed.">1×</button><button type="button" data-speed="2" aria-pressed="false" data-help="Double speed.">2×</button></div>
    <div class="sk-sub tb-ab" data-ref="sub" hidden>
      <label class="sk-fov"><span class="tb-a">A</span><select data-ref="subA" aria-label="Earlier visit (A)"></select></label>
      <label class="sk-fov"><span class="tb-b">B</span><select data-ref="subB" aria-label="Later visit (B)"></select></label>
      <div class="tb-seg sk-seg2" role="group" aria-label="Combine"><button type="button" data-subop="diff" aria-pressed="true" data-help="B − A takes visit A away from visit B, so what stayed the same cancels: orange marks more light later, blue more light earlier.">B − A</button><button type="button" data-subop="sum" aria-pressed="false" data-help="A + B shows visits A and B together (their average), so a moving star shows in both places.">A + B</button></div>
    </div>
  </div>
  <div class="tb-tracks">
    <div class="tb-track">
      <span class="tb-k">Dates</span>
      <div class="sk-strip" data-ref="strip" role="group" aria-label="Frames in date order"></div>
      <div class="sk-strip tb-minestrip" data-ref="mineStrip" role="group" aria-label="Your frames in date order"></div>
    </div>
    <div class="tb-track tb-colour">
      <span class="tb-k" data-help="${esc(CONTROL_HELP.colour.line)}">Colour</span>
      <div class="sk-spec">
        <div class="sk-axis"><i class="vis" style="width:${axisPct(0.7).toFixed(2)}%" title="Visible light"></i>
          <input class="sk-rng" type="range" data-ref="lam" min="${LAM_MIN}" max="${LAM_MAX}" step="0.01" style="left:${axisPct(LAM_MIN).toFixed(2)}%;width:${(100 - axisPct(LAM_MIN)).toFixed(2)}%" data-help="${esc(CONTROL_HELP.colour.line)}" aria-label="Wavelength in micrometres"></div>
        <div class="sk-ticks" aria-hidden="true">${ticks}</div>
        <div class="sk-axl" aria-hidden="true"><span>your eyes</span><span>SPHEREx · µm</span></div>
      </div>
      <div class="sk-readout"><p><b data-bind="lam"></b><small>µm</small></p><span data-bind="det"></span></div>
    </div>
  </div>
  <div class="tb-ab tb-mineab" data-ref="mineAb" hidden>
    <label class="sk-fov"><span class="tb-a">A</span><select data-mine="a" aria-label="Earlier frame (A)"></select></label>
    <label class="sk-fov"><span class="tb-b">B</span><select data-mine="b" aria-label="Later frame (B)"></select></label>
  </div>
  <div class="tb-notes">
    <div class="sk-leg"><span class="sk-key t" data-bind="trackLeg"></span><span class="sk-key d"><i class="b"></i>more light earlier<i class="o"></i>more light later</span></div>
    <p class="sk-flagnote" data-ref="flagsNote" hidden></p>
    <p class="sk-flagnote" data-ref="fcNote" hidden></p>
    <p class="sk-flagnote sk-ep-note" data-ref="epochNote" role="status" hidden></p>
    <p class="sk-gloss sk-epoch-gloss" data-ref="epochGloss" hidden>${esc(GLOSSARY.twomass.short)}</p>
    <p class="sk-hint" data-bind="hint"></p>
    <p class="sk-gest-hint" hidden>Swipe the picture to step through frames. On a later frame, press and hold to compare it with the first.</p>
    <p class="sk-gloss">${esc(GLOSSARY.um.short)} All of this is infrared: your eyes stop at 0.70 µm. Drag the colour, then let go to load it.</p>
  </div>
</section>

<footer class="tb-status">
  <span class="tb-help" data-ref="statusHelp"></span>
  ${helpAltButtonHtml()}
  <button type="button" class="tb-coord" data-ref="coord" data-help="Sky position under the pointer (RA, Dec). Press to copy it.">—</button>
  <button type="button" class="tb-ailink" data-act="about" aria-haspopup="dialog" aria-expanded="false">AI used</button>
  <div class="tb-about" data-ref="about" hidden role="dialog" aria-label="AI used"><p>${esc(AI_LINE)}</p><p>The AI note names the model that wrote it each time. Every claim on this page is listed with its source.</p><a href="${esc(AI_LINK)}" target="_blank" rel="noopener">Source list</a></div>
</footer>

<div class="tb-picker" id="tb-picker" data-ref="picker" hidden role="dialog" aria-modal="true" aria-label="Pick a target">
  <div class="tb-pbox">
    <form class="sk-search" data-ref="search" role="search"><span class="ic">${ICON.search}</span><input name="q" placeholder="Any star, or RA, Dec" autocomplete="off" aria-label="Search the sky: a star name, or RA and Dec"><kbd>Esc</kbd></form>
    <nav class="sk-tg" role="listbox" aria-label="Targets">${targets}</nav>
    <p class="tb-pnote">Press Enter to search the archive for a star name, or RA and Dec like 269.45, 4.69.</p>
  </div>
</div>
<p class="sk-sr" aria-live="polite" data-ref="live"></p>
<div class="sk-toast" data-ref="toast" role="status"></div>${helpDialogHtml()}`;
}

export function mount(root: HTMLElement): void
{
    root.classList.add('sk', 'tb');
    root.innerHTML = shell();
    mountHelp(root);
    const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    const qa = <T extends Element>(sel: string) => [...root.querySelectorAll(sel)] as T[];
    const ref = <T extends Element>(name: string) => q<T>(`[data-ref="${name}"]`);
    let aiNoteRef: ReturnType<typeof mountAiNote> | undefined;
    const ask = mountAsk(ref<HTMLElement>('ai'), { onRequestStart: () => aiNoteRef?.startRequest(), onRequestEnd: () => aiNoteRef?.finishRequest(), onRemaining: (n, request) => aiNoteRef?.setRemaining(n, request), onDailyLimit: (request, current) => aiNoteRef?.exhaustRemaining(request, current), onChargeUnknown: (request, sent) => aiNoteRef?.recheckRemaining(request, sent), onLocked: (request) => aiNoteRef?.relock(request) });
    const aiNote = mountAiNote(ref<HTMLElement>('ai'), { onState: (s) => ask.sync(s) });
    aiNoteRef = aiNote;
    const flagLayer = mountFlags(ref<HTMLElement>('flags'), () => renderSlots());
    const changesSlot = mountChanges(() => renderSlots());
    const spectrumSlot = mountSpectrum(ref<HTMLElement>('spec'), { enabled: FEATURES.spectrum });
    const upSlot = mountUpTonight(ref<HTMLElement>('up'), { enabled: FEATURES.upTonight });
    // Comet card (FEATURES.comet): off adds nothing to the page and fetches nothing.
    const comet = mountComet(ref<HTMLElement>('extrasAnchor'), { enabled: FEATURES.comet });
    // Planet Nine chart (FEATURES.planetx): under the comet card in the Extras tab.
    mountPlanetX(comet.section ?? ref<HTMLElement>('extrasAnchor'), { enabled: FEATURES.planetx });
    const fcLayer = mountFalseColour(ref<HTMLElement>('fc'), () => renderText());
    // Older picture (2MASS): off unless FEATURES.epoch; Play, False colour and Flagged pixels switch it off.
    const epochSlot = mountEpoch({ key: ref<HTMLButtonElement>('epochKey'), layer: ref<HTMLElement>('epoch'), tag: ref<HTMLButtonElement>('epochTag'),
        note: ref<HTMLElement>('epochNote'), gloss: ref<HTMLElement>('epochGloss'), thenHides: [ref<HTMLElement>('flags'), ref<HTMLElement>('changesMarks')] },
        { enabled: FEATURES.epoch, pause: () => play(false), hasWiderField: (fov) => mountEpoch.hasWiderField(fov, st.fovDeg) });
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
            if (!ref<HTMLElement>('fcNote').contains(d)) {
                d.open = !narrow.matches;
            }
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
    let speed = 1; // playback speed: ½×, 1× or 2×
    let savingPicture = false;
    let ctrl: AbortController | null = null;
    let lamDraft: number | null = null;
    let flagsOn = false; // the Flags layer over the sky
    let fcOn = false; // the False colour key is pressed (the layer shows in Stack on a live view)
    let fcState: LayerState = { key: false, layer: false, note: '' };
    let fcFailure: { result: SkyResult; mode: Mode; source: SourceKind; note: string } | null = null;
    let lookup: AbortController | null = null; // pending name lookup; any newer navigation cancels it
    let holdCompare: ReturnType<typeof createHoldCompare> | null = null;

    // ---------- undo and redo: view steps (target, view, dates, visits, zoom, layers) ----------
    interface Snap {
        target?: TargetId;
        center: SkyCoord;
        label: string;
        fovDeg: number;
        detector: Detector;
        lambda?: number;
        live: boolean;
        mode: Mode;
        index: number;
        subA: number;
        subB: number;
        subOp: SubOp;
        gaia: boolean;
        frame?: string;
        view: View;
        ring: boolean;
        trail: boolean;
        loupe: boolean;
    }
    const steps = new History<Snap>();
    let applying = false;
    let amendNext = false;
    function snap(): Snap
    {
        return { target: st.target, center: st.center, label: st.label, fovDeg: st.fovDeg, detector: st.detector, lambda: st.lambda,
            live: st.live, mode: st.mode, index: st.index, subA: st.subA, subB: st.subB, subOp: st.subOp, gaia: st.gaia,
            frame: view(true).frame, view: tool.view, ring: tool.ring, trail: tool.trail, loupe: tool.loupe };
    }
    function syncHistory(): void
    {
        tool.setHistory(steps.canUndo, steps.canRedo);
    }
    function record(): void
    {
        if (applying || st.playing) {
            return;
        }
        if (amendNext) {
            steps.amend(snap());
            amendNext = !!root.dataset.loading;
        } else {
            steps.record(snap());
        }
        syncHistory();
    }
    function applySnap(s: Snap | undefined): void
    {
        if (!s) {
            return;
        }
        applying = true;
        try {
            holdCompare?.cancel();
            play(false);
            tool.setView(s.view, true);
            tool.setLayers(s.ring, s.trail, s.loupe);
            st.gaia = s.gaia;
            st.mode = s.mode;
            st.subOp = s.subOp;
            const same = s.target === st.target && s.center.ra === st.center.ra && s.center.dec === st.center.dec && s.fovDeg === st.fovDeg
                && s.detector === st.detector && s.lambda === st.lambda && s.live === st.live;
            if (!same || !result) {
                st.target = s.target;
                st.center = s.center;
                st.label = s.label;
                st.fovDeg = s.fovDeg;
                st.detector = s.detector;
                st.lambda = s.lambda;
                st.live = s.live;
                st.wantFrame = s.mode === 'blink' ? s.frame : undefined;
                st.wantSub = s.mode === 'diff' ? { a: s.subA, b: s.subB, op: s.subOp } : undefined;
                swapText();
                void load();
            } else {
                st.index = Math.min(s.index, result.frames.length - 1);
                st.subA = s.subA;
                st.subB = s.subB;
                draw();
                history.replaceState(null, '', linkFor(!st.playing));
            }
        } finally {
            applying = false;
        }
        syncHistory();
    }
    const tool = mountTool(root, {
        isLoading: () => !!root.dataset.loading,
        onView: () => record(),
        onLayers: () => {
            overlay();
            record();
        },
        loupeOn: () => record(),
        holdStart: () => holdCompare?.start(),
        holdEnd: () => holdCompare?.end(),
        canHold: () => !!(holdCompare && result && result.frames.length >= 2 && st.mode === 'blink' && st.index > 0),
        coordAt: (fx, fy) => {
            if (!result) {
                return null;
            }
            const g = result.grid;
            const c = gridPixToSky(g, { x: fx * g.width - 0.5, y: fy * g.height - 0.5 });
            return `${formatRa(c.ra)} ${formatDec(c.dec)}`;
        },
        undo: () => applySnap(steps.undo()),
        redo: () => applySnap(steps.redo()),
        setWs: (ws) => setWs(ws),
        files: (list) => addFiles([...list]),
        coachText: () => HELP_INTRO,
    });

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
        if (!applying) {
            steps.record(snap());
        }
        amendNext = true; // the finished load fills in this step (frame, visits) instead of adding one
        syncHistory();
        ctrl?.abort();
        ctrl = new AbortController();
        const signal = ctrl.signal;
        holdCompare?.cancel();
        play(false);
        // Drop the previous view so nothing (play, strip, details) acts on frames of another spot.
        result = null;
        // The change list stops reading error maps and flags for that view, so they do not run beside the new load.
        changesSlot.stop();
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
        if (FEATURES.shareCard) {
            q<HTMLButtonElement>('[data-act="save-picture"]').disabled = true;
        }
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
            holdCompare?.cancel();
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
        const seg = q<HTMLElement>('.tb-mode');
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
        if (track && track.length && frames.length && tool.trail && (kind === 'mover' || kind === 'spectrum')) {
            // Trail: where the ring would be on every other date, as small dots.
            const here = st.mode === 'blink' ? at(st.index) : undefined;
            for (const p of new Set(frames.map((_, k) => at(k)))) {
                if (p && p !== here) {
                    parts.push(`<circle cx="${(p.pix.x + 0.5).toFixed(2)}" cy="${(p.pix.y + 0.5).toFixed(2)}" r="${Math.max(0.9, scale * 0.3).toFixed(2)}" class="trail"/>`);
                }
            }
        }
        if (track && track.length && frames.length && tool.ring) {
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
    function renderSlots(refreshText = false): void
    {
        if (refreshText) {
            renderText();
            return;
        }
        const view = result ? { result, targetId: st.target, index: st.index, mode: st.mode, source: sourceKind } : null;
        // The centre of the picture on screen: a saved copy of a target is centred on the target, whatever position the link named.
        spectrumSlot.update({ center: result?.grid.center ?? st.center, lambda: result?.locked[st.index]?.lambda, source: sourceKind, available: !!view });
        const changes = !!(FEATURES.changes && view && changesSlot.render(ref<HTMLElement>('changesBox'), ref<HTMLElement>('changesMarks'), view));
        ref<HTMLElement>('changes').hidden = !changes;
        ref<HTMLElement>('changesMarks').hidden = !changes;
        ref<HTMLElement>('halo').hidden = !(FEATURES.halo && view && renderHalo(ref<HTMLElement>('haloBox'), view));
        if (fcFailure && (!view || fcFailure.result !== view.result || fcFailure.mode !== view.mode || fcFailure.source !== view.source)) {
            fcFailure = null;
        }
        fcState = fcLayer.update(view, fcOn);
        if (fcState.failed && view) {
            fcOn = false;
            fcFailure = { result: view.result, mode: view.mode, source: view.source, note: fcState.note };
            fcLayer.update(view, false);
        } else if (!fcOn && fcFailure) {
            fcState = { ...fcState, note: fcFailure.note };
        }
        layerSlot(fcState, fcOn, 'fcKey', 'fc', 'fcNote');
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
        // A long note is split: the lead stays in view; the rest folds away (False colour at every width, others on narrow screens).
        const split = fs.split && fs.split.lead && fs.split.more ? fs.split : undefined;
        const want = split ? `${split.lead}\u0000${split.more}` : fs.note;
        if (note.dataset.shown !== want) {
            note.dataset.shown = want;
            if (split) {
                note.replaceChildren(split.lead, ' ');
                const more = document.createElement('details');
                more.className = 'sk-more';
                more.open = noteRef !== 'fcNote' && !narrow.matches;
                const sum = document.createElement('summary');
                // The label names what is folded away, so a reader who sees a coloured rim knows where it is explained.
                sum.textContent = noteRef === 'fcNote' ? 'How to read this colour: scale, bright stars, rims, speckle' : 'How to read this colour';
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
        const icon = ref<HTMLElement>('targetIcon');
        const kindIcon = st.target ? ICON[COPY[st.target].kind] : ICON.look;
        if (icon.innerHTML !== kindIcon) {
            icon.innerHTML = kindIcon;
        }
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
        upSlot.update(st.center);
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
        bind('hint', fcState.layer ? FALSE_COLOUR_HINT : st.mode === 'diff' && pair ? subtractText(pair.a, pair.b, st.subOp) : MODE_HINT[st.mode]);
        subBox.hidden = !(st.mode === 'diff' && pair !== null);
        if (FEATURES.shareCard) {
            q<HTMLButtonElement>('[data-act="save-picture"]').disabled = !pair || !result || !!root.dataset.loading || savingPicture;
        }
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
        ref<HTMLElement>('gaiaGloss').hidden = gaiaBtn.hidden;
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
        const colourPicture = fcState.layer ? fcState.picture : undefined;
        const colourTimes = colourPicture?.flatMap(band => band.times.flat());
        const colourDates = colourTimes?.length && colourTimes.every(Number.isFinite)
            ? [Math.min(...colourTimes), Math.max(...colourTimes)] : undefined;
        if (st.mode === 'blink' && f) {
            bind('frame', `Frame ${st.index + 1} of ${n}`);
            bind('when', niceDate(f.frame.frame.tMin));
        } else if (st.mode === 'stack' && first && last) {
            bind('frame', colourPicture ? 'False colour' : `Average of ${n}`);
            bind('when', colourPicture ? colourDates ? `${monthYear(colourDates[0]!)} – ${monthYear(colourDates[1]!)}` : 'Dates unavailable'
                : `${monthYear(first.tMin)} – ${monthYear(last.tMin)}`);
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
        bind('dlh', !colourPicture && (st.mode === 'blink' || n < 2) ? 'This frame' : 'These frames');

        const extraNotes: string[] = [];
        if (cored) {
            extraNotes.push('The white core is a star too bright for the camera there: SPHEREx records no value for those pixels.');
        }
        if (f && lf) {
            // Blink describes the frame on screen; Stack and Subtract describe the frames they combine.
            const diffPair = st.mode === 'diff' ? pair : null;
            const many = !!colourPicture || (st.mode !== 'blink' && (diffPair !== null || n > 1));
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
                ? colourPicture ? 'False colour from 2 wavelengths' : `Average of all ${n} frames`
                : diffPair
                    ? (st.subOp === 'sum' ? 'Visit A plus visit B' : 'Visit B minus visit A')
                    : `Frame ${n} minus frame 1`;
            const takenText = st.mode === 'stack'
                ? colourPicture ? colourDates ? `${niceDate(colourDates[0]!)} to ${niceDate(colourDates[1]!)}` : 'Dates unavailable'
                    : `${niceDate(first!.tMin)} to ${niceDate(last!.tMin)}`
                : diffPair && firstA && firstB
                    ? (st.subOp === 'sum' ? `${utc(firstA.tMin)} + ${utc(firstB.tMin)}` : `${utc(firstB.tMin)} − ${utc(firstA.tMin)}`)
                    : `${utc(last!.tMin)} − ${utc(first!.tMin)}`;
            const rows: [string, string][] = many
                ? [
                    ['Shows', showsText],
                    ['Taken', takenText],
                    ['Colour', colourPicture ? colourPicture.map(band => `${band.lambda.toFixed(2)} µm`).join(' and ')
                        : lams.length ? `${Math.min(...lams).toFixed(3)} to ${Math.max(...lams).toFixed(3)} µm` : '—'],
                ]
                : [
                    ['Taken', utc(rec.tMin)],
                    ['Frame', `${st.index + 1} of ${n}`],
                    ['Colour here', `${lf.lambda.toFixed(3)} µm (${lf.dLambda >= 0 ? '+' : '−'}${Math.abs(lf.dLambda).toFixed(3)})`],
                ];
            // Stack and Subtract can mix detectors or releases (e.g. QR3 and DR1), so list every one they use.
            if (colourPicture) {
                // Frames used in the picture; "of N" when some were left out, so the row agrees with the Files row below.
                rows.push(['Frames', colourPicture.map(band => `${band.used}${band.leftOut ? ` of ${band.used + band.leftOut}` : ''} at ${band.lambda.toFixed(2)} µm`).join(', ')]);
            }
            const fileRecs = shown.map((i) => result!.frames[i]!.frame.frame);
            // With the colour picture: the files listed below (used or left out) and the partner wavelength's frames.
            const recs = colourPicture ? [...new Set([...fileRecs, ...colourPicture.flatMap(band => band.records)])] : fileRecs;
            const relRecs = recs.filter((r, i) => recs.findIndex((o) => o.collection === r.collection) === i);
            const dets = [...new Set(recs.map((r) => r.detector))].sort((a, b) => a - b);
            rows.push(
                ['Detector', dets.map((d) => `D${d}`).join(', ')],
                ['Release', relRecs.map((r) => r.collection).join(', ')],
                ['Field', `${Number(result.grid.fovDeg.toFixed(3))}° · ${result.grid.width} × ${result.grid.height} px`],
                ['Scale', `${result.grid.pixelArcsec.toFixed(2)}″ per pixel`],
            );
            const firstRec = fileRecs[0]!;
            const lastRec = fileRecs[fileRecs.length - 1]!;
            // The Files and Open rows list the frames of the wavelength on screen only; say which one that is.
            const fileBand = colourPicture?.find(band => band.records.some(record => fileRecs.includes(record)))
                ?? colourPicture?.reduce((a, b) => (Math.abs(b.lambda - result!.lambda) < Math.abs(a.lambda - result!.lambda) ? b : a));
            // Said inside the value, on its own line: a longer label would squeeze every value in the box.
            const only = fileBand ? `<span class="sk-only">${fileBand.lambda.toFixed(2)} µm only</span>` : '';
            if (!many) {
                rows.push(['File', rec.obsId]);
            } else if (diffPair) {
                rows.push(['Files', `${recs.length} files: ${firstRec.obsId} to ${lastRec.obsId}`]);
            } else if (st.mode === 'diff') {
                rows.push(['Files', `${last!.obsId} − ${first!.obsId}`]);
            } else {
                rows.push(n === 1 ? ['File', first!.obsId] : ['Files', `${n}, ${first!.obsId} to ${last!.obsId}`]);
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
                return `<dt>${k}</dt><dd>${k === 'File' || k === 'Files' ? only : ''}${val}</dd>`;
            }).join('');
            const links: string[] = [];
            // One file on screen (Blink, or False colour over a single frame) gets one link, not "first" and "last".
            const oneFile = !many || fileRecs.length === 1;
            if (!oneFile) {
                for (const [r, label] of [[firstRec, 'first'], [lastRec, 'last']] as const) {
                    if (r.url) {
                        links.push(`<a href="${esc(r.url)}" rel="noopener" target="_blank"><span class="ic">${ICON.file}</span>FITS, ${label}</a>`);
                    }
                }
            } else if (rec.url) {
                links.push(`<a href="${esc(rec.url)}" rel="noopener" target="_blank"><span class="ic">${ICON.file}</span>FITS file</a>`);
            }
            if (rec.irsaUrl && oneFile) {
                links.push(`<a href="${esc(rec.irsaUrl)}" rel="noopener" target="_blank"><span class="ic">${ICON.out}</span>IRSA</a>`);
            }
            if (links.length) {
                html += `<dt>Open</dt><dd>${only}${links.join(' · ')}</dd>`;
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
        const skyColour = colourPicture ? colourPicture.map(band => `${band.lambda.toFixed(2)} µm`).join(' and ') : `${lam.toFixed(2)} µm`;
        canvas.setAttribute('aria-label', `Sky image. ${nowShowing}, ${skyColour}`);
        mineText();
    }

    // ---------- playback ----------

    function tick(): void
    {
        if (!result) {
            return;
        }
        holdCompare?.cancel();
        st.index = stepIndex(st.index, result.frames.length, 1);
        draw();
        timer = window.setTimeout(tick, frameDelayMs(FPS * speed));
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
            const visits = visitGroups(result).map((v) => `${v.n} in ${visitMonths(v)}`);
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
            holdCompare?.cancel();
            epochSlot.off(); // the older picture and frame playback are never on together
        }
        if (st.playing) {
            if (st.mode !== 'blink') {
                st.mode = 'blink';
                draw();
            }
            timer = window.setTimeout(tick, frameDelayMs(FPS * speed));
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
        holdCompare?.cancel();
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
        const f = result?.frames[holdCompare?.heldIndex() ?? st.index];
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
        record();
    }

    // ---------- My frames: the visitor's own files, processed in this browser ----------
    const mine = mountMine({ view: ref<HTMLElement>('mineView'), jobs: ref<HTMLElement>('jobs'), jobsList: ref<HTMLElement>('jobsList'),
        jobsCount: ref<HTMLElement>('jobsCount'), cands: ref<HTMLElement>('mineCands'), notes: ref<HTMLElement>('mineNotes'),
        ab: ref<HTMLElement>('mineAb'), strip: ref<HTMLElement>('mineStrip'), count: ref<HTMLElement>('wsCount') },
        { toast, onChange: () => mineText() });
    let mineMode: Mode = 'blink';
    let mineTimer = 0;
    const inMine = () => root.dataset.ws === 'mine';

    function setWs(ws: 'sky' | 'mine'): void
    {
        tool.setWs(ws);
        const on = ws === 'mine';
        if (on) {
            play(false);
            holdCompare?.cancel();
            minePlay(false);
            mine.draw(mineMode);
            mineText();
        } else {
            minePlay(false);
            renderText();
        }
        syncMine();
    }

    // Tools that read the Sky library's archive data do nothing on the visitor's own frames.
    const SKY_ONLY = '[data-tool="ring"], [data-tool="trail"], [data-tool="loupe"], [data-tool="hold"], [data-tool="zoomin"], [data-tool="fit"], [data-act="gaia"], [data-act="flags"], [data-act="falsecolour"], [data-act="epoch"]';
    function syncMine(): void
    {
        const on = inMine();
        for (const b of qa<HTMLButtonElement>(SKY_ONLY)) {
            b.disabled = on;
        }
        const has = !!mine.session;
        ref<HTMLElement>('empty').hidden = !on || has;
        ref<HTMLElement>('mineView').hidden = !on || !has;
        ref<HTMLElement>('sky').hidden = on;
        ref<HTMLElement>('stage').classList.toggle('tb-is-empty', on && !has);
    }

    function mineText(): void
    {
        if (!inMine()) {
            return;
        }
        syncMine();
        const t = mine.frameText();
        bind('name', mine.label());
        bind('frame', t.frame);
        bind('when', t.when);
        bind('statusShort', 'Processed in this browser');
        for (const b of qa<HTMLButtonElement>('[data-mode]')) {
            b.setAttribute('aria-pressed', String(b.dataset.mode === mineMode));
        }
        q<HTMLButtonElement>('[data-act="play"]').innerHTML = mineTimer ? ICON.pause : ICON.play;
        q<HTMLButtonElement>('[data-act="play"]').setAttribute('aria-label', mineTimer ? 'Pause' : 'Play');
    }

    function minePlay(on: boolean): void
    {
        window.clearTimeout(mineTimer);
        mineTimer = 0;
        if (on && mine.session && mine.session.frames.length > 1) {
            mineMode = 'blink';
            const tickMine = () => {
                mine.step(1);
                mineTimer = window.setTimeout(tickMine, frameDelayMs(FPS * speed));
            };
            mineTimer = window.setTimeout(tickMine, frameDelayMs(FPS * speed));
        }
        mineText();
    }

    // Clicks that mean something else while My frames is showing. True when handled here.
    function mineClick(b: HTMLButtonElement): boolean
    {
        if (b.dataset.mode) {
            minePlay(false);
            mineMode = b.dataset.mode as Mode;
            mine.draw(mineMode);
            mineText();
            return true;
        }
        if (b.dataset.mk !== undefined) {
            minePlay(false);
            mineMode = 'blink';
            mine.pick(Number(b.dataset.mk));
            return true;
        }
        if (b.dataset.act === 'play') {
            minePlay(!mineTimer);
            return true;
        }
        if (b.dataset.act === 'prev' || b.dataset.act === 'next') {
            minePlay(false);
            mineMode = 'blink';
            mine.step(b.dataset.act === 'next' ? 1 : -1);
            return true;
        }
        if (b.dataset.act === 'jobs-cancel') {
            mine.cancel();
            return true;
        }
        if (b.dataset.act === 'samples') {
            void loadSamples();
            return true;
        }
        if (b.dataset.act === 'save-picture') {
            toast('Save picture works on the Sky library targets.');
            return true;
        }
        return false;
    }

    function addFiles(files: File[]): void
    {
        setWs('mine');
        mine.add(files);
    }

    async function loadSamples(): Promise<void>
    {
        try {
            const files = await Promise.all(SAMPLE_FITS.map(async (name) => {
                const res = await fetch(`/samples/${name}`);
                if (!res.ok) {
                    throw new Error(String(res.status));
                }
                return new File([await res.blob()], name, { type: 'application/fits' });
            }));
            addFiles(files);
        } catch {
            toast('Couldn’t load the sample files. Try again in a moment.');
        }
    }

    // ---------- events ----------

    root.addEventListener('click', (e) => {
        holdCompare?.end();
        const b = (e.target as Element).closest('button');
        if (!b || !root.contains(b)) {
            return;
        }
        if ((inMine() || b.dataset.act === 'samples') && mineClick(b)) {
            return;
        }
        if (b.dataset.target) {
            setWs('sky');
            setTarget(b.dataset.target as TargetId);
        } else if (b.dataset.speed) {
            speed = Number(b.dataset.speed) || 1;
            qa<HTMLButtonElement>('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
            if (st.playing) {
                window.clearTimeout(timer);
                timer = window.setTimeout(tick, frameDelayMs(FPS * speed));
            }
        } else if (b.dataset.mode) {
            holdCompare?.cancel();
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
            holdCompare?.cancel();
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
            if (FEATURES.epoch) {
                epochSlot.off();
            }
            flagsOn = !flagsOn;
            fcOn = false;
            fcFailure = null;
            renderSlots(true);
        } else if (b.dataset.act === 'falsecolour') {
            if (FEATURES.epoch) {
                epochSlot.off();
            }
            fcFailure = null;
            fcOn = !fcOn;
            renderSlots(true);
        } else if (b.dataset.act === 'epoch' || b.dataset.act === 'epoch-tag') {
            if (b.dataset.act === 'epoch') {
                if (FEATURES.epoch && epochSlot.canRead && (fcOn || flagsOn || fcFailure)) {
                    fcOn = false;
                    flagsOn = false;
                    fcFailure = null;
                    renderSlots(true);
                }
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
        } else if (b.dataset.act === 'save-picture' && FEATURES.shareCard && !savingPicture && !root.dataset.loading) {
            const pair = activeVisits();
            if (pair && result && stretch && st.mode === 'diff') {
                const url = new URL(linkFor(false));
                url.searchParams.delete('op');
                const name = st.target ? COPY[st.target].display : st.label;
                const slug = name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'position';
                const date = (mjd: number) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);
                const records = [...pair.a.ks, ...pair.b.ks].map(k => result!.frames[k]!.frame.frame);
                const releases = releaseCredits(records.map(r => RELEASE_DOI[r.release]?.cite ?? r.collection));
                // Everything that can throw is built before the lock is taken, so the button cannot stay stuck.
                const card = { name, position: st.center, labelA: visitLabel(pair.a), labelB: visitLabel(pair.b), averaged: pair.a.n > 1 || pair.b.n > 1, releases, wavelength: result.lambda,
                    field: result.grid.fovDeg, rings: false, url: url.toString(), simulated: sourceKind === 'demo' };
                const filename = `slowsky-${slug}-${date(pair.a.mjd)}-${date(pair.b.mjd)}.png`;
                savingPicture = true;
                b.disabled = true;
                void saveShareCard({ result, a: pair.a, b: pair.b, stretch, card, filename }, toast).finally(() => {
                    savingPicture = false;
                    b.disabled = !!root.dataset.loading || !activeVisits() || !result;
                });
            }
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
        holdCompare?.cancel();
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

    document.addEventListener('keydown', (e) => {
        holdCompare?.end();
        // The guide is a modal dialog: the page's own shortcuts must not act behind it.
        if (root.querySelector('dialog[open]')) {
            return;
        }
        const el = e.target as HTMLElement;
        if (el.closest?.('input, textarea, select, [contenteditable], [role=separator]') || e.metaKey || e.ctrlKey || e.altKey) {
            return;
        }
        if (inMine()) {
            if (e.key === ' ' && !el.closest?.('button, summary, a, label')) {
                e.preventDefault();
                minePlay(!mineTimer);
            } else if (e.key === 'ArrowRight' || e.key === ']' || e.key === 'ArrowLeft' || e.key === '[') {
                minePlay(false);
                mineMode = 'blink';
                mine.step(e.key === 'ArrowRight' || e.key === ']' ? 1 : -1);
            }
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

    if (FEATURES.gestures) {
        const sky = ref<HTMLElement>('sky');
        const live = ref<HTMLElement>('live');
        const loadEl = ref<HTMLElement>('load');
        const errEl = ref<HTMLElement>('err');
        const epochEl = ref<HTMLElement>('epoch');
        const vv = window.visualViewport;
        const zoomed = (): boolean => !!vv && vv.scale > 1.01;
        const hold = createHoldCompare({
            // False colour and the older picture cover the frame, so a hold there would change nothing a visitor can see.
            canHold: () => !!(result && stretch && result.frames.length >= 2 && st.mode === 'blink' && !fcState.layer
                && !epochSlot.on && epochEl.hidden && loadEl.hidden && errEl.hidden),
            token: () => result,
            index: () => st.index,
            put: (index) => { st.index = index; },
            show: (index) => {
                st.index = index;
                draw();
            },
            pause: () => play(false),
            say: (text) => {
                if (text || live.textContent === HOLD_LINE) {
                    live.textContent = text;
                }
            },
        });
        holdCompare = hold;
        attachGestures(sky, {
            prev: () => step(-1),
            next: () => step(1),
            holdStart: () => hold.start(),
            holdEnd: () => hold.end(),
        }, {
            touchAction: 'pan-y pinch-zoom',
            ignore: (event) => zoomed() || (event instanceof Event && event.target instanceof Element
                && !!event.target.closest('button, a, input, select, textarea, label, summary, [role="button"], [role="separator"], [role="slider"]')),
        });
        const syncTouchAction = (): void => {
            sky.style.touchAction = zoomed() ? 'auto' : 'pan-y pinch-zoom';
        };
        syncTouchAction();
        vv?.addEventListener('resize', syncTouchAction);
        sky.classList.add('sk-gest');
        if (matchMedia('(pointer: coarse)').matches) {
            q<HTMLElement>('.sk-gest-hint').hidden = false;
        }
    }

    new ResizeObserver(() => placeSeg()).observe(q<HTMLElement>('.tb-mode'));

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
