const DEFAULT_API_BASE_URL = 'http://127.0.0.1:5173';

export function getApiBaseUrl(): string {
  const stored = String(wx.getStorageSync('kg_api_base_url') || '').trim();
  return (stored || DEFAULT_API_BASE_URL).replace(/\/$/, '');
}

export const LEGAL_CONSENT_VERSION = '2026-08-13-v1';
