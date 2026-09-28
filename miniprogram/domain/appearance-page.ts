import { usageShow, usageHide, usageTouch } from '../services/feature-usage';
import { Appearance, appearanceData, readAppearance, subscribeAppearance, updateAppearanceChrome } from './appearance';

// One lifecycle adapter keeps every page, its dialogs and the separate tab layer in sync.
export function withAppearance(options: any) {
  const apply = (page: any, value: Appearance) => {
    const data = appearanceData(value);
    // Native custom headers share one safe-area inset on every mounted page.
    data.appearanceStyle += `--status-bar-height:${page.data.statusBarHeight ?? 24}px;`;
    if (page.data.appearanceStyle !== data.appearanceStyle) page.setData(data);
    const tab = page.getTabBar?.();
    if (tab && tab.data?.appearanceStyle !== data.appearanceStyle) tab.setData(data);
  };
  return {
    ...Object.fromEntries(Object.entries(options).map(([name, value]) => [name,
      typeof value === 'function' && /^on/.test(name) && !['onLoad','onShow','onHide','onUnload','onReady','onPageScroll'].includes(name)
        ? function(this: any, ...args: any[]) {
          usageTouch(this);
          try { return (value as Function).apply(this, args); }
          finally { usageTouch(this); } // Flush category changes made by synchronous UI handlers now.
        }
        : value])),
    data: { ...options.data, ...appearanceData() },
    onLoad(this: any, query: any) {
      apply(this, readAppearance());
      this.stopAppearance = subscribeAppearance(value => apply(this, value));
      return options.onLoad?.call(this, query);
    },
    onShow(this: any) {
      usageShow(this);
      apply(this, readAppearance());
      const theme = readAppearance().theme;
      if (this.appliedChromeTheme !== theme) {
        updateAppearanceChrome();
        this.appliedChromeTheme = theme;
      }
      return options.onShow?.call(this);
    },
    onPageScroll(this: any, event: any) {
      usageTouch(this);
      return options.onPageScroll?.call(this, event);
    },
    onHide(this: any) {
      usageHide(this);
      return options.onHide?.call(this);
    },
    onUnload(this: any) {
      usageHide(this);
      this.stopAppearance?.();
      return options.onUnload?.call(this);
    },
  };
}
