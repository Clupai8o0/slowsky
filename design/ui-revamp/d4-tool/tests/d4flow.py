from playwright.sync_api import sync_playwright
from pathlib import Path
u = Path('index.html').resolve().as_uri(); S = '/tmp/d4shots'
with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in ('light', 'dark'):
        ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        ctx.add_init_script(f"localStorage.setItem('slowsky-d4-coach','1'); localStorage.setItem('slowsky-mock-theme','{theme}')")
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.goto(u); pg.wait_for_timeout(1200)
        pg.click('#ws-mine'); pg.wait_for_timeout(300)
        pg.click('#empty-sample-fits'); pg.wait_for_timeout(60); pg.screenshot(path=f'{S}/{theme}-fits-jobs.png')
        pg.wait_for_timeout(2500)
        pg.click('#mode [data-mode=subtract]'); pg.wait_for_timeout(800)
        pg.click('[data-tool=find]'); pg.wait_for_timeout(800)
        pg.mouse.move(700, 400); pg.wait_for_timeout(300)
        print(theme, 'coord:', pg.inner_text('#status-coord'), '| hud:', pg.inner_text('#hud-scale').replace('\n',' '), '| cands:', pg.locator('#cands .cand').count())
        print('  cands tab:', pg.inner_text('#tab-cands')[:260].replace('\n', ' / '))
        pg.screenshot(path=f'{S}/{theme}-fits-sub.png')
        pg.click('[data-tab=frame]'); pg.wait_for_timeout(300)
        print('  frame tab:', pg.inner_text('#tab-frame')[:600].replace('\n', ' / '))
        pg.screenshot(path=f'{S}/{theme}-fits-frame.png')
        # PNG sample
        pg.click('#inspector-close'); pg.wait_for_timeout(200)
        pg.evaluate("document.getElementById('empty-sample').click()"); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{S}/{theme}-png-jobs.png')
        pg.wait_for_timeout(3500)
        pg.click('#mode [data-mode=blink]'); pg.wait_for_timeout(400)
        pg.screenshot(path=f'{S}/{theme}-png-blink.png')
        pg.click('#ws-sky'); pg.wait_for_timeout(1200)
        pg.keyboard.press('Meta+k'); pg.wait_for_timeout(300); pg.screenshot(path=f'{S}/{theme}-picker.png')
        pg.keyboard.type('eps'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1500)
        print('  after pick:', pg.inner_text('#hud-id').replace('\n',' | '))
        pg.screenshot(path=f'{S}/{theme}-epsindb.png')
        print('  ERRORS', len(errs)); [print('   ', e[:240]) for e in errs[:8]]
        ctx.close()
    b.close()
