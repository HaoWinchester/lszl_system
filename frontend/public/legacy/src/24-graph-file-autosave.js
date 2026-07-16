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
  function isDirty(){return dirty}
  function saveNow(options={}){
    if(saving)return true;
    if(!dirty&&!options.force)return true;
    saving=true;emit('saving');
    let ok=false;
    try{
      if(typeof global.persistCurrentGraphNow==='function')ok=global.persistCurrentGraphNow({...options,bypassAutosave:true});
      else if(typeof global.saveNow==='function')ok=global.saveNow({...options,bypassAutosave:true});
      else ok=false;
      if(ok!==false){dirty=false;lastError='';lastSavedAt=Date.now();ok=true}
      else{lastError='保存失败'}
    }catch(err){console.warn('[KGGraphFileAutosave] save failed:',err);lastError=String(err&&err.message||err||'保存失败');ok=false}
    saving=false;emit(ok?'saved':'error');return ok;
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
  global.KGGraphFileAutosave={INTERVAL_MS,start,stop,markDirty,clearDirty,isDirty,saveNow,saveBeforeSwitch,bindBeforeUnload,status};
})(window);
