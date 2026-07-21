import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(frontendDir, path), 'utf8')

test('training frame preloads published papers, questions, and sessions', () => {
  const path = resolve(frontendDir, 'src/iframe/trainingFrameAdapter.ts')
  assert.ok(existsSync(path), 'expected training frame adapter')
  const source = readFileSync(path, 'utf8')
  assert.match(source, /papersApi\.list\('published'\)/)
  assert.match(source, /banksApi\.list/)
  assert.match(source, /banksApi\.listQuestions/)
  assert.match(source, /learningApi\.getSession/)
  assert.match(source, /kg_question_banks_v1__/)
  assert.match(source, /kg_exam_papers_v1__/)
  assert.match(source, /kg_learning_sessions_v2__/)
  assert.match(source, /knownQuestionIds/)
  assert.match(source, /this\.knownQuestionIds\.has\(questionId\)/)
})

test('workspace frame preloads and reconciles owner-scoped workspaces', () => {
  const path = resolve(frontendDir, 'src/iframe/workspaceFrameAdapter.ts')
  assert.ok(existsSync(path), 'expected workspace frame adapter')
  const source = readFileSync(path, 'utf8')
  assert.match(source, /learningApi\.listWorkspaces/)
  assert.match(source, /learningApi\.createWorkspace/)
  assert.match(source, /learningApi\.updateWorkspace/)
  assert.match(source, /learningApi\.deleteWorkspace/)
  assert.match(source, /kg_canvas_workspace_catalog_v2__/)
  assert.match(source, /kg_canvas_workspace_v1__/)
})

test('the original question-training page replaces the React reimplementation', () => {
  const route = read('src/routes/Training.tsx')
  assert.match(route, /question-training\.html/)
  assert.match(route, /trainingFrameAdapter/)
  assert.doesNotMatch(route, /q-reasoning-chain/)
  const app = read('src/App.tsx')
  const trainingRoute = app.match(/<Route path="\/training"[^>]*\/>/)?.[0] ?? ''
  assert.match(trainingRoute, /<Training/)
  assert.doesNotMatch(trainingRoute, /RequireAuth/)
})

test('the generic host preloads one-time state before rendering the iframe', () => {
  const host = read('src/routes/NewLegacyFrame.tsx')
  assert.match(host, /registerFrameBootstrap/)
  assert.match(host, /frameToken/)
  assert.match(host, /adapter\.load/)
  assert.match(host, /adapter\.onMessage/)
  assert.match(host, /clearFrameBootstraps/)
})
