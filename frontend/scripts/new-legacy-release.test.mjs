import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
const sourceVersion = readFileSync(resolve(source, 'VERSION'), 'utf8').trim()

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

function hashTree(root) {
  const hash = createHash('sha256')
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name)
      const relative = path.slice(root.length + 1)
      hash.update(relative)
      if (statSync(path).isDirectory()) visit(path)
      else hash.update(readFileSync(path))
    }
  }
  visit(root)
  return hash.digest('hex')
}

test('content prep studio ships reproducible modular source and backend bootstrap marker', () => {
  const contract = readJson(resolve(scriptsDir, 'new-legacy-contract.json'))
  const required = [
    'content-prep-studio/README.md',
    'content-prep-studio/build.py',
    'content-prep-studio/src/index.template.html',
    'content-prep-studio/src/css/app.css',
    'content-prep-studio/src/js/00-core-bootstrap.js',
    'content-prep-studio/src/js/10-state-domain.js',
    'content-prep-studio/src/js/20-page-runtime.js',
    'content-prep-studio/src/js/30-service-layer.js',
    'content-prep-studio/src/js/35-server-catalog-service.js',
    'content-prep-studio/src/js/36-server-draft-service.js',
    'content-prep-studio/src/js/37-shared-draft-ui.js',
    'content-prep-studio/src/js/40-events-bootstrap.js',
    'content-prep-studio/src/js/45-server-events.js',
    'content-prep-studio/src/tag-slot-schema.json',
    'content-prep-studio/tests/test_build.py',
    'content-prep-studio/tests/test_services.py',
    'content-prep-studio/tests/test_tag_migration.js',
    'content-prep-studio/tests/test_server_catalog.js',
    'content-prep-studio/tests/test_edit_lock_client.js',
    'content-prep-studio/tests/test_shared_draft_service.js',
    'content-prep-studio/tests/test_server_ui_contract.py',
    'content-prep-studio/dist/content-prep.html',
  ]
  for (const path of required) {
    assert.ok(contract.requiredFiles.includes(path), `${path} must be release-required`)
    assert.ok(existsSync(resolve(source, path)), `${path} must exist in source`)
  }

  const built = readFileSync(resolve(source, 'content-prep-studio/dist/content-prep.html'), 'utf8')
  assert.match(built, /window\.PMPPrepServices/)
  assert.match(built, /global\.PMPPrepSharedDrafts/)
  assert.match(built, /确认同步到主程序/)
  for (let index = 1; index <= 6; index += 1) {
    assert.match(built, new RegExp(`creator_00${index}`))
  }
  assert.match(built, /indexedDB\.open/)
  assert.match(built, /<script src="\/server-state-bootstrap\.js"><\/script>/)

  const enterinformation = resolve(repoDir, 'enterinformation')
  const existedBeforeBuild = existsSync(enterinformation)
  const before = existedBeforeBuild ? hashTree(enterinformation) : null
  const result = spawnSync('python3', [resolve(source, 'content-prep-studio/build.py')], {
    cwd: repoDir,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(enterinformation), existedBeforeBuild, 'build must not create or remove enterinformation')
  if (existedBeforeBuild) {
    assert.equal(hashTree(enterinformation), before, 'build must not modify enterinformation')
  }
  assert.equal(
    readFileSync(resolve(source, 'content-prep-studio/dist/content-prep.html'), 'utf8'),
    built,
    'repeated builds must be byte-identical',
  )
})

test('update builds an isolated release and atomically selects it', () => {
  const root = makeRoot()
  const result = run(root, 'update', source)

  assert.equal(result.status, 0, result.stderr)
  const current = readJson(resolve(root, 'current.json'))
  assert.equal(current.version, sourceVersion)
  assert.equal(current.previousVersion, null)
  assert.ok(existsSync(resolve(root, sourceVersion, 'source', 'learning-path.html')))
  assert.ok(existsSync(resolve(root, sourceVersion, 'site', 'learning-path.html')))
  const page = readFileSync(resolve(root, sourceVersion, 'site', 'index.html'), 'utf8')
  assert.match(page, new RegExp(`styles/user-center\\.css\\?v=${sourceVersion}`))
  assert.match(page, /<script src="\.\/server-state-bootstrap\.js"><\/script>/)
  assert.match(page, new RegExp(`direct-entry\\.js\\?v=${sourceVersion}`))
  assert.match(page, new RegExp(`runtime-config\\.override\\.js\\?v=${sourceVersion}`))
  const chooserTags = page.match(/<script defer src="src\/31-learning-entry-chooser\.js\?v=[^"]+"><\/script>/g) || []
  assert.equal(chooserTags.length, 1, 'release index must contain exactly one learning-entry chooser script')
  assert.ok(
    page.indexOf('src/29-auth-core.js') < page.indexOf('src/31-learning-entry-chooser.js')
      && page.indexOf('src/31-learning-entry-chooser.js') < page.indexOf('src/10-graph-editor.js'),
    'release chooser must run after auth core and before graph initialization',
  )
  const landingPage = readFileSync(resolve(root, sourceVersion, 'site', 'landing.html'), 'utf8')
  assert.match(landingPage, new RegExp(`styles/landing\\.css\\?v=${sourceVersion}`))
  assert.match(landingPage, new RegExp(`src/landing\\.js\\?v=${sourceVersion}`))
  assert.doesNotMatch(landingPage, /server-state-bootstrap|direct-entry|feature-analytics/, 'public landing must not load business runtime adapters')
  const practicePage = readFileSync(resolve(root, sourceVersion, 'site', 'practice-mode.html'), 'utf8')
  assert.match(
    practicePage,
    new RegExp(`src/41-account-menu\\.js\\?v=${sourceVersion}`),
    'release pages must cache-bust local business scripts',
  )
  const workspacePage = readFileSync(resolve(root, sourceVersion, 'site', 'question-workspace.html'), 'utf8')
  assert.match(workspacePage, /practice-learning-adapter\.js/)
  assert.match(workspacePage, /personal-card-adapter\.js/)
  assert.match(workspacePage, /src\/108-multi-question-learning-assets\.js/)
  assert.ok(workspacePage.indexOf('personal-card-adapter.js') < workspacePage.indexOf('src/77-multi-question-workspace.js'))
  assert.match(
    practicePage,
    /<script src="\.\/server-state-bootstrap\.js"><\/script>/,
    'the backend bootstrap injection marker must remain unversioned',
  )
  const retiredSingleDeep = readFileSync(resolve(root, sourceVersion, 'site', 'question-training.html'), 'utf8')
  assert.match(retiredSingleDeep, /location\.replace\(target\.toString\(\)\)/, 'the retired single-deep page must stay a redirect shell')
  assert.doesNotMatch(retiredSingleDeep, /<script\b[^>]*\bsrc=(['"])(?:\.\/)?src\//i, 'a redirect shell must contain zero src application scripts')
  assert.doesNotMatch(retiredSingleDeep, /question-catalog-adapter|direct-runtime-fixes|direct-auth-adapter/, 'a redirect shell must not receive retired runtime adapters')
  const questionBankPage = readFileSync(resolve(root, sourceVersion, 'site', 'question-bank.html'), 'utf8')
  assert.match(
    questionBankPage,
    new RegExp(`question-studio/question-studio-parser\\.js\\?v=${sourceVersion}`),
    'all local scripts must be versioned so warm navigation can reuse immutable assets',
  )
  assert.match(current.sourceHash, /^[a-f0-9]{64}$/)
  assert.match(current.adapterHash, /^[a-f0-9]{64}$/)
  assert.equal(readJson(resolve(root, sourceVersion, 'release.json')).adapterVersion, 4)
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

test('same source version is atomically rebuilt when the adapter changes', () => {
  const root = makeRoot()
  const harness = resolve(root, 'harness', 'frontend')
  const releases = resolve(root, 'releases')
  mkdirSync(harness, { recursive: true })
  cpSync(resolve(frontendDir, 'scripts'), resolve(harness, 'scripts'), { recursive: true })
  const harnessCommand = resolve(harness, 'scripts', 'manage-new-legacy.js')
  const runHarness = () => spawnSync(
    process.execPath,
    [harnessCommand, 'update', source, '--root', releases, '--skip-browser'],
    { cwd: repoDir, encoding: 'utf8' },
  )
  assert.equal(runHarness().status, 0)
  const before = readJson(resolve(releases, 'current.json'))
  const adapterPath = resolve(harness, 'scripts', 'new-legacy-assets', 'direct-entry.js')
  writeFileSync(adapterPath, `${readFileSync(adapterPath, 'utf8')}\n/* adapter-rebuild-probe */\n`)

  const result = runHarness()

  assert.equal(result.status, 0, result.stderr)
  const after = readJson(resolve(releases, 'current.json'))
  assert.equal(after.version, before.version)
  assert.equal(after.sourceHash, before.sourceHash)
  assert.notEqual(after.adapterHash, before.adapterHash)
  assert.equal(readJson(resolve(releases, sourceVersion, 'release.json')).adapterHash, after.adapterHash)
  assert.match(readFileSync(resolve(releases, sourceVersion, 'site', 'direct-entry.js'), 'utf8'), /adapter-rebuild-probe/)
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
  assert.ok(Array.isArray(report.command))
  assert.match(report.error, /candidate rejected/)
})

test('candidate with fewer site files is rejected before promotion', () => {
  const root = makeRoot()
  assert.equal(run(root, 'update', source).status, 0)
  const before = readFileSync(resolve(root, 'current.json'), 'utf8')
  const next = resolve(root, 'smaller-source')
  const nextVersion = `${sourceVersion}-smaller-site`
  cpSync(source, next, { recursive: true })
  writeFileSync(resolve(next, 'VERSION'), `${nextVersion}\n`)
  rmSync(resolve(next, 'README.md'))

  const result = run(root, 'update', next)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /候选 site 文件数.*当前 active site/)
  assert.equal(readFileSync(resolve(root, 'current.json'), 'utf8'), before)
  const report = readJson(resolve(root, nextVersion, 'validation.json'))
  assert.equal(report.passed, false)
  assert.match(report.error, /候选 site 文件数/)
})

test('candidate missing a critical content page is rejected before promotion', () => {
  const root = makeRoot()
  assert.equal(run(root, 'update', source).status, 0)
  const before = readFileSync(resolve(root, 'current.json'), 'utf8')
  const next = resolve(root, 'missing-critical-source')
  const nextVersion = `${sourceVersion}-missing-critical`
  cpSync(source, next, { recursive: true })
  writeFileSync(resolve(next, 'VERSION'), `${nextVersion}\n`)
  rmSync(resolve(next, 'admin-console.html'))

  const result = run(root, 'update', next)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /候选 site 缺少关键文件.*admin-console\.html/s)
  assert.equal(readFileSync(resolve(root, 'current.json'), 'utf8'), before)
  const report = readJson(resolve(root, nextVersion, 'validation.json'))
  assert.equal(report.passed, false)
  assert.match(report.error, /admin-console\.html/)
})

test('candidate missing the public landing page is rejected before promotion', () => {
  const root = makeRoot()
  assert.equal(run(root, 'update', source).status, 0)
  const before = readFileSync(resolve(root, 'current.json'), 'utf8')
  const harness = resolve(root, 'landing-gate-harness', 'frontend')
  mkdirSync(harness, { recursive: true })
  cpSync(resolve(frontendDir, 'scripts'), resolve(harness, 'scripts'), { recursive: true })
  const harnessSync = resolve(harness, 'scripts', 'sync-new-legacy.js')
  writeFileSync(
    harnessSync,
    readFileSync(harnessSync, 'utf8').replace(
      "  cpSync(source, out, { recursive: true })",
      "  cpSync(source, out, { recursive: true })\n  rmSync(resolve(out, 'landing.html'), { force: true })",
    ),
  )
  const harnessCommand = resolve(harness, 'scripts', 'manage-new-legacy.js')
  const next = resolve(root, 'missing-landing-source')
  const nextVersion = `${sourceVersion}-missing-landing`
  cpSync(source, next, { recursive: true })
  writeFileSync(resolve(next, 'VERSION'), `${nextVersion}\n`)
  writeFileSync(resolve(next, 'landing-gate-padding.txt'), 'keeps the candidate file count equal to active\n')

  const result = spawnSync(
    process.execPath,
    [harnessCommand, 'update', next, '--root', root, '--skip-browser'],
    { cwd: repoDir, encoding: 'utf8' },
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /候选 site 缺少关键文件.*landing\.html/s)
  assert.equal(readFileSync(resolve(root, 'current.json'), 'utf8'), before)
  const report = readJson(resolve(root, nextVersion, 'validation.json'))
  assert.equal(report.passed, false)
  assert.match(report.error, /landing\.html/)
})

test('rollback selects the previous successful release', () => {
  const root = makeRoot()
  assert.equal(run(root, 'update', source).status, 0)
  const next = resolve(root, 'next-source')
  const nextVersion = `${sourceVersion}-rollback-test`
  cpSync(source, next, { recursive: true })
  writeFileSync(resolve(next, 'VERSION'), `${nextVersion}\n`)
  assert.equal(run(root, 'update', next).status, 0)

  const result = run(root, 'rollback')

  assert.equal(result.status, 0, result.stderr)
  const current = readJson(resolve(root, 'current.json'))
  assert.equal(current.version, sourceVersion)
  assert.equal(current.previousVersion, nextVersion)
})

test('release validation runs smoke and visual regression against the candidate', () => {
  const validator = readFileSync(resolve(scriptsDir, 'validate-new-legacy-release.sh'), 'utf8')

  const migration = validator.indexOf('.venv/bin/python -m alembic upgrade head')
  const server = validator.indexOf('.venv/bin/python -m uvicorn app.main:app')
  const createDatabase = validator.indexOf('createdb')
  const dropDatabase = validator.indexOf('dropdb')
  assert.notEqual(migration, -1, 'candidate validation must migrate its isolated database before starting FastAPI')
  assert.notEqual(createDatabase, -1, 'candidate validation must create a disposable database')
  assert.notEqual(dropDatabase, -1, 'candidate validation must remove its disposable database')
  assert.ok(createDatabase < migration, 'candidate database must exist before migrations run')
  assert.ok(migration < server, 'candidate migration must run before FastAPI starts')
  assert.ok(validator.includes('DATABASE_URL="$VALIDATION_DATABASE_URL"'), 'migration and server must use the disposable database URL')

  // full_role_regression.py 绑定 v8.6 全字段 UI，v9 重构（简化模式 + 试卷独立页）后待重写，暂移出验收。
  assert.ok(validator.includes('frontend/e2e/new_legacy_smoke.py'))
  assert.ok(validator.includes('new-legacy/tests/landing-page-contract.test.js'))
  assert.ok(validator.includes('new-legacy/tests/landing-page-browser.py'))
  assert.ok(validator.includes('content-prep-studio/tests/test_server_catalog.js'))
  assert.ok(validator.includes('frontend/e2e/content_prep_question_bank.py'))
  assert.ok(validator.includes('frontend/e2e/content_prep_bank_load.py'))
  assert.ok(validator.includes('frontend/e2e/content_prep_concurrency.py'))
  assert.ok(validator.includes('frontend/e2e/practice_mode_initial_view.py'))
  assert.ok(validator.includes('frontend/e2e/multi_question_learning_assets.py'))
  assert.ok(validator.includes('frontend/e2e/direct_new_legacy_visual.py'))

  const contract = readJson(resolve(scriptsDir, 'new-legacy-contract.json'))
  assert.ok(contract.releaseValidation?.commands?.includes('python3 frontend/e2e/multi_question_learning_assets.py'))
})
