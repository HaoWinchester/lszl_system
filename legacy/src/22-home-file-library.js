'use strict';

/*
 * 兼容层：早期 KGHomeFileLibrary 已合并到 KGGraphFileStore。
 * 新功能应直接使用 KGGraphFileStore；保留这些方法只为避免旧调用失效。
 */
(function(global){
  const LEGACY_LIBRARY_KEY='kg_home_file_library_v1';
  function store(){return global.KGGraphFileStore||null}
  function currentOwner(){const s=store();return s&&s.currentOwner?s.currentOwner():'guest'}
  function toRecord(file){
    if(!file)return null;return{id:file.id,owner:file.owner,title:file.name,subject:file.graphData&&file.graphData.meta&&file.graphData.meta.subject||'',description:file.description||file.graphData&&file.graphData.meta&&file.graphData.meta.description||'',nodeCount:file.nodeCount||file.graphData&&file.graphData.nodes&&file.graphData.nodes.length||0,linkCount:file.linkCount||file.graphData&&file.graphData.links&&file.graphData.links.length||0,createdAt:file.createdAt,updatedAt:file.updatedAt,source:file.source,snapshot:file.graphData};
  }
  function list(options={}){const s=store();return s?s.listFiles(options).map(meta=>toRecord(s.getFile(meta.id,meta.owner,{includeTrash:!!options.includeTrash}))).filter(Boolean):[]}
  function get(id){const s=store();if(!s)return null;const meta=s.listFiles({owner:false,includeTrash:true}).find(file=>file.id===id);return meta?toRecord(s.getFile(id,meta.owner,{includeTrash:true})):null}
  function save(snapshot,options={}){
    const s=store();if(!s)return null;const owner=options.owner||currentOwner(),existing=options.id&&s.getFile(options.id,owner,{includeTrash:true});
    const file=existing?s.saveFile(existing.id,snapshot,{owner,name:options.title||existing.name}):s.createFile({id:options.id,owner,name:options.title||(snapshot&&snapshot.meta&&snapshot.meta.title),description:options.description,graphData:snapshot,createdAt:options.createdAt,updatedAt:options.updatedAt,source:options.source||'home-library-compat'},{owner,makeCurrent:options.makeCurrent!==false});
    return toRecord(file);
  }
  function saveCurrent(options={}){let snapshot=options.snapshot||options.state||null;if(!snapshot&&typeof options.stateGetter==='function')snapshot=options.stateGetter();if(!snapshot&&typeof global.exportableState==='function')snapshot=global.exportableState();return save(snapshot,options)}
  function update(id,patch={}){const current=get(id);if(!current)return null;return save(patch.snapshot||current.snapshot,{...patch,id,owner:patch.owner||current.owner,title:patch.title||current.title,createdAt:current.createdAt})}
  function remove(id,options={}){const current=get(id),s=store();return !!(current&&s&&s.deleteFile(id,{owner:current.owner,permanent:options.permanent===true}))}
  function clear(options={}){const s=store();if(!s)return false;const files=s.listFiles({owner:options.owner===false?false:(options.owner||currentOwner()),includeTrash:true});files.forEach(file=>s.deleteFile(file.id,{owner:file.owner,permanent:true,emit:false}));return true}
  function duplicate(id,options={}){const current=get(id),s=store();return current&&s?toRecord(s.duplicateFile(id,{owner:current.owner,name:options.title||current.title+' 副本',makeCurrent:options.makeCurrent!==false})):null}
  function stats(options={}){const s=store();if(!s)return{count:0,nodeCount:0,linkCount:0,latestUpdatedAt:0};const files=s.listFiles(options);return{count:files.length,nodeCount:files.reduce((n,f)=>n+(f.nodeCount||0),0),linkCount:files.reduce((n,f)=>n+(f.linkCount||0),0),latestUpdatedAt:files.reduce((n,f)=>Math.max(n,f.updatedAt||0),0)}}
  global.KGHomeFileLibrary={LIBRARY_KEY:LEGACY_LIBRARY_KEY,MAX_RECORDS:200,currentOwner,list,get,save,saveCurrent,update,remove,clear,duplicate,stats,readAll:list,writeAll(){console.warn('[KGHomeFileLibrary] writeAll 已废弃，请使用 KGGraphFileStore。');return false}};
})(window);
