import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { MODE_CHOICES, getModePolicy } from '../domain/mode-policy.ts';
import { THEMES, READING_SIZES, appearanceData } from '../domain/appearance.ts';
import { loadPage } from './helpers/page-harness.mjs';

const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
for (const route of app.pages) {
  test(`${route}: sharing opens a public entry without private state or a page screenshot`, async () => {
    const name = route.split('/')[1];
    const { page } = await loadPage(name, { MODE_CHOICES, getModePolicy, THEMES, READING_SIZES, appearanceData });
    assert.equal(typeof page.onShareAppMessage, 'function', `${route} must support forwarding`);
    const privateData = { sessionId: 'private-session', username: 'private-user', token: 'private-token', answers: { q1: ['A'] } };
    page.setData(privateData);
    for (const from of ['menu', 'button']) {
      const share = page.onShareAppMessage({ from, target: { dataset: privateData } });
      assert.equal(share.path, '/pages/tabs/index');
      assert.ok(app.pages.includes(share.path.slice(1)));
      assert.ok(share.title.length > 0);
      assert.ok(share.imageUrl.startsWith('/assets/'), 'explicit packaged cover prevents private screen capture');
      assert.ok(existsSync(new URL(`..${share.imageUrl}`, import.meta.url)));
      assert.doesNotMatch(JSON.stringify(share), /private-|sessionId|username|answers|token/);
      share.path = '/pages/practice/index?sessionId=private-session';
      assert.equal(page.onShareAppMessage().path, '/pages/tabs/index', 'next attempt remains safe after cancellation/retry');
    }
  });
}

test('a recipient without a session follows the existing login route', async () => {
  const { page, navigation } = await loadPage('home', { validateSession: async () => null });
  await page.loadHome();
  assert.equal(navigation[0].url, '/pages/login/index');
});
