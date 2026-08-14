'use strict';

/*
 * G5 · Workspace 服务器化：共享草稿自动保存 / 恢复 / 冲突处理（P4.5.29 差异 22–23）
 *
 * 覆盖：
 * 1. 编辑（markWorkspaceDirty）后防抖调度自动保存，多次编辑合并
 * 2. 自动保存失败保留 dirty 并显示可重试错误（不显示虚假成功）
 * 3. draft revision 冲突禁止静默覆盖：复制冲突副本为新草稿 / 放弃本地并重载
 * 4. 页面加载时按上次 draftId 自动恢复；草稿不存在时清除记录
 */

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const evalIn=(ctx,code)=>vm.runInContext(code,ctx);

function buildHarness(){
  const timers=[];
  const store=new Map();
  const elementStub={textContent:'',className:'',classList:{add(){},remove(){}},innerHTML:'',disabled:false,appendChild:()=>{}};
  const document={getElementById:id=>id==='toast'?elementStub:null,body:{},createElement:()=>elementStub};
  const window={
    __KG_DIRECT_BOOTSTRAP__:{},
    crypto:{randomUUID:()=>'11111111-1111-4111-8111-111111111111'},
    addEventListener:()=>{},
    localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
  };
  const context=vm.createContext({
    window,document,localStorage:window.localStorage,crypto:window.crypto,
    Date,JSON,Math,Map,Set,Array,Object,String,Number,console,Promise,
    setTimeout:fn=>{timers.push(fn);return timers.length},
    clearTimeout:id=>{const index=Number(id)-1;if(index>=0&&index<timers.length)timers[index]=null},setInterval:()=>0,
    confirm:()=>true,prompt:()=>'',alert:()=>{},
    Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},
  });
  ['00-core-bootstrap.js','10-state-domain.js','12-p45-authoring-domain.js','38-shared-draft-autosave.js'].forEach(name=>{
    vm.runInContext(source(name),context,{filename:name});
  });
  return {context,timers,store};
}

async function main(){
  /* ── 1. 防抖调度与合并 ──────────────────────────────────── */
  {
    const {context,timers}=buildHarness();
    evalIn(context,`
      window.__saved=[];
      window.PMPPrepDraftUi={save:async()=>{window.__saved.push('ok');return {id:'d1',revision:2,title:'T'}}};
      prepRuntime.draftId='d1';prepRuntime.dirty=false;
    `);
    evalIn(context,'markWorkspaceDirty()');
    assert.equal(timers.length,1,'编辑后应调度一次防抖自动保存');
    evalIn(context,'markWorkspaceDirty()');
    assert.ok(timers.length>=2,'再次编辑重新调度');
    for(const fn of timers)if(fn)await fn();
    // 只有最后一个防抖回调真正执行保存（前面的被 clearTimeout 逻辑合并）
    const saved=evalIn(context,'window.__saved.length');
    assert.equal(saved,1,'防抖合并为一次保存');
  }

  /* ── 2. 失败保留 dirty + 可重试提示 ─────────────────────── */
  {
    const {context}=buildHarness();
    evalIn(context,`
      window.__fails=0;window.__status='';
      window.PMPPrepDraftUi={save:async()=>{window.__fails++;throw Object.assign(new Error('无法连接服务器'),{code:'NETWORK_ERROR'})}};
      prepRuntime.draftId='d2';prepRuntime.dirty=true;
      updateWorkspaceSaveStatus=function(m){window.__status=m};
    `);
    const result=await evalIn(context,'(async()=>{try{await window.PMPPrepAutosave.runNow()}catch(e){}return {dirty:prepRuntime.dirty,status:window.__status,fails:window.__fails}})()');
    assert.equal(result.fails,1);
    assert.equal(result.dirty,true,'自动保存失败必须保留 dirty');
    assert.ok(result.status.includes('自动保存失败'),'显示失败提示');
    assert.ok(result.status.includes('重试'),'提示可重试');
  }

  /* ── 3a. revision 冲突 → 复制冲突副本 ───────────────────── */
  {
    const {context}=buildHarness();
    evalIn(context,`
      window.__created=[];
      window.PMPPrepDraftUi={save:async()=>{throw Object.assign(new Error('服务器数据已变化，请重新载入后再试。'),{code:'CONFLICT',status:409})}};
      confirm=()=>true;   // 选择“复制本地为新草稿”
      prompt=()=>'冲突副本标题';
      window.PMPPrepSharedDraftsForTest={create:async payload=>{window.__created.push(payload);return {id:'d-new',revision:1,title:payload.title}}};
      prepRuntime.draftId='d3';prepRuntime.dirty=true;prepRuntime.draftTitle='原草稿';
      window.PMPPrepAutosave.bindDrafts(window.PMPPrepSharedDraftsForTest);
    `);
    const created=JSON.parse(await evalIn(context,'(async()=>{try{await window.PMPPrepAutosave.runNow()}catch(e){}return JSON.stringify(window.__created.map(p=>p.title))})()'));
    assert.deepEqual(created,['冲突副本标题'],'409 选择复制副本时应把本地内容另存新草稿');
    const state=await evalIn(context,'(async()=>({draftId:prepRuntime.draftId,dirty:prepRuntime.dirty}))()');
    assert.equal(state.draftId,'d-new','切换到新草稿');
    assert.equal(state.dirty,false,'副本保存成功后 dirty 清除');
  }

  /* ── 3b. revision 冲突 → 放弃本地并重新载入 ─────────────── */
  {
    const {context}=buildHarness();
    evalIn(context,`
      window.__opened=[];
      window.PMPPrepDraftUi={
        save:async()=>{throw Object.assign(new Error('服务器数据已变化'),{code:'CONFLICT',status:409})},
        openDraft:async id=>{window.__opened.push(id)},
      };
      let step=0;confirm=()=>{step++;return step===1?false:true};  // 第一次拒绝复制，第二次接受“放弃并重载”
      prepRuntime.draftId='d3b';prepRuntime.dirty=true;prepRuntime.draftTitle='原草稿';
    `);
    evalIn(context,'(async()=>{try{await window.PMPPrepAutosave.runNow()}catch(e){}})()');
    await new Promise(resolve=>setImmediate(resolve));
    const opened=JSON.parse(evalIn(context,'JSON.stringify(window.__opened)'));
    assert.deepEqual(opened,['d3b'],'放弃本地后应重新载入服务器草稿');
  }

  /* ── 4. 自动恢复 / 404 清除记录 ─────────────────────────── */
  {
    const {context,store}=buildHarness();
    store.set('prep.lastDraftId','d-gone');
    evalIn(context,`
      window.__applied=[];
      window.PMPPrepSharedDraftsForTest={get:async id=>{const e=new Error('草稿不存在');e.status=404;throw e}};
      window.PMPPrepDraftUi={openDraft:async id=>{window.__applied.push(id)}};
      window.PMPPrepAutosave.bindDrafts(window.PMPPrepSharedDraftsForTest);
    `);
    await evalIn(context,'(async()=>window.PMPPrepAutosave.restoreLastDraft())()');
    assert.deepEqual(JSON.parse(evalIn(context,'JSON.stringify(window.__applied)')),[],'草稿不存在不应打开');
    assert.equal(store.get('prep.lastDraftId'),undefined,'404 后清除本地记录');
  }
  {
    const {context,store}=buildHarness();
    store.set('prep.lastDraftId','d-live');
    evalIn(context,`
      window.__opened=[];
      window.PMPPrepSharedDraftsForTest={get:async id=>({id,title:'活草稿',revision:2,payload:{prepStudioWorkspaceVersion:4}})};
      window.PMPPrepDraftUi={openDraft:async id=>{window.__opened.push(id)}};
      window.PMPPrepAutosave.bindDrafts(window.PMPPrepSharedDraftsForTest);
    `);
    await evalIn(context,'(async()=>window.PMPPrepAutosave.restoreLastDraft())()');
    assert.deepEqual(JSON.parse(evalIn(context,'JSON.stringify(window.__opened)')),['d-live'],'登录后自动恢复上次打开的共享草稿');
  }

  console.log('shared-draft-autosave: passed');
}

main().catch(error=>{console.error(error);process.exit(1)});
