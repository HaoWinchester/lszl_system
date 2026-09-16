import { withPrimaryPanel } from '../../domain/primary-panel';
import { getGrowthSummary, GrowthSummary } from '../../services/growth';
import { growthView } from '../../domain/growth-view';
import { navigation, openPaperCatalog } from "../../domain/navigation";
import { withAppearance } from '../../domain/appearance-page';
import { showDialog } from '../../domain/dialog';
import { validateSession } from '../../services/auth';
import { getCurrentUser } from '../../services/session';
import { listPublishedPapers } from '../../services/papers';
import {
  getSession,
  getActiveSessions,
  getRevengeSummary,
} from '../../services/practice';
import { PaperSummary, PracticeMode, PracticeSessionSummary } from '../../types/api';
import { selectPrimaryTab } from '../../domain/primary-tabs';
import { pageRefreshMode } from '../../domain/page-freshness';
import { messageOf } from '../../services/http';
import { openMembershipOffer } from '../../domain/membership-navigation';

function greetingFor(hour: number): string {
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

Component(withPrimaryPanel('home', withAppearance({
  refreshing: false,
  data: {
    statusBarHeight: 24,
    loading: true,
    error: '',
    lastLoadedAt: 0,
    continuing: false,
    summary: null as GrowthSummary | null,
    growth: null as ReturnType<typeof growthView> | null,
    growthError: '',
    revengeCount: '—' as number | string,
    displayName: '同学',
    greeting: '你好',
    todayLabel: '',
    papers: [] as PaperSummary[],
    activeSession: null as PracticeSessionSummary | null,
  },

  onLoad() {
    const now = new Date();
    const cached = getCurrentUser();
    this.setData({
      statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24,
      displayName: cached?.display_name || cached?.username || '同学',
      greeting: greetingFor(now.getHours()),
      todayLabel: `${now.getMonth() + 1}月${now.getDate()}日`,
    });
  },

  async loadHome() {
    if (this.refreshing) return;
    this.refreshing = true;
    if (!this.data.lastLoadedAt) this.setData({ loading: true });
    this.setData({ error: '' });
    try {
      const user = await validateSession();
      if (!user) {
        navigation.reLaunch({ url: '/pages/login/index' });
        return;
      }
      this.setData({ displayName: user.display_name || user.username });
      const results = await Promise.allSettled([
        listPublishedPapers(1, 3),
        getRevengeSummary(),
        getActiveSessions(),
        getGrowthSummary(),
      ]);
      const paperResult: any = results[0];
      const revengeResult: any = results[1];
      const activeResult: any = results[2];
      const growthResult: any = results[3];
      this.setData({
        summary: growthResult.status === 'fulfilled' ? growthResult.value : this.data.summary,
        growth: growthResult.status === 'fulfilled' ? growthView(growthResult.value) : this.data.growth,
        growthError: growthResult.status === 'rejected' ? messageOf(growthResult.reason) : '',
        revengeCount: revengeResult.status === 'fulfilled' ? Number(revengeResult.value?.stats?.active || 0) : this.data.revengeCount,
        papers: paperResult.status === 'fulfilled' ? paperResult.value.items : this.data.papers,
        activeSession: activeResult.status === 'fulfilled' ? activeResult.value[0] || null : this.data.activeSession,
        loading: false,
        lastLoadedAt: Date.now(),
        error: results.slice(0, 3).some(item => item.status === 'rejected') ? '部分数据未更新，请重试。' : '',
      });
    } catch (error) {
      this.setData({ loading: false, error: messageOf(error) });
    } finally {
      this.refreshing = false;
    }
  },

  onShow() {
    selectPrimaryTab(this as any, 0);
    if (pageRefreshMode(this.data.lastLoadedAt) !== 'skip') void this.loadHome();
  },

  onPullDownRefresh() { this.loadHome().finally(() => wx.stopPullDownRefresh()); },

  async onContinue() {
    const current = this.data.activeSession;
    if (!current || this.data.continuing) return;
    this.setData({ continuing: true });
    try {
      const session = await getSession(current.id);
      if (session.status === 'abandoned') { await this.loadHome(); return; }
      const page = session.status === 'completed' ? 'result' : 'practice';
      navigation.navigateTo({ url: `/pages/${page}/index?sessionId=${encodeURIComponent(session.id)}` });
    } catch (error) {
      showDialog({ title: '暂时无法继续', content: error instanceof Error ? error.message : '请稍后重试', showCancel: false });
    } finally {
      this.setData({ continuing: false });
    }
  },

  onQuickPractice() { openPaperCatalog('normal', { access: 'free', quick: true }); },

  onBrowsePapers() { openPaperCatalog('normal'); },

  onMode(event: any) {
    const mode = event.currentTarget.dataset.mode as PracticeMode;
    if (mode === 'revenge') {
      navigation.navigateTo({ url: '/pages/revenge/index' });
      return;
    }
    openPaperCatalog(mode);
  },

  onGrowth() { navigation.switchTab({ url: '/pages/growth/index' }); },

  async onPaper(event: any) {
    const paper = this.data.papers.find((item: PaperSummary) => item.releaseId === event.currentTarget.dataset.releaseId);
    if (!paper) return;
    if (paper.contentRestricted) {
      return openMembershipOffer();
    }
    const params = `paperId=${encodeURIComponent(paper.paperId)}&releaseId=${encodeURIComponent(paper.releaseId)}&title=${encodeURIComponent(paper.title)}&count=${paper.questionCount}&mode=normal`;
    navigation.navigateTo({ url: `/pages/practice-setup/index?${params}` });
  },
})));
