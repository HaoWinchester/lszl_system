import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {runNodeTestProcess} from './node-test-process.mjs'

test('standalone child tests propagate failure without inheriting the parent runner protocol', () => {
  const directory = mkdtempSync(fileURLToPath(new URL('../../artifacts/test-process-', import.meta.url)))
  try {
    const file = join(directory, 'controlled.cjs')
    writeFileSync(file, "const {test}=require('node:test');const assert=require('node:assert/strict');test('controlled child result',()=>{assert.equal(process.env.PASSTHROUGH,'kept');if(process.env.PROBE_FAIL==='yes')assert.fail('controlled failure')});")
    for (const [fail, status] of [['yes', 1], ['no', 0]]) {
      const result = runNodeTestProcess(['--test', file], {encoding: 'utf8', env: {NODE_TEST_CONTEXT: 'child-v8', PASSTHROUGH: 'kept', PROBE_FAIL: fail}})
      assert.equal(result.status, status, result.stdout + result.stderr)
      assert.match(result.stdout, /controlled child result/)
    }
  } finally {rmSync(directory, {recursive: true, force: true})}
})
