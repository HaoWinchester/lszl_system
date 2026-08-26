'use strict';

(function(global){
  let activeFiles=[],trashFiles=[],activeFolders=[],trashFolders=[],tags=[],currentId='',sessionEpoch=0,refreshSerial=0,lastError='',catalogLoaded=false,catalogPromise=null;
  const contentCache=new Map();
  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value))}
  function api(){return global.KGGraphFileApi||null}
  function active(){return !!(api()&&api().isRemote&&api().isRemote())}
  function currentOwner(){try{return global.KGAuthCore&&global.KGAuthCore.currentUsername?global.KGAuthCore.currentUsername()||'guest':'guest'}catch(error){return'guest'}}
  function timestamp(value){if(typeof value==='number'&&Number.isFinite(value))return value;const parsed=Date.parse(String(value||''));return Number.isFinite(parsed)?parsed:0}
  function normalizeFile(raw){
    if(!raw||typeof raw!=='object')return null;
    const tag=raw.tag&&typeof raw.tag==='object'?raw.tag:null;
    return{
      ...clone(raw),owner:raw.owner||raw.ownerId||currentOwner(),
      tags:tag&&tag.name?[String(tag.name)]:Array.isArray(raw.tags)?raw.tags.slice(0,1):[],
      favorite:raw.favorite===true,folderId:raw.folderId||null,restoreFolderId:raw.restoreFolderId||null,
      order:Number(raw.order)||0,revision:Math.max(1,Number(raw.revision)||1),
      createdAt:timestamp(raw.createdAt),updatedAt:timestamp(raw.updatedAt),lastOpenedAt:timestamp(raw.lastOpenedAt),deletedAt:timestamp(raw.deletedAt),
    };
  }
  function normalizeFolder(raw){
    if(!raw||typeof raw!=='object')return null;
    return{
      ...clone(raw),owner:raw.owner||raw.ownerId||currentOwner(),parentId:raw.parentId||null,restoreParentId:raw.restoreParentId||null,
      order:Number(raw.order)||0,createdAt:timestamp(raw.createdAt),updatedAt:timestamp(raw.updatedAt),deletedAt:timestamp(raw.deletedAt),
    };
  }
  function rememberError(error){lastError=String(error&&error.message||error||'图谱文件服务请求失败');return false}
  function getLastError(){return lastError}
  function clearSession(){sessionEpoch+=1;refreshSerial+=1;activeFiles=[];trashFiles=[];activeFolders=[];trashFolders=[];tags=[];currentId='';lastError='';catalogLoaded=false;catalogPromise=null;contentCache.clear()}
  function seedCurrent(file){
    if(!file){currentId='';return null}
    const normalized=normalizeFile(file);
    if(!normalized||!normalized.id)return null;
    currentId=String(normalized.id);
    const hydrated={...normalized,graphData:clone(file.graphData),learningState:clone(file.learningState)||{}};
    contentCache.set(currentId,hydrated);
    const meta={...normalized};delete meta.graphData;delete meta.learningState;
    activeFiles=[meta,...activeFiles.filter(item=>String(item.id)!==currentId)];
    return clone(hydrated);
  }
  async function refresh(){
    if(!active()){clearSession();return false}
    const epoch=sessionEpoch,serial=++refreshSerial,transport=api();
    try{
      const [activePayload,trashPayload,folderPayload,trashFolderPayload,tagPayload,currentPayload]=await Promise.all([
        transport.listFiles('active'),transport.listFiles('trashed'),transport.listFolders('active'),transport.listFolders('trashed'),transport.listTags(),transport.getCurrent(),
      ]);
      if(epoch!==sessionEpoch||serial!==refreshSerial||!active())return false;
      activeFiles=(Array.isArray(activePayload.files)?activePayload.files:[]).map(normalizeFile).filter(Boolean);
      trashFiles=(Array.isArray(trashPayload.files)?trashPayload.files:[]).map(normalizeFile).filter(Boolean);
      activeFolders=(Array.isArray(folderPayload.folders)?folderPayload.folders:[]).map(normalizeFolder).filter(Boolean);
      trashFolders=(Array.isArray(trashFolderPayload.folders)?trashFolderPayload.folders:[]).map(normalizeFolder).filter(Boolean);
      tags=(Array.isArray(tagPayload.tags)?tagPayload.tags:[]).map(clone);
      currentId=String(currentPayload.fileId||'');lastError='';catalogLoaded=true;return true;
    }catch(error){rememberError(error);throw error}
  }
  function ensureCatalog(){
    if(catalogLoaded)return Promise.resolve(true);
    if(catalogPromise)return catalogPromise;
    catalogPromise=refresh().finally(()=>{catalogPromise=null});
    return catalogPromise;
  }
  function initialize(){return ensureCatalog()}
  function listFiles(options={}){const status=options.status||'active';return clone(status==='trashed'?trashFiles:status==='all'||(options.includeTrash&&!options.status)?[...activeFiles,...trashFiles]:activeFiles)}
  function listFolders(options={}){const status=options.status||'active';return clone(status==='trashed'?trashFolders:status==='all'||(options.includeTrash&&!options.status)?[...activeFolders,...trashFolders]:activeFolders)}
  function listTags(){return clone(tags)}
  function getCurrentFileId(){return currentId}
  function getCurrentFileMeta(){return clone(activeFiles.find(file=>file.id===currentId)||null)}
  function getFileMeta(id,owner=currentOwner(),options={}){const pool=options.includeTrash?[...activeFiles,...trashFiles]:activeFiles;return clone(pool.find(file=>file.id===id&&file.owner===owner)||null)}
  function getFolder(id,options={}){const pool=options.includeTrash?[...activeFolders,...trashFolders]:activeFolders;return clone(pool.find(folder=>folder.id===id)||null)}
  async function setCurrentFileId(id){await api().setCurrent(id||null);currentId=String(id||'');return currentId}
  async function createFile(input={},options={}){try{const payload=await api().create(input),file=normalizeFile(payload.file);if(!file)throw new Error('远端图谱文件创建失败。');await refresh();if(options.makeCurrent!==false)await setCurrentFileId(file.id);return clone(file)}catch(error){return rememberError(error)}}
  async function openFile(id){try{const epoch=sessionEpoch,payload=await api().get(id);if(epoch!==sessionEpoch||!active())return null;const meta=normalizeFile(payload.meta);if(!meta)return null;const hydrated={...meta,graphData:clone(payload.graphData),learningState:clone(payload.learningState)||{}};contentCache.set(id,hydrated);await setCurrentFileId(id);return clone(hydrated)}catch(error){return rememberError(error)}}
  async function getFile(id,owner=currentOwner(),options={}){const cached=contentCache.get(id);if(cached&&cached.owner===owner)return clone(cached);if(!getFileMeta(id,owner,{includeTrash:options.includeTrash===true}))return null;try{const payload=await api().get(id),file={...normalizeFile(payload.meta),graphData:clone(payload.graphData),learningState:clone(payload.learningState)||{}};contentCache.set(id,file);return clone(file)}catch(error){return rememberError(error)}}
  async function saveFile(id,graphData,options={}){try{const current=getFileMeta(id,currentOwner(),{includeTrash:false});if(!current)return null;const payload=await api().save(id,{graphData,learningState:options.learningState,expectedRevision:current.revision});await refresh();const file=normalizeFile(payload.file);if(file)contentCache.set(id,{...file,graphData:clone(graphData),learningState:clone(options.learningState)||{}});return clone(file)}catch(error){return rememberError(error)}}
  async function patchFile(id,patch){try{const payload=await api().patchFile(id,patch);await refresh();return normalizeFile(payload.file)}catch(error){return rememberError(error)}}
  function renameFile(id,name){return patchFile(id,{name})}
  function moveFile(id,folderId){return patchFile(id,{folderId:folderId||null})}
  function setFileFavorite(id,favorite){return patchFile(id,{favorite:favorite===true})}
  async function deleteFile(id,options={}){try{if(options.permanent)await api().deleteFilePermanent(id);else await api().trashFile(id);contentCache.delete(id);await refresh();return true}catch(error){return rememberError(error)}}
  async function restoreFile(id){try{const payload=await api().restoreFile(id);await refresh();return normalizeFile(payload.file)}catch(error){return rememberError(error)}}
  async function emptyTrash(){try{const payload=await api().emptyTrash();await refresh();return Number(payload.deletedFiles||0)+Number(payload.deletedFolders||0)}catch(error){return rememberError(error)}}
  async function duplicateFile(id,options={}){try{const payload=await api().duplicateFile(id,options.name);await refresh();const file=normalizeFile(payload.file);if(file&&options.makeCurrent===true)await setCurrentFileId(file.id);return file}catch(error){return rememberError(error)}}
  function getFileTags(id){const file=getFileMeta(id,currentOwner(),{includeTrash:true});return file?clone(file.tags):[]}
  async function setFileTags(id,names){try{const name=Array.isArray(names)?String(names[0]||'').trim():'';let tag=name?tags.find(item=>item.name===name):null;if(name&&!tag){const payload=await api().createTag({name,color:'#64748b'});tag=payload.tag}await api().setFileTag(id,tag&&tag.id||null);await refresh();return getFileMeta(id,currentOwner(),{includeTrash:true})}catch(error){return rememberError(error)}}
  async function createTag(name,color=''){try{const payload=await api().createTag({name,color:color||'#64748b'});await refresh();return clone(payload.tag)}catch(error){return rememberError(error)}}
  async function updateTag(id,patch){try{const payload=await api().updateTag(id,patch);await refresh();return clone(payload.tag)}catch(error){return rememberError(error)}}
  async function deleteTag(id){try{await api().deleteTag(id);await refresh();return true}catch(error){return rememberError(error)}}
  async function createFolder(input={}){try{const payload=await api().createFolder(input);await refresh();return normalizeFolder(payload.folder)}catch(error){return rememberError(error)}}
  async function patchFolder(id,patch){try{const payload=await api().patchFolder(id,patch);await refresh();return normalizeFolder(payload.folder)}catch(error){return rememberError(error)}}
  function renameFolder(id,name){return patchFolder(id,{name})}
  function moveFolder(id,parentId){return patchFolder(id,{parentId:parentId||null})}
  async function trashFolder(id){try{await api().trashFolder(id);await refresh();return true}catch(error){return rememberError(error)}}
  async function restoreFolder(id){try{const payload=await api().restoreFolder(id);await refresh();return normalizeFolder(payload.folder)}catch(error){return rememberError(error)}}
  async function deleteFolderPermanently(id){try{await api().deleteFolderPermanent(id);await refresh();return true}catch(error){return rememberError(error)}}
  async function estimateStorage(){const activeByteSize=activeFiles.reduce((sum,file)=>sum+Number(file.byteSize||0),0),trashByteSize=trashFiles.reduce((sum,file)=>sum+Number(file.byteSize||0),0);return{usage:activeByteSize+trashByteSize,byteSize:activeByteSize+trashByteSize,activeByteSize,trashByteSize,nodeCount:activeFiles.reduce((sum,file)=>sum+Number(file.nodeCount||0),0),linkCount:activeFiles.reduce((sum,file)=>sum+Number(file.linkCount||0),0),files:activeFiles.length+trashFiles.length,quota:0}}
  function verifyIntegrity(){return{ok:true,checked:activeFiles.length+trashFiles.length,missing:[]}}
  function refreshFilePreviews(){return 0}
  function purgeExpiredTrash(){return 0}
  global.KGGraphFileRemoteStore={active,currentOwner,initialize,ensureCatalog,seedCurrent,refresh,clearSession,listFiles,getFileMeta,getFile,getCurrentFileMeta,createFile,openFile,saveFile,renameFile,deleteFile,restoreFile,emptyTrash,purgeExpiredTrash,duplicateFile,setFileTags,getFileTags,setFileFavorite,listTags,createTag,updateTag,deleteTag,listFolders,getFolder,createFolder,renameFolder,moveFile,moveFolder,trashFolder,restoreFolder,deleteFolderPermanently,setCurrentFileId,getCurrentFileId,getLastError,estimateStorage,verifyIntegrity,refreshFilePreviews};
})(window);
