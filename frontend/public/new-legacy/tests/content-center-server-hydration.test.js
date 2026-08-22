'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.resolve(__dirname, '../src/91-content-center-app.js');

class FakeElement {
  constructor() {
    this.className = '';
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.scrollLeft = 0;
    this.scrollTop = 0;
  }
  addEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
  focus() {}
}

function treeIndex(taxonomy) {
  const nodes = taxonomy.nodes || [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const children = parentId => nodes.filter(node => (node.parentId || null) === (parentId || null));
  const descendants = id => {
    const result = [];
    const visit = parentId => children(parentId).forEach(node => { result.push(node.id); visit(node.id); });
    visit(id);
    return result;
  };
  return {
    taxonomy,
    nodes,
    children,
    descendants,
    node: id => byId.get(id) || null,
    branchMatches: () => true,
    search: () => nodes,
    path: id => byId.has(id) ? [byId.get(id)] : [],
    pathLabel: id => byId.get(id)?.title?.zh || '',
  };
}

function createRuntime() {
  const elements = new Map();
  const listeners = new Map();
  const oldTaxonomy = {
    id: 'taxonomy-pmp-main', subjectId: 'subject-pmp', version: 1, versionLabel: 'v1.0',
    status: 'published', isDefault: true, maxDepth: 9, name: { zh: '旧版知识树' },
    nodes: Array.from({ length: 12 }, (_, index) => ({
      id: `old-${index}`, parentId: null, level: 1, status: 'active', title: { zh: `旧节点${index}` },
    })),
  };
  const serverTaxonomy = {
    ...oldTaxonomy,
    name: { zh: '内置完整知识树' },
    nodes: Array.from({ length: 317 }, (_, index) => ({
      id: `server-${index}`, parentId: null, level: 1, status: 'active', title: { zh: `节点${index}` },
    })),
  };
  let taxonomy = oldTaxonomy;
  let hydrateCalls = 0;
  const subject = { id: 'subject-pmp', code: 'PMP', name: { zh: 'PMP' } };
  const document = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    dispatchEvent() {},
  };
  const core = {
    taxonomyById: id => id === taxonomy.id ? taxonomy : null,
    subjectById: id => id === subject.id ? subject : null,
    defaultTaxonomyForSubject: id => id === subject.id ? taxonomy : null,
    getTaxonomies: id => !id || id === subject.id ? [taxonomy] : [],
    getSubjects: () => [subject],
    getActivities: () => [],
    currentUser: () => ({ id: 'admin', name: '管理员', role: 'admin' }),
    activityTitle: activity => activity.title || '',
    taxonomyEditMode: () => 'current',
    canEditTaxonomy: () => true,
    adminServices: {
      taxonomies: { currentForSubject: id => id === subject.id ? taxonomy : null },
      permissions: { can: () => true },
    },
  };
  const context = {
    console,
    document,
    location: { search: '?embed=knowledge&subjectId=subject-pmp&taxonomyId=taxonomy-pmp-main', hash: '#knowledge', href: 'http://test/content-center.html?subjectId=subject-pmp' },
    history: { replaceState() {} },
    localStorage: { getItem: () => '', setItem() {} },
    URL,
    URLSearchParams,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    CSS: { escape: value => String(value) },
    requestAnimationFrame: callback => callback(),
    setTimeout,
    clearTimeout,
    confirm: () => true,
    alert() {},
    KGLearningContent: core,
    KGKnowledgeTreeIndex: { create: treeIndex },
    KGKnowledgeQuestionStats: { collect: () => ({ questions: [] }) },
    KGAdminTeachingContentGateway: {
      async hydrateSubject(subjectId) {
        assert.equal(subjectId, 'subject-pmp');
        hydrateCalls += 1;
        await Promise.resolve();
        taxonomy = serverTaxonomy;
        return { taxonomy: serverTaxonomy };
      },
    },
  };
  context.window = context;
  context.globalThis = context;
  return {
    context,
    listeners,
    elements,
    hydrateCalls: () => hydrateCalls,
  };
}

test('embedded content center hydrates the selected subject before its first tree render', async () => {
  const runtime = createRuntime();
  vm.runInNewContext(fs.readFileSync(appPath, 'utf8'), runtime.context, { filename: appPath });
  const handlers = runtime.listeners.get('DOMContentLoaded') || [];
  assert.equal(handlers.length, 1);

  await Promise.all(handlers.map(handler => handler()));

  assert.equal(runtime.hydrateCalls(), 1);
  assert.match(runtime.elements.get('ccTreeSummary').innerHTML, /317 个知识节点/);
});
