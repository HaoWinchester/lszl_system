'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};
  const Core=root.Core;
  function create(options={}){
    if(!Core)throw new Error('KGTeacherDomains.Core 尚未加载');
    const transaction=options.transaction||Core.createTransactionService({audit:options.audit});
    function execute(config={}){
      const items=Array.isArray(config.items)?config.items:[];
      if(!items.length)return Core.result(false,null,['没有可处理的项目。']);
      const failures=[];
      const response=transaction.execute({
        prefix:config.prefix||'teacher-batch',targets:items,
        mutate:(item,index,transactionId)=>{
          try{return config.apply(item,index,transactionId)}catch(error){failures.push({index,id:String(item?.id||''),error:String(error?.message||error)});throw error}
        },
        persist:config.persist,
        rollback:config.rollback,
        audit:config.audit
      });
      return {...response,failures,processed:response.ok?items.length:0,total:items.length};
    }
    function executeBestEffort(config={}){
      const items=Array.isArray(config.items)?config.items:[];
      if(!items.length)return Core.result(false,null,['没有可处理的项目。']);
      const snapshots=items.map(Core.clone),itemResults=[],failures=[];
      items.forEach((item,index)=>{
        try{
          const outcome=config.apply?.(item,index,config.transactionId||'');
          if(outcome===false||outcome?.ok===false)throw new Error(outcome?.errors?.[0]||outcome?.error||`第 ${index+1} 项处理失败`);
          itemResults.push({index,id:String(item?.id||''),ok:true,skipped:!!outcome?.skipped,value:Core.clone(outcome?.value??outcome??item)});
        }catch(error){
          Core.replaceObject(item,snapshots[index]);
          failures.push({index,id:String(item?.id||''),error:String(error?.message||error)});
          itemResults.push({index,id:String(item?.id||''),ok:false,error:String(error?.message||error)});
        }
      });
      const successful=itemResults.filter(item=>item.ok&&!item.skipped);
      try{
        const persisted=config.persist?.(itemResults,failures);
        if(persisted===false||persisted?.ok===false)throw new Error(persisted?.errors?.[0]||persisted?.error||'保存失败');
      }catch(error){
        items.forEach((item,index)=>Core.replaceObject(item,snapshots[index]));
        try{config.rollback?.(error,snapshots)}catch(rollbackError){}
        return {...Core.result(false,{itemResults},[error?.message||error],[],{rolledBack:true}),failures,processed:0,total:items.length};
      }
      const ok=failures.length===0;
      if(config.audit) options.audit?.append?.({...config.audit,status:ok?'success':'partial',metadata:{...(config.audit.metadata||{}),itemCount:items.length,successCount:successful.length,failureCount:failures.length,failures}});
      return {...Core.result(ok,{itemResults},failures.map(item=>`第 ${item.index+1} 项：${item.error}`),failures.length?[`${failures.length} 项处理失败，其余项目已完整保存。`]:[],{partial:failures.length>0}),failures,processed:successful.length,total:items.length};
    }
    return Object.freeze({execute,executeBestEffort});
  }
  root.QuestionBank=root.QuestionBank||{};
  root.QuestionBank.BatchOperationService=Object.freeze({create});
})(globalThis);
