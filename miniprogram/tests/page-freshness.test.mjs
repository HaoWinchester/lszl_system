import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = join(root, 'domain/page-freshness.ts');

test('page refresh mode distinguishes initial, fresh, and stale content', async () => {
  assert.ok(existsSync(modulePath), 'page freshness policy should exist');
  const { pageRefreshMode, shouldRefresh } = await import(pathToFileURL(modulePath).href);

  assert.equal(shouldRefresh(0, 10_000, 30_000), true);
  assert.equal(shouldRefresh(5_000, 10_000, 30_000), false);
  assert.equal(shouldRefresh(5_000, 40_001, 30_000), true);
  assert.equal(pageRefreshMode(0, 10_000, 30_000), 'initial');
  assert.equal(pageRefreshMode(5_000, 10_000, 30_000), 'skip');
  assert.equal(pageRefreshMode(5_000, 40_001, 30_000), 'silent');
});
