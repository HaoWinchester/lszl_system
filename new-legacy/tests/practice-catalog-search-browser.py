#!/usr/bin/env python3
"""Search complete PC catalog without losing the selected practice configuration."""
from pathlib import Path
import re, shutil
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
body = re.search(r'<body([^>]*)>([\s\S]*)</body>', (ROOT/'practice-mode.html').read_text(), re.I)
html = re.sub(r'<script[\s\S]*?</script>', '', body.group(2), flags=re.I)
with sync_playwright() as pw:
    executable = next(p for p in [shutil.which('chromium'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', pw.chromium.executable_path] if p and Path(p).exists())
    browser = pw.chromium.launch(headless=True, executable_path=executable)
    for width in [1280, 390]:
        page = browser.new_page(viewport={'width':width, 'height':900})
        page.set_default_timeout(5000)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_content(f'<html><body{body.group(1)}>{html}</body></html>')
        page.evaluate('''() => {
          const papers=Array.from({length:25},(_,i)=>({id:'p'+i,paperId:'p'+i,releaseId:'r'+i,version:1,name:'试卷 '+i,description:i===21?'Agile & leadership':'练习',subject:i===21?'ACP':'PMP',status:'published',totalCount:60,questionCount:60,accessPolicy:{accessLevel:i===21?'member':'free'}}));
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGPublishedPaperRepository={listCatalogEntries:()=>papers};
          window.KGPaperAccessService={inspect:p=>({allowed:true,accessLevel:p.accessPolicy.accessLevel})};
          window.KGAuthCore={currentUser:()=>({username:'student',role:'student'})};
          window.KGPracticeLearningApi={stats:()=>({active:0}),active:()=>[],refresh:async()=>({}),getPaperProgress:async()=>({modes:{}}),getRevengeSummary:async()=>({stats:{active:0}})};
        }''')
        for css in ['styles/main.css','styles/practice-mode.css']:
            page.add_style_tag(content=(ROOT/css).read_text())
        for script in ['115-practice-mode-policy.js','118-revenge-entry-policy.js','100-practice-mode.js']:
            page.add_script_tag(content=(ROOT/'src'/script).read_text())
        page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
        expect(page.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(25)
        page.locator('label:has(input[name="practiceCount"][value="20"])').click()
        page.locator('label:has(input[name="practiceOrder"][value="random"])').click()
        selected = page.locator('#practiceSelectedPaperName').inner_text()
        page.locator('#practiceLibrarySearch').fill('agile')
        expect(page.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(1)
        expect(page.locator('#practicePaperLibrary [data-paper-id="p21"]')).to_be_visible()
        page.locator('#practiceLibrarySubject').select_option('ACP')
        page.locator('[data-paper-filter="member"]').first.click()
        expect(page.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(1)
        expect(page.locator('#practiceSelectedPaperName')).to_have_text(selected)
        expect(page.locator('input[name="practiceCount"][value="20"]')).to_be_checked()
        expect(page.locator('input[name="practiceOrder"][value="random"]')).to_be_checked()
        page.locator('#practiceLibrarySearch').fill('no such paper')
        expect(page.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(0)
        page.locator('#practiceLibraryClear').click()
        expect(page.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(25)
        expect(page.locator('#practiceLibrarySubject')).to_have_value('')
        expect(page.locator('#practiceSelectedPaperName')).to_have_text(selected)
        assert not errors, errors
        page.close()
    browser.close()
print('practice-catalog-search-browser-ok (1280px, 390px)')
