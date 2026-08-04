'use strict';
(function(global){
  const VERSION='9.0-p4.1.1';
  const SCHEMA_VERSION=1;
  const clone=value=>{if(value==null)return value;try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const clean=value=>String(value??'').trim();
  const unique=values=>[...new Set((values||[]).map(value=>clean(value)).filter(Boolean))];
  const nowIso=()=>new Date().toISOString();
  const safeId=(prefix='id')=>prefix+'-'+(global.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36));
  function hash(value){let h=0x811c9dc5;for(const char of String(value??'')){h^=char.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0}return 'fnv1a32:'+h.toString(16).padStart(8,'0')}
  function result(value={}){return {valid:value.valid!==false,errors:Array.isArray(value.errors)?value.errors:[],warnings:Array.isArray(value.warnings)?value.warnings:[],...value}}
  function actor(){
    const user=global.KGAuthCore?.currentUser?.({includeInactive:true})||global.KGLearningContent?.currentUser?.()||null;
    return {id:clean(user?.id||user?.username)||'local-anonymous',name:clean(user?.displayName||user?.name||user?.username)||'未登录本地用户',role:clean(user?.role)||'guest'};
  }
  global.KGAdminCore=Object.freeze({VERSION,SCHEMA_VERSION,clone,clean,unique,nowIso,safeId,hash,result,actor});
})(window);
