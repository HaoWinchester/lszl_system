'use strict';

(function(global){
  const clean=value=>String(value??'').trim();
  function currentUser(){const user=global.KGAuthCore?.getCurrentUser?.()||null;return {id:clean(user?.username||user?.id),name:clean(user?.displayName||user?.name||user?.username)}}
  async function jsonResponse(response){const payload=await response.json().catch(()=>({}));if(response.ok)return payload;const detail=payload?.detail||payload;throw new Error(detail?.message||`服务器返回 ${response.status}`)}
  async function submit(activities,options={}){
    if(mode()==='offline-file')throw new Error('当前通过本地文件打开，浏览器无法可靠地与主程序共享活动库。请运行 serve.py 或部署到 HTTP/HTTPS 服务器后使用直连。');
    const endpoint=clean(options.endpoint||global.KG_SERVER_CONFIG?.activityImportEndpoint);
    if(!endpoint)throw new Error('活动导入服务端接口未配置。');
    let contentRevision=Number(options.contentRevision);
    if(!Number.isSafeInteger(contentRevision)||contentRevision<0){
      const revisionResponse=await global.fetch('/api/v1/question-catalog/revision',{credentials:'include'});
      const revisionPayload=await jsonResponse(revisionResponse);contentRevision=Number(revisionPayload.revision);
    }
    const response=await global.fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({contentRevision,activities})});
    return {...(await jsonResponse(response)),provider:'server'};
  }
  function mode(){return location.protocol==='file:'?'offline-file':(global.KG_SERVER_CONFIG?.activityImportEndpoint?'server':'unconfigured')}
  global.QuestionStudioSync=Object.freeze({submit,mode,currentUser});
})(window);
