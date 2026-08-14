'use strict';

/* Pure Deep Recall flow rules shared by the controller and contract tests. */
(function(global){
  function clean(value){return String(value??'').trim()}
  function slug(value){
    return clean(value).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g,'-').replace(/^-+|-+$/g,'')||'question';
  }
  function ancestorDataIds(nodes,instanceId){
    const list=Array.isArray(nodes)?nodes:[];
    const byId=new Map(list.map(node=>[clean(node?.instanceId),node]));
    const blocked=new Set();
    let cursor=byId.get(clean(instanceId))||null,guard=0;
    while(cursor&&guard++<list.length+1){
      const dataId=clean(cursor.dataId);if(dataId)blocked.add(dataId);
      cursor=cursor.parentId?byId.get(clean(cursor.parentId))||null:null;
    }
    return blocked;
  }
  function filterAncestorChoices(nodes,instanceId,choices){
    const blocked=ancestorDataIds(nodes,instanceId),seen=new Set();
    return (Array.isArray(choices)?choices:[]).filter(choice=>{
      const next=clean(choice?.next);
      if(!next||blocked.has(next)||seen.has(next))return false;
      seen.add(next);return true;
    });
  }
  function personalNodeId(questionId,token=''){
    const suffix=clean(token)||global.crypto?.randomUUID?.()||(
      Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)
    );
    return `personal:${slug(questionId)}:${slug(suffix)}`;
  }

  const api=Object.freeze({ancestorDataIds,filterAncestorChoices,personalNodeId});
  global.KGDeepRecallFlowModel=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
