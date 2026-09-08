import { navigation } from "../../domain/navigation";
import { withAppearance } from '../../domain/appearance-page';
import { showDialog } from '../../domain/dialog';
import { normalizeQuestion } from '../../domain/question';
import { toggleAnswer } from '../../domain/practice-state';
import { classifyFailure, createSyncCoordinator } from '../../domain/sync-coordinator';
import type { SyncJob } from '../../domain/sync-coordinator';
import { messageOf } from '../../services/http';
import {
  getOverview,
  getRevengeSummary,
  getRemediation,
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

async function executeRevengeWrite(job: SyncJob) {
  if (job.action === 'revenge-answer') return submitRevengeAnswer(job.sessionId, { ...job.payload, requestId: job.key });
  if (job.action === 'remediation') return markRemediationReviewed(job.sessionId, job.key);
  if (job.action === 'verification') return submitVerification(job.sessionId, { ...job.payload, requestId: job.key });
  throw new Error(`不支持的错题同步操作: ${job.action}`);
}

Page(withAppearance({
  syncCoordinator: null as any,
  data: {
    statusBarHeight: 24,
    loading: true,
    busy: false,
    loadError: '',
    writeError: '',
    empty: false,
    waitingCount: 0,
    emptyTitle: '暂无待处理错题',
    emptyCopy: '',
    stats: {} as Record<string, number>,
    queueCount: 0,
    stage: 'answer' as 'answer' | 'remediation' | 'verification' | 'verification-result',
    candidate: {} as any,
    mistake: {} as any,
    question: {} as PracticeQuestion,
    selectedIds: [] as string[],
    previousAnswer: '',
    feedback: '',
  },

  onLoad() {
    this.syncCoordinator = createSyncCoordinator(executeRevengeWrite);
    this.setData({ statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24 });
    this.loadQueue();
  },

  async loadQueue() {
    this.setData({ loading: true, busy: false, loadError: '', writeError: '', selectedIds: [], feedback: '' });
    try {
      const [overview, summary] = await Promise.all([getOverview(), getRevengeSummary()]);
      const candidates = Array.isArray(overview.revengeCandidates) ? overview.revengeCandidates : [];
      let skipped = 0;
      for (const candidate of candidates) {
        if (candidate.status === 'needs_remediation' && candidate.remediationReviewedAt) {
          const mistakeId = String(candidate.mistakeId || candidate.id || '');
          const verification = await getVerificationCandidate(mistakeId);
          if (!verification.available || !verification.question) {
            skipped += 1;
            continue;
          }
          this.setData({
            loading: false,
            empty: false,
            stats: summary.stats || {},
            queueCount: candidates.length - skipped,
            stage: 'verification',
            candidate,
            mistake: candidate,
            question: normalizeQuestion(verification.question),
            previousAnswer: previousAnswer(candidate),
            feedback: '换一道同知识点题，确认自己是真正理解了。',
          });
          return;
        }
        if (candidate.status === 'needs_remediation') {
          const mistake = await getRemediation(String(candidate.mistakeId || candidate.id || ''));
          this.setData({ loading: false, empty: false, stats: summary.stats || {}, queueCount: candidates.length - skipped,
            stage: 'remediation', candidate, mistake, question: normalizeQuestion(mistake.questionSnapshot || {}),
            previousAnswer: (mistake.selectedAnswers || []).join('、') || previousAnswer(candidate), feedback: '继续上次未完成的纠错。' });
          return;
        }
        this.setData({
          loading: false,
          empty: false,
          stats: summary.stats || {},
          queueCount: candidates.length - skipped,
          stage: 'answer',
          candidate,
          mistake: candidate,
          question: normalizeQuestion(candidate.questionSnapshot || {}),
          previousAnswer: previousAnswer(candidate),
        });
        return;
      }
      const waitingCount = skipped + Number(summary.stats?.verificationWaiting || 0);
      this.setData({ loading: false, empty: true, stats: summary.stats || {}, queueCount: 0, waitingCount,
        emptyTitle: waitingCount ? '本轮复习已完成' : '暂无待处理错题',
        emptyCopy: waitingCount ? `还有 ${waitingCount} 道题等待复习时间或验证题，学习记录已保留。` : '继续练习后，需要重做的错题会出现在这里。' });
    } catch (error) {
      this.setData({ loading: false, loadError: messageOf(error) });
    }
  },

  onAnswerChange(event: any) {
    if (this.data.busy || this.syncCoordinator.pendingCount()) return;
    const selectedIds = toggleAnswer(
      this.data.selectedIds,
      String(event.detail.optionId || ''),
      this.data.question.type === 'multiple_choice',
    );
    this.setData({ selectedIds, feedback: '', writeError: '' });
  },

  async submitOriginal() {
    if (this.data.busy || !this.data.selectedIds.length) return;
    const mistakeId = String(this.data.candidate.mistakeId || this.data.candidate.id || '');
    this.setData({ busy: true, writeError: '' });
    try {
      const mistake: any = await this.syncCoordinator.enqueueWrite({
        sessionId: mistakeId,
        key: `revenge:${mistakeId}:${this.data.candidate.updatedAt || this.data.candidate.revengeAttemptCount || 0}`,
        action: 'revenge-answer',
        payload: answerPayload(this.data.question, this.data.selectedIds),
      });
      if (mistake.status !== 'needs_remediation') {
        await showDialog({
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
        previousAnswer: this.data.selectedIds.join('、'),
        question: normalizeQuestion(mistake.questionSnapshot || this.data.candidate.questionSnapshot || {}),
        feedback: '这次仍然答错了，先完成纠错。',
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  },

  async confirmRemediation() {
    if (this.data.busy) return;
    const mistakeId = String(this.data.candidate.mistakeId || this.data.candidate.id || '');
    this.setData({ busy: true, writeError: '' });
    try {
      await this.syncCoordinator.enqueueWrite({
        sessionId: mistakeId,
        key: `remediation:${mistakeId}:${this.data.mistake.updatedAt || ''}`,
        action: 'remediation',
        payload: {},
      });
      const verification = await getVerificationCandidate(mistakeId);
      if (!verification.available || !verification.question) {
        await showDialog({
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
      this.handleWriteError(error);
    }
  },

  async submitVerificationAnswer() {
    if (this.data.busy || !this.data.selectedIds.length) return;
    const mistakeId = String(this.data.candidate.mistakeId || this.data.candidate.id || '');
    this.setData({ busy: true, writeError: '' });
    try {
      const result: any = await this.syncCoordinator.enqueueWrite({
        sessionId: mistakeId,
        key: `verification:${mistakeId}:${this.data.question.id}:${this.data.mistake.verificationAttemptCount || 0}`,
        action: 'verification',
        payload: { questionId: this.data.question.id, ...answerPayload(this.data.question, this.data.selectedIds) },
      });
      this.showVerificationResult(result);
    } catch (error) {
      this.handleWriteError(error);
    }
  },

  handleWriteError(error: unknown) {
    if (classifyFailure(error) === 'auth') {
      navigation.reLaunch({ url: '/pages/login/index' });
      return;
    }
    this.setData({ busy: false, writeError: messageOf(error) });
  },

  showVerificationResult(result: any) {
    this.setData({ busy: false, stage: 'verification-result', question: normalizeQuestion(result.answer || this.data.question),
      feedback: result.verification?.correct ? '本次验证通过，已安排延时复习。' : '本次验证有误，请对照选项和解析，再继续纠错。' });
  },

  async retryWrites() {
    this.setData({ busy: true, writeError: '' });
    try {
      const results = await this.syncCoordinator.retryPending();
      const last: any = results[results.length - 1];
      if (last?.verification) {
        this.showVerificationResult(last);
        return;
      }
      if (last?.status === 'needs_remediation' && last?.remediationReviewedAt) {
        const mistakeId = String(last.id || this.data.candidate.mistakeId || '');
        const verification = await getVerificationCandidate(mistakeId);
        if (verification.available && verification.question) {
          this.setData({ busy: false, stage: 'verification', selectedIds: [], question: normalizeQuestion(verification.question) });
          return;
        }
        await this.loadQueue();
        return;
      }
      if (last?.status === 'needs_remediation') {
        this.setData({
          busy: false,
          stage: 'remediation',
          mistake: last,
          question: normalizeQuestion(last.questionSnapshot || {}),
          feedback: '这次仍然答错了，先完成纠错。',
        });
        return;
      }
      await this.loadQueue();
    } catch (error) {
      this.handleWriteError(error);
    }
  },

  onBack() { if (!this.data.busy) navigation.navigateBack({ fail: () => this.onHome() }); },
  onHome() { navigation.switchTab({ url: '/pages/home/index' }); },
}));
