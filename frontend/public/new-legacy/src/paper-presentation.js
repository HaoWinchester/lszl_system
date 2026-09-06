'use strict';
(function(global){
  const RECENT_PUBLICATION_MS=3*24*60*60*1000;
  function isRecentPublication(paper,now=Date.now()){
    const publishedAt=Number(paper?.publishedAt),age=now-publishedAt;
    return Number.isFinite(publishedAt)&&publishedAt>0&&age>=0&&age<RECENT_PUBLICATION_MS;
  }
  const api=Object.freeze({isRecentPublication});
  global.KGPaperPresentation=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
