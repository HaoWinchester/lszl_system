import { LEGAL_CONSENT_VERSION } from '../config/index';
import { request } from './http';
import { clearSession, MiniUser, setSession } from './session';

export type AuthState =
  | { status: 'anonymous' }
  | { status: 'binding_required'; bindingTicket: string; expiresAt: string }
  | { status: 'authenticated'; token: string; user: MiniUser; loginSessionId: string };

interface SessionResponse {
  status: 'authenticated';
  token: string;
  user: MiniUser;
  loginSessionId: string;
  expiresAt: string;
}

function clientMetadata(): Record<string, string> {
  const info = wx.getSystemInfoSync();
  return {
    platform: String(info.platform || ''),
    model: String(info.model || ''),
    system: String(info.system || ''),
    version: String(info.version || ''),
  };
}

function remember(result: SessionResponse): AuthState {
  setSession(result.token, result.user);
  return result;
}

export async function loginWithWechat(): Promise<AuthState> {
  const { code } = await wx.login();
  const result = await request<AuthState>({
    path: '/api/v1/auth/mini/wechat/login',
    method: 'POST',
    auth: false,
    data: { code, client: clientMetadata() },
  });
  return result.status === 'authenticated' ? remember(result as SessionResponse) : result;
}

export async function bindExistingAccount(
  bindingTicket: string,
  username: string,
  password: string,
): Promise<AuthState> {
  const result = await request<SessionResponse>({
    path: '/api/v1/auth/mini/bind',
    method: 'POST',
    auth: false,
    data: {
      bindingTicket,
      username,
      password,
      acceptedTermsVersion: LEGAL_CONSENT_VERSION,
      client: clientMetadata(),
    },
  });
  return remember(result);
}

export async function registerAccount(
  bindingTicket: string,
  username: string,
  password: string,
  displayName: string,
): Promise<AuthState> {
  const result = await request<SessionResponse>({
    path: '/api/v1/auth/mini/register',
    method: 'POST',
    auth: false,
    data: {
      bindingTicket,
      username,
      password,
      displayName,
      acceptedTermsVersion: LEGAL_CONSENT_VERSION,
      client: clientMetadata(),
    },
  });
  return remember(result);
}

export async function validateSession(): Promise<MiniUser | null> {
  try {
    const response = await request<{ user: MiniUser }>({ path: '/api/v1/auth/mini/session' });
    return response.user;
  } catch (_error) {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await request<{ ok: true }>({ path: '/api/v1/auth/mini/logout', method: 'POST' });
  } finally {
    clearSession();
  }
}
