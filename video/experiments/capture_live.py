"""Capture live Slowsky frames from the public site for the film (replaces the research stand-ins).

For each target: a full-UI shot (overlays as shipped), and every frame of the sky view with Gaia rings off.
Run: /opt/anaconda3/bin/python video/experiments/capture_live.py
"""
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "https://slowsky.vercel.app"
OUT = Path(__file__).resolve().parents[1] / "slowsky-film" / "public" / "live"
TARGETS = {"barnard": "Barnard", "rwaur": "RW Aurigae", "epsindib": "Epsilon Indi",
           "wise": "WISE 0855", "rdra": "R Draconis"}
SKY = {"x": 392, "y": 140, "width": 784, "height": 784}  # sky view at 1920x1080


def frame_count(page):
    m = re.search(r"Frame \d+ of (\d+)", page.inner_text("body"))
    return int(m.group(1)) if m else 1


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(3000)
        for key, label in TARGETS.items():
            page.locator(f"text=/^{label}/ >> visible=true").first.click()
            page.wait_for_timeout(5000)
            page.mouse.click(1357, 162)  # pause the blink
            page.wait_for_timeout(800)
            page.screenshot(path=str(OUT / f"ui_{key}.png"))
            gaia = page.get_by_label(re.compile("Brightest Gaia", re.I))
            try:
                if gaia.is_checked():
                    gaia.uncheck()
            except Exception as e:
                print(key, "gaia toggle:", e, file=sys.stderr)
            # step with "next" until the view comes back to the first frame (the frame label was unreliable)
            seen, n = [], 0
            for i in range(8):
                page.wait_for_timeout(1500)
                png = page.screenshot(clip=SKY)
                if png in seen:
                    break
                seen.append(png)
                (OUT / f"{key}_{i}.png").write_bytes(png)
                n += 1
                page.mouse.click(1467, 162)  # next frame
            try:
                gaia.check()
            except Exception:
                pass
            print(key, n, "frames")
        b.close()


if __name__ == "__main__":
    main()
