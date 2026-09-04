import { request } from './http';
import { PaperSummary } from '../types/api';

function normalizePaper(raw: any): PaperSummary {
  const access = String(raw?.accessPolicy?.accessLevel || raw?.accessLevel || 'free').toLowerCase();
  return {
    paperId: String(raw?.paperId || ''),
    releaseId: String(raw?.releaseId || raw?.id || ''),
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
