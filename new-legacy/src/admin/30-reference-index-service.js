'use strict';
(function(global){
  const Core=global.KGAdminCore;
  async function loadReferenceSnapshot(){
    const api=global.KGDomainApi;if(!api?.request)throw new Error('内容引用 API 未加载，请刷新后重试。');
    const snapshot=await api.request({path:'/api/v1/questions/reference-snapshot'});
    return {
      banks:Array.isArray(snapshot?.banks)?snapshot.banks:[],
      papers:Array.isArray(snapshot?.papers)?snapshot.papers:[],
      releases:Array.isArray(snapshot?.releases)?snapshot.releases:[],
    };
  }
  class ReferenceIndexService{
    constructor(options={}){this.content=options.content;this.organization=options.organization||global.KGContentOrganization||null;this.referenceSnapshot=options.referenceSnapshot||{banks:[],papers:[],releases:[]};this.referenceSnapshotReady=options.referenceSnapshotPending!==true;this.requiresServerTransactionalDelete=options.requiresServerTransactionalDelete===true;this.cache=null;this.builtAt=''}
    questionBanks(){return Array.isArray(this.referenceSnapshot?.banks)?this.referenceSnapshot.banks:[]}
    updateReferenceSnapshot(snapshot={}){this.referenceSnapshot={banks:[],papers:[],releases:[],...snapshot};this.referenceSnapshotReady=true;this.invalidate();return this.referenceSnapshot}
    permanentDeleteCheck(){if(!this.referenceSnapshotReady)return {valid:false,errors:['内容引用索引尚未加载完成，永久删除已暂停。']};if(this.requiresServerTransactionalDelete)return {valid:false,errors:['科目与知识树仍由本地管理事务保存，无法和服务器正式题目、试卷引用校验合并为同一事务；永久删除已暂停，请改用停用或归档。']};return {valid:true,errors:[]}}
    build(){
      if(!this.referenceSnapshotReady)throw new Error('内容引用索引尚未加载完成，请稍后重试。');
      const content=this.content,organization=this.organization;
      const subjects=content?.getSubjects?.()||[],taxonomies=content?.getTaxonomies?.()||[],activities=Object.values(content?.getActivityLibrary?.()||{}),questionBanks=this.questionBanks(),drafts=content?.getCourseDrafts?.()||[],releases=content?.getCourseReleases?.()||[],papers=[...(organization?.getPapers?.()||[]),...(this.referenceSnapshot?.papers||[]),...(this.referenceSnapshot?.releases||[])],tasks=organization?.getLearningTasks?.()||[],collections=organization?.getCollections?.()||[];
      const nodeRefs={},activityRefs={},taxonomyRefs={},subjectRefs={};
      const ensure=(map,id)=>map[id]||(map[id]=[]);
      const pushUnique=(map,id,row)=>{if(!id)return;const rows=ensure(map,id),key=[row.kind,row.id,row.detail||'',row.source||'',row.version||''].join('|');if(!rows.some(item=>[item.kind,item.id,item.detail||'',item.source||'',item.version||''].join('|')===key))rows.push(row)};
      subjects.forEach(subject=>ensure(subjectRefs,subject.id));
      taxonomies.forEach(taxonomy=>{ensure(taxonomyRefs,taxonomy.id);pushUnique(subjectRefs,taxonomy.subjectId,{kind:'taxonomy',id:taxonomy.id,title:taxonomy.name?.zh||taxonomy.id,detail:taxonomy.status,source:'taxonomy'});(taxonomy.nodes||[]).forEach(node=>ensure(nodeRefs,node.id))});
      activities.forEach(activity=>{
        const knowledge=activity.metadata?.knowledge||{},title=content?.activityTitle?.(activity)||activity.id,subjectId=activity.metadata?.subjectId;
        pushUnique(subjectRefs,subjectId,{kind:'activity',id:activity.id,title,detail:activity.type||'activity',source:'activity'});
        if(knowledge.taxonomyId)pushUnique(taxonomyRefs,knowledge.taxonomyId,{kind:'activity',id:activity.id,title,detail:'知识归属',source:'activity'});
        if(knowledge.primaryNodeId)pushUnique(nodeRefs,knowledge.primaryNodeId,{kind:'activity',id:activity.id,title,detail:'主知识点',source:'activity'});
        (knowledge.relatedNodeIds||[]).forEach(nodeId=>pushUnique(nodeRefs,nodeId,{kind:'activity',id:activity.id,title,detail:'相关知识点',source:'activity'}));
        ensure(activityRefs,activity.id);
      });
      questionBanks.forEach(bank=>{
        const subject=content?.subjectById?.(bank.subject),subjectId=subject?.id||'';
        if(subjectId)pushUnique(subjectRefs,subjectId,{kind:'question_bank',id:String(bank.id||bank.name||bank._storageKey),title:bank.name||bank.id||'题库',detail:`${(bank.questions||[]).length} 道题`,source:'question-bank'});
        (bank.questions||[]).forEach(question=>{
          const knowledge=question.metadata?.knowledge||{},id=`${bank.id||'bank'}:${question.id||'question'}`,title=question.title||question.teacherNumber||question.id||'题目';
          if(subjectId)pushUnique(subjectRefs,subjectId,{kind:'question',id,title,detail:question.teacherNumber||'正式题目',source:'question-bank'});
          if(knowledge.taxonomyId)pushUnique(taxonomyRefs,knowledge.taxonomyId,{kind:'question',id,title,detail:'正式题目知识归属',source:'question-bank'});
          if(knowledge.primaryNodeId)pushUnique(nodeRefs,knowledge.primaryNodeId,{kind:'question',id,title,detail:'主要知识点',source:'question-bank',bankId:bank.id,questionId:question.id});
        });
      });
      const indexCourse=(course,source,version='')=>{
        if(course?.subjectId)pushUnique(subjectRefs,course.subjectId,{kind:source==='release'?'course_release':'course_draft',id:course.id,title:course.name||course.id,detail:source==='release'?'课程发布':'课程草稿',source,version});
        if(course?.taxonomyId)pushUnique(taxonomyRefs,course.taxonomyId,{kind:'course',id:course.id,title:course.name||course.id,detail:source==='release'?'课程发布':'课程草稿',source,version});
        (course?.nodes||[]).forEach(node=>(node.activityIds||[]).forEach(activityId=>pushUnique(activityRefs,activityId,{kind:'course',id:course.id,title:course.name,detail:node.title,source,version})));
      };
      drafts.forEach(course=>indexCourse(course,'draft'));
      releases.forEach(release=>indexCourse(release.course||{},'release',release.version));
      papers.forEach(paper=>{const subjectId=content?.subjectById?.(paper.subjectId)?.id||'';pushUnique(subjectRefs,subjectId,{kind:'paper',id:paper.id,title:paper.title,detail:paper.status,source:'assessment'});(paper.sections||[]).forEach(section=>(section.items||[]).forEach(item=>pushUnique(activityRefs,item.activityId,{kind:'paper',id:paper.id,title:paper.title,detail:section.title,source:paper.status}))) });
      tasks.forEach(task=>{pushUnique(subjectRefs,task.subjectId,{kind:'learning_task',id:task.id,title:task.title,detail:task.type,source:task.status});(task.sourceActivityIds||[]).forEach(activityId=>pushUnique(activityRefs,activityId,{kind:'learning_task',id:task.id,title:task.title,detail:task.type,source:task.status}))});
      collections.forEach(collection=>(collection.activityIds||[]).forEach(activityId=>pushUnique(activityRefs,activityId,{kind:collection.type==='favorites'?'favorite':'collection',id:collection.id,title:collection.title,detail:collection.type,source:'organization'})));
      Object.entries(nodeRefs).forEach(([nodeId,refs])=>refs.filter(ref=>ref.kind==='activity').forEach(ref=>(activityRefs[ref.id]||[]).forEach(downstream=>pushUnique(nodeRefs,nodeId,{...downstream,viaActivityId:ref.id}))));
      this.builtAt=Core.nowIso();
      this.cache={builtAt:this.builtAt,subjects,taxonomies,activities,questionBanks,drafts,releases,papers,tasks,collections,nodeRefs,activityRefs,taxonomyRefs,subjectRefs};
      return this.summary();
    }
    ensure(){if(!this.cache)this.build();return this.cache}
    invalidate(){this.cache=null;this.builtAt=''}
    referencesForNode(nodeId){return Core.clone(this.ensure().nodeRefs[String(nodeId||'')]||[])}
    referencesForActivity(activityId){return Core.clone(this.ensure().activityRefs[String(activityId||'')]||[])}
    referencesForTaxonomy(taxonomyId){return Core.clone(this.ensure().taxonomyRefs[String(taxonomyId||'')]||[])}
    referencesForSubject(subjectId){return Core.clone(this.ensure().subjectRefs[String(subjectId||'')]||[])}
    subjectUsage(subjectId){const references=this.referencesForSubject(subjectId),counts={};references.forEach(item=>{counts[item.kind]=(counts[item.kind]||0)+1});return {total:references.length,counts,references}}
    summary(){const data=this.ensure();return {builtAt:data.builtAt,subjects:data.subjects.length,taxonomies:data.taxonomies.length,nodes:data.taxonomies.reduce((sum,item)=>sum+(item.nodes||[]).length,0),activities:data.activities.length,questionBanks:data.questionBanks.length,formalQuestions:data.questionBanks.reduce((sum,item)=>sum+(item.questions||[]).length,0),courseDrafts:data.drafts.length,courseReleases:data.releases.length,papers:data.papers.length,tasks:data.tasks.length,collections:data.collections.length,subjectReferenceCount:Object.values(data.subjectRefs).reduce((sum,rows)=>sum+rows.length,0),nodeReferenceCount:Object.values(data.nodeRefs).reduce((sum,rows)=>sum+rows.length,0),activityReferenceCount:Object.values(data.activityRefs).reduce((sum,rows)=>sum+rows.length,0),taxonomyReferenceCount:Object.values(data.taxonomyRefs).reduce((sum,rows)=>sum+rows.length,0)}}
  }
  ReferenceIndexService.loadReferenceSnapshot=loadReferenceSnapshot;
  global.KGReferenceIndexService=ReferenceIndexService;
})(window);
