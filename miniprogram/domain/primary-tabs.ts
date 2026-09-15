export const PRIMARY_TABS = [
  { key: 'home', label: '首页', path: '/pages/home/index', icon: 'home' },
  { key: 'papers', label: '练习', path: '/pages/papers/index', icon: 'normal' },
  { key: 'growth', label: '成长', path: '/pages/growth/index', icon: 'growth' },
  { key: 'profile', label: '我的', path: '/pages/profile/index', icon: 'profile' },
] as const;

type TabBarInstance = {
  setData(data: { selected: number }): void;
};

type PageWithTabBar = {
  getTabBar?: () => TabBarInstance | undefined;
};

export function tabIndexForPath(path: string): number {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return PRIMARY_TABS.findIndex(item => item.path === normalized);
}

export function selectPrimaryTab(page: PageWithTabBar, selected: number): void {
  page.getTabBar?.()?.setData({ selected });
}
