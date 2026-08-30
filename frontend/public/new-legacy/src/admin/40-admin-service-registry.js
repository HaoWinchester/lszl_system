'use strict';
(function(global){
  const legacy=global.KGLearningContent;
  if(!legacy)throw new Error('V9.0-P3.3 需要先加载 91-learning-content-core.js');
  const publicService=(instance,omitted=[])=>{
    const blocked=new Set(omitted),facade={};let prototype=Object.getPrototypeOf(instance);
    while(prototype&&prototype!==Object.prototype){for(const name of Object.getOwnPropertyNames(prototype)){if(name==='constructor'||blocked.has(name)||Object.prototype.hasOwnProperty.call(facade,name))continue;const value=instance[name];if(typeof value==='function')facade[name]=value.bind(instance)}prototype=Object.getPrototypeOf(prototype)}
    return Object.freeze(facade);
  };
  const repository=new global.KGLocalContentRepository({keys:{...(legacy.storageKeys||{}),...(global.KGContentOrganization?.storageKeys||{})}});
  const permissions=new global.KGAdminPermissionService({auth:global.KGAuthCore});
  const audit=new global.KGAdminAuditService(repository);
  const transactions=new global.KGAdminTransactionService(repository,audit,permissions);
  const referenceService=new global.KGReferenceIndexService({content:legacy,organization:global.KGContentOrganization,referenceSnapshotPending:true,requiresServerTransactionalDelete:true});
  const referenceSnapshotReady=global.KGReferenceIndexService.loadReferenceSnapshot()
    .then(snapshot=>{referenceService.updateReferenceSnapshot(snapshot);return snapshot})
    .catch(error=>{global.console?.warn?.('内容引用索引加载失败',error);return null});
  const subjectService=new global.KGSubjectService({legacy,transactions,permissions,references:referenceService});
  const taxonomyService=new global.KGTaxonomyService({legacy,repository,transactions,permissions,audit,references:referenceService});
  const activityService=new global.KGActivityService({legacy,transactions,references:referenceService});
  const courseService=new global.KGCourseService({legacy,api:global.KGCourseManagementApi,permissions,references:referenceService});
  const releaseService=new global.KGReleaseService({api:global.KGCourseManagementApi,organization:global.KGContentOrganization});
  const publicPermissions=publicService(permissions),publicAudit=publicService(audit,['clear']),publicTransactions=publicService(transactions,['execute','restoreSnapshot']);
  const references=publicService(referenceService),subjects=publicService(subjectService),taxonomies=publicService(taxonomyService,['reconcileAuthenticatedServerProjection']),activities=publicService(activityService),courses=publicService(courseService),releases=publicService(releaseService);
  const legacyContent=Object.freeze({
    currentUser:(...args)=>legacy.currentUser(...args),
    getSubjects:(...args)=>legacy.getSubjects(...args),
    getTaxonomies:(...args)=>legacy.getTaxonomies(...args),
    pathLabel:(...args)=>legacy.pathLabel(...args),
    searchNodes:(...args)=>legacy.searchNodes(...args),
    getActivities:(...args)=>legacy.getActivities?.(...args)||[],
    getActivityLibrary:(...args)=>legacy.getActivityLibrary?.(...args)||{},
    getCourseDrafts:(...args)=>legacy.getCourseDrafts?.(...args)||[],
    getCourseReleases:(...args)=>legacy.getCourseReleases?.(...args)||[],
    normalizeCourse:(...args)=>legacy.normalizeCourse(...args),
  });
  const domainReady=Promise.all([global.KGTeachingContentApi?.bootstrap?.(),global.KGCourseManagementApi?.ready?.()]).then(value=>({valid:true,value}),error=>({valid:false,error}));
  const services=Object.freeze({version:global.KGAdminCore.VERSION,repositoryMode:repository.mode,domainReady,permissions:publicPermissions,audit:publicAudit,transactions:publicTransactions,references,referenceSnapshotReady,subjects,taxonomies,activities,courses,releases,legacyContent});
  global.KGAdminServices=services;
  if(typeof global.KGCreateAdminTeachingContentGateway==='function'){
    global.KGCreateAdminTeachingContentGateway({services,reconcileServerProjection:(subjectId,taxonomy)=>taxonomyService.reconcileAuthenticatedServerProjection(subjectId,taxonomy)});
    try{delete global.KGCreateAdminTeachingContentGateway}catch(error){}
  }
})(window);
