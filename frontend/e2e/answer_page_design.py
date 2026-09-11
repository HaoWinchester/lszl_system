"""Reference layout proof with disposable PostgreSQL data and an immutable release."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import practice_resumable_report as harness
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/answer-page-design'
OUT.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(OUT)
common = Path(subprocess.check_output(['git', 'rev-parse', '--git-common-dir'], cwd=ROOT, text=True).strip()).resolve()
harness.ACTIVE_RELEASE_ROOT = common.parent / 'frontend/new-legacy-releases'
sys.path[:0] = [str(ROOT/'backend'), str(ROOT/'backend/tests')]

MATERIAL = '''一家金融科技公司的资深项目经理，正在负责开发一款面向中小企业的智能风控 SaaS 平台。项目采用敏捷框架，共有6个敏捷团队（每个团队7-9人）并行开发不同微服务，总开发周期为12个月，目前进行到第6个月（第12个冲刺）。

近期项目出现一系列状况：

产品负责人（PO）最近因健康原因休假两周，期间由业务方代表临时接管需求决策。临时PO在未与团队协商的情况下，直接向两个敏捷团队插入了一批高优先级需求，导致当前冲刺的迭代待办事项列表严重超载，冲刺目标面临无法达成的风险。

敏捷教练发现，开发团队在每日站会上只汇报“昨天做了什么、今天打算做什么”，但从不讨论遇到的阻碍和风险，导致两个关键外部API的集成问题被隐藏了整整5天，严重影响计划进度。'''
STEM = '在混合开发模式下，敏捷团队的迭代节奏与预测型团队的计划进度出现偏差，项目经理应采取什么措施？'
OPTIONS = ['将敏捷团队也切换为预测型开发模式，统一管理节奏','取消敏捷开发，全部采用预测型管理以避免冲突','要求敏捷团队加班追赶预测型团队的进度','在项目治理层面设定协调点，调整敏捷迭代的目标，使其与预测型团队的实际可用时间对齐']

def main():
    server = harness.IsolatedPracticeHarness()
    try:
        base = server.start()
        os.environ['DATABASE_URL'] = server._database_url()
        from mixed_question_support import seed_users, questions, publish, PASSWORD
        ids = harness.run_async(seed_users())
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width':1360,'height':1156}, reduced_motion='reduce')
            harness.login(context.request, base, ids['teacher'], PASSWORD)
            response = context.request.post(base+'/api/v1/question-materials', data={'title':'智能风控 SaaS 平台项目','text':MATERIAL,'images':[]})
            assert response.ok, response.text()
            material = response.json()['material']
            qs = questions(ids, material)
            for q in qs:
                if q.get('caseGroup'):
                    q['stemParts'] = [{'text':STEM}]
                    q['options'] = [{'id':key,'text':text,'correct':key=='D'} for key,text in zip('ABCD',OPTIONS)]
                    q['correctAnswer']='D'
                response=context.request.post(base+'/api/v1/banks/'+ids['bank']+'/questions',data=q)
                assert response.ok, response.text()
                q['id']=response.json()['question']['id']
            harness.run_async(publish(ids, qs))
            harness.login(context.request,base,ids['student'],PASSWORD)
            page=context.new_page();page.set_default_timeout(15000)
            errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(base+'/practice-mode.html',wait_until='networkidle')
            page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
            list_type = page.evaluate('''() => {
                const size = selector => getComputedStyle(document.querySelector(selector)).fontSize;
                return {title:size('.practice-mode-card h2'), body:size('.practice-mode-card p'),
                        control:size('.practice-start-btn'), brand:size('.practice-brand strong')};
            }''')
            page.locator('[data-practice-start="challenge"]').click()
            page.locator('#practiceGame').wait_for(state='visible')
            def jump(index):
                page.locator('[data-practice-action="sheet"]').click()
                page.locator(f'#practiceAnswerSheet [data-question-id="{qs[index]["id"]}"]').click()
            jump(5)
            page.mouse.move(0,0)
            page.evaluate('scrollTo(0,0)')
            page.screenshot(path=str(OUT/'desktop-case.png'),full_page=True)
            panel=page.locator('.practice-answer-panel').bounding_box()
            material_box=page.locator('.qm-question-materials').bounding_box()
            assert material_box['x']+material_box['width'] < panel['x']
            assert abs(material_box['y']-panel['y']) < 2
            assert page.locator('#practiceQuestionType').inner_text()=='单选题'
            assert 'linear-gradient' in page.locator('#practiceNextBtn').evaluate('(el)=>getComputedStyle(el).backgroundImage')
            assert page.locator('[data-kg-icon="settings"]').get_attribute('data-kg-icon-hydrated')=='settings'
            page.locator('.qm-case-body').evaluate('(el)=>el.scrollTop=100')
            prior=page.locator('.qm-case-body').evaluate('(el)=>el.scrollTop')
            page.locator('#practiceNextBtn').click()
            assert page.locator('.qm-case-body').evaluate('(el)=>el.scrollTop')==prior
            assert page.locator('#practiceNextBtn').is_disabled()
            page.locator('.qm-case summary').click()
            page.locator('#practicePrevBtn').click()
            assert not page.locator('.qm-case').evaluate('(el)=>el.open')
            page.locator('.qm-case summary').click()
            page.locator('#practiceMarkToggle').click()
            page.locator('[data-practice-action="marked"]').click()
            assert page.locator('#practiceAnswerSheet [data-question-id]').count()==1
            page.locator('#practiceAnswerSheet [data-question-id]').click()
            for width in [320,390,768,900,1024,1360]:
                page.set_viewport_size({'width':width,'height':1000})
                if not page.evaluate('document.documentElement.scrollWidth <= innerWidth'):
                    print(page.evaluate("[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).slice(-25)"), flush=True)
                    page.screenshot(path=str(OUT/'overflow.png'),full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
                if width<=900:
                    assert page.locator('.qm-question-materials').bounding_box()['y']<page.locator('.practice-answer-panel').bounding_box()['y']
                for selector, role in [('.practice-question-stem','title'),('.qm-text','body'),
                                       ('.practice-option','body'),('.practice-nav-btn','control'),
                                       ('.practice-brand strong','brand')]:
                    assert page.locator(selector).first.evaluate('(el)=>getComputedStyle(el).fontSize') == list_type[role], (width, selector, list_type)
                standard_size = page.locator('.practice-option').first.evaluate('(el)=>parseFloat(getComputedStyle(el).fontSize)')
                page.locator('[data-practice-action="settings"]').click()
                page.locator('#practiceReadingSize').select_option('large')
                assert page.locator('.practice-option').first.evaluate('(el)=>parseFloat(getComputedStyle(el).fontSize)') > standard_size
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), ('large',width)
                page.locator('#practiceReadingSize').select_option('standard')
                page.keyboard.press('Escape')
                assert page.locator('.practice-option').first.evaluate('(el)=>parseFloat(getComputedStyle(el).fontSize)') == standard_size
                if width==390: page.screenshot(path=str(OUT/'mobile-case.png'),full_page=True)
            jump(0)
            assert page.locator('.qm-question-materials').is_hidden()
            assert page.locator('#practicePrevBtn').is_disabled()
            page.screenshot(path=str(OUT/'desktop-single.png'),full_page=True)
            jump(1)
            assert page.locator('#practiceQuestionType').inner_text()=='多选题'
            jump(2)
            assert page.locator('#practiceQuestionType').inner_text()=='配对题'
            page.locator('[data-qm-left="l1"]').click()
            page.locator('[data-qm-right="r2"]').click()
            assert page.locator('#practiceConfirmAnswerBtn').is_disabled()
            page.locator('[data-qm-left="l2"]').click()
            page.locator('[data-qm-right="r1"]').click()
            assert page.locator('#practiceConfirmAnswerBtn').is_enabled()
            page.screenshot(path=str(OUT/'desktop-matching.png'),full_page=True)
            page.locator('#practiceConfirmAnswerBtn').click()
            page.locator('#practiceExitBtn').click()
            page.locator('#practiceSaveExitBtn').click()
            page.locator('#practiceLobby').wait_for(state='visible')
            page.reload(wait_until='networkidle')
            page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
            page.locator('[data-practice-start="challenge"]').click()
            page.locator('#practiceGame').wait_for(state='visible')
            page.locator('[data-practice-action="marked"]').click()
            assert page.locator('#practiceAnswerSheet [data-question-id]').count()==1
            assert not errors, errors
            browser.close()
            print('PASS design: cases, single/multiple/matching, scroll/collapse retention, marked filter/save/reload, navigation boundaries, reading settings, six viewport widths')
    finally:
        server.close()

if __name__=='__main__': main()
