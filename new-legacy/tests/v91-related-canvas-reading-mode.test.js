'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

// Run the real entry handler with only the formal-editor UI boundary supplied.
const vm=require('node:vm');
test('reading single selection always hides the main toolbar',()=>{
  const editor=read('src/10-graph-editor.js');
  const body=editor.slice(editor.indexOf('function updateCardQuickActions(){'),editor.indexOf('// 模式切换后重算卡牌工具栏'));
  let hidden=0;
  const context={graphModeAllows:()=>false,document:{body:{classList:{contains:()=>false}}},window:{KGHomeInteractionModes:{getMode:()=> 'reading'}},nodeStyleToolbarController:{hide:()=>hidden++,show(){},position(){}},cardQuickActionsEl:null,nodeToolbarTextElement:()=>null,nodeToolbarSelectedIds:()=>['a'],nodeToolbarPrimaryNode:()=>({id:'a'}),selectedTextElementIds:new Set(),selectedLinkIds:new Set(),boxSelect:null,cardDrag:null,state:{},stage:{classList:{contains:()=>false}},isCanvasPanMode:()=>false,ensureCardQuickActions:()=>({classList:{toggle(){}},querySelector(){}}),updateNodeStyleToolbarControls(){},homeSelectionAnchorRect(){}};
  vm.runInNewContext(body+';updateCardQuickActions()',context);
  assert.equal(hidden,1);
});
test('reading double click selects its card and opens the protected temporary entry; editing modes still edit',()=>{
  const editor=read('src/10-graph-editor.js');
  const handler=editor.slice(editor.indexOf("cardsLayer.addEventListener('dblclick',e=>{"),editor.indexOf('function textElementResizeHandleFromEvent'));
  for(const mode of ['reading','efficient','professional']){
    let listener,opened=0,edited=0,stopped=0;
    const state={selectedNodeId:'old',selectedElementId:'text',selectedLinkId:'link',linkSourceId:'old'},selectedNodeIds=new Set(['old']);
    const context={cardsLayer:{addEventListener:(_,fn)=>listener=fn},isCanvasPanMode:()=>false,cardFromEvent:()=>({dataset:{nodeId:'a'}}),window:{KGHomeInteractionModes:{getMode:()=>mode},KGHomeCanvasRuntime:{selectionFilter:{clear(){}}}},state,selectedNodeIds,selectedTextElementIds:new Set(),selectedLinkIds:new Set(),clearMultiSelection:()=>selectedNodeIds.clear(),refreshSelectionUI(){},openRelatedCanvasModal:()=>{opened++},startNodeInlineEdit:()=>{edited++}};
    vm.runInNewContext(handler,context);
    listener({target:{closest:()=>true},preventDefault(){},stopPropagation(){}});
    assert.equal(opened+edited,0,'interactive descendants keep their own action');
    listener({target:{closest:()=>false},preventDefault(){},stopPropagation(){stopped++}});
    assert.equal(stopped,1);
    assert.equal(opened,mode==='reading'?1:0);
    assert.equal(edited,mode==='reading'?0:1);
    if(mode==='reading'){assert.equal(state.selectedNodeId,'a');assert.equal(state.selectedElementId,null);assert.equal(state.selectedLinkId,null);assert.equal(state.linkSourceId,null);assert.equal(selectedNodeIds.size,0)}
  }
  assert.match(editor,/readOnly=!canWriteGraph\(\)/,'temporary view respects actual role and session restrictions');
  assert.match(editor,/ensureMarkers:ensureGraphEdgeMarkers,onClose:[^\n]+,readOnly\}/);
  assert.match(editor,/window\.addEventListener\('kg-home-interaction-mode-change',\(\)=>\{updateCardQuickActions\(\)\}\)/);
});

test('related canvas supports read-only mode and a local ink tool',()=>{
  const controller=read('src/graph/related-canvas-controller.js');
  // Content readonly still hides edit tools; ephemeral layout is draggable.
  assert.match(controller,/const readOnly=\(\)=>!!options\.readOnly/);
  assert.match(controller,/readOnly\(\)\?'':'<button data-action="add">新增卡片<\/button>/);
  assert.match(controller,/可拖动临时排列，关闭即丢弃/);
  assert.ok(!controller.includes('if(readOnly()){selection.selectNodes([n.id]);return}'),'readonly must not block temporary layout drag');
  assert.match(controller,/if\(readOnly\(\)&&name!=='fit'&&name!=='fullscreen'\)return/);
  // 临时编辑表单整体移除。
  assert.ok(!controller.includes('应用临时修改'),'临时编辑表单应已移除');
  assert.ok(!controller.includes('related-canvas-edit'));
  // 画笔：局部实例、笔迹不持久化、ESC 先退绘画、关闭时清理。
  assert.match(controller,/data-action="ink"/);
  assert.match(controller,/isInside:target=>!target\?\.closest\?\.\('\[data-canvas-ui\]'\)/);
  assert.match(controller,/graph\(\)\.strokes=\[\]/);
  assert.match(controller,/getStrokes:\(\)=>graph\(\)\.strokes/);
  assert.match(controller,/ink\.setTool\('select'\);e\.stopImmediatePropagation\(\);return/);
  assert.match(controller,/ink\.reset\(\{discardDraft:true\}\)/);
  // 弹层快捷键挂 window 捕获，先于画笔内核处理 ESC。
  assert.match(controller,/global\.addEventListener\('keydown',key,true\)/);
});

test('ink adapter allows page-defined hit testing for layered hosts',()=>{
  const ink=read('src/canvas/94-canvas-ink.js');
  assert.match(ink,/const inside=target=>options\.isInside\?options\.isInside\(target\):defaultInside\(target\)/);
});

test('efficient mode keeps the lock and related-canvas toolbar buttons visible',()=>{
  const css=read('styles/home-interaction-modes-p4330.css');
  assert.ok(!/efficient"\] \.node-style-toolbar \[data-node-toolbar-action="lock"\]/.test(css),'高效模式不得隐藏锁定按钮（用户反馈：锁定后切高效无法解锁）');
  assert.ok(!/efficient"\] \.node-style-toolbar \[data-node-toolbar-action="related-canvas"\]/.test(css));
  assert.match(css,/\.node-style-toolbar\.readonly-context \.node-toolbar-btn:not\(\.node-toolbar-grip\):not\(\[data-node-toolbar-action="related-canvas"\]\)/);
});

test('auth capture allows only authenticated reading card browsing; other readonly edits stay blocked',()=>{
  const source=read('src/30-auth-guards.js');
  const helperStart=source.indexOf('function authCanOpenReadingRelatedCanvas(');
  const helper=helperStart<0?'':source.slice(helperStart,source.indexOf('function authInstallGuards()',helperStart));
  const start=source.indexOf("cardsLayer.addEventListener('dblclick',e=>{");
  const handler=source.slice(start,source.indexOf('},true);',start)+8);
  for(const [logged,mode,interactive,blocked] of [[true,'reading',false,false],[false,'reading',false,true],[true,'professional',false,true],[true,'efficient',false,true],[true,'reading',true,true]]){
    let listener,prevented=false,stopped=false;
    const card={dataset:{nodeId:'a'}},target={closest:selector=>selector==='.knowledge-card'?card:interactive?{}:null};
    const context={cardsLayer:{addEventListener:(_,fn)=>listener=fn},authIsLoggedIn:()=>logged,window:{KGHomeInteractionModes:{getMode:()=>mode},KGRolePermissions:{can:()=>false}},showStatus(){},authOpen(){}};
    vm.runInNewContext(helper+handler,context);
    listener({target,preventDefault:()=>prevented=true,stopPropagation(){},stopImmediatePropagation:()=>stopped=true});
    assert.equal(prevented,blocked,JSON.stringify({logged,mode,interactive}));
    assert.equal(stopped,blocked);
  }
});
