import assert from 'node:assert/strict';
import { loadPage } from '../helpers/page-harness.mjs';
import { createUatClient } from '../helpers/uat-client.mjs';

let input = ''; for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input); assert.equal(config.base, 'https://uat.aihuanpu.com');
const checks = [], pageTimes = [], clients = [], facts = [];
async function check(name, action) {
  const start = performance.now();
  try { await action(); checks.push({ name, passed: true, ms: Math.round(performance.now()-start) }); }
  catch (e) { checks.push({ name, passed: false, error: e.message, code: e.code || '', status: e.statusCode || 0 }); }
}
async function timed(name, action) {
  const start = performance.now(); const result = await action();
  pageTimes.push({ name, ms: Math.round(performance.now() - start) }); return result;
}
const event = data => ({ currentTarget: { dataset: data } });
for (const account of config.accounts) {
  const c = await createUatClient(account), d = c.deps; clients.push(c);
  const label = account.entitled ? 'member' : account.status === 'expired' ? 'expired' : 'free';
  await check(label + ': identity and membership expiry', async () => {
    assert.equal((await d.validateSession()).username, account.username);
    const access = await d.getMySubscription(); assert.equal(access.entitlements.allExamPapers, account.entitled);
    const { page } = await loadPage('membership', d); await timed(label + '/membership', () => page.loadMembership());
    assert.equal(page.data.error, '');
    assert.equal(page.data.membership.statusLabel, label === 'member' ? '生效中' : label === 'expired' ? '已到期' : '未开通');
    if (label !== 'free') assert.match(page.data.membership.expiryLabel, /2026\./);
  });
  await check(label + ': server receipt events cannot be forged', async () => {
    for (const eventType of ['PRACTICE_REVENGE_ANSWERED', 'PRACTICE_REMEDIATION_VERIFIED']) {
      await assert.rejects(d.request({ path: '/api/v1/learning/events', method: 'POST',
        data: { eventType, payload: { requestId: 'audit-forged-event' } } }), e => e.statusCode === 400);
    }
  });
  const catalog = await d.listPublishedPapers(1, 100);
  const free = catalog.items.find(p => p.title === 'PMP 精选3道题');
  const member = catalog.items.find(p => p.accessLevel === 'member');
  assert.ok(free && member);
  await check(label + ': catalog filters and server membership gate', async () => {
    assert.equal(member.contentRestricted, !account.entitled);
    const { page } = await loadPage('papers', d); await timed(label + '/papers', () => page.loadPapers());
    assert.equal(page.data.error, ''); page.onAccess(event({ access: 'member' }));
    assert.ok(page.data.filtered.length && page.data.filtered.every(p => p.accessLevel === 'member'));
    const payload = { paperId: member.paperId, releaseId: member.releaseId, mode: 'normal', count: 3 };
    if (account.entitled) {
      const s = await d.startSession(payload);
      assert.equal((await d.abandonSession(s.id, { revision: s.revision, requestId: 'gate-' + s.id })).status, 'abandoned');
    } else await assert.rejects(d.startSession(payload), e => e.statusCode === 404);
  });
  await check(label + ': home, history and profile data preparation', async () => {
    for (let round = 0; round < 5; round++) {
      for (const [name, method] of [['home','loadHome'],['history','loadHistory'],['profile','loadProfile']]) {
        const { page } = await loadPage(name, d);
        await timed(label + '/' + name + (round ? '/warm' : '/first'), () => page[method]());
        assert.equal(page.data.error, ''); if (name === 'profile') assert.equal(page.data.syncError, '');
      }
    }
  });
  await check(label + ': refresh failure retains data and recovers', async () => {
    const { page } = await loadPage('profile', d); await page.loadProfile();
    const name = page.data.displayName, xp = page.data.totalExperience;
    c.faults.offline = true; await page.loadProfile({ silent: true });
    assert.equal(page.data.displayName, name); assert.equal(page.data.totalExperience, xp); assert.ok(page.data.syncError);
    assert.equal(d.getCurrentUser().username, account.username);
    c.faults.offline = false; await page.loadProfile({ silent: true }); assert.equal(page.data.syncError, '');
  });
  await check(label + ': rapid tab re-entry avoids duplicate page fetches', async () => {
    const { page } = await loadPage('history', d); await page.loadHistory();
    const before = c.requests.length; page.onShow(); page.onShow(); page.onShow();
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(c.requests.length, before);
  });
  // A new, isolated three-question session checks wrong-answer and recovery paths.
  const started = await d.startSession({ paperId: free.paperId, releaseId: free.releaseId, mode: 'normal', count: 3, order: 'paper' });
  const entries = started.questions, answers = {};
  for (const [i, entry] of entries.entries()) {
    const q = entry.question;
    const correct = q.type === 'multiple_choice' ? q.correctOptionIds : [q.correctAnswer];
    const chosen = i ? correct : [q.options.find(o => !correct.includes(o.id)).id];
    answers[entry.questionId] = { ...(q.type === 'multiple_choice' ? { selectedAnswerIds: chosen } : { selectedAnswer: chosen[0] }), selectionIndex: i + 1 };
  }
  await check(label + ': authoritative complete, result and PC parity', async () => {
    const completion = await d.completeSession(started.id, { revision: started.revision, requestId: 'audit-complete-' + started.id,
      answers, runtimeState: { pendingSelections: {} } });
    assert.equal(completion.report.counts.correct, 2); assert.equal(completion.report.counts.wrong, 1);
    const { page } = await loadPage('result', d); page.data.sessionId = started.id;
    await timed(label + '/result', () => page.loadResult()); assert.equal(page.data.error, '');
    page.onReview(event({ index: 0 })); assert.equal(page.data.reviewOpen, true); page.onCloseReview(); assert.equal(page.data.reviewOpen, false);
    const login = await fetch(c.base + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: account.username, password: account.password, acceptedTermsVersion: '2026-08-13-v1' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    const pc = await fetch(c.base + '/api/v1/learning/practice/sessions/' + started.id + '/report', { headers: { cookie } });
    assert.equal(pc.status, 200); assert.deepEqual((await pc.json()).report.counts, completion.report.counts);
    await fetch(c.base + '/api/v1/auth/logout', { method: 'POST', headers: { cookie } });
  });
  let revenge;
  await check(label + ': revenge initial answer and repeated-write safety', async () => {
    ({ page: revenge } = await loadPage('revenge', d)); revenge.onLoad();
    const limit = Date.now() + 15000; while (revenge.data.loading && Date.now() < limit) await new Promise(r => setTimeout(r, 20));
    assert.equal(revenge.data.loadError, ''); assert.equal(revenge.data.empty, false);
    const originalId = entries[0].questionId, original = answers[originalId];
    const mistakeId = revenge.data.candidate.mistakeId || revenge.data.candidate.id;
    assert.equal(revenge.data.question.id, originalId);
    const selected = original.selectedAnswerIds || [original.selectedAnswer];
    selected.forEach(id => revenge.onAnswerChange({ detail: { optionId: id } }));
    await revenge.submitOriginal(); assert.equal(revenge.data.writeError, ''); assert.equal(revenge.data.stage, 'remediation');
    const payload = { ...(original.selectedAnswerIds ? { selectedAnswerIds: selected } : { selectedAnswer: selected[0] }), requestId: 'repeat-audit-' + mistakeId };
    const first = await d.submitRevengeAnswer(mistakeId, payload), second = await d.submitRevengeAnswer(mistakeId, payload);
    assert.equal(second.revengeAttemptCount, first.revengeAttemptCount, 'the same retry must not count as another attempt');
    const correct = entries[0].question.correctOptionIds || [entries[0].question.correctAnswer];
    await assert.rejects(d.submitRevengeAnswer(mistakeId, { ...payload,
      ...(original.selectedAnswerIds ? { selectedAnswerIds: correct } : { selectedAnswer: correct[0] }) }), e => e.statusCode === 422);
  });
  await check(label + ': resume unfinished remediation', async () => {
    const { page } = await loadPage('revenge', d); page.onLoad();
    const limit = Date.now() + 15000; while (page.data.loading && Date.now() < limit) await new Promise(r => setTimeout(r, 20));
    assert.equal(page.data.loadError, ''); assert.equal(page.data.stage, 'remediation');
  });
  await check(label + ': remediation without a variant has a usable exit', async () => {
    assert.ok(revenge); await revenge.confirmRemediation();
    assert.equal(revenge.data.writeError, ''); assert.equal(revenge.data.busy, false);
    facts.push({ label, revengeStage: revenge.data.stage, empty: revenge.data.empty, waitingCount: revenge.data.waitingCount });
  });
  if (account.entitled) await check('member: 180-question limit, large paper save and resume', async () => {
    const full = catalog.items.find(p => p.questionCount >= 185 && !p.contentRestricted);
    assert.ok(full, 'A full-size published paper is required');
    const { page: setup } = await loadPage('practice-setup', d);
    setup.onLoad({ count: '185' });
    assert.equal(Math.max(...setup.data.countChoices.map(row => row.value)), 180);
    await assert.rejects(d.startSession({ paperId: full.paperId, releaseId: full.releaseId, mode: 'normal', count: 185 }), e => e.code === 'INVALID_PRACTICE_COUNT');
    const s = await timed('member/full-paper/start', () => d.startSession({ paperId: full.paperId, releaseId: full.releaseId, mode: 'normal', count: 180, order: 'paper' }));
    assert.equal(s.questions.length, 180);
    const paused = await timed('member/full-paper/pause', () => d.pauseSession(s.id, { revision: s.revision, requestId: 'audit-full-pause-' + s.id, runtimeState: { currentIndex: 100, pendingSelections: {} } }));
    assert.equal(paused.status, 'paused');
    const resumed = await timed('member/full-paper/resume', () => d.getSession(s.id));
    assert.equal(resumed.runtimeState.currentIndex, 100);
    const summaries = await d.getActiveSessions();
    const summary = summaries.find(row => row.id === s.id);
    assert.ok(summary); assert.equal(summary.stats.total, 180);
    assert.equal(summary.questions, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(summaries)) < 2000, 'List must not carry the frozen paper');
    assert.ok((await d.listSessions()).some(row => row.sessionId === s.id));
    await d.abandonSession(s.id, { revision: resumed.revision, requestId: 'audit-full-abandon-' + s.id });
  });
  await check(label + ': logout revokes only the current device', async () => {
    await d.logout(); c.activate(account.token); assert.equal(await d.validateSession(), null);
    c.activate(account.secondToken); assert.equal((await d.validateSession()).username, account.username);
  });
}
const requests = clients.flatMap(c => c.requests), grouped = {};
for (const row of requests.filter(r => !r.simulated && r.status >= 200 && r.status < 300)) {
  const key = row.method + ' ' + row.path.replace(/ps_[a-f0-9]+/g, ':session').replace(/pm_[a-f0-9]+/g, ':mistake');
  (grouped[key] ||= []).push(row);
}
const latency = Object.entries(grouped).map(([path, rows]) => {
  const ms = rows.map(r => r.ms).sort((a,b) => a-b), at = p => Math.round(ms[Math.max(0, Math.ceil(p*ms.length)-1)]);
  return { path, n: rows.length, p50Ms: at(.5), p95Ms: at(.95), maxMs: at(1), maxBytes: Math.max(...rows.map(r => r.bytes)) };
});
const failedRequests = requests.filter(r => !r.simulated && r.status >= 400).map(r => ({ ...r, path: r.path.replace(/ps_[a-f0-9]+/g, ':session').replace(/pm_[a-f0-9]+/g, ':mistake') }));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), checks, pageTimes, latency, facts, failedRequests, totalRequests: requests.length,
  passed: checks.filter(r => r.passed).length, failed: checks.filter(r => !r.passed).length }, null, 2));
process.exitCode = checks.some(row => !row.passed) ? 1 : 0;
