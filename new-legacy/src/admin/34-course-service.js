'use strict';
(function(global){
  class CourseService{
    constructor(options={}){this.legacy=options.legacy;this.transactions=options.transactions;this.references=options.references}
    drafts(){return this.legacy.getCourseDrafts()}
    releases(){return this.legacy.getCourseReleases()}
    validate(course){return this.legacy.validateCourse(course)}
    normalize(course,index=0){return this.legacy.normalizeCourse(course,index)}
    saveDraft(course){const tx=this.transactions.execute({name:'保存课程草稿',action:'course.draft.save',entityType:'course',entityId:course?.id,permission:'editCourses',keys:['courseDrafts'],validate:()=>this.validate(course),commit:()=>({valid:true,course:this.legacy.saveCourseDraft(course)})});if(tx.valid)this.references?.invalidate();return tx.valid?{valid:true,course:tx.value.course,transactionId:tx.transactionId,errors:[],warnings:tx.warnings||[]}:{valid:false,errors:tx.errors||[]}}
    deleteDraft(courseId){const tx=this.transactions.execute({name:'删除课程草稿',action:'course.draft.delete',entityType:'course',entityId:courseId,permission:'editCourses',keys:['courseDrafts'],commit:()=>({valid:true,courses:this.legacy.deleteCourseDraft(courseId)})});if(tx.valid)this.references?.invalidate();return tx.valid?{valid:true,courses:tx.value.courses,transactionId:tx.transactionId,errors:[]}:{valid:false,errors:tx.errors||[]}}
    publish(courseId,notes=''){const tx=this.transactions.execute({name:'发布课程',action:'course.publish',entityType:'course',entityId:courseId,permission:'publishCourses',keys:['courseDrafts','courseReleases','activeCourse'],commit:()=>this.legacy.publishCourse(courseId,notes)});if(tx.valid)this.references?.invalidate();return tx.valid?{...tx.value,transactionId:tx.transactionId}:{valid:false,errors:tx.errors||[]}}
    activeRelease(){return this.legacy.activeCourseRelease()}
    coverage(course){return this.legacy.courseKnowledgeCoverage(course)}
  }
  global.KGCourseService=CourseService;
})(window);
