'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};
  const Core=root.Core;
  const DEFAULT_IGNORED=[/^kg_question_banks_v1__/,/^kg_question_current_v1__/,/^kg_exam_current_v1__/,/^kg_admin_audit_log_v1$/,/^kg_deep_recall_current_question_v1$/];
  function directMatch(value,questionId,bankId){
    if(!value||typeof value!=='object')return false;
    const target=String(questionId),ids=[value.questionId,value.sourceQuestionId,value.originalQuestionId].filter(item=>item!=null).map(String);
    const arrayMatch=['questionIds','sourceQuestionIds','originalQuestionIds'].some(key=>Array.isArray(value[key])&&value[key].map(String).includes(target));
    if(!ids.includes(target)&&!arrayMatch)return false;
    const banks=[value.bankId,value.sourceBankId].filter(item=>item!=null).map(String);
    return !banks.length||banks.includes(String(bankId));
  }
  function countRefs(value,questionId,bankId,seen=new Set()){
    if(value==null||typeof value!=='object'||seen.has(value))return 0;
    seen.add(value);let count=directMatch(value,questionId,bankId)?1:0;
    if(Array.isArray(value))value.forEach(item=>{count+=countRefs(item,questionId,bankId,seen)});
    else Object.values(value).forEach(item=>{count+=countRefs(item,questionId,bankId,seen)});
    return count;
  }
  function classifyKey(key,prefixes={}){
    if(String(key).startsWith(prefixes.paper||'kg_exam_papers_v1__')||key===(prefixes.publishedPapers||'kg_exam_papers_published_v1')||key===(prefixes.releaseHistory||'kg_exam_paper_release_history_v1'))return 'paper';
    if(/course|learning_task|assignment|task/i.test(key))return 'courseTask';
    if(/learning_sessions|learning_events|learning_rounds|answer|score|stat|result|attempt|progress/i.test(key))return 'answer';
    return 'other';
  }
  function create(options={}){
    if(!Core)throw new Error('KGTeacherDomains.Core 尚未加载');
    const storage=options.storage||{};
    const read=options.read||((key)=>storage.readJSON?.(key,null));
    const keys=options.keys||(()=>storage.keys?.()||[]);
    const ignored=options.ignored||DEFAULT_IGNORED;
    const audit=options.audit||null;
    const actor=options.actor||(()=>({id:'local-teacher',name:'本地教师',role:'teacher'}));
    const now=options.now||Core.nowIso;
    function inspect(question,bank){
      const summary={paperRefs:0,courseTaskRefs:0,answerRefs:0,otherRefs:0,total:0,protected:false,locations:[]};
      const questionId=String(question?.id||''),bankId=String(bank?.id||'');if(!questionId)return summary;
      for(const rawKey of keys()){
        const key=String(rawKey||'');if(!key||ignored.some(rule=>rule.test(key)))continue;
        let value=null;try{value=read(key)}catch(error){continue}
        if(value==null)continue;const matches=countRefs(value,questionId,bankId);if(!matches)continue;
        const kind=classifyKey(key,options.prefixes||{});summary[`${kind}Refs`]=(summary[`${kind}Refs`]||0)+matches;summary.locations.push({key,kind,count:matches});
      }
      summary.total=summary.paperRefs+summary.courseTaskRefs+summary.answerRefs+summary.otherRefs;summary.protected=summary.total>0;return summary;
    }
    function aggregate(ids,bank){
      const rows=[...new Set((ids||[]).map(String))].map(id=>bank?.questions?.find(item=>String(item.id)===id)).filter(Boolean).map(question=>({question,refs:inspect(question,bank)}));
      return {rows,paperQuestions:rows.filter(row=>row.refs.paperRefs>0).length,courseQuestions:rows.filter(row=>row.refs.courseTaskRefs>0).length,answerQuestions:rows.filter(row=>row.refs.answerRefs>0).length,protectedQuestions:rows.filter(row=>row.refs.protected).length};
    }
    function lifecycle(question){const raw=question?.lifecycle||{};return {status:raw.status==='deleted'?'deleted':'active',deletedAt:String(raw.deletedAt||''),deletedBy:raw.deletedBy||null,deletedBatchId:String(raw.deletedBatchId||''),restoredAt:String(raw.restoredAt||''),restoredBy:raw.restoredBy||null}}
    function softDelete(bank,ids,options2={}){
      const batchId=Core.createId('batch-delete'),changed=[],uniqueIds=[...new Set((ids||[]).map(String))];const at=now(),who=actor(),isBulk=uniqueIds.length>1;
      for(const id of uniqueIds){const question=bank?.questions?.find(item=>String(item.id)===id);if(!question||lifecycle(question).status==='deleted')continue;const before=Core.clone(lifecycle(question));question.lifecycle={status:'deleted',deletedAt:at,deletedBy:who,deletedBatchId:batchId,restoredAt:'',restoredBy:null};changed.push(question.id);audit?.append?.({action:isBulk?'question.safe_delete.bulk':'question.safe_delete',entityType:'question',entityId:question.id,summary:`安全删除题目：${question.title||question.id}`,transactionId:batchId,metadata:{bankId:bank.id,batchId,questionId:String(question.id),before,after:question.lifecycle,references:inspect(question,bank)}})}
      if(changed.length)bank.updatedAt=Date.now();return Core.result(true,{bank,changed,batchId},[],[],{changed:changed.length});
    }
    function restore(bank,ids){
      const batchId=Core.createId('batch-restore'),changed=[],uniqueIds=[...new Set((ids||[]).map(String))],at=now(),who=actor(),isBulk=uniqueIds.length>1;
      for(const id of uniqueIds){const question=bank?.questions?.find(item=>String(item.id)===id);if(!question||lifecycle(question).status!=='deleted')continue;const before=Core.clone(lifecycle(question));question.lifecycle={...before,status:'active',deletedAt:'',deletedBy:null,deletedBatchId:'',restoredAt:at,restoredBy:who};changed.push(question.id);audit?.append?.({action:isBulk?'question.restore.bulk':'question.restore',entityType:'question',entityId:question.id,summary:`恢复题目：${question.title||question.id}`,transactionId:batchId,metadata:{bankId:bank.id,batchId,questionId:String(question.id),before,after:question.lifecycle}})}
      if(changed.length)bank.updatedAt=Date.now();return Core.result(true,{bank,changed,batchId},[],[],{changed:changed.length});
    }
    function permanentDelete(bank,ids){
      const batchId=Core.createId('batch-permanent-delete'),deleted=[],protectedIds=[];
      for(const id of [...new Set((ids||[]).map(String))]){const index=bank?.questions?.findIndex(item=>String(item.id)===id)??-1;if(index<0)continue;const question=bank.questions[index];if(lifecycle(question).status!=='deleted')continue;const refs=inspect(question,bank);if(refs.protected){protectedIds.push(question.id);audit?.append?.({action:'question.permanent_delete',entityType:'question',entityId:question.id,status:'failed',summary:`永久删除受保护：${question.title||question.id}`,transactionId:batchId,metadata:{bankId:bank.id,batchId,questionId:String(question.id),references:refs,reason:'business_reference_protected'}});continue}audit?.append?.({action:'question.permanent_delete',entityType:'question',entityId:question.id,summary:`永久删除题目：${question.title||question.id}`,transactionId:batchId,metadata:{bankId:bank.id,batchId,questionId:String(question.id),references:refs}});bank.questions.splice(index,1);deleted.push(question.id)}
      if(deleted.length)bank.updatedAt=Date.now();return Core.result(true,{bank,deleted,protectedIds,batchId},[],protectedIds.length?[`${protectedIds.length} 道题受业务引用保护，未删除。`]:[],{deleted:deleted.length,protected:protectedIds.length});
    }
    return Object.freeze({inspect,aggregate,softDelete,restore,permanentDelete,countRefs,directMatch});
  }
  root.QuestionBank=root.QuestionBank||{};
  root.QuestionBank.SafeDeleteService=Object.freeze({create,countRefs,directMatch});
})(globalThis);
