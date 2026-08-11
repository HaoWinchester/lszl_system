import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const p45Path = new URL('./p45-persistence-contract.json', import.meta.url)

function findSourceDirectory() {
  return [
    resolve(process.cwd(), '../updata-legacy'),
    resolve(process.cwd(), '../../../updata-legacy')
  ].find(existsSync)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sourceContains(directory, identifier) {
  return readdirSync(directory, { withFileTypes: true }).some((entry) => {
    const entryPath = resolve(directory, entry.name)
    return entry.isDirectory()
      ? sourceContains(entryPath, identifier)
      : entry.isFile() && readFileSync(entryPath, 'utf8').includes(identifier)
  })
}

test('P4.5 persistence manifest assigns every state domain', () => {
  const p45 = readJson(p45Path)
  assert.deepEqual(
    Object.keys(p45.domainApi).sort(),
    ['contentPrep', 'learning', 'questionCatalog', 'training']
  )
  assert.deepEqual(p45.excludedHomeFeatures, [
    'learning-entry', 'new-user-onboarding', 'simple-professional-node-editor', 'help-entry-refresh'
  ])

  const sourceDirectory = findSourceDirectory()
  assert.ok(sourceDirectory, 'expected an updata-legacy source directory')
  for (const identifier of [
    'kg_practice_mistakes_v1__user__',
    'kg_recall_association_management_v1__subject__',
    'kg_recall_association_library_v1__subject__',
    'kg_canvas_view_preferences_v1'
  ]) {
    assert.equal(sourceContains(sourceDirectory, identifier), true)
  }
})

test('P4.5 source audit locates the repository update source', () => {
  const normalCheckoutSource = resolve(process.cwd(), '../updata-legacy')
  const linkedWorktreeSource = resolve(process.cwd(), '../../../updata-legacy')
  assert.equal(
    findSourceDirectory(),
    existsSync(normalCheckoutSource) ? normalCheckoutSource : linkedWorktreeSource
  )
})

test('P4.5 runtime manifest is accepted by the frontend build contract', () => {
  const p45 = readJson(p45Path)
  const contract = readJson(new URL('./new-legacy-contract.json', import.meta.url))
  for (const key of p45.runtime.exactKeys) assert.ok(contract.runtimeStorage.exactKeys.includes(key), key)
  for (const prefix of p45.runtime.prefixes) assert.ok(contract.runtimeStorage.prefixes.includes(prefix), prefix)
})
