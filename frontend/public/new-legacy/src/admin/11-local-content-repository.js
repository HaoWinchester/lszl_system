'use strict';
(function(global){
  const Core=global.KGAdminCore;
  const TEACHING_RESOURCES=Object.freeze(['subjects','taxonomies','activityOverrides','tags','collections']);
  // allowedUntilTask7: course/task mutations still use the exact compatibility facade.
  const allowedUntilTask7=Object.freeze({courseDrafts:'kg_course_config_drafts_v1',courseReleases:'kg_course_config_releases_v1',activeCourse:'kg_course_config_active_release_v1',tasks:'kg_learning_tasks_v1'});
  const DEFAULT_KEYS=Object.freeze({...allowedUntilTask7,papers:'kg_assessment_papers_v1',audit:'kg_admin_audit_log_v1',snapshots:'kg_admin_transaction_snapshots_v1',taxonomyImports:'kg_taxonomy_import_records_v1',taxonomyReleases:'kg_taxonomy_release_records_v1',taxonomyDeletions:'kg_taxonomy_deletion_records_v1',adminSettings:'kg_admin_settings_v1'});
  class LocalContentRepository{
    constructor(options={}){this.storage=options.storage||global.KGAppStorage||null;this.keysMap=Object.freeze({...DEFAULT_KEYS,...(options.keys||{})});this.mode='local';global.KGContentRepository?.assertRepository?.(this)}
    key(name){return this.keysMap[name]||String(name||'')}
    read(name,fallback=null){if(TEACHING_RESOURCES.includes(name))return Core.clone(global.KGTeachingContentApi?.readResource?.(name,fallback)??fallback);const key=this.key(name);if(this.storage?.readJSON)return Core.clone(this.storage.readJSON(key,fallback));try{const raw=global.localStorage?.getItem(key);return raw?JSON.parse(raw):Core.clone(fallback)}catch(error){return Core.clone(fallback)}}
    write(name,value){if(TEACHING_RESOURCES.includes(name))return global.KGTeachingContentApi.saveCatalogResource(name,Core.clone(value)).then(()=>true);const key=this.key(name);if(this.storage?.writeJSON)return this.storage.writeJSON(key,Core.clone(value));try{global.localStorage?.setItem(key,JSON.stringify(value));return true}catch(error){return false}}
    remove(name){if(TEACHING_RESOURCES.includes(name))return global.KGTeachingContentApi.saveCatalogResource(name,[]).then(()=>true);const key=this.key(name);if(this.storage?.remove)return this.storage.remove(key);try{global.localStorage?.removeItem(key);return true}catch(error){return false}}
    exists(name){if(TEACHING_RESOURCES.includes(name))return Array.isArray(global.KGTeachingContentApi?.readResource?.(name,null));const key=this.key(name);if(this.storage?.exists)return this.storage.exists(key);try{return global.localStorage?.getItem(key)!=null}catch(error){return false}}
    keys(){return Object.keys(this.keysMap)}
    snapshot(names=this.keys()){const values={};(names||[]).forEach(name=>{values[name]={exists:this.exists(name),value:this.read(name,null)}});return {schemaVersion:1,createdAt:Core.nowIso(),repositoryMode:this.mode,values}}
    restore(snapshot){if(!snapshot?.values||typeof snapshot.values!=='object')return {valid:false,errors:['快照格式无效。']};const failed=[];Object.entries(snapshot.values).forEach(([name,entry])=>{const ok=entry?.exists?this.write(name,entry.value):this.remove(name);if(!ok)failed.push(name)});return {valid:failed.length===0,errors:failed.length?[`以下资源恢复失败：${failed.join(', ')}`]:[],restored:Object.keys(snapshot.values).length-failed.length}}
    health(){const probe='__kg_admin_repository_probe__';let writable=false;try{const storageKey=this.key(probe);global.localStorage?.setItem(storageKey,'1');writable=global.localStorage?.getItem(storageKey)==='1';global.localStorage?.removeItem(storageKey)}catch(error){}return {valid:!!global.localStorage,mode:this.mode,writable,keyCount:this.keys().length,keys:Core.clone(this.keysMap)}}
  }
  global.KGLocalContentRepository=LocalContentRepository;global.KG_LOCAL_CONTENT_KEYS=DEFAULT_KEYS;
})(window);
