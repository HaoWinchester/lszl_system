import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const contract = JSON.parse(readFileSync(resolve(scriptsDir, 'new-legacy-contract.json'), 'utf8'))

function parseArgs(argv) {
  const args = { source: resolve(repoDir, 'new-legacy'), out: resolve(frontendDir, 'public', 'new-legacy') }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--source' || token === '--out') {
      const value = argv[index + 1]
      if (!value) throw new Error(`${token} 缺少目录参数`)
      args[token.slice(2)] = resolve(value)
      index += 1
    } else {
      throw new Error(`未知参数：${token}`)
    }
  }
  return args
}

function walk(root, base = root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(root, entry.name)
      return entry.isDirectory() ? walk(path, base) : [relative(base, path)]
    })
    .sort()
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function sourceFiles(source) {
  return Object.fromEntries(walk(source).map((path) => [path, hashFile(resolve(source, path))]))
}

function rewriteStorageIdentifiers(source) {
  let output = ''
  let index = 0
  const length = source.length
  const isWord = (value) => /[A-Za-z0-9_$]/.test(value || '')
  while (index < length) {
    const char = source[index]
    const next = source[index + 1]
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      output += char
      index += 1
      while (index < length) {
        const current = source[index]
        output += current
        index += 1
        if (current === '\\' && index < length) {
          output += source[index]
          index += 1
        } else if (current === quote) {
          break
        }
      }
      continue
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      if (end < 0) return output + source.slice(index)
      output += source.slice(index, end + 1)
      index = end + 1
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      if (end < 0) return output + source.slice(index)
      output += source.slice(index, end + 2)
      index = end + 2
      continue
    }
    const qualified = ['window.localStorage', 'globalThis.localStorage'].find((token) => source.startsWith(token, index))
    if (qualified) {
      output += 'window.KGServerStateStorage'
      index += qualified.length
      continue
    }
    const token = 'localStorage'
    if (source.startsWith(token, index) && !isWord(source[index - 1]) && !isWord(source[index + token.length])) {
      output += 'window.KGServerStateStorage'
      index += token.length
      continue
    }
    output += char
    index += 1
  }
  return output
}

function rewriteInlineScripts(html) {
  return html.replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi, (match, attributes, body) =>
    `<script${attributes}>${rewriteStorageIdentifiers(body)}</script>`)
}

function patchTrainingSessionReentrancy(source) {
  const declaration = "  let active=null;\n  let runtimeKey='';"
  if (!source.includes(declaration)) {
    throw new Error('new-legacy 训练会话协调器结构已变化，请复核 src/64-flow-orchestrator.js 的重入补丁')
  }
  const eventCandidates = [
    "    try{global.dispatchEvent(new CustomEvent('kg:learning-session-changed',{detail:{reason,session:clone(active)}}))}catch(e){}",
    "    try{global.dispatchEvent(new CustomEvent('kg:learning-session-changed',{detail:{reason,session:active}}))}catch(e){}",
  ]
  const event = eventCandidates.find((candidate) => source.includes(candidate))
  if (!event) {
    throw new Error('new-legacy 训练会话事件结构已变化，请复核 src/64-flow-orchestrator.js 的重入补丁')
  }
  const persistAssignment = '    active=saved;\n    runtimeKey=makeRuntimeKey(saved);'
  if (!source.includes(persistAssignment)) {
    throw new Error('new-legacy 训练会话持久化结构已变化，请复核 src/64-flow-orchestrator.js 的空结果保护')
  }
  return source
    .replace(declaration, `${declaration}\n  let publishingSessionChange=false;`)
    .replace(event, [
      '    if(!publishingSessionChange){',
      '      publishingSessionChange=true;',
      `      try{${event.trim()}}finally{publishingSessionChange=false}`,
      '    }',
    ].join('\n'))
    .replace(persistAssignment, `    if(!saved)return clone(current);\n${persistAssignment}`)
}

function injectPage(html) {
  const injection = [
    '<script src="./server-state-bootstrap.js"></script><!-- kg-state:generated -->',
    '<script src="./runtime-config.override.js"></script><!-- kg-runtime:generated -->',
    '<script defer src="./new-legacy-navigation-bridge.js"></script><!-- kg-navigation:generated -->',
  ].join('\n')
  if (html.includes('kg-runtime:generated')) return html
  if (html.includes('</head>')) return html.replace('</head>', `${injection}\n</head>`)
  return `${injection}\n${html}`
}

function injectGuidedLearningDataBridge(html) {
  const marker = '<script defer src="src/87-guided-learning-data.js"></script>'
  const bridge = '<script defer src="./guided-learning-data-bridge.js"></script><!-- kg-guided-data:generated -->'
  if (html.includes('kg-guided-data:generated') || !html.includes(marker)) return html
  return html.replace(marker, `${marker}\n${bridge}`)
}

function diffFiles(previous = {}, next = {}) {
  const added = Object.keys(next).filter((path) => !(path in previous)).sort()
  const removed = Object.keys(previous).filter((path) => !(path in next)).sort()
  const changed = Object.keys(next).filter((path) => path in previous && previous[path] !== next[path]).sort()
  return { added, changed, removed }
}

function validate(source) {
  if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error(`找不到 new-legacy 目录：${source}`)
  const required = ['VERSION', ...contract.requiredPages, ...contract.requiredFiles]
  const missing = required.filter((path) => !existsSync(resolve(source, path)))
  if (missing.length) throw new Error(`new-legacy 缺少必需文件：${missing.join(', ')}`)
  const version = readFileSync(resolve(source, 'VERSION'), 'utf8').trim()
  if (!version) throw new Error('new-legacy/VERSION 不能为空')
  return version
}

function sync({ source, out }) {
  const version = validate(source)
  const hashes = sourceFiles(source)
  const defaultOut = resolve(frontendDir, 'public', 'new-legacy')
  const rootManifestPath = resolve(frontendDir, 'new-legacy-manifest.json')
  const previous = existsSync(rootManifestPath)
    ? JSON.parse(readFileSync(rootManifestPath, 'utf8'))
    : null

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  cpSync(source, out, { recursive: true })

  const bridgeDir = resolve(scriptsDir, 'new-legacy-assets')
  for (const asset of walk(bridgeDir)) cpSync(resolve(bridgeDir, asset), resolve(out, asset))
  const graphBridge = resolve(scriptsDir, 'legacy-assets', 'bridge.js')
  if (existsSync(graphBridge)) cpSync(graphBridge, resolve(out, 'graph-bridge.js'))

  for (const path of walk(resolve(out, 'src')).filter((item) => item.endsWith('.js'))) {
    const target = resolve(out, 'src', path)
    let generated = rewriteStorageIdentifiers(readFileSync(target, 'utf8'))
    if (path === '64-flow-orchestrator.js') generated = patchTrainingSessionReentrancy(generated)
    writeFileSync(target, generated)
  }

  for (const page of walk(out).filter((path) => !path.includes('/') && path.endsWith('.html'))) {
    const path = resolve(out, page)
    writeFileSync(path, injectGuidedLearningDataBridge(injectPage(rewriteInlineScripts(readFileSync(path, 'utf8')))))
  }

  const indexPath = resolve(out, 'index.html')
  let workbench = readFileSync(indexPath, 'utf8')
  const marker = '<script defer src="src/23-graph-file-store.js"></script>'
  if (workbench.includes(marker) && existsSync(graphBridge)) {
    workbench = workbench.replace(marker, `${marker}\n<script defer src="./graph-bridge.js"></script><!-- kg-graph:generated -->`)
  }
  writeFileSync(resolve(out, 'workbench.html'), workbench)

  const manifest = {
    schemaVersion: 1,
    version,
    bridgeVersion: 2,
    sourceFiles: hashes,
  }
  writeFileSync(resolve(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  if (out === defaultOut) {
    const changes = diffFiles(previous?.sourceFiles, hashes)
    const report = {
      schemaVersion: 1,
      fromVersion: previous?.version || null,
      toVersion: version,
      changes,
      incompatible: [],
    }
    writeFileSync(rootManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(resolve(frontendDir, 'new-legacy-sync-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
  return manifest
}

try {
  const args = parseArgs(process.argv.slice(2))
  const manifest = sync(args)
  process.stdout.write(`[sync:new-legacy] ${manifest.version} -> ${args.out}\n`)
} catch (error) {
  process.stderr.write(`[sync:new-legacy] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
