import test from 'node:test'
import assert from 'node:assert/strict'
import {runNodeTestProcess} from './node-test-process.mjs'
import { fileURLToPath } from 'node:url'

test('import workflows reject duplicate actions and recover after failure', () => {
  const result = runNodeTestProcess( ['--test', fileURLToPath(new URL('../../new-legacy/tests/import-guards.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
