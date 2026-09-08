import assert from 'node:assert/strict';
import { loadModule } from './page-harness.mjs';
import { sanitizeRichText } from '../../domain/rich-text.ts';
import { createPracticeRun } from '../../domain/pc-practice.ts';
import { getModePolicy, MODE_POLICIES, MODE_CHOICES, formatTimer } from '../../domain/mode-policy.ts';
import { mergeDraft, moveQuestion, toggleAnswer, toggleMarked } from '../../domain/practice-state.ts';
import { createSyncCoordinator, classifyFailure, resolveConflict } from '../../domain/sync-coordinator.ts';
import { invalidateLearningPages, pageRefreshMode } from '../../domain/page-freshness.ts';
import { subscriptionView } from '../../domain/subscription-view.ts';
import { avatarLetterOf } from '../../domain/profile-view.ts';

// Test-only host: real Page and service modules, external HTTP boundary only.
export async function createUatClient(account) {
  assert.match(account.username, /^mini_uat_save_[a-f0-9]{12}_[012]$/);
  const base = 'https://uat.aihuanpu.com', storage = new Map(), requests = [];
  const faults = { offline: false, delayMs: 0, dropResponse: '' };
  const wx = {
    getStorageSync: k => storage.get(k), setStorageSync: (k, v) => storage.set(k, structuredClone(v)),
    removeStorageSync: k => storage.delete(k), getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    reLaunch() {},
    request(options) {
      const begin = performance.now(), path = new URL(options.url).pathname;
      const row = { path, method: options.method, status: 0, ms: 0, bytes: 0, simulated: faults.offline || faults.delayMs > 0 };
      requests.push(row);
      if (faults.offline) { queueMicrotask(() => options.fail(new Error('Test: offline'))); return; }
      (async () => {
        if (faults.delayMs) await new Promise(resolve => setTimeout(resolve, faults.delayMs));
        const response = await fetch(options.url, { method: options.method, headers: options.header,
          body: options.method === 'GET' ? undefined : JSON.stringify(options.data),
          signal: AbortSignal.timeout(options.timeout || 12000) });
        const text = await response.text();
        Object.assign(row, { status: response.status, ms: performance.now() - begin, bytes: Buffer.byteLength(text) });
        if (faults.dropResponse && path.endsWith(faults.dropResponse) && response.ok) {
          faults.dropResponse = ''; options.fail(new Error('Test: response lost after commit')); return;
        }
        options.success({ statusCode: response.status, data: JSON.parse(text) });
      })().catch(error => { row.ms = performance.now() - begin; options.fail(error); });
    },
  };
  const identity = await loadModule('services/session.ts', { wx }, ['setSession', 'getSessionToken', 'getCurrentUser', 'clearSession']);
  const activate = token => identity.setSession(token || account.token, { username: account.username, role: 'student' });
  activate();
  const http = await loadModule('services/http.ts', { wx, ...identity, getApiBaseUrl: () => base }, ['request', 'ApiError', 'messageOf']);
  const auth = await loadModule('services/auth.ts', { wx, ...identity, ...http }, ['validateSession', 'logout']);
  const { normalizeQuestion } = await loadModule('domain/question.ts', { sanitizeRichText }, ['normalizeQuestion']);
  const practice = await loadModule('services/practice.ts', { ...http, normalizeQuestion, invalidateLearningPages },
    ['startSession', 'getSession', 'getActiveSessions', 'pauseSession', 'saveState', 'completeSession', 'abandonSession', 'getReport', 'listSessions',
      'getExperienceSummary', 'getOverview', 'getRevengeSummary', 'getRemediation', 'getVerificationCandidate', 'markRemediationReviewed', 'submitRevengeAnswer', 'submitVerification']);
  const papers = await loadModule('services/papers.ts', http, ['listPublishedPapers']);
  const subscription = await loadModule('services/subscription.ts', http, ['getMySubscription']);
  const drafts = await loadModule('domain/draft-store.ts', { wx }, ['loadLocalDraft', 'saveLocalDraft', 'clearLocalDraft', 'clearUserDrafts']);
  return { account, base, wx, storage, requests, faults, activate,
    deps: { ...identity, ...http, ...auth, ...practice, ...papers, ...subscription, ...drafts,
      normalizeQuestion, createPracticeRun, getModePolicy, MODE_POLICIES, MODE_CHOICES, formatTimer, mergeDraft, moveQuestion, toggleAnswer, toggleMarked,
      createSyncCoordinator, classifyFailure, resolveConflict, pageRefreshMode, subscriptionView, avatarLetterOf, selectPrimaryTab() {} } };
}
