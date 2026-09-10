import { pairLabel } from '../../domain/pc-practice';
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
      this.setData({ answerLabel: question?.type==='matching'?pairLabel(question,question.matching?.correctPairs):values.join('、') || String(question?.correctAnswer || '请结合要点理解') });
    },
  },
});
