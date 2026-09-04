const TOKEN_KEY = 'kg_mini_session_token';
const USER_KEY = 'kg_mini_current_user';

export interface MiniUser {
  username: string;
  display_name?: string | null;
  role: string;
  subject?: string | null;
  wechat?: { bound: boolean; nickname?: string } | null;
}

export function getSessionToken(): string {
  return String(wx.getStorageSync(TOKEN_KEY) || '');
}

export function setSession(token: string, user: MiniUser): void {
  wx.setStorageSync(TOKEN_KEY, token);
  wx.setStorageSync(USER_KEY, user);
}

export function getCurrentUser(): MiniUser | null {
  return (wx.getStorageSync(USER_KEY) || null) as MiniUser | null;
}

export function clearSession(): void {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
}
