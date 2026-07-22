import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const frontend = resolve(import.meta.dirname, '..')
const repo = resolve(frontend, '..')
const source = (path) => readFileSync(resolve(repo, path), 'utf8')

test('global shortcuts default to a compact, non-obstructive launcher outside the graph', () => {
  const shortcuts = source('new-legacy/src/39-global-shortcuts.js')
  const styles = source('new-legacy/styles/global-shortcuts.css')

  assert.match(shortcuts, /function shouldStartCollapsed\(\)/)
  assert.match(shortcuts, /currentPage\(\) !== ['"]index\.html['"]/)
  assert.match(shortcuts, /setCollapsed\(el,shouldStartCollapsed\(\)\)/)
  assert.match(styles, /\.kg-global-shortcuts\.is-collapsed/)
})

test('mobile file manager offers clear exits and user-center keeps submit controls visible', () => {
  const manager = source('new-legacy/file-manager.html')
  const center = source('new-legacy/src/33-user-center.js')
  const centerStyles = source('new-legacy/styles/user-center.css')

  assert.match(manager, /class="fm-mobile-readonly-actions"/)
  assert.match(manager, /返回首页/)
  assert.match(manager, /学习路径/)
  assert.match(center, /class="kg-user-center-footer"/)
  assert.match(centerStyles, /\.kg-user-center-footer/)
})

test('narrow learning headers preserve readable, single-line navigation', () => {
  const training = source('new-legacy/styles/question-training.css')
  const workspace = source('new-legacy/styles/question-workspace.css')

  assert.match(training, /\.qt-brand h1\{white-space:nowrap/)
  assert.match(training, /\.qt-actions \.qt-workspace-entry,\.qt-actions \.qt-question-nav,\.qt-actions \.auth-status\{display:none!important\}/)
  assert.match(workspace, /@media\(max-width:780px\)\{[\s\S]*?\.qw-top-actions\{min-width:0;max-width:48vw;overflow-x:auto/)
  assert.match(workspace, /@media\(min-width:781px\) and \(max-width:1100px\)\{[\s\S]*?\.qw-top-actions>\*\{flex:0 0 auto;white-space:nowrap\}/)
  assert.match(workspace, /\.qw-question-drawer>header>div\{min-width:0;flex:1\}/)
  assert.match(workspace, /\.qw-question-drawer>header button\{flex:0 0 42px;/)
})

test('status labels avoid duplicate role text and keyword punctuation stays attached', () => {
  const roles = source('new-legacy/src/34-role-permissions.js')
  const learningData = source('new-legacy/src/87-guided-learning-data.js')
  const learningStyles = source('new-legacy/styles/guided-learning-node.css')

  assert.match(roles, /const showRoleBadge=roleLabel\(role\)!==label/)
  assert.match(learningData, /\{text:'两周迭代，',target:true\}/)
  assert.match(learningStyles, /\.gln-activity\.gln-keyword-activity\{min-height:300px\}/)
})
