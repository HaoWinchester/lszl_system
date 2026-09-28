'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../src/65-question-bank-admin.js'),'utf8');
const start=source.indexOf('  async function syncRecallConfig(');
const code=source.slice(start,source.indexOf('  async function parseRecallLibrary(',start));
function runtime(){
  const bank={id:'b1',subject:'PMP'};
  const q={id:'q1',bankId:'b1',revision:4,clues:[],stemParts:[{text:'项目章程'}],status:{}};
  let server=structuredClone(q),fail=false;
  const messages=[],states=[];
  const fields={qbRecallKeywordsInput:{value:'项目章程'},qbRecallBindingsInput:{value:'项目章程 -> 入口'}};
  const context={state:{banks:[bank]},$:id=>fields[id],setRecallConfigSaveState:(...args)=>states.push(args),
    saveQuestionForm:async()=>{server=structuredClone(q);return true},currentQuestion:()=>q,currentBank:()=>bank,
    parseRecallBindings:()=>new Map([['项目章程','入口']]),keywordLocations:()=>[{field:'stem'}],
    recallLibraryApi:()=>null,normalizeClue:x=>x,slugify:x=>x,safeId:()=>'',
    rebuildStemParts:text=>[{text}],stemText:()=> '项目章程',stemClues:x=>x,
    saveBanks:()=>true,renderRecallConfig:()=>states.push(['saved']),toast:message=>messages.push(message),
    persistCatalogQuestionChanges:async rows=>{await Promise.resolve();if(fail)throw Error('network unavailable');server=structuredClone(rows[0]);},
  };
  vm.runInNewContext(code+'\nthis.run=syncRecallConfig;',context);
  return {context,run:context.run,server:()=>server,messages,states,setFail:value=>{fail=value},fields};
}
test('training save submits modified clues before declaring success',async()=>{
  const r=runtime();const result=await r.run();
  assert.equal(result.ok,true);assert.equal(r.server().clues.length,1,'saved training must survive reloading the server question');
  assert.equal(r.server().clues[0].recallNodeId,'入口');
});
test('failed training write keeps inputs and reports failure, then supports retry',async()=>{
  const r=runtime();r.setFail(true);const result=await r.run();
  assert.equal(result.ok,false,'must not report saved when final training request fails');
  assert.equal(r.fields.qbRecallKeywordsInput.value,'项目章程');
  assert.ok(!r.messages.some(message=>message.startsWith('已保存')));
  assert.equal(r.states.at(-1)[0],'dirty');
  r.setFail(false);assert.equal((await r.run()).ok,true);assert.equal(r.server().clues.length,1);
});
