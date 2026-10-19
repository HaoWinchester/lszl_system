#!/usr/bin/env python3
"""Isolated sound integration: actual page/controller/draft and native Web Audio.
All learning API data is synthetic; no running app, database or real account.
"""
from helpers.practice_tools import click_tool, open_tools
from pathlib import Path
import json
import os
import re
from playwright.sync_api import sync_playwright

ROOT = Path(os.environ.get('PRACTICE_MENU_TEST_ROOT', str(Path(__file__).resolve().parents[1])))
SCRIPTS = [
    'src/107-learning-ui-icons.js', 'src/28-device-preferences.js', 'src/111-practice-session-core.js',
    'src/115-practice-mode-policy.js', 'src/112-practice-answer-sheet.js',
    'src/113-practice-result-report.js', 'src/116-practice-session-save.js',
    'src/117-question-answer-set.js', 'src/114-practice-draft-state.js',
    'src/118-revenge-entry-policy.js', 'src/118-question-materials.js',
    'src/practice/practice-sound.js', 'src/100-practice-mode.js',
]


def harness(page, unsupported=False, mode="practice"):
    source = (ROOT / 'practice-mode.html').read_text()
    attrs, body = re.search(r'<body([^>]*)>([\s\S]*)</body>', source, re.I).groups()
    body = re.sub(r'<script[\s\S]*?</script>', '', body, flags=re.I)
    page.route('**/*', lambda route: route.fulfill(status=200, content_type='application/json', body='{}'))
    page.route('**/sound-harness', lambda route: route.fulfill(content_type='text/html', body=f'<html><head><meta charset="utf-8"></head><body{attrs}>{body}</body></html>'))
    page.goto('http://localhost/sound-harness')
    page.evaluate('''()=>{
      window.__owner='sound-fixture-A';window.__audioStarts=[];
      const NativeAudioContext=window.AudioContext;
      window.__audioSupported=!!NativeAudioContext;
      if(NativeAudioContext){const create=NativeAudioContext.prototype.createOscillator;NativeAudioContext.prototype.createOscillator=function(){
        const node=create.call(this),start=node.start.bind(node);node.start=(...args)=>{window.__audioStarts.push(node.type);return start(...args)};return node};}
      window.KGAuthCore={currentUser:()=>({username:window.__owner,role:'student'})};
      const refs=Array.from({length:10},(_,i)=>({questionId:'q'+(i+1),bankId:'fixture-bank',mistakeId:'mistake-'+i,orderIndex:i,
        question:{id:'q'+(i+1),type:'single_choice',title:'音效测试题 '+(i+1),stemParts:[{text:'请选择 A'}],
        options:[{id:'A',text:'正确',correct:true},{id:'B',text:'错误'}],correctAnswer:'A',analysis:'测试解析'}}));
      window.__saved=null;
      const session=mode=>({id:'sound-fixture-session',paperId:'fixture-paper',releaseId:'fixture-release',mode,status:'active',revision:1,
        questions:refs,questionOrder:refs.map(({question,...ref})=>ref),answers:{},runtimeState:{currentIndex:0,health:3,order:'paper',durationMs:0},
        stats:{total:10,answered:0,correct:0,wrong:0,unanswered:10,experience:0,durationMs:0}});
      window.KGPracticeLearningApi={stats:()=>({}),active:()=>[],refresh:async()=>({}),getPaperProgress:async()=>({modes:{}}),getRevengeSummary:async()=>({stats:{active:10,pending:0,needsRemediation:0,mastered:0}}),
        getSession:async()=>window.__saved,enterSession:async input=>({resumed:!!window.__saved,session:window.__saved||session(input.mode)}),
        pauseSession:async(id,input)=>{window.__saved={...session('practice'),...input,id,status:'paused',revision:2};return window.__saved},
        completeSession:async(id,input)=>({session:{...session('practice'),...input,id,status:'completed',revision:3},report:{official:false,reportKind:'practice',accuracyPercent:40,scorePercent:40,durationMs:1000,counts:{total:10,answered:5,correct:2,wrong:3,unanswered:5},domains:{},wrongQuestionIds:[]}}),
        listSessions:async()=>[],getReport:async()=>null};
      window.KGPublishedPaperRepository={listCatalogEntries:()=>[{id:'fixture-paper',paperId:'fixture-paper',releaseId:'fixture-release',name:'音效测试',subject:'测试',status:'published',questionCount:10,totalCount:10,accessPolicy:{accessLevel:'free'}}]};
      window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
      window.KGLearningLoading={show(){},hide(){}};
      window.KGActivitySchemaV1={getPracticeAutoExplain:()=>false,getLanguageMode:()=>'zh'};
    }''')
    if unsupported:
        page.evaluate('window.AudioContext=undefined;window.webkitAudioContext=undefined')
    page.route('**/assets/icons/lucide-learning.svg', lambda route: route.fulfill(path=ROOT/'assets/icons/lucide-learning.svg'))
    for style in re.findall(r'<link[^>]+href="([^"]+\.css)"', source):
        page.add_style_tag(content=(ROOT / style).read_text())
    for script in SCRIPTS:
        if (ROOT / script).exists():
            page.add_script_tag(content=(ROOT / script).read_text())
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.locator(f'[data-practice-start="{mode}"]').click()
    page.wait_for_function("KGPracticeMode.snapshot().view==='game'")


def count(page):
    return page.evaluate('window.__audioStarts.length')


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 960})
        page.set_default_timeout(10000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        harness(page)
        toggle = page.locator('#practiceSoundToggle')
        open_tools(page)
        assert toggle.is_visible(), 'the answer view must offer a visible sound toggle'
        assert toggle.inner_text() == '音效关'
        page.locator('[data-option-id="A"]').click()
        assert count(page) == 0, 'default muted must not create any oscillator'
        click_tool(page, '#practiceSoundToggle')
        assert toggle.inner_text() == '音效开'
        assert count(page) == 0, 'toggle must not preview correctness'
        page.locator('#practiceNextBtn').click()
        page.locator('[data-option-id="A"]').click()
        page.wait_for_function('window.__audioStarts.length===1')
        page.evaluate("KGPracticeMode.answerById('A')")
        assert count(page) == 1, 'duplicate local answer must not replay'
        page.locator('#practiceNextBtn').click()
        page.locator('[data-option-id="B"]').click()
        page.wait_for_function('window.__audioStarts.length===2')
        assert page.evaluate('__audioStarts[0]!==__audioStarts[1]'), 'correct/wrong tones must differ'
        page.locator('#practiceNextBtn').click()
        page.locator('#practiceInstantFeedback').uncheck()
        page.locator('[data-option-id="A"]').click()
        page.wait_for_function('KGPracticeMode.snapshot().index===4')
        assert count(page) == 2, 'hidden correctness must remain silent'
        page.locator('#practiceInstantFeedback').check()
        click_tool(page, '#practiceSoundToggle')
        page.locator('[data-option-id="B"]').click()
        assert count(page) == 2, 'explicit muted must remain silent'
        click_tool(page, '#practiceSoundToggle')
        # Save and resume accepted answers: neither restoring nor revisiting plays.
        page.locator('#practiceSaveProgressBtn').click()
        page.wait_for_function("window.__saved?.status==='paused'")
        page.evaluate('KGPracticeMode.showLobby()')
        page.locator('[data-practice-start="practice"]').click()
        page.wait_for_function("KGPracticeMode.snapshot().view==='game'")
        page.locator('#practicePrevBtn').click()
        assert count(page) == 2, 'restoring or rendering previous answers must not replay'
        assert toggle.inner_text() == '音效开', 'same owner preference must survive view restoration'
        assert page.evaluate('KGPracticeMode.finishPractice()') is True
        page.wait_for_function("KGPracticeMode.snapshot().view==='result'")
        assert page.locator('.practice-report-overall').is_visible()
        assert count(page) == 2, 'settlement and frozen report must not replay answers'
        page.locator('[data-report-review-all]').click()
        page.wait_for_function("document.querySelectorAll('[data-review-card]').length===10")
        assert count(page) == 2, 'review rendering must remain silent'
        page.locator('[data-review-filter="wrong"]').click()
        page.locator('[data-review-filter="all"]').click()
        assert count(page) == 2, 'report review filters must remain silent'
        page.evaluate("window.__owner='sound-fixture-B';dispatchEvent(new Event('kg-auth-session-change'))")
        assert toggle.inner_text() == '音效关', 'new owner defaults to quiet'
        assert page.evaluate("localStorage.getItem('kg_practice_sound_v1__sound-fixture-B')") is None
        page.reload()
        # Fresh page setup gets persisted A preference without autoplay.
        harness(page)
        assert toggle.inner_text() == '音效开'
        assert count(page) == 0
        # Unsupported audio still accepts the exact same answer flow.
        unsupported = browser.new_page(viewport={'width': 1440, 'height': 960})
        unsupported.on('pageerror', lambda error: errors.append(str(error)))
        harness(unsupported, unsupported=True)
        click_tool(unsupported, '#practiceSoundToggle')
        unsupported.locator('[data-option-id="A"]').click()
        assert unsupported.evaluate('KGPracticeMode.snapshot().answered') == 1
        assert count(unsupported) == 0
        # Revenge verification uses a separate accepted local-answer boundary.
        revenge = browser.new_page(viewport={'width': 1440, 'height': 960})
        revenge.on('pageerror', lambda error: errors.append(str(error)))
        harness(revenge, mode='revenge')
        click_tool(revenge, '#practiceSoundToggle')
        revenge.locator('[data-option-id="B"]').click()
        revenge.wait_for_function('window.__audioStarts.length===1')
        revenge.locator('#practiceRemediationContinueBtn').click()
        revenge.wait_for_function("document.body.dataset.practicePhase==='verification'")
        assert count(revenge) == 1, 'rendering a verification prompt must not sound'
        revenge.locator('[data-option-id="A"]').click()
        revenge.wait_for_function('window.__audioStarts.length===2')
        revenge.evaluate("KGPracticeMode.answerById('A')")
        assert count(revenge) == 2, 'duplicate verification must not replay'
        assert not errors, json.dumps(errors, ensure_ascii=False)
        browser.close()
    print('practice sound browser: toggle, native audio, duplicate, hidden correctness, mute, resume/report/review, owner, reload, unsupported, revenge verification passed')


if __name__ == "__main__":
    main()
