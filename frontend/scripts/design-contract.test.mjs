import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const readFrontend = (path) => readFileSync(resolve(frontendDir, path), 'utf8')
const readRepo = (path) => readFileSync(resolve(repoDir, path), 'utf8')

test('global workspace design assets are wired into the app and derived workbench', () => {
  const tokenPath = resolve(frontendDir, 'src/styles/design-system.css')
  const workbenchThemePath = resolve(scriptsDir, 'legacy-assets/boardmix-theme.css')

  assert.ok(existsSync(tokenPath), 'expected the shared design-system stylesheet')
  assert.ok(existsSync(workbenchThemePath), 'expected the derived workbench theme stylesheet')
  assert.match(readFrontend('src/main.tsx'), /import '\.\/styles\/design-system\.css'/)
  assert.match(readFrontend('scripts/copy-legacy.js'), /boardmix-theme\.css/)
  assert.match(readFrontend('scripts/legacy-assets/boardmix-theme.css'), /--kg-canvas/)
  assert.doesNotMatch(readRepo('legacy/index.html'), /boardmix-theme\.css/)
})

test('file browser consumes the shared workspace surface tokens', () => {
  const css = readFrontend('src/styles/file-manager.css')

  assert.match(css, /--fm-bg:\s*var\(--kg-canvas\)/)
  assert.match(css, /--fm-surface:\s*var\(--kg-surface\)/)
  assert.match(css, /--fm-border:\s*var\(--kg-border\)/)
  assert.match(css, /--fm-accent:\s*var\(--kg-primary\)/)
  assert.match(css, /--fm-radius:\s*var\(--kg-radius-panel\)/)
})

test('all route families receive the BoardMix workspace override layer', () => {
  const overridePath = resolve(frontendDir, 'src/styles/boardmix-overrides.css')
  assert.ok(existsSync(overridePath), 'expected the cross-route workspace override stylesheet')

  const css = readFrontend('src/styles/boardmix-overrides.css')
  for (const selector of ['.auth-backdrop', '.qb-app', '.question-training-app', '.kr-app', '.um-app', '.ss-app']) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')))
  }
  assert.match(readFrontend('src/main.tsx'), /import '\.\/styles\/boardmix-overrides\.css'/)
  assert.match(css, /var\(--kg-canvas\)/)
  assert.match(css, /var\(--kg-radius-panel\)/)
})

test('workspace overrides normalize the remaining tool, tab and admin-card outliers', () => {
  const css = readFrontend('src/styles/boardmix-overrides.css')
  for (const selector of [
    '.qb-layout-nav button.active',
    '#questionModal .question-font-tools button.active',
    '.um-stat',
    '.kg-subscription-card-cta',
    '.kg-global-shortcuts-link',
  ]) {
    assert.match(css, new RegExp(selector.replaceAll('.', '\\.')))
  }
  const legacyTheme = readFrontend('scripts/legacy-assets/boardmix-theme.css')
  assert.match(legacyTheme, /\.floating-tool-btn/)
  assert.match(legacyTheme, /\.upgrade-member-btn/)
  assert.match(legacyTheme, /\.kg-global-shortcuts-link/)
})

test('shared AppIcon exposes the approved Lucide semantic icon contract', () => {
  const iconPath = resolve(frontendDir, 'src/components/AppIcon.tsx')
  assert.ok(existsSync(iconPath), 'expected the shared AppIcon component')

  const component = readFrontend('src/components/AppIcon.tsx')
  assert.match(component, /from 'lucide-react'/)
  assert.match(component, /satisfies Record<string, LucideIcon>/)
  for (const name of [
    'add', 'back', 'search', 'settings', 'refresh', 'grid', 'list', 'more',
    'delete', 'upload', 'download', 'folder', 'user', 'logout', 'close',
    'zoomIn', 'zoomOut', 'check', 'chevronDown', 'collapse', 'expand',
    'recent', 'favorite', 'folderAdd', 'sun', 'moon', 'home', 'userAdd', 'network',
  ]) {
    assert.match(component, new RegExp(`\\b${name}:`), `expected AppIcon mapping for ${name}`)
  }

  const css = readFrontend('src/styles/design-system.css')
  for (const token of ['--kg-icon-compact', '--kg-icon-default', '--kg-icon-prominent']) {
    assert.match(css, new RegExp(token), `expected shared icon token ${token}`)
  }
  assert.match(css, /\.kg-icon\s*\{[\s\S]*display:\s*block/)
  assert.match(css, /\.kg-icon-button\s*\{[\s\S]*display:\s*inline-flex/)
  assert.match(css, /\.kg-icon-button\s*\{[\s\S]*align-items:\s*center/)
  assert.match(css, /\.kg-icon-button\s*\{[\s\S]*justify-content:\s*center/)
  assert.match(css, /\.kg-icon-button\s*\{[\s\S]*line-height:\s*0/)
  assert.match(css, /\.kg-icon\s*\{[\s\S]*flex:\s*0 0 auto/)
})

test('AppIcon exposes accessible semantics and consumes shared size tokens', () => {
  const component = readFrontend('src/components/AppIcon.tsx')
  assert.match(component, /export type AppIconSize = 'compact' \| 'default' \| 'prominent'/)
  assert.match(component, /size = 'default'/)
  assert.match(component, /`kg-icon--\$\{size\}`/)
  assert.match(component, /role=\{label \? 'img' : undefined\}/)
  assert.match(component, /aria-hidden=\{label \? undefined : true\}/)
  assert.doesNotMatch(component, /size=\{size\}/)

  const css = readFrontend('src/styles/design-system.css')
  for (const size of ['compact', 'default', 'prominent']) {
    assert.match(css, new RegExp(`\\.kg-icon--${size}\\s*\\{[\\s\\S]*width:\\s*var\\(--kg-icon-${size}\\)`))
    assert.match(css, new RegExp(`\\.kg-icon--${size}\\s*\\{[\\s\\S]*height:\\s*var\\(--kg-icon-${size}\\)`))
  }
})

test('study workspaces use AppIcon controls and reserve SVG for recall relationship content', () => {
  const questionBank = readFrontend('src/routes/QuestionBank.tsx')
  const training = readFrontend('src/routes/Training.tsx')
  const recall = readFrontend('src/routes/Recall.tsx')

  for (const [name, source] of [
    ['QuestionBank', questionBank],
    ['Training', training],
    ['Recall', recall],
  ]) {
    assert.match(source, /import \{ AppIcon \} from '\.\.\/components\/AppIcon'/, `${name} should consume AppIcon`)
    assert.doesNotMatch(source, /from 'lucide-react'/, `${name} should not directly import Lucide icons`)
  }

  assert.doesNotMatch(questionBank, /<svg\b/, 'QuestionBank should not render inline SVG controls')
  assert.doesNotMatch(training, /<svg\b/, 'Training should not render inline SVG controls')
  assert.match(recall, /<svg className="kr-edges" id="krEdges" aria-hidden="true">/, 'Recall keeps its relationship-line SVG as content')
  assert.equal((recall.match(/<svg\b/g) || []).length, 1, 'Recall should only retain the relationship-line SVG')
})

test('QuestionBank exposes accessible names for pure-icon delete controls', () => {
  const questionBank = readFrontend('src/routes/QuestionBank.tsx')

  assert.match(questionBank, /<button[^>]*aria-label="删除选项"[^>]*>[\s\S]{0,120}<AppIcon name="close"/, 'option deletion needs an accessible name')
  assert.match(questionBank, /<button[^>]*aria-label="删除关键词"[^>]*>[\s\S]{0,120}<AppIcon name="close"/, 'keyword deletion needs an accessible name')
})

test('file manager uses AppIcon for controls while FileCover remains the only inline SVG artwork', () => {
  const route = readFrontend('src/routes/Files.tsx')

  assert.match(route, /import \{ AppIcon \} from '\.\.\/components\/AppIcon'/)
  assert.doesNotMatch(route, /from 'lucide-react'/)
  assert.equal((route.match(/<svg\b/g) || []).length, 1, 'FileCover should be the only inline SVG artwork')
  assert.doesNotMatch(route, /<button[^>]*>[\s\S]{0,220}<svg\b/, 'action buttons must not contain hand-written SVGs')
})
