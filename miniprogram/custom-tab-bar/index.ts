import { PRIMARY_TABS } from '../domain/primary-tabs';
import { navigation } from '../domain/navigation';
import { appearanceData, subscribeAppearance } from '../domain/appearance';

Component({
  data: {
    ...appearanceData(),
    selected: 0,
    switching: false,
    dialogOpen: false,
    tabs: PRIMARY_TABS,
  },

  lifetimes: {
    attached() {
      this.setData(appearanceData());
      this.stopAppearance = subscribeAppearance(value => this.setData(appearanceData(value)));
    },
    detached() { this.stopAppearance?.(); },
  },
  methods: {
    noop() {},
    switchTab(event: any) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab || this.data.dialogOpen || this.data.switching || index === this.data.selected) return;

      const previous = this.data.selected;
      this.setData({ selected: index, switching: true });
      navigation.switchTab({
        url: tab.path,
        fail: () => {
          this.setData({ selected: previous });
          wx.showToast({ title: '页面未切换，请重试', icon: 'none' });
        },
        complete: () => this.setData({ switching: false }),
      });
    },
  },
});

export {};
