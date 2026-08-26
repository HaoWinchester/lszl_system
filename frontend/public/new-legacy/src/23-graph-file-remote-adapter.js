'use strict';
(function(global){
  let current=null,loadedGraph=null,pendingSave=Promise.resolve(),sessionEpoch=0,initializedEpoch=-1,currentInitializer=null;
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
  function clearSession(){sessionEpoch+=1;initializedEpoch=-1;currentInitializer=null;current=null;loadedGraph=null;pendingSave=Promise.resolve()}
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
    const expectedRevision=Number(current.revision)||1;
    pendingSave=pendingSave.catch(()=>null).then(()=>global.KGGraphFileApi.save(id,{graphData:snapshot,learningState:options.learningState,expectedRevision})).then(payload=>{
      if(epoch!==sessionEpoch||!active())return null;
      current=normalize(payload.file)||current;
      if(typeof onSuccess==='function')onSuccess();
      return current;
    }).catch(error=>{if(epoch===sessionEpoch)console.warn('[KGGraphFileRemoteAdapter] save failed',error);throw error});
    return true;
  }
  function flush(){return pendingSave}
  async function handleSessionChange(event){
    clearSession();
    if(!event?.detail?.authenticated||!active())return null;
    return initializeCurrent();
  }
  global.KGGraphFileRemoteAdapter={active,initialize,initializeCurrent,adoptFile,getLoadedGraph,getCurrentFileMeta,queueSave,flush,clearSession,handleSessionChange};
})(window);
