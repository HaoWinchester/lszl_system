#!/usr/bin/env python3
"""Exact resume/report identity, explicit restart and history recovery in actual DOM."""
from pathlib import Path
import re, shutil
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
body=re.search(r'<body([^>]*)>([\s\S]*)</body>',(ROOT/'practice-mode.html').read_text(),re.I)
html=re.sub(r'<script[\s\S]*?</script>','',body.group(2),flags=re.I)
with sync_playwright() as pw:
    executable=next(p for p in [shutil.which('chromium'),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',pw.chromium.executable_path] if p and Path(p).exists())
    browser=pw.chromium.launch(headless=True,executable_path=executable)
    for width in [1280,390]:
        page=browser.new_page(viewport={'width':width,'height':900})
        page.set_default_timeout(5000)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(f'<html><body{body.group(1)}>{html}</body></html>')
        page.evaluate('''() => {
          const paper={id:'paper',paperId:'paper',releaseId:'v2',version:2,name:'测试卷',subject:'PMP',status:'published',totalCount:23,questionCount:23,accessPolicy:{accessLevel:'free'}};
          const questions=Array.from({length:10},(_,i)=>({questionId:'q'+i,bankId:'b',orderIndex:i,question:{id:'q'+i,type:'single_choice',stemParts:[{text:'题目'+i}],options:[{id:'A',text:'正确'},{id:'B',text:'错误'}],correctAnswer:'A'}}));
          const make=(id,status,mode='practice')=>({id,paperId:'paper',releaseId:'v1',mode,status,revision:1,questions,answers:{},runtimeState:{currentIndex:4,order:'random'},stats:{total:10,answered:0,correct:0}});
          const sessions={saved:make('saved','paused'),old:make('old','completed','challenge'),older:make('older','completed','scholar')};
          window.__sessions=sessions;window.__failHistory=false;window.__emptyHistory=false;window.__failRead=false;window.__failStart=false;window.__calls=[];
          const pending=()=>Object.values(sessions).find(s=>['active','paused'].includes(s.status));
          window.KGAuthCore={currentUser:()=>({username:'student',role:'student'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
          window.KGPublishedPaperRepository={listCatalogEntries:()=>[paper]};
          window.KGPracticeLearningApi={stats:()=>({active:0}),active:()=>[],refresh:async()=>({}),
            getPaperProgress:async()=>({paperId:'paper',modes:{practice:pending()?{sessionId:pending().id,answered:0,total:10}:null}}),
            getRevengeSummary:async()=>({stats:{active:0},resumable:null}),
            listSessions:async()=>{if(window.__failHistory)throw Error('offline');if(window.__emptyHistory)return [];return Object.values(sessions).map((s,i)=>({sessionId:s.id,paperId:'paper',paperName:'测试卷',mode:s.mode,status:s.status,total:10,answered:0,createdAt:3000-i*1000,reportAvailable:s.status==='completed'}))},
            getSession:async id=>{window.__calls.push(['get',id]);if(window.__failRead)throw Error('offline');return sessions[id]},
            getReport:async id=>{window.__calls.push(['report',id]);return {official:false,reportNumber:id,paperName:'测试卷',counts:{total:10,correct:0,wrong:0,unanswered:10},wrongQuestionIds:[],domains:{}}},
            enterSession:async input=>{window.__calls.push(['enter',input]);return {resumed:true,session:pending()}},
            pauseSession:async(id,input)=>{sessions[id]={...sessions[id],status:'paused',revision:2,runtimeState:input.runtimeState,answers:input.answers};return sessions[id]},
            abandonSession:async(id,input)=>{window.__calls.push(['abandon',id]);sessions[id].status='abandoned';return sessions[id]},
            startSession:async input=>{
              window.__calls.push(['start',input]);if(pending())throw Object.assign(Error('exists'),{detail:{code:'RESUMABLE_SESSION_EXISTS',sessionId:pending().id}});
              if(window.__failStart)throw Error('network');return sessions.fresh={...make('fresh','active'),releaseId:'v2',runtimeState:{currentIndex:0,order:input.order}};
            }
          };
        }''')
        for css in ['styles/main.css','styles/practice-mode.css']:
            page.add_style_tag(content=(ROOT/css).read_text())
        for script in ['111-practice-session-core.js','115-practice-mode-policy.js','112-practice-answer-sheet.js','113-practice-result-report.js','116-practice-session-save.js','117-question-answer-set.js','114-practice-draft-state.js','118-revenge-entry-policy.js','100-practice-mode.js']:
            page.add_script_tag(content=(ROOT/'src'/script).read_text())
        page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
        expect(page.locator('[data-practice-start="practice"]')).to_have_text('继续上次练习 0/10')
        page.locator('[data-practice-start="practice"]').click()
        snap=page.evaluate('window.KGPracticeMode.snapshot()')
        assert snap['sessionId']=='saved' and snap['index']==4
        page.locator('#practiceExitBtn').click();page.locator('#practiceSaveExitBtn').click()
        # Cancellation must leave the original round resumable.
        page.once('dialog',lambda d:d.dismiss())
        page.locator('[data-practice-new="practice"]').click()
        expect(page.locator('[data-practice-new="practice"]')).to_be_enabled()
        assert not page.evaluate('window.__calls.some(c=>c[0]==="abandon")')
        page.locator('#practiceHistoryOpenBtn').click()
        page.locator('details summary').click()
        expect(page.locator('[data-history-resume="saved"]')).to_be_visible()
        expect(page.locator('[data-history-session="old"]')).to_be_visible()
        expect(page.locator('[data-history-session="older"]')).to_be_visible()
        assert page.locator('[data-history-session="saved"]').count()==0
        page.evaluate('window.__failRead=true')
        page.locator('[data-history-resume="saved"]').click()
        expect(page.locator('#practiceToast')).to_contain_text('无法读取')
        page.evaluate('window.__failRead=false')
        page.locator('[data-history-session="older"]').click()
        expect(page.locator('.practice-report-meta')).to_contain_text('older')
        page.locator('[data-report-lobby]').click()
        page.locator('#practiceHistoryOpenBtn').click();page.locator('details summary').click()
        page.locator('[data-history-resume="saved"]').click()
        assert page.evaluate('window.KGPracticeMode.snapshot().sessionId')=='saved'
        page.locator('#practiceExitBtn').click();page.locator('#practiceSaveExitBtn').click()
        page.evaluate('window.__failStart=true')
        page.once('dialog',lambda d:d.accept())
        page.locator('[data-practice-new="practice"]').click()
        expect(page.locator('#practiceToast')).to_contain_text('旧轮已结束并保留记录')
        assert page.evaluate('window.__sessions.saved.status')=='abandoned'
        page.evaluate('window.__failStart=false')
        # No pending round now: the normal entry API creates one in production.
        page.evaluate("() => {window.KGPracticeLearningApi.enterSession=async input=>({resumed:false,session:await window.KGPracticeLearningApi.startSession(input)})}")
        page.locator('[data-practice-start="practice"]').click()
        expect(page.locator('#practiceGame')).to_be_visible()
        assert page.evaluate('window.KGPracticeMode.snapshot().sessionId')=='fresh'
        page.locator('#practiceExitBtn').click();page.locator('#practiceSaveExitBtn').click()
        page.evaluate('window.__failHistory=true')
        page.locator('#practiceHistoryOpenBtn').click()
        expect(page.locator('#practiceHistoryEmpty')).to_contain_text('暂时无法读取')
        page.locator('#practiceHistoryCloseBtn').click()
        page.evaluate('window.__failHistory=false;window.__emptyHistory=true')
        page.locator('#practiceHistoryOpenBtn').click()
        expect(page.locator('#practiceHistoryEmpty')).to_have_text('暂无练习记录')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert not errors,errors
        page.close()
    browser.close()
print('practice-entry-history-browser-ok (desktop + 390px)')
