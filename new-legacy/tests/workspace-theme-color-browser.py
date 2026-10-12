#!/usr/bin/env python3
"""Real multi-question theme/color checks against disposable FastAPI only."""
import argparse
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--base-url',default='http://127.0.0.1:5189')
parser.add_argument('--diagnose',action='store_true')
parser.add_argument('--background-only',action='store_true')
parser.add_argument('--migration-only',action='store_true')
parser.add_argument('--readonly-only',action='store_true')
parser.add_argument('--settings-only',action='store_true')
args=parser.parse_args()
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1000})
    response=context.request.post(args.base_url+'/api/v1/auth/login',data={'username':'ink-viewer' if args.readonly_only else 'ink-browser','password':'ink-browser-test'})
    assert response.ok,response.text()
    page=context.new_page()
    page.goto(args.base_url+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release',wait_until='networkidle')
    page.wait_for_function('!!window.KGMultiQuestionWorkspace?.activeWorkspace()')
    if args.readonly_only:
        assert page.locator('body').get_attribute('data-qw-readonly')=='1'
        first=page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')
        page.locator('#qwThemeSelect').select_option('neon')
        page.evaluate('KGMultiQuestionWorkspace.renderCards()')
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')==first
        print('PASS readonly legacy document keeps first effective background after theme and rerender')
        browser.close()
        raise SystemExit(0)
    if args.migration_only:
        legacy_id=page.evaluate('''()=>{localStorage.setItem('kg_deep_recall_theme_platform_migrated_v1','1');localStorage.setItem('kg_deep_recall_theme_v1','ocean');const w=KGCanvasWorkspaceStore.createWorkspace('T02旧背景',{activate:false});delete w.background;KGCanvasWorkspaceStore.write(w);return w.id}''')
        page.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})')
        page.goto(args.base_url+'/question-workspace.html?workspace='+legacy_id,wait_until='networkidle')
        captured=page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')
        assert captured['appearance']['backgroundColor']=='#eff6ff',captured
        assert captured['layer']['color']=='rgb(239, 246, 255)',captured
        assert captured.get('surface',{}).get('ink')=='rgba(2,132,199,.08)',captured
        page.locator('#qwThemeSelect').select_option('neon')
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')==captured
        print('PASS first legacy ocean load captures effective blue gradient before theme switches')
        browser.close()
        raise SystemExit(0)
    if args.settings_only:
        a,b=page.evaluate('''async()=>{const s=KGCanvasWorkspaceStore;const a=s.createWorkspace('T02设置A',{activate:false});await KGMultiQuestionWorkspace.loadWorkspace(a.id);KGCanvasAppearanceController.write({pattern:'grid',backgroundColor:'#fff8dc'});const b=s.createWorkspace('T02设置B',{activate:false});await KGMultiQuestionWorkspace.loadWorkspace(b.id);KGCanvasAppearanceController.write({pattern:'solid',backgroundColor:'#eef6ff'});await KGMultiQuestionWorkspace.loadWorkspace(a.id);return [a.id,b.id]}''')
        original=page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')
        page.locator('#qwMinimapToggleBtn').click()
        current=page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')
        assert current['appearance']['backgroundColor']=='#fff8dc',current
        assert current['appearance']['pattern']=='grid',current
        global_before=page.evaluate('KGCanvasAppearanceController.read()')
        page.locator('[data-uc-canvas-settings]').click()
        page.locator('[data-uc-color="#fff1f5"]').click()
        page.locator('[data-uc-cancel]').click()
        assert page.evaluate('KGCanvasAppearanceController.read()')==global_before
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background.appearance.backgroundColor')=='#fff8dc'
        page.locator('[data-uc-canvas-settings]').click()
        page.locator('[data-uc-pattern=solid]').click()
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background.appearance.backgroundColor')=='#fff8dc'
        page.locator('[data-uc-cancel]').click()
        restored=page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')
        assert restored['surface']==original['surface'] and restored['layer']==original['layer'],restored
        assert restored['appearance']['pattern']=='grid'
        page.locator('[data-uc-canvas-settings]').click()
        page.locator('[data-uc-pattern=dots]').click()
        page.locator('[data-uc-confirm]').click()
        page.locator('[data-uc-canvas-settings]').click()
        page.locator('[data-uc-color="#fff1f5"]').click()
        page.evaluate('(id)=>KGMultiQuestionWorkspace.loadWorkspace(id)',b)
        assert page.locator('.uc-settings-backdrop').is_hidden()
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background.appearance.backgroundColor')=='#eef6ff'
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background.appearance.pattern')=='solid'
        page.evaluate('(id)=>KGMultiQuestionWorkspace.loadWorkspace(id)',a)
        saved=page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')
        page.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})')
        response=context.request.get(args.base_url+'/api/v1/workspaces')
        assert response.ok,response.text()
        assert next(w['payload']['background'] for w in response.json()['workspaces'] if w['payload']['id']==a)==saved
        page.reload(wait_until='networkidle')
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background.appearance.backgroundColor')=='#fff8dc'
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background.appearance.pattern')=='dots'
        page.evaluate('document.querySelector("#qwCanvasShell").requestFullscreen()')
        page.wait_for_function('!!document.fullscreenElement')
        page.locator('[data-uc-canvas-settings]').click()
        assert page.locator('.uc-settings-backdrop').evaluate('(e)=>document.fullscreenElement.contains(e)')
        page.locator('[data-uc-pattern=grid]').click()
        page.locator('[data-uc-cancel]').click()
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background.appearance.pattern')=='dots'
        print('PASS A/B document minimap, settings cancel/preview, pattern-only, server/reload and fullscreen settings')
        browser.close()
        raise SystemExit(0)
    ids=page.evaluate('''()=>{const s=KGCanvasWorkspaceStore;const w=s.createWorkspace('T02独立验证',{activate:false});KGMultiQuestionWorkspace.loadWorkspace(w.id);return [0,1].map(i=>s.addSynthesisCard({title:'T02卡片'+i},{x:80+i*500,y:80},{workspaceId:w.id}).node.id)}''')
    page.evaluate('(ids)=>{KGMultiQuestionWorkspace.renderCards();KGMultiQuestionWorkspace.selectNodes(ids)}',ids)
    page.wait_for_timeout(800)
    page.evaluate('(ids)=>KGMultiQuestionWorkspace.selectNodes(ids)',ids)

    page.evaluate('''()=>{window.__pickerCalls=[];const open=KGColorPickerV2.open;window.KGColorPickerV2={...KGColorPickerV2,open(options){__pickerCalls.push({anchor:options.anchor.id,action:options.anchor.dataset.qwSelectionAction});return open(options)}}}''')
    page.locator('[data-qw-selection-action=color]').click()
    panel=page.locator('.graph-floating-color-window')
    if not args.diagnose and not args.background_only:
        assert panel.evaluate('(e)=>getComputedStyle(e).position')=='absolute'
        box=panel.bounding_box()
        assert 200<=box['width']<=420 and box['height']<850,box
    print('DIAGNOSIS',page.evaluate('({calls:__pickerCalls,selected:document.querySelector("#qwSelectionToolbar").dataset.selectionCount,panelOpen:KGColorPickerV2.isOpen()})'))
    page.locator('[data-picker-swatch="#ef4444"]').first.click()
    print('SWATCH',page.evaluate('({selected:document.querySelector("#qwSelectionToolbar").dataset.selectionCount,colors:Object.values(KGMultiQuestionWorkspace.activeWorkspace().nodes).map(n=>n.color)})'))
    if args.diagnose:
        browser.close()
        raise SystemExit(0)
    if not args.background_only:
        assert page.evaluate('__pickerCalls[0].action')=='color','Picker must anchor to clicked waterdrop button'
    assert page.locator('#qwSelectionToolbar').get_attribute('data-selection-count')=='2'
    assert page.evaluate('Object.values(KGMultiQuestionWorkspace.activeWorkspace().nodes).every(n=>n.color==="#ef4444")')
    page.evaluate('KGColorPickerV2.close()')
    background=lambda:page.locator('.qw-background').evaluate('(e)=>{const s=getComputedStyle(e);return [s.backgroundColor,s.backgroundImage,s.backgroundRepeat]}')
    appearance=lambda:page.locator('#qwCanvasViewport').evaluate('(e)=>{const s=getComputedStyle(e);return [s.getPropertyValue("--uc-canvas-bg"),s.getPropertyValue("--uc-canvas-pattern-ink"),e.dataset.canvasPattern]}')
    before=background(),appearance()
    for theme in ['platform','parchment','aurora','neon','sakura','ocean','latte']:
        page.locator('#qwThemeSelect').select_option(theme)
        assert (background(),appearance())==before,theme+' changed effective background'
    print('PASS seven themes preserve gradient and surface grid')
    page.evaluate('KGCanvasAppearanceController.write({pattern:"grid",backgroundColor:"#fff8dc"},{source:"T02"})')
    saved_background=page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')
    assert saved_background['appearance']['pattern']=='grid'
    assert saved_background['appearance']['backgroundColor']=='#fff8dc'
    workspace_id=page.evaluate('KGMultiQuestionWorkspace.activeWorkspaceId()')
    page.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})')
    response=context.request.get(args.base_url+'/api/v1/workspaces')
    assert response.ok,response.text()
    payload=next(w['payload'] for w in response.json()['workspaces'] if w['payload']['id']==workspace_id)
    assert payload['background']==saved_background
    assert all(payload['nodes'][node]['color']=='#ef4444' for node in ids)
    page.reload(wait_until='networkidle')
    assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')==saved_background
    assert page.evaluate('(ids)=>ids.every(id=>KGMultiQuestionWorkspace.activeWorkspace().nodes[id].color==="#ef4444")',ids)
    assert appearance()[0].strip()=='#fff8dc'
    assert appearance()[2]=='grid'
    print('PASS server payload and reload restore independent background/card colors')
    page.evaluate('(ids)=>KGMultiQuestionWorkspace.selectNodes(ids)',ids)
    page.evaluate('document.querySelector("#qwCanvasShell").requestFullscreen()')
    page.wait_for_function('!!document.fullscreenElement')
    page.locator('[data-qw-selection-action=color]').click()
    assert page.locator('.graph-floating-color-window').evaluate('(e)=>document.fullscreenElement.contains(e)')
    swatch=page.locator('[data-picker-swatch="#22c55e"]').first
    print('FULLSCREEN HIT',swatch.evaluate('''e=>{const r=e.getBoundingClientRect();return {rect:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,250),ancestors:[e,e.parentElement,e.closest('.graph-floating-color-window'),e.closest('.graph-floating-color-window').parentElement].map(a=>({tag:a.tagName,id:a.id,cls:a.className,position:getComputedStyle(a).position,zIndex:getComputedStyle(a).zIndex,rect:a.getBoundingClientRect().toJSON()}))}}'''),flush=True)
    page.screenshot(path='artifacts/canvas-m0-m1/T02-fullscreen.png')
    swatch.click(timeout=5000)
    assert page.locator('#qwSelectionToolbar').get_attribute('data-selection-count')=='2'
    assert page.evaluate('(ids)=>ids.every(id=>KGMultiQuestionWorkspace.activeWorkspace().nodes[id].color==="#22c55e")',ids)
    print('PASS fullscreen waterdrop picker is visible, interactive and keeps selection')
    page.evaluate('document.exitFullscreen()')
    page.wait_for_function('!document.fullscreenElement')
    page.evaluate('KGColorPickerV2.close()')
    group_id=page.evaluate('(ids)=>KGCanvasWorkspaceStore.createGroup({title:"T02分组",x:60,y:60,width:1040,height:300},ids,{workspaceId:KGMultiQuestionWorkspace.activeWorkspaceId()}).group.id',ids)
    page.evaluate('(ids)=>{KGMultiQuestionWorkspace.renderCards();KGMultiQuestionWorkspace.selectNodes(ids)}',ids)
    page.locator('[data-qw-selection-action=color]').click()
    page.locator('[data-picker-swatch="#3b82f6"]').first.click()
    assert page.evaluate('(id)=>KGMultiQuestionWorkspace.activeWorkspace().groups.find(g=>g.id===id).color',group_id)=='#3b82f6'
    assert page.locator('#qwSelectionToolbar').get_attribute('data-selection-count')=='2'
    page.evaluate('KGColorPickerV2.close()')

    page.locator('#qwUndoBtn').click()
    assert page.evaluate('(id)=>KGMultiQuestionWorkspace.activeWorkspace().groups.find(g=>g.id===id).color',group_id)=='#ede9fe'
    print('PASS common-group color retains selection and undo restores group fill')
    page.locator('#qwThemeSelect').select_option('ocean')
    legacy_id=page.evaluate('''async()=>{const w=KGCanvasWorkspaceStore.createWorkspace('T02切换未迁移文档',{activate:false});await KGMultiQuestionWorkspace.loadWorkspace(w.id);return w.id}''')
    migrated=page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')
    assert migrated['appearance']['backgroundColor']=='#eff6ff',migrated
    assert migrated['surface']['ink']=='rgba(2,132,199,.08)',migrated
    assert migrated['layer']['color']=='rgb(239, 246, 255)',migrated
    page.evaluate('(id)=>KGMultiQuestionWorkspace.loadWorkspace(id)',workspace_id)
    assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')==saved_background
    assert appearance()[0].strip()=='#fff8dc'
    assert appearance()[2]=='grid'
    print('PASS switched legacy document captures own theme without stale layer/ink; old document restores yellow grid')
    browser.close()
