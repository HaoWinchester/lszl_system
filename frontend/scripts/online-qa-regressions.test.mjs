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

test('practice mode supports short published papers, truthful scholar rewards, and database-backed histories', () => {
  const html = source('new-legacy/practice-mode.html')
  const practice = source('new-legacy/src/100-practice-mode.js')
  const adapter = source('frontend/scripts/new-legacy-assets/practice-learning-adapter.js')
  const routes = source('backend/app/api/v1/learning.py')
  for (const script of ['37-subscription-plans.js', '37-subscription-orders.js', '37-subscription-redeem-codes.js', '37-subscription-core.js']) {
    assert.match(html, new RegExp(script.replaceAll('.', '\\.')))
  }
  assert.match(practice, /available>0&&available<COUNTS\[0\]/)
  assert.match(practice, /gainedSeconds/)
  assert.match(practice, /api\.recordSession\(practiceSessionPayload\(status\)\)/)
  assert.match(practice, /await api\.listSessions\(\)/)
  assert.match(adapter, /const API_ROOT = '\/api\/v1\/learning\/practice'/)
  assert.match(adapter, /request\('\/sessions'/)
  assert.match(routes, /@router\.post\("\/learning\/practice\/sessions"\)/)
  assert.doesNotMatch(practice, /(?:session|local)Storage/)
  assert.match(practice, /if\(!state\.active\|\|state\.locked\)return false/)
  assert.doesNotMatch(practice, /pagehide[^\n]*saveRecord\('abandoned'/)
  assert.doesNotMatch(practice, /showFeedback\('正确'\+\(state\.mode==='scholar'\?' · \+20 秒'/)
})

test('practice mistakes retain the exact published release identity', () => {
  const practice = source('new-legacy/src/100-practice-mode.js')
  assert.match(practice, /async function recordMistake[\s\S]{0,900}releaseId:text\(release\?\.releaseId\)/)
  assert.match(practice, /async function recordMistake[\s\S]{0,900}paperVersion:Number\(release\?\.version\|\|0\)/)
})

test('teacher imports honor duplicate settings and reject blank bank metadata', () => {
  const workflow = source('new-legacy/src/97-teacher-question-workflow.js')
  const bank = source('new-legacy/src/65-question-bank-admin.js')
  assert.match(workflow, /bulkAddQuestions\?\.\(\[question\],\{skipDuplicates:byId\('tqSkipDuplicates'\)\?\.checked!==false\}\)/)
  assert.match(bank, /题库名称不能为空/)
  assert.match(bank, /自定义科目不能为空/)
  assert.match(bank, /IMPORT_REPLACEMENT_CONFIRMATION_REQUIRED/)
  assert.match(bank, /确认覆盖/)
  assert.match(bank, /modifiedQuestions/)
})

test('graph editor enters performance mode from fifty cards, keeps visible labels, and preserves reversible drag history', () => {
  const graph = source('new-legacy/src/10-graph-editor.js')
  const history = source('new-legacy/src/graph/history-controller.js')
  const tabs = source('new-legacy/src/25-graph-file-tabs.js')
  const css = source('new-legacy/styles/main.css')
  assert.match(graph, /const LARGE_GRAPH_NODE_THRESHOLD=50/)
  assert.match(graph, /function isLargeGraphMode\(\)\{return isLargeGraphPreferenceEnabled\(\)&&isGraphOverLargeThreshold\(\)\}/)
  assert.match(graph, /function isGraphOverLargeThreshold\(\)\{return state\.nodes\.length>=LARGE_GRAPH_NODE_THRESHOLD\|\|state\.links\.length>=LARGE_GRAPH_LINK_THRESHOLD\}/)
  assert.match(graph, /function restoreGraphRedoSnapshot/)
  assert.match(graph, /key==='y'\|\|\(key==='z'&&e\.shiftKey\)/)
  assert.match(graph, /onFirstMove:session=>pushGraphUndoSnapshot\(session\.historyLabel\|\|'移动知识点'\)/)
  assert.match(history, /function undo\(\)\{return move\(undoStack,redoStack,'undo'\)\}/)
  assert.match(history, /function redo\(\)\{return move\(redoStack,undoStack,'redo'\)\}/)
  assert.match(graph, /function shouldRenderLinkInCurrentMode[\s\S]{0,700}if\(!isLargeGraphMode\(\)\)[\s\S]{0,400}return true;/)
  assert.match(css, /\.mobile-bar button\{min-width:0;font-size:11px/)
  assert.match(graph, /function recoverMobileGraphViewport\(\)/)
  assert.match(graph, /fitBoundsToView\(bounds,\{margin:36,minScale:\.05,maxScale:\.85\}\)/)
  assert.match(graph, /function resetGraphHistory\(\)/)
  assert.match(graph, /window\.resetGraphHistory=resetGraphHistory/)
  assert.match(tabs, /global\.resetGraphHistory\?\.\(\)/)
})

test('graph size and edit forms participate in undo history', () => {
  const graph = source('new-legacy/src/10-graph-editor.js')
  assert.match(graph, /styleController\.updateAppearance\(\[n\.id\],\{size\},[^;\n]*调整[^;\n]*卡牌尺寸/)
  assert.match(graph, /saveNodeBtn[\s\S]{0,1600}history\.run\([^;\n]*编辑[^;\n]*n\.title[^;\n]*mutate\)/)
  assert.match(graph, /saveLinkBtn[\s\S]{0,900}history\.run\('编辑知识关系',mutate\)/)
  assert.match(graph, /deleteLinkFromDetailBtn[\s\S]{0,300}pushGraphUndoSnapshot\('删除关系'/)
})

test('graph knowledge-point creation uses the current simple and professional editor without bypassing server persistence', () => {
  const page = source('new-legacy/index.html')
  const graph = source('new-legacy/src/10-graph-editor.js')
  const css = source('new-legacy/styles/main.css')
  const persistence = source('new-legacy/src/00-config-state.js')

  assert.match(page, /class="modal node-editor-modal"/)
  assert.match(page, /id="nodeModalModeBtn"/)
  assert.match(page, /class="form-grid node-simple-form"/)
  assert.match(page, /id="nodeAdvancedForm" hidden/)
  assert.match(graph, /function nodeModalDefaultFullMode\(\)/)
  assert.match(graph, /function setNodeModalFullMode\(/)
  assert.match(graph, /\$\('nodeModalModeBtn'\)\.onclick=\(\)=>setNodeModalFullMode\(!nodeModalFullMode,\{announce:true\}\)/)
  assert.match(graph, /saveNodeBtn[\s\S]{0,1600}model\.updateContent\(n,content\)[\s\S]{0,900}render\(\{mode:'geometry',persist:true\}\)/)
  assert.match(css, /#nodeModal \.node-simple-form textarea\{min-height:190px\}/)
  assert.match(persistence, /fileStore\.saveFile\(current\.id,snapshot,saveOptions\)/)
})

test('graph canvas bug-list interactions use directional curves, delayed details, color-matched mode tabs, and zero-shift double-click editing', () => {
  const graph = source('new-legacy/src/10-graph-editor.js')
  const editor = source('new-legacy/src/graph/inline-text-editor-controller.js')
  const styles = source('new-legacy/styles/home-graph-components.css')

  // A vertical pair must bend along the Y axis; horizontal-only controls create the S-shaped route in the bug report.
  assert.match(graph, /function defaultCurveControls\(a,b\)\{[\s\S]{0,500}Math\.abs\(dx\)>=Math\.abs\(dy\)[\s\S]{0,500}x:a\.x,y:a\.y\+offset[\s\S]{0,500}x:b\.x,y:b\.y-offset/)
  // Hover detail panels are deliberately delayed so moving across cards does not make panels flash.
  assert.match(graph, /const NODE_HOVER_DETAIL_DELAY=260,LARGE_GRAPH_HOVER_RELATION_DELAY=120/)
  assert.match(graph, /if\(isHoverDetailBlocked\(\)\)return;[\s\S]{0,220}hoverDetailTimer=setTimeout\([\s\S]{0,180}NODE_HOVER_DETAIL_DELAY\)/)
  // The update source names the precise mode that will be exited, avoiding an ambiguous compact action.
  assert.match(graph, /data-graph-mode-exit>退出</)
  assert.match(graph, /textContent=mode==='related'\?'退出只看相关':'退出心流'/)
  // Reusing the painted span rather than replacing it with a textarea prevents the text baseline from jumping.
  assert.match(editor, /editor\.setAttribute\('contenteditable','plaintext-only'\)/)
  assert.doesNotMatch(editor, /document\.createElement\(multiline\?'textarea':'input'\)/)
  assert.match(graph, /cardsLayer\.addEventListener\('dblclick',[\s\S]{0,420}startNodeInlineEdit\(card\.dataset\.nodeId,card\)/)
  assert.match(graph, /cardsLayer\.addEventListener\('dblclick',[\s\S]{0,520}startTextElementInlineEdit\(el\.dataset\.textElementId,el\)/)
  assert.match(styles, /\.graph-mode-indicator\.related\{--graph-mode-color:#f97316;background:var\(--graph-mode-color\)\}/)
  assert.match(styles, /\.graph-mode-indicator\.flow\{--graph-mode-color:#22c55e;background:var\(--graph-mode-color\)\}/)
  assert.match(styles, /\.node-text-content\.node-inline-direct-editor/)
})

test('content center remains an independent direct page', () => {
  const page = source('new-legacy/content-center.html')
  assert.doesNotMatch(page, /location\.replace\([^)]*admin-subjects\.html/)
  assert.match(page, /src="src\/91-content-center-app\.js"/)
})

test('membership checkout relies on automatic status refresh without manual payment actions', () => {
  const center = source('new-legacy/src/33-user-center.js')
  assert.doesNotMatch(center, /确认订阅申请/)
  assert.match(center, /handlePlanPick[\s\S]*await pay\.createNativeOrder\(plan\.id\)[\s\S]*renderNativePayment\(checkoutPlan\|\|plan,result\.order\)/)
  assert.match(center, /nativePayPollTimer=setInterval\(refresh,3000\)/)
  assert.doesNotMatch(center, /nativePayRefreshBtn|nativePayCancelOrderBtn|nativePayCloseBtn/)
  assert.doesNotMatch(center, /cancelNativeOrder\(order\.id\)/)
})

test('home restores the update learning-entry dialog, automatic guided steps, and the mobile reading shell', () => {
  const page = source('new-legacy/index.html')
  const chooser = source('new-legacy/src/31-learning-entry-chooser.js')
  const tour = source('new-legacy/src/40-guided-tour.js')
  const directEntry = source('frontend/scripts/new-legacy-assets/direct-entry.js')
  const modes = source('new-legacy/src/27-home-interaction-modes.js')
  const modeStyles = source('new-legacy/styles/home-interaction-modes-p4330.css')

  assert.match(page, /<button class="learning-mode-entry" id="learningEntryTopBtn"[^>]*>学习入口<\/button>/)
  assert.match(page, /id="learningEntryModal"/)
  assert.match(page, /从这里开始学习/)
  assert.match(page, /选择你现在最想做的事，直接进入对应学习板块。/)
  assert.match(page, /class="learning-entry-card entry-graph is-current"/)
  assert.match(page, /主动回忆关键词与知识线索 · 深度回忆/)
  assert.match(chooser, /learningEntryTopBtn/)
  assert.match(chooser, /梳理知识结构与关系 · 当前首页/)
  assert.match(chooser, /event\.key === "Escape"[\s\S]*closeDialog\(\{ focusGraph: true \}\)/)
  assert.match(chooser, /kg-learning-entry-dialog/)
  assert.match(chooser, /kg-learning-entry-dialog-opened/)
  assert.match(tour, /scheduleAutoGuidedTour/)
  assert.match(tour, /kg-learning-entry-dialog/)
  assert.match(tour, /kg-learning-entry-dialog-opened/)
  assert.match(directEntry, /waitForInitialLearningEntry/)
  assert.match(tour, /waitForInitialLearningEntry/)
  assert.match(tour, /result\?\.shown/)
  assert.doesNotMatch(tour, /不再在页面首次加载时自动启动全屏引导/)
  assert.match(modeStyles, /#graphSearchPanel/)
  assert.match(modes, /closeGraphSearchPanel/)
  assert.match(modeStyles, /\.mobile-reading-mode-indicator/)
  assert.match(modeStyles, /body\.graph-phone-reading[\s\S]*#mobileBar\{display:none!important\}/)
  assert.match(modeStyles, /body\.graph-phone-reading[\s\S]*\.graph-file-tabbar\{display:none!important\}/)
  assert.match(modeStyles, /body\.graph-phone-reading[\s\S]*#kgGlobalShortcuts/)
  assert.match(modeStyles, /body\.graph-phone-reading[\s\S]*\.uc-minimap-dock/)
})

test('an active paid membership hides renewal calls to action while preserving membership status', () => {
  const core = source('new-legacy/src/37-subscription-core.js')
  const center = source('new-legacy/src/33-user-center.js')

  assert.match(core, /#upgradeMemberBtn,#accountMenuUpgradeBtn,\[data-subscription-upgrade-label\]/)
  assert.match(core, /btn\.hidden=hasActivePaidMembership/)
  assert.doesNotMatch(core, /\? "续费" : "升级会员"/)
  assert.match(center, /ACTIVE_PAID_MEMBERSHIP_STATUSES\.has\(record\.status\)/)
  assert.match(center, /current\?\(plan\.id==="free"\?"当前使用中":"当前方案"\)/)
})

test('deep recall restores search for nodes on the current canvas', () => {
  const page = source('new-legacy/knowledge-recall.html')
  const runtime = source('new-legacy/src/86-knowledge-recall.js')
  assert.match(page, /id="krNodeSearchBtn"/)
  assert.match(page, /id="krNodeSearchInput"/)
  assert.match(page, /id="krNodeSearchResults"/)
  assert.match(runtime, /function renderNodeSearchResults\(query=''/)
  assert.match(runtime, /bindNodeSearch\(\)/)
})

test('global shortcuts never auto-collapse and retain a high-contrast surface', () => {
  const runtime = source('new-legacy/src/39-global-shortcuts.js')
  const styles = source('new-legacy/styles/global-shortcuts.css')
  assert.doesNotMatch(runtime, /shouldStartCollapsed/)
  assert.doesNotMatch(runtime, /setCollapsed\(el,/)
  assert.match(styles, /#1f2937/)
  assert.match(styles, /#f97316/)
})

test('active learning and file pages expose the shared support center', () => {
  for (const pageName of ['practice-mode.html', 'question-workspace.html', 'knowledge-recall.html', 'file-manager.html']) {
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
