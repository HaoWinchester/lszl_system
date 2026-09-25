const TOKEN_KEY = 'kg_mini_session_token';
const USER_KEY = 'kg_mini_current_user';
let sessionCleared = false;

export interface MiniUser {
  username: string;
  display_name?: string | null;
  role: string;
  subject?: string | null;
  wechat?: { bound: boolean; nickname?: string } | null;
}

export function getSessionToken(): string {
  if (sessionCleared) return '';
  try {
    const token = wx.getStorageSync(TOKEN_KEY);
    return typeof token === 'string' ? token : '';
  } catch { return ''; }
}

export function setSession(token: string, user: MiniUser): void {
  try {
    wx.setStorageSync(TOKEN_KEY, token);
    wx.setStorageSync(USER_KEY, user);
    sessionCleared = false;
  } catch {
    // Roll back both cache entries if only part of the session was saved.
    clearSession();
    throw Object.assign(new Error('无法保存登录状态，请检查设备存储空间后重新微信登录'), { code: 'SESSION_STORAGE_FAILED' });
  }
}

export function getCurrentUser(): MiniUser | null {
  if (sessionCleared) return null;
  try {
    const user = wx.getStorageSync(USER_KEY);
    return user && typeof user === 'object' && typeof user.username === 'string' ? user as MiniUser : null;
  } catch { return null; }
}

export function clearSession(): void {
  // Also invalidate in memory when the device cannot delete its cache entries.
  sessionCleared = true;
  // Cleanup must not interrupt the HTTP error callback and leave it pending.
  for (const key of [TOKEN_KEY, USER_KEY]) {
    try { wx.removeStorageSync(key); } catch {}
  }
}
