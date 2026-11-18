from playwright.sync_api import sync_playwright
from pathlib import Path
u=Path('index.html').resolve().as_uri()
mode=lambda pg: pg.evaluate("document.querySelector('#mode [aria-checked=true]')?.dataset.mode")
name=lambda pg: pg.inner_text('#hud-id').split('\n')[0]
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':1440,'height':900}, accept_downloads=True)
    ctx.add_init_script("localStorage.setItem('slowsky-d4-coach','1')")
    pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.goto(u); pg.wait_for_timeout(1600)
    # 1: stack, wait, switch target, undo before decode
    pg.click('#mode [data-mode=stack]'); pg.wait_for_timeout(700)
    pg.evaluate("""(()=>{const orig=HTMLImageElement.prototype.decode; HTMLImageElement.prototype.decode=function(){return new Promise(r=>setTimeout(()=>r(orig.call(this).catch(()=>{})),900))};})()""")
    pg.keyboard.press('Meta+k'); pg.wait_for_timeout(200); pg.keyboard.type('eps'); pg.keyboard.press('Enter'); pg.wait_for_timeout(150)
    pg.keyboard.press('Meta+z'); pg.wait_for_timeout(1600)
    print('1 undo during load ->', name(pg), mode(pg), '| dim', pg.evaluate("document.querySelector('.sky').classList.contains('dim')"))
    pg.evaluate("location.reload()"); pg.wait_for_timeout(1600)
    # 5: playing, click a thumb, wait, undo
    pg.evaluate("location.hash=''"); pg.reload(); pg.wait_for_timeout(1600)
    playing=pg.evaluate("document.querySelector('.play')?.getAttribute('aria-label')")
    cur=pg.evaluate("document.getElementById('playhead').getAttribute('aria-valuenow')")
    other=0 if cur!='1' else 2
    pg.evaluate(f"document.querySelectorAll('#dates-thumbs .thumb')[{other}].click()"); pg.wait_for_timeout(700)
    d1=pg.inner_text('#hud-id').split('\n')[1]
    pg.keyboard.press('Meta+z'); pg.wait_for_timeout(900)
    print('5 play label', playing, '| picked', d1, '-> after undo', pg.inner_text('#hud-id').split('\n')[1], '| toast', pg.inner_text('#toast'))
    # 3: subtract, click same thumb twice so a==b, save
    pg.click('#mode [data-mode=subtract]'); pg.wait_for_timeout(700)
    pg.evaluate("document.querySelectorAll('#dates-thumbs .thumb')[1].click()"); pg.wait_for_timeout(200); pg.evaluate("document.querySelectorAll('#dates-thumbs .thumb')[1].click()"); pg.wait_for_timeout(400)
    print('3 a/b', pg.inner_text('#ab-a'), '/', pg.inner_text('#ab-b'))
    got=None
    try:
        with pg.expect_download(timeout=2500) as dl:
            pg.click('#save-btn')
        got=dl.value.suggested_filename
    except Exception:
        pass
    print('3 save with a==b -> download', got, '| toast', pg.inner_text('#toast'))
    # 2: save then switch target while making
    pg.evaluate("document.querySelectorAll('#dates-thumbs .thumb')[0].click()"); pg.wait_for_timeout(500)
    with pg.expect_download(timeout=8000) as dl:
        pg.click('#save-btn'); pg.keyboard.press('Meta+k'); pg.wait_for_timeout(100); pg.keyboard.type('rw'); pg.keyboard.press('Enter')
    print('2 saved file', dl.value.suggested_filename, 'while now on', name(pg))
    # 6: tour focus
    pg.wait_for_timeout(1500)
    pg.keyboard.press('g'); pg.wait_for_timeout(300); pg.click('.guide-tour'); pg.wait_for_timeout(500)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    print('6 focus after Esc:', pg.evaluate("document.activeElement.id || document.activeElement.className || document.activeElement.tagName"))
    print('errors', errs[:5])
    b.close()
