'use strict';
(function(global){
  let current=null,loadedGraph=null,pendingSave=Promise.resolve(),sessionEpoch=0;
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
  function clearSession(){sessionEpoch+=1;current=null;loadedGraph=null;pendingSave=Promise.resolve()}
  async function initialize(){
    if(!active())return null;
    const epoch=sessionEpoch,api=global.KGGraphFileApi,listing=await api.listActive();
    if(epoch!==sessionEpoch||!active())return null;
    const files=Array.isArray(listing.files)?listing.files:[];
    const currentPayload=await api.getCurrent();
    if(epoch!==sessionEpoch||!active())return null;
    const requestedId=String(currentPayload&&currentPayload.fileId||'');
    let meta=normalize(files.find(file=>String(file&&file.id||'')===requestedId)||files[0]);
    if(!meta){
      const graphData=defaultGraph(),created=await api.create({name:graphData.meta.title,graphData});
      if(epoch!==sessionEpoch||!active())return null;
      meta=normalize(created.file);
    }
    if(!meta)throw new Error('远端图谱文件初始化失败。');
    const opened=await api.get(meta.id);
    if(epoch!==sessionEpoch||!active())return null;
    adoptFile(openFile(opened,meta));
    await api.setCurrent(current.id);
    return epoch===sessionEpoch&&active()?clone(current):null;
  }
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
    return initialize();
  }
  global.KGGraphFileRemoteAdapter={active,initialize,adoptFile,getLoadedGraph,getCurrentFileMeta,queueSave,flush,clearSession,handleSessionChange};
})(window);
