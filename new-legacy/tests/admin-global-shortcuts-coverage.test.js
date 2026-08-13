'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const expectedAdminPages = [
  'admin-console.html',
  'admin-operations.html',
  'admin-settings.html',
  'admin-subjects.html',
  'course-admin.html',
  'feedback-management.html',
  'message-management.html',
  'paper-management.html',
  'question-bank.html',
  'system-settings.html',
  'teacher-workbench.html',
  'user-management.html'
].sort();
const expectedShortcutPages = [
  ...expectedAdminPages,
  'index.html',
  'knowledge-recall.html',
  'question-workspace.html'
].sort();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function scriptTag(html, source) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`<script\\b[^>]*src=["']${escaped}["'][^>]*>`, 'i'))?.[0] || '';
}

const discoveredAdminPages = fs.readdirSync(root)
  .filter(file => file.endsWith('.html'))
  .filter(file => /class=["']admin-context-nav["']/.test(read(file)))
  .sort();

test('all admin navigation pages are covered by the contract', () => {
  assert.deepEqual(discoveredAdminPages, expectedAdminPages);
});

for (const page of expectedAdminPages) {
  test(`${page} loads one permission-aware global shortcut runtime`, () => {
    const html = read(page);
    const stylesheet = /<link\b[^>]*href=["']styles\/global-shortcuts\.css["'][^>]*>/g;
    const authScript = /<script\b[^>]*src=["']src\/29-auth-core\.js["'][^>]*>/g;
    const roleScript = /<script\b[^>]*src=["']src\/34-role-permissions\.js["'][^>]*>/g;
    const shortcutScript = /<script\b[^>]*src=["']src\/39-global-shortcuts\.js["'][^>]*>/g;

    assert.equal(count(html, stylesheet), 1, 'global shortcut stylesheet must be loaded exactly once');
    assert.equal(count(html, authScript), 1, 'authentication runtime must be loaded exactly once');
    assert.equal(count(html, roleScript), 1, 'role permission runtime must be loaded exactly once');
    assert.equal(count(html, shortcutScript), 1, 'global shortcut runtime must be loaded exactly once');

    const authIndex = html.indexOf('src/29-auth-core.js');
    const roleIndex = html.indexOf('src/34-role-permissions.js');
    const shortcutIndex = html.indexOf('src/39-global-shortcuts.js');
    assert.ok(authIndex < roleIndex, 'authentication must load before role permissions');
    assert.ok(roleIndex < shortcutIndex, 'role permissions must load before global shortcuts');

    const authTag = scriptTag(html, 'src/29-auth-core.js');
    const roleTag = scriptTag(html, 'src/34-role-permissions.js');
    const shortcutTag = scriptTag(html, 'src/39-global-shortcuts.js');
    assert.doesNotMatch(authTag + roleTag + shortcutTag, /\basync\b/i, 'ordered runtimes must not use async');
    if (/\bdefer\b/i.test(authTag)) {
      assert.match(roleTag, /\bdefer\b/i, 'deferred authentication requires deferred role permissions');
    }
    if (/\bdefer\b/i.test(roleTag)) {
      assert.match(shortcutTag, /\bdefer\b/i, 'deferred role permissions require deferred global shortcuts');
    }
  });
}

test('global shortcut coverage expands only to the admin navigation pages', () => {
  const htmlPages = fs.readdirSync(root).filter(file => file.endsWith('.html'));
  const scriptPages = htmlPages.filter(file => read(file).includes('src/39-global-shortcuts.js')).sort();
  const stylesheetPages = htmlPages.filter(file => read(file).includes('styles/global-shortcuts.css')).sort();
  assert.deepEqual(scriptPages, expectedShortcutPages);
  assert.deepEqual(stylesheetPages, expectedShortcutPages);
});
