import { navigation } from "../../domain/navigation";
import { withAppearance } from '../../domain/appearance-page';
import { showDialog } from '../../domain/dialog';
import { clearUserDrafts } from '../../domain/draft-store';
import { showLegalDocument } from '../../domain/legal-copy';
import { logout, validateSession } from '../../services/auth';
import { messageOf } from '../../services/http';
import { getExperienceSummary, listSessions } from '../../services/practice';
import { getCurrentUser } from '../../services/session';
import { getMySubscription } from '../../services/subscription';
import { pageRefreshMode } from '../../domain/page-freshness';
import { selectPrimaryTab } from '../../domain/primary-tabs';
import { avatarLetterOf } from '../../domain/profile-view';
import { subscriptionView } from '../../domain/subscription-view';

const roleLabels: Record<string, string> = {
  admin: '管理员', teacher: '教师', student: '学员', viewer: '访客',
};

Page(withAppearance({
  data: {
    statusBarHeight: 24,
    loading: true,
    error: '',
    lastLoadedAt: 0,
    user: {} as any,
    displayName: '同学',
    avatarLetter: '学',
    roleLabel: '学员',
    totalExperience: '—' as number | string,
    weekExperience: '—' as number | string,
    completedCount: '—' as number | string,
    accessTitle: '基础权限',
    accessCopy: '会员信息尚未获取',
    membership: { title: '会员信息', statusLabel: '待确认', expiryLabel: '待确认', description: '会员信息尚未获取' },
    syncLabel: '等待更新',
    syncError: '',
    loggingOut: false,
    loggedOut: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24 });
  },

  onShow() {
    selectPrimaryTab(this as any, 2);
    const mode = pageRefreshMode(this.data.lastLoadedAt);
    if (mode === 'skip') return;
    this.loadProfile({ silent: mode === 'silent' });
  },

  async loadProfile(options: { silent?: boolean } = {}) {
    if (this.data.loggedOut) { this.openLogin(); return; }
    const silent = options.silent === true && this.data.lastLoadedAt > 0;
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const user = await validateSession();
      if (!user) {
        this.openLogin();
        return;
      }
      const [experienceResult, historyResult, accessResult] = await Promise.allSettled([
        getExperienceSummary(), listSessions(), getMySubscription(),
      ]);
      const experience: any = experienceResult.status === 'fulfilled' ? experienceResult.value : {};
      const history: any[] = historyResult.status === 'fulfilled' ? historyResult.value : [];
      const access: any = accessResult.status === 'fulfilled' ? accessResult.value : {};
      const membership = accessResult.status === 'fulfilled' ? subscriptionView(user.role, access) : this.data.membership;
      const partialFailure = [experienceResult, historyResult, accessResult].some(item => item.status === 'rejected');
      const displayName = user.display_name || user.username;
      this.setData({
        user,
        displayName,
        avatarLetter: avatarLetterOf(displayName, user.username),
        roleLabel: roleLabels[user.role] || user.role,
        totalExperience: experienceResult.status === 'fulfilled' ? Number(experience.totalExperience || 0) : this.data.totalExperience,
        weekExperience: experienceResult.status === 'fulfilled' ? Number(experience.weekExperience || 0) : this.data.weekExperience,
        completedCount: historyResult.status === 'fulfilled' ? history.filter(item => item.status === 'completed').length : this.data.completedCount,
        accessTitle: membership.title,
        membership,
        syncLabel: partialFailure ? '部分数据未更新' : '已与网页端同步',
        syncError: partialFailure ? '未更新的项目保留上次数据，可以重新同步。' : '',
        accessCopy: membership.description,
        loading: false,
        error: '',
        lastLoadedAt: Date.now(),
      });
    } catch (error) {
      if (silent) { this.setData({ syncError: messageOf(error), syncLabel: '更新失败' }); return; }
      this.setData({ loading: false, error: messageOf(error) });
    }
  },

  onOpenLegal(event: any) {
    showLegalDocument(event.currentTarget.dataset.document === 'privacy' ? 'privacy' : 'terms');
  },

  onPullDownRefresh() { this.loadProfile({ silent: true }).finally(() => wx.stopPullDownRefresh()); },
  onRefresh() { return this.loadProfile({ silent: true }); },
  onHistory() { navigation.switchTab({ url: '/pages/history/index' }); },
  onMembership() { navigation.navigateTo({ url: '/pages/membership/index' }); },
  onAppearance() { navigation.navigateTo({ url: '/pages/appearance/index' }); },
  onRevenge() { navigation.navigateTo({ url: '/pages/revenge/index' }); },

  async onLogout() {
    if (this.data.loggingOut || this.confirmingLogout) return;
    if (this.data.loggedOut) { this.openLogin(); return; }
    this.confirmingLogout = true;
    const decision = await showDialog({ title: '退出登录', content: '退出后会清理这个账号在本机保存的未同步草稿。', confirmText: '退出', cancelText: '取消' })
      .finally(() => { this.confirmingLogout = false; });
    if (!decision.confirm) return;
    this.setData({ loggingOut: true });
    const username = getCurrentUser()?.username || this.data.user.username || '';
    try {
      await logout();
    } catch {
      // logout() always clears the local session, including on network failure.
    } finally {
      if (username) clearUserDrafts(username);
      this.openLogin();
    }
  },

  openLogin() {
    this.setData({ loggedOut: true, loggingOut: true, loading: false, user: {}, lastLoadedAt: 0, error: '' });
    navigation.reLaunch({ url: '/pages/login/index', fail: () => this.setData({
      loggingOut: false, error: '本机已退出，登录页面未打开，请重试。',
    }) });
  },
}));
