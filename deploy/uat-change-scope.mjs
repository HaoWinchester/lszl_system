import { readFileSync } from 'node:fs'
import { isOperationalRecord } from './release-input-policy.mjs'

const paths = readFileSync(0, 'utf8')
  .split(/\r?\n/)
  .map((path) => path.trim())
  .filter(Boolean)

const authoritativePracticePaths = new Set([
  'new-legacy/practice-mode.html',
  'new-legacy/styles/practice-mode.css',
  'new-legacy/src/100-practice-mode.js',
  'new-legacy/src/118-revenge-entry-policy.js',
])

const commonCompanionPaths = [
  'frontend/new-legacy-manifest.json',
  'frontend/new-legacy-sync-report.json',
  'new-legacy/VERSION',
  'new-legacy/content-prep-studio/dist/content-prep.html',
]

const practiceCompanionPaths = new Set([
  ...commonCompanionPaths,
  'new-legacy/tests/practice-answer-sheet-browser.py',
  'new-legacy/tests/practice-result-report-browser.py',
  'frontend/scripts/practice-learning-contract.test.mjs',
  'frontend/scripts/revenge-entry-policy.test.mjs',
  'frontend/e2e/practice_mode_initial_view.py',
  'frontend/e2e/practice_resumable_report.py',
])

const authoritativeCanvasPaths = new Set([
  'new-legacy/src/77-multi-question-workspace.js',
  'new-legacy/src/canvas/94-canvas-ink.js',
  'new-legacy/src/canvas/95-home-canvas-tools.js',
  'new-legacy/src/canvas/96-canvas-capture.js',
  'new-legacy/styles/canvas-ink.css',
])
const canvasCompanionPaths = new Set([
  ...commonCompanionPaths,
  'new-legacy/tests/canvas-ink-controller-browser.py',
  'new-legacy/tests/canvas-capture-browser.py',
  'new-legacy/tests/canvas-ink-browser.py',
  'new-legacy/tests/home-canvas-tools-browser.py',
  'new-legacy/tests/workspace-multitab-browser.py',
  'new-legacy/tests/helpers/canvas_ink_server.py',
])

function isFrontendOnly(path, authoritative, companions) {
  return isOperationalRecord(path)
    || authoritative.has(path)
    || companions.has(path)
    || path.startsWith('frontend/public/new-legacy/')
}

function requiresContentPrep(path) {
  return path === 'new-legacy/VERSION'
    || path.startsWith('new-legacy/content-prep-studio/src/')
    || path === 'new-legacy/content-prep-studio/build.py'
    || path === 'new-legacy/content-prep-studio/baseline/baseline.json'
}

const hasAuthoritativePracticeChange = paths.some((path) => authoritativePracticePaths.has(path))
const frontendOnly = hasAuthoritativePracticeChange && paths.every(path => isFrontendOnly(path, authoritativePracticePaths, practiceCompanionPaths))
const canvasOnly = paths.some(path => authoritativeCanvasPaths.has(path)) && paths.every(path => isFrontendOnly(path, authoritativeCanvasPaths, canvasCompanionPaths))
const result = {
  validationProfile: frontendOnly ? 'uat-fast' : canvasOnly ? 'uat-canvas' : 'full',
  buildContentPrep: paths.some(requiresContentPrep),
}
const fieldIndex = process.argv.indexOf('--field')
if (fieldIndex >= 0) {
  const field = process.argv[fieldIndex + 1]
  if (!(field in result)) throw new Error(`未知输出字段：${field || ''}`)
  process.stdout.write(`${result[field]}\n`)
} else {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
