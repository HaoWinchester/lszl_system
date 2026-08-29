import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const source = readFileSync(resolve(scriptsDir, 'new-legacy-assets', 'server-state-bootstrap.js'), 'utf8')

test('question catalog runtime keys are legacy-read-only after cutover', () => {
  const contract = JSON.parse(readFileSync(resolve(scriptsDir, 'new-legacy-contract.json'), 'utf8'))
  const runtime = contract.runtimeStorage
  const readOnly = runtime.legacyReadOnlyKeys
  for (const key of [
    'kg_question_banks_published_v1',
    'kg_principle_repository_v1',
    'kg_synthesis_preset_repository_v1',
    'kg_question_tag_names_v1',
  ]) {
    assert.ok(readOnly.exactKeys.includes(key))
    assert.ok(!runtime.exactKeys.includes(key))
  }
  assert.ok(readOnly.prefixes.includes('kg_question_banks_v1__'))
  assert.ok(!runtime.prefixes.includes('kg_question_banks_v1__'))

  const syncSource = readFileSync(resolve(scriptsDir, 'sync-new-legacy.js'), 'utf8')
  assert.match(syncSource, /legacyReadOnlyKeys/)
  assert.match(syncSource, /只读旧键禁止新增写调用/)

  const adapterPath = resolve(scriptsDir, 'new-legacy-assets', 'question-catalog-adapter.js')
  assert.ok(existsSync(adapterPath), 'question catalog adapter must exist after cutover')
  const adapter = readFileSync(adapterPath, 'utf8')
  assert.doesNotMatch(adapter, /localStorage\s*\.\s*(?:setItem|removeItem)\s*\(/)
})

test('direct bootstrap consumes the FastAPI-injected payload', () => {
  assert.match(source, /__KG_DIRECT_BOOTSTRAP__/)
  assert.match(source, /const injected = global\.__KG_DIRECT_BOOTSTRAP__/)
  assert.match(source, /serverInjected/)
  assert.doesNotMatch(source, /__KG_NEW_LEGACY_BOOTSTRAP__/)
})

test('direct bootstrap preserves the backend namespace for paper management saves', async () => {
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type
      this.detail = options.detail
    }
  }
  const nativeStorage = {
    values: new Map(),
    get length() { return this.values.size },
    getItem(key) { return this.values.get(String(key)) ?? null },
    setItem(key, value) { this.values.set(String(key), String(value)) },
    removeItem(key) { this.values.delete(String(key)) },
    clear() { this.values.clear() },
    key(index) { return [...this.values.keys()][Number(index)] ?? null },
  }
  const listeners = new Map()
  const fetch = async (url) => {
    if (String(url).startsWith('/api/v1/auth/me')) {
      return { ok: true, json: async () => ({ user: { username: 'teacher-a', role: 'teacher' } }) }
    }
    return {
      ok: true,
      json: async () => ({ storage: {}, revision: 1, contentRevision: 1 }),
    }
  }
  const window = {
    location: { pathname: '/paper-management.html' },
    localStorage: nativeStorage,
    __KG_DIRECT_BOOTSTRAP__: {
      page: 'paper-management.html',
      namespace: 'papers',
      authenticated: true,
      authUser: { username: 'teacher-a', role: 'teacher' },
      username: 'teacher-a',
      revision: 1,
      contentRevision: 1,
      readOnly: false,
    },
    crypto: { randomUUID: () => 'runtime-test-request' },
    navigator: {},
    setTimeout: () => 0,
    clearTimeout() {},
    queueMicrotask(callback) { callback() },
    addEventListener(type, callback) { listeners.set(type, callback) },
    dispatchEvent() {},
  }
  window.window = window
  vm.runInNewContext(source, {
    window,
    fetch,
    CustomEvent,
    URLSearchParams,
    console,
  })
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(window.KGServerStateBootstrap.namespace, 'papers')
})

test('direct bootstrap refreshes its public session snapshot after remote login', async () => {
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type
      this.detail = options.detail
    }
  }
  const nativeStorage = {
    values: new Map(),
    get length() { return this.values.size },
    getItem(key) { return this.values.get(String(key)) ?? null },
    setItem(key, value) { this.values.set(String(key), String(value)) },
    removeItem(key) { this.values.delete(String(key)) },
    clear() { this.values.clear() },
    key(index) { return [...this.values.keys()][Number(index)] ?? null },
  }
  const listeners = new Map()
  let loggedIn = false
  const runtimeWrites = []
  const fetch = async (url, options = {}) => {
    if (String(url).startsWith('/api/v1/auth/me')) {
      return loggedIn
        ? { ok: true, json: async () => ({ user: { username: 'admin-a', role: 'admin' }, loginSessionId: 'session-a' }) }
        : { ok: false, status: 401 }
    }
    if (String(url).endsWith('/api/v1/runtime/state') && options.method === 'PUT') runtimeWrites.push(options.body)
    return { ok: true, json: async () => ({ storage: {}, revision: 2, contentRevision: 3 }) }
  }
  const window = {
    location: { pathname: '/practice-mode.html' },
    localStorage: nativeStorage,
    __PMP_PRODUCT_RELEASE__: 'v9.0-test',
    __KG_DIRECT_BOOTSTRAP__: {
      page: 'practice-mode.html',
      namespace: 'page',
      authenticated: false,
      authUser: null,
      graphFilesApiCutoverEnabled: true,
      revision: 0,
      contentRevision: 0,
      readOnly: false,
    },
    crypto: { randomUUID: () => 'runtime-login-test-request' },
    navigator: {},
    setTimeout: () => 0,
    clearTimeout() {},
    queueMicrotask(callback) { callback() },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(callback)
    },
    dispatchEvent() {},
  }
  window.window = window
  vm.runInNewContext(source, { window, fetch, CustomEvent, URLSearchParams, console })
  await new Promise(resolve => setImmediate(resolve))

  loggedIn = true
  for (const listener of listeners.get('kg:auth-session-changed') || []) {
    listener({ detail: { authenticated: true, username: 'admin-a', loginSessionId: 'session-a' } })
  }
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(window.__KG_DIRECT_BOOTSTRAP__.authenticated, true)
  assert.equal(window.__KG_DIRECT_BOOTSTRAP__.authUser.username, 'admin-a')
  assert.equal(window.__KG_DIRECT_BOOTSTRAP__.releaseVersion, 'v9.0-test')
  assert.equal(window.KGServerStateBootstrap.authenticated, true)

  window.localStorage.setItem('kg_graph_file_index_v2', '[]')
  await window.KGServerStateStorage.flush()
  assert.equal(runtimeWrites.length, 0, 'cut-over graph keys must never enter runtime-state writes')
  window.localStorage.setItem('kg_default_entry_mode_v1', 'free')
  await window.KGServerStateStorage.flush()
  assert.equal(runtimeWrites.length, 1, 'unrelated runtime preferences must remain writable')
})

test('a stale anonymous hydration cannot overwrite a newer authenticated session', async () => {
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type
      this.detail = options.detail
    }
  }
  const nativeStorage = {
    values: new Map(),
    get length() { return this.values.size },
    getItem(key) { return this.values.get(String(key)) ?? null },
    setItem(key, value) { this.values.set(String(key), String(value)) },
    removeItem(key) { this.values.delete(String(key)) },
    clear() { this.values.clear() },
    key(index) { return [...this.values.keys()][Number(index)] ?? null },
  }
  const listeners = new Map()
  const authResolvers = []
  const fetch = async (url) => {
    if (String(url).startsWith('/api/v1/auth/me')) {
      return new Promise(resolve => authResolvers.push(resolve))
    }
    return { ok: true, json: async () => ({ storage: {}, revision: 2, contentRevision: 3 }) }
  }
  const window = {
    location: { pathname: '/practice-mode.html' },
    localStorage: nativeStorage,
    __KG_DIRECT_BOOTSTRAP__: {
      page: 'practice-mode.html',
      namespace: 'page',
      authenticated: false,
      authUser: null,
      revision: 0,
      contentRevision: 0,
      readOnly: false,
    },
    crypto: { randomUUID: () => 'runtime-race-test-request' },
    navigator: {},
    setTimeout: () => 0,
    clearTimeout() {},
    queueMicrotask(callback) { callback() },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(callback)
    },
    dispatchEvent() {},
  }
  window.window = window
  vm.runInNewContext(source, { window, fetch, CustomEvent, URLSearchParams, console })
  assert.equal(authResolvers.length, 1)

  for (const listener of listeners.get('kg:auth-session-changed') || []) {
    listener({ detail: { authenticated: true, username: 'admin-a', loginSessionId: 'session-a' } })
  }
  assert.equal(authResolvers.length, 2)
  authResolvers[1]({
    ok: true,
    json: async () => ({ user: { username: 'admin-a', role: 'admin' }, loginSessionId: 'session-a' }),
  })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  authResolvers[0]({ ok: false, status: 401 })
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(window.__KG_DIRECT_BOOTSTRAP__.authenticated, true)
  assert.equal(window.__KG_DIRECT_BOOTSTRAP__.authUser.username, 'admin-a')
})

test('direct state persistence never posts to a parent window', () => {
  assert.doesNotMatch(source, /parent\.postMessage/)
  assert.match(source, /fetch\(['"]\/api\/v1\/runtime\/state['"]/)
  assert.match(source, /credentials:\s*['"]include['"]/)
})

test('direct storage exposes save state and pagehide recovery', () => {
  assert.match(source, /kg:save-state/)
  assert.match(source, /snapshotMode:\s*['"]merge['"]/) // merge 快照 + mutations 全量键标识
  assert.match(source, /pagehide/)
  assert.match(source, /sendBeacon/)
})

test('direct storage replaces page localStorage and exposes an awaitable flush', () => {
  assert.match(source, /Object\.defineProperty\(global,\s*['"]localStorage['"]/)
  assert.match(source, /storage\.flush\s*=\s*flush/)
  assert.match(source, /return\s+flushPromise/)
})

test('pagehide waits for upstream graph handlers before taking its beacon snapshot', () => {
  assert.match(source, /queueMicrotask/)
  assert.match(source, /sendLatestBeacon/)
})

test('a revision conflict reloads server state before retrying', () => {
  assert.match(source, /response\.status\s*===\s*409/)
  assert.match(source, /method:\s*['"]GET['"]/)
  assert.match(source, /serverState\.storage/)
  assert.match(source, /pendingMutations/)
  assert.match(source, /applyPendingMutations/)
})

test('the original user-management service writes real backend accounts', () => {
  const adapter = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/direct-admin-adapter.js'), 'utf8')
  assert.match(adapter, /KGDomainApi/)
  assert.doesNotMatch(adapter, /XMLHttpRequest/)
  assert.match(adapter, /\/api\/v1\/users/)
  assert.match(adapter, /canEnterUserManagement/)
  for (const action of ['createUser', 'updateUser', 'resetPassword', 'setStatus', 'duplicateUser', 'deleteUsers', 'batchUpdate', 'importUsers']) {
    assert.match(adapter, new RegExp(`service\\.${action}`))
  }
  const userPage = readFileSync(resolve(frontendDir, 'public/new-legacy/user-management.html'), 'utf8')
  const servicePosition = userPage.indexOf('src/35-user-management-service.js')
  const adapterPosition = userPage.indexOf('direct-admin-adapter.js')
  const uiPosition = userPage.indexOf('src/35-user-management.js')
  assert.ok(servicePosition >= 0 && servicePosition < adapterPosition)
  assert.ok(adapterPosition < uiPosition)
})

test('graph and training login use remote authentication then reload account state', () => {
  const adapter = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/direct-auth-adapter.js'), 'utf8')
  assert.match(adapter, /KGAuthCore/)
  assert.match(adapter, /core\.login/)
  assert.match(adapter, /core\.register/)
  assert.match(adapter, /core\.logout/)
  assert.match(adapter, /requireLegalConsent/)
  assert.match(adapter, /acceptedTermsVersion/)
  const graphShellBundle = readFileSync(resolve(frontendDir, 'public/new-legacy/bundles/home-shell.js'), 'utf8')
  assert.match(graphShellBundle, /direct-auth-adapter\.js/)
  const retiredTrainingPage = readFileSync(resolve(frontendDir, 'public/new-legacy/question-training.html'), 'utf8')
  assert.match(retiredTrainingPage, /location\.replace\(target\.toString\(\)\)/)
  assert.doesNotMatch(retiredTrainingPage, /direct-auth-adapter\.js/)
  const entry = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/direct-entry.js'), 'utf8')
  assert.match(entry, /kg-auth-session-change/)
  assert.match(entry, /requestCurrentUser/)
})

test('graph account menu clears the remote session through the backend logout path', () => {
  const guards = readFileSync(resolve(frontendDir, '..', 'new-legacy', 'src/30-auth-guards.js'), 'utf8')
  const logout = guards.match(/async function authLogout\(\)\{([\s\S]*?)\n\}(?=\nfunction authAfterExternalLogin)/)
  assert.ok(logout, 'graph auth guard should expose an async logout handler')
  assert.match(logout[1], /AuthCore\.providerStatus\?\.\(\)\.remote/)
  assert.match(logout[1], /await AuthCore\.logout\([\s\S]*?authCurrentUser=null;[\s\S]*?return true;/)

  const training = readFileSync(resolve(frontendDir, '..', 'new-legacy', 'src/72-question-training-page.js'), 'utf8')
  assert.match(training, /async function authLogout\(\)/)
  assert.match(training, /AuthCore\.providerStatus\?\.\(\)\.remote[\s\S]*?await AuthCore\.logout\(/)
  assert.match(training, /KGAuthRuntime=.*logout:authLogout/)
})

test('graph autosave adapter uses the domain file save result', () => {
  const adapterPath = resolve(frontendDir, 'scripts/new-legacy-assets/direct-graph-adapter.js')
  assert.ok(existsSync(adapterPath), 'direct-graph-adapter.js should exist')
  const adapter = readFileSync(adapterPath, 'utf8')
  assert.match(adapter, /KGGraphFileAutosave/)
  assert.match(adapter, /saveNow/)
  assert.doesNotMatch(adapter, /KGServerStateStorage|runtime\/state/)
  const graphBundle = readFileSync(resolve(frontendDir, 'public/new-legacy/bundles/home-graph.js'), 'utf8')
  assert.ok(graphBundle.indexOf('src/24-graph-file-autosave.js') < graphBundle.indexOf('direct-graph-adapter.js'))
})

test('file manager navigates after the domain store write without runtime flush', () => {
  const manager = readFileSync(resolve(scriptsDir, '..', '..', 'new-legacy', 'src', '27-graph-file-manager.js'), 'utf8')
  assert.match(manager, /async function openFile\(id\)/)
  assert.match(manager, /await Promise\.resolve\(store\.openFile\(id,\{owner:currentOwner\(\)\}\)\)/)
  assert.match(manager, /onSubmit:async value=>\{/)
  assert.doesNotMatch(manager, /KGServerStateStorage\.flush/)
  assert.doesNotMatch(manager, /flushServerStateBeforeNavigation/)
  assert.doesNotMatch(manager, /location\.href='index\.html\?mode=free'/)
})

test('generated graph editor discards new-node drafts and avoids exact overlap', () => {
  const editor = readFileSync(resolve(frontendDir, 'public/new-legacy/src/10-graph-editor.js'), 'utf8')
  assert.match(editor, /editingNodeIsNew/)
  assert.match(editor, /discardNew:true/)
  assert.match(editor, /findAvailableNodePosition/)
  assert.match(editor, /graphNodeRectsOverlap/)
})

test('generated graph editor keeps an existing relation on duplicate connect', () => {
  const editor = readFileSync(resolve(frontendDir, 'public/new-legacy/src/10-graph-editor.js'), 'utf8')
  const branch = editor.match(/if\(relationExists\(source,id\)\)\{([\s\S]*?)\}else\{/)
  assert.ok(branch)
  assert.match(branch[1], /已有关系线/)
  assert.match(branch[1], /state\.selectedLinkId\s*=\s*existing\?existing\.id:null/)
  assert.doesNotMatch(branch[1], /state\.links\s*=|\.splice\(|\.filter\(/)
})

test('question edit adapter is injected before the upstream question editor initializer', () => {
  const adapterPath = resolve(frontendDir, 'scripts/new-legacy-assets/direct-question-adapter.js')
  assert.ok(existsSync(adapterPath), 'direct-question-adapter.js should exist')
  const adapter = readFileSync(adapterPath, 'utf8')
  assert.match(adapter, /questionStemInput/)
  assert.match(adapter, /\.option-text/)
  assert.match(adapter, /stopImmediatePropagation/)
  const sync = readFileSync(resolve(frontendDir, 'scripts/sync-new-legacy.js'), 'utf8')
  assert.match(sync, /direct-question-adapter\.js[^]*kg-question-editor:generated[^]*catalogPage\.marker/)
})

test('question readonly lock leaves the shared principle library available', () => {
  const adapter = readFileSync(resolve(scriptsDir, 'new-legacy-assets', 'direct-question-adapter.js'), 'utf8')
  const attributes = new Map()
  const control = (id, scope = '') => ({
    id,
    disabled: false,
    addEventListener() {},
    hasAttribute(name) { return attributes.has(`${id}:${name}`) },
    getAttribute(name) { return attributes.get(`${id}:${name}`) ?? null },
    setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)) },
    removeAttribute(name) { attributes.delete(`${id}:${name}`) },
    closest(selector) {
      if (selector === '#qbPrincipleAnnotationPanel') return scope === 'principles-panel' ? this : null
      return null
    },
    matches(selector) {
      return selector === '[data-annotation-tab]' && ['principles-tab', 'annotation-tab'].includes(scope)
    },
  })
  const questionField = control('questionStemInput', 'question')
  const saveQuestion = control('qbSaveQuestionBtn', 'question')
  const principleTab = control('principleTab', 'principles-tab')
  const principleSave = control('tqSavePrincipleBtn', 'principles-panel')
  const recallTab = control('recallTab', 'annotation-tab')
  const annotationControls = [principleTab, principleSave, recallTab]
  const elements = new Map([
    ['questionStemInput', questionField],
    ['qbSaveQuestionBtn', saveQuestion],
    ['qbQuestionBaseCard', { querySelectorAll: () => [questionField, saveQuestion] }],
    ['qbAnnotationCard', { querySelectorAll: () => annotationControls }],
  ])
  const bodyAttributes = new Map()
  const document = {
    body: { setAttribute(name, value) { bodyAttributes.set(name, String(value)) } },
    getElementById(id) { return elements.get(id) || null },
  }
  const window = {
    KGQuestionCatalogAdapter: {}, document,
    clearInterval() {}, setInterval() { return 1 }, clearTimeout() {}, setTimeout() { return 1 },
  }
  vm.runInNewContext(adapter, { window, document, console })

  window.KGQuestionCatalogEditController.applyReadonlyState(true)

  assert.equal(questionField.disabled, true, 'the locked question form must remain read-only')
  assert.equal(recallTab.disabled, false, 'read-only annotation panels must remain navigable')
  assert.equal(principleTab.disabled, false, 'the shared principle tab must still be selectable')
  assert.equal(principleSave.disabled, false, 'shared principle CRUD must not depend on a question edit lock')
  assert.equal(bodyAttributes.get('data-question-catalog-readonly'), 'true')
})

test('generated question preview persists the selected bank and question for recall', () => {
  const editor = readFileSync(resolve(frontendDir, 'public/new-legacy/src/65-question-bank-admin.js'), 'utf8')
  assert.match(editor, /async function previewDeepRecall\(\)/)
  const preview = editor.match(/function previewDeepRecall\(\)\{([\s\S]*?)window\.open\((?:url|'knowledge-recall\.html)/)
  assert.ok(preview)
  assert.match(preview[1], /const bank\s*=\s*currentBank\(\)/)
  assert.match(preview[1], /sourceBankId:bank\?\.id/)
  assert.doesNotMatch(preview[1], /KGServerStateStorage|runtime\/state/)
})

test('retired training shell does not load the former training runtime', () => {
  const cssPath = resolve(frontendDir, 'scripts/new-legacy-assets/direct-runtime-fixes.css')
  assert.ok(existsSync(cssPath), 'direct-runtime-fixes.css should exist')
  const css = readFileSync(cssPath, 'utf8')
  assert.match(css, /question-training-page[\s\S]*kg-global-shortcuts/)
  assert.match(css, /bottom:\s*88px\s*!important/)
  const page = readFileSync(resolve(frontendDir, 'public/new-legacy/question-training.html'), 'utf8')
  assert.match(page, /location\.replace\(target\.toString\(\)\)/)
  assert.doesNotMatch(page, /direct-runtime-fixes\.css/)
})

test('member deep link opens plans only for student accounts', () => {
  const entry = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/direct-entry.js'), 'utf8')
  assert.match(entry, /requestCurrentUser\(\)/)
  assert.match(entry, /currentRole\(\)/)
  assert.match(entry, /userRole\s*===\s*['"]student['"]/)
  assert.match(entry, /KGUserCenter\?\.open\?\.\(\)/)
  assert.match(entry, /upgradeMemberBtn/)
})

test('student navigation never exposes the user-management shortcut', () => {
  const shortcuts = readFileSync(resolve(frontendDir, '../new-legacy/src/39-global-shortcuts.js'), 'utf8')

  assert.doesNotMatch(shortcuts, /id:"users"[\s\S]*allowWhenNoAdmin:true/)
})

test('admin import supplies an explicit initial password to the backend', () => {
  const adapter = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/direct-admin-adapter.js'), 'utf8')
  assert.match(adapter, /prompt\(/)
  assert.match(adapter, /initial_password/)
  assert.match(adapter, /至少 4 位/)
  assert.match(adapter, /导入账号的初始密码/)
})

test('system settings adapter uses normalized backend APIs before rendering', () => {
  const adapterPath = resolve(frontendDir, 'scripts/new-legacy-assets/direct-system-adapter.js')
  assert.ok(existsSync(adapterPath), 'direct-system-adapter.js should exist')
  const adapter = readFileSync(adapterPath, 'utf8')
  for (const endpoint of ['themes', 'wechat-config', 'wechat-pay-config', 'subscription-plans']) {
    assert.match(adapter, new RegExp(`/api/v1/system/${endpoint}`))
  }
  assert.match(adapter, /method, path/)
  assert.match(adapter, /saveTheme/)
  assert.match(adapter, /saveConfig/)
  assert.match(adapter, /setPlanSettings/)
  const page = readFileSync(resolve(frontendDir, 'public/new-legacy/system-settings.html'), 'utf8')
  assert.ok(page.indexOf('direct-system-adapter.js') < page.indexOf('src/36-system-settings.js'))
})

test('generated pages describe the server-backed architecture without stale local-demo copy', () => {
  const generatedFiles = [
    'index.html',
    'question-training.html',
    'system-settings.html',
    'user-management.html',
    'src/32-wechat-login.js',
    'src/33-user-center.js',
    'src/35-user-management.js',
    'src/36-system-settings.js',
  ]
  const generated = generatedFiles
    .map((path) => readFileSync(resolve(frontendDir, 'public/new-legacy', path), 'utf8'))
    .join('\n')
  const staleVisibleCopy = [
    '账号和数据保存在本浏览器 localStorage',
    '管理本浏览器中的账号资料',
    '后续接服务器后细化',
    '当前纯前端版本暂未接入支付',
    '当前纯前端版本暂不接真实支付',
    '仅保存在本浏览器',
    '当前纯前端版支持“本地演示扫码登录”',
    '当前纯前端版本保留本地演示扫码能力',
    '当前版本为前端权限提示与拦截',
    '正式收费时应由后端保存价格、订单和订阅状态',
    '本浏览器 localStorage',
  ]
  for (const copy of staleVisibleCopy) assert.doesNotMatch(generated, new RegExp(copy))
  assert.match(generated, /服务器(?:校验与保存|保存)|同步保存到后台|保存到服务器/)
})
