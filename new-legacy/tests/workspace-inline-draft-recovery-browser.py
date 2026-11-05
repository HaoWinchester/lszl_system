#!/usr/bin/env python3
"""Real editable DOM: inline synthesis drafts survive failed and delayed writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'src/77-multi-question-workspace.js').read_text()
library_listener=source[source.index("    global.addEventListener('kg-personal-synthesis-cards-change'"):source.index("    global.addEventListener('focus'",source.index("    global.addEventListener('kg-personal-synthesis-cards-change'"))]
function=source[source.index('  function beginInlineNodeEdit('):source.index('  function beginGroupTitleEdit(',source.index('  function beginInlineNodeEdit('))]
def setup(browser,*,field='title',personal=True):
    page=browser.new_page();page.set_content('<article id="card"><h3 id="edit"></h3><p id="other"></p></article>')
    page.evaluate('''({personal})=>{window.owner='teacher';window.mode='401';window.calls=[];window.notices=[];
    const node={id:'n1',nodeType:'synthesis-card',cardType:'user',title:'原始标题',content:'原始内容',height:180,...(personal?{personalCardId:'pc1',personalCardRevision:1}:{})};
    window.state={workspaceId:'w1',workspaceSession:1,workspace:{id:'w1',nodes:{n1:node}},cards:new Map(),inlineEdit:null};
    window.record={id:'n1',node,element:document.querySelector('#card')};state.cards.set('n1',record);
    window.canEdit=()=>!window.locked;window.store=()=>({currentUserId:()=>owner,updateNode:(id,patch)=>{calls.push({kind:'model',patch});state.workspace.nodes[id]={...state.workspace.nodes[id],...patch};return {node:state.workspace.nodes[id],workspace:state.workspace}}});
    window.workspaceOptions=()=>({workspaceId:state.workspaceId});window.workspaceSnapshot=()=>JSON.parse(JSON.stringify(state.workspace));
    window.PersonalCards={update:(id,input)=>persist('update',id,input),create:input=>persist('create','new-pc',input)};
    window.persist=(kind,id,input)=>{calls.push({kind,id,input});if(mode==='pending')return new Promise((resolve,reject)=>{window.ack=()=>resolve({...input,id,revision:(input.revision||0)+1});window.reject=reject});if(mode!=='ok'){const error=Error('HTTP '+mode);error.status=Number(mode);return Promise.reject(error)}return Promise.resolve({...input,id,revision:(input.revision||0)+1})};
    window.personalCardInput=node=>({title:node.title,content:node.content});window.personalCardNodeFields=card=>({title:card.title,content:card.content,personalCardId:card.id,personalCardRevision:card.revision});
    window.syncRecordNode=(r,node)=>{r.node={...node}};window.pushWorkspaceHistory=()=>calls.push({kind:'history'});
    window.refreshSingleCardMarkup=r=>{calls.push({kind:'render'});r.element.innerHTML='<h3>'+r.node.title+'</h3><p>'+r.node.content+'</p>'};
    window.measureFullCardHeight=()=>220;window.placeCaretAtEnd=()=>{};window.notify=message=>notices.push(message);
    for(const name of ['applyCard','updateEdgesForNodeIds','renderMinimap','positionAnalysisPanels','scheduleSelectionToolbarPosition','renderStructure','updateEdgesGeometry','scheduleLayoutDiagnosis','setCardSelection','hydratePersonalCards'])window[name]=()=>{};
    window.KGAuthCore={currentUsername:()=>owner};window.global=window;
    }''',{'personal':personal})
    page.add_script_tag(content=function)
    page.add_script_tag(content=library_listener)
    page.evaluate('(field)=>beginInlineNodeEdit(document.querySelector("#edit"),"n1",field)',field)
    return page
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    for field,status in [('title','401'),('content','503')]:
        page=setup(browser,field=field);editor=page.locator('#edit');value='  未保存 '+field+' 中文\n继续输入  '
        editor.fill(value);typed=editor.inner_text();html=editor.inner_html();page.evaluate('(status)=>mode=status',status)
        assert page.evaluate('state.inlineEdit.finish(true)') is False
        assert page.evaluate('state.inlineEdit.element===document.querySelector("#edit")')
        assert editor.inner_html()==html;assert editor.inner_text()==typed
        assert editor.evaluate('e=>e.isContentEditable')
        assert page.evaluate('calls.filter(c=>c.kind==="model"||c.kind==="render").length')==0
        page.evaluate("mode='ok'");assert page.evaluate('state.inlineEdit.finish(true)') is True
        assert page.evaluate('state.inlineEdit') is None
        assert page.evaluate('(field)=>state.workspace.nodes.n1[field]',field)==typed.strip()
        page.close()
    # Pending calls deduplicate and never replace newer typed input.
    for personal in [True,False]:
        page=setup(browser,personal=personal);editor=page.locator('#edit');editor.fill('第一版')
        page.evaluate("()=>{mode='pending';window.first=state.inlineEdit.finish(true);window.second=state.inlineEdit.finish(true)}")
        assert page.evaluate('calls.filter(c=>c.kind==="update"||c.kind==="create").length')==1
        editor.fill('等待中继续输入');page.evaluate('ack()')
        assert page.evaluate('Promise.all([first,second])')==[False,False]
        expect(editor).to_have_text('等待中继续输入');assert editor.evaluate('e=>e.isContentEditable')
        page.evaluate("mode='ok'");assert page.evaluate('state.inlineEdit.finish(true)') is True
        assert page.evaluate('state.workspace.nodes.n1.title')=='等待中继续输入'
        assert page.evaluate('calls.filter(c=>c.kind==="create").length')==(0 if personal else 1)
        page.close()
    # Failed drafts may be cancelled; late completions cannot touch a newer editor.
    page=setup(browser);editor=page.locator('#edit');editor.fill('待取消')
    page.evaluate("()=>{mode='pending';window.old=state.inlineEdit.finish(true);window.previous=state.inlineEdit}")
    assert page.evaluate('previous.finish(false)') is True
    assert page.evaluate('state.inlineEdit') is None
    page.evaluate("beginInlineNodeEdit(document.querySelector('#other'),'n1','content')")
    newer=page.locator('#other');newer.fill('新的编辑器');page.evaluate('ack()')
    assert page.evaluate('old') is False
    expect(newer).to_have_text('新的编辑器');assert newer.evaluate('e=>e.isContentEditable')
    assert page.evaluate('calls.filter(c=>c.kind==="model").length')==0
    page.close()
    for switch in ['owner','workspaceId','workspaceSession']:
        page=setup(browser);editor=page.locator('#edit');editor.fill('原上下文草稿')
        page.evaluate("()=>{mode='pending';window.pending=state.inlineEdit.finish(true)}")
        page.evaluate('(key)=>{if(key==="owner")owner="other";else state[key]=key==="workspaceSession"?2:"w2";ack()}',switch)
        assert page.evaluate('pending') is False
        expect(editor).to_have_text('原上下文草稿')
        assert page.evaluate('state.inlineEdit.element===document.querySelector("#edit")')
        assert page.evaluate('calls.filter(c=>c.kind==="model").length')==0
        page.close()
    # A known server create acknowledgement is reused if the local workspace write fails.
    page=setup(browser,personal=False);editor=page.locator('#edit');editor.fill('服务端已创建的草稿')
    page.evaluate("()=>{mode='ok';window.originalStore=store;window.store=()=>({...originalStore(),updateNode:()=>null})}")
    assert page.evaluate('state.inlineEdit.finish(true)') is False
    expect(editor).to_have_text('服务端已创建的草稿')
    page.evaluate('window.store=originalStore')
    assert page.evaluate('state.inlineEdit.finish(true)') is True
    assert page.evaluate('calls.filter(c=>c.kind==="create").length')==1
    page.close()
    # Library events preserve the live DOM and defer the latest summary until cancel.
    page=setup(browser);editor=page.locator('#edit');editor.fill('库刷新期间的草稿')
    page.evaluate('''()=>{window.hydratePersonalCards=cards=>{calls.push({kind:'hydrate',cards});if(state.inlineEdit)refreshSingleCardMarkup(record)};
    for(const revision of [1,2])window.dispatchEvent(new CustomEvent('kg-personal-synthesis-cards-change',{detail:{active:[{id:'other',revision,title:'latest-'+revision}],archived:[]}}))}''')
    expect(editor).to_have_text('库刷新期间的草稿')
    assert page.evaluate('calls.filter(c=>c.kind==="hydrate").length')==0
    assert page.evaluate('state.inlineEdit.finish(false)') is True
    assert page.evaluate('calls.filter(c=>c.kind==="hydrate").length')==1
    assert page.evaluate('calls.find(c=>c.kind==="hydrate").cards[0].revision')==2
    page.close()
    # IME does not submit partial text, and failed blur remains retryable on a later blur.
    page=setup(browser);editor=page.locator('#edit');editor.fill('输入法内容')
    editor.dispatch_event('compositionstart')
    assert page.evaluate('state.inlineEdit.finish(true)') is False
    assert page.evaluate('calls.filter(c=>c.kind==="update").length')==0
    page.evaluate("mode='503'");editor.dispatch_event('compositionend')
    expect(editor).to_have_attribute('data-save-state','failed')
    editor.dispatch_event('blur');page.wait_for_function('calls.filter(c=>c.kind==="update").length===2')
    page.evaluate("mode='ok'");editor.dispatch_event('blur')
    page.wait_for_function('!state.inlineEdit');assert page.evaluate('state.workspace.nodes.n1.title')=='输入法内容'
    page.close()
    browser.close()
print('workspace-inline-draft-recovery-browser: passed')
