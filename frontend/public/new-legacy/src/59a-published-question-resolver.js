'use strict';

/*
 * PublishedQuestionResolver
 * 统一三个学习模式的冻结题目解析、错误分类与固定学习上下文。
 */
(function(global){
  const ERROR_MESSAGES=Object.freeze({
    PAPER_NOT_FOUND:'没有找到这份已发布试卷。',
    RELEASE_NOT_FOUND:'指定的发布版本不存在或历史记录已损坏。',
    RELEASE_WITHDRAWN:'该发布版本已撤回，不能新建或继续学习会话。',
    MODE_DISABLED:'该试卷未开放当前学习模式。',
    PAPER_FORBIDDEN:'当前账号没有权限学习这份试卷。',
    QUESTION_NOT_FOUND:'这道题不在指定的发布版本中。',
    QUESTION_SNAPSHOT_MISSING:'这道题的发布快照缺失。',
    QUESTION_SNAPSHOT_DAMAGED:'这道题的发布快照已损坏。',
    QUESTION_FORBIDDEN:'当前账号无权学习这道题。',
    EMPTY_PAPER:'这份试卷没有可学习的题目。'
  });
  function text(value){return String(value==null?'':value)}
  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function repository(){return global.KGPublishedPaperRepository||null}
  function normalizeContext(input={},defaults={}){
    if(typeof input==='string')input={questionId:input};
    const context={
      paperId:text(input.paperId||input.sourcePaperId||defaults.paperId),
      releaseId:text(input.releaseId||input.sourceReleaseId||defaults.releaseId),
      questionId:text(input.questionId||input.sourceQuestionId||input.id||defaults.questionId),
      bankId:text(input.bankId||input.sourceBankId||defaults.bankId),
      mode:text(input.mode||defaults.mode),
      source:text(input.source||defaults.source),
      workspaceId:text(input.workspaceId||input.workspace||defaults.workspaceId),
      returnUrl:text(input.returnUrl||input.return||defaults.returnUrl)
    };
    context.key=[context.paperId,context.releaseId,context.questionId].map(encodeURIComponent).join('::');
    context.complete=!!(context.paperId&&context.releaseId&&context.questionId);
    return context;
  }
  function failure(code,details={}){
    return {ok:false,code,message:text(details.message||ERROR_MESSAGES[code]||'发布内容不可用。'),context:normalizeContext(details.context||{}),paper:details.paper||null,release:details.release||details.paper||null,item:null,issues:clone(details.issues||[]),...details};
  }
  function resolvePaper(identifier,options={}){
    const repo=repository();
    if(!repo)return failure('PAPER_NOT_FOUND');
    const context=normalizeContext(typeof identifier==='object'?identifier:{releaseId:text(identifier)},options);
    const result=repo.__resolveInternally
      ?repo.__resolveInternally({paperId:context.paperId,releaseId:context.releaseId},{...options,mode:context.mode||options.mode,__repositoryInternal:true})
      :repo.resolvePublishedPaper?.({paperId:context.paperId,releaseId:context.releaseId},{...options,mode:context.mode||options.mode,__repositoryInternal:true});
    if(!result)return failure(context.releaseId?'RELEASE_NOT_FOUND':'PAPER_NOT_FOUND',{context});
    if(result.ok===false)return failure(result.code||'PAPER_NOT_FOUND',{...result,context:{...context,paperId:result.release?.paperId||context.paperId,releaseId:result.release?.releaseId||context.releaseId}});
    const canonical=normalizeContext({...context,paperId:result.paper?.paperId,releaseId:result.paper?.releaseId,mode:context.mode||options.mode});
    return {...result,ok:true,context:canonical};
  }
  function issueForQuestion(entry,context){
    const issue=(entry?.issues||[]).find(row=>
      text(row.questionId)===context.questionId&&(!context.bankId||text(row.bankId)===context.bankId)
    );
    if(issue)return failure(issue.code||'QUESTION_NOT_FOUND',{message:issue.message,context,paper:entry.paper,release:entry.release,issues:[issue],entry});
    return failure('QUESTION_NOT_FOUND',{context,paper:entry?.paper,release:entry?.release,issues:entry?.issues||[],entry});
  }
  function resolveQuestion(input={},options={}){
    const context=normalizeContext(input,options);
    const entry=resolvePaper(context,{...options,mode:context.mode||options.mode});
    if(!entry.ok)return entry;
    const canonicalBase=normalizeContext({...context,paperId:entry.paper.paperId,releaseId:entry.paper.releaseId,mode:context.mode||options.mode});
    if(!canonicalBase.questionId){
      const first=entry.items?.[0];
      if(!first)return failure('EMPTY_PAPER',{context:canonicalBase,paper:entry.paper,release:entry.release,issues:entry.issues||[],entry});
      const firstContext=normalizeContext({...canonicalBase,questionId:first.question.id,bankId:first.bank?.id||first.ref?.bankId});
      return {ok:true,code:entry.code||'READY',message:entry.message||'发布题目可用。',context:firstContext,paper:entry.paper,release:entry.release,item:clone(first),question:clone(first.question),bank:clone(first.bank),entry};
    }
    const item=(entry.items||[]).find(row=>
      text(row.question?.id||row.ref?.questionId)===canonicalBase.questionId&&
      (!canonicalBase.bankId||text(row.bank?.id||row.ref?.bankId)===canonicalBase.bankId)
    );
    if(!item)return issueForQuestion(entry,canonicalBase);
    const resolvedContext=normalizeContext({...canonicalBase,bankId:item.bank?.id||item.ref?.bankId,questionId:item.question?.id||item.ref?.questionId});
    return {ok:true,code:entry.code||'READY',message:entry.message||'发布题目可用。',context:resolvedContext,paper:entry.paper,release:entry.release,item:clone(item),question:clone(item.question),bank:clone(item.bank),entry};
  }
  function listPapers(options={}){
    const repo=repository();
    if(!repo)return [];
    return (repo.listPublishedPapers?.(options)||[]).map(entry=>({...entry,context:normalizeContext({paperId:entry.paper?.paperId,releaseId:entry.paper?.releaseId,mode:options.mode})}));
  }
  function message(result,fallback='发布内容不可用。'){
    if(!result)return fallback;
    return text(result.message||ERROR_MESSAGES[result.code]||fallback);
  }
  function contextFromItem(item,mode=''){
    return normalizeContext({paperId:item?.paper?.paperId||item?.paperId||item?.question?.sourcePaperId,releaseId:item?.paper?.releaseId||item?.releaseId||item?.question?.sourceReleaseId,questionId:item?.question?.id||item?.ref?.questionId,bankId:item?.bank?.id||item?.ref?.bankId,mode});
  }

  const api=Object.freeze({ERROR_MESSAGES,normalizeContext,contextFromItem,resolvePaper,resolveQuestion,listPapers,message});
  global.KGPublishedQuestionResolver=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
