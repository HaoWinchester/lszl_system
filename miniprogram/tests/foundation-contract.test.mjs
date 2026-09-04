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
  assert.match(styles, /--option-min:\s*122rpx/);
  assert.match(styles, /--ink:\s*#173b32/);
});

test('WXML templates avoid unsupported inline collection literals', () => {
  const templates = sourceFiles()
    .filter(path => path.endsWith('.wxml'))
    .map(path => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(templates, /wx:for="\{\{\s*\[/);
});
