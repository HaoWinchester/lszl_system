'use strict';

/*
 * KGPaperReleaseApi —— 已发布试卷细粒度 API 适配器（P4.6 性能优化第 1 轮）。
 *
 * 目录走 GET /api/v1/paper-releases/catalog 分页摘要（KB 级），
 * 题目按 release 走 GET /api/v1/paper-releases/{id}/questions 分页冻结快照，
 * 单响应受服务端 1MB 上限约束。
 *
 * - 大厅只预取第一页摘要，其他页面保持既有目录行为；完成后广播 kg:published-papers-changed。
 * - 题目按需拉取：同一 release 的题目分页串行（保序），不同 release 由调用方并发。
 * - 所有数据只进内存缓存，不写回 localStorage。
 */
(function (global) {
  const API_ROOT = '/api/v1/paper-releases';
  const DomainApi = global.KGDomainApi;
  const CATALOG_PAGE_SIZE = 100;
  const PRACTICE_CATALOG_PAGE_SIZE = 12;
  const practiceCatalog = /(?:^|\/)practice-mode\.html$/.test(text(global.location?.pathname));
  const QUESTIONS_PAGE_SIZE = 50;
  const MODES = Object.freeze(['practice_mode', 'deep_recall', 'multi_question_canvas', 'single_deep_study']);

  const state = {
    catalog: [],          // 轻量目录（normalize 后）
    catalogById: new Map(),
    selectedSummaries: new Map(), // [identifier field, id] -> exact published summary (or null)
    selectedSummaryLoads: new Map(),
    details: new Map(),   // releaseId -> release（normalize 后，含 questions refs）
    questions: new Map(), // releaseId -> { items, fetchedAt, seed }
    questionLoads: new Map(), // releaseId + seed + maxCount -> in-flight Promise
    loadedAt: 0,
    error: null,
    catalogStatus: 'loading',
  };
  let readyPromise = null;
  let catalogEpoch = 0;
  let catalogQueryVersion = 0;
  let pendingCatalogQuery = null;
  let catalogQuery = { page: 1, pageSize: practiceCatalog ? PRACTICE_CATALOG_PAGE_SIZE : CATALOG_PAGE_SIZE,
    search: '', subject: '', access: 'all', append: false };
  let catalogPaging = { ...catalogQuery, total: 0, subjects: [], hasMore: false };

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

  async function request(path, { method = 'GET', body } = {}) {
    if (!DomainApi?.request) throw new Error('试卷发布 API 未加载，请刷新页面后重试。');
    try {
      return await DomainApi.request({ method, path: `${API_ROOT}${path}`, body });
    } catch (error) {
      if (error?.status === 401) {
        try { (global.document || global).dispatchEvent(new CustomEvent('kg:auth-required', { bubbles: true })); } catch (dispatchError) {}
      }
      throw error;
    }
  }

  async function publish(paperId, body) {
    const id = text(paperId);
    if (!id) throw new Error('请先选择试卷。');
    const response = await request(`/papers/${encodeURIComponent(id)}/publish`, { method: 'POST', body });
    return clone(response?.release || null);
  }

  async function preflight(paperId) {
    const id = text(paperId);
    if (!id) throw new Error('请先选择试卷。');
    return clone(await request(`/papers/${encodeURIComponent(id)}/preflight`));
  }

  async function withdrawPaper(paperId) {
    const id = text(paperId);
    if (!id) throw new Error('请先选择试卷。');
    const response = await request(`/papers/${encodeURIComponent(id)}/withdraw-all`, { method: 'POST' });
    return Math.max(0, number(response?.withdrawn, 0));
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
      coverage: row.coverage ? clone(row.coverage) : null,
      ...(typeof row.contentRestricted === 'boolean' ? { contentRestricted: row.contentRestricted } : {}),
      updatedAt: number(row.updatedAt || row.publishedAt, 0),
      allowedRoles: Array.isArray(row.allowedRoles) ? row.allowedRoles.map(text).filter(Boolean) : [],
      accessPolicy: { accessLevel: accessLevelOf(row) },
      // 目录层没有题目引用与快照——按需通过 /questions 获取
      questions: [],
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
    try {
      global.dispatchEvent(new CustomEvent('kg:published-papers-changed', { detail: { source: 'paper-release-api' } }));
    } catch (error) {}
  }

  async function loadCatalog({ announce = true, epoch = catalogEpoch } = {}) {
    const rows = [];
    let page = 1;
    // 目录分页拉全（每页 100 条摘要，总量 KB 级）
    for (;;) {
      const payload = await request(`/catalog?page=${page}&pageSize=${CATALOG_PAGE_SIZE}`);
      const batch = Array.isArray(payload.releases) ? payload.releases : [];
      rows.push(...batch);
      const total = number(payload.total, rows.length);
      if (!batch.length || rows.length >= total) break;
      page += 1;
    }
    if (epoch !== catalogEpoch) return state.catalog;
    const changed = replaceCatalog(rows);
    if (announce && changed) announceChange();
    return state.catalog;
  }

  function catalog() {
    return state.catalog.map(clone);
  }

  function catalogPage() {
    const { append, ...page } = catalogPaging;
    return clone(page);
  }

  // 兼容旧记录与跳转参数：精确查询当前发布摘要，不扫描目录或读取冻结正文。
  function findPublishedSummary(field, value) {
    const id = text(value).trim();
    if (!id) return Promise.resolve(null);
    const key = JSON.stringify([field, id]);
    if (state.selectedSummaries.has(key)) return Promise.resolve(clone(state.selectedSummaries.get(key)));
    if (state.selectedSummaryLoads.has(key)) return state.selectedSummaryLoads.get(key);
    const epoch = catalogEpoch;
    const params = new URLSearchParams({ page: '1', pageSize: '1', mode: 'practice_mode', [field]: id });
    const operation = (async () => {
      try {
        const payload = await request(`/catalog?${params.toString()}`);
        if (epoch !== catalogEpoch) return null;
        const exact = (Array.isArray(payload.releases) ? payload.releases : [])
          .find(row => text(field === 'releaseId' ? row?.releaseId || row?.id : row?.paperId) === id
            && text(row?.releaseId || row?.id));
        const row = exact ? normalizeCatalogRow(exact) : null;
        state.selectedSummaries.set(key, row);
        return clone(row);
      } finally {
        if (state.selectedSummaryLoads.get(key) === operation) state.selectedSummaryLoads.delete(key);
      }
    })();
    state.selectedSummaryLoads.set(key, operation);
    return operation;
  }

  function findPublishedPaper(paperId) { return findPublishedSummary('paperId', paperId); }
  function findPublishedRelease(releaseId) { return findPublishedSummary('releaseId', releaseId); }

  // 大厅只读取请求的这一页；搜索、科目与权限过滤由服务端统一执行。
  function queryCatalog({ page = 1, pageSize = 12, search = '', subject = '', access = 'all', append = false } = {}) {
    const query = {
      page: Math.max(1, Math.floor(number(page, 1))),
      pageSize: Math.min(100, Math.max(1, Math.floor(number(pageSize, 12)))),
      search: text(search).trim(), subject: text(subject).trim(),
      access: ['free', 'member'].includes(access) ? access : 'all', append: append === true,
    };
    const key = JSON.stringify(query);
    if (pendingCatalogQuery?.key === key) return pendingCatalogQuery.promise;
    const sameCriteria = ['search', 'subject', 'access', 'pageSize'].every(field => query[field] === catalogQuery[field]);
    // Never combine pages from different filters, even if a caller passes append.
    query.append = query.append && sameCriteria;
    catalogQuery = query;
    const epoch = catalogEpoch;
    const version = ++catalogQueryVersion;
    if (!sameCriteria) {
      replaceCatalog([]);
      catalogPaging = { ...query, total: 0, subjects: catalogPaging.subjects, hasMore: false };
    }
    // 分页游标只在响应成功后提交；失败时“加载更多”仍应重试同一页。
    // catalogQuery 单独保留待请求条件，供 reload() 显式重试。
    state.catalogStatus = 'loading';
    state.error = null;
    announceChange();
    const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
    if (practiceCatalog) params.set('mode', 'practice_mode');
    if (query.search) params.set('search', query.search);
    if (query.subject) params.set('subject', query.subject);
    if (query.access !== 'all') params.set('access', query.access);
    const current = () => epoch === catalogEpoch && version === catalogQueryVersion;
    const operation = (async () => {
      try {
        const payload = await request(`/catalog?${params.toString()}`);
        if (!current()) return catalog();
        const batch = Array.isArray(payload.releases) ? payload.releases : [];
        const rows = query.append ? [...state.catalog, ...batch] : batch;
        const byId = new Map(rows.map(row => [text(row.releaseId || row.id), row]));
        replaceCatalog([...byId.values()]);
        const total = Math.max(0, number(payload.total, state.catalog.length));
        catalogPaging = { ...query, total,
          subjects: Array.isArray(payload.subjects) ? payload.subjects.map(text).filter(Boolean) : [],
          hasMore: batch.length > 0 && query.page * query.pageSize < total };
        state.error = null;
        state.catalogStatus = 'ready';
        return catalog();
      } catch (error) {
        if (current()) { state.error = error; state.catalogStatus = 'error'; }
        throw error;
      } finally {
        if (current()) { pendingCatalogQuery = null; announceChange(); }
      }
    })();
    pendingCatalogQuery = { key, promise: operation };
    // ready() always follows the most recently requested criteria, with its
    // historical non-throwing initialization contract.
    readyPromise = operation.catch(() => catalog());
    return operation;
  }

  function normalizeManagementRow(row) {
    const release = normalizeCatalogRow(row);
    const questions = (Array.isArray(row?.questions) ? row.questions : []).map((item, index) => ({
      bankId: text(item?.bankId),
      questionId: text(item?.questionId || item?.id),
      order: Math.max(1, number(item?.order, index + 1)),
      score: Math.max(0, number(item?.score, 1)),
    })).filter(item => item.bankId && item.questionId);
    return {
      ...release,
      id: release.paperId || release.id,
      status: 'published',
      publishedVersion: number(row?.publishedVersion ?? release.version, release.version),
      publishedReleaseId: text(row?.publishedReleaseId || release.releaseId),
      questions,
      manualQuestionIds: questions.map(item => item.questionId),
      serverReleaseProjection: true,
    };
  }

  async function managementCatalog() {
    const rows = [];
    let page = 1;
    for (;;) {
      const payload = await request(`/management-catalog?page=${page}&pageSize=${CATALOG_PAGE_SIZE}`);
      const batch = Array.isArray(payload.papers) ? payload.papers : [];
      rows.push(...batch.map(normalizeManagementRow));
      const total = number(payload.total, rows.length);
      if (!batch.length || rows.length >= total || page >= 50) break;
      page += 1;
    }
    return rows.map(clone);
  }

  function mergeManagementPapers(drafts, releases) {
    const local = (Array.isArray(drafts) ? drafts : []).map(clone);
    const releaseRows = (Array.isArray(releases) ? releases : []).map(normalizeManagementRow);
    const releaseByPaper = new Map(releaseRows.map(row => [text(row.paperId || row.id), row]));
    const merged = local.map(draft => {
      const paperId = text(draft?.id || draft?.paperId);
      const release = releaseByPaper.get(paperId);
      if (!release) return draft;
      releaseByPaper.delete(paperId);
      const draftQuestions = Array.isArray(draft?.questions) && draft.questions.length
        ? clone(draft.questions)
        : clone(release.questions);
      return {
        ...release,
        ...draft,
        id: paperId,
        paperId,
        status: 'published',
        publishedAt: release.publishedAt,
        publishedVersion: release.publishedVersion,
        publishedReleaseId: release.publishedReleaseId,
        enabledModes: clone(release.enabledModes),
        accessPolicy: clone(release.accessPolicy),
        questions: draftQuestions,
        serverReleaseProjection: true,
      };
    });
    return [...merged, ...releaseByPaper.values()].map(clone);
  }

  function findInCatalog(releaseId) {
    return state.catalogById.get(text(releaseId)) || null;
  }

  async function detail(releaseId) {
    const id = text(releaseId);
    if (!id) return null;
    if (state.details.has(id)) return state.details.get(id);
    const epoch = catalogEpoch;
    const payload = await request(`/${encodeURIComponent(id)}`);
    if (epoch !== catalogEpoch) return null;
    const row = payload && payload.release ? normalizeCatalogRow(payload.release) : null;
    if (!row) return null;
    // 分页目录中未出现并不代表已被替换；详情状态由服务端确定。
    row.current = practiceCatalog ? row.status === 'published' : state.catalogById.has(id);
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
    const loadKey = JSON.stringify([id, text(seed), Math.max(0, number(maxCount, 0))]);
    const pending = state.questionLoads.get(loadKey);
    if (pending) return pending;
    const epoch = catalogEpoch;
    const operation = (async () => {
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
        if (epoch !== catalogEpoch) return { items: [], release: null, total: 0 };
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
    })();
    state.questionLoads.set(loadKey, operation);
    try {
      return await operation;
    } finally {
      if (state.questionLoads.get(loadKey) === operation) state.questionLoads.delete(loadKey);
    }
  }

  function invalidate({ keepCatalog = true } = {}) {
    catalogEpoch += 1;
    catalogQueryVersion += 1;
    pendingCatalogQuery = null;
    readyPromise = null;
    state.details.clear();
    state.selectedSummaries.clear();
    state.selectedSummaryLoads.clear();
    state.questions.clear();
    state.questionLoads.clear();
    if (!keepCatalog) {
      state.catalog = [];
      state.catalogById = new Map();
      catalogQuery = { ...catalogQuery, page: 1, append: false };
      catalogPaging = { ...catalogQuery, total: 0, subjects: [], hasMore: false };
    }
  }

  function reload() {
    return ready({ force: true });
  }

  async function ready({ force = false } = {}) {
    if (!force && readyPromise) return readyPromise;
    if (practiceCatalog) {
      const operation = queryCatalog(catalogQuery);
      return force ? operation : readyPromise;
    }
    const epoch = catalogEpoch;
    state.catalogStatus = 'loading';
    announceChange();
    readyPromise = (async () => {
      try {
        await loadCatalog({ announce: false, epoch });
        if (epoch === catalogEpoch) { state.error = null; state.catalogStatus = 'ready'; }
      } catch (error) {
        if (epoch !== catalogEpoch) return state.catalog;
        state.error = error;
        state.catalogStatus = 'error';
        // Keep the failure distinct from a successfully loaded empty catalog.
        if (force) throw error;
      } finally {
        if (epoch === catalogEpoch) announceChange();
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
    queryCatalog,
    catalogPage,
    findPublishedPaper,
    findPublishedRelease,
    managementCatalog,
    mergeManagementPapers,
    publish,
    preflight,
    withdrawPaper,
    findInCatalog,
    detail,
    fetchQuestions,
    invalidate,
    error: () => state.error,
    catalogStatus: () => state.catalogStatus,
  });

  global.KGPaperReleaseApi = api;

  // 游客也可读取目录摘要；登录和退出后重新获取当前角色可见目录。
  ready();
  global.addEventListener('kg:auth-session-changed', event => {
    invalidate({ keepCatalog: false });
    announceChange();
    readyPromise = null;
    ready().then(() => announceChange()).catch(() => {});
  });
})(typeof window !== 'undefined' ? window : globalThis);
