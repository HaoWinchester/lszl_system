// Explicit UAT-only integration probe. Tokens arrive on stdin, never in logs.
// Runs real mini-program Page handlers/services against the public UAT API.
import assert from 'node:assert/strict';
import { loadModule, loadPage } from '../helpers/page-harness.mjs';
import { sanitizeRichText } from '../../domain/rich-text.ts';
import { createPracticeRun } from '../../domain/pc-practice.ts';
import { getModePolicy, formatTimer } from '../../domain/mode-policy.ts';
import { mergeDraft, moveQuestion, toggleAnswer, toggleMarked } from '../../domain/practice-state.ts';
import { createSyncCoordinator, classifyFailure, resolveConflict } from '../../domain/sync-coordinator.ts';
import { invalidateLearningPages, pageRefreshMode } from '../../domain/page-freshness.ts';

let input = ''; for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
assert.equal(config.base, 'https://uat.aihuanpu.com');
assert.ok(config.accounts.length === 3 && config.accounts.every(a => /^mini_uat_save_[a-f0-9]{12}_[012]$/.test(a.username)));
const output = [];
for (const [index, account] of config.accounts.entries()) {
  const storage = new Map(); let loseCompletionResponse = false, losePauseResponse = false;
  const wx = {
    getStorageSync: k => storage.get(k), setStorageSync: (k, v) => storage.set(k, structuredClone(v)),
    removeStorageSync: k => storage.delete(k), getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    reLaunch() {},
    request(options) {
      fetch(options.url, { method: options.method, headers: options.header,
        body: options.method === 'GET' ? undefined : JSON.stringify(options.data), signal: AbortSignal.timeout(20000) })
        .then(async response => {
          const data = await response.json();
          if (losePauseResponse && options.url.endsWith('/pause') && response.ok) {
            losePauseResponse = false; options.fail(new Error('Test: pause response lost after commit'));
          } else if (loseCompletionResponse && options.url.endsWith('/complete') && response.ok) {
            loseCompletionResponse = false; options.fail(new Error('Test: response lost after commit'));
          } else options.success({ statusCode: response.status, data });
        }).catch(error => options.fail(error));
    },
  };
  const identity = await loadModule('services/session.ts', { wx }, ['setSession', 'getSessionToken', 'getCurrentUser', 'clearSession']);
  const activate = token => identity.setSession(token, { username: account.username, role: 'student' });
  activate(account.token);
  const http = await loadModule('services/http.ts', { wx, ...identity, getApiBaseUrl: () => config.base }, ['request', 'ApiError', 'messageOf']);
  const { normalizeQuestion } = await loadModule('domain/question.ts', { sanitizeRichText }, ['normalizeQuestion']);
  const api = await loadModule('services/practice.ts', { ...http, normalizeQuestion, invalidateLearningPages },
    ['startSession', 'getSession', 'enterSession', 'pauseSession', 'saveState', 'completeSession', 'abandonSession', 'getReport', 'listSessions']);
  const drafts = await loadModule('domain/draft-store.ts', { wx }, ['loadLocalDraft', 'saveLocalDraft', 'clearLocalDraft']);
  const deps = { ...identity, ...http, ...api, ...drafts, createPracticeRun, getModePolicy, formatTimer,
    mergeDraft, moveQuestion, toggleAnswer, toggleMarked, createSyncCoordinator, classifyFailure, resolveConflict, pageRefreshMode, selectPrimaryTab() {} };
  const mode = ['normal', 'challenge', 'scholar'][index];
  const catalog = await http.request({ path: '/api/v1/paper-releases/catalog?page=1&pageSize=100' });
  const paper = catalog.releases.find(p => p.name === 'PMP 多选试卷');
  assert.ok(paper, 'Published multiple-choice paper is required');
  const started = await api.startSession({ paperId: paper.paperId, releaseId: paper.id || paper.releaseId, mode, count: 3, order: 'paper' });
  const sid = started.id;
  async function open() {
    const loaded = await loadPage('practice', deps, { showModal: async options => {
      assert.notEqual(options.title, '进度冲突', 'A saved retry must resume without a false conflict');
      return { confirm: true };
    } });
    loaded.page.data.sessionId = sid;
    loaded.page.syncCoordinator = createSyncCoordinator(job => loaded.page.executeSyncJob(job));
    await loaded.page.loadSession();
    assert.equal(loaded.page.data.loadError, '');
    return loaded;
  }
  let { page, navigation } = await open();
  assert.equal(page.data.session.questions.length, 3);
  assert.equal(page.data.currentQuestion.type, 'multiple_choice');
  const firstId = page.data.currentQuestion.options[0].id;
  const firstQid = page.data.session.questions[0].questionId;
  page.onAnswerChange({ detail: { optionId: firstId } }); page.onMark();
  page.onOpenSheet(); assert.equal(page.data.sheetOpen, true); page.onCloseSheet();
  await page.persistRuntime(); assert.equal(page.data.writeError, '');
  losePauseResponse = true;
  await page.onExit(); assert.equal(page.data.saveState, 'offline');
  assert.equal(page.leaving, false);
  await page.retryWrites(); assert.equal(page.data.writeError, '');
  assert.equal(navigation.at(-1)?.url, '/pages/home/index');
  const paused = await api.getSession(sid);
  assert.equal(paused.status, 'paused'); assert.equal(paused.stats.answered, 0);
  assert.deepEqual(paused.runtimeState.pendingSelections[firstQid], [firstId]);
  assert.deepEqual(paused.runtimeState.markedQuestionIds, [firstQid]);
  ({ page } = await open()); // Same device must not conflict with its own successful retry.
  assert.equal(page.data.loadError, ''); assert.notEqual(page.data.saveState, 'conflict');
  drafts.clearLocalDraft(account.username, sid); activate(account.secondToken);
  const resume = await loadPage('history', deps);
  await resume.page.loadHistory();
  assert.ok(resume.page.data.items.some(r => r.sessionId === sid && r.canResume));
  resume.page.onOpen({ currentTarget: { dataset: { sessionId: sid, kind: 'resume' } } });
  assert.equal(resume.navigation.at(-1)?.url, '/pages/practice/index?sessionId=' + sid);
  ({ page } = await open());
  assert.deepEqual(page.data.selectedIds, [firstId]); assert.equal(page.data.marked, true);
  assert.equal(page.data.submitted, false);
  // Cancel exit leaves both the page and the server session intact.
  const beforeCancel = (await api.getSession(sid)).revision;
  const cancel = await loadPage('practice', deps, { showModal: async () => ({ dismissed: true }) });
  cancel.page.data = { ...page.data }; cancel.page.run = page.run; cancel.page.syncCoordinator = page.syncCoordinator;
  await cancel.page.onExit(); assert.equal(cancel.navigation.length, 0);
  assert.equal((await api.getSession(sid)).revision, beforeCancel);
  const key = q => q.correctOptionIds?.length ? q.correctOptionIds : q.options.filter(o => o.correct).map(o => o.id);
  assert.ok(page.data.session.questions.every(q => key(q.question).length), 'Frozen answer keys required for all three PC-parity modes');
  let expectedCorrect = 0;
  for (let i = 0; i < 3; i++) {
    const q = page.data.currentQuestion;
    for (const id of [...page.data.selectedIds]) page.onAnswerChange({ detail: { optionId: id } });
    const ids = key(q);
    for (const id of ids) page.onAnswerChange({ detail: { optionId: id } });
    expectedCorrect++;
    if (i === 2) loseCompletionResponse = true;
    await page.onNext();
  }
  assert.equal(page.data.saveState, 'offline');
  assert.equal((await api.getSession(sid)).status, 'completed');
  await page.retryWrites();
  assert.equal(page.data.writeError, ''); assert.match(page.data.navigationTarget, /pages\/result/);
  const report = await api.getReport(sid);
  assert.equal(report.counts.total, 3); assert.equal(report.counts.correct, expectedCorrect);
  const history = await api.listSessions();
  assert.ok(history.some(r => r.sessionId === sid && r.reportAvailable));
  const { page: records } = await loadPage('history', deps); await records.loadHistory();
  assert.equal(records.data.error, ''); assert.ok(records.data.items.some(r => r.sessionId === sid && r.canReport));
  activate(config.accounts[(index + 1) % 3].token);
  await assert.rejects(api.getSession(sid), error => error.statusCode === 404);
  activate(account.secondToken);
  const extra = await api.startSession({ paperId: paper.paperId, releaseId: paper.id || paper.releaseId, mode, count: 3, order: 'paper' });
  const abandoned = await api.abandonSession(extra.id, { revision: extra.revision, requestId: 'uat-abandon-' + extra.id, answers: {}, runtimeState: { pendingSelections: {} } });
  assert.equal(abandoned.status, 'abandoned');
  output.push({ mode, sessionId: sid, checks: ['background save', 'pause exit', 'multi-select draft', 'mark and answer sheet', 'second-client resume', 'cancel exit', 'complete', 'lost-response retry', 'report and history', 'cross-user isolation', 'abandon'] });
  console.error('PASS', mode);
}
console.log(JSON.stringify({ passed: output.length, results: output }));
