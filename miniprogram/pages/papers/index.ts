import { withPrimaryPanel } from '../../domain/primary-panel';
import { pageRefreshMode } from '../../domain/page-freshness';
import { selectPrimaryTab } from '../../domain/primary-tabs';
import { MODE_POLICIES } from '../../domain/mode-policy';
import { navigation, consumePaperMode, consumePaperOptions } from "../../domain/navigation";
import { withAppearance } from '../../domain/appearance-page';
import { messageOf } from '../../services/http';
import { listPublishedPapers } from '../../services/papers';
import { PaperSummary, PracticeMode } from '../../types/api';
import { openMembershipOffer } from '../../domain/membership-navigation';

function filteredPapers(items: PaperSummary[], subject: string, access: string, search: string): PaperSummary[] {
  return items.filter(item =>
    (!search.trim() || `${item.title} ${item.subject} ${item.description || ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    && (subject === '全部科目' || item.subject === subject)
    && (access === 'all' || item.accessLevel === access),
  );
}

Component(withPrimaryPanel('papers', withAppearance({
  fetching: false,
  data: {
    statusBarHeight: 24,
    loading: true,
    error: '',
    refreshError: '',
    lastLoadedAt: 0,
    papers: [] as PaperSummary[],
    filtered: [] as PaperSummary[],
    subjects: ['全部科目'],
    subject: '全部科目',
    access: 'all',
    mode: 'normal' as PracticeMode,
    search: '',
    quick: false,
    modes: ['normal', 'challenge', 'scholar', 'revenge'].map(id => MODE_POLICIES[id as PracticeMode]),
    skeletonRows: [0, 1, 2],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
    moreError: '',
  },

  onLoad(query: Record<string, string> = {}) {
    this.setData({
      statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24,
      mode: (['normal', 'challenge', 'scholar'].includes(query.mode) ? query.mode : 'normal') as PracticeMode,
    });
    this.loadPapers();
  },

  onShow() {
    selectPrimaryTab(this as any, 1);
    const mode = consumePaperMode();
    if (mode) this.setData({ mode: mode as PracticeMode });
    const options = consumePaperOptions();
    if (options) {
      this.setData({ quick: options.quick === true, ...(options.access ? { access: options.access, search: '', subject: '全部科目' } : {}) });
      this.applyFilters();
    }
    if (pageRefreshMode(this.data.lastLoadedAt) !== 'skip') return this.loadPapers();
  },

  onSearch(event: any) { this.setData({ search: String(event.detail.value || '') }); this.applyFilters(); },
  onMode(event: any) {
    const mode = event.currentTarget.dataset.mode;
    if (mode === 'revenge') { navigation.navigateTo({ url: '/pages/revenge/index' }); return; }
    if (['normal', 'challenge', 'scholar'].includes(mode)) this.setData({ mode, quick: false });
  },

  onPullDownRefresh() {
    this.loadPapers().finally(() => wx.stopPullDownRefresh());
  },

  async loadPapers() {
    if (this.fetching) return;
    this.fetching = true;
    this.setData({ loading: this.data.lastLoadedAt === 0, error: '', refreshError: '' });
    try {
      const { items, total = items.length } = await listPublishedPapers(1, 100);
      const subjects = ['全部科目', ...Array.from(new Set(items.map(item => item.subject)))];
      this.setData({ papers: items, subjects, loading: false, lastLoadedAt: Date.now(), refreshError: '', page: 1, total, hasMore: items.length < total, moreError: '' });
      this.applyFilters();
    } catch (error) {
      if (this.data.lastLoadedAt) this.setData({ loading: false, refreshError: messageOf(error) });
      else this.setData({ loading: false, error: messageOf(error), filtered: [] });
    } finally {
      this.fetching = false;
    }
  },

  async loadMore() {
    if (this.fetching || this.data.refreshError || !this.data.hasMore) return;
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
      filtered: filteredPapers(this.data.papers, this.data.subject, this.data.access, this.data.search),
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
    if (this.fetching || this.data.refreshError) {
      wx.showToast({ title: this.fetching ? '试卷权限更新中，请稍候' : '请先重试更新试卷权限', icon: 'none' });
      return;
    }
    const item = event.detail.item as PaperSummary;
    if (item.contentRestricted) {
      return openMembershipOffer();
    }
    const params = [
      `paperId=${encodeURIComponent(item.paperId)}`,
      `releaseId=${encodeURIComponent(item.releaseId)}`,
      `title=${encodeURIComponent(item.title)}`,
      `count=${item.questionCount}`,
      ...(this.data.quick ? ['quick=1'] : []),
      `mode=${this.data.mode}`,
    ].join('&');
    navigation.navigateTo({ url: `/pages/practice-setup/index?${params}` });
  },

  onFullPractice() { this.setData({ quick: false }); },

  onBack() { navigation.navigateBack(); },
})));
