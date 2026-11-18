from playwright.sync_api import sync_playwright
import os
url='file://'+os.path.abspath('index.html')
with sync_playwright() as p:
    b=p.chromium.launch()
    for w,h in [(1440,900),(1280,720),(1024,768)]:
        pg=b.new_page(viewport={'width':w,'height':h})
        pg.goto(url); pg.wait_for_timeout(1500)
        pg.click('#mode [data-mode=subtract]'); pg.wait_for_timeout(1500)
        info=pg.evaluate("""(()=>{const out={};const ab=document.querySelector('.ab').getBoundingClientRect();out.ab=[ab.x,ab.y,ab.right,ab.bottom];
        const rail=document.querySelector('.rail, .dock, aside.left, .timeline-panel');
        const all=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return (cs.position==='fixed'||cs.position==='absolute')&&r.width>200&&r.top<ab.bottom&&r.bottom>ab.top+20&&r.left<ab.right&&r.right>ab.left&&!e.contains(document.querySelector('.ab'))&&!document.querySelector('.ab').contains(e)});
        out.over=all.map(e=>[e.id||e.className.toString().slice(0,40),Math.round(e.getBoundingClientRect().top),Math.round(e.getBoundingClientRect().bottom)]);
        const sc=document.querySelector('.ab').closest('[class]').parentElement;return out})()""")
        print(w,h,info)
        pg.screenshot(path=f'/tmp/d4ab-{w}.png', clip={'x':0,'y':h-330,'width':520,'height':330})
    b.close()
