#!/usr/bin/env python3
"""Cross-tab paper preferences must not rebuild selected cards in other tabs.

Run helpers/canvas_ink_server.py --multiple-papers, then this script with
--base-url http://127.0.0.1:5189. Uses only disposable local fixture accounts.
"""
import argparse
import json
from uuid import uuid4
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect


def check_account_switch(p, browser, base):
    """An existing server canvas must win over the next account's stale cache."""
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    server_owner = p.request.new_context()
    workspace_id = 'account-switch-' + uuid4().hex[:12]
    held = []
    try:
        logged_in = server_owner.post(base+'/api/v1/auth/login', data={'username': 'admin', 'password': 'jbgsnmm~123'})
        assert logged_in.ok, logged_in.text()
        payload = {
            'id': workspace_id, 'userId': 'admin', 'title': '账号切换服务器画布', 'schemaVersion': 10,
            'nodes': {f'account-question-{i}': {
                'id': f'account-question-{i}', 'questionId': f'ink-question-{i}',
                'bankId': 'ink-bank', 'paperId': 'ink-paper', 'releaseId': 'ink-release',
                'title': f'服务器题目 {i}', 'x': 100+(i-1)*650, 'y': 120,
                'width': 580, 'height': 500, 'color': '#ffffff',
            } for i in (1, 2)},
            'edges': [], 'groups': [], 'strokes': [], 'tables': [],
        }
        created = server_owner.post(base+'/api/v1/workspaces', data={
            'id': workspace_id, 'title': payload['title'], 'schemaVersion': 10, 'payload': payload,
        })
        assert created.ok, created.text()
        logged_in = context.request.post(base+'/api/v1/auth/login', data={'username': 'ink-browser', 'password': 'ink-browser-test'})
        assert logged_in.ok, logged_in.text()
        page = context.new_page()
        page.goto(base+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release&workspace=account-source-'+uuid4().hex[:12], wait_until='domcontentloaded')
        page.wait_for_function('window.KGWorkspaceInk && window.KGMultiQuestionWorkspace?.getState().questionCount > 0 && KGMultiQuestionWorkspace.activeWorkspace() && !KGMultiQuestionWorkspace.getState().readonly')
        page.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})')
        # The next account has an empty cached copy, while PostgreSQL has two cards.
        page.evaluate('(payload)=>KGCanvasWorkspaceStore.write({...payload,nodes:{}},{activate:true})', payload)

        def delay_workspace_list(route):
            if route.request.method == 'GET':
                held.append((route, route.fetch()))
            else:
                route.continue_()

        page.route(base+'/api/v1/workspaces', delay_workspace_list)
        result = page.evaluate("KGAuthCore.login('admin','jbgsnmm~123',{source:'disposable-account-switch-test'})")
        assert result['ok'], result
        for _ in range(100):
            if held:
                break
            page.wait_for_timeout(50)
        assert held, 'Switching accounts must load the new owner from the server'
        assert page.evaluate('KGMultiQuestionWorkspace.getState().readonly'), 'Editing must stay locked while the account loads'
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace()') is None, 'Do not activate stale cached content before hydration'
        blocked = page.evaluate("KGMultiQuestionWorkspace.addQuestionByReference({questionId:'ink-question-1',bankId:'ink-bank',paperId:'ink-paper',releaseId:'ink-release'})")
        assert blocked['reason'] == 'readonly', blocked
        route, response = held.pop(0)
        route.fulfill(response=response)
        page.wait_for_function('(id)=>KGMultiQuestionWorkspace.activeWorkspace()?.id===id && !KGMultiQuestionWorkspace.getState().readonly', arg=workspace_id)
        expect(page.locator('.qw-question-card')).to_have_count(2)
        page.evaluate('KGMultiQuestionWorkspace.selectNodes(Object.keys(KGMultiQuestionWorkspace.activeWorkspace().nodes))')
        page.evaluate("KGMultiQuestionWorkspace.applySelectionColor('#dbeafe')")
        page.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})')
        loaded = server_owner.get(base+'/api/v1/workspaces/'+workspace_id)
        assert loaded.ok, loaded.text()
        saved = loaded.json()['workspace']['payload']
        assert set(saved['nodes']) == {'account-question-1', 'account-question-2'}, saved
        assert all(node['color'] == '#dbeafe' for node in saved['nodes'].values()), saved
        page.unroute(base+'/api/v1/workspaces', delay_workspace_list)
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function('(id)=>window.KGMultiQuestionWorkspace?.activeWorkspace()?.id===id', arg=workspace_id)
        expect(page.locator('.qw-question-card')).to_have_count(2)
        assert page.evaluate("Object.values(KGMultiQuestionWorkspace.activeWorkspace().nodes).every(n=>n.color==='#dbeafe')")
        # A later server outage must expose cached content as read-only, never as a saved server canvas.
        page.route(base+'/api/v1/workspaces', lambda route: route.fulfill(status=503, content_type='application/json', body='{"detail":"fixture unavailable"}') if route.request.method == 'GET' else route.continue_())
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function("document.body.dataset.workspaceApiUnavailable==='true' && window.KGMultiQuestionWorkspace")
        assert page.evaluate('KGMultiQuestionWorkspace.getState().readonly'), 'Failed hydration must keep cached data read-only'
        blocked = page.evaluate("KGMultiQuestionWorkspace.addQuestionByReference({questionId:'ink-question-1',bankId:'ink-bank',paperId:'ink-paper',releaseId:'ink-release'})")
        assert blocked['reason'] == 'readonly', blocked
        print('PASS: failed server load leaves cached cards read-only', flush=True)
        print('PASS: account switch waits for two server cards, blocks premature edits and saves without cache overwrite', flush=True)
    finally:
        context.close()
        server_owner.delete(base+'/api/v1/workspaces/'+workspace_id)
        server_owner.dispose()


def check_case_width_diagnostics(p, browser, base):
    """Supported wide case cards must not be diagnosed as corrupt geometry."""
    teacher = browser.new_context()
    student = browser.new_context(viewport={'width':1440,'height':1000})
    try:
        assert teacher.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        result=teacher.request.post(base+'/api/v1/question-materials',data={'title':'案例尺寸检查','text':'案例材料：先分析再行动。'})
        assert result.ok,result.text()
        material=result.json()['material'];token=uuid4().hex;rows=[]
        for order in (1,2,0):
            question={'type':'single_choice','title':f'尺寸检查{order}-{token}','scope':'public','subject':'PMP','stemParts':[{'text':'如何处理变更？'}],'options':[{'id':'A','text':'先分析','correct':True},{'id':'B','text':'直接执行'}],'correctAnswer':'A','analysis':'先分析再按流程处理。'}
            if order:question.update(material=material,caseGroup={'id':material['id'],'order':order,'total':2})
            response=teacher.request.post(base+'/api/v1/banks/ink-bank/questions',data=question)
            assert response.ok,response.text()
            q=response.json()['question'];rows.append({'questionId':q['id'],'bankId':'ink-bank','question':q,'order':len(rows)+1})
        response=teacher.request.post(base+'/api/v1/paper-releases/publish-payload',data={'releaseId':'width-release-'+token,'paperId':'width-paper-'+token,'name':'案例尺寸验证','subject':'PMP','paperType':'mixed','publishedBy':'ink-browser','enabledModes':['multi_question_canvas'],'allowedRoles':['teacher','student'],'questions':rows,'questionSnapshots':rows})
        assert response.ok,response.text()
        release=response.json()['release']
        assert student.request.post(base+'/api/v1/auth/login',data={'username':'ink-student','password':'ink-browser-test'}).ok
        page=student.new_page()
        page.goto(base+'/question-workspace.html?paperId='+release['paperId']+'&releaseId='+release['releaseId']+'&workspace=width-'+token,wait_until='networkidle')
        page.wait_for_function('window.KGMultiQuestionWorkspace?.getState().questionCount===3 && !KGMultiQuestionWorkspace.getState().readonly')
        for row in rows:
            page.evaluate('(r)=>KGMultiQuestionWorkspace.addQuestionByReference(r)',{'questionId':row['questionId'],'bankId':'ink-bank','paperId':release['paperId'],'releaseId':release['releaseId']})
        expect(page.locator('.qw-question-card')).to_have_count(3)
        assert page.evaluate('KGMultiQuestionWorkspace.diagnoseLayout().oversized.length')==0,'default 16:9 case cards are supported sizes'
        ids=page.evaluate('''()=>{const nodes=Object.values(KGMultiQuestionWorkspace.activeWorkspace().nodes);return {caseId:nodes.find(n=>document.querySelector('[data-node-id="'+n.id+'"] .qm-card-case-layout')).id,plainId:nodes.find(n=>!document.querySelector('[data-node-id="'+n.id+'"] .qm-card-case-layout')).id}}''')
        page.evaluate('''ids=>{const s=KGCanvasWorkspaceStore;for(const [id,width] of [[ids.caseId,1400],[ids.plainId,1320]]){const n=s.ensure().nodes[id];s.updateNodeLayout(id,{x:n.x,y:n.y,width,height:Math.ceil(width*9/16)});}}''',ids)
        page.wait_for_function("id=>document.querySelector('[data-node-id=\"'+id+'\"]').offsetWidth===1400",arg=ids['caseId'])
        flagged=page.evaluate('KGMultiQuestionWorkspace.diagnoseLayout().oversized.map(x=>x.nodeId)')
        assert flagged==[ids['plainId']],flagged
        print('PASS: default/max-width case cards avoid false warnings; oversized ordinary cards remain diagnosed',flush=True)
    finally:
        student.close();teacher.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--account-switch-only', action='store_true')
    parser.add_argument('--case-diagnostics-only', action='store_true')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    assert urlparse(base).hostname in ('localhost', '127.0.0.1'), 'Local disposable server only'
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
        if args.case_diagnostics_only:
            check_case_width_diagnostics(p, browser, base)
            browser.close()
            return
        if args.account_switch_only:
            check_account_switch(p, browser, base)
            browser.close()
            return
        context = browser.new_context(viewport={'width':1440, 'height':1000})
        response = context.request.post(base+'/api/v1/auth/login', data={'username':'ink-browser', 'password':'ink-browser-test'})
        assert response.ok, response.text()
        pages = []
        errors = []
        for suffix in ('', '-2'):
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base+f'/question-workspace.html?paperId=ink-paper{suffix}&releaseId=ink-release{suffix}&workspace=multitab{suffix}', wait_until='domcontentloaded')
            page.wait_for_function('window.KGWorkspaceInk && window.KGMultiQuestionWorkspace?.getState().questionCount > 0')
            page.evaluate('(ref) => KGMultiQuestionWorkspace.addQuestionByReference(ref)', {'paperId':'ink-paper'+suffix, 'releaseId':'ink-release'+suffix, 'bankId':'ink-bank', 'questionId':'ink-question-'+('2' if suffix else '1')})
            expect(page.locator('.qw-question-card')).to_have_count(1)
            page.evaluate('KGMultiQuestionWorkspace.selectNodes(Object.keys(KGMultiQuestionWorkspace.activeWorkspace().nodes))')
            pages.append(page)
            if not suffix:
                # One foreign preference write isolates the trigger before testing
                # two live workspace tabs (old code can starve their event loops).
                page.wait_for_timeout(1000)
                page.evaluate('window.observedCard = document.querySelector(".qw-question-card")')
                other = context.new_page()
                other.goto(base+'/VERSION')
                other.evaluate("localStorage.setItem('kg_multi_question_paper_selection_v1__ink-browser', 'ink-paper-2')")
                page.wait_for_timeout(1500)
                same = page.evaluate('observedCard === document.querySelector(".qw-question-card")')
                other.close()
                assert same, 'A foreign paper preference replaced the selected card'
                print('PASS: foreign paper preference does not replace the selected card', flush=True)
        # Allow initial page-entry/focus work to finish, then watch DOM identity.
        pages[0].wait_for_timeout(1500)
        for page in pages:
            page.evaluate("""() => {
                window.observedCard = document.querySelector('.qw-question-card');
                window.detachedCards = 0;
                window.cardObserver = new MutationObserver(records => {
                    for (const r of records) for (const n of r.removedNodes)
                        if (n.nodeType === 1 && (n.matches('.qw-question-card') || n.querySelector('.qw-question-card'))) detachedCards++;
                });
                cardObserver.observe(observedCard.parentElement, {childList:true});
            }""")
        pages[0].wait_for_timeout(3000)
        for page, paper in zip(pages, ('ink-paper', 'ink-paper-2')):
            result = page.evaluate("""() => ({paper:KGMultiQuestionWorkspace.getState().paperId,
                selected:KGMultiQuestionWorkspace.getState().selectedNodeIds.length,
                replaced:detachedCards, sameCard:observedCard === document.querySelector('.qw-question-card')})""")
            print(json.dumps(result), flush=True)
            assert result['replaced'] == 0 and result['sameCard'], 'Idle tabs repeatedly replace selected cards'
            assert result['paper'] == paper and result['selected'] == 1, 'Another tab changed this tab selection'
        print('PASS: different papers stay selected without idle card reconstruction', flush=True)
        # Genuine published-catalog storage updates still reach the other tab.
        for key in ('kg_exam_papers_published_v1', 'kg_exam_paper_release_history_v1'):
            pages[0].evaluate('window.observedCard = document.querySelector(".qw-question-card")')
            pages[1].evaluate('(key) => localStorage.setItem(key, JSON.stringify([]))', key)
            pages[0].wait_for_function('observedCard !== document.querySelector(".qw-question-card")')
        print('PASS: published catalog and release-history updates still refresh cards', flush=True)
        assert not errors, errors
        check_account_switch(p, browser, base)
        check_case_width_diagnostics(p, browser, base)
        browser.close()


if __name__ == '__main__':
    main()
