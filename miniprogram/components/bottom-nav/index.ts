import type { PracticeMode } from '../../types/api';

const routes: Record<string, string> = {
  home: '/pages/home/index',
  history: '/pages/history/index',
  profile: '/pages/profile/index',
};

Component({
  properties: { current: { type: String, value: 'home' } },
  methods: {
    navigate(event: any) {
      const target = String(event.currentTarget.dataset.target || '');
      if (!routes[target] || target === this.data.current) return;
      wx.reLaunch({ url: routes[target] });
    },
  },
});

export {};
