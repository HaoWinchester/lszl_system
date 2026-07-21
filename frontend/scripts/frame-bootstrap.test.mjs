import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('learning API exposes sessions, events, and workspace persistence', () => {
  const path = resolve(frontendDir, 'src/api/learning.ts')
  assert.ok(existsSync(path))
  const source = readFileSync(path, 'utf8')
  for (const endpoint of ['/training/session/', '/learning/events', '/workspaces']) assert.match(source, new RegExp(endpoint))
  for (const operation of ['getSession', 'saveSession', 'appendEvent', 'listWorkspaces', 'createWorkspace', 'updateWorkspace', 'deleteWorkspace']) {
    assert.match(source, new RegExp(`\\b${operation}:`))
  }
})

test('frame bootstrap entries are random, page-scoped, and single-use', () => {
  const path = resolve(frontendDir, 'src/iframe/frameBootstrap.ts')
  assert.ok(existsSync(path))
  const source = readFileSync(path, 'utf8')
  assert.match(source, /crypto\.randomUUID/)
  assert.match(source, /entry\.page !== expectedPage/)
  assert.match(source, /delete entries\[token\]/)
  assert.match(source, /clearFrameBootstraps/)
})
