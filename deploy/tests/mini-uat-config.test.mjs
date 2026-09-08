import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function fixture(t, credentials = true) {
  const dir = mkdtempSync(join(tmpdir(), 'mini-uat-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'backend'));
  copyFileSync(join(root, 'docker-compose.uat.yml'), join(dir, 'docker-compose.uat.yml'));
  copyFileSync(join(root, 'docker-compose.mini-uat.yml'), join(dir, 'docker-compose.mini-uat.yml'));
  writeFileSync(join(dir, '.env.uat'), 'POSTGRES_PASSWORD=test-db-only\nSECRET_KEY=test-session-only\n');
  if (credentials) writeFileSync(join(dir, 'backend/.env.wechat-mini.local'),
    'WECHAT_MINI_APP_ID=wx-test-mini\nWECHAT_MINI_APP_SECRET=test-mini-only\nWECHAT_MINI_ENABLE_DEMO=true\n');
  return dir;
}

function config(dir, mini) {
  return spawnSync('docker', ['compose', '-p', 'lszl-kg-uat', '--env-file', '.env.uat',
    '-f', 'docker-compose.uat.yml', ...(mini ? ['-f', 'docker-compose.mini-uat.yml'] : []),
    'config', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
}

test('mini overlay adds only isolated credentials without changing PC settings, database or ports', t => {
  const dir = fixture(t);
  const before = config(dir, false);
  const after = config(dir, true);
  assert.equal(before.status, 0, before.stderr);
  assert.equal(after.status, 0, after.stderr);
  const base = JSON.parse(before.stdout), mini = JSON.parse(after.stdout);
  assert.deepEqual(mini.services.db, base.services.db);
  assert.deepEqual(mini.volumes, base.volumes);
  assert.deepEqual(mini.services.backend.ports, base.services.backend.ports);
  const actual = mini.services.backend.environment;
  assert.equal(actual.WECHAT_MINI_APP_ID, 'wx-test-mini');
  assert.equal(actual.WECHAT_MINI_APP_SECRET, 'test-mini-only');
  assert.equal(actual.WECHAT_MINI_ENABLE_DEMO, 'false');
  const extras = { ...actual };
  for (const key of ['WECHAT_MINI_APP_ID', 'WECHAT_MINI_APP_SECRET', 'WECHAT_MINI_ENABLE_DEMO']) delete extras[key];
  assert.deepEqual(extras, base.services.backend.environment);
  assert.equal(mini.services.backend.image, base.services.backend.image);
  assert.match(mini.services.backend.command.join(' '), /logging\.getLogger\('httpx'\)\.setLevel\(logging\.WARNING\)/);
});

test('mini deployment refuses to start without its separate credential file', t => {
  const result = config(fixture(t, false), true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\.env\.wechat-mini\.local/);
});
