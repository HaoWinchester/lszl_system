import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  CRITICAL_SITE_FILES,
  readProtectedReleaseState,
} from './new-legacy-release-storage.js'

function makeRoot() {
  return mkdtempSync(resolve(tmpdir(), 'kg-release-storage-'))
}

function createRelease(root, version) {
  const release = resolve(root, version)
  const site = resolve(release, 'site')
  for (const file of CRITICAL_SITE_FILES) {
    const path = resolve(site, file)
    mkdirSync(resolve(path, '..'), { recursive: true })
    writeFileSync(path, `${version}:${file}\n`)
  }
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
  })}\n`)
  return root
}

test('protected releases come from the pointer rather than version ordering', (t) => {
  const root = makeStore({ active: 'v2', previous: 'v1', extras: ['v99'] })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const state = readProtectedReleaseState(root)

  assert.deepEqual(state.protectedVersions, ['v2', 'v1'])
})

test('a single active release is valid when previousVersion is null', (t) => {
  const root = makeStore({ active: 'v2', previous: null })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  assert.deepEqual(readProtectedReleaseState(root).protectedVersions, ['v2'])
})

test('missing rollback release fails closed', (t) => {
  const root = makeStore({ active: 'v2', previous: 'v1', omit: ['v1'] })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  assert.throws(() => readProtectedReleaseState(root), /回滚版本.*不存在/)
})
