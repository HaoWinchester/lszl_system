import { navigation } from "../../domain/navigation";
import { withAppearance } from '../../domain/appearance-page';
import { THEMES, READING_SIZES, appearanceData, readAppearance, saveAppearance, updateAppearanceChrome, Appearance } from '../../domain/appearance';

Page(withAppearance({
  data: {
    statusBarHeight: 24,
    themes: THEMES.map(theme => ({ ...theme, style: appearanceData({ theme: theme.id, readingSize: 'standard' }).appearanceStyle })),
    sizes: READING_SIZES,
    saveMessage: '选择后立即应用，并在这台设备上记住。',
    saveError: '',
    // Explicit layout example, not an account record or a real graded practice.
    previewQuestion: {
      id: 'reading-preview', type: 'single_choice',
      stemNodes: [{ name: 'p', children: [{ type: 'text', text: '项目需求发生变化时，项目经理首先应该做什么？' }] }],
      options: [{ id: 'A', text: '评估变更对项目的影响，再按流程处理。' }, { id: 'B', text: '立即调整计划，并通知团队开始执行。' }],
      images: [], analysis: '先评估变更的影响，再按照项目的变更流程作出决定。', correctAnswer: 'A',
    },
    previewSelectedIds: ['A'],
  },
  onLoad() { this.setData({ statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24 }); },
  onBack() { navigation.navigateBack({ fail: () => navigation.switchTab({ url: '/pages/profile/index' }) }); },
  onSelectTheme(event: any) {
    const theme = THEMES.find(item => item.id === event.currentTarget.dataset.id);
    if (theme) this.applyChoice({ ...readAppearance(), theme: theme.id }, `已应用${theme.name}`);
  },
  onSelectSize(event: any) {
    const size = READING_SIZES.find(item => item.id === event.currentTarget.dataset.id);
    if (size) this.applyChoice({ ...readAppearance(), readingSize: size.id }, `已应用${size.name}字号`);
  },
  applyChoice(value: Appearance, label: string) {
    try {
      saveAppearance(value);
      updateAppearanceChrome(value);
      this.setData({ saveError: '', saveMessage: `${label}，已在本机记住。` });
    } catch {
      this.setData({ saveError: '设置未能保存，已保留原样。请再次选择重试。' });
    }
  },
}));
