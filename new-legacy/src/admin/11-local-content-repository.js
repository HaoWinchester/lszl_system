'use strict';
(function(global){
  const Core=global.KGAdminCore;
  const TEACHING_RESOURCES=Object.freeze(['subjects','taxonomies','activityOverrides','tags','collections']);
  const DEFAULT_KEYS=Object.freeze({audit:'audit',snapshots:'snapshots',taxonomyImports:'taxonomyImports',taxonomyReleases:'taxonomyReleases',taxonomyDeletions:'taxonomyDeletions',adminSettings:'adminSettings'});
  class LocalContentRepository{
    constructor(options={}){this.values=new Map();this.keysMap=Object.freeze({...DEFAULT_KEYS,...(options.keys||{})});this.mode='memory';global.KGContentRepository?.assertRepository?.(this)}
    key(name){return this.keysMap[name]||String(name||'')}
    read(name,fallback=null){if(TEACHING_RESOURCES.includes(name))return Core.clone(global.KGTeachingContentApi?.readResource?.(name,fallback)??fallback);return this.values.has(this.key(name))?Core.clone(this.values.get(this.key(name))):Core.clone(fallback)}
    write(name,value){if(TEACHING_RESOURCES.includes(name))return global.KGTeachingContentApi.saveCatalogResource(name,Core.clone(value)).then(()=>true);this.values.set(this.key(name),Core.clone(value));return true}
    remove(name){if(TEACHING_RESOURCES.includes(name))return global.KGTeachingContentApi.saveCatalogResource(name,[]).then(()=>true);this.values.delete(this.key(name));return true}
    exists(name){if(TEACHING_RESOURCES.includes(name))return Array.isArray(global.KGTeachingContentApi?.readResource?.(name,null));return this.values.has(this.key(name))}
    keys(){return Object.keys(this.keysMap)}
    snapshot(names=this.keys()){const values={};(names||[]).forEach(name=>{values[name]={exists:this.exists(name),value:this.read(name,null)}});return {schemaVersion:1,createdAt:Core.nowIso(),repositoryMode:this.mode,values}}
    restore(snapshot){if(!snapshot?.values||typeof snapshot.values!=='object')return {valid:false,errors:['快照格式无效。']};const failed=[];Object.entries(snapshot.values).forEach(([name,entry])=>{const ok=entry?.exists?this.write(name,entry.value):this.remove(name);if(!ok)failed.push(name)});return {valid:failed.length===0,errors:failed.length?[`以下资源恢复失败：${failed.join(', ')}`]:[],restored:Object.keys(snapshot.values).length-failed.length}}
    health(){return {valid:true,mode:this.mode,writable:true,keyCount:this.keys().length,keys:Core.clone(this.keysMap)}}
  }
  global.KGLocalContentRepository=LocalContentRepository;global.KG_LOCAL_CONTENT_KEYS=DEFAULT_KEYS;
})(window);
