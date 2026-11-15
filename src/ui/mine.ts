// My frames: the visitor's own FITS, PNG or JPG files, run through src/lib/upload-engine.ts in this browser.
// Nothing is uploaded. Blink, Stack and Subtract work on these frames; Subtract lists candidate changes with the
// same caution as the Sky library: every line is a candidate, never a discovery.
import { candidates, process, render, STAGES, type Candidate, type Session, type UploadFile } from '../lib/upload-engine';

export type MineMode = 'blink' | 'stack' | 'diff';

export interface MineEls {
    view: HTMLElement; // box over the stage that holds the canvas and the candidate marks
    jobs: HTMLElement;
    jobsList: HTMLElement;
    jobsCount: HTMLElement;
    cands: HTMLElement; // list in the Candidates tab
    notes: HTMLElement; // notes in the Frame tab
    ab: HTMLElement; // A and B pickers in the timeline
    strip: HTMLElement; // one small picture per frame, in date order
    count: HTMLElement; // number beside "My frames"
}

export interface MineDeps {
    toast: (text: string) => void;
    onChange: () => void; // frames or picks changed: the page updates its labels
}

export const MIN_FILES = 2;
export const MAX_FILES = 20;
export const SIGMA_CAP = 1000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const CAND_TAGS = Object.freeze({
    edge: { tag: 'edge or blank pixel', line: 'Edge or blank pixel: the spot touches the picture edge or a pixel with no value (often a too-bright star’s centre), so check it by eye.' },
    single: { tag: '1 pixel', line: '1 pixel: a spot this small is often a cosmic ray or a hot pixel, not something in the sky.' },
});

export function candTag(c: Candidate): 'edge' | 'single' | ''
{
    if (c.edge) {
        return 'edge';
    }
    return c.pixels === 1 ? 'single' : '';
}

// Past about 1000 the number says nothing more (often a too-bright star or a mismatch), so it is capped in words.
// Display pictures are already stretched, so their σ is only a ranking: shown with ≈.
export function sigmaText(c: Candidate, rough: boolean): string
{
    const v = c.sigma > 0 ? Math.abs(c.peak / c.sigma) : 0;
    if (v >= SIGMA_CAP) {
        return `over ${SIGMA_CAP}σ${rough ? ' (rough)' : ''}`;
    }
    return `${rough ? '≈' : ''}${v.toFixed(1)}σ`;
}

export function dateText(d: Date | null): string
{
    if (!d) {
        return 'no date';
    }
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface Mine {
    readonly session: Session | null;
    index: number;
    a: number;
    b: number;
    add(files: File[]): void;
    cancel(): void;
    draw(mode: MineMode): void;
    step(dir: number): void;
    pick(k: number): void;
    label(): string;
    frameText(): { frame: string; when: string };
}

export function mountMine(els: MineEls, deps: MineDeps): Mine
{
    const doc = els.view.ownerDocument;
    const canvas = doc.createElement('canvas');
    canvas.className = 'tb-mine-img';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Your frame');
    const marks = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    marks.setAttribute('class', 'tb-mine-marks');
    marks.setAttribute('aria-hidden', 'true');
    marks.setAttribute('preserveAspectRatio', 'none');
    els.view.append(canvas, marks);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    let session: Session | null = null;
    let ctrl: AbortController | null = null;
    let mode: MineMode = 'blink';
    let list: Candidate[] = [];
    let picked = -1;

    const mine: Mine = {
        get session()
        {
            return session;
        },
        index: 0,
        a: 0,
        b: 1,
        add,
        cancel,
        draw,
        step,
        pick,
        label,
        frameText,
    };

    const selA = els.ab.querySelector<HTMLSelectElement>('[data-mine="a"]')!;
    const selB = els.ab.querySelector<HTMLSelectElement>('[data-mine="b"]')!;
    for (const [sel, which] of [[selA, 'a'], [selB, 'b']] as const) {
        sel.addEventListener('change', () => {
            const n = session?.frames.length ?? 2;
            let v = Number(sel.value);
            // A is always earlier than B: the last frame can only be B, the first only A.
            v = which === 'a' ? Math.min(v, n - 2) : Math.max(v, 1);
            if (which === 'a') {
                mine.a = v;
                if (mine.b <= mine.a) {
                    mine.b = Math.min(mine.a + 1, (session?.frames.length ?? 2) - 1);
                }
            } else {
                mine.b = v;
                if (mine.a >= mine.b) {
                    mine.a = Math.max(0, mine.b - 1);
                }
            }
            picked = -1;
            draw(mode);
            deps.onChange();
        });
    }

    function cancel(): void
    {
        ctrl?.abort();
        ctrl = null;
        els.jobs.hidden = true;
    }

    function add(files: File[]): void
    {
        const use = files.filter((f) => /\.(fits?|fts|gz|png|jpe?g)$/i.test(f.name));
        if (use.length < MIN_FILES) {
            deps.toast(`Add at least ${MIN_FILES} frames of the same patch of sky (FITS, PNG or JPG).`);
            return;
        }
        if (use.length > MAX_FILES) {
            deps.toast(`Up to ${MAX_FILES} frames at a time; the first ${MAX_FILES} are used.`);
        }
        const batch = use.slice(0, MAX_FILES);
        cancel();
        ctrl = new AbortController();
        const signal = ctrl.signal;
        els.jobs.hidden = false;
        els.jobsCount.textContent = `${batch.length} files`;
        const rows = batch.map((f) => {
            const li = doc.createElement('li');
            li.textContent = `${f.name} · waiting`;
            els.jobsList.append(li);
            return li;
        });
        els.jobsList.replaceChildren(...rows);
        void process(batch as UploadFile[], {
            signal,
            onJob: (i, stage, info) => {
                const li = rows[i];
                if (!li) {
                    return;
                }
                const step = STAGES.indexOf(stage as typeof STAGES[number]);
                li.textContent = stage === 'error' ? `${batch[i]!.name} · ${info.error ?? 'could not be read'}`
                    : `${batch[i]!.name} · ${stage}${step >= 0 ? ` (${step + 1}/${STAGES.length})` : ''}`;
                li.classList.toggle('err', stage === 'error');
            },
        }).then((s) => {
            if (signal.aborted) {
                return;
            }
            if (s.frames.length < MIN_FILES) {
                els.jobsCount.textContent = 'Stopped';
                const li = doc.createElement('li');
                li.className = 'err';
                li.textContent = `Only ${s.frames.length} frame could be read. Add at least ${MIN_FILES} frames of the same patch of sky.`;
                els.jobsList.append(li);
                return;
            }
            session = s;
            mine.index = 0;
            mine.a = 0;
            mine.b = s.frames.length - 1;
            picked = -1;
            canvas.width = s.width;
            canvas.height = s.height;
            marks.setAttribute('viewBox', `0 0 ${s.width} ${s.height}`);
            els.count.textContent = String(s.frames.length);
            const opts = s.frames.map((f, i) => `<option value="${i}">${i + 1}: ${dateText(f.date)}</option>`).join('');
            selA.innerHTML = opts;
            selB.innerHTML = opts;
            buildStrip();
            els.jobs.hidden = !s.failed.length;
            if (s.failed.length) {
                els.jobsCount.textContent = `${s.failed.length} not used`;
            }
            draw(mode);
            deps.onChange();
        }, (e: unknown) => {
            if (signal.aborted) {
                return;
            }
            const msg = e instanceof Error ? e.message : 'These files could not be processed.';
            els.jobsCount.textContent = 'Stopped';
            const li = doc.createElement('li');
            li.className = 'err';
            li.textContent = msg;
            els.jobsList.append(li);
        });
    }

    function buildStrip(): void
    {
        if (!session) {
            els.strip.replaceChildren();
            return;
        }
        const s = session;
        els.strip.replaceChildren(...s.frames.map((f, i) => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.dataset.mk = String(i);
            b.setAttribute('aria-label', `Frame ${i + 1}: ${dateText(f.date)}`);
            const c = doc.createElement('canvas');
            c.width = s.width;
            c.height = s.height;
            (c.getContext('2d') as CanvasRenderingContext2D).putImageData(render(s, i, { mode: 'blink' }) as ImageData, 0, 0);
            const sm = doc.createElement('small');
            const bb = doc.createElement('b');
            bb.textContent = dateText(f.date);
            sm.append(bb, f.name);
            b.append(c, sm);
            return b;
        }));
    }

    function pick(k: number): void
    {
        if (session && k >= 0 && k < session.frames.length) {
            mine.index = k;
            draw('blink');
            deps.onChange();
        }
    }

    function step(dir: number): void
    {
        if (!session) {
            return;
        }
        const n = session.frames.length;
        mine.index = (mine.index + dir + n) % n;
        draw('blink');
        deps.onChange();
    }

    function rough(): boolean
    {
        return !session || session.frames.some((f) => f.kind !== 'fits');
    }

    function draw(m: MineMode): void
    {
        mode = m;
        els.ab.hidden = !(session && m === 'diff');
        if (!session) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            marks.innerHTML = '';
            renderList();
            return;
        }
        selA.value = String(mine.a);
        selB.value = String(mine.b);
        const img = render(session, mine.index, m === 'diff' ? { mode: 'subtract', a: mine.a, b: mine.b } : { mode: m });
        ctx.putImageData(img as ImageData, 0, 0);
        list = m === 'diff' ? candidates(session, mine.a, mine.b, { k: 5 }) : [];
        renderMarks();
        renderList();
        renderNotes();
        els.strip.querySelectorAll<HTMLButtonElement>('[data-mk]').forEach((b, i) => {
            const on = m === 'blink' ? i === mine.index : m === 'diff' ? i === mine.a || i === mine.b : true;
            if (on && m === 'blink') {
                b.setAttribute('aria-current', 'true');
            } else {
                b.removeAttribute('aria-current');
            }
            b.toggleAttribute('data-in-sub', m === 'diff' && on);
        });
    }

    function renderMarks(): void
    {
        const w = session?.width ?? 100;
        const r = Math.max(3, w / 30);
        // The marks share the picture's pixel units, so text and outline scale with the frame's size.
        marks.style.setProperty('--fs', `${(w / 16).toFixed(2)}px`);
        marks.style.setProperty('--sw', `${(w / 220).toFixed(3)}px`);
        marks.innerHTML = list.map((c, i) => `<g class="c ${c.sign === 'fainter' ? 'f' : 'b'}${i === picked ? ' on' : ''}"><rect x="${(c.x + 0.5 - r).toFixed(1)}" y="${(c.y + 0.5 - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}" vector-effect="non-scaling-stroke"/><text x="${(c.x + 0.5 + r + 1).toFixed(1)}" y="${(c.y + 0.5 - r).toFixed(1)}">${i + 1}</text></g>`).join('');
    }

    function para(text: string, cls = 'sk-body mute'): HTMLParagraphElement
    {
        const p = doc.createElement('p');
        p.className = cls;
        p.textContent = text;
        return p;
    }

    function renderList(): void
    {
        const out: HTMLElement[] = [];
        const h = doc.createElement('h2');
        h.className = 'sk-mh';
        h.textContent = 'Candidate changes in your frames';
        out.push(h);
        if (!session) {
            out.push(para('Add your own frames with Upload, then use Subtract to list candidate changes.'));
        } else if (mode !== 'diff') {
            out.push(para('Switch to Subtract (D) to list candidate changes between frames A and B.'));
        } else if (!list.length) {
            out.push(para(`No candidates above ${rough() ? 'about 5σ (rough, display pictures)' : '5σ'} for this pair.`));
        } else {
            out.push(para('Every line is a candidate only, never a discovery: a spot to look at again, not a finding.', 'sk-body'));
            if (rough()) {
                out.push(para('These are display pictures, so the σ figures are rough: use them to choose where to look, not as measurements.'));
            }
            if ([session.shifts[mine.a], session.shifts[mine.b]].some((s) => s && !s.ok)) {
                out.push(para('One of these two frames could not be lined up, so stars can show as false orange and blue pairs.'));
            }
            if ([session.frames[mine.a], session.frames[mine.b]].some((f) => f && f.dateSource === 'file')) {
                out.push(para('A date here comes from the file, not the observation, so “later” may not be the order the sky was photographed.'));
            }
            for (const key of ['edge', 'single'] as const) {
                if (list.some((c) => candTag(c) === key)) {
                    out.push(para(CAND_TAGS[key].line));
                }
            }
            const ul = doc.createElement('div');
            ul.className = 'tb-cands';
            list.forEach((c, i) => {
                const b = doc.createElement('button');
                b.type = 'button';
                b.className = `tb-cand ${c.sign === 'fainter' ? 'f' : 'b'}${i === picked ? ' on' : ''}`;
                const n = doc.createElement('span');
                n.className = 'n';
                n.textContent = String(i + 1);
                const w = doc.createElement('span');
                w.className = 'w';
                w.textContent = `Candidate ${i + 1} · ${c.sign === 'fainter' ? 'fainter later' : 'brighter later'}`;
                const tag = candTag(c);
                if (tag) {
                    const sm = doc.createElement('small');
                    sm.textContent = CAND_TAGS[tag].tag;
                    w.append(sm);
                }
                const sg = doc.createElement('span');
                sg.className = 's';
                sg.textContent = sigmaText(c, rough());
                b.append(n, w, sg);
                b.addEventListener('click', () => {
                    picked = picked === i ? -1 : i;
                    renderMarks();
                    renderList();
                });
                ul.append(b);
            });
            out.push(ul);
        }
        els.cands.replaceChildren(...out);
    }

    function renderNotes(): void
    {
        if (!session) {
            els.notes.replaceChildren();
            return;
        }
        const f = session.frames[mine.index]!;
        const out: HTMLElement[] = [];
        const h = doc.createElement('h2');
        h.className = 'sk-mh';
        h.textContent = 'Your frame';
        const dl = doc.createElement('dl');
        const row = (k: string, v: string) => {
            const dt = doc.createElement('dt');
            dt.textContent = k;
            const dd = doc.createElement('dd');
            dd.textContent = v;
            dl.append(dt, dd);
        };
        row('File', f.name);
        row('Kind', f.kind.toUpperCase());
        row('Size', `${f.width} × ${f.height} px`);
        row('Date', `${dateText(f.date)} (${f.dateSource === 'file' ? 'from the file' : f.dateSource === 'none' ? 'none found' : `from ${f.dateSource}`})`);
        if (f.unit) {
            row('Unit', String(f.unit));
        }
        const sh = session.shifts[mine.index];
        if (sh) {
            row('Lined up', sh.ok ? `moved ${sh.dx.toFixed(2)}, ${sh.dy.toFixed(2)} px` : 'could not be lined up; shown as is');
        }
        out.push(h, dl);
        const notes = [...new Set([...f.warnings, ...session.notes])];
        if (notes.length) {
            const ul = doc.createElement('ul');
            ul.className = 'sk-notes';
            for (const n of notes) {
                const li = doc.createElement('li');
                li.textContent = n;
                ul.append(li);
            }
            out.push(ul);
        }
        out.push(para('Your files stay in this browser. They are never uploaded.'));
        els.notes.replaceChildren(...out);
    }

    function label(): string
    {
        return session ? `My frames · ${session.frames.length}` : 'My frames';
    }

    function frameText(): { frame: string; when: string }
    {
        if (!session) {
            return { frame: '', when: 'No frames yet' };
        }
        if (mode === 'stack') {
            return { frame: `${session.frames.length} frames`, when: 'averaged' };
        }
        if (mode === 'diff') {
            return { frame: `B − A`, when: `${dateText(session.frames[mine.a]!.date)} → ${dateText(session.frames[mine.b]!.date)}` };
        }
        return { frame: `Frame ${mine.index + 1} of ${session.frames.length}`, when: dateText(session.frames[mine.index]!.date) };
    }

    renderList();
    return mine;
}
