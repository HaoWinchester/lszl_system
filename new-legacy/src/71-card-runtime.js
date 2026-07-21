'use strict';

/*
 * CardRuntime
 * 负责学习卡片挂载、更新、校验、错误隔离和命令转发。
 */
(function(global){
  const mounted=new Map();
  let bound=false;

  function registry(){return global.KGCardRegistry}
  function contract(){return global.KGCardContract}

  function findHost(cardId,root=document){
    return root.querySelector?.('[data-learning-card="'+String(cardId)+'"]')||null;
  }
  function setHostState(host,state,message=''){
    if(!host)return;
    host.dataset.cardRuntimeState=state;
    host.classList.toggle('learning-card-host--loading',state==='loading');
    host.classList.toggle('learning-card-host--ready',state==='ready');
    host.classList.toggle('learning-card-host--error',state==='error');
    if(message)host.dataset.cardRuntimeMessage=message;
    else delete host.dataset.cardRuntimeMessage;
  }
  function renderError(host,cardId,error){
    const message=String(error?.message||error||'未知错误');
    setHostState(host,'error',message);
    host.innerHTML='<div class="learning-card-error" role="alert">'
      +'<strong>学习卡片加载失败</strong>'
      +'<span>'+escapeHTML(message)+'</span>'
      +'<button type="button" data-card-retry="'+escapeHTML(cardId)+'">重新加载</button>'
      +'</div>';
    host.querySelector('[data-card-retry]')?.addEventListener('click',()=>mount(cardId,host,{replace:true}));
  }
  function escapeHTML(value){
    return String(value??'').replace(/[&<>"']/g,char=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[char]));
  }
  function buildContext(cardId,host){
    if(typeof global.KGCardContext!=='function')throw new Error('KGCardContext 尚未加载。');
    return new global.KGCardContext({cardId,host,runtime:api});
  }
  async function mount(cardId,host=null,options={}){
    cardId=String(cardId||'');
    host=host||findHost(cardId);
    if(!host)throw new Error('找不到卡片宿主：'+cardId);
    if(mounted.has(cardId)&&!options.replace)return mounted.get(cardId);
    if(mounted.has(cardId)&&options.replace)destroy(cardId);

    const definition=registry()?.get?.(cardId);
    if(!definition){
      renderError(host,cardId,new Error('卡片尚未注册：'+cardId));
      return null;
    }

    setHostState(host,'loading');
    try{
      const context=buildContext(cardId,host);
      const instance=await definition.create(context);
      contract()?.assertInstance?.(instance,cardId);
      const record={cardId,definition,host,context,instance,mountedAt:Date.now()};
      mounted.set(cardId,record);
      await instance.mount(host,context);
      instance.setMode(context.mode());
      await instance.update({
        question:context.question(),
        session:context.session(),
        reason:'mount'
      });
      setHostState(host,'ready');
      try{global.dispatchEvent(new CustomEvent('kg:card-mounted',{detail:{cardId,version:definition.version}}))}catch(e){}
      return record;
    }catch(error){
      mounted.delete(cardId);
      console.error('CardRuntime mount error',cardId,error);
      renderError(host,cardId,error);
      return null;
    }
  }
  async function mountAll(root=document){
    const hosts=[...(root.querySelectorAll?.('[data-learning-card]')||[])];
    const results=[];
    for(const host of hosts){
      const cardId=String(host.dataset.learningCard||'');
      if(!cardId)continue;
      results.push(await mount(cardId,host));
    }
    return results;
  }
  async function update(cardId,reason='state'){
    const record=mounted.get(String(cardId||''));
    if(!record)return null;
    try{
      await record.instance.update({
        question:record.context.question(),
        session:record.context.session(),
        reason
      });
      setHostState(record.host,'ready');
      return record;
    }catch(error){
      console.error('CardRuntime update error',cardId,error);
      renderError(record.host,record.cardId,error);
      return null;
    }
  }
  async function updateAll(reason='state'){
    return Promise.all([...mounted.keys()].map(id=>update(id,reason)));
  }
  function validate(cardId){
    const record=mounted.get(String(cardId||''));
    if(!record)return {valid:false,errors:[{code:'CARD_NOT_MOUNTED',message:'学习卡片尚未加载。'}]};
    try{return contract()?.normalizeValidation?.(record.instance.validate())||{valid:true,errors:[]}}
    catch(error){return {valid:false,errors:[{code:'VALIDATION_ERROR',message:String(error?.message||error)}]}}
  }
  function snapshot(cardId){
    const record=mounted.get(String(cardId||''));
    if(!record)return null;
    return record.instance.snapshot();
  }
  function setMode(mode){
    mounted.forEach(record=>record.instance.setMode(mode));
  }
  function focus(cardId){
    const record=mounted.get(String(cardId||''));
    if(!record)return false;
    record.instance.focus();
    return true;
  }
  function reset(cardId){
    const record=mounted.get(String(cardId||''));
    if(!record)return false;
    record.instance.reset();
    return true;
  }
  function destroy(cardId){
    cardId=String(cardId||'');
    const record=mounted.get(cardId);
    if(!record)return false;
    try{record.instance.destroy()}catch(error){console.warn('CardRuntime destroy error',cardId,error)}
    mounted.delete(cardId);
    setHostState(record.host,'idle');
    return true;
  }
  function destroyAll(){[...mounted.keys()].forEach(destroy)}
  function isMounted(cardId){return mounted.has(String(cardId||''))}
  function get(cardId){return mounted.get(String(cardId||''))||null}
  function list(){return [...mounted.values()]}
  function dispatch(command={},meta={}){
    const normalized={
      type:String(command?.type||''),
      payload:command?.payload&&typeof command.payload==='object'?command.payload:{},
      sourceCardId:String(meta.cardId||command?.sourceCardId||''),
      issuedAt:Date.now()
    };
    if(!normalized.type)throw new Error('卡片命令缺少 type。');
    const result=global.KGFlowOrchestrator?.dispatchCommand?.(normalized)||null;
    try{global.dispatchEvent(new CustomEvent('kg:card-command',{detail:{command:normalized,result}}))}catch(e){}
    return result;
  }
  function bind(){
    if(bound)return;
    bound=true;
    global.addEventListener?.('kg:learning-session-updated',()=>updateAll('session'));
    global.addEventListener?.('kg:learning-session-changed',event=>{
      const mode=event.detail?.session?.mode||'guided';
      setMode(mode);
      updateAll('session-changed');
    });
    global.addEventListener?.('kg:question-changed',()=>updateAll('question'));
    global.addEventListener?.('kg:learning-session-reset',()=>updateAll('reset'));
    global.addEventListener?.('beforeunload',destroyAll);
  }

  const api=Object.freeze({
    mount,mountAll,update,updateAll,validate,snapshot,setMode,focus,reset,destroy,destroyAll,
    isMounted,get,list,dispatch
  });
  global.KGCardRuntime=api;

  document.addEventListener('DOMContentLoaded',()=>{
    bind();
    mountAll();
  });
})(window);
