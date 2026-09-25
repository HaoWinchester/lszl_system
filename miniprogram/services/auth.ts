import { LEGAL_CONSENT_VERSION } from '../config/index';
import { ApiError, request } from './http';
import { clearSession, getSessionToken, MiniUser, setSession } from './session';

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
  // Optional diagnostics must not prevent authentication on restricted devices.
  let device: any = {}, appInfo: any = {};
  try { device = wx.getDeviceInfo?.() || {}; } catch {}
  try { appInfo = wx.getAppBaseInfo?.() || {}; } catch {}
  return {
    platform: String(device.platform || '').slice(0, 32),
    model: String(device.model || '').slice(0, 80),
    system: String(device.system || '').slice(0, 80),
    version: String(appInfo.version || '').slice(0, 32),
  };
}

function remember(result: SessionResponse): AuthState {
  if (result?.status !== 'authenticated' || typeof result.token !== 'string' || !result.token.trim()
    || typeof result.user?.username !== 'string' || !result.user.username.trim()) {
    throw new ApiError('登录服务返回信息不完整，请重试', 0, 'INVALID_AUTH_RESPONSE');
  }
  setSession(result.token, result.user);
  return result;
}

export async function loginWithWechat(): Promise<AuthState> {
  let login: { code?: string };
  try { login = await wx.login({ timeout: 12000 }); }
  catch { throw new ApiError('微信登录未完成，请检查网络后重试', 0, 'WECHAT_LOGIN_FAILED'); }
  const code = login?.code;
  if (typeof code !== 'string' || !code.trim()) {
    throw new ApiError('未获取到微信登录凭证，请重试', 0, 'WECHAT_CODE_MISSING');
  }
  const result = await request<AuthState>({
    path: '/api/v1/auth/mini/wechat/login',
    method: 'POST',
    auth: false,
    data: { code, client: clientMetadata() },
  });
  if (result?.status === 'authenticated') return remember(result as SessionResponse);
  if (result?.status === 'binding_required' && typeof result.bindingTicket === 'string' && result.bindingTicket.trim()) return result;
  throw new ApiError('登录服务返回信息不完整，请重试', 0, 'INVALID_AUTH_RESPONSE');
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
  if (!getSessionToken()) return null;
  try {
    const response = await request<{ user: MiniUser }>({ path: '/api/v1/auth/mini/session' });
    return response.user;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401 && error.code !== 'SESSION_CHANGED') return null;
    throw error;
  }
}

export async function logout(): Promise<void> {
  try {
    await request<{ ok: true }>({ path: '/api/v1/auth/mini/logout', method: 'POST' });
  } finally {
    clearSession();
  }
}
