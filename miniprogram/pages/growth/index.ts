import { withAppShare } from '../../domain/app-share';
import { pageRefreshMode } from '../../domain/page-freshness';
import { withPrimaryPanel } from '../../domain/primary-panel';
import { navigation, openPaperCatalog } from '../../domain/navigation';
import { withAppearance } from '../../domain/appearance-page';
import { selectPrimaryTab } from '../../domain/primary-tabs';
import { growthView, GROWTH_GOALS } from '../../domain/growth-view';
import { validateSession } from '../../services/auth';
import { messageOf } from '../../services/http';
import { getGrowthSummary, updateGrowthGoal, GrowthSummary } from '../../services/growth';

Component(withPrimaryPanel('growth', withAppearance(withAppShare({
  fetching: false,
  data: {
    statusBarHeight: 24, lastLoadedAt: 0, loading: true, error: '', goalError: '', saving: false,
    summary: null as GrowthSummary | null, view: null as ReturnType<typeof growthView> | null,
    goals: GROWTH_GOALS, selectedGoal: 10, savedNotice: '',
  },
  onLoad() { this.setData({ statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24 }); },
  onShow() { selectPrimaryTab(this as any, 2); if (pageRefreshMode(this.data.lastLoadedAt) !== 'skip') void this.loadGrowth(); },
  onPullDownRefresh() { this.loadGrowth().finally(() => wx.stopPullDownRefresh()); },
  async loadGrowth() {
    if (this.fetching || this.data.saving) return;
    this.fetching = true;
    this.setData({ loading: !this.data.summary, error: '' });
    try {
      if (!await validateSession()) { navigation.reLaunch({ url: '/pages/login/index' }); return; }
      const summary = await getGrowthSummary();
      this.setData({ summary, view: growthView(summary), selectedGoal: summary.configuredGoal, goalError: '', savedNotice: '', lastLoadedAt: Date.now() });
    } catch (error) { this.setData({ error: messageOf(error) }); }
    finally { this.fetching = false; this.setData({ loading: false }); }
  },
  onGoal(event: any) {
    const goal = Number(event.currentTarget.dataset.goal);
    if (this.data.saving || !GROWTH_GOALS.includes(goal)) return;
    this.setData({ selectedGoal: goal, goalError: '', savedNotice: '' });
  },
  async onSaveGoal() {
    const goal = this.data.selectedGoal;
    if (!this.data.summary || this.data.saving || this.fetching || !GROWTH_GOALS.includes(goal) || goal === this.data.summary.configuredGoal) return;
    this.setData({ saving: true, goalError: '', savedNotice: '' });
    try {
      const summary = await updateGrowthGoal(goal);
      this.setData({ summary, view: growthView(summary), selectedGoal: summary.configuredGoal, savedNotice: '目标已保存' });
    } catch (error) { this.setData({ goalError: messageOf(error) }); }
    finally { this.setData({ saving: false }); }
  },
  onPractice() { openPaperCatalog('normal'); },
  onHistory() { navigation.navigateTo({ url: '/pages/history/index' }); },
}))));
