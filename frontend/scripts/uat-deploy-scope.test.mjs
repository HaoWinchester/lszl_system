import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repoDir = resolve(scriptsDir, '..', '..')
const command = resolve(repoDir, 'deploy', 'uat-change-scope.mjs')
const validationProfileCommand = resolve(repoDir, 'frontend', 'scripts', 'new-legacy-validation-profile.sh')

function classify(paths) {
  const result = spawnSync(process.execPath, [command], {
    cwd: repoDir,
    encoding: 'utf8',
    input: `${paths.join('\n')}\n`,
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('a page-local frontend change uses the fast UAT validation profile', () => {
  assert.deepEqual(classify([
    'new-legacy/practice-mode.html',
    'new-legacy/styles/practice-mode.css',
    'new-legacy/tests/practice-answer-sheet-browser.py',
    'frontend/scripts/practice-learning-contract.test.mjs',
    'frontend/e2e/practice_mode_initial_view.py',
    'frontend/public/new-legacy/practice-mode.html',
    'frontend/new-legacy-manifest.json',
  ]), {
    validationProfile: 'uat-fast',
    buildContentPrep: false,
  })
})

test('a standalone VERSION change rebuilds generated content but fails closed to full validation', () => {
  assert.deepEqual(classify(['new-legacy/VERSION']), {
    validationProfile: 'full',
    buildContentPrep: true,
  })
})

test('VERSION and deterministic sync output stay fast only beside an authoritative practice change', () => {
  assert.deepEqual(classify([
    'new-legacy/practice-mode.html',
    'new-legacy/VERSION',
    'new-legacy/content-prep-studio/dist/content-prep.html',
    'frontend/public/new-legacy/VERSION',
    'frontend/public/new-legacy/index.html',
    'frontend/public/new-legacy/practice-mode.html',
    'frontend/new-legacy-manifest.json',
    'frontend/new-legacy-sync-report.json',
  ]), {
    validationProfile: 'uat-fast',
    buildContentPrep: true,
  })
})

test('backend, infrastructure, and unknown changes fail closed to full validation', () => {
  for (const path of [
    'backend/app/api/v1/training.py',
    'deploy/update-uat.sh',
    'docker-compose.uat.yml',
    'some-new-runtime/tool.bin',
    'new-legacy/src/41-account-menu.js',
    'new-legacy/styles/global-shortcuts.css',
    'frontend/scripts/new-legacy-assets/direct-auth-adapter.js',
    'new-legacy/content-prep-studio/src/js/20-page-runtime.js',
    'frontend/e2e/membership_checkout.py',
    'frontend/scripts/new-legacy-assets/practice-learning-adapter.js',
  ]) {
    assert.equal(classify([path]).validationProfile, 'full', path)
  }
  assert.equal(
    classify(['new-legacy/content-prep-studio/src/js/20-page-runtime.js']).buildContentPrep,
    true,
  )
  const baseline = classify(['new-legacy/content-prep-studio/baseline/baseline.json'])
  assert.equal(baseline.validationProfile, 'full')
  assert.equal(baseline.buildContentPrep, true)
  for (const generated of [
    'frontend/public/new-legacy/practice-mode.html',
    'backend/app/seed/guided_course_v8_6_0.json',
    'new-legacy/content-prep-studio/dist/content-prep.html',
  ]) assert.equal(classify([generated]).validationProfile, 'full', generated)
  for (const unsafeCompanion of [
    'backend/app/seed/guided_course_v8_6_0.json',
    'frontend/scripts/new-legacy-assets/practice-learning-adapter.js',
  ]) {
    assert.equal(
      classify(['new-legacy/practice-mode.html', unsafeCompanion]).validationProfile,
      'full',
      unsafeCompanion,
    )
  }
})

test('the fast profile keeps release smoke checks but excludes unrelated backend and domain suites', () => {
  const result = spawnSync('bash', [validationProfileCommand, 'uat-fast'], {
    cwd: repoDir,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
    'frontend-contracts',
    'integrated-core',
    'practice-e2e',
    'visual-regression',
  ])
})

test('the full profile retains backend and cross-domain release gates', () => {
  const result = spawnSync('bash', [validationProfileCommand, 'full'], {
    cwd: repoDir,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const groups = new Set(result.stdout.trim().split(/\r?\n/))
  for (const group of [
    'backend-tests',
    'frontend-contracts',
    'extended-contracts',
    'integrated-core',
    'practice-e2e',
    'cross-domain-e2e',
    'visual-regression',
  ]) assert.equal(groups.has(group), true, group)
})
