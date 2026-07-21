'use strict';

/*
 * CardRegistry
 * 管理学习卡片定义，不负责挂载或状态。
 */
(function(global){
  const definitions=new Map();
  const listeners=new Set();

  function notify(type,definition){
    const detail={type,definition,cardId:definition?.id||'',at:Date.now()};
    listeners.forEach(listener=>{
      try{listener(detail)}catch(error){console.error('CardRegistry listener error',error)}
    });
    try{global.dispatchEvent(new CustomEvent('kg:card-registry-changed',{detail}))}catch(e){}
  }
  function register(definition,options={}){
    global.KGCardContract?.assertDefinition?.(definition);
    const id=String(definition.id);
    if(definitions.has(id)&&!options.replace){
      const existing=definitions.get(id);
      if(String(existing.version)===String(definition.version))return existing;
      throw new Error('学习卡片已注册：'+id);
    }
    const normalized=Object.freeze({
      title:id,
      description:'',
      loadPolicy:'eager',
      styleIsolation:'scoped',
      ...definition,
      id,
      version:String(definition.version)
    });
    definitions.set(id,normalized);
    notify('registered',normalized);
    return normalized;
  }
  function unregister(id){
    id=String(id||'');
    const existing=definitions.get(id);
    if(!existing)return false;
    definitions.delete(id);
    notify('unregistered',existing);
    return true;
  }
  function get(id){return definitions.get(String(id||''))||null}
  function has(id){return definitions.has(String(id||''))}
  function list(){return [...definitions.values()]}
  function subscribe(listener){
    if(typeof listener!=='function')return()=>{};
    listeners.add(listener);
    return()=>listeners.delete(listener);
  }

  global.KGCardRegistry=Object.freeze({register,unregister,get,has,list,subscribe});
})(window);
