'use strict';

/*
 * 基线重构 C-1：图谱文件自动保存策略。
 * 仅在 dirty 时每 3 分钟保存，并在切换、刷新、关闭及退出前同步保存。
 */
(function(global){
  const INTERVAL_MS=3*60*1000;
  let dirty=false,timer=null,saving=false,lastSavedAt=0,lastError='';

  function emit(reason='status'){
    global.dispatchEvent(new CustomEvent('kg-graph-autosave-status',{detail:{dirty,saving,lastSavedAt,lastError,reason}}));
  }
  function markDirty(reason='change'){
    dirty=true;lastError='';emit(reason);return true;
  }
  function clearDirty(reason='saved'){
    dirty=false;lastError='';lastSavedAt=Date.now();emit(reason);return true;
  }
  function reportError(error,reason='server-error'){
    dirty=true;saving=false;lastError=String(error&&error.message||error||'保存失败');emit(reason);return false;
  }
  function reportSaved(reason='server-saved'){
    dirty=false;saving=false;lastError='';lastSavedAt=Date.now();emit(reason);return true;
  }
  function isDirty(){return dirty}
  function saveNow(options={}){
    if(saving)return true;
    if(!dirty&&!options.force)return true;
    saving=true;emit('saving');
    let result=false;
    try{
      if(typeof global.persistCurrentGraphNow==='function')result=global.persistCurrentGraphNow({...options,bypassAutosave:true});
      else if(typeof global.saveNow==='function')result=global.saveNow({...options,bypassAutosave:true});
      if(result&&typeof result.then==='function'){
        return result.then(ok=>{
          if(ok!==false){dirty=false;lastError='';lastSavedAt=Date.now()}else lastError='保存失败';
          saving=false;emit(ok!==false?'saved':'error');return ok!==false;
        }).catch(err=>{console.warn('[KGGraphFileAutosave] save failed:',err);lastError=String(err&&err.message||err||'保存失败');saving=false;emit('error');return false});
      }
      if(result!==false){dirty=false;lastError='';lastSavedAt=Date.now();result=true}
      else lastError='保存失败';
    }catch(err){console.warn('[KGGraphFileAutosave] save failed:',err);lastError=String(err&&err.message||err||'保存失败');result=false}
    saving=false;emit(result?'saved':'error');return result;
  }
  function saveBeforeSwitch(){return dirty?saveNow({force:true,silent:false,reason:'before-switch'}):true}
  function start(){
    if(timer)return true;
    timer=setInterval(()=>{if(dirty)saveNow({silent:true,reason:'interval'})},INTERVAL_MS);
    emit('start');return true;
  }
  function stop(){if(timer){clearInterval(timer);timer=null}emit('stop');return true}
  function bindBeforeUnload(){
    if(document.documentElement.dataset.graphAutosaveUnloadBound==='1')return;
    document.documentElement.dataset.graphAutosaveUnloadBound='1';
    global.addEventListener('beforeunload',()=>{if(dirty)saveNow({force:true,silent:true,reason:'beforeunload'})});
    global.addEventListener('pagehide',()=>{if(dirty)saveNow({force:true,silent:true,reason:'pagehide'})});
  }
  function status(){return{dirty,saving,lastSavedAt,lastError,intervalMs:INTERVAL_MS}}

  bindBeforeUnload();
  global.KGGraphFileAutosave={INTERVAL_MS,start,stop,markDirty,clearDirty,reportError,reportSaved,isDirty,saveNow,saveBeforeSwitch,bindBeforeUnload,status};
})(window);
