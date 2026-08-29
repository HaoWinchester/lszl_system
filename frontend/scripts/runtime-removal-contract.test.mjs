import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repoDir = resolve(scriptsDir, '../..')

const ROOTS = ['new-legacy', 'frontend/scripts', 'backend/app']
const DEVICE_PREFERENCE_SOURCE = 'new-legacy/src/28-device-preferences.js'
const IGNORED = [
  'new-legacy/tests/',
  'frontend/public/',
  'frontend/new-legacy-releases/',
  'frontend/scripts/runtime-removal-contract.test.mjs',
  'frontend/scripts/runtime-removal-baseline.json',
]
const TOKENS = {
  endpoint: /\/api\/v1\/runtime\/state/g,
  consumer: /\b(?:KGServerStateStorage|KGServerStateBootstrap)\b/g,
  runtimeKey: /(?:(['"`])(?<quoted>kg_[a-z0-9_]+(?:__[^'"`]*)?)\1|(?<bare>\bkg_[a-z0-9_]+(?:__\w+)?)(?=\s*:))/gi,
}
const DYNAMIC_KEY = /(?:(?:global|window)\s*(?:\?\.|\.)\s*)?(?:localStorage|sessionStorage)\s*(?:\?\.|\.)\s*(?:getItem|setItem|removeItem)\s*(?:\?\.)?\s*\(\s*([A-Za-z_$][\w$]*(?:\([^\n)]*\))?)/g
const DEVICE_PREFERENCE_STORAGE_CALL = /(?:(?:global|window)\s*(?:\?\.\s*|\.\s*))?localStorage\s*(?:\?\.\s*|\.\s*)(?:getItem|setItem|removeItem)\s*(?:\?\.\s*)?\(\s*(assertAllowed\s*\(\s*key\s*\)|[^,\n)]+)[^\n]*\)/g

function repoRelative(path) {
  return relative(repoDir, path).replaceAll('\\', '/')
}

function filesUnder(path) {
  const absolute = resolve(repoDir, path)
  if (statSync(absolute).isFile()) return [absolute]
  return readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const child = resolve(absolute, entry.name)
    return entry.isDirectory() ? filesUnder(repoRelative(child)) : [child]
  })
}

function occurrenceInventory(overrides = new Map()) {
  const result = { endpoint: [], consumer: [], runtimeKey: [], dynamicRuntimeKey: [], devicePreferenceStorage: [] }
  const normalizedOverrides = new Map(
    [...overrides].map(([path, source]) => [path.replaceAll('\\', '/'), source]),
  )
  const paths = new Set(ROOTS.flatMap(filesUnder).map(repoRelative))
  for (const path of normalizedOverrides.keys()) paths.add(path)
  for (const path of paths) {
    const absolute = resolve(repoDir, path)
    if (IGNORED.some(ignored => path === ignored || path.startsWith(ignored))) continue
    if (!/\.(?:js|mjs|py|html|json)$/.test(path)) continue
    const source = normalizedOverrides.get(path) ?? readFileSync(absolute, 'utf8')
    for (const [kind, pattern] of Object.entries(TOKENS)) {
      if (kind === 'runtimeKey' && path === DEVICE_PREFERENCE_SOURCE) continue
      for (const match of source.matchAll(pattern)) {
        const token = kind === 'runtimeKey'
          ? (match.groups?.quoted ?? match.groups?.bare ?? match[0])
          : match[0]
        result[kind].push(`${path}:${token}`)
      }
    }
    if (path !== DEVICE_PREFERENCE_SOURCE) {
      for (const match of source.matchAll(DYNAMIC_KEY)) {
        const token = match[1]
        if (!/^kg_[a-z0-9_]+(?:__[^'"`]*)?$/i.test(token)) result.dynamicRuntimeKey.push(`${path}:${token}`)
      }
    } else {
      for (const match of source.matchAll(DEVICE_PREFERENCE_STORAGE_CALL)) {
        if (/^assertAllowed\s*\(\s*key\s*\)$/.test(match[1])) continue
        result.devicePreferenceStorage.push(`${path}:${match[0].trim()}`)
      }
    }
  }
  for (const values of Object.values(result)) values.sort()
  return result
}

export function inventory(overrides = new Map()) {
  const occurrences = occurrenceInventory(overrides)
  return Object.fromEntries(Object.entries(occurrences).map(([kind, values]) => {
    const ordinal = new Map()
    return [kind, values.sort().map(value => {
      const separator = value.indexOf(':')
      const path = value.slice(0, separator)
      const token = value.slice(separator + 1)
      const key = `${path}:${token}`
      const index = (ordinal.get(key) ?? 0) + 1
      ordinal.set(key, index)
      return { path, token, ordinal: index }
    })]
  }))
}

const BASELINE = inventory()
const BASELINE_PATH = resolve(scriptsDir, 'runtime-removal-baseline.json')

if (process.env.WRITE_RUNTIME_REMOVAL_BASELINE === '1') {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(BASELINE_PATH, JSON.stringify(BASELINE, null, 2) + '\n')
}

function additions(actual, baseline) {
  return Object.fromEntries(
    Object.keys(actual).map(kind => {
      const known = new Set((baseline[kind] ?? []).map(item => typeof item === 'string' ? item : JSON.stringify(item)))
      return [kind, actual[kind].filter(item => !known.has(typeof item === 'string' ? item : JSON.stringify(item)))]
    }),
  )
}

export function contractReport(overrides = new Map(), baseline = BASELINE) {
  const actual = inventory(overrides)
  const unreviewed = additions(actual, baseline)
  const blocked = Object.values(unreviewed).some(items => items.length > 0)
  return { blocked, unreviewed }
}

test('runtime removal contract detects a newly added key, endpoint, and consumer', () => {
  const fixturePath = 'new-legacy/src/__runtime-removal-contract-fixture.js'
  const fixture = [
    "fetch('/api/v1/runtime/state'); fetch('/api/v1/runtime/state')",
    'window.KGServerStateStorage.flush(); window.KGServerStateStorage.refresh()',
    "localStorage.setItem('kg_exam_papers_published_v1', '{}')",
    "localStorage.setItem('kg_brand_new_persistent_v1', '{}')",
  ].join('\n')
  const actual = inventory(new Map([[fixturePath, fixture]]))

  assert.equal(actual.endpoint.length, BASELINE.endpoint.length + 2)
  assert.equal(actual.consumer.length, BASELINE.consumer.length + 2)
  assert.ok(actual.runtimeKey.length >= BASELINE.runtimeKey.length + 2)
})

test('runtime removal contract scans the shared domain client boundary', () => {
  const path = 'frontend/scripts/new-legacy-assets/domain-api-client.js'
  const report = contractReport(new Map([[path, "fetch('/api/v1/runtime/state')\n"]]))

  assert.equal(report.blocked, true)
  assert.deepEqual(report.unreviewed.endpoint, [{
    path,
    token: '/api/v1/runtime/state',
    ordinal: 1,
  }])
})

test('runtime removal contract rejects an unguarded device-preference storage write', () => {
  const report = contractReport(new Map([[
    DEVICE_PREFERENCE_SOURCE,
    "localStorage.setItem('kg_exam_papers_v1__admin', '[]')\n",
  ]]))

  assert.equal(report.blocked, true)
  assert.deepEqual(report.unreviewed.devicePreferenceStorage, [{
    path: DEVICE_PREFERENCE_SOURCE,
    token: "localStorage.setItem('kg_exam_papers_v1__admin', '[]')",
    ordinal: 1,
  }])
})

test('runtime inventory includes legacy implementation occurrences instead of ignoring whole files', () => {
  const actual = inventory()
  assert.ok(actual.endpoint.some(item => item.path === 'backend/app/web/routes.py'))
  assert.ok(actual.runtimeKey.some(item => item.path === 'backend/app/services/runtime_state_service.py'))
  assert.ok(actual.consumer.some(item => item.path === 'frontend/scripts/new-legacy-assets/server-state-bootstrap.js'))
})

test('inserting unrelated lines does not change occurrence baseline', () => {
  const path = 'new-legacy/src/__runtime-removal-contract-fixture.js'
  const source = "fetch('/api/v1/runtime/state')\n"
  const actual = inventory(new Map([[path, source]]))
  const shifted = inventory(new Map([[path, `const unrelated = true\n${source}`]]))
  assert.deepEqual(shifted, actual)
})

test('occurrences are structured and preserve tokens containing colons', () => {
  const path = 'new-legacy/src/__runtime-removal-contract-fixture.js'
  const actual = inventory(new Map([[path, "fetch('https://example.test/api/v1/runtime/state')\n"]]))
  assert.deepEqual(actual.endpoint.find(item => item.path === path), {
    path,
    token: '/api/v1/runtime/state',
    ordinal: 1,
  })
})

test('runtime key detector covers quoted, backtick, bare object keys and template constants', () => {
  const path = 'new-legacy/src/__runtime-removal-contract-fixture.js'
  const source = [
    "const SINGLE = 'kg_single_v1'",
    'const TEMPLATE = `kg_template_v1__${scope}`',
    "const record = {'kg_quoted_v1': 1, `kg_backtick_v1`: 2, kg_unquoted_v1: 3}",
  ].join('\n')
  const actual = inventory(new Map([[path, source]]))
  const tokens = actual.runtimeKey.filter(item => item.path === path).map(item => item.token)
  for (const token of ['kg_single_v1', 'kg_template_v1__${scope}', 'kg_quoted_v1', 'kg_backtick_v1', 'kg_unquoted_v1']) {
    assert.ok(tokens.includes(token), `missing ${token}`)
  }
})

test('unrecognized dynamic storage keys are reported', () => {
  const path = 'new-legacy/src/__runtime-removal-contract-fixture.js'
  const actual = inventory(new Map([[path, 'localStorage.setItem(buildRuntimeKey(scope), value)\n']]))
  assert.deepEqual(actual.dynamicRuntimeKey.filter(item => item.path === path), [{
    path,
    token: 'buildRuntimeKey(scope)',
    ordinal: 1,
  }])
})

test('unrecognized dynamic storage keys block the contract with an explicit report', () => {
  const path = 'new-legacy/src/__runtime-removal-contract-fixture.js'
  const report = contractReport(new Map([[path, 'localStorage.setItem(buildRuntimeKey(scope), value)\n']]))
  assert.equal(report.blocked, true)
  assert.equal(report.unreviewed.dynamicRuntimeKey.length, 1)
})

test('qualified and optional storage calls with dynamic keys block the contract', () => {
  const path = 'new-legacy/src/__runtime-removal-contract-fixture.js'
  const source = [
    'global.localStorage?.setItem(buildGlobalKey(scope), value)',
    'window.localStorage?.getItem?.(buildWindowKey(scope))',
    'localStorage?.setItem?.(buildLocalKey(scope), value)',
  ].join('\n')
  const report = contractReport(new Map([[path, source]]))

  assert.equal(report.blocked, true)
  assert.deepEqual(report.unreviewed.dynamicRuntimeKey, [
    { path, token: 'buildGlobalKey(scope)', ordinal: 1 },
    { path, token: 'buildLocalKey(scope)', ordinal: 1 },
    { path, token: 'buildWindowKey(scope)', ordinal: 1 },
  ])
})

test('adding an occurrence in the same file fails the baseline', () => {
  const path = 'new-legacy/src/__runtime-removal-contract-fixture.js'
  const source = "fetch('/api/v1/runtime/state')\n"
  const actual = inventory(new Map([[path, `${source}${source}`]]))
  assert.equal(actual.endpoint.length, BASELINE.endpoint.length + 2)
})

test('runtime dependency inventory has no unreviewed additions', () => {
  const approved = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  assert.deepEqual(additions(inventory(), approved), { endpoint: [], consumer: [], runtimeKey: [], dynamicRuntimeKey: [], devicePreferenceStorage: [] })
})
