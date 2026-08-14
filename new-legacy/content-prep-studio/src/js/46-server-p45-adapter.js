/*
 * P4.5 服务器适配器：Subject Facet Schema 的服务器加载与推送（差异 9–11）。
 * - loadSubjectFacetSchemas：从 /content-prep/subject-facets 读取服务器 Schema（正式真源），
 *   按 subjectId 合并进本地 state.subjectFacetRegistry；服务器数据不整包覆盖，只按科目替换。
 * - pushSubjectFacetSchema：显式推送编辑后的 Schema；revision/contentRevision 冲突（409）时
 *   拒绝覆盖：自动刷新服务器最新版并要求教师重新确认，不做静默合并。
 */
(function(global){
  const API_ROOT='/api/v1';
  class P45ServerError extends Error{
    constructor(code,message,{status=0,serverCode='',detail=null}={}){
      super(message);this.name='P45ServerError';this.code=code;this.status=status;this.serverCode=serverCode;this.detail=detail;
    }
  }
  async function request(path,options={}){
    let response;
    try{
      response=await global.fetch(`${API_ROOT}${path}`,{
        ...options,
        credentials:'include',
        headers:{...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}
      });
    }catch(cause){
      throw new P45ServerError('NETWORK_ERROR','无法连接服务器，本地 Facet 配置保持不变。',{cause});
    }
    let payload={};
    try{payload=await response.json()}catch(_error){payload={}}
    if(!response.ok){
      const detail=payload?.detail??payload??{};
      const serverCode=String(detail?.code||'');
      throw new P45ServerError(serverCode||`HTTP_${response.status}`,String(detail?.message||detail||`请求失败（${response.status}）`),{status:response.status,serverCode,detail});
    }
    return payload;
  }

  function currentState(){
    return typeof state!=='undefined'?state:null;
  }
  function registryWithServerSchemas(serverSchemas){
    const reg=normalizeSubjectFacetRegistry(currentState()?.subjectFacetRegistry||{});
    (serverSchemas||[]).forEach(schema=>{
      const normalized=normalizeFacetSchema(schema);
      if(!normalized.schemaId||!normalized.subjectId)return;
      const index=reg.schemas.findIndex(s=>s.schemaId===normalized.schemaId||s.subjectId===normalized.subjectId);
      if(index>=0)reg.schemas[index]=normalized;else reg.schemas.push(normalized);
    });
    return reg;
  }
  function refreshFacetUI(){
    if(typeof renderSubjectFacetManager==='function')renderSubjectFacetManager();
  }

  async function loadSubjectFacetSchemas(){
    const payload=await request('/content-prep/subject-facets');
    const appState=currentState();
    if(appState){
      appState.subjectFacetRegistry=registryWithServerSchemas(payload?.schemas);
      refreshFacetUI();
    }
    return {schemas:payload?.schemas||[],contentRevision:Number(payload?.contentRevision||0)};
  }

  async function pushSubjectFacetSchema(schema,{contentRevision=0}={}){
    let result;
    try{
      result=await request('/content-prep/subject-facets',{
        method:'PUT',
        body:JSON.stringify({contentRevision:Number(contentRevision),schema:JSON.parse(JSON.stringify(schema||{}))})
      });
    }catch(error){
      if(error.status===409){
        const latest=await loadSubjectFacetSchemas();
        throw new P45ServerError('SUBJECT_FACET_REVISION_CONFLICT',
          `服务器 Facet Schema 已更新（当前 revision ${latest.contentRevision}），已刷新为最新版；请重新确认你的修改后再次推送。`,
          {status:409,serverCode:error.serverCode,detail:{latestContentRevision:latest.contentRevision}});
      }
      throw error;
    }
    const appState=currentState();
    if(appState){
      appState.subjectFacetRegistry=registryWithServerSchemas([result?.schema]);
      refreshFacetUI();
    }
    return result;
  }

  async function loadBuildMetadata(){
    const metadata=await request('/content-prep/build-metadata');
    if(typeof prepRuntime!=='undefined')prepRuntime.serverBuildMetadata=metadata;
    global.PMPPrepAuthoringContract?.renderVersionHeader?.({
      serverBuild:metadata.serverBuild,
    });
    return metadata;
  }

  async function previewPrincipleMerge(bundle){
    return request('/content-prep/principle-merges/preview',{
      method:'POST',
      body:JSON.stringify({bundle}),
    });
  }

  async function applyPrincipleMerge(bundle,{contentRevision,resolutions}={}){
    return request('/content-prep/principle-merges/apply',{
      method:'POST',
      body:JSON.stringify({
        contentRevision:Number(contentRevision),
        bundle,
        resolutions:Array.isArray(resolutions)?resolutions:[],
      }),
    });
  }

  global.PMPPrepP45Server=Object.freeze({
    P45ServerError,
    loadSubjectFacetSchemas,
    pushSubjectFacetSchema,
    loadBuildMetadata,
    previewPrincipleMerge,
    applyPrincipleMerge,
  });
})(window);
