'use strict';

/*
 * P4.5.29 合并规格 §10.2 · Quick Text 家族字段（快捷子集）
 *
 * 1. 家族代号/角色/关系/变体类型/诊断目标/诊断层级/家族用途 全部可解析并归一
 * 2. 质量确认无论粘贴什么值，一律 false（外部来源不可自证）
 * 3. 不带家族字段的题目仍解析为 standalone
 */

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const stubEl=()=>({textContent:'',innerHTML:'',value:'',classList:{add(){},remove(){},toggle(){},contains:()=>false},addEventListener(){},appendChild(){},remove(){},contains:()=>false,closest:()=>null,dataset:{},style:{},querySelectorAll:()=>[],querySelector:()=>null});
/* uuid 桩必须每次不同：generateQuestionId() 的防碰撞 do...while 在固定 uuid 下会死循环 */
let uuidSeq=0;
const uuid=()=>{uuidSeq++;return `22222222-2222-4222-8222-${String(uuidSeq).padStart(12,'0')}`};
const document={getElementById:()=>stubEl(),body:stubEl(),createElement:()=>stubEl(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{}};
const window={__KG_DIRECT_BOOTSTRAP__:{},crypto:{randomUUID:uuid},addEventListener:()=>{}};
const context=vm.createContext({window,document,crypto:window.crypto,Date,JSON,Math,Map,Set,Array,Object,String,Number,console,setTimeout,clearTimeout,setInterval:()=>0});
vm.runInContext(source('00-core-bootstrap.js'),context,{filename:'00-core-bootstrap.js'});
vm.runInContext(source('10-state-domain.js'),context,{filename:'10-state-domain.js'});
vm.runInContext(source('12-p45-authoring-domain.js'),context,{filename:'12-p45-authoring-domain.js'});
vm.runInContext(source('20-page-runtime.js'),context,{filename:'20-page-runtime.js'});

const run=expr=>JSON.parse(vm.runInContext(`JSON.stringify(${expr})`,context));

const pasted=`【题目1】
标题：母题示例
难度：简单
家族代号：FAMILY-001
家族角色：母题
家族关系：root
变体类型：none
诊断目标：应用
诊断层级：2
家族用途：练习、错误确认
质量确认：是
题干：项目经理应该首先做什么？
A. 选项A
B. 选项B
C. 选项C
D. 选项D
答案：B
解析：解析内容。

【题目2】
标题：成员示例（中文别名）
难度：困难
家族代号：FAMILY-001
家族角色：成员
家族关系：能力拆解
变体类型：题干
诊断目标：概念
诊断层级：1
家族用途：诊断
题干：成员题干？
A. 选项A
B. 选项B
C. 选项C
D. 选项D
答案：A
解析：解析内容。

【题目3】
标题：无家族字段
难度：中等
题干：独立题干？
A. 选项A
B. 选项B
C. 选项C
D. 选项D
答案：C
解析：解析内容。`;

const qs=run(`parsePastedQuestionText(${JSON.stringify(pasted)})`);
assert.equal(qs.length,3,'三题全部解析');

const root=qs[0].metadata.questionFamily;
assert.equal(root.familyKey,'FAMILY-001','家族代号');
assert.equal(root.role,'root','母题→root');
assert.equal(root.relationToRoot,'root','root 关系固定 root');
assert.equal(root.variantType,'none','变体类型 none');
assert.equal(root.diagnosticTarget,'application','应用→application');
assert.equal(root.difficultyLevel,2,'诊断层级 2');
assert.deepEqual(root.purposes,['practice','error-confirmation'],'家族用途中文映射');
assert.equal(root.qualityConfirmed,false,'粘贴"质量确认：是"仍强制 false');

const member=qs[1].metadata.questionFamily;
assert.equal(member.role,'member','成员→member');
assert.equal(member.relationToRoot,'decomposed','能力拆解→decomposed');
assert.equal(member.variantType,'stem','题干变体→stem');
assert.equal(member.diagnosticTarget,'concept','概念→concept');
assert.equal(member.difficultyLevel,1,'诊断层级 1');
assert.equal(member.qualityConfirmed,false);

const standalone=qs[2].metadata.questionFamily;
assert.equal(standalone.role,'standalone','无家族字段→独立题');

console.log('quick text family fields: passed');
