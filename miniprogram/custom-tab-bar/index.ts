import { PRIMARY_TABS } from '../domain/primary-tabs';

Component({
  data: {
    selected: 0,
    switching: false,
    tabs: PRIMARY_TABS,
  },

  methods: {
    switchTab(event: any) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab || this.data.switching || index === this.data.selected) return;

      const previous = this.data.selected;
      this.setData({ selected: index, switching: true });
      wx.switchTab({
        url: tab.path,
        fail: () => this.setData({ selected: previous }),
        complete: () => this.setData({ switching: false }),
      });
    },
  },
});

export {};
