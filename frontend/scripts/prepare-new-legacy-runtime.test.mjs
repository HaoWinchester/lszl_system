import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { CRITICAL_SITE_FILES } from './new-legacy-release-storage.js'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const command = resolve(scriptsDir, 'prepare-new-legacy-runtime.js')

function makeRoot() {
  return mkdtempSync(resolve(tmpdir(), 'kg-runtime-release-'))
}

function createRelease(root, version) {
  const release = resolve(root, version)
  const site = resolve(release, 'site')
  for (const file of CRITICAL_SITE_FILES) {
    const path = resolve(site, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${version}:${file}\n`)
  }
  writeFileSync(resolve(site, 'index.html'), `${version}:index\n`)
  mkdirSync(resolve(release, 'source'), { recursive: true })
  writeFileSync(resolve(release, 'source', 'private-source.txt'), `${version}:source\n`)
  writeFileSync(resolve(release, 'release.json'), `${JSON.stringify({
    schemaVersion: 1,
    version,
    sourceHash: 'a'.repeat(64),
    adapterHash: 'b'.repeat(64),
  })}\n`)
  writeFileSync(resolve(release, 'validation.json'), `${JSON.stringify({ passed: true })}\n`)
}

function makeStore({ active, previous, extras = [], omit = [] }) {
  const root = makeRoot()
  for (const version of [active, previous, ...extras]) {
    if (version && !omit.includes(version)) createRelease(root, version)
  }
  writeFileSync(resolve(root, 'current.json'), `${JSON.stringify({
    schemaVersion: 1,
    version: active,
    previousVersion: previous,
    site: `${active}/site`,
    note: 'copy these bytes exactly',
  }, null, 2)}\n`)
  return root
}

function run(root, out) {
  return spawnSync(process.execPath, [command, '--root', root, '--out', out], { encoding: 'utf8' })
}

function countRegularFiles(root) {
  let files = 0
  let bytes = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) {
      const nested = countRegularFiles(path)
      files += nested.files
      bytes += nested.bytes
    } else if (entry.isFile()) {
      files += 1
      bytes += statSync(path).size
    }
  }
  return { files, bytes }
}

test('CLI packages the active and rollback releases selected by current.json without source or unselected versions', (t) => {
  const root = makeStore({ active: 'v2', previous: 'v1', extras: ['v99'] })
  const out = `${root}-runtime`
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const result = run(root, out)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    versions: ['v2', 'v1'],
    ...countRegularFiles(out),
    out,
  })
  assert.equal(readFileSync(resolve(out, 'current.json'), 'utf8'), readFileSync(resolve(root, 'current.json'), 'utf8'))
  assert.ok(existsSync(resolve(out, 'v2', 'site', 'index.html')))
  assert.ok(existsSync(resolve(out, 'v1', 'site', 'index.html')))
  assert.equal(existsSync(resolve(out, 'v99')), false)
  assert.equal(existsSync(resolve(out, 'v2', 'source')), false)
  assert.equal(existsSync(resolve(out, 'v1', 'source')), false)
})

test('CLI leaves an existing output unchanged when the pointer names a missing rollback release', (t) => {
  const root = makeStore({ active: 'v2', previous: 'v1', omit: ['v1'] })
  const out = `${root}-runtime`
  mkdirSync(out, { recursive: true })
  writeFileSync(resolve(out, 'keep.txt'), 'existing runtime\n')
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const result = run(root, out)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /回滚版本.*不存在/)
  assert.equal(readFileSync(resolve(out, 'keep.txt'), 'utf8'), 'existing runtime\n')
})

test('CLI rejects an output path that overlaps the input release root', (t) => {
  const root = makeStore({ active: 'v2', previous: 'v1' })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const result = run(root, root)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /输出目录不能与 release root 重叠/)
  assert.equal(readFileSync(resolve(root, 'current.json'), 'utf8').includes('"v2"'), true)
  assert.ok(existsSync(resolve(root, 'v2', 'source', 'private-source.txt')))
})

test('module import exposes prepareRuntime without running the CLI', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "import { prepareRuntime } from './scripts/prepare-new-legacy-runtime.js'; process.stdout.write(typeof prepareRuntime)"],
    { cwd: dirname(scriptsDir), encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout, 'function')
})
