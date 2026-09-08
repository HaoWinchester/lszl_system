import { navigation } from "../../domain/navigation";
import { withAppearance } from '../../domain/appearance-page';
import { messageOf } from '../../services/http';
import { listPublishedPapers } from '../../services/papers';
import { PaperSummary, PracticeMode } from '../../types/api';
import { openMembershipOffer } from '../../domain/membership-navigation';

function filteredPapers(items: PaperSummary[], subject: string, access: string): PaperSummary[] {
  return items.filter(item =>
    (subject === '全部科目' || item.subject === subject)
    && (access === 'all' || item.accessLevel === access),
  );
}

Page(withAppearance({
  fetching: false,
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
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
    moreError: '',
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
    if (this.fetching) return;
    this.fetching = true;
    this.setData({ loading: true, error: '' });
    try {
      const { items, total = items.length } = await listPublishedPapers(1, 100);
      const subjects = ['全部科目', ...Array.from(new Set(items.map(item => item.subject)))];
      this.setData({ papers: items, subjects, loading: false, page: 1, total, hasMore: items.length < total, moreError: '' });
      this.applyFilters();
    } catch (error) {
      this.setData({ loading: false, error: messageOf(error), filtered: [] });
    } finally {
      this.fetching = false;
    }
  },

  async loadMore() {
    if (this.fetching || !this.data.hasMore) return;
    this.fetching = true;
    this.setData({ loadingMore: true, moreError: '' });
    try {
      const next = this.data.page + 1;
      const { items, total } = await listPublishedPapers(next, 100);
      const papers = [...new Map([...this.data.papers, ...items].map(item => [item.releaseId, item])).values()];
      this.setData({ papers, total, page: next, hasMore: items.length > 0 && next * 100 < total,
        subjects: ['全部科目', ...Array.from(new Set(papers.map(item => item.subject)))] });
      this.applyFilters();
    } catch (error) {
      this.setData({ moreError: messageOf(error) });
    } finally {
      this.fetching = false;
      this.setData({ loadingMore: false });
    }
  },

  onReachBottom() { this.loadMore(); },

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

  async onSelectPaper(event: any) {
    const item = event.detail.item as PaperSummary;
    if (item.contentRestricted) {
      return openMembershipOffer();
    }
    const params = [
      `paperId=${encodeURIComponent(item.paperId)}`,
      `releaseId=${encodeURIComponent(item.releaseId)}`,
      `title=${encodeURIComponent(item.title)}`,
      `count=${item.questionCount}`,
      `mode=${this.data.mode}`,
    ].join('&');
    navigation.navigateTo({ url: `/pages/practice-setup/index?${params}` });
  },

  onBack() { navigation.navigateBack(); },
}));
