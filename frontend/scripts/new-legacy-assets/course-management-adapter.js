'use strict';

;(function (global) {
  const API = global.KGDomainApi;
  if (!API?.request) throw new Error('课程管理 API 客户端未就绪');

  const clone = value => {
    if (value === undefined) return undefined;
    try { return global.structuredClone ? global.structuredClone(value) : JSON.parse(JSON.stringify(value)); } catch (_error) { return value; }
  };
  const text = value => String(value ?? '').trim();
  let state = { drafts: [], releases: [], tasks: [] };
  let readyPromise = null;
  let generation = 0;
  let hydrated = false;

  function draftFromDto(row) {
    return {
      ...clone(row?.structure || {}), id: text(row?.id), name: text(row?.name),
      status: text(row?.status) || 'draft', revision: Number(row?.revision) || 1,
      ownerId: text(row?.ownerId), createdBy: text(row?.createdBy), updatedBy: text(row?.updatedBy),
      createdAt: text(row?.createdAt), updatedAt: text(row?.updatedAt),
    };
  }

  function taskFromDto(row) {
    const content = clone(row?.content || {});
    return {
      ...content, content, id: text(row?.id), title: text(row?.title),
      description: text(row?.description), releaseId: text(row?.releaseId),
      audience: clone(row?.audience || {}), status: text(row?.status) || 'draft',
      revision: Number(row?.revision) || 1, ownerId: text(row?.ownerId),
      createdBy: text(row?.createdBy), updatedBy: text(row?.updatedBy),
      createdAt: text(row?.createdAt), updatedAt: text(row?.updatedAt),
    };
  }

  function publish(action, payload) {
    try { global.dispatchEvent?.(new global.CustomEvent('kg:course-management-changed', { detail: { action, payload: clone(payload) } })); } catch (_error) {}
  }

  function snapshot() { return clone(state); }

  async function request(options) { return clone(await API.request(options)); }

  async function refresh(options = {}) {
    const currentGeneration = ++generation;
    const task = Promise.all([
      request({ path: '/api/v1/course-management/drafts' }),
      request({ path: '/api/v1/course-management/releases' }),
      request({ path: '/api/v1/course-management/tasks' }),
    ]).then(([draftResult, releaseResult, taskResult]) => {
      const next = {
        drafts: (draftResult?.drafts || []).map(draftFromDto),
        releases: clone(releaseResult?.releases || []),
        tasks: (taskResult?.tasks || []).map(taskFromDto),
      };
      if (currentGeneration === generation) { state = next; hydrated = true; }
      return clone(next);
    }).finally(() => { if (readyPromise === task) readyPromise = null; });
    if (options.trackReady !== false) readyPromise = task;
    return task;
  }

  function ready(options = {}) {
    if (options.force === true) return refresh();
    if (readyPromise) return readyPromise.then(clone);
    if (hydrated) return Promise.resolve(snapshot());
    return refresh();
  }

  function replaceRow(name, row) {
    const rows = state[name].slice();
    const index = rows.findIndex(item => item.id === row.id);
    if (index >= 0) rows[index] = clone(row); else rows.unshift(clone(row));
    state = { ...state, [name]: rows };
  }

  function removeRow(name, id) {
    state = { ...state, [name]: state[name].filter(item => item.id !== text(id)) };
  }

  async function mutation(action, options, settle) {
    try {
      const result = await request(options);
      settle?.(result);
      publish(action, result);
      return result;
    } catch (error) {
      if (error?.status === 409) await refresh({ trackReady: false });
      throw error;
    }
  }

  const draftMetadata = new Set(['id', 'ownerId', 'name', 'status', 'revision', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt']);
  function draftStructure(course) {
    return Object.fromEntries(Object.entries(clone(course || {})).filter(([key]) => !draftMetadata.has(key)));
  }

  async function createDraft(course) {
    const source = clone(course || {});
    const result = await mutation('draft.create', {
      method: 'POST', path: '/api/v1/course-management/drafts',
      body: { name: text(source.name) || '未命名课程', structure: draftStructure(source) },
    }, payload => replaceRow('drafts', draftFromDto(payload.draft)));
    return draftFromDto(result.draft);
  }

  async function updateDraft(id, patch, revision) {
    const changes = clone(patch || {});
    const body = {};
    if (Object.prototype.hasOwnProperty.call(changes, 'name')) body.name = text(changes.name);
    if (Object.prototype.hasOwnProperty.call(changes, 'status')) body.status = changes.status;
    const structureKeys = Object.keys(changes).filter(key => !draftMetadata.has(key));
    if (structureKeys.length) {
      const current = state.drafts.find(item => item.id === text(id)) || {};
      body.structure = draftStructure({ ...current, ...changes });
    }
    const result = await mutation('draft.update', {
      method: 'PUT', path: `/api/v1/course-management/drafts/${encodeURIComponent(text(id))}`,
      body: { ...body, revision: Number(revision) },
    }, payload => replaceRow('drafts', draftFromDto(payload.draft)));
    return draftFromDto(result.draft);
  }

  async function saveDraft(course) {
    const current = state.drafts.find(item => item.id === text(course?.id));
    return current
      ? updateDraft(current.id, course, Number(current.revision))
      : createDraft(course);
  }

  function createDraftSaveQueue() {
    let epoch = 0;
    let tail = Promise.resolve();
    return Object.freeze({
      save(course) {
        const queuedEpoch = epoch;
        const task = tail.catch(() => {}).then(async () => {
          if (queuedEpoch !== epoch) return null;
          try { return await saveDraft(course); } catch (error) { epoch += 1; throw error; }
        });
        tail = task;
        return task;
      },
    });
  }

  async function deleteDraft(id, revision) {
    const result = await mutation('draft.delete', {
      method: 'DELETE', path: `/api/v1/course-management/drafts/${encodeURIComponent(text(id))}`,
      body: { revision: Number(revision) },
    }, () => removeRow('drafts', id));
    return clone(result);
  }

  async function publishDraft(id, notes, revision) {
    const result = await mutation('draft.publish', {
      method: 'POST', path: `/api/v1/course-management/drafts/${encodeURIComponent(text(id))}/publish`,
      body: { revision: Number(revision), notes: text(notes) },
    }, payload => {
      replaceRow('drafts', draftFromDto(payload.draft));
      replaceRow('releases', clone(payload.release));
    });
    return { draft: draftFromDto(result.draft), release: clone(result.release) };
  }

  async function withdrawRelease(id, revision) {
    const result = await mutation('release.withdraw', {
      method: 'POST', path: `/api/v1/course-management/releases/${encodeURIComponent(text(id))}/withdraw`,
      body: { revision: Number(revision) },
    }, payload => replaceRow('releases', clone(payload.release)));
    return clone(result.release);
  }

  const taskMetadata = new Set(['id', 'ownerId', 'title', 'description', 'releaseId', 'audience', 'status', 'revision', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'content']);
  const taskContent = task => Object.fromEntries(Object.entries(clone(task || {})).filter(([key]) => !taskMetadata.has(key)));
  function taskBody(task, includeAll = true) {
    const source = clone(task || {});
    const body = {};
    for (const key of ['title', 'description', 'releaseId', 'audience', 'status']) {
      if (includeAll || Object.prototype.hasOwnProperty.call(source, key)) body[key] = clone(source[key]);
    }
    const contentKeys = Object.keys(source).filter(key => !taskMetadata.has(key));
    if (includeAll || contentKeys.length) body.content = taskContent(source);
    return body;
  }

  async function createTask(task) {
    const result = await mutation('task.create', {
      method: 'POST', path: '/api/v1/course-management/tasks', body: taskBody(task),
    }, payload => replaceRow('tasks', taskFromDto(payload.task)));
    return taskFromDto(result.task);
  }

  async function updateTask(id, patch, revision) {
    const current = state.tasks.find(item => item.id === text(id)) || {};
    const merged = { ...current, ...clone(patch || {}) };
    const body = taskBody(merged);
    body.revision = Number(revision);
    const result = await mutation('task.update', {
      method: 'PUT', path: `/api/v1/course-management/tasks/${encodeURIComponent(text(id))}`, body,
    }, payload => replaceRow('tasks', taskFromDto(payload.task)));
    return taskFromDto(result.task);
  }

  async function saveTask(task) {
    const current = state.tasks.find(item => item.id === text(task?.id));
    return current
      ? updateTask(current.id, task, Number(current.revision))
      : createTask(task);
  }

  async function deleteTask(id, revision) {
    const result = await mutation('task.delete', {
      method: 'DELETE', path: `/api/v1/course-management/tasks/${encodeURIComponent(text(id))}`,
      body: { revision: Number(revision) },
    }, () => removeRow('tasks', id));
    return clone(result);
  }

  global.KGCourseManagementApi = Object.freeze({
    ready, refresh, snapshot,
    listDrafts: () => clone(state.drafts), listReleases: () => clone(state.releases), listTasks: () => clone(state.tasks),
    createDraft, updateDraft, saveDraft, createDraftSaveQueue, deleteDraft, publishDraft, withdrawRelease,
    createTask, updateTask, saveTask, deleteTask,
  });
})(window);
