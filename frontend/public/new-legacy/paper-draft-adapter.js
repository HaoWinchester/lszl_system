'use strict';

/*
 * KGPaperDraftApi —— 试卷草稿、分类、导入与并行组卷的关系型 API 入口。
 *
 * 该适配器只保存当前页面生命周期内的请求状态；所有业务数据均以服务端响应为准。
 */
(function (global) {
  const API_ROOT = '/api/v1';
  let readyPromise = null;

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return value; }
  }

  function text(value) { return String(value == null ? '' : value); }

  function errorMessage(status, detail) {
    if (detail && !Array.isArray(detail) && detail.message) return text(detail.message);
    if (status === 401) return '登录状态已失效，请重新登录。';
    if (status === 403) return '当前账号没有试卷管理权限。';
    if (status === 409) return '数据已发生变化，请刷新后重试。';
    if (status === 422) return '提交内容未通过校验，请检查后重试。';
    return `试卷请求失败 (${status})`;
  }

  function normalizedError(status, payload) {
    const detail = payload && Object.prototype.hasOwnProperty.call(payload, 'detail')
      ? payload.detail
      : payload;
    const error = new Error(errorMessage(status, detail));
    error.status = status;
    error.code = !Array.isArray(detail) && detail && detail.code
      ? text(detail.code)
      : (status === 422 ? 'VALIDATION_ERROR' : `HTTP_${status}`);
    error.detail = clone(detail);
    if (!Array.isArray(detail) && detail && detail.currentRevision !== undefined) {
      error.currentRevision = detail.currentRevision;
    }
    return error;
  }

  async function request(path, { method = 'GET', body } = {}) {
    const headers = { accept: 'application/json' };
    const options = { method, credentials: 'include', headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await global.fetch(`${API_ROOT}${path}`, options);
    let payload = null;
    try { payload = await response.json(); } catch (error) {}
    if (!response.ok) {
      if (response.status === 401) {
        try { global.dispatchEvent(new CustomEvent('kg:auth-required')); } catch (error) {}
      }
      throw normalizedError(response.status, payload);
    }
    return clone(payload);
  }

  function announce(action, payload) {
    try {
      global.dispatchEvent(new CustomEvent('kg:paper-drafts-changed', {
        detail: { action, payload: clone(payload), source: 'paper-draft-api' },
      }));
    } catch (error) {}
  }

  async function list(options = {}) {
    const query = new URLSearchParams();
    if (options && options.status) query.set('status', text(options.status));
    const payload = await request(`/papers${query.toString() ? `?${query}` : ''}`);
    return Array.isArray(payload?.papers) ? clone(payload.papers) : [];
  }

  async function detail(paperId) {
    const payload = await request(`/papers/${encodeURIComponent(text(paperId))}`);
    return payload?.paper ? clone(payload.paper) : null;
  }

  async function mutate(action, path, method, body) {
    const payload = await request(path, { method, body });
    announce(action, payload);
    return payload;
  }

  async function create(body) {
    const payload = await mutate('create', '/papers', 'POST', body);
    return clone(payload.paper);
  }

  async function update(paperId, body) {
    const payload = await mutate(
      'update',
      `/papers/${encodeURIComponent(text(paperId))}`,
      'PUT',
      body,
    );
    return clone(payload.paper);
  }

  async function replaceQuestions(paperId, body) {
    const payload = await mutate(
      'replaceQuestions',
      `/papers/${encodeURIComponent(text(paperId))}/questions`,
      'PUT',
      body,
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
    return mutate(
      'remove',
      `/papers/${encodeURIComponent(text(paperId))}${suffix}`,
      'DELETE',
    );
  }

  async function lifecycle(paperId, action, revision) {
    const query = new URLSearchParams();
    if (revision !== undefined && revision !== null) query.set('revision', text(revision));
    const suffix = query.toString() ? `?${query}` : '';
    const payload = await mutate(
      action,
      `/papers/${encodeURIComponent(text(paperId))}/${action}${suffix}`,
      'POST',
    );
    return clone(payload.paper);
  }

  async function listCategories() {
    const payload = await request('/paper-categories');
    return Array.isArray(payload?.categories) ? clone(payload.categories) : [];
  }

  async function createCategory(body) {
    const payload = await mutate('createCategory', '/paper-categories', 'POST', body);
    return clone(payload.category);
  }

  async function updateCategory(categoryId, body) {
    const payload = await mutate(
      'updateCategory',
      `/paper-categories/${encodeURIComponent(text(categoryId))}`,
      'PUT',
      body,
    );
    return clone(payload.category);
  }

  async function removeCategory(categoryId, revision) {
    const query = new URLSearchParams();
    if (revision !== undefined && revision !== null) query.set('revision', text(revision));
    const suffix = query.toString() ? `?${query}` : '';
    return mutate(
      'removeCategory',
      `/paper-categories/${encodeURIComponent(text(categoryId))}${suffix}`,
      'DELETE',
    );
  }

  async function importPreflight(body) {
    const payload = await request('/papers/import/preflight', { method: 'POST', body });
    return clone(payload.preflight);
  }

  async function importPaper(body) {
    const payload = await mutate('import', '/papers/import', 'POST', body);
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
    );
    return clone(payload.result);
  }

  function ready() {
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
