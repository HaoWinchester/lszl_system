export interface Appearance { theme: string; readingSize: string; }
export interface Theme { id: string; name: string; description: string; colors: Record<string, string>; }

export const THEMES: Theme[] = [
  { id: 'paper', name: '纸感绿', description: '米白纸感，沉静深绿', colors: {
    paper: '#f4f0e7', surface: '#fbf9f3', 'surface-quiet': '#ece8dc', ink: '#173b32', text: '#243b35', muted: '#58685f',
    line: '#d8d7cc', 'green-soft': '#dfe9df', clay: '#a55842', gold: '#a78037', danger: '#a3473c',
    success: '#3f6859', 'success-soft': '#dfe9df', 'danger-soft': '#f4e8e2', 'on-accent': '#fffdf7', 'on-danger': '#ffffff',
    'border-strong': '#9ba49f', disabled: '#758078', 'disabled-surface': '#d9ded9', 'disabled-text': '#526159', mask: 'rgba(20, 39, 34, .38)',
  } },
  { id: 'white', name: '清爽白', description: '清晰白底，柔和蓝色', colors: {
    paper: '#f5f7fa', surface: '#ffffff', 'surface-quiet': '#e9edf2', ink: '#2d5275', text: '#28333e', muted: '#586776',
    line: '#d3dbe3', 'green-soft': '#e2ebf5', clay: '#a2513b', gold: '#8c6b24', danger: '#aa4037',
    success: '#376c51', 'success-soft': '#e3eee7', 'danger-soft': '#f8e8e5', 'on-accent': '#ffffff', 'on-danger': '#ffffff',
    'border-strong': '#8999a8', disabled: '#708090', 'disabled-surface': '#dbe2ea', 'disabled-text': '#526172', mask: 'rgba(24, 34, 45, .38)',
  } },
  { id: 'night', name: '夜读灰', description: '深灰底色，柔白正文', colors: {
    paper: '#202724', surface: '#29332e', 'surface-quiet': '#35423b', ink: '#a6d8be', text: '#e4e9e6', muted: '#adb9b1',
    line: '#53635a', 'green-soft': '#364d43', clay: '#e1ab8f', gold: '#d3b57c', danger: '#f0a49a',
    success: '#9bccb1', 'success-soft': '#31463b', 'danger-soft': '#523935', 'on-accent': '#10251c', 'on-danger': '#2c1516',
    'border-strong': '#88998e', disabled: '#89998f', 'disabled-surface': '#3c4841', 'disabled-text': '#b6c1b9', mask: 'rgba(0, 0, 0, .5)',
  } },
];

export const READING_SIZES = [
  { id: 'standard', name: '标准', question: 36, option: 31, body: 30, meta: 26 },
  { id: 'comfortable', name: '较大', question: 40, option: 35, body: 34, meta: 28 },
  { id: 'large', name: '大号', question: 44, option: 39, body: 38, meta: 30 },
];

// Device-only presentation preference; never contains accounts or learning records.
const STORAGE_KEY = 'kg_mini_appearance_v1';
let current: Appearance | undefined;
const listeners = new Set<(value: Appearance) => void>();

function normalize(value: unknown): Appearance {
  const input = value && typeof value === 'object' ? value as Partial<Appearance> : {};
  return {
    theme: THEMES.some(item => item.id === input.theme) ? input.theme! : 'paper',
    readingSize: READING_SIZES.some(item => item.id === input.readingSize) ? input.readingSize! : 'standard',
  };
}

export function readAppearance(): Appearance {
  if (!current) {
    try { current = normalize(wx.getStorageSync(STORAGE_KEY)); }
    catch { current = normalize(null); }
  }
  return { ...current };
}

export function saveAppearance(value: Appearance): void {
  const next = normalize(value);
  wx.setStorageSync(STORAGE_KEY, next);
  current = next;
  listeners.forEach(listener => listener({ ...next }));
}

export function subscribeAppearance(listener: (value: Appearance) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function appearanceData(value: Appearance = readAppearance()) {
  const safe = normalize(value);
  const theme = THEMES.find(item => item.id === safe.theme)!;
  const size = READING_SIZES.find(item => item.id === safe.readingSize)!;
  const styles = Object.entries(theme.colors).map(([key, color]) => `--${key}:${color}`);
  styles.push(`--font-question:${size.question}rpx`, `--font-option:${size.option}rpx`, `--font-reading-body:${size.body}rpx`, `--font-reading-meta:${size.meta}rpx`);
  return {
    appearanceStyle: styles.join(';') + ';', appearanceColors: theme.colors,
    appearanceTheme: safe.theme, appearanceReadingSize: safe.readingSize,
  };
}

export function updateAppearanceChrome(value: Appearance = readAppearance()): void {
  const { appearanceColors: colors, appearanceTheme: theme } = appearanceData(value);
  wx.setBackgroundColor?.({ backgroundColor: colors.paper, backgroundColorTop: colors.paper, backgroundColorBottom: colors.paper });
  wx.setBackgroundTextStyle?.({ textStyle: theme === 'night' ? 'light' : 'dark' });
  wx.setNavigationBarColor?.({ frontColor: theme === 'night' ? '#ffffff' : '#000000', backgroundColor: colors.paper });
}

export function resolveIconColor(color: string, value: Partial<Appearance> = readAppearance()): string {
  const { appearanceColors } = appearanceData(normalize(value));
  return appearanceColors[color] || (/^#[0-9a-f]{6}$/i.test(color) ? color : appearanceColors.ink);
}
