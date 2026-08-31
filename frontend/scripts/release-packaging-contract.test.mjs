import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const source = (path) => readFileSync(resolve(repoDir, path), 'utf8')
const requiredRsyncExcludes = [
  '/.git',
  '/.deploy-state',
  '/new-legacy',
  '/docs',
  '/frontend/new-legacy-releases',
  '/backups',
  '/测试数据',
  '/修改需求',
  '/转题目-json文档',
  '/内置数据',
  '/bug清单.docx',
  '/task-1-report.md',
  '/task-2-report.md',
  '/test-practice-mode.js',
  '/.superpowers',
  '/.pytest_cache',
  '/.gitattributes',
  'node_modules',
  '.venv',
  '__pycache__',
  '*.pyc',
  '.DS_Store',
  '._*',
  '/frontend/e2e',
  '/e2e',
  '.env.prod',
  '/backend/.env',
]

function assertRuntimePreparedBeforeRsync(script, label) {
  const generator = script.indexOf('node scripts/prepare-new-legacy-runtime.js')
  const rsync = script.indexOf('rsync -az --delete')
  assert.ok(generator >= 0, `${label} must generate the minimal frontend runtime`)
  assert.ok(rsync >= 0, `${label} must rsync the deployment tree`)
  assert.ok(generator < rsync, `${label} must prepare the runtime before rsync`)
}

function sharedRsyncExcludes() {
  const path = resolve(repoDir, 'deploy/rsync-excludes.txt')
  assert.ok(existsSync(path), 'deployment scripts require a shared rsync exclusion file')
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)
}

function assertDeploymentExcludes(script, label) {
  const start = script.indexOf('rsync -az --delete')
  const command = script.slice(start, script.indexOf('\n\n', start))
  assert.match(command, /--exclude-from "\$REPO_DIR\/deploy\/rsync-excludes\.txt"/, `${label} must use shared rsync exclusions`)
  for (const path of requiredRsyncExcludes) {
    assert.doesNotMatch(command, new RegExp(`--exclude ['\"]${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]`), `${label} must not duplicate shared exclusion ${path}`)
  }
}

function assertUatHasNoReleaseSourceRsync(script) {
  assert.doesNotMatch(
    script,
    /^\s*rsync\b(?:[^\n]|\\\n)*?\$REPO_DIR\/frontend\/new-legacy-releases(?:\/|(?=["'\s]))/m,
    'UAT must not use release storage as an rsync source',
  )
}

test('production and UAT deploy only the prepared runtime before synchronizing', () => {
  const production = source('deploy/update.sh')
  const uat = source('deploy/update-uat.sh')

  assertRuntimePreparedBeforeRsync(production, 'production deployment')
  assertRuntimePreparedBeforeRsync(uat, 'UAT deployment')
  assertDeploymentExcludes(production, 'production deployment')
  assertDeploymentExcludes(uat, 'UAT deployment')
  assert.deepEqual(sharedRsyncExcludes(), requiredRsyncExcludes)
})

test('UAT relies on the main sync and prepares runtime after promotion', () => {
  const uat = source('deploy/update-uat.sh')
  const promote = uat.indexOf('node scripts/manage-new-legacy.js promote "$VERSION"')
  const generator = uat.indexOf('node scripts/prepare-new-legacy-runtime.js')

  assert.ok(promote >= 0, 'UAT must promote the validated release')
  assert.ok(generator > promote, 'UAT must prepare runtime after promotion')
  assertUatHasNoReleaseSourceRsync(uat)
})

test('UAT contract rejects every release-storage rsync source', () => {
  const uat = source('deploy/update-uat.sh')
  const forbiddenSecondSync = `${uat}\nrsync -az "$REPO_DIR/frontend/new-legacy-releases/$VERSION" "$REMOTE:$REMOTE_DIR/frontend/new-legacy-releases/"\n`

  assert.throws(() => assertUatHasNoReleaseSourceRsync(forbiddenSecondSync), /rsync source/)
})

test('Docker ships the prepared runtime and keeps the public frontend assets', () => {
  const dockerfile = source('backend/Dockerfile')

  assert.match(dockerfile, /COPY frontend\/new-legacy-runtime\/ \/app\/frontend\/new-legacy-releases\//)
  assert.doesNotMatch(dockerfile, /COPY frontend\/new-legacy-releases\//)
  assert.match(dockerfile, /COPY frontend\/public\/new-legacy\/ \/app\/frontend\/public\/new-legacy\//)
})

test('ignore rules keep local backups, release storage, and generated runtime out of build contexts', () => {
  const dockerignore = source('.dockerignore')
  const gitignore = source('.gitignore')

  assert.match(dockerignore, /^\/backups\/$/m)
  assert.match(dockerignore, /^\/frontend\/new-legacy-releases\/$/m)
  assert.match(gitignore, /^\/backups\/$/m)
  assert.match(gitignore, /^\/frontend\/new-legacy-runtime\/$/m)
})
