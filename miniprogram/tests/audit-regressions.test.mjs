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
  const rows = [...Array.from({ length: 100 }, (_, i) => ({ releaseId: 'r' + i, subject: 'PMP', accessLevel: 'free' })),
    { releaseId: 'r100', subject: 'ACP', accessLevel: 'member' }];
  const { page } = await loadPage('papers', { messageOf: e => e.message,
    listPublishedPapers: async (number, size) => {
      calls.push([number, size]);
      if (number === 2 && fail) throw new Error('network unavailable');
      return { items: rows.slice((number - 1) * size, number * size), total: 101 };
    },
  });
  await page.loadPapers(); assert.equal(page.data.hasMore, true);
  page.onAccess({ currentTarget: { dataset: { access: 'member' } } });
  assert.equal(page.data.filtered.length, 0);
  await page.loadMore(); assert.equal(page.data.papers.length, 20); assert.ok(page.data.moreError);
  fail = false;
  await page.loadMore();
  for (let i = 0; i < 4; i++) await page.loadMore();
  assert.deepEqual(calls, [[1,20],[2,20],[2,20],[3,20],[4,20],[5,20],[6,20]]);
  assert.equal(page.data.papers.length, 101);
  assert.equal(page.data.filtered[0].releaseId, 'r100');
  assert.ok(page.data.subjects.includes('ACP')); assert.equal(page.data.hasMore, false);
  assert.equal(page.data.moreError, '');
  await page.loadMore(); assert.equal(calls.length, 7);
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

test('published translations supply English stems and match options by ID without replacing Chinese', async () => {
  const { normalizeQuestion } = await loadModule('domain/question.ts', { sanitizeRichText }, ['normalizeQuestion']);
  const raw = { stemParts: [{ text: '项目经理下一步应该做什么？' }], options: [{ id: 'A', text: '先沟通' }, { id: 'B', text: '更新计划' }],
    translations: { en: { stemParts: [{ text: 'What should the project manager do next?' }], options: [{ id: 'B', text: 'B. Update the plan' }, { id: 'A', text: 'A. Communicate first' }] } } };
  const result = normalizeQuestion(raw);
  assert.equal(result.stem, '项目经理下一步应该做什么？');
  assert.equal(result.stemEn, 'What should the project manager do next?');
  assert.deepEqual(result.options.map(o => o.textEn), ['Communicate first', 'Update the plan']);
  assert.deepEqual(normalizeQuestion(result), result);
  const flat = normalizeQuestion({ ...raw, stemEn: 'Explicit English', options: [{ id: 'A', text: '先沟通', textEn: 'Explicit option' }] });
  assert.equal(flat.stemEn, 'Explicit English'); assert.equal(flat.options[0].textEn, 'Explicit option');
  assert.equal(normalizeQuestion({ stem: '只有中文', options: [{ id: 'A', text: '选项' }], translations: { en: { options: {} } } }).stemEn, undefined);
});
