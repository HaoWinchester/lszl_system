import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptsDir, '..', '..')
const source = (path) => readFileSync(resolve(root, path), 'utf8')

test('deep recall writes the complete canvas through its versioned database session adapter', () => {
  const adapter = source('new-legacy/src/99-deep-recall-server-adapter.js')
  const recall = source('new-legacy/src/86-knowledge-recall.js')
  const page = source('new-legacy/knowledge-recall.html')

  assert.match(adapter, /\/api\/v1\/recall\/session/)
  assert.match(adapter, /\/api\/v1\/recall\/progress/)
  assert.match(adapter, /resetToCurrent/)
  assert.match(adapter, /expectedRevision/)
  assert.match(page, /99-deep-recall-server-adapter\.js/)
  assert.match(recall, /KGDeepRecallServerAdapter/)
  assert.match(recall, /loadDatabaseSession/)
  assert.match(recall, /saveGraph\(progressPayload\(\)\)/)
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

test('deep recall keeps core priority semantic and reveals one learner keyword class', () => {
  const recall = source('new-legacy/src/86-knowledge-recall.js')
  const page = source('new-legacy/knowledge-recall.html')
  const keyword = source('new-legacy/src/question-keyword/keyword-runtime-service.js')

  assert.match(recall, /function keywordProfile\(/)
  assert.match(recall, /KGQuestionKeywordRuntime/)
  assert.match(recall, /function revealKeywords\(/)
  assert.doesNotMatch(recall, /is-core|data-core/)
  assert.match(keyword, /function learnerClass\(\)\{return 'kr-keyword-token'\}/)
  assert.match(page, /id="krRevealKeywordsBtn"/)
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
  assert.ok(clickHandler.indexOf("const option=event.target.closest('.kr-option[data-option-id]')") < clickHandler.indexOf("const keyword=event.target.closest('.kr-keyword-token')"), 'answer feedback must take priority over nested keyword clicks')
  assert.match(clickHandler, /const option=event\.target\.closest\('\.kr-option\[data-option-id\]'\);[\s\S]{0,240}isRecallReadonly\(\)[\s\S]{0,240}flashRecallOptionFeedback\(option\)/)
  assert.match(styles, /\.kr-option\.is-answer-correct/)
  assert.match(styles, /\.kr-option\.is-answer-incorrect/)
  assert.match(styles, /@keyframes krOptionCorrectFlash/)
  assert.match(styles, /@keyframes krOptionIncorrectFlash/)
})
