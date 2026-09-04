import { validateSession } from '../../services/auth';
import { MODE_POLICIES } from '../../domain/mode-policy';
import { getCurrentUser } from '../../services/session';
import { listPublishedPapers } from '../../services/papers';
import {
  enterSession,
  getActiveSessions,
  getExperienceSummary,
  getOverview,
  getRevengeSummary,
} from '../../services/practice';
import { PaperSummary, PracticeMode, PracticeSession } from '../../types/api';

const modes = ['normal', 'challenge', 'scholar', 'revenge'].map(id => MODE_POLICIES[id as PracticeMode]);

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
    modes,
    papers: [] as PaperSummary[],
    activeSession: null as PracticeSession | null,
    overview: {},
    experience: {},
    revenge: {},
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
    this.setData({ displayName: user.display_name || user.username });
    const results = await Promise.allSettled([
      listPublishedPapers(1, 3),
      getOverview(),
      getExperienceSummary(),
      getRevengeSummary(),
      getActiveSessions(),
    ]);
    const paperResult: any = results[0];
    const overviewResult: any = results[1];
    const experienceResult: any = results[2];
    const revengeResult: any = results[3];
    const activeResult: any = results[4];
    this.setData({
      papers: paperResult.status === 'fulfilled' ? paperResult.value.items : [],
      overview: overviewResult.status === 'fulfilled' ? overviewResult.value : {},
      experience: experienceResult.status === 'fulfilled' ? experienceResult.value : {},
      revenge: revengeResult.status === 'fulfilled' ? revengeResult.value : {},
      modes: modes.map(item => item.id === 'revenge' && revengeResult.status === 'fulfilled' && Number(revengeResult.value?.stats?.active || 0) > 0
        ? { ...item, copy: `待处理 ${Number(revengeResult.value.stats.active)} 道，重做后完成变式验证` }
        : item),
      activeSession: activeResult.status === 'fulfilled' ? activeResult.value[0] || null : null,
      loading: false,
    });
  },

  async onContinue() {
    const current = this.data.activeSession;
    if (!current) return;
    try {
      const entered = await enterSession({ sessionId: current.id });
      wx.navigateTo({ url: `/pages/practice/index?sessionId=${encodeURIComponent(entered.session.id)}` });
    } catch (error) {
      wx.showModal({ title: '暂时无法继续', content: error instanceof Error ? error.message : '请稍后重试', showCancel: false });
    }
  },

  onBrowsePapers() { wx.navigateTo({ url: '/pages/papers/index?mode=normal' }); },

  onMode(event: any) {
    const mode = event.currentTarget.dataset.mode as PracticeMode;
    if (mode === 'revenge') {
      wx.navigateTo({ url: '/pages/revenge/index' });
      return;
    }
    wx.navigateTo({ url: `/pages/papers/index?mode=${mode}` });
  },

  onPaper(event: any) {
    const paper = this.data.papers.find((item: PaperSummary) => item.releaseId === event.currentTarget.dataset.releaseId);
    if (!paper) return;
    const params = `paperId=${encodeURIComponent(paper.paperId)}&releaseId=${encodeURIComponent(paper.releaseId)}&title=${encodeURIComponent(paper.title)}&count=${paper.questionCount}&mode=normal`;
    wx.navigateTo({ url: `/pages/practice-setup/index?${params}` });
  },
});
