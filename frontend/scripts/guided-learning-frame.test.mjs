import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

test('learning API exposes the canonical course and server-authoritative progress actions', () => {
  const source = read('src/api/learning.ts')
  assert.match(source, /getGuidedCourse/)
  assert.match(source, /getGuidedProgress/)
  assert.match(source, /completeGuidedNode/)
  assert.match(source, /submitPlacementAttempt/)
  assert.match(source, /resetGuidedProgress/)
})

test('guided frame adapter supports guests, progress, placement, reset, and preferences', () => {
  const path = resolve(root, 'src/iframe/guidedLearningFrameAdapter.ts')
  assert.ok(existsSync(path), 'expected guided learning frame adapter')
  const source = readFileSync(path, 'utf8')
  assert.match(source, /learningApi\.getGuidedCourse/)
  assert.match(source, /learningApi\.getGuidedProgress/)
  assert.match(source, /learningApi\.completeGuidedNode/)
  assert.match(source, /learningApi\.submitPlacementAttempt/)
  assert.match(source, /learningApi\.resetGuidedProgress/)
  assert.match(source, /kg_guided_learning_progress_v2__/)
  assert.match(source, /kg_question_language_mode_v1/)
  assert.match(source, /adminPreview/)
})

test('generated data bridge replaces course reads but retains Activity Schema materialization', () => {
  const assetPath = resolve(root, 'scripts/new-legacy-assets/guided-learning-data-bridge.js')
  assert.ok(existsSync(assetPath), 'expected generated guided data bridge')
  const source = readFileSync(assetPath, 'utf8')
  assert.match(source, /guidedCoursePackage/)
  assert.match(source, /KGActivitySchemaV1/)
  assert.match(source, /materialize/)
  assert.match(source, /\['zh','en','bilingual'\]/)
  assert.match(source, /getItem\(message\.payload\.progressKey\) !== serialized/)
  const sync = read('scripts/sync-new-legacy.js')
  assert.match(sync, /87-guided-learning-data\.js/)
  assert.match(sync, /guided-learning-data-bridge\.js/)
})

test('all three original guided pages share the server adapter and save retry path', () => {
  for (const route of ['LearningPath.tsx', 'GuidedLearningNode.tsx', 'GuidedLearningPlacementTest.tsx']) {
    assert.match(read(`src/routes/${route}`), /guidedLearningFrameAdapter/)
  }
  const host = read('src/routes/NewLegacyFrame.tsx')
  assert.match(host, /saveWithRetry/)
  assert.match(host, /save:success/)
  assert.match(host, /save:error/)
})
