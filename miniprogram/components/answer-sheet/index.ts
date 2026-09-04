Component({
  properties: {
    open: { type: Boolean, value: false },
    items: { type: Array, value: [] },
  },
  methods: {
    noop() {},
    onClose() { this.triggerEvent('close'); },
    onSelect(event: any) { this.triggerEvent('select', { index: Number(event.currentTarget.dataset.index) }); },
    onComplete() { this.triggerEvent('complete'); },
  },
});
