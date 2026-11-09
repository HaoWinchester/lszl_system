#!/usr/bin/env python3
"""Page history in the real drawer: recovery, identity races and narrow-screen DOM."""
from pathlib import Path
import re
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
body = re.search(r'<body([^>]*)>([\s\S]*)</body>', (ROOT / 'practice-mode.html').read_text(), re.I)
html = re.sub(r'<script[\s\S]*?</script>', '', body.group(2), flags=re.I)


def expect_summary(page, loaded, total, papers=2):
    expect(page.locator('#practiceHistorySummary')).to_have_text(
        f'已加载 {loaded} / 共 {total} 条记录 · {papers} 份试卷')


with sync_playwright() as pw:
    executable = next(p for p in [shutil.which('chromium'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', pw.chromium.executable_path] if p and Path(p).exists())
    browser = pw.chromium.launch(headless=True, executable_path=executable)
    for width in [1280, 390]:
        page = browser.new_page(viewport={'width': width, 'height': 900})
        page.set_default_timeout(5000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(f'<html><body{body.group(1)}>{html}</body></html>')
        page.evaluate('''() => {
          const rows=Array.from({length:125},(_,i)=>({sessionId:'s'+String(i).padStart(3,'0'),
            paperId:'paper-'+i%2,paperName:'分页测试卷 '+i%2,mode:i%3?'practice':'challenge',
            status:'completed',total:10,answered:10,correct:8,
            createdAt:new Date(Date.UTC(2026,10,9,12,0,0)-i*1000).toISOString(),reportAvailable:true}));
          window.__historyRows={student:rows,other:[{...rows[0],sessionId:'other-only',paperName:'另一账号试卷'}]};
          window.__owner='student';window.__pageCalls=[];window.__previewCalls=[];
          window.__failNext=false;window.__holdNext=false;window.__releasePage=null;
          window.KGAuthCore={currentUser:()=>window.__owner?{username:window.__owner,role:'student'}:null};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free'})};
          window.KGPublishedPaperRepository={listCatalogEntries:()=>[]};
          window.KGQuestionFavorites={fetchList:async()=>({favorites:[]})};
          window.KGPracticeLearningApi={stats:()=>({active:0}),active:()=>[],refresh:async()=>({}),
            getPaperProgress:async()=>({modes:{}}),getRevengeSummary:async()=>({stats:{active:0},resumable:null}),
            listSessions:async options=>{window.__previewCalls.push(options);return (window.__historyRows[window.__owner]||[]).slice(0,options?.limit||100)},
            listSessionsPage:async options=>{
              const owner=window.__owner,offset=Number(options.cursor?.slice(7)||0),records=window.__historyRows[owner]||[];
              window.__pageCalls.push({owner,...options});
              const payload={sessions:records.slice(offset,offset+options.limit),total:records.length,
                nextCursor:offset+options.limit<records.length?'cursor-'+(offset+options.limit):null};
              // Replayed summaries must not duplicate a record or a paper group.
              if(offset===20)payload.sessions.unshift(records[19]);
              const fail=window.__failNext;window.__failNext=false;
              if(window.__holdNext){window.__holdNext=false;await new Promise(resolve=>window.__releasePage=resolve)}
              if(fail)throw Error('offline');return payload;
            },
            clearSessions:async()=>{window.__historyRows[window.__owner]=[]}
          };
        }''')
        for css in ['styles/main.css', 'styles/practice-mode.css']:
            page.add_style_tag(content=(ROOT / css).read_text())
        scripts = ['111-practice-session-core.js', '115-practice-mode-policy.js', '112-practice-answer-sheet.js', '113-practice-result-report.js', '116-practice-session-save.js', '117-question-answer-set.js', '114-practice-draft-state.js', '118-revenge-entry-policy.js', 'practice/lobby-dashboard.js']
        # Use the real optional feature loader; fail its first script request.
        bundle_attempts = [0]
        def history_bundle(route):
            bundle_attempts[0] += 1
            if bundle_attempts[0] == 1:
                route.abort('failed')
            else:
                route.fulfill(body=(ROOT / 'src/practice/history-controller.js').read_text(), content_type='application/javascript')
        page.route('http://history.test/history-feature.js', history_bundle)
        page.evaluate('''() => {
          const config=document.createElement('script');config.id='kg-page-features';config.type='application/json';
          config.textContent=JSON.stringify({history:{scripts:['http://history.test/history-feature.js'],styles:[]}});document.head.append(config);
        }''')
        scripts.extend(['feature-assets.js', 'practice/feature-loader.js', '100-practice-mode.js'])
        for script in scripts:
            page.add_script_tag(content=(ROOT / 'src' / script).read_text())
        page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
        if page.locator('#practiceRecentBody').count():
            page.wait_for_function('window.__previewCalls.length>0')
            assert page.evaluate('window.__previewCalls.every(options=>options?.limit===5)'), 'recent preview must request only 5 summaries'
        assert page.evaluate('window.__pageCalls.length') == 0, 'drawer history is demand loaded'
        page.locator('#practiceHistoryOpenBtn').click()
        expect(page.locator('#practiceHistoryEmpty')).to_contain_text('暂时无法读取')
        expect(page.locator('#practiceHistoryLoadMore')).to_be_visible()
        expect(page.locator('#practiceHistoryLoadMore')).to_have_text('重试')
        assert page.evaluate('window.__pageCalls.length') == 0, 'failed feature must not read history'
        page.locator('#practiceHistoryLoadMore').click()
        expect_summary(page, 20, 125)
        assert bundle_attempts[0] == 2, 'feature failure must retry the script request'
        assert page.evaluate('window.__pageCalls') == [{'owner': 'student', 'limit': 20, 'cursor': None}]
        expect(page.locator('.practice-history-group')).to_have_count(2)
        expect(page.locator('.practice-history-attempt')).to_have_count(20)
        page.locator('.practice-history-group details summary').first.click()
        expect(page.locator('.practice-history-group details').first).to_have_attribute('open', '')

        # Failed append keeps the same records, expanded group and scroll position.
        page.evaluate('window.__failNext=true;window.__holdNext=true')
        page.locator('#practiceHistoryLoadMore').click()
        expect(page.locator('#practiceHistoryLoadMore')).to_be_disabled()
        page.evaluate("document.querySelector('#practiceHistoryLoadMore').click();document.querySelector('#practiceHistoryDrawer .practice-drawer-body').scrollTop=100")
        assert page.evaluate('window.__pageCalls.length') == 2, 'repeated clicks must share the pending request'
        before_scroll = page.locator('#practiceHistoryDrawer .practice-drawer-body').evaluate('(el)=>el.scrollTop')
        page.evaluate('window.__releasePage()')
        expect(page.locator('#practiceHistoryLoadMore')).to_be_enabled()
        expect(page.locator('#practiceHistoryPageStatus')).to_contain_text('重试')
        expect_summary(page, 20, 125)
        expect(page.locator('.practice-history-attempt')).to_have_count(20)
        expect(page.locator('.practice-history-group details').first).to_have_attribute('open', '')
        assert page.locator('#practiceHistoryDrawer .practice-drawer-body').evaluate('(el)=>el.scrollTop') == before_scroll

        # The same control retries the same cursor; successful append keeps expansion.
        page.evaluate('window.__holdNext=true')
        page.locator('#practiceHistoryLoadMore').click()
        page.locator('#practiceHistoryDrawer .practice-drawer-body').evaluate('(el)=>el.scrollTop=100')
        before_scroll = page.locator('#practiceHistoryDrawer .practice-drawer-body').evaluate('(el)=>el.scrollTop')
        page.evaluate('window.__releasePage()')
        expect_summary(page, 40, 125)
        assert page.locator('#practiceHistoryDrawer .practice-drawer-body').evaluate('(el)=>el.scrollTop') == before_scroll
        expect(page.locator('.practice-history-group')).to_have_count(2)
        expect(page.locator('.practice-history-attempt')).to_have_count(40)
        expect(page.locator('.practice-history-group details').first).to_have_attribute('open', '')
        assert page.evaluate('window.__pageCalls.slice(-2).every(call=>call.cursor==="cursor-20")')
        for loaded in [60, 80, 100, 120, 125]:
            page.locator('#practiceHistoryLoadMore').click()
            expect_summary(page, loaded, 125)
        expect(page.locator('.practice-history-attempt')).to_have_count(125)
        expect(page.locator('#practiceHistoryPageStatus')).to_have_text('已显示全部记录')
        expect(page.locator('#practiceHistoryLoadMore')).to_be_hidden()
        assert page.locator('[data-history-session="s124"]').count() == 1, 'record beyond the old 100-item cap is accessible'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')

        # Closing and reopening starts with the first page, with a retry on failure.
        page.locator('#practiceHistoryCloseBtn').click()
        page.evaluate('window.__failNext=true')
        page.locator('#practiceHistoryOpenBtn').click()
        expect(page.locator('#practiceHistoryEmpty')).to_contain_text('暂时无法读取')
        expect(page.locator('.practice-history-attempt')).to_have_count(0)
        expect(page.locator('#practiceHistoryLoadMore')).to_be_visible()
        page.locator('#practiceHistoryLoadMore').click()
        expect_summary(page, 20, 125)
        assert page.evaluate('window.__pageCalls.at(-1).cursor') is None

        # A superseded first request must never overwrite a newer opening.
        page.locator('#practiceHistoryCloseBtn').click()
        page.evaluate('window.__holdNext=true')
        page.locator('#practiceHistoryOpenBtn').click()
        page.locator('#practiceHistoryCloseBtn').click()
        page.evaluate("window.__historyRows.student.unshift({...window.__historyRows.student[0],sessionId:'newer-record'})")
        page.locator('#practiceHistoryOpenBtn').click()
        expect_summary(page, 20, 126)
        page.evaluate('window.__releasePage()')
        expect_summary(page, 20, 126)
        expect(page.locator('.practice-history-attempt')).to_have_count(20)

        # Switching identity while a page is pending clears the visible owner immediately.
        page.evaluate('window.__holdNext=true')
        page.locator('#practiceHistoryLoadMore').click()
        page.evaluate("window.__owner='other';window.dispatchEvent(new Event('kg-auth-session-change'))")
        expect(page.locator('.practice-history-attempt')).to_have_count(0)
        page.locator('#practiceHistoryOpenBtn').click()
        expect_summary(page, 1, 1, 1)
        page.evaluate('window.__releasePage()')
        expect_summary(page, 1, 1, 1)
        expect(page.locator('[data-history-session="other-only"]')).to_have_count(1)
        expect(page.locator('[data-history-session="s020"]')).to_have_count(0)

        # Clear resets loaded records, total and cursor and remains empty when reopened.
        page.locator('#practiceHistoryCloseBtn').click()
        page.evaluate("window.__owner='student';window.dispatchEvent(new Event('kg-auth-session-change'))")
        page.locator('#practiceHistoryOpenBtn').click()
        expect_summary(page, 20, 126)
        page.locator('#practiceClearHistoryBtn').click()
        expect_summary(page, 0, 0, 0)
        expect(page.locator('.practice-history-attempt')).to_have_count(0)
        expect(page.locator('#practiceClearHistoryBtn')).to_be_disabled()
        page.locator('#practiceHistoryCloseBtn').click()
        page.locator('#practiceHistoryOpenBtn').click()
        expect_summary(page, 0, 0, 0)
        assert page.evaluate('window.__pageCalls.at(-1).cursor') is None

        # Sign-out drops cached summaries, the count and any pending response.
        page.locator('#practiceHistoryCloseBtn').click()
        page.evaluate("window.__owner='student';window.dispatchEvent(new Event('kg-auth-session-change'));window.__holdNext=true")
        page.locator('#practiceHistoryOpenBtn').click()
        page.evaluate("window.__owner='';window.dispatchEvent(new Event('kg-auth-session-change'));window.__releasePage()")
        expect(page.locator('.practice-history-attempt')).to_have_count(0)
        expect(page.locator('#practiceHistorySummary')).to_contain_text('登录')
        expect(page.locator('#practiceHistoryCount')).to_be_hidden()
        assert not errors, errors
        page.close()
    browser.close()
print('practice-history-pagination-browser-ok (desktop + 390px)')
