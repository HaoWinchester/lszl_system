import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
test('card links use directional side midpoints and matching default tangents', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../new-legacy/tests/graph-edge-midpoints.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
