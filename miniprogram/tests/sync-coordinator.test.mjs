import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyFailure, createSyncCoordinator, resolveConflict } from '../domain/sync-coordinator.ts';

const offline = () => Object.assign(new Error('offline'), { statusCode: 0, code: 'NETWORK_ERROR' });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

test('a retry keeps the original idempotency key', async () => {
  const seen = [];
  const sync = createSyncCoordinator(async job => {
    seen.push(job.key);
    if (seen.length === 1) throw offline();
    return { ok: true };
  });
  await assert.rejects(sync.enqueueWrite({ sessionId: 's1', key: 'answer:q1:r3', action: 'answer', payload: {} }));
  await sync.retryPending();
  assert.deepEqual(seen, ['answer:q1:r3', 'answer:q1:r3']);
});

test('writes for a session are serialized in enqueue order', async () => {
  const order = [];
  let release;
  const firstGate = new Promise(resolve => { release = resolve; });
  const sync = createSyncCoordinator(async job => {
    order.push(`start:${job.key}`);
    if (job.key === 'one') await firstGate;
    order.push(`end:${job.key}`);
    return job.key;
  });
  const first = sync.enqueueWrite({ sessionId: 's1', key: 'one', action: 'state', payload: {} });
  const second = sync.enqueueWrite({ sessionId: 's1', key: 'two', action: 'state', payload: {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(order, ['start:one']);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['one', 'two']);
  assert.deepEqual(order, ['start:one', 'end:one', 'start:two', 'end:two']);
});

test('failures and conflict choices are explicit', () => {
  assert.equal(classifyFailure(offline()), 'offline');
  assert.equal(classifyFailure({ statusCode: 401 }), 'auth');
  assert.equal(classifyFailure({ statusCode: 409, code: 'PRACTICE_SESSION_REVISION_CONFLICT' }), 'conflict');
  assert.equal(classifyFailure({ statusCode: 422 }), 'error');
  const server = { revision: 5, currentIndex: 1 };
  const local = { revision: 3, currentIndex: 4 };
  assert.deepEqual(resolveConflict(server, local, 'server'), server);
  assert.deepEqual(resolveConflict(server, local, 'local'), { revision: 5, currentIndex: 4 });
});

test('practice and revenge writes use the coordinator and expose retry', () => {
  for (const page of ['practice', 'revenge']) {
    const source = read(`pages/${page}/index.ts`);
    const view = read(`pages/${page}/index.wxml`);
    assert.match(source, /enqueueWrite/);
    assert.match(source, /retryPending/);
    assert.match(view, /retryWrites/);
  }
  assert.match(read('services/http.ts'), /response\.statusCode === 401[\s\S]*reLaunch/);
});
