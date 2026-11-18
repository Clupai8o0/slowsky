#!/usr/bin/env python3
"""Capture the real Slowsky page for the film: public/ui/*.png and public/ui/manifest.json.

Run after any product layout change; the scenes read the boxes from the manifest, so no code change is needed:

    /opt/anaconda3/bin/python3 scripts/capture_ui.py [BASE]      # BASE defaults to http://localhost:5199

Also takes a "playing" set (PLAYING targets): the page's own player running, a shot per frame (see playing_set).

Everything is found by selector (data-act, data-mode, data-target, data-bind, data-ref), never by coordinates.
Clicks are sent from JS (element.click()) so no hover or focus state shows that a user would not see. The script
exits 1 with a message when a selector is missing or a state cannot be reached, instead of writing a wrong picture.
"""
import asyncio
import json
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5199").rstrip("/")
OUT = Path(__file__).resolve().parent.parent / "public" / "ui"

# desk: 1920x1080 at scale 1, as asked; desk2x: the same layout at scale 2, so camera moves never enlarge past
# 100% of a capture's pixels; phone: 390 wide at scale 3, 900 tall (r6, v0.3.2: the new Gaia note pushed the
# thumbnail strip and its labels below an 844 px view; film-c s7 crops above the status row from the manifest).
VIEWPORTS = {
    "desk": {"width": 1920, "height": 1080, "dsf": 1, "mobile": False},
    "desk2x": {"width": 1920, "height": 1080, "dsf": 2, "mobile": False},
    "phone": {"width": 390, "height": 900, "dsf": 3, "mobile": True},
}
TARGETS = ["barnard", "rwaur", "wise"]  # film keys; "wise" matches the page's id that starts with "wise"
PLAYING = ["barnard"]  # targets that also get a set shot while the page plays (film-c: s3 and s7)

SEL = {
    "picture": '[data-ref="sky"]',
    "frame": '[data-bind="frame"]',
    "status": ".sk-status",
    "targets": '[data-target]',
    "prev": '[data-act="prev"]',
    "play": '[data-act="play"]',
    "next": '[data-act="next"]',
    "gaia": '[data-act="gaia"]',
}
FRAME_RE = re.compile(r"Frame\s+(\d+)\s+of\s+(\d+)")


def die(msg):
    print(f"capture_ui: {msg}", file=sys.stderr)
    sys.exit(1)


async def box(page, sel):
    el = page.locator(sel).first
    if await el.count() == 0:
        die(f"selector {sel!r} is missing on {page.url}")
    b = await el.bounding_box()
    if not b or b["width"] < 1 or b["height"] < 1:
        die(f"selector {sel!r} has no visible box on {page.url}")
    return {k: round(b[k], 2) for k in ("x", "y", "width", "height")}


async def union(page, sel):
    boxes = await page.evaluate(
        """(sel) => [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect())
             .filter(r => r.width > 0 && r.height > 0).map(r => [r.left, r.top, r.right, r.bottom])""",
        sel,
    )
    if not boxes:
        die(f"selector {sel!r} has no visible element on {page.url}")
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes)
    y1 = max(b[3] for b in boxes)
    return {"x": round(x0, 2), "y": round(y0, 2), "width": round(x1 - x0, 2), "height": round(y1 - y0, 2)}


async def js_click(page, sel):
    el = page.locator(sel).first
    if await el.count() == 0:
        die(f"selector {sel!r} is missing on {page.url}")
    await el.evaluate("e => e.click()")


async def idle(page):
    """Wait until the page has loaded its frames and painted them."""
    await page.wait_for_load_state("networkidle")
    try:
        await page.wait_for_function(
            """() => {
                const app = document.getElementById('app');
                const lbl = document.querySelector('[data-bind="frame"]');
                // Blink reads 'Frame N of M'; Stack and Subtract read their own label ('Average of 3', 'B − A')
                const want = app && app.dataset.mode === 'blink' ? /Frame\\s+\\d+\\s+of\\s+\\d+/ : /\\S/;
                return app && !app.dataset.loading && lbl && want.test(lbl.textContent);
            }""",
            timeout=60000,
        )
    except Exception:
        die(f"page never finished loading (data-loading set, or no frame label) on {page.url}")
    await page.evaluate("() => document.fonts.ready")
    # two animation frames so the canvas and the overlay have drawn the current state
    await page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    await page.wait_for_timeout(250)


async def frame_label(page):
    t = (await page.locator(SEL["frame"]).first.text_content() or "").strip()
    m = FRAME_RE.search(t)
    if not m:
        die(f"frame label reads {t!r}, not 'Frame N of M'")
    return t, int(m.group(1)), int(m.group(2))


async def pause(page):
    lbl = await page.locator(SEL["play"]).first.get_attribute("aria-label")
    if lbl and lbl.lower().startswith("pause"):
        await js_click(page, SEL["play"])
    await page.wait_for_timeout(150)
    lbl = await page.locator(SEL["play"]).first.get_attribute("aria-label")
    if not lbl or lbl.lower().startswith("pause"):
        die(f"could not pause playback (play button says {lbl!r})")


async def ensure_mode(page, mode):
    sel = f'button[data-mode="{mode}"]'
    if await page.locator(sel).count() == 0:
        die(f"no mode button {sel}")
    if await page.locator(sel).first.get_attribute("aria-pressed") != "true":
        await js_click(page, sel)
        await idle(page)
    if await page.locator(sel).first.get_attribute("aria-pressed") != "true":
        die(f"mode {mode} did not switch on")


async def ensure_gaia(page):
    on = await page.evaluate("() => document.getElementById('app')?.dataset.gaia")
    if on != "true":
        await js_click(page, SEL["gaia"])
        await idle(page)
    on = await page.evaluate("() => document.getElementById('app')?.dataset.gaia")
    if on != "true":
        die("the Gaia overlay did not switch on")


async def step_to(page, want):
    """Step with the next control until the label reads 'Frame want of M'; confirm every change."""
    _, cur, n = await frame_label(page)
    for _ in range(n + 1):
        if cur == want:
            return
        before = (await frame_label(page))[0]
        await js_click(page, SEL["next"])
        try:
            await page.wait_for_function(
                "(b) => document.querySelector('[data-bind=\"frame\"]').textContent.trim() !== b", arg=before, timeout=5000
            )
        except Exception:
            die(f"the frame label did not change after 'next' (still {before!r})")
        await idle(page)
        _, cur, n = await frame_label(page)
    die(f"could not reach frame {want}")


async def play(page):
    """Press the page's own play control (if it is not already playing) and confirm it shows its pause state."""
    lbl = await page.locator(SEL["play"]).first.get_attribute("aria-label")
    if not lbl or not lbl.lower().startswith("pause"):
        await js_click(page, SEL["play"])
    await page.wait_for_timeout(150)
    lbl = await page.locator(SEL["play"]).first.get_attribute("aria-label")
    if not lbl or not lbl.lower().startswith("pause"):
        die(f"could not start playback (play button says {lbl!r})")


async def playing_set(browser, vp, key, tid, default):
    """The blink as it really plays: the page's own player runs (its control shows Pause) and each shot is taken
    right after the 'Frame N of M' label changes to the next frame. A full 2x screenshot takes longer than one
    player frame, so this page runs on Playwright's clock: time flows normally while the page loads and plays,
    then is held still while each shot is taken and moved on in small steps between shots. The page is never
    paused, stepped or redrawn by hand; the label and the control are checked again after every shot."""
    # its own context: Playwright's clock belongs to the whole context, so it must not freeze the main page
    v = VIEWPORTS[vp]
    ctx = await browser.new_context(
        viewport={"width": v["width"], "height": v["height"]},
        device_scale_factor=v["dsf"],
        is_mobile=v["mobile"],
        has_touch=v["mobile"],
        reduced_motion="no-preference",
    )
    page = await ctx.new_page()
    await page.clock.install()
    await open_target(page, tid, default)
    await ensure_mode(page, "blink")
    await ensure_gaia(page)
    await play(page)
    y = await scroll_to_sky(page, vp)
    now = await page.evaluate("() => Date.now()")
    await page.clock.pause_at(now + 20)
    _, _, n = await frame_label(page)
    prev = (await frame_label(page))[0]
    got = {}
    period = []
    for _ in range(n * 3):
        if len(got) == n:
            break
        for step in range(400):  # up to 10 s of page time
            await page.clock.run_for(25)
            label = (await frame_label(page))[0]
            if label != prev:
                break
        else:
            die(f"the frame label did not change while playing (still {prev!r})")
        period.append((step + 1) * 25)
        await page.clock.run_for(40)  # let the canvas and the overlay draw the frame the label names
        label, i, _ = await frame_label(page)
        prev = label
        if i in got:
            continue
        e = await shot(page, f"{vp}_{key}_play{i}", vp, y, {"playing": True})
        after = (await frame_label(page))[0]
        state = await page.locator(SEL["play"]).first.get_attribute("aria-label")
        if after != label or e["frameLabel"] != label or not state or not state.lower().startswith("pause"):
            die(f"{vp}_{key}_play{i}: the page changed during the shot ({label!r} -> {after!r}, control {state!r})")
        e["playLabel"] = state
        got[i] = e
    if len(got) != n:
        die(f"could not take every frame of {vp}_{key} while playing (got {sorted(got)})")
    await ctx.close()
    # the player's own frame time (ms), measured on the page clock; the first wait is partial, so skip it
    ms = sorted(period[1:])[len(period[1:]) // 2] if len(period) > 1 else None
    return [got[i] for i in range(1, n + 1)], ms


async def boxes(page, scroll_y):
    out = {
        "picture": await box(page, SEL["picture"]),
        "transport": await union(page, f'{SEL["prev"]}, {SEL["play"]}, {SEL["next"]}'),
        "targets": await union(page, SEL["targets"]),
        "status": await box(page, SEL["status"]),
        "frameLabel": await box(page, SEL["frame"]),
    }
    # the page's own wordmark, if the layout still has one (the film's title lands on it); optional
    if await page.locator(".sk-word").count() > 0:
        b = await page.locator(".sk-word").first.bounding_box()
        if b and b["width"] > 0:
            out["brand"] = {k: round(b[k], 2) for k in ("x", "y", "width", "height")}
    # the Gaia legend line (the ring key beside the picture), if visible; optional
    g = page.locator(SEL["gaia"]).first
    if await g.count() > 0:
        b = await g.bounding_box()
        if b and b["width"] > 0:
            out["gaia"] = {k: round(b[k], 2) for k in ("x", "y", "width", "height")}
    # the read-out line (frame label + date, `.sk-read`) and the whole Gaia key (toggle + its "Gaia DR3" source
    # link, `.sk-gk`), so the film's crops of them end where the page's own text ends; optional (14 Nov r3)
    for name, sel in (("readout", ".sk-read"), ("gaiaKey", ".sk-gk")):
        el = page.locator(sel).first
        if await el.count() > 0:
            b = await el.bounding_box()
            if b and b["width"] > 0:
                out[name] = {k: round(b[k], 2) for k in ("x", "y", "width", "height")}
    # the target buttons one by one, by id, for pointing at one of them
    out["targetButtons"] = await page.evaluate(
        """() => Object.fromEntries([...document.querySelectorAll('[data-target]')].map(e => {
            const r = e.getBoundingClientRect();
            return [e.dataset.target, {x: r.x, y: r.y, width: r.width, height: r.height}];
        }))"""
    )
    # boxes are in the screenshot's CSS pixels (multiply by dsf for image pixels)
    return out


async def shot(page, name, vp, scroll_y, extra=None):
    path = OUT / f"{name}.png"
    await page.screenshot(path=str(path))
    label = (await page.locator(SEL["frame"]).first.text_content() or "").strip()
    if not label:
        die(f"empty frame label for {name}")
    entry = {
        "file": f"ui/{name}.png",
        "viewport": {"width": VIEWPORTS[vp]["width"], "height": VIEWPORTS[vp]["height"], "dsf": VIEWPORTS[vp]["dsf"]},
        "scrollY": scroll_y,
        "boxes": await boxes(page, scroll_y),
        "frameLabel": label,
    }
    if extra:
        entry.update(extra)
    print(f"  {name}: {label}")
    return entry


async def scroll_to_sky(page, vp):
    """Phone: scroll so the picture's module sits at the top of the screen, as 'Skip to the sky' does."""
    if not VIEWPORTS[vp]["mobile"]:
        return 0
    await page.evaluate(
        """() => {
            const h = document.getElementById('sk-h2') || document.querySelector('[data-ref="sky"]');
            const y = h.getBoundingClientRect().top + window.scrollY - 12;
            window.scrollTo(0, Math.max(0, y));
        }"""
    )
    await page.wait_for_timeout(300)
    return await page.evaluate("() => window.scrollY")


async def target_ids(page):
    ids = await page.evaluate("() => [...document.querySelectorAll('[data-target]')].map(e => e.dataset.target)")
    found = {}
    for key in TARGETS:
        hit = [i for i in ids if i == key or (key == "wise" and i.startswith("wise"))]
        if not hit:
            die(f"no target button for {key!r} (page has {ids})")
        found[key] = hit[0]
    return found


async def open_target(page, tid, default):
    url = f"{BASE}/" if tid == default else f"{BASE}/?t={tid}"
    await page.goto(url, wait_until="networkidle")
    await idle(page)
    pressed = await page.evaluate(
        "(t) => document.querySelector(`[data-target=\"${t}\"]`)?.getAttribute('aria-pressed')", tid
    )
    if pressed != "true":
        die(f"{url} did not open target {tid}")


async def run_viewport(browser, vp, manifest):
    v = VIEWPORTS[vp]
    ctx = await browser.new_context(
        viewport={"width": v["width"], "height": v["height"]},
        device_scale_factor=v["dsf"],
        is_mobile=v["mobile"],
        has_touch=v["mobile"],
        reduced_motion="no-preference",
    )
    page = await ctx.new_page()
    await page.goto(f"{BASE}/", wait_until="networkidle")
    await idle(page)
    ids = await target_ids(page)
    default = await page.evaluate("() => document.querySelector('[data-target][aria-pressed=\"true\"]')?.dataset.target")
    print(f"{vp}: targets {ids}, default {default}")

    for key, tid in ids.items():
        await open_target(page, tid, default)
        await ensure_mode(page, "blink")
        await ensure_gaia(page)
        await pause(page)
        _, _, n = await frame_label(page)
        await step_to(page, 1)
        y = await scroll_to_sky(page, vp)
        frames = []
        for i in range(1, n + 1):
            await step_to(page, i)
            e = await shot(page, f"{vp}_{key}_f{i}", vp, y)
            # the picture alone, crisp, from the same state
            pic = OUT / f"{vp}_{key}_pic{i}.png"
            await page.locator(SEL["picture"]).first.screenshot(path=str(pic))
            e["picture"] = f"ui/{pic.name}"
            frames.append(e)
        full = OUT / f"{vp}_{key}_page.png"
        await page.screenshot(path=str(full), full_page=True)
        manifest["captures"][f"{vp}_{key}"] = {"target": tid, "frames": frames, "fullPage": f"ui/{full.name}"}
        if key in PLAYING:
            # the same state, but with the page's player running (the film shows these wherever the picture
            # blinks with the transport in view, so the control shows its pause state, as it did)
            pf, ms = await playing_set(browser, vp, key, tid, default)
            manifest["captures"][f"{vp}_{key}_playing"] = {
                "target": tid, "frames": pf, "fullPage": f"ui/{full.name}", "frameMs": ms,
            }

    if not v["mobile"]:
        # Stack and Subtract for Barnard's Star, and the page just after switching to RW Aurigae.
        await open_target(page, ids["barnard"], default)
        await ensure_gaia(page)
        await pause(page)
        for mode, label in (("stack", "stack"), ("diff", "subtract")):
            await ensure_mode(page, mode)
            manifest["captures"][f"{vp}_barnard_{label}"] = await shot(page, f"{vp}_barnard_{label}", vp, 0, {"mode": mode})
        await ensure_mode(page, "blink")
        await js_click(page, f'[data-target="{ids["rwaur"]}"]')
        await page.wait_for_timeout(100)
        await idle(page)
        pressed = await page.evaluate(
            "(t) => document.querySelector(`[data-target=\"${t}\"]`)?.getAttribute('aria-pressed')", ids["rwaur"]
        )
        if pressed != "true":
            die("clicking RW Aurigae did not switch the target")
        manifest["captures"][f"{vp}_switch_rwaur"] = await shot(page, f"{vp}_switch_rwaur", vp, 0, {"from": ids["barnard"]})
    await ctx.close()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"base": BASE, "captures": {}}
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            for vp in VIEWPORTS:
                await run_viewport(browser, vp, manifest)
        finally:
            await browser.close()
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"wrote {OUT / 'manifest.json'} ({len(manifest['captures'])} captures)")


if __name__ == "__main__":
    asyncio.run(main())
