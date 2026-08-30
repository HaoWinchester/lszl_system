'use strict';
(function(global){
  class CourseService{
    constructor(options={}){this.legacy=options.legacy;this.api=options.api||global.KGCourseManagementApi;this.permissions=options.permissions;this.references=options.references}
    drafts(){return this.api?.listDrafts?.()||[]}
    releases(){return this.api?.listReleases?.()||[]}
    validate(course){return this.legacy.validateCourse(course)}
    normalize(course,index=0){return this.legacy.normalizeCourse(course,index)}
    async saveDraft(course){const permission=this.permissions?.require?.('editCourses')||{valid:true};if(!permission.valid)return permission;const validation=this.validate(course);if(!validation.valid)return validation;const saved=await this.api.saveDraft(validation.course);this.references?.invalidate();return {valid:true,course:saved,errors:[],warnings:validation.warnings||[]}}
    async deleteDraft(courseId){const permission=this.permissions?.require?.('editCourses')||{valid:true};if(!permission.valid)return permission;const current=this.drafts().find(item=>item.id===courseId);if(!current)return {valid:false,errors:['课程草稿不存在。']};await this.api.deleteDraft(courseId,current.revision);this.references?.invalidate();return {valid:true,courses:this.drafts(),errors:[]}}
    async publish(courseId,notes=''){const permission=this.permissions?.require?.('publishCourses')||{valid:true};if(!permission.valid)return permission;const current=this.drafts().find(item=>item.id===courseId);if(!current)return {valid:false,errors:['课程草稿不存在。']};const validation=this.validate(current);if(!validation.valid)return validation;const saved=await this.api.publishDraft(courseId,notes,current.revision);this.references?.invalidate();return {valid:true,...saved,errors:[],warnings:validation.warnings||[]}}
    activeRelease(){return this.releases().filter(item=>item.status==='published').sort((a,b)=>String(b.publishedAt||'').localeCompare(String(a.publishedAt||'')))[0]||null}
    coverage(course){return this.legacy.courseKnowledgeCoverage(course)}
  }
  global.KGCourseService=CourseService;
})(window);
