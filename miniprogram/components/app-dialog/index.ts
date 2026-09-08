import { createDialogController, DialogOptions } from '../../domain/dialog';

Component({
  data: {
    visible: false, id: 0, title: '', content: '', showCancel: true,
    confirmText: '确定', cancelText: '取消',
  },
  lifetimes: {
    attached() {
      this.controller = createDialogController(view => {
        this.setData(view);
        this.tabBar?.setData({ dialogOpen: view.visible });
      });
    },
    detached() { this.controller?.dismiss(); },
  },
  pageLifetimes: {
    hide() { this.controller?.dismiss(); },
  },
  methods: {
    show(options: DialogOptions) {
      const pages = getCurrentPages();
      this.tabBar = pages[pages.length - 1]?.getTabBar?.();
      return this.controller.open(options);
    },
    onConfirm(event: any) { this.controller.settle(Number(event.currentTarget.dataset.id), true); },
    onCancel(event: any) { this.controller.settle(Number(event.currentTarget.dataset.id), false); },
    noop() {},
  },
});
