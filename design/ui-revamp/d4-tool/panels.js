// Slowsky d4 mockup: inspector panels for the product features the mockup lacked (Target and Frame extras, Charts,
// Extras, AI note look). Pure functions are ported from the product (~/Documents/projects/slowsky, read-only) with
// the same constants and maths; panels.test.mjs checks them against values from the product's own TS code.
// Data: paneldata.js (product code run on its saved frames), cometdata.js (product's comet file), frames.js, copy.js.
// Nothing here is invented: where the mockup has no data, the panel says so in one plain line.
(function () {
    'use strict';

    const SVGNS = 'http://www.w3.org/2000/svg';
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // ---------- small DOM helpers ----------

    function el(tag, cls, text)
    {
        const n = document.createElement(tag);
        if (cls) {
            n.className = cls;
        }
        if (text !== undefined && text !== null) {
            n.textContent = text;
        }
        return n;
    }

    function sv(tag, attrs, text)
    {
        const n = document.createElementNS(SVGNS, tag);
        if (attrs) {
            Object.keys(attrs).forEach((k) => {
                n.setAttribute(k, String(attrs[k]));
            });
        }
        if (text !== undefined && text !== null) {
            n.textContent = text;
        }
        return n;
    }

    function link(href, text, title)
    {
        const a = el('a', 'pn-src', text);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        if (title) {
            a.title = title;
        }
        return a;
    }

    function clear(node)
    {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function heading(parent, text)
    {
        const h = el('h3', 'pn-h', text);
        parent.appendChild(h);
        return h;
    }

    function para(parent, text, cls)
    {
        const p = el('p', cls || '', text);
        parent.appendChild(p);
        return p;
    }

    function plain(parent, text)
    {
        return para(parent, text, 'pn-plain');
    }

    function kvRow(dl, k, v)
    {
        const dt = el('dt', '', k);
        const dd = el('dd');
        if (typeof v === 'string') {
            dd.textContent = v;
        } else {
            dd.appendChild(v);
        }
        dl.appendChild(dt);
        dl.appendChild(dd);
    }

    function widthOf(node, fallback)
    {
        const w = Math.round(node.clientWidth || 0);
        return w >= 240 ? w : fallback;
    }

    function targetData(id)
    {
        const pd = window.PANEL_DATA;
        return pd && pd.targets && id ? pd.targets[id] || null : null;
    }

    function needTarget(parent, what)
    {
        plain(parent, what + ' needs a library target: pick one of the five on the left.');
    }

    // ---------- ported: src/lib/uptonight.ts (same constants and maths) ----------

    const MELBOURNE = Object.freeze({ name: 'Melbourne', latDeg: -37.814, lonDeg: 144.963, timeZone: 'Australia/Melbourne' });
    const DARK_SUN_ALT_DEG = -12;
    const RAD = Math.PI / 180;
    const DAY = 86400000;
    const wrap = (n) => ((n % 360) + 360) % 360;
    const julian = (time) => time / DAY + 2440587.5;

    function sunRaDec(date)
    {
        const t = (julian(+date) - 2451545) / 36525;
        const meanLongitude = wrap(280.46646 + t * (36000.76983 + 0.0003032 * t));
        const anomaly = wrap(357.52911 + t * (35999.05029 - 0.0001537 * t)) * RAD;
        const center = (1.914602 - t * (0.004817 + 0.000014 * t)) * Math.sin(anomaly)
            + (0.019993 - 0.000101 * t) * Math.sin(2 * anomaly) + 0.000289 * Math.sin(3 * anomaly);
        const omega = (125.04 - 1934.136 * t) * RAD;
        const longitude = (meanLongitude + center - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
        const obliquity = (23.439291 - 0.0130042 * t + 0.00256 * Math.cos(omega)) * RAD;
        return {
            raDeg: wrap(Math.atan2(Math.cos(obliquity) * Math.sin(longitude), Math.cos(longitude)) / RAD),
            decDeg: Math.asin(Math.sin(obliquity) * Math.sin(longitude)) / RAD,
        };
    }

    function precess(raDeg, decDeg, time)
    {
        const t = (julian(time) - 2451545) / 36525;
        const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) / 3600 * RAD;
        const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) / 3600 * RAD;
        const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) / 3600 * RAD;
        const ra = wrap(raDeg) * RAD;
        const dec = decDeg * RAD;
        const a = Math.cos(dec) * Math.sin(ra + zeta);
        const b = Math.cos(theta) * Math.cos(dec) * Math.cos(ra + zeta) - Math.sin(theta) * Math.sin(dec);
        const c = Math.sin(theta) * Math.cos(dec) * Math.cos(ra + zeta) + Math.cos(theta) * Math.sin(dec);
        return { raDeg: wrap((Math.atan2(a, b) + z) / RAD), decDeg: Math.asin(Math.max(-1, Math.min(1, c))) / RAD };
    }

    function horizontal(raDeg, decDeg, time, observer)
    {
        const jd = julian(time);
        const t = (jd - 2451545) / 36525;
        const sidereal = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - t ** 3 / 38710000;
        const hour = wrap(sidereal + observer.lonDeg - raDeg) * RAD;
        const dec = decDeg * RAD;
        const lat = observer.latDeg * RAD;
        const east = -Math.cos(dec) * Math.sin(hour);
        const north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(hour) * Math.sin(lat);
        const up = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(hour) * Math.cos(lat);
        return { altDeg: Math.asin(Math.max(-1, Math.min(1, up))) / RAD, azDeg: wrap(Math.atan2(east, north) / RAD) };
    }

    function altAz(raDeg, decDeg, date, observer)
    {
        const obs = observer || MELBOURNE;
        const p = precess(raDeg, decDeg, +date);
        return horizontal(p.raDeg, p.decDeg, +date, obs);
    }

    function upTonight(raDeg, decDeg, now, observer)
    {
        const obs = observer || MELBOURNE;
        const time = +now;
        if (![raDeg, decDeg, time, obs.latDeg, obs.lonDeg].every(Number.isFinite)
            || Math.abs(decDeg) > 90 || Math.abs(obs.latDeg) > 90) {
            return null;
        }
        const sunAltitude = (at) => {
            const sun = sunRaDec(new Date(at));
            return horizontal(sun.raDeg, sun.decDeg, at, obs).altDeg - DARK_SUN_ALT_DEG;
        };
        const step = 60000;
        const searchLimit = 370 * DAY;
        const crossing = (loTime, hiTime, loDark) => {
            let lo = loTime;
            let hi = hiTime;
            while (hi - lo > 500) {
                const mid = (lo + hi) / 2;
                if ((sunAltitude(mid) < 0) === loDark) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            return (lo + hi) / 2;
        };
        let start = null;
        let end = null;
        if (sunAltitude(time) < 0) {
            for (let at = time - step; at >= time - 48 * 3600000; at -= step) {
                if (sunAltitude(at) >= 0) {
                    start = crossing(at, at + step, false);
                    break;
                }
            }
        } else {
            for (let at = time + step; at <= time + 48 * 3600000; at += step) {
                if (sunAltitude(at) < 0) {
                    start = crossing(at - step, at, false);
                    break;
                }
            }
        }
        if (start === null) {
            return null;
        }
        const darkFrom = Math.max(time, start + 500);
        for (let at = darkFrom + step; at <= darkFrom + searchLimit; at += step) {
            if (sunAltitude(at) >= 0) {
                end = crossing(at - step, at, true);
                break;
            }
        }
        if (end === null) {
            return null;
        }
        if (time > start && end - time < 60000) {
            return upTonight(raDeg, decDeg, new Date(end + 1000), obs);
        }
        const altitude = (at) => altAz(raDeg, decDeg, new Date(at), obs).altDeg;
        const from = Math.max(time, start);
        const inside = time > start && time < end;
        let best = from;
        let bestAltitude = altitude(from);
        const consider = (at) => {
            const value = altitude(at);
            if (value > bestAltitude) {
                best = at;
                bestAltitude = value;
            }
        };
        const sampleStep = 600000;
        for (let a = from; a < end; a += sampleStep) {
            const b = Math.min(a + sampleStep, end);
            consider(b);
            let lo = a;
            let hi = b;
            while (hi - lo > 1000) {
                const m1 = lo + (hi - lo) / 3;
                const m2 = hi - (hi - lo) / 3;
                if (altitude(m1) < altitude(m2)) {
                    lo = m1;
                } else {
                    hi = m2;
                }
            }
            consider((lo + hi) / 2);
        }
        const bestDate = new Date(best);
        const position = altAz(raDeg, decDeg, bestDate, obs);
        const dateDec = precess(raDeg, decDeg, +bestDate).decDeg;
        const maxAltDeg = 90 - Math.abs(obs.latDeg - dateDec);
        const bestNow = inside && best - from <= 1000;
        if (![start, end, +bestDate, position.altDeg, position.azDeg, maxAltDeg].every(Number.isFinite)) {
            return null;
        }
        return {
            darkStart: new Date(start), darkEnd: new Date(end), from: new Date(from), inside: inside, bestNow: bestNow, best: bestDate,
            bestAltDeg: position.altDeg, bestAzDeg: position.azDeg, maxAltDeg: maxAltDeg,
        };
    }

    // src/ui/uptonight-view.ts, word for word.
    function upTonightText(r, observer)
    {
        const obs = observer || MELBOURNE;
        if (r === null) {
            return null;
        }
        if (r.maxAltDeg < -1) {
            return { line: 'This spot never rises above the horizon from ' + obs.name + '.', note: '' };
        }
        const clock = new Intl.DateTimeFormat('en-GB', { timeZone: obs.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        const darkFrom = clock.format(new Date(Math.ceil(+r.darkStart / 60000) * 60000));
        const darkTo = clock.format(new Date(Math.floor(+r.darkEnd / 60000) * 60000));
        const note = 'Times are ' + obs.name + ' time. Dark means the Sun is more than ' + Math.abs(DARK_SUN_ALT_DEG)
            + '° below the horizon, here from ' + darkFrom + ' to ' + darkTo
            + '. This says where the spot is in the sky, not whether anything can be seen there.';
        const prefix = r.inside ? 'From ' + obs.name + ', until the dark ends' : 'Tonight from ' + obs.name;
        const highest = r.inside ? 'highest' : 'highest in the dark';
        if (r.bestAltDeg < -1) {
            return { line: r.inside ? prefix + ': below the horizon.' : prefix + ': below the horizon while it is dark.', note: note };
        }
        const earliest = Math.ceil(+r.from / 60000) * 60000;
        const latest = Math.floor(+r.darkEnd / 60000) * 60000;
        const rounded = Math.round(+r.best / 60000) * 60000;
        const bounded = earliest > latest ? latest : Math.max(earliest, Math.min(latest, rounded));
        const time = clock.format(new Date(bounded));
        const altitude = Math.round(r.bestAltDeg) || 0;
        const directions = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
        const direction = directions[Math.floor((((r.bestAzDeg % 360) + 360) % 360 + 22.5) / 45) % 8];
        const when = r.inside && r.bestNow ? 'now' : 'at ' + time;
        if (r.bestAltDeg < 1) {
            return { line: prefix + ': ' + highest + ' ' + when + ', near the horizon, facing ' + direction + '.', note: note };
        }
        if (altitude < 10) {
            return { line: prefix + ': ' + highest + ' ' + when + ', very low, about ' + altitude + '° above the horizon, facing ' + direction + '.', note: note };
        }
        if (altitude < 80) {
            return { line: prefix + ': ' + highest + ' ' + when + ', about ' + altitude + '° above the horizon, facing ' + direction + '.', note: note };
        }
        return { line: prefix + ': ' + highest + ' ' + when + ', about ' + altitude + '° above the horizon, almost overhead.', note: note };
    }

    // ---------- ported: app.ts small figures (sky map, motion compass) ----------

    const MAP_W = 132;
    const MAP_H = 66;

    function mapXY(ra, dec)
    {
        return [MAP_W * (1 - (((ra % 360) + 360) % 360) / 360), MAP_H * (0.5 - dec / 180)];
    }

    const PLANE = (function () {
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
            const xy = mapXY(ra, dec);
            path += (Number.isFinite(last) && Math.abs(xy[0] - last) < MAP_W / 2 ? 'L' : 'M') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1);
            last = xy[0];
        }
        return path;
    })();

    function skyMapSvg(ra, dec)
    {
        const xy = mapXY(ra, dec);
        const s = sv('svg', { viewBox: '0 0 ' + MAP_W + ' ' + MAP_H, width: MAP_W, height: MAP_H, role: 'img',
            'aria-label': 'Position on the whole sky: the gold square, with the Milky Way as a faint band' });
        s.appendChild(sv('rect', { x: 0.5, y: 0.5, width: MAP_W - 1, height: MAP_H - 1, rx: 2, class: 'fr' }));
        s.appendChild(sv('path', { d: PLANE, class: 'mw' }));
        s.appendChild(sv('path', { d: 'M0 ' + MAP_H / 2 + 'H' + MAP_W, class: 'eq' }));
        s.appendChild(sv('rect', { x: (xy[0] - 3).toFixed(1), y: (xy[1] - 3).toFixed(1), width: 6, height: 6, rx: 1, class: 'me' }));
        return s;
    }

    const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

    function motionFigure(pmRa, pmDec)
    {
        const pm = Math.hypot(pmRa, pmDec) / 1000;
        const pa = (Math.atan2(pmRa, pmDec) * 180) / Math.PI;
        const way = COMPASS[Math.round((((pa % 360) + 360) % 360) / 45) % 8];
        const S = 66;
        const c = S / 2;
        const len = 17;
        const ux = -pmRa / 1000 / pm;
        const uy = -pmDec / 1000 / pm;
        const tx = c + ux * len;
        const ty = c + uy * len;
        const head = (k) => (tx - ux * 6 + k * uy * 4).toFixed(1) + ' ' + (ty - uy * 6 - k * ux * 4).toFixed(1);
        const s = sv('svg', { viewBox: '0 0 ' + S + ' ' + S, width: S, height: S, role: 'img',
            'aria-label': 'Moves ' + pm.toFixed(1) + ' arcseconds a year toward the ' + way });
        s.appendChild(sv('rect', { x: 0.5, y: 0.5, width: S - 1, height: S - 1, rx: 2, class: 'fr' }));
        s.appendChild(sv('path', { d: 'M' + c + ' 16V' + (S - 8) + 'M16 ' + c + 'H' + (S - 8), class: 'eq' }));
        s.appendChild(sv('text', { x: c, y: 13, class: 'lb' }, 'N'));
        s.appendChild(sv('text', { x: 8, y: c + 4, class: 'lb' }, 'E'));
        s.appendChild(sv('path', { d: 'M' + c + ' ' + c + 'L' + tx.toFixed(1) + ' ' + ty.toFixed(1), class: 'ar' }));
        s.appendChild(sv('path', { d: 'M' + head(1) + 'L' + tx.toFixed(1) + ' ' + ty.toFixed(1) + 'L' + head(-1), class: 'ar' }));
        s.appendChild(sv('rect', { x: c - 2, y: c - 2, width: 4, height: 4, rx: 1, class: 'me' }));
        return { svg: s, text: pm.toFixed(1) + '″ a year, ' + way };
    }

    // ---------- Target tab extras ----------

    const UP_TONIGHT_LABEL = 'Tonight’s sky.';

    function targetExtras(host, ctx)
    {
        const root = el('div', 'pn');
        host.appendChild(root);
        if (ctx.ws !== 'sky') {
            heading(root, 'What to look for');
            needTarget(root, 'The sky map, the motion arrow and the measured line');
            heading(root, 'Up tonight from Melbourne');
            needTarget(root, 'Up tonight');
            return;
        }
        const id = ctx.targetId;
        const d = targetData(id);
        const t = window.FRAMES && window.FRAMES[id];
        const copy = window.COPY && window.COPY[id];
        heading(root, 'What to look for');
        if (!d || !t || !copy) {
            plain(root, 'No saved data for this target in the mockup.');
            return;
        }
        // Coordinates as the product prints them (formatRa/formatDec of its view centre), linked to SIMBAD.
        const coord = el('p', 'pn-coord');
        coord.appendChild(link('https://simbad.cfa.harvard.edu/simbad/sim-id?Ident=' + encodeURIComponent(d.simbadName),
            d.raText + '  ' + d.decText, 'Position and motion: SIMBAD, ' + d.simbadName));
        root.appendChild(coord);

        const figs = el('div', 'pn-figs');
        const mapFig = el('figure', 'pn-fig');
        mapFig.appendChild(skyMapSvg(d.center.ra, d.center.dec));
        mapFig.appendChild(el('figcaption', '', 'Where in the sky'));
        figs.appendChild(mapFig);
        // The motion arrow only for stars that visibly walk: over half an arcsecond a year (app.ts).
        if (Number.isFinite(t.pmRa) && Number.isFinite(t.pmDec) && Math.hypot(t.pmRa, t.pmDec) > 500) {
            const m = motionFigure(t.pmRa, t.pmDec);
            const pmFig = el('figure', 'pn-fig');
            pmFig.appendChild(m.svg);
            pmFig.appendChild(el('figcaption', '', m.text));
            figs.appendChild(pmFig);
        }
        root.appendChild(figs);

        // The product's card lines that differ from copy.js: only the measured or extra words, never a repeat.
        if (d.show && d.show !== copy.show && d.show.indexOf(copy.show) === 0) {
            para(root, d.show.slice(copy.show.length).trim());
        }
        if (d.fact) {
            const p = el('p', 'pn-fact');
            p.appendChild(el('span', 'pn-sub', 'Measured here.'));
            p.appendChild(document.createTextNode(' ' + d.fact));
            root.appendChild(p);
        }
        if (d.not && d.not !== copy.not) {
            const p = el('p', 'pn-mute');
            p.appendChild(el('span', 'pn-sub', 'What this can’t tell you.'));
            p.appendChild(document.createTextNode(' ' + d.not));
            root.appendChild(p);
        }
        if (d.fact || (d.not && d.not !== copy.not)) {
            para(root, 'Measured by the live app’s code on its saved copy of this target.', 'pn-foot');
        }

        heading(root, 'Up tonight from Melbourne');
        let text = null;
        try {
            text = upTonightText(upTonight(d.center.ra, d.center.dec, ctx.now instanceof Date ? ctx.now : new Date()));
        } catch (e) {
            text = null;
        }
        if (!text) {
            plain(root, 'No answer for this spot.');
            return;
        }
        const up = el('p', 'pn-up');
        up.appendChild(el('span', 'pn-sub', UP_TONIGHT_LABEL));
        up.appendChild(document.createTextNode(' ' + text.line));
        root.appendChild(up);
        if (text.note) {
            para(root, text.note, 'pn-foot');
        }
    }

    // ---------- Frame tab extras ----------

    const RELEASE_DOI = {
        dr1: { id: '10.26131/IRSA678', label: 'SPHEREx DR1', cite: 'SPHEREx DR1, NASA/IPAC Infrared Science Archive, doi:10.26131/IRSA678' },
        qr3: { id: '10.26131/IRSA662', label: 'SPHEREx QR3', cite: 'SPHEREx QR3, NASA/IPAC Infrared Science Archive, doi:10.26131/IRSA662' },
    };

    function mjdToUtc(mjd)
    {
        return new Date((mjd - 40587) * 86400000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    }

    function frameExtras(host, ctx)
    {
        const root = el('div', 'pn');
        host.appendChild(root);
        heading(root, 'This frame');
        const dl = el('dl', 'kv');
        if (ctx.ws !== 'sky') {
            const s = ctx.session;
            if (!s || !s.frames || s.frames.length === 0) {
                plain(root, 'No frame loaded.');
                return;
            }
            const k = Math.min(Math.max(0, ctx.index | 0), s.frames.length - 1);
            const f = s.frames[k];
            kvRow(dl, 'Frame', (k + 1) + ' of ' + s.frames.length);
            if (f.unit) {
                kvRow(dl, 'Unit', String(f.unit));
            }
            if (f.meta) {
                if (f.meta.instrument) {
                    kvRow(dl, 'Instrument', String(f.meta.instrument).trim());
                }
                if (f.meta.detector !== undefined && f.meta.detector !== null) {
                    kvRow(dl, 'Detector', 'D' + String(f.meta.detector).trim());
                }
                kvRow(dl, 'Sky position', f.meta.hasWcs ? 'in the file (WCS)' : 'not in the file');
                if (Number.isFinite(f.meta.hdu)) {
                    kvRow(dl, 'Image read from', 'HDU ' + f.meta.hdu);
                }
            }
            root.appendChild(dl);
            return;
        }
        const t = window.FRAMES && window.FRAMES[ctx.targetId];
        const visits = ctx.visits || (t && t.visits) || [];
        if (!t || visits.length === 0) {
            plain(root, 'No frame for this target.');
            return;
        }
        const k = Math.min(Math.max(0, ctx.index | 0), visits.length - 1);
        const v = visits[k];
        const det = window.DETECTORS && window.DETECTORS[t.detector - 1];
        kvRow(dl, 'Frame', (k + 1) + ' of ' + visits.length);
        kvRow(dl, 'Detector', 'D' + t.detector + (det ? ' (' + det[0].toFixed(2) + '–' + det[1].toFixed(2) + ' µm)' : ''));
        const d = targetData(ctx.targetId);
        const rec = d ? d.frames.find((f) => f.obsId === v.obsId) : null;
        if (rec) {
            kvRow(dl, 'Taken', mjdToUtc(rec.tMin));
            kvRow(dl, 'Colour here', rec.lambda.toFixed(3) + ' µm (' + (rec.dLambda >= 0 ? '+' : '−') + Math.abs(rec.dLambda).toFixed(3) + ')');
            const doi = RELEASE_DOI[rec.release];
            kvRow(dl, 'Release', doi ? link('https://doi.org/' + doi.id, doi.label, doi.cite) : rec.collection);
            if (rec.pipelineVersion) {
                kvRow(dl, 'Pipeline', rec.pipelineVersion);
            }
            if (rec.url || rec.irsaUrl) {
                const open = el('span');
                if (rec.url) {
                    open.appendChild(link(rec.url, 'FITS file'));
                }
                if (rec.irsaUrl) {
                    if (rec.url) {
                        open.appendChild(document.createTextNode(' · '));
                    }
                    open.appendChild(link(rec.irsaUrl, 'IRSA'));
                }
                kvRow(dl, 'Open', open);
            }
        }
        root.appendChild(dl);
        if (!rec) {
            plain(root, 'This file is not in the live app’s saved copy, so its exact time, colour and archive link are not shown here.');
        }
        if (d && d.notes && d.notes.length) {
            para(root, 'Notes from the live app’s saved copy of this target', 'pn-sec');
            const ul = el('ul', 'warn-list');
            d.notes.forEach((n) => {
                ul.appendChild(el('li', '', n));
            });
            root.appendChild(ul);
        }
    }

    // ---------- Charts tab ----------

    const NO_COPY = 'The live app draws this from the real frames; this mockup has no copy of them.';

    function pct(v)
    {
        return (v >= 1 ? '+' : '−') + Math.abs((v - 1) * 100).toFixed(Math.abs(v - 1) < 0.1 ? 1 : 0) + '%';
    }

    function dayDate(mjd)
    {
        const d = new Date((mjd - 40587) * 86400000);
        return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    }

    // A relative-brightness chart (the product's curve and halo share this form): median line, optional noise band,
    // a 2 px line, error bars and dots. Text sits in HTML around it, so it stays sharp at any width.
    function relChart(width, series, opts)
    {
        const W = width;
        const H = 120;
        const padL = 44;
        const padR = 10;
        const lo = opts.lo;
        const hi = opts.hi;
        const t0 = series[0].mjd;
        const t1 = series[series.length - 1].mjd;
        const x = (t) => padL + 6 + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR - 12);
        const y = (v) => ((hi - v) / (hi - lo)) * H;
        const s = sv('svg', { class: 'pn-rel', viewBox: '0 0 ' + W + ' ' + (H + 22), width: W, height: H + 22, role: 'img', 'aria-label': opts.aria });
        if (opts.noise > 0) {
            s.appendChild(sv('rect', { x: padL, width: W - padL - padR, y: y(1 + opts.noise).toFixed(1),
                height: Math.max(0.5, y(1 - opts.noise) - y(1 + opts.noise)).toFixed(1), class: 'band' }));
        }
        s.appendChild(sv('path', { d: 'M' + padL + ' ' + y(1).toFixed(1) + 'H' + (W - padR), class: 'base' }));
        s.appendChild(sv('path', { d: 'M' + padL + ' 0V' + H + 'H' + (W - padR), class: 'ax' }));
        [[hi, pct(hi)], [1, 'median'], [lo, pct(lo)]].forEach((row) => {
            s.appendChild(sv('text', { x: padL - 6, y: Math.min(H - 2, Math.max(9, y(row[0]) + 4)).toFixed(1), class: 'tk', 'text-anchor': 'end' }, row[1]));
        });
        s.appendChild(sv('text', { x: padL, y: H + 16, class: 'tk' }, opts.t0Label));
        s.appendChild(sv('text', { x: W - padR, y: H + 16, class: 'tk', 'text-anchor': 'end' }, opts.t1Label));
        if (opts.line) {
            s.appendChild(sv('polyline', { points: series.map((p) => x(p.mjd).toFixed(1) + ',' + y(p.relative).toFixed(1)).join(' '), class: 'line' }));
        }
        series.forEach((p) => {
            const g = sv('g', { class: 'pt' });
            g.appendChild(sv('title', null, dayDate(p.mjd) + ': ' + pct(p.relative) + ' ± ' + (p.err * 100).toFixed(1) + '%'));
            g.appendChild(sv('path', { d: 'M' + x(p.mjd).toFixed(1) + ' ' + y(p.relative + p.err).toFixed(1) + 'V' + y(p.relative - p.err).toFixed(1), class: 'err' }));
            g.appendChild(sv('circle', { cx: x(p.mjd).toFixed(1), cy: y(p.relative).toFixed(1), r: 4, class: 'dot' }));
            // A bigger, invisible hit target for the hover title.
            g.appendChild(sv('circle', { cx: x(p.mjd).toFixed(1), cy: y(p.relative).toFixed(1), r: 12, class: 'hit' }));
            s.appendChild(g);
        });
        return s;
    }

    function chartCard(parent, title)
    {
        const sec = el('section', 'pn-card');
        sec.appendChild(el('h3', 'pn-h', title));
        parent.appendChild(sec);
        return sec;
    }

    function curveSection(root, ctx, width)
    {
        const sec = chartCard(root, 'Brightness over time');
        if (ctx.ws !== 'sky') {
            needTarget(sec, 'The brightness curve (it measures the star against Gaia comparison stars)');
            return;
        }
        const d = targetData(ctx.targetId);
        const copy = window.COPY && window.COPY[ctx.targetId];
        const kind = copy ? copy.kind : '';
        if (kind !== 'variable' && kind !== 'cold') {
            plain(sec, 'The live app draws this only for RW Aurigae and WISE 0855.');
            return;
        }
        const c = d && d.curve;
        if (!c) {
            plain(sec, 'The live app’s own code returned no curve for this view, so none is drawn.');
            return;
        }
        if (!c.hideChart) {
            const name = copy.display;
            const ys = c.points.map((p) => p.relative);
            const aria = 'Brightness of ' + name + ' over ' + c.points.length + ' looks, readings from ' + pct(Math.min.apply(null, ys)) + ' to '
                + pct(Math.max.apply(null, ys)) + ' relative to the median; the scale runs from ' + pct(c.lo) + ' to ' + pct(c.hi)
                + ' to fit the error bars. Estimated comparison noise about ' + (c.noise * 100).toFixed(1) + '%.';
            sec.appendChild(relChart(width, c.points, { lo: c.lo, hi: c.hi, noise: c.noise, line: true, aria: aria, t0Label: c.t0Label, t1Label: c.t1Label }));
            const key = el('p', 'pn-key');
            key.appendChild(el('i', 'pn-swatch'));
            key.appendChild(document.createTextNode('band: ' + c.refs + ' comparison stars'));
            sec.appendChild(key);
        }
        para(sec, c.note, 'pn-mute');
        para(sec, 'Computed by the live app’s code on its saved frames (paneldata.js).', 'pn-foot');
    }

    function spectrumSection(root, width)
    {
        // Text from src/ui/spectrum-view.ts SPECTRUM_TEXT; axis words from src/lib/spectrum-chart.ts and cube.ts.
        const sec = chartCard(root, 'Spectrum');
        para(sec, window.CONTROL_HELP ? window.CONTROL_HELP.spectrum.line : '', 'help-line');
        const W = width;
        const H = 150;
        const L = 40;
        const R = 10;
        const T = 10;
        const B = 36;
        const lamMin = 0.75;
        const lamMax = 5.0;
        const xFor = (lam) => L + ((lam - lamMin) / (lamMax - lamMin)) * (W - L - R);
        const s = sv('svg', { class: 'pn-empty', viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img',
            'aria-label': 'Empty spectrum chart: wavelength in µm across, surface brightness up. No data in the mockup.' });
        s.appendChild(sv('path', { d: 'M' + L + ' ' + T + 'V' + (H - B) + 'H' + (W - R), class: 'ax' }));
        [1, 2, 3, 4, 5].forEach((lam) => {
            s.appendChild(sv('text', { x: xFor(lam).toFixed(1), y: H - B + 15, class: 'tk', 'text-anchor': 'middle' }, String(lam)));
        });
        s.appendChild(sv('text', { x: (L + W - R) / 2, y: H - 4, class: 'al', 'text-anchor': 'middle' }, 'wavelength, µm'));
        s.appendChild(sv('text', { transform: 'translate(13 ' + ((T + H - B) / 2) + ') rotate(-90)', class: 'al', 'text-anchor': 'middle' }, 'surface brightness'));
        s.appendChild(sv('text', { x: (L + W - R) / 2, y: (T + H - B) / 2 + 4, class: 'tk', 'text-anchor': 'middle' }, 'No data in this mockup'));
        sec.appendChild(s);
        plain(sec, 'The live app reads this from the SPHEREx all-sky cube, live from the public archive; this mockup has no copy of it.');
        const btn = el('button', 'btn sm', 'Read the spectrum here');
        btn.type = 'button';
        btn.disabled = true;
        sec.appendChild(btn);
        para(sec, 'A live read from the public archive: about 2 MB. It can take half a minute.', 'pn-foot');
        para(sec, 'Value read: surface brightness, mean of 3 × 3 pixels minus the local background. Source: SPHEREx DR1 all-sky cube, doi:10.26131/IRSA679.', 'pn-foot');
    }

    // ---------- ported: src/ui/halo-view.ts haloHtml (words and rules; DOM instead of HTML strings) ----------

    const MIN_VISITS = 3;
    const CURVE_WIDTH_UM = 0.005;

    function haloDate(mjd, withDay)
    {
        const d = new Date((mjd - 40587) * 86400000);
        return (withDay ? d.getUTCDate() + ' ' : '') + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    }

    function visitCount(mjds)
    {
        const t = mjds.slice().sort((a, b) => a - b);
        return t.filter((v, i) => i === 0 || v - t[i - 1] >= 10).length;
    }

    function plural(n, one, many)
    {
        return n + ' ' + (n === 1 ? one : many);
    }

    // The panel's words as a list of blocks: { p: text } paragraphs, { table: rows }, { notes: [] }. Same order and
    // wording as haloHtml; the 'curve' kind adds { chart: true } where the product draws its line.
    function haloText(h, name)
    {
        const who = name;
        if (h.kind === 'nofit') {
            return [{ p: 'The ring around ' + who + '’s blank centre does not fit in this view. Choose a wider field to measure it.' }];
        }
        const arcsec = (v) => v.toFixed(v < 10 ? 1 : 0) + '″';
        const where = 'the light in a ring ' + arcsec(h.ringIn) + ' to ' + arcsec(h.ringOut) + ' from ' + who + '’s centre, outside the part the frames leave blank';
        const off = h.dropped > 0 ? ' ' + plural(h.dropped, 'frame was', 'frames were') + ' too far off this colour.' : '';
        const notes = h.caveats.length
            ? { notes: h.caveats.map((c) => Array.from(new Set(c.mjds.slice().sort((a, b) => a - b).map((t) => haloDate(t, true)))).join(', ') + ': ' + c.text) }
            : null;
        const lams = h.points.map((p) => p.lambda).filter(Number.isFinite);
        const lamLo = Math.min.apply(null, lams);
        const lamHi = Math.max.apply(null, lams);
        const colours = lams.length > 1 && lamHi - lamLo >= CURVE_WIDTH_UM - 1e-9
            ? ' These looks were taken from ' + lamLo.toFixed(3) + ' to ' + lamHi.toFixed(3) + ' µm; looks at slightly different colours can read differently for that reason alone.'
            : '';
        const visits = visitCount(h.points.map((p) => p.mjd));
        const gs = h.ringStars;
        const inRing = gs.length
            ? ' ' + (gs.length === 1 ? 'A catalogued Gaia star (G ' + gs[0].toFixed(1) + ') sits' : gs.length + ' catalogued Gaia stars (brightest G ' + gs[0].toFixed(1) + ') sit')
                + ' in or at the edge of the ring, so some of ' + (gs.length === 1 ? 'its' : 'their') + ' light is in every reading.'
            : '';
        const out = h.leftOut || 0;
        const shown = h.reason ? '' : h.note || '';
        const leftOut = out > 0
            ? (out === 1 ? 'One comparison star was left out: its readings scattered from look to look more than 3 times the median scatter of the other comparison stars'
                : out + ' comparison stars were left out, one at a time: at each step, the left-out star’s readings scattered from look to look more than 3 times the median scatter of the other comparison stars still in use at that step')
                + (shown ? '. The check below covers only the comparison stars that were kept.' : '.')
            : '';
        const module = [h.caveat, leftOut, shown].filter((t) => !!t).map((t) => ({ p: t }));
        const one = h.points.length === 1;
        const table = {
            table: h.points.map((p) => [haloDate(p.mjd, true), p.lambda.toFixed(3) + ' µm',
                one ? 'one reading, nothing to compare (noise ± ' + (p.err * 100).toFixed(1) + '%)' : pct(p.relative) + ' ± ' + (p.err * 100).toFixed(1) + '%']),
        };
        const blocks = [];
        if (h.kind === 'none' || h.kind === 'table') {
            const listed = h.kind === 'none' ? '' : one ? ' The one reading is listed below.' : ' Each reading is listed below.';
            const ruleText = ' A curve is drawn only from looks on at least ' + MIN_VISITS + ' visits, all within ' + CURVE_WIDTH_UM + ' µm of colour;'
                + ' these looks do not meet that';
            const why = h.reason
                ? ' No curve is drawn: ' + h.reason[0].toLowerCase() + h.reason.slice(1) + '.' + (h.rule === false ? ruleText + ' either.' : '') + listed
                : h.rule === true ? ' No curve is drawn.' + listed
                    : ruleText + ', so ' + (h.kind === 'none' ? 'there is no curve' : one ? 'the one reading is listed instead' : 'each reading is listed instead') + '.';
            const head = 'Near ' + h.lambda.toFixed(2) + ' µm, ' + where + ', could be measured in ' + h.points.length + ' of ' + plural(h.looks, 'look', 'looks')
                + (h.points.length ? ', taken on ' + plural(visits, 'visit', 'visits') : '') + '.' + why + off;
            blocks.push({ p: head });
            if (h.kind === 'table') {
                blocks.push(table);
                blocks.push({ p: 'Measured against ' + h.refs + ' nearby comparison stars from Gaia. '
                    + 'The ± is each reading’s noise: the sky around the ring and around the comparison stars, and how far off the star’s catalogue position could be.' + colours + inRing });
            }
            module.forEach((b) => blocks.push(b));
            if (notes) {
                blocks.push(notes);
            }
            return blocks;
        }
        const bad = h.looks - h.points.length;
        const left = off + (bad > 0 ? ' ' + plural(bad, 'look', 'looks') + ' could not be measured.' : '');
        blocks.push({ chart: true });
        blocks.push({ p: 'At ' + h.lambda.toFixed(2) + ' µm: ' + where + ', measured against ' + h.refs + ' nearby comparison stars from Gaia, look by look. '
            + 'The bar on each dot is its noise: the sky around the ring and around the comparison stars, and how far off the '
            + 'star’s catalogue position could be. A change inside its bar may be noise.' + colours + inRing + left });
        module.forEach((b) => blocks.push(b));
        blocks.push(table);
        if (notes) {
            blocks.push(notes);
        }
        return blocks;
    }

    function haloChartScale(h)
    {
        let lo = Math.min.apply(null, [1].concat(h.points.map((p) => p.relative - p.err)));
        let hi = Math.max.apply(null, [1].concat(h.points.map((p) => p.relative + p.err)));
        const pad = Math.max((hi - lo) * 0.18, 0.01);
        return { lo: lo - pad, hi: hi + pad };
    }

    function haloSection(root, ctx, width)
    {
        const sec = chartCard(root, 'Halo over time');
        const bar = el('div', 'pn-toggle-row');
        para(bar, 'Off by default in the live app.', 'pn-foot');
        const btn = el('button', 'btn sm', 'Show');
        btn.type = 'button';
        btn.setAttribute('aria-expanded', 'false');
        bar.appendChild(btn);
        sec.appendChild(bar);
        const body = el('div', 'pn-halo');
        body.hidden = true;
        sec.appendChild(body);
        btn.addEventListener('click', () => {
            body.hidden = !body.hidden;
            btn.textContent = body.hidden ? 'Show' : 'Hide';
            btn.setAttribute('aria-expanded', String(!body.hidden));
        });
        if (ctx.ws !== 'sky') {
            needTarget(body, 'Halo over time');
            return;
        }
        const copy = window.COPY && window.COPY[ctx.targetId];
        if (!copy || copy.kind !== 'saturated') {
            plain(body, 'The live app shows this only for R Draconis, whose card says its centre is too bright to measure.');
            return;
        }
        const d = targetData(ctx.targetId);
        const h = d && d.halo;
        if (!h) {
            plain(body, 'The live app’s own code returned nothing to show for this view.');
            return;
        }
        haloText(h, copy.display).forEach((b) => {
            if (b.p) {
                para(body, b.p, 'pn-mute');
            } else if (b.chart) {
                const sc = haloChartScale(h);
                const ys = h.points.map((p) => p.relative);
                body.appendChild(relChart(width, h.points, { lo: sc.lo, hi: sc.hi, noise: 0, line: true,
                    aria: 'Light in the ring over ' + h.points.length + ' looks, from ' + pct(Math.min.apply(null, ys)) + ' to ' + pct(Math.max.apply(null, ys)) + ' relative to the median.',
                    t0Label: haloDate(h.points[0].mjd, false), t1Label: haloDate(h.points[h.points.length - 1].mjd, false) }));
            } else if (b.table) {
                const tb = el('table', 'pn-table');
                const cap = el('caption', 'sr', 'Light in the ring, each look');
                tb.appendChild(cap);
                const thead = el('thead');
                const hr = el('tr');
                ['Look', 'Colour', 'Ring light vs the median of these looks'].forEach((t) => {
                    const th = el('th', '', t);
                    th.scope = 'col';
                    hr.appendChild(th);
                });
                thead.appendChild(hr);
                tb.appendChild(thead);
                const tbody = el('tbody');
                b.table.forEach((row) => {
                    const tr = el('tr');
                    row.forEach((c) => tr.appendChild(el('td', '', c)));
                    tbody.appendChild(tr);
                });
                tb.appendChild(tbody);
                body.appendChild(tb);
            } else if (b.notes) {
                const ul = el('ul', 'warn-list');
                b.notes.forEach((n) => ul.appendChild(el('li', '', n)));
                body.appendChild(ul);
            }
        });
        para(body, 'Computed by the live app’s code on its saved frames (paneldata.js).', 'pn-foot');
    }

    function charts(host, ctx)
    {
        clear(host);
        const root = el('div', 'pn');
        host.appendChild(root);
        const width = Math.min(widthOf(host, 312) - 28, 420) >= 240 ? Math.min(widthOf(host, 312) - 28, 420) : 312;
        curveSection(root, ctx, width);
        spectrumSection(root, width);
        haloSection(root, ctx, width);
        if (!window.PANEL_DATA) {
            plain(root, NO_COPY);
        }
    }

    // ---------- ported: src/lib/comet.ts ----------

    const COMET_TITLE = 'Comet 3I/ATLAS across the CO₂ band';
    const CO2_BAND_UM = [4.25, 4.27];
    const CO2_NEAR_UM = 0.03;
    const COMA_RADIUS_ARCMIN = 3;
    const PIXEL_ARCSEC = 6.15;
    const BLANK_RGB = [96, 28, 28];
    const COMET_PAPERS = Object.freeze([
        Object.freeze({ cite: 'Lisse et al. 2025, RNAAS 9, 242', doi: '10.3847/2515-5172/ae0293', arxiv: '2508.15469' }),
        Object.freeze({ cite: 'Lisse et al. 2026, RNAAS 10, 26', doi: '10.3847/2515-5172/ae3f95', arxiv: '2601.06759' }),
    ]);
    const COMET_BANNED = /\b(discover(y|ed|ies)?|detect(ed|ion|s)?|confirm(ed|s)?|proves?|proven)\b/i;

    // Shorter than the product's parser, same refusals that matter for drawing: anything off returns null.
    function parseComet(raw)
    {
        if (!raw || typeof raw !== 'object' || raw.units !== 'MJy/sr' || !Array.isArray(raw.frames)) {
            return null;
        }
        const size = raw.size;
        if (!Number.isInteger(size) || size < 5 || size > 101 || size % 2 !== 1 || raw.frames.length < 2 || raw.frames.length > 24) {
            return null;
        }
        const mid = (size - 1) / 2;
        for (const f of raw.frames) {
            if (!Array.isArray(f.cutout) || f.cutout.length !== size * size || typeof f.key !== 'string' || f.key.indexOf('dr1/') !== 0) {
                return null;
            }
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (f.cutout[(mid + dy) * size + mid + dx] === null) {
                        return null;
                    }
                }
            }
        }
        const frames = raw.frames.slice().sort((a, b) => a.wavelength - b.wavelength);
        return { object: raw.object, detector: raw.detector, size: size, units: 'MJy/sr', mostQuery: raw.mostQuery, madeBy: raw.madeBy,
            madeAt: raw.madeAt, note: raw.note, frames: frames };
    }

    function cometFrameLabel(f)
    {
        const wave = f.wavelength.toFixed(2) + ' µm';
        const time = f.start.slice(11, 16) + ' UTC';
        return { wave: wave, time: time, aria: wave + ', started ' + time + ' on ' + f.start.slice(0, 10) };
    }

    function cometPoints(doc)
    {
        return doc.frames.map((f) => ({ wavelength: f.wavelength, core: f.coreMean, border: f.borderMedian, value: f.coreMean - f.borderMedian }));
    }

    function corePixels(f, size)
    {
        const mid = (size - 1) / 2;
        const out = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                out.push(f.cutout[(mid + dy) * size + mid + dx]);
            }
        }
        return out;
    }

    function sharedScale(doc)
    {
        const lo = Math.min.apply(null, doc.frames.map((f) => f.borderMedian));
        const hi = Math.max.apply(null, [].concat.apply([], doc.frames.map((f) => corePixels(f, doc.size))));
        return hi > lo ? { lo: lo, hi: hi } : { lo: lo, hi: lo + 1 };
    }

    function cutoutRgba(f, size, scale)
    {
        const out = new Uint8ClampedArray(size * size * 4);
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const v = f.cutout[(size - 1 - row) * size + col];
                const o = (row * size + col) * 4;
                if (v === null || v === undefined) {
                    out[o] = BLANK_RGB[0];
                    out[o + 1] = BLANK_RGB[1];
                    out[o + 2] = BLANK_RGB[2];
                    out[o + 3] = 255;
                    continue;
                }
                const g = Math.round(255 * Math.min(1, Math.max(0, (v - scale.lo) / (scale.hi - scale.lo))));
                out[o] = g;
                out[o + 1] = g;
                out[o + 2] = g;
                out[o + 3] = 255;
            }
        }
        return out;
    }

    function cfmt(v)
    {
        return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
    }

    function timeGroups(doc)
    {
        const byTime = doc.frames.slice().sort((a, b) => a.mjdStart - b.mjdStart);
        const out = [];
        for (const f of byTime) {
            const last = out[out.length - 1];
            if (last && (f.mjdStart - last[last.length - 1].mjdStart) * 1440 <= 30) {
                last.push(f);
            } else {
                out.push([f]);
            }
        }
        return out;
    }

    function groupSentence(doc, top)
    {
        const group = timeGroups(doc).find((g) => g.some((f) => f.wavelength === top.wavelength)) || [];
        if (group.length < 2) {
            return 'The brightest frame has no neighbour taken within minutes of it, so this card cannot tell colour from time.';
        }
        const minutes = Math.max(1, Math.ceil((group[group.length - 1].mjdStart - group[0].mjdStart) * 1440 - 1e-6));
        const ws = group.map((f) => f.wavelength);
        const low = group.reduce((a, f) => (f.coreMean - f.borderMedian < a.coreMean - a.borderMedian ? f : a));
        return 'The ' + group.length + ' frames from ' + Math.min.apply(null, ws).toFixed(2) + ' to ' + Math.max.apply(null, ws).toFixed(2) + ' µm started within ' + minutes + ' minutes of each other.'
            + ' Among them the core reads ' + cfmt(top.value) + ' MJy/sr at ' + top.wavelength.toFixed(2) + ' µm and ' + cfmt(low.coreMean - low.borderMedian) + ' at ' + low.wavelength.toFixed(2) + ' µm. They are close in time, but this card still cannot fully separate colour from time, and the box may sit a little differently on the comet in each frame.';
    }

    function spanText(doc)
    {
        const first = doc.frames.reduce((a, f) => Math.min(a, f.mjdStart), Infinity);
        const last = doc.frames.reduce((a, f) => Math.max(a, f.mjdStart), -Infinity);
        const minutes = Math.round((last - first) * 1440);
        return minutes < 90 ? minutes + ' minutes' : 'about ' + (minutes / 60).toFixed(1) + ' hours';
    }

    function nearCo2(wavelength)
    {
        return wavelength >= CO2_BAND_UM[0] - CO2_NEAR_UM && wavelength <= CO2_BAND_UM[1] + CO2_NEAR_UM;
    }

    function cometCaption(doc)
    {
        const f0 = doc.frames[0];
        const fn = doc.frames[doc.frames.length - 1];
        const pts = cometPoints(doc);
        const top = pts.reduce((a, p) => (p.value > a.value ? p : a));
        const day = new Date(f0.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
        return [
            doc.frames.length + ' SPHEREx frames from ' + day + ', taken over ' + spanText(doc) + ' at wavelengths from ' + f0.wavelength.toFixed(2) + ' to ' + fn.wavelength.toFixed(2) + ' µm.'
                + ' Each frame sees a different wavelength, so the row mixes colour and time.',
            groupSentence(doc, top),
            'All the pictures share one linear brightness scale, so they can be compared; its top is the brightest pixel in any of the 3×3 boxes. The faint frames look almost black.'
                + ' Anything brighter than the top shows white, such as a star, a hot pixel or a cosmic-ray hit. Pixels with no value in the archive are drawn dark red.'
                + ' The pictures keep the detector’s orientation; they are not turned north up.',
            'The numbers are the mean of the 3×3 pixels at the comet’s predicted position (from IRSA’s Moving Object Search Tool), minus the median of each picture’s border.'
                + ' The box sits on the predicted position, not on the brightest pixel, so it can miss part of the peak.'
                + ' The border is not empty sky: the coma the SPHEREx team reports (about ' + COMA_RADIUS_ARCMIN + ' arcminutes in radius) is wider than these pictures (about ' + Math.round(doc.size * PIXEL_ARCSEC / 60) + ' arcminutes across).'
                + ' They are raw pixel values, not a calibrated measurement.',
            'Here the core is brightest at ' + top.wavelength.toFixed(2) + ' µm (' + cfmt(top.value) + ' MJy/sr above its border).'
                + (nearCo2(top.wavelength) ? ' The SPHEREx team reports carbon dioxide gas glowing at 4.25 to 4.27 µm in this comet (Lisse et al. 2026). This card does not separate gas light from dust light.' : ''),
            'The SPHEREx team reported this comet’s wide carbon dioxide coma (Lisse et al. 2025 and 2026). This card redraws public frames with rough numbers of its own and adds nothing new to that work.',
        ];
    }

    // src/ui/comet-view.ts cometChartSvg, as DOM.
    function cometChart(doc)
    {
        const pts = cometPoints(doc);
        const W = 300;
        const H = 170;
        const L = 40;
        const R = 10;
        const T = 10;
        const B = 34;
        const x0 = Math.floor(pts[0].wavelength * 10) / 10;
        const x1 = Math.ceil(pts[pts.length - 1].wavelength * 10) / 10;
        const ymax = Math.max.apply(null, pts.map((p) => p.value));
        const step = ymax > 20 ? 10 : ymax > 5 ? 2 : 0.5;
        const y1 = Math.ceil(ymax / step) * step;
        const y0f = Math.min(0, Math.floor(Math.min.apply(null, pts.map((p) => p.value)) / step) * step);
        const y0 = y1 > y0f ? y0f : y1 - step;
        const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
        const sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
        const top = pts.reduce((a, p) => (p.value > a.value ? p : a));
        const desc = 'Core brightness minus border, by wavelength: ' + pts.map((p) => p.wavelength.toFixed(2) + ' µm ' + cfmt(p.value)).join('; ') + ' MJy/sr.'
            + ' Highest at ' + top.wavelength.toFixed(2) + ' µm.';
        const s = sv('svg', { class: 'pn-cm-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': desc });
        s.appendChild(sv('title', null, 'Comet core brightness against wavelength'));
        s.appendChild(sv('path', { class: 'ax', d: 'M' + L + ' ' + T + 'V' + (H - B) + 'H' + (W - R) }));
        for (let v = x0; v <= x1 + 1e-9; v += 0.1) {
            s.appendChild(sv('text', { class: 'tk', x: sx(v).toFixed(1), y: H - B + 14, 'text-anchor': 'middle' }, v.toFixed(1)));
        }
        for (let v = y0; v <= y1 + 1e-9; v += step) {
            s.appendChild(sv('text', { class: 'tk', x: L - 6, y: (sy(v) + 4).toFixed(1), 'text-anchor': 'end' }, String(v)));
        }
        s.appendChild(sv('text', { class: 'al', x: (L + W - R) / 2, y: H - 4, 'text-anchor': 'middle' }, 'Wavelength (µm)'));
        s.appendChild(sv('text', { class: 'al', transform: 'translate(11 ' + ((T + H - B) / 2) + ') rotate(-90)', 'text-anchor': 'middle' }, 'MJy/sr'));
        s.appendChild(sv('path', { class: 'line', d: pts.map((p, i) => (i ? 'L' : 'M') + sx(p.wavelength).toFixed(1) + ' ' + sy(p.value).toFixed(1)).join(' ') }));
        pts.forEach((p) => {
            const g = sv('g', { class: 'pt' });
            g.appendChild(sv('title', null, p.wavelength.toFixed(2) + ' µm: ' + cfmt(p.value) + ' MJy/sr above the border'));
            g.appendChild(sv('circle', { class: 'dot', cx: sx(p.wavelength).toFixed(1), cy: sy(p.value).toFixed(1), r: 3 }));
            g.appendChild(sv('circle', { class: 'hit', cx: sx(p.wavelength).toFixed(1), cy: sy(p.value).toFixed(1), r: 10 }));
            s.appendChild(g);
        });
        return s;
    }

    function cometCard(root)
    {
        const sec = chartCard(root, COMET_TITLE);
        const doc = parseComet(window.COMET_3I_ATLAS);
        if (!doc) {
            plain(sec, 'The comet frames could not be loaded.');
            return;
        }
        const grid = el('div', 'pn-cm-row');
        const scale = sharedScale(doc);
        doc.frames.forEach((f) => {
            const lab = cometFrameLabel(f);
            const fig = el('figure', 'pn-cm-cell');
            const cv = el('canvas');
            cv.width = doc.size;
            cv.height = doc.size;
            cv.setAttribute('role', 'img');
            cv.setAttribute('aria-label', 'Comet-centred picture at ' + lab.aria);
            const c2 = cv.getContext('2d');
            if (c2) {
                c2.putImageData(new ImageData(cutoutRgba(f, doc.size, scale), doc.size, doc.size), 0, 0);
            }
            fig.appendChild(cv);
            const cap = el('figcaption');
            cap.appendChild(el('b', '', lab.wave));
            cap.appendChild(el('span', '', lab.time));
            fig.appendChild(cap);
            grid.appendChild(fig);
        });
        sec.appendChild(grid);
        sec.appendChild(cometChart(doc));
        // The product's banned-words rule: a sentence that claims a discovery, detection or proof is never shown.
        cometCaption(doc).forEach((s) => {
            if (COMET_BANNED.test(s)) {
                return;
            }
            para(sec, s, 'pn-mute');
        });
        para(sec, 'Frames: SPHEREx DR1, detector ' + doc.detector + ', from IRSA. Papers:', 'pn-mute');
        const ul = el('ul', 'pn-refs');
        COMET_PAPERS.forEach((p) => {
            const li = el('li');
            li.appendChild(link('https://doi.org/' + p.doi, p.cite));
            ul.appendChild(li);
        });
        sec.appendChild(ul);
        if (doc.note) {
            para(sec, doc.note, 'pn-foot');
        }
        const more = el('details', 'pn-more');
        more.appendChild(el('summary', '', 'Show the numbers'));
        const tb = el('table', 'pn-table');
        tb.appendChild(el('caption', '', 'The numbers behind the chart, in MJy/sr'));
        const hr = el('tr');
        ['Wavelength', 'Start', 'Core 3×3 mean', 'Border median', 'Core minus border'].forEach((t) => {
            const th = el('th', '', t);
            th.scope = 'col';
            hr.appendChild(th);
        });
        const thead = el('thead');
        thead.appendChild(hr);
        tb.appendChild(thead);
        const tbody = el('tbody');
        doc.frames.forEach((f) => {
            const lab = cometFrameLabel(f);
            const tr = el('tr');
            [lab.wave, lab.time, cfmt(f.coreMean), cfmt(f.borderMedian), cfmt(f.coreMean - f.borderMedian)].forEach((c) => tr.appendChild(el('td', '', c)));
            tbody.appendChild(tr);
        });
        tb.appendChild(tbody);
        more.appendChild(tb);
        sec.appendChild(more);
    }

    // ---------- ported: src/lib/planetx.ts and planetx-chart.ts ----------

    const PX = (function () {
        const orbit = 'https://arxiv.org/abs/2108.09868';
        const mission = 'https://arxiv.org/abs/2511.02985';
        const ps1 = 'https://arxiv.org/abs/2401.17977';
        const ztf = 'https://arxiv.org/abs/2110.13117';
        const des = 'https://arxiv.org/abs/2203.07642';
        const luhman = 'https://doi.org/10.1088/2041-8205/786/2/L18';
        const wise = 'https://irsa.ipac.caltech.edu/data/WISE/docs/release/All-Sky/expsup/sec4_4h.html';
        const earth = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html';
        const diameter = 'https://doi.org/10.1088/0004-637X/741/2/68';
        const inverseFourth = 'https://arxiv.org/abs/2506.12854';
        const P9 = {
            mass: { value: 6.2, unit: 'Earth masses', source: 'Brown & Batygin 2021, abstract, ' + orbit + '; -1.3/+2.2 Earth masses' },
            semiMajorAxis: { value: 380, unit: 'AU', source: 'Brown & Batygin 2021, abstract, ' + orbit + '; -80/+140 AU' },
            albedo: { value: [0.2, 0.75], unit: 'geometric albedo', source: 'Brown & Batygin 2021, section 5, ' + orbit },
            earthRadius: { value: 6371, unit: 'km', source: 'NASA Earth Fact Sheet, volumetric mean radius, ' + earth },
            diameterMagnitudeConstant: { value: 1329, unit: 'km', source: 'Masiero et al. 2011, section 1, ' + diameter },
            percentileCurveExtents: { value: [18, 23], unit: 'approximate R mag', source: 'Brown & Batygin 2021, arXiv:2108.09868v2, Figure 9, ' + orbit + '; approximate outer extents of conditional 16th and 84th percentile curves read by eye across right ascension, not global percentiles' },
            envelope: { value: [17, 25.5], unit: 'approximate R mag', source: 'Brown & Batygin 2021, arXiv:2108.09868v2, Figure 9, ' + orbit + '; approximate plotted colored extent read by eye, not a hard bound' },
        };
        const depthSource = 'Bock et al. 2025, abstract and Figure 19 caption, ' + mission + '; 5 sigma point source, per spectral channel, 4 observations per channel at the median sky, Galactic plane excluded';
        const makeDepth = (wavelength, depth) => ({
            wavelength: { value: wavelength, unit: 'µm', source: depthSource },
            fourObservations: { value: depth, unit: 'AB mag; 4 observations per channel', source: depthSource },
            oneObservation: { value: [depth[0] - 0.75, depth[1] - 0.75], unit: 'AB mag; one observation per channel (derived: 4-observation depth minus 0.75 mag)', source: depthSource + '; estimate: 4-observation depth - 2.5 log10(sqrt(4)), approximated by 0.75 mag' },
        });
        const SPHEREX_DEPTH = [makeDepth([0.75, 3.8], [19.5, 19.9]), makeDepth([3.8, 5], [17.8, 18.8])];
        const sv2 = 'mag; approximate single-epoch depth';
        const s2 = 'Brown, Holman & Batygin 2024, section II, ' + ps1;
        const SURVEYS = [
            { name: 'Pan-STARRS1', band: 'g', limit: { value: 22, unit: sv2, source: s2 } },
            { name: 'Pan-STARRS1', band: 'r', limit: { value: 21.8, unit: sv2, source: s2 } },
            { name: 'Pan-STARRS1', band: 'i', limit: { value: 21.5, unit: sv2, source: s2 } },
            { name: 'Pan-STARRS1', band: 'z', limit: { value: 20.9, unit: sv2, source: s2 } },
            { name: 'Pan-STARRS1', band: 'y', limit: { value: 19.7, unit: sv2, source: s2 } },
            { name: 'ZTF', band: 'V', limit: { value: 20.5, unit: 'mag; approximate 95% detection efficiency', source: 'Brown & Batygin 2022, abstract, ' + ztf } },
            { name: 'DES', band: 'r', limit: { value: 23.8, unit: 'mag; typical limiting magnitude (r)', source: 'Belyakov et al. 2022, section I, ' + des } },
        ];
        const EXCLUDED_FRACTION = { value: 0.78, source: 'Brown, Holman & Batygin 2024, abstract, sections 5 and 6, ' + ps1 };
        const PS1_HALF_COMPLETE = { value: 21.5, unit: 'V mag; 50% completion depth', source: 'Brown, Holman & Batygin 2024, abstract, ' + ps1 };
        const REMAINING_V = { value: { value: 22, lower: -1.4, upper: 1.1 }, unit: 'V mag', source: 'Brown, Holman & Batygin 2024, section 6, ' + ps1 + '; remaining reference population' };
        const w2Vega = { value: 13.89, source: 'Luhman 2014, Table 1, ' + luhman };
        const w2Offset = { value: 3.339, source: 'WISE Explanatory Supplement, section IV.4.h, Table 3, ' + wise };
        const WISE0855 = {
            w2AB: { value: w2Vega.value + w2Offset.value, unit: 'AB mag', source: 'Luhman 2014, Table 1, ' + luhman + '; WISE Explanatory Supplement Table 3, ' + wise + '; W2 Vega plus AB offset' },
            bandMicrometres: { value: 4.6 },
        };
        const TEXT = {
            stackGain: 'stacking frames goes deeper for a source that stays put; the gain is not measured here, and shift-and-stack for a moving source is not tested',
            bandNote: "Rows are in different bands (optical R and V, survey g, r, i, z and y, SPHEREx AB per channel, WISE W2) on one axis with no colour correction, so compare them only roughly. Only the model row is this repo's own estimate (reflected sunlight, V band); the others come from the papers listed, with the one-observation SPHEREx depth and the WISE 0855 AB value worked out here from published numbers, and the Planet Nine ranges read by eye from Figure 9 of Brown & Batygin 2021.",
            caveat: 'An estimate only: the one-observation depth assumes four equal independent observations. The model assumes the object is seen at opposition, fully lit.',
            wiseNote: "W2 is a broadband average and WISE 0855's spectrum changes steeply across 3.8 to 5 µm, so its brightness in one SPHEREx channel can differ from W2.",
        };
        const refs = [
            { key: 'orbit', text: 'Brown & Batygin 2021, The Orbit of Planet Nine', url: orbit },
            { key: 'mission', text: 'Bock et al. 2025, The SPHEREx Satellite Mission', url: mission },
            { key: 'ps1', text: 'Brown, Holman & Batygin 2024, Pan-STARRS1 search', url: ps1 },
            { key: 'ztf', text: 'Brown & Batygin 2022, ZTF search, AJ 163, 102, doi:10.3847/1538-3881/ac32dd', url: ztf },
            { key: 'des', text: 'Belyakov et al. 2022, DES limits', url: des },
            { key: 'luhman', text: 'Luhman 2014, WISE 0855 photometry', url: luhman },
            { key: 'wise', text: 'WISE All-Sky Explanatory Supplement, photometric calibration', url: wise },
            { key: 'earth', text: 'NASA Earth Fact Sheet', url: earth },
            { key: 'diameter', text: 'Masiero et al. 2011, asteroid albedo and diameter relation', url: diameter },
            { key: 'inverse-fourth', text: 'Chen et al. 2025, far-infrared search (cited only for the distance scaling)', url: inverseFourth },
        ];
        return { P9: P9, SPHEREX_DEPTH: SPHEREX_DEPTH, SURVEYS: SURVEYS, EXCLUDED_FRACTION: EXCLUDED_FRACTION, PS1_HALF_COMPLETE: PS1_HALF_COMPLETE,
            REMAINING_V: REMAINING_V, WISE0855: WISE0855, TEXT: TEXT, refs: refs };
    })();

    function positive(value)
    {
        if (!Number.isFinite(value) || value <= 0) {
            throw new RangeError('Expected a finite positive value');
        }
    }

    function radiusKm(massEarth)
    {
        positive(massEarth);
        return massEarth / 3 * PX.P9.earthRadius.value;
    }

    function absoluteMag(radius, albedo)
    {
        positive(radius);
        positive(albedo);
        if (albedo > 1) {
            throw new RangeError('Albedo must be at most one');
        }
        return 5 * (Math.log10(PX.P9.diameterMagnitudeConstant.value) - Math.log10(2) - Math.log10(radius) - Math.log10(albedo) / 2);
    }

    function oppositionDistanceModulus(distanceAu)
    {
        positive(distanceAu);
        if (distanceAu <= 1) {
            throw new RangeError('Heliocentric distance must exceed one AU');
        }
        return 5 * (Math.log10(distanceAu) + Math.log10(distanceAu - 1));
    }

    function apparentMag(massEarth, albedo, distanceAu)
    {
        const modulus = oppositionDistanceModulus(distanceAu);
        return absoluteMag(radiusKm(massEarth), albedo) + modulus;
    }

    function modelExample()
    {
        const distance = PX.P9.semiMajorAxis.value;
        const albedo = (PX.P9.albedo.value[0] + PX.P9.albedo.value[1]) / 2;
        return { vMag: apparentMag(PX.P9.mass.value, albedo, distance), label: 'model, V band, if it were at ' + distance + ' AU (its fitted semi-major axis, not its likely current distance), with albedo ' + albedo + ', the middle of the published range' };
    }

    const AXIS = { min: 16, max: 26, step: 2 };

    function planetxRows()
    {
        const range = (value, text, style) => ({ kind: 'range', from: value.value[0], to: value.value[1], text: text, source: value.source, style: style });
        const point = (value, text, source, style) => ({ kind: 'point', from: value, to: value, text: text, source: source, style: style || 'solid' });
        const depth = (key, style) => PX.SPHEREX_DEPTH.map((entry) => range(entry[key], entry.wavelength.value[0] + '–' + entry.wavelength.value[1] + ' µm', style));
        const remaining = PX.REMAINING_V.value;
        const model = modelExample();
        const tick = (m) => Object.assign(m, { kind: 'tick' });
        const remainingMark = point(remaining.value, 'Remaining estimate', PX.REMAINING_V.source);
        remainingMark.low = remaining.value + remaining.lower;
        remainingMark.high = remaining.value + remaining.upper;
        return [
            { id: 'p9-predicted', label: 'Planet Nine, predicted', band: PX.P9.envelope.unit, marks: [range(PX.P9.envelope, 'Fig. 9 extent, by eye', 'light'), range(PX.P9.percentileCurveExtents, 'Percentile-curve extents', 'solid')] },
            { id: 'p9-remaining', label: 'Not yet ruled out', band: PX.REMAINING_V.unit, marks: [remainingMark] },
            { id: 'model', label: "This repo's model, one example", band: 'V band', marks: [point(model.vMag, 'model, at ' + PX.P9.semiMajorAxis.value + ' AU', model.label + '; computed in this repo from the published mass, albedo range and semi-major axis', 'outline')] },
            { id: 'searches', label: 'Optical searches already done', band: 'Multiple optical bands', marks: PX.SURVEYS.map((s) => tick(point(s.limit.value, s.name + ' ' + s.band, s.limit.source)))
                .concat([tick(point(PX.PS1_HALF_COMPLETE.value, 'PS1 search half complete, ' + PX.PS1_HALF_COMPLETE.unit.split(';')[0], PX.PS1_HALF_COMPLETE.source))]) },
            { id: 'spherex-4', label: 'SPHEREx depth, 4 observations per channel', band: 'AB, per channel', marks: depth('fourObservations', 'solid') },
            { id: 'spherex-1', label: 'SPHEREx depth, one observation (derived)', band: 'AB, per channel', marks: depth('oneObservation', 'outline') },
            { id: 'wise0855', label: 'WISE 0855 at ' + PX.WISE0855.bandMicrometres.value + ' µm, a real cold neighbour', band: 'W2, AB', marks: [point(PX.WISE0855.w2AB.value, 'WISE 0855', PX.WISE0855.w2AB.source)] },
        ];
    }

    function magToX(mag, plotLeft, plotWidth)
    {
        return plotLeft + (mag - AXIS.min) / (AXIS.max - AXIS.min) * plotWidth;
    }

    function sentence(value)
    {
        const text = value.charAt(0).toUpperCase() + value.slice(1);
        return text.endsWith('.') ? text : text + '.';
    }

    function markValue(mark)
    {
        const format = (value) => String(Number(value.toFixed(2)));
        const value = mark.kind === 'range' ? format(mark.from) + '–' + format(mark.to) : format(mark.from);
        const uncertainty = mark.low !== undefined && mark.high !== undefined ? ' (' + format(mark.low) + '–' + format(mark.high) + ')' : '';
        return value + uncertainty;
    }

    function planetxChartText()
    {
        return {
            title: 'How faint would Planet Nine be, and how deep do the searches go?',
            caption: "The rows are in different bands, so their numbers are not interchangeable. The Planet Nine rows are optical brightness: the chart does not estimate how bright it would be at SPHEREx's wavelengths. This is an estimate from published numbers, not a search result.",
            notes: [PX.TEXT.bandNote, PX.TEXT.caveat, PX.TEXT.wiseNote, PX.TEXT.stackGain, modelExample().label,
                'Together, the ZTF, DES and Pan-STARRS1 searches have ruled out about ' + Math.round(PX.EXCLUDED_FRACTION.value * 100) + '% of the synthetic reference population'].map(sentence),
            references: PX.refs.filter((r) => r.key !== 'inverse-fourth'),
        };
    }

    // planetxChartSvg, as DOM, same layout rules; colours are mockup tokens in the product's order
    // (gold for the Planet Nine rows, ink for the searches, blue for SPHEREx, orange for WISE 0855).
    function planetxChart(requestedWidth)
    {
        const width = Number.isFinite(requestedWidth) && requestedWidth >= 320 ? requestedWidth : 320;
        const left = Math.min(230, Math.round(width * 0.42));
        const right = 20;
        const plotWidth = width - left - right;
        const rows = planetxRows();
        const colors = ['var(--pn-gold)', 'var(--pn-gold)', 'var(--pn-gold)', 'var(--ink-2)', 'var(--pn-blue)', 'var(--pn-blue)', 'var(--pn-orange)'];
        const ink = 'var(--ink)';
        const mute = 'var(--mute)';
        const xFor = (mag) => magToX(mag, left, plotWidth);
        let y = 20;
        const s = sv('svg', { class: 'pn-px', role: 'img' });
        const gridG = sv('g');
        s.appendChild(sv('title', null, 'Planet Nine brightness and survey depths'));
        s.appendChild(gridG);
        rows.forEach((row, rowIndex) => {
            const labelY = y + 13;
            const lines = [];
            row.label.split(' ').forEach((word) => {
                const last = lines.length - 1;
                if (last < 0 || (lines[last] + ' ' + word).length * 7 > left - 18) {
                    lines.push(word);
                } else {
                    lines[last] += ' ' + word;
                }
            });
            const bandY = labelY + lines.length * 15;
            const sorted = row.marks.map((mark, index) => ({ mark: mark, index: index }));
            if (row.id === 'searches') {
                sorted.sort((a, b) => a.mark.from - b.mark.from || a.index - b.index);
            }
            let markY = y + (row.marks[0] && row.marks[0].kind === 'range' ? 30 : 23);
            if (row.id === 'searches') {
                markY = bandY + 13;
            } else if (row.marks[0] && row.marks[0].kind === 'point') {
                const mark = row.marks[0];
                const rightEdge = xFor(mark.high !== undefined ? mark.high : mark.from) + (mark.high === undefined ? 4 : 0);
                if (rightEdge + 8 + mark.text.length * 6.6 > width && xFor(mark.low !== undefined ? mark.low : mark.from) - 12 - mark.text.length * 6.6 < left) {
                    markY = bandY + 12;
                }
            }
            const g = sv('g', { 'data-row': row.id });
            lines.forEach((line, i) => {
                g.appendChild(sv('text', { x: 8, y: labelY + i * 15, fill: ink, 'font-size': 13 }, line));
            });
            g.appendChild(sv('text', { x: 8, y: bandY, fill: mute, 'font-size': 11 }, row.band));
            const above = [];
            sorted.forEach((o, lineIndex) => {
                const mark = o.mark;
                const x = xFor(mark.from);
                const end = xFor(mark.to);
                const currentY = markY + (mark.kind === 'tick' ? lineIndex * 15 : 0);
                const color = colors[rowIndex] || colors[0];
                const paint = mark.style === 'outline' ? { fill: 'none', stroke: color, 'stroke-width': 1.5 }
                    : Object.assign({ fill: color }, mark.style === 'light' ? { 'fill-opacity': 0.28 } : {});
                const mg = sv('g', { 'data-mark': row.id });
                mg.appendChild(sv('title', null, markValue(mark) + '; ' + mark.source));
                if (mark.low !== undefined && mark.high !== undefined) {
                    mg.appendChild(sv('line', { x1: xFor(mark.low), y1: currentY, x2: xFor(mark.high), y2: currentY, stroke: color }));
                }
                if (mark.kind === 'range') {
                    mg.appendChild(sv('rect', Object.assign({ x: x, y: currentY - 4, width: end - x, height: 8, rx: 2 }, paint)));
                } else if (mark.kind === 'tick') {
                    mg.appendChild(sv('rect', Object.assign({ x: x - 1, y: currentY - 5, width: 2, height: 10 }, paint)));
                } else {
                    mg.appendChild(sv('circle', Object.assign({ cx: x, cy: currentY, r: 4 }, paint)));
                }
                const textWidth = mark.text.length * 6.6;
                const ta = { fill: 'var(--ink-2)', 'font-size': 11 };
                if (mark.kind === 'range') {
                    const textX = Math.max(left, Math.min(width - textWidth, x));
                    const below = row.id === 'p9-predicted' ? o.index === 0 : above.some((other) => textX < other.x + other.width + 6 && textX + textWidth + 6 > other.x);
                    ta.x = textX;
                    ta.y = currentY + (below ? 16 : -8);
                    if (!below) {
                        above.push({ x: textX, width: textWidth });
                    }
                } else {
                    const rightEdge = mark.kind === 'tick' ? x + 1 : xFor(mark.high !== undefined ? mark.high : mark.from) + (mark.high === undefined ? 4 : 0);
                    const leftEdge = mark.kind === 'tick' ? x - 1 : xFor(mark.low !== undefined ? mark.low : mark.from) - (mark.low === undefined ? 4 : 0);
                    const gap = mark.kind === 'tick' ? 6 : 8;
                    const flip = rightEdge + gap + textWidth > width;
                    ta.x = flip ? leftEdge - gap : rightEdge + gap;
                    ta.y = currentY;
                    if (flip) {
                        ta['text-anchor'] = 'end';
                    }
                    ta['dominant-baseline'] = 'middle';
                }
                if (/^\d/.test(mark.text)) {
                    ta['font-family'] = 'var(--mono)';
                }
                mg.appendChild(sv('text', ta, mark.text));
                g.appendChild(mg);
            });
            s.appendChild(g);
            const marksBottom = markY + (row.id === 'searches' ? (row.marks.length - 1) * 15 + 6 : row.marks[0] && row.marks[0].kind === 'range' ? 16 : 6);
            y = Math.max(y + 46, marksBottom + 10, bandY + 10);
        });
        const axisY = y + 5;
        const footerLines = [];
        'apparent magnitude (fainter to the right; each row in its own band)'.split(' ').forEach((word) => {
            const last = footerLines.length - 1;
            if (last < 0 || (footerLines[last] + ' ' + word).length * 6.6 > width - 16) {
                footerLines.push(word);
            } else {
                footerLines[last] += ' ' + word;
            }
        });
        const height = axisY + 35 + footerLines.length * 13;
        for (let mag = AXIS.min; mag <= AXIS.max; mag += AXIS.step) {
            const x = xFor(mag);
            gridG.appendChild(sv('line', { x1: x, y1: 20, x2: x, y2: axisY, stroke: mute, 'stroke-opacity': 0.14 }));
            s.appendChild(sv('line', { x1: x, y1: axisY, x2: x, y2: axisY + 5, stroke: mute }));
            s.appendChild(sv('text', { x: x, y: axisY + 18, 'text-anchor': 'middle', fill: mute, 'font-size': 11, 'font-family': 'var(--mono)' }, String(mag)));
        }
        s.appendChild(sv('line', { x1: left, y1: axisY, x2: width - right, y2: axisY, stroke: mute }));
        footerLines.forEach((line, i) => {
            s.appendChild(sv('text', { x: width / 2, y: axisY + 43 + i * 13, 'text-anchor': 'middle', fill: mute, 'font-size': 10 }, line));
        });
        const description = rows.map((row) => row.label + ' (' + row.band + '): ' + row.marks.map((m) => m.text + ' ' + markValue(m)).join('; ') + '.').join(' ');
        s.setAttribute('aria-label', description);
        s.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        s.setAttribute('width', String(width));
        s.setAttribute('height', String(height));
        return s;
    }

    function planetxCard(root, width)
    {
        const sec = chartCard(root, 'Planet Nine: how faint, how deep?');
        const text = planetxChartText();
        const fig = el('figure', 'pn-px-fig');
        fig.appendChild(planetxChart(width));
        const cap = el('figcaption');
        cap.appendChild(el('b', '', text.title));
        cap.appendChild(el('span', '', text.caption));
        fig.appendChild(cap);
        sec.appendChild(fig);
        const more = el('details', 'pn-more');
        more.appendChild(el('summary', '', 'About these numbers'));
        text.notes.forEach((n) => more.appendChild(el('p', 'pn-mute', n)));
        const ul = el('ul', 'pn-refs');
        text.references.forEach((r) => {
            const li = el('li');
            li.appendChild(link(r.url, r.text));
            ul.appendChild(li);
        });
        more.appendChild(ul);
        sec.appendChild(more);
    }

    // ---------- Sources and credits (source.ts credits(), sharecard.ts AI_CREDIT, SOURCES.md) ----------

    const AI_CREDIT = 'Made with AI-written code (Claude, Codex, Gemini)';
    const GAIA_CREDIT = 'ESA, Gaia DPAC; Gaia DR3; CC BY-NC 3.0 IGO';

    function releaseCredits(cites)
    {
        return Array.from(new Set(cites));
    }

    function creditsCard(root, ctx)
    {
        const sec = chartCard(root, 'Sources and credits');
        const ul = el('ul', 'pn-refs');
        const d = ctx.ws === 'sky' ? targetData(ctx.targetId) : null;
        const releases = d ? releaseCredits(d.frames.map((f) => (RELEASE_DOI[f.release] ? RELEASE_DOI[f.release].cite : f.collection))) : [];
        const items = [];
        if (d) {
            releases.forEach((r) => {
                const k = Object.keys(RELEASE_DOI).find((x) => RELEASE_DOI[x].cite === r);
                items.push(k ? [r, 'https://doi.org/' + RELEASE_DOI[k].id] : [r, '']);
            });
            items.push([GAIA_CREDIT, 'https://www.cosmos.esa.int/web/gaia/dr3']);
            items.push(['Position and motion: SIMBAD (Harvard mirror), ' + d.simbadName, 'https://simbad.cfa.harvard.edu/simbad/sim-id?Ident=' + encodeURIComponent(d.simbadName)]);
        } else {
            items.push(['Your own frames: credit them as their source asks.', '']);
        }
        items.push(['Comet card: SPHEREx DR1 frames from IRSA; Lisse et al. 2025 and 2026', '']);
        items.push([AI_CREDIT, '']);
        items.forEach((it) => {
            const li = el('li');
            if (it[1]) {
                li.appendChild(link(it[1], it[0]));
            } else {
                li.textContent = it[0];
            }
            ul.appendChild(li);
        });
        sec.appendChild(ul);
        para(sec, 'The full list, with every page checked and what is not confirmed, is SOURCES.md in the product repo: SPHEREx and its camera, where the data lives, the five targets, Spectrum, Planet Nine, Older picture (2MASS K), Comet card, Help text, and AI-generated content.', 'pn-foot');
    }

    function extras(host, ctx)
    {
        clear(host);
        const root = el('div', 'pn');
        host.appendChild(root);
        const width = Math.max(320, Math.min(widthOf(host, 320) - 28, 420));
        cometCard(root);
        planetxCard(root, width);
        creditsCard(root, ctx);
    }

    // ---------- AI note tab (src/ui/ai-note.ts, ask-panel.ts; words from the product) ----------

    function modelName(model)
    {
        const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:$|-\d{8}$)/.exec(model || '');
        if (!m) {
            return 'Claude';
        }
        const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
        return 'Claude ' + family + ' ' + m[2] + (m[3] ? '.' + m[3] : '');
    }

    const DEFAULT_MODEL = 'claude-opus-5-5'; // api/insight.ts default when INSIGHT_MODEL is unset

    function aiExtras(host, ctx)
    {
        const root = el('div', 'pn');
        host.appendChild(root);
        // No AI text is shown in this mockup, so no AI-generated tag here: say which model the live app labels its
        // notes with instead (api/insight.ts default when INSIGHT_MODEL is unset).
        para(root, 'In the live app each note is labelled with the Claude model that wrote it; by default that is ' + modelName(DEFAULT_MODEL) + '.', 'pn-mute');
        para(root, 'In the live app, the note stays off until the site owner sets it up. Typed questions are switched off on the live page.', 'pn-plain');

        const lock = el('form', 'pn-ai-lock');
        lock.addEventListener('submit', (e) => e.preventDefault());
        const lab = el('label');
        lab.appendChild(el('span', '', 'Passcode'));
        const pass = el('input');
        pass.type = 'password';
        pass.disabled = true;
        pass.setAttribute('aria-label', 'AI note passcode');
        lab.appendChild(pass);
        lock.appendChild(lab);
        const unlock = el('button', 'btn sm', 'Unlock');
        unlock.type = 'submit';
        unlock.disabled = true;
        lock.appendChild(unlock);
        root.appendChild(lock);

        const go = el('button', 'btn sm', 'Write an AI note');
        go.type = 'button';
        go.disabled = true;
        root.appendChild(go);
        para(root, 'Written by AI from the measurements on this page. It can be wrong and is not a measurement: check it against the numbers.', 'pn-foot');

        const ask = el('form', 'pn-ask');
        ask.addEventListener('submit', (e) => e.preventDefault());
        const al = el('label', 'pn-sub', 'Ask about this view');
        al.htmlFor = 'pn-ask-q';
        ask.appendChild(al);
        const row = el('div', 'pn-ask-row');
        const q = el('input');
        q.id = 'pn-ask-q';
        q.type = 'text';
        q.disabled = true;
        q.placeholder = 'For example: how much did the brightness vary?';
        row.appendChild(q);
        const askBtn = el('button', 'btn sm', 'Ask');
        askBtn.type = 'submit';
        askBtn.disabled = true;
        row.appendChild(askBtn);
        ask.appendChild(row);
        ask.appendChild(el('p', 'pn-foot', "The AI only picks lines from this page's measurements. It does not write an answer of its own."));
        ask.appendChild(el('p', 'pn-foot', 'Chosen by AI (' + modelName(DEFAULT_MODEL) + ') from the measurements on this page.'));
        root.appendChild(ask);
        if (ctx && ctx.ws !== 'sky') {
            plain(root, 'This mockup shows the AI note for library targets only.');
        }
    }

    window.SlowskyPanels = {
        targetExtras: targetExtras,
        frameExtras: frameExtras,
        charts: charts,
        extras: extras,
        aiExtras: aiExtras,
        // Ported pure functions, for panels.test.mjs.
        _test: { upTonight: upTonight, upTonightText: upTonightText, sunRaDec: sunRaDec, altAz: altAz, planetxRows: planetxRows,
            planetxChartText: planetxChartText, modelExample: modelExample, apparentMag: apparentMag, magToX: magToX,
            parseComet: parseComet, cometCaption: cometCaption, cometPoints: cometPoints, sharedScale: sharedScale, timeGroups: timeGroups,
            COMET_BANNED: COMET_BANNED, haloText: haloText, modelName: modelName, motionText: (a, b) => motionText(a, b) },
    };

    function motionText(pmRa, pmDec)
    {
        const pm = Math.hypot(pmRa, pmDec) / 1000;
        const pa = (Math.atan2(pmRa, pmDec) * 180) / Math.PI;
        return pm.toFixed(1) + '″ a year, ' + COMPASS[Math.round((((pa % 360) + 360) % 360) / 45) % 8];
    }
})();
