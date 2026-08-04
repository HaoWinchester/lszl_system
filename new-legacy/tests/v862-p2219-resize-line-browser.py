from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def text(p): return (ROOT/p).read_text()

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=b.new_page(viewport={'width':900,'height':650})
    page.set_content("""<body class="question-workspace-page">
      <article class="qw-question-card" style="position:absolute;left:200px;top:140px;width:420px;height:360px">
        <span class="qw-card-width-resize" data-qw-card-resize></span>
      </article>
    </body>""")
    page.add_style_tag(content=text('styles/question-workspace.css'))
    page.add_style_tag(content=text('styles/question-workspace-p2219.css'))
    handle=page.locator('.qw-card-width-resize')
    handle.evaluate("el=>el.style.opacity='1'")
    height=page.evaluate("""()=>getComputedStyle(document.querySelector('.qw-card-width-resize'),'::after').height""")
    assert height=='80px',height
    # Hit area remains unchanged.
    width=handle.evaluate("el=>getComputedStyle(el).width")
    assert width=='10px',width
    page.close();b.close()

print('v862-p2219-resize-line-browser-ok')
