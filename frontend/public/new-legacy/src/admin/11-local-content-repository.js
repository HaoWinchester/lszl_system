'use strict';
(function(global){
  const Core=global.KGAdminCore;
  const TEACHING_RESOURCES=Object.freeze(['subjects','taxonomies','activityOverrides','tags','collections']);
  const DEFAULT_KEYS=Object.freeze({audit:'audit',snapshots:'snapshots',taxonomyImports:'taxonomyImports',taxonomyReleases:'taxonomyReleases',taxonomyDeletions:'taxonomyDeletions',adminSettings:'adminSettings'});
  class LocalContentRepository{
    constructor(options={}){this.keysMap=Object.freeze({...DEFAULT_KEYS,...(options.keys||{})});this.mode='domain-api';global.KGContentRepository?.assertRepository?.(this)}
    key(name){return this.keysMap[name]||String(name||'')}
    read(name,fallback=null){
      if(TEACHING_RESOURCES.includes(name))return Core.clone(global.KGTeachingContentApi?.readResource?.(name,fallback)??fallback);
      const summary=global.KGAdminDomainSummary?.snapshot?.();
      if(name==='audit')return Core.clone(summary?.audit??fallback);
      return Core.clone(fallback);
    }
    write(name,value){if(TEACHING_RESOURCES.includes(name))return global.KGTeachingContentApi.saveCatalogResource(name,Core.clone(value)).then(()=>true);return false}
    remove(name){if(TEACHING_RESOURCES.includes(name))return global.KGTeachingContentApi.saveCatalogResource(name,[]).then(()=>true);return false}
    exists(name){if(TEACHING_RESOURCES.includes(name))return Array.isArray(global.KGTeachingContentApi?.readResource?.(name,null));if(name==='audit')return !!global.KGAdminDomainSummary?.snapshot?.();return false}
    keys(){return TEACHING_RESOURCES.slice()}
    snapshot(names=this.keys()){const values={};(names||[]).forEach(name=>{values[name]={exists:this.exists(name),value:this.read(name,null)}});return {schemaVersion:1,createdAt:Core.nowIso(),repositoryMode:this.mode,values}}
    restore(){return {valid:false,errors:['通用快照恢复已停用；请通过对应领域 API 执行变更。'],restored:0}}
    health(){return {valid:true,mode:this.mode,writable:false,writableResources:TEACHING_RESOURCES.slice(),keyCount:this.keys().length,keys:Core.clone(this.keysMap)}}
  }
  global.KGLocalContentRepository=LocalContentRepository;global.KG_LOCAL_CONTENT_KEYS=DEFAULT_KEYS;
})(window);
