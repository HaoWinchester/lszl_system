// Regression coverage for the native button audit, including pending (ungraded) choices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './helpers/page-harness.mjs';
import { createPracticeRun } from '../domain/pc-practice.ts';
import { getModePolicy, formatTimer } from '../domain/mode-policy.ts';
import { mergeDraft, moveQuestion, toggleAnswer, toggleMarked } from '../domain/practice-state.ts';
import { createSyncCoordinator, classifyFailure, resolveConflict } from '../domain/sync-coordinator.ts';

async function pendingMultipleChoice({mode='practice',localDraft=null,confirm=true}={}) {
  const session={id:'audit-multiple',mode,status:'active',revision:1,
    paperId:'audit-paper',releaseId:'audit-release',answers:{},runtimeState:{},stats:{},
    questions:[{questionId:'q1',question:{id:'q1',type:'multiple_choice',correctOptionIds:['A','C'],
      options:[{id:'A',text:'甲'},{id:'B',text:'乙'},{id:'C',text:'丙'}]}}]};
  let pauseInput;
  const {page}=await loadPage('practice',{
    createPracticeRun,getModePolicy,formatTimer,mergeDraft,moveQuestion,toggleAnswer,toggleMarked,
    createSyncCoordinator,classifyFailure,resolveConflict,ApiError:class extends Error {},
    getCurrentUser:()=>({username:'audit-student'}),getSession:async()=>structuredClone(session),
    loadLocalDraft:()=>localDraft,saveLocalDraft(){},clearLocalDraft(){},messageOf:error=>error.message,
    pauseSession:async(id,input)=>{pauseInput=input;return {...session,status:'paused',revision:2};},
    saveState:async(id,input)=>{pauseInput=input;return {...session,revision:session.revision+1,runtimeState:input.runtimeState};},
  },{showModal:async()=>({confirm,cancel:!confirm})});
  page.data.sessionId=session.id;
  page.syncCoordinator=createSyncCoordinator(job=>page.executeSyncJob(job));
  await page.loadSession();
  page.onAnswerChange({detail:{optionId:'A'}});
  page.onAnswerChange({detail:{optionId:'C'}});
  assert.deepEqual(page.data.selectedIds,['A','C']);
  return {page,session,pauseInput:()=>pauseInput};
}

test('selected multiple-choice must be distinguished from a completely unanswered question in the sheet',async()=>{
  const {page}=await pendingMultipleChoice();
  page.onOpenSheet();
  assert.notEqual(page.data.sheetItems[0].label,'未答','A/C are selected, but the sheet still reports 未答');
});

test('opening and dismissing the sheet repeatedly preserves pending choices without grading or navigation',async()=>{
  const {page}=await pendingMultipleChoice();
  const currentIndex=page.data.currentIndex;
  for(let attempt=0;attempt<2;attempt++) {
    page.onOpenSheet();
    assert.equal(page.data.sheetOpen,true);
    assert.equal(page.data.sheetItems[0].label,'已选，尚未提交');
    page.onCloseSheet();
    assert.equal(page.data.sheetOpen,false);
    assert.deepEqual(page.data.selectedIds,['A','C']);
    assert.equal(page.data.currentIndex,currentIndex);
    assert.equal(page.run.stats().answered,0);
  }
});

test('save-and-exit must send the pending multiple selection to the server for second-device recovery',async()=>{
  const {page,pauseInput}=await pendingMultipleChoice();
  await page.onExit();
  // Pending choices belong to resumable runtime, not the PC locked-answer payload.
  assert.deepEqual(pauseInput().runtimeState.pendingSelections?.q1,['A','C'],
    'The actual Page pause payload drops the only selected answer');
  assert.deepEqual(pauseInput().answers,{});
  assert.equal(page.run.stats().answered,0);
});

test('cold reload restores pending selections without grading; local removal wins at the same revision',async()=>{
  const {page,session}=await pendingMultipleChoice();
  session.runtimeState={pendingSelections:{q1:['A','C']}};
  page.setData({answers:{},selectedIds:[]});
  await page.loadSession();
  assert.deepEqual(page.data.selectedIds,['A','C']);
  assert.equal(page.data.submitted,false);
  assert.equal(page.run.stats().answered,0);
  page.onAnswerChange({detail:{optionId:'C'}});
  assert.deepEqual(page.modeRuntimeState().pendingSelections,{q1:['A']});
  page.onAnswerChange({detail:{optionId:'A'}});
  assert.deepEqual(page.modeRuntimeState().pendingSelections,{});
  assert.equal(page.buildSheetItems()[0].label,'未答');
});

test('sheet check submits selected multiple choice before looking for remaining unanswered questions',async()=>{
  const {page}=await pendingMultipleChoice();
  let completion;
  page.executeSyncJob=async job=>{completion=job.payload; return {session:{id:'audit-multiple'}};};
  await page.onComplete();
  assert.deepEqual(completion.answers.q1.selectedAnswerIds,['A','C']);
  assert.deepEqual(completion.runtimeState.pendingSelections,{});
  assert.equal(page.run.stats().answered,1);
  assert.equal(page.run.runtime().experience,10);
});

test('new local tentative choice and clearing override saved tentative values, never locked answers',()=>{
  const server={sessionId:'s',username:'u',revision:2,currentIndex:0,answers:{q1:['A','C'],q2:['A']},
    lockedAnswers:{q2:{selectedAnswer:'A',selectionIndex:1}},markedQuestionIds:[],savedAt:1};
  const local={...server,answers:{q1:[],q2:['B']}};
  assert.deepEqual(mergeDraft(server,local).state.answers,{q1:[],q2:['A']});
});

test('keep-local conflict recovery preserves tentative removal but keeps server locked answers',async()=>{
  const localDraft={sessionId:'audit-multiple',username:'audit-student',revision:1,currentIndex:0,
    answers:{},markedQuestionIds:[],savedAt:1};
  const {page,session,pauseInput}=await pendingMultipleChoice({localDraft,confirm:false});
  localDraft.answers={q1:['A']};
  session.revision=2; session.runtimeState={pendingSelections:{q1:['A','C']}};
  await page.handleWriteError({statusCode:409});
  assert.deepEqual(page.data.selectedIds,['A']);
  assert.deepEqual(page.modeRuntimeState().pendingSelections,{q1:['A']});
  assert.equal(page.syncRevision,2);
  await page.retryWrites();
  assert.equal(page.data.writeError,'');
  assert.equal(pauseInput().revision,2);
  assert.deepEqual(pauseInput().runtimeState.pendingSelections,{q1:['A']});
});

test('scholar sheet navigation completes immediately when committing a selection exhausts health',async()=>{
  const {page,session}=await pendingMultipleChoice({mode:'scholar'});
  session.questions.push({questionId:'q2',question:{id:'q2',type:'single_choice',correctAnswer:'A',options:[{id:'A'}]}});
  await page.loadSession();
  page.run.patchRuntime({health:1});
  page.onAnswerChange({detail:{optionId:'B'}});
  let completion;
  page.executeSyncJob=async job=>{completion=job.payload;return {session:{id:session.id}};};
  await page.goTo(1);
  assert.equal(page.run.runtime().health,0);
  assert.equal(page.data.currentIndex,0);
  assert.equal(page.run.stats().answered,1);
  assert.deepEqual(completion.answers.q1.selectedAnswerIds,['B']);
});

test('changing practice mode after declining resume must not silently reopen the old mode',async()=>{
  const {page,navigation}=await loadPage('practice-setup',{
    MODE_CHOICES:[],messageOf:error=>error.message,
    startSession:async input=>({id:'new-'+input.mode}),
  },{showModal:async()=>({confirm:false,cancel:true})});
  page.onLoad({paperId:'p',releaseId:'r',count:'3',mode:'normal'});
  await page.resolveExistingSession({detail:{detail:{sessionId:'old-normal'}}});
  page.onMode({currentTarget:{dataset:{mode:'challenge'}}});
  assert.equal(page.data.mode,'challenge');
  await page.start();
  assert.ok(!navigation.some(route=>route.url?.includes('sessionId=old-normal')),
    'The visible challenge selection is ignored and old-normal is opened');
});

for(const [handler,dataset,key,value] of [
  ['onCount',{value:20},'count',20],['onOrder',{order:'random'},'order','random'],
]) test(`${key} changes require a fresh lookup and never abandon the previous session implicitly`,async()=>{
  let started,abandoned=0;
  const {page,navigation}=await loadPage('practice-setup',{
    MODE_CHOICES:[],messageOf:error=>error.message,
    startSession:async input=>{started=input;return {id:'new-session'};},
    abandonSession:async()=>{abandoned++;},
  },{showModal:async()=>({confirm:false,cancel:true})});
  page.onLoad({paperId:'p',releaseId:'r',count:'60'});
  await page.resolveExistingSession({detail:{detail:{sessionId:'old-session'}}});
  page[handler]({currentTarget:{dataset}});
  await page.start();
  assert.equal(started[key],value); assert.equal(abandoned,0);
  assert.match(navigation.at(-1).url,/sessionId=new-session/);
});

test('unchecking consent during binding must block the account submission',async()=>{
  let submitted=0;
  const {page}=await loadPage('login',{
    messageOf:error=>error.message,
    bindExistingAccount:async()=>{submitted++;return {status:'authenticated'};},
  });
  Object.assign(page.data,{stage:'binding',formMode:'bind',bindingTicket:'audit-ticket',
    username:'audit-student',password:'audit-only',accepted:true});
  page.onToggleAccepted();
  assert.equal(page.data.accepted,false);
  await page.onSubmitAccount();
  assert.equal(submitted,0,'Account submission still runs after the user withdraws consent');
});

for(const formMode of ['bind','register']) test(`${formMode}: consent withdrawal preserves input and rechecking permits retry`,async()=>{
  let submitted=0;
  const {page,navigation}=await loadPage('login',{
    messageOf:error=>error.message,
    bindExistingAccount:async()=>{submitted++;}, registerAccount:async()=>{submitted++;},
  });
  Object.assign(page.data,{stage:'binding',formMode,bindingTicket:'audit-ticket',username:'audit',password:'audit-pass',accepted:false});
  await page.onSubmitAccount();
  assert.equal(submitted,0); assert.ok(page.data.error); assert.equal(page.data.password,'audit-pass');
  assert.equal(navigation.length,0);
  page.onToggleAccepted(); await page.onSubmitAccount();
  assert.equal(submitted,1); assert.equal(navigation.at(-1).url,'/pages/home/index');
});
