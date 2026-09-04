import assert from 'node:assert/strict';
import test from 'node:test';

import { PRIMARY_TABS, tabIndexForPath } from '../domain/primary-tabs.ts';

test('primary tab routes have stable page paths and indexes', () => {
  assert.deepEqual(PRIMARY_TABS.map(item => item.path), [
    '/pages/home/index',
    '/pages/history/index',
    '/pages/profile/index',
  ]);
  assert.equal(tabIndexForPath('/pages/history/index'), 1);
  assert.equal(tabIndexForPath('pages/profile/index'), 2);
  assert.equal(tabIndexForPath('/pages/papers/index'), -1);
});
