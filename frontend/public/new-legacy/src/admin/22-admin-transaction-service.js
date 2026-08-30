'use strict';
(function(global){
  const Core=global.KGAdminCore;
  class AdminTransactionService{
    constructor(repository,audit,permissions){this.repository=repository;this.audit=audit;this.permissions=permissions}
    snapshots(){return []}
    createSnapshot(){return {valid:false,errors:['通用浏览器快照已退役；请使用对应领域 API。'],persisted:false}}
    restoreSnapshot(){return {valid:false,errors:['通用浏览器快照已退役，不能恢复。'],persisted:false}}
    execute(){return {valid:false,errors:['同步浏览器事务已退役；请使用异步领域 API。'],persisted:false}}
    async executeAsync(spec={}){
      const permission=spec.permission?(this.permissions?.require?.(spec.permission)||{valid:true}):{valid:true};if(!permission.valid)return permission;
      const transactionId=Core.safeId('tx');
      try{
        const preflight=typeof spec.validate==='function'?await spec.validate():{valid:true};
        if(preflight?.valid===false)throw Object.assign(new Error((preflight.errors||['校验失败。']).join('；')),{preflight});
        const value=typeof spec.commit==='function'?await spec.commit():undefined;
        if(value?.valid===false)throw Object.assign(new Error((value.errors||['提交失败。']).join('；')),{commitResult:value});
        return {valid:true,transactionId,snapshotId:'',value,warnings:preflight?.warnings||[],persistence:'domain-api'};
      }catch(error){
        return {valid:false,transactionId,snapshotId:'',errors:error.preflight?.errors||error.commitResult?.errors||[error.message||'事务失败。'],rollback:{valid:false,skipped:true,reason:'领域 API 写入不伪造浏览器快照回滚'}};
      }
    }
  }
  global.KGAdminTransactionService=AdminTransactionService;
})(window);
