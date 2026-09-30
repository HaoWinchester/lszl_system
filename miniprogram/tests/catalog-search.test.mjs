import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage, loadModule } from './helpers/page-harness.mjs';
const paper = id => ({paperId:id,releaseId:id,title:id,subject:'PMP',accessLevel:'free',questionCount:10});
const tick = () => new Promise(resolve => setImmediate(resolve));

test('keyword/subject/access changes query the full catalog from page one and retain full subject options', async () => {
  const calls=[];
  const {page}=await loadPage('papers',{messageOf:e=>e.message,listPublishedPapers:async(p,n,filters)=>{
    calls.push([p,n,filters]);return {items:filters?.search?[paper('item-21')]:Array.from({length:20},(_,i)=>paper(`item-${i}`)),total:filters?.search?1:24,subjects:['PMP','ACP']};
  }});
  await page.loadPapers();assert.deepEqual(page.data.subjects,['全部科目','PMP','ACP']);
  page.onSearch({detail:{value:'后面的试卷'}});await tick();
  assert.equal(page.data.filtered[0].releaseId,'item-21');assert.equal(page.data.total,1);assert.equal(page.data.hasMore,false);
  page.onSubject({currentTarget:{dataset:{subject:'ACP'}}});await tick();
  page.onAccess({currentTarget:{dataset:{access:'member'}}});await tick();
  assert.deepEqual(calls.at(-1),[1,20,{search:'后面的试卷',subject:'ACP',access:'member'}]);
  page.clearFilters();await tick();assert.deepEqual(calls.at(-1),[1,20,{search:'',subject:'',access:'all'}]);
});

test('an older search and load-more response cannot overwrite the latest search or its loading state',async()=>{
  const pending=[];
  const {page}=await loadPage('papers',{messageOf:e=>e.message,listPublishedPapers:(p,n,f)=>new Promise((resolve,reject)=>pending.push({p,f,resolve,reject}))});
  const initial=page.loadPapers();pending[0].resolve({items:[paper('old')],total:40,subjects:['PMP']});await initial;
  const more=page.loadMore();page.onSearch({detail:{value:'new'}});await tick();
  assert.equal(pending.length,3);
  pending[1].resolve({items:[paper('old-page-2')],total:40,subjects:['PMP']});await more;
  assert.equal(page.data.loading,true);
  page.onSearch({detail:{value:'latest'}});await tick();
  pending[3].resolve({items:[paper('latest')],total:1,subjects:['PMP','ACP']});await tick();
  pending[2].reject(Error('stale failure'));await tick();
  assert.deepEqual(page.data.filtered.map(x=>x.releaseId),['latest']);assert.equal(page.data.error,'');assert.equal(page.fetching,false);
});

test('failed changed filters show a retryable error without stale results; retry keeps the same query',async()=>{
  let fail=false;
  const {page}=await loadPage('papers',{messageOf:e=>e.message,listPublishedPapers:async(p,n,f)=>{if(fail)throw Error('offline');return {items:[paper(f?.search||'old')],total:1,subjects:['PMP']};}});
  await page.loadPapers();fail=true;page.onSearch({detail:{value:'new'}});await tick();
  assert.equal(page.data.error,'offline');assert.deepEqual(page.data.filtered,[]);
  fail=false;await page.loadPapers();assert.equal(page.data.filtered[0].title,'new');assert.equal(page.data.error,'');
});

test('catalog request safely encodes filters and returns permitted subjects',async()=>{
  let path;
  const {listPublishedPapers}=await loadModule('services/papers.ts',{request:async options=>{path=options.path;return {releases:[],total:0,subjects:['PMP','ACP']};}},['listPublishedPapers']);
  const result=await listPublishedPapers(1,20,{search:'A & B',subject:'PMP',access:'member'});
  const query=new URL(path,'https://local.test').searchParams;
  assert.equal(query.get('search'),'A & B');assert.equal(query.get('subject'),'PMP');assert.equal(query.get('access'),'member');assert.deepEqual(result.subjects,['PMP','ACP']);
});
