'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const test = require('node:test');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const adapterSource = fs.readFileSync(
  path.join(REPO, 'frontend/scripts/new-legacy-assets/question-catalog-adapter.js'),
  'utf8',
);

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

async function loadAdapter({ importStatus = 200 } = {}) {
  const calls = [];
  const published = [];
  const events = [];
  let bootstrapCount = 0;
  const imported = {
    banks: [{
      id: 'b-server-a', name: '已持久化题库', subject: 'PMP', revision: 1,
      questions: [{ id: 'q-server-a', bankId: 'b-server-a', title: '已持久化题目', revision: 1 }],
    }],
    sourceBankIdMap: { 'source-bank-a': 'b-server-a' },
    sourceQuestionIdMap: { 'source-bank-a::source-question-a': 'q-server-a' },
    contentRevision: 4,
  };
  const window = {
    document: { body: { dataset: { questionCatalogMode: 'managed' } } },
    crypto: { randomUUID: () => 'test-client' },
    KGTeachingContentSync: { publish: detail => published.push(detail), subscribe: () => () => {} },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent(event) { events.push(event); },
    setTimeout, clearTimeout,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.startsWith('/api/v1/question-catalog/bootstrap?') && url.includes('mode=managed')) {
        bootstrapCount += 1;
        const afterImport = bootstrapCount > 1;
        return response(200, {
          banks: afterImport ? imported.banks : [],
          questions: afterImport ? imported.banks[0].questions : [],
          catalogRevision: afterImport ? 'catalog-4' : 'catalog-3',
          contentRevision: afterImport ? 4 : 3,
        });
      }
      if (url === '/api/v1/banks/import') {
        return response(importStatus, importStatus === 200 ? imported : { detail: { message: '导入被拒绝' } });
      }
      return response(404, { detail: { message: `unexpected request: ${url}` } });
    },
  };
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const context = vm.createContext({ window, CustomEvent, URLSearchParams, JSON, Date, Math, Promise, setTimeout, clearTimeout });
  vm.runInContext(adapterSource, context, { filename: 'question-catalog-adapter.js' });
  await window.KGQuestionCatalogAdapter.ready;
  return { adapter: window.KGQuestionCatalogAdapter, calls, events, published, imported };
}

test('catalog adapter posts an import and refreshes only after the server commits it', async () => {
  const fixture = await loadAdapter();
  const sourceBank = {
    id: 'source-bank-a', name: '导入源题库', subject: 'PMP',
    questions: [{ id: 'source-question-a', title: '导入源题目' }],
  };

  const result = await fixture.adapter.importBanks({ banks: [sourceBank] });

  assert.deepEqual(result.sourceBankIdMap, fixture.imported.sourceBankIdMap);
  const importCall = fixture.calls.find(call => call.url === '/api/v1/banks/import');
  assert.equal(importCall.options.method, 'POST');
  assert.deepEqual(JSON.parse(importCall.options.body), { banks: [sourceBank], confirmReplace: false, confirmDuplicateCleanup: false });
  assert.equal(fixture.adapter.snapshot().banks[0].id, 'b-server-a');
  assert.equal(fixture.published.at(-1).revision, 4);
  assert.ok(fixture.events.some(event => event.type === 'kg:question-catalog-changed'));
});

test('catalog adapter does not publish a content revision when import is rejected', async () => {
  const fixture = await loadAdapter({ importStatus: 422 });
  await assert.rejects(
    fixture.adapter.importBanks({ banks: [{ id: 'source-bank-a', name: '错误导入', subject: 'PMP', questions: [] }] }),
    /导入被拒绝/,
  );
  assert.equal(fixture.published.length, 0);
  assert.equal(fixture.adapter.snapshot().contentRevision, 3);
});
