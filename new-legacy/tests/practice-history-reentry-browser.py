#!/usr/bin/env python3
"""History entry must select the target paper before capturing its question count."""
from pathlib import Path
import re
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "practice-mode.html").read_text(encoding="utf-8")
body = re.search(r"<body([^>]*)>([\s\S]*)</body>", source, re.I)
assert body
html = re.sub(r"<script[\s\S]*?</script>", "", body.group(2), flags=re.I)

with sync_playwright() as playwright:
    executable = next(p for p in [shutil.which("chromium"), shutil.which("google-chrome"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        playwright.chromium.executable_path] if p and Path(p).exists())
    browser = playwright.chromium.launch(headless=True, executable_path=executable)
    # A new page models refresh: the lobby defaults to the newest 60-question paper,
    # while the completed attempt in history belongs to a 3-question paper.
    for selected_count in [10, 60]:
        page = browser.new_page(viewport={"width": 1280, "height": 1000})
        page.set_content(f'<html><body{body.group(1)}>{html}</body></html>')
        page.evaluate("""() => {
          const release=(id,count,publishedAt)=>({id,paperId:id,releaseId:id+'-v1',version:1,
            name:id,subject:'PMP',status:'published',questionCount:count,totalCount:count,
            publishedAt,accessPolicy:{accessLevel:'free'}});
          const papers=[release('large-paper',60,2),release('short-paper',3,1)];
          const questions=Array.from({length:3},(_,i)=>({questionId:'q'+i,bankId:'bank',orderIndex:i,
            question:{id:'q'+i,type:'single_choice',stemParts:[{text:'题目 '+i}],
            options:[{id:'A',text:'正确'},{id:'B',text:'错误'}],correctAnswer:'A'}}));
          window.__entryRequests=[];
          window.KGAuthCore={currentUser:()=>({username:'student',role:'student'})};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
          window.KGPublishedPaperRepository={listCatalogEntries:()=>papers};
          window.KGPracticeLearningApi={
            stats:()=>({active:0}),active:()=>[],refresh:async()=>({}),
            getPaperProgress:async()=>({modes:{}}),
            getRevengeSummary:async()=>({stats:{active:0},resumable:null}),
            listSessions:async()=>[{sessionId:'completed-3',paperId:'short-paper',paperName:'short-paper',
              mode:'challenge',status:'completed',answered:3,correct:1,endedAt:Date.now(),reportAvailable:true}],
            enterSession:async input=>{
              window.__entryRequests.push(input);
              if(input.count>3)throw Object.assign(new Error('shortage'),{status:422,
                detail:{code:'PRACTICE_QUESTION_SHORTAGE',available:3,requested:input.count}});
              return {resumed:false,session:{id:'new-practice',paperId:'short-paper',releaseId:'short-paper-v1',
                mode:'practice',status:'active',revision:1,questions,answers:{},runtimeState:{currentIndex:0,order:'paper'},
                stats:{total:3,answered:0,correct:0,wrong:0,unanswered:3,experience:0,durationMs:0}}};
            }
          };
        }""")
        for css in ["styles/main.css", "styles/practice-mode.css"]:
            page.add_style_tag(content=(ROOT / css).read_text(encoding="utf-8"))
        for script in ["111-practice-session-core.js", "115-practice-mode-policy.js", "112-practice-answer-sheet.js",
                       "113-practice-result-report.js", "116-practice-session-save.js", "117-question-answer-set.js",
                       "114-practice-draft-state.js", "118-revenge-entry-policy.js", "100-practice-mode.js"]:
            page.add_script_tag(content=(ROOT / "src" / script).read_text(encoding="utf-8"))
        page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
        page.locator('[data-paper-id="large-paper"]').first.click()
        page.locator(f'[name="practiceCount"][value="{selected_count}"]').check(force=True)
        page.locator('#practiceHistoryOpenBtn').click()
        page.locator('[data-history-practice="short-paper"]').click()
        request = page.evaluate('window.__entryRequests[0]')
        assert request == {"paperId":"short-paper", "releaseId":"short-paper-v1", "mode":"practice", "count":3, "order":"paper"}, request
        assert page.evaluate('window.KGPracticeMode.snapshot().active') is True
        assert page.locator('[name="practiceCount"]:checked').input_value() == '3'
        assert page.locator('#practiceSelectedPaperName').inner_text() == 'short-paper'
        page.close()
    browser.close()
print('practice-history-reentry-browser-ok')
