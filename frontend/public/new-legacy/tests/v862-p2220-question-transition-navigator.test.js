'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/66-question-navigator.js'),'utf8');
const classes=new Set();
const classList={contains:n=>n==='question-training-page'||classes.has(n),add:n=>classes.add(n),remove:n=>classes.delete(n)};
const elements={qtQuestionSwitchLoader:{hidden:true},qtQuestionSwitchLoaderText:{textContent:''}};
const document={body:{classList},documentElement:{clientWidth:1200,classList:{add:n=>classes.add('html:'+n),remove:n=>classes.delete('html:'+n)}},getElementById:id=>elements[id]||null,querySelectorAll:()=>[],addEventListener:()=>{}};
const paper={id:'p',name:'卷',questions:[{bankId:'b',questionId:'q1'},{bankId:'b',questionId:'q2'}]},bank={id:'b'};
const q1={id:'q1',title:'题1',sourceBankId:'b'},q2={id:'q2',title:'题2',sourceBankId:'b'};
let currentPaperIndex=0;
const context={window:null,globalThis:null,document,console,URLSearchParams,location:{search:'',pathname:'/question-training.html',hash:''},history:{replaceState:()=>{}},navigator:{maxTouchPoints:0},matchMedia:()=>({matches:false}),
setTimeout:fn=>{fn();return 1},clearTimeout:()=>{},requestAnimationFrame:fn=>{fn();return 1},authIsLoggedIn:()=>true,qCanOperateCurrentQuestion:()=>true,
qBankState:{get currentPaperIndex(){return currentPaperIndex},set currentPaperIndex(v){currentPaperIndex=v}},qbCurrentPaper:()=>paper,
qbPublishedPaperCatalog:()=>[{paper,items:[{paper,paperIndex:0,bank,question:q1},{paper,paperIndex:1,bank,question:q2}],configuredCount:2,targetCount:2,availableCount:2,missingCount:0,blockedCount:0}],
qbSelectPublishedPaper:(id,index)=>{currentPaperIndex=index;return paper},qbSaveCurrentPaper:()=>{},qbApplyPaperContext:()=>{},qbApplyCurrentQuestion:()=>{},renderQuestionTrainer:()=>{},
KGQuestionRepository:{currentId:()=>currentPaperIndex===0?'q1':'q2',notify:()=>{}},KGLearningSessionStore:{currentUserId:()=> 'u',get:()=>null},
KGFlowOrchestrator:{captureLegacyState:()=>{},switchQuestion:()=>{}},KGCanvasWorkspaceStore:null,addEventListener:()=>{}};
context.window=context;context.globalThis=context;vm.createContext(context);vm.runInContext(source,context);
const api=context.KGQuestionNavigator;
assert(api.switchTo(1));
assert.strictEqual(elements.qtQuestionSwitchLoaderText.textContent,'正在切换到第 2 题');
assert.strictEqual(elements.qtQuestionSwitchLoader.hidden,true);
assert.strictEqual(classes.has('qt-question-switching'),false);
assert.strictEqual(classes.has('qt-question-switch-entering'),false);
console.log('v862-p2220-question-transition-navigator-ok');
