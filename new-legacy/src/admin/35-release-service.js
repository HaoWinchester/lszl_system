'use strict';
(function(global){
  class ReleaseService{
    constructor(options={}){this.content=options.content;this.organization=options.organization}
    summary(){const releases=this.content?.getCourseReleases?.()||[];const papers=this.organization?.getPapers?.()||[];const tasks=this.organization?.getLearningTasks?.()||[];return {courseReleases:releases.length,publishedPapers:papers.filter(item=>item.status==='published').length,publishedTasks:tasks.filter(item=>item.status==='published').length,activeCourse:this.content?.activeCourseRelease?.()?.course?.id||''}}
    courseReleases(courseId=''){const rows=this.content?.getCourseReleases?.()||[];return courseId?rows.filter(item=>item.course?.id===courseId):rows}
  }
  global.KGReleaseService=ReleaseService;
})(window);
