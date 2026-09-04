import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

function sourceFiles(directory = root) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    const localPath = relative(root, path);
    if (localPath.startsWith('tests') || localPath.startsWith('docs')) return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

function allSource() {
  return sourceFiles().map(path => readFileSync(path, 'utf8')).join('\n');
}

test('mini program declares native home and login pages', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(app.pages.slice(0, 2), ['pages/home/index', 'pages/login/index']);
  assert.equal(app.window.navigationStyle, 'custom');
});

test('client source contains no WeChat secret or provider session key', () => {
  assert.doesNotMatch(allSource(), /WECHAT_MINI_APP_SECRET|session_key|appSecret/);
  assert.equal(JSON.parse(read('project.config.json')).appid, 'touristappid');
});

test('HTTP service attaches the opaque bearer token and handles expiry', () => {
  const source = read('services/http.ts');
  assert.match(source, /Authorization/);
  assert.match(source, /Bearer/);
  assert.match(source, /statusCode === 401/);
  assert.match(source, /clearSession/);
});

test('session validation skips the request when no local token exists', () => {
  const source = read('services/auth.ts');
  assert.match(source, /getSessionToken/);
  assert.match(source, /if \(!getSessionToken\(\)\) return null;/);
  assert.doesNotMatch(source, /getSystemInfoSync/);
});

test('login requires legal consent and supports existing-account binding', () => {
  const wxml = read('pages/login/index.wxml');
  assert.match(wxml, /微信登录/);
  assert.match(wxml, /绑定已有账号/);
  assert.match(wxml, /隐私政策/);
  assert.match(wxml, /用户协议/);
  assert.match(read('pages/login/index.ts'), /accepted/);
});

test('visual foundation avoids AI-like effects and keeps mobile touch sizing', () => {
  const styles = `${read('styles/tokens.wxss')}\n${read('app.wxss')}`;
  assert.doesNotMatch(styles, /linear-gradient|radial-gradient|filter:\s*blur|text-shadow/);
  assert.match(styles, /--touch-min:\s*96rpx/);
  assert.match(styles, /--option-min:\s*104rpx/);
  assert.match(styles, /--ink:\s*#173b32/);
});

test('entry pages share the approved title and spacing system', () => {
  const styles = `${read('pages/login/index.wxss')}\n${read('pages/home/index.wxss')}`;
  assert.doesNotMatch(styles, /font-family/);
  assert.match(styles, /font-size:\s*var\(--font-display\)/);
  assert.doesNotMatch(styles, /padding-top:\s*(?:64|88|108|112)rpx/);
});

test('WXML templates avoid unsupported inline collection literals', () => {
  const templates = sourceFiles()
    .filter(path => path.endsWith('.wxml'))
    .map(path => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(templates, /wx:for="\{\{\s*\[/);
});

test('native modal button labels stay within the WeChat four-character limit', () => {
  const violations = sourceFiles()
    .filter(path => path.endsWith('.ts'))
    .flatMap(path => {
      const source = readFileSync(path, 'utf8');
      return [...source.matchAll(/(?:confirmText|cancelText)\s*:\s*['`]([^'`]+)['`]/g)]
        .filter(match => [...match[1]].length > 4)
        .map(match => `${relative(root, path)}: ${match[1]}`);
    });
  assert.deepEqual(violations, []);
});

test('classed buttons opt out of the native fixed width and declare intentional full widths', () => {
  const appStyles = read('app.wxss');
  assert.match(appStyles, /button\[class\]\s*\{[^}]*width:\s*var\(--button-width,\s*auto\);[^}]*margin-left:\s*0;[^}]*margin-right:\s*0;/s);

  const fullWidthRules = [
    ['pages/home/index.wxss', '.mode-row'],
    ['pages/home/index.wxss', '.home-paper'],
    ['pages/practice-setup/index.wxss', '.line-option, .mode-option'],
    ['pages/practice-setup/index.wxss', '.start-button'],
    ['pages/profile/index.wxss', '.account-row, .logout'],
    ['pages/result/index.wxss', '.wrong-row'],
    ['pages/result/index.wxss', '.next-action'],
    ['pages/revenge/index.wxss', '.stage-action'],
    ['components/paper-list-item/index.wxss', '.paper-row'],
    ['components/answer-sheet/index.wxss', '.complete'],
  ];
  for (const [path, selector] of fullWidthRules) {
    const styles = read(path);
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(styles, new RegExp(`${escaped}\\s*\\{[^}]*--button-width:\\s*100%;`, 's'), `${path} ${selector}`);
  }
});
