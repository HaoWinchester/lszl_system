import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const frontend = resolve(import.meta.dirname, '..')
const repo = resolve(frontend, '..')
const readFrontend = (path) => readFileSync(resolve(frontend, path), 'utf8')
const readRepo = (path) => readFileSync(resolve(repo, path), 'utf8')

test('new-legacy is the only page-style source for retained React routes', () => {
  const main = readFrontend('src/main.tsx')
  assert.doesNotMatch(main, /design-system\.css|boardmix-overrides\.css|file-manager\.css|question-bank-admin\.css/)
  assert.match(main, /app-icon\.css/)
  const hook = readFrontend('src/hooks/useNewLegacyStyles.ts')
  assert.match(hook, /`\/new-legacy\/styles\/\$\{name\}`/)
  assert.match(hook, /document\.head\.append/)
  assert.match(hook, /link\.remove\(\)/)

  const contracts = {
    'Files.tsx': ['file-manager.css', 'file-manager-organize.css'],
    'QuestionBank.tsx': ['question-bank-admin.css', 'global-shortcuts.css', 'subscription.css', 'user-center.css'],
    'Recall.tsx': ['knowledge-recall.css', 'global-shortcuts.css', 'subscription.css', 'user-center.css'],
    'Users.tsx': ['user-management.css', 'global-shortcuts.css', 'subscription.css', 'user-center.css'],
    'Settings.tsx': ['user-management.css', 'system-settings.css', 'global-shortcuts.css', 'subscription.css', 'user-center.css'],
  }
  for (const [route, styles] of Object.entries(contracts)) {
    const source = readFrontend(`src/routes/${route}`)
    assert.match(source, /useNewLegacyStyles/)
    for (const style of styles) assert.match(source, new RegExp(style.replace('.', '\\.')))
  }
})

test('generated original pages preserve upstream styles and reject old theme overlays', () => {
  for (const page of [
    'learning-path.html',
    'question-training.html',
    'question-workspace.html',
    'guided-learning-node.html',
    'guided-learning-placement-test.html',
    'workbench.html',
  ]) {
    const generated = readFrontend(`public/new-legacy/${page}`)
    assert.doesNotMatch(generated, /boardmix-theme\.css|boardmix-overrides\.css/)
    assert.match(generated, /server-state-bootstrap\.js/)
    assert.match(generated, /new-legacy-navigation-bridge\.js/)
  }
  assert.match(readFrontend('public/new-legacy/question-training.html'), /styles\/question-training\.css/)
  assert.match(readFrontend('public/new-legacy/learning-path.html'), /styles\/guided-learning-path\.css/)
  assert.match(readFrontend('public/new-legacy/guided-learning-node.html'), /styles\/guided-learning-node\.css/)
})

test('retained pages keep the upstream DOM anchors and visible control labels', () => {
  const cases = [
    ['Files.tsx', ['fm-app', 'fm-sidebar', 'fm-topbar', 'fm-workspace', 'fm-file-grid', 'fm-details-drawer']],
    ['QuestionBank.tsx', ['qb-app', 'qb-topbar', 'qb-subject-strip', 'qb-layout-nav', 'qb-status-card', 'qb-main-tabs', 'qb-inspector']],
    ['Recall.tsx', ['kr-app', 'kr-topbar', 'kr-viewport', 'kr-world', 'kr-question-card', 'kr-node-layer']],
    ['Users.tsx', ['um-app', 'um-topbar', 'um-summary', 'um-layout', 'um-editor-card', 'um-right-card']],
    ['Settings.tsx', ['ss-app', 'ss-topbar', 'ss-layout', 'ss-sidebar', 'ss-content']],
  ]
  for (const [route, anchors] of cases) {
    const source = readFrontend(`src/routes/${route}`)
    for (const anchor of anchors) assert.match(source, new RegExp(anchor), `${route} missing ${anchor}`)
  }
  const bank = readFrontend('src/routes/QuestionBank.tsx')
  for (const label of ['导入 JSON', '导出当前题库', '导出全部题库', '下载模板', '设为当前训练题', '深度回忆预览']) {
    assert.match(bank, new RegExp(label))
  }
})

test('visible file and question-bank controls perform domain actions instead of placeholder notifications', () => {
  const files = readFrontend('src/routes/Files.tsx')
  assert.match(files, /const batchTag = async/)
  assert.match(files, /filesApi\.setFileTag/)
  assert.match(files, /const batchMove = async/)
  assert.match(files, /filesApi\.move/)
  assert.doesNotMatch(files, /notify\('批量标签|notify\('批量移动|notify\('已筛选/)

  const bank = readFrontend('src/routes/QuestionBank.tsx')
  assert.match(bank, /const importJson = async/)
  assert.match(bank, /banksApi\.createQuestion/)
  assert.match(bank, /const exportCurrent/)
  assert.match(bank, /const exportAll/)
  assert.match(bank, /const downloadTemplate/)
  assert.doesNotMatch(bank, /notify\('导入：|notify\('导出当前题库|notify\('导出全部题库/)
})

test('complex learning routes use the exact original-page engines', () => {
  const routes = {
    'Training.tsx': 'question-training.html',
    'QuestionWorkspace.tsx': 'question-workspace.html',
    'LearningPath.tsx': 'learning-path.html',
    'GuidedLearningNode.tsx': 'guided-learning-node.html',
    'GuidedLearningPlacementTest.tsx': 'guided-learning-placement-test.html',
  }
  for (const [route, page] of Object.entries(routes)) {
    const source = readFrontend(`src/routes/${route}`)
    assert.match(source, /NewLegacyFrame/)
    assert.match(source, new RegExp(page.replace('.', '\\.')))
  }
  assert.match(readFrontend('src/routes/GraphEditor.tsx'), /\/new-legacy\/workbench\.html/)
})

test('upstream retained pages changed only by remote runtime configuration', () => {
  for (const page of ['file-manager.html', 'question-bank.html', 'knowledge-recall.html', 'user-management.html', 'system-settings.html']) {
    const legacy = readRepo(`legacy/${page}`).replace(/<script defer src="src\/28-app-storage\.js"><\/script>/, '')
    const latest = readRepo(`new-legacy/${page}`)
      .replace(/<script defer src="src\/01-runtime-config\.js"><\/script>/, '')
      .replace(/\s*<script defer src="src\/28-app-storage\.js"><\/script>/, '')
    assert.equal(latest.replace(/\s+/g, ' ').trim(), legacy.replace(/\s+/g, ' ').trim())
  }
})
