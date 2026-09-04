export const PRIMARY_TABS = [
  { key: 'home', label: '首页', path: '/pages/home/index', icon: 'home' },
  { key: 'history', label: '记录', path: '/pages/history/index', icon: 'history' },
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
