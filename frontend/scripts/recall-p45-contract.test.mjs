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
  // P4.5.37 起进度保存防抖 420→1200ms，降低高频写库。
  assert.match(recall, /setTimeout\(\(\)=>\{progressSaveTimer=0;(?:void )?writeProgressNow\(\)\},1200\)/)
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
  const styles = source('new-legacy/styles/question-workspace.css')

  // P4.5.37 起与多题画布共用单一来源：点击字母按钮走 judgeKrOption（内含只读守卫），
  // flashKrOption 按对错加 is-correct-flash / is-wrong-flash 类；选项行内关键词优先于选项判定。
  assert.match(recall, /function recallOptionIsCorrect\(/)
  assert.match(recall, /data-qw-option-key/)
  assert.match(recall, /function flashKrOption\(key,correct\)/)
  assert.match(recall, /correct\?'is-correct-flash':'is-wrong-flash'/)
  const clickHandler = recall.slice(recall.indexOf("questionCard.addEventListener('click'"), recall.indexOf('function activateKeyword('))
  assert.ok(clickHandler.indexOf("const keyword=event.target.closest('.kr-keyword-token')") < clickHandler.indexOf("const optionKey=event.target.closest('[data-qw-option-key]')"), 'keywords nested inside option rows must win over option judging')
  assert.match(clickHandler, /const optionKey=event\.target\.closest\('\[data-qw-option-key\]'\);[\s\S]{0,400}judgeKrOption\(optionKey\.dataset\.qwOptionKey\)/)
  assert.match(recall, /function judgeKrOption\(key\)\{[\s\S]{0,160}isRecallReadonly\(\)/)
  assert.match(styles, /\.qw-card-option-key\.is-correct-flash/)
  assert.match(styles, /\.qw-card-option-key\.is-wrong-flash/)
  assert.match(styles, /@keyframes qw-option-correct-flash/)
  assert.match(styles, /@keyframes qw-option-wrong-flash/)
})
