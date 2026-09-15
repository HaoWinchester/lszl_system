import assert from 'node:assert/strict';
import test from 'node:test';

import { PRIMARY_TABS, tabIndexForPath } from '../domain/primary-tabs.ts';

test('primary tab routes have stable page paths and indexes', () => {
  assert.deepEqual(PRIMARY_TABS.map(item => item.path), [
    '/pages/home/index',
    '/pages/papers/index',
    '/pages/growth/index',
    '/pages/profile/index',
  ]);
  assert.equal(tabIndexForPath('/pages/history/index'), -1);
  assert.equal(tabIndexForPath('pages/profile/index'), 3);
  assert.equal(tabIndexForPath('/pages/papers/index'), 1);
});

test('bottom tabs update the mounted host with immediate touch feedback', async () => {
  const { readFileSync } = await import('node:fs');
  const markup = readFileSync(new URL('../components/primary-tab-bar/index.wxml', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../components/primary-tab-bar/index.ts', import.meta.url), 'utf8');
  assert.match(markup, /bindtap="switchTab"/);
  assert.match(script, /triggerEvent\('select'/);
  assert.doesNotMatch(script, /navigation\.switchTab|wx\.switchTab/);
  assert.match(markup, /hover-start-time="0"/);
  assert.match(markup, /hover-stay-time="0"/);
});
