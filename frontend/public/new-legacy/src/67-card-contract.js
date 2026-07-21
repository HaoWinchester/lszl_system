'use strict';

/*
 * CardContract
 * 定义所有学习卡片必须实现的生命周期协议。
 */
(function(global){
  const INSTANCE_METHODS=['mount','update','validate','snapshot','setMode','focus','reset','destroy'];

  function isFunction(value){return typeof value==='function'}
  function normalizeValidation(result){
    if(result===true||result===undefined||result===null)return {valid:true,errors:[]};
    if(result===false)return {valid:false,errors:[{code:'INVALID',message:'当前卡片尚未完成。'}]};
    if(typeof result==='string')return {valid:false,errors:[{code:'INVALID',message:result}]};
    const valid=result.valid!==false;
    const errors=Array.isArray(result.errors)?result.errors:[];
    return {
      valid,
      errors:errors.map((error,index)=>{
        if(typeof error==='string')return {code:'INVALID_'+index,message:error};
        return {
          code:String(error?.code||'INVALID_'+index),
          message:String(error?.message||'当前卡片尚未完成。'),
          field:String(error?.field||'')
        };
      })
    };
  }
  function validateDefinition(definition){
    const errors=[];
    if(!definition||typeof definition!=='object')errors.push('卡片定义必须是对象。');
    if(!String(definition?.id||'').trim())errors.push('卡片定义缺少 id。');
    if(!String(definition?.version||'').trim())errors.push('卡片定义缺少 version。');
    if(!isFunction(definition?.create))errors.push('卡片定义缺少 create(context) 方法。');
    return {valid:errors.length===0,errors};
  }
  function validateInstance(instance){
    const missing=INSTANCE_METHODS.filter(method=>!isFunction(instance?.[method]));
    return {
      valid:missing.length===0,
      errors:missing.map(method=>'卡片实例缺少 '+method+'()。'),
      missing
    };
  }
  function assertDefinition(definition){
    const result=validateDefinition(definition);
    if(!result.valid)throw new Error(result.errors.join(' '));
    return definition;
  }
  function assertInstance(instance,cardId='unknown'){
    const result=validateInstance(instance);
    if(!result.valid)throw new Error('卡片 '+cardId+' 不符合协议：'+result.errors.join(' '));
    return instance;
  }

  global.KGCardContract=Object.freeze({
    INSTANCE_METHODS:Object.freeze(INSTANCE_METHODS.slice()),
    normalizeValidation,
    validateDefinition,
    validateInstance,
    assertDefinition,
    assertInstance
  });
})(window);
