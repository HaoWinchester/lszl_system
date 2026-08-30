'use strict';
(function(global){
  class ReleaseService{
    constructor(options={}){this.api=options.api||global.KGCourseManagementApi;this.organization=options.organization}
    summary(){const snapshot=this.api?.snapshot?.()||{releases:[],tasks:[]},papers=this.organization?.getPapers?.()||[],active=snapshot.releases.find(item=>item.status==='published');return {courseReleases:snapshot.releases.length,publishedPapers:papers.filter(item=>item.status==='published').length,publishedTasks:snapshot.tasks.filter(item=>item.status==='published').length,activeCourse:active?.courseId||active?.course?.id||''}}
    courseReleases(courseId=''){const rows=this.api?.listReleases?.()||[];return courseId?rows.filter(item=>item.courseId===courseId||item.course?.id===courseId):rows}
  }
  global.KGReleaseService=ReleaseService;
})(window);
