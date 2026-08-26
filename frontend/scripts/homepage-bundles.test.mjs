import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { buildHomepageBundles } from './homepage-bundles.mjs'

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'kg-homepage-bundles-'))
  write(resolve(root, 'index.html'), `<!doctype html><html><head>
    <script src="./prelude.js?v=old"></script>
    <link rel="stylesheet" href="styles/shell.css?v=old">
    <link rel="stylesheet" href="styles/graph.css?v=old">
    </head><body>
    <script defer src="src/a.js?v=old"></script>
    <script defer src="src/b.js?v=old"></script>
    <script defer src="src/graph.js?v=old"></script>
    </body></html>`)
  write(resolve(root, 'prelude.js'), 'window.order.push("prelude")')
  write(resolve(root, 'src/a.js'), 'window.order.push("a")')
  write(resolve(root, 'src/b.js'), 'window.order.push("b")')
  write(resolve(root, 'src/graph.js'), 'window.order.push("graph")')
  write(resolve(root, 'styles/shell.css'), '.shell { color: black; }')
  write(resolve(root, 'styles/graph.css'), '.graph { color: blue; }')
  const plan = {
    groups: [
      { name: 'home-prelude', initial: true, defer: false, scripts: ['prelude.js'], styles: [] },
      { name: 'home-shell', initial: true, defer: true, scripts: ['src/a.js', 'src/b.js'], styles: ['styles/shell.css'] },
      { name: 'home-graph', initial: false, defer: true, retainStyleArtifact: true, scripts: ['src/graph.js'], styles: ['styles/graph.css'] },
    ],
  }
  return { root, plan }
}

test('builder emits reproducible bundles that execute classic scripts in declared order', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))

  buildHomepageBundles({ outputRoot: item.root, version: 'v-test', plan: item.plan })
  const firstHtml = readFileSync(resolve(item.root, 'index.html'), 'utf8')
  const firstShell = readFileSync(resolve(item.root, 'bundles/home-shell.js'), 'utf8')
  buildHomepageBundles({ outputRoot: item.root, version: 'v-test', plan: item.plan })

  assert.equal(readFileSync(resolve(item.root, 'index.html'), 'utf8'), firstHtml)
  assert.equal(readFileSync(resolve(item.root, 'bundles/home-shell.js'), 'utf8'), firstShell)
  assert.doesNotMatch(firstHtml, /src\/a\.js|src\/b\.js|src\/graph\.js|styles\/shell\.css|styles\/graph\.css/)
  assert.match(firstHtml, /bundles\/home-prelude\.js\?v=v-test/)
  assert.match(firstHtml, /<script defer src="bundles\/home-shell\.js\?v=v-test"><\/script>/)
  assert.match(firstHtml, /bundles\/home-shell\.css\?v=v-test/)
  assert.match(firstHtml, /<meta name="kg-homepage-bundle-version" content="v-test">/)
  assert.doesNotMatch(firstHtml, /bundles\/home-graph\.(?:js|css)/)
  assert.match(readFileSync(resolve(item.root, 'bundles/home-graph.css'), 'utf8'), /\.graph/)

  const context = vm.createContext({ window: { order: [] } })
  context.document = {
    head: {
      appendChild(script) { vm.runInContext(script.textContent, context) },
    },
    createElement() {
      return { dataset: {}, textContent: '', remove() {} }
    },
  }
  vm.runInContext(readFileSync(resolve(item.root, 'bundles/home-prelude.js'), 'utf8'), context)
  vm.runInContext(firstShell, context)
  vm.runInContext(readFileSync(resolve(item.root, 'bundles/home-graph.js'), 'utf8'), context)
  assert.deepEqual(context.window.order, ['prelude', 'a', 'b', 'graph'])
})

test('builder rejects missing, duplicate, and ungrouped homepage assets', (t) => {
  const missing = fixture()
  const duplicate = fixture()
  const ungrouped = fixture()
  t.after(() => {
    for (const item of [missing, duplicate, ungrouped]) rmSync(item.root, { recursive: true, force: true })
  })

  missing.plan.groups[1].scripts.push('src/missing.js')
  assert.throws(
    () => buildHomepageBundles({ outputRoot: missing.root, version: 'v-test', plan: missing.plan }),
    /src\/missing\.js/,
  )

  duplicate.plan.groups[2].scripts.push('src/a.js')
  assert.throws(
    () => buildHomepageBundles({ outputRoot: duplicate.root, version: 'v-test', plan: duplicate.plan }),
    /duplicate.*src\/a\.js/i,
  )

  ungrouped.plan.groups[2].scripts = []
  assert.throws(
    () => buildHomepageBundles({ outputRoot: ungrouped.root, version: 'v-test', plan: ungrouped.plan }),
    /ungrouped.*src\/graph\.js/i,
  )
})
