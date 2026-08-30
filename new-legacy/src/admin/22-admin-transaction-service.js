'use strict';
(function(global){
  const Core=global.KGAdminCore;
  class AdminTransactionService{
    constructor(repository,audit,permissions,options={}){this.repository=repository;this.audit=audit;this.permissions=permissions;this.snapshotLimit=Math.max(5,Number(options.snapshotLimit)||30)}
    snapshots(){const rows=this.repository.read('snapshots',[]);return Array.isArray(rows)?Core.clone(rows):[]}
    createSnapshot({name='手动快照',keys=this.repository.keys(),metadata={}}={}){const row={id:Core.safeId('snapshot'),name:Core.clean(name)||'手动快照',createdAt:Core.nowIso(),createdBy:Core.actor(),keys:[...keys],metadata:Core.clone(metadata),payload:this.repository.snapshot(keys)};const rows=this.snapshots();rows.unshift(row);this.repository.write('snapshots',rows.slice(0,this.snapshotLimit));return Core.clone({...row,payload:undefined})}
    restoreSnapshot(snapshotId){const permission=this.permissions?.require?.('manageSnapshots')||{valid:true};if(!permission.valid)return permission;const row=this.snapshots().find(item=>item.id===snapshotId);if(!row)return {valid:false,errors:['没有找到快照。']};const restored=this.repository.restore(row.payload);this.audit?.record({action:'snapshot.restore',entityType:'snapshot',entityId:row.id,status:restored.valid?'success':'failed',summary:`恢复快照：${row.name}`,metadata:{errors:restored.errors||[]}});return {...restored,snapshot:Core.clone({...row,payload:undefined})}}
    execute(spec={}){
      const permission=spec.permission?(this.permissions?.require?.(spec.permission)||{valid:true}):{valid:true};if(!permission.valid)return permission;
      const transactionId=Core.safeId('tx');const keys=Array.isArray(spec.keys)&&spec.keys.length?spec.keys:this.repository.keys();const payload=this.repository.snapshot(keys);const snapshot={id:Core.safeId('snapshot'),name:Core.clean(spec.name)||Core.clean(spec.action)||'写入事务',createdAt:Core.nowIso(),createdBy:Core.actor(),keys:[...keys],metadata:{transactionId,automatic:true,...Core.clone(spec.metadata||{})},payload};
      const snapshots=this.snapshots();snapshots.unshift(snapshot);this.repository.write('snapshots',snapshots.slice(0,this.snapshotLimit));
      try{
        const preflight=typeof spec.validate==='function'?spec.validate():{valid:true};if(preflight?.valid===false)throw Object.assign(new Error((preflight.errors||['校验失败。']).join('；')),{preflight});
        const value=typeof spec.commit==='function'?spec.commit():undefined;if(value?.valid===false)throw Object.assign(new Error((value.errors||['提交失败。']).join('；')),{commitResult:value});
        this.audit?.record({action:Core.clean(spec.action)||'transaction.commit',entityType:Core.clean(spec.entityType)||'system',entityId:Core.clean(spec.entityId),status:'success',summary:Core.clean(spec.summary)||Core.clean(spec.name),transactionId,metadata:{snapshotId:snapshot.id,...Core.clone(spec.metadata||{})}});
        return {valid:true,transactionId,snapshotId:snapshot.id,value,warnings:preflight?.warnings||[]};
      }catch(error){
        const rollback=this.repository.restore(payload);this.audit?.record({action:Core.clean(spec.action)||'transaction.rollback',entityType:Core.clean(spec.entityType)||'system',entityId:Core.clean(spec.entityId),status:'failed',summary:Core.clean(spec.summary)||Core.clean(spec.name)||error.message,transactionId,metadata:{snapshotId:snapshot.id,error:error.message,rollbackValid:rollback.valid,...Core.clone(spec.metadata||{})}});
        return {valid:false,transactionId,snapshotId:snapshot.id,errors:error.preflight?.errors||error.commitResult?.errors||[error.message||'事务失败。'],rollback};
      }
    }
    async executeAsync(spec={}){
      const permission=spec.permission?(this.permissions?.require?.(spec.permission)||{valid:true}):{valid:true};if(!permission.valid)return permission;
      const transactionId=Core.safeId('tx'),teaching=new Set(['subjects','taxonomies','activityOverrides','tags','collections']);
      const keys=(Array.isArray(spec.keys)&&spec.keys.length?spec.keys:this.repository.keys()).filter(key=>!teaching.has(key));
      const payload=this.repository.snapshot(keys),snapshot={id:Core.safeId('snapshot'),name:Core.clean(spec.name)||Core.clean(spec.action)||'写入事务',createdAt:Core.nowIso(),createdBy:Core.actor(),keys:[...keys],metadata:{transactionId,automatic:true,...Core.clone(spec.metadata||{})},payload};
      const snapshots=this.snapshots();snapshots.unshift(snapshot);this.repository.write('snapshots',snapshots.slice(0,this.snapshotLimit));
      try{
        const preflight=typeof spec.validate==='function'?await spec.validate():{valid:true};if(preflight?.valid===false)throw Object.assign(new Error((preflight.errors||['校验失败。']).join('；')),{preflight});
        const value=typeof spec.commit==='function'?await spec.commit():undefined;if(value?.valid===false)throw Object.assign(new Error((value.errors||['提交失败。']).join('；')),{commitResult:value});
        this.audit?.record({action:Core.clean(spec.action)||'transaction.commit',entityType:Core.clean(spec.entityType)||'system',entityId:Core.clean(spec.entityId),status:'success',summary:Core.clean(spec.summary)||Core.clean(spec.name),transactionId,metadata:{snapshotId:snapshot.id,...Core.clone(spec.metadata||{})}});
        return {valid:true,transactionId,snapshotId:snapshot.id,value,warnings:preflight?.warnings||[]};
      }catch(error){
        const rollback=this.repository.restore(payload);this.audit?.record({action:Core.clean(spec.action)||'transaction.rollback',entityType:Core.clean(spec.entityType)||'system',entityId:Core.clean(spec.entityId),status:'failed',summary:Core.clean(spec.summary)||Core.clean(spec.name)||error.message,transactionId,metadata:{snapshotId:snapshot.id,error:error.message,rollbackValid:rollback.valid,...Core.clone(spec.metadata||{})}});
        return {valid:false,transactionId,snapshotId:snapshot.id,errors:error.preflight?.errors||error.commitResult?.errors||[error.message||'事务失败。'],rollback};
      }
    }
  }
  global.KGAdminTransactionService=AdminTransactionService;
})(window);
