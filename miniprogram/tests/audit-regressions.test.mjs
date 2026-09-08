import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule, loadPage } from './helpers/page-harness.mjs';
import { sanitizeRichText } from '../domain/rich-text.ts';

test('option labels remove only their matching explicit prefix, preserving IDs and real content', async () => {
  const { normalizeQuestion } = await loadModule('domain/question.ts', { sanitizeRichText }, ['normalizeQuestion']);
  const raw = { correctAnswer: 'A', options: [
    { id: 'A', text: 'A. 先沟通', textEn: 'A. Communicate first' },
    { id: 'B', text: 'B、安排会议' }, { id: 'C', text: '（C）评估影响' },
    { id: 'D', text: 'D.5 是版本号' }, { id: 'E', text: 'API 调用' },
    { id: 'F', text: 'A. 这是正文引用' }, { id: 'G', text: 'G' },
    { id: 'H', text: 'H.264 视频' }, { id: 'I', text: 'I) Inspect' },
  ] };
  const result = normalizeQuestion(raw);
  assert.deepEqual(result.options.map(row => row.text), ['先沟通', '安排会议', '评估影响', 'D.5 是版本号', 'API 调用', 'A. 这是正文引用', 'G', 'H.264 视频', 'Inspect']);
  assert.equal(result.options[0].textEn, 'Communicate first');
  assert.equal(result.correctAnswer, 'A');
  assert.equal(raw.options[0].text, 'A. 先沟通');
  assert.deepEqual(normalizeQuestion(result).options, result.options);
});

test('active list consumers request lightweight summaries but details still load on demand', async () => {
  const paths = [];
  const { getActiveSessions, getSession } = await loadModule('services/practice.ts', {
    normalizeQuestion: value => value, invalidateLearningPages() {},
    request: async ({ path }) => {
      paths.push(path);
      return path.includes('/active') ? { sessions: [{ id: 's1', paperName: '试卷', status: 'paused', stats: { answered: 3 } }] }
        : { session: { id: 's1', questions: [{ questionId: 'q1', question: { id: 'q1' } }] } };
    },
  }, ['getActiveSessions', 'getSession']);
  const rows = await getActiveSessions();
  assert.equal(rows[0].stats.answered, 3);
  assert.equal(paths[0], '/api/v1/learning/practice/sessions/active?summary=true');
  assert.equal((await getSession('s1')).questions[0].questionId, 'q1');
});

test('catalog can load beyond 100, retain data on failure, retry the same page and filter new rows', async () => {
  let fail = true; const calls = [];
  const first = Array.from({ length: 100 }, (_, i) => ({ releaseId: 'r' + i, subject: 'PMP', accessLevel: 'free' }));
  const { page } = await loadPage('papers', { messageOf: e => e.message,
    listPublishedPapers: async (number, size) => {
      calls.push([number, size]);
      if (number === 1) return { items: first, total: 101 };
      if (fail) throw new Error('network unavailable');
      return { items: [{ releaseId: 'r100', subject: 'ACP', accessLevel: 'member' }], total: 101 };
    },
  });
  await page.loadPapers(); assert.equal(page.data.hasMore, true);
  page.onAccess({ currentTarget: { dataset: { access: 'member' } } });
  assert.equal(page.data.filtered.length, 0);
  await page.loadMore(); assert.equal(page.data.papers.length, 100); assert.ok(page.data.moreError);
  fail = false;
  await page.loadMore();
  assert.deepEqual(calls, [[1,100],[2,100],[2,100]]);
  assert.equal(page.data.filtered[0].releaseId, 'r100');
  assert.ok(page.data.subjects.includes('ACP')); assert.equal(page.data.hasMore, false);
  assert.equal(page.data.moreError, '');
  await page.loadMore(); assert.equal(calls.length, 3);
});

test('lightweight active progress does not erase persisted history duration or experience', async () => {
  const { listSessions } = await loadModule('services/practice.ts', {
    request: async ({ path }) => path.includes('/active')
      ? { sessions: [{ id: 's1', mode: 'practice', status: 'paused', stats: { answered: 3, correct: 2 } }] }
      : { sessions: [{ sessionId: 's1', experience: 15, durationMs: 123000, status: 'paused' }] },
  }, ['listSessions']);
  const [row] = await listSessions();
  assert.equal(row.durationMs, 123000); assert.equal(row.experience, 15); assert.equal(row.answered, 3);
});
