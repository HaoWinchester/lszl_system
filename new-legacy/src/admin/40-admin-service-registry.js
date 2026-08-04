'use strict';
(function(global){
  const legacy=global.KGLearningContent;
  if(!legacy)throw new Error('V9.0-P3.3 需要先加载 91-learning-content-core.js');
  const repository=new global.KGLocalContentRepository({keys:{...(legacy.storageKeys||{}),...(global.KGContentOrganization?.storageKeys||{})}});
  const permissions=new global.KGAdminPermissionService({auth:global.KGAuthCore});
  const audit=new global.KGAdminAuditService(repository);
  const transactions=new global.KGAdminTransactionService(repository,audit,permissions);
  const references=new global.KGReferenceIndexService({content:legacy,organization:global.KGContentOrganization});
  const subjects=new global.KGSubjectService({legacy,transactions,permissions,references});
  const taxonomies=new global.KGTaxonomyService({legacy,repository,transactions,permissions,audit,references});
  const activities=new global.KGActivityService({legacy,transactions,references});
  const courses=new global.KGCourseService({legacy,transactions,references});
  const releases=new global.KGReleaseService({content:legacy,organization:global.KGContentOrganization});
  global.KGAdminServices=Object.freeze({version:global.KGAdminCore.VERSION,repository,permissions,audit,transactions,references,subjects,taxonomies,activities,courses,releases,legacyContent:legacy});
})(window);
