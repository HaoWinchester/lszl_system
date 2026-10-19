'use strict';

(function(global){
  let selected=global.KGGraphFileStore||null;
  function remoteActive(){
    const remote=global.KGGraphFileRemoteStore;
    return !!(remote&&typeof remote.active==='function'&&remote.active());
  }
  function isRemote(){return selected===global.KGGraphFileRemoteStore&&remoteActive()}
  async function initialize(){
    const remote=global.KGGraphFileRemoteStore;
    if(remoteActive()){
      await remote.initialize();
      selected=remote;
    }else selected=global.KGGraphFileStore||null;
    return selected;
  }
  async function initializeCurrent(){
    if(remoteActive())selected=global.KGGraphFileRemoteStore;
    else selected=global.KGGraphFileStore||null;
    return selected;
  }
  function current(){return selected}
  function adopt(file){
    if(isRemote()&&file&&global.KGGraphFileRemoteAdapter&&typeof global.KGGraphFileRemoteAdapter.adoptFile==='function'){
      return global.KGGraphFileRemoteAdapter.adoptFile(file);
    }
    return file;
  }
  async function openFile(id,options={}){
    const store=current();
    if(!store||typeof store.openFile!=='function')return null;
    const file=await Promise.resolve(store.openFile(id,options));
    return adopt(file);
  }
  async function createFile(input={},options={}){
    const store=current();
    if(!store||typeof store.createFile!=='function')return null;
    let file=await Promise.resolve(store.createFile(input,options));
    if(isRemote()&&file&&typeof store.openFile==='function')file=await Promise.resolve(store.openFile(file.id,options));
    return adopt(file);
  }
  function fragmentSource(){
    const store=current(),indexed=store?.getCurrentFileMeta?.()||store?.getCurrentFile?.();
    const acknowledged=remoteActive()?global.KGGraphFileRemoteAdapter?.getCurrentFileMeta?.():null;
    // Queued saves can acknowledge a newer revision before the file index refreshes.
    // Never borrow metadata from a different selected tab or regress a fresh index.
    const file=!indexed?acknowledged:(acknowledged?.id===indexed.id&&Number(acknowledged.revision)>Number(indexed.revision)?acknowledged:indexed);
    return{fileId:file?.id||null,revision:file?.revision??null};
  }
  global.KGGraphFileEditorStoreBridge={initialize,initializeCurrent,current,isRemote,openFile,createFile,adopt,fragmentSource};
})(window);
