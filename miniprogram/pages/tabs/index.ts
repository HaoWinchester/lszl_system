import { withAppShare } from '../../domain/app-share';
import { withAppearance } from '../../domain/appearance-page';
import { PRIMARY_TABS } from '../../domain/primary-tabs';

Page(withAppearance(withAppShare({
  data: { activeTab: 0 },
  scrollPositions: {} as Record<number, number>,
  onLoad(query: Record<string, string> = {}) {
    this.scrollPositions = {};
    this.scrollRevision = 0;
    this.hostHidden = false;
    this.restoringScroll = false;
    const index = PRIMARY_TABS.findIndex(tab => tab.key === query.tab);
    this.setData({ activeTab: index < 0 ? 0 : index });
  },
  getTabBar() { return this.selectComponent('#primary-tab-bar'); },
  onReady() { this.getTabBar()?.setData({ selected: this.data.activeTab }); },
  onHide() { this.hostHidden = true; this.scrollRevision++; },
  onShow() {
    if (!this.hostHidden) return;
    this.hostHidden = false;
    this.restoreTabScroll(this.data.activeTab, ++this.scrollRevision);
  },
  restoreTabScroll(index: number, revision: number) {
    if (this.hostHidden || revision !== this.scrollRevision || index !== this.data.activeTab) return;
    this.restoringScroll = true;
    wx.pageScrollTo({
      scrollTop: this.scrollPositions[index] || 0, duration: 0,
      complete: () => {
        if (revision === this.scrollRevision) this.restoringScroll = false;
      },
    });
  },
  switchPrimaryTab(index: number) {
    if (!Number.isInteger(index) || !PRIMARY_TABS[index] || index === this.data.activeTab) return;
    const revision = ++this.scrollRevision;
    this.restoringScroll = true;
    this.setData({ activeTab: index }, () => {
      this.restoreTabScroll(index, revision);
    });
    this.getTabBar()?.setData({ selected: index });
  },
  onSelectTab(event: any) { this.switchPrimaryTab(Number(event.detail.index)); },
  onPageScroll(event: { scrollTop: number }) {
    if (!this.hostHidden && !this.restoringScroll) this.scrollPositions[this.data.activeTab] = event.scrollTop;
  },
  onPullDownRefresh() {
    const panel = this.selectComponent(`#panel-${this.data.activeTab}`);
    if (panel?.onPullDownRefresh) panel.onPullDownRefresh();
    else wx.stopPullDownRefresh();
  },
  onReachBottom() { this.selectComponent(`#panel-${this.data.activeTab}`)?.onReachBottom?.(); },
})));
