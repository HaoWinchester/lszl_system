import { withAppShare } from '../../domain/app-share';
import { navigation, openPaperCatalog } from "../../domain/navigation";
import { withAppearance } from '../../domain/appearance-page';
import { getCurrentUser } from '../../services/session';
import { getMySubscription } from '../../services/subscription';
import { subscriptionView } from '../../domain/subscription-view';
import { messageOf } from '../../services/http';

Page(withAppearance(withAppShare({
  data: {
    statusBarHeight: 24, loading: true, error: '', helpOpen: false, username: '',
    membership: { title: '会员信息', statusLabel: '待确认', expiryLabel: '待确认', description: '' },
  },
  onLoad() { this.setData({ statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24 }); },
  onShow() { return this.loadMembership(); },
  async loadMembership() {
    const user = getCurrentUser();
    if (!user) { navigation.reLaunch({ url: '/pages/login/index' }); return; }
    if (this.fetching) return;
    this.fetching = true;
    this.setData({ loading: true, error: '', username: user.username });
    try {
      const access = await getMySubscription();
      this.setData({ membership: subscriptionView(user.role, access), loading: false });
    } catch (error) {
      this.setData({ error: messageOf(error), loading: false });
    } finally { this.fetching = false; }
  },
  onFreePapers() { openPaperCatalog('normal', { access: 'free' }); },
  onHelp() { this.setData({ helpOpen: !this.data.helpOpen }); },
  onCopyUsername() { wx.setClipboardData({ data: this.data.username, fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }) }); },
  onPreviewSupport() {
    // Native preview needs a filesystem URL, not a bundled image component path.
    const path = `${wx.env.USER_DATA_PATH}/support-qr.jpg`;
    const fail = () => wx.showToast({ title: '图片未打开，请重试', icon: 'none' });
    wx.getFileSystemManager().copyFile({ srcPath: '/assets/support-qr.jpg', destPath: path,
      success: () => wx.previewImage({ current: path, urls: [path], fail }), fail });
  },
  onBack() { navigation.navigateBack({ fallback: '/pages/profile/index' }); },
  onPullDownRefresh() { this.loadMembership().finally(() => wx.stopPullDownRefresh()); },
})));
