import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..', '..')
const source = (path) => readFileSync(resolve(root, path), 'utf8')

test('P4.5 practice workflow renders revenge, remediation and verification controls', () => {
  const page = source('new-legacy/practice-mode.html')
  assert.match(page, /data-practice-start="revenge"/)
  assert.match(page, /id="practiceRemediationPanel"/)
  assert.match(page, /id="practiceVerificationBanner"/)
})

test('P4.5 practice workflow uses a database API adapter instead of a local mistake/history store', () => {
  const adapter = source('frontend/scripts/new-legacy-assets/practice-learning-adapter.js')
  const practice = source('new-legacy/src/100-practice-mode.js')
  assert.match(adapter, /\/api\/v1\/learning\/practice/)
  assert.match(adapter, /request\('\/sessions'/)
  assert.match(adapter, /async function answer\(input[^)]*\)/)
  assert.match(adapter, /request\('\/answers'/)
  assert.match(adapter, /async function verify\(mistakeId, input\)/)
  assert.match(practice, /KGPracticeLearningApi/)
  assert.match(practice, /await api\.answer\(standardAnswerPayload\(question,optionId\)\)/)
  assert.doesNotMatch(practice, /recordMistake\(question,\{selectedAnswer:optionId\}\)/)
  assert.doesNotMatch(practice, /kg_practice_mistakes_v1/)
  assert.doesNotMatch(practice, /kg_practice_history_v1/)
  assert.doesNotMatch(practice, /sessionStorage/)
  assert.doesNotMatch(practice, /localStorage/)
})

test('the release synchronizer injects the practice database adapter before the page behavior', () => {
  const sync = source('frontend/scripts/sync-new-legacy.js')
  assert.match(sync, /practice-learning-adapter\.js/)
  assert.match(sync, /kg-practice-learning:generated/)
})
