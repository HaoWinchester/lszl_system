'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/66-question-navigator.js'),'utf8');

const calls=[];
const paper1={id:'p1',name:'卷一',questions:[{bankId:'b1',questionId:'q1'}]};
const paper2={id:'p2',name:'卷二',questions:[{bankId:'b2',questionId:'q2'}]};
const bank1={id:'b1'},bank2={id:'b2'};
const q1={id:'q1',title:'题一',sourceBankId:'b1'},q2={id:'q2',title:'题二',sourceBankId:'b2'};
const catalog=[
  {paper:paper1,items:[{paper:paper1,paperIndex:0,bank:bank1,question:q1}],configuredCount:1,targetCount:1,availableCount:1,missingCount:0,blockedCount:0},
  {paper:paper2,items:[{paper:paper2,paperIndex:0,bank:bank2,question:q2}],configuredCount:1,targetCount:1,availableCount:1,missingCount:0,blockedCount:0}
];

const document={
  body:{classList:{contains:name=>name==='question-training-page',add:()=>{},remove:()=>{}}},
  documentElement:{clientWidth:1200},
  addEventListener:()=>{},
  getElementById:()=>null,
  querySelectorAll:()=>[]
};
const context={
  window:null,globalThis:null,document,console,
  URLSearchParams,CustomEvent:function(){},
  location:{search:'?questionId=q2&bankId=b2&paperId=p2&source=multi-question',pathname:'/question-training.html',hash:''},
  history:{replaceState:(...args)=>calls.push(['replaceState',...args])},
  navigator:{maxTouchPoints:0},
  matchMedia:()=>({matches:false}),
  setTimeout:fn=>{fn();return 1},
  requestAnimationFrame:fn=>{fn();return 1},
  authIsLoggedIn:()=>true,
  qCanOperateCurrentQuestion:()=>true,
  qBankState:{currentPaperIndex:0},
  qbCurrentPaper:()=>paper1,
  qbCurrentBank:()=>bank1,
  qbPublishedPaperCatalog:()=>catalog,
  qbSelectPublishedPaper:(paperId,index,options)=>{calls.push(['select',paperId,index,options]);context.qBankState.currentPaperIndex=index;return paperId==='p2'?paper2:paper1},
  renderQuestionTrainer:()=>calls.push(['renderQuestionTrainer']),
  KGQuestionRepository:{currentId:()=>q1.id,notify:reason=>calls.push(['notify',reason])},
  KGLearningSessionStore:{currentUserId:()=> 'u',get:()=>null},
  KGFlowOrchestrator:{captureLegacyState:()=>{},switchQuestion:opts=>calls.push(['flowSwitch',opts])},
  KGCanvasWorkspaceStore:null,
  addEventListener:()=>{}
};
context.window=context;context.globalThis=context;
vm.createContext(context);
vm.runInContext(source,context);

const api=context.KGQuestionNavigator;
assert(api);
const ok=api.applyIncomingQuestionTarget();
assert.strictEqual(ok,true);
const select=calls.find(row=>row[0]==='select');
assert(select,'target paper must be selected');
assert.strictEqual(select[1],'p2');
assert.strictEqual(select[2],0);
assert.strictEqual(!!select[3]?.applyQuestion,true);
assert(calls.some(row=>row[0]==='notify'&&row[1]==='workspace-question-switch'));
assert(calls.some(row=>row[0]==='replaceState'));
console.log('v862-p2219-question-deeplink-navigator-ok');
