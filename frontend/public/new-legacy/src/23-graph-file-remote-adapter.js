'use strict';
(function(global){
  let creating=null,unselectedFileId=null,current=null,loadedGraph=null,pendingSave=Promise.resolve(),sessionEpoch=0,initializedEpoch=-1,currentInitializer=null;
  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value))}
  function active(){return !!(global.KGGraphFileApi&&global.KGGraphFileApi.isRemote())}
  function normalize(file){return file&&typeof file==='object'?file:null}
  function defaultGraph(){
    if(typeof global.KGGraphDefaultFactory==='function'){
      const graph=global.KGGraphDefaultFactory();
      if(graph&&typeof graph==='object')return clone(graph);
    }
    return{meta:{title:'我的知识图谱',subject:'自定义学科',audience:'学员',description:'点击“新增知识点”开始创建。'},viewport:{x:260,y:170,scale:1},nodes:[],links:[],elements:[],importedFlashcards:[],flashReviews:{}};
  }
  function openFile(payload,fallback){const meta=normalize(payload&&payload.meta)||fallback||{};return{...meta,graphData:clone(payload&&payload.graphData)||defaultGraph(),learningState:clone(payload&&payload.learningState)||{}}}
  function adoptFile(file){
    const next=normalize(file);
    if(!next||!next.id||!next.graphData)return null;
    current=clone(next);loadedGraph=clone(next.graphData);return clone(current);
  }
  function clearSession(){sessionEpoch+=1;creating=null;unselectedFileId=null;initializedEpoch=-1;currentInitializer=null;current=null;loadedGraph=null;pendingSave=Promise.resolve()}
  function initializeCurrent(){
    if(!active())return Promise.resolve(null);
    const epoch=sessionEpoch;
    if(initializedEpoch===epoch)return Promise.resolve(clone(current));
    if(currentInitializer)return currentInitializer;
    const api=global.KGGraphFileApi;
    currentInitializer=(async()=>{
      const currentPayload=await api.getCurrent();
      if(epoch!==sessionEpoch||!active())return null;
      const requestedId=String(currentPayload&&currentPayload.fileId||'');
      if(!requestedId){
        current=null;loadedGraph=null;initializedEpoch=epoch;
        global.KGGraphFileRemoteStore?.seedCurrent?.(null);
        return null;
      }
      const opened=await api.get(requestedId);
      if(epoch!==sessionEpoch||!active())return null;
      const adopted=adoptFile(openFile(opened,normalize(opened&&opened.meta)||{id:requestedId}));
      if(!adopted)throw new Error('远端当前图谱初始化失败。');
      global.KGGraphFileRemoteStore?.seedCurrent?.(adopted);
      initializedEpoch=epoch;
      return clone(adopted);
    })();
    const pending=currentInitializer;
    pending.catch(()=>null).finally(()=>{if(currentInitializer===pending)currentInitializer=null});
    return pending;
  }
  function initialize(){return initializeCurrent()}
  function getLoadedGraph(){return clone(loadedGraph)}
  function getCurrentFileMeta(){return clone(current)}
  function queueSave(graphData,options={}){
    if(!active()||!current)return false;
    const epoch=sessionEpoch,id=current.id,snapshot=clone(graphData),onSuccess=options.onSuccess;
    loadedGraph=snapshot;
    pendingSave=pendingSave.catch(()=>null).then(()=>{
      if(epoch!==sessionEpoch||!active()||current?.id!==id)throw new Error('当前图谱已切换，请重新保存。');
      return global.KGGraphFileApi.save(id,{graphData:snapshot,learningState:options.learningState,expectedRevision:Number(current.revision)||1});
    }).then(async payload=>{
      if(epoch!==sessionEpoch||!active())return null;
      current=normalize(payload.file)||current;
      if(options.name!==undefined&&current.name!==options.name){
        const renamed=await global.KGGraphFileApi.patchFile(id,{name:options.name});
        if(epoch!==sessionEpoch||!active()||current?.id!==id)throw new Error('当前图谱已切换，请重新保存。');
        current=normalize(renamed.file)||current;
      }
      if(typeof onSuccess==='function')onSuccess();
      return current;
    }).catch(error=>{if(epoch===sessionEpoch)console.warn('[KGGraphFileRemoteAdapter] save failed',error);throw error});
    return true;
  }
  async function save(graphData,options={}){
    const epoch=sessionEpoch;
    function checkSession(){if(epoch!==sessionEpoch||!active())throw new Error('登录状态已变化，请重新登录后保存。')}
    await initializeCurrent();checkSession();
    if(!current){
      if(!creating){
        const task=(async()=>{
          const payload=await global.KGGraphFileApi.create({name:graphData.meta?.title||'我的知识图谱',graphData,source:'created'});
          checkSession();
          if(!payload.file?.id)throw new Error('图谱文件创建失败，请重试。');
          adoptFile({...payload.file,graphData});
          unselectedFileId=current.id;
          global.KGGraphFileRemoteStore?.seedCurrent?.(current);
        })();
        creating=task;
        task.catch(()=>null).finally(()=>{if(creating===task)creating=null});
      }
      await creating;checkSession();
    }
    // Keep the created file after a selection failure so retry never duplicates it.
    if(unselectedFileId){
      await global.KGGraphFileApi.setCurrent(unselectedFileId);checkSession();unselectedFileId=null;
      global.dispatchEvent(new CustomEvent('kg-graph-current-file-change',{detail:{id:current.id}}));
    }
    if(!queueSave(graphData,options))throw new Error('当前图谱不可保存，请重试。');
    await flush();checkSession();
    global.KGGraphFileRemoteStore?.seedCurrent?.({...current,graphData:loadedGraph});
    return current;
  }
  function flush(){return pendingSave}
  async function handleSessionChange(event){
    clearSession();
    if(!event?.detail?.authenticated||!active())return null;
    return initializeCurrent();
  }
  global.KGGraphFileRemoteAdapter={active,initialize,initializeCurrent,adoptFile,getLoadedGraph,getCurrentFileMeta,queueSave,save,flush,clearSession,handleSessionChange};
})(window);
