import assert from 'node:assert/strict'
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const command = resolve(scriptsDir, 'manage-new-legacy.js')
const source = resolve(repoDir, 'new-legacy')

function makeRoot() {
  return mkdtempSync(resolve(tmpdir(), 'kg-new-legacy-releases-'))
}

function run(root, ...args) {
  return spawnSync(process.execPath, [command, ...args, '--root', root, '--skip-browser'], {
    cwd: repoDir,
    encoding: 'utf8',
  })
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('update builds an isolated release and atomically selects it', () => {
  const root = makeRoot()
  const result = run(root, 'update', source)

  assert.equal(result.status, 0, result.stderr)
  const current = readJson(resolve(root, 'current.json'))
  assert.equal(current.version, 'v8.6.0')
  assert.equal(current.previousVersion, null)
  assert.ok(existsSync(resolve(root, 'v8.6.0', 'source', 'learning-path.html')))
  assert.ok(existsSync(resolve(root, 'v8.6.0', 'site', 'learning-path.html')))
  assert.match(current.sourceHash, /^[a-f0-9]{64}$/)
  assert.match(current.adapterHash, /^[a-f0-9]{64}$/)
  assert.equal(readJson(resolve(root, 'v8.6.0', 'release.json')).adapterVersion, 4)
})

test('same version with a different source hash fails without changing current', () => {
  const root = makeRoot()
  assert.equal(run(root, 'update', source).status, 0)
  const before = readFileSync(resolve(root, 'current.json'), 'utf8')
  const conflicting = resolve(root, 'conflicting-source')
  cpSync(source, conflicting, { recursive: true })
  writeFileSync(resolve(conflicting, 'README.md'), `${readFileSync(resolve(conflicting, 'README.md'), 'utf8')}\n冲突版本\n`)

  const result = run(root, 'update', conflicting)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /相同版本号.*文件内容不同/)
  assert.equal(readFileSync(resolve(root, 'current.json'), 'utf8'), before)
})

test('failed automatic validation never changes the active release', () => {
  const root = makeRoot()
  assert.equal(run(root, 'update', source).status, 0)
  const before = readFileSync(resolve(root, 'current.json'), 'utf8')
  const next = resolve(root, 'validation-failure-source')
  cpSync(source, next, { recursive: true })
  writeFileSync(resolve(next, 'VERSION'), 'v8.6.1-validation-failure\n')
  const validator = resolve(root, 'fail-validation.sh')
  writeFileSync(validator, '#!/bin/sh\necho candidate rejected >&2\nexit 17\n')
  chmodSync(validator, 0o755)

  const result = spawnSync(process.execPath, [command, 'update', next, '--root', root], {
    cwd: repoDir,
    encoding: 'utf8',
    env: { ...process.env, KG_RELEASE_VALIDATION_SCRIPT: validator },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /自动验收失败.*正式版本未切换/s)
  assert.equal(readFileSync(resolve(root, 'current.json'), 'utf8'), before)
  const report = readJson(resolve(root, 'v8.6.1-validation-failure', 'validation.json'))
  assert.equal(report.passed, false)
})

test('rollback selects the previous successful release', () => {
  const root = makeRoot()
  assert.equal(run(root, 'update', source).status, 0)
  const next = resolve(root, 'next-source')
  cpSync(source, next, { recursive: true })
  writeFileSync(resolve(next, 'VERSION'), 'v8.6.1\n')
  assert.equal(run(root, 'update', next).status, 0)

  const result = run(root, 'rollback')

  assert.equal(result.status, 0, result.stderr)
  const current = readJson(resolve(root, 'current.json'))
  assert.equal(current.version, 'v8.6.0')
  assert.equal(current.previousVersion, 'v8.6.1')
})
