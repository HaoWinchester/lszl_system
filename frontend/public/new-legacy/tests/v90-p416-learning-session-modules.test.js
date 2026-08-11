'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

class MemoryStorage{
  constructor(seed={}){this.map=new Map(Object.entries(seed));}
  getItem(key){return this.map.has(String(key))?this.map.get(String(key)):null;}
  setItem(key,value){this.map.set(String(key),String(value));}
  removeItem(key){this.map.delete(String(key));}
  clear(){this.map.clear();}
}
function load(file,context){
  const code=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  vm.runInContext(code,context,{filename:file});
}
function createContext(seed={}){
  const localStorage=new MemoryStorage(seed);
  const sessionStorage=new MemoryStorage();
  const events=[];
  const location={href:'http://localhost/question-training.html',pathname:'/question-training.html',search:'',hash:''};
  const history={replaceState(_s,_t,href){location.href='http://localhost/'+href;const u=new URL(location.href);location.pathname=u.pathname;location.search=u.search;location.hash=u.hash;},pushState(_s,_t,href){this.replaceState(_s,_t,href);}};
  const context=vm.createContext({
    console,JSON,Date,Math,URL,URLSearchParams,encodeURIComponent,decodeURIComponent,
    localStorage,sessionStorage,location,history,
    CustomEvent:class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}},
    addEventListener(){},dispatchEvent(event){events.push(event);return true;},
    KGAuthCore:{currentUsername:()=> 'tester'},
    KGRolePermissions:{canOperateQuestion:()=>true,canUseDeepRecallQuestion:()=>true},
    KGStorageKeys:{PUBLISHED_PAPERS:'kg_exam_papers_published_v1',PAPER_RELEASE_HISTORY:'kg_exam_paper_release_history_v1',PREFIXES:{LEARNING_SESSION:'kg_learning_sessions_v2__'}},
    KGAppStorage:{
      readString:(key,fallback='')=>localStorage.getItem(key)??fallback,
      readJSON:(key,fallback=null)=>{try{return JSON.parse(localStorage.getItem(key)??'null')??fallback}catch{return fallback}},
      writeJSON:(key,value)=>{localStorage.setItem(key,JSON.stringify(value));return true;}
    }
  });
  context.window=context;
  context.globalThis=context;
  context.__events=events;
  return context;
}
function release({paperId='paper-a',releaseId='rel-1',version=1,status='published',questionId='q-1',snapshotQuestion,enabledModes}={}){
  const question=snapshotQuestion===undefined?{id:questionId,title:'Question '+version,stemParts:[{text:'v'+version}],options:[]}:snapshotQuestion;
  return {
    paperId,releaseId,version,status,name:'Paper A',subject:'PMP',publishedAt:version*100,
    enabledModes:enabledModes||['deep_recall','multi_question_canvas','single_deep_study'],
    questions:[{bankId:'bank-a',questionId,order:1,score:1}],
    questionSnapshots:question===null?[]:[{bankId:'bank-a',bankName:'Bank A',questionId,question}]
  };
}

{
  const current=release({releaseId:'rel-2',version:2});
  const historical=release({releaseId:'rel-1',version:1});
  const ctx=createContext({
    kg_exam_papers_published_v1:JSON.stringify([current]),
    kg_exam_paper_release_history_v1:JSON.stringify([historical])
  });
  load('src/59-published-paper-repository.js',ctx);
  load('src/59a-published-question-resolver.js',ctx);
  const oldResult=ctx.KGPublishedQuestionResolver.resolveQuestion({paperId:'paper-a',releaseId:'rel-1',questionId:'q-1',bankId:'bank-a',mode:'single_deep_study'},{respectRole:true});
  assert.equal(oldResult.ok,true);
  assert.equal(oldResult.code,'RELEASE_SUPERSEDED');
  assert.equal(oldResult.question.title,'Question 1');
  assert.equal(oldResult.question.sourceReleaseId,'rel-1');
  const currentResult=ctx.KGPublishedQuestionResolver.resolveQuestion({paperId:'paper-a',releaseId:'rel-2',questionId:'q-1',mode:'single_deep_study'});
  assert.equal(currentResult.question.title,'Question 2');
  assert.equal(JSON.stringify(Array.from(ctx.KGPublishedPaperRepository.listReleases(),x=>x.releaseId)),JSON.stringify(['rel-2']));
  assert.equal(JSON.stringify(Array.from(ctx.KGPublishedPaperRepository.listReleases({includeHistory:true}),x=>x.releaseId)),JSON.stringify(['rel-2','rel-1']));
}

{
  const withdrawn=release({paperId:'paper-withdrawn',releaseId:'rel-w',version:1});
  const ctx=createContext({kg_exam_paper_release_history_v1:JSON.stringify([withdrawn])});
  load('src/59-published-paper-repository.js',ctx);
  load('src/59a-published-question-resolver.js',ctx);
  const result=ctx.KGPublishedQuestionResolver.resolvePaper({paperId:'paper-withdrawn',releaseId:'rel-w',mode:'deep_recall'});
  assert.equal(result.ok,false);
  assert.equal(result.code,'RELEASE_WITHDRAWN');
}

{
  const missing=release({paperId:'paper-missing',releaseId:'rel-m',snapshotQuestion:null});
  const damaged=release({paperId:'paper-damaged',releaseId:'rel-d',snapshotQuestion:{id:'q-1',stemParts:'bad',options:[]}});
  const ctx=createContext({kg_exam_papers_published_v1:JSON.stringify([missing,damaged])});
  load('src/59-published-paper-repository.js',ctx);
  load('src/59a-published-question-resolver.js',ctx);
  assert.equal(ctx.KGPublishedQuestionResolver.resolveQuestion({paperId:'paper-missing',releaseId:'rel-m',questionId:'q-1',mode:'deep_recall'}).code,'QUESTION_SNAPSHOT_MISSING');
  assert.equal(ctx.KGPublishedQuestionResolver.resolveQuestion({paperId:'paper-damaged',releaseId:'rel-d',questionId:'q-1',mode:'deep_recall'}).code,'QUESTION_SNAPSHOT_DAMAGED');
  ctx.KGRolePermissions.canOperateQuestion=()=>false;
  const forbidden=release({paperId:'paper-forbidden',releaseId:'rel-f'});
  ctx.localStorage.setItem('kg_exam_papers_published_v1',JSON.stringify([forbidden]));
  ctx.KGPublishedPaperRepository.invalidate();
  assert.equal(ctx.KGPublishedQuestionResolver.resolveQuestion({paperId:'paper-forbidden',releaseId:'rel-f',questionId:'q-1',mode:'single_deep_study'}).code,'QUESTION_FORBIDDEN');
}

{
  const ctx=createContext();
  load('src/59a-published-question-resolver.js',ctx);
  load('src/59b-learning-route-context.js',ctx);
  load('src/62-learning-session-store.js',ctx);
  load('src/62a-learning-progress.js',ctx);
  const v1={paperId:'paper-a',releaseId:'rel-1',questionId:'q-1',bankId:'bank-a',mode:'single_deep_study'};
  const v2={paperId:'paper-a',releaseId:'rel-2',questionId:'q-1',bankId:'bank-a',mode:'single_deep_study'};
  ctx.KGLearningSession.ensure(v1,{userId:'tester'});
  ctx.KGLearningSession.update(v1,{currentStep:3},'tester');
  ctx.KGLearningSession.ensure(v2,{userId:'tester'});
  assert.equal(ctx.KGLearningSession.get(v1,'tester').currentStep,3);
  assert.equal(ctx.KGLearningSession.get(v2,'tester').currentStep,1);
  assert.equal(ctx.KGLearningSession.list('tester').length,2);

  let flushed=0,cleared=0,loaded=0;
  ctx.KGLearningProgress.registerAdapter('single_deep_study',{flush(){flushed++;},clearTransient(){cleared++;},load(){loaded++;}});
  ctx.KGLearningProgress.activate(v1,{userId:'tester'});
  ctx.KGLearningProgress.activate(v2,{userId:'tester'});
  assert.equal(flushed,1);
  assert.equal(cleared,1);
  assert.equal(loaded,2);
  assert.equal(ctx.KGLearningSession.get(v1,'tester').currentStep,3);

  const href=ctx.KGLearningRouteContext.buildHref('question-training.html',{...v1,source:'test',returnUrl:'question-workspace.html?workspace=w1'});
  assert.match(href,/paperId=paper-a/);
  assert.match(href,/releaseId=rel-1/);
  assert.match(href,/questionId=q-1/);
  assert.match(href,/return=question-workspace/);
  const unsafe=ctx.KGLearningRouteContext.normalize({...v1,returnUrl:'https://evil.example/a'});
  assert.equal(unsafe.returnUrl,'index.html');
}

{
  const ctx=createContext();
  load('src/59a-published-question-resolver.js',ctx);
  load('src/59b-learning-route-context.js',ctx);
  load('src/62-learning-session-store.js',ctx);
  const legacyKey='kg_learning_sessions_v2__tester';
  ctx.localStorage.setItem(legacyKey,JSON.stringify({version:2,userId:'tester',sessions:{'q-legacy':{userId:'tester',questionId:'q-legacy',mode:'single_deep_study',currentStep:4,updatedAt:1}}}));
  const migrated=ctx.KGLearningSession.get({paperId:'paper-old',releaseId:'rel-old',questionId:'q-legacy',bankId:'bank-a',mode:'single_deep_study'},'tester');
  assert.equal(migrated.currentStep,4);
  assert.equal(migrated.contextKey,'paper-old::rel-old::q-legacy');
  const bucket=JSON.parse(ctx.localStorage.getItem(legacyKey));
  assert.ok(bucket.sessions['paper-old::rel-old::q-legacy']);
  assert.equal(bucket.sessions['q-legacy'],undefined);
}

console.log('v90-p416-learning-session-modules-ok');
