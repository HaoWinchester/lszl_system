import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const frontend = resolve(import.meta.dirname, '..')
const repo = resolve(frontend, '..')
const readFrontend = (path) => readFileSync(resolve(frontend, path), 'utf8')
const readRepo = (path) => readFileSync(resolve(repo, path), 'utf8')
const publicRelease = JSON.parse(readFrontend('public/new-legacy/manifest.json')).version

test('generated pages use the exact upstream UI with only direct runtime adapters', () => {
  for (const page of [
    'index.html',
    'learning-path.html',
    'question-training.html',
    'question-workspace.html',
    'guided-learning-node.html',
    'guided-learning-placement-test.html',
    'file-manager.html',
    'question-bank.html',
    'knowledge-recall.html',
    'user-management.html',
    'system-settings.html',
    'workbench.html',
  ]) {
    const upstreamPage = page === 'workbench.html' ? 'index.html' : page
    // 发布候选在自动验收时会先与线上当前版本并存；这里校验
    // public 实际携带的版本，不能把未同步的候选源当成静态包的上游。
    const upstream = readFrontend(`new-legacy-releases/${publicRelease}/source/${upstreamPage}`)
    const generated = readFrontend(`public/new-legacy/${page}`)
    assert.match(generated, /server-state-bootstrap\.js/)
    assert.match(generated, /direct-entry\.js/)
    assert.doesNotMatch(generated, /new-legacy-navigation-bridge|graph-bridge|guided-learning-data-bridge|<iframe/)
    for (const stylesheet of upstream.matchAll(/<link[^>]+href="([^"]+\.css)"/g)) {
      assert.match(generated, new RegExp(stylesheet[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  }
})

test('the active frontend package has one direct runtime and no React host', () => {
  const packageJson = JSON.parse(readFrontend('package.json'))
  assert.deepEqual(packageJson.dependencies, {})
  assert.doesNotMatch(JSON.stringify(packageJson), /react-router|vite|zustand/)
  assert.match(readFrontend('scripts/new-legacy-assets/server-state-bootstrap.js'), /__KG_DIRECT_BOOTSTRAP__/)
  assert.doesNotMatch(readFrontend('scripts/new-legacy-assets/server-state-bootstrap.js'), /postMessage|frameToken/)
})

test('FastAPI owns the stable direct-page aliases', () => {
  const routes = readRepo('backend/app/web/routes.py')
  for (const alias of ['/', '/graph', '/training', '/workspace', '/files', '/question-bank', '/recall', '/users', '/settings']) {
    assert.match(routes, new RegExp(`['"]${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`))
  }
})
