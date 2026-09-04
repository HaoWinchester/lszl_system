export interface PracticeDraft {
  sessionId: string;
  username: string;
  revision: number;
  currentIndex: number;
  answers: Record<string, string[]>;
  markedQuestionIds: string[];
  savedAt: number;
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
  return local.savedAt > server.savedAt
    ? { state: local, conflict: false, pendingLocal: true }
    : { state: server, conflict: false, pendingLocal: false };
}

export function toggleMarked(marked: string[], questionId: string): string[] {
  const unique = [...new Set(marked.map(String))];
  return unique.includes(questionId)
    ? unique.filter(id => id !== questionId)
    : [...unique, questionId];
}
