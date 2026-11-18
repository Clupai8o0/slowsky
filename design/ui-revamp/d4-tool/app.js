// Slowsky d4 tool mockup: workspace, timeline, colour track, HUD, inspector and upload wiring.
// Plain browser script (works from file://, no modules, no network).

(function ()
{
    'use strict';

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTH_INDEX = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const COACH_KEY = 'slowsky-d4-coach';
    const EPOCH_2026 = Date.UTC(2026, 0, 1);
    const YEAR_MS = 365.25 * 86400000;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---------- DOM references ----------
    const $ = (id) => document.getElementById(id);

    const wsSkyBtn = $('ws-sky');
    const wsMineBtn = $('ws-mine');
    const wsCountEl = $('ws-count');
    const targetBtn = $('target-btn');
    const targetThumbEl = $('target-thumb');
    const targetNameEl = $('target-name');
    const modeGroup = $('mode');
    const uploadBtn = $('upload-btn');
    const undoBtn = $('undo-btn');
    const redoBtn = $('redo-btn');
    const guideBtn = $('guide-btn');
    const saveBtn = $('save-btn');
    const fileInput = $('file-input');
    const helpBtn = $('help-btn');
    const shareBtn = $('share-btn');

    const workEl = $('work');
    const stageEl = $('stage');
    const skyEl = $('sky');
    const overlayEl = $('overlay');
    const trailEl = $('trail');
    const candsEl = $('cands');
    const ringEl = $('ring');
    const loupeEl = $('loupe');
    const emptyEl = $('empty');
    const emptyChooseBtn = $('empty-choose');
    const emptySampleBtn = $('empty-sample');

    const hudIdEl = $('hud-id');
    const hudNameEl = $('hud-name');
    const hudDateEl = $('hud-date');
    const hudVisitEl = $('hud-visit');
    const hudSrcEl = $('hud-src');

    const jobsEl = $('jobs');
    const jobsCountEl = $('jobs-count');
    const jobsCancelBtn = $('jobs-cancel');
    const jobsListEl = $('jobs-list');

    const toolsEl = $('tools');
    const zoomLabelEl = $('zoom-label');

    const hudScaleEl = $('hud-scale');
    const compassEl = hudScaleEl.querySelector('.compass');
    const scaleBarEl = $('scale-bar');
    const scaleLabelEl = $('scale-label');
    const hudLamEl = $('hud-lam');

    const caveatEl = $('caveat');
    const caveatTextEl = $('caveat-text');
    const minimapEl = $('minimap');
    const mmPlotEl = $('mm-plot');

    const coachEl = $('coach');
    const coachTitleEl = $('coach-title');
    const coachIntroEl = $('coach-intro');
    const coachTourBtn = $('coach-tour');
    const coachCloseBtn = $('coach-close');

    const inspectorEl = $('inspector');
    const inspectorCloseBtn = $('inspector-close');
    const tabInfoEl = $('tab-info');
    const tabFrameEl = $('tab-frame');
    const tabCandsEl = $('tab-cands');
    const tabAiEl = $('tab-ai');
    const tabChartsEl = $('tab-charts');
    const tabExtrasEl = $('tab-extras');

    const dropEl = $('drop');
    const toastEl = $('toast');

    const timelineEl = $('timeline');
    const prevBtn = $('prev');
    const playBtn = $('play');
    const nextBtn = $('next');
    const speedGroup = $('speed');
    const abEl = $('ab');
    const abAEl = $('ab-a');
    const abBEl = $('ab-b');
    const subopEl = $('subop');
    const stageLoadEl = $('stage-load');
    const stageLoadTextEl = $('stage-load-text');
    const fieldSelectEl = $('field-select');
    const layerNoteEl = $('layer-note');
    const announceEl = $('announce');

    const datesLaneEl = $('dates-lane');
    const datesThumbsEl = $('dates-thumbs');
    const datesAxisEl = $('dates-axis');
    const playheadEl = $('playhead');
    const peekEl = $('peek');
    const peekImgEl = peekEl.querySelector('img');
    const peekSpanEl = peekEl.querySelector('span');

    const trackColourEl = $('track-colour');
    const colourLaneEl = $('colour-lane');
    const colourBandsEl = $('colour-bands');
    const colourThumbEl = $('colour-thumb');
    const colourReadoutEl = $('colour-readout');

    const statusHelpEl = $('status-help');
    const statusLoadEl = $('status-load');
    const statusStageEl = $('status-stage');
    const statusCoordEl = $('status-coord');
    const statusAiBtn = $('status-ai');
    const aboutEl = $('about');

    const pickerEl = $('picker');
    const pickerInputEl = $('picker-input');
    const pickerListEl = $('picker-list');

    const tipEl = $('tip');
    const glossEl = $('gloss');

    // Dedicated canvas for SlowskyEngine rendering inside #sky (below #overlay)
    const engineCanvas = document.createElement('canvas');
    engineCanvas.className = 'engine-view';
    engineCanvas.hidden = true;
    skyEl.insertBefore(engineCanvas, overlayEl);
    const engineCtx = engineCanvas.getContext('2d');

    // Dedicated 2x pixel loupe canvas inside #loupe (75x75 source px -> 150x150 CSS px)
    const loupeCanvas = document.createElement('canvas');
    loupeCanvas.width = 75;
    loupeCanvas.height = 75;
    loupeCanvas.style.width = '150px';
    loupeCanvas.style.height = '150px';
    loupeCanvas.style.left = '0';
    loupeCanvas.style.top = '0';
    loupeEl.appendChild(loupeCanvas);
    const loupeCtx = loupeCanvas.getContext('2d');

    // ---------- Application state ----------
    function readLabelsPref()
    {
        try {
            return localStorage.getItem('slowsky-d4-labels') !== '0';
        } catch (err) {
            return true;
        }
    }

    const state = {
        ws: 'sky',
        target: 'barnard',
        mode: 'blink',
        index: 3,
        playing: !reducedMotion,
        speed: 1,
        zoom: 1,
        pan: { x: 0, y: 0 },
        a: 0,
        b: 3,
        abNext: 'a',
        session: null,
        sessionSizes: [],
        sessionThumbUrls: [],
        libSessions: {},
        libPromises: {},
        cands: [],
        candsEvaluated: false,
        candsWanted: false,
        subop: 'diff',
        layers: { gaia: false, flags: false, falsecolour: false, epoch: false },
        field: 0.1,
        focus: false,
        loupe: false,
        ring: true,
        trail: true,
        hold: false,
        holdPrevIndex: 0,
        holdWasPlaying: false,
        inspect: false,
        tab: 'info',
        labels: readLabelsPref(),
        colourUm: 0.93,
        roughToastShown: false,
    };

    let player = null;
    let blinkTimer = null;
    let switchSeq = 0;
    let libBuildAbort = null;
    let uploadAbort = null;
    let jobsHideTimer = null;
    let lastUploadBatch = null;
    let toastTimer = null;
    let tipTimer = null;
    let tipTarget = null;
    let helpSwapTimer = null;
    let currentHelpSignature = '';
    let firstHelpRendered = false;
    let colourStageTimers = [];
    let colourKeyTimer = null;
    let savedBandEl = null;
    let bandEls = [];
    let visitPositions = [];
    let pickerFilteredIds = [];
    let pickerSelectedIndex = 0;
    let activeTourStep = -1;
    let tourMarkEl = null;
    let tourTipEl = null;
    let tourElNow = null;
    let tourReturnFocus = null;
    let pointerInsideSky = false;
    let lastSkyClient = { x: 0, y: 0 };

    // Decoded IMG_DATA cache for taint-free loupe drawing on file://
    const imgDataCache = {};

    // ---------- Utility helpers ----------
    function clamp(v, lo, hi)
    {
        if (v < lo) {
            return lo;
        }
        if (v > hi) {
            return hi;
        }
        return v;
    }

    function parseVisitDate(str)
    {
        const parts = String(str).trim().split(/\s+/);
        const day = parseInt(parts[0], 10);
        const mon = MONTH_INDEX[parts[1]] ?? 0;
        const year = parseInt(parts[2], 10);
        return new Date(Date.UTC(year, mon, day, 12, 0, 0));
    }

    function formatUtcDate(d)
    {
        if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
            return 'no date';
        }
        return d.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
        });
    }

    function formatShortTick(d)
    {
        if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
            return 'no date';
        }
        const m = MONTHS[d.getUTCMonth()];
        const yy = String(d.getUTCFullYear()).slice(-2);
        return m + ' ' + yy;
    }

    function formatSigned(num, dp)
    {
        const absStr = Math.abs(num).toFixed(dp);
        if (num < 0) {
            return '\u2212' + absStr;
        }
        return '+' + absStr;
    }

    function formatMinus(num, dp)
    {
        const rounded = Number(num.toFixed(dp));
        if (rounded < 0) {
            return '\u2212' + Math.abs(num).toFixed(dp);
        }
        return Math.abs(rounded).toFixed(dp);
    }

    function formatBytes(bytes)
    {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return '0 KB';
        }
        if (bytes < 1024 * 1024) {
            return Math.max(1, Math.round(bytes / 1024)) + ' KB';
        }
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function dataUrlToBlobSync(dataUrl)
    {
        const comma = dataUrl.indexOf(',');
        const header = dataUrl.slice(0, comma);
        const body = dataUrl.slice(comma + 1);
        const mimeMatch = header.match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const bin = atob(body);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime });
    }

    function dataUrlToBlob(dataUrl)
    {
        if (!dataUrl) {
            return Promise.reject(new Error('Missing image data'));
        }
        if (typeof fetch === 'function') {
            return fetch(dataUrl).then((r) => r.blob()).catch(() => dataUrlToBlobSync(dataUrl));
        }
        return Promise.resolve(dataUrlToBlobSync(dataUrl));
    }

    function getImgDataElement(fileName)
    {
        if (imgDataCache[fileName]) {
            return imgDataCache[fileName];
        }
        const url = window.IMG_DATA && window.IMG_DATA[fileName];
        if (!url) {
            return null;
        }
        const im = new Image();
        im.src = url;
        imgDataCache[fileName] = im;
        return im;
    }

    function copyText(text, msg)
    {
        const done = () => {
            showToast(msg || 'Copied');
        };
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(done).catch(() => {
                fallbackCopy(text);
                done();
            });
        } else {
            fallbackCopy(text);
            done();
        }
    }

    function fallbackCopy(text)
    {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
        } catch (_) {
            // Ignore clipboard errors in restricted sandboxes
        }
        ta.remove();
    }

    function showToast(msg, durationMs)
    {
        clearTimeout(toastTimer);
        toastEl.textContent = msg;
        toastEl.hidden = false;
        toastTimer = setTimeout(() => {
            toastEl.hidden = true;
        }, durationMs || 2600);
    }

    function showStatusLoad(stageText)
    {
        statusStageEl.textContent = stageText || '';
        statusLoadEl.classList.add('busy');
        statusLoadEl.hidden = false;
    }

    function hideStatusLoad()
    {
        statusLoadEl.classList.remove('busy');
        statusLoadEl.hidden = true;
    }

    // ---------- URL hash sync ----------
    function parseInitialHash()
    {
        const raw = (window.location.hash || '').replace(/^#/, '');
        if (!raw) {
            return;
        }
        const params = new URLSearchParams(raw);
        const t = params.get('t');
        if (t && window.FRAMES && window.FRAMES[t]) {
            state.target = t;
            const n = window.FRAMES[t].visits.length;
            state.index = n - 1;
            state.a = 0;
            state.b = Math.max(0, n - 1);
        }
        const m = params.get('m');
        if (m === 'blink' || m === 'stack' || m === 'subtract') {
            state.mode = m;
            if (m !== 'blink') {
                state.playing = false;
            }
        }
        const iStr = params.get('i');
        if (iStr !== null) {
            const parsed = parseInt(iStr, 10);
            const maxN = window.FRAMES[state.target].visits.length;
            if (Number.isFinite(parsed) && parsed >= 0 && parsed < maxN) {
                state.index = parsed;
                if (state.mode === 'subtract') {
                    state.b = parsed > 0 ? parsed : Math.max(0, maxN - 1);
                }
            }
        }
        if (state.mode === 'subtract' && params.get('op') === 'sum') {
            state.subop = 'sum';
        }
        if (state.mode === 'subtract') {
            const maxN = window.FRAMES[state.target].visits.length;
            const pa = parseInt(params.get('a'), 10);
            const pb = parseInt(params.get('b'), 10);
            if (Number.isInteger(pa) && Number.isInteger(pb) && pa >= 0 && pb >= 0 && pa < maxN && pb < maxN) {
                state.a = Math.min(pa, pb);
                state.b = Math.max(pa, pb);
            }
        }
    }

    function syncHash()
    {
        noteStep();
        let nextHash = '';
        if (state.ws === 'sky') {
            nextHash = '#t=' + encodeURIComponent(state.target)
                + '&m=' + encodeURIComponent(state.mode)
                + '&i=' + String(state.index)
                + (state.mode === 'subtract' ? '&a=' + String(state.a) + '&b=' + String(state.b) : '')
                + (state.mode === 'subtract' && state.subop === 'sum' ? '&op=sum' : '');
        } else {
            nextHash = '#ws=mine&m=' + encodeURIComponent(state.mode) + '&i=' + String(state.index);
        }
        if (window.location.hash === nextHash) {
            return;
        }
        try {
            window.history.replaceState(null, '', nextHash);
        } catch (_) {
            window.location.hash = nextHash;
        }
    }

    // ---------- Active frame helpers ----------
    function getFrameCount()
    {
        if (state.ws === 'sky') {
            return window.FRAMES[state.target].visits.length;
        }
        if (state.session && state.session.frames) {
            return state.session.frames.length;
        }
        return 0;
    }

    function getDisplayedIndex()
    {
        if (state.hold) {
            return 0;
        }
        return state.index;
    }

    function getVisitDateLabel(idx)
    {
        if (state.ws === 'sky') {
            const v = window.FRAMES[state.target].visits[idx];
            return v ? v.date : '—';
        }
        if (state.session && state.session.frames[idx]) {
            return formatUtcDate(state.session.frames[idx].date);
        }
        return 'no date';
    }

    // ---------- Ring and trail (library only) ----------
    function computeRingPos(targetObj, visitDateStr)
    {
        const d = parseVisitDate(visitDateStr).getTime();
        const dt = (d - EPOCH_2026) / YEAR_MS;
        const x = 240 - ((targetObj.pmRa / 1000) * dt) / 0.75;
        const y = 240 - ((targetObj.pmDec / 1000) * dt) / 0.75;
        return { x, y };
    }

    function updateRingAndTrail(activeVisitIdx, replayDraw)
    {
        if (state.ws !== 'sky') {
            ringEl.classList.add('off');
            trailEl.classList.add('off');
            return;
        }
        const t = window.FRAMES[state.target];
        const pts = t.visits.map((v) => computeRingPos(t, v.date));
        const cur = pts[activeVisitIdx] || { x: 240, y: 240 };

        ringEl.setAttribute('cx', cur.x.toFixed(2));
        ringEl.setAttribute('cy', cur.y.toFixed(2));
        ringEl.classList.toggle('off', !state.ring);

        if (replayDraw) {
            ringEl.classList.remove('draw');
            void ringEl.getBoundingClientRect();
            ringEl.classList.add('draw');
        }

        while (trailEl.firstChild) {
            trailEl.removeChild(trailEl.firstChild);
        }
        if (pts.length > 1) {
            const path = document.createElementNS(SVG_NS, 'path');
            const dStr = pts.map((p, k) => (k === 0 ? 'M ' : 'L ') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ');
            path.setAttribute('d', dStr);
            trailEl.appendChild(path);
        }
        pts.forEach((p, k) => {
            if (k === activeVisitIdx) {
                return;
            }
            const c = document.createElementNS(SVG_NS, 'circle');
            c.setAttribute('cx', p.x.toFixed(2));
            c.setAttribute('cy', p.y.toFixed(2));
            c.setAttribute('r', '2.5');
            trailEl.appendChild(c);
        });
        trailEl.classList.toggle('off', !state.trail);
    }

    // ---------- HUD, Scale & Zoom ----------
    function updateTargetChrome()
    {
        const t = window.FRAMES[state.target];
        const copy = window.COPY[state.target];
        const lastVisit = t.visits[t.visits.length - 1];
        const mineFrames = state.session ? state.session.frames.length : 0;
        if (state.ws === 'mine') {
            // My frames shows the visitor's files, not a library target.
            targetNameEl.textContent = mineFrames ? 'Your files (' + mineFrames + ')' : 'Your files';
            const firstThumb = state.sessionThumbUrls && state.sessionThumbUrls[0];
            if (firstThumb) {
                targetThumbEl.src = firstThumb;
                targetThumbEl.style.visibility = '';
            } else {
                targetThumbEl.removeAttribute('src');
                targetThumbEl.style.visibility = 'hidden';
            }
        } else {
            targetNameEl.textContent = copy.display;
            targetThumbEl.src = 'img/' + lastVisit.file;
            targetThumbEl.style.visibility = '';
        }
        caveatTextEl.textContent = copy.not;

        mmPlotEl.querySelectorAll('[data-target]').forEach((btn) => {
            if (btn.dataset.target === state.target && state.ws === 'sky') {
                btn.setAttribute('aria-current', 'true');
            } else {
                btn.removeAttribute('aria-current');
            }
        });
    }

    function updateHudForIndex(idx)
    {
        if (state.ws === 'sky') {
            const t = window.FRAMES[state.target];
            const copy = window.COPY[state.target];
            const v = t.visits[idx] || t.visits[0];
            hudIdEl.hidden = false;
            hudScaleEl.hidden = false;
            hudNameEl.textContent = copy.display;
            hudDateEl.textContent = v.date;
            hudVisitEl.textContent = (idx + 1) + ' / ' + t.visits.length;
            hudSrcEl.textContent = 'Real SPHEREx pixels \u00b7 saved copy';
            hudLamEl.textContent = 'This frame ' + t.lam[0].toFixed(2) + '\u2013' + t.lam[1].toFixed(2) + ' \u00b5m';
            compassEl.hidden = false;
            scaleBarEl.hidden = false;
            updateScaleBar();
        } else if (state.session && state.session.frames.length > 0) {
            const s = state.session;
            const f = s.frames[idx] || s.frames[0];
            hudIdEl.hidden = false;
            hudScaleEl.hidden = false;
            hudNameEl.textContent = 'My frames';
            hudDateEl.textContent = formatUtcDate(f.date);
            hudVisitEl.textContent = (idx + 1) + ' / ' + s.frames.length;
            hudSrcEl.textContent = 'Your files \u00b7 processed in this browser';
            const kindLabel = (f.kind || 'file').toUpperCase();
            hudLamEl.textContent = kindLabel + (f.unit ? ' \u00b7 ' + f.unit : '');
            compassEl.hidden = true;
            scaleBarEl.hidden = true;
            scaleLabelEl.textContent = s.width + '\u00d7' + s.height + ' px';
        } else {
            hudIdEl.hidden = true;
            hudScaleEl.hidden = true;
        }
    }

    function updateScaleBar()
    {
        if (state.ws !== 'sky') {
            if (state.session) {
                compassEl.hidden = true;
                scaleBarEl.hidden = true;
                scaleLabelEl.textContent = state.session.width + '\u00d7' + state.session.height + ' px';
            }
            updateZoomLabel();
            return;
        }
        compassEl.hidden = false;
        scaleBarEl.hidden = false;
        const stageW = stageEl.clientWidth || 480;
        const pxPerArcmin = (stageW / 6) * state.zoom;
        const choices = [
            { arcmin: 1, label: '1\u2032' },
            { arcmin: 0.5, label: '30\u2033' },
            { arcmin: 2, label: '2\u2032' },
        ];
        let picked = null;
        for (let i = 0; i < choices.length; i++) {
            const w = choices[i].arcmin * pxPerArcmin;
            if (w >= 40 && w <= 110) {
                picked = { width: w, label: choices[i].label };
                break;
            }
        }
        if (!picked) {
            let bestDist = Infinity;
            for (let i = 0; i < choices.length; i++) {
                const w = choices[i].arcmin * pxPerArcmin;
                const dist = Math.abs(w - 75);
                if (dist < bestDist) {
                    bestDist = dist;
                    picked = { width: clamp(w, 24, 140), label: choices[i].label };
                }
            }
        }
        scaleBarEl.style.width = Math.round(picked.width) + 'px';
        scaleLabelEl.textContent = picked.label;
        updateZoomLabel();
    }

    function updateZoomLabel()
    {
        if (state.ws === 'sky') {
            const fov = 6 / state.zoom;
            zoomLabelEl.textContent = (Math.abs(fov - Math.round(fov)) < 0.05 ? String(Math.round(fov)) : fov.toFixed(1)) + '\u2032';
        } else {
            zoomLabelEl.textContent = (Math.abs(state.zoom - Math.round(state.zoom)) < 0.05 ? String(Math.round(state.zoom)) : state.zoom.toFixed(1)) + '\u00d7';
        }
    }

    function applyZoomPan()
    {
        const w = stageEl.clientWidth || 480;
        const h = stageEl.clientHeight || 480;
        const maxX = ((state.zoom - 1) * w) / 2;
        const maxY = ((state.zoom - 1) * h) / 2;
        state.pan.x = clamp(state.pan.x, -maxX, maxX);
        state.pan.y = clamp(state.pan.y, -maxY, maxY);
        skyEl.style.setProperty('--zoom', String(state.zoom));
        skyEl.style.setProperty('--pan-x', state.pan.x.toFixed(1) + 'px');
        skyEl.style.setProperty('--pan-y', state.pan.y.toFixed(1) + 'px');
        updateScaleBar();
        if (state.loupe && pointerInsideSky) {
            updateLoupeAt(lastSkyClient.x, lastSkyClient.y);
        }
        noteStep();
    }

    function resetView()
    {
        state.zoom = 1;
        state.pan.x = 0;
        state.pan.y = 0;
        applyZoomPan();
    }

    // ---------- Loading marks: inside the picture, and on the control that changed ----------
    // CSS shows a mark only after 120 ms, so quick changes never flash; a mark that did show stays 300 ms.
    const busyJobs = new Map();
    let busySeq = 0;
    let stageLoadHideTimer = null;

    function beginBusy(controlEl, text)
    {
        const id = ++busySeq;
        busyJobs.set(id, { el: controlEl || null, text: text || 'Loading', at: performance.now() });
        if (controlEl) {
            controlEl.classList.add('is-busy');
            controlEl.setAttribute('aria-busy', 'true');
        }
        clearTimeout(stageLoadHideTimer);
        stageLoadTextEl.textContent = text || 'Loading';
        stageEl.setAttribute('aria-busy', 'true');
        stageLoadEl.classList.add('on');
        return id;
    }

    function setBusyText(id, text)
    {
        const job = busyJobs.get(id);
        if (job && text) {
            job.text = text;
            stageLoadTextEl.textContent = text;
        }
    }

    function endBusy(id)
    {
        const job = busyJobs.get(id);
        if (!job) {
            return;
        }
        busyJobs.delete(id);
        const others = Array.from(busyJobs.values());
        if (job.el && !others.some((other) => other.el === job.el)) {
            const el = job.el;
            const shown = performance.now() - job.at;
            const wait = shown < 120 ? 0 : Math.max(0, 420 - shown);
            setTimeout(() => {
                if (!Array.from(busyJobs.values()).some((other) => other.el === el)) {
                    el.classList.remove('is-busy');
                    el.removeAttribute('aria-busy');
                }
            }, wait);
        }
        if (others.length > 0) {
            stageLoadTextEl.textContent = others[others.length - 1].text;
            return;
        }
        const shown = performance.now() - job.at;
        const wait = shown < 120 ? 0 : Math.max(0, 420 - shown);
        stageLoadHideTimer = setTimeout(() => {
            if (busyJobs.size === 0) {
                stageLoadEl.classList.remove('on');
                stageEl.removeAttribute('aria-busy');
            }
        }, wait);
    }

    // Runs synchronous work one frame later, so the loading marks are on screen while it runs.
    function withBusy(controlEl, text, work)
    {
        const id = beginBusy(controlEl, text);
        requestAnimationFrame(() => {
            setTimeout(() => {
                try {
                    work();
                } finally {
                    endBusy(id);
                }
            }, 0);
        });
    }

    function announce(text)
    {
        if (!announceEl) {
            return;
        }
        announceEl.textContent = '';
        setTimeout(() => {
            announceEl.textContent = text;
        }, 30);
    }

    // ---------- Undo and redo ----------
    // One step per settled change to what the picture shows: target, workspace, view, dates, B − A or A + B,
    // zoom and pan, ring, trail, loupe, layers and found candidates. Changes within 450 ms make one step, so a
    // drag or a run of key presses is undone at once. Uploads, colour, labels, theme and the inspector are not steps.
    const HISTORY_LIMIT = 60;
    const hist = { past: [], future: [], current: null, timer: null, applying: false };
    let switchPending = false;
    let switchBusy = 0;

    function viewSnapshot()
    {
        return {
            ws: state.ws,
            target: state.target,
            mode: state.mode,
            subop: state.subop,
            index: state.index,
            playing: state.playing,
            a: state.a,
            b: state.b,
            abNext: state.abNext,
            zoom: state.zoom,
            panX: state.pan.x,
            panY: state.pan.y,
            ring: state.ring,
            trail: state.trail,
            loupe: state.loupe,
            layers: Object.assign({}, state.layers),
            cands: state.candsWanted && state.mode === 'subtract',
        };
    }

    function sameStep(p, q)
    {
        const keys = ['ws', 'target', 'mode', 'subop', 'a', 'b', 'ring', 'trail', 'loupe', 'cands'];
        for (const key of keys) {
            if (p[key] !== q[key]) {
                return false;
            }
        }
        for (const key of Object.keys(p.layers)) {
            if (p.layers[key] !== q.layers[key]) {
                return false;
            }
        }
        if (Math.abs(p.zoom - q.zoom) > 0.01 || Math.abs(p.panX - q.panX) > 1 || Math.abs(p.panY - q.panY) > 1) {
            return false;
        }
        // While the dates play, the date is not a step; a date picked by hand is.
        if (p.index !== q.index && !(p.playing && q.playing)) {
            return false;
        }
        return true;
    }

    function updateHistoryButtons()
    {
        if (!undoBtn || !redoBtn) {
            return;
        }
        undoBtn.disabled = hist.applying || hist.past.length === 0;
        redoBtn.disabled = hist.applying || hist.future.length === 0;
    }

    function noteStep()
    {
        if (hist.applying || !hist.current) {
            return;
        }
        clearTimeout(hist.timer);
        hist.timer = setTimeout(commitStep, 450);
    }

    function commitStep()
    {
        clearTimeout(hist.timer);
        hist.timer = null;
        if (hist.applying || !hist.current) {
            return;
        }
        if (switchPending) {
            hist.timer = setTimeout(commitStep, 200);
            return;
        }
        const snap = viewSnapshot();
        if (sameStep(snap, hist.current)) {
            hist.current = snap;
            return;
        }
        hist.past.push(hist.current);
        if (hist.past.length > HISTORY_LIMIT) {
            hist.past.shift();
        }
        hist.future = [];
        hist.current = snap;
        updateHistoryButtons();
    }

    // A new upload replaces the old frames, so steps that showed the old ones cannot come back.
    function forgetMineSteps()
    {
        hist.past = hist.past.filter((snap) => snap.ws !== 'mine');
        hist.future = hist.future.filter((snap) => snap.ws !== 'mine');
        if (hist.current && hist.current.ws === 'mine') {
            // The current step showed the old frames: start again from what is on screen now.
            clearTimeout(hist.timer);
            hist.timer = null;
            hist.current = viewSnapshot();
        }
        updateHistoryButtons();
    }

    // A target still loading is the newest change: undo cancels it and the view stays where it was.
    function cancelPendingSwitch()
    {
        if (!switchPending) {
            return false;
        }
        switchSeq++;
        switchPending = false;
        endBusy(switchBusy);
        skyEl.classList.remove('dim');
        hideStatusLoad();
        updateTargetChrome();
        restartBlinkTimer();
        return true;
    }

    function undoStep()
    {
        if (hist.applying) {
            return;
        }
        if (cancelPendingSwitch()) {
            showToast('Undone');
            announce('Undone');
            return;
        }
        commitStep();
        if (hist.past.length === 0) {
            showToast('Nothing to undo');
            return;
        }
        const snap = hist.past.pop();
        hist.future.push(hist.current);
        applyStep(snap, undoBtn, 'Going back one step', 'Undone');
    }

    function redoStep()
    {
        if (hist.applying) {
            return;
        }
        if (switchPending) {
            showToast('Wait for the target to load');
            return;
        }
        commitStep();
        if (hist.future.length === 0) {
            showToast('Nothing to redo');
            return;
        }
        const snap = hist.future.pop();
        hist.past.push(hist.current);
        applyStep(snap, redoBtn, 'Going forward one step', 'Redone');
    }

    function applyStep(snap, controlEl, busyText, doneText)
    {
        hist.applying = true;
        updateHistoryButtons();
        const busy = beginBusy(controlEl, busyText);
        if (state.hold) {
            endHold();
        }

        let ready = Promise.resolve();
        if (snap.ws === 'sky' && snap.target !== state.target) {
            ready = switchTarget(snap.target);
        } else if (snap.ws !== state.ws) {
            setWorkspace(snap.ws, true);
        }

        ready.then(() => {
            if (snap.ws === 'sky' && state.target !== snap.target) {
                return; // Another target was picked while this step loaded: that choice wins.
            }
            const n = getFrameCount();
            state.mode = n >= 2 ? snap.mode : 'blink';
            state.subop = snap.subop;
            state.a = clamp(snap.a, 0, Math.max(0, n - 1));
            state.b = clamp(snap.b, 0, Math.max(0, n - 1));
            state.abNext = snap.abNext;
            state.index = clamp(snap.index, 0, Math.max(0, n - 1));
            state.playing = snap.playing && state.mode === 'blink' && n > 1;
            state.ring = snap.ring;
            state.trail = snap.trail;
            state.loupe = snap.loupe;
            if (!state.loupe) {
                loupeEl.hidden = true;
            }
            Object.assign(state.layers, snap.layers);
            state.zoom = snap.zoom;
            state.pan.x = snap.panX;
            state.pan.y = snap.panY;

            clearCandidates();
            applyZoomPan();
            updateZoomLabel();
            updateModeControls();
            updateThumbAbMarkers();
            updateLayerNote();
            if (state.ws === 'sky') {
                updateRingAndTrail(state.index, false);
            }
            goToIndex(state.index);
            restartBlinkTimer();
            renderInspectorAll();
            if (snap.cands) {
                runCandidates(false);
            }
            syncHash();
        }).finally(() => {
            hist.applying = false;
            hist.current = viewSnapshot();
            hist.current.cands = snap.cands;
            updateHistoryButtons();
            endBusy(busy);
            announce(doneText);
        });
    }

    // ---------- Layers (live data in the real app) ----------
    // The saved pictures in this mockup carry no Gaia list, no FLAGS layer, no second colour and no 2MASS
    // picture, so each layer says what the live app draws there instead of drawing something made up.
    const LAYER_NOTES = {
        gaia: 'Mockup: the live app rings the brightest stars from ESA’s Gaia DR3 catalogue here. This copy has no Gaia list, so no rings are drawn.',
        flags: 'Mockup: the live app marks the pixels each SPHEREx file flags. The saved pictures here carry no flags.',
        falsecolour: 'Mockup: the live app paints two SPHEREx colours as one picture. The saved pictures here hold one colour each.',
        epoch: 'Mockup: the live app flips to a 2MASS picture of this patch taken between 1997 and 2001. This copy has no 2MASS picture.',
    };

    function updateLayerNote()
    {
        if (!layerNoteEl) {
            return;
        }
        const on = Object.keys(LAYER_NOTES).filter((key) => state.layers[key]);
        while (layerNoteEl.firstChild) {
            layerNoteEl.removeChild(layerNoteEl.firstChild);
        }
        on.forEach((key) => {
            const p = document.createElement('p');
            const help = window.CONTROL_HELP && window.CONTROL_HELP[key === 'falsecolour' ? 'falseColour' : key];
            const b = document.createElement('b');
            b.textContent = help ? help.name : key;
            p.appendChild(b);
            p.appendChild(document.createTextNode(' ' + LAYER_NOTES[key]));
            layerNoteEl.appendChild(p);
        });
        layerNoteEl.hidden = on.length === 0;
    }

    function toggleLayer(key)
    {
        state.layers[key] = !state.layers[key];
        updateLayerNote();
        updateToolStates();
        const help = window.CONTROL_HELP && window.CONTROL_HELP[key === 'falsecolour' ? 'falseColour' : key];
        announce((help ? help.name : key) + (state.layers[key] ? ' on' : ' off'));
    }

    // ---------- Field of view ----------
    function setField(value)
    {
        const deg = parseFloat(value);
        if (!Number.isFinite(deg)) {
            return;
        }
        state.field = deg;
        if (state.ws === 'sky' && deg > 0.1) {
            withBusy(fieldSelectEl, 'Changing the field', () => {
                showToast('Mockup: the saved copy limits the field to 0.1°. The live app loads up to 1° from the archive.', 4200);
            });
        }
    }

    // ---------- B − A or A + B ----------
    function setSubop(op)
    {
        if (op !== 'diff' && op !== 'sum') {
            return;
        }
        state.subop = op;
        updateModeControls();
        const btn = subopEl ? subopEl.querySelector('[data-subop="' + op + '"]') : null;
        withBusy(btn, op === 'sum' ? 'Adding A and B' : 'Taking A away from B', () => {
            clearCandidates();
            syncHash();
            renderCurrentView();
            renderInspectorCands();
        });
    }

    // ---------- Focus mode ----------
    function setFocusMode(on)
    {
        state.focus = Boolean(on);
        document.body.classList.toggle('focus-mode', state.focus);
        if (state.focus && state.inspect) {
            setInspectorOpen(false);
        }
        updateToolStates();
        announce(state.focus ? 'Focus on: side panels hidden' : 'Focus off');
        requestAnimationFrame(applyZoomPan);
    }

    // ---------- Save a picture of A, B and B − A ----------
    function savePicture()
    {
        if (!window.SlowskyEngine || getFrameCount() < 2) {
            showToast('Save picture needs at least two frames.');
            return;
        }
        if (state.a === state.b) {
            showToast('A and B are the same date: pick two different dates to save a comparison.');
            return;
        }
        // Everything the picture says is read now, so a target or date changed while it is made cannot mislabel it.
        const ws = state.ws;
        const target = state.target;
        const pairA = Math.min(state.a, state.b);
        const pairB = Math.max(state.a, state.b);
        const labelA = getVisitDateLabel(pairA);
        const labelB = getVisitDateLabel(pairB);
        const title = ws === 'sky' ? window.COPY[target].display : 'My frames';
        const getSess = ws === 'sky' ? ensureLibrarySession(target) : Promise.resolve(state.session);
        const busy = beginBusy(saveBtn, 'Making the picture');
        getSess.then((session) => {
            if (!session) {
                return;
            }
            const engine = window.SlowskyEngine;
            const n = session.frames.length;
            if (pairB >= n) {
                showToast('Could not make the picture');
                return;
            }
            const a = pairA;
            const b = pairB;
            const panels = [
                { label: 'A · ' + labelA, image: engine.render(session, a, { mode: 'blink' }) },
                { label: 'B · ' + labelB, image: engine.render(session, b, { mode: 'blink' }) },
                { label: 'B − A', image: engine.render(session, 0, { mode: 'subtract', a: a, b: b }) },
            ];
            const side = 360;
            const pad = 20;
            const head = 56;
            const foot = 52;
            const canvas = document.createElement('canvas');
            canvas.width = pad + panels.length * (side + pad);
            canvas.height = head + side + foot;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#05070d';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#e9edf5';
            ctx.font = '600 18px system-ui, sans-serif';
            ctx.fillText(title, pad, 32);
            const scratch = document.createElement('canvas');
            panels.forEach((panel, i) => {
                const x = pad + i * (side + pad);
                scratch.width = panel.image.width;
                scratch.height = panel.image.height;
                scratch.getContext('2d').putImageData(panel.image, 0, 0);
                const scale = side / Math.max(panel.image.width, panel.image.height);
                const w = panel.image.width * scale;
                const h = panel.image.height * scale;
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(scratch, x + (side - w) / 2, head + (side - h) / 2, w, h);
                ctx.fillStyle = 'rgba(5, 7, 13, .72)';
                ctx.fillRect(x + 8, head + 8, ctx.measureText(panel.label).width + 16, 24);
                ctx.fillStyle = '#e9edf5';
                ctx.font = '500 13px system-ui, sans-serif';
                ctx.fillText(panel.label, x + 16, head + 25);
            });
            ctx.fillStyle = '#9aa3b5';
            ctx.font = '12px system-ui, sans-serif';
            const source = ws === 'sky'
                ? 'NASA SPHEREx pixels (saved display pictures) · B − A: blue more light earlier, orange more light later'
                : 'Your frames, processed in this browser · B − A: blue more light earlier, orange more light later';
            ctx.fillText(source, pad, head + side + 22);
            ctx.fillText('Made with Slowsky (mockup). A change here is a candidate to check, not a finding.', pad, head + side + 40);
            return new Promise((resolve) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = 'slowsky-' + (ws === 'sky' ? target : 'my-frames') + '-a-b.png';
                        document.body.appendChild(link);
                        link.click();
                        link.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 4000);
                        showToast('Picture saved');
                    } else {
                        showToast('Could not make the picture');
                    }
                    resolve();
                }, 'image/png');
            });
        }).catch(() => {
            showToast('Could not make the picture');
        }).finally(() => {
            endBusy(busy);
        });
    }

    // ---------- Panels made by panels.js (charts, up tonight, comet, Planet Nine, credits) ----------
    function panelCtx()
    {
        return {
            ws: state.ws,
            targetId: state.target,
            index: getDisplayedIndex(),
            visits: state.ws === 'sky' && window.FRAMES[state.target] ? window.FRAMES[state.target].visits : null,
            session: state.ws === 'mine' ? state.session : null,
            now: new Date(),
        };
    }

    function callPanel(name, el)
    {
        const panels = window.SlowskyPanels;
        if (!panels || typeof panels[name] !== 'function' || !el) {
            return;
        }
        try {
            panels[name](el, panelCtx());
        } catch (err) {
            const p = document.createElement('p');
            p.className = 'faint';
            p.textContent = 'This panel could not be drawn.';
            el.appendChild(p);
            if (window.console) {
                console.warn('panels.' + name, err);
            }
        }
    }

    // ---------- Playback timer ----------
    function updatePlayButton()
    {
        const useEl = playBtn.querySelector('use');
        if (state.playing) {
            if (useEl) {
                useEl.setAttribute('href', '#i-pause');
            }
            playBtn.setAttribute('aria-label', 'Pause');
        } else {
            if (useEl) {
                useEl.setAttribute('href', '#i-play');
            }
            playBtn.setAttribute('aria-label', 'Play');
        }
    }

    function restartBlinkTimer()
    {
        clearInterval(blinkTimer);
        blinkTimer = null;
        const n = getFrameCount();
        if (state.playing && !state.hold && state.mode === 'blink' && n > 1) {
            const ms = Math.round(700 / state.speed);
            blinkTimer = setInterval(() => {
                stepFrame(1, true);
            }, ms);
        }
        updatePlayButton();
    }

    // Playback ticks keep restarting the step timer, so the step on record can still hold the date playback
    // started on. Record where playback is now before a hand-made change stops it, so undo comes back here.
    function settlePlayback()
    {
        if (state.playing && !hist.applying && hist.current) {
            commitStep();
        }
    }

    function setPlaying(on)
    {
        if (!on) {
            settlePlayback();
        }
        const n = getFrameCount();
        if (on && n <= 1) {
            state.playing = false;
            restartBlinkTimer();
            return;
        }
        if (on && state.mode !== 'blink') {
            setMode('blink');
        }
        state.playing = Boolean(on);
        restartBlinkTimer();
    }

    function stepFrame(delta, fromTimer)
    {
        const n = getFrameCount();
        if (n <= 0) {
            return;
        }
        if (!fromTimer && state.playing) {
            settlePlayback();
            state.playing = false;
            restartBlinkTimer();
        }
        const nextIdx = ((state.index + delta) % n + n) % n;
        goToIndex(nextIdx);
    }

    function goToIndex(idx)
    {
        const n = getFrameCount();
        if (n <= 0) {
            return;
        }
        state.index = ((idx % n) + n) % n;
        syncHash();
        if (state.ws === 'sky' && state.mode === 'blink' && !state.hold) {
            player.go(state.index);
        } else {
            commitFrameVisuals(getDisplayedIndex());
            renderCurrentView();
        }
    }

    // Called when pixels of visit `idx` are committed on screen
    function commitFrameVisuals(idx)
    {
        updateHudForIndex(idx);
        updateRingAndTrail(idx, false);
        updateTimelineSelection(idx);
        if (state.loupe && pointerInsideSky) {
            updateLoupeAt(lastSkyClient.x, lastSkyClient.y);
        }
        if (pointerInsideSky) {
            updateSkyCoordAt(lastSkyClient.x, lastSkyClient.y);
        }
        if (state.inspect && state.tab === 'frame') {
            renderInspectorFrame();
        }
    }

    // ---------- SkyPlayer & Engine Rendering ----------
    function setSkyLayersVisible(visible)
    {
        skyEl.querySelectorAll('img.layer').forEach((im) => {
            im.hidden = !visible;
        });
        engineCanvas.hidden = visible;
    }

    function drawSessionToCanvas(session, idx, mode)
    {
        if (!window.SlowskyEngine || !session) {
            return;
        }
        const out = window.SlowskyEngine.render(session, idx, {
            mode: mode === 'subtract' && state.subop === 'sum' ? 'sum' : mode,
            a: state.a,
            b: state.b,
        });
        if (!out) {
            return;
        }
        if (typeof ImageData !== 'undefined' && out instanceof ImageData) {
            if (engineCanvas.width !== out.width || engineCanvas.height !== out.height) {
                engineCanvas.width = out.width;
                engineCanvas.height = out.height;
            }
            engineCtx.putImageData(out, 0, 0);
        } else if (out.width && out.height) {
            if (engineCanvas.width !== out.width || engineCanvas.height !== out.height) {
                engineCanvas.width = out.width;
                engineCanvas.height = out.height;
            }
            engineCtx.drawImage(out, 0, 0);
        }
    }

    function ensureLibrarySession(targetId)
    {
        if (state.libSessions[targetId]) {
            return Promise.resolve(state.libSessions[targetId]);
        }
        if (!window.SlowskyEngine) {
            showToast('Processing engine not loaded');
            return Promise.resolve(null);
        }
        if (state.libPromises[targetId]) {
            return state.libPromises[targetId];
        }
        if (libBuildAbort) {
            libBuildAbort.abort();
        }
        const ctrl = new AbortController();
        libBuildAbort = ctrl;
        const t = window.FRAMES[targetId];
        skyEl.classList.add('loading');
        showStatusLoad(window.STAGE_TEXT.headers);
        const modeBtn = modeGroup.querySelector('[data-mode="' + state.mode + '"]');
        const busy = beginBusy(state.mode !== 'blink' ? modeBtn : null, 'Preparing ' + (window.COPY[targetId] ? window.COPY[targetId].display : 'the frames'));

        const p = Promise.all(t.visits.map((v) => {
            const url = window.IMG_DATA && window.IMG_DATA[v.file];
            return dataUrlToBlob(url).then((blob) => {
                const ms = parseVisitDate(v.date).getTime();
                return new File([blob], v.file, { type: 'image/png', lastModified: ms });
            });
        })).then((files) => {
            return window.SlowskyEngine.process(files, {
                align: false,
                signal: ctrl.signal,
                onJob: (_jobIdx, stage) => {
                    if (state.ws === 'sky' && state.target === targetId) {
                        showStatusLoad('Stage: ' + stage);
                        setBusyText(busy, 'Preparing the frames: ' + stage);
                    }
                },
            });
        }).then((session) => {
            endBusy(busy);
            delete state.libPromises[targetId];
            state.libSessions[targetId] = session;
            if (state.ws === 'sky' && state.target === targetId) {
                skyEl.classList.remove('loading');
                hideStatusLoad();
            }
            return session;
        }).catch((err) => {
            endBusy(busy);
            delete state.libPromises[targetId];
            if (state.ws === 'sky' && state.target === targetId) {
                skyEl.classList.remove('loading');
                hideStatusLoad();
            }
            if (!ctrl.signal.aborted) {
                showToast(err && err.message ? err.message : 'Processing error');
            }
            return null;
        });

        state.libPromises[targetId] = p;
        return p;
    }

    function renderCurrentView()
    {
        const dispIdx = getDisplayedIndex();
        const effectiveMode = state.hold ? 'blink' : state.mode;

        if (state.ws === 'sky') {
            stageEl.classList.remove('is-empty');
            emptyEl.hidden = true;
            skyEl.hidden = false;

            if (effectiveMode === 'blink') {
                setSkyLayersVisible(true);
                if (player && (player.id !== state.target || player.i !== dispIdx)) {
                    player.go(dispIdx);
                } else {
                    commitFrameVisuals(dispIdx);
                }
            } else {
                if (!window.SlowskyEngine) {
                    showToast('Processing engine not loaded');
                    setMode('blink');
                    return;
                }
                const cached = state.libSessions[state.target];
                if (cached) {
                    setSkyLayersVisible(false);
                    drawSessionToCanvas(cached, dispIdx, effectiveMode);
                    commitFrameVisuals(dispIdx);
                    updateToolStates();
                    return;
                }
                const targetAtCall = state.target;
                ensureLibrarySession(targetAtCall).then((session) => {
                    if (!session || state.ws !== 'sky' || state.target !== targetAtCall) {
                        return;
                    }
                    const nowMode = state.hold ? 'blink' : state.mode;
                    if (nowMode === 'blink') {
                        return;
                    }
                    setSkyLayersVisible(false);
                    drawSessionToCanvas(session, getDisplayedIndex(), nowMode);
                    commitFrameVisuals(getDisplayedIndex());
                    updateToolStates();
                });
            }
        } else {
            if (!state.session) {
                stageEl.classList.add('is-empty');
                emptyEl.hidden = false;
                skyEl.hidden = true;
                updateHudForIndex(0);
            } else {
                stageEl.classList.remove('is-empty');
                emptyEl.hidden = true;
                skyEl.hidden = false;
                setSkyLayersVisible(false);
                drawSessionToCanvas(state.session, dispIdx, effectiveMode);
                commitFrameVisuals(dispIdx);
            }
        }
    }

    // ---------- Modes & Subtract A/B & Candidates ----------
    function updateModeControls()
    {
        const fewFrames = getFrameCount() < 2;
        if (fewFrames && state.mode !== 'blink') {
            state.mode = 'blink';
            clearCandidates();
        }
        modeGroup.querySelectorAll('[data-mode]').forEach((btn) => {
            btn.setAttribute('aria-checked', btn.dataset.mode === state.mode ? 'true' : 'false');
            btn.disabled = btn.dataset.mode !== 'blink' && fewFrames;
        });
        abEl.hidden = state.mode !== 'subtract' || getFrameCount() === 0;
        if (!abEl.hidden) {
            abAEl.textContent = getVisitDateLabel(state.a);
            abBEl.textContent = getVisitDateLabel(state.b);
        }
        if (subopEl) {
            subopEl.querySelectorAll('[data-subop]').forEach((btn) => {
                btn.setAttribute('aria-checked', btn.dataset.subop === state.subop ? 'true' : 'false');
            });
        }
        updateToolStates();
        if (!tipTarget) {
            setStatusHelpDefault();
        }
    }

    function updateToolStates()
    {
        const ringBtn = toolsEl.querySelector('[data-tool="ring"]');
        const trailBtn = toolsEl.querySelector('[data-tool="trail"]');
        const findBtn = toolsEl.querySelector('[data-tool="find"]');
        const loupeBtn = toolsEl.querySelector('[data-tool="loupe"]');
        const inspectBtn = toolsEl.querySelector('[data-tool="inspect"]');
        const zoomBtn = toolsEl.querySelector('[data-tool="zoom"]');
        const fitBtn = toolsEl.querySelector('[data-tool="fit"]');
        const holdBtn = toolsEl.querySelector('[data-tool="hold"]');

        const hasFrames = getFrameCount() > 0;
        if (ringBtn) {
            ringBtn.disabled = state.ws !== 'sky';
            ringBtn.setAttribute('aria-pressed', state.ws === 'sky' && state.ring ? 'true' : 'false');
        }
        if (trailBtn) {
            trailBtn.disabled = state.ws !== 'sky';
            trailBtn.setAttribute('aria-pressed', state.ws === 'sky' && state.trail ? 'true' : 'false');
        }
        if (findBtn) {
            findBtn.disabled = state.mode !== 'subtract' || getFrameCount() < 2;
        }
        if (loupeBtn) {
            loupeBtn.disabled = !hasFrames;
            loupeBtn.setAttribute('aria-pressed', state.loupe ? 'true' : 'false');
        }
        if (holdBtn) {
            holdBtn.disabled = getFrameCount() < 2;
        }
        if (zoomBtn) {
            zoomBtn.disabled = !hasFrames;
        }
        if (fitBtn) {
            fitBtn.disabled = !hasFrames;
        }
        if (inspectBtn) {
            inspectBtn.setAttribute('aria-pressed', state.inspect ? 'true' : 'false');
        }

        const transportDisabled = getFrameCount() < 2;
        prevBtn.disabled = transportDisabled;
        playBtn.disabled = transportDisabled;
        nextBtn.disabled = transportDisabled;

        Object.keys(state.layers).forEach((key) => {
            const layerBtn = toolsEl.querySelector('[data-tool="' + key + '"]');
            if (layerBtn) {
                layerBtn.disabled = !hasFrames;
                layerBtn.setAttribute('aria-pressed', state.layers[key] ? 'true' : 'false');
            }
        });
        const focusBtn = toolsEl.querySelector('[data-tool="focus"]');
        if (focusBtn) {
            focusBtn.setAttribute('aria-pressed', state.focus ? 'true' : 'false');
        }
        if (fieldSelectEl) {
            fieldSelectEl.disabled = state.ws !== 'sky';
        }
        if (saveBtn) {
            saveBtn.disabled = getFrameCount() < 2;
        }
        updateHistoryButtons();
        noteStep();
    }

    function setMode(nextMode)
    {
        if (nextMode !== 'blink' && nextMode !== 'stack' && nextMode !== 'subtract') {
            return;
        }
        if (nextMode !== 'blink' && getFrameCount() < 2) {
            showToast('Stack and Subtract need at least two frames.');
            return;
        }
        if (nextMode !== 'blink' && state.ws === 'sky' && !window.SlowskyEngine) {
            showToast('Processing engine not loaded');
            return;
        }
        settlePlayback();

        state.mode = nextMode;
        if (nextMode !== 'blink') {
            state.playing = false;
            restartBlinkTimer();
            if (state.ws === 'sky' && !state.roughToastShown) {
                state.roughToastShown = true;
                showToast('Stack and Subtract here use the saved display pictures, so the maths is rough.');
            }
        }

        const n = getFrameCount();
        clearCandidates();
        if (nextMode === 'subtract' && n > 0) {
            state.a = 0;
            state.b = state.index > 0 ? state.index : Math.max(0, n - 1);
            state.abNext = 'a';
        }

        syncHash();
        updateModeControls();
        updateThumbAbMarkers();
        if (nextMode === 'blink') {
            renderCurrentView();
            renderInspectorAll();
        } else {
            const modeBtn = modeGroup.querySelector('[data-mode="' + nextMode + '"]');
            withBusy(modeBtn, nextMode === 'stack' ? 'Stacking the frames' : 'Taking A away from B', () => {
                if (state.mode === nextMode) {
                    renderCurrentView();
                }
                renderInspectorAll();
            });
        }
        announce(nextMode === 'blink' ? 'Blink' : nextMode === 'stack' ? 'Stack' : 'Subtract');
    }

    function clearCandidates()
    {
        state.cands = [];
        state.candsEvaluated = false;
        state.candsWanted = false;
        while (candsEl.firstChild) {
            candsEl.removeChild(candsEl.firstChild);
        }
    }

    function getCandSigma(c)
    {
        // engine.js: peak is the difference value, sigma the robust noise (MAD) of the whole difference image.
        if (typeof c.peak === 'number' && typeof c.sigma === 'number' && c.sigma > 0) {
            return Math.abs(c.peak / c.sigma);
        }
        return 0;
    }

    function runCandidates(openTab)
    {
        if (state.mode !== 'subtract') {
            return;
        }
        if (!window.SlowskyEngine) {
            showToast('Processing engine not loaded');
            return;
        }
        // Candidates compare B − A, so finding them switches A + B back.
        if (state.subop === 'sum') {
            state.subop = 'diff';
            updateModeControls();
            renderCurrentView();
        }
        state.candsWanted = true;
        noteStep();
        const asked = { ws: state.ws, target: state.target, session: state.session, a: state.a, b: state.b };
        const getSess = state.ws === 'sky'
            ? ensureLibrarySession(state.target)
            : Promise.resolve(state.session);
        const findBtn = toolsEl.querySelector('[data-tool="find"]');
        const busy = beginBusy(findBtn, 'Looking for candidate changes');

        getSess.then((session) => {
            const sameView = state.ws === asked.ws && state.a === asked.a && state.b === asked.b
                && (asked.ws === 'sky' ? state.target === asked.target : state.session === asked.session);
            if (!session || state.mode !== 'subtract' || !sameView) {
                endBusy(busy);
                return;
            }
            requestAnimationFrame(() => {
                setTimeout(() => {
                    try {
                        const stillSame = state.ws === asked.ws && state.a === asked.a && state.b === asked.b
                            && state.mode === 'subtract' && state.candsWanted;
                        if (!stillSame) {
                            return;
                        }
                        const list = window.SlowskyEngine.candidates(session, state.a, state.b, { k: 5 }) || [];
                        state.cands = list;
                        state.candsEvaluated = true;
                        drawCandidateMarkers(session, list);
                        renderInspectorCands();
                        announce(list.length === 1 ? '1 candidate change' : list.length + ' candidate changes');
                        if (openTab) {
                            setInspectorOpen(true);
                            selectInspectorTab('cands');
                        }
                    } finally {
                        endBusy(busy);
                    }
                }, 0);
            });
        });
    }

    function drawCandidateMarkers(session, list)
    {
        while (candsEl.firstChild) {
            candsEl.removeChild(candsEl.firstChild);
        }
        if (!session || !list || list.length === 0) {
            return;
        }
        const scale = 480 / Math.max(session.width, session.height);
        const ox = (480 - session.width * scale) / 2;
        const oy = (480 - session.height * scale) / 2;

        list.forEach((c, idx) => {
            const g = document.createElementNS(SVG_NS, 'g');
            const signClass = c.sign === 'fainter' ? 'fainter' : 'brighter';
            g.setAttribute('class', 'cand ' + signClass);
            g.dataset.candIndex = String(idx);

            const cx = ox + c.x * scale;
            const cy = oy + c.y * scale;

            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', (cx - 8).toFixed(2));
            rect.setAttribute('y', (cy - 8).toFixed(2));
            rect.setAttribute('width', '16');
            rect.setAttribute('height', '16');

            const text = document.createElementNS(SVG_NS, 'text');
            const tx = clamp(cx + 10, 4, 466);
            const ty = clamp(cy - 9, 12, 474);
            text.setAttribute('x', tx.toFixed(2));
            text.setAttribute('y', ty.toFixed(2));
            text.textContent = String(idx + 1);

            g.appendChild(rect);
            g.appendChild(text);
            candsEl.appendChild(g);
        });
    }

    // ---------- Timeline ----------
    function buildTimeline()
    {
        while (datesThumbsEl.firstChild) {
            datesThumbsEl.removeChild(datesThumbsEl.firstChild);
        }
        while (datesAxisEl.firstChild) {
            datesAxisEl.removeChild(datesAxisEl.firstChild);
        }
        visitPositions = [];
        peekEl.hidden = true;

        const n = getFrameCount();
        if (n === 0) {
            playheadEl.hidden = true;
            return;
        }
        playheadEl.hidden = false;

        let dates = [];
        if (state.ws === 'sky') {
            dates = window.FRAMES[state.target].visits.map((v) => parseVisitDate(v.date));
        } else {
            dates = state.session.frames.map((f) => (f.date instanceof Date && !Number.isNaN(f.date.getTime()) ? f.date : null));
        }

        const datedIndices = [];
        const undatedIndices = [];
        dates.forEach((d, i) => {
            if (d) {
                datedIndices.push(i);
            } else {
                undatedIndices.push(i);
            }
        });

        let t0 = 0;
        let t1 = 0;
        let datedMaxPct = 100;

        if (n === 1) {
            visitPositions = [50];
        } else if (datedIndices.length === 0) {
            visitPositions = dates.map((_, i) => (i / (n - 1)) * 100);
        } else {
            const times = datedIndices.map((i) => dates[i].getTime());
            t0 = Math.min.apply(null, times);
            t1 = Math.max.apply(null, times);
            const uCount = undatedIndices.length;
            const dCount = datedIndices.length;
            const totalIntervals = Math.max(1, (dCount > 1 ? dCount - 1 : 0) + uCount);
            const undatedStep = 100 / totalIntervals;
            datedMaxPct = uCount > 0 ? Math.max(0, 100 - uCount * undatedStep) : 100;

            visitPositions = new Array(n).fill(0);
            datedIndices.forEach((idx, k) => {
                if (dCount === 1) {
                    visitPositions[idx] = 0;
                } else if (t1 > t0) {
                    visitPositions[idx] = ((dates[idx].getTime() - t0) / (t1 - t0)) * datedMaxPct;
                } else {
                    visitPositions[idx] = (k / (dCount - 1)) * datedMaxPct;
                }
            });
            undatedIndices.forEach((idx, k) => {
                visitPositions[idx] = datedMaxPct + (k + 1) * undatedStep;
            });
        }

        // Thumbnails and visit ticks
        for (let i = 0; i < n; i++) {
            const pct = visitPositions[i];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'thumb';
            btn.dataset.index = String(i);
            btn.style.left = pct.toFixed(3) + '%';
            btn.setAttribute('aria-label', getVisitDateLabel(i));

            if (state.ws === 'sky') {
                const v = window.FRAMES[state.target].visits[i];
                const im = document.createElement('img');
                im.src = 'img/' + v.file;
                im.alt = '';
                btn.appendChild(im);
            } else {
                const thumbCanvas = makeSessionThumbCanvas(state.session, i, 88);
                btn.appendChild(thumbCanvas);
            }

            btn.addEventListener('pointerenter', (e) => {
                if (e.pointerType === 'touch') {
                    return;
                }
                showPeek(i);
            });
            btn.addEventListener('pointerleave', () => {
                peekEl.hidden = true;
            });

            datesThumbsEl.appendChild(btn);

            const tick = document.createElement('span');
            tick.className = 'tick';
            tick.style.left = pct.toFixed(3) + '%';
            tick.textContent = formatShortTick(dates[i]);
            datesAxisEl.appendChild(tick);
        }

        // Year ticks at 1 Jan inside dated span
        if (datedIndices.length >= 2 && t1 > t0) {
            const startYear = new Date(t0).getUTCFullYear() + 1;
            const endYear = new Date(t1).getUTCFullYear();
            for (let yr = startYear; yr <= endYear; yr++) {
                const janMs = Date.UTC(yr, 0, 1, 12, 0, 0);
                if (janMs > t0 && janMs < t1) {
                    const yrPct = ((janMs - t0) / (t1 - t0)) * datedMaxPct;
                    const yTick = document.createElement('span');
                    yTick.className = 'tick year';
                    yTick.style.left = yrPct.toFixed(3) + '%';
                    yTick.textContent = String(yr);
                    datesAxisEl.appendChild(yTick);
                }
            }
        }

        playheadEl.setAttribute('aria-valuemin', '1');
        playheadEl.setAttribute('aria-valuemax', String(n));
        updateThumbAbMarkers();
        updateTimelineSelection(getDisplayedIndex());
    }

    function makeSessionThumbCanvas(session, idx, size)
    {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        if (!window.SlowskyEngine || !session) {
            return c;
        }
        const out = window.SlowskyEngine.render(session, idx, { mode: 'blink', a: 0, b: 0 });
        if (!out) {
            return c;
        }
        const tmp = document.createElement('canvas');
        tmp.width = out.width;
        tmp.height = out.height;
        const tctx = tmp.getContext('2d');
        if (typeof ImageData !== 'undefined' && out instanceof ImageData) {
            tctx.putImageData(out, 0, 0);
        } else if (out.width && out.height) {
            tctx.drawImage(out, 0, 0);
        }
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#05070d';
        ctx.fillRect(0, 0, size, size);
        const scale = Math.max(size / tmp.width, size / tmp.height);
        const dw = tmp.width * scale;
        const dh = tmp.height * scale;
        ctx.drawImage(tmp, (size - dw) / 2, (size - dh) / 2, dw, dh);
        return c;
    }

    function buildSessionPeekCache(session)
    {
        state.sessionThumbUrls = [];
        if (!session || !window.SlowskyEngine) {
            return;
        }
        for (let i = 0; i < session.frames.length; i++) {
            const c = makeSessionThumbCanvas(session, i, 132);
            state.sessionThumbUrls.push(c.toDataURL('image/png'));
        }
    }

    function showPeek(idx)
    {
        if (idx < 0 || idx >= visitPositions.length) {
            return;
        }
        if (state.ws === 'sky') {
            const v = window.FRAMES[state.target].visits[idx];
            peekImgEl.src = 'img/' + v.file;
            peekSpanEl.textContent = v.date;
        } else if (state.session && state.sessionThumbUrls[idx]) {
            peekImgEl.src = state.sessionThumbUrls[idx];
            peekSpanEl.textContent = getVisitDateLabel(idx);
        } else {
            return;
        }
        peekEl.style.left = visitPositions[idx].toFixed(3) + '%';
        peekEl.hidden = false;
    }

    function updateTimelineSelection(activeIdx)
    {
        const thumbs = datesThumbsEl.querySelectorAll('.thumb');
        thumbs.forEach((btn, i) => {
            btn.classList.toggle('on', i === activeIdx);
        });
        if (visitPositions[activeIdx] !== undefined) {
            playheadEl.style.left = visitPositions[activeIdx].toFixed(3) + '%';
            playheadEl.setAttribute('aria-valuenow', String(activeIdx + 1));
        }
    }

    function updateThumbAbMarkers()
    {
        const thumbs = datesThumbsEl.querySelectorAll('.thumb');
        thumbs.forEach((btn, i) => {
            btn.classList.remove('a', 'b');
            btn.querySelectorAll('.ab-tag').forEach((el) => el.remove());
            if (state.mode === 'subtract') {
                const isA = i === state.a;
                const isB = i === state.b;
                if (isA || isB) {
                    if (isA) {
                        btn.classList.add('a');
                    }
                    if (isB) {
                        btn.classList.add('b');
                    }
                    const tag = document.createElement('span');
                    tag.className = 'ab-tag';
                    tag.textContent = isA && isB ? 'AB' : (isA ? 'A' : 'B');
                    btn.appendChild(tag);
                }
            }
        });
        if (state.mode === 'subtract' && getFrameCount() > 0) {
            abEl.hidden = false;
            abAEl.textContent = getVisitDateLabel(state.a);
            abBEl.textContent = getVisitDateLabel(state.b);
        } else {
            abEl.hidden = true;
        }
    }

    function nearestVisitFromClientX(clientX)
    {
        const rect = datesLaneEl.getBoundingClientRect();
        if (rect.width <= 0 || visitPositions.length === 0) {
            return 0;
        }
        const pct = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < visitPositions.length; i++) {
            const dist = Math.abs(visitPositions[i] - pct);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    // ---------- Colour Track ----------
    function lamToPct(lam)
    {
        return ((lam - 0.40) / 4.60) * 100;
    }

    function pctToLam(pct)
    {
        return clamp(0.40 + (pct / 100) * 4.60, 0.40, 5.00);
    }

    function initColourTrack()
    {
        while (colourBandsEl.firstChild) {
            colourBandsEl.removeChild(colourBandsEl.firstChild);
        }
        bandEls = [];

        savedBandEl = document.createElement('div');
        savedBandEl.className = 'band saved';
        savedBandEl.title = 'Saved colour';
        colourBandsEl.appendChild(savedBandEl);

        (window.DETECTORS || []).forEach((range, idx) => {
            const b = document.createElement('div');
            b.className = 'band';
            const left = lamToPct(range[0]);
            const right = lamToPct(range[1]);
            b.style.left = left.toFixed(3) + '%';
            b.style.width = Math.max(0, right - left).toFixed(3) + '%';
            b.textContent = 'D' + String(idx + 1);
            colourBandsEl.appendChild(b);
            bandEls.push({ el: b, range: range });
        });

        syncColourToTarget();
    }

    function syncColourToTarget()
    {
        clearColourStageTimers();
        const t = window.FRAMES[state.target];
        const lam = t.lam;
        const left = clamp(lamToPct(lam[0]), 0, 100);
        const right = clamp(lamToPct(lam[1]), 0, 100);
        if (savedBandEl) {
            savedBandEl.style.left = left.toFixed(3) + '%';
            savedBandEl.style.width = Math.max(0, right - left).toFixed(3) + '%';
        }
        const mid = (lam[0] + lam[1]) / 2;
        setColourReadout(mid);
    }

    function setColourReadout(um)
    {
        state.colourUm = clamp(um, 0.40, 5.00);
        const pct = clamp(lamToPct(state.colourUm), 0, 100);
        colourThumbEl.style.left = pct.toFixed(3) + '%';
        colourThumbEl.setAttribute('aria-valuenow', state.colourUm.toFixed(2));
        colourReadoutEl.textContent = state.colourUm.toFixed(2) + ' \u00b5m';

        bandEls.forEach((item) => {
            const inside = state.colourUm >= item.range[0] && state.colourUm <= item.range[1];
            item.el.classList.toggle('on', inside);
        });
    }

    function clearColourStageTimers()
    {
        colourStageTimers.forEach((id) => clearTimeout(id));
        colourStageTimers = [];
    }

    function releaseColourThumb()
    {
        if (state.ws !== 'sky') {
            return;
        }
        const lam = window.FRAMES[state.target].lam;
        const mid = (lam[0] + lam[1]) / 2;
        if (state.colourUm >= lam[0] && state.colourUm <= lam[1]) {
            return;
        }
        clearColourStageTimers();
        const seq = [
            window.STAGE_TEXT.search,
            window.STAGE_TEXT.headers,
            window.STAGE_TEXT.pixels,
            window.STAGE_TEXT.regrid,
        ];
        seq.forEach((stageStr, idx) => {
            const tid = setTimeout(() => {
                showStatusLoad(stageStr);
            }, idx * 350);
            colourStageTimers.push(tid);
        });
        const doneId = setTimeout(() => {
            hideStatusLoad();
            showToast('Mockup: the live app loads this colour');
            setColourReadout(mid);
        }, seq.length * 350);
        colourStageTimers.push(doneId);
    }

    // ---------- Target Switch & Workspace Switch ----------
    function switchTarget(newId)
    {
        if (!window.FRAMES[newId]) {
            return Promise.resolve();
        }
        if (state.ws !== 'sky') {
            setWorkspace('sky', true);
        }
        statusCoordEl.textContent = '\u2014';
        if (state.target === newId && !skyEl.classList.contains('dim')) {
            return Promise.resolve();
        }

        const mySeq = ++switchSeq;
        switchPending = true;
        const busy = beginBusy(targetBtn, 'Loading ' + (window.COPY[newId] ? window.COPY[newId].display : 'the target'));
        switchBusy = busy;
        clearInterval(blinkTimer);
        blinkTimer = null;
        clearCandidates();

        skyEl.classList.add('dim');
        showStatusLoad(window.STAGE_TEXT.headers);

        const nextTarget = window.FRAMES[newId];
        const preloads = nextTarget.visits.map((v) => {
            const im = new Image();
            im.src = 'img/' + v.file;
            getImgDataElement(v.file);
            if (typeof im.decode === 'function') {
                return im.decode().catch(() => {});
            }
            return Promise.resolve();
        });

        return Promise.all(preloads).then(() => {
            endBusy(busy);
            if (mySeq !== switchSeq) {
                return;
            }
            switchPending = false;
            state.target = newId;
            const n = nextTarget.visits.length;
            state.index = n - 1;
            state.a = 0;
            state.b = Math.max(0, n - 1);
            state.abNext = 'a';
            resetView();

            updateTargetChrome();
            syncColourToTarget();
            buildTimeline();
            syncHash();

            skyEl.classList.remove('dim');
            hideStatusLoad();

            skyEl.classList.remove('plate-in');
            void skyEl.getBoundingClientRect();
            skyEl.classList.add('plate-in');
            setTimeout(() => {
                skyEl.classList.remove('plate-in');
            }, 250);

            player.setTarget(newId);
            updateRingAndTrail(state.index, true);

            if (state.mode !== 'blink') {
                renderCurrentView();
            } else {
                setSkyLayersVisible(true);
                restartBlinkTimer();
            }
            updateToolStates();
            renderInspectorAll();
            announce((window.COPY[newId] ? window.COPY[newId].display : newId) + ', ' + n + ' dates');
        });
    }

    function setWorkspace(nextWs, skipRender)
    {
        if (nextWs !== 'sky' && nextWs !== 'mine') {
            return;
        }
        if (state.hold) {
            endHold();
        }
        state.ws = nextWs;
        // The last pointer reading belongs to the other workspace's picture.
        statusCoordEl.textContent = '\u2014';
        wsSkyBtn.setAttribute('aria-selected', nextWs === 'sky' ? 'true' : 'false');
        wsMineBtn.setAttribute('aria-selected', nextWs === 'mine' ? 'true' : 'false');

        clearCandidates();
        resetView();

        if (nextWs === 'mine') {
            clearInterval(blinkTimer);
            blinkTimer = null;
            minimapEl.hidden = true;
            caveatEl.hidden = true;
            coachEl.hidden = true;
            trackColourEl.hidden = true;
            ringEl.classList.add('off');
            trailEl.classList.add('off');

            if (state.session && state.session.frames.length > 0) {
                const n = state.session.frames.length;
                state.index = clamp(state.index, 0, n - 1);
                state.a = 0;
                state.b = Math.max(0, n - 1);
            } else {
                state.index = 0;
                state.playing = false;
            }
        } else {
            minimapEl.hidden = false;
            caveatEl.hidden = false;
            trackColourEl.hidden = false;
            const n = window.FRAMES[state.target].visits.length;
            state.index = clamp(state.index, 0, n - 1);
            state.a = 0;
            state.b = Math.max(0, n - 1);
            updateRingAndTrail(state.index, false);
        }

        updateTargetChrome();
        buildTimeline();
        updateModeControls();
        syncHash();

        if (!skipRender) {
            renderCurrentView();
            restartBlinkTimer();
            renderInspectorAll();
        }
    }

    // ---------- Upload & Jobs Queue ----------
    function processFiles(files, isSample)
    {
        if (!files || files.length === 0) {
            return;
        }
        if (!window.SlowskyEngine) {
            showToast('Processing engine not loaded');
            return;
        }

        if (state.ws !== 'mine') {
            setWorkspace('mine', true);
        }

        clearTimeout(jobsHideTimer);
        if (uploadAbort) {
            uploadAbort.abort();
        }
        const ctrl = new AbortController();
        uploadAbort = ctrl;
        lastUploadBatch = { files: files, isSample: Boolean(isSample) };

        const stages = window.SlowskyEngine.STAGES || [
            'read', 'header', 'decode', 'size', 'align', 'stretch', 'ready',
        ];

        while (jobsListEl.firstChild) {
            jobsListEl.removeChild(jobsListEl.firstChild);
        }
        jobsCountEl.textContent = files.length === 1 ? '1 file' : files.length + ' files';
        jobsCancelBtn.textContent = 'Cancel';
        jobsEl.hidden = false;
        showStatusLoad(window.STAGE_TEXT.headers);
        const uploadBusy = beginBusy(uploadBtn, files.length === 1 ? 'Processing 1 file' : 'Processing ' + files.length + ' files');
        ctrl.signal.addEventListener('abort', () => {
            endBusy(uploadBusy);
        });

        const jobRecords = files.map((file) => {
            const li = document.createElement('li');
            li.className = 'job';

            const top = document.createElement('div');
            top.className = 'job-top';
            const iconSvg = document.createElementNS(SVG_NS, 'svg');
            iconSvg.setAttribute('class', 'ic');
            const useEl = document.createElementNS(SVG_NS, 'use');
            useEl.setAttribute('href', '#i-file');
            iconSvg.appendChild(useEl);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'job-name';
            nameSpan.textContent = file.name;

            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'faint num';
            sizeSpan.textContent = formatBytes(file.size);

            top.appendChild(iconSvg);
            top.appendChild(nameSpan);
            top.appendChild(sizeSpan);

            const stagesRow = document.createElement('div');
            stagesRow.className = 'job-stages';
            const chips = stages.map((st) => {
                const chip = document.createElement('span');
                chip.className = 'chip';
                chip.dataset.stage = st;
                chip.textContent = st;
                stagesRow.appendChild(chip);
                return chip;
            });

            const bar = document.createElement('div');
            bar.className = 'job-bar';
            const barFill = document.createElement('i');
            barFill.style.setProperty('--p', '0%');
            bar.appendChild(barFill);

            li.appendChild(top);
            li.appendChild(stagesRow);
            li.appendChild(bar);
            jobsListEl.appendChild(li);

            return {
                file: file,
                li: li,
                chips: chips,
                barFill: barFill,
                lastStageIdx: 0,
                errored: false,
            };
        });

        let hasAnyError = false;

        function markJobError(rec, reason)
        {
            if (!rec || rec.errored) {
                return;
            }
            rec.errored = true;
            hasAnyError = true;
            rec.li.classList.add('err');
            const errChip = rec.chips[rec.lastStageIdx] || rec.chips[0];
            if (errChip) {
                errChip.classList.remove('now', 'done');
                errChip.classList.add('err');
            }
            rec.barFill.style.setProperty('--p', '100%');

            const why = document.createElement('div');
            why.className = 'job-why';
            why.textContent = String(reason || 'Could not read file') + ' ';

            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'btn sm';
            retryBtn.textContent = 'Retry';
            retryBtn.addEventListener('click', () => {
                if (lastUploadBatch) {
                    processFiles(lastUploadBatch.files, lastUploadBatch.isSample);
                }
            });
            why.appendChild(retryBtn);
            rec.li.appendChild(why);
        }

        function updateJobStage(rec, stageName, info)
        {
            if (!rec || rec.errored) {
                return;
            }
            if (stageName === 'error' || (info && info.error)) {
                const msg = (info && (info.error.message || info.error || info.reason)) || 'Processing error';
                markJobError(rec, msg);
                return;
            }
            const sIdx = stages.indexOf(stageName);
            if (sIdx === -1) {
                return;
            }
            rec.lastStageIdx = sIdx;
            const finished = stageName === 'ready';
            rec.chips.forEach((chip, k) => {
                chip.classList.remove('done', 'now', 'err');
                if (finished || k < sIdx) {
                    chip.classList.add('done');
                } else if (k === sIdx) {
                    chip.classList.add('now');
                }
            });
            const pct = finished ? 100 : Math.round(((sIdx + 0.6) / stages.length) * 100);
            rec.barFill.style.setProperty('--p', pct + '%');
        }

        window.SlowskyEngine.process(files, {
            signal: ctrl.signal,
            onJob: (jobIdx, stage, info) => {
                showStatusLoad('Stage: ' + stage);
                setBusyText(uploadBusy, (files.length === 1 ? 'Processing 1 file: ' : 'Processing ' + files.length + ' files: ') + stage);
                if (typeof jobIdx === 'number' && jobIdx >= 0 && jobIdx < jobRecords.length) {
                    updateJobStage(jobRecords[jobIdx], stage, info);
                } else {
                    jobRecords.forEach((rec) => updateJobStage(rec, stage, info));
                }
            },
        }).then((session) => {
            endBusy(uploadBusy);
            if (ctrl.signal.aborted) {
                return;
            }
            hideStatusLoad();
            jobRecords.forEach((rec) => {
                if (!rec.errored) {
                    updateJobStage(rec, 'ready', null);
                }
            });

            if (!session || !session.frames || session.frames.length === 0) {
                if (!hasAnyError && jobRecords[0]) {
                    markJobError(jobRecords[0], 'No readable image frames');
                }
                jobsCancelBtn.textContent = 'Close';
                renderCurrentView();
                return;
            }

            state.session = session;
            forgetMineSteps();
            state.sessionSizes = files.map((f) => f.size || 0);
            buildSessionPeekCache(session);

            wsCountEl.textContent = String(session.frames.length);
            // The visitor may have gone back to the library while this ran: then leave that view alone.
            // setWorkspace('mine') picks the new session up when they come back.
            if (state.ws === 'mine') {
                state.index = session.frames.length - 1;
                state.a = 0;
                state.b = Math.max(0, session.frames.length - 1);
                state.abNext = 'a';
                clearCandidates();

                if (!reducedMotion && state.mode === 'blink' && session.frames.length > 1) {
                    state.playing = true;
                } else {
                    state.playing = false;
                }

                buildTimeline();
                updateTargetChrome();
                updateModeControls();
                renderCurrentView();
                restartBlinkTimer();
                renderInspectorAll();
                syncHash();
            }

            if (hasAnyError) {
                jobsCancelBtn.textContent = 'Close';
            } else {
                jobsHideTimer = setTimeout(() => {
                    jobsEl.hidden = true;
                }, 900);
            }
        }).catch((err) => {
            endBusy(uploadBusy);
            hideStatusLoad();
            if (ctrl.signal.aborted) {
                return;
            }
            if (!hasAnyError) {
                const activeRec = jobRecords.find((r) => !r.errored) || jobRecords[0];
                markJobError(activeRec, err && err.message ? err.message : String(err));
            }
            jobsCancelBtn.textContent = 'Close';
            renderCurrentView();
        });
    }

    // Three real SPHEREx FITS cutouts (samplefits.js, base64), run through the full pipeline with alignment.
    function runSampleFits()
    {
        if (!window.SlowskyEngine) {
            showToast('Processing engine not loaded');
            return;
        }
        if (!window.SAMPLE_FITS) {
            showToast('Could not load sample files');
            return;
        }
        const files = Object.keys(window.SAMPLE_FITS).map((name) => {
            const bin = atob(window.SAMPLE_FITS[name]);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) {
                bytes[i] = bin.charCodeAt(i);
            }
            return new File([bytes], name, { type: 'application/fits' });
        });
        processFiles(files, true);
    }

    function runSampleFiles()
    {
        if (!window.SlowskyEngine) {
            showToast('Processing engine not loaded');
            return;
        }
        const visits = window.FRAMES.barnard.visits;
        Promise.all(visits.map((v) => {
            const url = window.IMG_DATA && window.IMG_DATA[v.file];
            return dataUrlToBlob(url).then((blob) => {
                const ms = parseVisitDate(v.date).getTime();
                return new File([blob], v.file, { type: 'image/png', lastModified: ms });
            });
        })).then((files) => {
            processFiles(files, true);
        }).catch((err) => {
            showToast(err && err.message ? err.message : 'Could not load sample files');
        });
    }

    // ---------- Sky Coordinates, Loupe & Hold ----------
    function getSkyImageBox()
    {
        const rect = skyEl.getBoundingClientRect();
        let imgW = 480;
        let imgH = 480;
        if (state.ws === 'mine' && state.session) {
            imgW = state.session.width;
            imgH = state.session.height;
        }
        let boxLeft = rect.left;
        let boxTop = rect.top;
        let boxW = rect.width;
        let boxH = rect.height;

        if (imgW > imgH && imgW > 0) {
            boxH = rect.height * (imgH / imgW);
            boxTop = rect.top + (rect.height - boxH) / 2;
        } else if (imgH > imgW && imgH > 0) {
            boxW = rect.width * (imgW / imgH);
            boxLeft = rect.left + (rect.width - boxW) / 2;
        }
        return { rect, boxLeft, boxTop, boxW, boxH, imgW, imgH };
    }

    function updateSkyCoordAt(clientX, clientY)
    {
        if (getFrameCount() === 0) {
            statusCoordEl.textContent = '\u2014';
            return;
        }
        const box = getSkyImageBox();
        if (box.boxW <= 0 || box.boxH <= 0) {
            return;
        }
        const u = clamp((clientX - box.boxLeft) / box.boxW, 0, 1);
        const v = clamp((clientY - box.boxTop) / box.boxH, 0, 1);

        if (state.ws === 'sky') {
            const dxArcsec = (0.5 - u) * 360;
            const dyArcsec = (0.5 - v) * 360;
            const ew = dxArcsec >= 0 ? 'E' : 'W';
            const ns = dyArcsec >= 0 ? 'N' : 'S';
            statusCoordEl.textContent = Math.abs(dxArcsec).toFixed(1) + '\u2033 ' + ew + ', '
                + Math.abs(dyArcsec).toFixed(1) + '\u2033 ' + ns + ' of centre';
        } else if (state.session) {
            const s = state.session;
            const dispIdx = getDisplayedIndex();
            const frame = s.frames[dispIdx] || s.frames[0];
            const px = clamp(Math.floor(u * s.width), 0, s.width - 1);
            const py = clamp(Math.floor(v * s.height), 0, s.height - 1);
            let valText = '\u2014';
            if (frame && frame.data) {
                const shown = readoutValue(s, frame, px, py);
                const val = shown.value;
                if (Number.isFinite(val)) {
                    const absV = Math.abs(val);
                    let numStr = '0.00';
                    if (absV >= 100) {
                        numStr = val.toFixed(1);
                    } else if (absV >= 0.01 || val === 0) {
                        numStr = val.toFixed(2);
                    } else {
                        numStr = val.toExponential(2);
                    }
                    const unit = frame.kind === 'fits' ? (frame.unit || (frame.meta && frame.meta.bunit) || '') : '';
                    numStr = numStr.replace('-', '\u2212');
                    valText = shown.label + (unit ? numStr + ' ' + unit : numStr) + shown.after;
                }
            }
            statusCoordEl.textContent = 'x ' + px + ', y ' + py + ' \u00b7 ' + valText;
        }
    }

    // The number under the pointer must be the one behind the picture on screen: one frame (background
    // removed), the Stack mean, or the Subtract change B − A (median-centred, as drawn).
    let readoutDiffCache = null;
    function readoutValue(s, frame, px, py)
    {
        const i = py * s.width + px;
        const mode = state.hold ? 'blink' : state.mode;
        if (mode === 'stack') {
            let sum = 0;
            let count = 0;
            s.frames.forEach((f, fi) => {
                if (s.shifts && s.shifts[fi] && s.shifts[fi].ok === false) {
                    return;
                }
                const v = f.data[i];
                if (Number.isFinite(v)) {
                    sum += v;
                    count++;
                }
            });
            return { value: count ? sum / count : NaN, label: 'mean ', after: ' above background' };
        }
        if (mode === 'subtract' && window.SlowskyEngine && window.SlowskyEngine.difference) {
            const c = readoutDiffCache;
            if (!c || c.session !== s || c.a !== state.a || c.b !== state.b) {
                readoutDiffCache = { session: s, a: state.a, b: state.b,
                    data: window.SlowskyEngine.difference(s, state.a, state.b) };
            }
            return { value: readoutDiffCache.data[i], label: 'B \u2212 A ', after: '' };
        }
        return { value: frame.data[i], label: '', after: frame.kind === 'fits' ? ' above background' : '' };
    }

    function getCurrentLoupeSource()
    {
        const effectiveMode = state.hold ? 'blink' : state.mode;
        if (state.ws === 'sky' && effectiveMode === 'blink') {
            const dispIdx = getDisplayedIndex();
            const v = window.FRAMES[state.target].visits[dispIdx];
            return v ? getImgDataElement(v.file) : null;
        }
        if (!engineCanvas.hidden && engineCanvas.width > 0) {
            return engineCanvas;
        }
        return null;
    }

    function updateLoupeAt(clientX, clientY)
    {
        if (!state.loupe || getFrameCount() === 0) {
            loupeEl.hidden = true;
            return;
        }
        const src = getCurrentLoupeSource();
        if (!src) {
            loupeEl.hidden = true;
            return;
        }
        const srcW = src.naturalWidth || src.width;
        const srcH = src.naturalHeight || src.height;
        if (!srcW || !srcH) {
            loupeEl.hidden = true;
            return;
        }

        const box = getSkyImageBox();
        const stageRect = stageEl.getBoundingClientRect();
        const u = clamp((clientX - box.boxLeft) / box.boxW, 0, 1);
        const v = clamp((clientY - box.boxTop) / box.boxH, 0, 1);

        const localW = skyEl.clientWidth || 480;
        const localH = skyEl.clientHeight || 480;
        const uSky = (clientX - box.rect.left) / box.rect.width;
        const vSky = (clientY - box.rect.top) / box.rect.height;

        const invZoom = 1 / state.zoom;
        let offsetScreenX = 20;
        let offsetScreenY = 20;
        if (clientX + 174 > stageRect.right) {
            offsetScreenX = -170;
        }
        if (clientY + 174 > stageRect.bottom) {
            offsetScreenY = -170;
        }

        const leftLocal = uSky * localW + offsetScreenX * invZoom;
        const topLocal = vSky * localH + offsetScreenY * invZoom;

        loupeEl.style.left = leftLocal.toFixed(1) + 'px';
        loupeEl.style.top = topLocal.toFixed(1) + 'px';
        loupeEl.style.transformOrigin = '0 0';
        loupeEl.style.transform = state.zoom !== 1 ? 'scale(' + invZoom.toFixed(4) + ')' : '';

        loupeCtx.imageSmoothingEnabled = false;
        loupeCtx.fillStyle = '#05070d';
        loupeCtx.fillRect(0, 0, 75, 75);

        const cx = u * srcW;
        const cy = v * srcH;
        const sx = cx - 37.5;
        const sy = cy - 37.5;
        loupeCtx.drawImage(src, sx, sy, 75, 75, 0, 0, 75, 75);
        loupeEl.hidden = false;
    }

    function startHold()
    {
        if (state.hold || getFrameCount() < 2) {
            return;
        }
        state.hold = true;
        state.holdPrevIndex = state.index;
        state.holdWasPlaying = state.playing;
        clearInterval(blinkTimer);
        blinkTimer = null;

        const holdBtn = toolsEl.querySelector('[data-tool="hold"]');
        if (holdBtn) {
            holdBtn.classList.add('held');
        }
        renderCurrentView();
    }

    function endHold()
    {
        if (!state.hold) {
            return;
        }
        state.hold = false;
        const holdBtn = toolsEl.querySelector('[data-tool="hold"]');
        if (holdBtn) {
            holdBtn.classList.remove('held');
        }
        renderCurrentView();
        if (state.holdWasPlaying && state.mode === 'blink') {
            state.playing = true;
            restartBlinkTimer();
        }
    }

    // ---------- Inspector ----------
    function setInspectorOpen(open)
    {
        state.inspect = Boolean(open);
        inspectorEl.hidden = !state.inspect;
        workEl.classList.toggle('inspecting', state.inspect);
        updateToolStates();
        if (state.inspect) {
            renderInspectorAll();
        }
    }

    function selectInspectorTab(tabName)
    {
        state.tab = tabName;
        inspectorEl.querySelectorAll('[data-tab]').forEach((btn) => {
            btn.setAttribute('aria-selected', btn.dataset.tab === tabName ? 'true' : 'false');
        });
        tabInfoEl.hidden = tabName !== 'info';
        tabFrameEl.hidden = tabName !== 'frame';
        tabCandsEl.hidden = tabName !== 'cands';
        tabAiEl.hidden = tabName !== 'ai';
        tabChartsEl.hidden = tabName !== 'charts';
        tabExtrasEl.hidden = tabName !== 'extras';
        if (tabName === 'charts') {
            renderInspectorCharts();
        } else if (tabName === 'extras') {
            renderInspectorExtras();
        }
    }

    function renderInspectorCharts()
    {
        while (tabChartsEl.firstChild) {
            tabChartsEl.removeChild(tabChartsEl.firstChild);
        }
        callPanel('charts', tabChartsEl);
    }

    function renderInspectorExtras()
    {
        while (tabExtrasEl.firstChild) {
            tabExtrasEl.removeChild(tabExtrasEl.firstChild);
        }
        callPanel('extras', tabExtrasEl);
    }

    function appendKvRow(dl, label, valueNodeOrStr)
    {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        if (typeof valueNodeOrStr === 'string') {
            dd.textContent = valueNodeOrStr;
        } else {
            dd.appendChild(valueNodeOrStr);
        }
        dl.appendChild(dt);
        dl.appendChild(dd);
    }

    function renderInspectorInfo()
    {
        renderInspectorInfoBase();
        callPanel('targetExtras', tabInfoEl);
    }

    function renderInspectorInfoBase()
    {
        while (tabInfoEl.firstChild) {
            tabInfoEl.removeChild(tabInfoEl.firstChild);
        }
        if (state.ws === 'sky') {
            const t = window.FRAMES[state.target];
            const copy = window.COPY[state.target];

            const h3 = document.createElement('h3');
            h3.textContent = copy.headline;
            const pShow = document.createElement('p');
            pShow.textContent = copy.show;
            const pNot = document.createElement('p');
            pNot.textContent = copy.not;

            const dl = document.createElement('dl');
            dl.className = 'kv';

            const posText = 'RA ' + t.ra.toFixed(4) + '\u00b0, Dec ' + formatSigned(t.dec, 4) + '\u00b0';
            const copyPosBtn = document.createElement('button');
            copyPosBtn.type = 'button';
            copyPosBtn.textContent = posText;
            copyPosBtn.addEventListener('click', () => {
                copyText(posText, 'Copied');
            });

            const pmText = 'RA ' + formatSigned(t.pmRa, 1) + ', Dec ' + formatSigned(t.pmDec, 1) + ' mas/yr';
            const lamText = t.lam[0].toFixed(2) + '\u2013' + t.lam[1].toFixed(2) + ' \u00b5m';

            appendKvRow(dl, 'Target', t.name);
            appendKvRow(dl, 'Catalogue position (frames.js)', copyPosBtn);
            appendKvRow(dl, 'Proper motion', pmText);
            appendKvRow(dl, 'Visits', String(t.visits.length));
            appendKvRow(dl, 'Saved colour', lamText);
            appendKvRow(dl, 'Detector', 'D' + String(t.detector));

            tabInfoEl.appendChild(h3);
            tabInfoEl.appendChild(pShow);
            tabInfoEl.appendChild(pNot);
            tabInfoEl.appendChild(dl);
        } else {
            const h3 = document.createElement('h3');
            h3.textContent = 'My frames';
            tabInfoEl.appendChild(h3);

            if (!state.session || state.session.frames.length === 0) {
                const p = document.createElement('p');
                p.textContent = 'No frames loaded yet.';
                tabInfoEl.appendChild(p);
                return;
            }

            const s = state.session;
            const totalBytes = state.sessionSizes.reduce((acc, v) => acc + v, 0);
            const datedCount = s.frames.filter((f) => f.date instanceof Date && !Number.isNaN(f.date.getTime())).length;
            const alignedCount = (s.shifts || []).filter((sh) => sh && sh.ok).length;

            const dl = document.createElement('dl');
            dl.className = 'kv';
            appendKvRow(dl, 'Files', String(s.frames.length));
            appendKvRow(dl, 'Total size', formatBytes(totalBytes));
            appendKvRow(dl, 'Dated', datedCount + ' / ' + s.frames.length);
            appendKvRow(dl, 'Dimensions', s.width + '\u00d7' + s.height + ' px');
            appendKvRow(dl, 'Alignment', alignedCount + ' / ' + s.frames.length + ' lined up');
            tabInfoEl.appendChild(dl);
        }
    }

    function renderInspectorFrame()
    {
        renderInspectorFrameBase();
        callPanel('frameExtras', tabFrameEl);
    }

    function renderInspectorFrameBase()
    {
        while (tabFrameEl.firstChild) {
            tabFrameEl.removeChild(tabFrameEl.firstChild);
        }
        const idx = getDisplayedIndex();

        if (state.ws === 'sky') {
            const t = window.FRAMES[state.target];
            const v = t.visits[idx] || t.visits[0];

            if (state.mode === 'stack' || state.mode === 'subtract') {
                const rough = document.createElement('p');
                rough.className = 'help-line';
                rough.textContent = 'Stack and Subtract here use the saved display pictures, so the maths is rough.';
                tabFrameEl.appendChild(rough);
            }

            const dl = document.createElement('dl');
            dl.className = 'kv';
            appendKvRow(dl, 'Date', v.date);
            appendKvRow(dl, 'Observation ID', v.obsId);
            appendKvRow(dl, 'Visit stack', v.frames === 1 ? '1 exposure in this visit' : v.frames + ' exposures in this visit');
            appendKvRow(dl, 'Size', '480\u00d7480 px');
            appendKvRow(dl, 'Kind', 'PNG \u00b7 D' + String(t.detector));
            appendKvRow(dl, 'Shift applied', 'dx 0.0, dy 0.0 px');
            tabFrameEl.appendChild(dl);
        } else {
            if (!state.session || state.session.frames.length === 0) {
                const p = document.createElement('p');
                p.textContent = 'No frame loaded.';
                tabFrameEl.appendChild(p);
                return;
            }
            const s = state.session;
            const f = s.frames[idx] || s.frames[0];
            const sh = s.shifts && s.shifts[idx];
            const shiftText = sh && sh.ok
                ? 'dx ' + formatMinus(sh.dx, 1) + ', dy ' + formatMinus(sh.dy, 1) + ' px'
                : 'not lined up';

            const dl = document.createElement('dl');
            dl.className = 'kv';
            appendKvRow(dl, 'Date', f.dateSource === 'file' ? formatUtcDate(f.date) + ' (file date)' : f.dateSource === 'none' ? 'unknown' : formatUtcDate(f.date));
            appendKvRow(dl, 'File', f.name);
            appendKvRow(dl, 'Size', f.width + '\u00d7' + f.height + ' px');
            appendKvRow(dl, 'Kind', (f.kind || 'file').toUpperCase());
            appendKvRow(dl, 'Shift applied', shiftText);
            tabFrameEl.appendChild(dl);

            const notices = [];
            if (Array.isArray(s.notes)) {
                s.notes.forEach((n) => notices.push(n));
            }
            if (Array.isArray(f.warnings)) {
                f.warnings.forEach((w) => notices.push(w));
            }
            if (f.dateSource === 'file') {
                notices.push('This picture has no observation date, so the date is when the file was last saved. It may not be when the sky was photographed.');
            }
            if (notices.length > 0) {
                const ul = document.createElement('ul');
                ul.className = 'warn-list';
                notices.forEach((msg) => {
                    const li = document.createElement('li');
                    li.textContent = msg;
                    ul.appendChild(li);
                });
                tabFrameEl.appendChild(ul);
            }
        }
    }

    // Short tags for candidates that are weaker evidence (the engine already ranks them lower); explained once above
    // the list so the same sentence is not repeated on every row.
    const CAND_TAGS = {
        edge: {
            tag: 'edge or blank pixel',
            line: 'Edge or blank pixel: the spot touches the picture edge or a pixel with no value (often a too-bright star\u2019s centre), so check it by eye.',
        },
        single: {
            tag: '1 pixel',
            line: '1 pixel: a spot this small is often a cosmic ray or a hot pixel, not something in the sky.',
        },
    };

    function candTagKey(c)
    {
        if (c.edge) {
            return 'edge';
        }
        if (c.pixels === 1) {
            return 'single';
        }
        return '';
    }

    function sigmaText(value, rough)
    {
        // Past ~1000 the number says nothing more (often a too-bright star or a mismatch), so it is capped in words.
        if (value >= 1000) {
            return 'over 1000\u03c3';
        }
        return (rough ? '\u2248' : '') + value.toFixed(1) + '\u03c3';
    }

    function renderInspectorCands()
    {
        while (tabCandsEl.firstChild) {
            tabCandsEl.removeChild(tabCandsEl.firstChild);
        }
        const helpP = document.createElement('p');
        helpP.className = 'help-line';
        helpP.textContent = window.CONTROL_HELP.changes.line;
        tabCandsEl.appendChild(helpP);

        if (state.mode !== 'subtract') {
            const note = document.createElement('p');
            note.textContent = 'Switch to Subtract (D) and press Candidates to list candidate changes.';
            tabCandsEl.appendChild(note);
            return;
        }

        if (!state.candsEvaluated) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn sm';
            btn.textContent = 'Candidate changes';
            btn.addEventListener('click', () => {
                runCandidates(false);
            });
            tabCandsEl.appendChild(btn);
            return;
        }

        if (state.cands.length === 0) {
            const emptyP = document.createElement('p');
            emptyP.textContent = 'No candidates above 5\u03c3 for this pair.';
            tabCandsEl.appendChild(emptyP);
            return;
        }

        // Display pictures (PNG/JPG, incl. the saved library copies) are already stretched, so their noise is not
        // the camera's noise: the sigma figure is only a ranking there, never a measurement.
        const candSess = state.ws === 'sky' ? state.libSessions[state.target] : state.session;
        const rough = !candSess || candSess.frames.some((f) => f.kind !== 'fits');
        if (rough) {
            const roughP = document.createElement('p');
            roughP.className = 'help-line';
            roughP.textContent = 'These are display pictures, so the \u03c3 figures are rough: use them to choose where to look, not as measurements.';
            tabCandsEl.appendChild(roughP);
        }
        const pairShifts = candSess && candSess.shifts ? [candSess.shifts[state.a], candSess.shifts[state.b]] : [];
        if (pairShifts.some((sh) => sh && sh.ok === false)) {
            const alignP = document.createElement('p');
            alignP.className = 'help-line';
            alignP.textContent = 'One of these two frames could not be lined up, so stars can show as false orange and blue pairs.';
            tabCandsEl.appendChild(alignP);
        }
        const pairFrames = candSess ? [candSess.frames[state.a], candSess.frames[state.b]] : [];
        if (pairFrames.some((f) => f && f.dateSource === 'file')) {
            const dateP = document.createElement('p');
            dateP.className = 'help-line';
            dateP.textContent = 'A date here comes from the file, not the observation, so “later” may not be the order the sky was photographed.';
            tabCandsEl.appendChild(dateP);
        }
        ['edge', 'single'].forEach((key) => {
            if (state.cands.some((c) => candTagKey(c) === key)) {
                const tagP = document.createElement('p');
                tagP.className = 'help-line';
                tagP.textContent = CAND_TAGS[key].line;
                tabCandsEl.appendChild(tagP);
            }
        });
        state.cands.forEach((c, idx) => {
            const signClass = c.sign === 'fainter' ? 'fainter' : 'brighter';
            const signWords = c.sign === 'fainter' ? 'fainter later' : 'brighter later';
            const sigmaVal = getCandSigma(c);

            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'cand-row ' + signClass;

            const nSpan = document.createElement('span');
            nSpan.className = 'n';
            nSpan.textContent = String(idx + 1);

            const labelSpan = document.createElement('span');
            labelSpan.className = 'what';
            labelSpan.textContent = 'Candidate ' + (idx + 1) + ' \u00b7 ' + signWords;
            const tagKey = candTagKey(c);
            if (tagKey) {
                const cautionEl = document.createElement('small');
                cautionEl.textContent = CAND_TAGS[tagKey].tag;
                labelSpan.appendChild(cautionEl);
            }

            const sepSpan = document.createElement('span');
            sepSpan.className = 'sr';
            sepSpan.textContent = ' \u00b7 ';

            const sigSpan = document.createElement('span');
            sigSpan.className = 'sig';
            sigSpan.textContent = sigmaText(sigmaVal, rough);

            row.appendChild(nSpan);
            row.appendChild(row.ownerDocument.createTextNode(' '));
            row.appendChild(labelSpan);
            row.appendChild(sepSpan);
            row.appendChild(sigSpan);

            row.addEventListener('click', () => {
                const isOn = row.classList.toggle('on');
                const marker = candsEl.querySelector('[data-cand-index="' + idx + '"]');
                if (marker) {
                    marker.classList.toggle('on', isOn);
                }
            });

            tabCandsEl.appendChild(row);
        });
    }

    function renderInspectorAi()
    {
        renderInspectorAiBase();
        callPanel('aiExtras', tabAiEl);
    }

    function renderInspectorAiBase()
    {
        while (tabAiEl.firstChild) {
            tabAiEl.removeChild(tabAiEl.firstChild);
        }
        const badge = document.createElement('span');
        badge.className = 'ai-label';
        badge.textContent = 'AI note';

        const helpP = document.createElement('p');
        helpP.className = 'help-line';
        helpP.textContent = window.CONTROL_HELP.aiNote.line;

        const box = document.createElement('div');
        box.className = 'ai-box';
        box.textContent = 'Mockup: no AI note is written here. In the live app, Claude writes this note from the numbers the page measured, and the heading names the exact Claude model.';

        tabAiEl.appendChild(badge);
        tabAiEl.appendChild(helpP);
        tabAiEl.appendChild(box);
    }

    function renderInspectorAll()
    {
        renderInspectorInfo();
        renderInspectorFrame();
        renderInspectorCands();
        if (state.tab === 'charts') {
            renderInspectorCharts();
        } else if (state.tab === 'extras') {
            renderInspectorExtras();
        }
    }

    // ---------- Help, Tooltips & Glossary ----------
    function getHelpDescriptor(el)
    {
        if (!el) {
            return null;
        }
        const helpId = el.dataset.helpId;
        const ch = helpId && window.CONTROL_HELP ? window.CONTROL_HELP[helpId] : null;

        let cleanText = '';
        const clone = el.cloneNode(true);
        clone.querySelectorAll('kbd, .count').forEach((n) => n.remove());
        cleanText = (clone.textContent || '').trim();

        const name = el.getAttribute('aria-label') || cleanText || (ch && ch.name) || '';
        const key = el.dataset.key || (el.querySelector('kbd') ? el.querySelector('kbd').textContent.trim() : '');
        const line = el.dataset.help || (ch && ch.line) || '';
        if (!line) {
            return null;
        }
        return { name: ch ? ch.name : name, tipName: name || (ch && ch.name) || '', key: key, line: line };
    }

    function escapeRegex(s)
    {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function buildTermRegex(id, findStr)
    {
        const startsWord = /^[A-Za-z0-9]/.test(findStr);
        const endsWord = /[A-Za-z0-9]$/.test(findStr);
        const allowPlural = id === 'frame' || id === 'pixel' || id === 'candidate' || id === 'catalogueStar';
        const core = escapeRegex(findStr) + (allowPlural ? 's?' : '');
        const pre = startsWord ? '(^|[^A-Za-z0-9])' : '(^|[^A-Za-z])';
        const post = endsWord ? '(?=$|[^A-Za-z0-9])' : '(?=$|[^A-Za-z])';
        return new RegExp(pre + '(' + core + ')' + post, 'i');
    }

    function buildHelpNodesWithGlossary(name, line)
    {
        const frag = document.createDocumentFragment();
        if (name) {
            const b = document.createElement('b');
            b.textContent = name;
            frag.appendChild(b);
        }

        let segments = [{ text: line, termId: null }];
        const order = window.TERM_ORDER || [];
        const gloss = window.GLOSSARY || {};

        order.forEach((id) => {
            const entry = gloss[id];
            if (!entry || !entry.find) {
                return;
            }
            const re = buildTermRegex(id, entry.find);
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                if (seg.termId !== null) {
                    continue;
                }
                const m = re.exec(seg.text);
                if (m) {
                    const prefixLen = m[1].length;
                    const matchStart = m.index + prefixLen;
                    const matchText = m[2];
                    const before = seg.text.slice(0, matchStart);
                    const after = seg.text.slice(matchStart + matchText.length);
                    const nextSegs = [];
                    if (before) {
                        nextSegs.push({ text: before, termId: null });
                    }
                    nextSegs.push({ text: matchText, termId: id });
                    if (after) {
                        nextSegs.push({ text: after, termId: null });
                    }
                    segments.splice(i, 1, ...nextSegs);
                    break;
                }
            }
        });

        segments.forEach((seg) => {
            if (!seg.termId) {
                frag.appendChild(document.createTextNode(seg.text));
            } else {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'term';
                btn.dataset.term = seg.termId;
                btn.textContent = seg.text;
                frag.appendChild(btn);
            }
        });

        return frag;
    }

    function setStatusHelp(name, line)
    {
        const sig = name + '|' + line;
        if (sig === currentHelpSignature) {
            return;
        }
        currentHelpSignature = sig;
        clearTimeout(helpSwapTimer);

        const applyContent = () => {
            while (statusHelpEl.firstChild) {
                statusHelpEl.removeChild(statusHelpEl.firstChild);
            }
            statusHelpEl.appendChild(buildHelpNodesWithGlossary(name, line));
            statusHelpEl.classList.remove('swap-out');
        };

        if (!firstHelpRendered || reducedMotion) {
            firstHelpRendered = true;
            applyContent();
        } else {
            statusHelpEl.classList.add('swap-out');
            helpSwapTimer = setTimeout(applyContent, 120);
        }
    }

    function setStatusHelpDefault()
    {
        const entry = window.CONTROL_HELP[state.mode] || window.CONTROL_HELP.blink;
        setStatusHelp(entry.name, entry.line);
    }

    function showTooltipFor(el)
    {
        const desc = getHelpDescriptor(el);
        if (!desc) {
            return;
        }
        while (tipEl.firstChild) {
            tipEl.removeChild(tipEl.firstChild);
        }
        const b = document.createElement('b');
        b.textContent = desc.tipName;
        tipEl.appendChild(b);

        if (desc.key) {
            const kbd = document.createElement('kbd');
            kbd.textContent = desc.key;
            tipEl.appendChild(kbd);
        }

        const span = document.createElement('span');
        span.className = 'tip-line';
        span.textContent = desc.line;
        tipEl.appendChild(span);

        tipEl.style.left = '0px';
        tipEl.style.top = '0px';
        tipEl.hidden = false;

        const r = el.getBoundingClientRect();
        const tw = tipEl.offsetWidth;
        const th = tipEl.offsetHeight;
        let left = r.left + r.width / 2 - tw / 2;
        let top = r.top - th - 8;

        if (top < 8) {
            if (r.bottom + th + 8 <= window.innerHeight - 8) {
                top = r.bottom + 8;
            } else {
                left = r.right + 8;
                top = r.top + r.height / 2 - th / 2;
            }
        }
        left = clamp(left, 8, Math.max(8, window.innerWidth - tw - 8));
        top = clamp(top, 8, Math.max(8, window.innerHeight - th - 8));
        tipEl.style.left = Math.round(left) + 'px';
        tipEl.style.top = Math.round(top) + 'px';
    }

    function hideTooltip()
    {
        clearTimeout(tipTimer);
        tipTarget = null;
        tipEl.hidden = true;
    }

    function openGlossary(termId, anchorEl)
    {
        const entry = window.GLOSSARY && window.GLOSSARY[termId];
        if (!entry) {
            return;
        }
        while (glossEl.firstChild) {
            glossEl.removeChild(glossEl.firstChild);
        }
        const b = document.createElement('b');
        b.textContent = entry.term;
        glossEl.appendChild(b);
        glossEl.appendChild(document.createTextNode(entry.short));

        glossEl.style.left = '0px';
        glossEl.style.top = '0px';
        glossEl.hidden = false;

        const r = anchorEl.getBoundingClientRect();
        const gw = glossEl.offsetWidth;
        const gh = glossEl.offsetHeight;
        const left = clamp(r.left, 8, Math.max(8, window.innerWidth - gw - 8));
        let top = r.top - gh - 8;
        if (top < 8) {
            top = clamp(r.bottom + 8, 8, Math.max(8, window.innerHeight - gh - 8));
        }
        glossEl.style.left = Math.round(left) + 'px';
        glossEl.style.top = Math.round(top) + 'px';
    }

    // ---------- Coach & Tour ----------
    function initCoach()
    {
        coachTitleEl.textContent = window.HELP_TITLE;
        coachIntroEl.textContent = window.HELP_INTRO;
        let seen = false;
        try {
            seen = Boolean(localStorage.getItem(COACH_KEY));
        } catch (_) {
            seen = false;
        }
        if (!seen && state.ws === 'sky') {
            coachEl.hidden = false;
        }
    }

    function dismissCoach()
    {
        coachEl.hidden = true;
        try {
            localStorage.setItem(COACH_KEY, '1');
        } catch (_) {
            // Ignore storage errors
        }
    }

    function closeTour()
    {
        const wasOpen = activeTourStep >= 0;
        const hadFocus = Boolean(tourTipEl && tourTipEl.contains(document.activeElement));
        activeTourStep = -1;
        tourElNow = null;
        if (wasOpen && (hadFocus || document.activeElement === document.body)) {
            const back = tourReturnFocus && tourReturnFocus.isConnected && tourReturnFocus.getClientRects().length > 0
                ? tourReturnFocus : stageEl;
            setTimeout(() => back.focus({ preventScroll: true }), 0);
        }
        tourReturnFocus = null;
        if (tourMarkEl) {
            tourMarkEl.remove();
            tourMarkEl = null;
        }
        if (tourTipEl) {
            tourTipEl.remove();
            tourTipEl = null;
        }
    }

    function runTourPrep(prep)
    {
        if (!prep) {
            return;
        }
        if (prep === 'close-inspector') {
            if (state.inspect) {
                setInspectorOpen(false);
            }
        } else if (prep.indexOf('inspector:') === 0) {
            setInspectorOpen(true);
            selectInspectorTab(prep.slice('inspector:'.length));
        } else if (prep === 'mode:blink') {
            if (state.mode !== 'blink') {
                setMode('blink');
            }
        } else if (prep === 'mode:subtract') {
            if (state.mode !== 'subtract' && getFrameCount() >= 2) {
                setMode('subtract');
            }
        }
    }

    function openGuide(sectionId)
    {
        if (window.SlowskyGuide && typeof window.SlowskyGuide.open === 'function') {
            closeTour();
            window.SlowskyGuide.open(typeof sectionId === 'string' ? sectionId : undefined);
        } else {
            showToast('Guide not loaded');
        }
    }

    function tourSteps()
    {
        const fromGuide = window.SlowskyGuide && Array.isArray(window.SlowskyGuide.tourSteps)
            ? window.SlowskyGuide.tourSteps : null;
        if (fromGuide && fromGuide.length > 0) {
            return fromGuide.map((step) => ({ sel: step.sel, title: step.title, line: step.line, prep: step.prep }));
        }
        return null;
    }

    function visibleTourEl(sel)
    {
        const el = sel ? document.querySelector(sel) : null;
        if (!el) {
            return stageEl;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? el : stageEl;
    }

    function showTourStep(stepIdx)
    {
        const guided = tourSteps();
        if (guided) {
            if (stepIdx < 0 || stepIdx >= guided.length) {
                closeTour();
                return;
            }
            runTourPrep(guided[stepIdx].prep);
        }
        const steps = guided ? guided.map((step) => ({
            get el() {
                return visibleTourEl(step.sel);
            },
            title: step.title,
            line: step.line,
        })) : [
            {
                el: timelineEl,
                title: window.CONTROL_HELP.blink.name,
                line: window.CONTROL_HELP.blink.line,
            },
            {
                el: modeGroup,
                title: window.CONTROL_HELP.subtract.name,
                line: window.CONTROL_HELP.subtract.line,
            },
            {
                el: uploadBtn,
                title: 'Upload',
                line: uploadBtn.dataset.help || '',
            },
        ];
        if (stepIdx < 0 || stepIdx >= steps.length) {
            closeTour();
            return;
        }
        if (activeTourStep < 0) {
            const from = document.activeElement;
            tourReturnFocus = from && from !== document.body ? from : guideBtn;
        }
        activeTourStep = stepIdx;
        const item = steps[stepIdx];
        if (!tourMarkEl) {
            tourMarkEl = document.createElement('div');
            tourMarkEl.className = 'coach-mark';
            document.body.appendChild(tourMarkEl);
        }
        if (!tourTipEl) {
            tourTipEl = document.createElement('div');
            tourTipEl.className = 'coach-tip';
            document.body.appendChild(tourTipEl);
        }

        while (tourTipEl.firstChild) {
            tourTipEl.removeChild(tourTipEl.firstChild);
        }
        const b = document.createElement('b');
        b.textContent = item.title;
        const span = document.createElement('span');
        span.textContent = item.line;
        const row = document.createElement('div');
        row.className = 'row';
        const count = document.createElement('span');
        count.className = 'faint num';
        count.textContent = (stepIdx + 1) + ' / ' + steps.length;
        const nextB = document.createElement('button');
        nextB.type = 'button';
        nextB.className = 'btn primary sm';
        nextB.textContent = stepIdx === steps.length - 1 ? 'Done' : 'Next';
        nextB.addEventListener('click', () => {
            showTourStep(stepIdx + 1);
        });
        row.appendChild(count);
        row.appendChild(nextB);

        tourTipEl.appendChild(b);
        tourTipEl.appendChild(span);
        tourTipEl.appendChild(row);

        tourElNow = () => item.el;
        positionTourElements(item.el);
        // Panels opened by the step slide in; place the mark again once they have settled.
        setTimeout(() => {
            if (activeTourStep === stepIdx) {
                positionTourElements(item.el);
            }
        }, 260);
        nextB.focus();
    }

    function positionTourElements(targetEl, allowScroll = true)
    {
        if (!tourMarkEl || !tourTipEl || !targetEl) {
            return;
        }
        let r = targetEl.getBoundingClientRect();
        if (allowScroll && (r.top < 0 || r.bottom > window.innerHeight)) {
            // Small screens scroll: bring the control into view before marking it.
            targetEl.scrollIntoView({ block: 'center', inline: 'nearest' });
            r = targetEl.getBoundingClientRect();
        }
        tourMarkEl.style.left = Math.round(r.left - 4) + 'px';
        tourMarkEl.style.top = Math.round(r.top - 4) + 'px';
        tourMarkEl.style.width = Math.round(r.width + 8) + 'px';
        tourMarkEl.style.height = Math.round(r.height + 8) + 'px';

        const tw = tourTipEl.offsetWidth || 260;
        const th = tourTipEl.offsetHeight || 110;
        let top = r.top - th - 12;
        if (top < 10) {
            top = r.bottom + 12;
        }
        const left = clamp(r.left + r.width / 2 - tw / 2, 10, Math.max(10, window.innerWidth - tw - 10));
        top = clamp(top, 10, Math.max(10, window.innerHeight - th - 10));
        tourTipEl.style.left = Math.round(left) + 'px';
        tourTipEl.style.top = Math.round(top) + 'px';
    }

    // ---------- Picker (Command Palette) ----------
    function openPicker()
    {
        pickerEl.hidden = false;
        pickerInputEl.value = '';
        pickerInputEl.setAttribute('aria-expanded', 'true');
        pickerSelectedIndex = Math.max(0, window.ORDER.indexOf(state.target));
        renderPickerList('');
        updatePickerSelection();
        pickerInputEl.focus();
    }

    function closePicker()
    {
        if (pickerEl.hidden) {
            return;
        }
        pickerEl.hidden = true;
        pickerInputEl.setAttribute('aria-expanded', 'false');
        pickerInputEl.removeAttribute('aria-activedescendant');
        targetBtn.focus();
    }

    function renderPickerList(query)
    {
        while (pickerListEl.firstChild) {
            pickerListEl.removeChild(pickerListEl.firstChild);
        }
        const q = query.trim().toLowerCase();
        pickerFilteredIds = window.ORDER.filter((id) => {
            if (!q) {
                return true;
            }
            const c = window.COPY[id];
            const f = window.FRAMES[id];
            return c.display.toLowerCase().includes(q)
                || f.name.toLowerCase().includes(q)
                || c.short.toLowerCase().includes(q)
                || id.toLowerCase().includes(q);
        });

        if (pickerSelectedIndex >= pickerFilteredIds.length) {
            pickerSelectedIndex = 0;
        }

        pickerFilteredIds.forEach((id, idx) => {
            const c = window.COPY[id];
            const f = window.FRAMES[id];
            const lastV = f.visits[f.visits.length - 1];

            const li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.id = 'picker-opt-' + id;
            li.dataset.target = id;
            li.setAttribute('aria-selected', idx === pickerSelectedIndex ? 'true' : 'false');

            const im = document.createElement('img');
            im.src = 'img/' + lastV.file;
            im.alt = '';

            const textWrap = document.createElement('div');
            const nm = document.createElement('span');
            nm.className = 'nm';
            nm.textContent = c.display;
            const sub = document.createElement('span');
            sub.className = 'sub';
            sub.textContent = c.short;
            textWrap.appendChild(nm);
            textWrap.appendChild(sub);

            const kSpan = document.createElement('span');
            kSpan.className = 'k num';
            kSpan.textContent = String(f.visits.length);

            li.appendChild(im);
            li.appendChild(textWrap);
            li.appendChild(kSpan);

            li.addEventListener('mouseenter', () => {
                pickerSelectedIndex = idx;
                updatePickerSelection();
            });
            li.addEventListener('click', () => {
                closePicker();
                switchTarget(id);
            });

            pickerListEl.appendChild(li);
        });

        const looksLikeCoordsOrName = q.length > 0 && (pickerFilteredIds.length === 0 || /[0-9]+\s*[,\s]\s*[+-]?[0-9]+/.test(q));
        if (looksLikeCoordsOrName) {
            const note = document.createElement('li');
            note.className = 'note';
            note.textContent = 'Mockup: the live app searches the archive for this.';
            pickerListEl.appendChild(note);
        }
        updatePickerSelection();
    }

    function updatePickerSelection()
    {
        const options = pickerListEl.querySelectorAll('li[role="option"]');
        options.forEach((li, idx) => {
            const sel = idx === pickerSelectedIndex;
            li.setAttribute('aria-selected', sel ? 'true' : 'false');
            if (sel) {
                li.scrollIntoView({ block: 'nearest' });
            }
        });
        const active = options[pickerSelectedIndex];
        if (active) {
            pickerInputEl.setAttribute('aria-activedescendant', active.id);
        } else {
            pickerInputEl.removeAttribute('aria-activedescendant');
        }
    }

    // ---------- Minimap & About ----------
    function initMinimap()
    {
        while (mmPlotEl.firstChild) {
            mmPlotEl.removeChild(mmPlotEl.firstChild);
        }
        window.ORDER.forEach((id) => {
            const t = window.FRAMES[id];
            const c = window.COPY[id];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.target = id;
            btn.setAttribute('aria-label', c.display);
            btn.dataset.help = c.short;

            const xPct = ((360 - t.ra) / 360) * 100;
            const yPct = ((90 - t.dec) / 180) * 100;
            btn.style.left = xPct.toFixed(2) + '%';
            btn.style.top = yPct.toFixed(2) + '%';

            if (id === state.target) {
                btn.setAttribute('aria-current', 'true');
            }
            btn.addEventListener('click', () => {
                switchTarget(id);
            });
            mmPlotEl.appendChild(btn);
        });
    }

    function initAbout()
    {
        while (aboutEl.firstChild) {
            aboutEl.removeChild(aboutEl.firstChild);
        }
        const p = document.createElement('p');
        p.textContent = window.AI_LINE;
        const a = document.createElement('a');
        a.href = window.AI_LINK;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Which AI tools';
        aboutEl.appendChild(p);
        aboutEl.appendChild(a);
    }

    // ---------- Event Listeners ----------
    function bindEvents()
    {
        // Brand home reset
        const brandEl = document.querySelector('.brand');
        if (brandEl) {
            brandEl.addEventListener('click', (e) => {
                e.preventDefault();
                setWorkspace('sky', false);
            });
        }

        // Workspaces
        wsSkyBtn.addEventListener('click', () => {
            if (state.ws !== 'sky') {
                setWorkspace('sky', false);
            }
        });
        wsMineBtn.addEventListener('click', () => {
            if (state.ws !== 'mine') {
                setWorkspace('mine', false);
            }
        });

        // Target picker
        targetBtn.addEventListener('click', () => {
            openPicker();
        });
        pickerEl.addEventListener('click', (e) => {
            if (e.target === pickerEl) {
                closePicker();
            }
        });
        pickerInputEl.addEventListener('input', () => {
            pickerSelectedIndex = 0;
            renderPickerList(pickerInputEl.value);
        });
        pickerInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (pickerFilteredIds.length > 0) {
                    pickerSelectedIndex = (pickerSelectedIndex + 1) % pickerFilteredIds.length;
                    updatePickerSelection();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (pickerFilteredIds.length > 0) {
                    pickerSelectedIndex = (pickerSelectedIndex - 1 + pickerFilteredIds.length) % pickerFilteredIds.length;
                    updatePickerSelection();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const chosen = pickerFilteredIds[pickerSelectedIndex];
                if (chosen) {
                    closePicker();
                    switchTarget(chosen);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closePicker();
            }
        });

        // Modes
        modeGroup.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-mode]');
            if (btn) {
                setMode(btn.dataset.mode);
            }
        });

        // Upload & Drag-and-drop
        const triggerFileDialog = () => {
            fileInput.value = '';
            fileInput.click();
        };
        uploadBtn.addEventListener('click', triggerFileDialog);
        emptyChooseBtn.addEventListener('click', triggerFileDialog);
        emptySampleBtn.addEventListener('click', () => {
            runSampleFiles();
        });
        const emptySampleFitsBtn = $('empty-sample-fits');
        if (emptySampleFitsBtn) {
            emptySampleFitsBtn.addEventListener('click', () => {
                runSampleFits();
            });
        }
        fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files.length > 0) {
                processFiles(Array.from(fileInput.files), false);
            }
        });

        jobsCancelBtn.addEventListener('click', () => {
            if (uploadAbort) {
                uploadAbort.abort();
                uploadAbort = null;
            }
            hideStatusLoad();
            jobsEl.hidden = true;
        });

        window.addEventListener('dragover', (e) => {
            if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
                e.preventDefault();
            }
        });
        window.addEventListener('drop', (e) => {
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                dropEl.hidden = true;
                processFiles(Array.from(e.dataTransfer.files), false);
            }
        });
        workEl.addEventListener('dragenter', (e) => {
            if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
                e.preventDefault();
                dropEl.hidden = false;
            }
        });
        workEl.addEventListener('dragover', (e) => {
            if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
                e.preventDefault();
                dropEl.hidden = false;
            }
        });
        workEl.addEventListener('dragleave', (e) => {
            if (!workEl.contains(e.relatedTarget)) {
                dropEl.hidden = true;
            }
        });

        // Top bar buttons
        helpBtn.addEventListener('click', () => {
            state.labels = document.body.classList.toggle('labels');
            helpBtn.setAttribute('aria-pressed', state.labels ? 'true' : 'false');
            helpBtn.dataset.help = state.labels
                ? 'Labels under every tool: on. Press to hide them once you know the tools.'
                : 'Labels under every tool: off. Press to show them.';
            try {
                localStorage.setItem('slowsky-d4-labels', state.labels ? '1' : '0');
            } catch (err) {
                // Private mode: the choice lasts for this visit only.
            }
        });
        shareBtn.addEventListener('click', () => {
            syncHash();
            copyText(window.location.href, 'Link copied');
        });
        undoBtn.addEventListener('click', undoStep);
        redoBtn.addEventListener('click', redoStep);
        saveBtn.addEventListener('click', savePicture);
        guideBtn.addEventListener('click', openGuide);
        if (fieldSelectEl) {
            fieldSelectEl.addEventListener('change', () => {
                setField(fieldSelectEl.value);
            });
        }
        if (subopEl) {
            subopEl.addEventListener('click', (e) => {
                const opBtn = e.target.closest('[data-subop]');
                if (opBtn && opBtn.dataset.subop !== state.subop) {
                    setSubop(opBtn.dataset.subop);
                }
            });
        }
        if (window.SlowskyGuide) {
            window.SlowskyGuide.onShow = (stepIdx) => {
                showTourStep(stepIdx);
            };
        }

        // Floating Tools
        toolsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-tool]');
            if (!btn || btn.disabled) {
                return;
            }
            const tool = btn.dataset.tool;
            if (tool === 'loupe') {
                state.loupe = !state.loupe;
                updateToolStates();
                if (!state.loupe) {
                    loupeEl.hidden = true;
                } else if (pointerInsideSky) {
                    updateLoupeAt(lastSkyClient.x, lastSkyClient.y);
                }
            } else if (tool === 'ring') {
                state.ring = !state.ring;
                updateRingAndTrail(getDisplayedIndex(), false);
                updateToolStates();
            } else if (tool === 'trail') {
                state.trail = !state.trail;
                updateRingAndTrail(getDisplayedIndex(), false);
                updateToolStates();
            } else if (tool === 'find') {
                runCandidates(true);
            } else if (tool === 'zoom') {
                state.zoom = state.zoom > 1.01 ? 1 : 2;
                if (state.zoom === 1) {
                    state.pan.x = 0;
                    state.pan.y = 0;
                }
                applyZoomPan();
            } else if (tool === 'fit') {
                resetView();
            } else if (tool === 'inspect') {
                setInspectorOpen(!state.inspect);
            } else if (tool === 'focus') {
                setFocusMode(!state.focus);
            } else if (Object.prototype.hasOwnProperty.call(state.layers, tool)) {
                toggleLayer(tool);
            }
        });

        const holdBtn = toolsEl.querySelector('[data-tool="hold"]');
        if (holdBtn) {
            holdBtn.addEventListener('pointerdown', (e) => {
                if (holdBtn.disabled) {
                    return;
                }
                e.preventDefault();
                holdBtn.setPointerCapture(e.pointerId);
                startHold();
            });
            holdBtn.addEventListener('pointerup', () => {
                endHold();
            });
            holdBtn.addEventListener('pointercancel', () => {
                endHold();
            });
            holdBtn.addEventListener('lostpointercapture', () => {
                endHold();
            });
        }

        // Inspector tabs & close
        inspectorCloseBtn.addEventListener('click', () => {
            setInspectorOpen(false);
        });
        inspectorEl.querySelector('.tabs').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-tab]');
            if (btn) {
                selectInspectorTab(btn.dataset.tab);
            }
        });

        // Coach
        coachCloseBtn.addEventListener('click', () => {
            dismissCoach();
        });
        coachTourBtn.addEventListener('click', () => {
            dismissCoach();
            showTourStep(0);
        });

        // Transport & Speed
        prevBtn.addEventListener('click', () => {
            stepFrame(-1, false);
        });
        nextBtn.addEventListener('click', () => {
            stepFrame(1, false);
        });
        playBtn.addEventListener('click', () => {
            setPlaying(!state.playing);
        });
        speedGroup.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-speed]');
            if (!btn) {
                return;
            }
            const sp = parseFloat(btn.dataset.speed);
            if (!Number.isFinite(sp)) {
                return;
            }
            state.speed = sp;
            speedGroup.querySelectorAll('[data-speed]').forEach((b) => {
                b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
            });
            if (state.playing) {
                restartBlinkTimer();
            }
        });

        // Timeline Dates Lane Scrubbing & Thumb Clicks
        datesLaneEl.style.touchAction = 'none';
        let scrubbingDates = false;
        let scrubMoved = false;
        let scrubStartThumb = null;
        let scrubStartX = 0;

        datesLaneEl.addEventListener('pointerdown', (e) => {
            if (getFrameCount() === 0) {
                return;
            }
            const thumbBtn = e.target.closest('.thumb');
            scrubbingDates = true;
            scrubMoved = false;
            scrubStartThumb = thumbBtn;
            scrubStartX = e.clientX;
            datesLaneEl.setPointerCapture(e.pointerId);

            if (!thumbBtn || state.mode !== 'subtract') {
                if (state.playing) {
                    setPlaying(false);
                }
                const idx = thumbBtn ? parseInt(thumbBtn.dataset.index, 10) : nearestVisitFromClientX(e.clientX);
                goToIndex(idx);
            }
        });

        datesLaneEl.addEventListener('pointermove', (e) => {
            if (!scrubbingDates) {
                return;
            }
            if (Math.abs(e.clientX - scrubStartX) > 5) {
                scrubMoved = true;
            }
            if (scrubMoved || !scrubStartThumb || state.mode !== 'subtract') {
                if (state.playing) {
                    setPlaying(false);
                }
                const idx = nearestVisitFromClientX(e.clientX);
                if (idx !== state.index) {
                    goToIndex(idx);
                }
            }
        });

        const pickPairThumb = (idx) => {
            if (!Number.isFinite(idx)) {
                return;
            }
            if (state.abNext === 'a') {
                state.a = idx;
                state.abNext = 'b';
            } else {
                state.b = idx;
                state.abNext = 'a';
            }
            // Subtract is always later minus earlier: A is the earlier date, whichever was picked first.
            if (state.a > state.b) {
                const t = state.a;
                state.a = state.b;
                state.b = t;
                state.abNext = state.abNext === 'a' ? 'b' : 'a';
            }
            state.index = idx;
            syncHash();
            updateThumbAbMarkers();
            updateModeControls();
            clearCandidates();
            const pickedThumb = datesThumbsEl.querySelector('[data-index="' + idx + '"]');
            withBusy(pickedThumb, 'Comparing A and B', () => {
                renderCurrentView();
                renderInspectorCands();
            });
            announce('A ' + getVisitDateLabel(state.a) + ', B ' + getVisitDateLabel(state.b));
        };
        const finishDatesScrub = () => {
            if (!scrubbingDates) {
                return;
            }
            if (!scrubMoved && scrubStartThumb && state.mode === 'subtract') {
                pickPairThumb(parseInt(scrubStartThumb.dataset.index, 10));
            }
            scrubbingDates = false;
            scrubStartThumb = null;
        };
        // Keyboard (Enter or Space on a focused thumbnail) arrives as a click with detail 0.
        datesLaneEl.addEventListener('click', (e) => {
            const thumbBtn = e.target.closest('.thumb');
            if (!thumbBtn || e.detail !== 0 || getFrameCount() === 0) {
                return;
            }
            const idx = parseInt(thumbBtn.dataset.index, 10);
            if (state.mode === 'subtract') {
                pickPairThumb(idx);
            } else {
                if (state.playing) {
                    setPlaying(false);
                }
                goToIndex(idx);
            }
        });
        datesLaneEl.addEventListener('pointerup', finishDatesScrub);
        datesLaneEl.addEventListener('pointercancel', finishDatesScrub);

        playheadEl.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                e.stopPropagation();
                stepFrame(-1, false);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                stepFrame(1, false);
            }
        });

        // Colour Lane Dragging & Keyboard
        let draggingColour = false;
        const updateColourFromPointer = (clientX) => {
            const rect = colourLaneEl.getBoundingClientRect();
            if (rect.width <= 0) {
                return;
            }
            const pct = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
            setColourReadout(pctToLam(pct));
        };

        colourLaneEl.addEventListener('pointerdown', (e) => {
            if (state.ws !== 'sky') {
                return;
            }
            clearColourStageTimers();
            hideStatusLoad();
            draggingColour = true;
            colourLaneEl.setPointerCapture(e.pointerId);
            updateColourFromPointer(e.clientX);
        });
        colourLaneEl.addEventListener('pointermove', (e) => {
            if (draggingColour) {
                updateColourFromPointer(e.clientX);
            }
        });
        const finishColourDrag = () => {
            if (!draggingColour) {
                return;
            }
            draggingColour = false;
            releaseColourThumb();
        };
        colourLaneEl.addEventListener('pointerup', finishColourDrag);
        colourLaneEl.addEventListener('pointercancel', finishColourDrag);

        colourThumbEl.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                clearColourStageTimers();
                clearTimeout(colourKeyTimer);
                const step = e.key === 'ArrowRight' ? 0.01 : -0.01;
                setColourReadout(state.colourUm + step);
                colourKeyTimer = setTimeout(() => {
                    releaseColourThumb();
                }, 450);
            }
        });

        // Sky Zoom, Pan, Pinch, Coord, Loupe & Touch Long-Press Hold
        stageEl.addEventListener('wheel', (e) => {
            if (getFrameCount() === 0) {
                return;
            }
            e.preventDefault();
            const factor = Math.exp(-e.deltaY * 0.002);
            const nextZoom = clamp(state.zoom * factor, 1, 2);
            if (nextZoom === state.zoom) {
                return;
            }
            const stRect = stageEl.getBoundingClientRect();
            const cx = e.clientX - (stRect.left + stRect.width / 2);
            const cy = e.clientY - (stRect.top + stRect.height / 2);
            const ratio = nextZoom / state.zoom;
            state.pan.x = cx - (cx - state.pan.x) * ratio;
            state.pan.y = cy - (cy - state.pan.y) * ratio;
            state.zoom = nextZoom;
            applyZoomPan();
        }, { passive: false });

        skyEl.addEventListener('dblclick', () => {
            resetView();
        });

        const skyPointers = new Map();
        let lastPinchDist = 0;
        let lastPinchMid = null;
        let touchHoldTimer = null;
        let downPos = { x: 0, y: 0 };

        skyEl.addEventListener('pointerenter', (e) => {
            pointerInsideSky = true;
            lastSkyClient = { x: e.clientX, y: e.clientY };
            updateSkyCoordAt(e.clientX, e.clientY);
            if (state.loupe) {
                updateLoupeAt(e.clientX, e.clientY);
            }
        });

        skyEl.addEventListener('pointerleave', () => {
            pointerInsideSky = false;
            loupeEl.hidden = true;
        });

        skyEl.addEventListener('pointerdown', (e) => {
            if (getFrameCount() === 0) {
                return;
            }
            skyEl.setPointerCapture(e.pointerId);
            skyPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            lastSkyClient = { x: e.clientX, y: e.clientY };
            updateSkyCoordAt(e.clientX, e.clientY);

            if (skyPointers.size === 1) {
                downPos = { x: e.clientX, y: e.clientY };
                if (state.zoom > 1) {
                    skyEl.classList.add('panning');
                }
                if (e.pointerType === 'touch') {
                    clearTimeout(touchHoldTimer);
                    touchHoldTimer = setTimeout(() => {
                        if (skyPointers.size === 1) {
                            startHold();
                        }
                    }, 380);
                }
            } else if (skyPointers.size === 2) {
                clearTimeout(touchHoldTimer);
                if (state.hold) {
                    endHold();
                }
                const pts = Array.from(skyPointers.values());
                lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                lastPinchMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
            }
        });

        skyEl.addEventListener('pointermove', (e) => {
            pointerInsideSky = true;
            lastSkyClient = { x: e.clientX, y: e.clientY };
            updateSkyCoordAt(e.clientX, e.clientY);

            if (skyPointers.has(e.pointerId)) {
                const prev = skyPointers.get(e.pointerId);
                const dx = e.clientX - prev.x;
                const dy = e.clientY - prev.y;
                skyPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

                if (skyPointers.size === 1) {
                    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 8) {
                        clearTimeout(touchHoldTimer);
                    }
                    if (state.zoom > 1 && !state.hold) {
                        state.pan.x += dx;
                        state.pan.y += dy;
                        applyZoomPan();
                    }
                } else if (skyPointers.size === 2) {
                    const pts = Array.from(skyPointers.values());
                    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
                    if (lastPinchDist > 0) {
                        state.zoom = clamp(state.zoom * (dist / lastPinchDist), 1, 2);
                    }
                    if (lastPinchMid) {
                        state.pan.x += mid.x - lastPinchMid.x;
                        state.pan.y += mid.y - lastPinchMid.y;
                    }
                    lastPinchDist = dist;
                    lastPinchMid = mid;
                    applyZoomPan();
                }
            }

            if (state.loupe) {
                updateLoupeAt(e.clientX, e.clientY);
            }
        });

        const endSkyPointer = (e) => {
            skyPointers.delete(e.pointerId);
            clearTimeout(touchHoldTimer);
            if (skyPointers.size < 2) {
                lastPinchDist = 0;
                lastPinchMid = null;
            }
            if (skyPointers.size === 0) {
                skyEl.classList.remove('panning');
                if (e.pointerType === 'touch' && state.hold) {
                    endHold();
                } else if (e.pointerType === 'touch' && e.type === 'pointerup' && state.zoom <= 1.01 && downPos) {
                    // Swipe the picture to step through the dates (left: later, right: earlier).
                    const sx = e.clientX - downPos.x;
                    const sy = e.clientY - downPos.y;
                    if (Math.abs(sx) > 40 && Math.abs(sx) > 1.5 * Math.abs(sy) && getFrameCount() > 1) {
                        stepFrame(sx < 0 ? 1 : -1, false);
                    }
                }
            }
        };
        skyEl.addEventListener('pointerup', endSkyPointer);
        skyEl.addEventListener('pointercancel', endSkyPointer);

        // Status bar coord copy & AI used popover
        statusCoordEl.addEventListener('click', () => {
            const txt = statusCoordEl.textContent.trim();
            if (txt && txt !== '\u2014') {
                copyText(txt, 'Copied');
            }
        });
        statusAiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            aboutEl.hidden = !aboutEl.hidden;
        });

        // Glossary clicks in status bar
        statusHelpEl.addEventListener('click', (e) => {
            const termBtn = e.target.closest('.term');
            if (!termBtn) {
                return;
            }
            e.stopPropagation();
            openGlossary(termBtn.dataset.term, termBtn);
        });

        // Close popovers on outside click
        document.addEventListener('pointerdown', (e) => {
            if (!glossEl.hidden && !glossEl.contains(e.target) && !e.target.closest('.term')) {
                glossEl.hidden = true;
            }
            if (!aboutEl.hidden && !aboutEl.contains(e.target) && e.target !== statusAiBtn) {
                aboutEl.hidden = true;
            }
            hideTooltip();
        });

        // Delegated hover & focus for tooltips and status help
        const handleHelpEnter = (target, isTouch) => {
            const el = target && target.closest ? target.closest('[data-help], [data-help-id]') : null;
            if (!el) {
                return;
            }
            const desc = getHelpDescriptor(el);
            if (!desc) {
                return;
            }
            setStatusHelp(desc.name, desc.line);
            clearTimeout(tipTimer);
            tipTarget = el;
            if (!isTouch) {
                tipTimer = setTimeout(() => {
                    if (tipTarget === el) {
                        showTooltipFor(el);
                    }
                }, 350);
            }
        };

        const handleHelpLeave = (related) => {
            const nextEl = related && related.closest ? related.closest('[data-help], [data-help-id]') : null;
            if (nextEl && nextEl === tipTarget) {
                return;
            }
            hideTooltip();
            if (!nextEl) {
                setStatusHelpDefault();
            }
        };

        document.addEventListener('pointerover', (e) => {
            handleHelpEnter(e.target, e.pointerType === 'touch');
        });
        document.addEventListener('pointerout', (e) => {
            if (tipTarget && e.target && tipTarget.contains(e.target)) {
                if (!e.relatedTarget || !tipTarget.contains(e.relatedTarget)) {
                    handleHelpLeave(e.relatedTarget);
                }
            }
        });
        document.addEventListener('focusin', (e) => {
            handleHelpEnter(e.target, false);
        });
        document.addEventListener('focusout', (e) => {
            handleHelpLeave(e.relatedTarget);
        });

        // Global Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            hideTooltip();

            if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                if (pickerEl.hidden) {
                    openPicker();
                } else {
                    closePicker();
                }
                return;
            }

            if (e.key === 'Escape') {
                if (!glossEl.hidden) {
                    e.preventDefault();
                    glossEl.hidden = true;
                    return;
                }
                if (!pickerEl.hidden) {
                    e.preventDefault();
                    closePicker();
                    return;
                }
                if (!aboutEl.hidden) {
                    e.preventDefault();
                    aboutEl.hidden = true;
                    return;
                }
                if (activeTourStep >= 0) {
                    e.preventDefault();
                    closeTour();
                    return;
                }
                if (state.inspect) {
                    e.preventDefault();
                    setInspectorOpen(false);
                    return;
                }
                if (!coachEl.hidden) {
                    e.preventDefault();
                    dismissCoach();
                    return;
                }
                return;
            }

            const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
            const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select'
                || Boolean(e.target && e.target.isContentEditable);
            if (isTyping || !pickerEl.hidden) {
                return;
            }
            if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                const lower = e.key.toLowerCase();
                if (lower === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    undoStep();
                    return;
                }
                if ((lower === 'z' && e.shiftKey) || (lower === 'y' && e.ctrlKey && !e.metaKey)) {
                    e.preventDefault();
                    redoStep();
                    return;
                }
            }
            if (e.metaKey || e.ctrlKey || e.altKey) {
                return;
            }

            const key = e.key;
            if (key === '/') {
                e.preventDefault();
                openPicker();
            } else if (key === '?') {
                e.preventDefault();
                helpBtn.click();
            } else if (key === ' ') {
                const onBtnOrLink = tag === 'button' || tag === 'a';
                if (!onBtnOrLink || e.target === playBtn) {
                    e.preventDefault();
                    setPlaying(!state.playing);
                }
            } else if (key === 'ArrowLeft' || key === '[') {
                e.preventDefault();
                stepFrame(-1, false);
            } else if (key === 'ArrowRight' || key === ']') {
                e.preventDefault();
                stepFrame(1, false);
            } else if (key === 'f' || key === 'F') {
                setFocusMode(!state.focus);
            } else if (key === 'g' || key === 'G') {
                openGuide();
            } else if (key === 'b' || key === 'B') {
                setMode('blink');
            } else if (key === 's' || key === 'S') {
                setMode('stack');
            } else if (key === 'd' || key === 'D') {
                setMode('subtract');
            } else if (key === 'l' || key === 'L') {
                const lBtn = toolsEl.querySelector('[data-tool="loupe"]');
                if (lBtn && !lBtn.disabled) {
                    lBtn.click();
                }
            } else if (key === 'r' || key === 'R') {
                const rBtn = toolsEl.querySelector('[data-tool="ring"]');
                if (rBtn && !rBtn.disabled) {
                    rBtn.click();
                }
            } else if (key === 'h' || key === 'H') {
                if (!e.repeat) {
                    startHold();
                }
            } else if (key === 'i' || key === 'I') {
                setInspectorOpen(!state.inspect);
            } else if (key === 'u' || key === 'U') {
                triggerFileDialog();
            } else if (key === 't' || key === 'T') {
                const themeBtn = document.querySelector('[data-theme-toggle]');
                if (themeBtn) {
                    themeBtn.click();
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'h' || e.key === 'H') {
                endHold();
            }
        });

        window.addEventListener('blur', () => {
            endHold();
        });

        // Resize handling for scale bar and tour
        if (typeof ResizeObserver === 'function') {
            const ro = new ResizeObserver(() => {
                applyZoomPan();
            });
            ro.observe(stageEl);
        }
        document.addEventListener('scroll', () => {
            if (activeTourStep >= 0 && tourElNow) {
                positionTourElements(tourElNow(), false);
            }
        }, { passive: true, capture: true });
        window.addEventListener('resize', () => {
            applyZoomPan();
            if (activeTourStep >= 0) {
                showTourStep(activeTourStep);
            }
        });
    }

    // ---------- Boot ----------
    function boot()
    {
        parseInitialHash();

        // Pre-warm IMG_DATA cache for initial target
        window.FRAMES[state.target].visits.forEach((v) => {
            getImgDataElement(v.file);
        });

        initMinimap();
        initColourTrack();
        initAbout();
        renderInspectorAi();

        updateTargetChrome();
        buildTimeline();

        // Create SkyPlayer (note: onChange fires inside constructor before `player` is assigned!)
        const initialIndex = state.index;
        player = new SkyPlayer(skyEl, state.target, {
            fade: 0,
            onChange: (p) => {
                const seq = p.seq;
                const idxAtCall = p.i;
                const targetAtCall = p.id;
                const pending = p.layers[1 - p.front];
                const commit = () => {
                    if (p.seq !== seq) {
                        return;
                    }
                    const effectiveMode = state.hold ? 'blink' : state.mode;
                    if (state.ws !== 'sky' || effectiveMode !== 'blink') {
                        setSkyLayersVisible(false);
                        return;
                    }
                    if (state.target === targetAtCall && !state.hold) {
                        state.index = idxAtCall;
                        syncHash();
                        commitFrameVisuals(idxAtCall);
                    } else if (state.hold) {
                        commitFrameVisuals(0);
                    }
                };
                if (pending && typeof pending.decode === 'function') {
                    pending.decode().catch(() => {}).then(commit);
                } else {
                    commit();
                }
            },
        });

        if (initialIndex !== player.i) {
            state.index = initialIndex;
            player.go(initialIndex);
        }

        // Immediate initial chrome sync before async decode resolves
        commitFrameVisuals(state.index);
        updateRingAndTrail(state.index, true);
        updateModeControls();
        renderInspectorAll();
        setStatusHelpDefault();
        initCoach();
        bindEvents();

        if (state.mode !== 'blink') {
            renderCurrentView();
        } else {
            restartBlinkTimer();
        }
        syncHash();
        document.body.classList.toggle('labels', state.labels);
        helpBtn.setAttribute('aria-pressed', state.labels ? 'true' : 'false');
        if (!state.labels) {
            helpBtn.dataset.help = 'Labels under every tool: off. Press to show them.';
        }
        hist.current = viewSnapshot();
        updateHistoryButtons();
        finishBooting();
    }

    // First load: the picture frame shows the loading mark until the first date is decoded, then the page
    // settles in. At least 650 ms so the animation reads; at most 4 s if a picture never decodes.
    function finishBooting()
    {
        const started = performance.now();
        const firstVisit = window.FRAMES[state.target] && window.FRAMES[state.target].visits[state.index];
        const name = window.COPY[state.target] ? window.COPY[state.target].display : 'the sky';
        stageLoadTextEl.textContent = 'Loading ' + name;
        const decodeFirst = new Promise((resolve) => {
            if (!firstVisit) {
                resolve();
                return;
            }
            const im = new Image();
            im.src = (window.IMG_DATA && window.IMG_DATA[firstVisit.file]) || 'img/' + firstVisit.file;
            if (typeof im.decode === 'function') {
                im.decode().then(resolve, resolve);
            } else {
                im.onload = resolve;
                im.onerror = resolve;
            }
        });
        const timeout = new Promise((resolve) => {
            setTimeout(resolve, 4000);
        });
        Promise.race([decodeFirst, timeout]).then(() => {
            const wait = Math.max(0, 650 - (performance.now() - started));
            setTimeout(() => {
                document.body.classList.remove('booting');
                document.body.classList.add('booted');
                if (busyJobs.size === 0) {
                    stageLoadEl.classList.remove('on');
                }
                setTimeout(() => {
                    document.body.classList.remove('booted');
                }, 900);
            }, wait);
        });
    }

    boot();
})();
