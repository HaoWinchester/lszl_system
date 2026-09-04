import { clearUserDrafts } from '../../domain/draft-store';
import { showLegalDocument } from '../../domain/legal-copy';
import { logout, validateSession } from '../../services/auth';
import { messageOf } from '../../services/http';
import { getExperienceSummary, listSessions } from '../../services/practice';
import { getCurrentUser } from '../../services/session';
import { getMySubscription } from '../../services/subscription';
import { selectPrimaryTab } from '../../domain/primary-tabs';

const roleLabels: Record<string, string> = {
  admin: '管理员', teacher: '教师', student: '学员', viewer: '访客',
};

const planLabels: Record<string, string> = {
  free: '基础权限', monthly: '月度会员', quarterly: '季度会员', half_year: '半年会员', lifetime: '终身会员',
};

function dateLabel(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `有效期至 ${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

Page({
  data: {
    statusBarHeight: 24,
    loading: true,
    error: '',
    user: {} as any,
    displayName: '同学',
    roleLabel: '学员',
    totalExperience: 0,
    weekExperience: 0,
    completedCount: 0,
    accessTitle: '基础权限',
    accessCopy: '会员试卷需在网页端开通',
    loggingOut: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24 });
  },

  onShow() {
    selectPrimaryTab(this as any, 2);
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ loading: true, error: '' });
    try {
      const user = await validateSession();
      if (!user) {
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      const [experienceResult, historyResult, accessResult] = await Promise.allSettled([
        getExperienceSummary(), listSessions(), getMySubscription(),
      ]);
      const experience: any = experienceResult.status === 'fulfilled' ? experienceResult.value : {};
      const history: any[] = historyResult.status === 'fulfilled' ? historyResult.value : [];
      const access: any = accessResult.status === 'fulfilled' ? accessResult.value : {};
      const entitled = access.entitlements?.allExamPapers === true;
      const planId = String(access.subscription?.planId || 'free');
      const privileged = ['admin', 'teacher'].includes(user.role);
      this.setData({
        user,
        displayName: user.display_name || user.username,
        roleLabel: roleLabels[user.role] || user.role,
        totalExperience: Number(experience.totalExperience || 0),
        weekExperience: Number(experience.weekExperience || 0),
        completedCount: history.filter(item => item.status === 'completed').length,
        accessTitle: privileged ? '教学账号' : planLabels[planId] || planId,
        accessCopy: privileged || entitled
          ? `${privileged ? '已开放全部试卷' : '已开放会员试卷'}${dateLabel(access.subscription?.expiresAt) ? ` · ${dateLabel(access.subscription.expiresAt)}` : ''}`
          : '可使用免费试卷；会员权限请在网页端开通',
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false, error: messageOf(error) });
    }
  },

  onOpenLegal(event: any) {
    showLegalDocument(event.currentTarget.dataset.document === 'privacy' ? 'privacy' : 'terms');
  },

  async onLogout() {
    if (this.data.loggingOut) return;
    const decision = await wx.showModal({ title: '退出登录', content: '退出后会清理这个账号在本机保存的未同步草稿。', confirmText: '退出', cancelText: '取消' });
    if (!decision.confirm) return;
    this.setData({ loggingOut: true });
    const username = getCurrentUser()?.username || this.data.user.username || '';
    try {
      await logout();
    } finally {
      if (username) clearUserDrafts(username);
      wx.reLaunch({ url: '/pages/login/index' });
    }
  },
});
