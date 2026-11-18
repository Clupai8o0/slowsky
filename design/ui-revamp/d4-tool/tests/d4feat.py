import sys
from playwright.sync_api import sync_playwright
from pathlib import Path
u = Path('index.html').resolve().as_uri(); S = '/tmp/d4shots'
WATCH = """
window.__marks = [];
new MutationObserver((ms) => { for (const m of ms) { const t = m.target; if (m.attributeName === 'class') {
  if (t.id === 'stage-load' && t.classList.contains('on')) window.__marks.push('stage:' + (document.getElementById('stage-load-text')||{}).textContent);
  if (t.classList && t.classList.contains('is-busy')) window.__marks.push('busy:' + (t.id || t.dataset.tool || t.dataset.mode || t.className));
}}}).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class'] });
"""
def run(theme, w, h):
    ctx = b.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
    ctx.add_init_script(f"localStorage.setItem('slowsky-mock-theme','{theme}')")
    pg = ctx.new_page(); errs = []
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.goto(u)
    boot0 = pg.evaluate("document.body.className")
    pg.screenshot(path=f'{S}/feat-{theme}-{w}-boot.png')
    pg.wait_for_timeout(1800)
    pg.screenshot(path=f'{S}/feat-{theme}-{w}-coach.png')
    print(f'== {theme} {w}: boot class at load "{boot0}", after "{pg.evaluate("document.body.className")}"')
    if pg.locator('#coach-close').count() and pg.locator('#coach-close').is_visible():
        pg.click('#coach-close'); pg.wait_for_timeout(200)
    pg.evaluate(WATCH)
    ud = lambda: (pg.is_disabled('#undo-btn'), pg.is_disabled('#redo-btn'))
    print('  undo/redo disabled at start:', ud())
    tgt0 = pg.inner_text('#hud-id').split('\n')[0]
    pg.click('#mode [data-mode=subtract]'); pg.wait_for_timeout(900)
    print('  after subtract: mode', pg.evaluate("document.querySelector('#mode [aria-checked=true]')?.dataset.mode"), 'undo/redo', ud())
    pg.click('#undo-btn'); pg.wait_for_timeout(900)
    print('  after undo: mode', pg.evaluate("document.querySelector('#mode [aria-checked=true]')?.dataset.mode"), 'undo/redo', ud())
    pg.click('#redo-btn'); pg.wait_for_timeout(900)
    print('  after redo: mode', pg.evaluate("document.querySelector('#mode [aria-checked=true]')?.dataset.mode"), 'undo/redo', ud())
    # A + B
    pg.click('[data-subop=sum]'); pg.wait_for_timeout(700)
    print('  subop sum checked:', pg.get_attribute('[data-subop=sum]', 'aria-checked'), '| hash', pg.evaluate("location.hash"))
    pg.screenshot(path=f'{S}/feat-{theme}-{w}-sum.png')
    pg.click('[data-subop=diff]'); pg.wait_for_timeout(500)
    # target switch + undo with keyboard
    pg.keyboard.press('Meta+k'); pg.wait_for_timeout(300); pg.keyboard.type('eps'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1800)
    tgt1 = pg.inner_text('#hud-id').split('\n')[0]
    pg.keyboard.press('Meta+z'); pg.wait_for_timeout(1800)
    tgt2 = pg.inner_text('#hud-id').split('\n')[0]
    pg.keyboard.press('Meta+Shift+z'); pg.wait_for_timeout(1800)
    tgt3 = pg.inner_text('#hud-id').split('\n')[0]
    print(f'  targets: start {tgt0!r} -> pick {tgt1!r} -> undo {tgt2!r} -> redo {tgt3!r}')
    # layers
    for k in ('gaia', 'flags', 'falsecolour', 'epoch'):
        sel = f'[data-tool={k}]'
        if not pg.locator(sel).is_visible():
            print('  layer', k, 'NOT VISIBLE'); continue
        pg.click(sel); pg.wait_for_timeout(200)
        print('  layer', k, pg.get_attribute(sel, 'aria-pressed'), '| note:', (pg.inner_text('#layer-note') if pg.is_visible('#layer-note') else '(hidden)')[:110])
        pg.click(sel); pg.wait_for_timeout(150)
    # field
    if pg.locator('#field-select').is_visible():
        pg.select_option('#field-select', '0.5'); pg.wait_for_timeout(600)
        print('  field 0.5 -> toast:', pg.inner_text('#toast')[:120] if pg.locator('#toast').count() else '', '| zoom label', pg.inner_text('#zoom-label'))
        pg.select_option('#field-select', '0.1'); pg.wait_for_timeout(400)
    else:
        print('  field select NOT VISIBLE')
    # save picture
    try:
        with pg.expect_download(timeout=6000) as dl:
            pg.click('#save-btn')
        d = dl.value; p = f'{S}/feat-{theme}-{w}-save.png'; d.save_as(p); print('  save picture:', d.suggested_filename)
    except Exception as e:
        print('  save picture FAILED', str(e)[:120])
    # focus
    pg.keyboard.press('f'); pg.wait_for_timeout(400)
    print('  focus mode:', 'focus-mode' in pg.evaluate("document.body.className"))
    pg.screenshot(path=f'{S}/feat-{theme}-{w}-focus.png')
    pg.keyboard.press('f'); pg.wait_for_timeout(300)
    # inspector tabs
    pg.keyboard.press('i'); pg.wait_for_timeout(300)
    for t in ('info', 'frame', 'cands', 'charts', 'ai', 'extras'):
        loc = pg.locator(f'[data-tab={t}]')
        if loc.count() and loc.is_visible():
            loc.click(); pg.wait_for_timeout(250)
            print(f'  tab {t}:', pg.inner_text(f'#tab-{t}')[:90].replace('\n', ' / '))
        else:
            print('  tab', t, 'NOT VISIBLE')
    pg.screenshot(path=f'{S}/feat-{theme}-{w}-inspector.png')
    pg.keyboard.press('i'); pg.wait_for_timeout(300)
    # guide
    pg.keyboard.press('g'); pg.wait_for_timeout(400)
    print('  guide open:', pg.locator('.guide').is_visible())
    pg.screenshot(path=f'{S}/feat-{theme}-{w}-guide.png')
    pg.fill('.guide-search input', 'subtract'); pg.wait_for_timeout(250)
    print('  guide search hits:', pg.evaluate("[...document.querySelectorAll('.guide-body [data-find]')].filter(e=>!e.hidden).length"))
    pg.fill('.guide-search input', ''); pg.wait_for_timeout(150)
    pg.click('.guide-tour'); pg.wait_for_timeout(500)
    titles = []
    for i in range(30):
        tip = pg.locator('.coach-tip')
        if not tip.count() or not tip.is_visible():
            break
        titles.append(tip.locator('b').inner_text())
        if i in (0, 5, 12):
            pg.screenshot(path=f'{S}/feat-{theme}-{w}-tour{i}.png')
        tip.locator('button').last.click(); pg.wait_for_timeout(450)
    print(f'  tour steps shown {len(titles)}:', ' | '.join(titles))
    print('  loading marks seen:', sorted(set(pg.evaluate("window.__marks"))))
    print('  ERRORS', len(errs)); [print('   ', e[:240]) for e in errs[:8]]
    ctx.close()

with sync_playwright() as p:
    b = p.chromium.launch()
    for theme, w, h in [('light', 1440, 900), ('dark', 390, 844)]:
        run(theme, w, h)
    b.close()
