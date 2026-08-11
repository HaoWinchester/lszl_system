import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const p45Path = new URL('./p45-persistence-contract.json', import.meta.url)
const migrationMatrixPath = new URL('../../docs/p45-migration-matrix.md', import.meta.url)
const p45PostgresTableRegistry = new Set([
  'graph_files',
  'file_contents',
  'question_banks',
  'questions',
  'principles',
  'synthesis_presets',
  'learning_events',
  'practice_mistakes',
  'practice_verifications',
  'recall_progress',
  'shared_runtime_states',
  'recall_association_libraries',
  'learning_evidence',
  'learning_diagnoses',
  'learning_decisions',
  'learning_content_versions',
  'content_eligibility_policies',
  'recommendation_candidates',
  'recommendation_rankings',
  'recommendation_selections',
  'recommendation_records',
  'learner_content_events',
  'content_effect_attributions',
  'question_upload_batches',
  'question_audit_logs',
  'prep_workspaces',
])
const placeholderOrWildcard = /—|\bTBD\b|\bfuture\b|后续|\*/iu

function parseMarkdownTable(markdown) {
  const lines = markdown.split('\n').filter((line) => /^\|.*\|\s*$/.test(line))
  assert.ok(lines.length >= 3, 'expected a Markdown table with a header and at least one row')

  const parseCells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim())
  const headers = parseCells(lines[0])
  return lines.slice(2).map((line) => Object.fromEntries(
    parseCells(line).map((cell, index) => [headers[index], cell])
  ))
}

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

test('P4.5 limits session persistence to navigation and preview token prefixes', () => {
  const p45 = readJson(p45Path)
  assert.deepEqual(p45.sessionOnlyPrefixes, [
    'kg_teacher_preview_',
    'kg_learning_route_context_',
  ])
})

test('P4.5 migration matrix assigns database ownership and API routes to every migrated feature group', () => {
  const rows = parseMarkdownTable(readFileSync(migrationMatrixPath, 'utf8'))
  const requiredGroups = [
    '图谱画布',
    '题库与训练',
    '做题与验证',
    '深度回忆',
    '学习诊断与推荐',
    'Prep Studio',
  ]

  for (const group of requiredGroups) {
    const row = rows.find((candidate) => candidate['功能组'] === group)
    assert.ok(row, `expected migration matrix row for ${group}`)
    assert.notEqual(row['排除？'], 'excluded', `${group} must be a migrated group`)
  }
})

test('P4.5 migration matrix rejects blank and placeholder persistence assignments for every migrated row', () => {
  const rows = parseMarkdownTable(readFileSync(migrationMatrixPath, 'utf8'))

  for (const row of rows.filter((candidate) => candidate['排除？'] !== 'excluded')) {
    const owners = row['PostgreSQL 归属'].match(/[a-z][a-z0-9_]*/g) ?? []
    assert.equal(placeholderOrWildcard.test(row['PostgreSQL 归属']), false, `${row['功能组']} has a placeholder PostgreSQL owner`)
    assert.ok(owners.length, `${row['功能组']} requires a PostgreSQL owner`)
    for (const owner of owners) {
      assert.ok(p45PostgresTableRegistry.has(owner), `${row['功能组']} has an unregistered PostgreSQL owner: ${owner}`)
    }

    const apiRoutes = row.API.split(/[、,，；;]/).map((route) => route.trim().replaceAll('`', '')).filter(Boolean)
    assert.equal(placeholderOrWildcard.test(row.API), false, `${row['功能组']} has a placeholder API route`)
    assert.ok(apiRoutes.length, `${row['功能组']} requires an API route`)
    for (const route of apiRoutes) {
      assert.match(route, /^\/api\/v1\/[a-z0-9-]+$/, `${row['功能组']} has an invalid API route`)
    }
  }
})

test('P4.5 migration matrix records homepage exclusions without a source-copy task', () => {
  const rows = parseMarkdownTable(readFileSync(migrationMatrixPath, 'utf8'))
  const excludedFeatures = [
    '四个学习入口',
    '新手引导',
    '简易/专业知识点编辑切换',
    '帮助入口改版',
  ]

  for (const feature of excludedFeatures) {
    const row = rows.find((candidate) => candidate['功能组'] === feature)
    assert.ok(row, `expected exclusion row for ${feature}`)
    assert.equal(row['排除？'], 'excluded', `${feature} must be excluded`)
    assert.equal(row['来源模块'], '无（不得从 updata-legacy/ 复制）', `${feature} must not have a source-copy task`)
    assert.equal(row['PostgreSQL 归属'], '—', `${feature} must not be assigned a database owner`)
    assert.equal(row.API, '—', `${feature} must not be assigned an API route`)
  }
})
