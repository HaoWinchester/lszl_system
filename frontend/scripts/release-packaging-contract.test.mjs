import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const source = (path) => readFileSync(resolve(repoDir, path), 'utf8')
const requiredRsyncExcludes = [
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
]

function assertRuntimePreparedBeforeRsync(script, label) {
  const generator = script.indexOf('node scripts/prepare-new-legacy-runtime.js')
  const rsync = script.indexOf('rsync -az --delete')
  assert.ok(generator >= 0, `${label} must generate the minimal frontend runtime`)
  assert.ok(rsync >= 0, `${label} must rsync the deployment tree`)
  assert.ok(generator < rsync, `${label} must prepare the runtime before rsync`)
}

function assertDeploymentExcludes(script, label) {
  for (const path of requiredRsyncExcludes) {
    assert.match(script, new RegExp(`--exclude ['\"]${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]`), `${label} must exclude ${path}`)
  }
}

test('production and UAT deploy only the prepared runtime before synchronizing', () => {
  const production = source('deploy/update.sh')
  const uat = source('deploy/update-uat.sh')

  assertRuntimePreparedBeforeRsync(production, 'production deployment')
  assertRuntimePreparedBeforeRsync(uat, 'UAT deployment')
  assertDeploymentExcludes(production, 'production deployment')
  assertDeploymentExcludes(uat, 'UAT deployment')
})

test('UAT relies on the main sync and prepares runtime after promotion', () => {
  const uat = source('deploy/update-uat.sh')
  const promote = uat.indexOf('node scripts/manage-new-legacy.js promote "$VERSION"')
  const generator = uat.indexOf('node scripts/prepare-new-legacy-runtime.js')

  assert.ok(promote >= 0, 'UAT must promote the validated release')
  assert.ok(generator > promote, 'UAT must prepare runtime after promotion')
  assert.doesNotMatch(uat, /rsync -az "\$REPO_DIR\/frontend\/new-legacy-releases\/current\.json"/)
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
