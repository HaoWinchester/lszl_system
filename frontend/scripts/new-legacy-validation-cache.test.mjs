import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { CRITICAL_SITE_FILES } from './new-legacy-release-storage.js'

const scripts = dirname(fileURLToPath(import.meta.url))
const repository = resolve(scripts, '../..')
const version = 'cache-test-v1'
const validatorEnvName = `KG_RELEASE_${'VALIDATION_SCRIPT'}`

function put(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function fixture(t) {
  const parent = resolve(repository, '.superpowers')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(resolve(parent, 'cache-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const checkout = resolve(root, 'checkout-a')
  mkdirSync(checkout)
  for (const file of ['manage-new-legacy.js', 'new-legacy-release-storage.js']) {
    const target = resolve(checkout, 'frontend/scripts', file)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(resolve(scripts, file), target)
  }
  const policy = 'deploy/release-input-policy.mjs'
  if (existsSync(resolve(repository, policy))) {
    mkdirSync(resolve(checkout, 'deploy'), { recursive: true })
    cpSync(resolve(repository, policy), resolve(checkout, policy))
  }
  put(resolve(checkout, 'frontend/package.json'), '{"type":"module"}\n')
  // The manager and Git are real; only expensive bundle building and validation
  // are replaced with deterministic executables at their process boundaries.
  put(resolve(checkout, 'frontend/scripts/sync-new-legacy.js'), `import { cpSync } from 'node:fs';\ncpSync(process.argv[3], process.argv[5], { recursive: true });\n`)
  for (const file of ['new-legacy-contract.json', 'homepage-bundles.json', 'homepage-bundles.mjs', 'new-legacy-assets/adapter.js']) {
    put(resolve(checkout, 'frontend/scripts', file), '{}\n')
  }
  put(resolve(checkout, 'new-legacy/VERSION'), version)
  for (const file of CRITICAL_SITE_FILES) put(resolve(checkout, 'new-legacy', file), `fixture ${file}\n`)
  put(resolve(checkout, 'backend/app.py'), 'print("backend")\n')
  put(resolve(checkout, 'docs/superpowers/plan.md'), 'Plan\n')
  put(resolve(checkout, 'docs/verification/result.md'), 'Result\n')
  put(resolve(checkout, 'docs/runtime-contract.md'), 'Runtime contract\n')
  put(resolve(checkout, '.gitignore'), '/releases/\n')
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: checkout, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=Cache Test', '-c', 'user.email=cache@example.invalid', 'commit', '-qm', 'fixture')
  const validator = resolve(root, 'validator.sh')
  put(validator, '#!/bin/sh\nprintf "validation\\n" >> "$VALIDATION_CALLS"\nexit "${VALIDATION_EXIT:-0}"\n')
  chmodSync(validator, 0o755)
  const calls = resolve(root, 'calls.txt')
  const run = (directory = checkout, env = {}, args = []) => spawnSync(process.execPath, [
    resolve(directory, 'frontend/scripts/manage-new-legacy.js'), 'update', resolve(directory, 'new-legacy'),
    '--root', resolve(directory, 'releases'), ...args,
  ], {
    cwd: directory, encoding: 'utf8',
    env: { ...process.env, [validatorEnvName]: validator, VALIDATION_CALLS: calls, ...env },
  })
  const pass = (...args) => {
    const result = run(...args)
    assert.equal(result.status, 0, result.stderr)
    return result
  }
  const reportPath = resolve(checkout, 'releases', version, 'validation.json')
  return { root, checkout, validator, run, pass, reportPath,
    count: () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').length : 0,
    readReport: () => JSON.parse(readFileSync(reportPath, 'utf8')),
  }
}

test('identical Git checkouts and relocated validator reuse successful evidence', (t) => {
  const f = fixture(t)
  f.pass()
  const other = resolve(f.root, 'checkout-b')
  const clone = spawnSync('git', ['clone', '-q', f.checkout, other], { encoding: 'utf8' })
  assert.equal(clone.status, 0, clone.stderr)
  cpSync(resolve(f.checkout, 'releases'), resolve(other, 'releases'), { recursive: true })
  const validator = resolve(f.root, 'elsewhere/validator.sh')
  mkdirSync(dirname(validator))
  cpSync(f.validator, validator)
  f.pass(other, { [validatorEnvName]: validator })
  assert.equal(f.count(), 1, 'identical inputs in a different checkout must reuse validation')
})

test('only operational Markdown records may change without rerunning validation', (t) => {
  const f = fixture(t)
  f.pass()
  put(resolve(f.checkout, 'docs/superpowers/plan.md'), 'Updated plan\n')
  put(resolve(f.checkout, 'docs/verification/new-result.md'), 'New result\n')
  f.pass()
  assert.equal(f.count(), 1, 'operational records must not invalidate the evidence')
})

test('committing a validated release then refreshing the sync diff report reuses evidence', (t) => {
  const f = fixture(t)
  const report = resolve(f.checkout, 'frontend/new-legacy-sync-report.json')
  put(report, JSON.stringify({ schemaVersion: 1, fromVersion: 'old', toVersion: version,
    changes: { added: [], changed: ['VERSION', 'styles/answer-page.css'], removed: [] }, incompatible: [] }))
  f.pass()
  const before = readFileSync(f.reportPath, 'utf8')
  for (const args of [['add', '.'], ['-c', 'user.name=Cache Test', '-c', 'user.email=cache@example.invalid', 'commit', '-qm', 'release']]) {
    const result = spawnSync('git', args, { cwd: f.checkout, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  // update-uat syncs once more before asking the release manager to update.
  // The previous diff becomes empty although all actual release inputs match.
  put(report, JSON.stringify({ schemaVersion: 1, fromVersion: version, toVersion: version,
    changes: { added: [], changed: [], removed: [] }, incompatible: [] }))
  f.pass()
  assert.equal(f.count(), 1, 'refreshing a diagnostic diff must not repeat full validation')
  assert.equal(readFileSync(f.reportPath, 'utf8'), before)
})

for (const path of ['backend/app.py', '.unknown-runtime-config', 'docs/runtime-contract.md', 'docs/superpowers/check.js', 'frontend/package.json', 'frontend/new-legacy-manifest.json', 'frontend/another-sync-report.json']) {
  test(`runtime input ${path} invalidates successful evidence`, (t) => {
    const f = fixture(t)
    f.pass()
    put(resolve(f.checkout, path), path.endsWith('package.json') ? '{"type":"module","version":"2"}\n' : 'changed\n')
    f.pass()
    assert.equal(f.count(), 2)
  })
}

test('validator executable permission changes cannot reuse success', (t) => {
  const f = fixture(t)
  f.pass()
  chmodSync(f.validator, 0o644)
  assert.notEqual(f.run().status, 0)
  assert.equal(f.readReport().passed, false)
})

test('changed Python runtime version invalidates successful evidence', (t) => {
  const f = fixture(t)
  const python = resolve(f.root, 'bin/python3')
  put(python, '#!/bin/sh\nprintf "Python 3.11.1\\n"\n')
  chmodSync(python, 0o755)
  const env = { PATH: `${dirname(python)}:${process.env.PATH}` }
  f.pass(f.checkout, env)
  put(python, '#!/bin/sh\nprintf "Python 3.12.0\\n"\n')
  f.pass(f.checkout, env)
  assert.equal(f.count(), 2, 'Python version is part of validation evidence')
})

test('same-count site tampering requires a new successful validation', (t) => {
  const f = fixture(t)
  f.pass()
  put(resolve(f.checkout, 'releases', version, 'site/admin-console.html'), 'tampered site\n')
  const result = f.run(f.checkout, { VALIDATION_EXIT: '17' })
  assert.notEqual(result.status, 0, 'a cached report must not conceal modified site content')
  assert.equal(f.count(), 2)
  assert.equal(f.readReport().passed, false)
})

test('candidate source tampering is rejected before cached validation or promotion', (t) => {
  const f = fixture(t)
  f.pass()
  put(resolve(f.checkout, 'releases', version, 'source/admin-console.html'), 'tampered source\n')
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /source.*(?:不一致|不同|变更)/)
  assert.equal(f.count(), 1)
  assert.equal(f.readReport().passed, false)
})

test('validation progress is readable on disk before the validator exits', (t) => {
  const f = fixture(t)
  put(f.validator, '#!/bin/sh\necho "stage-visible-before-exit"\ngrep -q "stage-visible-before-exit" "$1/$2/validation-run.log" || exit 21\necho "stage-complete" >&2\n')
  f.pass()
  const log = readFileSync(resolve(f.checkout, 'releases', version, 'validation-run.log'), 'utf8')
  assert.match(log, /stage-visible-before-exit/)
  assert.match(log, /stage-complete/)
})

test('failed adapter rebuild preserves its detailed log after staging cleanup', (t) => {
  const f = fixture(t)
  f.pass()
  put(resolve(f.checkout, 'frontend/scripts/homepage-bundles.mjs'), '{}\n// new adapter\n')
  put(f.validator, '#!/bin/sh\necho "adapter-validation-failed" >&2\nprintf "%060000d\\n" 0\nexit 23\n')
  const before = readFileSync(resolve(f.checkout, 'releases/current.json'), 'utf8')
  const reportBefore = readFileSync(f.reportPath, 'utf8')
  const result = f.run()
  assert.notEqual(result.status, 0)
  const path = result.stderr.match(/验收进度日志：([^\n]+)/)?.[1]
  assert.ok(path, result.stderr)
  assert.equal(existsSync(path), true, 'reported validation log survives adapter staging cleanup')
  const log = readFileSync(path, 'utf8')
  assert.match(log, /adapter-validation-failed/)
  assert.ok(log.length > 60_000, 'preserved log includes output beyond the report tail limit')
  assert.equal(readFileSync(resolve(f.checkout, 'releases/current.json'), 'utf8'), before)
  assert.equal(readFileSync(f.reportPath, 'utf8'), reportBefore)
})

for (const target of ['source/admin-console.html', 'site/admin-console.html']) {
  test(`changing ${target} during validation cannot produce successful evidence`, (t) => {
    const f = fixture(t)
    put(f.validator, `#!/bin/sh\nprintf changed > "$1/$2/${target}"\n`)
    assert.notEqual(f.run().status, 0)
    assert.equal(f.readReport().passed, false)
    assert.equal(existsSync(resolve(f.checkout, 'releases/current.json')), false)
  })
}

for (const [label, changed] of [
  ['failed', { passed: false }], ['skipped', { skipped: true }],
  ['incompatible profile', { profile: 'uat-fast' }], ['legacy schema', { schemaVersion: 1 }],
]) {
  test(`${label} evidence is not reusable`, (t) => {
    const f = fixture(t)
    f.pass()
    put(f.reportPath, JSON.stringify({ ...f.readReport(), ...changed }))
    f.pass()
    assert.equal(f.count(), 2)
  })
}
