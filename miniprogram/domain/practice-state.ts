export interface PracticeDraft {
  sessionId: string;
  username: string;
  revision: number;
  currentIndex: number;
  answers: Record<string, string[]>;
  markedQuestionIds: string[];
  savedAt: number;
  lockedAnswers?: Record<string, any>;
  runtimeState?: Record<string, any>;
}

export function toggleAnswer(
  selected: string[],
  optionId: string,
  multiple: boolean,
): string[] {
  if (!multiple) return [optionId];
  const unique = [...new Set(selected.map(String))];
  return unique.includes(optionId)
    ? unique.filter(id => id !== optionId)
    : [...unique, optionId];
}

export function moveQuestion(currentIndex: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, currentIndex + delta));
}

export function mergeDraft(server: PracticeDraft, local?: PracticeDraft): {
  state: PracticeDraft;
  conflict: boolean;
  pendingLocal: boolean;
} {
  if (!local || local.username !== server.username || local.sessionId !== server.sessionId) {
    return { state: server, conflict: false, pendingLocal: false };
  }
  if (server.revision > local.revision) {
    return { state: server, conflict: true, pendingLocal: false };
  }
  if (local.revision > server.revision) {
    return { state: local, conflict: false, pendingLocal: true };
  }
  // The same revision means the local draft was based on this exact server state.
  // Loading the server now must not make an older, unsent local selection disappear.
  const locked = Object.fromEntries(Object.entries(server.answers)
    .filter(([id]) => !server.lockedAnswers || server.lockedAnswers[id]?.draft !== true && !!server.lockedAnswers[id]));
  const state = { ...local, answers: { ...server.answers, ...local.answers, ...locked } };
  const pendingLocal = JSON.stringify(state.answers) !== JSON.stringify(server.answers)
    || state.currentIndex !== server.currentIndex
    || JSON.stringify(state.markedQuestionIds) !== JSON.stringify(server.markedQuestionIds);
  return { state, conflict: false, pendingLocal };
}

export function toggleMarked(marked: string[], questionId: string): string[] {
  const unique = [...new Set(marked.map(String))];
  return unique.includes(questionId)
    ? unique.filter(id => id !== questionId)
    : [...unique, questionId];
}
