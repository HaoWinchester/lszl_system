import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const frontend = resolve(import.meta.dirname, '..')
const repo = resolve(frontend, '..')
const readFrontend = (path) => readFileSync(resolve(frontend, path), 'utf8')
const readRepo = (path) => readFileSync(resolve(repo, path), 'utf8')
const publicRelease = JSON.parse(readFrontend('public/new-legacy/manifest.json')).version
const frozenSource = resolve(frontend, 'new-legacy-releases', publicRelease, 'source')
const candidateSource = existsSync(frozenSource) ? frozenSource : resolve(repo, 'new-legacy')

function readGeneratedPageAssets(page, generated) {
  if (!generated.includes('kg-homepage-bundle-version')) return generated
  const bundles = Array.from(generated.matchAll(/(?:src|href)=["'](bundles\/[^"'?]+)[^"']*["']/g), (match) => match[1])
  const deferredBundles = JSON.parse(readFrontend('scripts/homepage-bundles.json')).groups
    .filter((group) => !group.initial)
    .flatMap((group) => [
      ...(group.scripts.length ? [`bundles/${group.name}.js`] : []),
      ...(group.styles.length ? [`bundles/${group.name}.css`] : []),
    ])
  return [generated, ...new Set([...bundles, ...deferredBundles])].map((asset) => (
    asset === generated ? generated : readFrontend(`public/new-legacy/${asset}`)
  )).join('\n')
}

test('production pages do not describe account data as a local demo or local question bank', () => {
  const targets = [
    'new-legacy/help-center.html',
    'new-legacy/message-management.html',
    'new-legacy/multi-question-help.html',
    'new-legacy/src/65-question-bank-admin.js',
    'new-legacy/src/97-teacher-question-workflow.js',
    'new-legacy/src/102-help-content.js',
  ].map(readRepo).join('\n')
  for (const phrase of ['本地演示模式', '本地演示环境中的已读数量', '已保存到本地题库', '后续会继续补充完整图示']) {
    assert.doesNotMatch(targets, new RegExp(phrase))
  }
})

test('generated pages use the exact upstream UI with only direct runtime adapters', () => {
  for (const page of [
    'index.html',
    'learning-path.html',
    'question-training.html',
    'question-workspace.html',
    'guided-learning-node.html',
    'guided-learning-placement-test.html',
    'file-manager.html',
    'question-bank.html',
    'knowledge-recall.html',
    'user-management.html',
    'system-settings.html',
    'workbench.html',
  ]) {
    const upstreamPage = page === 'workbench.html' ? 'index.html' : page
    // 发布候选在自动验收时会先与线上当前版本并存；这里校验
    // public 实际携带的版本，不能把未同步的候选源当成静态包的上游。
    const upstream = readFileSync(resolve(candidateSource, upstreamPage), 'utf8')
    const generated = readFrontend(`public/new-legacy/${page}`)
    const generatedAssets = readGeneratedPageAssets(page, generated)
    assert.match(generated, /kg-direct-bootstrap-anchor/)
    assert.doesNotMatch(generated, /server-state-bootstrap\.js/)
    assert.match(generatedAssets, /direct-entry\.js/)
    assert.doesNotMatch(generated, /new-legacy-navigation-bridge|graph-bridge|guided-learning-data-bridge|<iframe/)
    for (const stylesheet of upstream.matchAll(/<link[^>]+href="([^"]+\.css)"/g)) {
      assert.match(generatedAssets, new RegExp(stylesheet[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  }
})

test('the active frontend package has a retired Runtime marker and no React host', () => {
  const packageJson = JSON.parse(readFrontend('package.json'))
  assert.deepEqual(packageJson.dependencies, {})
  assert.doesNotMatch(JSON.stringify(packageJson), /react-router|vite|zustand/)
  assert.equal(existsSync(resolve(frontend, 'scripts/new-legacy-assets/server-state-bootstrap.js')), false)
  assert.deepEqual(JSON.parse(readFrontend('scripts/new-legacy-assets/runtime-retirement.json')), {
    schemaVersion: 1,
    status: 'retired',
    runtimeRequests: 0,
  })
})

test('FastAPI owns the stable direct-page aliases', () => {
  const routes = readRepo('backend/app/web/routes.py')
  for (const alias of ['/', '/graph', '/training', '/workspace', '/files', '/question-bank', '/recall', '/users', '/settings']) {
    assert.match(routes, new RegExp(`['"]${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`))
  }
})

test('practice mode ships one resumable answer sheet and a nonofficial Huanpu PMP report', () => {
  const page = readRepo('new-legacy/practice-mode.html')
  const style = readRepo('new-legacy/styles/practice-mode.css')
  const report = readRepo('new-legacy/src/113-practice-result-report.js')
  for (const id of [
    'practiceAnswerSheet', 'practiceAnswerSheetMobileBtn', 'practiceAnswerSheetDrawer',
    'practiceSubmitConfirm', 'practiceSaveExitBtn', 'practiceAbandonBtn',
  ]) assert.match(page, new RegExp(`id="${id}"`))
  assert.match(page, /src\/111-practice-session-core\.js/)
  assert.match(page, /src\/112-practice-answer-sheet\.js/)
  assert.match(page, /src\/113-practice-result-report\.js/)
  // Task 6：答题卡折叠为单实例抽屉，桌面不再常驻侧栏；入口按钮保留既有 ID 且全宽度可见
  assert.doesNotMatch(page, /id="practiceAnswerSheetMobile"/)
  assert.equal((page.match(/aria-label="答题概览"/g) || []).length, 1)
  assert.doesNotMatch(style, /padding-right:324px/)
  assert.match(style, /\.practice-answer-sheet-mobile-btn\{display:inline-flex/)
  assert.match(report, /src="\/assets\/logo\.jpg"/)
  assert.match(report, /幻谱 PMP 模拟成绩分析报告/)
  assert.match(report, /不代表 PMI 官方考试成绩/)
  for (const weight of ['people', 'process', 'business-environment']) assert.match(report, new RegExp(weight))
})
