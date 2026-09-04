import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from '../../domain/draft-store';
import { formatTimer, getModePolicy } from '../../domain/mode-policy';
import type { ModePolicy } from '../../domain/mode-policy';
import { mergeDraft, moveQuestion, PracticeDraft, toggleAnswer, toggleMarked } from '../../domain/practice-state';
import { classifyFailure, createSyncCoordinator, resolveConflict } from '../../domain/sync-coordinator';
import type { SyncJob } from '../../domain/sync-coordinator';
import { ApiError, messageOf } from '../../services/http';
import { completeSession, getSession, pauseSession, saveState, submitAnswer } from '../../services/practice';
import { getCurrentUser } from '../../services/session';
import { PracticeQuestion, PracticeSession } from '../../types/api';

function answerMap(session: PracticeSession): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [questionId, value] of Object.entries(session.answers || {})) {
    const ids = Array.isArray(value.selectedAnswerIds)
      ? value.selectedAnswerIds.map(String)
      : value.selectedAnswer ? [String(value.selectedAnswer)] : [];
    if (ids.length) result[questionId] = ids;
  }
  return result;
}

function draftFor(session: PracticeSession, username: string, currentIndex: number, answers: Record<string, string[]>, marked: string[]): PracticeDraft {
  return { sessionId: session.id, username, revision: session.revision, currentIndex, answers, markedQuestionIds: marked, savedAt: Date.now() };
}

Page({
  timerId: 0 as any,
  timerStartedAt: 0,
  timerDeadline: 0,
  syncRevision: 0,
  syncCoordinator: null as any,
  data: {
    statusBarHeight: 24,
    loading: true,
    loadError: '',
    writeError: '',
    sessionId: '',
    session: { questions: [], revision: 0 } as unknown as PracticeSession,
    currentIndex: 0,
    currentQuestion: {} as PracticeQuestion,
    selectedIds: [] as string[],
    answers: {} as Record<string, string[]>,
    submittedById: {} as Record<string, boolean>,
    markedIds: [] as string[],
    marked: false,
    submitted: false,
    showAnalysis: false,
    sheetOpen: false,
    sheetItems: [] as any[],
    saveState: 'local',
    busy: false,
    progressPercent: 0,
    modeTitle: '普通练习',
    policy: getModePolicy('normal') as ModePolicy,
    timerLabel: '',
    timerUrgent: false,
    sheetDots: [0, 1, 2, 3],
  },

  onLoad(query: Record<string, string>) {
    this.syncCoordinator = createSyncCoordinator((job: SyncJob) => this.executeSyncJob(job));
    this.setData({
      statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24,
      sessionId: decodeURIComponent(query.sessionId || ''),
    });
    this.loadSession();
  },

  async loadSession() {
    this.setData({ loading: true, loadError: '', writeError: '' });
    try {
      const session = await getSession(this.data.sessionId);
      const username = getCurrentUser()?.username || '';
      const serverAnswers = answerMap(session);
      const serverDraft = draftFor(
        session,
        username,
        Number(session.runtimeState?.currentIndex || 0),
        serverAnswers,
        (session.runtimeState?.markedQuestionIds || []).map(String),
      );
      const merged = mergeDraft(serverDraft, loadLocalDraft(username, session.id) || undefined);
      const submittedById = Object.fromEntries(Object.keys(serverAnswers).map(id => [id, true]));
      this.syncRevision = session.revision;
      this.setData({
        session,
        currentIndex: Math.min(merged.state.currentIndex, Math.max(0, session.questions.length - 1)),
        answers: merged.state.answers,
        markedIds: merged.state.markedQuestionIds,
        submittedById,
        saveState: merged.conflict ? 'conflict' : merged.pendingLocal ? 'local' : 'saved',
        policy: getModePolicy(session.mode),
        modeTitle: getModePolicy(session.mode).title,
        loading: false,
      });
      this.refreshCurrent();
      this.startModeTimer();
    } catch (error) {
      this.setData({ loading: false, loadError: messageOf(error) });
    }
  },

  async executeSyncJob(job: SyncJob) {
    const input = { ...job.payload, revision: this.syncRevision, requestId: job.key };
    let result: any;
    if (job.action === 'answer') result = await submitAnswer(job.sessionId, input);
    else if (job.action === 'state') result = await saveState(job.sessionId, input);
    else if (job.action === 'pause') result = await pauseSession(job.sessionId, input);
    else if (job.action === 'complete') result = await completeSession(job.sessionId, input);
    else throw new Error(`不支持的同步操作: ${job.action}`);
    const session = result?.session || result;
    if (session?.revision) this.syncRevision = Number(session.revision);
    return result;
  },

  refreshCurrent() {
    const entry = this.data.session.questions[this.data.currentIndex];
    if (!entry) return;
    const questionId = entry.questionId;
    const submitted = Boolean(this.data.submittedById[questionId]);
    this.setData({
      currentQuestion: entry.question,
      selectedIds: this.data.answers[questionId] || [],
      submitted,
      showAnalysis: submitted && this.data.policy.revealAfterAnswer,
      marked: this.data.markedIds.includes(questionId),
      progressPercent: Math.round(((this.data.currentIndex + 1) / this.data.session.questions.length) * 100),
      sheetItems: this.buildSheetItems(),
    });
  },

  modeRuntimeState() {
    const durationMs = this.timerStartedAt
      ? Math.max(0, Date.now() - this.timerStartedAt)
      : Number(this.data.session.runtimeState?.durationMs || this.data.session.stats?.durationMs || 0);
    const runtimeState: Record<string, unknown> = {
      currentIndex: this.data.currentIndex,
      markedQuestionIds: this.data.markedIds,
      durationMs,
    };
    if (this.data.policy.timerKind === 'countdown') {
      runtimeState.remainingMs = Math.max(0, this.timerDeadline - Date.now());
    }
    return runtimeState;
  },

  startModeTimer(resetCountdown = false) {
    this.stopModeTimer();
    const policy = this.data.policy;
    if (!policy.showTimer) return;
    const priorDuration = Number(this.data.session.runtimeState?.durationMs || this.data.session.stats?.durationMs || 0);
    this.timerStartedAt = Date.now() - priorDuration;
    if (policy.timerKind === 'countdown') {
      const saved = Number(this.data.session.runtimeState?.remainingMs);
      const remaining = !resetCountdown && Number.isFinite(saved)
        ? Math.max(0, saved)
        : Number(policy.initialSeconds || 60) * 1000;
      this.timerDeadline = Date.now() + remaining;
    }
    this.updateModeTimer();
    this.timerId = setInterval(() => this.updateModeTimer(), 250);
  },

  stopModeTimer() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = 0;
  },

  updateModeTimer() {
    const policy = this.data.policy;
    const remaining = policy.timerKind === 'countdown'
      ? Math.max(0, this.timerDeadline - Date.now())
      : Math.max(0, Date.now() - this.timerStartedAt);
    this.setData({ timerLabel: formatTimer(remaining), timerUrgent: policy.timerKind === 'countdown' && remaining <= 10000 });
    if (policy.timerKind === 'countdown' && remaining <= 0) {
      this.stopModeTimer();
      this.submitTimeout();
    }
  },

  async submitTimeout() {
    if (this.data.busy || this.data.submitted) return;
    const entry = this.data.session.questions[this.data.currentIndex];
    if (!entry) return;
    this.setData({ busy: true, saveState: 'saving' });
    try {
      const input = {
        questionId: entry.questionId,
        timedOut: true,
        runtimeState: this.modeRuntimeState(),
      };
      const result: any = await this.syncCoordinator.enqueueWrite({
        sessionId: this.data.session.id,
        key: `timeout:${this.data.session.id}:${entry.questionId}`,
        action: 'answer',
        payload: input,
      });
      const questions = result.session.questions?.length ? result.session.questions : this.data.session.questions;
      this.setData({
        session: { ...result.session, questions },
        submittedById: { ...this.data.submittedById, [entry.questionId]: true },
        submitted: true,
        showAnalysis: false,
        busy: false,
        saveState: 'saved',
      });
      wx.showToast({ title: '本题超时，已记为未答', icon: 'none' });
      setTimeout(() => this.onNext(), 450);
    } catch (error) {
      await this.handleWriteError(error);
    }
  },

  buildSheetItems() {
    return this.data.session.questions.map((entry, index) => ({
      questionId: entry.questionId,
      state: index === this.data.currentIndex ? 'current' : this.data.submittedById[entry.questionId] ? 'answered' : 'unanswered',
      marked: this.data.markedIds.includes(entry.questionId),
      label: this.data.submittedById[entry.questionId] ? '已答' : '未答',
    }));
  },

  saveDraft() {
    const username = getCurrentUser()?.username || '';
    if (!username || !this.data.session.id) return;
    saveLocalDraft(draftFor(this.data.session, username, this.data.currentIndex, this.data.answers, this.data.markedIds));
    this.setData({ saveState: 'local' });
  },

  onAnswerChange(event: any) {
    if (this.data.submitted) return;
    const questionId = this.data.session.questions[this.data.currentIndex].questionId;
    const selected = toggleAnswer(
      this.data.answers[questionId] || [],
      event.detail.optionId,
      this.data.currentQuestion.type === 'multiple_choice',
    );
    this.setData({ answers: { ...this.data.answers, [questionId]: selected }, selectedIds: selected, writeError: '' });
    this.saveDraft();
  },

  async submitCurrent() {
    if (this.data.busy || !this.data.selectedIds.length) return;
    const entry = this.data.session.questions[this.data.currentIndex];
    this.setData({ busy: true, saveState: 'saving', writeError: '' });
    try {
      const input: any = {
        questionId: entry.questionId,
      };
      if (entry.question.type === 'multiple_choice') input.selectedAnswerIds = this.data.selectedIds;
      else input.selectedAnswer = this.data.selectedIds[0];
      const result: any = await this.syncCoordinator.enqueueWrite({
        sessionId: this.data.session.id,
        key: `answer:${this.data.session.id}:${entry.questionId}`,
        action: 'answer',
        payload: input,
      });
      const submittedById = { ...this.data.submittedById, [entry.questionId]: true };
      const questions = result.session.questions?.length ? result.session.questions : this.data.session.questions;
      this.setData({
        session: { ...result.session, questions },
        submittedById,
        submitted: true,
        showAnalysis: this.data.policy.revealAfterAnswer,
        currentQuestion: questions[this.data.currentIndex]?.question || entry.question,
        saveState: 'saved',
        busy: false,
      });
      this.saveDraft();
      this.setData({ saveState: 'saved', sheetItems: this.buildSheetItems() });
    } catch (error) {
      await this.handleWriteError(error);
    }
  },

  async persistRuntime() {
    if (!this.data.session.id) return;
    this.setData({ saveState: 'saving' });
    try {
      const session: PracticeSession = await this.syncCoordinator.enqueueWrite({
        sessionId: this.data.session.id,
        key: `state:${this.data.session.id}:${this.data.currentIndex}:${[...this.data.markedIds].sort().join(',')}`,
        action: 'state',
        payload: { runtimeState: this.modeRuntimeState() },
      });
      this.setData({ session: { ...session, questions: session.questions.length ? session.questions : this.data.session.questions }, saveState: 'saved' });
      this.saveDraft();
      this.setData({ saveState: 'saved' });
    } catch (error) {
      await this.handleWriteError(error);
    }
  },

  async handleWriteError(error: unknown) {
    const failure = classifyFailure(error);
    if (failure === 'auth') {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    if (failure === 'conflict' || (error instanceof ApiError && ['PRACTICE_SESSION_REVISION_CONFLICT', 'REVISION_CONFLICT', 'PRACTICE_REVISION_CONFLICT'].includes(error.code))) {
      this.setData({ saveState: 'conflict', busy: false });
      try {
        const latest = await getSession(this.data.session.id);
        const username = getCurrentUser()?.username || '';
        const local = loadLocalDraft(username, latest.id) || draftFor(this.data.session, username, this.data.currentIndex, this.data.answers, this.data.markedIds);
        const serverTime = String((latest as any).lastSavedAt || '刚刚');
        const localTime = local.savedAt ? new Date(local.savedAt).toLocaleString() : '未记录';
        const decision = await wx.showModal({
          title: '进度冲突',
          content: `服务器：${serverTime}\n本机：${localTime}\n载入服务器进度，或保留本机选择再重试。`,
          confirmText: '用服务器', cancelText: '保留本机',
        });
        if (decision.confirm) {
          await this.loadSession();
        } else {
          const reconciled = resolveConflict(
            draftFor(latest, username, Number(latest.runtimeState?.currentIndex || 0), answerMap(latest), (latest.runtimeState?.markedQuestionIds || []).map(String)),
            local,
            'local',
          );
          this.syncRevision = latest.revision;
          this.setData({
            session: { ...latest, questions: latest.questions.length ? latest.questions : this.data.session.questions },
            currentIndex: reconciled.currentIndex,
            answers: reconciled.answers,
            markedIds: reconciled.markedQuestionIds,
            saveState: 'local',
            writeError: '已保留本机草稿，请点击重试同步。',
          });
          this.refreshCurrent();
        }
      } catch (loadError) {
        this.setData({ writeError: messageOf(loadError) });
      }
      return;
    }
    this.setData({ saveState: failure === 'offline' ? 'offline' : 'local', writeError: messageOf(error), busy: false });
  },

  async retryWrites() {
    if (!this.syncCoordinator || !this.syncCoordinator.pendingCount()) {
      await this.persistRuntime();
      return;
    }
    this.setData({ saveState: 'saving', writeError: '' });
    try {
      const results = await this.syncCoordinator.retryPending();
      const completed = results.find((result: any) => result?.report && result?.session?.status === 'completed') as any;
      if (completed) {
        wx.redirectTo({ url: `/pages/result/index?sessionId=${encodeURIComponent(completed.session.id)}` });
        return;
      }
      await this.loadSession();
    } catch (error) {
      await this.handleWriteError(error);
    }
  },

  onMark() {
    const questionId = this.data.session.questions[this.data.currentIndex].questionId;
    const markedIds = toggleMarked(this.data.markedIds, questionId);
    this.setData({ markedIds, marked: markedIds.includes(questionId) });
    this.saveDraft();
    this.persistRuntime();
  },

  onPrevious() { this.goTo(moveQuestion(this.data.currentIndex, this.data.session.questions.length, -1)); },
  onNext() {
    if (this.data.currentIndex + 1 >= this.data.session.questions.length) { this.onComplete(); return; }
    this.goTo(moveQuestion(this.data.currentIndex, this.data.session.questions.length, 1));
  },
  goTo(index: number) {
    const changed = index !== this.data.currentIndex;
    this.setData({ currentIndex: index, writeError: '' });
    this.refreshCurrent();
    if (changed && this.data.policy.timerKind === 'countdown' && !this.data.submitted) this.startModeTimer(true);
    this.saveDraft();
    this.persistRuntime();
  },
  onOpenSheet() { this.setData({ sheetOpen: true, sheetItems: this.buildSheetItems() }); },
  onCloseSheet() { this.setData({ sheetOpen: false }); },
  onSheetSelect(event: any) { this.setData({ sheetOpen: false }); this.goTo(event.detail.index); },

  async onComplete() {
    const answered = Object.keys(this.data.submittedById).length;
    const unanswered = Math.max(0, this.data.session.questions.length - answered);
    const decision = await wx.showModal({ title: '确认交卷', content: `已答 ${answered} 题，未答 ${unanswered} 题。交卷后将生成成绩报告。`, confirmText: '确认交卷', cancelText: '继续检查' });
    if (!decision.confirm) return;
    this.setData({ busy: true });
    try {
      const result: any = await this.syncCoordinator.enqueueWrite({
        sessionId: this.data.session.id,
        key: `complete:${this.data.session.id}`,
        action: 'complete',
        payload: { runtimeState: this.modeRuntimeState() },
      });
      const username = getCurrentUser()?.username || '';
      if (username) clearLocalDraft(username, this.data.session.id);
      wx.redirectTo({ url: `/pages/result/index?sessionId=${encodeURIComponent(result.session.id)}` });
    } catch (error) { await this.handleWriteError(error); }
  },

  async onExit() {
    const decision = await wx.showModal({ title: '暂停练习', content: '当前选择会保留在本机，已提交的答案和进度会同步到服务器。', confirmText: '暂停退出', cancelText: '继续做题' });
    if (!decision.confirm) return;
    try {
      const paused: PracticeSession = await this.syncCoordinator.enqueueWrite({
        sessionId: this.data.session.id,
        key: `pause:${this.data.session.id}`,
        action: 'pause',
        payload: { runtimeState: this.modeRuntimeState() },
      });
      this.setData({ session: paused, saveState: 'saved' });
      this.saveDraft();
      this.setData({ saveState: 'saved' });
    } catch (error) {
      this.saveDraft();
      await this.handleWriteError(error);
      return;
    }
    wx.navigateBack({ delta: 1 });
  },

  onShow() {
    if (!this.data.loading && this.data.session.id && this.data.policy.showTimer && !this.timerId) this.startModeTimer();
  },
  onHide() {
    this.saveDraft();
    if (this.data.session.id && !this.data.loading) void this.persistRuntime();
    if (this.data.policy.showTimer) {
      this.setData({
        session: {
          ...this.data.session,
          runtimeState: { ...this.data.session.runtimeState, ...this.modeRuntimeState() },
        },
      });
    }
    this.stopModeTimer();
  },
  onUnload() { this.stopModeTimer(); },
});
