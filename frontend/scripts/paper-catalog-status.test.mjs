import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('catalog separates loading, failure, successful retry and true empty result',async()=>{
 let resolve,reject;const events=[];const w={KGDomainApi:{request:()=>new Promise((a,b)=>{resolve=a;reject=b})},addEventListener(){},dispatchEvent:e=>events.push(e.type)};
 w.window=w;w.CustomEvent=class{constructor(type){this.type=type}};
 vm.runInNewContext(readFileSync('scripts/new-legacy-assets/paper-release-adapter.js','utf8'),w);
 assert.equal(w.KGPaperReleaseApi.catalogStatus(),'loading');reject(Error('offline'));await w.KGPaperReleaseApi.ready();
 assert.equal(w.KGPaperReleaseApi.catalogStatus(),'error');assert.ok(w.KGPaperReleaseApi.error());
 const retry=w.KGPaperReleaseApi.reload();assert.equal(w.KGPaperReleaseApi.catalogStatus(),'loading');resolve({releases:[],total:0});await retry;
 assert.equal(w.KGPaperReleaseApi.catalogStatus(),'ready');assert.equal(w.KGPaperReleaseApi.error(),null);assert.equal(w.KGPaperReleaseApi.catalog().length,0);
 assert.ok(events.filter(e=>e==='kg:published-papers-changed').length>=3);
});
