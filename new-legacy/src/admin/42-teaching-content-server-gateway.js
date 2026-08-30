'use strict';
(function(global){
  function createAdminTeachingContentGateway(options={}){
    const Services=options.services,reconcileServerProjection=options.reconcileServerProjection,Api=global.KGTeachingContentApi;
    if(!Services||typeof reconcileServerProjection!=='function'||!Api)throw new Error('教学内容 API 能力未就绪。');
    const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(_error){return value}};
    const clean=value=>String(value??'').trim();
    const snapshots=new Map();
    let tail=Promise.resolve();

    function enqueue(operation){
      const current=tail.catch(()=>undefined).then(operation);
      tail=current.catch(error=>{
        try{global.dispatchEvent?.(new global.CustomEvent('kg-admin-teaching-content-sync-error',{detail:{error}}))}catch(_error){}
        return undefined;
      });
      return current;
    }

    function mapTaxonomy(source={}){
      const id=clean(source.id),nodes=(Array.isArray(source.nodes)?source.nodes:[]).map((node,index)=>({...clone(node),id:clean(node.id),taxonomyId:id,parentId:node.parentId?clean(node.parentId):null,level:Math.max(1,Number(node.level)||1),title:typeof node.title==='object'?node.title:{zh:clean(node.title||node.id),en:''},status:clean(node.status)||'active',sortOrder:Number(node.sortOrder||index+1)}));
      return {...clone(source),id,subjectId:clean(source.subjectId),name:typeof source.name==='object'?source.name:{zh:clean(source.name||source.title||id),en:''},version:Math.max(1,Number(source.version)||1),status:clean(source.status)||'published',isDefault:source.isDefault!==false,nodes};
    }
    async function hydrateSubject(subjectId){const data=await Api.bootstrap(subjectId,{relationships:true}),raw=data?.knowledgeTree?.taxonomy;snapshots.set(clean(subjectId),clone(data));return {taxonomy:raw?mapTaxonomy(raw):null,recallLibrary:clone(data.recallLibrary||null),contentRevision:Number(data.contentRevision)||0}}
    function persistResource(name,value){
      return enqueue(async()=>({valid:true,resource:name,value:await Api.saveCatalogResource(name,value)}));
    }
    const gateway=Object.freeze({hydrateSubject,persistResource,flush:()=>tail,getSnapshot:subjectId=>clone(snapshots.get(clean(subjectId))||Api.snapshot())});
    global.KGAdminTeachingContentGateway=gateway;return gateway;
  }
  global.KGCreateAdminTeachingContentGateway=createAdminTeachingContentGateway;
})(window);
