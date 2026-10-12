'use strict';
(function(global){
  const clone=value=>JSON.parse(JSON.stringify(value));
  function create({kind,graph,fileId=null,persist=null}={}){
    if(!['formal','temporary'].includes(kind))throw new Error('Invalid graph session kind');
    if(kind==='temporary'&&persist!=null)throw new Error('Temporary sessions reject persist adapters');
    let value=clone(graph),closed=false;const urls=new Map();
    const assertOpen=()=>{if(closed)throw new Error('Graph session is closed')};
    const getState=()=>{assertOpen();return value};
    const replaceState=graph=>{assertOpen();value=clone(graph);return value};
    const history=global.KGGraphHistoryController.create({capture:getState,restore:replaceState});
    function trackObjectUrl(url,revoke=u=>global.URL.revokeObjectURL(u)){assertOpen();urls.set(url,revoke);return url}
    function close(){if(closed)return;history.clear();closed=true;for(const [url,revoke] of urls)revoke(url);urls.clear();value=null}
    return Object.freeze({kind,fileId:kind==='temporary'?null:fileId,getState,replaceState,history,trackObjectUrl,close,get closed(){return closed},persist(options){assertOpen();return kind==='temporary'?true:typeof persist==='function'?persist(value,options):true}});
  }
  global.KGGraphSession=Object.freeze({create});
  if(typeof module!=='undefined')module.exports=global.KGGraphSession;
})(typeof window!=='undefined'?window:globalThis);
