'use strict';
(function(global){
  const Core=global.KGAdminCore;
  class AdminAuditService{
    constructor(repository,options={}){this.repository=repository;this.limit=Math.max(50,Number(options.limit)||500)}
    list(filters={}){let rows=this.repository.read('audit',[]);if(!Array.isArray(rows))rows=[];if(filters.action)rows=rows.filter(item=>item.action===filters.action);if(filters.entityType)rows=rows.filter(item=>item.entityType===filters.entityType);if(filters.status)rows=rows.filter(item=>item.status===filters.status);return Core.clone(rows.sort((a,b)=>String(b.at).localeCompare(String(a.at))))}
    record(entry={}){const actor=entry.actor||Core.actor();const record={id:Core.clean(entry.id)||Core.safeId('audit'),schemaVersion:1,at:Core.clean(entry.at)||Core.nowIso(),actor:Core.clone(actor),action:Core.clean(entry.action)||'unknown',entityType:Core.clean(entry.entityType)||'system',entityId:Core.clean(entry.entityId),status:Core.clean(entry.status)||'success',summary:Core.clean(entry.summary),transactionId:Core.clean(entry.transactionId),metadata:Core.clone(entry.metadata||{})};const rows=this.list();rows.unshift(record);this.repository.write('audit',rows.slice(0,this.limit));return Core.clone(record)}
    clear(){return this.repository.write('audit',[])}
    summary(){const rows=this.list();return {total:rows.length,success:rows.filter(item=>item.status==='success').length,failed:rows.filter(item=>item.status==='failed').length,lastAt:rows[0]?.at||''}}
  }
  global.KGAdminAuditService=AdminAuditService;
})(window);
