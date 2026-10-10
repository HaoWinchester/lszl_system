import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
test('professional node edits preserve existing manual geometry and styling', () => {
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../../new-legacy/tests/graph-node-modal-preserve.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
