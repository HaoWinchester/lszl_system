'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const admin = read('src/65-question-bank-admin.js');
const questionBankImportController = read('src/teacher/question-bank-import-controller.js');
const questionPage = read('question-bank.html');
const paperPage = read('paper-management.html');
const directAdapter = fs.readFileSync(
  path.join(REPO, 'frontend/scripts/new-legacy-assets/direct-question-adapter.js'),
  'utf8',
);
const catalogAdapter = fs.readFileSync(
  path.join(REPO, 'frontend/scripts/new-legacy-assets/question-catalog-adapter.js'),
  'utf8',
);
const syncScript = fs.readFileSync(
  path.join(REPO, 'frontend/scripts/sync-new-legacy.js'),
  'utf8',
);
const prepCatalogService = read('content-prep-studio/src/js/35-server-catalog-service.js');
const prepServerEvents = read('content-prep-studio/src/js/45-server-events.js');
const principlePresetController = read('src/teacher/training-config/principle-preset-controller.js');
assert.match(prepCatalogService, /async loadCatalog\(/, 'Content Prep needs a managed catalog snapshot for remote read-only refreshes');
assert.match(prepServerEvents, /PMPPrepServerPrinciples/, 'Content Prep principle editor must use a server CRUD controller');
assert.doesNotMatch(principlePresetController, /KGServerStateStorage/, 'principle operations must not depend on Runtime State flush or refresh');
assert.match(principlePresetController, /principles\/status[^]*reloadPrincipleProjection\(\)/, 'status updates must reload the server-backed principle projection');
assert.match(principlePresetController, /principles\/import[^]*applyPrincipleCardBundle\(result\.principles&&result\.synthesisPresets\?result:payload\)/, 'imports must apply the canonical domain API response');
assert.match(principlePresetController, /principles\/delete[^]*applyPrincipleCardBundle\(result\)/, 'deletes must apply the canonical domain API response');
assert.match(prepServerEvents, /btnQuickSaveWorkspace[^]*syncWorkspaceToServer/, 'the header save button must commit to the server');
assert.match(prepServerEvents, /btnSaveWorkspaceLocal[^]*syncWorkspaceToServer/, 'the workspace save button must commit to the server');

for (const [name, html, shellClass] of [
  ['question-bank.html', questionPage, 'teacher-admin-shell'],
  ['paper-management.html', paperPage, 'paper-management-page'],
]) {
  assert(html.includes(`class="${shellClass}`) || html.includes(` ${shellClass}`), `${name} must retain its teacher DOM shell`);
  assert(html.includes('styles/focus-vega-teacher.css'), `${name} must retain the Focus/Vega teacher skin`);
  assert(html.includes('data-ui-skin="focus-vega"'), `${name} must retain its current UI skin marker`);
  assert(html.includes('data-question-catalog-mode="managed"'), `${name} must declare managed catalog mode`);
}

assert.match(admin, /const Catalog\s*=\s*window\.KGQuestionCatalogAdapter/);
assert.match(admin, /const CatalogEditor\s*=\s*window\.KGQuestionCatalogEditController/);
assert.match(admin, /async function init\(\)[\s\S]*?await Catalog\.ready[\s\S]*?state\.banks\s*=\s*loadBanks\(\)/);
assert.match(admin, /async function initPaperManagementPage\(\)[\s\S]*?PaperDataLoaderFactory\.create\([^]*?paperDataLoader\.initialize\(/, 'paper management must initialize through the summary-first demand loader');
assert.doesNotMatch(admin, /Promise\.all\(\(summaries\|\|\[\]\)\.map/, 'paper management must not prefetch every paper detail');
assert.match(admin, /function loadBanks\(\)[\s\S]*?Catalog\.snapshot\(\)/);
assert.match(admin, /function loadLegacyBanksForMigrationPreview\(\)[\s\S]*?readString\(banksKey\(\)/);
assert.equal((admin.match(/banksKey\(\)/g) || []).length, 2, 'banksKey may only be declared and read by migration preview');
assert.doesNotMatch(admin, /writeJSON\(banksKey\(|kg_question_banks_published_v1/, 'teacher pages must not write a formal Runtime State catalog');

const saveBanksBody = admin.match(/function saveBanks\([^]*?\n  \}/)?.[0] || '';
assert(saveBanksBody, 'saveBanks compatibility function is missing');
assert.doesNotMatch(saveBanksBody, /writeJSON\(banksKey\(|syncPublishedBanks\(/, 'saveBanks must not write the formal Runtime State catalog');

assert.match(admin, /async function saveBankForm\([^)]*\)[\s\S]*?await Catalog\.saveBank\(/);
assert.match(admin, /async function addBank\([^]*?await Catalog\.saveBank\(/);
assert.match(admin, /async function addQuestion\(\)[^]*?await Catalog\.saveQuestion\(/);
assert.match(admin, /async function cloneQuestion\(\)[^]*?await Catalog\.saveQuestion\(/);
assert.match(admin, /async function deleteBankById\([^]*?await Catalog\.deleteBank\(/);
assert.match(admin, /async function saveQuestionForm\([^]*?await CatalogEditor\.save\(/);
assert.match(admin, /async function selectQuestion\([^]*?await CatalogEditor\.open\(/);
assert.match(admin, /beforeunload[^\n]*CatalogEditor\.release/);
assert(admin.includes('questionSnapshots'), 'published paper releases must retain immutable questionSnapshots');
assert.match(admin, /addEventListener\('kg:question-catalog-changed',\s*handleQuestionCatalogChanged\)/, 'managed question UI must consume catalog refresh events');
assert.match(admin, /function handleQuestionCatalogChanged\([^]*?state\.dirty[^]*?renderBankList\(\)[^]*?renderQuestionList\(\)[^]*?renderServerCatalogNewerNotice\(\)/, 'dirty managed UI must refresh read-only lists without a full form render');
assert.match(admin, /服务器有新版本[^]*?重新载入\/合并/, 'dirty managed UI must show a server-newer marker with an explicit action');
assert.match(admin, /function markCatalogEditorDirty\([^]*?state\.dirty\s*=\s*true/, 'raw editor input must participate in dirty detection');
assert.match(admin, /applyServerCatalogRefresh/, 'managed UI must expose an explicit server reload action');

for (const member of ['open', 'save', 'release', 'applyReadonlyState']) {
  assert(directAdapter.includes(`${member}(`), `edit controller missing ${member}()`);
}
assert(directAdapter.includes('heartbeatIntervalSeconds') && directAdapter.includes('30000'), 'edit controller must renew the server lock every 30 seconds');
assert(directAdapter.includes('baseRevision') && directAdapter.includes('lockToken'), 'existing-question saves must include revision and lock token');
assert(catalogAdapter.includes('deleteBank') && catalogAdapter.includes('deleteQuestion'), 'catalog adapter must expose explicit delete operations');

const catalogInjection = syncScript.indexOf('question-catalog-adapter.js');
const directInjection = syncScript.indexOf('direct-question-adapter.js');
const adminMarker = syncScript.indexOf('src/65-question-bank-admin.js');
assert(catalogInjection >= 0 && directInjection >= 0 && adminMarker >= 0, 'teacher adapter injection markers are missing');
assert(syncScript.includes('kg-question-editor:generated'), 'teacher edit controller must be injected before the admin initializer');

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function loadPrepService(fetchImpl, { withSync = true } = {}) {
  const published = [];
  const window = {
    fetch: fetchImpl,
    crypto: { randomUUID: () => 'prep-client-id' },
    PMPPrepServices: {},
    ...(withSync ? { KGTeachingContentSync: { publish: detail => published.push(detail) } } : {}),
  };
  const context = vm.createContext({ window, fetch: fetchImpl, crypto: window.crypto, Date, JSON, Math, URLSearchParams, console });
  vm.runInContext(prepCatalogService, context);
  return { service: window.PMPPrepServices.ServerCatalogService, published };
}

function loadPrepEvents({ listWritableBanks, loadCatalog } = {}) {
  const elements = new Map();
  const windowListeners = new Map();
  const dispatched = [];
  let syncListener = null;
  let bankRefreshes = 0;
  let catalogRefreshes = 0;
  const serverWrites = [];
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const handlers = new Map();
    const initialValues = {
      pmPrincipleName: '本地原则', pmPrincipleStatus: 'active', pmConfusable: '',
      pmPresetTitle: '本地归纳卡', pmPresetContent: '本地归纳内容', pmPresetStatus: 'draft', pmPresetVersion: '1',
    };
    const value = {
      id,
      value: id === 'questionStemInput' ? '未保存的本地题干' : (initialValues[id] || ''),
      textContent: '',
      className: '',
      innerHTML: '',
      disabled: false,
      onclick: id === 'btnNewWorkspace' ? function () {} : null,
      addEventListener(type, listener) { handlers.set(type, listener); },
      handler(type) { return handlers.get(type); },
    };
    elements.set(id, value);
    return value;
  }
  const question = { id: 'q-local', title: '未保存的本地题目', serverRevision: null };
  const prepRuntime = {
    dirty: true,
    serverContentRevision: 1,
    serverActor: { username: 'teacher-a' },
    creatorProfile: { creatorId: 'creator_001', name: '波塞冬' },
    clientInstanceId: 'client-1',
    serverBankId: 'bank-1',
    serverBanks: [],
    editLeaseState: { questionId: '', mode: 'local-new', canSave: true },
  };
  const state = {
    questionBank: { subject: 'PMP', name: '本地题库', questions: [question] },
    knowledgeTree: { id: 'tax-local', subjectId: 'subject-pmp', nodes: [] },
    recallLibrary: { schemaVersion: 1, nodes: [], edges: [] },
    tagConfig: { schemaVersion: 2, names: {} },
    principles: { schemaVersion: 1, items: [{ id: 'principle-local', name: '本地原则', status: 'active', confusablePrincipleIds: [] }] },
    synthesisPresets: { schemaVersion: 1, items: [{ id: 'preset-local', principleId: 'principle-local', title: '本地归纳卡', content: '本地归纳内容', status: 'draft', version: 1 }] },
    currentQuestionId: question.id,
    currentPrincipleId: 'principle-local',
  };
  const catalog = {
    async listWritableBanks() {
      bankRefreshes += 1;
      return listWritableBanks
        ? listWritableBanks(bankRefreshes)
        : [{ id: 'bank-1', name: '共享题库', accessMode: 'teacher' }];
    },
    async loadCatalog() {
      catalogRefreshes += 1;
      return loadCatalog
        ? loadCatalog(catalogRefreshes)
        : {
            banks: [{ id: 'bank-1', name: '共享题库', subject: 'PMP' }],
            questions: [{ id: 'q-server', bankId: 'bank-1', title: '服务器新题', revision: 2 }],
            contentRevision: 5,
          };
    },
    async loadSharedContent() { return { contentRevision: 1, knowledgeTree: null, recallLibrary: state.recallLibrary, principles: state.principles, synthesisPresets: state.synthesisPresets, tagConfig: state.tagConfig }; },
    async savePrinciple(principle,preset,options) { serverWrites.push({ type: 'principle-save', principle, preset, options }); return { contentRevision: 2, principles: { schemaVersion: 1, items: [principle] }, synthesisPresets: { schemaVersion: 1, items: [preset] }, recallLibrary:state.recallLibrary,tagConfig:state.tagConfig }; },
    async deletePrinciple(id,options) { serverWrites.push({ type: 'principle-delete', id, options }); return { contentRevision: 3, principles: { schemaVersion: 1, items: [] }, synthesisPresets: { schemaVersion: 1, items: [] }, recallLibrary:state.recallLibrary,tagConfig:state.tagConfig }; },
    async uploadBundle(bundle,options) { serverWrites.push({ type: 'workspace-save', bundle, options }); return { batchId: 'batch-save', bankId: 'bank-1', bankRevision: 2, contentRevision: 4, questions: [] }; },
    createEditLeaseController() { return { open: async () => ({}), close: async () => {}, reconfirm: async () => ({}), handleSaveError() {}, snapshot: () => ({}) }; },
    releaseLock: async () => true,
  };
  const document = { getElementById: element, querySelectorAll: () => [] };
  const projections = new Map([
    ['kg_principle_repository_v1', JSON.stringify({ schemaVersion: 1, items: [{ id: 'principle-server', name: '服务器原则' }] })],
    ['kg_synthesis_preset_repository_v1', JSON.stringify({ schemaVersion: 1, items: [{ id: 'preset-server', principleId: 'principle-server', title: '服务器归纳卡' }] })],
  ]);
  const window = {
    PMPPrepServices: { ServerCatalogService: catalog },
    KGTeachingContentSync: { subscribe(listener) { syncListener = listener; return () => { syncListener = null; }; } },
    localStorage: { getItem(key) { return projections.get(String(key)) || null; } },
    PMPPrepDraftUi: { save: async () => { serverWrites.push({ type: 'workspace-save' }); return { id: 'draft-1', revision: 2, title: '本地草稿' }; } },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    dispatchEvent(event) { dispatched.push(event); },
  };
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const context = vm.createContext({
    window, document, PMPPrepServices: window.PMPPrepServices, prepRuntime, state,
    currentQuestion: () => question, renderQuestionLockState() {}, saveWorkspaceLocal: async () => {},
    esc: value => String(value), markWorkspaceDirty() {}, prompt: () => null, QuestionService: { normalize: value => value },
    normalizePrinciples: value => value, normalizePresets: value => value,
    renderQuestionListOnly() {}, renderPrincipleList() {}, refreshHeader() {}, refreshAll() {},
    nowIso: () => '2026-08-10T00:00:00Z', refreshAll() {}, ExportService: { completeBundle: () => ({questionBank:state.questionBank,knowledgeTree:{taxonomy:state.knowledgeTree},recallLibrary:state.recallLibrary,principles:state.principles,synthesisPresets:state.synthesisPresets,tagConfig:state.tagConfig}) },
    VERSION: '0.4.0', toast() {}, duplicateQuestion: async () => {}, CustomEvent, setTimeout, clearTimeout, console,
  });
  vm.runInContext(prepServerEvents, context);
  return {
    question,
    prepRuntime,
    stemInput: element('questionStemInput'),
    status: element('serverCatalogStatus'),
    dispatched,
    state,
    applyRemote: options => window.PMPPrepServerContentRefresh?.apply(options),
    element,
    elementText: id => `${element(id).textContent}\n${element(id).innerHTML}`,
    bankRefreshes: () => bankRefreshes,
    catalogRefreshes: () => catalogRefreshes,
    remote: detail => syncListener?.(detail),
    pagehide: () => windowListeners.get('pagehide')?.(),
    serverWrites,
    serverPrinciples: () => window.PMPPrepServerPrinciples,
  };
}

function loadManagedAdmin() {
  const elements = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const alerts = [];
  let catalogSnapshot = {
    banks: [{ id: 'bank-1', name: '本地显示题库', subject: 'PMP', questions: [] }],
    questions: [{
      id: 'q-1', bankId: 'bank-1', title: '本地题目', revision: 1, stemParts: [{ text: '本地题干' }],
      options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }], correctAnswer: 'A',
      clues: [{ id: 'clue-local', text: '本地线索' }], concepts: [{ id: 'concept-local', title: '本地知识点' }],
      reasoningSteps: [{ id: 'reason-local', title: '本地推理' }], metadata: { principleIds: ['principle-local'] },
    }],
    contentRevision: 1,
  };
  function classList() {
    const values = new Set();
    return { add: (...items) => items.forEach(item => values.add(item)), remove: (...items) => items.forEach(item => values.delete(item)), contains: item => values.has(item), toggle(item, force) { const next = force ?? !values.has(item); if (next) values.add(item); else values.delete(item); return next; } };
  }
  function element(id = '') {
    if (id && elements.has(id)) return elements.get(id);
    const handlers = new Map();
    const value = {
      id, value: '', innerHTML: '', textContent: '', hidden: false, disabled: false, checked: false,
      dataset: {}, style: { setProperty() {} }, classList: classList(), options: [],
      addEventListener(type, listener) { const rows = handlers.get(type) || []; rows.push(listener); handlers.set(type, rows); },
      async trigger(type, event = {}) { for (const listener of handlers.get(type) || []) await listener({ currentTarget: value, target: value, ...event }); },
      querySelectorAll() { return []; }, querySelector() { return null; }, closest() { return null; },
      appendChild(child) { if (child.id) elements.set(child.id, child); child.parentElement = value; return child; },
      remove() { if (value.id) elements.delete(value.id); }, focus() {}, setAttribute() {}, removeAttribute() {},
      getBoundingClientRect() { return { top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30 }; },
    };
    if (id) elements.set(id, value);
    return value;
  }
  const body = element('body');
  body.dataset = { questionCatalogMode: 'managed' };
  const document = {
    body, documentElement: { clientWidth: 1280, clientHeight: 800 }, activeElement: null,
    getElementById: element, createElement: () => element(''),
    querySelectorAll: () => [], querySelector: () => element('query-root'),
    addEventListener(type, listener) { const rows = documentListeners.get(type) || []; rows.push(listener); documentListeners.set(type, rows); },
    dispatchEvent() {},
  };
  const Catalog = {
    ready: Promise.resolve(), snapshot: () => JSON.parse(JSON.stringify(catalogSnapshot)),
    saveBank: async value => value, saveQuestion: async value => value, deleteBank: async () => true, deleteQuestion: async () => true,
    async importBanks({ banks }) {
      const source = banks[0];
      catalogSnapshot = {
        banks: [{ id: 'b-imported', name: source.name, subject: source.subject, revision: 1 }],
        questions: [{
          id: 'q-imported', bankId: 'b-imported', title: source.questions[0].title, revision: 1,
          stemParts: source.questions[0].stemParts, options: source.questions[0].options,
          correctAnswer: source.questions[0].correctAnswer,
        }],
        contentRevision: 2,
      };
      return {
        banks: [{ ...catalogSnapshot.banks[0], questions: catalogSnapshot.questions }],
        sourceBankIdMap: { [source.id]: 'b-imported' },
        sourceQuestionIdMap: { [`${source.id}::${source.questions[0].id}`]: 'q-imported' },
        contentRevision: 2,
      };
    },
  };
  const savedQuestions = [];
  const CatalogEditor = { open: async () => true, save: async (value, options) => { savedQuestions.push({ value, options }); return value; }, release() {}, applyReadonlyState() {}, status: () => ({ readonly: false }) };
  const window = {
    KGQuestionCatalogAdapter: Catalog, KGQuestionCatalogEditController: CatalogEditor,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null },
    addEventListener(type, listener) { const rows = windowListeners.get(type) || []; rows.push(listener); windowListeners.set(type, rows); },
    removeEventListener(type, listener) { const rows = windowListeners.get(type) || []; windowListeners.set(type, rows.filter(item => item !== listener)); },
    dispatchEvent(event) { for (const listener of windowListeners.get(event.type) || []) listener(event); },
    innerWidth: 1280, innerHeight: 800,
  };
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const location = { search: '?bankId=bank-1&questionId=q-1', href: 'http://test/question-bank.html?bankId=bank-1&questionId=q-1' };
  const context = vm.createContext({
    window, document, CustomEvent, URLSearchParams, URL, Blob, Map, Set, Date, JSON, Math, Number, Object, Array,
    location, navigator: {}, crypto: { randomUUID: () => 'id-test' },
    requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout, alert(message) { alerts.push(String(message)); }, confirm: () => true, prompt: () => null,
    console, CSS: { escape: value => String(value) },
  });
  vm.runInContext(questionBankImportController, context, { filename: 'question-bank-import-controller.js' });
  window.KGTeacherDomains = context.KGTeacherDomains;
  vm.runInContext(admin, context, { filename: '65-question-bank-admin.js' });
  return {
    async init() { for (const listener of documentListeners.get('DOMContentLoaded') || []) await listener(); },
    input(target) { for (const listener of documentListeners.get('input') || []) listener({ target }); },
    change(target) { for (const listener of documentListeners.get('change') || []) listener({ target }); },
    remote(snapshot) { catalogSnapshot = snapshot; window.dispatchEvent(new CustomEvent('kg:question-catalog-changed', { detail: { source: 'remote', snapshot } })); },
    element, api: context.KGQuestionBankAdminAPI, savedQuestions, location, Catalog, alerts,
  };
}

async function testPrepPublishesOnlyCommittedServerChanges() {
  const calls = [];
  const { service, published } = loadPrepService(async (url) => {
    calls.push(url);
    if (url === '/api/v1/content-prep/banks') {
      return response(200, { bank: { id: 'bank-1' }, contentRevision: 2 });
    }
    if (url === '/api/v1/content-prep/batches') {
      return response(200, {
        batchId: 'batch-1', bankId: 'bank-1', bankRevision: 2, contentRevision: 3,
        questions: [{ questionId: 'q-1', status: 'created', revision: 1, contentHash: 'a'.repeat(64) }],
      });
    }
    return response(503, { detail: '提交后状态查询暂时不可用' });
  });
  await service.createBank({ name: '共享题库' });
  const workspace = { serverBankId: 'bank-1', clientInstanceId: 'client-1', lastIdempotencyKey: '', lastBatchId: '' };
  const question = { id: 'q-1', title: '题目', serverRevision: null };
  await service.uploadBundle(
    { questionBank: { questions: [question] }, principles: {}, synthesisPresets: {}, tagConfig: {} },
    { workspace, creatorId: 'creator_001', questions: [question] },
  );
  assert.deepEqual(published.map(detail => detail.revision), [2, 3], 'only successful server commits may publish teaching revisions');
  assert.deepEqual(calls, [
    '/api/v1/content-prep/banks',
    '/api/v1/content-prep/batches',
  ], 'the committed POST result must be authoritative and must not depend on a second status GET');

  const offline = loadPrepService(async () => response(200, { bank: { id: 'offline-bank' }, contentRevision: 4 }), { withSync: false });
  assert.equal((await offline.service.createBank({ name: '离线兼容' })).id, 'offline-bank', 'offline Content Prep must continue when the sync global is absent');
}

async function testPrepPrincipleCrudAndWorkspaceSaveAreServerBacked() {
  const prep = loadPrepEvents();
  await new Promise(resolve => setTimeout(resolve, 0));
  // P4.5.29 冻结架构：原则先写入数据库共享草稿，第七步统一原子同步；
  // 直接 CRUD 正式库被拒绝，防止绕过 Lock/Revision/审计。
  const principle = { id: 'principle-local', name: '服务器原则', status: 'active', confusablePrincipleIds: [] };
  const preset = { id: 'preset-local', principleId: principle.id, title: '原则：服务器原则', content: '服务器内容', status: 'active', version: 1 };
  await assert.rejects(() => prep.serverPrinciples().save(principle, preset), /共享草稿/);
  await assert.rejects(() => prep.serverPrinciples().remove(principle.id), /共享草稿/);
  assert.deepEqual(prep.serverWrites, [], '正式内容不得绕过共享草稿直接写服务器');
  // 头部保存按钮必须提交到数据库共享草稿（服务器），而不是浏览器存储
  await prep.element('btnQuickSaveWorkspace').onclick();
  assert.equal(prep.serverWrites[0].type, 'workspace-save');
  assert.equal(prep.serverWrites.length, 1);
}

async function testManagedAdminDirtyEditorPreservesFields() {
  const managed = loadManagedAdmin();
  await managed.init();
  const stem = managed.element('questionStemInput');
  stem.value = '未提交的老师题干';
  managed.input(stem);
  assert.equal(managed.api.getServerCatalogRefreshState().dirty, true, 'raw managed editor input must set the shared dirty signal');
  managed.remote({
    banks: [{ id: 'bank-1', name: '服务器共享题库', subject: 'PMP' }],
    questions: [{ id: 'q-1', bankId: 'bank-1', title: '服务器新题目', stemParts: [{ text: '服务器题干' }], options: [{ id: 'A', text: 'A2' }, { id: 'B', text: 'B2' }], correctAnswer: 'B' }],
    contentRevision: 9,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(stem.value, '未提交的老师题干', 'managed catalog refresh must not overwrite a dirty question field');
  assert.equal(managed.api.getServerCatalogRefreshState().revision, 9);
  assert.match(managed.element('qbQuestionList').innerHTML, /服务器新题目/, 'managed read-only question list must refresh while editor stays dirty');
  assert.match(managed.element('qbServerCatalogNewerNotice').innerHTML, /重新载入[^]*合并当前表单/, 'managed dirty editor must expose explicit reload and merge actions');
  await managed.api.applyServerCatalogRefresh({ mode: 'reload' });
  assert.equal(stem.value, '服务器题干', 'explicit reload must replace the form with the retained server version');
  assert.equal(managed.api.getServerCatalogRefreshState().dirty, false);
}

async function testManagedAdminJsonImportPersistsBeforeAnyQuestionSave() {
  const managed = loadManagedAdmin();
  await managed.init();
  const sourceBank = {
    id: 'source-bank-import', name: '导入后持久化题库', subject: 'PMP',
    questions: [{
      id: 'source-question-import', title: '导入后持久化题目',
      stemParts: [{ text: '导入题干' }], options: [{ id: 'A', text: '正确' }, { id: 'B', text: '错误' }], correctAnswer: 'A',
    }],
  };
  const success = await managed.api.importQuestionBanks({ banks: [sourceBank] });
  assert.equal(success.ok, true);
  assert.equal(managed.api.getCurrentBank().id, 'b-imported');
  assert.equal(managed.api.getCurrentQuestion().id, 'q-imported');
  assert.equal(managed.api.getCurrentQuestion().revision, 1);

  const before = JSON.stringify(managed.api.getAllQuestions());
  managed.Catalog.importBanks = async () => { throw new Error('模拟网络中断'); };
  const failed = await managed.api.importQuestionBanks({ banks: [sourceBank] });
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(managed.api.getAllQuestions()), before, 'failed imports must retain the visible managed catalog');
  assert.match(managed.alerts.at(-1), /导入未提交/);
}

async function testManagedAdminReimportUsesExportedSourceIdsWhenTheServerSkipsDuplicates() {
  const managed = loadManagedAdmin();
  await managed.init();
  const exportedBank = {
    id: 'b-internal-server-id', sourceId: 'stable-export-bank', name: '已导出的服务器题库', subject: 'PMP',
    questions: [{
      id: 'q-internal-server-id', sourceId: 'stable-export-question', title: '已导出的服务器题目',
      stemParts: [{ text: '原样再导入不得重复创建' }], options: [{ id: 'A', text: '正确' }, { id: 'B', text: '错误' }], correctAnswer: 'A',
    }],
  };
  managed.remote({
    banks: [{ id: exportedBank.id, sourceId: exportedBank.sourceId, name: exportedBank.name, subject: 'PMP', revision: 1 }],
    questions: [{ ...exportedBank.questions[0], bankId: exportedBank.id, revision: 1 }],
    contentRevision: 3,
  });
  managed.Catalog.importBanks = async () => ({
    banks: [],
    sourceBankIdMap: { 'stable-export-bank': 'b-internal-server-id' },
    sourceQuestionIdMap: { 'stable-export-bank::stable-export-question': 'q-internal-server-id' },
    contentRevision: 3,
    importPlan: { skip: 1 },
  });

  const result = await managed.api.importQuestionBanks({ banks: [exportedBank] });

  assert.equal(result.ok, true, 'a duplicate export must resolve through sourceId rather than be reported as a failed import');
  assert.equal(managed.api.getCurrentBank().id, 'b-internal-server-id');
  assert.equal(managed.api.getCurrentQuestion().id, 'q-internal-server-id');
  assert.equal(managed.alerts.length, 0);
}

async function testManagedAdminMergePreservesNestedDraft() {
  const managed = loadManagedAdmin();
  await managed.init();
  managed.element('questionStemInput').value = '合并后的本地题干';
  managed.element('questionStemPrincipleIdsInput').value = 'principle-dom';
  managed.element('clueTextInput').value = '尚未点击保存的线索';
  managed.element('conceptTitleInput').value = '尚未点击保存的知识点';
  managed.input(managed.element('clueTextInput'));
  managed.remote({
    banks: [{ id: 'bank-1', name: '服务器共享题库', subject: 'PMP' }],
    questions: [{ id: 'q-1', bankId: 'bank-1', title: '服务器题目', revision: 2, stemParts: [{ text: '服务器题干' }], options: [{ id: 'A', text: 'A2' }, { id: 'B', text: 'B2' }], correctAnswer: 'B', clues: [], concepts: [] }],
    contentRevision: 2,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  managed.element('clueTextInput').value = '服务器提示后继续输入的线';
  managed.input(managed.element('clueTextInput'));
  managed.element('clueTextInput').value = '服务器提示后继续输入的线索';
  managed.input(managed.element('clueTextInput'));
  assert.equal(await managed.api.applyServerCatalogRefresh({ mode: 'merge' }), true);
  const saved = managed.savedQuestions.at(-1);
  assert.equal(saved.options.baseRevision, 2, 'merge must use the same server entity and its latest revision');
  assert.equal(saved.value.stemParts[0].text, '合并后的本地题干');
  assert.ok(saved.value.clues.some(item => item.text === '本地线索'), 'state-backed local clues must survive remote read-only refresh');
  assert.equal(saved.value.clues.filter(item => item.text.includes('服务器提示后继续输入')).length, 1, 'continued pending clue input must replace its captured draft instead of accumulating partial duplicates');
  assert.ok(saved.value.clues.some(item => item.text === '服务器提示后继续输入的线索'), 'an in-progress clue subform must be captured into explicit merge');
  assert.ok(saved.value.concepts.some(item => item.title === '尚未点击保存的知识点'), 'an in-progress concept subform must be captured into explicit merge');
  assert.equal(JSON.stringify(saved.value.metadata.principleIds), '["principle-dom"]');
}

async function testManagedAdminDeletionRequiresConflictCopy() {
  const managed = loadManagedAdmin();
  await managed.init();
  managed.element('questionStemInput').value = '删除冲突中的本地题干';
  managed.element('clueTextInput').value = '删除冲突中的未存线索';
  managed.input(managed.element('clueTextInput'));
  managed.remote({
    banks: [{ id: 'bank-1', name: '服务器共享题库', subject: 'PMP' }],
    questions: [{ id: 'q-other', bankId: 'bank-1', title: '其他服务器题目', revision: 1, stemParts: [{ text: '其他题干' }], options: [] }],
    contentRevision: 2,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(managed.api.getServerCatalogRefreshState().conflictReason, /原题目已删除或移动/);
  assert.equal(await managed.api.applyServerCatalogRefresh({ mode: 'merge' }), false, 'deleted dirty entity must never retarget merge to the first server question');
  assert.equal(managed.savedQuestions.length, 0);
  const draft = managed.api.exportServerCatalogLocalDraft();
  assert.equal(draft.question.stemParts[0].text, '删除冲突中的本地题干');
  assert.ok(draft.question.clues.some(item => item.text === '删除冲突中的未存线索'));
  assert.equal(managed.api.copyServerCatalogLocalDraft(), true);
  const copied = managed.api.getCurrentQuestion();
  assert.notEqual(copied.id, 'q-other');
  assert.equal(copied.stemParts[0].text, '删除冲突中的本地题干');
  assert.ok(copied.clues.some(item => item.text === '删除冲突中的未存线索'));
}

async function testManagedAdminBlocksIncompleteNestedMerge() {
  const managed = loadManagedAdmin();
  await managed.init();
  managed.element('clueExplainInput').value = '只填写了解释，关键词还没填';
  managed.input(managed.element('clueExplainInput'));
  managed.remote({
    banks: [{ id: 'bank-1', name: '服务器共享题库', subject: 'PMP' }],
    questions: [{ id: 'q-1', bankId: 'bank-1', title: '服务器题目', revision: 2, stemParts: [{ text: '服务器题干' }], options: [] }],
    contentRevision: 2,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await managed.api.applyServerCatalogRefresh({ mode: 'merge' }), false, 'partial nested forms must block merge instead of silently dropping raw values');
  assert.equal(managed.savedQuestions.length, 0);
  assert.equal(managed.element('clueExplainInput').value, '只填写了解释，关键词还没填');
  assert.match(managed.api.exportServerCatalogLocalDraft().pendingSubforms.incompleteReason, /尚未填写关键词/);
  managed.element('clueTextInput').value = '补全后的关键词';
  managed.input(managed.element('clueTextInput'));
  assert.equal(await managed.api.applyServerCatalogRefresh({ mode: 'merge' }), true);
  assert.ok(managed.savedQuestions.at(-1).value.clues.some(item => item.text === '补全后的关键词' && item.explain === '只填写了解释，关键词还没填'));
}

async function testManagedAdminBlocksSelectOnlyNestedMerge() {
  const managed = loadManagedAdmin();
  await managed.init();
  managed.element('clueTypeInput').value = 'trap';
  managed.change(managed.element('clueTypeInput'));
  managed.remote({
    banks: [{ id: 'bank-1', name: '服务器共享题库', subject: 'PMP' }],
    questions: [{ id: 'q-1', bankId: 'bank-1', title: '服务器题目', revision: 2, stemParts: [{ text: '服务器题干' }], options: [] }],
    contentRevision: 2,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await managed.api.applyServerCatalogRefresh({ mode: 'merge' }), false, 'select-only clue edits must count as an incomplete subform instead of being silently dropped');
  assert.equal(managed.savedQuestions.length, 0);
  assert.equal(managed.element('clueTypeInput').value, 'trap');
}

async function testManagedAdminResetClearsPendingNestedBlock() {
  const managed = loadManagedAdmin();
  await managed.init();
  managed.element('clueTextInput').value = '已取消的未存关键词';
  managed.input(managed.element('clueTextInput'));
  await managed.element('qbCancelClueEditBtn').trigger('click');
  assert.equal(managed.element('clueTextInput').value, '');
  managed.remote({
    banks: [{ id: 'bank-1', name: '服务器共享题库', subject: 'PMP' }],
    questions: [{ id: 'q-1', bankId: 'bank-1', title: '服务器题目', revision: 2, stemParts: [{ text: '服务器题干' }], options: [] }],
    contentRevision: 2,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await managed.api.applyServerCatalogRefresh({ mode: 'merge' }), true, 'a cancelled/reset nested form must not leave a stale touched flag that blocks later merge');
  assert.ok(!managed.savedQuestions.at(-1).value.clues.some(item => item.text === '已取消的未存关键词'));
}

async function testManagedAdminMergesFloatingClueDraft() {
  const managed = loadManagedAdmin();
  await managed.init();
  managed.element('floatingClueTextInput').value = '悬浮面板未存关键词';
  managed.element('floatingClueExplainInput').value = '悬浮面板未存解释';
  managed.input(managed.element('floatingClueExplainInput'));
  managed.remote({
    banks: [{ id: 'bank-1', name: '服务器共享题库', subject: 'PMP' }],
    questions: [{ id: 'q-1', bankId: 'bank-1', title: '服务器题目', revision: 2, stemParts: [{ text: '服务器题干' }], options: [] }],
    contentRevision: 2,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await managed.api.applyServerCatalogRefresh({ mode: 'merge' }), true);
  assert.ok(managed.savedQuestions.at(-1).value.clues.some(item => item.text === '悬浮面板未存关键词' && item.explain === '悬浮面板未存解释'));
}

async function testTrainingQuestionEditRoutesToBaseInfo() {
  const managed = loadManagedAdmin();
  await managed.init();
  managed.element('body').dataset.qbWorkflowStep = 'training';
  const destination = managed.api.openQuestionBasicInfo('q-1');
  assert.equal(destination, 'question-bank.html?mode=simple&step=questions&bankId=bank-1&questionId=q-1');
  assert.equal(managed.location.href, destination, 'training question actions must navigate to the selected question basic-info view');
}

async function testDirtyPrepEditorPreservesFieldsOnRemoteCommit() {
  const prep = loadPrepEvents();
  await new Promise(resolve => setTimeout(resolve, 0));
  const beforeQuestion = JSON.stringify(prep.question);
  const beforeStem = prep.stemInput.value;
  const beforeRefreshes = prep.bankRefreshes();
  await prep.remote({ revision: 5, source: 'remote-teacher' });
  assert.equal(JSON.stringify(prep.question), beforeQuestion, 'remote refresh must not replace a dirty question model');
  assert.equal(prep.stemInput.value, beforeStem, 'remote refresh must leave dirty form fields untouched');
  assert.equal(prep.prepRuntime.dirty, true, 'remote refresh must preserve the local dirty state');
  assert.equal(prep.bankRefreshes(), beforeRefreshes + 1, 'remote refresh must update the read-only server bank list');
  assert.equal(prep.prepRuntime.serverCatalogSnapshot.questions[0].title, '服务器新题', 'remote refresh must retain a read-only question snapshot');
  assert.match(prep.elementText('questionList'), /服务器新题/, 'dirty question list must refresh from the server snapshot');
  assert.match(prep.elementText('principleList'), /服务器原则/, 'dirty principle list must refresh without replacing its editor');
  assert.match(prep.status.textContent, /服务器有新版本.*显式重新载入或合并/);
  assert.ok(prep.dispatched.some(event => event.type === 'prep:server-content-advanced' && event.detail.requiresExplicitReload));
  await prep.applyRemote({ mode: 'reload' });
  assert.equal(prep.state.questionBank.questions[0].title, '服务器新题', 'explicit reload must apply the retained server question snapshot');
  assert.equal(prep.state.principles.items[0].name, '服务器原则', 'explicit reload must apply the retained principle projection');
  assert.equal(prep.state.synthesisPresets.items[0].title, '服务器归纳卡', 'explicit reload must apply the retained preset projection');
  assert.equal(prep.prepRuntime.dirty, false, 'explicit reload may clear dirty state only after applying server content');
}

async function testDirtyPrepPrinciplePresetMergePreservesRawFields() {
  const prep = loadPrepEvents();
  prep.element('pmPrincipleName').value = '未保存的新原则名称';
  prep.element('pmConfusable').value = 'principle-x, principle-y';
  prep.element('pmPresetTitle').value = '未保存的新归纳卡';
  prep.element('pmPresetContent').value = '未保存的归纳内容';
  prep.element('pmPresetStatus').value = 'active';
  prep.element('pmPresetVersion').value = '3';
  await new Promise(resolve => setTimeout(resolve, 0));
  await prep.remote({ revision: 5, source: 'remote-teacher' });
  assert.equal(prep.element('pmPrincipleName').value, '未保存的新原则名称', 'remote read-only refresh must not overwrite raw principle fields');
  assert.equal(await prep.applyRemote({ mode: 'merge' }), true);
  const principle = prep.state.principles.items.find(item => item.id === 'principle-local');
  const preset = prep.state.synthesisPresets.items.find(item => item.principleId === 'principle-local');
  assert.equal(principle.name, '未保存的新原则名称');
  assert.equal(JSON.stringify(principle.confusablePrincipleIds), '["principle-x","principle-y"]');
  assert.equal(preset.title, '未保存的新归纳卡');
  assert.equal(preset.content, '未保存的归纳内容');
  assert.equal(preset.status, 'active');
  assert.equal(preset.version, 3);
}

async function testPrepRemoteRefreshesSerialize() {
  const pending = [];
  const prep = loadPrepEvents({
    listWritableBanks(call) {
      if (call === 1) return [{ id: 'bank-1', name: '初始题库', accessMode: 'teacher' }];
      return new Promise(resolve => pending.push(resolve));
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const revisionTwo = prep.remote({ revision: 2, source: 'remote-2' });
  await new Promise(resolve => setTimeout(resolve, 0));
  const revisionThree = prep.remote({ revision: 3, source: 'remote-3' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pending.length, 1, 'Content Prep remote list refreshes must serialize');
  pending.shift()([{ id: 'bank-2', name: '版本 2', accessMode: 'teacher' }]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pending.length, 1, 'Content Prep must run the queued newer refresh after the first response');
  pending.shift()([{ id: 'bank-3', name: '版本 3', accessMode: 'teacher' }]);
  await Promise.all([revisionTwo, revisionThree]);
  assert.equal(prep.prepRuntime.serverContentRevision, 3);
}

async function testPrepRemoteRefreshRetriesBeforeAdvancingRevision() {
  const prep = loadPrepEvents({
    listWritableBanks(call) {
      if (call === 2) throw new Error('临时断网');
      return [{ id: call === 1 ? 'initial' : 'recovered', name: '题库', accessMode: 'teacher' }];
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  await prep.remote({ revision: 2, source: 'remote' });
  assert.equal(prep.bankRefreshes(), 3, 'Content Prep must retry a transient list refresh');
  assert.equal(prep.prepRuntime.serverContentRevision, 2, 'Content Prep may advance only after a successful remote refresh');
  assert.equal(prep.prepRuntime.serverBanks[0].id, 'recovered');
}

async function testPrepRetainsRevisionAfterShortRetryBudget() {
  const prep = loadPrepEvents({
    listWritableBanks(call) {
      if (call >= 2 && call <= 4) throw new Error('持续临时断网');
      return [{ id: call === 1 ? 'initial' : 'recovered-later', name: '题库', accessMode: 'teacher' }];
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  await prep.remote({ revision: 2, source: 'remote' });
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(prep.prepRuntime.serverContentRevision, 2, 'Content Prep must retain and retry a revision after the short retry budget');
  assert.equal(prep.prepRuntime.serverBanks[0].id, 'recovered-later');
}

async function testPrepRetriesSuccessfulButStaleCatalogSnapshot() {
  const prep = loadPrepEvents({
    loadCatalog(call) {
      return {
        banks: [{ id: 'bank-1', name: '共享题库', subject: 'PMP' }],
        questions: [{ id: call === 1 ? 'stale-question' : 'fresh-question', bankId: 'bank-1', title: '题目' }],
        contentRevision: call === 1 ? 1 : 2,
      };
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  await prep.remote({ revision: 2, source: 'remote' });
  assert.equal(prep.catalogRefreshes(), 2, 'Content Prep must retry a successful bootstrap that is still behind the announced revision');
  assert.equal(prep.prepRuntime.serverCatalogSnapshot.questions[0].id, 'fresh-question');
  assert.equal(prep.prepRuntime.serverContentRevision, 2);
}

async function testPrepPagehideStopsInFlightRetryLoop() {
  let rejectRefresh;
  const prep = loadPrepEvents({
    listWritableBanks(call) {
      if (call === 1) return [{ id: 'initial', name: '初始题库', accessMode: 'teacher' }];
      return new Promise((_resolve, reject) => { rejectRefresh = reject; });
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const refresh = prep.remote({ revision: 2, source: 'remote' });
  await new Promise(resolve => setTimeout(resolve, 0));
  prep.pagehide();
  rejectRefresh(new Error('页面已隐藏'));
  await refresh;
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(prep.bankRefreshes(), 2, 'Content Prep must not restart an in-flight retry loop after pagehide');
  assert.equal(prep.prepRuntime.serverContentRevision, 1, 'Content Prep must not apply an in-flight revision after pagehide');
}

testPrepPublishesOnlyCommittedServerChanges()
  .then(testPrepPrincipleCrudAndWorkspaceSaveAreServerBacked)
  .then(testManagedAdminDirtyEditorPreservesFields)
  .then(testManagedAdminJsonImportPersistsBeforeAnyQuestionSave)
  .then(testManagedAdminReimportUsesExportedSourceIdsWhenTheServerSkipsDuplicates)
  .then(testManagedAdminMergePreservesNestedDraft)
  .then(testManagedAdminDeletionRequiresConflictCopy)
  .then(testManagedAdminBlocksIncompleteNestedMerge)
  .then(testManagedAdminBlocksSelectOnlyNestedMerge)
  .then(testManagedAdminResetClearsPendingNestedBlock)
  .then(testManagedAdminMergesFloatingClueDraft)
  .then(testTrainingQuestionEditRoutesToBaseInfo)
  .then(testDirtyPrepEditorPreservesFieldsOnRemoteCommit)
  .then(testDirtyPrepPrinciplePresetMergePreservesRawFields)
  .then(testPrepRemoteRefreshesSerialize)
  .then(testPrepRemoteRefreshRetriesBeforeAdvancingRevision)
  .then(testPrepRetainsRevisionAfterShortRetryBudget)
  .then(testPrepRetriesSuccessfulButStaleCatalogSnapshot)
  .then(testPrepPagehideStopsInFlightRetryLoop)
  .then(() => console.log('content-prep-question-bank-integration-ok'))
  .catch(error => { console.error(error); process.exitCode = 1; });
