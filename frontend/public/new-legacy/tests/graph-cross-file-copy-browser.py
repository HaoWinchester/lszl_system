"""AC06 base scenarios using explicit clipboard events and isolated file API fixtures."""
import argparse,json,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
def check_new_file(pw,browser,base,source_override=False,username='ink-browser',password='ink-browser-test',role='teacher',evidence=None):
    ctx=browser.new_context(viewport={'width':1440,'height':1000})
    login=ctx.request.post(base+'/api/v1/auth/login',data={'username':username,'password':password})
    assert login.ok,login.text()
    assert login.json()['user']['role']==role,login.text()
    source={'meta':{'title':'原始图谱'},'nodes':[{'id':'new-source','title':'原图内容','x':150,'y':150}],'links':[]}
    created=ctx.request.post(base+'/api/v1/files',data={'name':'新建来源'+uuid.uuid4().hex[:8],'graphData':source})
    assert created.ok,created.text();source_id=created.json()['file']['id']
    assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':source_id}).ok
    page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script('window.prompt=()=>null')
    if source_override:
        bundle=(ROOT/'frontend/public/new-legacy/bundles/home-graph.js').read_text()
        suffix='\n//# sourceURL=src/25-graph-file-tabs.js'
        old_source=json.dumps((ROOT/'frontend/public/new-legacy/src/25-graph-file-tabs.js').read_text().rstrip()+suffix,ensure_ascii=False)
        assert old_source in bundle, 'The source override must replace the actual tabs module'
        bundle=bundle.replace(old_source,json.dumps((ROOT/'new-legacy/src/25-graph-file-tabs.js').read_text().rstrip()+suffix,ensure_ascii=False))
        page.route('**/bundles/home-graph.js*',lambda route:route.fulfill(content_type='application/javascript',body=bundle))
        shell=(ROOT/'frontend/public/new-legacy/bundles/home-shell.css').read_text()
        old_css=(ROOT/'frontend/public/new-legacy/styles/graph-file-tabs.css').read_text().rstrip()
        assert old_css in shell
        shell=shell.replace(old_css,(ROOT/'new-legacy/styles/graph-file-tabs.css').read_text().rstrip())
        page.route('**/bundles/home-shell.css*',lambda route:route.fulfill(content_type='text/css',body=shell))
    def name_dialog(name=None,cancel=False):
        page.locator('#graphFileAddBtn').click()
        dialog=page.locator('#graphNewFileDialog')
        expect(dialog).to_be_visible()
        assert page.locator('#graphNewFileDialog').count()==1
        if evidence:page.screenshot(path=str(evidence/f'{role}-naming-dialog.png'))
        if cancel:page.keyboard.press('Escape')
        else:
            dialog.get_by_label('图谱名称').fill(name)
            dialog.get_by_label('图谱名称').press('Enter')
    def ready():
        page.wait_for_function('window.KGGraphFileTabs && window.KGGraphFileRemoteAdapter?.getCurrentFileMeta()?.id && !KGGraphFileTabs.isSwitching()')
        for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
            if page.locator(selector).is_visible():page.locator(selector).click()
    def files():
        response=ctx.request.get(base+'/api/v1/files');assert response.ok,response.text();return response.json()['files']
    page.goto(base+'/index.html?mode=free',wait_until='networkidle');ready()
    assert page.evaluate('KGGraphFileEditorStoreBridge.isRemote()'), 'Use the real default Files API, not a local-store stub'
    initial_count=len(files());name_dialog(cancel=True)
    page.wait_for_function('!KGGraphFileTabs.isSwitching()')
    assert len(files())==initial_count and page.evaluate('KGGraphFileRemoteAdapter.getCurrentFileMeta().id')==source_id
    page.evaluate("()=>{window.prompt=()=>{throw new Error('Native prompt is unsupported by this browser host')}}")
    page.locator('#graphFileAddBtn').evaluate('(button)=>{button.click();button.click()}')
    dialog=page.locator('#graphNewFileDialog');expect(dialog).to_be_visible()
    assert dialog.count()==1, 'Repeated plus clicks must not create multiple dialogs'
    dialog.get_by_label('图谱名称').fill(' ');dialog.get_by_label('图谱名称').press('Enter')
    expect(dialog.get_by_role('alert')).to_have_text('请输入图谱名称。')
    dialog.get_by_role('button',name='取消',exact=True).click()
    page.wait_for_function('!KGGraphFileTabs.isSwitching()');assert len(files())==initial_count
    page.evaluate("KGGraphModel.updateContent(state.nodes[0],{title:'尚未保存的原图修改'});KGGraphFileAutosave.markDirty('new-file-regression')")
    # A failed source save must cancel creation and keep its draft in the editor.
    ctx.set_offline(True)
    name_dialog('应取消的新图')
    page.wait_for_function('!KGGraphFileTabs.isSwitching()')
    assert len(files())==initial_count
    assert page.evaluate('state.nodes[0].title')=='尚未保存的原图修改'
    ctx.set_offline(False)
    assert page.evaluate('KGGraphFileTabs.manualSave()') is True
    # Failed create requests remain recoverable without replacing the source.
    ctx.set_offline(True)
    name_dialog('失败后可重试')
    page.wait_for_function('!KGGraphFileTabs.isSwitching()')
    assert len(files())==initial_count and page.evaluate('KGGraphFileRemoteAdapter.getCurrentFileMeta().id')==source_id
    ctx.set_offline(False)
    new_name='独立新图'+uuid.uuid4().hex[:6]
    name_dialog(new_name)
    page.wait_for_function('(source)=>!KGGraphFileTabs.isSwitching() && KGGraphFileRemoteAdapter.getCurrentFileMeta()?.id!==source',arg=source_id)
    new_id=page.evaluate('KGGraphFileRemoteAdapter.getCurrentFileMeta().id')
    assert page.evaluate('state.nodes.length')==0
    if evidence:page.screenshot(path=str(evidence/f'{role}-new-empty.png'))
    expect(page.locator('.graph-file-tab[data-file-id="'+source_id+'"]')).to_have_count(1)
    expect(page.locator('.graph-file-tab[data-file-id="'+new_id+'"]')).to_have_count(1)
    assert len(files())==initial_count+1
    original=ctx.request.get(base+'/api/v1/files/'+source_id).json()['graphData']
    assert original['nodes'][0]['title']=='尚未保存的原图修改'
    page.evaluate("state.nodes.push(makeNode('新图独立内容',100,100,'#2563eb'));render({persist:true})")
    assert page.evaluate('persistCurrentGraphNow()') is True
    page.reload(wait_until='networkidle');ready();assert page.evaluate('state.nodes[0].title')=='新图独立内容'
    page.locator('.graph-file-tab[data-file-id="'+source_id+'"] .graph-file-tab-title').click()
    page.wait_for_function('(id)=>KGGraphFileRemoteAdapter.getCurrentFileMeta()?.id===id && !KGGraphFileTabs.isSwitching()',arg=source_id)
    assert page.evaluate('state.nodes[0].title')=='尚未保存的原图修改'
    if evidence:page.screenshot(path=str(evidence/f'{role}-source-restored.png'))
    assert not errors,errors
    ctx.close()
    print(f'PASS {role}: real login, DOM naming/cancel/validation, offline save/create recovery, independent empty file, persistence and tab switching',flush=True)
    return {'role':role,'username':username,'status':'passed','sourceId':source_id,'newId':new_id,'checks':['native-prompt-unavailable','name-dialog','escape','cancel','empty-name','repeat-click','source-save-offline','create-offline-retry','independent-empty-file','source-preserved','save-reload','switch-original']}

def check_readonly_file(browser,base,role,evidence,username=None,password=None,source_ids=None):
    ctx=browser.new_context(viewport={'width':1440,'height':1000})
    if username:
        login=ctx.request.post(base+'/api/v1/auth/login',data={'username':username,'password':password})
        assert login.ok,login.text();assert login.json()['user']['role']==role
    page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script("window.prompt=()=>{throw new Error('Native prompts unavailable')}")
    page.goto(base+'/index.html?mode=free',wait_until='networkidle')
    page.wait_for_function('window.KGGraphFileTabs && window.KGGraphModel')
    for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
        if page.locator(selector).is_visible():page.locator(selector).click()
    original=ctx.request.get(base+'/api/v1/files/'+source_ids[0]).json()['graphData'] if source_ids else None
    if page.locator('#graphFileAddBtn').is_enabled():page.locator('#graphFileAddBtn').click()
    page.wait_for_function('!KGGraphFileTabs.isSwitching()')
    assert page.locator('#graphNewFileDialog').count()==0, f'{role} cannot open create UI'
    page.screenshot(path=str(evidence/f'{role}-create-blocked.png'))
    expected=403 if username else 401
    denied=ctx.request.post(base+'/api/v1/files',data={'name':'不应创建','graphData':{'nodes':[],'links':[]}})
    assert denied.status==expected,(role,'create',denied.status)
    target=source_ids[0] if source_ids else 'guest-denied'
    denied=ctx.request.put(base+'/api/v1/files/'+target,data={'graphData':{'nodes':[],'links':[]},'expectedRevision':1})
    assert denied.status==expected,(role,'save',denied.status)
    checks=['native-prompt-unavailable','create-ui-blocked',f'create-api-{expected}',f'save-api-{expected}']
    if source_ids:
        for fid in reversed(source_ids):
            page.locator('.graph-file-tab[data-file-id="'+fid+'"] .graph-file-tab-title').click()
            page.wait_for_function('(id)=>KGGraphFileRemoteAdapter.getCurrentFileMeta()?.id===id && !KGGraphFileTabs.isSwitching()',arg=fid)
        page.reload(wait_until='networkidle')
        page.wait_for_function('(id)=>window.KGGraphFileRemoteAdapter?.getCurrentFileMeta()?.id===id',arg=source_ids[0])
        assert ctx.request.get(base+'/api/v1/files/'+source_ids[0]).json()['graphData']==original
        page.screenshot(path=str(evidence/f'{role}-browse-reload.png'))
        checks+=['read-own-content','switch-cursor','reload-cursor','original-unchanged']
    assert not errors,errors
    ctx.close();print(f'PASS {role}: '+', '.join(checks),flush=True)
    return {'role':role,'username':username,'status':'passed','checks':checks}

def check_role_matrix(pw,browser,base,evidence):
    evidence.mkdir(parents=True,exist_ok=True)
    run=uuid.uuid4().hex[:8];password='new-files-role-test';admin=pw.request.new_context()
    login=admin.post(base+'/api/v1/auth/login',data={'username':'admin','password':'jbgsnmm~123'})
    assert login.ok, 'Disposable fixture admin login failed; no real account will be modified'
    accounts={role:f'newfiles_{role}_{run}' for role in ['admin','teacher','student','viewer']}
    viewer_sources=[]
    for role,username in accounts.items():
        created=admin.post(base+'/api/v1/users',data={'username':username,'password':password,'role':'student' if role=='viewer' else role,'subject':'PMP'})
        assert created.ok,created.text()
        if role=='viewer':
            setup=pw.request.new_context();assert setup.post(base+'/api/v1/auth/login',data={'username':username,'password':password}).ok
            for index in (1,2):
                result=setup.post(base+'/api/v1/files',data={'name':f'只读原图{index}','graphData':{'nodes':[{'id':f'viewer-{index}','title':f'只读原内容{index}'}],'links':[]}})
                assert result.ok,result.text();viewer_sources.append(result.json()['file']['id'])
            assert setup.put(base+'/api/v1/files/current',data={'fileId':viewer_sources[0]}).ok
            setup.dispose();changed=admin.put(base+'/api/v1/users/'+username,data={'role':'viewer'});assert changed.ok,changed.text()
    results=[]
    for role in ['admin','teacher','student','viewer','guest']:
        try:
            if role in ['admin','teacher','student']:
                result=check_new_file(pw,browser,base,username=accounts[role],password=password,role=role,evidence=evidence)
            else:
                result=check_readonly_file(browser,base,role,evidence,accounts.get(role),password,viewer_sources if role=='viewer' else None)
            results.append(result)
        except Exception as error:
            print(f'FAIL {role}: {error}',flush=True)
            results.append({'role':role,'username':accounts.get(role),'status':'failed','error':str(error)})
            for context in browser.contexts:
                for page in context.pages:
                    try:page.screenshot(path=str(evidence/f'{role}-failure.png'))
                    except Exception:pass
                context.close()
    isolation=[]
    for role in ['admin','teacher','student','viewer','guest']:
        client=pw.request.new_context()
        if role!='guest':assert client.post(base+'/api/v1/auth/login',data={'username':accounts[role],'password':password}).ok
        for owner in results:
            if not owner.get('newId') or owner['role']==role:continue
            response=client.get(base+'/api/v1/files/'+owner['newId'])
            expected=401 if role=='guest' else 404
            isolation.append({'role':role,'foreignOwner':owner['role'],'status':response.status,'expected':expected})
        client.dispose()
    report={'run':run,'baseUrl':base,'version':admin.get(base+'/VERSION').text().strip(),'roles':results,'isolation':isolation,'faultInjection':'Browser offline/online only; no mocked business responses'}
    (evidence/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    admin.dispose()
    assert all(item['status']==item['expected'] for item in isolation),isolation
    assert all(item['status']=='passed' for item in results),results
    print('PASS five-role new-file matrix and cross-account API isolation; evidence: '+str(evidence),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);parser.add_argument('--new-file-only',action='store_true');parser.add_argument('--source-override',action='store_true');parser.add_argument('--role-matrix',action='store_true');parser.add_argument('--evidence-dir',default=str(ROOT/'artifacts/window-role-qa/new-files'));args=parser.parse_args();base=args.base_url.rstrip('/')
    assert base.startswith('http://127.0.0.1:')
    out=ROOT/'artifacts/canvas-m2-m5/t07';out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=args.new_file_only or args.role_matrix)
        if args.role_matrix:
            assert not args.source_override, 'Role QA must use the actual synced public assets'
            check_role_matrix(pw,browser,base,Path(args.evidence_dir));browser.close();return
        if args.new_file_only:
            check_new_file(pw,browser,base,args.source_override);browser.close();return
        ctx=browser.new_context(viewport={'width':1440,'height':1000})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
        graph={'nodes':[{'id':'a','title':'源正文','notes':'详细资料','geometry':{'x':150,'y':200,'width':260,'height':100},'cardStyle':'rounded','color':'#db2777'},{'id':'b','title':'第二卡片','geometry':{'x':550,'y':300,'width':200,'height':150}},{'id':'c','title':'未选中','geometry':{'x':300,'y':500,'width':200,'height':100}}],'links':[{'id':'ab','from':'a','to':'b','fromPort':'left','toPort':'top','pathStyle':'curve','curveControls':[{'x':50,'y':250},{'x':650,'y':220}]},{'id':'ac','from':'a','to':'c'}]}
        files=[]
        for name,data in [('A',graph),('B',{'nodes':[],'links':[]})]:
            r=ctx.request.post(base+'/api/v1/files',data={'name':'片段'+name+uuid.uuid4().hex[:6],'graphData':data});assert r.ok;files.append(r.json()['file'])
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':files[0]['id']}).ok
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        def ready(p):
            p.wait_for_load_state('networkidle');p.wait_for_function('!!window.KGGraphFileTabs && !!window.KGGraphModel')
            for selector in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
                if p.locator(selector).is_visible():p.locator(selector).click()
            p.locator('.graph-mode-trigger').click();p.locator('[data-graph-mode-option="professional"]').click();p.wait_for_function('!KGGraphFileTabs.isSwitching()')
        page.goto(base+'/index.html',wait_until='networkidle');ready(page)
        before=page.evaluate('JSON.stringify(saveableState())')
        page.locator('.knowledge-card[data-node-id="a"]').click();page.locator('.knowledge-card[data-node-id="b"]').click(modifiers=['Control'])
        # Real keyboard dispatch triggers native copy; read the application session fragment afterward.
        page.keyboard.press('Meta+c')
        fragment=page.evaluate('KGGraphKernel.clipboard.readFragment()')
        assert len(fragment['nodes'])==2 and len(fragment['links'])==1,fragment
        page.locator('.graph-file-tab[data-file-id="'+files[1]['id']+'"]').click();page.wait_for_function('state.nodes.length===0 && !KGGraphFileTabs.isSwitching()')
        def paste(p,text):
            return p.evaluate("""(text)=>{const d=new DataTransfer();d.setData('text/plain',text);const e=new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true});document.dispatchEvent(e);return e.defaultPrevented}""",text)
        assert paste(page,json.dumps(fragment));assert paste(page,json.dumps(fragment))
        # T16: 跨文件粘贴走服务端受控端点（异步），等待串行粘贴完成后断言。
        page.wait_for_function('state.nodes.length===4')
        copied=page.evaluate('saveableState()');assert len(copied['nodes'])==4 and len(copied['links'])==2
        ids=[n['id'] for n in copied['nodes']];assert len(set(ids))==4 and not set(ids)&{'a','b','c'}
        assert all(l['from'] in ids and l['to'] in ids and l['fromPort']=='left' and l['toPort']=='top' for l in copied['links'])
        assert copied['nodes'][1]['x']-copied['nodes'][0]['x']==400
        assert copied['nodes'][0]['notes']=='详细资料' and copied['nodes'][0]['cardStyle']=='rounded'
        old=page.evaluate('JSON.stringify(saveableState())');assert not paste(page,'{"format":"kg-graph-fragment","version":99}')
        assert page.evaluate('JSON.stringify(saveableState())')==old
        page.evaluate("KGGraphModel.updateContent(state.nodes[0],{title:'目标修改'});render({persist:true})")
        assert page.evaluate('persistCurrentGraphNow()') is True
        page.reload(wait_until='networkidle');ready(page);assert page.evaluate('state.nodes.length')==4
        assert page.evaluate("state.nodes[0].title")=='目标修改'
        assert page.evaluate("state.nodes[2].title")=='源正文','repeated paste shares content'
        # Separate tab receives only the explicit serialized fragment, no background clipboard read.
        tab=ctx.new_page();tab.on('pageerror',lambda e:errors.append(str(e)));tab.goto(base+'/index.html',wait_until='networkidle');ready(tab)
        assert paste(tab,json.dumps(fragment));tab.wait_for_function('state.nodes.length===6')
        # Native textarea editing must leave application fragments and graph untouched.
        tab.evaluate("const t=document.createElement('textarea');t.id='native-copy-test';t.value='文本优先';document.body.append(t);t.focus();t.select()")
        count=tab.evaluate('state.nodes.length');tab.keyboard.press('Meta+c');tab.keyboard.press('Meta+v');assert tab.evaluate('state.nodes.length')==count
        expect(tab.locator('#native-copy-test')).to_have_value('文本优先')
        assert tab.evaluate('KGGraphKernel.clipboard.hasData()')
        tab.evaluate("window.dispatchEvent(new Event('kg-auth-session-change'))")
        # Same account refresh retains clipboard; real logout clears it.
        assert tab.evaluate('KGGraphKernel.clipboard.hasData()')
        page.locator('.graph-file-tab[data-file-id="'+files[0]['id']+'"]').click();page.wait_for_function('state.nodes.some(n=>n.id===\"c\")')
        assert page.evaluate('JSON.stringify(saveableState())')==before,'source changed'
        tab.evaluate('authLogout()');tab.wait_for_function('!KGGraphKernel.clipboard.hasData()')
        assert not errors,errors
        page.screenshot(path=str(out/'cross-file-copy.png'));check_new_file(pw,browser,base);browser.close();print('PASS: AC06 base copy/paste, independent links/ports, reload, cross-tab events, native text, logout')
if __name__=='__main__':main()
