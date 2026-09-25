import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/page-harness.mjs';

// Prevent review builds from selecting a different server or stale local settings.
for (const [name, accountInfo, override, expected] of [
  ['trial ignores a cached UAT override', () => ({ miniProgram: { envVersion: 'trial' } }), 'https://uat.aihuanpu.com', 'https://lszl.aihuanpu.com'],
  ['release ignores a cached localhost override', () => ({ miniProgram: { envVersion: 'release' } }), 'http://127.0.0.1:5173', 'https://lszl.aihuanpu.com'],
  ['missing environment uses production', () => ({}), 'http://127.0.0.1:5173', 'https://lszl.aihuanpu.com'],
  ['account-info error uses production', () => { throw new Error('unavailable'); }, 'http://127.0.0.1:5173', 'https://lszl.aihuanpu.com'],
  ['unknown environment uses production', () => ({ miniProgram: { envVersion: 'unknown' } }), '', 'https://lszl.aihuanpu.com'],
  ['explicit development supports UAT', () => ({ miniProgram: { envVersion: 'develop' } }), 'https://uat.aihuanpu.com/', 'https://uat.aihuanpu.com'],
  ['explicit development retains localhost default', () => ({ miniProgram: { envVersion: 'develop' } }), '', 'http://127.0.0.1:5173'],
]) {
  test(name, async () => {
    const wx = {
      getAccountInfoSync: accountInfo,
      getStorageSync: () => override,
    };
    const config = await loadModule('config/index.ts', { wx }, ['getApiBaseUrl']);
    assert.equal(config.getApiBaseUrl(), expected);
  });
}
