"""Real recall UI and PostgreSQL persistence on canvas_ink_server disposable fixture."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('RECALL_CUSTOM_BASE','http://127.0.0.1:5191')
URL=BASE+'/knowledge-recall.html?questionId=ink-question-1&bankId=ink-bank&paperId=ink-paper&releaseId=ink-release'
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000})
    assert context.request.post(BASE+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
    # Source JS only; all session/progress traffic uses real FastAPI/PG.
    for filename in ('src/86-knowledge-recall.js','src/95-recall-association-library.js','src/recall/deep-recall-flow-model.js','src/canvas/dom-interaction.js','styles/knowledge-recall.css'):
        context.route('**/'+filename+'*',lambda route,request,filename=filename:route.fulfill(status=200,content_type='text/css' if filename.endswith('.css') else 'application/javascript',body=(ROOT/filename).read_text()))
    page=context.new_page()
    page.on('dialog',lambda dialog:dialog.accept())
    page.on('pageerror',lambda error:print('PAGEERROR',error,flush=True))
    page.goto(URL)
    expect(page.locator('#krRevealKeywordsBtn')).to_be_enabled(timeout=30000)
    with page.expect_response(lambda response:'/api/v1/recall/progress/' in response.url and response.request.method=='POST' and '/reset' in response.url):
        page.locator('#krResetBtn').click()
    page.locator('#krRevealKeywordsBtn').click()
    keyword=page.locator('.kr-keyword-token').filter(has_text='分析影响').first
    expect(keyword).to_be_visible()
    keyword.click()
    expect(page.locator('.kr-node')).to_have_count(1)
    assert page.evaluate("KGLearningProgress.flush('deep_recall')")
    graph=context.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()['progress']
    assert graph['nodes'][0].get('custom') is True,'unmatched keyword must create custom root'
    node_id=graph['nodes'][0]['dataId'];assert node_id.startswith('personal:')
    page.locator('.kr-node button').first.click()
    expect(page.locator('#krPersonalTitle')).to_be_visible()
    expect(page.get_by_label('卡牌标题',exact=True)).to_be_visible()
    expect(page.get_by_label('我的回忆内容',exact=True)).to_be_visible()
    page.locator('#krPersonalTitle').fill('')
    page.locator('#krPersonalSaveBtn').click()
    expect(page.locator('#krPersonalTitle')).to_have_value('')
    assert page.evaluate("KGLearningProgress.flush('deep_recall')")
    unchanged=context.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()['progress']
    assert unchanged['customNodes'][node_id]['title']=='分析影响'
    page.locator('#krPersonalTitle').fill('我的影响分析')
    page.locator('#krPersonalContent').fill('先识别风险，再判断影响。')
    page.route('**/api/v1/recall/progress/**',lambda route:route.fulfill(status=503,content_type='application/json',body='{"detail":"injected save failure"}'))
    page.locator('#krPersonalSaveBtn').click()
    assert page.evaluate("KGLearningProgress.flush('deep_recall')") is False
    expect(page.locator('#krPersonalTitle')).to_have_value('我的影响分析')
    expect(page.locator('#krPersonalContent')).to_have_value('先识别风险，再判断影响。')
    page.unroute('**/api/v1/recall/progress/**')
    assert page.evaluate("KGLearningProgress.flush('deep_recall')")
    page.locator('.kr-guide-close').click()
    keyword.click();expect(page.locator('.kr-node')).to_have_count(1)
    assert page.evaluate("KGLearningProgress.flush('deep_recall')")
    page.reload()
    expect(page.locator('.kr-node')).to_have_count(1,timeout=30000)
    page.locator('.kr-node button').first.click()
    expect(page.locator('#krPersonalTitle')).to_have_value('我的影响分析')
    expect(page.locator('#krPersonalContent')).to_have_value('先识别风险，再判断影响。')
    page.evaluate("KGRecallAssociationLibrary.setSessionLibrary({nodes:[{id:'baseline',title:'进度基准'}],edges:[]},'test-exact')")
    page.locator('#krCustomInput').fill('进度')
    page.locator('#krCustomInput').evaluate("el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))")
    expect(page.locator('.kr-node')).to_have_count(1)
    page.locator('#krCustomSaveBtn').click();expect(page.locator('.kr-node')).to_have_count(2)
    page.locator('.kr-node button').last.click()
    expect(page.locator('#krPersonalContent')).to_be_visible()
    page.locator('#krPersonalContent').fill('子卡也能编辑')
    page.locator('#krPersonalSaveBtn').click()
    assert page.evaluate("KGLearningProgress.flush('deep_recall')")
    graph=context.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()['progress']
    assert graph['customNodes'][node_id]['hint']=='先识别风险，再判断影响。'
    assert len(graph['customNodes'])==2,'manual unmatched input must also stay custom'
    assert any(item.get('hint')=='子卡也能编辑' for item in graph['customNodes'].values())
    page.evaluate('KGRecallAssociationLibrary.clearSessionLibrary()')
    out=ROOT.parent/'artifacts/canvas-m0-m1';out.mkdir(exist_ok=True,parents=True)
    page.screenshot(path=str(out/'T03-custom-root.png'))
    # A real saved historic system root must remain unchanged on load/click.
    session=context.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()
    historic={'instanceId':'historical-root','dataId':'impact','rootKey':'impact','title':'旧已保存卡牌','x':450,'y':100,'parentId':None,'depth':0}
    historic_child=dict(graph['nodes'][1]);historic_child['parentId']='historical-root'
    historic_edge={'id':'historical-edge','from':'historical-root','to':historic_child['instanceId']}
    saved=context.request.put(BASE+'/api/v1/recall/progress/ink-question-1?releaseId=ink-release',data={'expectedRevision':session['progressRevision'],'questionRevision':session['currentQuestion']['revision'],'libraryHash':session['library']['contentHash'],'graphSchemaVersion':3,'nodes':[historic,historic_child],'edges':[historic_edge],'strokes':[],'customNodes':{historic_child['dataId']:graph['customNodes'][historic_child['dataId']]},'activeKeywords':['impact']})
    assert saved.ok,saved.text()
    page.reload();expect(page.locator('.kr-node')).to_have_count(2,timeout=30000)
    assert page.evaluate("KGLearningProgress.flush('deep_recall')")
    restored=context.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()['progress']['nodes'][0]
    assert restored['dataId']=='impact' and not restored.get('custom')
    page.locator('#krRevealKeywordsBtn').click()
    page.locator('.kr-keyword-token').filter(has_text='分析影响').first.click()
    expect(page.locator('.kr-node')).to_have_count(2)
    page.locator('.kr-node button').first.click()
    page.locator('#krConvertPersonalBtn').click()
    expect(page.locator('#krPersonalTitle')).to_be_visible()
    assert page.evaluate("KGLearningProgress.flush('deep_recall')")
    converted=context.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()['progress']
    assert converted['edges']==[historic_edge]
    assert converted['nodes'][1]['parentId']=='historical-root'
    page.locator('#krUndoPersonalBtn').click()
    expect(page.locator('#krConvertPersonalBtn')).to_be_visible()
    assert page.evaluate("KGLearningProgress.flush('deep_recall')")
    restored=context.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()['progress']['nodes'][0]
    assert restored['dataId']=='impact' and not restored.get('custom')
    undone=context.request.get(BASE+'/api/v1/recall/session/ink-question-1?releaseId=ink-release').json()['progress']
    assert undone['edges']==[historic_edge]
    assert undone['nodes'][1]['parentId']=='historical-root'
    page.locator('#krConvertPersonalBtn').click()
    expect(page.locator('#krUndoPersonalBtn')).to_be_visible()
    page.locator('.kr-guide-close').click()
    page.locator('#krNextQuestionBtn').click()
    expect(page.locator('#krQuestionPosition')).to_have_text('题目 2 / 2',timeout=30000)
    page.locator('#krPrevQuestionBtn').click()
    expect(page.locator('#krQuestionPosition')).to_have_text('题目 1 / 2',timeout=30000)
    expect(page.locator('.kr-node')).to_have_count(2)
    page.locator('.kr-node button').first.click()
    expect(page.locator('#krPersonalTitle')).to_be_visible()
    expect(page.locator('#krUndoPersonalBtn')).to_have_count(0)
    page.locator('.kr-guide-close').click()
    with page.expect_response(lambda response:'/reset' in response.url and response.request.method=='POST'):
        page.locator('#krResetBtn').click()
    expect(page.locator('.kr-node')).to_have_count(0)
    page.locator('#krRevealKeywordsBtn').click()
    page.locator('.kr-keyword-token').filter(has_text='分析影响').first.click()
    page.locator('.kr-node button').first.click()
    expect(page.locator('#krPersonalTitle')).to_be_visible()
    expect(page.locator('#krUndoPersonalBtn')).to_have_count(0)
    page.locator('.kr-guide-close').click()
    page.locator('#krResetBtn').click();expect(page.locator('.kr-node')).to_have_count(0)
    browser.close()
print('recall-unmatched-custom-browser: passed')
