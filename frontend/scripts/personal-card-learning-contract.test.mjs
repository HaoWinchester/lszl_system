import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..', '..')
const source = (path) => readFileSync(resolve(root, path), 'utf8')

test('personal synthesis cards use the authenticated database API without browser persistence', () => {
  const adapter = source('frontend/scripts/new-legacy-assets/personal-card-adapter.js')
  assert.match(adapter, /\/api\/v1\/learning\/personal-cards/)
  assert.match(adapter, /async function create\(input\)/)
  assert.match(adapter, /async function update\(cardId, input\)/)
  assert.match(adapter, /async function archive\(cardId\)/)
  assert.match(adapter, /async function restore\(cardId\)/)
  assert.match(adapter, /kg-personal-synthesis-cards-change/)
  assert.doesNotMatch(adapter, /localStorage|sessionStorage|indexedDB/)
})

test('the synchronizer loads learning asset adapters before the multi-question workspace', () => {
  const sync = source('frontend/scripts/sync-new-legacy.js')
  assert.match(sync, /kg-personal-cards:generated/)
  assert.match(sync, /kg-practice-learning:generated/)
  assert.match(sync, /question-workspace\.html/)
})
