import { validateSession } from '../../services/auth';
import { getCurrentUser } from '../../services/session';

function greetingFor(hour: number): string {
  if (hour < 11) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

Page({
  data: {
    statusBarHeight: 24,
    loading: true,
    displayName: '同学',
    greeting: '你好',
    todayLabel: '',
  },

  async onLoad() {
    const now = new Date();
    const cached = getCurrentUser();
    this.setData({
      statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24,
      displayName: cached?.display_name || cached?.username || '同学',
      greeting: greetingFor(now.getHours()),
      todayLabel: `${now.getMonth() + 1}月${now.getDate()}日`,
    });
    const user = await validateSession();
    if (!user) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    this.setData({
      displayName: user.display_name || user.username,
      loading: false,
    });
  },
});
