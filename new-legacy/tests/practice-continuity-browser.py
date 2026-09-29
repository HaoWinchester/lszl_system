#!/usr/bin/env python3
"""Real practice DOM: coverage, explicit save/retry and report-to-next-session."""
from pathlib import Path
import re
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'practice-mode.html').read_text()
body = re.search(r'<body([^>]*)>([\s\S]*)</body>', source, re.I)
html = re.sub(r'<script[\s\S]*?</script>', '', body.group(2), flags=re.I)
with sync_playwright() as pw:
    executable = next(p for p in [shutil.which('chromium'), shutil.which('google-chrome'),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', pw.chromium.executable_path]
        if p and Path(p).exists())
    browser = pw.chromium.launch(headless=True, executable_path=executable)
    for width in [1280, 390]:
        page = browser.new_page(viewport={'width': width, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_content(f'<html><body{body.group(1)}>{html}</body></html>')
        page.evaluate('''() => {
          const coverage={releaseId:'paper-v1',totalCount:23,completedCount:20,remainingUnseen:3};
          const paper={id:'paper',paperId:'paper',releaseId:'paper-v1',version:1,name:'连续练习测试卷',
            subject:'PMP',status:'published',questionCount:23,totalCount:23,coverage,accessPolicy:{accessLevel:'free'}};
          const questions=Array.from({length:10},(_,i)=>({questionId:'q'+i,bankId:'bank',orderIndex:i,
            question:{id:'q'+i,type:i===2?'multiple_choice':'single_choice',stemParts:[{text:'题目 '+(i+1)}],
            options:[{id:'A',text:'正确选项'},{id:'B',text:'错误选项'}],correctAnswer:'A'}}));
          let session;
          window.__writes=[];window.__failSave=true;window.__progressFail=true;window.__withdrawn=false;
          window.KGAuthCore={currentUser:()=>({username:'student',role:'student'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
          window.KGPublishedPaperRepository={listCatalogEntries:()=>window.__withdrawn?[]:[paper]};
          const start=input=>{window.__writes.push(['start',input]);return session={id:'session-'+window.__writes.length,
            paperId:'paper',releaseId:'paper-v1',mode:'practice',status:'active',revision:1,questions,
            answers:{},runtimeState:{currentIndex:0,order:'paper'},
            stats:{total:10,answered:0,correct:0,wrong:0,unanswered:10,experience:0,durationMs:0}}};
          window.KGPracticeLearningApi={stats:()=>({active:0}),active:()=>[],refresh:async()=>({}),listSessions:async()=>[],
            getPaperProgress:async()=>{if(window.__progressFail)throw new Error('offline');return {coverage,modes:{}}},
            getRevengeSummary:async()=>({stats:{active:0},resumable:null}),
            enterSession:async input=>({resumed:false,session:start(input)}),startSession:async input=>start(input),
            pauseSession:async(id,input)=>{
              window.__writes.push(['pause',input]);
              if(window.__failSave)throw new Error('temporary failure');
              session={...session,status:'paused',revision:session.revision+1,answers:input.answers,runtimeState:input.runtimeState};
              return session;
            },
            completeSession:async(id,input)=>{
              window.__writes.push(['complete',input]);
              session={...session,status:'completed',revision:session.revision+1,answers:input.answers};
              return {session,report:{official:false,purpose:'learning',scorePercent:10,counts:{total:10,correct:1,wrong:1,unanswered:8},
                wrongQuestionIds:['q0'],unansweredQuestionIds:questions.slice(2).map(q=>q.questionId),domains:{}}};
            }
          };
        }''')
        for css in ['styles/main.css', 'styles/practice-mode.css']:
            page.add_style_tag(content=(ROOT / css).read_text())
        for script in ['111-practice-session-core.js','115-practice-mode-policy.js','112-practice-answer-sheet.js',
                       '113-practice-result-report.js','116-practice-session-save.js','117-question-answer-set.js',
                       '114-practice-draft-state.js','118-revenge-entry-policy.js','100-practice-mode.js']:
            page.add_script_tag(content=(ROOT / 'src' / script).read_text())
        page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
        expect(page.locator('#practiceCoverageSummary')).to_contain_text('暂不可用')
        page.evaluate('window.__progressFail=false')
        page.locator('#practiceCoverageRetry').click()
        expect(page.locator('#practiceCoverageSummary')).to_contain_text('已练 20 / 23')
        expect(page.locator('.practice-paper-coverage').first).to_be_visible()
        page.locator('[data-practice-start="practice"]').click()
        expect(page.locator('#practiceSaveStatusText')).to_contain_text('已保存 0/10')
        page.locator('[data-option-id="B"]').click()
        expect(page.locator('#practiceSaveStatusText')).to_contain_text('最新进度尚未保存')
        assert len(page.evaluate('window.__writes')) == 1  # Answers remain local until explicit save.
        page.locator('#practiceSaveProgressBtn').click()
        expect(page.locator('#practiceSaveStatusText')).to_contain_text('保存失败')
        assert page.evaluate('window.KGPracticeMode.snapshot().answered') == 1
        page.evaluate('window.__failSave=false')
        page.locator('#practiceSaveProgressBtn').click()
        expect(page.locator('#practiceSaveStatusText')).to_contain_text('已保存 1/10')
        assert page.evaluate('window.KGPracticeMode.snapshot().active')
        page.locator('#practiceNextBtn').click()
        page.locator('[data-option-id="A"]').click()
        expect(page.locator('#practiceSaveStatusText')).to_contain_text('本轮已答 2/10')
        page.locator('#practiceSaveProgressBtn').click()
        expect(page.locator('#practiceSaveStatusText')).to_contain_text('已保存 2/10')
        page.locator('#practiceNextBtn').click()
        page.locator('[data-option-id="A"]').click()
        expect(page.locator('#practiceSaveProgressBtn')).to_be_enabled()
        page.evaluate("Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'))")
        expect(page.locator('#practiceSaveStatusText')).to_contain_text('网络已断开')
        expect(page.locator('#practiceSaveProgressBtn')).to_be_disabled()
        page.evaluate("Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'))")
        expect(page.locator('#practiceSaveProgressBtn')).to_be_enabled()
        page.locator('#practiceExitBtn').click()
        page.locator('#practiceExitCancel').click()
        assert page.evaluate('window.KGPracticeMode.snapshot().active')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        page.evaluate('window.KGPracticeMode.finishPractice()')
        expect(page.locator('[data-report-next]')).to_have_text('继续短练 10 题')
        expect(page.locator('#practiceResult')).to_contain_text('未做 3 题')
        assert page.locator('[data-report-review-wrong]').is_visible()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        page.locator('[data-report-next]').click()
        expect(page.locator('#practiceSaveStatusText')).to_contain_text('已保存 0/10')
        assert page.evaluate('window.__writes.at(-1)') == ['start', {
            'paperId':'paper','releaseId':'paper-v1','mode':'practice','count':10,'order':'paper'}]
        page.evaluate('window.KGPracticeMode.finishPractice()')
        expect(page.locator('[data-report-next]')).to_be_visible()
        page.evaluate('window.__withdrawn=true')
        before = len(page.evaluate('window.__writes'))
        page.locator('[data-report-next]').click()
        assert len(page.evaluate('window.__writes')) == before
        assert not errors, errors
        page.close()
    browser.close()
print('practice-continuity-browser-ok (desktop + 390px)')
