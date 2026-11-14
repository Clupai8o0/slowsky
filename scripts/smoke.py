#!/usr/bin/env python3
"""Browser smoke test for Slowsky. Exit 0 only if every check passed.

  python scripts/smoke.py [--base URL] [--mode offline|live|both] [--out DIR] [--timeout SECONDS]

Needs Playwright for Python with Chromium installed. No --base: builds, serves dist/ with
`vite preview` on a free port from 5210 and stops that server by PID on every exit path.
"""
import argparse
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = [  # (id, button name, needs click)
    ("barnard", "Barnard", False),
    ("rwaur", "RW Aurigae", True),
    ("epsindb", "Epsilon Indi B", True),
    ("wise0855", "WISE 0855", True),
    ("rdra", "R Draconis", True),
]
PIXELS_JS = """() => {
  const c = document.querySelector('canvas[data-ref="canvas"]');
  if (!c || !c.width || !c.height) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const counts = new Map();
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const k = (d[i] << 24) ^ (d[i + 1] << 16) ^ (d[i + 2] << 8) ^ d[i + 3];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let top = 0;
  for (const v of counts.values()) { if (v > top) top = v; }
  return {distinct: counts.size, topShare: top / n};
}"""
BUILD_TIMEOUT = 300
FRAME_RE = re.compile(r"Frame (\d+) of (\d+)")


def free_port(start=5210):
    for p in range(start, start + 200):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    raise RuntimeError("no free port")


class Server:
    proc = None
    build = None

    @staticmethod
    def kill_group(p):
        if p and p.poll() is None:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:  # a process we started, in its own session: by group, never by name
                    os.killpg(p.pid, sig)
                    p.wait(timeout=5)
                    return
                except subprocess.TimeoutExpired:
                    continue
                except Exception:
                    return

    def start(self):
        self.build = subprocess.Popen(["npm", "run", "build"], cwd=ROOT, stdout=subprocess.PIPE,
                                      stderr=subprocess.STDOUT, text=True, start_new_session=True)
        try:
            outp, _ = self.build.communicate(timeout=BUILD_TIMEOUT)
        except subprocess.TimeoutExpired:
            self.kill_group(self.build)
            raise RuntimeError("npm run build timed out after %d s" % BUILD_TIMEOUT)
        if self.build.returncode != 0:
            print((outp or "")[-1500:])
            raise RuntimeError("npm run build failed")
        port = free_port()
        self.proc = subprocess.Popen(
            ["npx", "vite", "preview", "--port", str(port), "--strictPort", "--host", "127.0.0.1"],
            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        print(f"server pid {self.proc.pid} port {port}", flush=True)
        base = f"http://127.0.0.1:{port}/"
        t0 = time.time()
        while time.time() - t0 < 30:
            if self.proc.poll() is not None:
                raise RuntimeError("vite preview exited early")
            if socket.socket().connect_ex(("127.0.0.1", port)) == 0:
                return base
            time.sleep(0.3)
        raise RuntimeError("preview server did not start")

    def stop(self):
        p, self.proc = self.proc, None
        self.kill_group(p)
        self.kill_group(self.build)


def page_texts(pg):
    return pg.inner_text("body")


HASH_JS = """() => {
  const c = document.querySelector('canvas[data-ref="canvas"]');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) { h = Math.imul(h ^ d[i], 16777619) >>> 0; }
  return h;
}"""


def frame_now(pg):
    m = FRAME_RE.search(pg.evaluate("document.querySelector('[data-bind=\"frame\"]')?.textContent || ''"))
    return (int(m.group(1)), int(m.group(2))) if m else None


def pause_and_step(pg, fails):
    play = pg.locator('button[data-act="play"]')
    if play.get_attribute("aria-label") == "Pause":
        play.click()
    time.sleep(0.5)
    if play.get_attribute("aria-label") != "Play":
        fails.append("could not pause playback")
        return
    a = frame_now(pg)
    time.sleep(1.5)
    if frame_now(pg) != a:
        fails.append("frame changes while paused")
        return
    h0 = pg.evaluate(HASH_JS)
    pg.locator('button[data-act="next"]').click()
    want = a[0] + 1 if a[0] < a[1] else 1
    ok = False
    for _ in range(15):
        time.sleep(0.3)
        b = frame_now(pg)
        if b and b[0] == want:
            ok = True
            break
    if not ok:
        fails.append("Next did not go to frame %d (was %d of %d)" % (want, a[0], a[1]))
        return
    for _ in range(10):
        if pg.evaluate(HASH_JS) != h0:
            return
        time.sleep(0.3)
    fails.append("canvas pixels did not change after Next")


def go_live(pg, fails, live_timeout, allow_fallback):
    """From the saved copy, press Go live and require a real live read. Returns a note."""
    play = pg.locator('button[data-act="play"]')
    if play.get_attribute("aria-label") == "Pause":
        play.click()
    time.sleep(0.5)
    saved = frame_now(pg)
    saved_hash = pg.evaluate(HASH_JS)
    btn = pg.locator('[data-act="live"]')
    if btn.is_hidden():
        fails.append("Go live button is not shown on the saved copy")
        return ""
    t0 = time.time()
    btn.click()
    status = ""
    while time.time() - t0 < live_timeout:
        time.sleep(0.5)
        status = pg.evaluate("document.querySelector('[data-bind=\"status\"]')?.textContent || ''")
        err = pg.evaluate("(() => { const e = document.querySelector('[data-ref=\"err\"]'); return e && !e.hidden ? e.textContent : ''; })()")
        if status.startswith("Live:") and frame_now(pg):
            break
        if err or "did not answer" in status:
            status = (err or status).strip()
            break
    secs = time.time() - t0
    if not status.startswith("Live:"):
        if allow_fallback:
            return "live archive down, fell back to the saved copy (allowed): %s" % status[:100]
        fails.append("live read failed: %s" % (status[:140] or "no live status within %gs" % live_timeout))
        return ""
    now = frame_now(pg)
    if not now or now[1] < 2:
        fails.append("live view has fewer than 2 frames (%s)" % (now,))
        return ""
    play = pg.locator('button[data-act="play"]')
    if play.get_attribute("aria-label") == "Pause":
        play.click()
        time.sleep(0.5)
    if now[1] == saved[1] and pg.evaluate(HASH_JS) == saved_hash:
        fails.append("live view looks identical to the saved copy (same frame count and pixels)")
    hrefs = pg.evaluate("[...document.querySelectorAll('[data-ref=\"dl\"] a')].map(a => a.href)")
    if not any("nasa-irsa-spherex" in h and h.lower().split("?")[0].endswith(".fits") or "nasa-irsa-spherex" in h for h in hrefs):
        fails.append("details panel has no FITS link on nasa-irsa-spherex (%s)" % hrefs[:2])
    return "live read %.0fs, %d frames (saved copy had %d)" % (secs, now[1], saved[1])


def run_target(browser, base, tid, label, click, mode, timeout, out, brk, live_timeout=90, allow_fallback=False):
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    pg = ctx.new_page()
    errs = []
    aborted = set()  # URLs this script aborted on purpose
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:200]))

    def on_console(m):
        if m.type != "error":
            return
        url = (m.location or {}).get("url", "")
        if url in aborted:
            return
        if not url and mode == "offline" and re.search(r"amazonaws\.com|/api/", m.text):
            return  # app-level log of a fetch we aborted (no URL attached)
        errs.append("console: " + m.text[:150] + (" (" + url[:100] + ")" if url else ""))
    pg.on("console", on_console)

    def on_failed(r):
        if r.url not in aborted and not (mode == "live" and "ERR_ABORTED" in str(r.failure)):  # the page cancelling its own reads
            errs.append("request failed: ..." + r.url[-50:] + " " + str(r.failure))
    pg.on("requestfailed", on_failed)

    def abort(r):
        aborted.add(r.request.url)
        r.abort()
    if mode == "offline":
        pg.route(re.compile(r".*(amazonaws\.com|/api/).*"), abort)
    if brk == "snapshot":
        pg.route("**/snapshot/**", abort)
    if brk == "live":
        pg.route(re.compile(r".*(/api/sia|amazonaws\.com).*"), abort)
    if brk in ("target", "next"):
        sel = "[data-target]" if brk == "target" else '[data-act="next"]'
        pg.add_init_script("document.addEventListener('click', e => { if (e.target.closest('%s')) "
                           "{ e.stopImmediatePropagation(); e.preventDefault(); } }, true);" % sel)
    t0 = time.time()
    fails = []
    note = ""
    got = None
    try:
        pg.goto(base, wait_until="load")
        tsel = f'button[data-target="{tid}"]'
        pg.locator(tsel + ":visible").first.wait_for(timeout=15000)
        if click:
            pg.wait_for_function("document.querySelector('[data-ref=\"dl\"]')?.textContent.includes('File')", timeout=timeout * 1000)
            old = pg.evaluate("document.querySelector('[data-ref=\"dl\"]').textContent")
            pg.locator(tsel + ":visible").first.click()
        try:
            pg.wait_for_function("(s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true'", arg=tsel, timeout=timeout * 1000)
            if click:  # the load finished: details now describe a different file than the previous target's
                pg.wait_for_function("(o) => document.querySelector('[data-ref=\"dl\"]').textContent !== o", arg=old, timeout=timeout * 1000)
        except Exception:
            raise RuntimeError(f"target {tid} did not become selected/loaded within {timeout:g}s")
        deadline = time.time() + timeout
        while time.time() < deadline:
            txt = page_texts(pg)
            m = FRAME_RE.search(pg.evaluate("document.querySelector('[data-bind=\"frame\"]')?.textContent || ''"))
            if m and int(m.group(2)) >= 2 and re.search(r"Live:|Saved copy|Offline", txt):
                got = m
                break
            time.sleep(0.4)
        txt = page_texts(pg)
        if not got:
            fails.append("no 'Frame N of M' (M>=2) within %ds" % timeout)
        else:
            pix = None
            for _ in range(20):  # frame may take a moment to paint
                pix = pg.evaluate(PIXELS_JS)
                if pix and pix["distinct"] > 20 and pix["topShare"] < 0.95:
                    break
                time.sleep(0.5)
            if not pix:
                fails.append("no canvas")
            elif pix["distinct"] <= 20 or pix["topShare"] >= 0.95:
                fails.append("blank canvas (distinct=%d, top=%.0f%%)" % (pix["distinct"], pix["topShare"] * 100))
            snapshot = bool(re.search(r"Saved copy", txt))
            live = "Live:" in txt
            if mode == "offline" and not snapshot:
                fails.append("page does not say it shows the offline snapshot")
            if mode == "live":
                note = go_live(pg, fails, live_timeout, allow_fallback)
            else:
                note = "snapshot"
            if not fails:
                pause_and_step(pg, fails)
        if errs:
            fails.append("; ".join(errs[:3]))
    except Exception as e:
        fails.append("exception: " + str(e).splitlines()[0][:200])
    try:
        pg.screenshot(path=os.path.join(out, f"{mode}-{tid}.png"))
    except Exception:
        pass
    ctx.close()
    ok = not fails
    msg = "; ".join(fails) if fails else note
    print(f"{'PASS' if ok else 'FAIL'} {tid} {mode} {time.time() - t0:.1f}s {msg}", flush=True)
    return ok


def run_page_checks(browser, base, out):
    ok = True
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    pg = ctx.new_page()
    fails = []
    t0 = time.time()
    try:
        pg.goto(base, wait_until="load")
        if not pg.title().strip():
            fails.append("document has no title")
        for w, h in ((1280, 860), (390, 844)):
            pg.set_viewport_size({"width": w, "height": h})
            time.sleep(0.5)
            over = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if over > 0:
                fails.append(f"horizontal scroll {over}px at {w}x{h}")
        bad = pg.evaluate("""() => [...document.querySelectorAll('button')].filter(b => {
            const r = b.getBoundingClientRect(), s = getComputedStyle(b);
            if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none' || b.closest('[hidden]')) return false;
            const name = (b.getAttribute('aria-label') || b.getAttribute('aria-labelledby') || b.innerText || b.title || '').trim();
            return !name;
        }).map(b => b.outerHTML.slice(0, 80))""")
        if bad:
            fails.append("buttons without a name: " + " | ".join(bad[:3]))
    except Exception as e:
        fails.append("exception: " + str(e).splitlines()[0][:200])
    ctx.close()
    print(f"{'PASS' if not fails else 'FAIL'} page-checks - {time.time() - t0:.1f}s {'; '.join(fails)}", flush=True)
    return not fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base")
    ap.add_argument("--mode", choices=["offline", "live", "both"], default="offline")
    ap.add_argument("--out")
    ap.add_argument("--timeout", type=float, default=60)
    ap.add_argument("--live-timeout", type=float, default=90, help="seconds for a live read after Go live")
    ap.add_argument("--allow-fallback", action="store_true", help="live mode: a fallback to the saved copy passes with a note")
    ap.add_argument("--break", dest="brk", choices=["snapshot", "target", "next", "live"], help=argparse.SUPPRESS)
    a = ap.parse_args()
    out = a.out or tempfile.mkdtemp(prefix="slowsky-smoke-")
    os.makedirs(out, exist_ok=True)
    server = Server()

    def bye(signum, frame):
        server.stop()
        print("SMOKE FAIL: interrupted", flush=True)
        os._exit(1)
    signal.signal(signal.SIGTERM, bye)
    signal.signal(signal.SIGINT, bye)
    failed = 0
    try:
        base = a.base or server.start()
        if not base.endswith("/"):
            base += "/"
        modes = ["offline", "live"] if a.mode == "both" else [a.mode]
        with sync_playwright() as p:
            browser = p.chromium.launch()
            if not run_page_checks(browser, base, out):
                failed += 1
            for mode in modes:
                timeout = a.timeout
                for tid, label, click in TARGETS:
                    if not run_target(browser, base, tid, label, click, mode, timeout, out, a.brk, a.live_timeout, a.allow_fallback):
                        failed += 1
            browser.close()
        print(f"screenshots: {out}")
    except Exception as e:
        print(f"FAIL setup {e}")
        failed += 1
    finally:
        server.stop()
    print("SMOKE PASS" if failed == 0 else f"SMOKE FAIL: {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
