'use strict';

;(function (global) {
  const API = global.KGDomainApi;
  if (!API?.request) throw new Error('管理域摘要 API 客户端未就绪');

  const clone = value => {
    if (value === undefined) return undefined;
    try { return global.structuredClone ? global.structuredClone(value) : JSON.parse(JSON.stringify(value)); } catch (_error) { return value; }
  };
  const text = value => String(value ?? '').trim();
  let state = null;
  let readyPromise = null;

  function auditRow(row) {
    const detail = row?.detail && typeof row.detail === 'object' ? row.detail : {};
    return {
      id: text(row?.id), at: text(row?.at), action: text(row?.action) || 'system',
      entityType: text(detail.entityType) || 'system',
      entityId: text(row?.target_username || detail.entityId),
      actor: { id: text(row?.actor), name: text(row?.actor) || '系统' },
      status: /fail|error|denied/i.test(text(row?.action)) ? 'failed' : 'success',
      summary: text(detail.summary || detail.message) || text(row?.action),
      metadata: clone(detail),
    };
  }

  async function load() {
    const teaching = global.KGTeachingContentApi;
    const courses = global.KGCourseManagementApi;
    const [, , banksResult, papersResult] = await Promise.all([
      teaching?.bootstrap?.(),
      courses?.ready?.(),
      API.request({ path: '/api/v1/banks' }),
      API.request({ path: '/api/v1/papers' }),
    ]);
    const restricted = await Promise.allSettled([
      API.request({ path: '/api/v1/system/logs?limit=100' }),
      API.request({ path: '/api/v1/engagement/admin/feedback?limit=100&offset=0' }),
      API.request({ path: '/api/v1/engagement/admin/messages?limit=100&offset=0' }),
    ]);
    const role = text(global.KGAuthCore?.currentUser?.({ includeInactive: true })?.role || global.__KG_DIRECT_BOOTSTRAP__?.authUser?.role || global.__KG_DIRECT_BOOTSTRAP__?.user?.role);
    const [logsResult, feedbackResult, messagesResult] = restricted.map(result => {
      if (result.status === 'fulfilled') return result.value;
      if (role === 'teacher' && result.reason?.status === 403) return {};
      throw result.reason;
    });
    const courseState = courses?.snapshot?.() || { drafts: [], releases: [], tasks: [] };
    const logs = clone(logsResult?.logs || []);
    const banks = clone(banksResult?.banks || []);
    const papers = clone(papersResult?.papers || []);
    const feedback = clone(feedbackResult?.items || []);
    const messages = clone(messagesResult?.items || []);
    const audit = logs.map(auditRow);
    state = {
      subjects: clone(teaching?.readResource?.('subjects', []) || []),
      taxonomies: clone(teaching?.readResource?.('taxonomies', []) || []),
      activityOverrides: clone(teaching?.readResource?.('activityOverrides', []) || []),
      drafts: clone(courseState.drafts || []), releases: clone(courseState.releases || []), tasks: clone(courseState.tasks || []),
      logs, audit, banks, papers, feedback, messages,
      questionCount: banks.reduce((sum, bank) => sum + Math.max(0, Number(bank.question_count ?? bank.questionCount ?? bank.total) || 0), 0),
      pendingFeedbackCount: feedback.filter(item => ['pending', 'in_progress'].includes(text(item.status))).length,
      deletions: audit.filter(item => /delete|remove/i.test(item.action)),
      loadedAt: new Date().toISOString(),
    };
    return clone(state);
  }

  function ready(options = {}) {
    if (state && options.force !== true) return Promise.resolve(clone(state));
    if (readyPromise) return readyPromise.then(clone);
    readyPromise = load().finally(() => { readyPromise = null; });
    return readyPromise;
  }

  global.KGAdminDomainSummary = Object.freeze({ ready, refresh: () => ready({ force: true }), snapshot: () => clone(state) });
})(window);
