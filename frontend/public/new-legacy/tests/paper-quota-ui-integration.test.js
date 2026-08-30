'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadAdminApi({ principles = [], principlePayload = null, principlePayloadRaw = null, supplementDom = null, initialPapers = null, harness = null } = {}) {
  const documentListeners = new Map();
  const storage = new Map();
  if (typeof principlePayloadRaw === 'string') storage.set('kg_principle_repository_v1', principlePayloadRaw);
  else if (principlePayload) storage.set('kg_principle_repository_v1', JSON.stringify(principlePayload));
  if (Array.isArray(initialPapers)) {
    storage.set('kg_exam_papers_v1__public', JSON.stringify(initialPapers));
  }
  const sandbox = {
    console,
    Date,
    JSON,
    Math,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: callback => callback(),
    alert() {},
    confirm: () => true,
    prompt: () => '',
    location: { href: 'http://example.test/paper-management.html', search: '' },
    CSS: { escape: value => String(value) },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
      key: index => Array.from(storage.keys())[index] || null,
      get length() { return storage.size; },
    },
    KGQuestionCatalogAdapter: Array.isArray(initialPapers) ? {
      ready: Promise.resolve(),
      snapshot: () => ({ banks: [], questions: [] }),
    } : undefined,
    document: {
      body: { dataset: Array.isArray(initialPapers) ? { paperManagementPage: 'true' } : {} },
      documentElement: { clientWidth: 1280, clientHeight: 800 },
      addEventListener: (type, listener) => documentListeners.set(type, listener),
      querySelectorAll: selector => {
        if (selector === '[data-paper-supplement-mode]') return supplementDom?.radios || [];
        if (selector === '#qbPaperDomainQuotaList [data-domain]') return supplementDom?.domainRows || [];
        if (selector === '#qbPaperPrincipleQuotaList [data-principle-id]') return supplementDom?.principleRows || [];
        return [];
      },
      querySelector: selector => selector === '[data-paper-supplement-mode]:checked'
        ? (supplementDom?.radios || []).find(input => input.checked) || null
        : null,
      getElementById: id => supplementDom?.elements?.[id] || null,
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    open() {},
    KGPrincipleRepository: Array.isArray(principles)
      ? { list: () => principles.map(item => ({ ...item })) }
      : undefined,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const relativePath of [
    'src/teacher/paper-management/paper-quota-service.js',
    'src/65-question-bank-admin.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'), sandbox, {
      filename: relativePath,
    });
  }
  if (harness) {
    harness.initialize = () => documentListeners.get('DOMContentLoaded')?.();
    harness.readPaperStorage = () => storage.get('kg_exam_papers_v1__public') || null;
  }
  return sandbox.KGQuestionBankAdminAPI;
}

test('paper page changes preferred selection only for create and import events', () => {
  const api = loadAdminApi();
  assert.deepEqual(JSON.parse(JSON.stringify(api.paperChangeReloadOptions(
    { detail: { action: 'create', payload: { paper: { id: 'paper-new' } } } },
    'paper-old',
  ))), { selectedId: 'paper-new', replaceQueuedPreferred: true });
  assert.deepEqual(JSON.parse(JSON.stringify(api.paperChangeReloadOptions(
    { detail: { action: 'update', payload: { paper: { id: 'paper-other' } } } },
    'paper-old',
  ))), { selectedId: 'paper-old', replaceQueuedPreferred: false });
  assert.equal(api.paperChangePreferredId(
    { detail: { action: 'create', payload: { paper: { id: 'paper-new' } } } },
    'paper-old',
  ), 'paper-new');
  assert.equal(api.paperChangePreferredId(
    { detail: { action: 'import', payload: { result: { paperId: 'paper-imported' } } } },
    'paper-old',
  ), 'paper-imported');
  assert.equal(api.paperChangePreferredId(
    { detail: { action: 'update', payload: { paper: { id: 'paper-other' } } } },
    'paper-old',
  ), 'paper-old');
  assert.equal(api.paperChangePreferredId(
    { detail: { action: 'archive', payload: { paper: { id: 'paper-other' } } } },
    'paper-old',
  ), 'paper-old');
  assert.equal(api.paperChangePreferredId({ detail: { action: 'remove', payload: {} } }, 'paper-old'), 'paper-old');
});

test('paper page queues the newest preferred id when a reload is already pending', async () => {
  const api = loadAdminApi();
  let releaseFirst;
  const firstPending = new Promise(resolve => { releaseFirst = resolve; });
  const calls = [];
  const applied = [];
  const coordinator = api.createPaperReloadCoordinator(async (preferredId, control = { isCurrent: () => true }) => {
    calls.push(preferredId);
    if (calls.length === 1) await firstPending;
    if (control.isCurrent()) applied.push(preferredId);
    return { selectedPaperId: preferredId };
  });

  const first = coordinator.request('paper-old');
  await Promise.resolve();
  const follow = coordinator.request('paper-new');
  const nonCreateRefresh = coordinator.request('paper-old', { replaceQueuedPreferred: false });
  assert.deepEqual(calls, ['paper-old']);
  releaseFirst();
  await Promise.all([first, follow, nonCreateRefresh]);
  assert.deepEqual(calls, ['paper-old', 'paper-new']);
  assert.deepEqual(applied, ['paper-new']);
});

test('non-create refresh during an active create reload keeps the create selection intent', async () => {
  const api = loadAdminApi();
  let releaseCreate;
  const createDetailPending = new Promise(resolve => { releaseCreate = resolve; });
  const calls = [];
  const applied = [];
  const coordinator = api.createPaperReloadCoordinator(async (preferredId, control) => {
    calls.push(preferredId);
    if (calls.length === 1) await createDetailPending;
    if (control.isCurrent()) applied.push(preferredId);
    return { papers: [{ id: preferredId }], selectedPaperId: preferredId };
  });

  const createReload = coordinator.request('paper-created', { replaceQueuedPreferred: true });
  await Promise.resolve();
  const lifecycleRefresh = coordinator.request('paper-old', { replaceQueuedPreferred: false });
  releaseCreate();
  await Promise.all([createReload, lifecycleRefresh]);

  assert.deepEqual(calls, ['paper-created', 'paper-created']);
  assert.deepEqual(applied, ['paper-created', 'paper-created']);
});

test('failed create reload keeps its preferred id for a later non-create retry', async () => {
  const api = loadAdminApi();
  const calls = [];
  let fail = true;
  const coordinator = api.createPaperReloadCoordinator(async preferredId => {
    calls.push(preferredId);
    if (fail) throw new Error('新建后刷新失败');
    return { papers: [{ id: preferredId }], selectedPaperId: preferredId };
  });

  await assert.rejects(
    coordinator.request('paper-created', { replaceQueuedPreferred: true }),
    /新建后刷新失败/,
  );
  fail = false;
  const retried = await coordinator.request('paper-old', { replaceQueuedPreferred: false });

  assert.equal(retried.selectedPaperId, 'paper-created');
  assert.deepEqual(calls, ['paper-created', 'paper-created']);
});

test('fallback paper reload cannot apply old detail after create invalidation when the queued reload fails', async () => {
  const api = loadAdminApi();
  let resolveOldDetail;
  let markDetailStarted;
  const oldDetail = new Promise(resolve => { resolveOldDetail = resolve; });
  const detailStarted = new Promise(resolve => { markDetailStarted = resolve; });
  let readyCalls = 0;
  const applied = [];
  const runner = api.createPaperReloadRunner({
    paperDataLoader: null,
    paperApi: {
      async ready() {
        readyCalls += 1;
        if (readyCalls === 1) return { papers: [{ id: 'paper-old' }], categories: [] };
        throw new Error('排队的新一代刷新失败');
      },
      detail() { markDetailStarted(); return oldDetail; },
    },
    catalog: { banks: () => [] },
    readCurrentSnapshot: () => ({ papers: [], categories: [], selectedPaperId: '', selectedPaper: null }),
    applySnapshot: snapshot => applied.push(snapshot),
  });
  const coordinator = api.createPaperReloadCoordinator(runner);

  const first = coordinator.request('paper-old');
  await detailStarted;
  coordinator.request('paper-created', { replaceQueuedPreferred: true });
  resolveOldDetail({ id: 'paper-old', revision: 1, questions: [] });

  await assert.rejects(first, /排队的新一代刷新失败/);
  assert.equal(applied.length, 0);
});

test('paper reload runner resolves the page loader after page initialization', async () => {
  const api = loadAdminApi();
  let loader = null;
  let fallbackCalls = 0;
  const refreshed = [];
  const runner = api.createPaperReloadRunner({
    getPaperDataLoader: () => loader,
    paperApi: {
      async ready() { fallbackCalls += 1; return { papers: [], categories: [] }; },
      async detail() { throw new Error('fallback detail must not run'); },
    },
    catalog: { banks: () => [] },
    readCurrentSnapshot: () => ({ papers: [], categories: [], selectedPaperId: '', selectedPaper: null }),
    applySnapshot: () => { throw new Error('fallback apply must not run'); },
  });
  loader = {
    async refreshPapers(options) { refreshed.push(options.preferredPaperId); },
    snapshot: () => ({
      papers: [{ id: 'paper-created' }],
      categories: [],
      selectedPaperId: 'paper-created',
      selectedPaper: { id: 'paper-created' },
      candidateQuestions: [{ id: 'question-still-visible' }],
    }),
  };

  const result = await runner('paper-created');

  assert.deepEqual(refreshed, ['paper-created']);
  assert.equal(fallbackCalls, 0);
  assert.equal(result.candidateQuestions[0].id, 'question-still-visible');
});

test('paper editor offers one accessible domain-or-principle supplement strategy', () => {
  const html = fs.readFileSync(path.join(ROOT, 'paper-management.html'), 'utf8');
  const controls = Array.from(html.matchAll(
    /<input\b(?=[^>]*\btype="radio")(?=[^>]*\bname="paperSupplementMode")(?=[^>]*\bvalue="(domain|principle)")[^>]*>/g,
  ));

  assert.deepEqual(controls.map(match => match[1]).sort(), ['domain', 'principle']);
  assert.equal(controls.filter(match => /\bchecked\b/.test(match[0])).length, 1);
  assert.match(html, /<label[^>]*>\s*<input[^>]*value="domain"[^>]*>[\s\S]*?按领域配额\s*<\/span>\s*<\/label>/);
  assert.match(html, /<label[^>]*>\s*<input[^>]*value="principle"[^>]*>[\s\S]*?按原则配额\s*<\/span>\s*<\/label>/);
  assert.match(html, /id="qbPaperDomainQuotaList"/);
  assert.match(html, /id="qbPaperPrincipleQuotaList"/);
});

test('paper page loads the quota service before the controller without an optional repository asset', () => {
  const html = fs.readFileSync(path.join(ROOT, 'paper-management.html'), 'utf8');
  const quota = html.indexOf('src/teacher/paper-management/paper-quota-service.js');
  const admin = html.indexOf('src/65-question-bank-admin.js');

  assert.doesNotMatch(html, /src\/principles\/principle-repository\.js/);
  assert.ok(admin > quota, 'quota service must load before the paper admin controller');
});

test('release sync injects the quota service before paper admin when an older page omits it', () => {
  const syncSource = fs.readFileSync(path.resolve(ROOT, '..', 'frontend/scripts/sync-new-legacy.js'), 'utf8');
  const start = syncSource.indexOf('function injectPage(');
  const end = syncSource.indexOf('\nfunction diffFiles(', start);
  assert.ok(start >= 0 && end > start, 'injectPage function must be loadable');
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`
    const versionPageRelease = html => html;
    const versionPageAssets = html => html;
    ${syncSource.slice(start, end)}
    globalThis.injectPageUnderTest = injectPage;
  `, sandbox);
  const generated = sandbox.injectPageUnderTest(
    '<html><head></head><body><script defer src="src/65-question-bank-admin.js"></script></body></html>',
    'paper-management.html',
    'test-version',
  );
  const quota = generated.indexOf('src/teacher/paper-management/paper-quota-service.js');
  const admin = generated.indexOf('src/65-question-bank-admin.js');

  assert.ok(quota >= 0, 'sync must add the quota service to older paper pages');
  assert.ok(admin > quota, 'sync must place the quota service before the admin controller');

  const misordered = sandbox.injectPageUnderTest(
    '<html><head></head><body><script defer src="src/65-question-bank-admin.js"></script><script defer src="src/teacher/paper-management/paper-quota-service.js"></script><script defer src="src/teacher/paper-management/paper-quota-service.js"></script></body></html>',
    'paper-management.html',
    'test-version',
  );
  const quotaTags = misordered.match(/src\/teacher\/paper-management\/paper-quota-service\.js/g) || [];
  const reorderedQuota = misordered.indexOf('src/teacher/paper-management/paper-quota-service.js');
  const reorderedAdmin = misordered.indexOf('src/65-question-bank-admin.js');
  assert.equal(quotaTags.length, 1, 'sync must keep one quota service script');
  assert.ok(reorderedQuota < reorderedAdmin, 'sync must normalize quota -> admin');
  assert.equal(
    sandbox.injectPageUnderTest(misordered, 'paper-management.html', 'test-version'),
    misordered,
    'sync must be byte-idempotent after dependency normalization',
  );
});

test('legacy drafts migrate once while preserving both quota maps and manual selection order', () => {
  const api = loadAdminApi();
  const migrated = api.normalizePaperDraft({
    id: 'paper-old',
    subject: 'PMP',
    domainTargets: { process: 2, people: 1 },
    principleQuotas: { 'principle-servant': 3 },
    questions: [
      { bankId: 'bank-1', questionId: 'q-manual-1', order: 2 },
      { bankId: 'bank-1', questionId: 'q-manual-1', order: 1 },
      { bankId: '', questionId: 'q-dangling', order: 3 },
      { bankId: 'bank-2', questionId: 'q-manual-2', order: 4 },
    ],
  });

  assert.equal(migrated.supplementMode, 'domain');
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.domainQuotas)), { process: 2, people: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.principleQuotas)), { 'principle-servant': 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.manualQuestionIds)), ['q-manual-1', 'q-manual-2']);
  assert.deepEqual(
    JSON.parse(JSON.stringify(migrated.questions.map(ref => `${ref.bankId}:${ref.questionId}`))),
    ['bank-1:q-manual-1', 'bank-2:q-manual-2'],
  );

  const refreshed = api.normalizePaperDraft(JSON.parse(JSON.stringify({
    ...migrated,
    supplementMode: 'principle',
  })));
  assert.equal(refreshed.supplementMode, 'principle');
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed.domainQuotas)), { process: 2, people: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed.principleQuotas)), { 'principle-servant': 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed.manualQuestionIds)), ['q-manual-1', 'q-manual-2']);
});

test('supplementing uses only the active strategy and appends after existing questions', () => {
  const api = loadAdminApi();
  const paper = api.normalizePaperDraft({
    id: 'paper-principles',
    subject: 'PMP',
    supplementMode: 'principle',
    domainQuotas: { domainA: 5 },
    principleQuotas: { principleB: 2 },
    manualQuestionIds: ['q-manual'],
    questions: [{ bankId: 'bank-1', questionId: 'q-manual', order: 1 }],
  });
  const candidates = [
    { bank: { id: 'bank-1' }, question: { id: 'q-manual', domain: 'domainA', metadata: { principleIds: ['principleA'] } } },
    { bank: { id: 'bank-1' }, question: { id: 'q-domain-only', domain: 'domainA', metadata: { principleIds: ['principleA'] } } },
    { bank: { id: 'bank-1' }, question: { id: 'q-principle-1', domain: 'domainB', metadata: { principleIds: ['principleB'] } } },
    { bank: { id: 'bank-2' }, question: { id: 'q-principle-2', domain: 'domainC', metadata: { principleIds: ['principleB'] } } },
  ];

  const result = api.supplementPaperDraft(paper, candidates, () => 0.5);

  const questionIds = JSON.parse(JSON.stringify(result.paper.questions.map(ref => ref.questionId)));
  assert.equal(questionIds[0], 'q-manual');
  assert.deepEqual(questionIds.slice(1).sort(), ['q-principle-1', 'q-principle-2']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.paper.manualQuestionIds)), ['q-manual']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.paper.domainQuotas)), { domainA: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(result.paper.principleQuotas)), { principleB: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(result.shortages)), []);
});

test('quota entry validation rejects fractional and negative values without discarding valid rows', () => {
  const api = loadAdminApi();
  const result = api.parsePaperQuotaEntries([
    { id: 'principle-valid', label: '有效原则', value: '2' },
    { id: 'principle-empty', label: '空配额', value: '' },
    { id: 'principle-fractional', label: '小数原则', value: '1.5' },
    { id: 'principle-negative', label: '负数原则', value: '-1' },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(result.quotas)), { 'principle-valid': 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(result.errors)), [
    '小数原则的配额必须是非负整数。',
    '负数原则的配额必须是非负整数。',
  ]);
});

test('an insufficient active quota returns a visible-saveable shortage result', () => {
  const api = loadAdminApi();
  const paper = api.normalizePaperDraft({
    id: 'paper-shortage',
    subject: 'PMP',
    supplementMode: 'principle',
    domainQuotas: { domainA: 9 },
    principleQuotas: { principleA: 3 },
    questions: [],
  });
  const result = api.supplementPaperDraft(paper, [
    { bank: { id: 'bank-1' }, question: { id: 'q-only', domain: 'domainB', metadata: { principleIds: ['principleA'] } } },
  ], () => 0);

  assert.deepEqual(JSON.parse(JSON.stringify(result.paper.questions.map(ref => ref.questionId))), ['q-only']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.shortages)), [{
    bucketId: 'principleA', requested: 3, existing: 0, added: 1, missing: 2,
  }]);
  const savedAndReloaded = api.normalizePaperDraft(JSON.parse(JSON.stringify(result.paper)));
  assert.equal(savedAndReloaded.supplementMode, 'principle');
  assert.deepEqual(JSON.parse(JSON.stringify(savedAndReloaded.principleQuotas)), { principleA: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(savedAndReloaded.domainQuotas)), { domainA: 9 });
  assert.deepEqual(JSON.parse(JSON.stringify(savedAndReloaded.questions.map(ref => ref.questionId))), ['q-only']);
});

test('principle quota rows use active repository IDs and report shared-pool capacity', () => {
  const api = loadAdminApi({ principles: [
    { id: 'principle-active', name: '先分析后行动', status: 'active' },
    { id: 'principle-inactive', name: '旧原则', status: 'inactive' },
  ] });
  const rows = api.listPaperPrincipleQuotaRows('PMP', [
    { bank: { id: 'bank-1', subject: 'PMP' }, question: { id: 'q1', metadata: { principleIds: ['principle-active'] } } },
    { bank: { id: 'bank-2', subject: 'PMP' }, question: { id: 'q2', metadata: { principleIds: ['principle-active', 'principle-inactive'] } } },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { id: 'principle-active', name: '先分析后行动', count: 2 },
  ]);
});

test('principle quota rows read the shared payload without loading a repository script', () => {
  const api = loadAdminApi({
    principles: null,
    principlePayload: { schemaVersion: 1, items: [
      { id: 'principle-active', name: '先沟通后行动', status: 'active' },
      { id: 'principle-inactive', name: '已停用原则', status: 'inactive' },
    ] },
  });
  const rows = api.listPaperPrincipleQuotaRows('PMP', [
    { bank: { id: 'bank-1', subject: 'PMP' }, question: { id: 'q1', metadata: { principleIds: ['principle-active'] } } },
    { bank: { id: 'bank-1', subject: 'PMP' }, question: { id: 'q2', metadata: { principleIds: ['principle-inactive'] } } },
    { bank: { id: 'bank-2', subject: 'PMP' }, question: { id: 'q3', metadata: { principleIds: ['principle-question-only'] } } },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { id: 'principle-active', name: '先沟通后行动', count: 1 },
    { id: 'principle-question-only', name: 'principle-question-only', count: 1 },
  ]);
});

test('a malformed shared principle payload fails closed without crashing', () => {
  const api = loadAdminApi({ principles: null, principlePayloadRaw: '{malformed' });
  assert.deepEqual(JSON.parse(JSON.stringify(api.listPaperPrincipleQuotaRows('PMP', []))), []);
});

test('a mode change without a current draft restores the default radio and quota panel', () => {
  const supplementDom = {
    radios: [
      { value: 'domain', checked: false },
      { value: 'principle', checked: true },
    ],
    elements: {
      qbPaperDomainQuotaList: { hidden: false },
      qbPaperPrincipleQuotaList: { hidden: true },
    },
  };
  const api = loadAdminApi({ supplementDom });

  api.handlePaperSupplementModeChange();

  assert.equal(supplementDom.radios[0].checked, true);
  assert.equal(supplementDom.radios[1].checked, false);
  assert.equal(supplementDom.elements.qbPaperDomainQuotaList.hidden, false);
  assert.equal(supplementDom.elements.qbPaperPrincipleQuotaList.hidden, true);
});

test('a rejected strategy save restores the persisted mode without writing the draft', async () => {
  const harness = {};
  const supplementDom = {
    radios: [
      { value: 'domain', checked: true, addEventListener() {} },
      { value: 'principle', checked: false, addEventListener() {} },
    ],
    domainRows: [],
    principleRows: [{
      dataset: { principleId: 'principle-invalid' },
      querySelector: selector => selector === 'strong'
        ? { textContent: '非法原则' }
        : { value: '1.5' },
    }],
    elements: {
      qbPaperDomainQuotaList: { hidden: false, innerHTML: '' },
      qbPaperPrincipleQuotaList: { hidden: true, innerHTML: '' },
    },
  };
  const persistedPaper = {
    id: 'paper-persisted-domain',
    name: '持久化试卷',
    subject: 'PMP',
    supplementMode: 'domain',
    domainQuotas: { process: 2 },
    principleQuotas: { 'principle-invalid': 1 },
    questions: [],
  };
  const api = loadAdminApi({ initialPapers: [persistedPaper], supplementDom, harness });
  await harness.initialize();
  const storageBefore = harness.readPaperStorage();

  supplementDom.radios[0].checked = false;
  supplementDom.radios[1].checked = true;
  supplementDom.elements.qbPaperDomainQuotaList.hidden = true;
  supplementDom.elements.qbPaperPrincipleQuotaList.hidden = false;

  assert.equal(api.handlePaperSupplementModeChange(), false);
  assert.equal(supplementDom.radios[0].checked, true);
  assert.equal(supplementDom.radios[1].checked, false);
  assert.equal(supplementDom.elements.qbPaperDomainQuotaList.hidden, false);
  assert.equal(supplementDom.elements.qbPaperPrincipleQuotaList.hidden, true);
  assert.equal(harness.readPaperStorage(), storageBefore);
});
