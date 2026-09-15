import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage, loadModule } from './helpers/page-harness.mjs';
import { pageRefreshMode } from '../domain/page-freshness.ts';
const paper = restricted => ({ paperId:'p', releaseId:'r', title:'项目管理', subject:'PMP', questionCount:10, accessLevel:'member', contentRestricted:restricted });

test('persistent catalog silently refreshes changed entitlements and withdrawn releases on stale return', async () => {
  let items = [paper(true), {...paper(false),releaseId:'withdrawn'}], calls = 0, offers = 0;
  const { page, navigation } = await loadPage('papers', { pageRefreshMode, selectPrimaryTab() {}, openMembershipOffer:async()=>{offers++;}, messageOf:e=>e.message, listPublishedPapers:async()=>{ calls++; return {items,total:items.length}; } });
  await page.loadPapers(); page.setData({mode:'scholar',search:'项目',subject:'PMP',access:'member',lastLoadedAt:Date.now()-31000});
  items=[paper(false)]; await page.onShow();
  assert.equal(calls,2); assert.equal(page.data.papers.length,1); assert.equal(page.data.filtered[0].contentRestricted,false);
  assert.deepEqual([page.data.mode,page.data.search,page.data.subject,page.data.access],['scholar','项目','PMP','member']);
  await page.onSelectPaper({detail:{item:page.data.filtered[0]}}); assert.match(navigation.at(-1).url,/mode=scholar/);
  await page.onShow(); assert.equal(calls,2,'fresh cached tab skips duplicate read');
  items=[paper(true)];page.setData({lastLoadedAt:Date.now()-31000});await page.onShow();await page.onSelectPaper({detail:{item:page.data.filtered[0]}});assert.equal(offers,1);assert.equal(navigation.length,1,'revoked entitlement must not enter setup');
});
test('silent catalog refresh guards concurrent calls, preserves stale display on failure and retries before access', async () => {
  let resolve, fail=false, slow=false, calls=0, notices=[];
  const {page,navigation}=await loadPage('papers',{pageRefreshMode,selectPrimaryTab(){},messageOf:e=>e.message,listPublishedPapers:async()=>{calls++;if(slow) await new Promise(r=>resolve=r);if(fail)throw Error('offline');return {items:[paper(false)],total:1};}}, {showToast:o=>notices.push(o.title)});
  await page.loadPapers();page.setData({lastLoadedAt:Date.now()-31000});slow=true;fail=true;
  const pending=page.onShow(); await page.onShow(); assert.equal(calls,2);assert.equal(page.data.loading,false);await page.onSelectPaper({detail:{item:paper(false)}});assert.equal(navigation.length,0);
  resolve();await pending;assert.equal(page.data.filtered.length,1);assert.equal(page.data.refreshError,'offline');assert.equal(page.fetching,false);await page.onSelectPaper({detail:{item:paper(false)}});assert.equal(navigation.length,0);
  slow=false;fail=false;await page.loadPapers();assert.equal(page.data.refreshError,'');await page.onSelectPaper({detail:{item:page.data.filtered[0]}});assert.equal(navigation.length,1);assert.equal(notices.length,2);
});
test('history/report round trips pop the existing history and never duplicate stack entries', async () => {
  const stack=[{route:'pages/growth/index'},{route:'pages/history/index'}];
  const {page}=await loadPage('result',{getCurrentPages:()=>stack},{navigateBack:o=>{stack.splice(stack.length-(o.delta||1));o.success?.();},redirectTo:o=>{stack[stack.length-1]={route:o.url.slice(1)};}});
  const {page:history}=await loadPage('history',{}, {navigateTo:o=>stack.push({route:o.url.slice(1).split('?')[0]})});
  for(let i=0;i<12;i++){history.onOpen({currentTarget:{dataset:{sessionId:'saved',kind:'report'}}});page.onBack();assert.deepEqual(stack.map(p=>p.route),['pages/growth/index','pages/history/index']);}
});
test('direct reports replace themselves with history; failed back navigation falls back visibly', async () => {
  let stack=[{route:'pages/result/index'}], redirects=[], notices=[];
  const {page}=await loadPage('result',{getCurrentPages:()=>stack},{navigateBack:o=>o.fail(),redirectTo:o=>{redirects.push(o.url);if(redirects.length===3)o.fail(Error('navigation unavailable'));},showToast:o=>notices.push(o.title)});
  page.onBack();assert.deepEqual(redirects,['/pages/history/index']);stack=[{route:'pages/history/index'},{route:'pages/result/index'}];page.onBack();assert.equal(redirects.length,2);page.onBack();assert.equal(notices.length,1);
});
test('compact membership summary deduplicates equal status and expiry while retaining real expiry', async()=>{
  const {subscriptionSummary}=await loadModule('domain/subscription-view.ts',{},['subscriptionSummary']);
  assert.equal(subscriptionSummary({statusLabel:'未开通',expiryLabel:'未开通'}),'未开通');
  assert.equal(subscriptionSummary({statusLabel:'生效中',expiryLabel:'2026.10.01 08:00'}),'生效中 · 2026.10.01 08:00');
});
