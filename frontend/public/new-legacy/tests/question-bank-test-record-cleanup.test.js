const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'question-bank.html'), 'utf8');
const controller = fs.readFileSync(
  path.join(root, 'src', '65-question-bank-admin.js'),
  'utf8',
);

test('selected bank exposes a guarded test-record cleanup action', () => {
  assert.match(html, /id="qbClearBankTestRecordsBtn"/);
  assert.match(controller, /test-learning-records\/clear/);
  assert.match(controller, /清除测试答题记录/);
  assert.match(controller, /qbClearBankTestRecordsBtn.*addEventListener\('click'/s);
  assert.match(controller, /clearedTestRecordBankIds:new Set\(\)/);
  assert.match(controller, /clearedTestRecordBankIds\.add\(bank\.id\)/);
  assert.match(controller, /!state\.clearedTestRecordBankIds\.has\(bank\.id\)/);
});
