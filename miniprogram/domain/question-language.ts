export type LanguageMode = 'zh' | 'en' | 'bilingual';

const STORAGE_KEY = 'kg_mini_language_mode';
const MODES: LanguageMode[] = ['zh', 'en', 'bilingual'];
const LABELS: Record<LanguageMode, string> = { zh: '中', en: 'EN', bilingual: '双' };

export function normalizeLanguageMode(value: unknown): LanguageMode {
  return value === 'en' || value === 'bilingual' ? value : 'zh';
}

export function getLanguageMode(): LanguageMode {
  try { return normalizeLanguageMode(wx.getStorageSync(STORAGE_KEY)); } catch { return 'zh'; }
}

export function setLanguageMode(mode: LanguageMode): LanguageMode {
  const next = normalizeLanguageMode(mode);
  try { wx.setStorageSync(STORAGE_KEY, next); } catch { /* storage 不可用时仅本次会话生效 */ }
  return next;
}

export function cycleLanguageMode(mode: LanguageMode): LanguageMode {
  const current = normalizeLanguageMode(mode);
  return MODES[(MODES.indexOf(current) + 1) % MODES.length];
}

export function languageLabel(mode: LanguageMode): string {
  return LABELS[normalizeLanguageMode(mode)];
}
