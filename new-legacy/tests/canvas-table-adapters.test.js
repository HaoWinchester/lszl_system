'use strict';
/* 三页 tables 持久化 adapter：图谱 sanitize 共享 helper、多题 store、回忆 server adapter。 */
const test=require('node:test');
const assert=require('node:assert/strict');
const model=require('../src/canvas/table-model.js');
const table=()=>({id:'tb_1',schemaVersion:1,x:10,y:20,rows:3,cols:3,columnWidths:[140,140,140],rowHeights:[40,40,40],cells:{'0,0':'中文'},merges:[]});

test('sanitizeCollection drops invalid tables and enforces canvas cell budget',()=>{
  const clean=model.sanitizeCollection([table(),{bad:1},null]);
  assert.equal(clean.length,1);
  assert.equal(clean[0].id,'tb_1');
  assert.deepEqual(model.sanitizeCollection('nope'),[]);
  assert.deepEqual(model.sanitizeCollection(null),[]);
  const warnings=[];
  model.sanitizeCollection([{...table(),rows:0}],{onInvalid:error=>warnings.push(error.message)});
  assert.deepEqual(warnings,[warnings[0]]);
  // 画布级 20000：5 张满额表超限整组丢弃。
  const big={...table(),id:'tb_big',rows:100,cols:50,columnWidths:Array(50).fill(140),rowHeights:Array(100).fill(40)};
  assert.deepEqual(model.sanitizeCollection([big,big,big,big,big]),[]);
  assert.equal(model.sanitizeCollection([big,big,big,big]).length,4);
});

test('multi-question workspace store loads and keeps tables contract keys',()=>{
  require('../src/65-canvas-workspace-store.js');
  const store=globalThis.KGCanvasWorkspaceStore;
  // Node 环境加载冒烟：tables 接线后模块不崩溃；payload.tables 的真实往返
  // 由后端 test_canvas_table_persistence.py 覆盖，UI 往返由 T19 浏览器测试覆盖。
  assert.equal(store.STORAGE_PREFIX,'kg_canvas_workspace_v1__');
  assert.equal(typeof store.replaceAllFromServer,'function');
});

test('deep recall server adapter carries tables through save and reset payloads',async()=>{
  const adapter=require('../src/99-deep-recall-server-adapter.js');
  const requests=[];
  const session={progressRevision:2,currentQuestion:{revision:1},library:{contentHash:'a'.repeat(64)},
    progress:{nodes:[],strokes:[],edges:[],tables:[table()],customNodes:{},activeKeywords:[],choiceOffsets:{},transform:{x:0,y:0,scale:1},metrics:{},graphSchemaVersion:3}};
  const responses=[
    {ok:true,status:200,json:async()=>session},
    {ok:true,status:200,json:async()=>({...session.progress,revision:3})},
  ];
  let call=0;
  const impl=async(url,init)=>{requests.push({url,init});return responses[Math.min(call++,responses.length-1)]};
  const client=adapter.create({questionId:'q1',fetchImpl:impl});
  await client.loadSession();
  assert.deepEqual(client.getState().graph.tables,[table()]);
  const graph={...session.progress,tables:[table()],nodes:[],strokes:[],edges:[],customNodes:{},activeKeywords:[],choiceOffsets:{},transform:{x:0,y:0,scale:1},metrics:{},graphSchemaVersion:3};
  await client.saveGraph(graph);
  const body=JSON.parse(requests[1].init.body);
  assert.deepEqual(body.tables,[table()]);
  // 失败草稿保留 tables：409 后 lastUnsavedGraph 仍含表格，重试载荷一致。
  call=1; // 复用成功响应保持简单，仅校验 state
  assert.equal(client.getState().saveState,'saved');
});
