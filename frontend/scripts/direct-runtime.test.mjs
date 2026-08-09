import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

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
  assert.doesNotMatch(source, /__KG_NEW_LEGACY_BOOTSTRAP__/)
})

test('direct state persistence never posts to a parent window', () => {
  assert.doesNotMatch(source, /parent\.postMessage/)
  assert.match(source, /fetch\(['"]\/api\/v1\/runtime\/state['"]/)
  assert.match(source, /credentials:\s*['"]include['"]/)
})

test('direct storage exposes save state and pagehide recovery', () => {
  assert.match(source, /kg:save-state/)
  assert.match(source, /snapshotMode:\s*['"]full['"]/) // full coalesced snapshot
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
  assert.match(adapter, /XMLHttpRequest/)
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
  for (const pageName of ['index.html', 'question-training.html']) {
    const page = readFileSync(resolve(frontendDir, `public/new-legacy/${pageName}`), 'utf8')
    assert.match(page, /direct-auth-adapter\.js/)
  }
  const entry = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/direct-entry.js'), 'utf8')
  assert.match(entry, /kg-auth-session-change/)
  assert.match(entry, /location\.reload/)
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

test('graph autosave adapter runs after the upstream autosave module', () => {
  const adapterPath = resolve(frontendDir, 'scripts/new-legacy-assets/direct-graph-adapter.js')
  assert.ok(existsSync(adapterPath), 'direct-graph-adapter.js should exist')
  const adapter = readFileSync(adapterPath, 'utf8')
  assert.match(adapter, /KGGraphFileAutosave/)
  assert.match(adapter, /saveNow/)
  assert.match(adapter, /KGServerStateStorage/)
  assert.match(adapter, /\.flush/)
  const graphPage = readFileSync(resolve(frontendDir, 'public/new-legacy/index.html'), 'utf8')
  assert.ok(graphPage.indexOf('src/24-graph-file-autosave.js') < graphPage.indexOf('direct-graph-adapter.js'))
})

test('file manager waits for server state before navigating', () => {
  const manager = readFileSync(resolve(frontendDir, 'public/new-legacy/src/27-graph-file-manager.js'), 'utf8')
  assert.match(manager, /await global\.KGServerStateStorage\.flush\(\)/)
  assert.match(manager, /await flushServerStateBeforeNavigation\(\)/)
  assert.match(manager, /async function openFile/)
  assert.match(manager, /onSubmit:async value/)
  assert.equal((manager.match(/location\.href='index\.html\?mode=free'/g) || []).length, 2)
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

test('question validation adapter runs after the upstream question editor', () => {
  const adapterPath = resolve(frontendDir, 'scripts/new-legacy-assets/direct-question-adapter.js')
  assert.ok(existsSync(adapterPath), 'direct-question-adapter.js should exist')
  const adapter = readFileSync(adapterPath, 'utf8')
  assert.match(adapter, /questionStemInput/)
  assert.match(adapter, /\.option-text/)
  assert.match(adapter, /stopImmediatePropagation/)
  const page = readFileSync(resolve(frontendDir, 'public/new-legacy/question-bank.html'), 'utf8')
  assert.ok(page.indexOf('src/65-question-bank-admin.js') < page.indexOf('direct-question-adapter.js'))
})

test('generated question preview persists the selected bank and question for recall', () => {
  const editor = readFileSync(resolve(frontendDir, 'public/new-legacy/src/65-question-bank-admin.js'), 'utf8')
  assert.match(editor, /async function previewDeepRecall\(\)/)
  const preview = editor.match(/function previewDeepRecall\(\)\{([\s\S]*?)window\.open\((?:url|'knowledge-recall\.html)/)
  assert.ok(preview)
  assert.match(preview[1], /const bank\s*=\s*currentBank\(\)/)
  assert.match(preview[1], /sourceBankId:bank\?\.id/)
  assert.match(preview[1], /await window\.KGServerStateStorage\.flush\(\)/)
})

test('training runtime CSS keeps shortcuts above the guided action dock', () => {
  const cssPath = resolve(frontendDir, 'scripts/new-legacy-assets/direct-runtime-fixes.css')
  assert.ok(existsSync(cssPath), 'direct-runtime-fixes.css should exist')
  const css = readFileSync(cssPath, 'utf8')
  assert.match(css, /question-training-page[\s\S]*kg-global-shortcuts/)
  assert.match(css, /bottom:\s*88px\s*!important/)
  const page = readFileSync(resolve(frontendDir, 'public/new-legacy/question-training.html'), 'utf8')
  assert.match(page, /direct-runtime-fixes\.css/)
})

test('member deep link opens plans only for student accounts', () => {
  const entry = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/direct-entry.js'), 'utf8')
  assert.match(entry, /authUser\?\.role/)
  assert.match(entry, /role\s*===\s*['"]student['"]/)
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
  assert.match(generated, /服务器按用户隔离保存|保存到服务器/)
})
