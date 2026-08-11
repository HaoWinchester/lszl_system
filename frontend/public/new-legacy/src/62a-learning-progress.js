'use strict';

/*
 * LearningProgress
 * 统一学习进度与页面瞬时状态的切换生命周期。持久化仍复用既有 LearningSession、
 * 深度回忆和多题画布存储键；切换上下文只清理当前页面的旧题目/旧进度/旧画布，
 * 不删除历史学习记录。
 */
(function(global){
  const adapters=new Map();
  function text(value){return String(value==null?'':value)}
  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function normalizeContext(input={},defaults={}){
    return global.KGLearningRouteContext?.normalize?.(input,defaults)||global.KGLearningSession?.normalizeContext?.(input,defaults)||input;
  }
  function adapter(mode=''){return adapters.get(text(mode))||null}
  function registerAdapter(mode,implementation={}){
    mode=text(mode);if(!mode)return false;
    adapters.set(mode,{flush:typeof implementation.flush==='function'?implementation.flush:null,clearTransient:typeof implementation.clearTransient==='function'?implementation.clearTransient:null,load:typeof implementation.load==='function'?implementation.load:null,onError:typeof implementation.onError==='function'?implementation.onError:null});
    return true;
  }
  function safeCall(fn,...args){try{return fn?.(...args)}catch(error){console.warn('学习进度适配器执行失败',error);return false}}
  function get(context={},userId){return global.KGLearningSession?.get?.(normalizeContext(context),userId)||null}
  function ensure(context={},options={}){return global.KGLearningSession?.ensure?.(normalizeContext(context,options),options)||null}
  function save(context={},progress={},options={}){
    const normalized=normalizeContext(context,options);
    const current=ensure(normalized,options);if(!current)return null;
    return global.KGLearningSession?.update?.(normalized,draft=>{draft.progress={...(draft.progress||{}),...clone(progress),updatedAt:Date.now()};return draft},options.userId);
  }
  function status(context={},userId){
    const session=get(context,userId);
    if(!session)return {key:'not-started',label:'未开始',step:0,session:null};
    if(session.status==='completed')return {key:'completed',label:'已完成',step:5,session};
    const step=Math.max(1,Math.min(5,Number(session.currentStep||1)));
    return {key:'in-progress',label:'第 '+step+' 步',step,session};
  }
  function activate(context={},options={}){
    const normalized=normalizeContext(context,options);
    const mode=text(normalized.mode||options.mode||'guided');
    const currentAdapter=adapter(mode);
    const previous=global.KGLearningSession?.active?.(mode,options.userId);
    const changed=!previous||previous.key!==normalized.key;
    if(changed&&previous){
      safeCall(currentAdapter?.flush,clone(previous),clone(normalized),options);
      if(options.clearTransient!==false)safeCall(currentAdapter?.clearTransient,clone(previous),clone(normalized),options);
    }
    const activation=global.KGLearningSession?.activate?.(normalized,{...options,mode,clearTransient:options.clearTransient!==false})||{changed,previous,current:normalized,session:ensure(normalized,options)};
    if(changed)safeCall(currentAdapter?.load,clone(normalized),clone(previous),options);
    try{global.dispatchEvent?.(new CustomEvent('kg:learning-progress-context-changed',{detail:{previous:clone(previous),current:clone(normalized),mode,changed,clearTransient:options.clearTransient!==false}}))}catch(error){}
    return activation;
  }
  function flush(mode='',options={}){
    const context=global.KGLearningSession?.active?.(mode,options.userId);return safeCall(adapter(mode)?.flush,clone(context),null,options);
  }
  function clearTransient(mode='',options={}){
    const context=global.KGLearningSession?.active?.(mode,options.userId);return safeCall(adapter(mode)?.clearTransient,clone(context),null,options);
  }
  function reset(context={},options={}){
    const normalized=normalizeContext(context,options),mode=text(normalized.mode||options.mode);
    if(options.deletePersisted)global.KGLearningSession?.remove?.(normalized,options.userId);
    safeCall(adapter(mode)?.clearTransient,clone(normalized),null,{...options,reset:true});
    return options.deletePersisted?null:global.KGLearningSession?.restart?.(normalized,options);
  }

  const api=Object.freeze({registerAdapter,get,ensure,save,status,activate,flush,clearTransient,reset,normalizeContext});
  global.KGLearningProgress=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
