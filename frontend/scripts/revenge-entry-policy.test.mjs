import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..', '..')
const policySource = readFileSync(
  resolve(root, 'new-legacy/src/118-revenge-entry-policy.js'),
  'utf8',
)

function derive(activeCount, selectedCount) {
  const window = {}
  runInNewContext(policySource, { window })
  return JSON.parse(JSON.stringify(
    window.KGRevengeEntryPolicy.derive(activeCount, selectedCount),
  ))
}

test('revenge entry automatically uses every eligible question up to ten', () => {
  assert.deepEqual(derive(0), {
    total: 0,
    automatic: true,
    selectedCount: 0,
    requestCount: 0,
    options: [],
  })
  assert.deepEqual(derive(1, 10), {
    total: 1,
    automatic: true,
    selectedCount: 1,
    requestCount: 1,
    options: [{ value: 1, label: '全部 1 题', disabled: false, kind: 'all' }],
  })
  assert.deepEqual(derive(10, 20), {
    total: 10,
    automatic: true,
    selectedCount: 10,
    requestCount: 10,
    options: [{ value: 10, label: '全部 10 题', disabled: false, kind: 'all' }],
  })
})

test('revenge entry defaults to ten and disables unavailable batch sizes', () => {
  assert.deepEqual(derive(14), {
    total: 14,
    automatic: false,
    selectedCount: 10,
    requestCount: 10,
    options: [
      { value: 10, label: '10 题', disabled: false, kind: 'batch' },
      { value: 20, label: '20 题', disabled: true, kind: 'batch' },
      { value: 14, label: '全部 14 题', disabled: false, kind: 'all' },
    ],
  })
})

test('revenge entry preserves a valid twenty or all selection', () => {
  assert.deepEqual(derive(29, 20), {
    total: 29,
    automatic: false,
    selectedCount: 20,
    requestCount: 20,
    options: [
      { value: 10, label: '10 题', disabled: false, kind: 'batch' },
      { value: 20, label: '20 题', disabled: false, kind: 'batch' },
      { value: 29, label: '全部 29 题', disabled: false, kind: 'all' },
    ],
  })
  assert.equal(derive(29, 29).requestCount, 29)
})

test('revenge entry caps one session at 180 questions', () => {
  assert.deepEqual(derive(200, 200), {
    total: 200,
    automatic: false,
    selectedCount: 10,
    requestCount: 10,
    options: [
      { value: 10, label: '10 题', disabled: false, kind: 'batch' },
      { value: 20, label: '20 题', disabled: false, kind: 'batch' },
      { value: 180, label: '本次最多 180 题', disabled: false, kind: 'limit' },
    ],
  })
  assert.equal(derive(200, 180).requestCount, 180)
})
