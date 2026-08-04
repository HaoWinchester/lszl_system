'use strict';
(function(global){
  const Core=global.KGAdminCore;
  const LABELS=Object.freeze({
    viewAdminConsole:'进入管理端',editSubjects:'维护科目',editTaxonomies:'维护知识树',publishTaxonomies:'发布知识树',deleteTaxonomies:'归档与删除知识树',importTaxonomies:'导入知识树版本',editActivities:'维护活动',editCourses:'维护课程',publishCourses:'发布课程',manageAssessments:'维护学习任务与试卷',viewReferences:'查看引用索引',viewAudit:'查看审计记录',manageSnapshots:'创建与恢复快照'
  });
  const ROLE_PERMISSIONS=Object.freeze({
    admin:Object.freeze(Object.keys(LABELS)),
    teacher:Object.freeze(['viewAdminConsole','editTaxonomies','importTaxonomies','editActivities','editCourses','publishCourses','manageAssessments','viewReferences']),
    student:Object.freeze([]),viewer:Object.freeze([]),guest:Object.freeze([])
  });
  class AdminPermissionService{
    constructor(options={}){this.auth=options.auth||global.KGAuthCore||null}
    currentUser(){return this.auth?.currentUser?.({includeInactive:true})||null}
    currentRole(){return Core.clean(this.currentUser()?.role)||'guest'}
    permissionsFor(role=this.currentRole()){return new Set(ROLE_PERMISSIONS[role]||ROLE_PERMISSIONS.guest)}
    can(permission,role=this.currentRole()){return this.permissionsFor(role).has(permission)}
    require(permission){return this.can(permission)?{valid:true,permission}:{valid:false,permission,errors:[`当前角色没有“${LABELS[permission]||permission}”权限。`]}}
    summary(role=this.currentRole()){const allowed=this.permissionsFor(role);return {role,allowed:[...allowed],denied:Object.keys(LABELS).filter(item=>!allowed.has(item)),labels:LABELS}}
  }
  global.KGAdminPermissionService=AdminPermissionService;
  global.KG_ADMIN_PERMISSION_LABELS=LABELS;
})(window);
