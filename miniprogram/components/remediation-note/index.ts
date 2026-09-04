Component({
  properties: {
    mistake: { type: Object, value: {} },
    question: { type: Object, value: {} },
    previousAnswer: { type: String, value: '' },
  },
  data: { answerLabel: '请结合要点理解' },
  observers: {
    question(question: any) {
      const values = Array.isArray(question?.correctOptionIds)
        ? question.correctOptionIds.map(String).filter(Boolean)
        : [];
      this.setData({ answerLabel: values.join('、') || String(question?.correctAnswer || '请结合要点理解') });
    },
  },
});
