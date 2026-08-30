'use strict';
(function(global){
  function createAdminTeachingContentGateway(options={}){
    const Services=options.services,reconcileServerProjection=options.reconcileServerProjection,Api=global.KGTeachingContentApi;
    if(!Services||typeof reconcileServerProjection!=='function'||!Api)throw new Error('教学内容 API 能力未就绪。');
    const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(_error){return value}};
    const clean=value=>String(value??'').trim();
    const snapshots=new Map();
    let tail=Promise.resolve(),applying=false;

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
    function applyCurrent(subjectId,taxonomy){applying=true;try{const result=reconcileServerProjection(subjectId,mapTaxonomy(taxonomy));if(result?.valid===false)throw new Error((result.errors||['知识树内存快照更新失败']).join('；'))}finally{applying=false}}
    async function hydrateSubject(subjectId){const data=await Api.bootstrap(subjectId),raw=data?.knowledgeTree?.taxonomy;if(raw)applyCurrent(raw.subjectId||subjectId,raw);snapshots.set(clean(subjectId),clone(data));return {taxonomy:raw?mapTaxonomy(raw):null,recallLibrary:clone(data.recallLibrary||null),contentRevision:Number(data.contentRevision)||0}}
    async function saveTaxonomyNow(taxonomy){const saved=await Api.saveTaxonomy(mapTaxonomy(taxonomy));const data=Api.snapshot();snapshots.set(clean(saved.subjectId),clone(data));return {taxonomy:mapTaxonomy(saved),recallLibrary:clone(data.recallLibrary||null),contentRevision:Number(data.contentRevision)||0}}
    async function publishTaxonomy(taxonomy){return enqueue(()=>saveTaxonomyNow(taxonomy))}
    async function publishCurrentTaxonomyFromStore(subjectId){const current=Services.taxonomies.currentForSubject(subjectId);return current?publishTaxonomy(current):null}
    function persistResource(name,value){
      if(applying)return tail;
      return enqueue(async()=>{
        if(name==='taxonomies'){
          const rows=Array.isArray(value)?value:[];
          for(const subject of Services.legacyContent.getSubjects()){
            const current=rows.find(row=>row.subjectId===subject.id&&(row.isDefault||row.id===subject.defaultTaxonomyId))||rows.find(row=>row.subjectId===subject.id&&row.status==='published');
            if(current)await saveTaxonomyNow(current);
          }
        }else if(name==='activityOverrides'&&Array.isArray(value)&&value.length){
          await Api.importActivities(value);
        }
        return {valid:true,resource:name};
      });
    }
    const gateway=Object.freeze({hydrateSubject,publishTaxonomy,publishCurrentTaxonomyFromStore,persistResource,flush:()=>tail,getSnapshot:subjectId=>clone(snapshots.get(clean(subjectId))||Api.snapshot())});
    global.KGAdminTeachingContentGateway=gateway;return gateway;
  }
  global.KGCreateAdminTeachingContentGateway=createAdminTeachingContentGateway;
})(window);
