'use strict';

/*
 * 规格书 Test 11 + Test 12 · Workspace v6 迁移与服务器字段不丢（P4.5.29 合并规格 §11）
 *
 * 1. 旧 v4 Workspace 导入后 prepStudioWorkspaceVersion = 6
 * 2. 原 questions/tags/principles/recall/knowledgeTree/server 保留
 * 3. Question 的 serverRevision/serverContentHash/lastSyncedAt 不被迁移清空
 * 4. 新 payload 导出为 v6 + 完整 schema 声明（global-semantic-v1 / subject-facet-registry-v1 / question-family-v1）
 */

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const stubEl=()=>({textContent:'',innerHTML:'',value:'',classList:{add(){},remove(){},toggle(){},contains:()=>false},addEventListener(){},appendChild(){},remove(){},contains:()=>false,closest:()=>null,dataset:{},style:{},querySelectorAll:()=>[],querySelector:()=>null});
const document={getElementById:()=>stubEl(),body:stubEl(),createElement:()=>stubEl(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{}};
const window={__KG_DIRECT_BOOTSTRAP__:{},crypto:{randomUUID:()=>'11111111-1111-4111-8111-111111111111'},addEventListener:()=>{}};
const context=vm.createContext({window,document,crypto:window.crypto,Date,JSON,Math,Map,Set,Array,Object,String,Number,console,setTimeout,clearTimeout,setInterval:()=>0,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}});
vm.runInContext(source('00-core-bootstrap.js'),context,{filename:'00-core-bootstrap.js'});
vm.runInContext(source('10-state-domain.js'),context,{filename:'10-state-domain.js'});
vm.runInContext(source('12-p45-authoring-domain.js'),context,{filename:'12-p45-authoring-domain.js'});
vm.runInContext(source('20-page-runtime.js'),context,{filename:'20-page-runtime.js'});
vm.runInContext(source('30-service-layer.js'),context,{filename:'30-service-layer.js'});

const run=expr=>JSON.parse(vm.runInContext(`JSON.stringify(${expr})`,context));

/* ── 旧 v4 工作区（带服务器字段）────────────────────────── */

const v4={
  prepStudioWorkspaceVersion:4,prepStudioVersion:'0.4.0',savedAt:'2026-01-01T00:00:00.000Z',
  schema:{tagSlots:'semantic-v1',questionIds:'uuid-v4',keywordSystem:'Question Keyword System v2'},
  tagConfig:{schemaVersion:2,slotIdStrategy:'semantic-v1',names:{'usage/stage/0':'入门练习'},groupNames:{},categoryNames:{},aliases:{},slotAliases:{},looseAliases:{}},
  principles:{schemaVersion:1,items:[{id:'p-1',name:'先分析再升级',status:'active',confusablePrincipleIds:[],createdAt:1,updatedAt:1}],updatedAt:1},
  synthesisPresets:{schemaVersion:1,items:[{id:'pre-1',principleId:'p-1',title:'旧标题',content:'内容',status:'active',version:1,createdAt:1,updatedAt:1}],updatedAt:1},
  questionBank:{id:'bank-1',name:'旧库',subject:'PMP',questions:[
    {id:'11111111-1111-4111-8111-111111111111',title:'旧题',difficulty:'基础',stemParts:[{text:'题干'}],options:[{id:'A',text:'a'},{id:'B',text:'b'}],correctAnswer:'A',clues:[{id:'kw-1',text:'题干'}],serverRevision:12,serverContentHash:'sha256:abc',lastSyncedAt:'2026-01-02T00:00:00.000Z'}
  ]},
  recallLibrary:{schemaVersion:1,nodes:[{id:'rn-1',title:'入口'}],edges:[],updatedAt:''},
  knowledgeTree:{taxonomy:{id:'tax-1',subjectId:'subject-pmp',name:{zh:'PMP'},version:'1',nodes:[]}},
  server:{serverBankId:'srv-bank-1',serverBankRevision:7,clientInstanceId:'cli-1',lastIdempotencyKey:'idem-1',lastBatchId:'batch-1',lastUploadFingerprint:'fp-1'},
};

const migrated=run(`migrateWorkspacePayload(${JSON.stringify(v4)})`);
assert.equal(migrated.prepStudioWorkspaceVersion,6,'v4 → v6');
assert.equal(migrated.migratedFromVersion,4,'记录迁移来源');
assert.equal(migrated.tagConfig.slotIdStrategy,'global-semantic-v1','Tag 迁到 global-semantic-v1');
assert.ok('subjectFacetRegistry' in migrated,'补 subjectFacetRegistry');
assert.equal(migrated.schema.subjectFacets,'subject-facet-registry-v1','schema 声明 facets');
assert.equal(migrated.schema.questionFamily,'question-family-v1','schema 声明 family');
assert.equal(migrated.schema.tagSlots,'global-semantic-v1','schema tagSlots 升级');
assert.equal(migrated.server.serverBankId,'srv-bank-1','server.serverBankId 保留');
assert.equal(migrated.server.serverBankRevision,7,'server.serverBankRevision 保留');
assert.equal(migrated.server.clientInstanceId,'cli-1','server.clientInstanceId 保留');
assert.equal(migrated.server.lastIdempotencyKey,'idem-1','server.lastIdempotencyKey 保留');

const q=migrated.questionBank.questions[0];
assert.equal(q.serverRevision,12,'serverRevision 不被迁移清空');
assert.equal(q.serverContentHash,'sha256:abc','serverContentHash 不被迁移清空');
assert.equal(q.lastSyncedAt,'2026-01-02T00:00:00.000Z','lastSyncedAt 不被迁移清空');
assert.ok(Array.isArray(q.metadata.subjectFacets),'Question 补 subjectFacets 默认 []');
assert.equal(q.metadata.questionFamily.role,'standalone','Question 补 questionFamily 默认 standalone');
assert.equal(migrated.recallLibrary.nodes[0].id,'rn-1','recallLibrary 保留');
assert.ok(migrated.knowledgeTree,'knowledgeTree 保留');
assert.equal(migrated.principles.items[0].id,'p-1','principles 保留');

/* ── 幂等：v6 再迁移不变且无迁移标记 ─────────────────────── */

const again=run(`migrateWorkspacePayload(${JSON.stringify(migrated)})`);
assert.equal(again.prepStudioWorkspaceVersion,6,'v6 直通');
assert.equal(again.migratedAt,migrated.migratedAt,'v6 不再触发新迁移（migratedAt 不变）');
assert.equal(again.questionBank.questions[0].serverRevision,12,'直通服务器字段仍保留');

/* ── 新导出 payload 为 v6 + 完整 schema ─────────────────── */

vm.runInContext(`applyWorkspacePayload(${JSON.stringify(v4)})`,context);
const payload=run(`workspacePayload()`);
assert.equal(payload.prepStudioWorkspaceVersion,6,'导出 v6');
assert.equal(payload.schema.tagSlots,'global-semantic-v1');
assert.equal(payload.schema.subjectFacets,'subject-facet-registry-v1');
assert.equal(payload.schema.questionFamily,'question-family-v1');
assert.equal(payload.schema.questionIds,'uuid-v4');
assert.ok(payload.server&&typeof payload.server==='object','导出保留 server 扩展');

console.log('workspace v6 migration: passed');
