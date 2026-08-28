'use strict';
;(function(global){
  const METHODS=Object.freeze({pause:'pauseSession',abandon:'abandonSession',complete:'completeSession'});
  const CLOSE_BYTE_LIMIT=48*1024;
  function clone(value){return JSON.parse(JSON.stringify(value))}
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
  global.KGPracticeSessionSave=Object.freeze({create});
})(window);
