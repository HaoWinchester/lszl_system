const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SERVICE_PATH = path.join(
  ROOT,
  'src/teacher/paper-management/paper-quota-service.js'
);

function loadService() {
  const context = { console, globalThis: null };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SERVICE_PATH, 'utf8'), context, {
    filename: 'paper-quota-service.js'
  });
  return context.KGPaperQuotaService;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const service = loadService();

test('normalizeConfig defaults to domain mode and preserves both quota maps', () => {
  assert.deepEqual(
    plain(service.normalizeConfig({
      domainQuotas: { d1: 2, d2: 0 },
      principleQuotas: { p1: 3 }
    })),
    {
      mode: 'domain',
      domainQuotas: { d1: 2, d2: 0 },
      principleQuotas: { p1: 3 }
    }
  );
});

test('normalizeConfig rejects unknown modes and invalid quota values', () => {
  const invalidInputs = [
    { mode: 'combined', domainQuotas: {} },
    { mode: 'domain', domainQuotas: { d1: -1 } },
    { mode: 'domain', domainQuotas: { d1: 1.5 } },
    { mode: 'principle', principleQuotas: { p1: '2' } }
  ];

  invalidInputs.forEach(input => {
    assert.throws(
      () => service.normalizeConfig(input),
      error => error?.name === 'TypeError' && Boolean(error.message)
    );
  });
});

test('principle supplementation preserves manual questions and never duplicates them', () => {
  const result = plain(service.supplement({
    paperQuestionIds: ['q-manual', 'q-manual'],
    candidates: [
      { id: 'q-manual', domainId: 'd1', principleIds: ['p1'], eligible: true },
      { id: 'q2', domainId: 'd1', principleIds: ['p1', 'p2'], eligible: true },
      { id: 'q3', domainId: 'd2', principleIds: ['p2'], eligible: true }
    ],
    mode: 'principle',
    quotas: { p1: 1, p2: 1 },
    random: () => 0.5
  }));

  assert.deepEqual(result.addedQuestionIds, ['q2']);
  assert.deepEqual(result.assignments, {
    p1: ['q-manual'],
    p2: ['q2']
  });
  assert.deepEqual(result.shortages, []);
});

test('domain supplementation fills exact deficits without removing surplus selections', () => {
  const result = plain(service.supplement({
    paperQuestionIds: ['q-existing-d1', 'q-surplus-d2'],
    candidates: [
      { id: 'q-existing-d1', domainId: 'd1', principleIds: [], eligible: true },
      { id: 'q-surplus-d2', domainId: 'd2', principleIds: [], eligible: true },
      { id: 'q-add-d1', domainId: 'd1', principleIds: [], eligible: true },
      { id: 'q-add-d2', domainId: 'd2', principleIds: [], eligible: true }
    ],
    mode: 'domain',
    quotas: { d1: 2, d2: 0 },
    random: () => 0.999
  }));

  assert.deepEqual(result.addedQuestionIds, ['q-add-d1']);
  assert.deepEqual(result.assignments, {
    d1: ['q-existing-d1', 'q-add-d1'],
    d2: ['q-surplus-d2']
  });
});

test('supplement excludes ineligible and archived questions from additions', () => {
  const result = plain(service.supplement({
    paperQuestionIds: ['q-kept-ineligible'],
    candidates: [
      { id: 'q-kept-ineligible', domainId: 'd1', principleIds: [], eligible: false },
      { id: 'q-ineligible', domainId: 'd1', principleIds: [], eligible: false },
      { id: 'q-archived', domainId: 'd1', principleIds: [], eligible: true, archived: true },
      { id: 'q-active', domainId: 'd1', principleIds: [], eligible: true, archived: false }
    ],
    mode: 'domain',
    quotas: { d1: 2 },
    random: () => 0.5
  }));

  assert.deepEqual(result.addedQuestionIds, ['q-active']);
  assert.deepEqual(result.assignments, {
    d1: ['q-kept-ineligible', 'q-active']
  });
});

test('supplement reports every remaining quota shortage with explicit counts', () => {
  const result = plain(service.supplement({
    paperQuestionIds: ['q-existing'],
    candidates: [
      { id: 'q-existing', domainId: 'd1', principleIds: [], eligible: true },
      { id: 'q-one-more', domainId: 'd1', principleIds: [], eligible: true }
    ],
    mode: 'domain',
    quotas: { d1: 3, d2: 2 },
    random: () => 0.5
  }));

  assert.deepEqual(result.shortages, [
    { bucketId: 'd1', requested: 3, existing: 1, added: 1, missing: 1 },
    { bucketId: 'd2', requested: 2, existing: 0, added: 0, missing: 2 }
  ]);
});

test('a multi-principle candidate fills only the first greatest-deficit bucket', () => {
  const result = plain(service.supplement({
    paperQuestionIds: [],
    candidates: [
      { id: 'q-both', domainId: 'd1', principleIds: ['p2', 'p1'], eligible: true }
    ],
    mode: 'principle',
    quotas: { p1: 1, p2: 1 },
    random: () => 0.5
  }));

  assert.deepEqual(result.addedQuestionIds, ['q-both']);
  assert.deepEqual(result.assignments, { p1: ['q-both'], p2: [] });
  assert.deepEqual(result.shortages, [
    { bucketId: 'p2', requested: 1, existing: 0, added: 0, missing: 1 }
  ]);
});

test('existing principle questions prefer outstanding buckets and expose unmatched IDs', () => {
  const result = plain(service.supplement({
    paperQuestionIds: ['q-both', 'q-unmatched'],
    candidates: [
      { id: 'q-both', domainId: 'd1', principleIds: ['p1', 'p2'], eligible: true },
      { id: 'q-unmatched', domainId: 'd2', principleIds: ['p3'], eligible: true }
    ],
    mode: 'principle',
    quotas: { p1: 0, p2: 1 },
    random: () => 0.5
  }));

  assert.deepEqual(result.assignments, { p1: [], p2: ['q-both'] });
  assert.deepEqual(result.unassignedExistingIds, ['q-unmatched']);
  assert.deepEqual(result.shortages, []);
});

test('candidate order is stable before applying the injected shuffle', () => {
  const run = candidates => plain(service.supplement({
    paperQuestionIds: [],
    candidates,
    mode: 'domain',
    quotas: { d1: 2 },
    random: (() => {
      const values = [0, 0];
      return () => values.shift();
    })()
  })).addedQuestionIds;
  const candidates = [
    { id: 'q3', domainId: 'd1', principleIds: [], eligible: true },
    { id: 'q1', domainId: 'd1', principleIds: [], eligible: true },
    { id: 'q2', domainId: 'd1', principleIds: [], eligible: true }
  ];

  assert.deepEqual(run(candidates), ['q2', 'q3']);
  assert.deepEqual(run([...candidates].reverse()), ['q2', 'q3']);
});

test('supplementation is idempotent when additions are included in the next paper state', () => {
  const request = {
    candidates: [
      { id: 'q1', domainId: 'd1', principleIds: [], eligible: true },
      { id: 'q2', domainId: 'd1', principleIds: [], eligible: true }
    ],
    mode: 'domain',
    quotas: { d1: 2 },
    random: () => 0.5
  };
  const first = plain(service.supplement({ ...request, paperQuestionIds: [] }));
  const second = plain(service.supplement({
    ...request,
    paperQuestionIds: first.addedQuestionIds
  }));

  assert.deepEqual(first.addedQuestionIds, ['q1', 'q2']);
  assert.deepEqual(second.addedQuestionIds, []);
  assert.deepEqual(second.assignments, { d1: ['q1', 'q2'] });
  assert.deepEqual(second.shortages, []);
});

test('principle supplementation preserves its multi-bucket assignment on rerun', () => {
  const request = {
    candidates: [
      { id: 'q1-flex', domainId: 'd1', principleIds: ['p1', 'p2'], eligible: true },
      { id: 'q2-p1', domainId: 'd1', principleIds: ['p1'], eligible: true },
      { id: 'q3-p2', domainId: 'd1', principleIds: ['p2'], eligible: true },
      { id: 'q4-p2', domainId: 'd1', principleIds: ['p2'], eligible: true }
    ],
    mode: 'principle',
    quotas: { p1: 1, p2: 2 },
    random: () => 0.999
  };
  const first = plain(service.supplement({ ...request, paperQuestionIds: [] }));
  const second = plain(service.supplement({
    ...request,
    paperQuestionIds: first.addedQuestionIds
  }));

  assert.deepEqual(first.addedQuestionIds, ['q1-flex', 'q2-p1', 'q3-p2']);
  assert.deepEqual(first.assignments, {
    p1: ['q2-p1'],
    p2: ['q1-flex', 'q3-p2']
  });
  assert.deepEqual(second.addedQuestionIds, []);
  assert.deepEqual(second.assignments, first.assignments);
  assert.deepEqual(second.shortages, []);
});

test('supplement rejects conflicting duplicate candidate IDs in every input order', () => {
  const duplicateCandidates = [
    { id: 'q-duplicate', domainId: 'd1', principleIds: [], eligible: true },
    { id: 'q-duplicate', domainId: 'd2', principleIds: [], eligible: true }
  ];
  const run = candidates => service.supplement({
    paperQuestionIds: [],
    candidates,
    mode: 'domain',
    quotas: { d1: 1 },
    random: () => 0.5
  });

  [duplicateCandidates, [...duplicateCandidates].reverse()].forEach(candidates => {
    assert.throws(
      () => run(candidates),
      error => error?.name === 'TypeError' && /duplicate candidate ID/i.test(error.message)
    );
  });
});

test('supplement handles a large single-domain pool without quadratic rescanning', () => {
  const count = 6000;
  const candidates = Array.from({ length: count }, (_, index) => ({
    id: `q-${String(index).padStart(6, '0')}`,
    domainId: 'd1',
    principleIds: [],
    eligible: true
  }));
  const startedAt = performance.now();
  const result = service.supplement({
    paperQuestionIds: [],
    candidates,
    mode: 'domain',
    quotas: { d1: count },
    random: () => 0.999
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(result.addedQuestionIds.length, count);
  assert.ok(elapsedMs < 600, `expected <600ms, received ${elapsedMs.toFixed(1)}ms`);
});

test('supplement does not mutate paper IDs, candidates, or quota objects', () => {
  const paperQuestionIds = ['q1'];
  const candidates = [
    { id: 'q1', domainId: 'd1', principleIds: ['p1'], eligible: true },
    { id: 'q2', domainId: 'd1', principleIds: ['p1'], eligible: true }
  ];
  const quotas = { p1: 2 };
  const before = JSON.stringify({ paperQuestionIds, candidates, quotas });

  service.supplement({
    paperQuestionIds,
    candidates,
    mode: 'principle',
    quotas,
    random: () => 0.5
  });

  assert.equal(JSON.stringify({ paperQuestionIds, candidates, quotas }), before);
});
