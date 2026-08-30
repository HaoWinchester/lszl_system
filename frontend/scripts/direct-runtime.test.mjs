import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const assets = resolve(scriptsDir, 'new-legacy-assets')

test('retired Runtime has no executable browser bootstrap', () => {
  assert.equal(existsSync(resolve(assets, 'server-state-bootstrap.js')), false)
  assert.deepEqual(JSON.parse(readFileSync(resolve(assets, 'runtime-retirement.json'), 'utf8')), {
    schemaVersion: 1,
    status: 'retired',
    runtimeRequests: 0,
  })
})

test('direct adapters retain only relational API boundaries', () => {
  for (const asset of ['canvas-workspace-adapter.js', 'course-management-adapter.js', 'question-catalog-adapter.js']) {
    assert.doesNotMatch(readFileSync(resolve(assets, asset), 'utf8'), /\/api\/v1\/runtime\/state/)
  }
})
