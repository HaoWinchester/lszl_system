export interface DialogOptions {
  title: string;
  content?: string;
  showCancel?: boolean;
  confirmText?: string;
  cancelText?: string;
}

export interface DialogResult {
  confirm: boolean;
  cancel: boolean;
  dismissed: boolean;
}

interface DialogView {
  visible: boolean;
  id: number;
  title: string;
  content: string;
  showCancel: boolean;
  confirmText: string;
  cancelText: string;
}

const dismissed = (): DialogResult => ({ confirm: false, cancel: false, dismissed: true });

export function createDialogController(render: (view: DialogView) => void) {
  let sequence = 0;
  const queue: { view: DialogView; resolve: (result: DialogResult) => void }[] = [];
  const paint = () => render(queue[0]?.view || {
    visible: false, id: 0, title: '', content: '', showCancel: false, confirmText: '', cancelText: '',
  });
  return {
    open(options: DialogOptions): Promise<DialogResult> {
      return new Promise(resolve => {
        const showCancel = options.showCancel !== false;
        queue.push({ resolve, view: {
          visible: true, id: ++sequence, title: options.title, content: options.content || '', showCancel,
          confirmText: options.confirmText || (showCancel ? '确定' : '知道了'),
          cancelText: options.cancelText || '取消',
        } });
        if (queue.length === 1) paint();
      });
    },
    settle(id: number, confirm: boolean) {
      const active = queue[0];
      if (!active || active.view.id !== id || (!confirm && !active.view.showCancel)) return;
      queue.shift();
      paint();
      active.resolve({ confirm, cancel: !confirm, dismissed: false });
    },
    dismiss() {
      const pending = queue.splice(0);
      paint();
      pending.forEach(item => item.resolve(dismissed()));
    },
  };
}

export function showDialog(options: DialogOptions): Promise<DialogResult> {
  const pages = getCurrentPages();
  const host = pages[pages.length - 1]?.selectComponent?.('#app-dialog');
  if (!host) {
    wx.showToast({ title: '页面尚未就绪，请重试', icon: 'none' });
    return Promise.resolve(dismissed());
  }
  return host.show(options);
}
