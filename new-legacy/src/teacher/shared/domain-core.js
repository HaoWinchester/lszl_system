'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const clean=value=>String(value??'').trim();
  const nowIso=()=>new Date().toISOString();
  const createId=(prefix='tx')=>`${prefix}-${global.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36)}`;
  function replaceObject(target,source){
    if(!target||typeof target!=='object')return source;
    Object.keys(target).forEach(key=>delete target[key]);
    Object.assign(target,clone(source));
    return target;
  }
  function result(ok,value=null,errors=[],warnings=[],meta={}){
    return {ok:!!ok,value:clone(value),errors:[...new Set((errors||[]).map(clean).filter(Boolean))],warnings:[...new Set((warnings||[]).map(clean).filter(Boolean))],meta:clone(meta||{})};
  }
  function createAuditService(options={}){
    const read=options.read||(()=>[]),write=options.write||(()=>false),key=clean(options.key)||'kg_admin_audit_log_v1',limit=Math.max(50,Number(options.limit)||500),actor=options.actor||(()=>({id:'local-teacher',name:'本地教师',role:'teacher'}));
    function append(entry={}){
      const record={id:clean(entry.id)||createId('audit'),schemaVersion:1,at:clean(entry.at)||nowIso(),actor:clone(entry.actor||actor()),action:clean(entry.action)||'teacher.domain.update',entityType:clean(entry.entityType)||'teacher-domain',entityId:clean(entry.entityId),status:clean(entry.status)||'success',summary:clean(entry.summary),transactionId:clean(entry.transactionId),metadata:clone(entry.metadata||{})};
      try{const rows=read(key,[]);if(!write(key,[record,...(Array.isArray(rows)?rows:[])].slice(0,limit)))throw new Error('审计存储写入失败');return result(true,record)}catch(error){return result(false,null,[error?.message||error],[],{record})}
    }
    return Object.freeze({append,key});
  }
  function createTransactionService(options={}){
    const audit=options.audit||null;
    function execute(config={}){
      const transactionId=clean(config.transactionId)||createId(config.prefix||'teacher-tx');
      const targets=Array.isArray(config.targets)?config.targets:[];
      const snapshots=targets.map(clone);
      const itemResults=[];
      let committed=false;
      try{
        targets.forEach((target,index)=>{
          const outcome=config.mutate?.(target,index,transactionId);
          if(outcome===false||outcome?.ok===false)throw new Error(outcome?.errors?.[0]||outcome?.error||`第 ${index+1} 项处理失败`);
          itemResults.push({index,ok:true,value:clone(outcome?.value??outcome??target)});
        });
        const persisted=config.persist?.(transactionId,itemResults);
        if(persisted===false||persisted?.ok===false)throw new Error(persisted?.errors?.[0]||persisted?.error||'保存失败');
        committed=true;
        config.onCommit?.(transactionId,itemResults);
        if(config.audit) audit?.append?.({...config.audit,status:'success',transactionId,metadata:{...(config.audit.metadata||{}),itemCount:targets.length,batchId:transactionId,questionId:String(config.audit.metadata?.questionId||targets[0]?.id||config.audit.entityId||'batch')}});
        return result(true,{transactionId,itemResults},[],[],{committed:true});
      }catch(error){
        targets.forEach((target,index)=>replaceObject(target,snapshots[index]));
        try{config.rollback?.(transactionId,error,snapshots)}catch(rollbackError){}
        if(config.audit) audit?.append?.({...config.audit,status:'failed',transactionId,metadata:{...(config.audit.metadata||{}),itemCount:targets.length,error:String(error?.message||error),batchId:transactionId,questionId:String(config.audit.metadata?.questionId||targets[0]?.id||config.audit.entityId||'batch')}});
        return result(false,{transactionId,itemResults},[error?.message||error],[],{committed:false,rolledBack:true});
      }finally{config.onFinally?.({transactionId,committed})}
    }
    return Object.freeze({execute});
  }
  root.Core=Object.freeze({clone,clean,createId,nowIso,replaceObject,result,createAuditService,createTransactionService});
})(globalThis);
