import { getApiBaseUrl } from '../config/index';
import { clearSession, getSessionToken } from './session';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code = 'REQUEST_FAILED',
    public readonly detail?: unknown,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: unknown;
  auth?: boolean;
  idempotencyKey?: string;
}

function errorParts(payload: any): { code: string; message: string } {
  const detail = payload && payload.detail;
  if (detail && typeof detail === 'object') {
    return {
      code: String(detail.code || 'REQUEST_FAILED'),
      message: String(detail.message || '请求失败，请重试'),
    };
  }
  return { code: 'REQUEST_FAILED', message: String(detail || '请求失败，请重试') };
}

export function request<T>(options: RequestOptions): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getApiBaseUrl()}${options.path}`,
      method: options.method || 'GET',
      data: options.data,
      header: headers,
      timeout: 12000,
      success: (response: { statusCode: number; data: any }) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data as T);
          return;
        }
        if (response.statusCode === 401) {
          clearSession();
          const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
          const currentRoute = String(pages[pages.length - 1]?.route || '');
          if (currentRoute && currentRoute !== 'pages/login/index') {
            wx.reLaunch({ url: '/pages/login/index' });
          }
        }
        const parts = errorParts(response.data);
        reject(new ApiError(parts.message, response.statusCode, parts.code, response.data));
      },
      fail: (error: unknown) => {
        reject(new ApiError('网络连接不可用，已保留当前内容', 0, 'NETWORK_ERROR', error));
      },
    });
  });
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}
