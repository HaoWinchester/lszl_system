import { PRIMARY_TABS } from '../../domain/primary-tabs';
import { appearanceData, subscribeAppearance } from '../../domain/appearance';

Component({
  options: { styleIsolation: 'apply-shared' },
  data: {
    ...appearanceData(),
    selected: 0,
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
      if (!this.data.tabs[index] || this.data.dialogOpen || index === this.data.selected) return;
      this.setData({ selected: index });
      this.triggerEvent('select', { index });
    },
  },
});

export {};
