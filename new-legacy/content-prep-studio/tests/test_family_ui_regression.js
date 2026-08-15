'use strict';

/*
 * 本轮 UI 修复回归：
 * 1. Bug1/2：normalizeBank 导入时重算 source-isolated matchLocations（首次进入题目即有高亮，
 *    消除"关键词已不在题干/选项中"误报）
 * 2. Bug4：新建家族成员插入到母题（及其已有成员）正下方，而非列表末尾
 */

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const stubEl=()=>({textContent:'',innerHTML:'',value:'',className:'',disabled:false,checked:false,classList:{add(){},remove(){},toggle(){},contains:()=>false},addEventListener(){},appendChild(){},remove(){},contains:()=>false,closest:()=>null,dataset:{},style:{},querySelectorAll:()=>[],querySelector:()=>null,onclick:null,onchange:null,oninput:null});
const document={getElementById:()=>stubEl(),body:stubEl(),createElement:()=>stubEl(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{}};
let uuidSeq=0;
const uuid=()=>{uuidSeq++;return `33333333-3333-4333-8333-${String(uuidSeq).padStart(12,'0')}`};
const window={__KG_DIRECT_BOOTSTRAP__:{},crypto:{randomUUID:uuid},addEventListener:()=>{},confirm:()=>true};
const context=vm.createContext({window,document,crypto:window.crypto,Date,JSON,Math,Map,Set,Array,Object,String,Number,Boolean,console,setTimeout,clearTimeout,setInterval:()=>0,confirm:()=>true,TextEncoder,TextDecoder});
for(const f of ['00-core-bootstrap.js','10-state-domain.js','12-p45-authoring-domain.js','20-page-runtime.js','30-service-layer.js']){
  vm.runInContext(source(f),context,{filename:f});
}
const run=expr=>JSON.parse(vm.runInContext(`JSON.stringify(${expr})`,context));

/* ── Bug1/2：导入重算 matchLocations ─────────────────────── */

const bank=run(`normalizeBank({name:'导入库',subject:'PMP',questions:[{
  id:'q-import-1',title:'风险题',difficulty:'简单',
  stemParts:[{text:'项目经理首先评估风险的影响。'}],
  options:[{id:'A',text:'忽略风险'},{id:'B',text:'记录风险'},{id:'C',text:'升级风险'},{id:'D',text:'接受风险'}],
  correctAnswer:'B',analysis:'解析。',
  clues:[
    {id:'kw-1',text:'风险',keywordLevel:'core',sourceType:'stem',sourceOptionId:'',matchLocations:[]},
    {id:'kw-2',text:'风险',keywordLevel:'normal',sourceType:'option',sourceOptionId:'A',matchLocations:[]}
  ]
}]})`);
const q1=bank.questions[0];
const stemKw=q1.clues.find(c=>c.id==='kw-1'),optKw=q1.clues.find(c=>c.id==='kw-2');
assert.deepEqual(stemKw.matchLocations,[{field:'stem',optionId:'',count:1}],'题干关键词导入后重算位置');
assert.deepEqual(optKw.matchLocations,[{field:'option',optionId:'A',count:1}],'选项关键词只在该选项内计数（source 隔离）');

/* ── Bug4：家族成员插入母题正下方 ────────────────────────── */

vm.runInContext(`
  state.questionBank.questions=[];
  const root=normalizeQuestion({id:'q-root-1',title:'母题',stemParts:[{text:'母题干'}],options:[{id:'A',text:'a'},{id:'B',text:'b'},{id:'C',text:'c'},{id:'D',text:'d'}],correctAnswer:'A',analysis:'x',metadata:{questionFamily:{role:'root',familyKey:'FAM-9'}}},0,'PMP');
  const other=normalizeQuestion({id:'q-other-1',title:'独立题',stemParts:[{text:'独立干'}],options:[{id:'A',text:'a'},{id:'B',text:'b'},{id:'C',text:'c'},{id:'D',text:'d'}],correctAnswer:'A',analysis:'x'},1,'PMP');
  state.questionBank.questions.push(root,other);
  state.currentQuestionId='q-root-1';
`,context);
vm.runInContext('createFamilyMemberFromCurrent()',context);
let order=run(`state.questionBank.questions.map(q=>q.id)`);
assert.equal(order.length,3,'共 3 题');
assert.equal(order[0],'q-root-1','母题第一');
assert.ok(order[1]!=='q-other-1','新成员插在母题正下方（独立题之前）');
const member=run(`state.questionBank.questions[1]`);
assert.equal(member.metadata.questionFamily.role,'member','新题是家族成员');
assert.equal(member.metadata.questionFamily.rootQuestionId,'q-root-1','绑定母题');

/* 再创建第二个成员：应插在第一个成员之后、独立题之前 */
vm.runInContext(`state.currentQuestionId=${JSON.stringify(member.id)};createFamilyMemberFromCurrent()`,context);
order=run(`state.questionBank.questions.map(q=>q.id)`);
assert.equal(order.length,4,'共 4 题');
assert.equal(order[3],'q-other-1','独立题仍在末尾，第二成员紧随第一成员');

console.log('family ui regression: passed');
