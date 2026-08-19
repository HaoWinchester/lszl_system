'use strict';

/*
 * KGPaperReleaseApi —— 已发布试卷细粒度 API 适配器（P4.6 性能优化第 1 轮）。
 *
 * 取代通过 /api/v1/runtime/state 整包拉取 kg_exam_papers_published_v1（约 7.65MB）
 * 的旧链路：目录走 GET /api/v1/paper-releases/catalog 分页摘要（KB 级），
 * 题目按 release 走 GET /api/v1/paper-releases/{id}/questions 分页冻结快照，
 * 单响应受服务端 1MB 上限约束。
 *
 * - 目录在注入后立即预取，载入完成后广播 kg:published-papers-changed 与
 *   kg-app-storage-change（旧键名），让既有页面监听器失效缓存并重渲染。
 * - 题目按需拉取：同一 release 的题目分页串行（保序），不同 release 由调用方并发。
 * - 所有数据只进内存缓存，不写回 localStorage。
 */
(function (global) {
  const API_ROOT = '/api/v1/paper-releases';
  const CATALOG_PAGE_SIZE = 100;
  const QUESTIONS_PAGE_SIZE = 50;
  const MODES = Object.freeze(['practice_mode', 'deep_recall', 'multi_question_canvas', 'single_deep_study']);

  const state = {
    catalog: [],          // 轻量目录（normalize 后）
    catalogById: new Map(),
    details: new Map(),   // releaseId -> release（normalize 后，含 questions refs）
    questions: new Map(), // releaseId -> { items, fetchedAt, seed }
    loadedAt: 0,
    error: null,
  };
  let readyPromise = null;

  function text(value) { return String(value == null ? '' : value); }
  function number(value, fallback) {
    const result = Number(value);
    const base = Number.isFinite(result) ? result : fallback;
    return Number.isFinite(base) ? base : 0;
  }
  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return value; }
  }

  async function request(path) {
    const response = await global.fetch(`${API_ROOT}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (response.status === 401) {
      try { global.dispatchEvent(new CustomEvent('kg:auth-required')); } catch (error) {}
      const authError = new Error('登录状态已失效，请重新登录。');
      authError.status = 401;
      throw authError;
    }
    if (response.status === 403) {
      const forbidden = new Error('当前账号没有权限访问这份发布内容。');
      forbidden.status = 403;
      throw forbidden;
    }
    if (!response.ok) {
      const error = new Error(`发布试卷请求失败 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function accessLevelOf(row) {
    const raw = text(row?.accessPolicy?.accessLevel || row?.accessLevel).toLowerCase();
    return ['member', 'vip', 'paid', 'premium'].includes(raw) ? 'member' : 'free';
  }

  function normalizeCatalogRow(row) {
    row = row && typeof row === 'object' ? row : {};
    const releaseId = text(row.releaseId || row.id);
    const questionCount = number(row.questionCount ?? row.configuredCount ?? row.totalCount, 0);
    return {
      id: text(row.paperId || releaseId),
      paperId: text(row.paperId),
      releaseId,
      version: number(row.version, 0),
      name: text(row.name || row.title || '未命名试卷'),
      title: text(row.title || row.name || '未命名试卷'),
      subject: text(row.subject || 'PMP'),
      description: text(row.description),
      categoryId: text(row.categoryId),
      categoryName: text(row.categoryName),
      purpose: text(row.purpose || 'learning'),
      status: text(row.status || 'published').toLowerCase() || 'published',
      enabledModes: Array.isArray(row.enabledModes) && row.enabledModes.length
        ? row.enabledModes.map(text).filter(mode => MODES.includes(mode))
        : MODES.slice(),
      modeConfigVersion: number(row.modeConfigVersion, 2),
      publishedAt: number(row.publishedAt, 0),
      publishedBy: text(row.publishedBy),
      withdrawnAt: number(row.withdrawnAt, 0),
      totalCount: questionCount,
      configuredCount: questionCount,
      contentRestricted: row.contentRestricted === true,
      updatedAt: number(row.updatedAt || row.publishedAt, 0),
      allowedRoles: Array.isArray(row.allowedRoles) ? row.allowedRoles.map(text).filter(Boolean) : [],
      accessPolicy: { accessLevel: accessLevelOf(row) },
      // 目录层没有题目引用与快照——按需通过 /questions 获取
      questions: [],
      questionSnapshots: [],
      source: 'paper-release-api',
      current: true,
      availability: 'published',
    };
  }

  function replaceCatalog(rows) {
    const catalog = (Array.isArray(rows) ? rows : [])
      .map(normalizeCatalogRow)
      .filter(row => row.releaseId);
    const catalogById = new Map(catalog.map(row => [row.releaseId, row]));
    const changed = catalog.length !== state.catalog.length
      || catalog.some((row, index) => row.releaseId !== state.catalog[index]?.releaseId
        || row.updatedAt !== state.catalog[index]?.updatedAt);
    state.catalog = catalog;
    state.catalogById = catalogById;
    state.loadedAt = Date.now();
    return changed;
  }

  function announceChange() {
    // 与旧 runtime 键失效协议保持一致：59-repo / 60 / 77 / 86 监听这些事件重渲染
    try {
      global.dispatchEvent(new CustomEvent('kg:published-papers-changed', { detail: { source: 'paper-release-api' } }));
      for (const key of ['kg_exam_papers_published_v1', 'kg_exam_paper_release_history_v1']) {
        global.dispatchEvent(new CustomEvent('kg-app-storage-change', { detail: { key, value: null } }));
      }
    } catch (error) {}
  }

  async function loadCatalog({ announce = true } = {}) {
    const rows = [];
    let page = 1;
    // 目录分页拉全（每页 100 条摘要，总量 KB 级）
    for (;;) {
      const payload = await request(`/catalog?page=${page}&pageSize=${CATALOG_PAGE_SIZE}`);
      const batch = Array.isArray(payload.releases) ? payload.releases : [];
      rows.push(...batch);
      const total = number(payload.total, rows.length);
      if (!batch.length || rows.length >= total || page >= 50) break;
      page += 1;
    }
    const changed = replaceCatalog(rows);
    if (announce && changed) announceChange();
    return state.catalog;
  }

  function catalog() {
    return state.catalog.map(clone);
  }

  function findInCatalog(releaseId) {
    return state.catalogById.get(text(releaseId)) || null;
  }

  async function detail(releaseId) {
    const id = text(releaseId);
    if (!id) return null;
    if (state.details.has(id)) return state.details.get(id);
    const payload = await request(`/${encodeURIComponent(id)}`);
    const row = payload && payload.release ? normalizeCatalogRow(payload.release) : null;
    if (!row) return null;
    // 详情可能来自 superseded 历史 release
    row.current = state.catalogById.has(id);
    row.availability = row.status === 'withdrawn' ? 'withdrawn' : (row.current ? 'published' : 'superseded');
    state.details.set(id, row);
    return row;
  }

  async function fetchQuestions(releaseId, { seed = '', maxCount = 0 } = {}) {
    const id = text(releaseId);
    if (!id) return { items: [], release: null };
    const cached = state.questions.get(id);
    const wanted = maxCount > 0 ? Math.min(maxCount, cached?.total || Infinity) : 0;
    if (cached && (!wanted || cached.items.length >= Math.min(wanted, cached.total))) {
      return { items: cached.items.slice(0, wanted || undefined), release: cached.release, total: cached.total };
    }
    const items = [];
    let offset = 0;
    let total = 0;
    let releaseRow = null;
    let guard = 0;
    // 分页串行保序；服务端按 1MB 上限截断（responseTruncated）时尽量续拉
    for (;;) {
      guard += 1;
      if (guard > 100) break;
      const query = new URLSearchParams({ limit: String(QUESTIONS_PAGE_SIZE), offset: String(offset) });
      if (seed) query.set('seed', seed);
      const payload = await request(`/${encodeURIComponent(id)}/questions?${query.toString()}`);
      releaseRow = payload.release ? normalizeCatalogRow(payload.release) : releaseRow;
      total = number(payload.total, total);
      const batch = Array.isArray(payload.questions) ? payload.questions : [];
      for (const row of batch) {
        items.push({
          bankId: text(row.bankId),
          questionId: text(row.questionId || row.question?.id),
          order: number(row.orderIndex, items.length),
          snapshot: {
            bankId: text(row.bankId),
            questionId: text(row.questionId || row.question?.id),
            question: row.question || null,
          },
        });
      }
      offset = number(payload.nextOffset, offset + batch.length);
      if (!batch.length || offset >= total) break;
      if (maxCount > 0 && items.length >= maxCount) break;
    }
    const release = releaseRow || findInCatalog(id);
    state.questions.set(id, { items, total: total || items.length, seed, release });
    return { items: maxCount > 0 ? items.slice(0, maxCount) : items, release, total: total || items.length };
  }

  function invalidate({ keepCatalog = true } = {}) {
    state.details.clear();
    state.questions.clear();
    if (!keepCatalog) {
      state.catalog = [];
      state.catalogById = new Map();
    }
  }

  function reload() {
    return ready({ force: true });
  }

  async function ready({ force = false } = {}) {
    if (!force && readyPromise) return readyPromise;
    readyPromise = (async () => {
      try {
        await loadCatalog({ announce: !force });
        state.error = null;
      } catch (error) {
        state.error = error;
        // 失败不冻结页面：目录为空时页面呈现“暂无”，可重试
        if (force) throw error;
      }
      return state.catalog;
    })();
    return readyPromise;
  }

  // 教师发布/撤回后调用（内容变化 → 全量失效并重载目录）
  global.addEventListener('kg:paper-release-published', () => {
    invalidate({ keepCatalog: false });
    readyPromise = null;
    ready({ force: true }).then(() => announceChange()).catch(() => {});
  });

  const api = Object.freeze({
    ready,
    reload,
    catalog,
    findInCatalog,
    detail,
    fetchQuestions,
    invalidate,
    error: () => state.error,
  });

  global.KGPaperReleaseApi = api;

  // 未登录时静默：请求会 401，目录保持空；登录成功事件后再试
  ready();
  global.addEventListener('kg:auth-session-changed', event => {
    if (!event?.detail?.authenticated) return;
    invalidate({ keepCatalog: false });
    readyPromise = null;
    ready().then(() => announceChange()).catch(() => {});
  });
})(typeof window !== 'undefined' ? window : globalThis);
