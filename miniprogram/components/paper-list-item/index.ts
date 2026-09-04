Component({
  properties: {
    item: { type: Object, value: {} },
    progressText: { type: String, value: '' },
  },
  methods: {
    onSelect() {
      this.triggerEvent('select', { item: this.data.item });
    },
  },
});
