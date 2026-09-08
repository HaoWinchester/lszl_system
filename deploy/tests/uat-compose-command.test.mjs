import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../..');

function run(t, fail = false) {
  const dir = mkdtempSync(join(root, '.mini-deploy-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'ssh'), '#!/bin/sh\nprintf "%s\\n" "$*"\nexit ' + (fail ? 23 : 0) + '\n', { mode: 0o755 });
  return spawnSync('bash', [join(root, 'deploy/update-uat.sh'), '--check-config'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: dir + ':' + process.env.PATH },
  });
}

test('UAT read-only config check uses mini overlay and never emits expanded secrets or starts services', t => {
  const result = run(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /-f docker-compose\.uat\.yml -f docker-compose\.mini-uat\.yml/);
  assert.match(result.stdout, /config --quiet/);
  assert.match(result.stdout, /test -s backend\/\.env\.wechat-mini\.local/);
  assert.doesNotMatch(result.stdout, /up -d|rsync|docker build|WECHAT_MINI_APP_SECRET=/);
});

test('UAT missing or invalid mini config aborts the deployment preflight', t => {
  const result = run(t, true);
  assert.equal(result.status, 23);
  assert.doesNotMatch(result.stdout, /up -d|rsync|docker build/);
});
