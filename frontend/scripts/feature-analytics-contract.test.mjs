import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const assetsDir = resolve(scriptsDir, 'new-legacy-assets')
const generatedDir = resolve(frontendDir, 'public', 'new-legacy')
const readSource = (path) => readFileSync(path.endsWith('.js') && path.startsWith('direct-') ? resolve(assetsDir, path) : resolve(generatedDir, path), 'utf8')

// ---------------------------------------------------------------- Task 4: 上报器注入与隐私

test('every generated page loads feature telemetry after direct bootstrap', () => {
  for (const pageName of ['index.html', 'file-manager.html', 'question-bank.html', 'question-training.html', 'knowledge-recall.html', 'learning-path.html']) {
    const page = pageName === 'index.html'
      ? readFileSync(resolve(generatedDir, 'bundles/home-shell.js'), 'utf8')
      : readFileSync(resolve(generatedDir, pageName), 'utf8')
    assert.ok(
      page.indexOf('direct-entry.js') < page.indexOf('feature-analytics.js'),
      `${pageName} 应在 direct-entry.js 之后加载 feature-analytics.js`,
    )
  }
})

test('telemetry sends only allowlisted event fields and never persists tracking data locally', () => {
  const source = readFileSync(resolve(assetsDir, 'feature-analytics.js'), 'utf8')
  assert.match(source, /\/api\/v1\/analytics\/feature-events/)
  assert.match(source, /credentials:\s*['"]include['"]/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|ownerId|username|payload/)
})

// ---------------------------------------------------------------- Task 5: 成功结果埋点

test('successful user actions emit only design-approved telemetry actions', () => {
  const checks = [
    ['direct-graph-adapter.js', "track('graph','outcome','graph_saved')"],
    ['src/27-graph-file-manager.js', "track('files','outcome','library_saved')"],
    ['src/65-question-bank-admin.js', "track('question_bank','outcome','question_saved')"],
    ['src/86-knowledge-recall.js', "track('recall','outcome','recall_saved')"],
    ['src/64-flow-orchestrator.js', "track('training','key_action','answer_submitted')"],
    ['src/64-flow-orchestrator.js', "track('training','outcome',saved.answer.isCorrect?'answer_correct':'answer_incorrect')"],
    ['src/88-guided-learning-store.js', "track('learning_path','outcome','node_completed')"],
  ]
  for (const [path, token] of checks) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(readSource(path), new RegExp(escaped), `${path} 应包含埋点 ${token}`)
  }
})

test('telemetry calls only fire after their successful persistence step', () => {
  const training = readSource('src/64-flow-orchestrator.js')
  assert.ok(training.indexOf('ANSWER_SUBMITTED') < training.indexOf("track('training','outcome'"), 'training 成果埋点应在提交事件之后')
  const recall = readSource('src/86-knowledge-recall.js')
  assert.ok(recall.indexOf('await recallAdapter.saveGraph') < recall.indexOf("track('recall','outcome'"), 'recall 成果埋点应在数据库写入之后')
  assert.match(recall, /if\(saved\)\{[\s\S]*track\('recall','outcome','recall_saved'\)/)
  const files = readSource('src/27-graph-file-manager.js')
  assert.ok(files.indexOf('await state.modalHandler(value)') < files.indexOf("track('files','outcome'"), 'files 成果埋点应在 modal handler 成功之后')
  const graph = readSource('direct-graph-adapter.js')
  assert.ok(graph.indexOf('storage.flush()') < graph.indexOf("track('graph','outcome'"), 'graph 成果埋点应在 flush 之后')
})

// ---------------------------------------------------------------- Task 6: 管理员仪表板

test('system settings declares an analytics tab with stable content anchors', () => {
  const html = readFileSync(resolve(repoDir, 'new-legacy/system-settings.html'), 'utf8')
  for (const token of ['data-ss-tab="analytics"', 'data-ss-panel="analytics"', 'id="ssAnalyticsStart"', 'id="ssAnalyticsEnd"', 'id="ssAnalyticsRole"', 'id="ssAnalyticsContent"']) {
    assert.match(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('dashboard only requests the aggregate endpoint and never renders user identifiers', () => {
  const source = readFileSync(resolve(repoDir, 'new-legacy/src/36-system-settings.js'), 'utf8')
  assert.match(source, /\/api\/v1\/system\/feature-analytics/)
  const start = source.indexOf('function loadFeatureAnalytics')
  assert.ok(start >= 0, '应实现 loadFeatureAnalytics')
  const segment = source.slice(start, start + 6000)
  assert.doesNotMatch(segment, /feature-events|ownerId|username|eventId/)
})

// ---------------------------------------------------------------- Task 7: 发布文档

test('baseline document describes the feature analytics rollout', () => {
  const doc = readFileSync(resolve(repoDir, 'docs/功能基线-重构参考.md'), 'utf8')
  assert.match(doc, /feature_usage_events/)
  assert.match(doc, /系统设置 → 功能分析/)
  assert.match(doc, /发布后开始|不回填|发布后累计/)
})
