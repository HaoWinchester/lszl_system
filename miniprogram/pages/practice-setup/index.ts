import { ApiError, messageOf } from '../../services/http';
import { abandonSession, getSession, startSession } from '../../services/practice';
import { PracticeMode, PracticeOrder } from '../../types/api';

const modes = [
  { id: 'normal', title: '普通练习', copy: '提交后即可查看答案与解析', tone: 'green' },
  { id: 'challenge', title: '挑战模式', copy: '限时完成，交卷后统一查看结果', tone: 'clay' },
  { id: 'scholar', title: '学霸模式', copy: '更紧凑的时间要求与完整评分', tone: 'gold' },
];

Page({
  data: {
    statusBarHeight: 24,
    paperId: '',
    releaseId: '',
    title: '未命名试卷',
    totalCount: 0,
    countChoices: [] as Array<{ label: string; value: number }>,
    count: 10,
    order: 'paper' as PracticeOrder,
    mode: 'normal' as PracticeMode,
    modes,
    starting: false,
    error: '',
  },

  onLoad(query: Record<string, string>) {
    const total = Math.max(1, Number(query.count || 1));
    const values = [10, 20, total].filter((value, index, rows) => value <= total && rows.indexOf(value) === index);
    this.setData({
      statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24,
      paperId: decodeURIComponent(query.paperId || ''),
      releaseId: decodeURIComponent(query.releaseId || ''),
      title: decodeURIComponent(query.title || '未命名试卷'),
      totalCount: total,
      countChoices: values.map(value => ({ label: value === total ? `全卷 ${value}` : `${value} 题`, value })),
      count: values[0],
      mode: (query.mode || 'normal') as PracticeMode,
    });
  },

  onCount(event: any) { this.setData({ count: Number(event.currentTarget.dataset.value) }); },
  onOrder(event: any) { this.setData({ order: event.currentTarget.dataset.order }); },
  onMode(event: any) { this.setData({ mode: event.currentTarget.dataset.mode }); },
  onBack() { wx.navigateBack(); },

  async start() {
    if (this.data.starting) return;
    this.setData({ starting: true, error: '' });
    try {
      const session = await startSession({
        paperId: this.data.paperId,
        releaseId: this.data.releaseId,
        mode: this.data.mode,
        count: this.data.count,
        order: this.data.order,
      });
      wx.redirectTo({ url: `/pages/practice/index?sessionId=${encodeURIComponent(session.id)}` });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RESUMABLE_SESSION_EXISTS') {
        await this.resolveExistingSession(error);
        return;
      }
      this.setData({ error: messageOf(error), starting: false });
    }
  },

  async resolveExistingSession(error: ApiError) {
    const sessionId = String((error.detail as any)?.detail?.sessionId || '');
    if (!sessionId) {
      this.setData({ error: error.message, starting: false });
      return;
    }
    const decision = await wx.showModal({
      title: '已有未完成练习',
      content: '可以继续上次进度，也可以放弃后重新开始。',
      confirmText: '继续上次',
      cancelText: '放弃后重新开始',
    });
    if (decision.confirm) {
      wx.redirectTo({ url: `/pages/practice/index?sessionId=${encodeURIComponent(sessionId)}` });
      return;
    }
    try {
      const existing = await getSession(sessionId);
      await abandonSession(sessionId, {
        revision: existing.revision,
        requestId: `abandon:${sessionId}:${existing.revision}`,
      });
      this.setData({ starting: false });
      await this.start();
    } catch (retryError) {
      this.setData({ error: messageOf(retryError), starting: false });
    }
  },
});
