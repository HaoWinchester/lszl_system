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
