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
