'use strict';

(function(global){
  const Core=global.KGLearningContent;
  if(!Core)return;

  const TAG_RESOURCE='tags';
  const COLLECTION_RESOURCE='collections';
  const PAPER_RESOURCE='papers';
  const TASK_RESOURCE='tasks';
  const SCHEMA_VERSION=1;
  const ModePolicy=global.KGPaperLearningModes;
  const TASK_TYPES=Object.freeze((ModePolicy?.listActive?.()||[
    {id:'practice_mode'},{id:'deep_recall'},{id:'multi_question_canvas'}
  ]).map(mode=>mode.id));
  const RETIRED_TASK_ERROR='单题深学已停用，请选择刷题、深度回忆或归纳';
  const RETIRED_TASK_TYPES=Object.freeze(['single_deep_study','single_deep','single-deep']);
  const RETIRED_TASK=Object.freeze({id:'single_deep_study',label:'单题深学（已停用）',retired:true,fallbackId:'practice_mode'});
  const PAPER_STATUSES=['draft','published','archived'];
  const ACTIVITY_DIFFICULTIES=['unset','easy','medium','hard'];
  const ACTIVITY_PURPOSES=['practice','exam','learning_task'];

  const clone=value=>Core.clone(value);
  const clean=value=>String(value??'').trim();
  const resolveHistoricalTaskType=value=>ModePolicy?.resolveHistorical?.(clean(value))||(RETIRED_TASK_TYPES.includes(clean(value))?RETIRED_TASK:null);
  const unique=values=>[...new Set((values||[]).map(value=>clean(value)).filter(Boolean))];
  const nowIso=()=>new Date().toISOString();
  const safeId=prefix=>Core.safeId(prefix);
  const read=(key,fallback)=>{if(key===TAG_RESOURCE||key===COLLECTION_RESOURCE||key===PAPER_RESOURCE)return clone(global.KGTeachingContentApi?.readResource?.(key,fallback)??fallback);if(key===TASK_RESOURCE)return clone(global.KGCourseManagementApi?.listTasks?.()||fallback);return clone(fallback)};

  function authorRecord(source={}){
    const user=Core.currentUser();
    return {
      createdByUserId:clean(source.createdByUserId)||user.id,
      createdByName:clean(source.createdByName)||user.name,
      createdAt:clean(source.createdAt)||nowIso(),
      updatedByUserId:clean(source.updatedByUserId)||user.id,
      updatedByName:clean(source.updatedByName)||user.name,
      updatedAt:clean(source.updatedAt)||nowIso()
    };
  }
  function touch(record){
    const next=clone(record)||{};const user=Core.currentUser();
    next.authorship=authorRecord(next.authorship);
    next.authorship.updatedByUserId=user.id;next.authorship.updatedByName=user.name;next.authorship.updatedAt=nowIso();
    return next;
  }
  function normalizeTag(tag,index=0){
    const source=tag&&typeof tag==='object'?tag:{};
    return {id:clean(source.id)||safeId('tag'),schemaVersion:SCHEMA_VERSION,name:clean(source.name)||`标签 ${index+1}`,subjectId:clean(source.subjectId),description:clean(source.description),color:clean(source.color)||'',status:['active','archived'].includes(source.status)?source.status:'active',sortOrder:Number(source.sortOrder)||index+1,authorship:authorRecord(source.authorship)};
  }
  function getTags(filters={}){
    let list=(read(TAG_RESOURCE,[])||[]).map(normalizeTag);
    if(filters.subjectId)list=list.filter(item=>!item.subjectId||item.subjectId===filters.subjectId);
    if(filters.status)list=list.filter(item=>item.status===filters.status);
    return clone(list.sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name,'zh-CN')));
  }
  async function saveTag(tag){
    const list=getTags();let record=normalizeTag(tag,list.length);record=touch(record);
    const index=list.findIndex(item=>item.id===record.id);if(index>=0)list[index]=record;else list.push(record);await global.KGTeachingContentApi.saveActivityTags(list);return {valid:true,tag:clone(record)};
  }
  async function deleteTag(tagId){
    const id=clean(tagId);const used=Core.getActivities().filter(activity=>activityOrganization(activity).tagIds.includes(id)).map(activity=>activity.id);
    if(used.length)return {valid:false,errors:[`该标签仍被 ${used.length} 个活动使用。请先移除标签，或将标签归档。`],activityIds:used};
    await global.KGTeachingContentApi.saveActivityTags(getTags().filter(item=>item.id!==id));return {valid:true,deletedId:id};
  }

  function normalizeCollection(collection,index=0){
    const source=collection&&typeof collection==='object'?collection:{};
    return {id:clean(source.id)||safeId('collection'),schemaVersion:SCHEMA_VERSION,title:clean(source.title)||`题集 ${index+1}`,subjectId:clean(source.subjectId)||'subject-pmp',description:clean(source.description),type:['collection','favorites'].includes(source.type)?source.type:'collection',visibility:['private','shared'].includes(source.visibility)?source.visibility:'private',status:['active','archived'].includes(source.status)?source.status:'active',activityIds:unique(source.activityIds),sortOrder:Number(source.sortOrder)||index+1,authorship:authorRecord(source.authorship)};
  }
  function ensureFavoritesCollection(){
    const user=Core.currentUser();const list=(read(COLLECTION_RESOURCE,[])||[]).map(normalizeCollection);let item=list.find(collection=>collection.type==='favorites'&&collection.authorship.createdByUserId===user.id);
    if(!item)item=normalizeCollection({id:`favorites-${user.id}`,title:'我的收藏',subjectId:'subject-pmp',type:'favorites',visibility:'private',authorship:{createdByUserId:user.id,createdByName:user.name}},list.length);
    return clone(item);
  }
  function getCollections(filters={}){
    const favorite=ensureFavoritesCollection();let list=(read(COLLECTION_RESOURCE,[])||[]).map(normalizeCollection);if(!list.some(item=>item.id===favorite.id))list.push(favorite);
    if(filters.subjectId)list=list.filter(item=>!item.subjectId||item.subjectId===filters.subjectId);
    if(filters.type)list=list.filter(item=>item.type===filters.type);
    if(filters.status)list=list.filter(item=>item.status===filters.status);
    if(filters.ownerId)list=list.filter(item=>item.authorship.createdByUserId===filters.ownerId);
    return clone(list.sort((a,b)=>a.sortOrder-b.sortOrder||a.title.localeCompare(b.title,'zh-CN')));
  }
  async function saveCollection(collection){
    const list=getCollections();let record=normalizeCollection(collection,list.length);record=touch(record);
    const library=Core.getActivityLibrary();record.activityIds=record.activityIds.filter(id=>library[id]);
    const index=list.findIndex(item=>item.id===record.id);if(index>=0)list[index]=record;else list.push(record);await global.KGTeachingContentApi.saveActivityCollections(list);return {valid:true,collection:clone(record)};
  }
  async function deleteCollection(collectionId){
    const item=getCollections().find(collection=>collection.id===clean(collectionId));if(!item)return {valid:false,errors:['题集不存在。']};
    if(item.type==='favorites')return {valid:false,errors:['系统收藏夹不能删除。']};
    await global.KGTeachingContentApi.saveActivityCollections(getCollections().filter(collection=>collection.id!==item.id));return {valid:true,deletedId:item.id};
  }
  async function addActivitiesToCollection(collectionId,activityIds){
    const item=getCollections().find(collection=>collection.id===clean(collectionId));if(!item)return {valid:false,errors:['题集不存在。']};
    item.activityIds=unique([...(item.activityIds||[]),...activityIds]);return await saveCollection(item);
  }
  async function removeActivitiesFromCollection(collectionId,activityIds){
    const remove=new Set(activityIds||[]);const item=getCollections().find(collection=>collection.id===clean(collectionId));if(!item)return {valid:false,errors:['题集不存在。']};
    item.activityIds=item.activityIds.filter(id=>!remove.has(id));return await saveCollection(item);
  }
  async function toggleFavorite(activityId){
    const item=ensureFavoritesCollection();const exists=item.activityIds.includes(activityId);item.activityIds=exists?item.activityIds.filter(id=>id!==activityId):[...item.activityIds,activityId];await saveCollection(item);return {valid:true,favorite:!exists,collection:item};
  }
  function favoriteActivityIds(){return new Set(ensureFavoritesCollection().activityIds)}

  function activityOrganization(activity){
    const source=activity?.metadata?.organization&&typeof activity.metadata.organization==='object'?activity.metadata.organization:{};
    return {difficulty:ACTIVITY_DIFFICULTIES.includes(source.difficulty)?source.difficulty:'unset',estimatedTimeSeconds:Math.max(0,Number(source.estimatedTimeSeconds)||0),usagePurposes:unique(source.usagePurposes).filter(item=>ACTIVITY_PURPOSES.includes(item)),tagIds:unique(source.tagIds),reviewStatus:['unreviewed','reviewed'].includes(source.reviewStatus)?source.reviewStatus:'unreviewed',sourceType:['original','adapted','imported','legacy'].includes(source.sourceType)?source.sourceType:'legacy'};
  }
  async function updateActivityOrganization(activityIds,patch={}){
    const library=Core.getActivityLibrary();const results=[];
    (activityIds||[]).forEach(id=>{
      const activity=library[id];if(!activity){results.push({valid:false,activityId:id,errors:['活动不存在。']});return}
      const current=activityOrganization(activity);const next={...current,...clone(patch)};
      if(patch.tagIds)next.tagIds=unique(patch.tagIds).filter(tagId=>getTags().some(tag=>tag.id===tagId));
      if(patch.addTagIds)next.tagIds=unique([...current.tagIds,...patch.addTagIds]).filter(tagId=>getTags().some(tag=>tag.id===tagId));
      if(patch.removeTagIds){const remove=new Set(patch.removeTagIds);next.tagIds=current.tagIds.filter(id=>!remove.has(id))}
      if(patch.usagePurposes)next.usagePurposes=unique(patch.usagePurposes).filter(item=>ACTIVITY_PURPOSES.includes(item));
      delete next.addTagIds;delete next.removeTagIds;
      activity.metadata.organization=next;results.push({activity,activityId:id});
    });
    const saved=await Core.saveActivities(results.filter(item=>item.activity).map(item=>item.activity),{touch:true});return {valid:saved.valid,results:saved.results.map((item,index)=>({...item,activityId:results[index]?.activityId}))};
  }

  function normalizePaper(paper,index=0){
    const source=paper&&typeof paper==='object'?paper:{};const sections=(Array.isArray(source.sections)?source.sections:[]).map((section,sectionIndex)=>({id:clean(section.id)||safeId('paper-section'),title:clean(section.title)||`第 ${sectionIndex+1} 部分`,order:Number(section.order)||sectionIndex+1,items:(Array.isArray(section.items)?section.items:[]).map((item,itemIndex)=>({activityId:clean(item.activityId),score:Math.max(0,Number(item.score)||1),order:Number(item.order)||itemIndex+1})).filter(item=>item.activityId)}));
    return {id:clean(source.id)||safeId('paper'),schemaVersion:SCHEMA_VERSION,title:clean(source.title||source.name)||`新试卷 ${index+1}`,subjectId:clean(source.subjectId)||'subject-pmp',description:clean(source.description),sections:sections.length?sections:[{id:safeId('paper-section'),title:'试题',order:1,items:[]}],settings:{durationMinutes:Math.max(0,Number(source.settings?.durationMinutes)||0),passingScore:Math.max(0,Number(source.settings?.passingScore)||60),shuffleActivities:!!source.settings?.shuffleActivities,shuffleOptions:source.settings?.shuffleOptions!==false,attemptsAllowed:Math.max(1,Number(source.settings?.attemptsAllowed)||1),showAnswersAfterSubmit:source.settings?.showAnswersAfterSubmit!==false},status:PAPER_STATUSES.includes(source.status)?source.status:'draft',version:Math.max(1,Number(source.version)||1),publishedAt:clean(source.publishedAt),archivedAt:clean(source.archivedAt),authorship:authorRecord(source.authorship)};
  }
  function getPapers(filters={}){
    let list=(read(PAPER_RESOURCE,[])||[]).map(normalizePaper);
    if(filters.subjectId)list=list.filter(item=>item.subjectId===filters.subjectId);
    if(filters.status)list=list.filter(item=>item.status===filters.status);
    return clone(list.sort((a,b)=>String(b.authorship.updatedAt).localeCompare(String(a.authorship.updatedAt))));
  }
  function validatePaper(paper){
    const record=normalizePaper(paper);const errors=[];const warnings=[];const library=Core.getActivityLibrary();const ids=[];
    if(!record.title)errors.push('试卷名称不能为空。');if(!Core.subjectById(record.subjectId))errors.push('试卷科目不存在。');
    record.sections.forEach(section=>section.items.forEach(item=>{ids.push(item.activityId);const activity=library[item.activityId];if(!activity)errors.push(`活动不存在：${item.activityId}`);else if(activity.metadata?.subjectId!==record.subjectId)warnings.push(`活动 ${item.activityId} 与试卷科目不一致。`);if(item.score<=0)warnings.push(`活动 ${item.activityId} 的分值为 0。`)}));
    if(!ids.length)warnings.push('试卷还没有题目。');if(new Set(ids).size!==ids.length)warnings.push('试卷中存在重复活动。');
    return {valid:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)],paper:record,totalScore:record.sections.reduce((sum,section)=>sum+section.items.reduce((sub,item)=>sub+item.score,0),0),activityCount:ids.length};
  }
  async function savePaper(){return {valid:false,errors:['活动组卷旧入口已停用，请在试卷管理页使用题目 API 组卷。']}}
  async function deletePaper(){return {valid:false,errors:['请在试卷管理页执行删除。']}}
  async function publishPaper(){return {valid:false,errors:['请在试卷管理页执行发布。']}}
  async function archivePaper(){return {valid:false,errors:['请在试卷管理页执行归档。']}}

  function normalizeTask(task,index=0){
    const source=task&&typeof task==='object'?task:{};
    const rawType=clean(source.type);
    const historical=resolveHistoricalTaskType(rawType);
    const activeType=ModePolicy?.ACTIVE_MODE_ALIASES?.[rawType.toLowerCase()]||rawType;
    const type=historical?.id||(TASK_TYPES.includes(activeType)?activeType:'deep_recall');
    return {id:clean(source.id)||safeId('learning-task'),schemaVersion:SCHEMA_VERSION,title:clean(source.title)||`学习任务 ${index+1}`,type,typeLabel:historical?.label||ModePolicy?.label?.(type)||type,retired:!!historical,fallbackId:historical?.fallbackId||'',releaseId:clean(source.releaseId),revision:Math.max(1,Number(source.revision)||1),subjectId:clean(source.subjectId)||'subject-pmp',description:clean(source.description),sourceActivityIds:unique(source.sourceActivityIds),sourcePaperId:clean(source.sourcePaperId),config:{keywordAnnotations:Array.isArray(source.config?.keywordAnnotations)?clone(source.config.keywordAnnotations):[],legacyQuestionRefs:Array.isArray(source.config?.legacyQuestionRefs)?clone(source.config.legacyQuestionRefs):[],workspaceId:clean(source.config?.workspaceId),templateParserVersion:clean(source.config?.templateParserVersion)||'reserved-v1'},status:PAPER_STATUSES.includes(source.status)?source.status:'draft',version:Math.max(1,Number(source.version)||1),publishedAt:clean(source.publishedAt),archivedAt:clean(source.archivedAt),authorship:authorRecord(source.authorship),legacySource:source.legacySource?clone(source.legacySource):null};
  }
  function getLearningTasks(filters={}){
    let list=(read(TASK_RESOURCE,[])||[]).map(normalizeTask);
    if(filters.subjectId)list=list.filter(item=>item.subjectId===filters.subjectId);
    if(filters.type)list=list.filter(item=>item.type===filters.type);
    if(filters.status)list=list.filter(item=>item.status===filters.status);
    return clone(list.sort((a,b)=>String(b.authorship.updatedAt).localeCompare(String(a.authorship.updatedAt))));
  }
  function validateTask(task){
    const record=normalizeTask(task);const errors=[];const warnings=[];const library=Core.getActivityLibrary();
    if(resolveHistoricalTaskType(task?.type))errors.push(RETIRED_TASK_ERROR);
    if(!record.title)errors.push('学习任务名称不能为空。');if(!Core.subjectById(record.subjectId))errors.push('学习任务科目不存在。');
    record.sourceActivityIds.forEach(id=>{if(!library[id])errors.push(`活动不存在：${id}`);else if(library[id].metadata?.subjectId!==record.subjectId)warnings.push(`活动 ${id} 与任务科目不一致。`)});
    if(!record.sourceActivityIds.length&&!record.config.legacyQuestionRefs.length&&!record.config.workspaceId)warnings.push('学习任务尚未关联活动、旧题目或画布。');
    return {valid:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)],task:record};
  }
  async function saveLearningTask(task){const validation=validateTask(task);if(!validation.valid)return validation;const record=touch(validation.task);if(!record.releaseId)return {...validation,valid:false,errors:['请先发布课程并选择一个发布版本。']};const saved=await global.KGCourseManagementApi.saveTask(record);return {...validation,valid:true,task:normalizeTask(saved)}}
  async function deleteLearningTask(taskId){const task=getLearningTasks().find(item=>item.id===clean(taskId));if(!task)return {valid:false,errors:['学习任务不存在。']};if(task.retired)return {valid:false,errors:[RETIRED_TASK_ERROR],task};await global.KGCourseManagementApi.deleteTask(task.id,task.revision);return {valid:true,deletedId:task.id}}
  async function publishLearningTask(taskId){const task=getLearningTasks().find(item=>item.id===clean(taskId));if(!task)return {valid:false,errors:['学习任务不存在。']};const validation=validateTask(task);if(!validation.valid)return validation;const hasSource=task.sourceActivityIds.length||task.config.legacyQuestionRefs.length||task.config.workspaceId;if(!hasSource)return {valid:false,errors:['学习任务至少需要关联一个活动、旧题目或多题画布。']};return saveLearningTask({...task,status:'published',publishedAt:nowIso()})}
  async function archiveLearningTask(taskId){const task=getLearningTasks().find(item=>item.id===clean(taskId));if(!task)return {valid:false,errors:['学习任务不存在。']};return saveLearningTask({...task,status:'archived',archivedAt:nowIso()})}

  function migrateLegacyLearningSources(){return {valid:false,created:0,skipped:true,errors:['旧浏览器任务迁移已停用，请使用服务端迁移命令。']}}

  function activityReferences(activityId){
    const id=clean(activityId);const refs=[];
    Core.activityUsage(id).forEach(item=>refs.push({kind:'course',title:item.courseName,detail:item.nodeTitle,source:item.source,id:item.courseId}));
    getCollections().forEach(item=>{if(item.activityIds.includes(id))refs.push({kind:item.type==='favorites'?'favorite':'collection',title:item.title,detail:item.type==='favorites'?'收藏夹':'题集',id:item.id})});
    getPapers().forEach(paper=>paper.sections.forEach(section=>{if(section.items.some(item=>item.activityId===id))refs.push({kind:'paper',title:paper.title,detail:section.title,status:paper.status,id:paper.id})}));
    getLearningTasks().forEach(task=>{if(task.sourceActivityIds.includes(id))refs.push({kind:'learning_task',title:task.title,detail:task.type,status:task.status,id:task.id})});
    return refs;
  }
  function collectionUsage(collectionId){const item=getCollections().find(collection=>collection.id===clean(collectionId));return item?item.activityIds.map(activityId=>({activityId,references:activityReferences(activityId)})):[]}
  function summary(){return {tags:getTags().length,collections:getCollections().filter(item=>item.type==='collection').length,favorites:favoriteActivityIds().size,papers:getPapers().length,publishedPapers:getPapers({status:'published'}).length,tasks:getLearningTasks().length,publishedTasks:getLearningTasks({status:'published'}).length}}

  global.KGContentOrganization=Object.freeze({
    SCHEMA_VERSION,storageKeys:Object.freeze({}),TASK_TYPES,RETIRED_TASK_ERROR,ACTIVITY_DIFFICULTIES,ACTIVITY_PURPOSES,
    getTags,saveTag,deleteTag,getCollections,saveCollection,deleteCollection,addActivitiesToCollection,removeActivitiesFromCollection,toggleFavorite,favoriteActivityIds,
    activityOrganization,updateActivityOrganization,getPapers,savePaper,deletePaper,publishPaper,archivePaper,validatePaper,getLearningTasks,saveLearningTask,deleteLearningTask,publishLearningTask,archiveLearningTask,validateTask,migrateLegacyLearningSources,activityReferences,collectionUsage,summary,normalizePaper,normalizeTask
  });
})(window);
