'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const gatewayPath = path.resolve(__dirname, '../src/admin/42-teaching-content-server-gateway.js');
const adminSource = name => fs.readFileSync(path.resolve(__dirname, `../src/admin/${name}`), 'utf8');

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(payload); },
  };
}

function createRuntime(options = {}) {
  let subjects = [{
    id: 'subject-pmp',
    code: 'PMP',
    name: { zh: 'PMP' },
    defaultTaxonomyId: 'taxonomy-pmp-main',
  }];
  let taxonomies = [
    { id: 'taxonomy-pmp-main', subjectId: 'subject-pmp', version: 1, status: 'published', isDefault: true, name: { zh: '旧版知识树' }, nodes: Array.from({ length: 12 }, (_, index) => ({ id: `old-${index}`, level: 1, title: { zh: `旧${index}` } })) },
    { id: 'taxonomy-local-draft', subjectId: 'subject-pmp', version: 3, status: 'draft', isDefault: false, name: { zh: '本地待发布草稿' }, nodes: [{ id: 'draft-root', level: 1, title: { zh: '草稿' } }] },
  ];
  const calls = [];
  let failPut = false;
  let serverTaxonomy = {
    id: 'taxonomy-pmp-complete-v1',
    subjectId: 'subject-pmp',
    version: 2,
    status: 'published',
    name: { zh: 'PMP 完整知识树' },
    nodes: Array.from({ length: 317 }, (_, index) => ({
      id: `server-${index}`,
      taxonomyId: 'taxonomy-pmp-complete-v1',
      parentId: null,
      level: 1,
      title: { zh: `节点${index}` },
      status: 'active',
      sortOrder: index + 1,
    })),
  };
  const listeners = new Map();
  const legacyContent = {
    storageKeys: {},
    getSubjects: () => structuredClone(subjects),
    saveSubjects: rows => {
      if (failSubjectSave) { failSubjectSave = false; return false; }
      subjects = structuredClone(rows);
      return structuredClone(subjects);
    },
    getTaxonomies: subjectId => structuredClone(taxonomies.filter(item => !subjectId || item.subjectId === subjectId)),
    saveTaxonomies: rows => { taxonomies = structuredClone(rows); return { valid: true, taxonomies: structuredClone(taxonomies) }; },
    subjectById: id => structuredClone(subjects.find(item => item.id === id || item.code === id) || null),
    taxonomyById: id => structuredClone(taxonomies.find(item => item.id === id) || null),
    defaultTaxonomyForSubject: id => {
      const subject = subjects.find(item => item.id === id);
      return structuredClone(taxonomies.find(item => item.id === subject?.defaultTaxonomyId) || null);
    },
    nodesForTaxonomy: id => structuredClone(taxonomies.find(item => item.id === id)?.nodes || []),
    nodeById: (taxonomyId, nodeId) => structuredClone(taxonomies.find(item => item.id === taxonomyId)?.nodes?.find(item => item.id === nodeId) || null),
    validateTaxonomy: taxonomy => {
      const errors = [];
      if (!taxonomy?.id) errors.push('知识树缺少 ID。');
      if (!taxonomy?.subjectId) errors.push('知识树缺少科目。');
      const nodeIds = (taxonomy?.nodes || []).map(item => item.id);
      if (new Set(nodeIds).size !== nodeIds.length) errors.push('知识点 ID 重复。');
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    getActivityLibrary: () => ({}), getActivities: () => [], activityTitle: activity => activity?.id || '',
    getCourseDrafts: () => [], getCourseReleases: () => [],
    validateCourse: () => ({ valid: true, errors: [] }), normalizeCourse: course => structuredClone(course),
    saveActivity: value => value, saveActivities: values => values, mapActivities: values => values,
    importActivityPackage: value => value, exportActivityPackage: value => value, activityUsage: () => [],
    saveCourseDraft: value => value, deleteCourseDraft: () => [], publishCourse: () => ({ valid: true }),
    activeCourseRelease: () => null, courseKnowledgeCoverage: () => ({}),
    deleteKnowledgeNode: () => ({ valid: true }), resetTaxonomies: () => ({ subjects: [], taxonomies: [] }),
  };
  let failSubjectSave = false;
  class Repository { constructor() { this.mode = 'test'; } read(_key, fallback) { return structuredClone(fallback); } write() { return true; } keys() { return []; } snapshot() { return {}; } restore() { return { valid: true }; } }
  class Permissions { can() { return true; } require() { return { valid: true }; } }
  class Audit { constructor() {} record() {} list() { return []; } }
  class Transactions {
    constructor() {}
    execute({ validate, commit }) {
      const checked = validate?.() || { valid: true };
      if (checked.valid === false) return checked;
      const value = commit?.();
      return value?.valid === false ? value : { valid: true, value, transactionId: 'tx-1', snapshotId: 'snapshot-1' };
    }
  }
  const localValues = new Map();
  const context = {
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    KGAdminCore: {
      VERSION: 'test', clean: value => String(value ?? '').trim(), clone: value => structuredClone(value),
      nowIso: () => '2026-08-29T00:00:00Z', actor: () => ({ id: 'admin' }), safeId: prefix => `${prefix}-1`,
      hash: value => String(value).length,
    },
    KGAuthCore: { currentUser: () => ({ id: 'admin', role: 'admin' }) },
    KGDomainApi: { request: async () => ({ banks: [], papers: [], releases: [] }) },
    localStorage: {
      getItem: key => localValues.has(key) ? localValues.get(key) : null,
      setItem: (key, value) => localValues.set(key, String(value)),
      removeItem: key => localValues.delete(key),
    },
    KGLearningContent: legacyContent,
    KGContentOrganization: { storageKeys: {}, getPapers: () => [], getLearningTasks: () => [], getCollections: () => [] },
    KGLocalContentRepository: options.realInfrastructure ? undefined : Repository,
    KGAdminPermissionService: options.realInfrastructure ? undefined : Permissions,
    KGAdminAuditService: options.realInfrastructure ? undefined : Audit,
    KGAdminTransactionService: options.realInfrastructure ? undefined : Transactions,
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); },
    dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); },
    async fetch(url, init = {}) {
      calls.push({ url: String(url), init: structuredClone(init) });
      if ((init.method || 'GET') === 'PUT') {
        if (failPut) return response({ detail: '服务器拒绝更新' }, 500);
        const body = JSON.parse(init.body);
        return response({
          subjectId: 'subject-pmp',
          ...body,
          recallLibrary: { id: 'recall-current', version: 2, nodes: [], edges: [] },
          contentRevision: 42,
        });
      }
      return response({
        subjectId: 'subject-pmp',
        knowledgeTree: { taxonomy: serverTaxonomy },
        recallLibrary: { id: 'recall-current', version: 2, nodes: [], edges: [] },
        contentRevision: 41,
      });
    },
  };
  context.window = context;
  let apiSnapshot = null;
  context.KGTeachingContentApi = {
    async bootstrap(subjectId) {
      const responseValue = await context.fetch(`/api/v1/content-prep/shared-content?subjectId=${encodeURIComponent(subjectId)}`);
      apiSnapshot = await responseValue.json();
      return structuredClone(apiSnapshot);
    },
    async saveCatalogResource(name, value) {
      const responseValue = await context.fetch('/api/v1/content-prep/shared-content', {
        method: 'PUT',
        body: JSON.stringify({
          subjectId: 'subject-pmp',
          contentRevision: Number(apiSnapshot?.contentRevision) || 0,
          [name]: value,
        }),
      });
      const payload = await responseValue.json();
      if (!responseValue.ok) throw new Error(payload.detail || '服务器请求失败');
      apiSnapshot = payload;
      return structuredClone(payload[name] || value);
    },
    snapshot() { return structuredClone(apiSnapshot || {}); },
    async importActivities() { return {}; },
  };
  vm.runInNewContext(fs.readFileSync(gatewayPath, 'utf8'), context, { filename: gatewayPath });
  if (options.realInfrastructure) {
    for (const name of [
      '11-local-content-repository.js', '20-admin-permission-service.js',
      '21-admin-audit-service.js', '22-admin-transaction-service.js',
    ]) vm.runInNewContext(adminSource(name), context, { filename: name });
  }
  for (const name of [
    '30-reference-index-service.js', '31-subject-service.js', '32-taxonomy-service.js',
    '33-activity-service.js', '34-course-service.js', '35-release-service.js', '40-admin-service-registry.js',
  ]) vm.runInNewContext(adminSource(name), context, { filename: name });
  return {
    context,
    services: context.KGAdminServices,
    calls,
    get serverTaxonomy() { return structuredClone(serverTaxonomy); },
    setServerTaxonomy(value) { serverTaxonomy = structuredClone(value); },
    setFailPut(value) { failPut = value; },
    failNextSubjectSave() { failSubjectSave = true; },
    rawWriters: Object.entries(legacyContent).filter(([name, value]) => typeof value === 'function' && /^(?:save|delete|reset|publish|map|import)/.test(name)).map(([, value]) => value),
    taxonomies: () => structuredClone(taxonomies),
    subjects: () => structuredClone(subjects),
  };
}

test('gateway hydrates the server current taxonomy without deleting local drafts', async () => {
  assert.equal(fs.existsSync(gatewayPath), true, '缺少教学内容服务端网关');
  const runtime = createRuntime();

  const hydrated = await runtime.context.KGAdminTeachingContentGateway.hydrateSubject('subject-pmp');

  assert.equal(hydrated.taxonomy.id, runtime.serverTaxonomy.id);
  assert.equal(hydrated.taxonomy.nodes.length, 317);
  assert.equal(runtime.taxonomies().some(item => item.id === 'taxonomy-pmp-main'), true);
  assert.equal(runtime.taxonomies().some(item => item.id === 'taxonomy-local-draft'), true);
  assert.equal(runtime.subjects()[0].defaultTaxonomyId, 'taxonomy-pmp-main');
});

test('gateway persists catalog resources with the hydrated content revision and surfaces server errors', async () => {
  assert.equal(fs.existsSync(gatewayPath), true, '缺少教学内容服务端网关');
  const runtime = createRuntime();
  const gateway = runtime.context.KGAdminTeachingContentGateway;
  await gateway.hydrateSubject('subject-pmp');

  await gateway.persistResource('taxonomies', [{ ...runtime.serverTaxonomy, status: 'published' }]);
  const put = runtime.calls.find(call => call.init.method === 'PUT');
  assert.ok(put);
  const body = JSON.parse(put.init.body);
  assert.equal(body.contentRevision, 41);
  assert.equal(body.taxonomies[0].id, runtime.serverTaxonomy.id);
  assert.equal(body.taxonomies[0].nodes.length, 317);

  runtime.setFailPut(true);
  await assert.rejects(
    gateway.persistResource('taxonomies', [{ ...runtime.serverTaxonomy, id: 'taxonomy-failing' }]),
    /服务器拒绝更新/,
  );
});

test('public admin service graph exposes no raw content writer or unchecked projection replacement', () => {
  const runtime = createRuntime();
  const forbidden = new Set(runtime.rawWriters);
  const visited = new Set();
  const queue = [{ value: runtime.services, path: 'KGAdminServices' }];
  const exposed = [];
  while (queue.length) {
    const { value, path: currentPath } = queue.shift();
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null || visited.has(value)) continue;
    visited.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const child = value[key];
      const childPath = `${currentPath}.${String(key)}`;
      if (forbidden.has(child)) exposed.push(childPath);
      if ((typeof child === 'object' || typeof child === 'function') && child !== null) queue.push({ value: child, path: childPath });
    }
  }

  assert.deepEqual(exposed, []);
  assert.equal(runtime.services.subjects.legacy, undefined);
  assert.equal(runtime.services.taxonomies.legacy, undefined);
  assert.equal(runtime.services.references.content, undefined);
  assert.equal(runtime.services.activities.legacy, undefined);
  assert.equal(runtime.services.courses.legacy, undefined);
  assert.equal(runtime.services.releases.content, undefined);
  assert.equal(runtime.services.taxonomies.reconcileServerProjection, undefined);
  assert.equal(runtime.services.repository, undefined);
  assert.equal(runtime.services.permissions.auth, undefined);
  assert.equal(runtime.services.audit.repository, undefined);
  assert.equal(runtime.services.audit.clear, undefined);
  assert.equal(runtime.services.transactions.repository, undefined);
  assert.equal(runtime.services.transactions.execute, undefined);
  assert.equal(runtime.services.transactions.restoreSnapshot, undefined);
});

test('narrow public infrastructure facades retain every method used by real admin pages', () => {
  const runtime = createRuntime({ realInfrastructure: true });
  const services = runtime.services;

  assert.equal(services.permissions.currentUser().role, 'admin');
  assert.equal(services.permissions.can('editTaxonomies'), true);
  assert.equal(services.permissions.summary().role, 'admin');
  services.audit.record({ action: 'facade.behavior', entityType: 'test', summary: '窄接口行为验证' });
  assert.equal(services.audit.list()[0].action, 'facade.behavior');
  assert.equal(services.audit.summary().total, 1);
  const snapshot = services.transactions.createSnapshot({ name: '窄接口快照行为验证' });
  assert.equal(services.transactions.snapshots()[0].id, snapshot.id);

  vm.runInNewContext(adminSource('41-learning-content-compat.js'), runtime.context, { filename: '41-learning-content-compat.js' });
  assert.equal(runtime.context.KGLearningContent.repositoryMode, 'local');
  assert.equal(runtime.context.KGLearningContent.adminServices, services);
  assert.equal(services.repository, undefined);
  assert.equal(services.transactions.execute, undefined);
  assert.equal(services.transactions.restoreSnapshot, undefined);
});

test('gateway hydration never rewrites local state even for an invalid remote snapshot', async () => {
  const runtime = createRuntime();
  const beforeSubjects = runtime.subjects();
  const beforeTaxonomies = runtime.taxonomies();
  runtime.setServerTaxonomy({ ...runtime.serverTaxonomy, id: '', nodes: [{ id: 'duplicate' }, { id: 'duplicate' }] });

  const hydrated = await runtime.context.KGAdminTeachingContentGateway.hydrateSubject('subject-pmp');
  assert.equal(hydrated.taxonomy.id, '');
  assert.deepEqual(runtime.subjects(), beforeSubjects);
  assert.deepEqual(runtime.taxonomies(), beforeTaxonomies);
});

test('gateway hydration does not invoke legacy subject writers', async () => {
  const runtime = createRuntime();
  const beforeSubjects = runtime.subjects();
  const beforeTaxonomies = runtime.taxonomies();
  runtime.failNextSubjectSave();

  await runtime.context.KGAdminTeachingContentGateway.hydrateSubject('subject-pmp');
  assert.deepEqual(runtime.subjects(), beforeSubjects);
  assert.deepEqual(runtime.taxonomies(), beforeTaxonomies);
});
