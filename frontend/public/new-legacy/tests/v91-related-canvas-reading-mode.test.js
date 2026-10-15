'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('reading mode exposes the related-canvas entry with a read-only toolbar',()=>{
  const editor=read('src/10-graph-editor.js');
  // updateCardQuickActions：阅读模式单选卡牌时放行工具栏入口（auth-readonly 仍整体隐藏）。
  assert.match(editor,/const readingEntry=!graphModeAllows\('nodeToolbar'\)&&!document\.body\.classList\.contains\('auth-readonly'\)/);
  assert.match(editor,/window\.KGHomeInteractionModes\?\.getMode\?\.\(\)==='reading'/);
  // updateNodeStyleToolbarControls：阅读模式统一收口隐藏（grip + related-canvas 除外）。
  assert.match(editor,/const readonlyContext=!graphModeAllows\('nodeToolbar'\)/);
  assert.match(editor,/btn\.dataset\.nodeToolbarAction!=='related-canvas'\)btn\.hidden=true/);
  // handleNodeToolbarAction：阅读模式仅放行 related-canvas 动作。
  assert.match(editor,/阅读模式下仅可打开相关画布/);
  // 打开临时画布按当前模式传只读标记。
  assert.match(editor,/readOnly:window\.KGHomeInteractionModes\?\.getMode\?\.\(\)==='reading'/);
  // 模式切换后重算工具栏。
  assert.match(editor,/window\.addEventListener\('kg-home-interaction-mode-change',\(\)=>\{updateCardQuickActions\(\)\}\)/);
});

test('related canvas supports read-only mode and a local ink tool',()=>{
  const controller=read('src/graph/related-canvas-controller.js');
  // 只读态：隐藏编辑按钮与画笔、禁卡片拖拽、动作短路、auth 文案。
  assert.match(controller,/const readOnly=\(\)=>!!options\.readOnly/);
  assert.match(controller,/readOnly\(\)\?'':'<button data-action="add">新增卡片<\/button>/);
  assert.match(controller,/只读查看：仅供演示浏览/);
  assert.match(controller,/if\(readOnly\(\)\)return;if\(connection\.source\(\)\)/);
  assert.match(controller,/if\(readOnly\(\)&&name!=='fit'&&name!=='fullscreen'\)return/);
  // 临时编辑表单整体移除。
  assert.ok(!controller.includes('应用临时修改'),'临时编辑表单应已移除');
  assert.ok(!controller.includes('related-canvas-edit'));
  // 画笔：局部实例、笔迹不持久化、ESC 先退绘画、关闭时清理。
  assert.match(controller,/data-action="ink"/);
  assert.match(controller,/isInside:target=>!target\?\.closest\?\.\('\[data-canvas-ui\]'\)/);
  assert.match(controller,/let ink=null,inkOpen=false,inkStrokes=\[\]/);
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
