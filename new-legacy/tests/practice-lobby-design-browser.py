"""Approved lobby layout, real isolated API data and all four preserved modes."""
import argparse,json,subprocess,uuid
from helpers.practice_tools import click_tool, open_tools
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);parser.add_argument('--baseline',action='store_true');parser.add_argument('--output-dir',type=Path,default=ROOT/'artifacts/knowledge-universe-20261020/task-4/real-api');parser.add_argument('--source-overrides',action='store_true');args=parser.parse_args()
OUT=args.output_dir;OUT.mkdir(parents=True,exist_ok=True)
BASE=args.base_url.rstrip('/');assert BASE.startswith('http://127.0.0.1:'),'Requires disposable local backend'
checks=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':1000})
    def call(method,path,body=None):
        r=getattr(ctx.request,method)(BASE+path,data=body) if body is not None else getattr(ctx.request,method)(BASE+path)
        assert r.ok,(path,r.status,r.text());return r.json()
    call('post','/api/v1/auth/login',{'username':'ink-browser','password':'ink-browser-test'})
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    if args.source_overrides:
        # Exercise authoritative edited assets without syncing or promoting a release.
        def source_asset(route):
            from urllib.parse import urlparse
            asset=ROOT/'new-legacy'/urlparse(route.request.url).path.lstrip('/')
            if asset.is_file():route.fulfill(path=asset)
            else:route.continue_()
        page.route('**/styles/**',source_asset);page.route('**/src/**',source_asset)
    if args.baseline:
        original=subprocess.check_output(['git','show','c9388519:frontend/public/new-legacy/practice-mode.html'])
        page.route('**/practice-mode.html',lambda route:route.fulfill(body=original,content_type='text/html'))
    page.goto(BASE+'/practice-mode.html',wait_until='networkidle')
    assert page.locator('.practice-lobby-sidebar').count()==1,'approved sidebar missing'
    assert page.locator('#practiceRecentPanel').count()==1,'actual history preview missing'
    universe_path='/api/v1/learning/practice/knowledge-universe'
    catalog=call('get',universe_path)
    catalog_nodes=catalog['nodes'];published=[node for node in catalog_nodes if node['subject']=='PMP'][:20]
    assert len(published)==20,'Requires real published PMP knowledge catalog'
    fixture_file=OUT/'fixture.json'
    if fixture_file.exists():fixture=json.loads(fixture_file.read_text())
    else:
        token=uuid.uuid4().hex[:7];bank=call('post','/api/v1/banks',{'name':'大厅回归 '+token,'subject':'PMP','visibility':'private'})['bank'];ids=[]
        for i in range(20):
            q=call('post',f'/api/v1/banks/{bank["id"]}/questions',{'title':f'大厅第{i+1}题','subject':'PMP','type':'single_choice','stemParts':[{'text':'如何处理已识别风险？'}],'options':[{'id':'A','text':'分析并响应风险'},{'id':'B','text':'忽略风险'}],'correctAnswer':'A','analysis':'应当分析风险并选择响应措施。','metadata':{'subjectFacets':[{'dimensionId':'exam-domain','valueId':'process'}],'knowledge':{'taxonomyId':published[i]['taxonomyId'],'primaryNodeId':published[i]['primaryNodeId'],'pathSnapshot':published[i]['path']}}})['question'];ids.append(q['id'])
        papers=[]
        for name,access in [('敏捷精讲练习','free'),('预测专题练习','free'),('专项会员练习','member')]:
            paper=call('post','/api/v1/papers',{'name':name+' '+token,'subject':'PMP','totalCount':20,'questions':[{'bankId':bank['id'],'questionId':qid,'order':i+1,'score':1} for i,qid in enumerate(ids)]})['paper']
            release=call('post',f'/api/v1/paper-releases/papers/{paper["id"]}/publish',{'revision':paper['revision'],'accessLevel':access,'enabledModes':['practice_mode'],'allowedRoles':['student','teacher','admin'],'metadata':{}})['release'];papers.append({'id':paper['id'],'releaseId':release['id'],'name':paper['name'],'access':access})
        fixture={'papers':papers,'questions':ids,'knowledgeNodes':published,'knowledgeFixture':2};fixture_file.write_text(json.dumps(fixture))
    assert fixture.get('knowledgeFixture')==2,'Use a fresh output directory: old fixture predates frozen knowledge references'
    call('delete','/api/v1/learning/practice/sessions')
    for favorite in call('get','/api/v1/question-favorites?limit=50')['favorites']:call('post','/api/v1/question-favorites/'+favorite['questionId']+'/toggle',{})
    page.reload(wait_until='networkidle');page.wait_for_function('document.querySelectorAll("#practicePaperLibrary [data-paper-id]").length>=4')
    def choose(index=0):page.locator('#practicePaperLibrary [data-paper-id="'+fixture['papers'][index]['id']+'"]').click();page.wait_for_timeout(250)
    choose();checks.append('real catalog and four modes')
    assert page.locator('.practice-mode-card').count()==4
    for label in ['普通练习','挑战模式','学霸模式','复仇模式']:assert page.get_by_role('heading',name=label,exact=True).count()==1,label
    page.locator('#practiceLibrarySearch').fill('找不到的试卷');expect(page.locator('#practicePaperLibrary .practice-paper-empty')).to_contain_text('没有找到');page.locator('#practiceLibraryClear').click();expect(page.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(4)
    page.locator('#practiceLibraryFilters [data-paper-filter="member"]').click();expect(page.locator('#practicePaperLibrary [data-paper-id]')).to_have_count(1);page.locator('#practiceLibraryClear').click();page.locator('#practiceLibrarySubject').select_option('PMP');page.locator('#practiceLibraryClear').click();checks.append('search, free/member, subject and clear')
    page.locator('#practiceLibraryMoreBtn').click();expect(page.locator('#practicePaperDrawer')).to_be_visible();page.keyboard.press('Escape');expect(page.locator('#practicePaperDrawer')).to_be_hidden()
    for mode in ['challenge','scholar']:
        help=page.locator('.'+mode+' .practice-lobby-help');help.locator('summary').click();expect(help).to_have_attribute('open','');page.keyboard.press('Escape');assert not help.evaluate('e=>e.open')
    page.locator('#practiceRevengeRuleTrigger').click();expect(page.locator('#practiceRevengeRuleTooltip')).to_be_visible();page.keyboard.press('Escape');page.locator('.practice-revenge-options summary').click();expect(page.locator('#practiceRevengePendingCount')).to_be_visible();page.locator('.practice-revenge-options summary').click();checks.append('rule disclosure and all revenge batch controls')
    assert page.locator('[data-lobby-open="reports"]').count()==0,'duplicate reports entry must stay absent'
    for button,drawer,close in [('#practiceHistoryOpenBtn','#practiceHistoryDrawer','#practiceHistoryCloseBtn'),('#practiceFavoritesOpenBtn','#practiceFavoritesDrawer','#practiceFavoritesCloseBtn')]:
        page.locator(button).click();expect(page.locator(drawer)).to_be_visible();page.locator(close).click()
    page.locator('[data-lobby-open="account"]').click();expect(page.locator('#userCenterModal')).to_be_visible();page.keyboard.press('Escape');checks.append('sidebar history, favorites and account actions; recent report replay is tested below')
    # A failed preview fetch must expose retry without stale/private rows.
    page.route('**/api/v1/learning/practice/sessions',lambda route:route.fulfill(status=503,json={'detail':'temporary'}))
    page.locator('#practiceRecentFavoritesTab').click();page.locator('#practiceRecentHistoryTab').click();expect(page.locator('[data-recent-retry]')).to_be_visible();expect(page.locator('#practiceRecentBody tr')).to_have_count(0)
    page.unroute('**/api/v1/learning/practice/sessions');page.locator('[data-recent-retry]').click();expect(page.locator('[data-recent-retry]')).to_be_hidden();checks.append('preview error clears rows and retries')
    # Each mode starts and saves through its original API-backed workflow.
    call('delete','/api/v1/learning/practice/sessions')
    for mode in ['practice','challenge','scholar']:
        choose();page.locator('#practiceCountOptions label:has([value="20"])').click();page.locator('.practice-order-options label:has([value="random"])').click()
        page.locator('[data-practice-start="'+mode+'"]').click();page.wait_for_function('(mode)=>KGPracticeMode.snapshot().active&&KGPracticeMode.snapshot().mode===mode',arg=mode)
        assert page.evaluate('KGPracticeMode.snapshot().questionCount')==20
        click_tool(page, '#practiceExitBtn');expect(page.locator('#practiceExitConfirm')).to_be_visible();page.locator('#practiceSaveExitBtn').click();page.wait_for_function('KGPracticeMode.snapshot().view==="lobby"')
    expect(page.locator('#practiceRecentBody tr')).to_have_count(3);checks.append('ordinary/challenge/scholar start and save, real records preview')
    page.wait_for_timeout(500);page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
    # Resume an actual ordinary attempt, create a wrong answer and settle it.
    page.locator('[data-recent-resume]').last.click();page.wait_for_function('KGPracticeMode.snapshot().active');assert page.evaluate('KGPracticeMode.snapshot().mode')=='practice'
    page.locator('[data-option-id="B"]').click();page.wait_for_timeout(700)
    click_tool(page, '#practiceFavoriteBtn');page.wait_for_timeout(350)
    page.locator('#practiceAnswerSheetMobileBtn').click();assert page.locator('[data-answer-submit]').count()==0,'ordinary retains automatic completion';page.keyboard.press('Escape')
    for index in range(1,20):
        page.locator('#practiceNextBtn').click();page.wait_for_function('(i)=>KGPracticeMode.snapshot().index===i',arg=index);page.locator('[data-option-id="A"]').click()
    page.wait_for_function('KGPracticeMode.snapshot().view==="result"')
    page.locator('[data-report-lobby]').click();page.wait_for_function('KGPracticeMode.snapshot().view==="lobby"');page.wait_for_timeout(500)
    page.locator('[data-recent-report]').click();page.wait_for_function('KGPracticeMode.snapshot().view==="result"');page.locator('[data-report-lobby]').click();checks.append('preview resume, settled report and real favorites')
    # Full published catalog plus the exact server-owned practiced overlay. No success mocks.
    dashboard_path=universe_path
    identities={(node['taxonomyId'],node['primaryNodeId']) for node in fixture['knowledgeNodes']}
    def verify_universe(data,attempts=20):
        assert data['topicCount']==len(catalog_nodes) and len(data['nodes'])==len(catalog_nodes)
        assert data['attemptCount']==attempts and data['practicedTopicCount']==20 and data['unpracticedTopicCount']==len(catalog_nodes)-20
        assert {(node['taxonomyId'],node['primaryNodeId']) for node in data['nodes'] if node['practiced']}==identities
        assert all(node['brightness']==.12 and node['attemptCount']==0 and node['proficiencyScore'] is None for node in data['nodes'] if not node['practiced'])
    saved=call('get',dashboard_path);verify_universe(saved)
    assert {node['proficiencyScore'] for node in saved['nodes'] if node['practiced']}=={0,27.3}
    with page.expect_response(lambda response:dashboard_path in response.url) as opened:
        page.locator('#practiceKnowledgeDashboardOpen').click()
    actual=opened.value.json();verify_universe(actual)
    knowledge=page.get_by_role('dialog',name='星空知识网络');expect(knowledge).to_be_visible()
    expect(knowledge.locator('canvas')).to_have_count(1)
    expect(knowledge.locator('[data-knowledge-summary]')).to_contain_text('累计 20 次作答')
    expect(knowledge.locator('[data-knowledge-page-count]')).to_have_text(f"全部 {len(catalog_nodes)} 个考点")
    first=actual['nodes'][0]
    expect(knowledge.locator('[data-knowledge-detail-title]')).to_have_text(first['title'])
    expect(knowledge.locator('[data-knowledge-detail-path]')).to_have_text(' / '.join(first['path']))
    knowledge.locator('[data-knowledge-list-toggle]').click()
    expect(knowledge.locator('[data-knowledge-list] button')).to_have_count(len(catalog_nodes))
    practiced_index=next(i for i,node in enumerate(actual['nodes']) if node['practiced'])
    knowledge.locator('[data-knowledge-list] button').nth(practiced_index).click()
    expect(knowledge.locator('[data-knowledge-detail-title]')).to_have_text(actual['nodes'][practiced_index]['title'])
    expect(knowledge.locator('[data-knowledge-detail-attempts]')).to_have_text('1 次')
    page.screenshot(path=str(OUT/'knowledge-space-real-api.png'),full_page=True)
    knowledge.locator('[data-knowledge-close]').click();expect(knowledge).to_be_hidden()
    expect(page.locator('#practiceKnowledgeDashboardOpen')).to_be_focused()
    with page.expect_response(lambda response:dashboard_path in response.url) as reopened:
        page.locator('#practiceKnowledgeDashboardOpen').click()
    persisted=reopened.value.json();verify_universe(persisted)
    assert persisted['nodes']==actual['nodes']
    expect(knowledge.locator('canvas')).to_have_count(1);page.keyboard.press('Escape')
    page.reload(wait_until='networkidle')
    with page.expect_response(lambda response:dashboard_path in response.url) as refreshed:
        page.locator('#practiceKnowledgeDashboardOpen').click()
    assert refreshed.value.json()['nodes']==actual['nodes'];page.keyboard.press('Escape')
    checks.append('real UI practice: full published catalog, exact 20-node overlay, unpracticed dark, reopen and page refresh persistence')
    # Complete authoritative server sessions with differing answer histories; never inject correctness.
    snapshots=[saved]
    for correct in (True,True,False):
        session=call('post','/api/v1/learning/practice/sessions/start',{'paperId':fixture['papers'][0]['id'],'releaseId':fixture['papers'][0]['releaseId'],'mode':'practice','count':20,'order':'paper'})['session']
        answers={qid:{'selectedAnswer':'A' if correct else 'B','selectionIndex':index+1} for index,qid in enumerate(fixture['questions'])}
        result=call('post',f"/api/v1/learning/practice/sessions/{session['id']}/complete",{'revision':session['revision'],'answers':answers})
        assert result['report']['counts']['correct']==(20 if correct else 0)
        snapshots.append(call('get',dashboard_path))
    def node_at(data,identity):return next(node for node in data['nodes'] if (node['taxonomyId'],node['primaryNodeId'])==identity)
    correct_identity=next((node['taxonomyId'],node['primaryNodeId']) for node in saved['nodes'] if node['proficiencyScore']==27.3)
    scored=[node_at(snapshot,correct_identity) for snapshot in snapshots]
    assert scored[0]['proficiencyScore']<scored[1]['proficiencyScore']<scored[2]['proficiencyScore']
    assert scored[3]['proficiencyScore']<scored[2]['proficiencyScore'] and scored[3]['brightness']<scored[2]['brightness']
    verify_universe(snapshots[-1],80)
    (OUT/'universe-api-evidence.json').write_text(json.dumps({'catalogCount':len(catalog_nodes),'practicedIdentities':sorted(identities),'scoreHistory':scored,'final':snapshots[-1]},ensure_ascii=False,indent=2))
    with page.expect_response(lambda response:dashboard_path in response.url) as updated:
        page.locator('#practiceKnowledgeDashboardOpen').click()
    assert updated.value.json()['nodes']==snapshots[-1]['nodes'];page.keyboard.press('Escape')
    checks.append('real completed API sessions increase proficiency and brightness with correct practice; an error lowers both; refreshed panel reads persisted result')
    page.locator('#practiceRecentFavoritesTab').click();expect(page.locator('[data-recent-favorite]')).to_have_count(1);page.locator('[data-recent-favorite]').click();expect(page.locator('#practiceFavoriteDetail')).to_be_visible();page.keyboard.press('Escape');page.locator('#practiceRecentHistoryTab').click()
    page.locator('[data-practice-start="revenge"]').click();page.wait_for_function('KGPracticeMode.snapshot().active&&KGPracticeMode.snapshot().mode==="revenge"');click_tool(page, '#practiceExitBtn');page.locator('#practiceSaveExitBtn').click();page.wait_for_function('KGPracticeMode.snapshot().view==="lobby"');checks.append('revenge mode retained with real wrong-question pool')
    # Mobile: no viewport overflow, all four modes and all help/actions remain reachable.
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(250)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),page.evaluate('document.documentElement.scrollWidth')
    for mode in ['challenge','scholar']:
        help=page.locator('.'+mode+' .practice-lobby-help');help.locator('summary').click();box=help.locator('.practice-help-content').bounding_box();assert box['x']>=0 and box['x']+box['width']<=390,box;page.keyboard.press('Escape')
    page.locator('#practiceExpFab').click();expect(page.locator('#practiceExpPanel')).to_be_visible();page.locator('#practiceExpFab').click();checks.append('390px layout, accessible rules and XP controls')
    for button in ['#practiceHistoryOpenBtn','#practiceFavoritesOpenBtn']:
        assert page.locator(button+' span').last.is_visible(),button+' mobile navigation label'
    page.evaluate('scrollTo(0,0)');page.screenshot(path=str(OUT/'mobile.png'),full_page=True)
    # Real account logout must remove private preview rows and open the existing auth dialog.
    page.locator('#authStatus').click();page.locator('#accountMenuSessionBtn').click()
    page.wait_for_function('!KGAuthCore.currentUser()');expect(page.locator('#practiceRecentBody tr')).to_have_count(0)
    page.set_viewport_size({'width':1440,'height':1000});expect(page.locator('#practiceExpPanel')).to_be_hidden();expect(page.locator('#practiceExpTotal')).to_have_text('0')
    for mode in ['practice','challenge','scholar','revenge']:
        page.locator('[data-practice-start="'+mode+'"]').click();expect(page.locator('#authModal')).to_be_visible();page.keyboard.press('Escape')
        assert not page.evaluate('KGPracticeMode.snapshot().active')
    checks.append('real logout clears private preview; all four guest starts require login')
    student=browser.new_context(viewport={'width':1440,'height':1000})
    response=student.request.post(BASE+'/api/v1/auth/login',data={'username':'学生','password':'111111'});assert response.ok
    sp=student.new_page()
    if args.source_overrides:
        sp.route('**/styles/**',source_asset);sp.route('**/src/**',source_asset)
    sp.goto(BASE+'/practice-mode.html',wait_until='networkidle')
    sp.locator('#practicePaperLibrary [data-paper-id="'+fixture['papers'][2]['id']+'"]').click()
    for mode in ['practice','challenge','scholar']:
        sp.locator('[data-practice-start="'+mode+'"]').click();expect(sp.locator('#userSubscriptionDetailModal')).to_be_visible();sp.keyboard.press('Escape')
        assert not sp.evaluate('KGPracticeMode.snapshot().active')
    expect(sp.locator('#practiceRecentBody tr')).to_have_count(0)
    other=student.request.get(BASE+universe_path);assert other.ok
    isolated=other.json();assert isolated['topicCount']==len(catalog_nodes) and isolated['practicedTopicCount']==0
    assert all(not node['practiced'] and node['attemptCount']==0 and node['brightness']==.12 for node in isolated['nodes'])
    sp.locator('#practiceKnowledgeDashboardOpen').click()
    expect(sp.locator('[data-knowledge-list] button')).to_have_count(len(catalog_nodes))
    expect(sp.locator('[data-knowledge-summary]')).to_contain_text('已练 0')
    sp.keyboard.press('Escape')
    checks.append('non-member student blocks membership paper in three catalog modes; isolated preview')
    student.close()
    assert not errors,errors
    (OUT/'browser-results.json').write_text(json.dumps({'apiMocks':'error-only route for recovery test','checks':checks,'pageErrors':errors},ensure_ascii=False,indent=2))
    browser.close()
print(json.dumps(checks,ensure_ascii=False))
