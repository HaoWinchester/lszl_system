'use strict';

/*
 * G2 · Subject Facet 全链路（P4.5.29 差异 9–11、27、29）
 *
 * 覆盖：
 * 1. pmp-facet-schema-v1 归一（trim/默认值/非法项过滤）
 * 2. Registry 归一：默认 PMP Schema 注入、按 subjectId 去重
 * 3. facetId 稳定格式 subject/<slug>/<dimension>/<value>
 * 4. 题目 metadata.subjectFacets 绑定归一（字符串/对象/去重/未知保留待校验）
 * 5. importFacetSchema：缺 schemaId/subjectId/dimensions 报错；按 subjectId 替换
 * 6. validateQuestionFacets：无效引用 error（阻断正式同步，含定位）；deprecated warning（兼容历史）
 */

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const document={getElementById:()=>null,body:{},createElement:()=>({})};
const window={__KG_DIRECT_BOOTSTRAP__:{},crypto:{randomUUID:()=>'11111111-1111-4111-8111-111111111111'},addEventListener:()=>{}};
const context=vm.createContext({window,document,crypto:window.crypto,Date,JSON,Math,Map,Set,Array,Object,String,Number,console,setTimeout,clearTimeout,setInterval:()=>0,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}});
vm.runInContext(source('00-core-bootstrap.js'),context,{filename:'00-core-bootstrap.js'});
vm.runInContext(source('10-state-domain.js'),context,{filename:'10-state-domain.js'});
vm.runInContext(source('12-p45-authoring-domain.js'),context,{filename:'12-p45-authoring-domain.js'});

const run=(expr)=>JSON.parse(vm.runInContext(`JSON.stringify(${expr})`,context));

/* ── 归一与稳定 ID ─────────────────────────────────────────── */

// 默认 PMP Schema 注入 registry，format 标记 subject-facet-registry-v1
const reg=run(`normalizeSubjectFacetRegistry({})`);
assert.equal(reg.format,'subject-facet-registry-v1');
assert.ok(reg.schemas.some(s=>s.subjectId==='subject-pmp'),'默认 PMP Facet Schema 必须存在');
assert.ok(reg.schemas.some(s=>s.dimensions.some(d=>d.id==='performance-domain'&&d.values.some(v=>v.id==='governance'))));

// 归一：trim、selection 默认 multi、非法 value/dimension 过滤
const schema=run(`normalizeFacetSchema(${JSON.stringify({
  schemaId:' pmp-facet-x ',schemaVersion:0,subjectId:' subject-x ',subjectCodes:[' X ','x'],
  name:'  X 分类  ',status:'bogus',
  dimensions:[
    {id:' d1 ',label:' D1 ',values:[{id:' v1 ',label:' V1 '},{id:'',label:'空 ID'},{label:'缺 ID'}]},
    {id:'',label:'缺 ID 维度',values:[{id:'v',label:'L'}]},
  ],
})})`);
assert.equal(schema.schemaId,'pmp-facet-x');
assert.equal(schema.subjectId,'subject-x');
assert.deepEqual(schema.subjectCodes,['X','x']);
assert.equal(schema.schemaVersion,1);
assert.equal(schema.status,'active');
assert.equal(schema.dimensions.length,1);
assert.equal(schema.dimensions[0].selection,'multi');
assert.equal(schema.dimensions[0].values.length,1);
assert.equal(schema.dimensions[0].values[0].id,'v1');

// facetId 稳定格式
const stable=run(`facetIdFor(normalizeSubjectFacetRegistry({}).schemas.find(s=>s.subjectId==='subject-pmp'),'performance-domain','governance')`);
assert.equal(stable,'subject/pmp/performance-domain/governance');

/* ── 题目绑定归一 ──────────────────────────────────────────── */

const q=(facets)=>({id:'q1',subject:'PMP',metadata:{subjectFacets:facets}});

// 字符串 / 对象 / 去重（字符串与对象同 facetId 合并）
let rows=run(`normalizeQuestionFacets(${JSON.stringify(['subject/pmp/exam-domain/people',{facetId:'subject/pmp/exam-domain/people'},'subject/pmp/exam-domain/process'])},'PMP',state.subjectFacetRegistry)`);
assert.equal(rows.length,2,'同 facetId 字符串/对象形式合并去重');
assert.equal(rows[0].facetId,'subject/pmp/exam-domain/people');
assert.equal(rows[0].status,'active');

// 未知引用保留（status=unknown）供校验定位，而不是悄悄丢弃
rows=run(`normalizeQuestionFacets(${JSON.stringify(['subject/pmp/no-such-dim/value'])},'PMP',state.subjectFacetRegistry)`);
assert.equal(rows.length,1);
assert.equal(rows[0].status,'unknown');

/* ── 校验（差异 29：可定位、阻断同步）─────────────────────── */

// 无效引用 → error，带 facetId 定位
let issues=run(`validateQuestionFacets(${JSON.stringify(q(['subject/pmp/no-such-dim/value']))},state.subjectFacetRegistry)`);
assert.equal(issues.length,1);
assert.equal(issues[0].level,'error');
assert.ok(issues[0].message.includes('subject/pmp/no-such-dim/value'),'错误信息必须包含可定位的 facetId');

// deprecated 值 → warning（兼容历史 Schema 引用，不阻断）
issues=run(`validateQuestionFacets(${JSON.stringify(q(['subject/pmp/performance-domain/deprecated-value']))},(function(){
  const reg=normalizeSubjectFacetRegistry({});
  const dim=reg.schemas.find(s=>s.subjectId==='subject-pmp').dimensions.find(d=>d.id==='performance-domain');
  dim.values.push({id:'deprecated-value',label:'旧绩效域',status:'deprecated',aliases:[],replacedBy:[]});
  return reg;
})())`);
assert.equal(issues.length,1);
assert.equal(issues[0].level,'warning');

// 有效引用 → 无问题
issues=run(`validateQuestionFacets(${JSON.stringify(q(['subject/pmp/performance-domain/governance','subject/pmp/exam-domain/process']))},state.subjectFacetRegistry)`);
assert.equal(issues.length,0);

/* ── 导入（差异 10：导入/编辑/校验/导出）──────────────────── */

assert.throws(
  ()=>vm.runInContext(`importFacetSchema({schemaId:'',subjectId:'subject-x',dimensions:[{id:'d',label:'D',values:[{id:'v',label:'V'}]}]})`,context),
  /缺少 schemaId/,
);
assert.throws(
  ()=>vm.runInContext(`importFacetSchema({schemaId:'x',subjectId:'',dimensions:[{id:'d',label:'D',values:[{id:'v',label:'V'}]}]})`,context),
  /缺少 subjectId/,
);
assert.throws(
  ()=>vm.runInContext(`importFacetSchema({schemaId:'x',subjectId:'subject-x',dimensions:[]})`,context),
  /dimensions/,
);

// 按 subjectId 替换，不产生重复 schema
vm.runInContext(`importFacetSchema(${JSON.stringify({
  schemaId:'pmp-facet-v2',subjectId:'subject-pmp',name:'PMP 分类 v2',
  dimensions:[{id:'delivery-approach',label:'交付',selection:'multi',values:[{id:'hybrid',label:'混合型',status:'active',aliases:[],replacedBy:[]}]}],
})})`,context);
const after=run(`normalizeSubjectFacetRegistry(state.subjectFacetRegistry)`);
const pmpSchemas=after.schemas.filter(s=>s.subjectId==='subject-pmp');
assert.equal(pmpSchemas.length,1,'同 subjectId 只保留一份 schema');
assert.equal(pmpSchemas[0].schemaId,'pmp-facet-v2');
assert.ok(after.schemas.length>=1);

console.log('p45-facets: passed');
