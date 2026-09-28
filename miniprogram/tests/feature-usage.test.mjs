import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {loadModule} from './helpers/page-harness.mjs';
async function setup(){
  let now=Date.UTC(2026,8,28),token='A',interval;
  const requests=[],root={};
  vm.runInNewContext(readFileSync(new URL('../domain/feature-usage-clock.js',import.meta.url),'utf8'),{globalThis:root});
  const api=await loadModule('services/feature-usage.ts',{
    create:root.KGUsageClock.create,Date:class extends Date{static now(){return now}},
    getSessionToken:()=>token,getApiBaseUrl:()=>'',setInterval:fn=>{interval=fn;return 1},clearInterval:()=>{interval=null},
    wx:{request:o=>requests.push(o)},
  },['usageShow','usageHide','usageTouch','usageBackground']);
  return {api,requests,step:n=>now+=n*1000,tick:()=>interval?.(),token:v=>token=v};
}
test('mini lifecycle reports visible foreground and excludes app background',async()=>{
 const x=await setup(),page={route:'pages/practice/index',data:{}};x.api.usageShow(page);x.step(15);x.tick();
 assert.equal(x.requests.length,1);assert.equal(x.requests[0].data.foregroundSeconds,15);
 x.requests[0].success({statusCode:201});x.requests[0].complete();x.api.usageBackground();x.step(60);x.tick();assert.equal(x.requests.length,1);
});
test('mini retries use same event id and account changes discard queued counters',async()=>{
 const x=await setup(),page={usageFeature:'home',data:{}};x.api.usageShow(page);x.step(15);x.tick();const first=x.requests[0];first.complete();
 x.step(15);x.tick();assert.equal(x.requests[1].data.eventId,first.data.eventId);x.requests[1].complete();x.token('B');x.step(15);x.tick();
 assert.ok(x.requests.slice(2).every(r=>r.header.Authorization==='Bearer B'));
});
test('only visible primary panel is counted; host lifecycle cannot replace it',async()=>{
 const x=await setup(),home={usageFeature:'home',data:{}},host={route:'pages/tabs/index',data:{}};
 x.api.usageShow(home);x.api.usageShow(host);x.step(15);x.tick();assert.equal(x.requests[0].data.featureKey,'home');
});
test('shared clock copies are identical',()=>assert.equal(readFileSync(new URL('../domain/feature-usage-clock.js',import.meta.url),'utf8'),readFileSync(new URL('../../new-legacy/src/feature-usage-clock.js',import.meta.url),'utf8')));

test('scrolls from the visible tabs host keep its active panel effective after the idle window',async()=>{
 const x=await setup(),home={usageFeature:'home',data:{}},hidden={usageFeature:'papers',data:{}};
 const host={route:'pages/tabs/index',data:{activeTab:0},selectComponent:selector=>selector==='#panel-0'?home:hidden};
 x.api.usageShow(home);
 for(let step=0;step<10;step++){
  x.step(15);x.api.usageTouch(host);x.tick();
  const request=x.requests.at(-1);request.success({statusCode:201});request.complete();
 }
 assert.equal(x.requests.at(-1).data.featureKey,'home');
 assert.equal(x.requests.at(-1).data.activeSeconds,15);
});

test('hidden panels and restoring or hidden hosts do not renew effective activity',async()=>{
 const x=await setup(),home={usageFeature:'home',data:{}},hidden={usageFeature:'papers',data:{}};
 const host={route:'pages/tabs/index',data:{activeTab:0},restoringScroll:true,selectComponent:()=>home};
 x.api.usageShow(home);
 for(let step=0;step<10;step++){
  x.step(15);x.api.usageTouch(hidden);x.api.usageTouch(host);x.tick();
  const request=x.requests.at(-1);request.success({statusCode:201});request.complete();
 }
 assert.equal(x.requests.at(-1).data.activeSeconds,0);
 host.restoringScroll=false;host.hostHidden=true;x.api.usageTouch(host);x.step(15);x.tick();
 assert.equal(x.requests.at(-1).data.activeSeconds,0);
});

test('acknowledged backlog drains immediately without waiting for another sampling interval',async()=>{
 const x=await setup();x.api.usageShow({usageFeature:'home',data:{}});
 for(let i=0;i<3;i++){x.step(15);x.tick();}
 assert.equal(x.requests.length,1);
 const first=x.requests[0];first.success({statusCode:201});first.complete();
 assert.equal(x.requests.length,2);
 assert.notEqual(x.requests[1].data.eventId,first.data.eventId);
 x.requests[1].success({statusCode:422});x.requests[1].complete();
 assert.equal(x.requests.length,3);
});

test('network failures, 500 and 429 do not cause a hot retry loop',async()=>{
 for(const statusCode of [0,500,429]){
  const x=await setup(),page={usageFeature:'home',data:{}};x.api.usageShow(page);
  x.step(15);x.tick();x.step(15);x.tick();
  if(statusCode)x.requests[0].success({statusCode});
  x.requests[0].complete();assert.equal(x.requests.length,1);
  x.api.usageTouch(page);assert.equal(x.requests.length,1,'touches during retry backoff do not resend');
  x.step(15);x.tick();assert.equal(x.requests.length,2);
  assert.equal(x.requests[1].data.eventId,x.requests[0].data.eventId);
 }
});

test('manual question analysis expansion changes category and respects forced analysis display',async()=>{
 const x=await setup(),page={route:'pages/practice/index',data:{showAnalysis:false,analysisExpanded:false,showResult:true,policy:{revealAfterAnswer:true}}};
 x.api.usageShow(page);x.step(15);x.tick();x.requests[0].success({statusCode:201});x.requests[0].complete();
 page.data.analysisExpanded=true;x.api.usageTouch(page);x.step(15);x.tick();
 assert.equal(x.requests.at(-1).data.featureKey,'analysis');x.requests.at(-1).success({statusCode:201});x.requests.at(-1).complete();
 page.data.analysisExpanded=false;page.data.showAnalysis=true;x.api.usageTouch(page);x.step(15);x.tick();
 assert.equal(x.requests.at(-1).data.featureKey,'analysis');
});

test('the real question component emits expanded analysis state and resets it for another question',async()=>{
 let definition;
 await loadModule('components/question-view/index.ts',{Component:value=>{definition=value}},[]);
 const events=[],component={properties:{allowAnalysis:true,showResult:true,question:{id:'q1'}},data:{questionKey:'q1',analysisExpanded:false},setData(values){Object.assign(this.data,values)},triggerEvent:(name,detail)=>events.push({name,detail})};
 definition.methods.toggleAnalysis.call(component);
 assert.equal(events.at(-1)?.name,'analysischange');assert.equal(events.at(-1).detail.expanded,true);assert.equal(events.at(-1).detail.questionId,'q1');
 definition.observers['question, selectedIds, showAnalysis, showResult, selectedPairs'].call(component,{id:'q2',options:[]},[],false,false,{});
 assert.equal(component.data.analysisExpanded,false);assert.equal(events.at(-1).detail.expanded,false);assert.equal(events.at(-1).detail.questionId,'q2');
});

test('practice handles component analysis events at the actual category boundary, ignoring stale question events',async()=>{
 const {loadPage}=await import('./helpers/page-harness.mjs');
 const {getModePolicy}=await import('../domain/mode-policy.ts');
 const x=await setup();
 const {page}=await loadPage('practice',{getModePolicy,...x.api});
 page.route='pages/practice/index';page.data.currentQuestion={id:'q1'};page.data.showResult=true;x.api.usageShow(page);x.step(10);
 assert.equal(typeof page.onAnalysisChange,'function');
 page.onAnalysisChange({detail:{questionId:'q1',expanded:true}});
 assert.equal(x.requests[0].data.featureKey,'practice');assert.equal(x.requests[0].data.foregroundSeconds,10);
 x.requests[0].success({statusCode:201});x.requests[0].complete();x.step(15);x.tick();
 assert.equal(x.requests.at(-1).data.featureKey,'analysis');
 page.onAnalysisChange({detail:{questionId:'old-question',expanded:false}});assert.equal(page.data.analysisExpanded,true);
});


test('retained expanded state does not count an analysis hidden by unanswered state or mode policy',async()=>{
 for(const data of [{showResult:false,policy:{revealAfterAnswer:true}},{showResult:true,policy:{revealAfterAnswer:false}}]){
  const x=await setup();x.api.usageShow({route:'pages/practice/index',data:{...data,analysisExpanded:true}});x.step(15);x.tick();
  assert.equal(x.requests[0].data.featureKey,'practice');
 }
});
