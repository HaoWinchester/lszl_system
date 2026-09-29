import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule, loadPage } from './helpers/page-harness.mjs';

const rawCoverage = { releaseId: 'r', totalCount: 23, completedCount: 20, remainingUnseen: 3 };

test('catalog and progress keep server coverage, reject missing or mismatched statistics', async () => {
  const requests = [];
  let coverage = rawCoverage;
  const service = await loadModule('services/papers.ts', {
    request: async input => { requests.push(input.path); return { releases: [{paperId:'p', releaseId:'r', coverage}], coverage }; },
  }, ['listPublishedPapers', 'getPaperCoverage']);
  const catalog = await service.listPublishedPapers();
  assert.equal(catalog.items[0].coverage.remainingUnseen, 3);
  assert.match(catalog.items[0].coverage.label, /已练 20.*23.*未练 3/);
  assert.deepEqual(await service.getPaperCoverage('p/a', 'r'), catalog.items[0].coverage);
  assert.equal(requests.at(-1), '/api/v1/learning/practice/papers/p%2Fa/progress?releaseId=r');
  for (coverage of [undefined, {...rawCoverage, releaseId:'old'}, {...rawCoverage, completedCount:-1}, {...rawCoverage, remainingUnseen:30}]) {
    assert.equal((await service.listPublishedPapers()).items[0].coverage, null);
    assert.equal(await service.getPaperCoverage('p', 'r'), null);
  }
});

async function resultPage(coverage = rawCoverage) {
  const { page, navigation } = await loadPage('result', {
    getReport: async () => ({paperName:'试卷', counts:{total:5}}),
    getSession: async () => ({paperId:'p',releaseId:'r',mode:'practice',questions:[],answers:{}}),
    getPaperCoverage: async () => typeof coverage === 'function' ? coverage() : coverage,
    messageOf: e => e.message,
  });
  page.data.sessionId = 'finished';
  await page.loadResult();
  return {page, navigation};
}

test('result starts a fresh normal batch directly via existing setup, preserving release and default ten', async () => {
  const {page, navigation} = await resultPage();
  assert.equal(page.data.nextCount,10);
  assert.equal(page.data.coverage.remainingUnseen,3);
  page.onNextPractice(); page.onNextPractice();
  assert.equal(navigation.length,1);
  const query = Object.fromEntries(new URLSearchParams(navigation[0].url.split('?')[1]));
  const starts = [];
  const {page:setup,navigation:opened} = await loadPage('practice-setup', { MODE_CHOICES:[], startSession:async input=>{starts.push(input);return {id:'new'};} });
  setup.onLoad(query); await setup.onReady();
  assert.deepEqual(starts,[{paperId:'p',releaseId:'r',mode:'normal',count:10,order:'paper'}]);
  assert.match(opened[0].url,/sessionId=new/);
});

test('short paper caps next batch; all-seen report retains review action', async () => {
  const {page} = await resultPage({...rawCoverage,totalCount:3,completedCount:3,remainingUnseen:0});
  assert.equal(page.data.nextCount,3);
  page.onNextPractice();
  assert.equal(page.data.openingNext,true);
});

test('coverage failure leaves report usable, retries fresh server totals, and navigation failure is retryable', async () => {
  let response = null;
  const {page,navigation} = await resultPage(() => {
    if (response instanceof Error) throw response;
    return response;
  });
  assert.equal(page.data.error,'');
  assert.ok(page.data.coverageError);
  page.onNextPractice(); assert.equal(navigation.length,0);
  response = Error('offline'); await page.loadCoverage();
  assert.equal(page.data.coverageError,'offline');
  assert.equal(page.data.coverageLoading,false);
  response = rawCoverage; await page.loadCoverage();
  assert.equal(page.data.coverageError,'');
  assert.equal(page.data.nextCount,10);
  response = {...rawCoverage,completedCount:23,remainingUnseen:0};
  await page.loadCoverage();
  assert.equal(page.data.coverage.remainingUnseen,0);
  page.onNextPractice(); navigation[0].fail();
  assert.equal(page.data.openingNext,false);
  assert.ok(page.data.nextError);
  page.onNextPractice(); assert.equal(navigation.length,2);
});

test('next batch shares resumable-session choice and preserves old work when cancelled', async () => {
  class ApiError extends Error {
    code = 'RESUMABLE_SESSION_EXISTS';
    detail = {detail:{sessionId:'old'}};
  }
  let attempts = 0, confirm = false, abandoned = 0;
  const {page,navigation} = await loadPage('practice-setup', {
    MODE_CHOICES:[], ApiError, messageOf:e=>e.message,
    startSession:async()=>{attempts++; throw new ApiError('unfinished');},
    abandonSession:async()=>{abandoned++;},
  }, {showModal:async()=>({confirm})});
  page.onLoad({paperId:'p',releaseId:'r',count:'23',short:'1'});
  await page.onReady();
  assert.equal(page.data.existingSessionId,'old');
  assert.equal(page.data.starting,false);
  assert.equal(navigation.length,0);
  await page.onRestartExisting();
  assert.equal(abandoned,0);
  await page.start();
  assert.equal(attempts,1);
  assert.match(navigation.at(-1).url,/sessionId=old/);
});

test('next batch start failure is recoverable and short papers use the actual count', async () => {
  class ApiError extends Error {}
  let denied = true;
  const starts = [];
  const {page,navigation} = await loadPage('practice-setup', {
    MODE_CHOICES:[], ApiError, messageOf:e=>e.message,
    startSession:async input=>{starts.push(input); if(denied) throw new ApiError('试卷暂不可用');return {id:'new'};},
  });
  page.onLoad({paperId:'p',releaseId:'r',count:'3',short:'1',mode:'scholar'});
  await page.onReady(); assert.equal(page.data.starting,false); assert.equal(page.data.error,'试卷暂不可用');
  denied=false; await page.start(); assert.equal(page.data.error,'');
  assert.equal(starts[1].count,3); assert.equal(starts[1].mode,'normal');
  assert.match(navigation.at(-1).url,/sessionId=new/);
});


test('restart locks the real dialog queue before awaiting confirmation and releases on cancel', async () => {
  const {createDialogController} = await import('../domain/dialog.ts');
  let view, confirmations=0, abandons=0, starts=0;
  const dialog=createDialogController(value=>{view=value;if(value.visible)confirmations++;});
  const {page}=await loadPage('practice-setup', {MODE_CHOICES:[],showDialog:options=>dialog.open(options),
    getSession:async()=>({revision:1}), abandonSession:async()=>{abandons++;},
    startSession:async()=>{starts++;return {id:'new'};},messageOf:e=>e.message});
  page.data.existingSessionId='old';
  const cancelled=page.onRestartExisting(); assert.equal(page.data.starting,true); await page.onRestartExisting();
  assert.equal(confirmations,1);
  dialog.settle(view.id,false); await cancelled;
  assert.equal(page.data.starting,false); assert.equal(abandons,0);
  const confirmed=page.onRestartExisting(); await page.onRestartExisting();
  assert.equal(confirmations,2);
  dialog.settle(view.id,true);await confirmed;
  assert.equal(abandons,1);assert.equal(starts,1);
});
