import { PracticeDraft } from './practice-state';

function key(username: string, sessionId: string): string {
  return `practice-draft:${username}:${sessionId}`;
}

export function saveLocalDraft(draft: PracticeDraft): void {
  wx.setStorageSync(key(draft.username, draft.sessionId), draft);
}

export function loadLocalDraft(username: string, sessionId: string): PracticeDraft | null {
  const value = wx.getStorageSync(key(username, sessionId));
  return value && typeof value === 'object' ? (value as PracticeDraft) : null;
}

export function clearLocalDraft(username: string, sessionId: string): void {
  wx.removeStorageSync(key(username, sessionId));
}
