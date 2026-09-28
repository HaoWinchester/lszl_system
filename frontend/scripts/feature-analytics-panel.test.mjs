import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../new-legacy/src/36-system-settings.js',import.meta.url),'utf8');
function setup(){
 const pending=[];const fields={ssAnalyticsContent:{innerHTML:''},ssAnalyticsStart:{value:'2026-09-01'},ssAnalyticsEnd:{value:'2026-09-28'}};
 const scope={$:key=>fields[key],analyticsDate:()=>'',URLSearchParams,escapeHTML:s=>s,renderFeatureAnalytics:d=>{fields.ssAnalyticsContent.innerHTML=d.label},fetch:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
 vm.createContext(scope);vm.runInContext(source.slice(source.indexOf('  let analyticsRequest=0;'),source.indexOf('  function setTab(tab)')),scope);
 return {fields,pending,load:()=>scope.loadFeatureAnalytics()};
}
test('an older failed request cannot replace a newer successful filter result',async()=>{
 const x=setup();const old=x.load(),fresh=x.load();
 x.pending[1].resolve({ok:true,json:async()=>({label:'new filter'})});await fresh;
 x.pending[0].reject(Error('old failure'));await old;
 assert.equal(x.fields.ssAnalyticsContent.innerHTML,'new filter');
});
test('invalid date selection invalidates the previous in-flight result',async()=>{
 const x=setup();const old=x.load();x.fields.ssAnalyticsStart.value='2026-10-01';await x.load();
 x.pending[0].resolve({ok:true,json:async()=>({label:'stale'})});await old;
 assert.match(x.fields.ssAnalyticsContent.innerHTML,/开始日期不能晚于结束日期/);
});
