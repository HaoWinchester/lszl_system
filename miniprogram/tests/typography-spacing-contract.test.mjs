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
    '--font-display: 44rpx', '--font-question: 36rpx', '--font-nav: 34rpx',
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
