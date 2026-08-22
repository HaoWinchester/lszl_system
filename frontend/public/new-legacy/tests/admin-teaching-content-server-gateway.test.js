'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const gatewayPath = path.resolve(__dirname, '../src/admin/42-teaching-content-server-gateway.js');

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(payload); },
  };
}

function createRuntime() {
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
  const serverTaxonomy = {
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
    getSubjects: () => structuredClone(subjects),
    saveSubjects: rows => { subjects = structuredClone(rows); return structuredClone(subjects); },
    getTaxonomies: subjectId => structuredClone(taxonomies.filter(item => !subjectId || item.subjectId === subjectId)),
    saveTaxonomies: rows => { taxonomies = structuredClone(rows); return { valid: true, taxonomies: structuredClone(taxonomies) }; },
  };
  const services = {
    legacyContent,
    subjects: {
      get: id => structuredClone(subjects.find(item => item.id === id) || null),
    },
    taxonomies: {
      list: subjectId => legacyContent.getTaxonomies(subjectId),
      get: id => structuredClone(taxonomies.find(item => item.id === id) || null),
      currentForSubject(subjectId) {
        const subject = subjects.find(item => item.id === subjectId);
        return structuredClone(taxonomies.find(item => item.subjectId === subjectId && item.id === subject?.defaultTaxonomyId) || null);
      },
    },
  };
  const context = {
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    KGAdminServices: services,
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); },
    dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); },
    async fetch(url, init = {}) {
      calls.push({ url: String(url), init: structuredClone(init) });
      if ((init.method || 'GET') === 'PUT') {
        if (failPut) return response({ detail: '服务器拒绝更新' }, 500);
        return response({
          subjectId: 'subject-pmp',
          knowledgeTree: { taxonomy: JSON.parse(init.body).knowledgeTree.taxonomy },
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
  return {
    context,
    services,
    calls,
    serverTaxonomy,
    setFailPut(value) { failPut = value; },
    taxonomies: () => structuredClone(taxonomies),
    subjects: () => structuredClone(subjects),
  };
}

test('gateway hydrates the server current taxonomy without deleting local drafts', async () => {
  assert.equal(fs.existsSync(gatewayPath), true, '缺少教学内容服务端网关');
  const runtime = createRuntime();
  vm.runInNewContext(fs.readFileSync(gatewayPath, 'utf8'), runtime.context, { filename: gatewayPath });

  const hydrated = await runtime.context.KGAdminTeachingContentGateway.hydrateSubject('subject-pmp');

  assert.equal(hydrated.taxonomy.id, runtime.serverTaxonomy.id);
  assert.equal(hydrated.taxonomy.nodes.length, 317);
  assert.equal(runtime.services.taxonomies.currentForSubject('subject-pmp').id, runtime.serverTaxonomy.id);
  assert.equal(runtime.services.taxonomies.currentForSubject('subject-pmp').nodes.length, 317);
  assert.equal(runtime.taxonomies().some(item => item.id === 'taxonomy-pmp-main'), false);
  assert.equal(runtime.taxonomies().some(item => item.id === 'taxonomy-local-draft'), true);
  assert.equal(runtime.subjects()[0].defaultTaxonomyId, runtime.serverTaxonomy.id);
});

test('gateway publishes with the hydrated content revision and surfaces server errors', async () => {
  assert.equal(fs.existsSync(gatewayPath), true, '缺少教学内容服务端网关');
  const runtime = createRuntime();
  vm.runInNewContext(fs.readFileSync(gatewayPath, 'utf8'), runtime.context, { filename: gatewayPath });
  const gateway = runtime.context.KGAdminTeachingContentGateway;
  await gateway.hydrateSubject('subject-pmp');

  await gateway.publishTaxonomy({ ...runtime.serverTaxonomy, status: 'published' });
  const put = runtime.calls.find(call => call.init.method === 'PUT');
  assert.ok(put);
  const body = JSON.parse(put.init.body);
  assert.equal(body.contentRevision, 41);
  assert.equal(body.knowledgeTree.taxonomy.id, runtime.serverTaxonomy.id);
  assert.equal(body.knowledgeTree.taxonomy.nodes.length, 317);

  runtime.setFailPut(true);
  await assert.rejects(
    gateway.publishTaxonomy({ ...runtime.serverTaxonomy, id: 'taxonomy-failing' }),
    /服务器拒绝更新/,
  );
});
