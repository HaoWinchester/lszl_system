import { navigation } from './navigation';

// Keep the four existing page implementations mounted in one native page.
// Only the visible panel receives page-show/refresh events; its state survives tab changes.
export function withPrimaryPanel(key: string, page: any) {
  const { data, onLoad, onShow, onHide, onUnload, ...members } = page;
  const methods = Object.fromEntries(Object.entries(members).filter(([, value]) => typeof value === 'function'));
  const initialState = Object.fromEntries(Object.entries(members).filter(([, value]) => typeof value !== 'function'));
  const enter = (panel: any) => {
    if (!panel.properties.active || panel.panelVisible || panel.panelPageHidden) return;
    if (!panel.panelInitialized) {
      Object.assign(panel, initialState);
      panel.panelInitialized = true;
      page.onLoad?.call(panel, {});
    }
    panel.panelVisible = true;
    page.onShow?.call(panel);
  };
  const leave = (panel: any) => {
    if (!panel.panelVisible) return;
    panel.panelVisible = false;
    page.onHide?.call(panel);
  };
  return {
    options: { styleIsolation: 'apply-shared' },
    properties: { active: { type: Boolean, value: false } },
    data,
    observers: {
      active(value: boolean) {
        if (!this.panelAttached) return;
        if (value) enter(this); else leave(this);
      },
    },
    lifetimes: {
      attached() { this.panelAttached = true; enter(this); },
      detached() { leave(this); if (this.panelInitialized) onUnload?.call(this); },
    },
    pageLifetimes: { show() { this.panelPageHidden = false; enter(this); }, hide() { this.panelPageHidden = true; leave(this); } },
    methods: {
      ...methods,
      getTabBar() { return getCurrentPages().slice(-1)[0]?.getTabBar?.(); },
      // Preserve old direct-entry URLs while routing them to the shared host.
      onLoad() { navigation.reLaunch({ url: `/pages/tabs/index?tab=${key}` }); },
    },
  };
}
