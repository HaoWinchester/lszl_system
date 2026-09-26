import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('import workflows reject duplicate actions and recover after failure', () => {
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../../new-legacy/tests/import-guards.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
