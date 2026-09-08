Component({
  properties: {
    question: { type: Object, value: {} },
    selectedIds: { type: Array, value: [] },
    submitted: { type: Boolean, value: false },
    showAnalysis: { type: Boolean, value: false },
    showResult: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
  },
  data: { displayQuestion: { images: [], options: [] }, displayOptions: [], answerLabel: '', selectedLabel: '', outcome: '' },
  observers: {
    'question, selectedIds, showAnalysis, showResult'(question: any, selectedIds: string[], showAnalysis: boolean, showResult: boolean) {
      const selected = new Set((selectedIds || []).map(String));
      const safeQuestion = question && typeof question === 'object' ? question : { images: [], options: [] };
      const reveal = showAnalysis || showResult;
      const correctIds = reveal ? (safeQuestion.correctOptionIds?.length ? safeQuestion.correctOptionIds : safeQuestion.correctAnswer ? [safeQuestion.correctAnswer] : []).map(String) : [];
      const correct = new Set(correctIds);
      this.setData({
        displayQuestion: { ...safeQuestion, images: safeQuestion.images || [], options: safeQuestion.options || [] },
        displayOptions: (safeQuestion.options || []).map((option: any) => ({
          ...option, selected: selected.has(String(option.id)),
          verdict: !reveal || !correct.size ? '' : correct.has(String(option.id)) ? 'correct' : selected.has(String(option.id)) ? 'wrong' : '',
        })),
        answerLabel: correctIds.join('、') || '请参考解析',
        selectedLabel: [...selected].join('、') || '未作答',
        outcome: !correct.size ? '作答已记录' : correct.size === selected.size && [...correct].every(id => selected.has(id)) ? '回答正确' : selected.size ? '回答有误' : '本题未作答',
      });
    },
  },
  methods: {
    onChoose(event: any) {
      if (this.properties.submitted) return;
      this.triggerEvent('change', { optionId: String(event.currentTarget.dataset.id || '') });
    },
    previewImage(event: any) {
      const current = String(event.currentTarget.dataset.src || '');
      if (!current) return;
      wx.previewImage({ current, urls: this.data.displayQuestion.images || [current] });
    },
  },
});
