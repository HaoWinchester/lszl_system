import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const assetsDir = resolve(scriptsDir, 'new-legacy-assets')
const sourceDir = resolve(repoDir, 'new-legacy')
const generatedDir = resolve(frontendDir, 'public', 'new-legacy')
const readSource = (path) => readFileSync(path.endsWith('.js') && path.startsWith('direct-') ? resolve(assetsDir, path) : resolve(sourceDir, path), 'utf8')

// ---------------------------------------------------------------- Task 4: 上报器注入与隐私

test('every generated page loads feature telemetry after direct bootstrap', () => {
  for (const pageName of ['index.html', 'file-manager.html', 'question-bank.html', 'question-training.html', 'knowledge-recall.html', 'learning-path.html']) {
    const page = readFileSync(resolve(generatedDir, pageName), 'utf8')
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
  // 成果埋点必须出现在对应持久化/事件之后，而非之前或 catch 中
  const training = readSource('src/64-flow-orchestrator.js')
  assert.ok(training.indexOf('ANSWER_SUBMITTED') < training.indexOf("track('training','outcome'"), 'training 成果埋点应在提交事件之后')
  const recall = readSource('src/86-knowledge-recall.js')
  assert.ok(recall.indexOf('Store.writeJSON') < recall.indexOf("track('recall','outcome'"), 'recall 成果埋点应在写入之后')
  const files = readSource('src/27-graph-file-manager.js')
  assert.ok(files.indexOf('await state.modalHandler(value)') < files.indexOf("track('files','outcome'"), 'files 成果埋点应在 modal handler 成功之后')
  const graph = readSource('direct-graph-adapter.js')
  assert.ok(graph.indexOf('storage.flush()') < graph.indexOf("track('graph','outcome'"), 'graph 成果埋点应在 flush 之后')
})
