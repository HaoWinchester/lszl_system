"""Exercise authoritative dialog UI without mutating a database or release."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/remaining-learning-requirements/dashboard-browser'
OUT.mkdir(parents=True, exist_ok=True)
checks = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, channel='chrome')
    page = browser.new_page(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content('<!doctype html><html lang="zh"><body><button id="open" data-knowledge-dashboard-open>星空知识网络</button></body></html>')
    page.add_style_tag(path=str(ROOT/'new-legacy/styles/knowledge-dashboard.css'))
    page.evaluate('''() => {
      window.owner='A'; window.KGAuthCore={currentUser:()=>owner?{username:owner}:null};
      window.mode='ready'; window.calls=0;
      window.KGDomainApi={request: async options => {
        calls++; if(mode==='error')throw Error('offline');
        if(mode==='pending')return new Promise(resolve=>window.resolveOld=resolve);
        if(mode==='empty')return {nodes:[],topicCount:0,attemptCount:0};
        return {nodes:[{title:'风险管理 <安全>',subject:'PMP',taxonomyId:'tax',path:['项目','风险'],attemptCount:3,brightness:.6,lastPracticedAt:'2026-10-17T00:00:00Z'}],topicCount:1,attemptCount:3,recentAttemptCount:2,unknownAttemptCount:1};
      }};
    }''')
    page.add_script_tag(path=str(ROOT/'new-legacy/src/practice/knowledge-dashboard.js'))
    page.locator('#open').click()
    dialog = page.get_by_role('dialog', name='星空知识网络')
    expect(dialog).to_be_visible()
    expect(page.locator('[data-knowledge-close]')).to_be_focused()
    expect(page.locator('[data-knowledge-list]')).to_contain_text('风险管理 <安全>')
    assert page.locator('[data-knowledge-network] circle').count()==2
    assert page.locator('[data-knowledge-network]').evaluate('e=>getComputedStyle(e).animationName')=='none'
    # Native modal containment covers forward/backward Tab and Escape return focus.
    page.keyboard.press('Shift+Tab')
    assert page.evaluate('document.querySelector("dialog").contains(document.activeElement)')
    page.keyboard.press('Escape');expect(dialog).not_to_be_visible();expect(page.locator('#open')).to_be_focused()
    checks.append('native dialog focus containment, Escape restoration, escaped API labels and reduced motion')
    page.evaluate("mode='error'");page.locator('#open').click();expect(page.locator('[data-knowledge-retry]')).to_be_visible()
    assert page.locator('[data-knowledge-list] li').count()==0
    page.evaluate("mode='ready'");page.locator('[data-knowledge-retry]').click();expect(page.locator('[data-knowledge-list] li')).to_have_count(1)
    checks.append('network error clears rows and retry recovers')
    page.evaluate("mode='pending';void KGKnowledgeDashboard.open()")
    page.wait_for_function('!!window.resolveOld')
    page.evaluate("owner='B';mode='empty';dispatchEvent(new Event('kg-auth-session-change'))")
    expect(page.locator('[data-knowledge-status]')).to_contain_text('保存有效作答')
    page.evaluate("resolveOld({nodes:[{title:'A private'}],topicCount:1})")
    expect(page.locator('[data-knowledge-list] li')).to_have_count(0)
    assert 'A private' not in dialog.inner_text()
    prior_calls=page.evaluate('calls')
    page.evaluate("owner='';dispatchEvent(new Event('kg-auth-session-change'))")
    expect(page.locator('[data-knowledge-status]')).to_contain_text('登录后')
    assert page.evaluate('calls')==prior_calls
    page.keyboard.press('Escape');page.locator('#open').click()
    expect(page.locator('[data-knowledge-status]')).to_contain_text('登录后')
    assert page.evaluate('calls')==prior_calls
    checks.append('account switch invalidates delayed owner data; logout and guest entry clear UI without API fetch')
    page.evaluate("owner='B';mode='ready';dispatchEvent(new Event('kg-auth-session-change'))")
    expect(page.locator('[data-knowledge-list] li')).to_have_count(1)
    page.screenshot(path=str(OUT/'desktop.png'))
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    box=dialog.bounding_box();assert box['x']>=0 and box['x']+box['width']<=390
    page.screenshot(path=str(OUT/'mobile.png'))
    checks.append('390px dialog remains in viewport; no page overflow')
    assert not errors, errors
    browser.close()
(OUT/'results.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False))
