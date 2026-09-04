import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from '../../domain/draft-store';
import { mergeDraft, moveQuestion, PracticeDraft, toggleAnswer, toggleMarked } from '../../domain/practice-state';
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
  data: {
    statusBarHeight: 24,
    loading: true,
    error: '',
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
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24,
      sessionId: decodeURIComponent(query.sessionId || ''),
    });
    this.loadSession();
  },

  async loadSession() {
    this.setData({ loading: true, error: '' });
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
      this.setData({
        session,
        currentIndex: Math.min(merged.state.currentIndex, Math.max(0, session.questions.length - 1)),
        answers: merged.state.answers,
        markedIds: merged.state.markedQuestionIds,
        submittedById,
        saveState: merged.conflict ? 'conflict' : merged.pendingLocal ? 'local' : 'saved',
        modeTitle: ({ practice: '普通练习', challenge: '挑战模式', scholar: '学霸模式', revenge: '错题复仇' } as any)[session.mode] || '练习',
        loading: false,
      });
      this.refreshCurrent();
    } catch (error) {
      this.setData({ loading: false, error: messageOf(error) });
    }
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
      showAnalysis: submitted && ['practice', 'revenge'].includes(this.data.session.mode),
      marked: this.data.markedIds.includes(questionId),
      progressPercent: Math.round(((this.data.currentIndex + 1) / this.data.session.questions.length) * 100),
      sheetItems: this.buildSheetItems(),
    });
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
    this.setData({ answers: { ...this.data.answers, [questionId]: selected }, selectedIds: selected });
    this.saveDraft();
  },

  async submitCurrent() {
    if (this.data.busy || !this.data.selectedIds.length) return;
    const entry = this.data.session.questions[this.data.currentIndex];
    this.setData({ busy: true, saveState: 'saving', error: '' });
    try {
      const input: any = {
        revision: this.data.session.revision,
        questionId: entry.questionId,
        requestId: `answer:${this.data.session.id}:${entry.questionId}:${this.data.session.revision}`,
      };
      if (entry.question.type === 'multiple_choice') input.selectedAnswerIds = this.data.selectedIds;
      else input.selectedAnswer = this.data.selectedIds[0];
      const result = await submitAnswer(this.data.session.id, input);
      const submittedById = { ...this.data.submittedById, [entry.questionId]: true };
      const questions = result.session.questions?.length ? result.session.questions : this.data.session.questions;
      this.setData({
        session: { ...result.session, questions },
        submittedById,
        submitted: true,
        showAnalysis: ['practice', 'revenge'].includes(result.session.mode),
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
      const session = await saveState(this.data.session.id, {
        revision: this.data.session.revision,
        requestId: `state:${this.data.session.id}:${this.data.session.revision}:${this.data.currentIndex}`,
        runtimeState: { currentIndex: this.data.currentIndex, markedQuestionIds: this.data.markedIds },
      });
      this.setData({ session: { ...session, questions: session.questions.length ? session.questions : this.data.session.questions }, saveState: 'saved' });
      this.saveDraft();
      this.setData({ saveState: 'saved' });
    } catch (error) {
      await this.handleWriteError(error);
    }
  },

  async handleWriteError(error: unknown) {
    if (error instanceof ApiError && ['PRACTICE_SESSION_REVISION_CONFLICT', 'REVISION_CONFLICT', 'PRACTICE_REVISION_CONFLICT'].includes(error.code)) {
      this.setData({ saveState: 'conflict', busy: false });
      const decision = await wx.showModal({ title: '进度冲突', content: '这份练习已在其他页面更新。是否载入服务器上的最新进度？', confirmText: '载入最新', cancelText: '保留本机' });
      if (decision.confirm) await this.loadSession();
      return;
    }
    this.setData({ saveState: error instanceof ApiError && error.statusCode === 0 ? 'offline' : 'local', error: messageOf(error), busy: false });
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
  goTo(index: number) { this.setData({ currentIndex: index, error: '' }); this.refreshCurrent(); this.saveDraft(); this.persistRuntime(); },
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
      const result = await completeSession(this.data.session.id, {
        revision: this.data.session.revision,
        requestId: `complete:${this.data.session.id}:${this.data.session.revision}`,
      });
      const username = getCurrentUser()?.username || '';
      if (username) clearLocalDraft(username, this.data.session.id);
      wx.redirectTo({ url: `/pages/result/index?sessionId=${encodeURIComponent(result.session.id)}` });
    } catch (error) { await this.handleWriteError(error); }
  },

  async onExit() {
    const decision = await wx.showModal({ title: '暂停练习', content: '当前选择会保留在本机，已提交的答案和进度会同步到服务器。', confirmText: '暂停并退出', cancelText: '继续做题' });
    if (!decision.confirm) return;
    try {
      const paused = await pauseSession(this.data.session.id, {
        revision: this.data.session.revision,
        requestId: `pause:${this.data.session.id}:${this.data.session.revision}`,
        runtimeState: { currentIndex: this.data.currentIndex, markedQuestionIds: this.data.markedIds },
      });
      this.setData({ session: paused, saveState: 'saved' });
    } catch (error) { this.saveDraft(); }
    wx.navigateBack({ delta: 1 });
  },

  onHide() { this.saveDraft(); },
});
