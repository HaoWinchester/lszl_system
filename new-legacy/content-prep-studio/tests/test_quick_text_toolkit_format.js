'use strict';

/*
 * 调整4 · 外部 AI 工具包 V2.2（P4.5.29）Quick Text 格式兼容
 *
 * 工具包 §20 模板使用带空格写法：【题目 1】、A 原则：、原则 IDs：、
 * 主知识点 ID：、A 反馈 EN：。解析器必须同时兼容紧凑与带空格两种写法。
 */

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const stubEl=()=>({textContent:'',innerHTML:'',value:'',classList:{add(){},remove(){},toggle(){},contains:()=>false},addEventListener(){},appendChild(){},remove(){},contains:()=>false,closest:()=>null,dataset:{},style:{},querySelectorAll:()=>[],querySelector:()=>null});
const document={getElementById:()=>stubEl(),body:stubEl(),createElement:()=>stubEl(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{}};
let uuidSeq=0;
const uuid=()=>{uuidSeq++;return `44444444-4444-4444-8444-${String(uuidSeq).padStart(12,'0')}`};
const window={__KG_DIRECT_BOOTSTRAP__:{},crypto:{randomUUID:uuid},addEventListener:()=>{}};
const context=vm.createContext({window,document,crypto:window.crypto,Date,JSON,Math,Map,Set,Array,Object,String,Number,console,setTimeout,clearTimeout,setInterval:()=>0,TextEncoder,TextDecoder});
for(const f of ['00-core-bootstrap.js','10-state-domain.js','12-p45-authoring-domain.js','20-page-runtime.js','30-service-layer.js']){
  vm.runInContext(source(f),context,{filename:f});
}
const run=expr=>JSON.parse(vm.runInContext(`JSON.stringify(${expr})`,context));

const pasted=`【题目 1】
标题：工具包格式题
难度：简单
家族代号：FAMILY-B01-01
家族角色：母题
家族关系：root
变体类型：none
诊断目标：application
诊断层级：2
家族用途：practice
质量确认：否
领域：风险
主题：风险应对
阶段：基础练习
标签：基础练习、核心题

题干：项目经理发现新风险，应该首先做什么？
A. 立即上报发起人
A 陷阱：过早升级
B. 先分析影响再决定应对
B 陷阱：
C. 忽略该风险
C 陷阱：回避
D. 直接动用储备
D 陷阱：跳过流程

答案：B
解析：先分析后行动。

English Title：Risk First
English Stem：What should the PM do first?
A_EN：Escalate at once.
B_EN：Analyze then respond.
C_EN：Ignore it.
D_EN：Use reserves.
English Analysis：Analyze first.
A 反馈 EN：Premature.
B 反馈 EN：Correct.
C 反馈 EN：Wrong.
D 反馈 EN：Wrong.

主知识点 ID：kp-risk-1
普通关键词：风险=>recall-risk；
核心关键词：首先=>|decision-cue|题目要求识别优先行动；
原则 IDs：principle-analyze-first
A 原则：principle-no-premature-escalation
B 原则：principle-analyze-first`;

const qs=run(`parsePastedQuestionText(${JSON.stringify(pasted)})`);
assert.equal(qs.length,1,'【题目 1】带空格标题可分块');
const q=qs[0];
assert.equal(q.metadata.knowledge.primaryNodeId,'kp-risk-1','主知识点 ID 带空格可解析');
assert.equal(q.metadata.knowledge.mappingStatus,'confirmed','mappingStatus 归一为 confirmed');
assert.deepEqual(q.metadata.principleIds,['principle-analyze-first','principle-no-premature-escalation'].sort(),'原则 IDs 带空格可解析且汇总 option map');
assert.deepEqual(q.metadata.optionPrincipleMap.A,['principle-no-premature-escalation'],'A 原则带空格可解析');
assert.deepEqual(q.metadata.optionPrincipleMap.B,['principle-analyze-first'],'B 原则带空格可解析');
assert.equal(q.translations.en.optionFeedback.A,'Premature.','A 反馈 EN 带空格可解析');
assert.equal(q.translations.en.optionFeedback.B,'Correct.','B 反馈 EN 带空格可解析');
assert.equal(q.metadata.questionFamily.familyKey,'FAMILY-B01-01','家族代号保留连字符');
assert.equal(q.options[0].trap,'过早升级','A 陷阱带空格可解析');
const core=q.clues.find(c=>c.text==='首先');
assert.ok(core&&core.keywordLevel==='core'&&core.solutionRole==='decision-cue','核心关键词规格可解析');

/* 工具包 Complete AI JSON（§19）：clues 无 id、matchLocations 缺省、mappingStatus=mapped */
const aiJson=run(`normalizeBank({name:'AI 批次',subject:'PMP',questions:[{
  title:'AI 题目',difficulty:'简单',
  stemParts:[{text:'先分析再行动的风险应对。'}],
  options:[{id:'A',text:'上报'},{id:'B',text:'分析'},{id:'C',text:'忽略'},{id:'D',text:'储备'}],
  correctAnswer:'B',analysis:'解析',
  clues:[{text:'分析',textEn:'analyze',keywordLevel:'core',sourceType:'stem',sourceOptionId:'',solutionRole:'decision-cue',coreReason:'决定路径',recallNodeId:''}],
  metadata:{knowledge:{primaryNodeId:'kp-1',mappingStatus:'mapped'},questionFamily:{role:'root',familyKey:'F-1'},principleIds:[],optionPrincipleMap:{A:[],B:[],C:[],D:[]}}
}]})`);
const aiq=aiJson.questions[0];
assert.ok(aiq.clues[0].id,'AI JSON 无 clue id 时自动生成');
assert.ok(aiq.clues[0].matchLocations.length===1,'AI JSON 导入重算 matchLocations');
assert.equal(aiq.metadata.knowledge.mappingStatus,'confirmed','外部 mapped 归一为 confirmed');

console.log('toolkit v2.2 format compat: passed');
