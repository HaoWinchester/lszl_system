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
  navigateBack(options: { fail?: () => void; fallback?: string } = {}) {
    const fail = () => options.fail ? options.fail() : navigation.switchTab({ url: options.fallback || '/pages/home/index' });
    try { wx.navigateBack({ fail }); } catch { fail(); }
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
