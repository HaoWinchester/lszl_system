'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const financePages = [
  'admin-console.html',
  'admin-settings.html',
  'admin-operations.html',
  'admin-subjects.html',
  'feedback-management.html',
  'course-admin.html',
  'message-management.html',
  'paper-management.html',
  'question-bank.html',
  'system-settings.html',
  'teacher-workbench.html',
  'user-management.html',
];
const NAV_LINK = '<a data-admin-nav="finance" href="finance-management.html">财务管理</a>';

test('finance-management 页面存在且骨架完整', () => {
  const html = fs.readFileSync(path.join(root, 'finance-management.html'), 'utf8');
  assert.match(html, /data-admin-page="finance"/);
  assert.match(html, /data-admin-context="finance"/);
  assert.match(html, /data-admin-skin="focus-vega"/);
  assert.match(html, new RegExp(NAV_LINK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const script of [
    'src/01-runtime-config.js',
    'src/28-app-storage.js',
    'src/29-auth-core.js',
    'src/shared/auth-recovery.js',
    'src/33-user-center.js',
    'src/34-role-permissions.js',
    'src/admin/49-admin-ui.js',
    'src/121-finance-management-app.js',
    'src/admin/48-admin-context-nav.js',
  ]) {
    assert.ok(html.includes(`src="${script}"`), `缺少脚本引用：${script}`);
  }
  assert.ok(html.includes('styles/finance-management.css'), '缺少财务页样式');
});

test('12 个 admin 页面均含财务管理导航项', () => {
  for (const page of financePages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.ok(html.includes(NAV_LINK), `${page} 缺少财务管理导航`);
    const navCount = (html.match(/data-admin-nav="finance"/g) || []).length;
    assert.equal(navCount, 1, `${page} 财务导航出现 ${navCount} 次`);
  }
});

test('finance app 通过带凭据的同源请求访问 /api/v1/finance', () => {
  const js = fs.readFileSync(path.join(root, 'src/121-finance-management-app.js'), 'utf8');
  assert.match(js, /credentials:\s*'include'/);
  assert.match(js, /\/api\/v1\/finance/);
  assert.doesNotMatch(js, /api[_-]?key|secret|password\s*=/i, '不应内嵌凭据');
  assert.match(js, /admin.*teacher|teacher.*admin/i, '应做 admin/teacher 角色判断');
});

test('契约 requiredFiles 已登记财务页面文件', () => {
  const contract = JSON.parse(
    fs.readFileSync(path.resolve(root, '../frontend/scripts/new-legacy-contract.json'), 'utf8'),
  );
  for (const file of ['finance-management.html', 'styles/finance-management.css', 'src/121-finance-management-app.js']) {
    assert.ok(contract.requiredFiles.includes(file), `requiredFiles 缺少 ${file}`);
  }
});
