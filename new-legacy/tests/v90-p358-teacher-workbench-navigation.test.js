'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const assert=require('assert/strict');
const vm=require('vm');
const {execFileSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const REPO=path.resolve(ROOT,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

assert(read('VERSION').trim(),'release version must not be empty');

const adminPages=['admin-console.html','admin-subjects.html','teacher-workbench.html','question-bank.html','paper-management.html','course-admin.html','user-management.html','feedback-management.html','message-management.html','admin-operations.html','admin-settings.html','system-settings.html'];
for(const file of adminPages){
  const html=read(file);
  assert.equal((html.match(/data-admin-nav=/g)||[]).length,9,`${file} primary nav count`);
  assert(html.includes('data-admin-nav="teacher" href="teacher-workbench.html">教师工作台</a>'),`${file} teacher entry`);
  assert(!html.includes('data-admin-nav="questions"'),`${file} legacy question primary entry`);
  assert(!html.includes('data-admin-nav="papers"'),`${file} legacy paper primary entry`);
}

const workbench=read('teacher-workbench.html');
assert(workbench.includes('data-admin-context="teacher"'));
assert(workbench.includes('data-question-catalog-mode="managed"'),'teacher workbench must request the shared managed catalog');
assert.equal((workbench.match(/data-workflow-card=/g)||[]).length,3);
assert(workbench.includes('data-workflow-card="papers"'));
assert(workbench.includes('<b>3</b><strong>管理试卷</strong>'));
assert(workbench.includes('href="paper-management.html">试卷管理</a>'));
assert(!workbench.includes('data-workflow-card="courses"'));
assert(!workbench.includes('>课程设置</a>'));
assert(workbench.includes('id="wbPaperDraftCount"')&&workbench.includes('id="wbPublishedPaperCount"'));

const question=read('question-bank.html');
assert(question.includes('data-admin-context="teacher"'));
assert(question.includes('<a href="paper-management.html">试卷管理</a>'));
assert(question.includes('<b>3</b>管理试卷'));
assert(!question.includes('<b>3</b>设置课程'));

const paper=read('paper-management.html');
assert(paper.includes('data-admin-context="teacher"'));
assert(paper.includes('<header class="tw-topbar pm-shell-topbar">'));
assert(paper.includes('<a class="active" href="paper-management.html">试卷管理</a>'));
assert(paper.includes('<a class="tw-step active" href="paper-management.html"><b>3</b>管理试卷</a>'));

const course=read('course-admin.html');
assert(course.includes('<h1>课程与任务</h1>'));
assert(!course.includes('<header class="tw-topbar">'));
assert(!course.includes('<section class="tw-workflow"'));
assert(!course.includes('data-config-view="papers"'));
assert(!course.includes('data-config-panel="papers"'));
assert(course.includes('data-config-view="courses"')&&course.includes('data-config-view="tasks"'));

const workbenchApp=read('src/91-teacher-workbench-app.js');
assert(workbenchApp.includes("wbPaperDraftCount"));
assert(workbenchApp.includes("wbPublishedPaperCount"));
assert(workbenchApp.includes("paper-management.html"));
assert(!workbenchApp.includes('getCourseDrafts()'));
assert(!workbenchApp.includes('kg_question_banks_v1__'),'workbench must not read an account-local question catalog');
assert(!workbenchApp.includes('kg_exam_papers_v1__'),'workbench must not read account-local paper drafts');
assert(read('src/97-teacher-question-workflow.js').includes('下一步：试卷管理'));
assert(read('src/39-global-shortcuts.js').includes('label:"教师工作台", href:"teacher-workbench.html"'));

function createWorkbenchRuntime({adapterMissing=false}={}){
  const elements=new Map();
  const documentListeners=new Map();
  const windowListeners=new Map();
  const reads=[];
  let catalog={
    banks:[
      {id:'bank-a',questionCount:2},
      {id:'bank-b',questionCount:2},
    ],
    questions:[
      {id:'q-configured',bankId:'bank-a',lifecycle:{status:'active'},clues:[{text:'关键词',recallNodeId:'node-1'}]},
      {id:'q-pending',bankId:'bank-a',lifecycle:{status:'active'},clues:[]},
      {id:'q-quick',bankId:'bank-b',lifecycle:{status:'active'},clues:[{text:'快速线索',sourceMode:'quick'}]},
      {id:'q-deleted',bankId:'bank-b',lifecycle:{status:'deleted'},clues:[]},
    ],
    catalogRevision:'catalog-1',
    contentRevision:11,
  };
  const storage=new Map([
    ['kg_assessment_papers_v1',JSON.stringify([
      {id:'paper-draft',status:'draft'},
      {id:'paper-published',status:'published'},
      {id:'paper-archived',status:'archived'},
    ])],
    ['kg_course_config_drafts_v1',JSON.stringify([{id:'course-shared'}])],
    ['kg_learning_tasks_v1',JSON.stringify([{id:'task-shared',status:'draft'}])],
    ['kg_exam_papers_v1__user__teacher-a',JSON.stringify(Array.from({length:9},(_,index)=>({id:`account-paper-${index}`})))],
  ]);
  let releaseReady,failReady;
  const ready=new Promise((resolve,reject)=>{releaseReady=resolve;failReady=reject});
  function element(id){
    if(!elements.has(id))elements.set(id,{id,textContent:'0',href:'',dataset:{}});
    return elements.get(id);
  }
  const document={
    body:{dataset:{questionCatalogMode:'managed'}},
    getElementById:element,
    addEventListener(type,listener){
      const rows=documentListeners.get(type)||[];rows.push(listener);documentListeners.set(type,rows);
    },
  };
  const window={
    document,
    KGQuestionCatalogAdapter:{ready,snapshot:()=>JSON.parse(JSON.stringify(catalog))},
    KGAppStorage:{readJSON(key,fallback){reads.push(key);const raw=storage.get(key);return raw===undefined?fallback:JSON.parse(raw)}},
    KGLearningContent:{currentUser:()=>({name:'共享教师',role:'teacher'})},
    KGAuthCore:{currentUsername:()=> 'teacher-a'},
    addEventListener(type,listener){
      const rows=windowListeners.get(type)||[];rows.push(listener);windowListeners.set(type,rows);
    },
    dispatchEvent(event){for(const listener of windowListeners.get(event.type)||[])listener(event)},
  };
  if(adapterMissing)delete window.KGQuestionCatalogAdapter;
  class CustomEvent{constructor(type,options={}){this.type=type;this.detail=options.detail}}
  const context=vm.createContext({window,document,CustomEvent,JSON,String,Number,Array,Promise,console,setTimeout,clearTimeout});
  vm.runInContext(workbenchApp,context,{filename:'91-teacher-workbench-app.js'});
  return {
    body:document.body,
    element,
    reads,
    storage,
    releaseReady,
    failReady,
    setCatalog(next){catalog=next},
    async domReady(){for(const listener of documentListeners.get('DOMContentLoaded')||[])await listener()},
    emit(type){window.dispatchEvent(new CustomEvent(type))},
  };
}

async function testSharedWorkbenchRendering(){
  const runtime=createWorkbenchRuntime();
  const pendingInit=runtime.domReady();
  await Promise.resolve();
  assert.equal(runtime.element('wbQuestionCount').textContent,'0','workbench must wait for the managed catalog bootstrap');
  runtime.releaseReady();
  await pendingInit;
  assert.equal(runtime.element('wbQuestionCount').textContent,'3');
  assert.equal(runtime.element('wbTrainingPendingCount').textContent,'1');
  assert.equal(runtime.element('wbPaperDraftCount').textContent,'1');
  assert.equal(runtime.element('wbPublishedPaperCount').textContent,'1');
  assert.equal(runtime.body.dataset.sharedBankCount,'2');
  assert.equal(runtime.body.dataset.sharedCourseCount,'1');
  assert.equal(runtime.body.dataset.sharedTaskCount,'1');

  runtime.setCatalog({
    banks:[{id:'bank-a',questionCount:1}],
    questions:[{id:'q-remote',bankId:'bank-a',lifecycle:{status:'active'},clues:[]}],
    catalogRevision:'catalog-2',
    contentRevision:12,
  });
  runtime.emit('kg:question-catalog-changed');
  assert.equal(runtime.element('wbQuestionCount').textContent,'1');
  assert.equal(runtime.element('wbTrainingPendingCount').textContent,'1');

  runtime.storage.set('kg_assessment_papers_v1',JSON.stringify([
    {id:'paper-published-2',status:'published'},
    {id:'paper-published-3',status:'published'},
  ]));
  runtime.emit('kg:server-state-reloaded');
  assert.equal(runtime.element('wbPaperDraftCount').textContent,'0');
  assert.equal(runtime.element('wbPublishedPaperCount').textContent,'2');

  runtime.storage.set('kg_assessment_papers_v1',JSON.stringify([
    {id:'paper-archived-only',status:'archived'},
  ]));
  runtime.setCatalog({
    banks:[{id:'bank-a',questionCount:1}],
    questions:[{id:'q-configured-again',bankId:'bank-a',lifecycle:{status:'active'},clues:[{text:'快速线索',sourceMode:'quick'}]}],
    catalogRevision:'catalog-3',
    contentRevision:13,
  });
  runtime.emit('kg:question-catalog-changed');
  runtime.emit('kg:server-state-reloaded');
  assert.equal(runtime.element('wbPaperCardState').textContent,'创建第一张试卷');
  assert.equal(runtime.element('wbNextTitle').textContent,'创建第一张学习试卷');
}

async function testCatalogFailureIsNotRenderedAsAnEmptyCatalog(){
  const runtime=createWorkbenchRuntime();
  const pendingInit=runtime.domReady();
  runtime.failReady(new Error('catalog unavailable'));
  await pendingInit;
  assert.equal(runtime.element('wbQuestionCount').textContent,'—');
  assert.equal(runtime.element('wbTrainingPendingCount').textContent,'—');
  assert.equal(runtime.element('wbNextTitle').textContent,'暂时无法读取公共题库');
  assert.equal(runtime.element('wbNextAction').textContent,'重新加载');
  runtime.emit('kg:server-state-reloaded');
  runtime.emit('kg:question-catalog-changed');
  assert.equal(runtime.element('wbQuestionCount').textContent,'—','events after bootstrap failure must not render a false empty catalog');
  assert.equal(runtime.element('wbNextTitle').textContent,'暂时无法读取公共题库');
}

async function testMissingCatalogAdapterIsNotRenderedAsAnEmptyCatalog(){
  const runtime=createWorkbenchRuntime({adapterMissing:true});
  await runtime.domReady();
  assert.equal(runtime.element('wbQuestionCount').textContent,'—');
  assert.equal(runtime.element('wbTrainingPendingCount').textContent,'—');
  assert.equal(runtime.element('wbNextTitle').textContent,'暂时无法读取公共题库');
}

function testGeneratedManagedCatalogInjection(){
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'kg-workbench-contract-'));
  try{
    execFileSync(process.execPath,[path.join(REPO,'frontend/scripts/sync-new-legacy.js'),'--source',ROOT,'--out',output],{stdio:'pipe'});
    const generated=fs.readFileSync(path.join(output,'teacher-workbench.html'),'utf8');
    assert(generated.includes('data-question-catalog-mode="managed"'));
    const adapter=generated.indexOf('question-catalog-adapter.js');
    const app=generated.indexOf('src/91-teacher-workbench-app.js');
    assert(adapter>=0,'generated teacher workbench must include the managed catalog adapter');
    assert(adapter<app,'managed catalog adapter must be declared before the workbench app');
  }finally{
    fs.rmSync(output,{recursive:true,force:true});
  }
}

(async()=>{
  await testSharedWorkbenchRendering();
  await testCatalogFailureIsNotRenderedAsAnEmptyCatalog();
  await testMissingCatalogAdapterIsNotRenderedAsAnEmptyCatalog();
  testGeneratedManagedCatalogInjection();
  console.log('v90-p358-teacher-workbench-navigation-static-ok');
})().catch(error=>{console.error(error);process.exitCode=1});
