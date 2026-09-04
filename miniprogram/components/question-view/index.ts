Component({
  properties: {
    question: { type: Object, value: {} },
    selectedIds: { type: Array, value: [] },
    submitted: { type: Boolean, value: false },
    showAnalysis: { type: Boolean, value: false },
  },
  data: { displayQuestion: { images: [], options: [] }, displayOptions: [] },
  observers: {
    'question, selectedIds'(question: any, selectedIds: string[]) {
      const selected = new Set((selectedIds || []).map(String));
      const safeQuestion = question && typeof question === 'object' ? question : { images: [], options: [] };
      this.setData({
        displayQuestion: { ...safeQuestion, images: safeQuestion.images || [], options: safeQuestion.options || [] },
        displayOptions: (safeQuestion.options || []).map((option: any) => ({ ...option, selected: selected.has(String(option.id)) })),
      });
    },
  },
  methods: {
    onChoose(event: any) {
      this.triggerEvent('change', { optionId: String(event.currentTarget.dataset.id || '') });
    },
    previewImage(event: any) {
      const current = String(event.currentTarget.dataset.src || '');
      if (!current) return;
      wx.previewImage({ current, urls: this.data.displayQuestion.images || [current] });
    },
  },
});
