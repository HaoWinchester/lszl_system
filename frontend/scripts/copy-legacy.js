// 把 legacy 原版资源拷贝到 frontend/public/legacy/，并派生 workbench.html（注入 bridge.js）。
// 由 package.json 的 predev/prebuild 钩子调用。不改动 legacy/ 源文件。
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')            // 仓库根
const legacyDir = resolve(repoRoot, 'legacy')
const assetsDir = resolve(__dirname, 'legacy-assets')       // 我们的 bridge.js 源
const outDir = resolve(__dirname, '..', 'public', 'legacy') // Vite 静态输出

if (!existsSync(legacyDir)) {
  console.error('[copy-legacy] 找不到 legacy/ 目录：', legacyDir)
  process.exit(1)
}

// 1. 清空并重建目标目录
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// 2. 拷贝 legacy 资源：src/ + styles/
for (const sub of ['src', 'styles']) {
  cpSync(resolve(legacyDir, sub), resolve(outDir, sub), { recursive: true })
}

// 3. 拷贝顶层原版页面（index 供对比；其余供 legacy 内部跳转兜底）
const topHtml = [
  'index.html', 'file-manager.html', 'knowledge-recall.html',
  'question-bank.html', 'question-training.html', 'system-settings.html', 'user-management.html',
]
for (const f of topHtml) {
  const src = resolve(legacyDir, f)
  if (existsSync(src)) cpSync(src, resolve(outDir, f))
}

// 4. 拷贝我们的 bridge.js
if (!existsSync(resolve(assetsDir, 'bridge.js'))) {
  console.error('[copy-legacy] 找不到 scripts/legacy-assets/bridge.js')
  process.exit(1)
}
cpSync(resolve(assetsDir, 'bridge.js'), resolve(outDir, 'bridge.js'))

// 5. 从 index.html 派生 workbench.html：在 23-graph-file-store.js 之后注入 bridge.js
const indexHtml = readFileSync(resolve(legacyDir, 'index.html'), 'utf8')
const marker = '<script defer src="src/23-graph-file-store.js"></script>'
if (!indexHtml.includes(marker)) {
  console.error('[copy-legacy] index.html 中找不到注入锚点：', marker)
  process.exit(1)
}
const workbenchHtml = indexHtml.replace(
  marker,
  marker + '\n<script defer src="./bridge.js"></script><!-- kg-bridge（由 copy-legacy.js 注入，勿手改）-->',
)
writeFileSync(resolve(outDir, 'workbench.html'), workbenchHtml)

console.log('[copy-legacy] 已生成 public/legacy/（含 workbench.html + bridge.js）')
