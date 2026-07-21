import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(frontendDir, path), 'utf8')

test('the app follows the new-legacy default route map', () => {
  const app = read('src/App.tsx')
  assert.match(app, /path="\/"[\s\S]{0,180}<LearningPath/)
  assert.match(app, /path="\/graph"[\s\S]{0,220}<GraphEditor/)
  assert.match(app, /path="\/workspace"[\s\S]{0,180}<QuestionWorkspace/)
  assert.match(app, /path="\/learning\/node"[\s\S]{0,180}<GuidedLearningNode/)
  assert.match(app, /path="\/learning\/placement-test"[\s\S]{0,220}<GuidedLearningPlacementTest/)
})

test('learning and graph routes use focused original-page wrappers', () => {
  for (const path of [
    'src/routes/NewLegacyFrame.tsx',
    'src/routes/LearningPath.tsx',
    'src/routes/QuestionWorkspace.tsx',
    'src/routes/GuidedLearningNode.tsx',
    'src/routes/GuidedLearningPlacementTest.tsx',
  ]) assert.ok(existsSync(resolve(frontendDir, path)), `expected ${path}`)

  assert.match(read('src/routes/LearningPath.tsx'), /learning-path\.html/)
  assert.match(read('src/routes/QuestionWorkspace.tsx'), /question-workspace\.html/)
  assert.match(read('src/routes/GuidedLearningNode.tsx'), /guided-learning-node\.html/)
  assert.match(read('src/routes/GuidedLearningPlacementTest.tsx'), /guided-learning-placement-test\.html/)
  assert.match(read('src/routes/GraphEditor.tsx'), /\/new-legacy\/workbench\.html/)
})

test('the iframe host validates navigation messages and preserves search parameters', () => {
  const host = read('src/routes/NewLegacyFrame.tsx')
  assert.match(host, /parseNewLegacyMessage/)
  assert.match(host, /location\.search/)
  assert.match(host, /navigate\(to\)/)
  assert.match(host, /removeEventListener\('message'/)
  assert.match(host, /onError=/)
})
