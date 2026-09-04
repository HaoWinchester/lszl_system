import { messageOf } from '../../services/http';
import { getReport, getSession } from '../../services/practice';
import { PracticeQuestion, PracticeReport, PracticeSession } from '../../types/api';

const domainLabels: Record<string, string> = {
  people: '人员',
  process: '过程',
  'business-environment': '商业环境',
};

function percent(value: unknown): string {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function formatDuration(value: unknown): string {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) / 60000));
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

Page({
  data: {
    statusBarHeight: 24,
    loading: true,
    error: '',
    sessionId: '',
    report: {} as PracticeReport,
    session: { questions: [] } as unknown as PracticeSession,
    accuracy: '0',
    score: '0',
    duration: '0 分钟',
    conclusion: '继续巩固',
    domains: [] as Array<{ id: string; label: string; score: string; weak: boolean }>,
    wrongQuestions: [] as Array<{ questionId: string; number: number; question: PracticeQuestion }>,
    reviewOpen: false,
    reviewQuestion: {} as PracticeQuestion,
    reviewNumber: 0,
    reviewAnswer: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24,
      sessionId: decodeURIComponent(query.sessionId || ''),
    });
    this.loadResult();
  },

  async loadResult() {
    this.setData({ loading: true, error: '' });
    try {
      const [report, session] = await Promise.all([
        getReport(this.data.sessionId),
        getSession(this.data.sessionId),
      ]);
      const domainRows = Object.entries(report.domains || {})
        .filter(([, value]) => Number(value?.total || 0) > 0)
        .map(([id, value]) => ({
          id,
          label: domainLabels[id] || id,
          score: percent(value?.scorePercent),
          weak: Number(value?.scorePercent || 0) < 60,
        }))
        .sort((left, right) => Number(left.score) - Number(right.score));
      const wrongIds = new Set((report.wrongQuestionIds || []).map(String));
      const wrongQuestions = session.questions
        .map((entry, index) => ({ questionId: entry.questionId, number: index + 1, question: entry.question }))
        .filter(item => wrongIds.has(item.questionId));
      this.setData({
        report,
        session,
        accuracy: percent(report.accuracyPercent),
        score: percent(report.scorePercent),
        duration: formatDuration(report.durationMs),
        conclusion: report.passed ? '已达到本次目标' : '还有可以补强的地方',
        domains: domainRows,
        wrongQuestions,
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false, error: messageOf(error) });
    }
  },

  onReview(event: any) {
    const index = Number(event.currentTarget.dataset.index || 0);
    const item = this.data.wrongQuestions[index];
    if (!item) return;
    const correctIds = item.question.correctOptionIds || [];
    this.setData({
      reviewOpen: true,
      reviewQuestion: item.question,
      reviewNumber: item.number,
      reviewAnswer: correctIds.join('、') || item.question.correctAnswer || '请参考解析',
    });
  },

  onCloseReview() { this.setData({ reviewOpen: false }); },
  noop() {},

  onRetry() {
    const { session, report } = this.data;
    const query = [
      `paperId=${encodeURIComponent(String(session.paperId || report.paperId || ''))}`,
      `releaseId=${encodeURIComponent(String(session.releaseId || report.releaseId || ''))}`,
      `title=${encodeURIComponent(String(report.paperName || session.paperName || '再练一次'))}`,
      `count=${session.questions.length}`,
      'mode=normal',
    ].join('&');
    wx.redirectTo({ url: `/pages/practice-setup/index?${query}` });
  },

  onRevenge() {
    wx.navigateTo({ url: `/pages/revenge/index?sessionId=${encodeURIComponent(this.data.sessionId)}` });
  },

  onHome() { wx.reLaunch({ url: '/pages/home/index' }); },
});
