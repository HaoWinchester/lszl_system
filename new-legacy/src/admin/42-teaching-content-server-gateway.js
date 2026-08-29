'use strict';

(function(global){
  const Services=global.KGAdminServices;
  if(!Services)return;

  const SHARED_CONTENT_PATH='/api/v1/content-prep/shared-content';
  const TAXONOMY_STORAGE_KEY='kg_content_taxonomies_v1';
  const snapshots=new Map();
  let applyingServerState=false;
  let publishTimer=0;

  const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(_error){return value}};
  const clean=value=>String(value??'').trim();

  async function requestJson(url,init={}){
    if(typeof global.fetch!=='function')throw new Error('当前环境缺少 fetch');
    const response=await global.fetch(url,{
      credentials:'include',
      headers:{Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{}),...(init.headers||{})},
      ...init,
    });
    let payload=null;
    try{payload=await response.json()}catch(_error){}
    if(!response.ok){
      const error=new Error(clean(payload?.detail||payload?.message)||`HTTP ${response.status}`);
      error.status=response.status;
      error.payload=payload;
      throw error;
    }
    return payload;
  }

  function localized(value,fallback=''){
    if(value&&typeof value==='object')return {zh:clean(value.zh||value.en||fallback),en:clean(value.en||'')};
    return {zh:clean(value||fallback),en:''};
  }

  function mapServerTaxonomy(source={}){
    const id=clean(source.id);
    const nodes=(Array.isArray(source.nodes)?source.nodes:[]).map((node,index)=>({
      ...clone(node),
      id:clean(node.id),
      taxonomyId:id,
      parentId:node.parentId?clean(node.parentId):null,
      level:Math.max(1,Number(node.level)||1),
      title:localized(node.title,node.id||'未命名知识点'),
      description:localized(node.description,''),
      status:clean(node.status)||'active',
      sortOrder:Number(node.sortOrder||index+1),
    }));
    return {
      ...clone(source),
      id,
      subjectId:clean(source.subjectId),
      name:localized(source.name||source.title,id||'未命名知识树'),
      version:Math.max(1,Number(source.version)||1),
      versionLabel:clean(source.versionLabel)||`v${Math.max(1,Number(source.version)||1)}.0`,
      status:'published',
      isDefault:true,
      nodes,
    };
  }

  function serverTaxonomy(taxonomy={}){
    const mapped=mapServerTaxonomy({...taxonomy,status:'published'});
    return {...mapped,status:'published',isDefault:true};
  }

  function fingerprint(taxonomy){
    if(!taxonomy)return '';
    const value=serverTaxonomy(taxonomy);
    return JSON.stringify({
      id:value.id,
      subjectId:value.subjectId,
      name:value.name,
      version:value.version,
      status:value.status,
      nodes:value.nodes,
    });
  }

  function applyCurrentTaxonomy(subjectId,taxonomy){
    applyingServerState=true;
    try{
      const saved=Services.taxonomies.reconcileServerProjection(subjectId,taxonomy);
      if(saved?.valid===false)throw new Error((saved.errors||['知识树本地投影保存失败']).join('；'));
    }finally{applyingServerState=false}
  }

  async function readSubject(subjectId){
    return requestJson(`${SHARED_CONTENT_PATH}?subjectId=${encodeURIComponent(clean(subjectId)||'PMP')}`);
  }

  async function hydrateSubject(subjectId){
    const data=await readSubject(subjectId);
    const raw=data?.knowledgeTree?.taxonomy;
    if(!raw||typeof raw!=='object')throw new Error('服务器尚无可用的已发布知识树');
    const taxonomy=mapServerTaxonomy(raw);
    applyCurrentTaxonomy(taxonomy.subjectId||subjectId,taxonomy);
    snapshots.set(taxonomy.subjectId||subjectId,{
      contentRevision:Number(data.contentRevision)||0,
      taxonomyId:taxonomy.id,
      fingerprint:fingerprint(taxonomy),
      recallLibrary:clone(data.recallLibrary||null),
    });
    return {taxonomy,recallLibrary:clone(data.recallLibrary||null),contentRevision:Number(data.contentRevision)||0};
  }

  async function saveTaxonomy(taxonomy,revision){
    const subjectId=clean(taxonomy.subjectId);
    return requestJson(SHARED_CONTENT_PATH,{
      method:'PUT',
      body:JSON.stringify({
        subjectId,
        contentRevision:Number(revision)||0,
        knowledgeTree:{taxonomy:serverTaxonomy(taxonomy)},
      }),
    });
  }

  async function publishTaxonomy(taxonomy){
    const candidate=serverTaxonomy(taxonomy);
    const subjectId=candidate.subjectId;
    let snapshot=snapshots.get(subjectId);
    if(!snapshot){
      const current=await readSubject(subjectId);
      snapshot={contentRevision:Number(current.contentRevision)||0,recallLibrary:clone(current.recallLibrary||null)};
      snapshots.set(subjectId,snapshot);
    }
    let saved;
    try{saved=await saveTaxonomy(candidate,snapshot.contentRevision)}
    catch(error){
      if(error?.status!==409)throw error;
      const current=await readSubject(subjectId);
      snapshot.contentRevision=Number(current.contentRevision)||0;
      saved=await saveTaxonomy(candidate,snapshot.contentRevision);
    }
    const returned=mapServerTaxonomy(saved?.knowledgeTree?.taxonomy||candidate);
    snapshots.set(subjectId,{
      contentRevision:Number(saved?.contentRevision)||snapshot.contentRevision,
      taxonomyId:returned.id,
      fingerprint:fingerprint(returned),
      recallLibrary:clone(saved?.recallLibrary||snapshot.recallLibrary||null),
    });
    return {taxonomy:returned,contentRevision:Number(saved?.contentRevision)||snapshot.contentRevision,recallLibrary:clone(saved?.recallLibrary||null)};
  }

  async function publishCurrentTaxonomyFromStore(subjectId){
    const current=Services.taxonomies.currentForSubject(subjectId);
    if(!current)return null;
    const snapshot=snapshots.get(subjectId);
    const currentFingerprint=fingerprint(current);
    if(snapshot?.fingerprint===currentFingerprint)return {taxonomy:current,contentRevision:snapshot.contentRevision,unchanged:true};
    return publishTaxonomy(current);
  }

  function scheduleCurrentPublication(){
    if(applyingServerState)return;
    global.clearTimeout(publishTimer);
    publishTimer=global.setTimeout(()=>{
      const subjects=Services.legacyContent.getSubjects();
      Promise.all(subjects.map(item=>publishCurrentTaxonomyFromStore(item.id))).catch(error=>{
        global.dispatchEvent?.(new CustomEvent('kg-admin-teaching-content-sync-error',{detail:{error}}));
      });
    },350);
  }

  global.addEventListener?.('kg-app-storage-change',event=>{
    if(clean(event?.detail?.key)===TAXONOMY_STORAGE_KEY)scheduleCurrentPublication();
  });

  global.KGAdminTeachingContentGateway=Object.freeze({
    hydrateSubject,
    publishTaxonomy,
    publishCurrentTaxonomyFromStore,
    getSnapshot:subjectId=>clone(snapshots.get(subjectId)||null),
  });
})(window);
