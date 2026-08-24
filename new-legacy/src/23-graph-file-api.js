'use strict';
(function(global){
  let sessionAuthenticated=null;
  function authConfig(){return global.KGAuthCore&&global.KGAuthCore.providerConfig?global.KGAuthCore.providerConfig():{mode:'local-demo'}}
  function bootstrap(){return global.__KG_DIRECT_BOOTSTRAP__||{}}
  function isRemote(){const direct=bootstrap(),authenticated=sessionAuthenticated===null?!!((global.KGAuthCore&&global.KGAuthCore.currentUser&&global.KGAuthCore.currentUser())||(direct.authenticated&&direct.authUser)):sessionAuthenticated;return direct.graphFilesApiCutoverEnabled===true&&authConfig().mode==='remote'&&authenticated}
  function baseUrl(){const config=authConfig(),base=String(config.baseUrl||'').replace(/\/$/,'');return /\/api\/v1$/.test(base)?base:base+'/api/v1'}
  function headers(){const stored=(function(){try{return JSON.parse((global.localStorage||{}).getItem('kg_remote_auth_session_v1')||'null')}catch(error){return null}})();return {'Content-Type':'application/json',...(stored&&stored.token?{Authorization:'Bearer '+stored.token}:{})}}
  async function request(path,options={}){
    const response=await global.fetch(baseUrl()+path,{credentials:authConfig().credentials||'include',headers:{...headers(),...(options.headers||{})},method:options.method||'GET',body:options.body===undefined?undefined:JSON.stringify(options.body)});
    let payload={};try{payload=await response.json()}catch(error){}
    if(!response.ok){
      const detail=payload&&payload.detail;
      const message=detail&&typeof detail==='object'?detail.message:detail||payload.message||'图谱文件服务请求失败（'+response.status+'）';
      const error=new Error(String(message));error.status=response.status;error.detail=detail||null;
      if(detail&&typeof detail==='object'&&detail.currentRevision!==undefined)error.currentRevision=detail.currentRevision;
      throw error;
    }
    return payload;
  }
  function idPath(id){return'/files/'+encodeURIComponent(id)}
  function query(params){const values=new URLSearchParams();Object.entries(params||{}).forEach(([key,value])=>{if(value!==undefined&&value!==null&&value!=='')values.set(key,String(value))});const text=values.toString();return text?'?'+text:''}
  const api={
    isRemote,request,
    listFiles:(status='active',options={})=>request('/files'+query({status,page_size:options.pageSize||200,folder_id:options.folderId,query:options.query,sort:options.sort})),
    listActive:()=>request('/files?status=active&page_size=200'),
    create:input=>request('/files',{method:'POST',body:input}),
    get:id=>request(idPath(id)),
    save:(id,input)=>request(idPath(id),{method:'PUT',body:input}),
    patchFile:(id,patch)=>request(idPath(id),{method:'PATCH',body:patch}),
    trashFile:id=>request(idPath(id),{method:'DELETE'}),
    restoreFile:id=>request(idPath(id)+'/restore',{method:'POST'}),
    deleteFilePermanent:id=>request(idPath(id)+'/permanent',{method:'DELETE'}),
    duplicateFile:(id,name)=>request(idPath(id)+'/duplicate',{method:'POST',body:{name}}),
    emptyTrash:()=>request('/files/trash/empty',{method:'POST'}),
    getCurrent:()=>request('/files/current'),
    setCurrent:id=>request('/files/current',{method:'PUT',body:{fileId:id||null}}),
    listFolders:(status='active')=>request('/files/folders'+query({status})),
    createFolder:input=>request('/files/folders',{method:'POST',body:input}),
    patchFolder:(id,patch)=>request('/files/folders/'+encodeURIComponent(id),{method:'PATCH',body:patch}),
    trashFolder:id=>request('/files/folders/'+encodeURIComponent(id),{method:'DELETE'}),
    restoreFolder:id=>request('/files/folders/'+encodeURIComponent(id)+'/restore',{method:'POST'}),
    deleteFolderPermanent:id=>request('/files/folders/'+encodeURIComponent(id)+'/permanent',{method:'DELETE'}),
    listTags:()=>request('/files/tags'),
    createTag:input=>request('/files/tags',{method:'POST',body:input}),
    updateTag:(id,patch)=>request('/files/tags/'+encodeURIComponent(id),{method:'PATCH',body:patch}),
    deleteTag:id=>request('/files/tags/'+encodeURIComponent(id),{method:'DELETE'}),
    setFileTag:(id,tagId)=>request(idPath(id)+'/tag',{method:'PUT',body:{tagId:tagId||null}}),
  };
  function trackSession(event){
    if(event&&event.detail&&typeof event.detail.authenticated==='boolean')sessionAuthenticated=event.detail.authenticated;
    else if(global.KGAuthCore&&typeof global.KGAuthCore.currentUser==='function')sessionAuthenticated=!!global.KGAuthCore.currentUser();
  }
  if(typeof global.addEventListener==='function'){
    global.addEventListener('kg:auth-session-changed',trackSession);
    global.addEventListener('kg-auth-session-change',trackSession);
  }
  global.KGGraphFileApi=api;
})(window);
