import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule, loadPage } from './helpers/page-harness.mjs';

const summary = {requestedCount:10,actualCount:10,unseenCount:3,reviewCount:7,totalCount:23,completedCount:20,remainingUnseen:3};
const mixed = '本轮 10 题：未做 3 题 · 复习 7 题。优先未做题，保留完整案例，其余由已做题补足。';
test('session service preserves frozen selection notice through start and restore', async () => {
  const requests = [];
  const raw = {id:'s',mode:'practice',questions:[],selectionSummary:summary,scoringSnapshot:{selectionSummary:summary}};
  const service = await loadModule('services/practice.ts', {
    request: async input => { requests.push(input); return {session:structuredClone(raw)}; },
    normalizeQuestion: value=>value, invalidateLearningPages() {},
  }, ['startSession','getSession','normalizeSession']);
  const started = await service.startSession({paperId:'p',releaseId:'r',mode:'normal',count:10,order:'random'});
  assert.deepEqual(started.selectionSummary, summary);
  assert.equal(started.selectionNotice, mixed);
  const restored = await service.getSession('s');
  assert.equal(restored.selectionNotice, started.selectionNotice);
  assert.equal(requests[0].data.count,10);
  assert.equal(requests[0].data.order,'random');
  assert.equal(service.normalizeSession({}).selectionNotice,'');
  assert.equal(service.normalizeSession({mode:'revenge',selectionSummary:summary}).selectionNotice,'');
  assert.equal(service.normalizeSession({scoringSnapshot:{selectionSummary:{...summary,unseenCount:0,reviewCount:10}}}).selectionNotice,'本轮复习 10 题。');
  assert.equal(service.normalizeSession({selectionSummary:{...summary,unseenCount:10,reviewCount:0}}).selectionNotice,'本轮 10 题：均为未做题。');
});

test('new practice from result uses full paper count and original requested batch size', async () => {
  const {page,navigation}=await loadPage('result', {getModePolicy:()=>({id:'normal'})});
  page.data.session={paperId:'p',releaseId:'r',questions:Array(10).fill({}),selectionSummary:summary};
  page.onRetry();
  const query=new URLSearchParams(navigation[0].url.split('?')[1]);
  assert.equal(query.get('count'),'23');
  assert.equal(query.get('practiceCount'),'10');
  const {page:setup}=await loadPage('practice-setup',{MODE_CHOICES:[]});
  setup.onLoad(Object.fromEntries(query));
  assert.equal(setup.data.totalCount,23);
  assert.equal(setup.data.count,10);
});
