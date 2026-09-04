import { request } from './http';
import {
  PracticeMode,
  PracticeReport,
  PracticeSession,
  SessionWriteInput,
  StartSessionInput,
} from '../types/api';
import { normalizeQuestion } from '../domain/question';

const ROOT = '/api/v1/learning/practice';

function backendMode(mode: PracticeMode): string {
  return mode === 'normal' ? 'practice' : mode;
}

function normalizeSession(rawValue: any): PracticeSession {
  const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  return {
    ...raw,
    id: String(raw.id || ''),
    mode: String(raw.mode || 'practice'),
    status: String(raw.status || ''),
    revision: Number(raw.revision || 0),
    questions: questions.map((entry: any) => ({
      ...entry,
      questionId: String(entry?.questionId || entry?.question?.id || ''),
      question: normalizeQuestion(entry?.question || entry?.questionSnapshot || {}),
    })),
  } as PracticeSession;
}

export function getOverview(): Promise<Record<string, any>> {
  return request({ path: `${ROOT}/overview` });
}

export function getExperienceSummary(): Promise<Record<string, any>> {
  return request({ path: `${ROOT}/experience-summary` });
}

export function getRevengeSummary(): Promise<Record<string, any>> {
  return request({ path: `${ROOT}/revenge/summary` });
}

export async function getActiveSessions(): Promise<PracticeSession[]> {
  const payload = await request<{ sessions?: unknown[] }>({ path: `${ROOT}/sessions/active` });
  return (payload.sessions || []).map(normalizeSession);
}

export async function listSessions(): Promise<PracticeSession[]> {
  const payload = await request<{ sessions?: unknown[] }>({ path: `${ROOT}/sessions` });
  return (payload.sessions || []).map(normalizeSession);
}

export async function startSession(input: StartSessionInput): Promise<PracticeSession> {
  const payload = await request<{ session: unknown }>({
    path: `${ROOT}/sessions/start`,
    method: 'POST',
    data: { ...input, mode: backendMode(input.mode) },
  });
  return normalizeSession(payload.session);
}

export async function enterSession(input: {
  sessionId?: string;
  paperId?: string;
  releaseId?: string;
  mode?: PracticeMode;
}): Promise<{ resumed: boolean; session: PracticeSession }> {
  const payload = await request<{ resumed?: boolean; session: any; questions?: any[] }>({
    path: `${ROOT}/sessions/enter`,
    method: 'POST',
    data: { ...input, ...(input.mode ? { mode: backendMode(input.mode) } : {}) },
  });
  return {
    resumed: payload.resumed === true,
    session: normalizeSession({ ...payload.session, questions: payload.questions || payload.session?.questions }),
  };
}

export async function getSession(sessionId: string): Promise<PracticeSession> {
  const payload = await request<{ session: unknown }>({ path: `${ROOT}/sessions/${encodeURIComponent(sessionId)}` });
  return normalizeSession(payload.session);
}

export async function submitAnswer(sessionId: string, input: SessionWriteInput): Promise<any> {
  const payload: any = await request({
    path: `${ROOT}/sessions/${encodeURIComponent(sessionId)}/answers`,
    method: 'POST',
    data: input,
    idempotencyKey: input.requestId,
  });
  return { ...payload, session: normalizeSession(payload.session) };
}

export async function saveState(sessionId: string, input: SessionWriteInput): Promise<PracticeSession> {
  const payload = await request<{ session: unknown }>({
    path: `${ROOT}/sessions/${encodeURIComponent(sessionId)}/state`,
    method: 'PATCH',
    data: input,
    idempotencyKey: input.requestId,
  });
  return normalizeSession(payload.session);
}

export async function pauseSession(sessionId: string, input: SessionWriteInput): Promise<PracticeSession> {
  const payload = await request<{ session: unknown }>({
    path: `${ROOT}/sessions/${encodeURIComponent(sessionId)}/pause`,
    method: 'POST',
    data: input,
    idempotencyKey: input.requestId,
  });
  return normalizeSession(payload.session);
}

export async function abandonSession(sessionId: string, input: SessionWriteInput): Promise<PracticeSession> {
  const payload = await request<{ session: unknown }>({
    path: `${ROOT}/sessions/${encodeURIComponent(sessionId)}/abandon`,
    method: 'POST',
    data: input,
    idempotencyKey: input.requestId,
  });
  return normalizeSession(payload.session);
}

export async function completeSession(sessionId: string, input: SessionWriteInput): Promise<{
  session: PracticeSession;
  report: PracticeReport;
}> {
  const payload = await request<{ session: unknown; report: PracticeReport }>({
    path: `${ROOT}/sessions/${encodeURIComponent(sessionId)}/complete`,
    method: 'POST',
    data: input,
    idempotencyKey: input.requestId,
  });
  return { session: normalizeSession(payload.session), report: payload.report || {} };
}

export async function getReport(sessionId: string): Promise<PracticeReport> {
  const payload = await request<{ report: PracticeReport }>({
    path: `${ROOT}/sessions/${encodeURIComponent(sessionId)}/report`,
  });
  return payload.report || {};
}
