Component({
  properties: {
    title: { type: String, value: '暂无内容' },
    body: { type: String, value: '' },
    actionText: { type: String, value: '' },
  },
  methods: {
    onAction() {
      this.triggerEvent('action');
    },
  },
});
