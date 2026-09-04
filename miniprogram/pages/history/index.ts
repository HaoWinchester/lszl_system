import { messageOf } from '../../services/http';
import { listSessions } from '../../services/practice';
import { PracticeHistoryItem } from '../../types/api';
import { selectPrimaryTab } from '../../domain/primary-tabs';

const modeLabels: Record<string, string> = {
  practice: '普通练习', challenge: '挑战模式', scholar: '学霸模式', revenge: '错题复仇',
};

function formatDate(value?: string): string {
  if (!value) return '时间未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function viewItem(item: PracticeHistoryItem) {
  const completed = item.status === 'completed';
  const accuracy = item.answered ? Math.round((item.correct / item.answered) * 100) : 0;
  return {
    ...item,
    modeLabel: modeLabels[item.mode] || '练习',
    dateLabel: formatDate(item.createdAt),
    statusLabel: completed ? '已交卷' : item.status === 'paused' ? '已暂停' : '已放弃',
    resultLabel: completed ? `正确率 ${accuracy}%` : `已答 ${item.answered} 题`,
    canReport: completed && item.reportAvailable,
    canResume: item.status === 'paused',
  };
}

Page({
  data: {
    statusBarHeight: 24,
    loading: true,
    error: '',
    filter: 'all',
    items: [] as ReturnType<typeof viewItem>[],
    visibleItems: [] as ReturnType<typeof viewItem>[],
  },

  onLoad() {
    this.setData({ statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24 });
  },

  onShow() {
    selectPrimaryTab(this as any, 1);
    this.loadHistory();
  },

  onPullDownRefresh() {
    this.loadHistory().finally(() => wx.stopPullDownRefresh());
  },

  async loadHistory() {
    this.setData({ loading: true, error: '' });
    try {
      const items = (await listSessions()).filter(item => item.sessionId).map(viewItem);
      this.setData({ items, loading: false });
      this.applyFilter();
    } catch (error) {
      this.setData({ loading: false, error: messageOf(error), items: [], visibleItems: [] });
    }
  },

  applyFilter() {
    const visibleItems = this.data.filter === 'all'
      ? this.data.items
      : this.data.items.filter(item => item.status === this.data.filter);
    this.setData({ visibleItems });
  },

  onFilter(event: any) {
    this.setData({ filter: String(event.currentTarget.dataset.filter || 'all') });
    this.applyFilter();
  },

  onOpen(event: any) {
    const sessionId = String(event.currentTarget.dataset.sessionId || '');
    const kind = String(event.currentTarget.dataset.kind || '');
    if (!sessionId) return;
    if (kind === 'report') {
      wx.navigateTo({ url: `/pages/result/index?sessionId=${encodeURIComponent(sessionId)}` });
    } else if (kind === 'resume') {
      wx.navigateTo({ url: `/pages/practice/index?sessionId=${encodeURIComponent(sessionId)}` });
    }
  },

  onBack() { wx.navigateBack(); },
});
