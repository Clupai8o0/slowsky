// Direction 1: Theatre — Interactive controller for the single centred stage + sheets mockup.
// Depends on frames.js (window.FRAMES), copy.js (window.COPY, ORDER, ...), help.js (window.HELP_*), and base.js (SkyPlayer, icon).

(function ()
{
    'use strict';

    const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
    const BLINK_MS = 800;
    const EPOCH_REF_MS = Date.UTC(2026, 0, 1); // saved PNGs are centred on the predicted position at 2026.0
    const BASE_FOV_ARCSEC = 360;               // 6 arcminutes = 360 arcseconds across cutout

    const MONTHS = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };

    const GLOSSARY_PATTERNS = {
        frame: /\bframes?\b/i,
        pixel: /\bpixels?\b/i,
        infrared: /\binfrared\b/i,
        um: /µm/u,
        arcsec: /″|\barcseconds?\b|\barcsec\b/i,
        gaia: /\bGaia\b/,
        catalogueStar: /\bcatalogue stars?\b/i,
        twomass: /\b2MASS\b/,
        noise: /\bnoise\b/i,
        snr: /\bS\/N\b/,
        candidate: /\bcandidates?\b/i
    };

    // Extended SkyPlayer: 800 ms blink cadence, hard-cuts while blinking/stepping,
    // and file://-safe canvas composition fallback for Stack and Subtract.
    class TheatrePlayer extends SkyPlayer
    {
        play(on = !this.timer)
        {
            clearInterval(this.timer);
            this.timer = null;
            if (on && this.mode === 'blink') {
                this.timer = setInterval(() => {
                    this.step(1);
                }, BLINK_MS);
            }
            this.opts.onPlaybackChange?.(this);
            return !!this.timer;
        }

        composeReady(cache, mode)
        {
            try {
                return super.composeReady(cache, mode);
            } catch (err) {
                if (err.name !== 'SecurityError') {
                    throw err;
                }
                if (mode === 'diff') {
                    // An absolute difference cannot distinguish brightening from fading.
                    this.opts.onNote?.('Subtract needs the live app', this);
                    return null;
                }
                // Strict file:// Stack fallback: arithmetic mean via 1/(k+1) alpha.
                const W = cache[0].naturalWidth;
                const c = document.createElement('canvas');
                c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
                c.width = W;
                c.height = W;
                const ctx = c.getContext('2d');
                cache.forEach((im, idx) => {
                    ctx.globalAlpha = 1 / (idx + 1);
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.drawImage(im, 0, 0, W, W);
                });
                return c;
            }
        }
    }

    // Application state
    const state = {
        targetId: 'barnard',
        displayedTargetId: null,
        customQuery: null,
        fovArcmin: 6,
        archiveSource: 'saved',
        wavelength: 0.93,
        activeDetector: 1,
        overlays: {
            targetPos: true,
            gaia: false,
            flags: false,
            older: false,
            falseColour: false
        },
        sheetOpen: null,
        sheetTriggerEl: null,
        openGlossaryTerm: null,
        glossaryTriggerEl: null,
        cmdOpen: false,
        cmdIndex: 0,
        cmdItems: [],
        holdingFirst: false,
        holdPrevIndex: 0,
        holdWasPlaying: false,
        loadSeq: 0,
        wlSeq: 0,
        targetSeq: 0,
        targetTimers: [],
        targetLoading: false,
        stageLoading: false,
        stageTimers: [],
        lastRetryAction: null,
        booted: false
    };

    // Cached DOM references
    const el = {};

    function cacheDom()
    {
        const ids = [
            'sr-announce', 'brand-home', 'search-open', 'search-trigger-text',
            'icon-search', 'icon-share', 'icon-moon', 'icon-sun',
            'copy-link-btn', 'copy-link-label', 'target-ribbon',
            'stage-main', 'stage-headline', 'stage-pm', 'stage-meta-sep',
            'stage-coords', 'stage-coords-text', 'stage-coords-copied',
            'help-intro', 'help-intro-title', 'help-more-btn',
            'help-intro-lead', 'help-intro-more', 'help-intro-more-inner',
            'plate-shell', 'sky-stage', 'sky-viewport', 'sky-pixels', 'sky-svg',
            'ov-trail', 'ov-target',
            'target-ring', 'target-ring-shadow',
            'sky-status-bar', 'sky-status-text',
            'sky-error-bar', 'sky-error-text', 'sky-retry-btn', 'sky-error-dismiss',
            'sky-false-badge', 'sky-custom-bar', 'sky-custom-label', 'sky-custom-reset',
            'sky-tag', 'sky-scale-bar', 'sky-scale-label',
            'sky-loupe', 'loupe-inner', 'loupe-img', 'loupe-canvas',
            'plate-hold-hint', 'plate-wl-summary',
            'stage-caption', 'stage-show', 'stage-caveat', 'help-ai-note',
            'theatre-dock', 'btn-prev', 'btn-play', 'btn-next',
            'icon-prev', 'icon-play-state', 'icon-next',
            'scrubber-wrap', 'scrubber-current-date', 'scrubber-visit-count',
            'scrubber-track-area', 'scrubber-fill', 'scrubber-ticks', 'scrubber-thumb',
            'scrubber-peek', 'peek-img', 'peek-date', 'peek-sub',
            'dock-mode-hint',
            'wl-readout', 'wl-det-readout', 'wl-source-note', 'wl-reset-btn',
            'wl-bar-container', 'wl-interactive', 'wl-bands', 'wl-thumb', 'wl-hover-tip', 'help-colour',
            'trigger-meta-guide', 'trigger-meta-overlays', 'trigger-meta-frame',
            'ai-line-text', 'ai-link',
            'sheet-backdrop', 'bottom-sheet', 'sheet-title', 'sheet-close', 'sheet-body',
            'panel-guide', 'panel-overlays', 'panel-frame',
            'guide-headline', 'guide-coords-btn', 'guide-coords-text', 'guide-coords-copied',
            'guide-show', 'guide-not', 'glossary-ref-list',
            'skymap-wrap', 'skymap-svg', 'skymap-points', 'skymap-readout',
            'skymap-hover-card', 'skymap-hover-name', 'skymap-hover-hook',
            'motion-rate-label', 'motion-svg', 'motion-path-full', 'motion-path-active',
            'motion-visit-dots', 'motion-step-readout', 'motion-components',
            'chk-target-pos', 'chk-gaia', 'chk-flags', 'chk-older', 'chk-false-colour',
            'help-gaia', 'help-flags', 'help-epoch', 'help-false-colour', 'help-field',
            'mock-note-gaia', 'mock-note-flags', 'mock-note-older',
            'false-colour-reveal', 'false-colour-text',
            'field-size-seg', 'archive-mode-seg', 'btn-sim-error',
            'spec-target-title', 'spec-subtitle', 'btn-fits-download', 'fits-feedback',
            'spec-date', 'spec-visit', 'spec-obsid-btn', 'spec-obsid', 'spec-obsid-copied',
            'spec-frames', 'spec-detector', 'spec-lam',
            'spec-coords-btn', 'spec-coords', 'spec-coords-copied',
            'spec-pm', 'spec-field', 'spec-file',
            'gloss-popover', 'gloss-popover-text', 'gloss-popover-close',
            'cmd-backdrop', 'cmd-search-icon', 'cmd-input', 'cmd-close', 'cmd-list'
        ];
        ids.forEach((id) => {
            el[id] = document.getElementById(id);
        });
    }

    function setTextIfChanged(node, text)
    {
        const next = String(text ?? '');
        if (!node || node.dataset.rawText === next) {
            return false;
        }
        node.dataset.rawText = next;
        node.textContent = next;
        return true;
    }

    function getModeHelpLine(mode)
    {
        const key = mode === 'diff' ? 'subtract' : mode;
        if (window.CONTROL_HELP && window.CONTROL_HELP[key]) {
            return window.CONTROL_HELP[key].line;
        }
        return (window.MODE_HINT && window.MODE_HINT[mode]) || '';
    }

    function updateStageProperMotion(targetId, isCustom)
    {
        if (isCustom) {
            el['stage-pm'].hidden = true;
            el['stage-meta-sep'].hidden = true;
            return;
        }
        const t = window.FRAMES[targetId];
        const pmArcsecYr = Math.hypot(t.pmRa, t.pmDec) / 1000;
        el['stage-pm'].hidden = false;
        el['stage-meta-sep'].hidden = false;
        setTextIfChanged(el['stage-pm'], `${pmArcsecYr.toFixed(2)}″/yr`);
    }

    // Populate beginner help copy from help.js
    function initHelpContent()
    {
        if (window.HELP_TITLE) {
            setTextIfChanged(el['help-intro-title'], window.HELP_TITLE);
        }
        if (window.HELP_INTRO) {
            const cut = window.HELP_INTRO.indexOf('. ');
            if (cut !== -1) {
                setTextIfChanged(el['help-intro-lead'], window.HELP_INTRO.slice(0, cut + 1));
                setTextIfChanged(el['help-intro-more-inner'], ' ' + window.HELP_INTRO.slice(cut + 2));
            } else {
                setTextIfChanged(el['help-intro-lead'], window.HELP_INTRO);
                setTextIfChanged(el['help-intro-more-inner'], '');
            }
        }

        const ch = window.CONTROL_HELP;
        if (ch) {
            setTextIfChanged(el['dock-mode-hint'], getModeHelpLine('blink'));
            if (ch.colour) {
                setTextIfChanged(el['help-colour'], ch.colour.line);
            }
            if (ch.field) {
                setTextIfChanged(el['help-field'], ch.field.line);
            }
            if (ch.gaia) {
                setTextIfChanged(el['help-gaia'], ch.gaia.line);
            }
            if (ch.flags) {
                setTextIfChanged(el['help-flags'], ch.flags.line);
            }
            if (ch.epoch) {
                setTextIfChanged(el['help-epoch'], ch.epoch.line);
            }
            if (ch.falseColour) {
                setTextIfChanged(el['help-false-colour'], ch.falseColour.line);
            }
            if (ch.aiNote) {
                setTextIfChanged(el['help-ai-note'], ch.aiNote.line);
            }
        }

        if (window.AI_LINE) {
            el['ai-line-text'].textContent = window.AI_LINE;
        }
        if (window.AI_LINK) {
            el['ai-link'].href = window.AI_LINK;
            el['ai-link'].textContent = 'Which AI tools';
        }

        if (window.GLOSSARY && el['glossary-ref-list']) {
            const order = window.TERM_ORDER || Object.keys(window.GLOSSARY);
            el['glossary-ref-list'].innerHTML = order
                .filter((id) => window.GLOSSARY[id])
                .map((id) => {
                    const entry = window.GLOSSARY[id];
                    return `<div class="glossary-ref-item"><dt>${escapeHtml(entry.term)}</dt><dd>${escapeHtml(entry.long)}</dd></div>`;
                })
                .join('');
        }
    }

    // Wrap the first visible on-screen occurrence of each GLOSSARY term in a focusable dotted-underline button
    function annotateGlossaryTerms()
    {
        if (!window.GLOSSARY) {
            return;
        }

        const focusedTerm = (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('gloss-btn'))
            ? document.activeElement.dataset.glossary
            : null;
        const openTerm = state.openGlossaryTerm;

        document.querySelectorAll('button.gloss-btn').forEach((btn) => {
            const parent = btn.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(btn.textContent), btn);
                parent.normalize();
            }
        });

        const terms = window.TERM_ORDER || Object.keys(window.GLOSSARY);
        const seen = new Set();
        const roots = [el['stage-main'], el['bottom-sheet']];

        roots.forEach((root) => {
            if (!root || root.hidden) {
                return;
            }
            const textNodes = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode(node)
                {
                    if (!node.nodeValue || !node.nodeValue.trim()) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    const p = node.parentElement;
                    if (!p) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (p.closest('[hidden], button, a, input, select, textarea, label, kbd, svg, .sr, .sky, .scrubber-peek, .wl-hover-tip, .glossary-ref-list, #gloss-popover')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    const rev = p.closest('.reveal');
                    if (rev && !rev.classList.contains('open') && getComputedStyle(rev).display === 'grid') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            let n;
            while ((n = walker.nextNode())) {
                textNodes.push(n);
            }

            textNodes.forEach((startNode) => {
                let current = startNode;
                while (current && current.nodeValue && seen.size < terms.length) {
                    const text = current.nodeValue;
                    let best = null;
                    for (let i = 0; i < terms.length; i++) {
                        const id = terms[i];
                        if (seen.has(id) || !window.GLOSSARY[id]) {
                            continue;
                        }
                        const re = GLOSSARY_PATTERNS[id];
                        if (!re) {
                            continue;
                        }
                        const m = re.exec(text);
                        if (m && (best === null || m.index < best.index)) {
                            best = { id, index: m.index, match: m[0] };
                        }
                    }
                    if (!best) {
                        break;
                    }
                    seen.add(best.id);
                    const afterNode = current.splitText(best.index);
                    const restNode = afterNode.splitText(best.match.length);
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'gloss-btn';
                    btn.dataset.glossary = best.id;
                    btn.dataset.term = best.id;
                    btn.setAttribute('aria-expanded', openTerm === best.id ? 'true' : 'false');
                    btn.setAttribute('aria-controls', 'gloss-popover');
                    btn.textContent = best.match;
                    afterNode.parentNode.replaceChild(btn, afterNode);
                    current = restNode;
                }
            });
        });

        if (focusedTerm) {
            const restored = document.querySelector(`button.gloss-btn[data-glossary="${focusedTerm}"]`);
            restored?.focus({ preventScroll: true });
        }

        if (openTerm) {
            const nextTrigger = document.querySelector(`button.gloss-btn[data-glossary="${openTerm}"]`);
            if (nextTrigger) {
                state.glossaryTriggerEl = nextTrigger;
                positionGlossaryPopover();
            } else {
                closeGlossaryPopover(false);
            }
        }
    }

    function positionGlossaryPopover()
    {
        const pop = el['gloss-popover'];
        const btn = state.glossaryTriggerEl;
        if (!pop || pop.hidden || !btn || !btn.isConnected) {
            return;
        }
        const bRect = btn.getBoundingClientRect();
        const pRect = pop.getBoundingClientRect();
        const pad = 12;
        const left = Math.max(pad, Math.min(window.innerWidth - pRect.width - pad, bRect.left + bRect.width / 2 - pRect.width / 2));
        let top = bRect.bottom + 6;
        if (top + pRect.height > window.innerHeight - pad) {
            top = Math.max(pad, bRect.top - pRect.height - 6);
        }
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
    }

    function openGlossaryPopover(id, triggerBtn)
    {
        if (!window.GLOSSARY || !window.GLOSSARY[id]) {
            return;
        }
        if (state.glossaryTriggerEl && state.glossaryTriggerEl !== triggerBtn) {
            state.glossaryTriggerEl.setAttribute('aria-expanded', 'false');
        }
        state.openGlossaryTerm = id;
        state.glossaryTriggerEl = triggerBtn;
        triggerBtn.setAttribute('aria-expanded', 'true');
        el['gloss-popover-text'].textContent = window.GLOSSARY[id].short;
        el['gloss-popover'].hidden = false;
        positionGlossaryPopover();
    }

    function closeGlossaryPopover(restoreFocus)
    {
        if (!el['gloss-popover'] || el['gloss-popover'].hidden) {
            return;
        }
        el['gloss-popover'].hidden = true;
        const prevBtn = state.glossaryTriggerEl;
        if (prevBtn) {
            prevBtn.setAttribute('aria-expanded', 'false');
        }
        state.openGlossaryTerm = null;
        state.glossaryTriggerEl = null;
        if (restoreFocus && prevBtn && prevBtn.isConnected) {
            prevBtn.focus({ preventScroll: true });
        }
    }

    function parseVisitDate(dateStr)
    {
        const parts = String(dateStr).trim().split(/\s+/);
        if (parts.length !== 3) {
            return EPOCH_REF_MS;
        }
        const day = parseInt(parts[0], 10);
        const mon = MONTHS[parts[1]] ?? 0;
        const yr = parseInt(parts[2], 10);
        return Date.UTC(yr, mon, day);
    }

    function formatSigned(num, digits)
    {
        const fixed = Math.abs(num).toFixed(digits);
        return (num >= 0 ? '+' : '−') + fixed;
    }

    function formatCoords(t)
    {
        return `${t.ra.toFixed(4)}°, ${formatSigned(t.dec, 4)}°`;
    }

    function announce(msg)
    {
        if (!el['sr-announce']) {
            return;
        }
        el['sr-announce'].textContent = '';
        requestAnimationFrame(() => {
            el['sr-announce'].textContent = msg;
        });
    }

    function copyText(text, badgeEl, buttonEl)
    {
        const finish = () => {
            if (badgeEl) {
                badgeEl.hidden = false;
                clearTimeout(badgeEl._timer);
                badgeEl._timer = setTimeout(() => {
                    badgeEl.hidden = true;
                }, 1600);
            }
            if (buttonEl) {
                buttonEl.classList.add('is-copied');
                clearTimeout(buttonEl._timer);
                buttonEl._timer = setTimeout(() => {
                    buttonEl.classList.remove('is-copied');
                }, 1600);
            }
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(finish).catch(() => {
                fallbackCopy(text);
                finish();
            });
        } else {
            fallbackCopy(text);
            finish();
        }
    }

    function fallbackCopy(text)
    {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            // Ignore clipboard errors in restricted sandboxes
        }
        ta.remove();
    }

    // Compute exact star position (% of 6' sky plate, North up, East left) for a visit index
    function getVisitSkyPosition(targetId, visitIndex)
    {
        const t = window.FRAMES[targetId];
        const v = t.visits[visitIndex] || t.visits[0];
        const dtYears = (parseVisitDate(v.date) - EPOCH_REF_MS) / (365.25 * 86400 * 1000);
        const dxArcsec = -(t.pmRa / 1000) * dtYears;
        const dyArcsec = -(t.pmDec / 1000) * dtYears;
        return {
            x: 50 + (dxArcsec / BASE_FOV_ARCSEC) * 100,
            y: 50 + (dyArcsec / BASE_FOV_ARCSEC) * 100,
            dxArcsec,
            dyArcsec
        };
    }

    function getNativeMidWavelength(targetId)
    {
        const t = window.FRAMES[targetId];
        return Number(((t.lam[0] + t.lam[1]) / 2).toFixed(2));
    }

    function findDetectorForWavelength(um)
    {
        const dets = window.DETECTORS;
        for (let i = 0; i < dets.length; i++) {
            const [lo, hi] = dets[i];
            if (um >= lo && um <= hi) {
                return i + 1;
            }
            if (i < dets.length - 1 && um > hi && um < dets[i + 1][0]) {
                return (um - hi) < (dets[i + 1][0] - um) ? i + 1 : i + 2;
            }
        }
        return um < dets[0][0] ? 1 : dets.length;
    }

    function clearStageTimers()
    {
        state.stageTimers.forEach((tm) => clearTimeout(tm));
        state.stageTimers = [];
    }

    function syncStageLoading()
    {
        const busy = state.targetLoading || state.stageLoading;
        el['sky-stage'].classList.toggle('loading', busy);
        el['sky-stage'].classList.toggle('is-fetching', busy);
        el['sky-status-bar'].hidden = !busy;
    }

    function runStageProgress(stages, stepMs, onDone)
    {
        clearStageTimers();
        const seq = ++state.loadSeq;
        el['sky-error-bar'].hidden = true;

        if (REDUCED_MOTION.matches) {
            stepMs = Math.min(stepMs, 90);
        }

        state.stageLoading = true;
        syncStageLoading();
        if (stages && stages.length > 0) {
            el['sky-status-bar'].hidden = false;
            el['sky-status-text'].textContent = stages[0];
            for (let k = 1; k < stages.length; k++) {
                const tm = setTimeout(() => {
                    if (seq !== state.loadSeq) {
                        return;
                    }
                    el['sky-status-text'].textContent = stages[k];
                }, k * stepMs);
                state.stageTimers.push(tm);
            }
        }

        const finishTm = setTimeout(() => {
            if (seq !== state.loadSeq) {
                return;
            }
            state.stageLoading = false;
            syncStageLoading();
            if (onDone) {
                onDone();
            }
        }, Math.max(1, stages.length) * stepMs);
        state.stageTimers.push(finishTm);
    }

    function triggerTransientLoad(ms)
    {
        el['sky-stage'].classList.add('loading');
        clearTimeout(el['sky-stage']._quickLoadTimer);
        el['sky-stage']._quickLoadTimer = setTimeout(() => {
            if (!el['sky-stage'].classList.contains('is-fetching')) {
                el['sky-stage'].classList.remove('loading');
            }
        }, REDUCED_MOTION.matches ? 80 : ms);
    }

    function swapText(node, applyFn)
    {
        if (!node) {
            return;
        }
        if (REDUCED_MOTION.matches) {
            applyFn();
            return;
        }
        node.classList.add('out');
        clearTimeout(node._swapTimer);
        node._swapTimer = setTimeout(() => {
            applyFn();
            node.classList.remove('out');
        }, 120);
    }

    // Build static icons from base.js
    function initIcons()
    {
        el['icon-search'].innerHTML = icon('search');
        el['cmd-search-icon'].innerHTML = icon('search');
        el['icon-share'].innerHTML = icon('share');
        el['icon-moon'].innerHTML = icon('moon');
        el['icon-sun'].innerHTML = icon('sun');
        el['icon-prev'].innerHTML = icon('prev');
        el['icon-next'].innerHTML = icon('next');
        el['icon-play-state'].innerHTML = icon('pause');

        const isDark = document.documentElement.dataset.theme === 'dark';
        document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
            btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        });
    }

    // Build 5-card target ribbon
    function buildTargetRibbon()
    {
        const frag = document.createDocumentFragment();
        window.ORDER.forEach((id) => {
            const c = window.COPY[id];
            const f = window.FRAMES[id];
            const lastFile = f.visits[f.visits.length - 1].file;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'target-card';
            btn.dataset.target = id;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', id === state.targetId ? 'true' : 'false');
            btn.tabIndex = id === state.targetId ? 0 : -1;

            btn.innerHTML = `
                <span class="target-thumb" aria-hidden="true">
                    <img src="img/${lastFile}" alt="" loading="eager" decoding="async">
                </span>
                <span class="target-card-copy">
                    <span class="target-card-name">${c.display}</span>
                    <span class="target-card-hook">${c.short}</span>
                </span>
            `;

            btn.addEventListener('click', () => {
                selectTarget(id, true);
            });

            btn.addEventListener('keydown', (e) => {
                const idx = window.ORDER.indexOf(id);
                let nextIdx = -1;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    nextIdx = (idx + 1) % window.ORDER.length;
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    nextIdx = (idx - 1 + window.ORDER.length) % window.ORDER.length;
                } else if (e.key === 'Home') {
                    nextIdx = 0;
                } else if (e.key === 'End') {
                    nextIdx = window.ORDER.length - 1;
                }
                if (nextIdx !== -1) {
                    e.preventDefault();
                    e.stopPropagation();
                    const nextId = window.ORDER[nextIdx];
                    selectTarget(nextId, true);
                    const nextBtn = el['target-ribbon'].querySelector(`[data-target="${nextId}"]`);
                    if (nextBtn) {
                        nextBtn.focus();
                    }
                }
            });

            frag.appendChild(btn);
        });
        el['target-ribbon'].innerHTML = '';
        el['target-ribbon'].appendChild(frag);
    }

    function updateRibbonSelection()
    {
        const cards = el['target-ribbon'].querySelectorAll('.target-card');
        cards.forEach((card) => {
            const on = !state.customQuery && card.dataset.target === state.targetId;
            card.setAttribute('aria-selected', on ? 'true' : 'false');
            card.tabIndex = (card.dataset.target === state.targetId) ? 0 : -1;
        });
    }

    // Build Wavelength Detector Bands
    function buildWavelengthBands()
    {
        const frag = document.createDocumentFragment();
        window.DETECTORS.forEach((range, idx) => {
            const detNum = idx + 1;
            const span = range[1] - range[0];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'wl-band';
            btn.dataset.det = String(detNum);
            btn.style.flex = `${Math.max(0.62, span)} 1 0%`;
            btn.tabIndex = -1;
            btn.setAttribute('aria-label', `Detector ${detNum} covers ${range[0].toFixed(2)} to ${range[1].toFixed(2)} micrometres`);
            btn.textContent = `D${detNum}`;

            btn.addEventListener('pointerenter', () => {
                showWavelengthHoverTip(detNum, range, btn);
            });
            btn.addEventListener('pointerleave', () => {
                el['wl-hover-tip'].hidden = true;
            });

            frag.appendChild(btn);
        });
        el['wl-bands'].innerHTML = '';
        el['wl-bands'].appendChild(frag);
    }

    function showWavelengthHoverTip(detNum, range, bandEl)
    {
        const tip = el['wl-hover-tip'];
        const wrapRect = el['wl-bar-container'].getBoundingClientRect();
        const bandRect = bandEl.getBoundingClientRect();
        const cx = (bandRect.left + bandRect.width / 2) - wrapRect.left;
        const nativeDet = window.FRAMES[state.targetId].detector;
        const suffix = detNum === nativeDet ? ' · saved' : '';
        tip.textContent = `Detector ${detNum} covers ${range[0].toFixed(2)}-${range[1].toFixed(2)} µm${suffix}`;
        tip.hidden = false;
        const clamped = Math.max(70, Math.min(wrapRect.width - 70, cx));
        tip.style.left = `${clamped}px`;
    }

    function positionWavelengthThumb()
    {
        const bands = Array.from(el['wl-bands'].querySelectorAll('.wl-band'));
        if (bands.length === 0) {
            return;
        }
        const trackRect = el['wl-interactive'].getBoundingClientRect();
        if (trackRect.width <= 0) {
            return;
        }
        const um = state.wavelength;
        const detIdx = Math.max(0, Math.min(bands.length - 1, findDetectorForWavelength(um) - 1));
        const [lo, hi] = window.DETECTORS[detIdx];
        const frac = Math.max(0, Math.min(1, (um - lo) / (hi - lo)));
        const bRect = bands[detIdx].getBoundingClientRect();
        const px = (bRect.left - trackRect.left) + frac * bRect.width;
        el['wl-thumb'].style.left = `${px}px`;
    }

    function updateAngularScale()
    {
        // The visible plate spans the selected field; its layout width excludes the zoom transform.
        const plateWidth = el['sky-pixels'].clientWidth;
        el['sky-scale-bar'].style.width = `${plateWidth / state.fovArcmin}px`;
        el['sky-scale-label'].textContent = '1′';
    }

    function wavelengthFromPointer(clientX)
    {
        const bands = Array.from(el['wl-bands'].querySelectorAll('.wl-band'));
        if (bands.length === 0) {
            return state.wavelength;
        }
        for (let i = 0; i < bands.length; i++) {
            const r = bands[i].getBoundingClientRect();
            const [lo, hi] = window.DETECTORS[i];
            if (clientX <= r.right || i === bands.length - 1) {
                const frac = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
                return Number((lo + frac * (hi - lo)).toFixed(2));
            }
        }
        return state.wavelength;
    }

    function syncWavelengthUI(liveOnly)
    {
        const t = window.FRAMES[state.targetId];
        const det = findDetectorForWavelength(state.wavelength);
        state.activeDetector = det;
        const [lo, hi] = window.DETECTORS[det - 1];
        const isNative = det === t.detector;

        el['wl-readout'].textContent = `${state.wavelength.toFixed(2)} µm`;
        el['wl-det-readout'].textContent = `Detector ${det} covers ${lo.toFixed(2)}-${hi.toFixed(2)} µm`;
        el['wl-interactive'].setAttribute('aria-valuenow', state.wavelength.toFixed(2));
        el['wl-interactive'].setAttribute('aria-valuetext', `${state.wavelength.toFixed(2)} micrometres, Detector ${det}`);

        const bands = el['wl-bands'].querySelectorAll('.wl-band');
        bands.forEach((b, idx) => {
            const dNum = idx + 1;
            b.classList.toggle('is-native', dNum === t.detector);
            b.classList.toggle('is-active', dNum === det);
        });

        if (isNative) {
            el['wl-source-note'].textContent = 'Saved frame';
            el['wl-source-note'].classList.remove('is-sim');
            el['wl-reset-btn'].hidden = true;
        } else {
            el['wl-source-note'].textContent = `Simulated · Saved band is D${t.detector}`;
            el['wl-source-note'].classList.add('is-sim');
            el['wl-reset-btn'].hidden = false;
        }

        if (setTextIfChanged(el['plate-wl-summary'], `This frame: ${t.lam[0].toFixed(2)}-${t.lam[1].toFixed(2)} µm`)) {
            annotateGlossaryTerms();
        }

        positionWavelengthThumb();

        if (!liveOnly) {
            commitWavelengthLoad(isNative, det);
        }
    }

    function commitWavelengthLoad(isNative, det)
    {
        const seq = ++state.wlSeq;
        const stages = isNative
            ? [window.STAGE_TEXT.pixels, window.STAGE_TEXT.regrid]
            : [
                window.STAGE_TEXT.search,
                window.STAGE_TEXT.headers,
                window.STAGE_TEXT.pixels,
                window.STAGE_TEXT.regrid
            ];
        const stepMs = isNative ? 120 : 210;

        state.lastRetryAction = () => {
            commitWavelengthLoad(isNative, det);
        };

        runStageProgress(stages, stepMs, () => {
            if (seq !== state.wlSeq) {
                return;
            }
            el['sky-pixels'].style.setProperty('--sky-fade', REDUCED_MOTION.matches ? '90ms' : '200ms');
            el['sky-pixels'].animate?.(
                [{ opacity: 0.62 }, { opacity: 1 }],
                { duration: REDUCED_MOTION.matches ? 80 : 200, easing: 'cubic-bezier(.16, 1, .3, 1)' }
            );
            setTimeout(() => {
                el['sky-pixels'].style.setProperty('--sky-fade', '0ms');
            }, 210);
            announce(`Wavelength ${state.wavelength.toFixed(2)} micrometres, Detector ${det}`);
        });
    }

    // Build Date Scrubber ticks for current target
    function buildScrubberTicks()
    {
        const t = player.t;
        const n = t.visits.length;
        const frag = document.createDocumentFragment();

        t.visits.forEach((v, idx) => {
            const pct = n === 1 ? 50 : (idx / (n - 1)) * 100;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'scrubber-tick';
            btn.style.left = `${pct}%`;
            btn.tabIndex = -1;
            btn.dataset.visit = String(idx);
            btn.setAttribute('aria-label', `Jump to visit ${idx + 1} of ${n}, ${v.date}`);

            btn.addEventListener('pointerenter', () => {
                showScrubberPeek(idx);
            });
            btn.addEventListener('pointerleave', () => {
                el['scrubber-peek'].hidden = true;
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                jumpToVisit(idx, true);
            });

            frag.appendChild(btn);
        });

        el['scrubber-ticks'].innerHTML = '';
        el['scrubber-ticks'].appendChild(frag);
        el['scrubber-track-area'].setAttribute('aria-valuemax', String(n));
    }

    function showScrubberPeek(idx)
    {
        const t = window.FRAMES[state.targetId];
        const v = t.visits[idx];
        if (!v) {
            return;
        }
        const n = t.visits.length;
        const pct = n === 1 ? 50 : (idx / (n - 1)) * 100;
        const wrapRect = el['scrubber-wrap'].getBoundingClientRect();
        const rawX = 7 + (pct / 100) * Math.max(1, wrapRect.width - 14);
        const clampedX = Math.max(60, Math.min(wrapRect.width - 60, rawX));

        el['peek-img'].src = `img/${v.file}`;
        el['peek-date'].textContent = v.date;
        el['peek-sub'].textContent = `Visit ${idx + 1} of ${n}`;
        el['scrubber-peek'].style.left = `${clampedX}px`;
        el['scrubber-peek'].hidden = false;
    }

    function updateScrubberUI()
    {
        const t = player.t;
        const n = t.visits.length;
        const idx = player.i;
        const v = t.visits[idx];
        const pct = n === 1 ? 50 : (idx / (n - 1)) * 100;

        el['scrubber-current-date'].textContent = v.date;
        el['scrubber-visit-count'].textContent = `Visit ${idx + 1} / ${n}`;
        el['scrubber-fill'].style.width = `${pct}%`;
        el['scrubber-thumb'].style.left = `calc(7px + (100% - 14px) * ${(pct / 100).toFixed(4)})`;

        el['scrubber-track-area'].setAttribute('aria-valuenow', String(idx + 1));
        el['scrubber-track-area'].setAttribute('aria-valuetext', `Visit ${idx + 1} of ${n}, ${v.date}`);

        const ticks = el['scrubber-ticks'].querySelectorAll('.scrubber-tick');
        ticks.forEach((tick, k) => {
            tick.classList.toggle('is-past', k <= idx);
        });
    }

    // Astronomical SVG overlays: Gold proper-motion ring and dotted visit trail from frames.js
    function rebuildTargetTrailSVG()
    {
        const t = player.t;
        const positions = t.visits.map((_, k) => getVisitSkyPosition(player.id, k));
        let svgHtml = '';

        if (positions.length > 1) {
            const pts = positions.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
            svgHtml += `<polyline class="trail-path" points="${pts}"></polyline>`;
        }

        positions.forEach((p, idx) => {
            svgHtml += `<circle class="trail-ring" data-trail-idx="${idx}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4.5"></circle>`;
        });

        el['ov-trail'].innerHTML = svgHtml;
    }

    function updateActiveTargetRing(animateDraw)
    {
        const pos = getVisitSkyPosition(player.id, player.i);
        const cx = pos.x.toFixed(2);
        const cy = pos.y.toFixed(2);

        el['target-ring'].setAttribute('cx', cx);
        el['target-ring'].setAttribute('cy', cy);
        el['target-ring-shadow'].setAttribute('cx', cx);
        el['target-ring-shadow'].setAttribute('cy', cy);

        // Hide the dotted trail circle at the currently active visit so the solid gold ring owns it cleanly
        const trailCircles = el['ov-trail'].querySelectorAll('.trail-ring');
        trailCircles.forEach((c, idx) => {
            c.style.opacity = idx === player.i ? '0' : '1';
        });

        if (animateDraw && !REDUCED_MOTION.matches) {
            el['target-ring'].classList.remove('is-drawing');
            void el['target-ring'].getBoundingClientRect();
            el['target-ring'].classList.add('is-drawing');
            clearTimeout(el['target-ring']._drawTimer);
            el['target-ring']._drawTimer = setTimeout(() => {
                el['target-ring'].classList.remove('is-drawing');
            }, 440);
        }
    }

    function syncOverlayVisibility(changedKey)
    {
        const ov = state.overlays;
        el['ov-target'].hidden = !ov.targetPos;
        el['ov-trail'].hidden = !ov.targetPos;
        el['mock-note-gaia'].hidden = !ov.gaia;
        el['mock-note-flags'].hidden = !ov.flags;
        el['mock-note-older'].hidden = !ov.older;
        el['sky-false-badge'].hidden = !ov.falseColour;
        el['false-colour-reveal'].classList.toggle('open', ov.falseColour);

        if (changedKey === 'targetPos' && ov.targetPos) {
            el['ov-target'].classList.remove('fading-in');
            void el['ov-target'].getBoundingClientRect();
            el['ov-target'].classList.add('fading-in');
            updateActiveTargetRing(true);
        }

        const activeCount = Object.values(ov).filter(Boolean).length;
        el['trigger-meta-overlays'].textContent = `${activeCount} on · ${state.fovArcmin}′`;

        if (state.sheetOpen && !el['bottom-sheet'].hidden) {
            annotateGlossaryTerms();
        }
    }

    // Build Interactive Sky Map ("Where in the sky")
    function buildSkyMap()
    {
        const svgNS = 'http://www.w3.org/2000/svg';
        const frag = document.createDocumentFragment();

        window.ORDER.forEach((id) => {
            const t = window.FRAMES[id];
            const c = window.COPY[id];
            // Map RA 0..360 -> x 24..336, Dec +90..-90 -> y 16..164
            const x = 24 + (t.ra / 360) * 312;
            const y = 90 - (t.dec / 90) * 74;

            const g = document.createElementNS(svgNS, 'g');
            g.setAttribute('class', 'skymap-star');
            g.setAttribute('tabindex', '0');
            g.setAttribute('role', 'button');
            g.dataset.target = id;
            g.setAttribute('aria-label', `${c.display}: ${c.short} (RA ${t.ra.toFixed(1)} degrees, Dec ${t.dec.toFixed(1)} degrees)`);

            const hit = document.createElementNS(svgNS, 'circle');
            hit.setAttribute('class', 'skymap-star-hit');
            hit.setAttribute('cx', x.toFixed(1));
            hit.setAttribute('cy', y.toFixed(1));
            hit.setAttribute('r', '14');

            const ring = document.createElementNS(svgNS, 'circle');
            ring.setAttribute('class', 'skymap-star-ring');
            ring.setAttribute('cx', x.toFixed(1));
            ring.setAttribute('cy', y.toFixed(1));
            ring.setAttribute('r', '8.5');

            const dot = document.createElementNS(svgNS, 'circle');
            dot.setAttribute('class', 'skymap-star-dot');
            dot.setAttribute('cx', x.toFixed(1));
            dot.setAttribute('cy', y.toFixed(1));
            dot.setAttribute('r', '4');

            g.appendChild(hit);
            g.appendChild(ring);
            g.appendChild(dot);

            const showHover = () => {
                el['skymap-hover-name'].textContent = c.display;
                el['skymap-hover-hook'].textContent = c.short;
                el['skymap-hover-card'].hidden = false;
                el['skymap-readout'].textContent = `RA ${t.ra.toFixed(1)}°, Dec ${formatSigned(t.dec, 1)}°`;
            };
            const hideHover = () => {
                el['skymap-hover-card'].hidden = true;
                el['skymap-readout'].textContent = 'Click any star to switch';
            };

            g.addEventListener('pointerenter', showHover);
            g.addEventListener('focus', showHover);
            g.addEventListener('pointerleave', hideHover);
            g.addEventListener('blur', hideHover);

            g.addEventListener('click', () => {
                selectTarget(id, true);
            });
            g.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectTarget(id, true);
                }
            });

            frag.appendChild(g);
        });

        el['skymap-points'].innerHTML = '';
        el['skymap-points'].appendChild(frag);
    }

    function updateSkyMapActive()
    {
        const stars = el['skymap-points'].querySelectorAll('.skymap-star');
        stars.forEach((s) => {
            s.classList.toggle('is-current', !state.customQuery && s.dataset.target === state.targetId);
        });
    }

    // Animated Proper Motion Diagram synchronized with player visit index
    function updateMotionDiagram()
    {
        const t = player.t;
        const n = t.visits.length;
        const idx = player.i;
        const pmMasYr = Math.hypot(t.pmRa, t.pmDec);
        const pmArcsecYr = pmMasYr / 1000;

        el['motion-rate-label'].textContent = `${pmArcsecYr.toFixed(2)}″ / yr`;
        el['motion-components'].textContent = `pmRA ${formatSigned(t.pmRa, 1)}, pmDec ${formatSigned(t.pmDec, 1)} mas/yr`;
        el['motion-step-readout'].textContent = `Visit ${idx + 1} of ${n} · ${t.visits[idx].date}`;

        // North up (-y), East left (-x). Scale length honestly relative to Barnard's Star (~10.4"/yr)
        const ux = pmMasYr > 0.001 ? (-t.pmRa / pmMasYr) : 0;
        const uy = pmMasYr > 0.001 ? (-t.pmDec / pmMasYr) : -1;
        const halfSpan = Math.max(8, Math.min(48, (pmArcsecYr / 10.4) * 48));

        const x0 = 110 - ux * halfSpan;
        const y0 = 90 - uy * halfSpan;
        const x1 = 110 + ux * halfSpan;
        const y1 = 90 + uy * halfSpan;

        el['motion-path-full'].setAttribute('x1', x0.toFixed(1));
        el['motion-path-full'].setAttribute('y1', y0.toFixed(1));
        el['motion-path-full'].setAttribute('x2', x1.toFixed(1));
        el['motion-path-full'].setAttribute('y2', y1.toFixed(1));

        // Interpolate active vector endpoint by visit date fraction
        const tStart = parseVisitDate(t.visits[0].date);
        const tEnd = parseVisitDate(t.visits[n - 1].date);
        const tCur = parseVisitDate(t.visits[idx].date);
        const frac = tEnd > tStart ? (tCur - tStart) / (tEnd - tStart) : 1;

        const xa = x0 + (x1 - x0) * Math.max(0.08, frac);
        const ya = y0 + (y1 - y0) * Math.max(0.08, frac);
        el['motion-path-active'].setAttribute('x1', x0.toFixed(1));
        el['motion-path-active'].setAttribute('y1', y0.toFixed(1));
        el['motion-path-active'].setAttribute('x2', xa.toFixed(1));
        el['motion-path-active'].setAttribute('y2', ya.toFixed(1));

        const svgNS = 'http://www.w3.org/2000/svg';
        const frag = document.createDocumentFragment();
        t.visits.forEach((v, k) => {
            const tk = parseVisitDate(v.date);
            const fk = tEnd > tStart ? (tk - tStart) / (tEnd - tStart) : 0.5;
            const dx = x0 + (x1 - x0) * fk;
            const dy = y0 + (y1 - y0) * fk;
            const c = document.createElementNS(svgNS, 'circle');
            c.setAttribute('class', k === idx ? 'motion-visit-dot is-active' : 'motion-visit-dot');
            c.setAttribute('cx', dx.toFixed(1));
            c.setAttribute('cy', dy.toFixed(1));
            c.setAttribute('r', k === idx ? '4.5' : '3');
            c.addEventListener('click', () => {
                jumpToVisit(k, true);
            });
            frag.appendChild(c);
        });
        el['motion-visit-dots'].innerHTML = '';
        el['motion-visit-dots'].appendChild(frag);
    }

    // Sync "What to look for" & "This frame" sheet copy and readouts
    function updateSheetsContent()
    {
        const t = player.t;
        const customQuery = player.id === state.targetId ? state.customQuery : null;
        const c = customQuery ? window.CUSTOM_COPY : window.COPY[player.id];
        const v = player.visit;
        const n = t.visits.length;
        const pmArcsecYr = Math.hypot(t.pmRa, t.pmDec) / 1000;
        const coordsStr = customQuery ? customQuery : formatCoords(t);

        // Guide sheet
        const g1 = setTextIfChanged(el['guide-headline'], c.headline);
        setTextIfChanged(el['guide-coords-text'], customQuery ? customQuery : `RA ${t.ra.toFixed(4)}°, Dec ${formatSigned(t.dec, 4)}°`);
        const g2 = setTextIfChanged(el['guide-show'], c.show);
        const g3 = setTextIfChanged(el['guide-not'], c.not);

        // Frame spec sheet
        const titleName = customQuery ? `Custom sky spot (${customQuery})` : window.COPY[player.id].display;
        el['spec-target-title'].textContent = `${titleName} — Visit ${player.i + 1} of ${n}`;
        const s1 = setTextIfChanged(
            el['spec-subtitle'],
            customQuery
                ? 'Simulated custom search · Showing saved cutout pixel stand-in'
                : 'Real SPHEREx cutout · Saved single-band frame'
        );
        el['spec-date'].textContent = v.date;
        el['spec-visit'].textContent = `${player.i + 1} of ${n}`;
        el['spec-obsid'].textContent = v.obsId;
        el['spec-frames'].textContent = String(v.frames);
        const s2 = setTextIfChanged(el['spec-detector'], `Detector ${t.detector} of 6`);
        const s3 = setTextIfChanged(el['spec-lam'], `${t.lam[0].toFixed(2)}-${t.lam[1].toFixed(2)} µm`);
        el['spec-coords'].textContent = coordsStr;
        const s4 = setTextIfChanged(el['spec-pm'], `${pmArcsecYr.toFixed(2)}″/yr (${formatSigned(t.pmRa, 1)}, ${formatSigned(t.pmDec, 1)} mas/yr)`);
        const s5 = setTextIfChanged(el['spec-field'], `${state.fovArcmin}′ × ${state.fovArcmin}′ · North up, East left`);
        el['spec-file'].textContent = v.file;
        el['fits-feedback'].hidden = true;

        el['trigger-meta-frame'].textContent = `D${t.detector} · ${v.frames} fr`;

        if ((g1 || g2 || g3 || s1 || s2 || s3 || s4 || s5) && state.sheetOpen && !el['bottom-sheet'].hidden) {
            annotateGlossaryTerms();
        }
    }

    function syncPlaybackUI()
    {
        if (!player) {
            return;
        }
        const isPlaying = !!player.timer;
        el['btn-play'].setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
        el['btn-play'].setAttribute('aria-label', isPlaying ? 'Pause blinking (Space)' : 'Play blinking (Space)');
        el['icon-play-state'].innerHTML = icon(isPlaying ? 'pause' : 'play');
        el['sky-stage'].classList.toggle('is-paused', !isPlaying && player.mode === 'blink');
    }

    function showPlayerMessage(message)
    {
        el['sky-error-text'].textContent = message;
        el['sky-error-bar'].hidden = false;
        state.lastRetryAction = () => {
            player.retry();
        };
    }

    // Frame metadata changes only after the corresponding pixels are ready to display.
    function onPlayerChange()
    {
        if (!player) {
            return;
        }
        const t = player.t;
        const n = t.visits.length;
        const v = player.visit;
        const mode = player.displayMode;
        if (state.displayedTargetId !== player.id) {
            state.displayedTargetId = player.id;
            buildScrubberTicks();
            rebuildTargetTrailSVG();
        }
        syncPlaybackUI();
        el['sky-error-bar'].hidden = true;

        // Corner tag inside sky plate
        if (state.holdingFirst) {
            el['sky-tag'].textContent = `${v.date} · Visit 1 of ${n} (holding first)`;
        } else if (mode === 'blink') {
            el['sky-tag'].textContent = `${v.date} · Visit ${player.i + 1} of ${n}`;
        } else if (mode === 'stack') {
            el['sky-tag'].textContent = `Stack · ${n} visits averaged`;
        } else {
            el['sky-tag'].textContent = `Subtract · ${t.visits[n - 1].date} − ${t.visits[0].date}`;
        }

        // Move gold ring synchronously with the hard cut
        updateActiveTargetRing(false);
        updateScrubberUI();
        updateMotionDiagram();
        updateSheetsContent();
        syncLoupeSource();
    }

    function jumpToVisit(idx, byUser)
    {
        if (player.mode !== 'blink') {
            setComparisonMode('blink', false);
        }
        player.play(false);
        el['sky-pixels'].style.setProperty('--sky-fade', '0ms');
        player.fade = 0;
        triggerTransientLoad(110);
        return player.go(idx).then((shown) => {
            if (shown && byUser) {
                announceCurrentVisit();
            }
        });
    }

    function announceCurrentVisit()
    {
        announce(`Visit ${player.i + 1} of ${player.t.visits.length}, ${player.visit.date}`);
    }

    function setComparisonMode(mode, byUser)
    {
        const buttons = document.querySelectorAll('.mode-seg button[data-mode]');
        buttons.forEach((b) => {
            b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
        });

        const helpLine = getModeHelpLine(mode);
        swapText(el['dock-mode-hint'], () => {
            if (setTextIfChanged(el['dock-mode-hint'], helpLine)) {
                annotateGlossaryTerms();
            }
        });

        player.setMode(mode);
        if (mode === 'blink' && byUser && !REDUCED_MOTION.matches) {
            player.play(true);
        }

        if (byUser) {
            const label = mode === 'diff' ? 'Subtract' : (mode === 'stack' ? 'Stack' : 'Blink');
            announce(`${label} mode. ${helpLine}`);
        }
    }

    // Target switching: fixed layout, old plate dims to 60% under 2px progress line,
    // new plate crossfades in (250 ms) with settle (1.04 -> 1), title & copy swap at midpoint.
    function selectTarget(id, byUser, customQueryText = null, force = false)
    {
        if (!window.FRAMES[id]) {
            return;
        }
        const sameSpot = !force && id === state.targetId && id === player.id && customQueryText === state.customQuery && state.booted && !state.targetLoading;
        if (sameSpot) {
            return;
        }

        clearStageTimers();
        ++state.loadSeq;
        ++state.wlSeq;
        state.stageLoading = false;
        state.targetTimers.forEach((tm) => clearTimeout(tm));
        state.targetTimers = [];
        const switchSeq = ++state.targetSeq;
        // Stop the old target before changing the selected target or its visit count.
        player.play(false);
        player.cancelPending();
        state.targetId = id;
        state.customQuery = customQueryText;
        state.wavelength = getNativeMidWavelength(id);

        updateRibbonSelection();
        updateSkyMapActive();
        el['sky-error-bar'].hidden = true;
        el['sky-custom-bar'].hidden = !customQueryText;
        if (customQueryText) {
            el['sky-custom-label'].textContent = customQueryText;
        }

        const t = window.FRAMES[id];
        const c = customQueryText ? window.CUSTOM_COPY : window.COPY[id];

        state.lastRetryAction = () => {
            selectTarget(id, true, customQueryText, true);
        };

        // Pause blinking during transition and show 2px progress bar + 60% dim
        state.targetLoading = true;
        syncStageLoading();
        el['sky-status-text'].textContent = window.STAGE_TEXT.pixels;

        if (customQueryText || state.archiveSource === 'live') {
            el['sky-status-bar'].hidden = false;
            el['sky-status-text'].textContent = window.STAGE_TEXT.search;
        }

        // Pre-decode latest frame of the incoming target before swapping
        const lastVisit = t.visits[t.visits.length - 1];
        const pre = new Image();
        pre.src = `img/${lastVisit.file}`;

        const minDelay = customQueryText ? 520 : (state.archiveSource === 'live' ? 440 : 140);
        const startMs = performance.now();

        // Midpoint swap for headline, coordinates, and caption
        swapText(el['stage-headline'], () => {
            setTextIfChanged(el['stage-headline'], c.headline);
            el['stage-coords-text'].textContent = customQueryText ? customQueryText : formatCoords(t);
            updateStageProperMotion(id, !!customQueryText);
            annotateGlossaryTerms();
        });
        swapText(el['stage-caption'], () => {
            setTextIfChanged(el['stage-show'], c.show);
            setTextIfChanged(el['stage-caveat'], c.not);
            annotateGlossaryTerms();
        });

        if (customQueryText || state.archiveSource === 'live') {
            const tm = setTimeout(() => {
                if (switchSeq === state.targetSeq) {
                    el['sky-status-text'].textContent = window.STAGE_TEXT.pixels;
                }
            }, Math.round(minDelay * 0.55));
            state.targetTimers.push(tm);
        }

        pre.decode().then(() => {
            const elapsed = performance.now() - startMs;
            const wait = Math.max(0, (REDUCED_MOTION.matches ? 60 : minDelay) - elapsed);
            const tm = setTimeout(async () => {
                if (switchSeq !== state.targetSeq) {
                    return;
                }

                // 250ms crossfade + 1.04 -> 1 settle on target arrival, then return to 0ms hard-cut for blink
                player.fade = REDUCED_MOTION.matches ? 90 : 250;
                const shown = await player.setTarget(id);
                if (switchSeq !== state.targetSeq) {
                    return;
                }
                state.targetLoading = false;
                syncStageLoading();
                if (!shown) {
                    state.lastRetryAction = () => selectTarget(id, true, customQueryText, true);
                    return;
                }
                setTimeout(() => {
                    player.fade = 0;
                }, 270);

                if (!REDUCED_MOTION.matches) {
                    el['sky-stage'].classList.remove('is-settling');
                    void el['sky-stage'].getBoundingClientRect();
                    el['sky-stage'].classList.add('is-settling');
                    clearTimeout(el['sky-stage']._settleTimer);
                    el['sky-stage']._settleTimer = setTimeout(() => {
                        el['sky-stage'].classList.remove('is-settling');
                    }, 280);
                }

                buildScrubberTicks();
                rebuildTargetTrailSVG();
                syncWavelengthUI(true);
                updateActiveTargetRing(true);
                onPlayerChange();

                if (player.mode === 'blink' && !REDUCED_MOTION.matches) {
                    player.play(true);
                }

                updateHashQuietly();
                if (byUser) {
                    announce(`${customQueryText || window.COPY[id].display}. ${c.headline}`);
                }
            }, wait);
            state.targetTimers.push(tm);
        }).catch(() => {
            if (switchSeq !== state.targetSeq) {
                return;
            }
            state.targetLoading = false;
            syncStageLoading();
            showPlayerMessage('Couldn’t load target — showing last saved look.');
            state.lastRetryAction = () => selectTarget(id, true, customQueryText, true);
        });
    }

    function updateHashQuietly()
    {
        try {
            history.replaceState(null, '', `#${state.targetId}`);
        } catch (err) {
            // Ignore history errors in restricted file:// contexts
        }
    }

    // Hover Loupe (2x, square, 4px corners, real SPHEREx pixels)
    function syncLoupeSource()
    {
        if (el['sky-loupe'].hidden) {
            return;
        }
        const v = player.visit;
        if (player.displayMode === 'blink') {
            el['loupe-img'].hidden = false;
            el['loupe-canvas'].hidden = true;
            const wantSrc = `img/${v.file}`;
            if (el['loupe-img'].getAttribute('src') !== wantSrc) {
                el['loupe-img'].setAttribute('src', wantSrc);
            }
        } else if (player.canvas && !player.canvas.hidden) {
            el['loupe-img'].hidden = true;
            el['loupe-canvas'].hidden = false;
            const lc = el['loupe-canvas'];
            lc.width = player.canvas.width;
            lc.height = player.canvas.height;
            const ctx = lc.getContext('2d');
            ctx.drawImage(player.canvas, 0, 0);
        }
    }

    function updateLoupeAtPointer(e)
    {
        if (e.pointerType && e.pointerType !== 'mouse') {
            el['sky-loupe'].hidden = true;
            return;
        }
        if (state.holdingFirst || e.target.closest('.sky-error-bar, .sky-custom-bar')) {
            el['sky-loupe'].hidden = true;
            return;
        }

        const rect = el['sky-stage'].getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
            el['sky-loupe'].hidden = true;
            return;
        }

        if (el['sky-loupe'].hidden) {
            el['sky-loupe'].hidden = false;
            syncLoupeSource();
        }

        const loupeSize = 116;
        const zoom = 2;
        const fovScale = BASE_FOV_ARCSEC / (state.fovArcmin * 60);
        const totalScale = zoom * fovScale;

        // Account for centred viewport scale when mapping pointer to underlying 6' cutout
        const imgCoordX = (x - rect.width / 2) / fovScale + rect.width / 2;
        const imgCoordY = (y - rect.height / 2) / fovScale + rect.height / 2;

        const innerW = rect.width * totalScale;
        const innerH = rect.height * totalScale;
        const tx = (loupeSize / 2) - imgCoordX * totalScale;
        const ty = (loupeSize / 2) - imgCoordY * totalScale;

        el['loupe-inner'].style.width = `${innerW}px`;
        el['loupe-inner'].style.height = `${innerH}px`;
        el['loupe-inner'].style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;

        // Keep loupe inside sky plate bounds, offset from cursor
        let lx = x + 18;
        let ly = y - loupeSize - 14;
        if (lx + loupeSize > rect.width - 8) {
            lx = x - loupeSize - 18;
        }
        if (ly < 8) {
            ly = y + 18;
        }
        lx = Math.max(8, Math.min(rect.width - loupeSize - 8, lx));
        ly = Math.max(8, Math.min(rect.height - loupeSize - 8, ly));

        el['sky-loupe'].style.left = `${lx}px`;
        el['sky-loupe'].style.top = `${ly}px`;
    }

    // Press-and-hold on plate -> temporary cut to first visit (Visit 0); release -> return
    function startHoldFirstVisit()
    {
        if (state.holdingFirst) {
            return;
        }
        state.holdingFirst = true;
        state.holdWasPlaying = !!player.timer;
        state.holdPrevIndex = player.i;
        el['sky-loupe'].hidden = true;

        if (player.mode !== 'blink') {
            setComparisonMode('blink', false);
        }
        player.play(false);
        player.fade = 0;
        el['sky-stage'].classList.add('is-holding');
        player.go(0);
    }

    function endHoldFirstVisit()
    {
        if (!state.holdingFirst) {
            return;
        }
        state.holdingFirst = false;
        el['sky-stage'].classList.remove('is-holding');
        player.fade = 0;
        player.go(state.holdPrevIndex);
        if (state.holdWasPlaying) {
            player.play(true);
        }
    }

    // Bottom Sheets ("What to look for", "Overlays & field", "This frame")
    function openSheet(tabId, triggerBtn)
    {
        if (state.sheetOpen === tabId && !el['bottom-sheet'].hidden) {
            closeSheet();
            return;
        }

        state.sheetOpen = tabId;
        if (triggerBtn) {
            state.sheetTriggerEl = triggerBtn;
        }

        // Update trigger expanded states
        document.querySelectorAll('[data-sheet-open]').forEach((btn) => {
            btn.setAttribute('aria-expanded', btn.dataset.sheetOpen === tabId ? 'true' : 'false');
        });

        el['sheet-backdrop'].hidden = false;
        el['bottom-sheet'].hidden = false;
        el['bottom-sheet'].classList.remove('is-closing');

        activateSheetTab(tabId);

        requestAnimationFrame(() => {
            el['sheet-backdrop'].classList.add('is-open');
            el['bottom-sheet'].classList.add('is-open');
        });

        // Keep sky plate visible above the ~58% sheet if scrolled down
        const skyRect = el['sky-stage'].getBoundingClientRect();
        if (skyRect.top < 54 || skyRect.top > window.innerHeight * 0.25) {
            window.scrollTo({
                top: Math.max(0, window.scrollY + skyRect.top - 66),
                behavior: REDUCED_MOTION.matches ? 'auto' : 'smooth'
            });
        }

        const tabBtn = document.getElementById(`tab-${tabId}`);
        if (tabBtn) {
            tabBtn.focus({ preventScroll: true });
        }
    }

    function activateSheetTab(tabId)
    {
        state.sheetOpen = tabId;
        const titles = {
            guide: 'What to look for',
            overlays: 'Overlays and field',
            frame: 'This frame'
        };
        el['sheet-title'].textContent = titles[tabId] || 'Details';

        ['guide', 'overlays', 'frame'].forEach((key) => {
            const tab = document.getElementById(`tab-${key}`);
            const panel = document.getElementById(`panel-${key}`);
            const on = key === tabId;
            if (tab) {
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                tab.tabIndex = on ? 0 : -1;
            }
            if (panel) {
                panel.hidden = !on;
            }
        });

        document.querySelectorAll('[data-sheet-open]').forEach((btn) => {
            btn.setAttribute('aria-expanded', btn.dataset.sheetOpen === tabId ? 'true' : 'false');
        });

        if (!el['bottom-sheet'].hidden) {
            annotateGlossaryTerms();
        }
    }

    function closeSheet()
    {
        if (el['bottom-sheet'].hidden) {
            return;
        }
        if (state.glossaryTriggerEl && el['bottom-sheet'].contains(state.glossaryTriggerEl)) {
            closeGlossaryPopover(false);
        }
        state.sheetOpen = null;
        document.querySelectorAll('[data-sheet-open]').forEach((btn) => {
            btn.setAttribute('aria-expanded', 'false');
        });

        el['sheet-backdrop'].classList.remove('is-open');
        el['bottom-sheet'].classList.remove('is-open');
        el['bottom-sheet'].classList.add('is-closing');

        const delay = REDUCED_MOTION.matches ? 20 : 150;
        setTimeout(() => {
            if (!state.sheetOpen) {
                el['bottom-sheet'].hidden = true;
                el['sheet-backdrop'].hidden = true;
                el['bottom-sheet'].classList.remove('is-closing');
                annotateGlossaryTerms();
            }
        }, delay);

        if (state.sheetTriggerEl) {
            state.sheetTriggerEl.focus({ preventScroll: true });
        }
    }

    // Centred Command Palette (⌘K)
    function openCommandPalette()
    {
        if (state.cmdOpen) {
            return;
        }
        state.cmdOpen = true;
        el['search-open'].setAttribute('aria-expanded', 'true');
        el['cmd-backdrop'].hidden = false;
        el['cmd-input'].value = '';
        renderCommandItems('');
        el['cmd-input'].focus();
    }

    function closeCommandPalette(restoreFocus = true)
    {
        if (!state.cmdOpen) {
            return;
        }
        state.cmdOpen = false;
        el['search-open'].setAttribute('aria-expanded', 'false');
        el['cmd-backdrop'].hidden = true;
        if (restoreFocus) {
            el['search-open'].focus();
        }
    }

    function renderCommandItems(query)
    {
        const q = query.trim().toLowerCase();
        const items = [];

        window.ORDER.forEach((id) => {
            const c = window.COPY[id];
            const f = window.FRAMES[id];
            const hay = `${c.display} ${f.name} ${c.short} ${f.ra} ${f.dec} d${f.detector}`.toLowerCase();
            if (!q || hay.includes(q)) {
                items.push({
                    kind: 'target',
                    id,
                    title: c.display,
                    sub: c.short,
                    meta: `D${f.detector} · ${f.visits.length} visits`,
                    thumb: `img/${f.visits[f.visits.length - 1].file}`
                });
            }
        });

        if (q.length > 0) {
            items.push({
                kind: 'custom',
                query: query.trim(),
                title: `Look up “${query.trim()}”`,
                sub: 'Simulated archive cutout at this star or RA, Dec',
                meta: 'Archive mockup'
            });
        }

        state.cmdItems = items;
        state.cmdIndex = 0;

        el['cmd-list'].innerHTML = items.map((item, idx) => {
            const thumbHtml = item.thumb
                ? `<img src="${item.thumb}" alt="">`
                : `<span>RA</span>`;
            return `
                <button type="button" class="cmd-item" role="option" data-cmd-idx="${idx}" aria-selected="${idx === 0 ? 'true' : 'false'}">
                    <span class="cmd-item-thumb" aria-hidden="true">${thumbHtml}</span>
                    <span class="cmd-item-body">
                        <span class="cmd-item-title">${escapeHtml(item.title)}</span>
                        <span class="cmd-item-sub">${escapeHtml(item.sub)}</span>
                    </span>
                    <span class="cmd-item-meta num">${escapeHtml(item.meta)}</span>
                </button>
            `;
        }).join('');

        el['cmd-list'].querySelectorAll('.cmd-item').forEach((btn) => {
            btn.addEventListener('pointerenter', () => {
                setCmdActiveIndex(parseInt(btn.dataset.cmdIdx, 10));
            });
            btn.addEventListener('click', () => {
                executeCmdItem(parseInt(btn.dataset.cmdIdx, 10));
            });
        });
    }

    function escapeHtml(str)
    {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function setCmdActiveIndex(idx)
    {
        if (state.cmdItems.length === 0) {
            return;
        }
        state.cmdIndex = ((idx % state.cmdItems.length) + state.cmdItems.length) % state.cmdItems.length;
        const nodes = el['cmd-list'].querySelectorAll('.cmd-item');
        nodes.forEach((n, k) => {
            const on = k === state.cmdIndex;
            n.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on) {
                n.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function executeCmdItem(idx)
    {
        const item = state.cmdItems[idx];
        if (!item) {
            return;
        }
        closeCommandPalette(false);
        if (item.kind === 'target') {
            el['search-trigger-text'].textContent = 'Any star, or RA, Dec';
            selectTarget(item.id, true, null);
        } else {
            el['search-trigger-text'].textContent = item.query;
            selectTarget(state.targetId, true, item.query);
        }
        el['sky-stage'].focus({ preventScroll: true });
    }

    // Bind all DOM interactions
    function bindEvents()
    {
        // Brand home link
        el['brand-home'].addEventListener('click', (e) => {
            e.preventDefault();
            el['search-trigger-text'].textContent = 'Any star, or RA, Dec';
            selectTarget('barnard', true, null);
        });

        // Copy link button in topbar
        el['copy-link-btn'].addEventListener('click', () => {
            const url = `${location.href.split('#')[0]}#${state.targetId}`;
            copyText(url, null, el['copy-link-btn']);
            el['copy-link-label'].textContent = 'Copied';
            clearTimeout(el['copy-link-btn']._labelTimer);
            el['copy-link-btn']._labelTimer = setTimeout(() => {
                el['copy-link-label'].textContent = 'Copy link';
            }, 1600);
            announce('Copied link to clipboard');
        });

        // Coordinate & obsId inline copy buttons
        el['stage-coords'].addEventListener('click', () => {
            const t = window.FRAMES[state.targetId];
            const val = state.customQuery || `${t.ra.toFixed(4)}, ${t.dec >= 0 ? '+' : ''}${t.dec.toFixed(4)}`;
            copyText(val, el['stage-coords-copied'], null);
            announce(`Copied coordinates ${val}`);
        });

        el['guide-coords-btn'].addEventListener('click', () => {
            const t = window.FRAMES[state.targetId];
            const val = state.customQuery || `${t.ra.toFixed(4)}, ${t.dec >= 0 ? '+' : ''}${t.dec.toFixed(4)}`;
            copyText(val, el['guide-coords-copied'], null);
            announce(`Copied coordinates ${val}`);
        });

        el['spec-coords-btn'].addEventListener('click', () => {
            const t = window.FRAMES[state.targetId];
            const val = state.customQuery || `${t.ra.toFixed(4)}, ${t.dec >= 0 ? '+' : ''}${t.dec.toFixed(4)}`;
            copyText(val, el['spec-coords-copied'], null);
            announce(`Copied coordinates ${val}`);
        });

        el['spec-obsid-btn'].addEventListener('click', () => {
            const v = player.visit;
            copyText(v.obsId, el['spec-obsid-copied'], null);
            announce(`Copied observation ID ${v.obsId}`);
        });

        // Sky stage: Hover Loupe + Press-and-Hold for Visit 0
        el['sky-stage'].addEventListener('pointermove', updateLoupeAtPointer);
        el['sky-stage'].addEventListener('pointerleave', () => {
            el['sky-loupe'].hidden = true;
            endHoldFirstVisit();
        });
        el['sky-stage'].addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || e.target.closest('button')) {
                return;
            }
            el['sky-stage'].setPointerCapture?.(e.pointerId);
            startHoldFirstVisit();
        });
        el['sky-stage'].addEventListener('pointerup', () => {
            endHoldFirstVisit();
        });
        el['sky-stage'].addEventListener('pointercancel', () => {
            endHoldFirstVisit();
        });

        // Error & Custom spot banners inside Sky
        el['sky-retry-btn'].addEventListener('click', () => {
            el['sky-error-bar'].hidden = true;
            if (state.lastRetryAction) {
                state.lastRetryAction();
            }
        });
        el['sky-error-dismiss'].addEventListener('click', () => {
            el['sky-error-bar'].hidden = true;
        });
        el['sky-custom-reset'].addEventListener('click', () => {
            el['search-trigger-text'].textContent = 'Any star, or RA, Dec';
            selectTarget(state.targetId, true, null);
        });

        // Playback buttons
        el['btn-prev'].addEventListener('click', () => {
            if (player.mode !== 'blink') {
                setComparisonMode('blink', false);
            }
            player.play(false);
            player.fade = 0;
            triggerTransientLoad(90);
            player.step(-1).then((shown) => {
                if (shown) {
                    announceCurrentVisit();
                }
            });
        });

        el['btn-next'].addEventListener('click', () => {
            if (player.mode !== 'blink') {
                setComparisonMode('blink', false);
            }
            player.play(false);
            player.fade = 0;
            triggerTransientLoad(90);
            player.step(1).then((shown) => {
                if (shown) {
                    announceCurrentVisit();
                }
            });
        });

        el['btn-play'].addEventListener('click', () => {
            if (player.mode !== 'blink') {
                setComparisonMode('blink', false);
            }
            const on = player.play();
            announce(on ? 'Blinking frames' : 'Paused');
        });

        // Mode segmented control
        document.querySelectorAll('.mode-seg button[data-mode]').forEach((btn) => {
            btn.addEventListener('click', () => {
                setComparisonMode(btn.dataset.mode, true);
            });
        });

        // Scrubber drag & keyboard
        let scrubbing = false;
        const scrubFromClientX = (clientX) => {
            const rect = el['scrubber-track-area'].getBoundingClientRect();
            const n = window.FRAMES[state.targetId].visits.length;
            const frac = Math.max(0, Math.min(1, (clientX - (rect.left + 7)) / Math.max(1, rect.width - 14)));
            const idx = Math.round(frac * (n - 1));
            showScrubberPeek(idx);
            if (idx !== player.i || player.mode !== 'blink') {
                jumpToVisit(idx, false);
            }
        };

        el['scrubber-track-area'].addEventListener('pointerdown', (e) => {
            if (e.button !== 0) {
                return;
            }
            scrubbing = true;
            el['scrubber-track-area'].setPointerCapture?.(e.pointerId);
            scrubFromClientX(e.clientX);
        });

        el['scrubber-track-area'].addEventListener('pointermove', (e) => {
            const rect = el['scrubber-track-area'].getBoundingClientRect();
            const n = window.FRAMES[state.targetId].visits.length;
            const frac = Math.max(0, Math.min(1, (e.clientX - (rect.left + 7)) / Math.max(1, rect.width - 14)));
            const idx = Math.round(frac * (n - 1));
            showScrubberPeek(idx);
            if (scrubbing && idx !== player.i) {
                jumpToVisit(idx, false);
            }
        });

        const stopScrub = () => {
            if (scrubbing) {
                scrubbing = false;
                announceCurrentVisit();
            }
        };
        el['scrubber-track-area'].addEventListener('pointerup', stopScrub);
        el['scrubber-track-area'].addEventListener('pointercancel', stopScrub);
        el['scrubber-track-area'].addEventListener('pointerleave', () => {
            if (!scrubbing) {
                el['scrubber-peek'].hidden = true;
            }
        });

        el['scrubber-track-area'].addEventListener('keydown', (e) => {
            const n = window.FRAMES[state.targetId].visits.length;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                jumpToVisit(player.i - 1, true);
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                jumpToVisit(player.i + 1, true);
            } else if (e.key === 'Home') {
                e.preventDefault();
                jumpToVisit(0, true);
            } else if (e.key === 'End') {
                e.preventDefault();
                jumpToVisit(n - 1, true);
            }
        });

        // Wavelength bar drag, band click, reset, and keyboard
        let draggingWl = false;
        let wlDownX = 0;
        let wlStartDet = 1;

        const updateWlTipForCurrent = () => {
            const det = findDetectorForWavelength(state.wavelength);
            const bandEl = el['wl-bands'].querySelector(`[data-det="${det}"]`);
            if (bandEl) {
                showWavelengthHoverTip(det, window.DETECTORS[det - 1], bandEl);
            }
        };

        el['wl-interactive'].addEventListener('pointerdown', (e) => {
            if (e.button !== 0) {
                return;
            }
            draggingWl = true;
            wlDownX = e.clientX;
            wlStartDet = state.activeDetector;
            el['wl-interactive'].classList.add('is-dragging');
            el['wl-interactive'].setPointerCapture?.(e.pointerId);
            state.wavelength = wavelengthFromPointer(e.clientX);
            syncWavelengthUI(true);
            updateWlTipForCurrent();
        });

        el['wl-interactive'].addEventListener('pointermove', (e) => {
            if (!draggingWl) {
                return;
            }
            state.wavelength = wavelengthFromPointer(e.clientX);
            syncWavelengthUI(true);
            updateWlTipForCurrent();
        });

        const finishWlDrag = (e) => {
            if (!draggingWl) {
                return;
            }
            draggingWl = false;
            el['wl-interactive'].classList.remove('is-dragging');
            if (e && typeof e.clientX === 'number' && Math.abs(e.clientX - wlDownX) < 4) {
                const clickedDet = findDetectorForWavelength(state.wavelength);
                if (clickedDet !== wlStartDet) {
                    const [lo, hi] = window.DETECTORS[clickedDet - 1];
                    state.wavelength = Number(((lo + hi) / 2).toFixed(2));
                }
            }
            el['wl-hover-tip'].hidden = true;
            syncWavelengthUI(false);
        };
        el['wl-interactive'].addEventListener('pointerup', finishWlDrag);
        el['wl-interactive'].addEventListener('pointercancel', finishWlDrag);
        el['wl-bar-container'].addEventListener('pointerleave', () => {
            if (!draggingWl) {
                el['wl-hover-tip'].hidden = true;
            }
        });

        el['wl-interactive'].addEventListener('keydown', (e) => {
            let delta = 0;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                delta = -0.12;
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                delta = 0.12;
            }
            if (delta !== 0) {
                e.preventDefault();
                e.stopPropagation();
                state.wavelength = Number(Math.max(0.75, Math.min(5.0, state.wavelength + delta)).toFixed(2));
                syncWavelengthUI(false);
            }
        });

        el['wl-reset-btn'].addEventListener('click', () => {
            state.wavelength = getNativeMidWavelength(state.targetId);
            syncWavelengthUI(false);
        });

        // Phone beginner-intro "More" / "Less" toggle (.reveal transition)
        el['help-more-btn'].addEventListener('click', () => {
            const open = !el['help-intro'].classList.contains('is-expanded');
            el['help-intro'].classList.toggle('is-expanded', open);
            el['help-intro-more'].classList.toggle('open', open);
            el['help-more-btn'].setAttribute('aria-expanded', open ? 'true' : 'false');
            el['help-more-btn'].textContent = open ? 'Less' : 'More';
            annotateGlossaryTerms();
        });

        // Glossary dotted-underline buttons & square popover
        document.addEventListener('click', (e) => {
            const glossBtn = e.target.closest && e.target.closest('button.gloss-btn');
            if (glossBtn) {
                const termId = glossBtn.dataset.glossary;
                if (!el['gloss-popover'].hidden && state.openGlossaryTerm === termId && state.glossaryTriggerEl === glossBtn) {
                    closeGlossaryPopover(true);
                } else {
                    openGlossaryPopover(termId, glossBtn);
                }
                return;
            }
            if (!el['gloss-popover'].hidden && !(e.target.closest && e.target.closest('#gloss-popover'))) {
                closeGlossaryPopover(false);
            }
        });

        el['gloss-popover-close'].addEventListener('click', () => {
            closeGlossaryPopover(true);
        });

        window.addEventListener('scroll', () => {
            if (!el['gloss-popover'].hidden) {
                positionGlossaryPopover();
            }
        }, { passive: true, capture: true });

        let wasCompactIntro = window.innerWidth <= 680;
        window.addEventListener('resize', () => {
            positionWavelengthThumb();
            updateAngularScale();
            if (!el['gloss-popover'].hidden) {
                positionGlossaryPopover();
            }
            const isCompactIntro = window.innerWidth <= 680;
            if (isCompactIntro !== wasCompactIntro) {
                wasCompactIntro = isCompactIntro;
                annotateGlossaryTerms();
            }
        });

        // Sheet open triggers, tabs, backdrop, close
        document.querySelectorAll('[data-sheet-open]').forEach((btn) => {
            btn.addEventListener('click', () => {
                openSheet(btn.dataset.sheetOpen, btn);
            });
        });

        document.querySelectorAll('[data-sheet-tab]').forEach((tab) => {
            tab.addEventListener('click', () => {
                activateSheetTab(tab.dataset.sheetTab);
            });
            tab.addEventListener('keydown', (e) => {
                const order = ['guide', 'overlays', 'frame'];
                const idx = order.indexOf(tab.dataset.sheetTab);
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    e.stopPropagation();
                    const next = order[(idx + (e.key === 'ArrowRight' ? 1 : 2)) % order.length];
                    activateSheetTab(next);
                    document.getElementById(`tab-${next}`)?.focus();
                }
            });
        });

        el['sheet-close'].addEventListener('click', closeSheet);
        el['sheet-backdrop'].addEventListener('click', closeSheet);

        // Overlays checkboxes
        const overlayMap = [
            ['chk-target-pos', 'targetPos'],
            ['chk-gaia', 'gaia'],
            ['chk-flags', 'flags'],
            ['chk-older', 'older'],
            ['chk-false-colour', 'falseColour']
        ];

        overlayMap.forEach(([chkId, key]) => {
            el[chkId].addEventListener('change', () => {
                const checked = el[chkId].checked;
                state.overlays[key] = checked;
                syncOverlayVisibility(key);
                if (checked && key === 'falseColour') {
                    triggerTransientLoad(160);
                    announce('False colour note shown');
                }
            });
        });

        // Field size segmented control (6', 4', 3')
        el['field-size-seg'].querySelectorAll('button[data-fov]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const fov = parseInt(btn.dataset.fov, 10);
                state.fovArcmin = fov;
                el['field-size-seg'].querySelectorAll('button').forEach((b) => {
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                const scale = 6 / fov;
                el['sky-viewport'].style.setProperty('--fov-scale', scale.toFixed(3));

                updateAngularScale();

                triggerTransientLoad(180);
                syncOverlayVisibility(null);
                updateSheetsContent();
                announce(`Field size ${fov} arcminutes`);
            });
        });

        // Data source ("Saved copy" vs "Go live") + Simulate load failure
        el['archive-mode-seg'].querySelectorAll('button[data-source]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const src = btn.dataset.source;
                state.archiveSource = src;
                el['archive-mode-seg'].querySelectorAll('button').forEach((b) => {
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                if (src === 'live') {
                    runStageProgress(
                        [
                            window.STAGE_TEXT.search,
                            window.STAGE_TEXT.headers,
                            window.STAGE_TEXT.pixels,
                            window.STAGE_TEXT.regrid
                        ],
                        200,
                        () => {
                            announce('Live archive mode simulated');
                        }
                    );
                } else {
                    el['sky-error-bar'].hidden = true;
                    announce('Using saved SPHEREx copy');
                }
            });
        });

        el['btn-sim-error'].addEventListener('click', () => {
            state.lastRetryAction = () => {
                runStageProgress([window.STAGE_TEXT.pixels, window.STAGE_TEXT.regrid], 160, () => {
                    announce('Archive frame reloaded');
                });
            };
            runStageProgress([window.STAGE_TEXT.search, window.STAGE_TEXT.headers], 150, () => {
                el['sky-error-bar'].hidden = false;
                announce('Couldn’t load archive frame. Last saved frame kept.');
            });
        });

        // FITS cutout placeholder button
        el['btn-fits-download'].addEventListener('click', () => {
            const v = player.visit;
            el['fits-feedback'].textContent = `Mockup preview — in the live app, this fetches the calibrated R7 FITS cutout for ${v.obsId} (${v.date}).`;
            el['fits-feedback'].hidden = false;
            announce(`FITS cutout mockup note shown for ${v.obsId}`);
        });

        // Command palette open/close/input/navigation
        el['search-open'].addEventListener('click', openCommandPalette);
        el['cmd-close'].addEventListener('click', () => {
            closeCommandPalette(true);
        });
        el['cmd-backdrop'].addEventListener('click', (e) => {
            if (e.target === el['cmd-backdrop']) {
                closeCommandPalette(true);
            }
        });
        el['cmd-input'].addEventListener('input', () => {
            renderCommandItems(el['cmd-input'].value);
        });
        el['cmd-input'].addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCmdActiveIndex(state.cmdIndex + 1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCmdActiveIndex(state.cmdIndex - 1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                executeCmdItem(state.cmdIndex);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeCommandPalette(true);
            }
        });

        // Global keyboard shortcuts: ⌘K / Ctrl+K, Esc, Space, ←/→, B/S/D, T, Hold H
        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented) {
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                if (state.cmdOpen) {
                    closeCommandPalette(true);
                } else {
                    openCommandPalette();
                }
                return;
            }

            if (e.key === 'Escape') {
                if (!el['gloss-popover'].hidden) {
                    e.preventDefault();
                    closeGlossaryPopover(true);
                    return;
                }
                if (state.cmdOpen) {
                    e.preventDefault();
                    closeCommandPalette(true);
                    return;
                }
                if (state.sheetOpen) {
                    e.preventDefault();
                    closeSheet();
                    return;
                }
            }

            if (state.cmdOpen) {
                return;
            }

            const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.metaKey || e.ctrlKey || e.altKey) {
                return;
            }

            if (e.key === '/' && tag !== 'button') {
                e.preventDefault();
                openCommandPalette();
                return;
            }

            if (e.key === ' ' && tag !== 'button' && tag !== 'a') {
                e.preventDefault();
                el['btn-play'].click();
                return;
            }

            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                el['btn-prev'].click();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                el['btn-next'].click();
            } else if (e.key.toLowerCase() === 'b') {
                setComparisonMode('blink', true);
            } else if (e.key.toLowerCase() === 's') {
                setComparisonMode('stack', true);
            } else if (e.key.toLowerCase() === 'd') {
                setComparisonMode('diff', true);
            } else if (e.key.toLowerCase() === 't') {
                const toggleBtn = document.querySelector('[data-theme-toggle]');
                if (toggleBtn) {
                    toggleBtn.click();
                }
            } else if (e.key.toLowerCase() === 'h' && !e.repeat) {
                startHoldFirstVisit();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key && e.key.toLowerCase() === 'h') {
                endHoldFirstVisit();
            }
        });

        REDUCED_MOTION.addEventListener?.('change', (ev) => {
            player.reduced = ev.matches;
            if (ev.matches && player.timer) {
                player.play(false);
            }
        });
    }

    // Boot sequence: skeletons hold exact layout with zero CLS, then first frame fades in 200 ms,
    // gold ring draws itself, and blinking starts within < 1 s (unless prefers-reduced-motion).
    let player = null;

    function boot()
    {
        cacheDom();
        initIcons();
        initHelpContent();

        const hashId = location.hash.replace(/^#/, '').trim();
        if (hashId && window.FRAMES[hashId]) {
            state.targetId = hashId;
        }
        state.wavelength = getNativeMidWavelength(state.targetId);
        setTextIfChanged(el['false-colour-text'], window.FALSE_COLOUR_HINT);

        buildTargetRibbon();
        buildWavelengthBands();
        buildSkyMap();

        const t = window.FRAMES[state.targetId];
        const c = window.COPY[state.targetId];

        setTextIfChanged(el['stage-headline'], c.headline);
        updateStageProperMotion(state.targetId, false);
        el['stage-coords-text'].textContent = formatCoords(t);
        setTextIfChanged(el['stage-show'], c.show);
        setTextIfChanged(el['stage-caveat'], c.not);
        setTextIfChanged(el['plate-wl-summary'], `This frame: ${t.lam[0].toFixed(2)}-${t.lam[1].toFixed(2)} µm`);

        player = new TheatrePlayer(el['sky-pixels'], state.targetId, {
            fade: REDUCED_MOTION.matches ? 90 : 200,
            onChange: onPlayerChange,
            onPlaybackChange: syncPlaybackUI,
            onError: () => showPlayerMessage('Couldn’t load frame — showing last saved look.'),
            onNote: showPlayerMessage
        });

        buildScrubberTicks();
        rebuildTargetTrailSVG();
        updateSkyMapActive();
        syncOverlayVisibility(null);
        syncWavelengthUI(true);
        annotateGlossaryTerms();

        requestAnimationFrame(() => {
            positionWavelengthThumb();
            updateAngularScale();
        });
        new ResizeObserver(updateAngularScale).observe(el['sky-pixels']);

        bindEvents();

        // Decode initial frame so first load transitions smoothly from skeleton -> pixels (200 ms)
        const firstVisitImg = player.cache[player.i];
        const finishBoot = () => {
            if (state.booted) {
                return;
            }
            state.booted = true;
            el['sky-stage'].classList.remove('is-booting');
            el['stage-headline'].classList.remove('skel');
            el['stage-show'].classList.remove('skel');
            el['stage-caveat'].classList.remove('skel');

            player.fade = 0;
            updateActiveTargetRing(true);

            // Autoplay blink on load so first-time visitor sees motion within < 2s
            // (respects prefers-reduced-motion: stays paused on latest frame with Play ready)
            if (!REDUCED_MOTION.matches) {
                player.play(true);
            } else {
                onPlayerChange();
            }
        };

        const bootDelay = REDUCED_MOTION.matches ? 40 : 180;
        if (firstVisitImg) {
            firstVisitImg.decode().catch(() => {}).then(() => {
                setTimeout(finishBoot, bootDelay);
            });
        } else {
            setTimeout(finishBoot, bootDelay);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
