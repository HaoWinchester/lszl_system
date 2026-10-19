import test from 'node:test'
import assert from 'node:assert/strict'
import {runNodeTestProcess} from './node-test-process.mjs'
import { fileURLToPath } from 'node:url'
test('professional node edits preserve existing manual geometry and styling', () => {
  const result = runNodeTestProcess( ['--test', fileURLToPath(new URL('../../new-legacy/tests/graph-node-modal-preserve.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
