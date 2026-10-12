'use strict';
/* T19 · 共享表格控制器：纯逻辑（选择矩形/等比缩放/钳制/表格状判断）+ 三页脚本注册契约。 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const controller=require('../src/canvas/table-controller.js');
const model=require('../src/canvas/table-model.js');

const table=over=>model.normalize({id:'tb_1',schemaVersion:1,x:10,y:20,rows:4,cols:4,
  columnWidths:[120,120,120,120],rowHeights:[40,40,40,40],cells:{'1,1':'甲','1,2':'b'},merges:[],...over});

test('selectionRect 扩展覆盖相交合并区域，合并请求整体包含已有合并',()=>{
  const merged=table({merges:[{row:1,column:1,rowSpan:2,columnSpan:2}]});
  // anchor 在合并左上、focus 在右下角：矩形扩展到恰好覆盖合并区。
  assert.deepEqual(controller.selectionRect(merged,{row:1,column:1},{row:2,column:2}),
    {row:1,column:1,rowSpan:2,columnSpan:2});
  // focus 只碰到合并区一角也扩展到完整覆盖。
  assert.deepEqual(controller.selectionRect(merged,{row:0,column:0},{row:1,column:1}),
    {row:0,column:0,rowSpan:3,columnSpan:3});
  // 无合并：普通矩形。
  assert.deepEqual(controller.selectionRect(table(),{row:2,column:3},{row:0,column:1}),
    {row:0,column:1,rowSpan:3,columnSpan:3});
  assert.equal(controller.selectionRect(null,{row:0,column:0}),null);
  assert.equal(controller.selectionRect(table(),null),null);
  // 越界 focus 被钳制到表内。
  const small=table({rows:2,cols:2,columnWidths:[100,100],rowHeights:[40,40],cells:{'0,0':'a'}});
  assert.deepEqual(controller.selectionRect(small,{row:0,column:0},{row:9,column:9}),
    {row:0,column:0,rowSpan:2,columnSpan:2});
});

test('scaleSizes 等比缩放且不低于最小值；clampGridCount/isTabularGrid 钳制与判断',()=>{
  assert.deepEqual(controller.scaleSizes([100,100,100],300),[100,100,100]);
  assert.deepEqual(controller.scaleSizes([100,100,100],150),[50,50,50]);
  // 拉到很小时每列钳到下限，不出现 0/负数。
  for(const width of controller.scaleSizes([100,200],30))assert.ok(width>=controller.LIMITS.MIN_SIZE);
  assert.deepEqual(controller.scaleSizes([],200),[200]);
  assert.equal(controller.clampGridCount(3,100),3);
  assert.equal(controller.clampGridCount('12',10),10);
  assert.equal(controller.clampGridCount(250,100),100);
  assert.equal(controller.clampGridCount(0,100),0);
  assert.equal(controller.clampGridCount(-2,100),0);
  assert.equal(controller.clampGridCount('abc',100),0);
  assert.equal(controller.isTabularGrid({cells:[['a']]}),false);
  assert.equal(controller.isTabularGrid({cells:[['a','b']]}),true);
  assert.equal(controller.isTabularGrid({cells:[['a'],['b']]}),true);
  assert.equal(controller.isTabularGrid(null),false);
});

test('控制器 create 的缺参防御与 LIMITS 契约（与 model 对齐）',()=>{
  assert.equal(controller.create({}),null);
  assert.equal(controller.create({viewport:{},world:{}}),null);
  assert.equal(controller.LIMITS.GRID_MAX,10);
  assert.equal(controller.LIMITS.ROWS_MAX,100);
  assert.equal(controller.LIMITS.COLS_MAX,50);
  assert.equal(controller.LIMITS.MIN_SIZE,28);
  assert.equal(controller.LIMITS.ROWS_MAX,model.LIMITS.MAX_ROWS);
  assert.equal(controller.LIMITS.COLS_MAX,model.LIMITS.MAX_COLS);
});

test('三页 HTML 与 homepage-bundles 均登记 table-model/table-clipboard/table-controller 与 canvas-table.css',()=>{
  const root=path.join(__dirname,'..');
  for(const page of ['index.html','question-workspace.html','knowledge-recall.html']){
    const html=fs.readFileSync(path.join(root,page),'utf8');
    for(const script of ['src/canvas/table-model.js','src/canvas/table-clipboard.js','src/canvas/table-controller.js']){
      assert.ok(html.includes(`<script defer src="${script}"></script>`),`${page} 缺少 ${script}`);
    }
    assert.ok(html.includes('styles/canvas-table.css'),`${page} 缺少 canvas-table.css`);
  }
  const bundles=JSON.parse(fs.readFileSync(path.join(root,'../frontend/scripts/homepage-bundles.json'),'utf8'));
  const graph=bundles.groups.find(group=>group.name==='home-graph');
  for(const script of ['src/canvas/table-model.js','src/canvas/table-clipboard.js','src/canvas/table-controller.js']){
    assert.ok(graph.scripts.includes(script),`home-graph 缺少 ${script}`);
  }
  const shell=bundles.groups.find(group=>group.name==='home-shell');
  assert.ok(shell.styles.includes('styles/canvas-table.css'),'home-shell 缺少 canvas-table.css');
});

test('共享控制器源码不直接请求业务 API，三页接入均复用同一模块',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/canvas/table-controller.js'),'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|api\/v1/.test(source),'控制器不得直接请求业务 API');
  for(const page of ['../src/canvas/95-home-canvas-tools.js','../src/77-multi-question-workspace.js','../src/86-knowledge-recall.js']){
    const text=fs.readFileSync(path.join(__dirname,page),'utf8');
    assert.ok(text.includes('KGCanvasTableController'),`${page} 未接入共享表格控制器`);
  }
});
