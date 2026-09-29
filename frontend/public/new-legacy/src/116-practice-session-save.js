'use strict';
;(function(global){
  const METHODS=Object.freeze({pause:'pauseSession',abandon:'abandonSession',complete:'completeSession'});
  const CLOSE_BYTE_LIMIT=48*1024;
  function clone(value){return JSON.parse(JSON.stringify(value))}
  function describeStatus({total=0,saved=0,answered=0,dirty=false,saving=false,error=false,conflict=false,online=true}={}){
    if(conflict)return {kind:'conflict',text:'其他页面已更新进度，请先加载最新进度。'};
    if(saving)return {kind:'saving',text:'正在保存进度，请稍候…'};
    if(!online)return {kind:'offline',text:`网络已断开；服务器已保存 ${saved}/${total} 题。请保持页面打开，联网后保存。`};
    if(error)return {kind:'error',text:`保存失败，当前答案仍在本页；服务器已保存 ${saved}/${total} 题。请重试保存。`};
    if(dirty)return {kind:'dirty',text:`本轮已答 ${answered}/${total} 题，服务器已保存 ${saved} 题；最新进度尚未保存。`};
    return {kind:'saved',text:`已保存 ${saved}/${total} 题；已保存的进度可下次继续。`};
  }
  function create({api}){
    let inFlight=null,closeSent=false;
    function save(action,sessionId,input){
      if(!METHODS[action]||!sessionId)return Promise.reject(new Error('无效的保存操作'));
      const body=clone(input),key=JSON.stringify([action,sessionId,body]);
      if(inFlight)return inFlight.key===key?inFlight.promise:Promise.reject(new Error('已有保存操作正在进行'));
      const intent={action,sessionId,body,key,promise:null};
      inFlight=intent;
      let request;
      try{request=api[METHODS[action]](sessionId,body,{keepalive:false})}
      catch(error){request=Promise.reject(error)}
      intent.promise=Promise.resolve(request).finally(()=>{if(inFlight===intent)inFlight=null});
      return intent.promise;
    }
    function flushForPageHide({sessionId,input,active,dirty}){
      if(closeSent)return false;
      const intent=inFlight||(sessionId&&active&&dirty?{action:'pause',sessionId,body:input}:null);
      if(!intent)return false;
      const body=clone(intent.body);
      if(new TextEncoder().encode(JSON.stringify(body)).byteLength>CLOSE_BYTE_LIMIT)return false;
      closeSent=true;
      try{
        Promise.resolve(api[METHODS[intent.action]](intent.sessionId,body,{keepalive:true})).catch(()=>{});
        return true;
      }catch(error){return false}
    }
    function reset(){if(inFlight)return false;closeSent=false;return true}
    return Object.freeze({save,flushForPageHide,reset,pending:()=>!!inFlight});
  }
  global.KGPracticeSessionSave=Object.freeze({create,describeStatus});
})(window);
