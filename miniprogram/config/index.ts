const API_BASE_URLS: Record<string, string> = {
  develop: 'http://127.0.0.1:5173',
  trial: 'https://uat.aihuanpu.com',
  release: 'https://lszl.aihuanpu.com',
};

function environmentVersion(): string {
  try {
    return String(wx.getAccountInfoSync?.().miniProgram?.envVersion || 'develop');
  } catch (_error) {
    return 'develop';
  }
}

export function getApiBaseUrl(): string {
  const environment = environmentVersion();
  const localOverride = environment === 'develop'
    ? String(wx.getStorageSync('kg_api_base_url') || '').trim()
    : '';
  return (localOverride || API_BASE_URLS[environment] || API_BASE_URLS.release).replace(/\/$/, '');
}

export const LEGAL_CONSENT_VERSION = '2026-08-13-v1';
