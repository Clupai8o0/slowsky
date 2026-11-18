from playwright.sync_api import sync_playwright
from pathlib import Path
u=Path('index.html').resolve().as_uri()
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1440,'height':900})
    ctx.add_init_script("localStorage.setItem('slowsky-d4-coach','1')")
    pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(u); pg.wait_for_timeout(1500)
    for t in ('barnard','epsindb'):
        pg.evaluate(f"location.hash='#t={t}&m=subtract'"); pg.wait_for_timeout(300); pg.reload(); pg.wait_for_timeout(1800)
        pg.click('[data-tool=find]'); pg.wait_for_timeout(1200)
        pg.is_visible('[data-tab=cands]') or pg.keyboard.press('i'); pg.wait_for_timeout(300); pg.click('[data-tab=cands]'); pg.wait_for_timeout(300)
        print(t, pg.inner_text('#tab-cands')[:900].replace('\n',' / '))
        pg.screenshot(path=f'/tmp/d4shots/cands-{t}.png')
    pg.click('[data-tab=ai]'); pg.wait_for_timeout(300); pg.screenshot(path='/tmp/d4shots/ai-tab.png')
    print('errs', errs); b.close()
