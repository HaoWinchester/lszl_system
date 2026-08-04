from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']

def text(path):
    return (ROOT / path).read_text()

def body_html(path):
    src = text(path)
    match = re.search(r'<body[^>]*>([\s\S]*)</body>', src, re.I)
    return re.sub(r'<script[\s\S]*?</script>', '', match.group(1), flags=re.I)

def style(page, *paths):
    for path in paths:
        page.add_style_tag(content=text(path))

def script(page, *paths):
    for path in paths:
        page.add_script_tag(content=text(path))

def mock_storage(page):
    page.evaluate("""()=>{
      const m=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>m.has(k)?m.get(k):null,
        setItem:(k,v)=>m.set(k,String(v)),
        removeItem:k=>m.delete(k),
        clear:()=>m.clear()
      }});
      window.confirm=()=>true;window.alert=()=>{};
    }""")

def test_language(browser):
    page = browser.new_page(viewport={'width': 1000, 'height': 700})
    page.set_content('<body class="question-training-page"><div id="host"></div></body>')
    mock_storage(page)
    page.evaluate("""()=>{
      window.KGCardRegistry={register:def=>window.__answerDef=def};
    }""")
    script(page, 'src/86-activity-schema-v1.js', 'src/86-free-mode-language.js', 'src/cards/answer-card.js')
    page.evaluate("""async()=>{
      const q={
        id:'q1',title:'中文题目',stemParts:[{text:'中文题干'}],
        options:[{id:'A',text:'中文A'},{id:'B',text:'中文B'}],
        translations:{en:{title:'English title',stem:'English stem',options:[{id:'A',text:'English A'},{id:'B',text:'English B'}]}}
      };
      window.__answer=window.__answerDef.create({question:()=>q,session:()=>({answer:{}}),dispatch:()=>{}});
      await window.__answer.mount(document.getElementById('host'));
    }""")
    assert page.locator('.answer-card-bilingual-en').count() == 0
    page.evaluate("KGActivitySchemaV1.setLanguageMode('bilingual')")
    page.evaluate("__answer.update()")
    assert page.locator('.answer-card-bilingual-en').count() >= 4
    page.evaluate("KGActivitySchemaV1.setLanguageMode('zh')")
    page.evaluate("__answer.update()")
    assert page.locator('.answer-card-bilingual-en').count() == 0
    page.close()

def test_recall_theme_focus(browser):
    page = browser.new_page(viewport={'width': 1366, 'height': 768})
    page.set_content('<body class="knowledge-recall-page">' + body_html('knowledge-recall.html') + '</body>')
    mock_storage(page)
    style(page, 'styles/knowledge-recall.css', 'styles/learning-practice-shell.css')
    script(page,
           'src/28-app-storage.js', 'src/50-question-data.js', 'src/86-activity-schema-v1.js',
           'src/86-free-mode-language.js', 'src/85-knowledge-recall-data.js',
           'src/95-recall-association-library.js', 'src/97-recall-storage.js', 'src/96-recall-question-source.js',
           'src/99-learning-practice-shell.js', 'src/98-recall-graph-model.js', 'src/86-knowledge-recall.js')
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(180)

    page.locator('details.lp-view-menu').evaluate('el=>el.open=true')
    page.locator('#krThemeSelect').select_option('neon')
    page.wait_for_timeout(30)
    assert page.locator('#krViewport').get_attribute('data-theme') == 'neon'
    assert page.locator('#krApp').get_attribute('data-theme') == 'neon'

    trigger = page.locator('#krQuestionListBtn')
    trigger.click()
    page.wait_for_timeout(80)
    assert not page.locator('#krQuestionSearch').evaluate('el=>document.activeElement===el')
    page.keyboard.press('Escape')
    page.wait_for_timeout(40)
    assert page.locator('#krQuestionDrawer').get_attribute('aria-hidden') == 'true'
    page.close()

def test_mobile_drawers(browser):
    cases = [
        ('knowledge-recall.html', 'knowledge-recall-page', '#krQuestionDrawer', ['styles/knowledge-recall.css', 'styles/knowledge-recall-p2223.css'], 360),
        ('question-workspace.html', 'question-workspace-page', '#qwQuestionDrawer', ['styles/question-workspace.css'], 360),
    ]
    for file, body_class, drawer, styles, expected_width in cases:
        page = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        page.set_content(f'<meta name="viewport" content="width=device-width, initial-scale=1"><body class="{body_class}">' + body_html(file) + '</body>')
        style(page, *styles, 'styles/learning-practice-shell.css')
        box = page.locator(drawer).bounding_box()
        assert box and abs(box['width'] - expected_width) < 4, (file, box)
        page.close()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=ARGS)
    test_language(browser)
    test_recall_theme_focus(browser)
    test_mobile_drawers(browser)
    browser.close()

print('v862-p221-bugfix-browser-ok')
