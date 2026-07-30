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

test('user center uses the supplied profile-dialog structure while retaining project fields', () => {
  const center = source('new-legacy/src/33-user-center.js')
  const centerStyles = source('new-legacy/styles/user-center.css')

  for (const anchor of ['uc-dialog', 'uc-form-grid', 'uc-binding-card', 'uc-membership-card', 'uc-password-card', 'ucNoteCount']) {
    assert.match(center, new RegExp(anchor))
  }
  assert.match(centerStyles, /\.kg-user-center-modal\.uc-dialog/)
  assert.match(centerStyles, /\.uc-membership-card/)
  assert.match(centerStyles, /width:min\(740px,calc\(100vw - 48px\)\)/)
  assert.match(centerStyles, /\.uc-dialog \.uc-header h2\{font-size:26px\}/)
  assert.match(center, /class="icon-button dialog-close"[^>]*><span class="modal-close-icon"/)
  assert.match(center, /class="uc-close dialog-close"[^>]*><span class="modal-close-icon"/)
  assert.match(centerStyles, /\.dialog-close \.modal-close-icon\{[^}]*background-image:url/)
  assert.match(centerStyles, /\.uc-dialog \.uc-close\{\/\* display:grid; \*\//)
  const membershipStyles = source('new-legacy/styles/membership-ui.css')
  assert.match(membershipStyles, /\.membership-ui\{[^}]*width:min\(920px,calc\(100vw - 44px\)\)/)
  assert.match(membershipStyles, /\.membership-ui \.plan-title\{[^}]*font-size:20px/)
  assert.match(membershipStyles, /\.membership-ui \.modal-header\{[^}]*align-items:center/)
  assert.match(membershipStyles, /\.membership-ui \.icon-button\{\/\* display:grid; \*\//)
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

test('standalone learning headers use one account menu instead of a detached logout button', () => {
  for (const page of ['learning-path.html', 'question-training.html', 'question-workspace.html']) {
    const markup = source(`new-legacy/${page}`)

    assert.match(markup, /class="account-menu-shell(?:\s|\")/)
    assert.match(markup, /data-account-menu-trigger="true"/)
    assert.match(markup, /class="account-hidden-trigger" hidden id="authLogoutBtn"/)
    assert.doesNotMatch(markup, /class="auth-logout-btn" id="authLogoutBtn"[^>]*style="display:none"/)
  }
})

test('shared controls center their own content and document the only start-aligned exceptions', () => {
  const main = source('new-legacy/styles/main.css')
  const account = source('new-legacy/styles/account-menu.css')
  const learning = source('new-legacy/styles/guided-learning-path.css')
  const audit = source('frontend/e2e/ui_geometry_audit.py')

  assert.match(main, /\.floating-subtool-btn\{[\s\S]*?justify-content:center;[\s\S]*?text-align:center;/)
  assert.match(account, /\.account-menu-trigger\{[\s\S]*?justify-content:center;[\s\S]*?text-align:center;/)
  assert.match(learning, /\.gl-stage-path-tools button\{display:grid;place-items:center/)
  assert.doesNotMatch(learning, /writing-mode:vertical-rl/)
  assert.match(audit, /\[data-geometry-align='start'\]/)
  assert.match(audit, /\.qt-teacher-menu-panel \.qt-nav-btn/)
})

test('knowledge-detail action disclosure uses one centered chevron icon in both states', () => {
  const editor = source('new-legacy/src/10-graph-editor.js')
  const styles = source('new-legacy/styles/main.css')

  assert.match(editor, /class="detail-actions-toggle detail-panel-control"[^>]*><span class="detail-actions-chevron"/)
  assert.match(editor, /class="close-detail detail-panel-control"[^>]*><span class="detail-close-icon"/)
  assert.match(editor, /toggle\.classList\.toggle\('is-expanded',expanded\)/)
  assert.doesNotMatch(editor, /toggle\.textContent=expanded\?'⌃':'⌄'/)
  assert.match(styles, /\.detail-panel-control\{[\s\S]*?display:grid;[\s\S]*?place-items:center;[\s\S]*?background:#f3f4f6;[\s\S]*?color:#64748b;/)
  assert.match(styles, /\.detail-panel-control svg\{[\s\S]*?stroke-width:2\.4;/)
  assert.match(styles, /\.detail-actions-chevron\{[\s\S]*?transform:rotate\(0deg\)/)
  assert.match(styles, /\.detail-actions-toggle\.is-expanded \.detail-actions-chevron\{transform:rotate\(180deg\)/)
})
