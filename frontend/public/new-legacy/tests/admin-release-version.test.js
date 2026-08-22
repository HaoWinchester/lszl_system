'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const uiPath = path.resolve(root, 'src/admin/49-admin-ui.js');
const adminPages = [
  'admin-console.html',
  'admin-operations.html',
  'admin-settings.html',
  'admin-subjects.html',
  'feedback-management.html',
  'message-management.html',
];

function runtime(release = 'v9.0-test.7') {
  const account = { id: 'adminAccountMenu' };
  const topbar = {
    children: [account],
    insertBefore(child, reference) {
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
    },
    appendChild(child) { this.children.push(child); },
  };
  const document = {
    documentElement: { dataset: { release } },
    body: { dataset: { adminPage: 'subjects' } },
    getElementById(id) { return id === 'adminAccountMenu' ? account : null; },
    querySelector(selector) {
      if (selector === '.admin-topbar') return topbar;
      if (selector === '.admin-release-version') {
        return topbar.children.find(item => item.className === 'admin-release-version') || null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    createElement(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        className: '',
        textContent: '',
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = String(value); },
      };
    },
    addEventListener() {},
  };
  const context = {
    console,
    document,
    setTimeout,
    clearTimeout,
    addEventListener() {},
    location: { href: '' },
  };
  context.window = context;
  return { context, topbar, account };
}

test('shared admin UI renders the actual release exactly once before the account menu', () => {
  const { context, topbar, account } = runtime();
  vm.runInNewContext(fs.readFileSync(uiPath, 'utf8'), context, { filename: uiPath });

  const first = context.KGAdminUI.renderReleaseVersion();
  const repeated = context.KGAdminUI.renderReleaseVersion();

  assert.equal(first, repeated);
  assert.equal(first.textContent, 'v9.0-test.7');
  assert.equal(first.attributes['aria-label'], '当前后台版本 v9.0-test.7');
  assert.equal(topbar.children.filter(item => item.className === 'admin-release-version').length, 1);
  assert.ok(topbar.children.indexOf(first) < topbar.children.indexOf(account));
});

test('every admin topbar page loads the shared release renderer', () => {
  for (const page of adminPages) {
    const html = fs.readFileSync(path.resolve(root, page), 'utf8');
    assert.match(html, /class="admin-topbar"/, `${page} 缺少后台顶部栏`);
    assert.match(html, /src="src\/admin\/49-admin-ui\.js"/, `${page} 未加载后台通用 UI`);
  }
});

test('release sync stamps the real version on generated HTML', () => {
  const syncSource = fs.readFileSync(path.resolve(root, '../frontend/scripts/sync-new-legacy.js'), 'utf8');
  assert.match(syncSource, /versionPageRelease\(html, version\)/);
  assert.match(syncSource, /data-release="\$\{version\}"/);
  assert.match(syncSource, /versionPageRelease\(generated, version\)/);
});
