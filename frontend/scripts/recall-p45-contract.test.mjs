import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptsDir, '..', '..')
const source = (path) => readFileSync(resolve(root, path), 'utf8')

test('deep recall writes the complete canvas through its database adapter', () => {
  const adapter = source('frontend/scripts/new-legacy-assets/recall-progress-adapter.js')
  const recall = source('new-legacy/src/86-knowledge-recall.js')
  const sync = source('frontend/scripts/sync-new-legacy.js')

  assert.match(adapter, /\/api\/v1\/recall\/progress/)
  assert.match(adapter, /async function read\(/)
  assert.match(adapter, /async function write\(/)
  assert.match(adapter, /async function remove\(/)
  assert.match(adapter, /async function loadExplored\(/)
  assert.match(adapter, /function signedIn\(/)
  assert.match(adapter, /function hasPersistedQuestion\(question\)/)
  assert.match(adapter, /id !== 'unavailable'/)
  assert.match(adapter, /if \(!signedIn\(\) \|\| !hasPersistedQuestion\(question\)\) return null/)
  assert.match(sync, /recall-progress-adapter\.js/)
  assert.match(recall, /KGRecallProgressAdapter/)
  assert.match(recall, /await RecallProgress\.read\(/)
  assert.match(recall, /RecallProgress\.write\(/)
  assert.match(recall, /RecallProgress\.remove\(/)
  assert.doesNotMatch(recall, /RecallStorage\.readProgress/)
  assert.doesNotMatch(recall, /RecallStorage\.writeProgress/)
  assert.doesNotMatch(recall, /RecallStorage\.removeProgress/)
})

test('deep recall carries the update release performance and association safeguards', () => {
  const recall = source('new-legacy/src/86-knowledge-recall.js')

  assert.match(recall, /let associationRuntime=/)
  assert.match(recall, /function guideChoicePage\(/)
  assert.match(recall, /let nodeDrag=/)
  assert.match(recall, /function renderGraphDelta\(/)
  assert.match(recall, /function updateConnectedEdges\(/)
  assert.match(recall, /edgeCreated/)
  assert.match(recall, /setTimeout\(\(\)=>\{progressSaveTimer=0;(?:void )?writeProgressNow\(\)\},420\)/)
  assert.match(recall, /拖动整理位置/)
})

test('deep recall carries the update release core-keyword hierarchy', () => {
  const recall = source('new-legacy/src/86-knowledge-recall.js')
  const page = source('new-legacy/knowledge-recall.html')
  const styles = source('new-legacy/styles/knowledge-recall-p4526.css')

  assert.match(recall, /function keywordProfile\(/)
  assert.match(recall, /KGQuestionKeywordRuntime/)
  assert.match(recall, /kr-keyword\$\{item\.profile\?\.isCore\?' is-core':''\}/)
  assert.match(page, /knowledge-recall-p4517\.css/)
  assert.match(page, /knowledge-recall-p4526\.css/)
  assert.match(styles, /\.kr-keyword\.is-core/)
})

test('deep recall options give immediate correct and incorrect answer feedback', () => {
  const recall = source('new-legacy/src/86-knowledge-recall.js')
  const styles = source('new-legacy/styles/knowledge-recall.css')

  assert.match(recall, /function recallOptionIsCorrect\(/)
  assert.match(recall, /data-option-id=/)
  assert.match(recall, /function flashRecallOptionFeedback\(/)
  assert.match(recall, /is-answer-correct/)
  assert.match(recall, /is-answer-incorrect/)
  assert.match(recall, /setTimeout\(\(\)=>\{[^}]*is-answer-correct[^}]*is-answer-incorrect/)
  const clickHandler = recall.slice(recall.indexOf("questionCard.addEventListener('click'"), recall.indexOf('function activateKeyword('))
  assert.ok(clickHandler.indexOf("const option=event.target.closest('.kr-option[data-option-id]')") < clickHandler.indexOf("const keyword=event.target.closest('.kr-keyword')"), 'answer feedback must take priority over nested keyword clicks')
  assert.match(clickHandler, /const option=event\.target\.closest\('\.kr-option\[data-option-id\]'\);[\s\S]{0,240}isRecallReadonly\(\)[\s\S]{0,240}flashRecallOptionFeedback\(option\)/)
  assert.match(styles, /\.kr-option\.is-answer-correct/)
  assert.match(styles, /\.kr-option\.is-answer-incorrect/)
  assert.match(styles, /@keyframes krOptionCorrectFlash/)
  assert.match(styles, /@keyframes krOptionIncorrectFlash/)
})
