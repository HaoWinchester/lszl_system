"""Read-only layout/navigation checks against a running, authenticated candidate.

TEACHER_BASE_URL=http://127.0.0.1:5179 TEACHER_BROWSER_SESSION=teacher-layout python3 ...
Authenticate the named agent-browser session first. No business records are created.
"""
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/learning-experience'
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('TEACHER_BASE_URL', 'http://127.0.0.1:5179').rstrip('/')
SESSION = os.environ.get('TEACHER_BROWSER_SESSION', 'teacher-layout')


def browser(*args):
    result = subprocess.run(['agent-browser', '--session', SESSION, '--json', *args], cwd=ROOT, capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout)
    assert payload['success'], payload
    return payload.get('data', {})


def evaluate(js):
    return browser('eval', js).get('result')


routes = [
    ('teacher-workbench.html', '工作台'),
    ('question-bank.html?mode=simple&step=questions', '题目管理'),
    ('question-bank.html?mode=simple&step=training', '训练配置'),
    ('paper-management.html', '试卷管理'),
]
checks = []
for width, height in [(1440, 1000), (390, 844)]:
    browser('set', 'viewport', str(width), str(height))
    for index, (route, label) in enumerate(routes):
        browser('open', f'{BASE}/{route}')
        browser('wait', '--fn', 'document.body.classList.contains("teacher-shell-ready")')
        role = evaluate('window.KGAuthCore?.currentUser?.()?.role')
        assert role in ['admin', 'teacher'], f'Authenticated teacher/admin session required; got {role}'
        result = evaluate('''(() => {
          const visible=x=>!!x&&x.getBoundingClientRect().height>0;
          const tabs=[...document.querySelectorAll('.tw-tabs a')];
          const title=document.querySelector('.wb-hero-copy h1,.qb-brand h1,.pm-page-head h1');
          return { width:innerWidth, scroll:document.documentElement.scrollWidth,
            current:tabs.find(x=>x.getAttribute('aria-current')==='page')?.textContent,
            nav:tabs.map(x=>x.getAttribute('href')), titleVisible:visible(title),
            flowVisible:visible(document.querySelector('.tw-workflow')),
            analysis:!!document.querySelector('[data-teacher-analytics]') };
        })()''')
        assert result['scroll'] <= width + 1, (route, result)
        assert result['current'] == label, (route, result)
        assert len(result['nav']) == 5 and len(set(result['nav'])) == 5, (route, result)
        assert result['titleVisible'] and not result['flowVisible'], (route, result)
        assert result['analysis'] == (role == 'admin'), (role, result)
        browser('click', '.tw-admin-menu summary')
        assert evaluate('document.querySelector(".tw-admin-menu").open')
        menu = evaluate('document.querySelector(".tw-admin-menu .admin-context-nav").getBoundingClientRect().toJSON()')
        assert menu['left'] >= 0 and menu['right'] <= width + 1, menu
        browser('press', 'Escape')
        assert not evaluate('document.querySelector(".tw-admin-menu").open')
        if label == '训练配置' and width == 390:
            assert not evaluate('document.getElementById("qbBankTabPanel").getBoundingClientRect().height>0'), 'mobile training must not squeeze in the bank editor'
        if label == '试卷管理':
            for button in ['qbAddPaperBtn', 'qbSavePaperBtn', 'qbPublishPaperBtn']:
                assert evaluate(f'!!document.getElementById("{button}")?.getBoundingClientRect().height'), button
            browser('click', '.tw-more-actions summary')
            assert evaluate('document.getElementById("qbImportPaperBtn").getBoundingClientRect().height>0')
            browser('click', '#qbImportPaperBtn')
            assert evaluate('!!document.querySelector("dialog[open]")'), 'Import must open its real dialog'
            browser('press', 'Escape')
            assert not evaluate('!!document.querySelector("dialog[open]")'), 'Cancel import must restore page'
            browser('press', 'Escape')
        browser('screenshot', str(OUT / f'teacher-runtime-{index}-{width}.png'))
        checks.append({'route': route, 'viewport': width, 'role': role, **result})
(OUT / 'teacher-browser-results.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2))
print(f'{len(checks)} authenticated desktop/mobile page checks passed; import opened/cancelled on both viewports')
