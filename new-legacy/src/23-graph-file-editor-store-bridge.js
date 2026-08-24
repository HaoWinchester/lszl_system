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
  global.KGGraphFileEditorStoreBridge={initialize,current,isRemote,openFile,createFile,adopt};
})(window);
