import { navigation } from "../../domain/navigation";
import { withAppearance } from '../../domain/appearance-page';
import { getCurrentUser } from '../../services/session';
import { getMySubscription } from '../../services/subscription';
import { subscriptionView } from '../../domain/subscription-view';
import { messageOf } from '../../services/http';

Page(withAppearance({
  data: {
    statusBarHeight: 24, loading: true, error: '',
    membership: { title: '会员信息', statusLabel: '待确认', expiryLabel: '待确认', description: '' },
  },
  onLoad() { this.setData({ statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24 }); },
  onShow() { return this.loadMembership(); },
  async loadMembership() {
    const user = getCurrentUser();
    if (!user) { navigation.reLaunch({ url: '/pages/login/index' }); return; }
    if (this.fetching) return;
    this.fetching = true;
    this.setData({ loading: true, error: '' });
    try {
      const access = await getMySubscription();
      this.setData({ membership: subscriptionView(user.role, access), loading: false });
    } catch (error) {
      this.setData({ error: messageOf(error), loading: false });
    } finally { this.fetching = false; }
  },
  onBack() { navigation.navigateBack({ fallback: '/pages/profile/index' }); },
  onPullDownRefresh() { this.loadMembership().finally(() => wx.stopPullDownRefresh()); },
}));
