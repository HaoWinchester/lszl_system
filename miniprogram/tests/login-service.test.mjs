import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule, loadPage } from './helpers/page-harness.mjs';

async function authFixture(overrides = {}, response = { status: 'binding_required', bindingTicket: 'valid-binding-ticket', expiresAt: '2099-01-01' }) {
  const requests = [], sessions = [];
  const wx = { login: async () => ({ code: 'valid-code' }), getDeviceInfo: () => ({}), getAppBaseInfo: () => ({}), ...overrides };
  const http = await loadModule('services/http.ts', {}, ['ApiError', 'messageOf']);
  const auth = await loadModule('services/auth.ts', { wx, ...http, LEGAL_CONSENT_VERSION: 'test',
    request: async options => { requests.push(options); return response; }, setSession: (...args) => sessions.push(args),
  }, ['loginWithWechat', 'bindExistingAccount']);
  return { ...auth, ...http, requests, sessions };
}

test('optional device metadata failure cannot block first-time WeChat login', async () => {
  const api = await authFixture({ getDeviceInfo() { throw new Error('device info unavailable'); } });
  const outcome = await api.loginWithWechat();
  assert.equal(outcome.status, 'binding_required');
  assert.equal(api.requests.length, 1);
});

test('missing WeChat code is rejected before HTTP with an actionable error', async () => {
  const api = await authFixture({ login: async () => ({}) });
  await assert.rejects(api.loginWithWechat(), /微信.*重试/);
  assert.equal(api.requests.length, 0);
});

test('unrecognized login response leaves button available for retry', async () => {
  const api = await authFixture({}, { status: 'unknown' });
  const { page } = await loadPage('login', api);
  page.setData({ accepted: true });
  await page.onWechatLogin();
  assert.equal(page.data.submitting, false);
  assert.match(page.data.error, /重试/);
  assert.equal(api.sessions.length, 0);
});

test('incomplete authenticated response never persists a broken session', async () => {
  const api = await authFixture({}, { status: 'authenticated', user: {} });
  await assert.rejects(api.bindExistingAccount('ticket', 'test', 'test'), /重试/);
  assert.equal(api.sessions.length, 0);
});

test('first-time binding and existing login remain usable', async () => {
  const api = await authFixture();
  const { page } = await loadPage('login', api);
  page.setData({ accepted: true });
  await page.onWechatLogin();
  assert.equal(page.data.stage, 'binding');
  assert.equal(page.data.bindingTicket, 'valid-binding-ticket');
  assert.equal(page.data.submitting, false);
  const existing = await authFixture({}, { status: 'authenticated', token: 'valid-token', user: { username: 'test' }, loginSessionId: 'id' });
  assert.equal((await existing.loginWithWechat()).status, 'authenticated');
  assert.equal(existing.sessions.length, 1);
});


test('WeChat SDK rejection releases the login button and a second attempt succeeds', async () => {
  let attempts = 0;
  const api = await authFixture({ login: async options => {
    assert.equal(options.timeout, 12000);
    if (++attempts === 1) throw { errMsg: 'login:fail timeout' };
    return { code: 'recovered-code' };
  } });
  const { page } = await loadPage('login', api);
  page.setData({ accepted: true });
  await page.onWechatLogin();
  assert.equal(page.data.submitting, false);
  assert.match(page.data.error, /微信.*重试/);
  assert.equal(api.requests.length, 0);
  await page.onWechatLogin();
  assert.equal(page.data.stage, 'binding');
  assert.equal(page.data.error, '');
});

test('a binding response without a usable ticket does not open a broken form', async () => {
  const api = await authFixture({}, { status: 'binding_required' });
  const { page } = await loadPage('login', api);
  page.setData({ accepted: true });
  await page.onWechatLogin();
  assert.equal(page.data.stage, 'wechat');
  assert.equal(page.data.submitting, false);
  assert.match(page.data.error, /重试/);
});

test('optional metadata conforms to backend field limits on unusual devices', async () => {
  const api = await authFixture({ getDeviceInfo: () => ({ model: 'x'.repeat(120), system: 'y'.repeat(120) }), getAppBaseInfo() { throw Error('unavailable'); } });
  await api.loginWithWechat();
  assert.ok(api.requests[0].data.client.model.length <= 80);
  assert.ok(api.requests[0].data.client.system.length <= 80);
});
