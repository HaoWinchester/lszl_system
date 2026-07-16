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

test('admin and membership routes use AppIcon only where an operation has a clear icon meaning', () => {
  const users = readFrontend('src/routes/Users.tsx')
  const settings = readFrontend('src/routes/Settings.tsx')
  const member = readFrontend('src/routes/Member.tsx')
  const login = readFrontend('src/routes/Login.tsx')

  for (const [name, source] of [
    ['Users', users],
    ['Settings', settings],
    ['Member', member],
  ]) {
    assert.match(source, /import \{ AppIcon \} from '\.\.\/components\/AppIcon'/, `${name} should consume AppIcon`)
    assert.doesNotMatch(source, /from 'lucide-react'/, `${name} should not directly import Lucide icons`)
  }

  assert.doesNotMatch(login, /from 'lucide-react'/, 'Login must not bypass the shared icon entry point')
  assert.doesNotMatch(login, /components\/AppIcon/, 'Login has no icon-only operation and should avoid a decorative import')
})

test('workspace overrides keep the professional admin treatment free of gradients', () => {
  const css = readFrontend('src/styles/boardmix-overrides.css')
  assert.doesNotMatch(css, /linear-gradient/i, 'shared workspace overrides must not reintroduce decorative gradients')
})

test('admin and member surfaces share compact professional workspace geometry', () => {
  const css = readFrontend('src/styles/boardmix-overrides.css')
  for (const selector of ['.um-right-shell', '.ss-sidebar', '.kg-subscription-detail-body', '.kg-user-center-modal']) {
    assert.match(css, new RegExp(selector.replaceAll('.', '\\.')), `expected ${selector} to receive the shared workspace treatment`)
  }
})

test('admin route canvases explicitly replace the legacy gradient page background', () => {
  const css = readFrontend('src/styles/boardmix-overrides.css')
  assert.match(css, /body:has\(\.um-app\),\s*body:has\(\.ss-app\)\s*\{[\s\S]*background:\s*var\(--kg-canvas\) !important/)
})

test('member plan cards wrap into the modal instead of relying on a clipped horizontal rail', () => {
  const css = readFrontend('src/styles/boardmix-overrides.css')
  assert.match(css, /\.kg-subscription-detail-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit, minmax\(210px, 1fr\)\) !important/)
  assert.match(css, /\.kg-subscription-detail-grid\s*\{[\s\S]*overflow:\s*visible !important/)
})

test('member plan cards are content articles with one real CTA button', () => {
  const member = readFrontend('src/routes/Member.tsx')
  const css = readFrontend('src/styles/boardmix-overrides.css')

  assert.match(member, /<article[\s\S]{0,360}className=\{`subscription-plan-card kg-subscription-purchase-card/)
  assert.doesNotMatch(member, /<article[\s\S]{0,500}role="button"/, 'the plan article must not masquerade as a button')
  assert.doesNotMatch(member, /<article[\s\S]{0,500}tabIndex=\{0\}/, 'the plan article must not enter the tab order without an action')
  assert.match(member, /<button\s+className="kg-subscription-card-cta um-action-with-icon"/, 'the CTA remains the actionable control')
  assert.match(css, /\.kg-subscription-card-cta\s*\{[\s\S]*pointer-events:\s*auto !important/, 'the shared override must restore CTA pointer interaction')
})

test('member plan articles do not retain the legacy clickable-card motion cue', () => {
  const css = readFrontend('src/styles/boardmix-overrides.css')
  assert.match(css, /\.kg-subscription-purchase-card\s*\{[\s\S]*cursor:\s*default !important/)
  assert.match(css, /\.kg-subscription-purchase-card:hover\s*\{[\s\S]*transform:\s*none !important/)
})

test('AppIcon is the only direct Lucide entry point and create actions do not use plus glyphs', () => {
  const sourceFiles = [
    'src/components/Placeholder.tsx',
    'src/routes/Files.tsx',
    'src/routes/QuestionBank.tsx',
    'src/routes/Training.tsx',
    'src/routes/Recall.tsx',
    'src/routes/Users.tsx',
    'src/routes/Settings.tsx',
    'src/routes/Member.tsx',
    'src/routes/Login.tsx',
  ]
  for (const path of sourceFiles) {
    assert.doesNotMatch(readFrontend(path), /from ['"]lucide-react['"]/, `${path} must consume AppIcon`)
  }
  assert.match(readFrontend('src/components/Placeholder.tsx'), /components\/AppIcon|\.\/AppIcon/)
  const questionBank = readFrontend('src/routes/QuestionBank.tsx')
  assert.doesNotMatch(questionBank, />\s*\+\s*(新题库|新题|新试卷)/)
  assert.match(questionBank, /className="kg-button-with-icon"/)
  assert.match(readFrontend('src/styles/design-system.css'), /\.kg-button-with-icon\s*\{[\s\S]*display:\s*inline-flex/)
})

test('shared workspace tokens meet the approved contrast and touch contracts', () => {
  const css = readFrontend('src/styles/design-system.css')

  assert.match(css, /--kg-muted:\s*#626d78;/, 'muted body copy must clear AA contrast on both workspace surfaces')
  assert.match(css, /--kg-control-touch:\s*44px;/, 'touch controls need one shared 44px interaction token')
  assert.match(css, /@media\s*\(pointer:\s*coarse\)[\s\S]*\.kg-icon-button[\s\S]*min-width:\s*var\(--kg-control-touch\)/)
  assert.match(css, /@media\s*\(pointer:\s*coarse\)[\s\S]*\.kg-icon-button[\s\S]*min-height:\s*var\(--kg-control-touch\)/)
})

test('cross-route workspace buttons do not use decorative lift motion', () => {
  const css = readFrontend('src/styles/boardmix-overrides.css')

  assert.doesNotMatch(css, /translateY\(-1px\)/, 'product controls should communicate state with color, not decorative lifting')
})

test('mobile file manager exposes real read-only content above the fold', () => {
  const route = readFrontend('src/routes/Files.tsx')
  const css = readFrontend('src/styles/file-manager.css')

  assert.match(route, /const \[mobileReadonly, setMobileReadonly\] = useState\(false\)/)
  assert.match(route, /matchMedia\('\(max-width: 800px\)'\)/)
  assert.match(route, /classList\.toggle\('is-mobile-readonly', mobile\)/)
  assert.match(route, /hidden=\{!mobileNoticeOpen\}/)
  assert.match(route, /setMobileNoticeOpen\(false\)/)
  assert.match(route, /mobileReadonly \? open\(f\)/, 'a tap must open a file in mobile read-only mode')
  assert.match(css, /body\.is-mobile-readonly #fmDetailsBtn[\s\S]{0,160}display:\s*none\s*!important/, 'read-only mobile must not leave a textless details button')
  assert.match(css, /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*?\.fm-app \.fm-sidebar\s*\{[^}]*height:\s*auto/)
  assert.match(css, /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*?\.fm-mobile-readonly-notice\s*\{[^}]*display:\s*grid/)
})

test('QuestionBank has one primary navigation and an inline workspace context', () => {
  const route = readFrontend('src/routes/QuestionBank.tsx')

  assert.equal((route.match(/className="qb-layout-nav"/g) || []).length, 1)
  assert.doesNotMatch(route, /className="qb-main-tabs"/, 'the workspace must not repeat the sidebar primary navigation')
  assert.doesNotMatch(route, /className="qb-status-card"/, 'bank status belongs in the workspace header')
  assert.match(route, /className="qb-workspace-context"/)
  assert.match(route, /const openAnnotation = \(tab: AnnoTab\)/)
  assert.match(route, /setAnnoTab\(tab\); setMainTab\('base'\)/)
  assert.doesNotMatch(route, /notify\('标注完成度见右侧面板'\)/, 'status is visible in the inspector and must not masquerade as navigation')
})

test('mobile admin and study routes put the active task before secondary navigation', () => {
  const usersCss = readFrontend('src/styles/user-management.css')
  const training = readFrontend('src/routes/Training.tsx')
  const trainingCss = readFrontend('src/styles/question-training.css')
  const recall = readFrontend('src/routes/Recall.tsx')
  const recallCss = readFrontend('src/styles/knowledge-recall.css')

  assert.match(usersCss, /@media\s*\(max-width:\s*820px\)[\s\S]*\.um-layout\s*\{[^}]*display:\s*contents/)
  assert.match(usersCss, /@media\s*\(max-width:\s*820px\)[\s\S]*\.um-left-card\s*\{[^}]*order:\s*1/)
  assert.match(usersCss, /@media\s*\(max-width:\s*820px\)[\s\S]*\.um-summary\s*\{[^}]*order:\s*2/)
  const users = readFrontend('src/routes/Users.tsx')
  assert.match(users, /const \[listToolsOpen, setListToolsOpen\] = useState\(false\)/)
  assert.match(users, /className=\{`um-list-tools-summary\$\{listToolsOpen \? ' active' : ''\}`\}/)
  assert.match(usersCss, /\.um-list-tools:not\(\.is-open\)\s*\{[^}]*display:\s*none/)
  assert.match(training, /<details className="qt-secondary-nav" open>/, 'desktop management links must be present without an extra click')
  assert.match(trainingCss, /\.qt-secondary-nav\[open\] \.qt-secondary-nav-links/)
  assert.match(recall, /<details className="kr-secondary-tools" open>/, 'desktop canvas settings must be present without an extra click')
  assert.match(recallCss, /\.kr-secondary-tools\[open\] \.kr-secondary-tools-content/)
  assert.match(usersCss, /\/\* Compact desktop summary rail \*\/[\s\S]*\.um-summary\s*\{[^}]*display:\s*flex/)
  assert.match(usersCss, /\/\* Compact desktop summary rail \*\/[\s\S]*\.um-stat\s*\{[^}]*border:\s*0/)
})

test('settings presents role themes as readable desktop color workspaces', () => {
  const route = readFrontend('src/routes/Settings.tsx')
  const css = readFrontend('src/styles/system-settings.css')

  assert.match(route, /className="ss-role-theme-panel"/)
  assert.match(route, /className="um-role-theme"/)
  assert.match(route, /className="ss-theme-color-grid"/)
  assert.match(route, /aria-label=\{`\$\{label\}主色`\}/)
  assert.match(route, /t\.primary_color\.toUpperCase\(\)/)
  assert.match(css, /\.ss-role-theme-panel\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(css, /\.ss-theme-color-grid label\s*\{[^}]*grid-template-columns:\s*1fr/)
  assert.match(css, /\.ss-color-field\s*\{/)
})

test('training gives an actionable desktop empty state instead of a blank panel', () => {
  const route = readFrontend('src/routes/Training.tsx')
  const css = readFrontend('src/styles/question-training.css')

  assert.match(route, /className="q-empty q-guided-empty"/)
  assert.match(route, /<Link to="\/question-bank">前往题库管理<\/Link>/)
  assert.match(css, /\.question-training-app \.q-guided-empty\s*\{/)
  assert.match(css, /\.question-training-app \.q-empty-actions\s*\{/)
})

test('recall distinguishes no selected question from a loading request', () => {
  const route = readFrontend('src/routes/Recall.tsx')
  const css = readFrontend('src/styles/knowledge-recall.css')

  assert.match(route, /qid \? <div className="kr-loading">正在加载题目…<\/div>/)
  assert.match(route, /className="kr-empty-state"/)
  assert.match(route, /<Link to="\/training">前往考题训练<\/Link>/)
  assert.match(route, /className="kr-world"[\s\S]{0,180}left: '50%'[\s\S]{0,80}top: '50%'/)
  assert.match(css, /\.kr-app\s*\{[^}]*height:\s*100vh/)
  assert.match(css, /\.kr-app\[data-theme="platform"\] \.kr-empty-state\s*\{/)
})

test('member detail keeps its desktop header fixed while the body scrolls', () => {
  const css = readFrontend('src/styles/boardmix-overrides.css')

  assert.match(css, /\.kg-subscription-detail-modal\s*\{[\s\S]*display:\s*flex !important;[\s\S]*flex-direction:\s*column;[\s\S]*overflow:\s*hidden;/)
  assert.match(css, /\.kg-subscription-detail-body\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*auto;/)
})
