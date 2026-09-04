Component({
  properties: {
    state: { type: String, value: 'local' },
  },
  data: { label: '本地草稿' },
  observers: {
    state(value: string) {
      const labels: Record<string, string> = {
        local: '本地草稿', saving: '正在保存', saved: '已保存', offline: '离线草稿', conflict: '进度冲突',
      };
      this.setData({ label: labels[value] || labels.local });
    },
  },
});
