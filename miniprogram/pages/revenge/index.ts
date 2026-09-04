import { normalizeQuestion } from '../../domain/question';
import { toggleAnswer } from '../../domain/practice-state';
import { messageOf } from '../../services/http';
import {
  getOverview,
  getRevengeSummary,
  getVerificationCandidate,
  markRemediationReviewed,
  submitRevengeAnswer,
  submitVerification,
} from '../../services/practice';
import { PracticeQuestion } from '../../types/api';

function answerPayload(question: PracticeQuestion, selectedIds: string[]) {
  return question.type === 'multiple_choice'
    ? { selectedAnswerIds: selectedIds }
    : { selectedAnswer: selectedIds[0] };
}

function previousAnswer(candidate: any): string {
  const values = Array.isArray(candidate?.previousWrongAnswerIds)
    ? candidate.previousWrongAnswerIds.map(String)
    : candidate?.previousWrongAnswer ? [String(candidate.previousWrongAnswer)] : [];
  return values.join('、');
}

Page({
  data: {
    statusBarHeight: 24,
    loading: true,
    busy: false,
    error: '',
    empty: false,
    stats: {} as Record<string, number>,
    queueCount: 0,
    stage: 'answer' as 'answer' | 'remediation' | 'verification',
    candidate: {} as any,
    mistake: {} as any,
    question: {} as PracticeQuestion,
    selectedIds: [] as string[],
    previousAnswer: '',
    feedback: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24 });
    this.loadQueue();
  },

  async loadQueue() {
    this.setData({ loading: true, busy: false, error: '', selectedIds: [], feedback: '' });
    try {
      const [overview, summary] = await Promise.all([getOverview(), getRevengeSummary()]);
      const candidates = Array.isArray(overview.revengeCandidates) ? overview.revengeCandidates : [];
      const candidate = candidates[0];
      if (!candidate) {
        this.setData({ loading: false, empty: true, stats: summary.stats || {}, queueCount: 0 });
        return;
      }
      this.setData({
        loading: false,
        empty: false,
        stats: summary.stats || {},
        queueCount: candidates.length,
        stage: 'answer',
        candidate,
        mistake: candidate,
        question: normalizeQuestion(candidate.questionSnapshot || {}),
        previousAnswer: previousAnswer(candidate),
      });
    } catch (error) {
      this.setData({ loading: false, error: messageOf(error) });
    }
  },

  onAnswerChange(event: any) {
    const selectedIds = toggleAnswer(
      this.data.selectedIds,
      String(event.detail.optionId || ''),
      this.data.question.type === 'multiple_choice',
    );
    this.setData({ selectedIds, feedback: '' });
  },

  async submitOriginal() {
    if (this.data.busy || !this.data.selectedIds.length) return;
    const mistakeId = String(this.data.candidate.mistakeId || this.data.candidate.id || '');
    this.setData({ busy: true, error: '' });
    try {
      const mistake = await submitRevengeAnswer(mistakeId, {
        ...answerPayload(this.data.question, this.data.selectedIds),
        requestId: `revenge:${mistakeId}:${this.data.candidate.updatedAt || this.data.candidate.revengeAttemptCount || 0}`,
      });
      if (mistake.status !== 'needs_remediation') {
        await wx.showModal({
          title: '这次答对了',
          content: mistake.status === 'mastered' ? '这道错题已完成掌握验证。' : '已进入延时复习，稍后会再次验证。',
          showCancel: false,
          confirmText: '继续',
        });
        await this.loadQueue();
        return;
      }
      this.setData({
        busy: false,
        stage: 'remediation',
        mistake,
        question: normalizeQuestion(mistake.questionSnapshot || this.data.candidate.questionSnapshot || {}),
        feedback: '这次仍然答错了，先完成纠错。',
      });
    } catch (error) {
      this.setData({ busy: false, error: messageOf(error) });
    }
  },

  async confirmRemediation() {
    if (this.data.busy) return;
    const mistakeId = String(this.data.candidate.mistakeId || this.data.candidate.id || '');
    this.setData({ busy: true, error: '' });
    try {
      await markRemediationReviewed(mistakeId, `remediation:${mistakeId}`);
      const verification = await getVerificationCandidate(mistakeId);
      if (!verification.available || !verification.question) {
        await wx.showModal({
          title: '纠错已完成', content: verification.message || '暂无同知识点变式题，以后可继续验证。', showCancel: false,
        });
        await this.loadQueue();
        return;
      }
      this.setData({
        busy: false,
        stage: 'verification',
        selectedIds: [],
        question: normalizeQuestion(verification.question),
        feedback: '换一道同知识点题，确认自己是真正理解了。',
      });
    } catch (error) {
      this.setData({ busy: false, error: messageOf(error) });
    }
  },

  async submitVerificationAnswer() {
    if (this.data.busy || !this.data.selectedIds.length) return;
    const mistakeId = String(this.data.candidate.mistakeId || this.data.candidate.id || '');
    this.setData({ busy: true, error: '' });
    try {
      const result: any = await submitVerification(mistakeId, {
        questionId: this.data.question.id,
        ...answerPayload(this.data.question, this.data.selectedIds),
        requestId: `verification:${mistakeId}:${this.data.question.id}`,
      });
      await wx.showModal({
        title: result.verification?.correct ? '验证通过' : '再理一遍',
        content: result.verification?.correct ? '这个知识点已经掌握。' : '变式题仍然出错，已重新放回纠错队列。',
        showCancel: false,
        confirmText: '继续',
      });
      await this.loadQueue();
    } catch (error) {
      this.setData({ busy: false, error: messageOf(error) });
    }
  },

  onBack() { wx.navigateBack(); },
  onHome() { wx.reLaunch({ url: '/pages/home/index' }); },
});
