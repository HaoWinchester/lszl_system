'use strict';
(function(global){
  const Core=global.KGAdminCore;
  const INACTIVE_STATUSES=new Set(['inactive','disabled','deprecated','archived']);
  class SubjectService{
    constructor(options={}){this.legacy=options.legacy;this.transactions=options.transactions;this.permissions=options.permissions;this.references=options.references}
    list(options={}){const rows=this.legacy.getSubjects();return options.includeInactive===false?rows.filter(item=>!this.isInactive(item)):rows}
    get(subjectId){return this.legacy.subjectById(subjectId)}
    isInactive(subjectOrId){const item=typeof subjectOrId==='string'?this.get(subjectOrId):subjectOrId;return !!item&&INACTIVE_STATUSES.has(Core.clean(item.status).toLowerCase())}
    validate(subjects){
      const errors=[],ids=new Set(),codes=new Set();
      (subjects||[]).forEach((item,index)=>{
        const label=`第 ${index+1} 个科目`,id=Core.clean(item?.id),code=Core.clean(item?.code).toUpperCase(),name=Core.clean(item?.name?.zh||item?.name);
        if(!id)errors.push(`${label}缺少稳定 ID。`);else if(ids.has(id))errors.push(`科目 ID 重复：${id}`);else ids.add(id);
        if(!code)errors.push(`${id||label} 缺少编号。`);else if(!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(code))errors.push(`${id||label} 的编号只能使用 1—32 位大写字母、数字、点、下划线或连字符。`);else if(codes.has(code))errors.push(`科目编号重复：${code}`);else codes.add(code);
        if(!name)errors.push(`${id||label} 缺少中文名称。`);
      });
      return {valid:errors.length===0,errors,warnings:[]};
    }
    usage(subjectId){
      const subject=this.get(subjectId);if(!subject)return {valid:false,errors:['科目不存在。'],subjectId,total:0,counts:{},references:[]};
      if(typeof this.references?.subjectUsage==='function')return {valid:true,subjectId,...this.references.subjectUsage(subjectId)};
      const rows=[];const push=(kind,id,title)=>rows.push({kind,id,title});
      (this.legacy.getTaxonomies?.(subjectId)||[]).forEach(item=>push('taxonomy',item.id,item.name?.zh||item.id));
      Object.values(this.legacy.getActivityLibrary?.()||{}).filter(item=>item.metadata?.subjectId===subjectId).forEach(item=>push('activity',item.id,this.legacy.activityTitle?.(item)||item.id));
      (this.legacy.getCourseDrafts?.()||[]).filter(item=>item.subjectId===subjectId).forEach(item=>push('course_draft',item.id,item.name||item.id));
      (this.legacy.getCourseReleases?.()||[]).filter(item=>item.course?.subjectId===subjectId).forEach(item=>push('course_release',item.id,item.course?.name||item.id));
      return this._usageResult(rows);
    }
    deletionCheck(subjectId){
      const subject=this.get(subjectId);if(!subject)return {valid:false,errors:['科目不存在。']};
      const authority=this.references?.permanentDeleteCheck?.()||{valid:true,errors:[]};if(!authority.valid)return {...authority,subject,usage:{total:0,counts:{},references:[]}};
      const usage=this.usage(subjectId);if(!usage.valid)return usage;
      if(usage.total){
        const labels={taxonomy:'知识树',activity:'题目',course_draft:'课程草稿',course_release:'已发布课程',paper:'试卷',learning_task:'学习任务',collection:'题集',question_bank:'题库',question:'正式题目'};
        const detail=Object.entries(usage.counts).filter(([,count])=>count>0).map(([kind,count])=>`${labels[kind]||kind} ${count}`).join('、');
        return {valid:false,errors:[`该科目已有内容（${detail}），不能永久删除。请改为停用，已有内容和历史记录不会受影响。`],subject,usage};
      }
      return {valid:true,errors:[],subject,usage};
    }
    create(input={}){
      const subjects=this.list();const code=Core.clean(input.code).toUpperCase(),now=Core.nowIso(),actor=Core.actor();
      const record={id:this._nextId(code,subjects),code,name:{zh:Core.clean(input.nameZh||input.name?.zh||input.name),en:Core.clean(input.nameEn||input.name?.en)},description:{zh:Core.clean(input.descriptionZh||input.description?.zh||input.description),en:Core.clean(input.descriptionEn||input.description?.en)},defaultTaxonomyId:'',status:'active',sortOrder:(subjects.length+1)*10,createdAt:now,updatedAt:now,createdBy:actor,updatedBy:actor};
      const next=[...subjects,record];const validation=this.validate(next);if(!validation.valid)return validation;
      const tx=this.transactions.execute({name:'新增科目',action:'subject.create',entityType:'subject',entityId:record.id,permission:'editSubjects',keys:['subjects'],validate:()=>validation,commit:()=>({valid:!!this.legacy.saveSubjects(next),subject:this.legacy.subjectById(record.id)}),summary:`新增科目：${record.name.zh}`,metadata:{after:record}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{valid:true,subject:tx.value.subject,transactionId:tx.transactionId,snapshotId:tx.snapshotId,errors:[],warnings:[]}:{valid:false,errors:tx.errors||[]};
    }
    update(subjectId,input={}){
      const before=this.get(subjectId);if(!before)return {valid:false,errors:['科目不存在。']};
      const after={...before,name:{zh:Core.clean(input.nameZh||input.name?.zh||input.name||before.name?.zh),en:Core.clean(input.nameEn??input.name?.en??before.name?.en)},description:{zh:Core.clean(input.descriptionZh??input.description?.zh??before.description?.zh),en:Core.clean(input.descriptionEn??input.description?.en??before.description?.en)},updatedAt:Core.nowIso(),updatedBy:Core.actor()};
      const next=this.list().map(item=>item.id===subjectId?after:item);const validation=this.validate(next);if(!validation.valid)return validation;
      const tx=this.transactions.execute({name:'编辑科目',action:'subject.update',entityType:'subject',entityId:subjectId,permission:'editSubjects',keys:['subjects'],validate:()=>validation,commit:()=>({valid:!!this.legacy.saveSubjects(next),subject:this.legacy.subjectById(subjectId)}),summary:`编辑科目：${after.name.zh}`,metadata:{before,after}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{valid:true,subject:tx.value.subject,transactionId:tx.transactionId,snapshotId:tx.snapshotId,errors:[],warnings:[]}:{valid:false,errors:tx.errors||[]};
    }
    move(subjectId,direction){
      const rows=this.list().slice().sort((a,b)=>Number(a.sortOrder)-Number(b.sortOrder));const index=rows.findIndex(item=>item.id===subjectId);if(index<0)return {valid:false,errors:['科目不存在。']};
      const delta=direction==='up'||Number(direction)<0?-1:1,target=index+delta;if(target<0||target>=rows.length)return {valid:false,errors:['科目已经位于当前方向的边界。']};
      const before=rows.map(item=>({id:item.id,sortOrder:item.sortOrder}));[rows[index],rows[target]]=[rows[target],rows[index]];const next=rows.map((item,i)=>({...item,sortOrder:(i+1)*10,updatedAt:item.id===subjectId?Core.nowIso():item.updatedAt,updatedBy:item.id===subjectId?Core.actor():item.updatedBy}));
      const tx=this.transactions.execute({name:'调整科目顺序',action:'subject.reorder',entityType:'subject',entityId:subjectId,permission:'editSubjects',keys:['subjects'],validate:()=>this.validate(next),commit:()=>({valid:!!this.legacy.saveSubjects(next),subjects:this.legacy.getSubjects()}),summary:`调整科目顺序：${this.get(subjectId)?.name?.zh||subjectId}`,metadata:{direction:delta<0?'up':'down',before,after:next.map(item=>({id:item.id,sortOrder:item.sortOrder}))}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{valid:true,subjects:tx.value.subjects,transactionId:tx.transactionId,snapshotId:tx.snapshotId,errors:[]}:{valid:false,errors:tx.errors||[]};
    }
    setStatus(subjectId,status){
      const before=this.get(subjectId);if(!before)return {valid:false,errors:['科目不存在。']};const normalized=status==='active'?'active':'inactive';if((this.isInactive(before)?'inactive':'active')===normalized)return {valid:true,subject:before,errors:[],unchanged:true};
      const after={...before,status:normalized,updatedAt:Core.nowIso(),updatedBy:Core.actor()};const next=this.list().map(item=>item.id===subjectId?after:item);const action=normalized==='active'?'subject.restore':'subject.deactivate',name=normalized==='active'?'恢复科目':'停用科目';
      const tx=this.transactions.execute({name,action,entityType:'subject',entityId:subjectId,permission:'editSubjects',keys:['subjects'],validate:()=>this.validate(next),commit:()=>({valid:!!this.legacy.saveSubjects(next),subject:this.legacy.subjectById(subjectId)}),summary:`${name}：${before.name?.zh||before.code}`,metadata:{before,after}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{valid:true,subject:tx.value.subject,transactionId:tx.transactionId,snapshotId:tx.snapshotId,errors:[]}:{valid:false,errors:tx.errors||[]};
    }
    delete(subjectId){
      const check=this.deletionCheck(subjectId);if(!check.valid)return check;const before=check.subject,next=this.list().filter(item=>item.id!==subjectId);
      const tx=this.transactions.execute({name:'永久删除空科目',action:'subject.delete',entityType:'subject',entityId:subjectId,permission:'editSubjects',keys:['subjects'],validate:()=>this.validate(next),commit:()=>({valid:!!this.legacy.saveSubjects(next),subjects:this.legacy.getSubjects()}),summary:`永久删除空科目：${before.name?.zh||before.code}`,metadata:{before,usage:check.usage}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{valid:true,deleted:before,subjects:tx.value.subjects,transactionId:tx.transactionId,snapshotId:tx.snapshotId,errors:[]}:{valid:false,errors:tx.errors||[]};
    }
    saveAll(subjects){const tx=this.transactions.execute({name:'保存科目',action:'subject.save',entityType:'subject',permission:'editSubjects',keys:['subjects'],validate:()=>this.validate(subjects),commit:()=>({valid:!!this.legacy.saveSubjects(subjects),subjects:this.legacy.getSubjects()}),metadata:{count:(subjects||[]).length}});if(tx.valid)this.references?.invalidate();return tx.valid?{valid:true,subjects:tx.value.subjects,transactionId:tx.transactionId,errors:[],warnings:[]}:{valid:false,errors:tx.errors||[]}}
    _nextId(code,subjects){const slug=Core.clean(code).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');let id=slug?`subject-${slug}`:Core.safeId('subject');const used=new Set((subjects||[]).map(item=>item.id));let index=2,base=id;while(used.has(id))id=`${base}-${index++}`;return id}
    _usageResult(rows){const counts={};(rows||[]).forEach(item=>{counts[item.kind]=(counts[item.kind]||0)+1});return {valid:true,total:(rows||[]).length,counts,references:Core.clone(rows||[])} }
  }
  global.KGSubjectService=SubjectService;
})(window);
