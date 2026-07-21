import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bridgePath = resolve(frontendDir, 'src/iframe/newLegacyBridge.ts')

test('parent bridge validates origin, channel, version, and page', () => {
  assert.ok(existsSync(bridgePath), 'expected typed new-legacy bridge')
  const source = readFileSync(bridgePath, 'utf8')
  assert.match(source, /event\.origin !== window\.location\.origin/)
  assert.match(source, /data\.channel !== NEW_LEGACY_CHANNEL/)
  assert.match(source, /data\.version !== NEW_LEGACY_VERSION/)
  assert.match(source, /data\.page !== expectedPage/)
  assert.match(source, /ALLOWED_MESSAGE_TYPES\.has/)
})

test('iframe navigation bridge maps every upstream page to an app route', () => {
  const source = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/new-legacy-navigation-bridge.js'), 'utf8')
  for (const [page, route] of [
    ['learning-path.html', '/'],
    ['index.html', '/graph'],
    ['question-training.html', '/training'],
    ['question-workspace.html', '/workspace'],
    ['guided-learning-node.html', '/learning/node'],
    ['guided-learning-placement-test.html', '/learning/placement-test'],
    ['file-manager.html', '/files'],
    ['question-bank.html', '/question-bank'],
    ['knowledge-recall.html', '/recall'],
    ['user-management.html', '/users'],
    ['system-settings.html', '/settings'],
  ]) {
    assert.match(source, new RegExp(`'${page.replaceAll('.', '\\.')}'\\s*:\\s*'${route.replaceAll('/', '\\/')}'`))
  }
  assert.match(source, /target\.search/)
  assert.match(source, /target\.hash/)
  assert.match(source, /kg-auth-session-change/)
  assert.match(source, /send\('logout'/)
})
