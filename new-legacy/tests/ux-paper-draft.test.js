'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
function setup({quota=false}={}){
  const elements=Object.fromEntries(['paperNameInput','paperSubjectInput','paperTypeInput','paperTotalInput','paperCategoryInput','paperAccessLevelInput','paperDescriptionInput','qbPaperSaveState','pmCurrentPaperTitle'].map(id=>[id,{id,value:'',type:'text',dataset:{}}]));
  const quotaInput={id:'',type:'number',value:'0',dataset:{},closest:()=>({dataset:{domain:'D'}})};
  const quotaRow={dataset:{domain:'D'},querySelector:selector=>selector==='input'?quotaInput:{textContent:'D'}};
  if(quota){elements.qbPaperQuotaList={};elements.qbPaperPrincipleQuotaList={};elements.qbPaperDomainQuotaList={set innerHTML(value){quotaInput.value=String(value).match(/value="([^"]*)"/)?.[1]||'0'}}}
  const events={};let decision='stay',fail=false,hold=null,requestStarted=null,lastPayload=null;

  const context={console,URL,URLSearchParams,Date,JSON,Math,setTimeout,clearTimeout,location:{href:'http://localhost/paper-management.html',search:''},localStorage:{getItem(){return null}},document:{body:{dataset:{paperManagementPage:'true'}},getElementById:id=>elements[id]||null,querySelectorAll:selector=>selector.startsWith('#paperNameInput,')?[...Object.values(elements).filter(el=>el.id?.startsWith('paper')),...(quota?[quotaInput]:[])]:selector==='#qbPaperDomainQuotaList [data-domain]'&&quota?[quotaRow]:[],querySelector:()=>null,addEventListener:(name,fn)=>events[name]=fn},addEventListener(){},dispatchEvent(){},CustomEvent:class{},KGPaperDraftApi:{async update(id,payload){lastPayload=payload;requestStarted?.();if(hold)await hold;if(fail)throw Error('offline');return {id,...payload,revision:2,questions:[]}}}};
  context.window=context;context.globalThis=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'src/shared/unsaved-guard.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'../frontend/scripts/new-legacy-assets/paper-management-data-loader.js'),'utf8'),context);
  const create=context.KGUnsavedGuard.create;context.KGUnsavedGuard.create=options=>create({...options,choose:async()=>decision});
  let source=fs.readFileSync(path.join(root,'src/65-question-bank-admin.js'),'utf8');
  source=source.replace('  globalThis.KGQuestionBankAdminAPI=Object.freeze({',`  globalThis.draftTest={state, renderPaperManager, fillPaperForm, initPaperUnsavedGuard, readPaperDraft, applyPaperCatalogFilter, confirmPaperLeave, savePaperForm, applyPaperManagementSnapshot,autoDistributeQuota,clearPaperQuota,buildCurrentPaper,persistPaperQuestions,reloadPaperDrafts,selectPaperDraft:id=>typeof selectPaperDraft==='function'?selectPaperDraft(id):paperDataLoader.selectPaper(id),connectLoader(paperApi){catalogUiReady=true;paperDataLoader=window.KGPaperManagementDataLoader.create({paperApi,catalogApi:{ready:Promise.resolve(),snapshot:()=>({banks:[]})},onChange:applyPaperManagementSnapshot});return paperDataLoader},configureQuotaTest(){paperDomainStats=()=>[{domain:'D',count:10,complete:10}];paperPrincipleStats=()=>[];loadPaperQuotaCandidates=async()=>[];paperCandidates=()=>[{bank:{id:'b'},question:{id:'q'}}];paperAccepts=()=>true;supplementPaperDraft=paper=>({paper,addedQuestionIds:[],shortages:[]})}};\n  globalThis.KGQuestionBankAdminAPI=Object.freeze({`);
  vm.runInContext(source,context);
  const api=context.draftTest;api.state.papers=[{id:'p1',name:'Original',subject:'PMP',totalCount:180,questions:[],enabledModes:[],revision:1,accessPolicy:{}},{id:'p2',name:'Other',subject:'PMP',questions:[]}];api.state.selectedPaperId='p1';api.state.paperDetailReady=true;
  if(quota)api.configureQuotaTest();
  context.KGPaperDraftApi.replaceQuestions=async(id,payload)=>{requestStarted?.();if(hold)await hold;return {id,...lastPayload,...payload,questions:[],revision:3}};
  api.renderPaperManager();return {api,elements,quotaInput,choose:value=>decision=value,fail:value=>fail=value,payload:()=>lastPayload,holdNext(){let resume;hold=new Promise(resolve=>resume=resolve);return {started:new Promise(resolve=>requestStarted=resolve),resume}}};
}
test('paper candidate/background redraw preserves raw name, description and invalid numeric input',()=>{
 const {api,elements}=setup();elements.paperNameInput.value='  unsaved  ';elements.paperDescriptionInput.value='not sent';elements.paperTotalInput.value='';
 api.renderPaperManager();assert.equal(elements.paperNameInput.value,'  unsaved  ');assert.equal(elements.paperDescriptionInput.value,'not sent');assert.equal(elements.paperTotalInput.value,'');assert.equal(elements.qbPaperSaveState.textContent,'有未保存的修改');
});
test('cancel search/category/status keeps the same selected paper and raw draft',async()=>{
 const {api,elements}=setup();elements.paperNameInput.value='draft';await api.applyPaperCatalogFilter({search:'Other',category:'missing',status:'published'});
 assert.equal(api.state.selectedPaperId,'p1');assert.equal(api.state.paperListSearch,'');assert.equal(api.state.paperCategoryFilter,'ALL');assert.equal(elements.paperNameInput.value,'draft');
});
test('failed save blocks leaving, successful save allows it, discard restores persisted fields',async()=>{
 const {api,elements,choose,fail}=setup();elements.paperNameInput.value='draft';choose('save');fail(true);
 assert.equal(await api.confirmPaperLeave(),false);assert.equal(elements.paperNameInput.value,'draft');assert.equal(api.state.selectedPaperId,'p1');
 fail(false);assert.equal(await api.confirmPaperLeave(),true);assert.equal(api.state.papers[0].name,'draft');
 elements.paperNameInput.value='discard this';choose('discard');assert.equal(await api.confirmPaperLeave(),true);assert.equal(elements.paperNameInput.value,'draft');
});
test('background snapshot cannot switch an edited paper',()=>{
 const {api,elements}=setup();elements.paperDescriptionInput.value='keep';
 api.applyPaperManagementSnapshot({papers:[{id:'p2',name:'Other',subject:'PMP'}],selectedPaperId:'p2',selectedPaper:{id:'p2',name:'Other',subject:'PMP'}});
 assert.equal(api.state.selectedPaperId,'p1');assert.equal(elements.paperDescriptionInput.value,'keep');assert.ok(api.state.papers.some(p=>p.id==='p1'));
});

test('automatic distribution reflects saved quotas and the next save cannot restore old values',async()=>{
 const {api,elements,quotaInput,payload}=setup({quota:true});elements.paperTotalInput.value='4';await api.autoDistributeQuota();
 assert.equal(quotaInput.value,'4');assert.equal(elements.qbPaperSaveState.textContent,'已保存');await api.savePaperForm();assert.equal(payload().quotas.domainQuotas.D,4);
});
test('clear saves current metadata and synchronizes the cleared quota',async()=>{
 const {api,elements,quotaInput,payload}=setup({quota:true});elements.paperNameInput.value='renamed';quotaInput.value='3';await api.clearPaperQuota();
 assert.equal(quotaInput.value,'0');assert.equal(payload().name,'renamed');assert.equal(elements.qbPaperSaveState.textContent,'已保存');
});
test('quota success refreshes untouched fields while preserving text typed during the request',async()=>{
 const {api,elements,quotaInput,holdNext,payload}=setup({quota:true});elements.paperTotalInput.value='4';const gate=holdNext();const task=api.autoDistributeQuota();await gate.started;
 elements.paperDescriptionInput.value='new text during save';gate.resume();await task;
 assert.equal(quotaInput.value,'4');assert.equal(elements.paperDescriptionInput.value,'new text during save');assert.equal(elements.qbPaperSaveState.textContent,'有未保存的修改');await api.savePaperForm();assert.equal(payload().quotas.domainQuotas.D,4);
});
test('quota edits made during a derived save remain dirty and are not overwritten',async()=>{
 const {api,elements,quotaInput,holdNext}=setup({quota:true});elements.paperTotalInput.value='4';const gate=holdNext();const task=api.autoDistributeQuota();await gate.started;quotaInput.value='2';gate.resume();await task;
 assert.equal(quotaInput.value,'2');assert.equal(elements.qbPaperSaveState.textContent,'有未保存的修改');assert.equal(api.state.papers[0].domainQuotas.D,4);
});
test('build synchronizes committed metadata and marks the successful draft clean',async()=>{
 const {api,elements}=setup({quota:true});elements.paperDescriptionInput.value='build draft';await api.buildCurrentPaper();assert.equal(api.state.papers[0].description,'build draft');assert.equal(elements.qbPaperSaveState.textContent,'已保存');
});
test('a failed derived save retains original quota input and unsaved metadata',async()=>{
 const {api,elements,quotaInput,fail}=setup({quota:true});elements.paperTotalInput.value='4';quotaInput.value='2';fail(true);await api.autoDistributeQuota();assert.equal(quotaInput.value,'2');assert.equal(elements.paperTotalInput.value,'4');
 api.renderPaperManager();assert.equal(elements.qbPaperSaveState.textContent,'有未保存的修改');
});
test('normal save rebases normalized saved fields without clearing edits made while pending',async()=>{
 const {api,elements,holdNext}=setup();elements.paperNameInput.value='  trimmed name  ';const gate=holdNext();const task=api.savePaperForm();await gate.started;elements.paperDescriptionInput.value='later input';gate.resume();await task;
 assert.equal(elements.paperNameInput.value,'trimmed name');assert.equal(elements.paperDescriptionInput.value,'later input');assert.equal(elements.qbPaperSaveState.textContent,'有未保存的修改');
});

function realLoaderFixture(api){
 const papers=JSON.parse(JSON.stringify(api.state.papers));let resolveReady=null,resolveDetail=null,blockReady=false,blockDetail=false;
 const loader=api.connectLoader({ready:async()=>{if(blockReady)await new Promise(resolve=>resolveReady=resolve);return {papers,categories:[]}},detail:async id=>{if(blockDetail)await new Promise(resolve=>resolveDetail=resolve);return papers.find(paper=>paper.id===id)}});
 return {loader,blockReady:()=>blockReady=true,releaseReady:()=>resolveReady(),blockDetail:()=>blockDetail=true,releaseDetail:()=>{blockDetail=false;resolveDetail()}};
}
test('real loader loading then detail snapshots do not turn a clean selection into a dirty draft',async()=>{
 const {api,elements}=setup();const fixture=realLoaderFixture(api);await fixture.loader.initialize({preferredPaperId:'p1'});fixture.blockDetail();
 const selecting=api.selectPaperDraft('p2');await Promise.resolve();assert.equal(api.state.selectedPaperId,'p2');assert.notEqual(elements.qbPaperSaveState.textContent,'有未保存的修改');fixture.releaseDetail();await selecting;
 assert.equal(elements.paperNameInput.value,'Other');assert.equal(api.state.selectedPaperId,'p2');assert.equal(elements.qbPaperSaveState.textContent,'已保存');
});
test('save-triggered delayed background refresh of A cannot undo explicit selection B',async()=>{
 const {api,elements,choose}=setup();const fixture=realLoaderFixture(api);await fixture.loader.initialize({preferredPaperId:'p1'});
 elements.paperNameInput.value='saved A';choose('save');assert.equal(await api.confirmPaperLeave(),true);
 fixture.blockReady();const refreshing=api.reloadPaperDrafts({selectedId:'p1'});await Promise.resolve();await api.selectPaperDraft('p2');assert.equal(elements.paperNameInput.value,'Other');
 fixture.releaseReady();await refreshing;assert.equal(api.state.selectedPaperId,'p2');assert.equal(elements.paperNameInput.value,'Other');assert.equal(elements.qbPaperSaveState.textContent,'已保存');
});

for(const operation of ['savePaperForm','autoDistributeQuota'])test(operation+' response for A cannot select A or copy current B input',async()=>{
 const {api,elements,holdNext}=setup({quota:true});const fixture=realLoaderFixture(api);await fixture.loader.initialize({preferredPaperId:'p1'});
 const gate=holdNext();const task=api[operation]();await gate.started;await api.selectPaperDraft('p2');elements.paperDescriptionInput.value='B unsaved only';gate.resume();await task;
 assert.equal(api.state.selectedPaperId,'p2');assert.equal(elements.paperNameInput.value,'Other');assert.equal(elements.paperDescriptionInput.value,'B unsaved only');assert.equal(api.state.papers.find(p=>p.id==='p1').name,'Original');assert.notEqual(api.state.papers.find(p=>p.id==='p1').description,'B unsaved only');
 if(operation==='autoDistributeQuota')assert.equal(api.state.papers.find(p=>p.id==='p1').domainQuotas.D,10);
});
test('question persistence for A updates A without selecting it after user switches to B',async()=>{
 const {api,elements,holdNext}=setup();const fixture=realLoaderFixture(api);await fixture.loader.initialize({preferredPaperId:'p1'});const draft={...api.state.papers[0]};
 const gate=holdNext();const task=api.persistPaperQuestions(draft);await gate.started;await api.selectPaperDraft('p2');gate.resume();await task;api.renderPaperManager();assert.equal(api.state.selectedPaperId,'p2');assert.equal(elements.paperNameInput.value,'Other');
});
