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
