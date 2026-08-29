'use strict';

/*
 * KGPaperDraftApi —— 试卷草稿、分类、导入与并行组卷的关系型 API 入口。
 *
 * 该适配器只保存当前页面生命周期内的请求状态；所有业务数据均以服务端响应为准。
 */
(function (global) {
  const API_ROOT = '/api/v1';
  const DomainApi = global.KGDomainApi;
  let readyPromise = null;
  let paperListLoad = null;
  let categoryListLoad = null;
  let paperListGeneration = 0;
  const summaryState = { papers: null, categories: null };
  const detailCache = new Map();
  const detailLoads = new Map();

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return value; }
  }

  function text(value) { return String(value == null ? '' : value); }

  async function request(path, { method = 'GET', body } = {}) {
    if (!DomainApi?.request) throw new Error('试卷草稿 API 未加载，请刷新页面后重试。');
    try {
      return clone(await DomainApi.request({ method, path: `${API_ROOT}${path}`, body }));
    } catch (error) {
      if (error?.status === 401) {
        try { global.dispatchEvent(new CustomEvent('kg:auth-required')); } catch (error) {}
      }
      throw error;
    }
  }

  function announce(action, payload) {
    try {
      global.dispatchEvent(new CustomEvent('kg:paper-drafts-changed', {
        detail: { action, payload: clone(payload), source: 'paper-draft-api' },
      }));
    } catch (error) {}
  }

  function invalidatePaper(paperId) {
    const id = text(paperId);
    detailCache.delete(id);
    detailLoads.delete(id);
  }

  function invalidatePaperLists() {
    paperListGeneration += 1;
    summaryState.papers = null;
    paperListLoad = null;
    readyPromise = null;
  }

  function invalidateCategoryLists() {
    summaryState.categories = null;
    categoryListLoad = null;
    readyPromise = null;
  }

  function invalidateLists() {
    invalidatePaperLists();
    invalidateCategoryLists();
  }

  function cachePaper(paper) {
    const id = text(paper?.id);
    if (id) detailCache.set(id, clone(paper));
  }

  async function list(options = {}) {
    const query = new URLSearchParams();
    if (options && options.status) query.set('status', text(options.status));
    const cacheable = !query.toString();
    if (cacheable && options.forceReload === true) invalidatePaperLists();
    if (cacheable && options.forceReload !== true && summaryState.papers) {
      return clone(summaryState.papers);
    }
    if (cacheable && options.forceReload !== true && paperListLoad) return clone(await paperListLoad);
    const generation = paperListGeneration;
    const task = request(`/papers${query.toString() ? `?${query}` : ''}`)
      .then(payload => {
        const papers = Array.isArray(payload?.papers) ? clone(payload.papers) : [];
        if (cacheable && generation === paperListGeneration) summaryState.papers = clone(papers);
        return papers;
      })
      .finally(() => { if (cacheable && paperListLoad === task) paperListLoad = null; });
    if (cacheable) paperListLoad = task;
    return clone(await task);
  }

  async function detail(paperId, options = {}) {
    const id = text(paperId);
    if (!id) return null;
    if (options.forceReload !== true && detailCache.has(id)) return clone(detailCache.get(id));
    if (options.forceReload !== true && detailLoads.has(id)) return clone(await detailLoads.get(id));
    const task = request(`/papers/${encodeURIComponent(id)}`)
      .then(payload => {
        const paper = payload?.paper ? clone(payload.paper) : null;
        if (paper) detailCache.set(id, clone(paper));
        return paper;
      })
      .finally(() => detailLoads.delete(id));
    detailLoads.set(id, task);
    return clone(await task);
  }

  async function mutate(action, path, method, body, settle = () => {}) {
    const payload = await request(path, { method, body });
    settle(payload);
    announce(action, payload);
    return payload;
  }

  async function create(body) {
    const payload = await mutate('create', '/papers', 'POST', body, result => {
      cachePaper(result.paper);
      invalidatePaperLists();
    });
    return clone(payload.paper);
  }

  async function update(paperId, body) {
    const payload = await mutate(
      'update',
      `/papers/${encodeURIComponent(text(paperId))}`,
      'PUT',
      body,
      result => { cachePaper(result.paper); invalidatePaperLists(); },
    );
    return clone(payload.paper);
  }

  async function replaceQuestions(paperId, body) {
    const payload = await mutate(
      'replaceQuestions',
      `/papers/${encodeURIComponent(text(paperId))}/questions`,
      'PUT',
      body,
      result => { cachePaper(result.paper); invalidatePaperLists(); },
    );
    return clone(payload.paper);
  }

  async function remove(paperId, options = {}) {
    const query = new URLSearchParams();
    if (options.revision !== undefined && options.revision !== null) {
      query.set('revision', text(options.revision));
    }
    if (options.reason) query.set('reason', text(options.reason));
    const suffix = query.toString() ? `?${query}` : '';
    const payload = await mutate(
      'remove',
      `/papers/${encodeURIComponent(text(paperId))}${suffix}`,
      'DELETE',
      undefined,
      () => { invalidatePaper(paperId); invalidatePaperLists(); },
    );
    return payload;
  }

  async function lifecycle(paperId, action, revision) {
    const query = new URLSearchParams();
    if (revision !== undefined && revision !== null) query.set('revision', text(revision));
    const suffix = query.toString() ? `?${query}` : '';
    const payload = await mutate(
      action,
      `/papers/${encodeURIComponent(text(paperId))}/${action}${suffix}`,
      'POST',
      undefined,
      result => { cachePaper(result.paper); invalidatePaperLists(); },
    );
    return clone(payload.paper);
  }

  async function listCategories(options = {}) {
    if (options.forceReload !== true && summaryState.categories) return clone(summaryState.categories);
    if (options.forceReload !== true && categoryListLoad) return clone(await categoryListLoad);
    const task = request('/paper-categories')
      .then(payload => {
        const categories = Array.isArray(payload?.categories) ? clone(payload.categories) : [];
        summaryState.categories = clone(categories);
        return categories;
      })
      .finally(() => { categoryListLoad = null; });
    categoryListLoad = task;
    return clone(await task);
  }

  async function createCategory(body) {
    const payload = await mutate('createCategory', '/paper-categories', 'POST', body, invalidateCategoryLists);
    return clone(payload.category);
  }

  async function updateCategory(categoryId, body) {
    const payload = await mutate(
      'updateCategory',
      `/paper-categories/${encodeURIComponent(text(categoryId))}`,
      'PUT',
      body,
      invalidateCategoryLists,
    );
    return clone(payload.category);
  }

  async function removeCategory(categoryId, revision) {
    const query = new URLSearchParams();
    if (revision !== undefined && revision !== null) query.set('revision', text(revision));
    const suffix = query.toString() ? `?${query}` : '';
    const payload = await mutate(
      'removeCategory',
      `/paper-categories/${encodeURIComponent(text(categoryId))}${suffix}`,
      'DELETE',
      undefined,
      invalidateCategoryLists,
    );
    return payload;
  }

  async function importPreflight(body) {
    const payload = await request('/papers/import/preflight', { method: 'POST', body });
    return clone(payload.preflight);
  }

  async function importPaper(body) {
    const payload = await mutate('import', '/papers/import', 'POST', body, invalidatePaperLists);
    return clone(payload.result);
  }

  async function compositionPreflight(body) {
    const payload = await request('/papers/composition/preflight', { method: 'POST', body });
    return clone(payload.preflight);
  }

  async function createCompositionBatch(body) {
    const payload = await mutate(
      'compositionBatch',
      '/papers/composition/batches',
      'POST',
      body,
      invalidatePaperLists,
    );
    return clone(payload.result);
  }

  function ready(options = {}) {
    if (options.forceReload === true) invalidateLists();
    if (!readyPromise) {
      readyPromise = Promise.all([list(), listCategories()])
        .then(([papers, categories]) => clone({ papers, categories }))
        .catch((error) => {
          readyPromise = null;
          throw error;
        });
    }
    return readyPromise.then(clone);
  }

  global.KGPaperDraftApi = Object.freeze({
    ready,
    list,
    detail,
    invalidatePaper,
    invalidateLists,
    create,
    update,
    replaceQuestions,
    remove,
    archive: (paperId, revision) => lifecycle(paperId, 'archive', revision),
    restore: (paperId, revision) => lifecycle(paperId, 'restore', revision),
    publish: (paperId, revision) => lifecycle(paperId, 'publish', revision),
    unpublish: (paperId, revision) => lifecycle(paperId, 'unpublish', revision),
    listCategories,
    createCategory,
    updateCategory,
    removeCategory,
    importPreflight,
    importPaper,
    compositionPreflight,
    createCompositionBatch,
  });
})(globalThis);
