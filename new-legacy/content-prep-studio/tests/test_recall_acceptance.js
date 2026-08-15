'use strict';

/*
 * 页签④ 联想库验收器（参照 V8 智能记录版移植）核心逻辑回归：
 * 1. 索引：标题/英文/Alias 均可命中；ID 直达
 * 2. 未命中 / 多义 自动记录；断链 / 单候选 状态判定
 * 3. 路径防回跳：祖先节点被过滤
 * 4. 报告汇总计数
 */

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const stubEl=()=>({textContent:'',innerHTML:'',value:'',disabled:false,className:'',classList:{add(){},remove(){},toggle(){},contains:()=>false},addEventListener(){},appendChild(){},remove(){},contains:()=>false,closest:()=>null,dataset:{},style:{},querySelectorAll:()=>[],querySelector:()=>null,onclick:null,select(){}});
const document={getElementById:()=>stubEl(),body:stubEl(),createElement:()=>stubEl(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{}};
const store={};
const localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}};
const window={__KG_DIRECT_BOOTSTRAP__:{},addEventListener:()=>{},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},Blob:function(){}};
const context=vm.createContext({window,document,localStorage,Date,JSON,Math,Map,Set,Array,Object,String,Number,console,setTimeout,clearTimeout,confirm:()=>true});
for(const f of ['00-core-bootstrap.js','10-state-domain.js','12-p45-authoring-domain.js','16-recall-acceptance.js']){
  vm.runInContext(source(f),context,{filename:f});
}
const run=expr=>JSON.parse(vm.runInContext(`JSON.stringify(${expr})`,context));

/* 准备工作区联想库 */
vm.runInContext(`
  state.recallLibrary={schemaVersion:1,updatedAt:'',
    nodes:[
      {id:'r-pm',title:'项目经理',titleEn:'Project Manager',aliases:['PM','项目经理角色'],priority:3},
      {id:'r-st',title:'相关方',titleEn:'Stakeholder',aliases:['ST','干系人'],priority:2},
      {id:'r-risk',title:'风险登记册',aliases:[],priority:1},
      {id:'r-charter',title:'团队章程',aliases:[],priority:1}
    ],
    edges:[
      {id:'e1',from:'r-pm',to:'r-st',label:'管理',priority:5},
      {id:'e2',from:'r-pm',to:'r-risk',label:'维护',priority:3},
      {id:'e3',from:'r-st',to:'r-pm',label:'反向',priority:1}
    ]};
  RA.records=[];RA.lastRecordId=null;
  raSyncFromWorkspace(true);
`,context);

/* 1. 索引与命中方式 */
assert.equal(run(`raResolve('项目经理').ids[0]`),'r-pm','中文标题命中');
assert.equal(run(`raResolve('项目经理').mode`),'正式标题');
assert.equal(run(`raResolve('Project Manager').ids[0]`),'r-pm','英文标题命中');
assert.equal(run(`raResolve('PM').ids[0]`),'r-pm','Alias 命中');
assert.equal(run(`raResolve('r-risk').mode`),'ID','ID 直达');
assert.equal(run(`raResolve('不存在的词').ids.length`),0,'未命中');
vm.runInContext(`
  state.recallLibrary.nodes.push({id:'r-pm2',title:'PM',aliases:[]});
  RA.records=[];raSyncFromWorkspace(true);
`,context);
assert.equal(run(`raResolve('PM').mode`),'正式标题','同名多节点走标题多候选');
vm.runInContext(`state.recallLibrary.nodes.pop();RA.records=[];raSyncFromWorkspace(true)`,context);

/* 2. 自动记录：未命中 / 多义 / 断链 / 单候选 */
vm.runInContext(`RA.records=[];raRecordMiss('团队章程不存在')`,context);
assert.equal(run(`RA.records.at(-1).autoStatus`),'未命中','未命中自动记录');
vm.runInContext(`RA.path=['r-pm'];raRecordNodeEntry('r-st','input','相关方','正式标题')`,context);
assert.equal(run(`RA.records.at(-1).candidateCount`),1,'r-st 只有 r-pm 一个候选（反向边被祖先过滤后）→ 单候选');
vm.runInContext(`RA.path=['r-charter'];raRecordNodeEntry('r-charter','input','团队章程','正式标题')`,context);
assert.equal(run(`RA.records.at(-1).autoStatus`),'断链','无出边 → 断链');

/* 3. 防回跳：祖先过滤 */
vm.runInContext(`RA.path=['r-pm','r-st']`,context);
const elig=run(`raEligibleFor('r-st').map(e=>e.to)`);
assert.ok(!elig.includes('r-pm'),'祖先 r-pm 被过滤（防回跳）');

/* 4. 报告汇总 */
vm.runInContext(`RA.records.push({autoStatus:'未命中'},{autoStatus:'断链',manualVerdict:'联想不自然',note:'x'})`,context);
const report=run(`raReportObject()`);
assert.equal(report.testerVersion.includes('V8-recording'),true,'报告版本标识');
assert.equal(report.summary.unresolved>=1,true);
assert.equal(report.summary.deadEnds>=1,true);
assert.equal(report.summary.manualIssues,1);

/* 5. 人工判定更新最近一条（lastRecordId 指向的记录） */
vm.runInContext(`raAddRecord({type:'node',nodeTitle:'目标节点',autoStatus:'可继续',candidateCount:2,firstChoices:[],path:[]})`,context);
vm.runInContext(`raUpdateLatest('需补入口/Alias',false)`,context);
assert.equal(run(`raLatest().manualVerdict`),'需补入口/Alias','人工判定写入最近一条记录');

console.log('recall acceptance tester: passed');
