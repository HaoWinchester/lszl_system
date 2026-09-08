Component({
  properties: {
    open: { type: Boolean, value: false },
    items: { type: Array, value: [] },
    completeLabel: { type: String, value: '检查并交卷' },
  },
  data: { gridHeight: 96 },
  observers: {
    items(items: any[]) {
      const rows = Math.min(5, Math.max(1, Math.ceil(items.length / 5)));
      this.setData({ gridHeight: rows * 96 + (rows - 1) * 16 });
    },
  },
  methods: {
    noop() {},
    onClose() { this.triggerEvent('close'); },
    onSelect(event: any) { this.triggerEvent('select', { index: Number(event.currentTarget.dataset.index) }); },
    onComplete() { this.triggerEvent('complete'); },
  },
});
