import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repoDir = resolve(scriptsDir, '..', '..')
const read = (path) => readFileSync(resolve(repoDir, path), 'utf8')

test('P4.5.15 keeps the flow indicator visible in efficient mode and gives each mode a clear exit', () => {
  const graph = read('new-legacy/src/10-graph-editor.js')
  const interactionCss = read('new-legacy/styles/home-interaction-modes-p4330.css')
  const componentCss = read('new-legacy/styles/home-graph-components.css')

  assert.ok(graph.includes("mode==='related'?'只看相关':'心流状态'"))
  assert.ok(graph.includes("mode==='related'?'当前仅显示中心节点及其直接相关内容':'当前突出关联内容，弱化无关信息'"))
  assert.ok(graph.includes("mode==='related'?'退出只看相关':'退出心流'"))
  assert.doesNotMatch(interactionCss, /\[data-graph-interaction-mode="efficient"\]\s+\.graph-mode-indicator\{display:none!important\}/)
  assert.match(componentCss, /\.graph-mode-indicator\.related strong[\s\S]*?color:#fff/)
})
