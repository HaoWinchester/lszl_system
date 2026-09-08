// Opt-in integration audit. Input credentials arrive on stdin and are never logged.
// Uses production Page handlers, domain logic, storage, HTTP and service adapters.
// Only the WeChat host APIs are emulated; HTTP responses are never mocked.
import assert from 'node:assert/strict';
import { loadModule, loadPage } from '../helpers/page-harness.mjs';
import { sanitizeRichText } from '../../domain/rich-text.ts';
import { createPracticeRun } from '../../domain/pc-practice.ts';
import { getModePolicy, formatTimer } from '../../domain/mode-policy.ts';
import { mergeDraft, moveQuestion, toggleAnswer, toggleMarked } from '../../domain/practice-state.ts';
import { createSyncCoordinator, classifyFailure, resolveConflict } from '../../domain/sync-coordinator.ts';
import { pageRefreshMode, invalidateLearningPages } from '../../domain/page-freshness.ts';
import { subscriptionView } from '../../domain/subscription-view.ts';
import { avatarLetterOf } from '../../domain/profile-view.ts';

let input=''; for await (const chunk of process.stdin) input+=chunk;
const config=JSON.parse(input);
assert.equal(config.base, 'http://127.0.0.1:5173');
assert.equal(config.accounts.length, 10);
const storage=new Map(); // Shared device storage deliberately exercises username scoping.
const results=[];
const clients=[];
let requests=0;
async function waitFor(predicate, message) {
  const deadline=Date.now()+15000;
  while (!predicate()) {
    if(Date.now()>deadline) throw new Error(message);
    await new Promise(resolve=>setTimeout(resolve,10));
  }
}
async function clientFor(account) {
  const faults={dropCompletionResponse:false};
  const wx={
    getStorageSync:key=>storage.get(key), setStorageSync:(key,value)=>storage.set(key,structuredClone(value)),
    removeStorageSync:key=>storage.delete(key), getStorageInfoSync:()=>({keys:[...storage.keys()]}),
    request(options) {
      requests++;
      fetch(options.url, {method:options.method, headers:options.header,
        body:options.method==='GET' ? undefined : JSON.stringify(options.data), signal:AbortSignal.timeout(12000)})
        .then(async response=>{
          const data=await response.json();
          if(faults.dropCompletionResponse && options.url.endsWith('/complete') && response.ok) {
            faults.dropCompletionResponse=false;
            options.fail(new Error('Audit fault: response lost after real server commit'));
          } else options.success({statusCode:response.status,data});
        })
        .catch(error=>options.fail(error));
    },
    reLaunch() {},
  };
  const session=await loadModule('services/session.ts',{wx},['getSessionToken','setSession','getCurrentUser','clearSession']);
  const activate=(token=account.token)=>session.setSession(token,{username:account.username,role:'student'});
  activate();
  const http=await loadModule('services/http.ts',{wx,...session,getApiBaseUrl:()=>config.base},['request','ApiError','messageOf']);
  const auth=await loadModule('services/auth.ts',{wx,...session,...http,getApp:()=>({globalData:{}})},['validateSession','logout']);
  const {normalizeQuestion}=await loadModule('domain/question.ts',{sanitizeRichText},['normalizeQuestion']);
  const practice=await loadModule('services/practice.ts',{...http,normalizeQuestion,invalidateLearningPages},
    ['startSession','getSession','enterSession','saveState','pauseSession','abandonSession','completeSession','getReport','listSessions','getOverview','getExperienceSummary','getRevengeSummary','submitRevengeAnswer','getRemediation','markRemediationReviewed','getVerificationCandidate','submitVerification']);
  const subscription=await loadModule('services/subscription.ts',http,['getMySubscription']);
  const papers=await loadModule('services/papers.ts',http,['listPublishedPapers']);
  const drafts=await loadModule('domain/draft-store.ts',{wx},['loadLocalDraft','saveLocalDraft','clearLocalDraft','clearUserDrafts']);
  const deps={...session,...http,...auth,...practice,...subscription,...papers,...drafts,
    normalizeQuestion,createPracticeRun,getModePolicy,formatTimer,mergeDraft,moveQuestion,toggleAnswer,toggleMarked,
    createSyncCoordinator,classifyFailure,resolveConflict,pageRefreshMode,subscriptionView,avatarLetterOf,selectPrimaryTab(){}};
  return {deps,activate,faults};
}

for(const account of config.accounts) {
  const {deps:d,activate,faults}=await clientFor(account);
  clients.push({d,activate,account});
  const row={username:account.username,plan:account.plan,entitled:account.entitled,mode:account.mode,checks:[]};
  results.push(row);
  try {
    assert.equal((await d.validateSession()).username,account.username);
    const baselineCompleted=(await d.listSessions()).filter(item=>item.status==='completed').length;
    const access=await d.getMySubscription();
    assert.equal(access.entitlements.allExamPapers,account.entitled);
    row.checks.push('bearer identity + subscription entitlement');
    const {page:membership}=await loadPage('membership',d);
    await membership.loadMembership();
    assert.equal(membership.data.error,'');
    assert.deepEqual(membership.data.membership,subscriptionView(account.role || 'student',access));
    row.membership=membership.data.membership;
    row.findings=[];
    if(account.subscriptionStatus==='paused' && membership.data.membership.statusLabel!=='已暂停') {
      row.findings.push('后台会员已暂停，但页面显示待确认并提示重新同步；权限拦截正常，状态说明不准确。');
    }
    row.checks.push('read-only membership status + expiry');
    const catalog=await d.listPublishedPapers(1,100);
    const free=catalog.items.find(p=>p.releaseId===config.freeRelease);
    assert.ok(free);
    const member=catalog.items.find(p=>p.releaseId===config.memberRelease);
    assert.ok(member); assert.equal(member.contentRestricted,!account.entitled);
    const memberInput={paperId:member.paperId,releaseId:config.memberRelease,mode:'normal',count:3};
    if(account.entitled) {
      const memberSession=await d.startSession(memberInput);
      await d.abandonSession(memberSession.id,{revision:memberSession.revision,requestId:'audit-member-'+account.username});
    } else {
      await assert.rejects(d.startSession(memberInput),e=>e.statusCode===404 && e.code==='PRACTICE_RELEASE_NOT_FOUND');
    }
    row.checks.push('catalog and server-side member gate');

    // Actual setup button starts a real session and produces the practice destination.
    const {page:setup,navigation:setupNav}=await loadPage('practice-setup',{...d,MODE_CHOICES:[]});
    setup.onLoad({paperId:free.paperId,releaseId:config.freeRelease,title:'本地十账号闭环测试',count:'3',mode:account.mode});
    await setup.start();
    assert.equal(setup.data.error,'');
    const destination=setupNav.at(-1)?.url || '';
    assert.match(destination,/pages\/practice\/index\?sessionId=/);
    const id=new URL(destination,'http://local').searchParams.get('sessionId');
    row.sessionId=id;
    async function openPractice() {
      const loaded=await loadPage('practice',d);
      loaded.page.data.sessionId=id;
      loaded.page.syncCoordinator=createSyncCoordinator(job=>loaded.page.executeSyncJob(job));
      await loaded.page.loadSession();
      assert.equal(loaded.page.data.loadError,'');
      return loaded;
    }
    let {page:p}=await openPractice();
    assert.equal(p.data.session.questions.length,3);
    assert.equal(p.data.currentQuestion.correctAnswer,'A');
    p.onMark(); p.onOpenSheet();
    assert.equal(p.data.sheetOpen,true); assert.equal(p.data.markedIds.length,1);
    p.onCloseSheet();
    p.onAnswerChange({detail:{optionId:'B'}}); // Q1 intentionally wrong.
    assert.equal(p.data.submitted,true);
    await p.onNext(); assert.equal(p.data.currentIndex,1);
    p.onAnswerChange({detail:{optionId:'A'}}); p.onAnswerChange({detail:{optionId:'C'}});
    assert.equal(p.data.submitted,false);
    p.onOpenSheet(); assert.equal(p.data.sheetItems[1].label,'已选，尚未提交'); p.onCloseSheet();
    await p.persistRuntime();
    assert.equal(p.data.writeError,'');
    const backgroundSaved=await d.getSession(id);
    assert.equal(backgroundSaved.stats.answered,1);
    assert.deepEqual(backgroundSaved.runtimeState.pendingSelections[backgroundSaved.questions[1].questionId],['A','C']);
    await p.onExit();
    assert.equal(p.data.writeError,''); assert.equal(p.data.session.status,'paused');
    const paused=await d.getSession(id);
    assert.equal(paused.stats.answered,1); assert.equal(paused.runtimeState.currentIndex,1);
    assert.deepEqual(paused.runtimeState.markedQuestionIds,[paused.questions[0].questionId]);
    assert.deepEqual(paused.runtimeState.pendingSelections[paused.questions[1].questionId],['A','C']);
    assert.equal(paused.answers[paused.questions[1].questionId],undefined);
    for(const other of config.accounts.filter(item=>item.username!==account.username)) {
      assert.equal(d.loadLocalDraft(other.username,id),null);
    }
    // Second client has no local draft; answers, marks and position must come from server.
    d.clearLocalDraft(account.username,id); activate(account.secondToken);
    ({page:p}=await openPractice());
    assert.equal(p.data.currentIndex,1);
    assert.equal(p.data.markedIds.length,1);
    assert.equal(p.run.stats().wrong,1);
    assert.equal(p.data.currentQuestion.type,'multiple_choice');
    assert.deepEqual(p.data.selectedIds,['A','C']);
    assert.equal(p.data.submitted,false);
    p.onAnswerChange({detail:{optionId:'C'}});
    await p.onExit(); assert.equal(p.data.writeError,'');
    d.clearLocalDraft(account.username,id); activate(account.token);
    ({page:p}=await openPractice());
    assert.deepEqual(p.data.selectedIds,['A']);
    p.onAnswerChange({detail:{optionId:'C'}});
    await p.onNext(); assert.equal(p.data.currentIndex,2);
    assert.equal(p.run.stats().correct,1);
    // Every learner exercises a lost response AFTER a real successful completion commit.
    faults.dropCompletionResponse=true;
    p.onAnswerChange({detail:{optionId:'A'}});
    await waitFor(()=>p.leaving || p.data.writeError,'Last answer did not complete');
    assert.equal(p.leaving,false); assert.equal(p.data.saveState,'offline');
    assert.equal((await d.getSession(id)).status,'completed');
    await p.retryWrites();
    assert.equal(p.data.writeError,''); assert.match(p.data.navigationTarget,/pages\/result/);
    const report=await d.getReport(id);
    assert.equal(report.counts.total,3); assert.equal(report.counts.correct,2);
    assert.equal(report.counts.wrong,1); assert.equal(report.counts.unanswered,0);
    const completed=await d.getSession(id);
    assert.equal(completed.status,'completed');
    assert.deepEqual(completed.runtimeState.pendingSelections,{});
    assert.equal(d.loadLocalDraft(account.username,id),null);
    row.checks.push('setup + mark + answer sheet + single/multiple choice + pause + second-client resume + automatic completion + lost-response retry');
    const {page:result,navigation:resultNav}=await loadPage('result',d);
    result.data.sessionId=id; await result.loadResult();
    assert.equal(result.data.error,''); assert.equal(result.data.reviewItems.length,1);
    result.onReview({currentTarget:{dataset:{index:0}}});
    assert.equal(result.data.reviewOpen,true); assert.deepEqual(result.data.reviewSelectedIds,['B']);
    assert.equal(result.data.reviewAnswer,'A'); result.onCloseReview(); assert.equal(result.data.reviewOpen,false);
    result.onRetry(); assert.match(resultNav.at(-1).url,new RegExp('mode='+account.mode));
    const {page:history}=await loadPage('history',d); await history.loadHistory();
    assert.equal(history.data.error,''); assert.ok(history.data.items.some(item=>item.sessionId===id && item.canReport));
    history.onFilter({currentTarget:{dataset:{filter:'paused'}}}); assert.equal(history.data.visibleItems.length,0);
    row.checks.push('report + analysis open/close + retry route + history filter');

    // Use real revenge page handlers, with a real independent same-knowledge question.
    const {page:revenge}=await loadPage('revenge',d);
    revenge.onLoad();
    await waitFor(()=>!revenge.data.loading,'Revenge queue did not load');
    assert.equal(revenge.data.loadError,''); assert.equal(revenge.data.empty,false);
    row.mistakeId=String(revenge.data.candidate.mistakeId || revenge.data.candidate.id);
    revenge.onAnswerChange({detail:{optionId:'B'}}); await revenge.submitOriginal();
    assert.equal(revenge.data.writeError,''); assert.equal(revenge.data.stage,'remediation');
    await revenge.confirmRemediation();
    assert.equal(revenge.data.writeError,''); assert.equal(revenge.data.stage,'verification');
    revenge.onAnswerChange({detail:{optionId:'A'}}); await revenge.submitVerificationAnswer();
    assert.equal(revenge.data.writeError,''); assert.equal(revenge.data.stage,'verification-result');
    assert.match(revenge.data.feedback,/验证通过/);
    await revenge.loadQueue(); assert.equal(revenge.data.empty,true);
    row.checks.push('wrong answer → remediation → real variant → verification → delayed review');
    const {page:profile}=await loadPage('profile',d); await profile.loadProfile();
    assert.equal(profile.data.error,''); assert.equal(profile.data.syncError,'');
    assert.equal(profile.data.user.username,account.username); assert.equal(profile.data.completedCount,baselineCompleted+1);
    assert.ok(profile.data.totalExperience>=20);
    row.checks.push('profile ownership + summary refresh');
    console.error('PASS',account.username,account.plan,account.mode,'through verification');
  } catch(error) {
    row.failure=error.stack;
    console.error('FAIL',account.username,error.stack);
  }
}

let isolationChecks=0;
for(const {d,activate,account} of clients) {
  activate();
  const own=results.find(row=>row.username===account.username);
  if(own.failure) continue;
  for(const other of results.filter(row=>row.username!==account.username && row.sessionId && row.mistakeId)) {
    for(const path of [`/sessions/${other.sessionId}`,`/sessions/${other.sessionId}/report`,`/mistakes/${other.mistakeId}/remediation`]) {
      await assert.rejects(d.request({path:'/api/v1/learning/practice'+path}),e=>e.statusCode===404);
      isolationChecks++;
    }
    await assert.rejects(d.saveState(other.sessionId,{revision:1,requestId:'cross-account-'+account.username,answers:{}}),e=>e.statusCode===404);
    isolationChecks++;
  }
  const ownRows=await d.listSessions();
  assert.ok(ownRows.every(row=>!results.some(other=>other.username!==account.username && other.sessionId===row.sessionId)));
  own.checks.push('all-nine-other-accounts read/write isolation');
  await d.logout();
  assert.equal(d.getCurrentUser(),null);
  activate(); assert.equal(await d.validateSession(),null); // Revoked original token.
  activate(account.secondToken); assert.equal((await d.validateSession()).username,account.username);
  await d.logout();
  own.checks.push('logout revokes this token; second session remains valid until its own logout');
}
console.log(JSON.stringify({run:config.run,accounts:results,requests,isolationChecks,
  passed:results.filter(row=>!row.failure).length,failed:results.filter(row=>row.failure).length,
  findings:results.flatMap(row=>row.findings || [])}));
if(results.some(row=>row.failure)) process.exitCode=1;
