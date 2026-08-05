import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const source = (path) => readFileSync(resolve(repoDir, path), 'utf8')

test('coalesced runtime saves identify every mutated key', () => {
  const bootstrap = source('frontend/scripts/new-legacy-assets/server-state-bootstrap.js')
  assert.match(bootstrap, /const mutations\s*=\s*Array\.from\(batch\.values\(\)\)/)
  assert.match(bootstrap, /snapshotMode:\s*'full',[\s\S]*mutations,[\s\S]*revision/)
})

test('non-retryable runtime mutations are discarded and server state is restored', () => {
  const bootstrap = source('frontend/scripts/new-legacy-assets/server-state-bootstrap.js')
  assert.match(bootstrap, /function discardBatch\(batch\)/)
  assert.match(bootstrap, /response\.status===403\|\|response\.status===422/)
  assert.match(bootstrap, /await reloadServerState\(\)/)
  assert.match(bootstrap, /discardBatch\(batch\)/)
})

test('a rejected runtime mutation is isolated without discarding legal siblings', () => {
  const bootstrap = source('frontend/scripts/new-legacy-assets/server-state-bootstrap.js')
  assert.match(bootstrap, /async function submitIsolatedBatch\(batch\)/)
  assert.match(bootstrap, /function splitBatch\(batch\)/)
  assert.match(bootstrap, /part\.size\s*===\s*1/)
  assert.match(bootstrap, /await submitPart\(left\)/)
  assert.match(bootstrap, /await submitPart\(right\)/)
})

test('analytics injection uses a browser global that exists at runtime', () => {
  const sync = source('frontend/scripts/sync-new-legacy.js')
  assert.doesNotMatch(sync, /const ANALYTICS_TRACK\s*=\s*['"][^'"\n]*\bglobal\./)
  assert.match(sync, /const ANALYTICS_TRACK\s*=\s*['"][^'"\n]*\bglobalThis\./)
})

test('course admin tolerates the optional account label', () => {
  const course = source('new-legacy/src/91-course-admin-app.js')
  assert.match(course, /const account=\$\('caAccount'\);if\(account\)account\.textContent=/)
})

test('system settings no longer calls the removed synchronous WeChat URL builder', () => {
  const settings = source('new-legacy/src/36-system-settings.js')
  assert.doesNotMatch(settings, /buildOfficialAuthUrl/)
})

test('user center awaits the authenticated self-profile endpoint', () => {
  const core = source('new-legacy/src/29-auth-core.js')
  const center = source('new-legacy/src/33-user-center.js')
  assert.match(core, /async function updateProfile/)
  assert.match(core, /method:["']PUT["']/)
  assert.match(center, /async function saveProfile/)
  assert.match(center, /await core\.updateProfile/)
  assert.match(core, /payload\.detail\|\|payload\.message/)
})

test('production engagement uses authenticated remote endpoints', () => {
  const runtime = source('frontend/scripts/new-legacy-assets/runtime-config.override.js')
  const repository = source('new-legacy/src/101-engagement-repository.js')
  assert.match(runtime, /engagement:\s*\{\s*mode:\s*['"]remote['"]/)
  assert.match(runtime, /\/api\/v1\/engagement\/feedback/)
  assert.match(repository, /payload\?\.detail\|\|payload\?\.message/)
})

test('engagement rejects executable attachment URLs and reads every bounded page', () => {
  const service = source('backend/app/services/engagement_service.py')
  const repository = source('new-legacy/src/101-engagement-repository.js')
  const support = source('new-legacy/src/103-support-center.js')
  const admin = source('new-legacy/src/105-feedback-management-app.js')
  assert.match(service, /validate_feedback_attachment/)
  assert.match(service, /base64\.b64decode\([\s\S]{0,100}validate=True/)
  assert.match(repository, /async function remoteAllPages/)
  assert.match(repository, /pagination\?\.hasMore/)
  assert.match(support, /MAX_ATTACHMENT_BYTES=160\*1024/)
  assert.ok(admin.includes('base64,[A-Za-z0-9+/]+={0,2}$'))
  assert.match(admin, /escapeHtml\(safe\)/)
})

test('practice mode supports short published papers and truthful scholar rewards', () => {
  const html = source('new-legacy/practice-mode.html')
  const practice = source('new-legacy/src/100-practice-mode.js')
  for (const script of ['37-subscription-plans.js', '37-subscription-orders.js', '37-subscription-redeem-codes.js', '37-subscription-core.js']) {
    assert.match(html, new RegExp(script.replaceAll('.', '\\.')))
  }
  assert.match(practice, /available>0&&available<COUNTS\[0\]/)
  assert.match(practice, /gainedSeconds/)
  assert.match(practice, /ACTIVE_ATTEMPT_PREFIX/)
  assert.match(practice, /function restoreActiveAttempt/)
  assert.match(practice, /sessionStorage/)
  assert.match(practice, /document\.body\.dataset\.practiceView==='game'&&state\.locked/)
  assert.doesNotMatch(practice, /pagehide[^\n]*saveRecord\('abandoned'/)
  assert.doesNotMatch(practice, /showFeedback\('正确'\+\(state\.mode==='scholar'\?' · \+20 秒'/)
})

test('practice resume requires the exact published release identity', () => {
  const practice = source('new-legacy/src/100-practice-mode.js')
  assert.match(practice, /releaseId:text\(release\?\.releaseId\)/)
  assert.match(practice, /paperVersion:Number\(release\?\.version\|\|0\)/)
  assert.match(practice, /text\(release\.releaseId\)!==text\(attempt\.releaseId\)/)
  assert.match(practice, /Number\(release\.version\)!==Number\(attempt\.paperVersion\)/)
})

test('teacher imports honor duplicate settings and reject blank bank metadata', () => {
  const workflow = source('new-legacy/src/97-teacher-question-workflow.js')
  const bank = source('new-legacy/src/65-question-bank-admin.js')
  assert.match(workflow, /bulkAddQuestions\?\.\(\[question\],\{skipDuplicates:byId\('tqSkipDuplicates'\)\?\.checked!==false\}\)/)
  assert.match(bank, /题库名称不能为空/)
  assert.match(bank, /自定义科目不能为空/)
})

test('graph editor uses thresholded large mode, visible labels, and reversible drag history', () => {
  const graph = source('new-legacy/src/10-graph-editor.js')
  const tabs = source('new-legacy/src/25-graph-file-tabs.js')
  const css = source('new-legacy/styles/main.css')
  assert.match(graph, /function isLargeGraphMode\(\)\{return isLargeGraphPreferenceEnabled\(\)&&isGraphOverLargeThreshold\(\)\}/)
  assert.match(graph, /function restoreGraphRedoSnapshot/)
  assert.match(graph, /key==='y'\|\|\(key==='z'&&e\.shiftKey\)/)
  assert.match(graph, /const undoSnapshot=graphUndoSnapshot\(\)/)
  assert.match(graph, /return true;\s*}\s*function shouldRenderLinkInCurrentMode/)
  assert.match(css, /\.mobile-bar button\{min-width:0;font-size:11px/)
  assert.match(graph, /function recoverMobileGraphViewport\(\)/)
  assert.match(graph, /fitBoundsToView\(bounds,\{margin:36,minScale:\.05,maxScale:\.85\}\)/)
  assert.match(graph, /function resetGraphHistory\(\)/)
  assert.match(tabs, /global\.resetGraphHistory\?\.\(\)/)
})

test('graph size and edit forms participate in undo history', () => {
  const graph = source('new-legacy/src/10-graph-editor.js')
  assert.match(graph, /pushGraphUndoSnapshot\('调整卡牌尺寸'/)
  assert.match(graph, /pushGraphUndoSnapshot\('编辑知识点'/)
  assert.match(graph, /pushGraphUndoSnapshot\('编辑知识关系'/)
  assert.match(graph, /deleteLinkFromDetailBtn[\s\S]{0,300}pushGraphUndoSnapshot\('删除关系'/)
})

test('content center remains an independent direct page', () => {
  const page = source('new-legacy/content-center.html')
  assert.doesNotMatch(page, /location\.replace\([^)]*admin-subjects\.html/)
  assert.match(page, /src="src\/91-content-center-app\.js"/)
})

test('membership requires confirmation and supports cancelling an own pending order', () => {
  const center = source('new-legacy/src/33-user-center.js')
  const adapter = source('frontend/scripts/new-legacy-assets/direct-system-adapter.js')
  const routes = source('backend/app/api/v1/subscriptions.py')
  assert.match(center, /handlePlanPick[\s\S]*renderPlanConfirm\(plan\)/)
  assert.match(center, /id="nativePayCancelOrderBtn"/)
  assert.match(center, /cancelNativeOrder\(order\.id\)/)
  assert.match(adapter, /async cancelNativeOrder\(orderId\)/)
  assert.match(adapter, /\/self-cancel/)
  assert.match(routes, /@router\.post\("\/orders\/\{order_id\}\/self-cancel"\)/)
})

test('learning and file pages expose the shared support center', () => {
  for (const pageName of ['practice-mode.html', 'question-training.html', 'question-workspace.html', 'knowledge-recall.html', 'file-manager.html']) {
    const page = source(`new-legacy/${pageName}`)
    assert.match(page, /styles\/support-center\.css/, `${pageName} 缺少支持中心样式`)
    assert.match(page, /src\/101-engagement-repository\.js/, `${pageName} 缺少消息数据源`)
    assert.match(page, /src\/103-support-center\.js/, `${pageName} 缺少支持中心交互`)
  }
})

test('support dialogs trap and restore focus with Chinese inline validation', () => {
  const support = source('new-legacy/src/103-support-center.js')
  assert.match(support, /\blet\s+[^\n;]*dialogReturnFocus=null/)
  assert.match(support, /function trapDialogFocus\(event\)/)
  assert.match(support, /event\.key!=='Tab'/)
  assert.match(support, /!backdrop\.contains\(document\.activeElement\)/)
  assert.match(support, /target\?\.focus\?\.\(\)/)
  assert.match(support, /请填写反馈标题和详细描述/)
  assert.match(support, /__KG_DIRECT_BOOTSTRAP__\?\.releaseVersion/)
  assert.doesNotMatch(support, /id="feedbackTitle"[^>]*required/)
})

test('production deploy waits for health before best-effort host cleanup', () => {
  const deploy = source('deploy/update.sh')
  const health = deploy.indexOf('/api/v1/health')
  const prune = deploy.indexOf('docker image prune')
  assert.ok(health >= 0 && prune > health)
  assert.match(deploy, /curl -fsS[^\n]+\/api\/v1\/health/)
  assert.match(deploy, /docker image prune[^\n]*\|\| true/)
  assert.match(deploy, /journalctl[^\n]*\|\| true/)
})

test('help navigation preserves its caller and clears stale zero-result detail', () => {
  const helpPage = source('new-legacy/help-center.html')
  const helpApp = source('new-legacy/src/104-help-center-app.js')
  const account = source('new-legacy/src/41-account-menu.js')
  const multiHelp = source('new-legacy/multi-question-help.html')
  assert.match(helpPage, /id="helpSearch"[^>]*aria-label="搜索帮助内容"/)
  assert.match(helpPage, /id="helpBack"/)
  assert.match(helpApp, /returnTo/)
  assert.match(helpApp, /if\(!rows\.length\)[\s\S]*helpContent/)
  assert.match(account, /help-center\.html\?returnTo=/)
  assert.match(multiHelp, /aria-label="返回多题归纳画布"/)
})

test('workspace filebar uses page-native rename controls instead of browser dialogs', () => {
  const filebar = source('new-legacy/src/79-multi-question-workspace-filebar.js')
  assert.match(filebar, /function openTitleEdit\(/)
  assert.match(filebar, /contentEditable='true'/)
  assert.doesNotMatch(filebar, /\b(?:prompt|confirm)\s*\(/)
})

test('admin shell enforces the viewAdminConsole permission before rendering', () => {
  const shell = source('new-legacy/src/admin/50-admin-shell-app.js')
  assert.match(shell, /viewAdminConsole/)
  assert.match(shell, /permission|can\(/i)
})

for (const page of [
  'learning-path.html',
  'guided-learning-node.html',
  'guided-learning-placement-test.html',
]) {
  test(`${page} remains a real guided-learning route`, () => {
    assert.doesNotMatch(source(`new-legacy/${page}`), /location\.replace\(['"]practice-mode\.html/)
  })
}

test('file manager logout is remote and folders honor an explicit trash status', () => {
  const html = source('new-legacy/file-manager.html')
  const manager = source('new-legacy/src/27-graph-file-manager.js')
  const store = source('new-legacy/src/23-graph-file-store.js')
  assert.match(manager, /async function accountSessionAction/)
  assert.match(manager, /await auth\.logout/)
  assert.match(html, /id="fmUserCenterBtn"/)
  assert.match(html, /id="fmSystemSettingsLink"[^>]*hidden/)
  assert.match(html, /src="src\/33-user-center\.js"/)
  assert.match(manager, /fmSystemSettingsLink'\)\.hidden=\!\(user&&user\.role==='admin'\)/)
  assert.match(manager, /fmUserCenterBtn'\)\.hidden=\!user/)
  assert.match(manager, /KGUserCenter.*\.open/)
  assert.match(store, /if\(status\)folders=folders\.filter\(folder=>folder\.status===status\)/)
})

test('file tags and explicit favorites are independent', () => {
  const manager = source('new-legacy/src/27-graph-file-manager.js')
  const organizer = source('new-legacy/src/27-file-manager-organize.js')
  const store = source('new-legacy/src/23-graph-file-store.js')
  assert.match(store, /favoriteExplicit/)
  assert.match(manager, /file\.favorite/)
  assert.match(manager, /action==='favorite'/)
  assert.doesNotMatch(organizer, /并加入我的收藏|并退出我的收藏/)
})

test('workspace and graph manual saves await the server flush result', () => {
  const filebar = source('new-legacy/src/79-multi-question-workspace-filebar.js')
  const workspace = source('new-legacy/src/77-multi-question-workspace.js')
  const adapter = source('frontend/scripts/new-legacy-assets/direct-graph-adapter.js')
  const autosave = source('new-legacy/src/24-graph-file-autosave.js')
  assert.match(filebar, /async function manualSave/)
  assert.match(workspace, /async function manualSaveWorkspace/)
  assert.match(workspace, /await global\.KGServerStateStorage\?\.flush/)
  assert.match(adapter, /autosave\.reportError/)
  assert.match(autosave, /function reportError/)
})

test('new workspace synthesis cards avoid overlap and selected search targets stack above peers', () => {
  const workspace = source('new-legacy/src/77-multi-question-workspace.js')
  const css = source('new-legacy/styles/question-workspace.css')
  assert.match(workspace, /position\|\|findOpenCardPosition\(viewportCenterWorld\(\)/)
  assert.match(css, /\.qw-question-card\.is-selected\s*\{[^}]*z-index:/s)
  assert.match(css, /\.qw-workspace-tab-close\s*\{[^}]*z-index:/s)
})

test('mobile learning headers keep the account menu and recall validates blank custom nodes', () => {
  const shell = source('new-legacy/styles/learning-practice-shell.css')
  const practiceCss = source('new-legacy/styles/practice-mode.css')
  const recall = source('new-legacy/src/86-knowledge-recall.js')
  assert.match(shell, /\.lp-top-actions \.account-menu-trigger\{display:inline-flex!important\}/)
  assert.doesNotMatch(shell, /\.lp-top-actions \.auth-status[^}]*display:none!important/)
  assert.match(practiceCss, /@media \(max-width:420px\)/)
  assert.match(recall, /setCustomValidity\('请输入要添加的知识点'\)/)
  assert.match(recall, /lastViewportSize/)
})

test('zero-result graph search clears stale hidden selections', () => {
  const graph = source('new-legacy/src/10-graph-editor.js')
  assert.match(graph, /if\(!results\.length\)\{\s*if\(state\.selectedNodeId\|\|state\.selectedLinkId/s)
  assert.match(graph, /clearSelection\(\);\s*refreshSelectionUI\(\)/s)
})

test('admin diagnostics checks the backend without writing an unregistered storage probe', () => {
  const settings = source('new-legacy/src/admin/53-admin-settings-app.js')
  assert.match(settings, /async function health/)
  assert.match(settings, /fetch\('\/api\/v1\/health'/)
  assert.doesNotMatch(settings, /Services\.repository\.health\(\)/)
})

test('cancelling a password reset exits without showing a validation error', () => {
  const users = source('new-legacy/src/35-user-management.js')
  assert.match(users, /const password=prompt\(`请输入 \$\{username\} 的新密码（至少 4 个字符）：`\);\s*if\(password===null\)return;/)
})
