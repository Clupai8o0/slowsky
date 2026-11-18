// Slowsky revamp: shared mockup behaviour. Needs frames.js (window.FRAMES) loaded first.
// Theme: <button data-theme-toggle>. Player: new SkyPlayer(rootEl, targetId, {onChange}).

(function ()
{
    const KEY = 'slowsky-mock-theme';
    const saved = localStorage.getItem(KEY);
    if (saved) {
        document.documentElement.dataset.theme = saved;
    }
    document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-theme-toggle]');
        if (!b) {
            return;
        }
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem(KEY, next);
        document.querySelectorAll('[data-theme-toggle]').forEach((x) => x.setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'));
    });
})();

const ICONS = {
    sun: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"/></svg>',
    moon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"/></svg>',
    play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
    prev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3 5 8l5 5"/></svg>',
    next: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m6 3 5 5-5 5"/></svg>',
    search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/></svg>',
    share: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.5 9.5 9.5 6.5M7 4l1-1a3 3 0 0 1 4.2 4.2l-1 1M9 12l-1 1a3 3 0 0 1-4.2-4.2l1-1"/></svg>',
    info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2V11M8 5v.01"/></svg>',
};

// The saved PNGs as data URLs (imgdata.js), so Stack and Subtract can read pixels when the page is opened from file://.
function imgSrc(file)
{
    return (window.IMG_DATA && window.IMG_DATA[file]) || 'img/' + file;
}

class SkyPlayer
{
    constructor(root, targetId, opts = {})
    {
        this.root = root;
        this.opts = opts;
        // Two stacked layers so a new frame is decoded before it shows (no pop-in, no flash).
        root.querySelectorAll('img').forEach((x) => x.remove());
        this.layers = [0, 1].map(() => {
            const im = root.insertBefore(document.createElement('img'), root.firstChild);
            im.className = 'layer';
            im.decoding = 'async';
            return im;
        });
        this.front = 0;
        this.img = this.layers[0];
        this.fade = opts.fade ?? 180;          // ms; 0 = hard cut (best for spotting motion when blinking)
        this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.seq = 0;
        this.canvas = null;
        this.timer = null;
        this.mode = 'blink';
        this.setTarget(targetId);
    }

    setTarget(id)
    {
        this.id = id;
        this.t = window.FRAMES[id];
        this.i = this.t.visits.length - 1;
        this.cache = this.t.visits.map((v) => {
            const im = new Image();
            im.src = imgSrc(v.file);
            return im;
        });
        this.draw();
    }

    get visit() { return this.t.visits[this.i]; }

    go(i)
    {
        const n = this.t.visits.length;
        this.i = ((i % n) + n) % n;
        this.draw();
    }

    step(d) { this.go(this.i + d); }

    play(on = !this.timer)
    {
        clearInterval(this.timer);
        this.timer = null;
        if (on) {
            this.timer = setInterval(() => this.step(1), 700);
        }
        this.opts.onChange?.(this);
        return !!this.timer;
    }

    setMode(m)
    {
        this.mode = m;
        if (m !== 'blink') {
            this.play(false);
        }
        this.draw();
    }

    draw()
    {
        if (this.mode === 'blink') {
            this.show('img/' + this.visit.file, `${this.t.name}, real SPHEREx infrared frame from ${this.visit.date}`);
            if (this.canvas) {
                this.canvas.hidden = true;
            }
        } else {
            this.compose();
        }
        this.opts.onChange?.(this);
    }

    // Decode the next frame off-screen, then swap layers: fade (or cut while blinking fast). Old frame stays until the new one is ready.
    show(src, alt)
    {
        const seq = ++this.seq;
        const back = this.layers[1 - this.front];
        const slow = setTimeout(() => this.root.classList.add('loading'), 120);
        back.src = src;
        back.alt = alt;
        back.decode().catch(() => {}).then(() => {
            clearTimeout(slow);
            this.root.classList.remove('loading');
            if (seq !== this.seq) {
                return;
            }
            const cut = this.fade === 0 || (this.timer && this.opts.cutWhilePlaying !== false);
            this.root.style.setProperty('--sky-fade', (cut ? 0 : (this.reduced ? 100 : this.fade)) + 'ms');
            back.hidden = false;
            back.classList.add('on');
            this.layers[this.front].classList.remove('on');
            this.layers[this.front].setAttribute('aria-hidden', 'true');
            back.removeAttribute('aria-hidden');
            this.front = 1 - this.front;
            this.img = back;
        });
    }

    // Stack = mean of every visit; Subtract = latest minus first (blue darker, orange brighter). Mockup maths on display PNGs.
    compose()
    {
        const ready = this.cache.every((im) => im.complete && im.naturalWidth);
        if (!ready) {
            Promise.all(this.cache.map((im) => im.decode().catch(() => {}))).then(() => this.compose());
            return;
        }
        const W = this.cache[0].naturalWidth;
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
            this.img.after(this.canvas);
        }
        const c = this.canvas;
        c.width = c.height = W;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const px = this.cache.map((im) => {
            ctx.drawImage(im, 0, 0, W, W);
            return ctx.getImageData(0, 0, W, W).data;
        });
        const out = ctx.createImageData(W, W);
        for (let k = 0; k < out.data.length; k += 4) {
            if (this.mode === 'stack') {
                let s = 0;
                px.forEach((p) => { s += p[k]; });
                const v = s / px.length;
                out.data[k] = out.data[k + 1] = out.data[k + 2] = v;
            } else {
                const d = (px[px.length - 1][k] - px[0][k]) / 255;
                const a = Math.min(1, Math.abs(d) * 2.2);
                const [r, g, b] = d > 0 ? [243, 152, 58] : [92, 150, 240];
                out.data[k] = 5 + (r - 5) * a; out.data[k + 1] = 7 + (g - 7) * a; out.data[k + 2] = 13 + (b - 13) * a;
            }
            out.data[k + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
        c.hidden = false;
        c.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: this.reduced ? 1 : 220, easing: 'ease-out' });
    }
}

function icon(name) { return ICONS[name] || ''; }
