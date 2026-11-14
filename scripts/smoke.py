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
from urllib.parse import urlsplit

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


def is_fits_url(url):
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == "https" and parsed.hostname in {
            "nasa-irsa-spherex.s3.us-east-1.amazonaws.com",
            "nasa-irsa-spherex.s3.amazonaws.com",
        } and parsed.path.lower().endswith(".fits"))
    except ValueError:
        return False


def has_error_text(text):
    # "error bar" is the brightness curve's own wording, not a failure.
    return bool(re.search(r"failed to fetch|couldn['’]t|could not|unavailable|timed out|bad gateway|\berror\b(?!\s+bars?\b)", text, re.IGNORECASE))


def response_proof(url, status):
    try:
        path = urlsplit(url).path
        fits = path.rsplit("/", 1)[-1] if status in (200, 206, 304) and is_fits_url(url) else ""
        return fits, status in (200, 304) and path == "/api/sia"
    except ValueError:
        return "", False


def is_archive_url(url):
    try:
        parsed = urlsplit(url)
        return parsed.hostname in {"nasa-irsa-spherex.s3.us-east-1.amazonaws.com",
                                   "nasa-irsa-spherex.s3.amazonaws.com"} or parsed.path == "/api/sia"
    except ValueError:
        return False


def live_proof(status, s3_ok, sia_ok, frames, error, fits_files):
    if error:
        return "live view error: " + error[:140]
    if not status.startswith("Live:"):
        return "live status missing"
    if not s3_ok:
        return "no successful SPHEREx S3 response after Go live"
    if not sia_ok:
        return "no successful /api/sia response after Go live"
    if frames["count"] < 1:
        return "live view has no frames"
    if not is_fits_url(frames["url"]):
        return "details panel has no FITS link on nasa-irsa-spherex"
    if urlsplit(frames["url"]).path.rsplit("/", 1)[-1] not in fits_files:
        return "the FITS link shown was not read live"
    return ""


def self_test():
    cases = [
        ("regional FITS", lambda: is_fits_url("https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/dr1/a.fits?x=1")),
        ("global FITS", lambda: is_fits_url("https://nasa-irsa-spherex.s3.amazonaws.com/a.fits")),
        ("non-FITS", lambda: not is_fits_url("https://nasa-irsa-spherex.s3.amazonaws.com/a.txt")),
        ("wrong host", lambda: not is_fits_url("https://nasa-irsa-spherex.evil.example/a.fits")),
        ("wrong scheme", lambda: not is_fits_url("http://nasa-irsa-spherex.s3.amazonaws.com/a.fits")),
        ("clean text", lambda: not has_error_text("Live: archive ready")),
        ("failed fetch", lambda: has_error_text("Live: Failed to fetch")),
        ("couldn't", lambda: has_error_text("Couldn't load frame")),
        ("error", lambda: has_error_text("Live: ERROR loading frame")),
        ("error bars are not an error", lambda: not has_error_text("Each point has its own error bar. Error bars show noise.")),
        ("could not", lambda: has_error_text("COULD NOT load")),
        ("unavailable", lambda: has_error_text("Unavailable")),
        ("timed out", lambda: has_error_text("Timed Out")),
        ("bad gateway", lambda: has_error_text("Bad Gateway")),
        ("fallback is not an error", lambda: not has_error_text("Saved copy (the live archive did not answer).")),
        ("FITS 304", lambda: response_proof("https://nasa-irsa-spherex.s3.amazonaws.com/a.fits?x=1", 304) == ("a.fits", False)),
        ("FITS 200", lambda: response_proof("https://nasa-irsa-spherex.s3.amazonaws.com/a.fits", 200) == ("a.fits", False)),
        ("FITS 206", lambda: response_proof("https://nasa-irsa-spherex.s3.amazonaws.com/a.fits", 206) == ("a.fits", False)),
        ("SIA 304", lambda: response_proof("https://example.org/api/sia?x=1", 304) == ("", True)),
        ("SIA 200", lambda: response_proof("https://example.org/api/sia", 200) == ("", True)),
        ("SIA 206 rejected", lambda: response_proof("https://example.org/api/sia", 206) == ("", False)),
        ("SIA prefix rejected", lambda: response_proof("https://example.org/api/sia-extra", 200) == ("", False)),
        ("S3 non-FITS rejected", lambda: response_proof("https://nasa-irsa-spherex.s3.amazonaws.com/a.txt", 200) == ("", False)),
        ("bad response rejected", lambda: response_proof("https://nasa-irsa-spherex.s3.amazonaws.com/a.fits", 500) == ("", False)),
        ("archive host", lambda: is_archive_url("https://nasa-irsa-spherex.s3.amazonaws.com/a.txt")),
        ("archive SIA", lambda: is_archive_url("https://example.org/api/sia?x=1")),
        ("archive prefix rejected", lambda: not is_archive_url("https://example.org/api/sia-other")),
        ("archive wrong host", lambda: not is_archive_url("https://nasa-irsa-spherex.evil.example/a.fits")),
        ("live prefix needs colon", lambda: live_proof("Lively", True, True, {"count": 1, "url": "https://nasa-irsa-spherex.s3.amazonaws.com/a.fits"}, "", {"a.fits"}) == "live status missing"),
        ("shown FITS was fetched", lambda: not live_proof("Live: ready", True, True, {"count": 1, "url": "https://nasa-irsa-spherex.s3.amazonaws.com/a.fits"}, "", {"a.fits"})),
        ("shown FITS was not fetched", lambda: live_proof("Live: ready", True, True, {"count": 1, "url": "https://nasa-irsa-spherex.s3.amazonaws.com/a.fits"}, "", {"b.fits"}) == "the FITS link shown was not read live"),
        ("live proof accepts one frame", lambda: not live_proof("Live: ready", True, True, {"count": 1, "url": "https://nasa-irsa-spherex.s3.amazonaws.com/a.fits"}, "", {"a.fits"})),
        ("live proof requires status", lambda: live_proof("Saved copy", True, True, {"count": 1, "url": "https://nasa-irsa-spherex.s3.amazonaws.com/a.fits"}, "", {"a.fits"}) == "live status missing"),
        ("live proof requires S3", lambda: live_proof("Live:", False, True, {"count": 1, "url": "https://nasa-irsa-spherex.s3.amazonaws.com/a.fits"}, "", set()) == "no successful SPHEREx S3 response after Go live"),
        ("live proof requires SIA", lambda: live_proof("Live:", True, False, {"count": 1, "url": "https://nasa-irsa-spherex.s3.amazonaws.com/a.fits"}, "", {"a.fits"}) == "no successful /api/sia response after Go live"),
        ("live proof requires frames", lambda: live_proof("Live:", True, True, {"count": 0, "url": "https://nasa-irsa-spherex.s3.amazonaws.com/a.fits"}, "", {"a.fits"}) == "live view has no frames"),
        ("live proof requires FITS", lambda: live_proof("Live:", True, True, {"count": 1, "url": "https://evil.example/a.fits"}, "", {"a.fits"}) == "details panel has no FITS link on nasa-irsa-spherex"),
        ("live proof rejects errors", lambda: live_proof("Live:", True, True, {"count": 1, "url": "https://nasa-irsa-spherex.s3.amazonaws.com/a.fits"}, "error", {"a.fits"}) == "live view error: error"),
    ]
    failed = 0
    for name, check in cases:
        try:
            ok = check()
        except Exception as exc:
            ok = False
            print(f"FAIL {name}: {exc}")
        else:
            print(f"{'PASS' if ok else 'FAIL'} {name}")
        failed += not ok
    return 1 if failed else 0


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


def visible_error(pg):
    elements = pg.locator('[data-ref="err"], [role="alert"], .error, .sk-err')
    for i in range(elements.count()):
        el = elements.nth(i)
        if el.is_visible():
            return (el.inner_text().strip() or "visible error element")[:140]
    status = pg.locator('[data-bind="status"]')
    for i in range(status.count()):
        el = status.nth(i)
        if el.is_visible():
            text = el.inner_text().strip()
            if has_error_text(text):
                return text[:140]
    return ""


def wait_js(pg, expression, arg=None, timeout=5000):
    """Poll a page expression from Python.

    Playwright's own wait_for_function polls with eval() inside the page, which the site's Content Security Policy
    (no 'unsafe-eval') refuses whenever the first check is not already true. evaluate() goes through the debugger
    and is not subject to the policy, so the page is tested with its real policy in force.
    """
    deadline = time.time() + timeout / 1000
    while True:
        if pg.evaluate(expression, arg):
            return
        if time.time() >= deadline:
            raise TimeoutError(f"page condition not met within {timeout / 1000:g}s")
        pg.wait_for_timeout(50)


def pause_first_frame(pg):
    play = pg.locator('button[data-act="play"]')
    if play.get_attribute("aria-label") == "Pause":
        play.click()
    wait_js(pg, "document.querySelector('button[data-act=\"play\"]')?.getAttribute('aria-label') === 'Play'", timeout=5000)
    pg.locator('[data-ref="strip"] button').first.click()
    wait_js(pg, r"""() => {
        const label = document.querySelector('[data-bind="frame"]')?.textContent?.trim() || '';
        const match = /^Frame 1 of (\d+)/.exec(label);
        return match && document.querySelectorAll('[data-ref="strip"] button').length === Number(match[1]);
    }""", timeout=5000)
    frame = frame_now(pg)
    details = pg.evaluate("""() => {
        const d = document.querySelector('[data-ref="dl"]');
        const file = [...d.querySelectorAll('dt')].find(e => e.textContent.trim() === 'File');
        return file?.nextElementSibling?.textContent?.trim() || '';
    }""")
    dates = pg.locator('[data-ref="strip"] button').evaluate_all(
        "buttons => buttons.map(b => (b.getAttribute('aria-label') || '').replace(/^Frame \\d+:\\s*/, ''))")
    if not frame or not details or len(dates) != frame[1] or not all(dates):
        raise RuntimeError("first frame details or frame list missing")
    return {"count": frame[1], "file": details, "dates": dates, "hash": pg.evaluate(HASH_JS)}


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
    else:
        for _ in range(10):
            if pg.evaluate(HASH_JS) != h0:
                break
            time.sleep(0.3)
        else:
            fails.append("canvas pixels did not change after Next")
    if error := visible_error(pg):
        fails.append("view error after Next: " + error)


def go_live(pg, fails, live_timeout, allow_fallback):
    """From the saved copy, press Go live and require a real live read. Returns a note."""
    saved = pause_first_frame(pg)
    btn = pg.locator('[data-act="live"]')
    if btn.is_hidden():
        fails.append("Go live button is not shown on the saved copy")
        return ""
    responses = {"fits": set(), "sia": False}

    def on_response(response):
        fits, sia = response_proof(response.url, response.status)
        if fits:
            responses["fits"].add(fits)
        if sia:
            responses["sia"] = True

    def read_live():
        t0 = time.time()
        btn.click()
        status = ""
        while time.time() - t0 < live_timeout:
            time.sleep(0.5)
            status = pg.evaluate("document.querySelector('[data-bind=\"status\"]')?.textContent || ''").strip()
            if status.startswith("Saved copy") and "did not answer" in status:
                if allow_fallback:
                    return "live archive down, fell back to the saved copy (allowed): %s" % status[:100]
                break
            err = visible_error(pg)
            if err:
                fails.append("live view error: " + err[:140])
                return ""
            if status.startswith("Live:") and frame_now(pg) and responses["fits"] and responses["sia"]:
                break
        secs = time.time() - t0
        if not status.startswith("Live:"):
            fails.append("live read failed: %s" % (status[:140] or "no live status within %gs" % live_timeout))
            return ""
        now = frame_now(pg)
        if error := visible_error(pg):
            fails.append("live view error: " + error)
            return ""
        if not now or now[1] < 1:
            fails.append("live view has no frames")
            return ""
        live = pause_first_frame(pg)
        for _ in range(20):
            pix = pg.evaluate(PIXELS_JS)
            if pix and pix["distinct"] > 20 and pix["topShare"] < 0.95:
                break
            time.sleep(0.5)
        else:
            fails.append("live canvas is blank")
            return ""
        hrefs = pg.evaluate("[...document.querySelectorAll('[data-ref=\"dl\"] a')].map(a => a.href)")
        fits_url = next((href for href in hrefs if is_fits_url(href)), "")
        status = pg.evaluate("document.querySelector('[data-bind=\"status\"]')?.textContent || ''")
        reason = live_proof(status, bool(responses["fits"]), responses["sia"],
                            {"count": live["count"], "url": fits_url}, visible_error(pg), responses["fits"])
        if reason:
            fails.append(reason)
            return ""
        if saved["dates"] == live["dates"] and saved["file"] == live["file"]:
            comparison = "same frames as the saved copy"
        else:
            comparison = "%d frames, saved copy had %d" % (live["count"], saved["count"])
        return "live read %.0fs, %s" % (secs, comparison)

    pg.on("response", on_response)
    try:
        return read_live()
    finally:
        pg.remove_listener("response", on_response)


def run_target(browser, base, tid, label, click, mode, timeout, out, brk, live_timeout=90, allow_fallback=False):
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    pg = ctx.new_page()
    errs = []
    aborted = set()  # URLs this script aborted on purpose
    pg.on("pageerror", lambda e: errs.append(("pageerror: " + str(e)[:200], "")))

    def on_console(m):
        if m.type != "error":
            return
        url = (m.location or {}).get("url", "")
        if url in aborted:
            return
        if not url and mode == "offline" and re.search(r"amazonaws\.com|/api/", m.text):
            return  # app-level log of a fetch we aborted (no URL attached)
        urls = [url] + re.findall(r"https?://[^\s\"'<>]+", m.text)
        archive_url = next((candidate for candidate in urls if is_archive_url(candidate)), "")
        errs.append(("console: " + m.text[:150] + (" (" + url[:100] + ")" if url else ""), archive_url))
    pg.on("console", on_console)

    def on_failed(r):
        if r.url not in aborted and not (mode == "live" and "ERR_ABORTED" in str(r.failure)):  # the page cancelling its own reads
            errs.append(("request failed: ..." + r.url[-50:] + " " + str(r.failure), r.url))
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
            wait_js(pg, "document.querySelector('[data-ref=\"dl\"]')?.textContent.includes('File')", timeout=timeout * 1000)
            old = pg.evaluate("document.querySelector('[data-ref=\"dl\"]').textContent")
            pg.locator(tsel + ":visible").first.click()
        try:
            wait_js(pg, "(s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true'", arg=tsel, timeout=timeout * 1000)
            if click:  # the load finished: details now describe a different file than the previous target's
                wait_js(pg, "(o) => document.querySelector('[data-ref=\"dl\"]').textContent !== o", arg=old, timeout=timeout * 1000)
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
        if error := visible_error(pg):
            fails.append("view error: " + error)
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
            if mode == "offline" and not snapshot:
                fails.append("page does not say it shows the offline snapshot")
            if mode == "live":
                if not fails:
                    note = go_live(pg, fails, live_timeout, allow_fallback)
            else:
                note = "snapshot"
            current = frame_now(pg)
            if not fails and current and current[1] >= 2:
                pause_and_step(pg, fails)
        fallback = mode == "live" and allow_fallback and note.startswith("live archive down, fell back")
        remaining = [message for message, url in errs if not (fallback and is_archive_url(url))]
        if remaining:
            fails.append("; ".join(remaining[:3]))
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
    ap.add_argument("--self-test", action="store_true", help="test pure checks without a browser")
    ap.add_argument("--base")
    ap.add_argument("--mode", choices=["offline", "live", "both"], default="offline")
    ap.add_argument("--out")
    ap.add_argument("--timeout", type=float, default=60)
    ap.add_argument("--live-timeout", type=float, default=90, help="seconds for a live read after Go live")
    ap.add_argument("--allow-fallback", action="store_true", help="live mode: a fallback to the saved copy passes with a note")
    ap.add_argument("--break", dest="brk", choices=["snapshot", "target", "next", "live"], help=argparse.SUPPRESS)
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    from playwright.sync_api import sync_playwright
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
