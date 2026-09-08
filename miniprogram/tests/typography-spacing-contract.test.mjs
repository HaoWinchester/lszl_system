import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

function wxssFiles(directory = root) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    const localPath = relative(root, path);
    if (localPath.startsWith('tests') || localPath.startsWith('docs')) return [];
    return statSync(path).isDirectory()
      ? wxssFiles(path)
      : path.endsWith('.wxss') ? [path] : [];
  });
}

test('typography uses one global family and the approved scale', () => {
  const files = wxssFiles();
  const source = files.map(path => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(source, /STSong|Songti SC|,\s*serif/);

  const localFamilyFiles = files
    .filter(path => !path.endsWith('app.wxss'))
    .filter(path => /font-family\s*:/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(localFamilyFiles, []);

  const allowed = new Set([26, 30, 31, 32, 34, 36, 44, 104]);
  const hardCodedSizes = [...source.matchAll(/font-size\s*:\s*(\d+)rpx/g)]
    .map(match => Number(match[1]));
  assert.deepEqual([...new Set(hardCodedSizes.filter(size => !allowed.has(size)))], []);
});

test('global tokens define the approved type and spacing system', () => {
  const tokens = read('styles/tokens.wxss');
  for (const declaration of [
    '--font-display: 44rpx', '--font-question: 36rpx', '--font-nav: 32rpx',
    '--font-heading: 32rpx', '--font-option: 31rpx', '--font-body: 30rpx',
    '--font-meta: 26rpx', '--space-1: 8rpx', '--space-2: 16rpx',
    '--space-3: 24rpx', '--space-4: 32rpx', '--space-5: 40rpx',
    '--space-6: 48rpx', '--page-gutter: 32rpx', '--option-min: 104rpx',
  ]) assert.match(tokens, new RegExp(declaration.replace(': ', ':\\s*')));
});

test('page styles use class-based selectors supported by component wxss', () => {
  const pageAndComponentStyles = wxssFiles()
    .filter(path => /\/(pages|components)\//.test(path));
  const unsupported = pageAndComponentStyles.flatMap(path => {
    const source = readFileSync(path, 'utf8');
    return source.split('\n').flatMap((line, index) => {
      const selector = line.split('{', 1)[0];
      const hasTagDescendant = /(?:^|,)\s*\.[\w-]+(?:\s*>\s*|\s+)(?:view|text|button|image|scroll-view|input)\b/.test(selector);
      const hasAttributeSelector = /\[[^\]]+\]/.test(selector);
      return hasTagDescendant || hasAttributeSelector
        ? [`${relative(root, path)}:${index + 1}`]
        : [];
    });
  });

  assert.deepEqual(unsupported, []);
});

test('block-level visual components expose a full-width host', () => {
  for (const component of ['question-view', 'paper-list-item', 'empty-state', 'remediation-note']) {
    const styles = read(`components/${component}/index.wxss`);
    assert.match(styles, /:host\s*\{[^}]*display:\s*block;[^}]*width:\s*100%;/s, component);
  }
});

test('answer sheet keeps a scrollable grid and centered controls', () => {
  assert.match(read('components/answer-sheet/index.wxml'), /<scroll-view[^>]*scroll-y[^>]*class="sheet-scroll"/);
  const styles = read('components/answer-sheet/index.wxss');
  assert.match(styles, /\.sheet-scroll\s*\{[^}]*max-height:\s*40vh/);
  assert.match(styles, /\.sheet-close, \.sheet-number, \.complete\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*center/);
});

test('secondary-page navigation shares the back-to-title spacing instead of page-specific overrides', () => {
  const global = read('app.wxss');
  assert.match(global, /\.nav-bar\s*\{[^}]*gap:\s*0;/s);
  for (const page of ['papers', 'practice-setup', 'result', 'membership', 'appearance', 'revenge']) {
    const markup = read(`pages/${page}/index.wxml`);
    assert.match(markup, /class="nav-bar(?:\s[^"]*)?"/);
    assert.match(markup, /class="nav-back"/);
    assert.match(markup, /class="nav-title"/);
    assert.doesNotMatch(read(`pages/${page}/index.wxss`), /\.nav-bar\s*\{[^}]*(?:gap|padding-right):/s, page);
  }
});

test('navigation keeps a compact back-title group without losing the touch target to button resets', () => {
  const styles = read('app.wxss');
  // button[class] has higher specificity than .nav-back: the old inset never applied.
  assert.match(styles, /button\.nav-back\s*\{[^}]*margin-left:\s*-16rpx;/s);
  assert.match(styles, /button\.nav-back\s*\{[^}]*height:\s*44px;/s);
  assert.match(styles, /\.nav-bar\s*\{[^}]*height:\s*44px;/s);
  assert.match(styles, /\.nav-title\s*\{[^}]*font-weight:\s*500;/s);
  assert.match(styles, /\.nav-title\s*\{[^}]*white-space:\s*nowrap;/s);
});

test('all standard page headers inherit the common navigation geometry', () => {
  const { pages } = JSON.parse(read('app.json'));
  for (const page of pages.filter(page => page !== 'pages/practice/index')) {
    assert.match(read(`${page}.wxml`), /class="nav-bar(?:\s[^"]*)?"/, page);
    assert.doesNotMatch(read(`${page}.wxss`), /\.(?:nav-bar|nav-title|nav-back|history-nav|revenge-nav)\s*\{/, page);
  }
});

test('the practice toolbar keeps its progress controls on the same navigation-height baseline', () => {
  assert.match(read('pages/practice/index.wxss'), /\.practice-nav\s*\{[^}]*height:\s*44px;/s);
});

test('result heading uses the same top inset as the practice setup heading', () => {
  for (const [page, heading] of [['result', 'result-heading'], ['practice-setup', 'paper-heading']]) {
    const styles = read(`pages/${page}/index.wxss`);
    assert.match(styles, new RegExp(`\\.${heading}\\s*\\{[^}]*padding:\\s*var\\(--space-5\\) 0(?:;| var\\(--space-5\\);)`), page);
  }
});
