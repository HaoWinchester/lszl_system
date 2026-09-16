// Real UAT HTTP with NEW isolated identities supplied on stdin. Never logs credentials.
// Provision with manual_uat_save_exit.py; do not reuse accounts from another audit.
import assert from 'node:assert/strict';
import { createUatClient } from '../helpers/uat-client.mjs';
import { loadPage } from '../helpers/page-harness.mjs';
let input=''; for await(const chunk of process.stdin) input+=chunk;
const config=JSON.parse(input); assert.equal(config.base,'https://uat.aihuanpu.com'); assert.equal(config.accounts.length,3);
const clients=[],results=[];
for(const [index,account] of config.accounts.entries()) {
 const c=await createUatClient({...account,token:account.secondToken}), d=c.deps;clients.push(c);
 const before=await d.getGrowthSummary();
 assert.equal((await d.listSessions()).length,0,'Use freshly provisioned accounts with no practice history');
 assert.equal(before.totalCompletedDays,0);
 assert.equal(before.today.answered,0);
 const goal=[5,20,30][index];
 const {page}=await loadPage('growth',d); await page.loadGrowth();assert.equal(page.data.error,'');
 page.onGoal({currentTarget:{dataset:{goal}}});await page.onSaveGoal();assert.equal(page.data.goalError,'');
 assert.equal(page.data.summary.configuredGoal,goal);assert.equal(page.data.summary.today.goal,before.today.goal);
 assert.ok(page.data.summary.goalEffectiveDate > page.data.summary.date);
 await assert.rejects(d.updateGrowthGoal(7),e=>e.statusCode===422);
 c.faults.offline=true;await page.loadGrowth();assert.ok(page.data.error);assert.equal(page.data.summary.configuredGoal,goal);
 c.faults.offline=false;await page.loadGrowth();assert.equal(page.data.error,'');
 const catalog=await d.listPublishedPapers(1,100);const paper=catalog.items.find(p=>p.title==='PMP 多选试卷');assert.ok(paper);
 const s=await d.startSession({paperId:paper.paperId,releaseId:paper.releaseId,mode:'normal',count:10,order:'paper'});
 const answers={};for(const [i,e] of s.questions.entries()) {
  const q=e.question,ids=q.correctOptionIds?.length?q.correctOptionIds:[q.correctAnswer];
  answers[e.questionId]={selectedAnswerIds:ids,selectionIndex:i+1};
 }
 const fresh=new Set(s.questions.map(e=>e.questionId)).size;
 const payload={revision:s.revision,requestId:'growth-audit-'+s.id,answers,runtimeState:{pendingSelections:{}}};
 const finished=await d.completeSession(s.id,payload);assert.equal(finished.report.counts.answered,10);
 const after=await d.getGrowthSummary();assert.equal(after.today.answered-before.today.answered,fresh);
 assert.ok(after.today.completed);assert.ok(after.currentStreak>=1);assert.equal(after.week.length,7);assert.equal(after.timezone,'Asia/Shanghai');
 await d.completeSession(s.id,payload);assert.equal((await d.getGrowthSummary()).today.answered,after.today.answered);
 const repeated=await d.startSession({paperId:paper.paperId,releaseId:paper.releaseId,mode:'normal',count:10,order:'paper'});
 await d.completeSession(repeated.id,{...payload,revision:repeated.revision,requestId:'growth-repeat-'+repeated.id});
 assert.equal((await d.getGrowthSummary()).today.answered,after.today.answered);
 const {page:home}=await loadPage('home',d);await home.loadHome();assert.equal(home.data.error,'');assert.deepEqual(home.data.summary.today,after.today);
 results.push({username:account.username,goal,nextDayEffective:true,answeredBefore:before.today.answered,answeredAfter:after.today.answered,uniqueIncrease:fresh,completed:after.today.completed,checks:['growth page load/goal save','invalid goal rejected','offline retry keeps summary','real completion credited','retry and same-question repeat deduplicated','home and growth match']});
}
for(const [index,c] of clients.entries())assert.equal((await c.deps.getGrowthSummary()).configuredGoal,[5,20,30][index]);
console.log(JSON.stringify({passed:results.length,accountGoalsIsolated:true,results},null,2));
