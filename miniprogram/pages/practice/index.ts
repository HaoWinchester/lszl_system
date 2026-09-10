import { navigation } from "../../domain/navigation";
import { withAppearance } from '../../domain/appearance-page';
import { showDialog } from '../../domain/dialog';
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from '../../domain/draft-store';
import { formatTimer, getModePolicy } from '../../domain/mode-policy';
import type { ModePolicy } from '../../domain/mode-policy';
import { mergeDraft, moveQuestion, PracticeDraft, toggleAnswer, toggleMarked } from '../../domain/practice-state';
import { classifyFailure, createSyncCoordinator, resolveConflict } from '../../domain/sync-coordinator';
import type { SyncJob } from '../../domain/sync-coordinator';
import { ApiError, messageOf } from '../../services/http';
import { abandonSession, completeSession, getSession, pauseSession, saveState } from '../../services/practice';
import { createPracticeRun, normalizePairs } from '../../domain/pc-practice';
import { getCurrentUser } from '../../services/session';
import { PracticeQuestion, PracticeSession } from '../../types/api';

function answerMap(session: PracticeSession): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  // Tentative multi-select choices are resumable UI state, never locked/graded answers.
  for (const entry of session.questions) {
    const pending = session.runtimeState?.pendingSelections?.[entry.questionId];
    if (entry.question.type === 'multiple_choice' && Array.isArray(pending)) {
      result[entry.questionId] = entry.question.options.map(option => option.id).filter(id => pending.includes(id));
    }
  }
  for (const [questionId, value] of Object.entries(session.answers || {})) {
    if (value.timedOut) { result[questionId] = []; continue; }
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

Page(withAppearance({
  timerId: 0 as any,
  timerStartedAt: 0,
  timerDeadline: 0,
  syncRevision: 0,
  syncCoordinator: null as any,
  leaving: false,
  confirming: false,
  unloaded: false,
  run: null as ReturnType<typeof createPracticeRun> | null,
  feedbackTimer: 0 as any,
  challengeFailedShown: false,
  data: {
    statusBarHeight: 24,
    loading: true,
    loadError: '',
    writeError: '',
    draftError: '',
    navigationError: '',
    navigationTarget: '',
    sessionId: '',
    session: { questions: [], revision: 0 } as unknown as PracticeSession,
    currentIndex: 0,
    currentQuestion: {} as PracticeQuestion,
    selectedIds: [] as string[],
    selectedPairs: {} as Record<string,string>,
    matches: {} as Record<string,Record<string,string>>,
    matchingComplete:false,
    answers: {} as Record<string, string[]>,
    submittedById: {} as Record<string, boolean>,
    markedIds: [] as string[],
    marked: false,
    submitted: false,
    showAnalysis: false,
    nextActionLabel: '下一题',
    sheetOpen: false,
    sheetItems: [] as any[],
    saveState: 'local',
    busy: false,
    progressPercent: 0,
    modeTitle: '普通练习',
    policy: getModePolicy('normal') as ModePolicy,
    timerLabel: '',
    timerUrgent: false,
    health: 0,
    maxHealth: 0,
    streak: 0,
    experience: 0,
    feedback: '',
    showAnswers: false,
    showResult: false,
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
      if (session.status === 'completed') {
        this.openReport(session.id);
        return;
      }
      if (session.status === 'abandoned') throw new Error('这次练习已放弃，请返回选择试卷重新开始。');
      if (!session.questions.length) throw new Error('本次练习没有可用题目，请返回重新选择试卷。');
      const username = getCurrentUser()?.username || '';
      const serverAnswers = answerMap(session);
      const serverDraft = draftFor(
        session,
        username,
        Number(session.runtimeState?.currentIndex || 0),
        serverAnswers,
        (session.runtimeState?.markedQuestionIds || []).map(String),
      );
      serverDraft.lockedAnswers = session.answers;
      const merged = mergeDraft(serverDraft, loadLocalDraft(username, session.id) || undefined);
      this.run = createPracticeRun(session, merged.conflict ? undefined : merged.state);
      const submittedById = Object.fromEntries(Object.keys(this.run.submission()).map(id => [id, true]));
      const runtime = this.run.runtime();
      this.syncRevision = session.revision;
      this.setData({
        session,
        currentIndex: Math.min(merged.state.currentIndex, Math.max(0, session.questions.length - 1)),
        answers: merged.state.answers,
        matches: runtime.pendingMatches||{},
        markedIds: merged.state.markedQuestionIds,
        submittedById,
        saveState: merged.conflict ? 'conflict' : merged.pendingLocal ? 'local' : 'saved',
        policy: getModePolicy(session.mode),
        modeTitle: getModePolicy(session.mode).title,
        showAnswers: runtime.showAnswers === true,
        health: runtime.health, maxHealth: this.run.maxHealth, streak: runtime.streak, experience: runtime.experience,
        loading: false,
      });
      this.refreshCurrent();
      this.startModeTimer();
      if (this.run.shouldComplete() && !merged.conflict) await this.onComplete();
      if (merged.conflict) await this.handleWriteError(new ApiError('服务器进度已更新', 409, 'PRACTICE_SESSION_REVISION_CONFLICT'));
    } catch (error) {
      this.setData({ loading: false, loadError: messageOf(error) });
    }
  },

  async executeSyncJob(job: SyncJob) {
    const input = { ...job.payload, revision: this.syncRevision, requestId: job.key };
    let result: any;
    if (job.action === 'state') result = await saveState(job.sessionId, input);
    else if (job.action === 'pause') result = await pauseSession(job.sessionId, input);
    else if (job.action === 'complete') result = await completeSession(job.sessionId, input);
    else if (job.action === 'abandon') result = await abandonSession(job.sessionId, input);
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
    const selectedIds = this.data.answers[questionId] || [];
    const lastQuestion = this.data.currentIndex + 1 === this.data.session.questions.length;
    this.setData({
      currentQuestion: entry.question,
      selectedIds,
      selectedPairs:this.run?.answer(questionId)?.selectedPairs||this.data.matches[questionId]||{},
      matchingComplete:!!normalizePairs(entry.question,this.data.matches[questionId]||{},true),
      submitted,
      nextActionLabel: this.run?.shouldComplete() ? '交卷'
        : lastQuestion ? (!submitted && selectedIds.length ? '完成本题' : '返回未答题') : '下一题',
      showAnalysis: this.data.policy.revealAfterAnswer && this.data.showAnswers,
      showResult: submitted || (this.data.policy.revealAfterAnswer && this.data.showAnswers),
      marked: this.data.markedIds.includes(questionId),
      progressPercent: Math.round(((this.data.currentIndex + 1) / this.data.session.questions.length) * 100),
      sheetItems: this.buildSheetItems(),
    });
  },

  modeRuntimeState() {
    const durationMs = this.timerStartedAt
      ? Math.max(0, Date.now() - this.timerStartedAt)
      : Number(this.run?.runtime().durationMs ?? this.data.session.runtimeState?.durationMs ?? this.data.session.stats?.durationMs ?? 0);
    const runtimeState: Record<string, unknown> = {
      ...this.run?.runtime(),
      currentIndex: this.data.currentIndex,
      markedQuestionIds: this.data.markedIds,
      durationMs,
      showAnswers: this.data.showAnswers,
      pendingMatches:Object.fromEntries(Object.entries(this.data.matches).filter(([id,pairs])=>Object.keys(pairs).length&&!this.run?.answer(id))),
      pendingSelections: Object.fromEntries(Object.entries(this.data.answers)
        .filter(([id, ids]) => ids.length && !this.run?.answer(id))),
    };
    if (this.data.policy.timerKind === 'countdown') {
      runtimeState.remainingMs = Math.max(0, this.timerDeadline - Date.now());
    }
    return runtimeState;
  },

  startModeTimer(resetCountdown = false) {
    this.stopModeTimer();
    const policy = this.data.policy;
    const priorDuration = Number(this.run?.runtime().durationMs ?? this.data.session.runtimeState?.durationMs ?? this.data.session.stats?.durationMs ?? 0);
    if (!this.timerStartedAt) this.timerStartedAt = Date.now() - priorDuration;
    if (!policy.showTimer) return;
    if (policy.timerKind === 'countdown') {
      const saved = Number(this.run?.runtime().remainingMs ?? this.data.session.runtimeState?.remainingMs);
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
      if (this.data.busy) return;
      this.submitTimeout();
    }
  },

  async submitTimeout() {
    if (this.data.busy || this.data.submitted) return;
    const entry = this.data.session.questions[this.data.currentIndex];
    if (!entry) return;
    this.recordCurrent(true);
    if (this.run?.shouldComplete()) { await this.onComplete(); return; }
    this.scheduleAdvance();
  },

  buildSheetItems() {
    return this.data.session.questions.map((entry, index) => ({
      questionId: entry.questionId,
      state: `${this.run?.answer(entry.questionId) ? (this.run.answer(entry.questionId)?.correct ? 'answered' : 'wrong') : (this.data.answers[entry.questionId]?.length || Object.keys(this.data.matches[entry.questionId]||{}).length) ? 'pending' : 'unanswered'}${index === this.data.currentIndex ? ' current' : ''}`,
      marked: this.data.markedIds.includes(entry.questionId),
      label: this.run?.answer(entry.questionId)?.timedOut ? '超时' : this.run?.answer(entry.questionId) ? (this.run.answer(entry.questionId)?.correct ? '正确' : '错误') : this.data.answers[entry.questionId]?.length ? '已选，尚未提交' : '未答',
    }));
  },

  saveDraft() {
    const username = getCurrentUser()?.username || '';
    if (!username || !this.data.session.id) return;
    try {
      saveLocalDraft({ ...draftFor(this.data.session, username, this.data.currentIndex, this.data.answers, this.data.markedIds),
        lockedAnswers: this.run?.submission(), runtimeState: this.modeRuntimeState() });
      this.setData({ saveState: 'local', draftError: '' });
    } catch {
      this.setData({ saveState: 'memory', draftError: '本机草稿无法保存，答案暂存在当前页面。请用“保存退出”或交卷同步进度，勿直接关闭小程序。' });
    }
  },

  onAnswerChange(event: any) {
    if (this.data.submitted || this.data.busy || this.data.showAnswers || this.syncCoordinator.pendingCount()) return;
    const questionId = this.data.session.questions[this.data.currentIndex].questionId;
    if(this.data.currentQuestion.type==='matching'){
      const pairs=normalizePairs(this.data.currentQuestion,event.detail.selectedPairs);if(!pairs)return;
      this.setData({matches:{...this.data.matches,[questionId]:pairs},selectedPairs:pairs,writeError:''});this.refreshCurrent();this.saveDraft();return;
    }
    if(this.data.currentQuestion.type==='unknown')return;
    const selected = toggleAnswer(
      this.data.answers[questionId] || [],
      event.detail.optionId,
      this.data.currentQuestion.type === 'multiple_choice',
    );
    this.setData({ answers: { ...this.data.answers, [questionId]: selected }, selectedIds: selected, writeError: '' });
    this.refreshCurrent();
    this.saveDraft();
    if (this.data.currentQuestion.type !== 'multiple_choice') {
      this.recordCurrent();
      if (this.run?.shouldComplete()) void this.onComplete();
      else if (this.data.session.mode !== 'practice') this.scheduleAdvance();
    }
  },

  onConfirmMatching(){
    if(this.data.showAnswers||this.data.busy||!this.data.matchingComplete||this.syncCoordinator.pendingCount())return;
    if(this.recordCurrent()){if(this.run?.shouldComplete())void this.onComplete();else if(this.data.session.mode!=='practice')this.scheduleAdvance();}
  },
  recordCurrent(timedOut = false) {
    if (this.data.busy || this.data.submitted || !this.run) return false;
    const entry = this.data.session.questions[this.data.currentIndex];
    this.run.patchRuntime(this.modeRuntimeState());
    if (!this.run.select(entry.questionId, entry.question.type==='matching'?this.data.selectedPairs:this.data.selectedIds, timedOut)) return false;
    const runtime = this.run.runtime();
    this.setData({ submitted: true, submittedById: { ...this.data.submittedById, [entry.questionId]: true },
      answers: { ...this.data.answers, [entry.questionId]: timedOut ? [] : this.data.selectedIds },
      health: runtime.health, streak: runtime.streak, experience: runtime.experience,
      feedback: timedOut ? '超时 · -1 生命' : this.run.answer(entry.questionId)?.correct ? '回答正确' : '回答错误',
    });
    if (this.data.policy.timerKind === 'countdown') {
      this.timerDeadline = Date.now() + runtime.remainingMs;
      if (!this.timerId) this.timerId = setInterval(() => this.updateModeTimer(), 250);
      this.updateModeTimer();
    }
    this.refreshCurrent(); this.saveDraft();
    if (this.data.session.mode === 'challenge' && runtime.health === 0 && !this.challengeFailedShown) {
      this.challengeFailedShown = true;
      void showDialog({ title: '本次挑战失败', content: '生命已用完，可以继续完成剩余题目，或保存退出。', showCancel: false, confirmText: '继续作答' });
    }
    return true;
  },

  scheduleAdvance() {
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => {
      if (!this.unloaded && !this.leaving && !this.data.busy) void this.onNext();
    }, 650);
  },

  async persistRuntime() {
    if (!this.data.session.id || this.leaving || this.unloaded || ['completed', 'abandoned'].includes(this.data.session.status)) return;
    this.setData({ saveState: 'saving' });
    try {
      const session: PracticeSession = await this.syncCoordinator.enqueueWrite({
        sessionId: this.data.session.id,
        key: `state:${this.data.session.id}:${Date.now()}`,
        action: 'state',
        payload: { answers: this.run?.submission() || {}, runtimeState: this.modeRuntimeState() },
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
      navigation.reLaunch({ url: '/pages/login/index' });
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
        const decision = await showDialog({
          title: '进度冲突',
          content: `服务器：${serverTime}\n本机：${localTime}\n载入服务器进度，或保留本机选择再重试。`,
          confirmText: '用服务器', cancelText: '保留本机',
        });
        if (decision.dismissed) return;
        if (decision.confirm) {
          clearLocalDraft(username, latest.id);
          await this.loadSession();
        } else {
          const serverDraft = draftFor(latest, username, Number(latest.runtimeState?.currentIndex || 0), answerMap(latest), (latest.runtimeState?.markedQuestionIds || []).map(String));
          serverDraft.lockedAnswers = latest.answers;
          const reconciled = resolveConflict(
            serverDraft,
            local,
            'local',
          );
          this.syncRevision = latest.revision;
          this.run = createPracticeRun(latest, { ...local, runtimeState: local.runtimeState });
          this.setData({
            session: { ...latest, questions: latest.questions.length ? latest.questions : this.data.session.questions },
            currentIndex: reconciled.currentIndex,
            answers: mergeDraft(serverDraft, reconciled).state.answers,
            matches:this.run.runtime().pendingMatches||{},
            submittedById: Object.fromEntries(Object.keys(this.run.submission()).map(id => [id, true])),
            markedIds: reconciled.markedQuestionIds,
            saveState: 'local',
            writeError: '',
          });
          this.saveDraft();
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
    if (this.data.busy) return;
    if (!this.syncCoordinator || !this.syncCoordinator.pendingCount()) {
      await this.persistRuntime();
      return;
    }
    this.setData({ busy: true, saveState: 'saving', writeError: '' });
    try {
      const results = await this.syncCoordinator.retryPending();
      const completed = results.find((result: any) => result?.report && result?.session?.status === 'completed') as any;
      if (completed) {
        this.stopModeTimer();
        const username = getCurrentUser()?.username || '';
        if (username) clearLocalDraft(username, completed.session.id);
        this.openReport(completed.session.id);
        return;
      }
      const exited = results.find((result: any) => ['paused', 'abandoned'].includes(result?.status)) as PracticeSession | undefined;
      if (exited) {
        // The acknowledged snapshot includes tentative selections and marks.
        // An older local revision would falsely conflict when this page reopens.
        clearLocalDraft(getCurrentUser()?.username || '', exited.id);
        this.leavePractice();
        return;
      }
      await this.loadSession();
      this.setData({ busy: false });
    } catch (error) {
      await this.handleWriteError(error);
    }
  },

  onMark() {
    if (this.data.loading || this.data.loadError || this.data.busy || !this.data.session.questions.length) return;
    const questionId = this.data.session.questions[this.data.currentIndex].questionId;
    const markedIds = toggleMarked(this.data.markedIds, questionId);
    this.setData({ markedIds, marked: markedIds.includes(questionId) });
    this.saveDraft();
  },

  onShowAnswers(event: any) { this.setData({ showAnswers: event.detail.value }); this.refreshCurrent(); this.saveDraft(); },

  onPrevious() { this.goTo(moveQuestion(this.data.currentIndex, this.data.session.questions.length, -1)); },
  async onNext() {
    if (this.data.busy || this.leaving || this.syncCoordinator.pendingCount()) return;
    if (!this.data.submitted && this.data.currentQuestion.type === 'multiple_choice' && !this.data.showAnswers) this.recordCurrent();
    if (this.run?.shouldComplete()) { await this.onComplete(); return; }
    if (this.data.currentIndex + 1 >= this.data.session.questions.length) {
      const index = this.data.session.questions.findIndex(entry => !this.run?.answer(entry.questionId));
      if (index >= 0) this.goTo(index);
      return;
    }
    this.goTo(moveQuestion(this.data.currentIndex, this.data.session.questions.length, 1));
  },
  goTo(index: number) {
    if (this.data.busy || this.leaving || this.syncCoordinator.pendingCount()) return;
    if (index !== this.data.currentIndex && !this.data.showAnswers && this.data.currentQuestion.type === 'multiple_choice') this.recordCurrent();
    if (this.run?.shouldComplete()) return this.onComplete();
    clearTimeout(this.feedbackTimer);
    this.setData({ currentIndex: index, writeError: '', feedback: '' });
    this.refreshCurrent();
    this.saveDraft();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  onOpenSheet() { this.setData({ sheetOpen: true, sheetItems: this.buildSheetItems() }); },
  onCloseSheet() { this.setData({ sheetOpen: false }); },
  onSheetSelect(event: any) { this.setData({ sheetOpen: false }); this.goTo(event.detail.index); },

  async onComplete() {
    if (this.data.busy || this.confirming || this.leaving) return;
    if (this.syncCoordinator.pendingCount()) {
      this.setData({ writeError: '还有提交未同步，请先重试同步后再交卷。' });
      return;
    }
    if (!this.data.showAnswers && this.data.currentQuestion.type === 'multiple_choice') this.recordCurrent();
    if (!this.run?.shouldComplete()) {
      const index = this.data.session.questions.findIndex(entry => !this.run?.answer(entry.questionId));
      if (index >= 0) { this.setData({ sheetOpen: false }); this.goTo(index); }
      return;
    }
    this.setData({ busy: true });
    clearTimeout(this.feedbackTimer);
    this.stopModeTimer();
    try {
      const result: any = await this.syncCoordinator.enqueueWrite({
        sessionId: this.data.session.id,
        key: `complete:${this.data.session.id}`,
        action: 'complete',
        payload: { answers: this.run.submission(), runtimeState: this.modeRuntimeState() },
      });
      const username = getCurrentUser()?.username || '';
      if (username) clearLocalDraft(username, this.data.session.id);
      this.openReport(result.session.id);
    } catch (error) { await this.handleWriteError(error); }
  },

  async onExit() {
    if (this.data.busy || this.confirming || this.leaving) return;
    if (this.data.loading || this.data.loadError) { this.leavePractice(); return; }
    if (this.syncCoordinator.pendingCount()) {
      this.setData({ writeError: '还有提交未同步，请先重试同步再退出。' });
      return;
    }
    this.confirming = true;
    const decision = await showDialog({ title: '退出练习', content: '保存已答题和当前进度，下次继续；也可以结束本次练习，已答错题仍会计入错题记录。', confirmText: '保存退出', cancelText: '结束练习' });
    this.confirming = false;
    if (decision.dismissed) return;
    if (!decision.confirm) {
      const abandon = await showDialog({ title: '结束本次练习？', content: '结束后不能继续本次练习；已答题会按 PC 规则结算。', confirmText: '结束练习', cancelText: '继续做题' });
      if (!abandon.confirm) return;
      this.setData({ busy: true });
      try {
        await this.syncCoordinator.enqueueWrite({ sessionId: this.data.session.id, key: `abandon:${this.data.session.id}:${this.syncRevision}`, action: 'abandon', payload: { answers: this.run?.submission() || {}, runtimeState: this.modeRuntimeState() } });
        clearLocalDraft(getCurrentUser()?.username || '', this.data.session.id);
        this.leavePractice();
      } catch (error) { await this.handleWriteError(error); }
      return;
    }
    this.setData({ busy: true });
    try {
      const paused: PracticeSession = await this.syncCoordinator.enqueueWrite({
        sessionId: this.data.session.id,
        key: `pause:${this.data.session.id}:${this.syncRevision}`,
        action: 'pause',
        payload: { answers: this.run?.submission() || {}, runtimeState: this.modeRuntimeState() },
      });
      this.setData({ session: paused, saveState: 'saved' });
      this.saveDraft();
      this.setData({ saveState: 'saved' });
    } catch (error) {
      this.saveDraft();
      await this.handleWriteError(error);
      return;
    }
    this.leavePractice();
  },

  leavePractice() {
    this.leaving = true;
    this.stopModeTimer();
    clearTimeout(this.feedbackTimer);
    this.setData({ navigationTarget: '/pages/home/index' });
    this.retryNavigation();
  },

  openReport(sessionId: string) {
    this.leaving = true;
    this.stopModeTimer();
    clearTimeout(this.feedbackTimer);
    this.setData({ navigationTarget: `/pages/result/index?sessionId=${encodeURIComponent(sessionId)}` });
    this.retryNavigation();
  },

  retryNavigation() {
    const url = this.data.navigationTarget;
    if (!url) return;
    this.setData({ busy: true, navigationError: '', sheetOpen: false });
    const method = url === '/pages/home/index' ? 'switchTab' : 'redirectTo';
    navigation[method]({ url, fail: () => this.setData({ busy: false,
      navigationError: '进度已保存，但页面未打开。请重试跳转，不会重复提交。' }) });
  },

  onShow() {
    if (!this.leaving && !this.data.loading && this.data.session.id && !this.timerStartedAt) {
      this.startModeTimer();
      if (this.run?.shouldComplete()) void this.onComplete();
    }
  },
  onHide() {
    if (this.leaving) return;
    this.saveDraft();
    this.run?.patchRuntime(this.modeRuntimeState());
    clearTimeout(this.feedbackTimer);
    if (this.data.session.id && !this.data.loading && !this.data.busy) void this.persistRuntime();
    if (this.data.session.id) {
      this.setData({
        session: {
          ...this.data.session,
          runtimeState: { ...this.data.session.runtimeState, ...this.modeRuntimeState() },
        },
      });
    }
    this.stopModeTimer();
    this.timerStartedAt = 0;
  },
  onUnload() { this.unloaded = true; this.stopModeTimer(); clearTimeout(this.feedbackTimer); },
}));
