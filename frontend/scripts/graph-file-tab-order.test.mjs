import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('graph tab drag order persists remotely and survives failures and session changes', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../new-legacy/tests/graph-file-tab-order.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
