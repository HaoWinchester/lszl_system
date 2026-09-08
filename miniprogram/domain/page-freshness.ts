export const DEFAULT_PAGE_MAX_AGE_MS = 30_000;
let learningChangedAt = 0;

export function invalidateLearningPages(): void {
  learningChangedAt = Date.now();
}

export type PageRefreshMode = 'initial' | 'silent' | 'skip';

export function shouldRefresh(
  lastLoadedAt: number,
  now = Date.now(),
  maxAgeMs = DEFAULT_PAGE_MAX_AGE_MS,
): boolean {
  return lastLoadedAt <= 0 || learningChangedAt >= lastLoadedAt || now - lastLoadedAt > maxAgeMs;
}

export function pageRefreshMode(
  lastLoadedAt: number,
  now = Date.now(),
  maxAgeMs = DEFAULT_PAGE_MAX_AGE_MS,
): PageRefreshMode {
  if (lastLoadedAt <= 0) return 'initial';
  return shouldRefresh(lastLoadedAt, now, maxAgeMs) ? 'silent' : 'skip';
}
