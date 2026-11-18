from playwright.sync_api import sync_playwright
from pathlib import Path
u=Path('index.html').resolve().as_uri(); S='/tmp/d4shots'
with sync_playwright() as p:
    b=p.chromium.launch()
    for theme,w,h in [('light',1440,900),('light',1024,768),('dark',1280,720),('dark',768,1024)]:
        ctx=b.new_context(viewport={'width':w,'height':h}); ctx.add_init_script(f"localStorage.setItem('slowsky-d4-coach','1'); localStorage.setItem('slowsky-mock-theme','{theme}')")
        pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(u); pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{S}/size-{theme}-{w}x{h}.png')
        ov=pg.evaluate("""(()=>{const a=document.querySelector('.tools').getBoundingClientRect(), h=document.querySelector('.hud-id').getBoundingClientRect(), s=document.querySelector('.hud-scale').getBoundingClientRect(); return {tools:[Math.round(a.left),Math.round(a.top),Math.round(a.right),Math.round(a.bottom)], hudBottom:Math.round(h.bottom), scaleTop:Math.round(s.top), scaleRight:Math.round(s.right)}})()""")
        pg.keyboard.press('i'); pg.wait_for_timeout(500)
        pg.screenshot(path=f'{S}/size-{theme}-{w}x{h}-insp.png')
        print(theme,w,h,ov,'errs',len(errs))
        ctx.close()
    b.close()
