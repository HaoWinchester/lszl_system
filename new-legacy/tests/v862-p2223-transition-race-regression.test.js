'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/66-question-navigator.js'),'utf8');

let now=0,nextTimerId=1;
const timers=new Map();
function setTimer(fn,delay=0){
  const id=nextTimerId++;
  timers.set(id,{id,at:now+Math.max(0,Number(delay)||0),fn});
  return id;
}
function clearTimer(id){timers.delete(id)}
function advanceTo(target){
  while(true){
    const due=[...timers.values()].filter(t=>t.at<=target).sort((a,b)=>a.at-b.at||a.id-b.id)[0];
    if(!due)break;
    timers.delete(due.id);now=due.at;due.fn();
  }
  now=target;
}

const classes=new Set();
const classList={
  contains:name=>name==='question-training-page'||classes.has(name),
  add:name=>classes.add(name),
  remove:name=>classes.delete(name)
};
const htmlClasses=new Set();
const elements={qtQuestionSwitchLoader:{hidden:true},qtQuestionSwitchLoaderText:{textContent:''}};
const document={
  body:{classList},
  documentElement:{clientWidth:1200,classList:{add:n=>htmlClasses.add(n),remove:n=>htmlClasses.delete(n)}},
  getElementById:id=>elements[id]||null,
  querySelectorAll:()=>[],
  addEventListener:()=>{}
};
const paper={id:'p',name:'卷',questions:[{bankId:'b',questionId:'q1'},{bankId:'b',questionId:'q2'}]};
const bank={id:'b'};
const questions=[{id:'q1',title:'题1',sourceBankId:'b'},{id:'q2',title:'题2',sourceBankId:'b'}];
let currentPaperIndex=0;
const context={
  window:null,globalThis:null,document,console,URLSearchParams,
  location:{search:'',pathname:'/question-training.html',hash:''},history:{replaceState:()=>{}},
  navigator:{maxTouchPoints:0},matchMedia:()=>({matches:false}),
  setTimeout:setTimer,clearTimeout:clearTimer,requestAnimationFrame:fn=>{fn();return 1},
  authIsLoggedIn:()=>true,qCanOperateCurrentQuestion:()=>true,
  qBankState:{get currentPaperIndex(){return currentPaperIndex},set currentPaperIndex(v){currentPaperIndex=v}},
  qbCurrentPaper:()=>paper,
  qbPublishedPaperCatalog:()=>[{paper,items:questions.map((question,paperIndex)=>({paper,paperIndex,bank,question})),configuredCount:2,targetCount:2,availableCount:2,missingCount:0,blockedCount:0}],
  qbSelectPublishedPaper:(id,index)=>{currentPaperIndex=index;return paper},qbSaveCurrentPaper:()=>{},qbApplyPaperContext:()=>{},qbApplyCurrentQuestion:()=>{},
  renderQuestionTrainer:()=>{},KGQuestionRepository:{currentId:()=>questions[currentPaperIndex].id,notify:()=>{}},
  KGLearningSessionStore:{currentUserId:()=> 'u',get:()=>null},
  KGFlowOrchestrator:{captureLegacyState:()=>{},switchQuestion:()=>{}},KGGuidedLearningCanvas:{flushPendingConclusion:()=>{}},
  KGCanvasWorkspaceStore:null,addEventListener:()=>{}
};
context.window=context;context.globalThis=context;
vm.createContext(context);vm.runInContext(source,context,{filename:'src/66-question-navigator.js'});
const api=context.KGQuestionNavigator;

assert(api.switchTo(1));
advanceTo(0);      // 第一轮切题完成渲染，安排 80ms 外层定时器
advanceTo(80);     // 第一轮进入淡入阶段，安排 340ms 隐藏
assert.strictEqual(elements.qtQuestionSwitchLoader.hidden,false);

advanceTo(100);
assert(api.switchTo(0));
advanceTo(100);    // 第二轮完成渲染，第一轮隐藏任务应被取消
advanceTo(180);    // 第二轮进入淡入阶段，安排 440ms 隐藏
advanceTo(340);    // 原第一轮隐藏时刻
assert.strictEqual(elements.qtQuestionSwitchLoader.hidden,false,'旧切题任务不得提前隐藏新加载层');
assert.strictEqual(classes.has('qt-question-switch-entering'),true,'第二轮淡入状态应继续存在');

advanceTo(440);
assert.strictEqual(elements.qtQuestionSwitchLoader.hidden,true,'最新一轮动画结束后才隐藏加载层');
assert.strictEqual(classes.has('qt-question-switch-entering'),false);
console.log('v862-p2223-transition-race-regression-ok');
