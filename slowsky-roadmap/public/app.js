// Slowsky build roadmap. Plain DOM, no framework. Data goes in with textContent only.
const KEY_STORE = 'slowsky-roadmap-key';
const AUTHOR_STORE = 'slowsky-roadmap-author';
const TZ_STORE = 'slowsky-roadmap-tz';
const REFRESH_MS = 30000;
const RETRY_MS = 5000;
// Printable ASCII only: anything else (a zero-width space or smart quote pasted from chat) makes
// fetch throw on the Authorization header before any request goes out.
const KEY_RE = /^[\x21-\x7e]{16,256}$/;

// Fixed offsets: neither zone changes clocks during the event.
const TZ = { NPT: 345, AEDT: 660 };
const OTHER = { NPT: 'AEDT', AEDT: 'NPT' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const START = Date.parse('2026-11-14T03:30:00+05:45');
const END = Date.parse('2026-11-15T13:30:00+05:45');
const LAST_SUBMIT = Date.parse('2026-11-15T12:30:00+05:45');
const HARD_STOP = Date.parse('2026-11-15T13:00:00+05:45');

const LANES = [
    { id: 'milestones', label: 'Milestones' },
    { id: 'sam', label: 'Sam' },
    { id: 'build', label: 'Build' },
    { id: 'lanes', label: 'Parallel' },
    { id: 'demo', label: 'Demo video' },
    { id: 'overnight', label: 'Overnight' },
    { id: 'rest', label: 'Rest' },
];

const STATUS = {
    todo: { icon: '○', label: 'To do' },
    doing: { icon: '◐', label: 'Doing' },
    done: { icon: '✓', label: 'Done' },
    blocked: { icon: '✕', label: 'Blocked' },
    cut: { icon: '–', label: 'Cut' },
    late: { icon: '!', label: 'Late' },
    passed: { icon: '◆', label: 'Passed' },
};
const PICKABLE = ['todo', 'doing', 'done', 'blocked', 'cut'];
const TIER_LABEL = { core: 'Core', weekend: 'Overnight', 'if-ahead': 'Only if ahead', roadmap: 'Roadmap' };
const KIND_LABEL = { version: 'Version', feature: 'Feature', block: 'Timeline block', milestone: 'Milestone', step: "Sam's step", idea: 'Beyond v1' };

const state = {
    key: null,
    tz: 'NPT',
    items: [],
    updates: [],
    byId: new Map(),
    fetchedAt: 0,
    error: '',
    centred: false,
    feedLimit: 30,
    open: null,
    openStatus: null,
    openProgress: null,
    loading: false,
    reloadAgain: false,
    retry: 0,
    updatesLimit: 0,
};

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

function h(tag, props = {}, ...kids)
{
    const el = document.createElement(tag);
    setProps(el, props);
    append(el, kids);
    return el;
}

function s(tag, props = {}, ...kids)
{
    const el = document.createElementNS(NS, tag);
    setProps(el, props);
    append(el, kids);
    return el;
}

function setProps(el, props)
{
    for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) {
            continue;
        }
        if (k === 'text') {
            el.textContent = String(v);
        } else if (k.startsWith('on') && typeof v === 'function') {
            el.addEventListener(k.slice(2), v);
        } else {
            el.setAttribute(k === 'className' ? 'class' : k, v === true ? '' : String(v));
        }
    }
}

function append(el, kids)
{
    for (const kid of kids.flat()) {
        if (kid === null || kid === undefined || kid === false) {
            continue;
        }
        el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
}

// Time helpers
function pad(n)
{
    return String(n).padStart(2, '0');
}

function parts(ms, tz = state.tz)
{
    const d = new Date(ms + TZ[tz] * 60000);
    return { day: DAYS[d.getUTCDay()], date: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes() };
}

function clock(ms, tz = state.tz)
{
    const p = parts(ms, tz);
    return `${pad(p.h)}:${pad(p.m)}`;
}

function stamp(ms, tz = state.tz)
{
    return `${parts(ms, tz).day} ${clock(ms, tz)}`;
}

function bothZones(ms)
{
    return `${stamp(ms)} ${state.tz} · ${stamp(ms, OTHER[state.tz])} ${OTHER[state.tz]}`;
}

function span(ms)
{
    const mins = Math.round(Math.abs(ms) / 60000);
    if (mins < 1) {
        return 'under a minute';
    }
    const hrs = Math.floor(mins / 60);
    if (hrs === 0) {
        return `${mins} m`;
    }
    return `${hrs} h ${pad(mins % 60)} m`;
}

function ago(ms, now)
{
    const d = now - ms;
    if (d < 45000) {
        return 'just now';
    }
    return `${span(d)} ago`;
}

function ms(value)
{
    return value ? Date.parse(value) : NaN;
}

// Status shown on screen: stored status, plus "late" for open items past their due time.
function shown(item, now)
{
    if (item.kind === 'milestone') {
        if (item.status === 'done') {
            return 'done';
        }
        return ms(item.due_at) < now ? 'passed' : item.status;
    }
    if (['done', 'cut', 'blocked'].includes(item.status)) {
        return item.status;
    }
    if (item.lane === 'rest' || item.kind === 'idea' || item.kind === 'version') {
        return item.status;
    }
    if (ms(item.due_at) < now) {
        return 'late';
    }
    return item.status;
}

function badge(key, extraClass = '')
{
    const st = STATUS[key] || STATUS.todo;
    return h('span', { className: `badge st-${key} ${extraClass}`.trim() },
        h('span', { className: 'icon', 'aria-hidden': 'true', text: st.icon }),
        h('span', { className: 'badge-label', text: st.label }));
}

function meter(pct, label)
{
    const bar = h('span');
    bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    return h('div', { className: 'meter', role: 'img', 'aria-label': label || `${Math.round(pct)}%` }, bar);
}

function mean(list)
{
    if (list.length === 0) {
        return 0;
    }
    return list.reduce((sum, item) => sum + item.progress, 0) / list.length;
}

// Data
async function api(path, options = {})
{
    const key = state.key;
    const headers = { authorization: `Bearer ${key}` };
    if (options.body) {
        headers['content-type'] = 'application/json';
    }
    const res = await fetch(`/api/${path}`, { ...options, headers, cache: 'no-store' });
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    if (res.status === 401) {
        // Only forget the key this request used; a newer key pasted meanwhile stays.
        if (state.key === key) {
            forgetKey('That key did not work. Paste the key again.');
        }
        throw new Error('Wrong key');
    }
    if (!res.ok) {
        throw new Error((data && data.error) || `Server said ${res.status}`);
    }
    return data;
}

async function load()
{
    if (!state.key) {
        return;
    }
    if (state.loading) {
        // A refresh already in flight may have read the data before a save; run once more after it.
        state.reloadAgain = true;
        return;
    }
    state.loading = true;
    const key = state.key;
    try {
        const data = await api('roadmap');
        if (state.key !== key) {
            // The key was forgotten or changed while this request ran: drop the answer.
            return;
        }
        state.items = data.items;
        state.updates = data.updates;
        state.updatesLimit = data.updates_limit || 0;
        state.byId = new Map(data.items.map((item) => [item.id, item]));
        state.fetchedAt = Date.now();
        state.error = '';
        $('key-gate').hidden = true;
        $('app').hidden = false;
        $('post-note').hidden = false;
        $('forget-key').hidden = false;
        render();
    } catch (err) {
        if (state.key !== key) {
            return;
        }
        state.error = err.message;
        if (!state.fetchedAt && state.key) {
            // Nothing has loaded yet, so the app is still hidden: say so on the key screen (the key is
            // kept, so a network blip heals itself) and try again soon.
            showGate(`Could not load the roadmap: ${err.message}. Trying again in a few seconds, or paste the key again.`, false);
            if (!state.retry) {
                state.retry = setTimeout(() => {
                    state.retry = 0;
                    load();
                }, RETRY_MS);
            }
        }
        renderSync(Date.now());
    } finally {
        state.loading = false;
        if (state.reloadAgain) {
            state.reloadAgain = false;
            load();
        }
    }
}

function showGate(message, focus)
{
    $('app').hidden = true;
    $('post-note').hidden = true;
    $('forget-key').hidden = !state.key;
    $('key-gate').hidden = false;
    $('key-error').textContent = message || '';
    if (focus) {
        $('key-input').focus();
    }
}

function forgetKey(message)
{
    state.key = null;
    try {
        localStorage.removeItem(KEY_STORE);
    } catch {
        // storage can be off in private mode
    }
    showGate(message, true);
}

// Strip spaces and invisible characters that chat apps add when the key is copied.
function cleanKey(raw)
{
    return String(raw || '').replace(/[\s\u00a0\u200b-\u200d\u2060\ufeff]/g, '');
}

// Rendering
function render()
{
    const now = Date.now();
    renderHero(now);
    renderLegend();
    renderGantt(now);
    renderVersions(now);
    renderSteps(now);
    renderIdeas();
    renderFeed(now);
    renderSync(now);
    if (state.open) {
        const fresh = state.byId.get(state.open);
        if (fresh) {
            renderHistory(fresh.id);
        }
    }
    for (const el of document.querySelectorAll('.tz-name')) {
        el.textContent = state.tz;
    }
}

function renderHero(now)
{
    const left = LAST_SUBMIT - now;
    const count = $('count-last');
    const tile = count.closest('.tile');
    tile.classList.remove('soon', 'urgent', 'over');
    if (left <= 0) {
        count.textContent = HARD_STOP - now > 0 ? `closed ${span(left)} ago` : 'Event over';
        tile.classList.add('over');
    } else {
        count.textContent = span(left);
        if (left < 3600000) {
            tile.classList.add('urgent');
        } else if (left < 6 * 3600000) {
            tile.classList.add('soon');
        }
    }
    $('count-sub').textContent = `${bothZones(LAST_SUBMIT)}. Hard stop ${clock(HARD_STOP)} ${state.tz}.`;

    const next = state.items
        .filter((item) => item.kind === 'milestone' && item.status !== 'done' && ms(item.due_at) > now)
        .sort((a, b) => ms(a.due_at) - ms(b.due_at))[0];
    if (next) {
        $('next-title').textContent = next.title;
        $('next-sub').textContent = `in ${span(ms(next.due_at) - now)} · ${stamp(ms(next.due_at))} ${state.tz}`;
    } else {
        $('next-title').textContent = 'None left';
        $('next-sub').textContent = '';
    }

    const core = state.items.filter((item) => item.kind === 'feature' && item.tier === 'core' && item.status !== 'cut');
    const pct = mean(core);
    const done = core.filter((item) => item.status === 'done').length;
    $('overall-pct').textContent = `${Math.round(pct)}%`;
    $('overall-sub').textContent = `${done} of ${core.length} done`;
    $('overall-meter').replaceWith(Object.assign(meter(pct, `Core features ${Math.round(pct)}% complete`), { id: 'overall-meter' }));

    const list = $('now-list');
    list.replaceChildren();
    const live = state.items
        .filter((item) => item.kind === 'block' && item.lane !== 'rest' && ms(item.start_at) <= now && ms(item.due_at) > now)
        .sort((a, b) => a.sort - b.sort);
    const doing = state.items.filter((item) => item.status === 'doing' && !live.includes(item) && item.kind !== 'block');
    for (const item of [...live, ...doing].slice(0, 6)) {
        list.append(h('li', {},
            h('button', { type: 'button', className: 'link', onclick: () => openItem(item.id) },
                badge(shown(item, now), 'compact'), ' ', item.title)));
    }
    if (list.childElementCount === 0) {
        list.append(h('li', { className: 'sub', text: 'Nothing scheduled right now.' }));
    }
}

function renderSync(now)
{
    const el = $('sync');
    el.classList.toggle('bad', Boolean(state.error));
    if (state.error) {
        const when = state.fetchedAt ? ` Showing data from ${ago(state.fetchedAt, now)}.` : '';
        el.textContent = `Can't reach the server: ${state.error}.${when}`;
    } else if (state.fetchedAt) {
        el.textContent = `Live · updated ${ago(state.fetchedAt, now)} · refreshes every 30 s`;
    }
}

function renderLegend()
{
    const el = $('legend');
    el.replaceChildren(...['todo', 'doing', 'done', 'late', 'blocked', 'cut'].map((key) => badge(key)),
        h('span', { className: 'legend-now' }, h('span', { className: 'swatch-now', 'aria-hidden': 'true' }), 'Now'));
}

// Gantt
const G = { pxh: 56, axis: 44, row: 30, bar: 22, gap: 12, pad: 16 };

function xOf(t)
{
    return G.pad + ((t - START) / 3600000) * G.pxh;
}

function packRows(entries)
{
    const ends = [];
    for (const entry of entries.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1)) {
        let row = ends.findIndex((end) => end <= entry.x0 + 0.5);
        if (row === -1) {
            row = ends.length;
            ends.push(0);
        }
        ends[row] = entry.x1;
        entry.row = row;
    }
    return Math.max(1, ends.length);
}

function renderGantt(now)
{
    const svg = $('gantt');
    const labels = $('gantt-labels');
    const scroller = $('gantt-scroll');
    const keepScroll = scroller.scrollLeft;
    const width = Math.ceil(xOf(END) + G.pad);

    const lanes = LANES.map((lane) => ({ ...lane, entries: [] }));
    const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
    for (const item of state.items) {
        if (item.kind === 'milestone' && item.due_at) {
            const x = xOf(ms(item.due_at));
            const labelW = item.title.length * 6.4;
            // A label that would run past the right edge (Last Submit, Hard stop) goes left of its diamond.
            const flip = x + 14 + labelW > width - 4;
            const entry = flip
                ? { item, x0: x - 14 - labelW, x1: x + 8, x, flip }
                : { item, x0: x - 8, x1: x + 14 + labelW, x, flip };
            laneById.get('milestones').entries.push(entry);
        } else if (item.kind === 'block' && item.start_at && item.due_at) {
            const lane = laneById.get(item.lane) || laneById.get('build');
            lane.entries.push({ item, x0: xOf(ms(item.start_at)), x1: xOf(ms(item.due_at)) });
        }
    }

    let y = G.axis;
    for (const lane of lanes) {
        lane.rows = packRows(lane.entries);
        lane.y = y;
        lane.h = lane.rows * G.row + 8;
        y += lane.h + G.gap;
    }
    const height = y;

    svg.replaceChildren();
    labels.replaceChildren();
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    labels.setAttribute('height', height);
    labels.setAttribute('viewBox', `0 0 88 ${height}`);
    labels.setAttribute('width', 88);

    // Lane bands (alternate tint instead of divider lines)
    lanes.forEach((lane, i) => {
        if (i % 2 === 0) {
            svg.append(s('rect', { className: 'band', x: 0, y: lane.y - G.gap / 2, width, height: lane.h + G.gap }));
            labels.append(s('rect', { className: 'band', x: 0, y: lane.y - G.gap / 2, width: 88, height: lane.h + G.gap }));
        }
        labels.append(s('text', { className: 'lane-label', x: 10, y: lane.y + 19, text: lane.label }));
    });

    // Hour grid and axis
    const grid = s('g', { className: 'grid' });
    const axis = s('g', { className: 'axis' });
    const off = TZ[state.tz] * 60000;
    const firstHour = Math.ceil((START + off) / 3600000) * 3600000 - off;
    for (let t = firstHour; t <= END; t += 3600000) {
        const x = xOf(t);
        const p = parts(t);
        const midnight = p.h === 0;
        grid.append(s('line', { className: midnight ? 'day-line' : 'hour-line', x1: x, x2: x, y1: G.axis - 6, y2: height }));
        axis.append(s('text', { className: 'hour', x, y: G.axis - 12, 'text-anchor': 'middle', text: pad(p.h) }));
        if (midnight) {
            axis.append(s('text', { className: 'day', x: x + 4, y: 14, text: `${p.day} ${p.date} Nov` }));
        }
    }
    axis.append(s('text', { className: 'day', x: G.pad, y: 14, text: `${parts(START).day} ${parts(START).date} Nov · ${state.tz}` }));
    svg.append(grid, axis);

    // Deadlines
    for (const [t, label] of [[LAST_SUBMIT, 'Last Submit'], [HARD_STOP, 'Hard stop']]) {
        const x = xOf(t);
        svg.append(s('line', { className: 'deadline', x1: x, x2: x, y1: G.axis - 4, y2: height }, s('title', { text: label })));
    }

    // Blocks and milestones
    for (const lane of lanes) {
        for (const entry of lane.entries) {
            const top = lane.y + 4 + entry.row * G.row;
            if (lane.id === 'milestones') {
                svg.append(milestoneMark(entry, top, now));
            } else {
                svg.append(blockMark(entry, top, now));
            }
        }
    }

    // Now line
    if (now >= START && now <= END) {
        const x = xOf(now);
        const tag = `Now ${clock(now)}`;
        const w = tag.length * 6.6 + 12;
        svg.append(s('line', { className: 'now-line', x1: x, x2: x, y1: G.axis - 18, y2: height }));
        svg.append(s('rect', { className: 'now-tag', x: x - w / 2, y: 18, width: w, height: 16, rx: 8 }));
        svg.append(s('text', { className: 'now-text', x, y: 30, 'text-anchor': 'middle', text: tag }));
    }

    if (!state.centred) {
        state.centred = true;
        const target = now >= START && now <= END ? xOf(now) - scroller.clientWidth * 0.3 : 0;
        scroller.scrollLeft = Math.max(0, target);
    } else {
        scroller.scrollLeft = keepScroll;
    }

    renderTimelineTable(lanes, now);
}

function itemLabel(item, now)
{
    const st = STATUS[shown(item, now)];
    const when = item.start_at
        ? `${stamp(ms(item.start_at))}–${clock(ms(item.due_at))} ${state.tz}`
        : `${stamp(ms(item.due_at))} ${state.tz}`;
    const who = item.owner ? `, ${item.owner}` : '';
    return `${item.title}${who}. ${when}. ${st.label}${item.progress ? `, ${item.progress}%` : ''}.`;
}

function bindMark(group, item, now)
{
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');
    group.setAttribute('aria-label', itemLabel(item, now));
    group.addEventListener('click', () => openItem(item.id));
    group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openItem(item.id);
        }
    });
    group.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse') {
            showTip(event, item, now);
        }
    });
    group.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'mouse') {
            moveTip(event);
        }
    });
    group.addEventListener('pointerleave', hideTip);
    group.addEventListener('focus', () => showTipFor(group, item, now));
    group.addEventListener('blur', hideTip);
}

function blockMark(entry, top, now)
{
    const { item } = entry;
    const key = shown(item, now);
    const w = Math.max(6, entry.x1 - entry.x0 - 2);
    const g = s('g', { className: `mark st-${key}` });
    g.append(s('rect', { className: 'hit', x: entry.x0, y: top - 3, width: w + 2, height: G.bar + 6 }));
    g.append(s('rect', { className: 'bar-bg', x: entry.x0 + 1, y: top, width: w, height: G.bar, rx: 4 }));
    if (item.progress > 0 && key !== 'cut') {
        g.append(s('rect', { className: 'bar-fill', x: entry.x0 + 1, y: top, width: Math.max(4, (w * item.progress) / 100), height: G.bar, rx: 4 }));
    }
    g.append(s('rect', { className: 'bar-edge', x: entry.x0 + 1, y: top, width: 3, height: G.bar, rx: 1.5 }));
    const room = Math.floor((w - 12) / 6.6);
    if (room >= 7) {
        const full = `${STATUS[key].icon} ${item.title}`;
        const text = full.length > room ? `${full.slice(0, Math.max(1, room - 1))}…` : full;
        g.append(s('text', { className: 'bar-text', x: entry.x0 + 9, y: top + 15, text }));
    }
    bindMark(g, item, now);
    return g;
}

function milestoneMark(entry, top, now)
{
    const { item, x } = entry;
    const key = shown(item, now);
    const cy = top + G.bar / 2;
    const r = 7;
    const g = s('g', { className: `mark ms st-${key}` });
    g.append(s('rect', { className: 'hit', x: entry.x0 - 2, y: top - 3, width: entry.x1 - entry.x0 + 4, height: G.bar + 6 }));
    g.append(s('path', { className: 'diamond', d: `M${x} ${cy - r}L${x + r} ${cy}L${x} ${cy + r}L${x - r} ${cy}Z` }));
    g.append(entry.flip
        ? s('text', { className: 'ms-text', x: x - 11, y: cy + 4, 'text-anchor': 'end', text: item.title })
        : s('text', { className: 'ms-text', x: x + 11, y: cy + 4, text: item.title }));
    bindMark(g, item, now);
    return g;
}

function renderTimelineTable(lanes, now)
{
    const body = $('timeline-table');
    const rows = [];
    for (const lane of lanes) {
        for (const entry of lane.entries) {
            rows.push({ lane, item: entry.item, t: ms(entry.item.start_at || entry.item.due_at) });
        }
    }
    rows.sort((a, b) => a.t - b.t);
    body.replaceChildren(...rows.map(({ lane, item }) => {
        const when = item.start_at ? `${stamp(ms(item.start_at))}–${clock(ms(item.due_at))}` : stamp(ms(item.due_at));
        return h('tr', {},
            h('td', { className: 'num', text: when }),
            h('td', { text: lane.label }),
            h('td', {}, h('button', { type: 'button', className: 'link', onclick: () => openItem(item.id), text: item.title })),
            h('td', {}, badge(shown(item, now), 'compact')));
    }));
}

// Tooltip
function tipContent(item, now)
{
    const tip = $('tip');
    const key = shown(item, now);
    const when = item.start_at
        ? `${stamp(ms(item.start_at))}–${clock(ms(item.due_at))} ${state.tz}`
        : `${stamp(ms(item.due_at))} ${state.tz}`;
    tip.replaceChildren(
        h('strong', { text: item.title }),
        h('span', { className: 'tip-row' }, badge(key), item.progress ? ` ${item.progress}%` : ''),
        h('span', { className: 'tip-row', text: `${when}${item.owner ? ` · ${item.owner}` : ''}` }),
        item.detail ? h('span', { className: 'tip-detail', text: item.detail }) : null);
    tip.hidden = false;
    return tip;
}

function showTip(event, item, now)
{
    tipContent(item, now);
    moveTip(event);
}

function moveTip(event)
{
    const tip = $('tip');
    const pad = 14;
    const rect = tip.getBoundingClientRect();
    let left = event.clientX + pad;
    let top = event.clientY + pad;
    if (left + rect.width > window.innerWidth - 8) {
        left = event.clientX - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - 8) {
        top = event.clientY - rect.height - pad;
    }
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
}

function showTipFor(el, item, now)
{
    const tip = tipContent(item, now);
    const box = el.getBoundingClientRect();
    const rect = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, box.left))}px`;
    tip.style.top = `${box.bottom + 8 + rect.height > window.innerHeight ? box.top - rect.height - 8 : box.bottom + 8}px`;
}

function hideTip()
{
    $('tip').hidden = true;
}

// Versions board
function renderVersions(now)
{
    const el = $('versions');
    const versions = state.items.filter((item) => item.kind === 'version');
    el.replaceChildren(...versions.map((v) => {
        const features = state.items.filter((item) => item.kind === 'feature' && item.version === v.version);
        const live = features.filter((item) => item.status !== 'cut');
        const pct = live.length ? mean(live) : v.progress;
        const done = live.filter((item) => item.status === 'done').length;
        const due = ms(v.due_at);
        const left = due - now;
        let key = v.status;
        if (key !== 'done' && key !== 'cut' && live.length && done === live.length) {
            key = 'done';
        } else if (!['done', 'cut', 'blocked'].includes(key) && left < 0) {
            key = 'late';
        }
        const card = h('article', { className: `card version st-${key}` },
            h('div', { className: 'card-head' },
                h('button', { type: 'button', className: 'chip', onclick: () => openItem(v.id), text: v.version }),
                h('div', { className: 'card-title' },
                    h('h3', { text: v.title.replace(/^v[\d.]+\s*/, '') }),
                    h('p', { className: 'sub', text: `Due ${stamp(due)} ${state.tz} · ${left > 0 ? `in ${span(left)}` : `${span(left)} ago`}` })),
                badge(key)),
            h('div', { className: 'card-progress' },
                meter(pct, `${v.version} ${Math.round(pct)}% complete`),
                h('span', { className: 'num', text: `${Math.round(pct)}%` }),
                h('span', { className: 'sub', text: live.length ? `${done} of ${live.length} done` : '' })),
            v.tier === 'if-ahead' ? h('p', { className: 'sub', text: v.detail }) : null,
            h('ul', { className: 'feature-list' }, features.map((f) => featureRow(f, now))));
        return card;
    }));
}

function featureRow(item, now)
{
    const key = shown(item, now);
    const tier = item.tier && item.tier !== 'core' ? h('span', { className: 'tag', text: TIER_LABEL[item.tier] }) : null;
    return h('li', {},
        h('button', { type: 'button', className: `row-btn st-${key}`, onclick: () => openItem(item.id) },
            badge(key, 'compact'),
            h('span', { className: 'row-main' },
                h('span', { className: `row-title${key === 'cut' ? ' struck' : ''}`, text: item.title }),
                h('span', { className: 'row-sub' }, item.owner || '', tier ? ' ' : '', tier)),
            h('span', { className: 'num row-pct', text: item.progress ? `${item.progress}%` : '' })));
}

// Sam's steps
function renderSteps(now)
{
    const steps = state.items.filter((item) => item.kind === 'step').sort((a, b) => ms(a.due_at) - ms(b.due_at) || a.sort - b.sort);
    const done = steps.filter((item) => item.status === 'done').length;
    const late = steps.filter((item) => shown(item, now) === 'late').length;
    $('steps-sub').textContent = `${done} of ${steps.length} done${late ? ` · ${late} late` : ''}`;
    $('steps').replaceChildren(...steps.map((item) => {
        const key = shown(item, now);
        return h('li', {},
            h('button', { type: 'button', className: `row-btn st-${key}`, onclick: () => openItem(item.id) },
                badge(key, 'compact'),
                h('span', { className: 'row-main' },
                    h('span', { className: `row-title${key === 'done' ? ' muted' : ''}`, text: item.title }),
                    h('span', { className: 'row-sub', text: `by ${stamp(ms(item.due_at))} ${state.tz}` }))));
    }));
}

function renderIdeas()
{
    const ideas = state.items.filter((item) => item.kind === 'idea');
    $('ideas').replaceChildren(...ideas.map((item) => h('button', { type: 'button', className: 'card idea', onclick: () => openItem(item.id) },
        h('h3', { text: item.title }),
        h('p', { className: 'sub', text: item.detail }))));
}

// Activity feed
function updateRow(u, now, withItem = true)
{
    const item = u.item_id ? state.byId.get(u.item_id) : null;
    const head = h('p', { className: 'feed-head' },
        h('span', { className: 'who', text: u.author }),
        h('time', { datetime: u.at, title: bothZones(ms(u.at)), text: `${stamp(ms(u.at))} · ${ago(ms(u.at), now)}` }));
    const change = [];
    if (u.status) {
        change.push(badge(u.status, 'compact'));
    }
    if (u.progress !== null && u.progress !== undefined) {
        change.push(h('span', { className: 'num', text: `${u.progress}%` }));
    }
    return h('li', {},
        head,
        withItem && item
            ? h('p', { className: 'feed-item' }, h('button', { type: 'button', className: 'link', onclick: () => openItem(item.id), text: item.title }), ' ', ...change)
            : (change.length ? h('p', { className: 'feed-item' }, ...change) : null),
        h('p', { className: 'feed-note', text: u.note }));
}

function renderFeed(now)
{
    const list = state.updates.slice(0, state.feedLimit);
    $('feed').replaceChildren(...list.map((u) => updateRow(u, now)));
    if (list.length === 0) {
        $('feed').append(h('li', { className: 'sub', text: 'No updates yet.' }));
    }
    $('feed-more').hidden = state.updates.length <= state.feedLimit;
    if ($('feed-more').hidden && state.updatesLimit && state.updates.length >= state.updatesLimit) {
        $('feed').append(h('li', { className: 'sub', text: `Only the newest ${state.updatesLimit} updates load.` }));
    }
}

// Dialog
function author()
{
    try {
        return localStorage.getItem(AUTHOR_STORE) || '';
    } catch {
        return '';
    }
}

function openItem(id)
{
    const item = id ? state.byId.get(id) : null;
    const now = Date.now();
    state.open = item ? item.id : null;
    hideTip();
    $('d-error').textContent = '';
    $('d-note').value = '';
    $('d-author').value = author();
    $('d-status-set').hidden = !item;
    $('d-progress-field').hidden = !item;
    $('d-history-wrap').hidden = !item;
    if (!item) {
        $('d-kind').textContent = 'Progress update';
        $('d-title').textContent = 'Post a general update';
        $('d-meta').textContent = 'Shows in the feed. To move a status, open that item instead.';
        $('d-detail').textContent = '';
        $('d-gate').textContent = '';
        $('d-note').placeholder = 'What happened?';
    } else {
        const bits = [KIND_LABEL[item.kind] || item.kind];
        if (item.version && item.version !== 'beyond') {
            bits.push(item.version);
        }
        if (item.tier) {
            bits.push(TIER_LABEL[item.tier]);
        }
        $('d-kind').textContent = bits.join(' · ');
        $('d-title').textContent = item.title;
        const meta = [];
        if (item.owner) {
            meta.push(`Owner: ${item.owner}`);
        }
        if (item.start_at) {
            meta.push(`${bothZones(ms(item.start_at))} to ${clock(ms(item.due_at))} ${state.tz}`);
        } else if (item.due_at) {
            meta.push(`Due ${bothZones(ms(item.due_at))}`);
        }
        const key = shown(item, now);
        if (key === 'late' || key === 'passed') {
            meta.push(STATUS[key].label);
        }
        $('d-meta').textContent = meta.join(' · ');
        $('d-detail').textContent = item.detail || '';
        $('d-gate').textContent = item.gate ? `Gate: ${item.gate}` : '';
        $('d-note').placeholder = 'What changed? Optional when you only move the status.';
        pickStatus(item.status);
        setProgress(item.progress);
        // Save sends only what the user changed from here, so a refresh while the dialog is open
        // cannot make Save undo another session's update.
        state.openStatus = item.status;
        state.openProgress = Number($('d-progress').value);
        renderHistory(item.id);
    }
    const dlg = $('dlg');
    if (!dlg.open) {
        dlg.showModal();
    }
    (item ? $('d-status').querySelector('[aria-checked="true"]') : $('d-note')).focus();
}

function renderHistory(id)
{
    const now = Date.now();
    const list = state.updates.filter((u) => u.item_id === id);
    $('d-history').replaceChildren(...list.map((u) => updateRow(u, now, false)));
    const capped = state.updatesLimit && state.updates.length >= state.updatesLimit;
    if (list.length === 0) {
        $('d-history').append(h('li', { className: 'sub', text: capped ? 'No recent updates (only the newest load).' : 'No updates yet.' }));
    } else if (capped) {
        $('d-history').append(h('li', { className: 'sub', text: 'Older updates may not be shown.' }));
    }
}

function buildStatusPicker()
{
    const box = $('d-status');
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', 'Status');
    box.replaceChildren(...PICKABLE.map((key) => h('button', {
        type: 'button',
        role: 'radio',
        className: `pick st-${key}`,
        'data-status': key,
        'aria-checked': 'false',
        onclick: () => {
            pickStatus(key);
            if (key === 'done') {
                setProgress(100);
            }
        },
    }, h('span', { className: 'icon', 'aria-hidden': 'true', text: STATUS[key].icon }), STATUS[key].label)));
    box.addEventListener('keydown', (event) => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(event.key in keys)) {
            return;
        }
        event.preventDefault();
        const current = PICKABLE.indexOf(pickedStatus());
        const next = PICKABLE[(current + keys[event.key] + PICKABLE.length) % PICKABLE.length];
        pickStatus(next);
        if (next === 'done') {
            setProgress(100);
        }
        box.querySelector(`[data-status="${next}"]`).focus();
    });
}

function pickStatus(key)
{
    for (const btn of $('d-status').querySelectorAll('[data-status]')) {
        const on = btn.dataset.status === key;
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
        btn.tabIndex = on ? 0 : -1;
    }
}

function pickedStatus()
{
    const btn = $('d-status').querySelector('[aria-checked="true"]');
    return btn ? btn.dataset.status : 'todo';
}

function setProgress(value)
{
    $('d-progress').value = String(value);
    $('d-progress-out').textContent = `${$('d-progress').value}%`;
}

async function save(event)
{
    event.preventDefault();
    const item = state.open ? state.byId.get(state.open) : null;
    const err = $('d-error');
    err.textContent = '';
    let note = $('d-note').value.trim();
    const who = $('d-author').value.trim() || 'Sam';
    const body = { author: who };
    if (item) {
        const status = pickedStatus();
        const progress = Number($('d-progress').value);
        body.id = item.id;
        if (status !== state.openStatus) {
            body.status = status;
        }
        if (progress !== state.openProgress) {
            body.progress = progress;
        }
        if (!note) {
            if (body.status === undefined && body.progress === undefined) {
                err.textContent = 'Change the status or progress, or write a note.';
                return;
            }
            note = [body.status ? STATUS[body.status].label : null, body.progress !== undefined ? `${body.progress}%` : null]
                .filter(Boolean).join(', ');
        }
    } else if (!note) {
        err.textContent = 'Write a note first.';
        $('d-note').focus();
        return;
    }
    body.note = note;
    const button = $('d-save');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
        const res = await api('update', { method: 'POST', body: JSON.stringify(body) });
        try {
            localStorage.setItem(AUTHOR_STORE, who);
        } catch {
            // ignore
        }
        closeDialog();
        applySaved(res);
        await load();
    } catch (e) {
        err.textContent = `Not saved: ${e.message}`;
    } finally {
        button.disabled = false;
        button.textContent = 'Save update';
    }
}

// Show a save at once, without waiting for the next refresh.
function applySaved(res)
{
    if (!res) {
        return;
    }
    // row_to_json times carry microseconds; keep 3 digits so every browser parses them.
    const iso = (value) => (typeof value === 'string' ? value.replace(/(\.\d{3})\d+/, '$1') : value);
    if (res.item && state.byId.has(res.item.id)) {
        const { status, progress } = res.item;
        state.items = state.items.map((item) => (item.id === res.item.id ? { ...item, status, progress } : item));
        state.byId = new Map(state.items.map((item) => [item.id, item]));
    }
    if (res.update && !state.updates.some((u) => String(u.id) === String(res.update.id))) {
        state.updates = [{ ...res.update, at: iso(res.update.at) }, ...state.updates];
    }
    render();
}

function closeDialog()
{
    state.open = null;
    state.openStatus = null;
    state.openProgress = null;
    const dlg = $('dlg');
    if (dlg.open) {
        dlg.close();
    }
}

// Start
function setTz(tz)
{
    state.tz = TZ[tz] ? tz : 'NPT';
    for (const btn of document.querySelectorAll('[data-tz]')) {
        btn.setAttribute('aria-pressed', btn.dataset.tz === state.tz ? 'true' : 'false');
    }
    try {
        localStorage.setItem(TZ_STORE, state.tz);
    } catch {
        // ignore
    }
}

function readKey()
{
    const match = /(?:^|[#&])key=([^&]+)/.exec(location.hash);
    if (match) {
        history.replaceState(null, '', location.pathname + location.search);
        let key = '';
        try {
            key = cleanKey(decodeURIComponent(match[1]));
        } catch {
            key = '';
        }
        if (!KEY_RE.test(key)) {
            return null;
        }
        try {
            localStorage.setItem(KEY_STORE, key);
        } catch {
            // the key still works for this visit
        }
        return key;
    }
    let stored = null;
    try {
        stored = localStorage.getItem(KEY_STORE);
    } catch {
        return null;
    }
    if (stored && !KEY_RE.test(stored)) {
        try {
            localStorage.removeItem(KEY_STORE);
        } catch {
            // ignore
        }
        return null;
    }
    return stored;
}

function start()
{
    buildStatusPicker();
    try {
        setTz(localStorage.getItem(TZ_STORE) || 'NPT');
    } catch {
        setTz('NPT');
    }
    for (const btn of document.querySelectorAll('[data-tz]')) {
        btn.addEventListener('click', () => {
            setTz(btn.dataset.tz);
            if (state.fetchedAt) {
                render();
            }
        });
    }
    $('key-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const key = cleanKey($('key-input').value);
        if (!KEY_RE.test(key)) {
            $('key-error').textContent = key.length < 16 ? 'That is too short to be the key.' : 'That does not look like the key. Copy it again from the link.';
            return;
        }
        state.key = key;
        try {
            localStorage.setItem(KEY_STORE, key);
        } catch {
            // ignore
        }
        $('key-input').value = '';
        $('key-error').textContent = 'Checking…';
        load();
    });
    $('forget-key').addEventListener('click', () => forgetKey(''));
    $('post-note').addEventListener('click', () => openItem(null));
    $('feed-more').addEventListener('click', () => {
        state.feedLimit += 50;
        renderFeed(Date.now());
    });
    $('dlg-form').addEventListener('submit', save);
    $('d-close').addEventListener('click', closeDialog);
    $('d-cancel').addEventListener('click', closeDialog);
    $('dlg').addEventListener('close', () => {
        state.open = null;
    });
    // Close on a backdrop tap only when the press also started on the backdrop, so a drag that
    // ends outside the form (slider, text selection) keeps the unsaved note.
    let downOnBackdrop = false;
    $('dlg').addEventListener('pointerdown', (event) => {
        downOnBackdrop = event.target === $('dlg');
    });
    $('dlg').addEventListener('click', (event) => {
        if (downOnBackdrop && event.target === $('dlg')) {
            closeDialog();
        }
        downOnBackdrop = false;
    });
    $('d-progress').addEventListener('input', () => {
        const value = Number($('d-progress').value);
        $('d-progress-out').textContent = `${value}%`;
        if (value > 0 && value < 100 && pickedStatus() === 'todo') {
            pickStatus('doing');
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            load();
        }
    });
    window.addEventListener('resize', hideTip);
    $('gantt-scroll').addEventListener('scroll', hideTip, { passive: true });

    setInterval(() => {
        if (document.visibilityState === 'visible') {
            load();
        }
    }, REFRESH_MS);
    setInterval(() => {
        if (state.fetchedAt && document.visibilityState === 'visible') {
            const now = Date.now();
            renderHero(now);
            renderSync(now);
        }
    }, 10000);

    const hadHashKey = /(?:^|[#&])key=/.test(location.hash);
    state.key = readKey();
    if (state.key) {
        load();
    } else {
        forgetKey(hadHashKey ? 'The key in that link looks damaged. Paste the key instead.' : '');
    }
}

start();
