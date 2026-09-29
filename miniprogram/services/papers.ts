import { request } from './http';
import { PaperCoverage, PaperSummary } from '../types/api';

function normalizeCoverage(raw: any, releaseId: string): PaperCoverage | null {
  if (!raw || raw.releaseId !== releaseId) return null;
  const { totalCount, completedCount, remainingUnseen } = raw;
  if (![totalCount, completedCount, remainingUnseen].every(value => Number.isInteger(value) && value >= 0)
      || completedCount + remainingUnseen !== totalCount) return null;
  return { releaseId, totalCount, completedCount, remainingUnseen,
    label: `本版本已练 ${completedCount} / ${totalCount} 题 · 未练 ${remainingUnseen} 题` };
}

export async function getPaperCoverage(paperId: string, releaseId: string): Promise<PaperCoverage | null> {
  const payload = await request<{ coverage?: unknown }>({
    path: `/api/v1/learning/practice/papers/${encodeURIComponent(paperId)}/progress?releaseId=${encodeURIComponent(releaseId)}`,
  });
  return normalizeCoverage(payload.coverage, releaseId);
}

function normalizePaper(raw: any): PaperSummary {
  const releaseId = String(raw?.releaseId || raw?.id || '');
  const access = String(raw?.accessPolicy?.accessLevel || raw?.accessLevel || 'free').toLowerCase();
  return {
    paperId: String(raw?.paperId || ''),
    releaseId,
    coverage: normalizeCoverage(raw?.coverage, releaseId),
    version: Number(raw?.version || 0),
    title: String(raw?.title || raw?.name || '未命名试卷'),
    subject: String(raw?.subject || 'PMP'),
    description: String(raw?.description || ''),
    questionCount: Number(raw?.questionCount ?? raw?.configuredCount ?? raw?.totalCount ?? 0),
    accessLevel: ['member', 'vip', 'paid', 'premium'].includes(access) ? 'member' : 'free',
    contentRestricted: raw?.contentRestricted === true,
    enabledModes: Array.isArray(raw?.enabledModes) ? raw.enabledModes.map(String) : [],
    publishedAt: raw?.publishedAt ?? null,
  };
}

export async function listPublishedPapers(page = 1, pageSize = 30): Promise<{
  items: PaperSummary[];
  total: number;
}> {
  const payload = await request<{ releases?: unknown[]; total?: number }>({
    path: `/api/v1/paper-releases/catalog?page=${page}&pageSize=${pageSize}`,
  });
  return {
    items: (Array.isArray(payload.releases) ? payload.releases : []).map(normalizePaper),
    total: Number(payload.total || 0),
  };
}
