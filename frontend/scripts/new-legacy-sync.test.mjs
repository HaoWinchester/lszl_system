import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const syncScript = resolve(scriptsDir, 'sync-new-legacy.js')
const sourceMigrationManifest = resolve(scriptsDir, '..', '..', 'new-legacy', 'p45-migration-manifest.json')
const requiredPages = [
  'index.html',
  'learning-path.html',
  'guided-learning-node.html',
  'guided-learning-placement-test.html',
  'question-training.html',
  'question-workspace.html',
  'knowledge-recall.html',
]
const requiredFiles = [
  'src/01-runtime-config.js',
  'src/31-learning-entry-chooser.js',
  'src/23-graph-file-store.js',
  'src/64-flow-orchestrator.js',
  'src/86-activity-schema-v1.js',
  'src/87-guided-learning-data.js',
  'src/88-guided-learning-store.js',
  'src/89-guided-learning-app.js',
  'src/90-guided-learning-node-app.js',
  'src/108-multi-question-learning-assets.js',
  'schemas/activity-schema-v1.json',
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

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function files(root, base = root) {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(root, entry.name)
      return entry.isDirectory() ? files(path, base) : [relative(base, path)]
    })
    .sort()
}

function hashTree(root) {
  const hash = createHash('sha256')
  for (const path of files(root)) {
    hash.update(path)
    hash.update(readFileSync(resolve(root, path)))
  }
  return hash.digest('hex')
}

function fixture({ omit, omitP45MigrationManifest = false } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'kg-new-legacy-sync-'))
  const upstream = resolve(root, 'new-legacy')
  const output = resolve(root, 'output')
  mkdirSync(upstream, { recursive: true })
  write(resolve(upstream, 'VERSION'), 'v8.6.0\n')
  for (const page of requiredPages) {
    if (page === omit) continue
    const authScript = page === 'index.html'
      ? '<script defer src="src/24-graph-file-autosave.js"></script><script defer src="src/30-auth-guards.js"></script><script defer src="src/60-question-bank.js"></script>'
      : page === 'question-training.html'
        ? '<script defer src="src/59-published-paper-repository.js"></script><script defer src="src/72-question-training-page.js"></script>'
        : page === 'question-workspace.html'
          ? '<script defer src="src/59-published-paper-repository.js"></script><script defer src="src/77-multi-question-workspace.js"></script>'
          : page === 'knowledge-recall.html'
            ? '<script defer src="src/59-published-paper-repository.js"></script><script defer src="src/96-recall-question-source.js"></script>'
          : ''
    write(resolve(upstream, page), `<!doctype html><html><head></head><body><script defer src="src/01-runtime-config.js"></script>${authScript}</body></html>`)
  }
  for (const path of requiredFiles) {
    if (path === omit) continue
    const content = path.endsWith('.json')
      ? '{"type":"object"}\n'
      : path === 'src/64-flow-orchestrator.js'
        ? `'use strict';\n(function(global){\n  let active=null;\n  let runtimeKey='';\n  function useSession(session,reason='restore'){\n    active=session;\n    try{global.dispatchEvent(new CustomEvent('kg:learning-session-changed',{detail:{reason,session:active}}))}catch(e){}\n    return active;\n  }\n  function persist(current,saved){\n    active=saved;\n    runtimeKey=makeRuntimeKey(saved);\n    return saved;\n  }\n})(window);\n`
        : `'use strict';\n`
    write(resolve(upstream, path), content)
  }
  if (!omitP45MigrationManifest) {
    write(resolve(upstream, 'p45-migration-manifest.json'), JSON.stringify({
      legacyUnmigratedIndexedDbModules: [
        'content-prep-studio/src/js/10-state-domain.js',
        'content-prep-studio/dist/content-prep.html',
      ],
    }))
  }
  return { root, upstream, output }
}

function runSync(item) {
  return spawnSync(process.execPath, [syncScript, '--source', item.upstream, '--out', item.output], {
    encoding: 'utf8',
  })
}

test('source manifest limits transitional IndexedDB debt to Prep Studio', () => {
  const manifest = JSON.parse(readFileSync(sourceMigrationManifest, 'utf8'))

  assert.deepEqual(manifest.legacyUnmigratedIndexedDbModules, [
    'content-prep-studio/src/js/10-state-domain.js',
    'content-prep-studio/dist/content-prep.html',
  ])
})

test('sync copies v8.6.0 and injects the direct runtime without editing upstream', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  const before = hashTree(item.upstream)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(hashTree(item.upstream), before)
  assert.equal(JSON.parse(readFileSync(resolve(item.output, 'manifest.json'), 'utf8')).version, 'v8.6.0')
  const page = readFileSync(resolve(item.output, 'learning-path.html'), 'utf8')
  assert.match(page, /server-state-bootstrap\.js/)
  assert.match(page, /direct-entry\.js\?v=v8\.6\.0/)
  assert.match(page, /<html[^>]*data-release="v8\.6\.0"/)
  assert.doesNotMatch(page, /new-legacy-navigation-bridge\.js/)
  assert.match(readFileSync(resolve(item.output, 'src/64-flow-orchestrator.js'), 'utf8'), /publishingSessionChange/)
  assert.match(readFileSync(resolve(item.output, 'src/64-flow-orchestrator.js'), 'utf8'), /if\(!saved\)return clone\(current\)/)
  const workspacePage = readFileSync(resolve(item.output, 'question-workspace.html'), 'utf8')
  assert.ok(
    workspacePage.indexOf('practice-learning-adapter.js') < workspacePage.indexOf('personal-card-adapter.js')
      && workspacePage.indexOf('personal-card-adapter.js') < workspacePage.indexOf('src/77-multi-question-workspace.js'),
    'workspace learning adapters must load before the page behavior',
  )
  assert.ok(existsSync(resolve(item.output, 'personal-card-adapter.js')))
})

test('sync fails closed when a required page is missing', (t) => {
  const item = fixture({ omit: 'learning-path.html' })
  t.after(() => rmSync(item.root, { recursive: true, force: true }))

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /learning-path\.html/)
})

test('sync requires a P4.5 migration manifest', (t) => {
  const item = fixture({ omitP45MigrationManifest: true })
  t.after(() => rmSync(item.root, { recursive: true, force: true }))

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /P4\.5 migration manifest is required/)
})

test('sync rejects an unregistered future business-storage key', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/23-graph-file-store.js'), "localStorage.setItem('kg_future_business_state_v1', '{}')\n")

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /kg_future_business_state_v1/)
  assert.match(result.stderr, /P4\.5 persistent state is not registered/)
})

test('sync reports the P4.5 contract diagnostic for an unregistered persistent key', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), "localStorage.setItem('kg_p45_unregistered_payload_v1', '{}')\n")

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /P4\.5 persistent state is not registered: kg_p45_unregistered_payload_v1/)
})

test('sync rejects IndexedDB persistence in every non-debt P4.5 module', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), "indexedDB.open('business-workspace')\n")
  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /IndexedDB business persistence is forbidden in migrated module: src\/p45-fixture\.js/)
})

test('sync rejects a manifest that self-declares an extra IndexedDB debt module before scanning source', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'p45-migration-manifest.json'), JSON.stringify({
    legacyUnmigratedIndexedDbModules: [
      'content-prep-studio/src/js/10-state-domain.js',
      'content-prep-studio/dist/content-prep.html',
      'src/p45-fixture.js',
    ],
  }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), "indexedDB.open('business-workspace')\n")

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /P4\.5 migration manifest is invalid/)
  assert.doesNotMatch(result.stderr, /IndexedDB business persistence is forbidden/)
})

test('sync rejects missing, duplicate, and additional P4.5 IndexedDB debt entries before scanning source', (t) => {
  const manifests = [
    ['content-prep-studio/src/js/10-state-domain.js'],
    [
      'content-prep-studio/src/js/10-state-domain.js',
      'content-prep-studio/dist/content-prep.html',
      'content-prep-studio/dist/content-prep.html',
    ],
    [
      'content-prep-studio/src/js/10-state-domain.js',
      'content-prep-studio/dist/content-prep.html',
      'src/another-fixture.js',
    ],
  ]

  for (const legacyUnmigratedIndexedDbModules of manifests) {
    const item = fixture()
    t.after(() => rmSync(item.root, { recursive: true, force: true }))
    write(resolve(item.upstream, 'p45-migration-manifest.json'), JSON.stringify({ legacyUnmigratedIndexedDbModules }))
    write(resolve(item.upstream, 'src/p45-fixture.js'), "indexedDB.open('business-workspace')\n")

    const result = runSync(item)

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /P4\.5 migration manifest is invalid/)
    assert.doesNotMatch(result.stderr, /IndexedDB business persistence is forbidden/)
  }
})

test('sync rejects optional IndexedDB open in an unlisted module', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), "indexedDB?.open('business-workspace')\n")

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /IndexedDB business persistence is forbidden in migrated module: src\/p45-fixture\.js/)
})

test('sync rejects obsolete migration and offline-export manifest fields before source scanning', (t) => {
  const manifests = [
    { migratedBusinessModules: {}, legacyUnmigratedIndexedDbModules: [] },
    { legacyUnmigratedIndexedDbModules: [], offlineExportOnly: true },
  ]

  for (const manifest of manifests) {
    const item = fixture()
    t.after(() => rmSync(item.root, { recursive: true, force: true }))
    write(resolve(item.upstream, 'p45-migration-manifest.json'), JSON.stringify(manifest))

    const result = runSync(item)

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /P4\.5 migration manifest is invalid/)
  }
})

test('sync rejects an obsolete manifest field before source storage violations', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'p45-migration-manifest.json'), JSON.stringify({
    legacyUnmigratedIndexedDbModules: [],
    offlineExportOnly: true,
  }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), "localStorage.setItem('kg_p45_unregistered_payload_v1', '{}')\n")

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /P4\.5 migration manifest is invalid/)
  assert.doesNotMatch(result.stderr, /P4\.5 persistent state is not registered/)
})

test('sync permits ordinary collection writes without IndexedDB', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), "const values = new Set(); values.add('value')\n")
  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
})

test('sync rejects split IndexedDB transaction and object-store writes in a non-debt module', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), [
    "const tx = db.transaction('workspace', 'readwrite')",
    "const store = tx.objectStore('workspace')",
    'store.put({ id: 1 })',
  ].join('\n'))
  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /IndexedDB business persistence is forbidden in migrated module: src\/p45-fixture\.js/)
})

test('sync rejects optional IndexedDB transaction and object-store writes in an unlisted module', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), [
    "const tx = db?.transaction('workspace', 'readwrite')",
    "const store = tx?.objectStore('workspace')",
    'store?.put({ id: 1 })',
  ].join('\n'))

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /IndexedDB business persistence is forbidden in migrated module: src\/p45-fixture\.js/)
})

test('sync rejects optional bracket IndexedDB persistence in an unlisted module', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), [
    "const db = indexedDB?.['open']('business-workspace')",
    "const tx = db?.['transaction']('workspace', 'readwrite')",
    "const store = tx?.['objectStore']('workspace')",
    "store?.['put']({ id: 1 })",
  ].join('\n'))

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /IndexedDB business persistence is forbidden in migrated module: src\/p45-fixture\.js/)
})

test('sync rejects split IndexedDB writes assigned after declaration in a migrated module', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), [
    'let tx',
    "tx = db.transaction('workspace', 'readwrite')",
    'let store',
    "store = tx.objectStore('workspace')",
    'store.put({ id: 1 })',
  ].join('\n'))
  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /IndexedDB business persistence is forbidden in migrated module: src\/p45-fixture\.js/)
})

test('sync permits P4.5 session-only navigation and preview tokens', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/p45-fixture.js'), "sessionStorage.setItem('kg_teacher_preview_123', 'token')\n")

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
})

test('sync permits deprecated question keys for reads but rejects new direct writes', (t) => {
  const readable = fixture()
  const writable = fixture()
  t.after(() => rmSync(readable.root, { recursive: true, force: true }))
  t.after(() => rmSync(writable.root, { recursive: true, force: true }))
  write(
    resolve(readable.upstream, 'src/23-graph-file-store.js'),
    "localStorage.getItem('kg_question_banks_published_v1')\n",
  )
  write(
    resolve(writable.upstream, 'src/23-graph-file-store.js'),
    "localStorage.setItem('kg_question_banks_published_v1', '[]')\n",
  )

  const readResult = runSync(readable)
  const writeResult = runSync(writable)

  assert.equal(readResult.status, 0, readResult.stderr)
  assert.notEqual(writeResult.status, 0)
  assert.match(writeResult.stderr, /只读旧键禁止新增写调用/)
})

test('sync is reproducible for the same source tree', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))

  assert.equal(runSync(item).status, 0)
  const first = hashTree(item.output)
  assert.equal(runSync(item).status, 0)
  assert.equal(hashTree(item.output), first)
})

test('sync preserves upstream javascript instead of parsing localStorage identifiers', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  const source = `'use strict';\nlocalStorage.setItem('kg_default_entry_mode_v1', 'free');\nconst escaped = value => value.replace(/[&<>'"]/g, '');\nlocalStorage.setItem('kg_question_language_mode_v1', 'zh');\n`
  write(resolve(item.upstream, 'src/65-question-bank-admin.js'), source)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(resolve(item.output, 'src/65-question-bank-admin.js'), 'utf8'), source)
})

test('sync adds the server flush when recall preview is already async', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/65-question-bank-admin.js'), `(function(){
  async function previewDeepRecall(){
    if(!await saveQuestionForm({silent:true})) return;
    const bank = currentBank();
    const q = currentQuestion();
    if(!bank || !q) return;
    try{
      JSON.stringify({question:q});
    }catch(e){}
    window.open('knowledge-recall.html?bankId=' + encodeURIComponent(bank.id||'') + '&questionId=' + encodeURIComponent(q.id || 'current'), '_blank');
  }
  function addQuestion(){
    state.activeSidebarTab = 'questions';
    state.activeLayoutNav = 'questions';
    bank.updatedAt = Date.now();
    saveBanks();
    render();
  }
})();
`)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  const generated = readFileSync(resolve(item.output, 'src/65-question-bank-admin.js'), 'utf8')
  const flush = generated.indexOf('await window.KGServerStateStorage.flush()')
  const open = generated.indexOf("window.open('knowledge-recall.html?bankId='")
  assert.ok(flush >= 0)
  assert.ok(flush < open)
})

test('sync accepts the server-catalog add-question flow without applying the legacy tab patch', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  const source = `(function(){
  async function previewDeepRecall(){
    try{
      if(window.KGServerStateStorage&&typeof window.KGServerStateStorage.flush==='function')await window.KGServerStateStorage.flush();
    }catch(error){return}
    window.open('knowledge-recall.html?bankId=' + encodeURIComponent(bank.id||'') + '&questionId=' + encodeURIComponent(q.id || 'current'), '_blank');
  }
  async function addQuestion(){
    const created=await Catalog.saveQuestion(q,{bankId:bank.id});
    state.activeLayoutNav='questions';
    toast('已创建题目并进入服务器题库。');
    return created;
  }
})();
`
  write(resolve(item.upstream, 'src/65-question-bank-admin.js'), source)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(resolve(item.output, 'src/65-question-bank-admin.js'), 'utf8'), source)
})

test('sync does not mistake an unrelated flush for a recall-preview flush', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/65-question-bank-admin.js'), `(function(){
  async   function previewDeepRecall () {
    const bank = currentBank();
    const q = currentQuestion();
    try{
      JSON.stringify(q);
    }catch(e){}
    window.open('knowledge-recall.html?bankId=' + encodeURIComponent(bank.id||'') + '&questionId=' + encodeURIComponent(q.id || 'current'), '_blank');
  }
  async function unrelatedSave(){
    if(window.KGServerStateStorage&&typeof window.KGServerStateStorage.flush==='function')await window.KGServerStateStorage.flush();
  }
  function addQuestion(){
    state.activeSidebarTab = 'questions';
    state.activeLayoutNav = 'questions';
    bank.updatedAt = Date.now();
    saveBanks();
    render();
  }
})();
`)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  const generated = readFileSync(resolve(item.output, 'src/65-question-bank-admin.js'), 'utf8')
  const preview = generated.indexOf('function previewDeepRecall')
  const open = generated.indexOf("window.open('knowledge-recall.html?bankId='", preview)
  const flush = generated.lastIndexOf('await window.KGServerStateStorage.flush()', open)
  assert.ok(flush > preview)
  assert.ok(flush < open)
})

test('sync does not mistake an unrelated catalog save for the catalog add-question flow', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/65-question-bank-admin.js'), `(function(){
  async function previewDeepRecall(){
    try{
      if(window.KGServerStateStorage&&typeof window.KGServerStateStorage.flush==='function')await window.KGServerStateStorage.flush();
    }catch(error){return}
    window.open('knowledge-recall.html?bankId=' + encodeURIComponent(bank.id||'') + '&questionId=' + encodeURIComponent(q.id || 'current'), '_blank');
  }
  function helper(){return Catalog.saveQuestion(draft)}
  function addQuestion(){
    state.activeSidebarTab = 'questions';
    state.activeLayoutNav = 'questions';
    bank.updatedAt = Date.now();
    saveBanks();
    render();
  }
})();
`)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  const generated = readFileSync(resolve(item.output, 'src/65-question-bank-admin.js'), 'utf8')
  assert.match(generated, /state\.activeMainTab = 'base';/)
  assert.match(generated, /state\.activeLayoutNav = 'base';/)
})

test('sync bounds recall preview before a following arrow-function flush', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/65-question-bank-admin.js'), `(function(){
  async function previewDeepRecall(){
    const bank = currentBank();
    const q = currentQuestion();
    const braces = \`literal } \${JSON.stringify({ nested: true })}\`;
    try{
      JSON.stringify({ q, braces });
    }catch(e){}
    window.open('knowledge-recall.html?bankId=' + encodeURIComponent(bank.id||'') + '&questionId=' + encodeURIComponent(q.id || 'current'), '_blank');
  }
  const unrelatedSave = async () => {
    if(window.KGServerStateStorage&&typeof window.KGServerStateStorage.flush==='function')await window.KGServerStateStorage.flush();
  };
  function addQuestion(){
    state.activeSidebarTab = 'questions';
    state.activeLayoutNav = 'questions';
    bank.updatedAt = Date.now();
    saveBanks();
    render();
  }
})();
`)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  const generated = readFileSync(resolve(item.output, 'src/65-question-bank-admin.js'), 'utf8')
  const preview = generated.indexOf('function previewDeepRecall')
  const open = generated.indexOf("window.open('knowledge-recall.html?bankId='", preview)
  const flush = generated.lastIndexOf('await window.KGServerStateStorage.flush()', open)
  assert.ok(flush > preview)
  assert.ok(flush < open)
})

test('sync bounds add-question before a following arrow-function catalog save', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/65-question-bank-admin.js'), `(function(){
  async function previewDeepRecall(){
    try{
      if(window.KGServerStateStorage&&typeof window.KGServerStateStorage.flush==='function')await window.KGServerStateStorage.flush();
    }catch(error){return}
    window.open('knowledge-recall.html?bankId=' + encodeURIComponent(bank.id||'') + '&questionId=' + encodeURIComponent(q.id || 'current'), '_blank');
  }
  function addQuestion(){
    const braces = \`literal } \${JSON.stringify({ nested: true })}\`;
    state.activeSidebarTab = 'questions';
    state.activeLayoutNav = 'questions';
    bank.updatedAt = Date.now();
    saveBanks();
    render();
  }
  const helper = () => Catalog.saveQuestion(draft);
})();
`)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  const generated = readFileSync(resolve(item.output, 'src/65-question-bank-admin.js'), 'utf8')
  assert.match(generated, /state\.activeMainTab = 'base';/)
  assert.match(generated, /state\.activeLayoutNav = 'base';/)
})

test('sync injects server storage before any upstream inline script', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'learning-path.html'), `<!doctype html><html><head><script>localStorage.getItem('kg_default_entry_mode_v1')</script></head><body><script defer src="src/01-runtime-config.js"></script></body></html>`)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  const generated = readFileSync(resolve(item.output, 'learning-path.html'), 'utf8')
  assert.ok(generated.indexOf('server-state-bootstrap.js') < generated.indexOf("localStorage.getItem('kg_default_entry_mode_v1')"))
})

test('sync limits the training overlay stylesheet to the training page', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(readFileSync(resolve(item.output, 'learning-path.html'), 'utf8'), /direct-runtime-fixes\.css/)
  assert.match(readFileSync(resolve(item.output, 'question-training.html'), 'utf8'), /direct-runtime-fixes\.css/)
})
