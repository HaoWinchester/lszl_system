import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const manager = resolve(scriptsDir, 'manage-new-legacy.js')
const runtimeGenerator = resolve(scriptsDir, 'prepare-new-legacy-runtime.js')
const canonicalSource = resolve(repoDir, 'new-legacy')

function run(command, args) {
  return spawnSync(process.execPath, [command, ...args], { cwd: repoDir, encoding: 'utf8' })
}

function copySource(root, version) {
  const source = resolve(root, version)
  cpSync(canonicalSource, source, { recursive: true })
  writeFileSync(resolve(source, 'VERSION'), `${version}\n`)
  return source
}

test('release manager promotes two releases before runtime packaging selects only the pointer versions', (t) => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'kg-runtime-integration-'))
  const releases = resolve(fixture, 'releases')
  const firstVersion = 'runtime-integration-first'
  const secondVersion = 'runtime-integration-second'
  const firstSource = copySource(fixture, firstVersion)
  const secondSource = copySource(fixture, secondVersion)
  const runtime = resolve(fixture, 'runtime')
  t.after(() => rmSync(fixture, { recursive: true, force: true }))

  const firstUpdate = run(manager, ['update', firstSource, '--root', releases, '--skip-browser'])
  assert.equal(firstUpdate.status, 0, firstUpdate.stderr)
  const secondUpdate = run(manager, ['update', secondSource, '--root', releases, '--skip-browser'])
  assert.equal(secondUpdate.status, 0, secondUpdate.stderr)
  const promote = run(manager, ['promote', secondVersion, '--root', releases, '--skip-browser'])
  assert.equal(promote.status, 0, promote.stderr)

  const prepared = run(runtimeGenerator, ['--root', releases, '--out', runtime])

  assert.equal(prepared.status, 0, prepared.stderr)
  assert.deepEqual(JSON.parse(prepared.stdout).versions, [secondVersion, firstVersion])
  const pointer = JSON.parse(readFileSync(resolve(runtime, 'current.json'), 'utf8'))
  assert.equal(pointer.version, secondVersion)
  assert.equal(pointer.previousVersion, firstVersion)
  assert.equal(existsSync(resolve(runtime, secondVersion, 'site')), true)
  assert.equal(existsSync(resolve(runtime, firstVersion, 'site')), true)
  assert.equal(existsSync(resolve(runtime, secondVersion, 'source')), false)
  assert.equal(existsSync(resolve(runtime, firstVersion, 'source')), false)
})
