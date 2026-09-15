type NavigationOptions = {
  url: string;
  success?: (result?: any) => void;
  fail?: (error?: any) => void;
  complete?: (result?: any) => void;
};

// Share navigation failures across pages; never silently leave a control inert.
function move(method: 'navigateTo' | 'redirectTo' | 'switchTab' | 'reLaunch', options: NavigationOptions) {
  const fail = (error: any) => {
    if (options.fail) options.fail(error);
    else wx.showToast({ title: '页面未打开，请返回后重试', icon: 'none' });
  };
  try { wx[method]({ ...options, fail }); }
  catch (error) { fail(error); options.complete?.(error); }
}

export const navigation = {
  navigateTo: (options: NavigationOptions) => move('navigateTo', options),
  redirectTo: (options: NavigationOptions) => move('redirectTo', options),
  switchTab: (options: NavigationOptions) => move('switchTab', options),
  reLaunch: (options: NavigationOptions) => move('reLaunch', options),
  navigateBack(options: { fail?: () => void; fallback?: string; delta?: number } = {}) {
    const fail = () => options.fail ? options.fail() : navigation.switchTab({ url: options.fallback || '/pages/home/index' });
    try { wx.navigateBack({ delta: options.delta || 1, fail }); } catch { fail(); }
  },
};

// switchTab cannot carry query strings. Keep only a one-shot UI route intent;
// never store account or practice records here. Consume on catalog onShow.
let pendingPaperMode: string | null = null;
export function openPaperCatalog(mode = 'normal') {
  pendingPaperMode = ['normal', 'challenge', 'scholar'].includes(mode) ? mode : 'normal';
  navigation.switchTab({ url: '/pages/papers/index', fail: () => {
    pendingPaperMode = null;
    wx.showToast({ title: '练习页未打开，请重试', icon: 'none' });
  } });
}
export function consumePaperMode(): string | null {
  const mode = pendingPaperMode;
  pendingPaperMode = null;
  return mode;
}

// Reuse an existing secondary page instead of multiplying its stack frames.
export function returnToPage(path: string) {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const route = path.replace(/^\//, '');
  const fallback = () => navigation.redirectTo({ url: path });
  for (let index = pages.length - 2; index >= 0; index--) {
    if (pages[index].route === route) {
      navigation.navigateBack({ delta: pages.length - 1 - index, fail: fallback });
      return;
    }
  }
  fallback();
}
