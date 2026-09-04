import { messageOf } from '../../services/http';
import { listPublishedPapers } from '../../services/papers';
import { PaperSummary, PracticeMode } from '../../types/api';

function filteredPapers(items: PaperSummary[], subject: string, access: string): PaperSummary[] {
  return items.filter(item =>
    (subject === '全部科目' || item.subject === subject)
    && (access === 'all' || item.accessLevel === access),
  );
}

Page({
  data: {
    statusBarHeight: 24,
    loading: true,
    error: '',
    papers: [] as PaperSummary[],
    filtered: [] as PaperSummary[],
    subjects: ['全部科目'],
    subject: '全部科目',
    access: 'all',
    mode: 'normal' as PracticeMode,
    skeletonRows: [0, 1, 2],
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24,
      mode: (query.mode || 'normal') as PracticeMode,
    });
    this.loadPapers();
  },

  onPullDownRefresh() {
    this.loadPapers().finally(() => wx.stopPullDownRefresh());
  },

  async loadPapers() {
    this.setData({ loading: true, error: '' });
    try {
      const { items } = await listPublishedPapers(1, 100);
      const subjects = ['全部科目', ...Array.from(new Set(items.map(item => item.subject)))];
      this.setData({ papers: items, subjects, loading: false });
      this.applyFilters();
    } catch (error) {
      this.setData({ loading: false, error: messageOf(error), filtered: [] });
    }
  },

  applyFilters() {
    this.setData({
      filtered: filteredPapers(this.data.papers, this.data.subject, this.data.access),
    });
  },

  onSubject(event: any) {
    this.setData({ subject: event.currentTarget.dataset.subject });
    this.applyFilters();
  },

  onAccess(event: any) {
    this.setData({ access: event.currentTarget.dataset.access });
    this.applyFilters();
  },

  onSelectPaper(event: any) {
    const item = event.detail.item as PaperSummary;
    if (item.contentRestricted) {
      wx.showModal({
        title: '当前账号暂不可练习',
        content: '这份会员试卷需要先在网页端开通对应权限，已有权限会自动同步。',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }
    const params = [
      `paperId=${encodeURIComponent(item.paperId)}`,
      `releaseId=${encodeURIComponent(item.releaseId)}`,
      `title=${encodeURIComponent(item.title)}`,
      `count=${item.questionCount}`,
      `mode=${this.data.mode}`,
    ].join('&');
    wx.navigateTo({ url: `/pages/practice-setup/index?${params}` });
  },

  onBack() { wx.navigateBack(); },
});
