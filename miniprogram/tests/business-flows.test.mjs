import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage, loadModule } from './helpers/page-harness.mjs';
import { sanitizeRichText } from '../domain/rich-text.ts';
import { mergeDraft, moveQuestion, toggleAnswer, toggleMarked } from '../domain/practice-state.ts';
import { getModePolicy, MODE_POLICIES, formatTimer } from '../domain/mode-policy.ts';
import { createSyncCoordinator, classifyFailure } from '../domain/sync-coordinator.ts';
import { pageRefreshMode, invalidateLearningPages } from '../domain/page-freshness.ts';
import { createPracticeRun, normalizePairs } from '../domain/pc-practice.ts';
import { subscriptionView } from '../domain/subscription-view.ts';

const session = (mode = 'practice') => ({ id: 's1', mode, status: 'active', revision: 3, paperId: 'p1', releaseId: 'r1',
  questions: [{ questionId: 'q1', question: { id: 'q1', type: 'multiple_choice', options: [{ id: 'A' }, { id: 'B' }] } }, { questionId: 'q2', question: { id: 'q2', type: 'single_choice', options: [] } }], answers: {}, runtimeState: {}, stats: {} });

test('published question renders the complete stem, not its catalog title', async () => {
  const { normalizeQuestion } = await loadModule('domain/question.ts', { sanitizeRichText }, ['normalizeQuestion']);
  const question = normalizeQuestion({ title: '相关方沟通', stemParts: [{ text: '一个项目正面临社区抵制。' }, { text: '项目经理应采取哪两项行动？' }], options: [] });
  assert.equal(question.stem, '一个项目正面临社区抵制。项目经理应采取哪两项行动？');
  assert.ok(JSON.stringify(question.stemNodes).includes('项目经理'));
});

test('canceling resume never abandons the previous session', async () => {
  let abandoned = false;
  const { page } = await loadPage('practice-setup', { MODE_CHOICES: [], abandonSession: async () => { abandoned = true; } }, { showModal: async () => ({ confirm: false, cancel: true }) });
  page.data.starting = true;
  await page.resolveExistingSession({ detail: { detail: { sessionId: 'saved-session' } } });
  assert.equal(abandoned, false); assert.equal(page.data.starting, false); assert.equal(page.data.existingSessionId, 'saved-session');
});

test('network failures validating a session propagate instead of logging the user out', async () => {
  class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
  let statusCode = 0;
  const { validateSession } = await loadModule('services/auth.ts', { ApiError, getSessionToken: () => 'test-token', request: async () => { throw new ApiError('offline', statusCode); } }, ['validateSession']);
  await assert.rejects(validateSession(), /offline/);
  statusCode = 401; assert.equal(await validateSession(), null);
});

async function practice(overrides = {}, wxOverrides = {}) {
  const savedDrafts = [];
  const result = await loadPage('practice', { ApiError: class extends Error {}, createPracticeRun, normalizePairs, getModePolicy, formatTimer, mergeDraft, moveQuestion, toggleAnswer, toggleMarked, createSyncCoordinator, classifyFailure,
    getCurrentUser: () => ({ username: 'u' }), loadLocalDraft: () => undefined,
    saveLocalDraft: draft => savedDrafts.push(draft), clearLocalDraft() {}, messageOf: e => e.message,
    getSession: async () => session(), ...overrides }, wxOverrides);
  result.page.syncCoordinator = createSyncCoordinator(async () => session());
  result.page.data.sessionId = 's1';
  return { ...result, savedDrafts };
}

test('draft write failures preserve the answer in memory, warn, and recover on the next save', async () => {
  let unavailable = true;
  let stored;
  const drafts = await loadModule('domain/draft-store.ts', { wx: {
    setStorageSync: (_key, value) => { if (unavailable) throw new Error('storage full'); stored = value; },
  } }, ['saveLocalDraft']);
  const s = session();
  s.questions[0].question = { id: 'q1', type: 'single_choice', options: [{ id: 'A' }, { id: 'B' }], correctAnswer: 'A' };
  const { page } = await practice({ ...drafts, getSession: async () => s });
  await page.loadSession();
  assert.doesNotThrow(() => page.onAnswerChange({ detail: { optionId: 'A' } }));
  assert.equal(page.run.answer('q1').correct, true);
  assert.equal(page.data.submitted, true);
  assert.ok(page.data.draftError);
  assert.equal(page.data.saveState, 'memory');
  assert.equal(page.data.writeError, '');
  unavailable = false;
  page.saveDraft();
  assert.equal(page.data.draftError, '');
  assert.equal(page.data.saveState, 'local');
  assert.equal(stored.lockedAnswers.q1.selectedAnswer, 'A');
});

test('home loads only visible data and does not depend on unused statistics', async () => {
  const unexpected = () => { throw new Error('unused request'); };
  const { page } = await loadPage('home', { MODE_POLICIES,
    validateSession: async () => ({ username: 'u', display_name: '学员' }),
    listPublishedPapers: async () => ({ items: [{ releaseId: 'r1', title: '试卷' }] }),
    getOverview: unexpected, getExperienceSummary: unexpected,
    getRevengeSummary: async () => ({ stats: { active: 2 } }),
    getActiveSessions: async () => [{ id: 's1' }], messageOf: e => e.message,
  });
  await page.loadHome();
  assert.equal(page.data.error, '');
  assert.equal(page.data.papers[0].title, '试卷');
  assert.equal(page.data.activeSession.id, 's1');
  assert.match(page.data.modes.find(mode => mode.id === 'revenge').copy, /2/);
});

test('same-revision local choice survives a later server fetch', () => {
  const base = { sessionId: 's1', username: 'u', revision: 3, currentIndex: 0, answers: {}, markedQuestionIds: [], savedAt: 10000 };
  const result = mergeDraft(base, { ...base, savedAt: 5000, answers: { q1: ['B'] }, markedQuestionIds: ['q1'] });
  assert.deepEqual(result.state.answers, { q1: ['B'] });
  assert.equal(result.pendingLocal, true);
});

test('server locked answers always win over local selections at the same revision', () => {
  const base = { sessionId: 's1', username: 'u', revision: 3, currentIndex: 0, answers: { q1: ['A'] }, markedQuestionIds: [], savedAt: 10000 };
  assert.deepEqual(mergeDraft(base, { ...base, answers: { q1: ['B'], q2: ['A'] } }).state.answers, { q1: ['A'], q2: ['A'] });
});

test('learning writes invalidate otherwise fresh tab data immediately', () => {
  const before = Date.now() - 1;
  invalidateLearningPages();
  assert.equal(pageRefreshMode(before), 'silent');
});

test('timed-out multiple choice remains locked after restoring a session', async () => {
  const s = session('scholar'); s.answers.q1 = { selectedAnswerIds: [], timedOut: true }; s.runtimeState.remainingMs = 0;
  const { page } = await practice({ getSession: async () => s });
  await page.loadSession();
  assert.equal(page.data.submitted, true);
  assert.equal(page.data.submittedById.q1, true);
  assert.equal(page.data.sheetItems[0].label, '超时');
  assert.notEqual(page.timerId, 0); // PC keeps the shared countdown running while reviewing locked questions.
});

test('finished session opens its report instead of allowing writes', async () => {
  const { page, navigation } = await practice({ getSession: async () => ({ ...session(), status: 'completed' }) });
  await page.loadSession();
  assert.match(navigation[0].url, /pages\/result\/index\?sessionId=s1/);
  assert.equal(page.leaving, true);
});

test('completed report navigation can be retried without another completion write', async () => {
  const s = session(); s.questions = [s.questions[0]];
  s.runtimeState.autoExplain = false;
  let opens = 0, writes = 0;
  const { page } = await practice({ getSession: async () => s }, {
    redirectTo: options => { opens++; if (opens === 1) options.fail?.({ errMsg: 'redirectTo:fail' }); else options.success?.(); },
  });
  await page.loadSession();
  page.syncCoordinator.enqueueWrite = async () => { writes++; return { session: { ...s, status: 'completed' } }; };
  page.onAnswerChange({ detail: { optionId: 'B' } }); await page.onNext();
  assert.equal(page.data.busy, false);
  assert.ok(page.data.navigationError);
  await page.retryNavigation();
  assert.equal(opens, 2); assert.equal(writes, 1);
});

test('saved exit navigation failure offers a retry without repeating the pause write', async () => {
  let opens = 0, writes = 0;
  const { page } = await practice({}, { switchTab: options => {
    opens++; if (opens === 1) options.fail?.({ errMsg: 'switchTab:fail' }); else options.success?.();
  } });
  await page.loadSession();
  page.syncCoordinator.enqueueWrite = async () => { writes++; return { ...session(), status: 'paused' }; };
  await page.onExit();
  assert.equal(page.data.busy, false); assert.ok(page.data.navigationError);
  page.retryNavigation(); assert.equal(opens, 2); assert.equal(writes, 1);
});

test('retrying a failed save-exit removes its stale draft and resumes without a false conflict', async () => {
  const storage = new Map();
  const drafts = await loadModule('domain/draft-store.ts', { wx: {
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    getStorageSync: key => storage.get(key), removeStorageSync: key => storage.delete(key),
  } }, ['saveLocalDraft', 'loadLocalDraft', 'clearLocalDraft']);
  class ApiError extends Error {
    constructor(message, statusCode, code) { super(message); Object.assign(this, { statusCode, code }); }
  }
  let server = session(), unavailable = true;
  const dependencies = { ...drafts, ApiError, getSession: async () => server,
    pauseSession: async (_id, input) => {
      if (unavailable) throw Object.assign(new Error('offline'), { statusCode: 0 });
      server = { ...server, status: 'paused', revision: 4, answers: input.answers, runtimeState: input.runtimeState };
      return server;
    },
  };
  const { page, navigation } = await practice(dependencies);
  page.syncCoordinator = createSyncCoordinator(job => page.executeSyncJob(job));
  await page.loadSession();
  page.onAnswerChange({ detail: { optionId: 'B' } }); page.onMark();
  await page.onExit();
  assert.equal(navigation.length, 0);
  assert.deepEqual(drafts.loadLocalDraft('u', 's1').answers.q1, ['B']);
  unavailable = false; await page.retryWrites();
  assert.equal(navigation.at(-1)?.url, '/pages/home/index');
  let conflicts = 0;
  const resumed = await practice(dependencies, { showModal: async () => { conflicts++; return { dismissed: true }; } });
  await resumed.page.loadSession();
  assert.equal(conflicts, 0, 'a successful retry must not prompt the same client to resolve its own save');
  assert.notEqual(resumed.page.data.saveState, 'conflict');
  assert.equal(resumed.page.data.loadError, '');
  assert.deepEqual(resumed.page.data.selectedIds, ['B']);
  assert.equal(resumed.page.data.marked, true);
});

test('normal practice records duration although its timer is not visible', async () => {
  const { page } = await practice(); await page.loadSession();
  page.timerStartedAt = Date.now() - 45000;
  assert.ok(page.modeRuntimeState().durationMs >= 45000);
  assert.equal(page.data.policy.showTimer, false);
});

test('cold restore preserves the newer same-revision local elapsed duration', async () => {
  const { page } = await practice({ loadLocalDraft: () => ({ sessionId: 's1', username: 'u', revision: 3,
    currentIndex: 0, answers: {}, markedQuestionIds: [], savedAt: Date.now(), runtimeState: { durationMs: 45000 } }) });
  await page.loadSession();
  assert.ok(page.modeRuntimeState().durationMs >= 45000);
});

test('navigation and answer selection cannot race an in-flight submit', async () => {
  const { page } = await practice(); await page.loadSession(); page.data.busy = true;
  page.goTo(1); page.onAnswerChange({ detail: { optionId: 'B' } });
  assert.equal(page.data.currentIndex, 0);
  assert.equal(page.data.selectedIds.length, 0);
});

test('countdown waits for an in-flight submit before recording timeout', async () => {
  const { page } = await practice({ getSession: async () => session('scholar') }); await page.loadSession();
  let timeouts = 0; page.submitTimeout = () => { timeouts++; };
  page.timerDeadline = Date.now() - 1; page.data.busy = true; page.updateModeTimer();
  assert.equal(timeouts, 0);
  page.data.busy = false; page.updateModeTimer(); assert.equal(timeouts, 1);
});

test('scholar cannot restart an unanswered timer by jumping to another question', async () => {
  const { page } = await practice({ getSession: async () => session('scholar') }); await page.loadSession();
  const deadline = page.timerDeadline; page.goTo(1);
  assert.equal(page.data.currentIndex, 1); assert.equal(page.timerDeadline, deadline);
});

test('single choice locks locally with no per-question API call and cannot be changed', async () => {
  const s = session(); s.questions[0].question.type = 'single_choice'; s.questions[0].question.correctAnswer = 'A';
  const { page } = await practice({ getSession: async () => s }); await page.loadSession();
  page.onAnswerChange({ detail: { optionId: 'A' } });
  assert.equal(page.data.submitted, true); assert.equal(page.run.stats().correct, 1);
  page.onAnswerChange({ detail: { optionId: 'B' } });
  assert.deepEqual(page.data.selectedIds, ['A']); assert.equal(page.syncRevision, 3);
});

test('multiple choice locks and advances exactly once without a separate review step', async () => {
  const { page } = await practice(); await page.loadSession();
  page.onAnswerChange({ detail: { optionId: 'B' } });
  assert.equal(page.data.submitted, false);
  await page.onNext();
  assert.equal(page.data.currentIndex, 1); assert.deepEqual(page.run.submission().q1.selectedAnswerIds, ['B']);
  page.onPrevious(); assert.equal(page.data.submitted, true);
});

test('last answer automatically completes with a full selection-only payload', async () => {
  const s = session(); s.questions = [s.questions[0]];
  s.runtimeState.autoExplain = false;
  const { page } = await practice({ getSession: async () => s }); await page.loadSession();
  let job; page.syncCoordinator.enqueueWrite = async value => { job = value; return { session: { ...s, status: 'completed' } }; };
  page.onAnswerChange({ detail: { optionId: 'B' } }); await page.onNext();
  assert.equal(job.action, 'complete'); assert.deepEqual(job.payload.answers.q1, { selectedAnswerIds: ['B'], selectionIndex: 1 });
  assert.equal(page.leaving, true);
});

for (const mode of ['challenge', 'scholar']) {
  test(`${mode}: multiple choice still advances without revealing analysis`, async () => {
    const { page } = await practice({ getSession: async () => session(mode) }); await page.loadSession();
    page.onAnswerChange({ detail: { optionId: 'B' } });
    await page.onNext(); assert.equal(page.data.currentIndex, 1);
    page.onPrevious(); assert.equal(page.data.showAnalysis, false);
  });
}

for (const autoExplain of [true, false]) {
  test(`old autoExplain=${autoExplain} cannot show explanation or delay multi-select navigation`, async () => {
    const s = session(); s.runtimeState.autoExplain = autoExplain;
    const { page } = await practice({ getSession: async () => s }); await page.loadSession();
    page.onAnswerChange({ detail: { optionId: 'B' } });
    assert.equal(page.data.nextActionLabel, '下一题');
    await page.onNext(); assert.equal(page.data.currentIndex, 1);
    page.onPrevious(); assert.equal(page.data.showAnalysis, false);
    page.onShowAnswers({ detail: { value: true } }); assert.equal(page.data.showAnalysis, true);
    page.onShowAnswers({ detail: { value: false } }); assert.equal(page.data.showAnalysis, false);
    assert.equal(page.run.stats().answered, 1);
    assert.equal(page.modeRuntimeState().autoExplain, autoExplain, 'do not overwrite the PC preference');
  });
}

test('single-choice grading no longer opens explanation when show answers is off', async () => {
  const s = session(); s.questions[0].question.type = 'single_choice'; s.questions[0].question.correctAnswer = 'A';
  const { page } = await practice({ getSession: async () => s }); await page.loadSession();
  page.onAnswerChange({ detail: { optionId: 'A' } });
  assert.equal(page.data.submitted, true); assert.equal(page.data.showAnalysis, false);
  page.onShowAnswers({ detail: { value: true } }); assert.equal(page.data.showAnalysis, true);
  page.onShowAnswers({ detail: { value: false } }); assert.equal(page.data.showAnalysis, false);
  assert.equal(page.run.stats().correct, 1);
});

test('save failure keeps locked selections available for retry and does not exit', async () => {
  const { page, navigation } = await practice(); await page.loadSession();
  page.onAnswerChange({ detail: { optionId: 'B' } }); await page.onNext();
  page.syncCoordinator.enqueueWrite = async () => { throw Object.assign(new Error('网络不可用'), { statusCode: 0 }); };
  await page.onExit();
  assert.equal(page.data.saveState, 'offline'); assert.equal(page.data.busy, false);
  assert.equal(navigation.length, 0); assert.deepEqual(page.run.submission().q1.selectedAnswerIds, ['B']);
});

test('ordinary practice display-answer toggle blocks answers but does not mark unanswered as done', async () => {
  const { page } = await practice(); await page.loadSession();
  page.onShowAnswers({ detail: { value: true } }); page.onAnswerChange({ detail: { optionId: 'B' } });
  assert.equal(page.data.showAnalysis, true); assert.equal(page.run.stats().answered, 0);
  page.onShowAnswers({ detail: { value: false } }); page.onAnswerChange({ detail: { optionId: 'B' } });
  assert.deepEqual(page.data.selectedIds, ['B']);
});

test('setup offers PC counts and a short-paper fallback', async () => {
  const { page } = await loadPage('practice-setup', { MODE_CHOICES: [] });
  page.onLoad({ count: '200' }); assert.deepEqual(page.data.countChoices.map(item => item.value), [10, 20, 60, 180]);
  page.onLoad({ count: '5' }); assert.deepEqual(page.data.countChoices.map(item => item.value), [5]);
});

test('history unfinished filter includes both active and paused sessions', async () => {
  const { page } = await loadPage('history', { pageRefreshMode, selectPrimaryTab() {}, messageOf: e => e.message,
    listSessions: async () => ['active', 'paused', 'completed'].map((status, i) => ({ sessionId: `s${i}`, status, answered: i, correct: 0, mode: 'practice' })) });
  page.data.filter = 'paused'; await page.loadHistory();
  assert.deepEqual(Array.from(page.data.visibleItems, item => item.status), ['active', 'paused']);
  assert.equal(page.data.visibleItems[0].statusLabel, '进行中');
});

test('home continues the exact saved session and refreshes when returning', async () => {
  let entered;
  const { page, navigation } = await loadPage('home', { MODE_POLICIES, pageRefreshMode, selectPrimaryTab() {},
    getSession: async id => { entered = id; return session(); } });
  page.data.activeSession = session(); await page.onContinue();
  assert.equal(entered, 's1'); assert.match(navigation[0].url, /sessionId=s1/);
  let loads = 0; page.loadHome = () => { loads++; }; page.onShow(); assert.equal(loads, 1);
});

test('profile failed summaries preserve values and do not claim synced', async () => {
  const { page } = await loadPage('profile', { subscriptionView, validateSession: async () => ({ username: 'u', role: 'student' }),
    getExperienceSummary: async () => { throw new Error('offline'); }, listSessions: async () => [], getMySubscription: async () => ({}),
    avatarLetterOf: () => 'U', messageOf: e => e.message });
  page.data.totalExperience = 125; await page.loadProfile();
  assert.equal(page.data.totalExperience, 125);
  assert.equal(page.data.syncLabel, '部分数据未更新');
  assert.ok(page.data.syncError);
});

test('report includes unanswered questions and reuses the original practice mode', async () => {
  const s = session('challenge'); s.answers.q1 = { selectedAnswerIds: ['B'], correct: false }; s.questions[0].question.correctOptionIds = ['A'];
  const { page, navigation } = await loadPage('result', { createPracticeRun, normalizePairs, getModePolicy, getReport: async () => ({ wrongQuestionIds: ['q1'], counts: { unanswered: 1 }, durationMs: 35000 }),
    getSession: async () => s, messageOf: e => e.message });
  page.data.sessionId = s.id; await page.loadResult();
  assert.equal(page.data.reviewItems.length, 2); assert.equal(page.data.reviewItems[1].status, '未作答');
  page.onReview({ currentTarget: { dataset: { index: 0 } } });
  assert.deepEqual(Array.from(page.data.reviewSelectedIds), ['B']);
  assert.equal(page.data.duration, '35 秒');
  page.onRetry(); assert.match(navigation[0].url, /mode=challenge/);
});

test('scholar result uses remaining life rather than exam pass percentage', async () => {
  const s = session('scholar'); s.status = 'completed'; s.runtimeState = { health: 0, maxStreak: 4 };
  const { page } = await loadPage('result', { createPracticeRun, normalizePairs, getModePolicy, messageOf: e => e.message,
    getSession: async () => s, getReport: async () => ({ passed: true, counts: { total: 2, correct: 1 } }) });
  await page.loadResult(); assert.equal(page.data.gameOutcome, '学霸挑战失败');
  assert.match(page.data.gameDetail, /剩余生命 0 \/ 3/);
});

test('revenge restores unfinished remediation without asking the original question again', async () => {
  const candidate = { id: 'm1', status: 'needs_remediation' };
  const { page } = await loadPage('revenge', { normalizeQuestion: value => value, getOverview: async () => ({ revengeCandidates: [candidate] }),
    getRevengeSummary: async () => ({ stats: {} }), getRemediation: async () => ({ ...candidate, selectedAnswers: ['B'], questionSnapshot: { correctAnswer: 'A' } }), messageOf: e => e.message });
  await page.loadQueue(); assert.equal(page.data.stage, 'remediation'); assert.equal(page.data.question.correctAnswer, 'A');
});

test('revenge waiting for verification is not presented as no mistakes', async () => {
  const { page } = await loadPage('revenge', { getOverview: async () => ({ revengeCandidates: [{ id: 'm1', status: 'needs_remediation', remediationReviewedAt: 'today' }] }),
    getRevengeSummary: async () => ({ stats: { verificationWaiting: 2 } }), getVerificationCandidate: async () => ({ available: false }), messageOf: e => e.message });
  await page.loadQueue(); assert.equal(page.data.empty, true); assert.equal(page.data.waitingCount, 3);
  assert.equal(page.data.emptyTitle, '本轮复习已完成');
});

test('matching partial pair saves as pending, resumes, and confirms only when complete', async()=>{
 const s=session();s.questions[0].question={id:'q1',type:'matching',options:[],matching:{left:[{id:'l1',text:'一'},{id:'l2',text:'二'}],right:[{id:'r1',text:'甲'},{id:'r2',text:'乙'}],correctPairs:{l1:'r2',l2:'r1'}}};
 s.runtimeState={pendingMatches:{q1:{l1:'r2'}}};
 const {page,savedDrafts}=await practice({getSession:async()=>s});await page.loadSession();
 assert.deepEqual(page.data.selectedPairs,{l1:'r2'});assert.equal(page.data.matchingComplete,false);assert.equal(page.run.answer('q1'),null);
 page.onAnswerChange({detail:{selectedPairs:{l1:'r2',l2:'r1'}}});
 assert.equal(page.data.matchingComplete,true);assert.equal(page.run.answer('q1'),null);
 assert.deepEqual(savedDrafts.at(-1).runtimeState.pendingMatches.q1,{l1:'r2',l2:'r1'});
 page.onConfirmMatching();assert.equal(page.run.answer('q1').correct,true);assert.equal(page.data.submitted,true);
 assert.deepEqual(page.run.submission().q1.selectedPairs,{l1:'r2',l2:'r1'});
 assert.deepEqual(page.modeRuntimeState().pendingMatches,{});page.stopModeTimer();
});
