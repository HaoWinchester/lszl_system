// Opt-in local QA: full production-derived bilingual paper, real mini-program Page/service handlers and HTTP.
// WeChat host APIs are emulated here; native simulator verification is recorded separately.
import assert from 'node:assert/strict';
import { createUatClient } from '../helpers/uat-client.mjs';
import { loadPage } from '../helpers/page-harness.mjs';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
assert.equal(config.base, 'http://127.0.0.1:5183'); assert.equal(config.accounts.length, 3);
const storage = new Map(), rows = [], clients = [];
const waitFor = async predicate => { const end = Date.now() + 15000; while (!predicate()) { assert.ok(Date.now() < end, 'completion timed out'); await new Promise(r => setTimeout(r, 10)); } };
for (const [index, account] of config.accounts.entries()) {
 const client = await createUatClient(account, { base: config.base, storage }); clients.push(client);
 const d = client.deps, row = { username: account.username, checks: [] }; rows.push(row);
 assert.equal((await d.validateSession()).username, account.username);
 const catalog = await d.listPublishedPapers(1, 100);
 const paper = catalog.items.find(p => p.releaseId === config.releaseId); assert.ok(paper); assert.equal(paper.questionCount, 60);
 for (const old of await d.getActiveSessions()) await d.abandonSession(old.id, { revision: (await d.getSession(old.id)).revision, requestId: 'qa-reset-' + old.id, answers: {}, runtimeState: {} });
 const baseline = await d.getGrowthSummary();
 const session = await d.startSession({ paperId: config.paperId, releaseId: config.releaseId, mode: 'normal', count: 60, order: 'paper' });
 row.sessionId = session.id;
 assert.equal(session.questions.length, 60);
 for (const { question: q } of session.questions) {
  assert.match(q.stem, /[\u4e00-\u9fff]/); assert.match(q.stemEn, /[A-Za-z]{3}/);
  assert.ok(q.options.length >= 2); assert.ok(q.options.every(o => o.text && /[A-Za-z]{3}/.test(o.textEn)));
 }
 row.checks.push('60 bilingual stems and every bilingual option');
 async function open() {
  const { page } = await loadPage('practice', d);
  page.data.sessionId = session.id; page.syncCoordinator = d.createSyncCoordinator(job => page.executeSyncJob(job));
  await page.loadSession(); assert.equal(page.data.loadError, ''); return page;
 }
 let p = await open();
 for (let i = 0; i < 60; i++) {
  assert.equal(p.data.currentIndex, i);
  const q = p.data.currentQuestion;
  const ids = q.correctOptionIds?.length ? q.correctOptionIds : [q.correctAnswer];
  assert.equal(ids.length, 1); assert.ok(q.options.some(o => o.id === ids[0]));
  if (i === 0) p.onMark();
  const chosen = i <= index ? q.options.find(o => !ids.includes(o.id)).id : ids[0];
  p.onAnswerChange({ detail: { optionId: chosen } });
  assert.equal(p.data.submitted, true);
  if (i < 59) await p.onNext(); else await waitFor(() => p.leaving || p.data.writeError);
  assert.equal(p.data.writeError, '');
  if (i === 9) {
   await p.onExit(); assert.equal(p.data.session.status, 'paused');
   const saved = await d.getSession(session.id); assert.equal(saved.stats.answered, 10);
   d.clearLocalDraft(account.username, session.id); client.activate(account.secondToken);
   p = await open(); assert.equal(p.data.currentIndex, 10); assert.equal(p.data.markedIds.length, 1);
   assert.equal(p.run.stats().answered, 10); row.checks.push('pause at 10, clear local draft, second-session resume with marks');
  }
 }
 const report = await d.getReport(session.id);
 assert.equal(report.counts.total, 60); assert.equal(report.counts.correct, 59 - index); assert.equal(report.counts.wrong, index + 1); assert.equal(report.counts.unanswered, 0);
 const history = await d.listSessions(); assert.ok(history.some(s => s.sessionId === session.id && s.reportAvailable));
 const after = await d.getGrowthSummary(); assert.equal(after.today.answered - baseline.today.answered, 60);
 row.counts = report.counts; row.growthIncrease = 60;
 row.checks.push('60 answers + automatic completion + report + history + growth');
 // Leave a fresh short run for an independent native UI check.
 const native = await d.startSession({ paperId: config.paperId, releaseId: config.releaseId, mode: 'normal', count: 3, order: 'paper' });
 row.nativeSessionId = native.id;
 console.error('PASS', account.username, JSON.stringify(row.counts));
}
const probeId = 'bilingual-shared-device-probe';
for (const client of clients) {
 client.activate();
 client.deps.saveLocalDraft({ username: client.deps.getCurrentUser().username, sessionId: probeId, revision: 1, currentIndex: 0, answers: { probe: [client.account.username] }, markedQuestionIds: [], savedAt: Date.now() });
}
for (const [index, client] of clients.entries()) {
 client.activate(); const d = client.deps;
 assert.deepEqual(d.loadLocalDraft(d.getCurrentUser().username, probeId).answers.probe, [client.account.username]);
 d.clearUserDrafts(d.getCurrentUser().username);
 for (const later of clients.slice(index + 1)) assert.deepEqual(d.loadLocalDraft(later.account.username, probeId).answers.probe, [later.account.username]);
 rows[index].checks.push('shared device has three simultaneous drafts for same session ID; account read and logout cleanup remain isolated');
 for (const [otherIndex, row] of rows.entries()) {
  if (index === otherIndex) continue;
  await assert.rejects(d.getSession(row.sessionId), e => e.statusCode === 404);
  await assert.rejects(d.getReport(row.sessionId), e => e.statusCode === 404);
  await assert.rejects(d.pauseSession(row.nativeSessionId, { revision: 1, requestId: `isolation-${index}-${otherIndex}`, answers: {}, runtimeState: {} }), e => e.statusCode === 404);

 }
 const history = await d.listSessions();
 assert.ok(rows.filter((_,i) => i !== index).every(row => history.every(s => s.sessionId !== row.sessionId)));
 rows[index].checks.push('other two accounts cannot read session/report, write progress or appear in history');
}
console.log(JSON.stringify({ passed: rows.length, fullPaperAnswers: 180, crossAccountRejections: 18, paperName: config.paperName, results: rows }, null, 2));
