import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule,loadPage} from './helpers/page-harness.mjs';
import {assignPair,pairLabel} from '../domain/pc-practice.ts';

test('free catalog route clears previous member search and carries quick intent only once',async()=>{
 const routing=await loadModule('domain/navigation.ts',{wx:{reLaunch(){},showToast(){}}},['openPaperCatalog','consumePaperMode','consumePaperOptions']);
 routing.openPaperCatalog('normal',{access:'free',quick:true});
 const {page,navigation}=await loadPage('papers',{...routing,selectPrimaryTab(){}});
 page.setData({lastLoadedAt:Date.now(),search:'old',subject:'old',access:'member',mode:'scholar',papers:[{title:'free',subject:'PMP',accessLevel:'free'},{title:'member',subject:'PMP',accessLevel:'member'}]});
 page.onShow();assert.deepEqual([page.data.search,page.data.subject,page.data.access,page.data.mode,page.data.quick],['','全部科目','free','normal',true]);assert.equal(page.data.filtered.length,1);
 assert.equal(routing.consumePaperOptions(),null);
 await page.onSelectPaper({detail:{item:{paperId:'p',releaseId:'r',title:'free',questionCount:20}}});
 assert.equal(new URL('https://test'+navigation.at(-1).url).searchParams.get('quick'),'1');
 page.onMode({currentTarget:{dataset:{mode:'scholar'}}});assert.equal(page.data.quick,false);
});
test('failed free catalog navigation does not leak its filter into the next tab visit',async()=>{
 const routing=await loadModule('domain/navigation.ts',{wx:{reLaunch:o=>o.fail(),showToast(){}}},['openPaperCatalog','consumePaperMode','consumePaperOptions']);
 routing.openPaperCatalog('normal',{access:'free',quick:true});assert.equal(routing.consumePaperMode(),null);assert.equal(routing.consumePaperOptions(),null);
});
test('quick setup starts at most five available questions and cannot start twice while pending',async()=>{
 for(const [total,want] of [[185,5],[3,3]]){
  let resolve;const calls=[];
  const {page,navigation}=await loadPage('practice-setup',{MODE_CHOICES:[],ApiError:class extends Error{},messageOf:e=>e.message,startSession:input=>{calls.push(input);return new Promise(r=>resolve=r);}});
  page.onLoad({paperId:'p',releaseId:'r',count:String(total),quick:'1',mode:'scholar'});
  const pending=page.onReady();await page.start();assert.equal(calls.length,1);assert.deepEqual(calls[0],{paperId:'p',releaseId:'r',mode:'normal',count:want,order:'paper'});
  resolve({id:'s'});await pending;assert.equal(navigation.at(-1).url,'/pages/practice/index?sessionId=s');
 }
});
test('ordinary setup waits for the user and includes a five-question choice on long papers',async()=>{
 let calls=0;const {page}=await loadPage('practice-setup',{MODE_CHOICES:[],startSession:async()=>{calls++;return{id:'s'};}});
 page.onLoad({count:'185'});await page.onReady();assert.equal(calls,0);assert.equal(page.data.count,10);assert.ok(page.data.countChoices.some(c=>c.value===5));
});
test('inline matching collapses on cancel and assignment, and locks after submission',async()=>{
 let definition;await loadModule('components/question-view/index.ts',{Component:x=>definition=x,assignPair,pairLabel},[]);
 const changes=[];const component={...definition.methods,data:{...definition.data},properties:{question:{id:'q',matching:{left:[{id:'l'}],right:[{id:'r'}]}},selectedPairs:{},submitted:false},setData(v){Object.assign(this.data,v);},triggerEvent(n,v){changes.push(v);}};
 const tap=id=>({currentTarget:{dataset:{id}}});component.chooseLeft(tap('l'));assert.equal(component.data.activeLeft,'l');component.chooseLeft(tap('l'));assert.equal(component.data.activeLeft,'');
 component.chooseLeft(tap('l'));component.chooseRight(tap('r'));assert.equal(component.data.activeLeft,'');assert.deepEqual(changes,[{selectedPairs:{l:'r'}}]);
 component.properties.submitted=true;component.chooseLeft(tap('l'));component.chooseRight(tap('r'));assert.equal(changes.length,1);
});
test('analysis disclosure requires answered state and policy, and resets when changing questions',async()=>{
 let definition;await loadModule('components/question-view/index.ts',{Component:x=>definition=x,assignPair,pairLabel},[]);
 const component={...definition.methods,data:{...definition.data},properties:{allowAnalysis:true,showResult:false},setData(v){Object.assign(this.data,v);},loadAssets(){}};
 component.toggleAnalysis();assert.equal(component.data.analysisExpanded,false);
 component.properties.showResult=true;component.properties.allowAnalysis=false;component.toggleAnalysis();assert.equal(component.data.analysisExpanded,false);
 component.properties.allowAnalysis=true;component.toggleAnalysis();assert.equal(component.data.analysisExpanded,true);
 Object.values(definition.observers)[0].call(component,{id:'new',options:[]},[],false,false,{});assert.equal(component.data.analysisExpanded,false);
});
test('six to nine question papers retain full-paper practice alongside the quick five choice',async()=>{
 for(const total of [6,7,8,9]){
  const {page}=await loadPage('practice-setup',{MODE_CHOICES:[]});page.onLoad({count:String(total)});
  assert.deepEqual(page.data.countChoices.map(c=>c.value),[5,total]);assert.equal(page.data.count,total);
  page.onLoad({count:String(total),quick:'1'});assert.equal(page.data.count,5);
 }
});
