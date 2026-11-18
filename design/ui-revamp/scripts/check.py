"""Screenshot a mockup in light and dark at several widths and flag rule breaks.

Usage: python3 check.py DIR [OUT]
Flags: console errors, sideways scroll, capsule shapes (radius >= half the height on a wide box),
external requests, and whether the five targets switch and Space/arrows do something.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

d = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else d / 'shots')
out.mkdir(parents=True, exist_ok=True)
url = (d / 'index.html').as_uri()

PILLS = """() => {
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 8 || s.display === 'none' || s.visibility === 'hidden') { continue; }
    const rad = parseFloat(s.borderTopLeftRadius) || 0;
    const hasBox = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== 'none';
    if (hasBox && rad > 4.5 && !(Math.abs(r.width - r.height) < 2 && rad >= r.width / 2 - 1)) {
      bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 30)} r=${rad} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return { bad: [...new Set(bad)].slice(0, 12), hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in ('light', 'dark'):
        for w, h in ((1440, 900), (768, 1024), (390, 844)):
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if w < 800 else 1)
            ctx.add_init_script(f"localStorage.setItem('slowsky-mock-theme', '{theme}')")
            pg = ctx.new_page()
            errs, ext = [], []
            pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('request', lambda r: ext.append(r.url) if not r.url.startswith(('file:', 'data:', 'blob:')) else None)
            pg.goto(url)
            pg.wait_for_timeout(1800)
            pg.screenshot(path=str(out / f'{theme}-{w}.png'), full_page=(w != 1440))
            if w == 1440:
                pg.screenshot(path=str(out / f'{theme}-{w}-full.png'), full_page=True)
            r = pg.evaluate(PILLS)
            print(f'{theme} {w}: hscroll {r["hscroll"]}; capsules {len(r["bad"])}; errors {len(errs)}; external {len(ext)}', flush=True)
            for x in r['bad'][:6]:
                print('   capsule:', x)
            for x in errs[:6]:
                print('   error:', x[:200])
            for x in ext[:3]:
                print('   external:', x[:120])
            if theme == 'light' and w == 1440:
                pg.keyboard.press('Space')
                pg.keyboard.press('ArrowRight')
                pg.wait_for_timeout(400)
                pg.screenshot(path=str(out / 'light-1440-after-keys.png'))
                print('   after keys errors:', len(errs))
            ctx.close()
    b.close()
print('CHECK DONE')
