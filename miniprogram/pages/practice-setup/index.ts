import { navigation } from "../../domain/navigation";
import { withAppearance } from '../../domain/appearance-page';
import { showDialog } from '../../domain/dialog';
import { ApiError, messageOf } from '../../services/http';
import { abandonSession, getSession, startSession } from '../../services/practice';
import { PracticeMode, PracticeOrder } from '../../types/api';
import { MODE_CHOICES } from '../../domain/mode-policy';

Page(withAppearance({
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
    modes: MODE_CHOICES,
    starting: false,
    existingSessionId: '',
    error: '',
  },

  onLoad(query: Record<string, string>) {
    const total = Math.max(1, Number(query.count || 1));
    const values = total < 10 ? [total] : [10, 20, 60, 180].filter(value => value <= total);
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

  updateSetting(field: 'count' | 'order' | 'mode', value: number | string) {
    if (this.data.starting || this.data[field] === value) return;
    // A resumable session belongs to the settings that produced its lookup.
    this.setData({ [field]: value, existingSessionId: '', error: '' });
  },
  onCount(event: any) { this.updateSetting('count', Number(event.currentTarget.dataset.value)); },
  onOrder(event: any) { this.updateSetting('order', event.currentTarget.dataset.order); },
  onMode(event: any) { this.updateSetting('mode', event.currentTarget.dataset.mode); },
  onBack() { navigation.navigateBack(); },

  async start() {
    if (this.data.starting) return;
    this.setData({ starting: true, error: '' });
    if (this.data.existingSessionId) { this.openPractice(this.data.existingSessionId); return; }
    try {
      const session = await startSession({
        paperId: this.data.paperId,
        releaseId: this.data.releaseId,
        mode: this.data.mode,
        count: this.data.count,
        order: this.data.order,
      });
      this.openPractice(session.id);
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
    const decision = await showDialog({
      title: '已有未完成练习',
      content: '继续上次进度，或返回设置。若要重新开始，可在设置页明确放弃上次练习。',
      confirmText: '继续练习',
      cancelText: '返回设置',
    });
    if (decision.confirm) {
      this.openPractice(sessionId);
      return;
    }
    this.setData({ starting: false, existingSessionId: sessionId });
  },

  openPractice(sessionId: string) {
    navigation.redirectTo({
      url: `/pages/practice/index?sessionId=${encodeURIComponent(sessionId)}`,
      fail: () => this.setData({ starting: false, existingSessionId: sessionId,
        error: '练习已保留，但页面未打开。请点击继续练习重试。' }),
    });
  },

  async onRestartExisting() {
    const sessionId = this.data.existingSessionId;
    if (!sessionId || this.data.starting) return;
    const decision = await showDialog({ title: '放弃上次练习？', content: '上次练习将结束，不能再继续作答。随后按当前设置创建新练习。', confirmText: '重新开始', cancelText: '保留进度' });
    if (!decision.confirm) return;
    this.setData({ starting: true, error: '' });
    try {
      const existing = await getSession(sessionId);
      await abandonSession(sessionId, {
        revision: existing.revision,
        requestId: `abandon:${sessionId}:${existing.revision}`,
      });
      this.setData({ starting: false, existingSessionId: '' });
      await this.start();
    } catch (retryError) {
      this.setData({ error: messageOf(retryError), starting: false });
    }
  },
}));
