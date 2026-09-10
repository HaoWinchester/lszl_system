"""Mixed paper browser proof using a disposable database and built release."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import practice_resumable_report as harness
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.superpowers/sdd/2026-09-09-mixed-question-types/browser'
OUT.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(OUT)
common = Path(subprocess.check_output(['git','rev-parse','--git-common-dir'], cwd=ROOT, text=True).strip()).resolve()
harness.ACTIVE_RELEASE_ROOT = common.parent / 'frontend/new-legacy-releases'
sys.path[:0] = [str(ROOT/'backend'), str(ROOT/'backend/tests')]

def main():
    server = harness.IsolatedPracticeHarness()
    base = server.start()
    os.environ['DATABASE_URL'] = server._database_url()
    from mixed_question_support import seed_users, questions, publish, PASSWORD, png
    ids = harness.run_async(seed_users())
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        teacher = browser.new_context(viewport={'width':1440,'height':1000})
        harness.login(teacher.request,base,ids['teacher'],PASSWORD)
        asset_response = teacher.request.post(base+'/api/v1/question-assets',data=png())
        assert asset_response.ok, asset_response.text()
        asset=asset_response.json()['asset']
        material_response=teacher.request.post(base+'/api/v1/question-materials',data={'title':'跨国项目沟通案例','text':'团队分布在三个时区，需要共享实时进度。\n请根据此材料回答三道问题。','images':[asset]})
        assert material_response.ok, material_response.text()
        material=material_response.json()['material']
        qs=questions(ids,material,asset)
        for question in qs:
            response=teacher.request.post(base+'/api/v1/banks/'+ids['bank']+'/questions',data=question)
            assert response.ok,response.text()
            question['id']=response.json()['question']['id']
        edit=teacher.new_page(); edit.set_default_timeout(15000)
        edit.on('dialog',lambda dialog:dialog.accept())
        edit.goto(base+'/question-bank.html?bankId='+ids['bank']+'&questionId='+qs[2]['id']+'&view=content&entry=manual',wait_until='networkidle')
        edit.wait_for_timeout(300)
        edit.screenshot(path=str(OUT/'teacher-debug.png'))
        (OUT/'teacher-debug.txt').write_text(edit.locator('body').inner_text())
        edit.locator('#questionTypeInput').wait_for(state='visible')
        assert edit.locator('#questionTypeInput').input_value()=='matching'
        edit.locator('[data-rich-left="0"]').fill('更新后的左侧条目')
        with edit.expect_response(lambda r:'/content-prep/questions/' in r.url and r.request.method=='PUT') as saving:
            edit.locator('#qbSaveQuestionBtn').click()
        assert saving.value.ok,saving.value.text()
        edit.reload(wait_until='networkidle')
        assert edit.locator('[data-rich-left="0"]').input_value()=='更新后的左侧条目'
        edit.screenshot(path=str(OUT/'teacher-matching.png'))
        print('PASS teacher matching editor save/reload',flush=True)
        release=harness.run_async(publish(ids,qs))
        context=browser.new_context(viewport={'width':1280,'height':900})
        harness.login(context.request,base,ids['student'],PASSWORD)
        page=context.new_page(); page.set_default_timeout(15000)
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+'/practice-mode.html',wait_until='networkidle')
        page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
        page.locator('[data-practice-start="challenge"]').click()
        page.locator('#practiceGame').wait_for(state='visible')
        sid=page.evaluate('KGPracticeMode.snapshot().sessionId')
        assert page.evaluate('KGPracticeMode.snapshot().questionCount')==7
        def jump(index):
            page.locator('#practiceAnswerSheetMobileBtn').click()
            page.locator(f'#practiceAnswerSheet [data-question-id="{qs[index]["id"]}"]').click()
        jump(2)
        page.locator('[data-qm-left="l1"]').click()
        page.locator('[data-qm-right="r2"]').click()
        assert page.locator('#practiceConfirmAnswerBtn').is_disabled()
        page.locator('#practiceExitBtn').click()
        page.locator('#practiceSaveExitBtn').click()
        page.locator('#practiceLobby').wait_for(state='visible')
        saved=context.request.get(base+'/api/v1/learning/practice/sessions/'+sid).json()['session']
        assert saved['runtimeState']['pendingMatches'][qs[2]['id']]=={'l1':'r2'}
        assert qs[2]['id'] not in saved['answers']
        page.reload(wait_until='networkidle')
        page.locator(f'[data-paper-id="{ids["paper"]}"]').first.click()
        page.locator('[data-practice-start="challenge"]').click()
        page.locator('#practiceGame').wait_for(state='visible')
        assert '乙' in page.locator('[data-qm-left="l1"]').inner_text()
        page.locator('[data-qm-left="l2"]').press('Enter')
        page.locator('[data-qm-right="r1"]').press('Enter')
        assert page.locator('#practiceConfirmAnswerBtn').is_enabled()
        page.screenshot(path=str(OUT/'matching-desktop.png'))
        page.locator('#practiceConfirmAnswerBtn').click()
        page.wait_for_timeout(800)
        jump(3)
        page.locator('.qm-zoom').click()
        assert page.locator('dialog.qm-image-dialog').is_visible()
        page.locator('dialog.qm-image-dialog button').click()
        jump(4)
        assert page.locator('.qm-case').is_visible()
        page.screenshot(path=str(OUT/'case-desktop.png'))
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(OUT/'case-mobile.png'))
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.set_viewport_size({'width':1280,'height':900})
        for index in [0,1,3,4,5,6]:
            jump(index)
            page.locator('[data-option-id="A"]').first.click()
            if index==1:
                page.locator('[data-option-id="C"]').first.click()
                page.locator('#practiceConfirmAnswerBtn').click()
            page.wait_for_timeout(800)
        page.locator('.practice-result-report').wait_for(state='visible')
        completed=context.request.get(base+'/api/v1/learning/practice/sessions/'+sid).json()['session']
        assert completed['stats']['correct']==7,completed['stats']
        assert completed['answers'][qs[2]['id']]['selectedPairs']=={'l1':'r2','l2':'r1'}
        assert not errors,errors
        page.screenshot(path=str(OUT/'mixed-report.png'))
        print('PASS seven mixed questions, partial pairing save/resume, keyboard, image zoom, case desktop/mobile, exact 7/7 report',flush=True)
        browser.close()
    server.close()

if __name__=='__main__': main()
