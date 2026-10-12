'use strict';
(function(global){
  function create({original,persist}){
    let draft=original,status='draft',version=0,composing=false,pending=null,error=null;
    function update(value){draft=value;version++;status='draft';error=null}
    function cancel(){version++;draft=original;status='draft';error=null;return original}
    async function commit(){
      if(composing)return false;if(pending)return pending;
      const current=version,value=draft;status='committing';
      pending=Promise.resolve().then(async()=>{try{const result=await persist(value);if(current!==version)return false;if(result===false)throw Error('文字未保存，请重试');status='committed';return true}catch(e){if(current===version){status='failed';error=e}return false}finally{pending=null}});
      return pending;
    }
    return Object.freeze({update,cancel,commit,setComposing:value=>{composing=!!value},state:()=>({original,draft,status,error,composing})});
  }
  const api=Object.freeze({create});global.KGTextEditSession=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
