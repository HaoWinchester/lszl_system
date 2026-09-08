import { Appearance, appearanceData, readAppearance, subscribeAppearance, updateAppearanceChrome } from './appearance';

// One lifecycle adapter keeps every page, its dialogs and the separate tab layer in sync.
export function withAppearance(options: any) {
  const apply = (page: any, value: Appearance) => {
    const data = appearanceData(value);
    page.setData(data);
    page.getTabBar?.()?.setData(data);
  };
  return {
    ...options,
    data: { ...options.data, ...appearanceData() },
    onLoad(this: any, query: any) {
      apply(this, readAppearance());
      this.stopAppearance = subscribeAppearance(value => apply(this, value));
      return options.onLoad?.call(this, query);
    },
    onShow(this: any) {
      apply(this, readAppearance());
      updateAppearanceChrome();
      return options.onShow?.call(this);
    },
    onUnload(this: any) {
      this.stopAppearance?.();
      return options.onUnload?.call(this);
    },
  };
}
