import type { PracticeSession, PracticeQuestion } from '../types/api';

type Answer = { selectedPairs?: Record<string,string>; selectedAnswer?: string; selectedAnswerIds?: string[]; selectionIndex: number; timedOut?: boolean; correct?: boolean };
const RUNTIME_FIELDS = ['currentIndex', 'health', 'streak', 'maxStreak', 'experience', 'remainingMs', 'durationMs', 'languageMode', 'autoExplain', 'order', 'showAnswers', 'markedQuestionIds', 'pendingSelections', 'pendingMatches'];
function writableRuntime(value: Record<string, any> = {}) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => RUNTIME_FIELDS.includes(key)));
}

export function normalizePairs(question: PracticeQuestion, value: unknown, complete = false): Record<string,string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const left = (question.matching?.left || []).map(item => item.id), right = (question.matching?.right || []).map(item => item.id);
  const pairs = value as Record<string,string>, keys = Object.keys(pairs), values = Object.values(pairs);
  if (!left.length || keys.some(id => !left.includes(id)) || values.some(id => !right.includes(id)) || new Set(values).size !== values.length) return null;
  if (complete && (keys.length !== left.length || left.length !== right.length)) return null;
  return Object.fromEntries(left.filter(id => Object.prototype.hasOwnProperty.call(pairs,id)).map(id => [id,pairs[id]]));
}
export function assignPair(question: PracticeQuestion, current: Record<string,string>, left: string, right: string): Record<string,string> {
  const next = {...(normalizePairs(question,current) || {})};
  if (!question.matching?.left.some(item => item.id === left)) return next;
  if (!right) { delete next[left]; return next; }
  if (!question.matching.right.some(item => item.id === right)) return next;
  Object.keys(next).forEach(id => { if (next[id] === right) delete next[id]; });
  next[left] = right; return next;
}
export function pairLabel(question: PracticeQuestion, selected: Record<string,string> = {}): string {
  return (question.matching?.left || []).map((left,index) => `${index+1} → ${question.matching?.right.find(right=>right.id===selected[left.id])?.text || '未配对'}`).join('；');
}

// Kept in one pure module. Behavioral parity is tested against the PC draft engine.
export function createPracticeRun(session: PracticeSession, local?: { lockedAnswers?: Record<string, any>; runtimeState?: Record<string, any> }) {
  const questions = new Map(session.questions.map(entry => [entry.questionId, entry.question]));
  const mode = session.mode;
  const maxHealth = Math.max(3, Math.ceil(questions.size * (mode === 'scholar' ? .1 : .3)));
  const runtime = { health: maxHealth, streak: 0, maxStreak: 0, experience: 0, remainingMs: 60000,
    ...writableRuntime(session.runtimeState), ...writableRuntime(local?.runtimeState) } as Record<string, any>;
  const answers: Record<string, Answer> = {};

  function grade(id: string, value: any): Answer {
    const question = questions.get(id)!;
    if (question.type === 'matching') {
      const selectedPairs = value.timedOut ? {} : normalizePairs(question,value.selectedPairs) || {};
      const expected = normalizePairs(question,question.matching?.correctPairs,true);
      return {...value,selectedPairs,correct: !value.timedOut && !!expected && !!normalizePairs(question,selectedPairs,true) && Object.keys(expected).every(key=>expected[key]===selectedPairs[key])};
    }
    const selected = question.type === 'multiple_choice'
      ? question.options.map(option => option.id).filter(id => (value.selectedAnswerIds || []).includes(id))
      : [String(value.selectedAnswer || '')];
    const correct = question.type === 'multiple_choice' ? question.correctOptionIds || [] : [question.correctAnswer || ''];
    return { ...value, ...(question.type === 'multiple_choice' && !value.timedOut ? { selectedAnswerIds: selected } : {}),
      correct: !value.timedOut && correct.length > 0 && selected.length === correct.length && correct.every(id => selected.includes(id)) };
  }

  for (const [id, value] of Object.entries({ ...local?.lockedAnswers, ...session.answers })) {
    if (questions.has(id) && value.draft !== true) answers[id] = grade(id, { ...value, selectionIndex: Number(value.selectionIndex) || Object.keys(answers).length + 1 });
  }
  if (mode === 'challenge') runtime.health = Math.max(0, maxHealth - Object.values(answers).filter(answer => !answer.correct).length);

  function select(id: string, ids: string[] | Record<string,string>, timedOut = false): boolean {
    const question = questions.get(id);
    if (!question || question.type === 'unknown' || !['single_choice','multiple_choice','matching'].includes(question.type) || answers[id] || (timedOut && mode !== 'scholar')) return false;
    const matching = question.type === 'matching';
    if (!timedOut && matching && !normalizePairs(question,ids,true)) return false;
    const selected = Array.isArray(ids) ? [...new Set(ids)] : [];
    if (!timedOut && !matching && (!selected.length || selected.some(id => !question.options.some(option => option.id === id)))) return false;
    if (!timedOut && !matching && question.type !== 'multiple_choice' && selected.length !== 1) return false;
    const selectionIndex = Math.max(0, ...Object.values(answers).map(answer => answer.selectionIndex)) + 1;
    const answer = grade(id, { selectionIndex, ...(matching ? {selectedPairs: timedOut ? {} : normalizePairs(question,ids,true)!, ...(timedOut?{timedOut:true}:{})} : timedOut ? { selectedAnswer: '__timeout__', timedOut: true }
      : question.type === 'multiple_choice' ? { selectedAnswerIds: selected } : { selectedAnswer: selected[0] }) });
    answers[id] = answer;
    if (answer.correct) {
      runtime.streak++; runtime.maxStreak = Math.max(runtime.maxStreak, runtime.streak);
      runtime.experience += 10 + (runtime.streak >= 8 ? 10 : runtime.streak >= 5 ? 5 : runtime.streak >= 3 ? 2 : 0);
      if (mode === 'scholar') {
        runtime.remainingMs = Math.min(60000, runtime.remainingMs + 20000);
        if (runtime.streak % 5 === 0) runtime.health = Math.min(maxHealth, runtime.health + 1);
      }
    } else {
      runtime.streak = 0;
      if (mode !== 'practice') runtime.health = Math.max(0, runtime.health - 1);
      if (mode === 'scholar') {
        const after = timedOut ? 0 : Math.max(0, runtime.remainingMs - 20000);
        runtime.remainingMs = after > 0 ? after : runtime.health > 0 ? 40000 : 0;
      }
    }
    return true;
  }

  function submission(): Record<string, Answer> {
    return Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, {
      ...(answer.selectedPairs ? {selectedPairs:{...answer.selectedPairs}} : answer.selectedAnswerIds ? { selectedAnswerIds: [...answer.selectedAnswerIds] } : { selectedAnswer: answer.selectedAnswer }),
      selectionIndex: answer.selectionIndex, ...(answer.timedOut ? { timedOut: true } : {}),
    }]));
  }
  function stats() {
    const values = Object.values(answers), correct = values.filter(answer => answer.correct).length;
    return { total: questions.size, answered: values.length, correct, wrong: values.length - correct, unanswered: questions.size - values.length };
  }
  return { select, submission, stats, maxHealth,
    answer: (id: string) => answers[id] ? { ...answers[id] } : null,
    runtime: () => ({ ...runtime }),
    patchRuntime: (patch: Record<string, any>) => Object.assign(runtime, writableRuntime(patch)),
    shouldComplete: () => (questions.size > 0 && stats().answered === questions.size) || (mode === 'scholar' && runtime.health <= 0),
  };
}
