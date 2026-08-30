'use strict';

/* 深度回忆发布题目源：页面只保留交互，发布版本与快照解析由共享模块完成。
 * P4.6 第 1 轮：数据源改为 KGPaperReleaseApi 细粒度 API（经 59-repository），
 * list() 保持同步读内存缓存；缓存由异步 rebuild 填充，rebuild 完成后广播
 * kg:recall-source-updated 让页面重渲染。 */
(function(global){
  const LEGACY_CURRENT_KEY='kg_deep_recall_current_question_v1';
  const MODE='deep_recall';
  const catalogReady=Promise.resolve(global.KGQuestionCatalogAdapter?.ready);
  let catalogLoaded=false;
  let cache={generation:0,list:[]};
  let rebuilding=false;

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function text(value){return String(value==null?'':value)}
  function isRecallPage(){return !!global.document?.body?.classList?.contains?.('knowledge-recall-page')}
  function repository(){return global.KGPublishedPaperRepository||null}
  function resolver(){return global.KGPublishedQuestionResolver||null}
  function collectionId(releaseId){return 'paper-release:'+text(releaseId)}
  function emptyQuestion(message='当前没有可用于深度回忆的已发布试卷。'){
    return {id:'unavailable',title:'暂无题目',stemParts:[{text:message}],options:[],clues:[],concepts:[],tags:[],sourceCollectionId:'',sourceBankId:'',sourceQuestionId:'unavailable',sourcePaperId:'',sourceReleaseId:''};
  }
  function collectionFromEntry(entry){
    const paper=entry.paper||{};
    return {
      id:collectionId(paper.releaseId),paperId:text(paper.paperId),releaseId:text(paper.releaseId),version:Number(paper.version||0),
      name:text(paper.name||'未命名试卷')+(Number(paper.version||0)>0?' · v'+Number(paper.version):''),subject:text(paper.subject||'PMP'),
      configuredCount:Number(entry.configuredCount||0),availableCount:Number(entry.availableCount||0),missingCount:Number(entry.missingCount||0),damagedCount:Number(entry.damagedCount||0),blockedCount:Number(entry.blockedCount||0),issues:clone(entry.issues||[]),
      questions:(entry.items||[]).map(item=>{
        const question=clone(item.question)||{};
        question.sourceCollectionId=collectionId(paper.releaseId);question.sourcePaperId=text(paper.paperId);question.sourceReleaseId=text(paper.releaseId);question.sourceBankId=text(item.bank?.id||item.ref?.bankId);question.sourceQuestionId=text(question.id||item.ref?.questionId);
        return {id:text(question.id),title:text(question.title||'未命名题目'),topic:text(question.topic||question.domain),difficulty:text(question.difficulty),bankId:text(question.sourceBankId),paperId:text(paper.paperId),releaseId:text(paper.releaseId),paperIndex:Number(item.paperIndex||0),context:clone(item.context),question};
      })
    };
  }
  function lightweightCollection(row={}){
    const paperId=text(row.paperId||row.id),releaseId=text(row.releaseId);
    const configuredCount=Math.max(0,Number(row.totalCount||row.questionCount||0));
    return {
      id:collectionId(releaseId),paperId,releaseId,version:Number(row.version||0),
      name:text(row.name||row.title||'未命名试卷')+(Number(row.version||0)>0?' · v'+Number(row.version):''),subject:text(row.subject||'PMP'),
      configuredCount,availableCount:configuredCount,missingCount:0,damagedCount:0,blockedCount:0,issues:[],questions:[]
    };
  }
  function requestedRelease(target={},rows=[]){
    const route=global.KGLearningRouteContext?.parse?.({mode:MODE})||{};
    const saved=global.KGRecallStorage?.readCurrent?.()||{};
    const collectionRelease=text(target.collectionId).replace(/^paper-release:/,'');
    const releaseId=text(target.releaseId||collectionRelease||route.releaseId||saved.sourceReleaseId||saved.question?.sourceReleaseId);
    const paperId=text(target.paperId||route.paperId||saved.sourcePaperId||saved.question?.sourcePaperId);
    return rows.find(row=>releaseId&&text(row.releaseId)===releaseId)
      ||rows.find(row=>paperId&&text(row.paperId||row.id)===paperId)
      ||rows[0]||null;
  }
  let rebuildPromise=null;
  let rebuildKey='';
  async function rebuild(target={},options={}){
    const key=[text(target.paperId),text(target.releaseId)].join('::');
    // 同一目标的并发调用复用一次解析；切换 release 时允许启动新的按需载入。
    if(rebuildPromise&&rebuildKey===key)return rebuildPromise;
    const previous=cache;
    rebuildKey=key;
    rebuildPromise=(async()=>{
      try{
        await repository()?.ready?.();
        const options={mode:MODE,respectRole:true};
        const rows=(repository()?.listCatalogEntries?.(options)||[]).filter(row=>{
          const inspected=repository()?.inspectRelease?.({paperId:row.paperId||row.id,releaseId:row.releaseId},options);
          return !inspected||inspected.ok!==false;
        });
        const list=rows.map(row=>{
          const resolved=repository()?.peekResolved?.(row.releaseId);
          return resolved?collectionFromEntry(resolved):lightweightCollection(row);
        }).filter(item=>item.id);
        const selected=requestedRelease(target,rows);
        if(selected&&typeof resolver()?.resolvePaper==='function'){
          const resolved=repository()?.peekResolved?.(selected.releaseId)
            ||await resolver().resolvePaper({paperId:selected.paperId||selected.id,releaseId:selected.releaseId,mode:MODE},options);
          if(!resolved?.ok)throw new Error(resolver()?.message?.(resolved,'指定发布版本不可用。')||resolved?.message||'指定发布版本不可用。');
          const collection=collectionFromEntry(resolved);
          const index=list.findIndex(item=>item.releaseId===collection.releaseId);
          if(index>=0)list[index]=collection;else list.unshift(collection);
        }
        cache={generation:cache.generation+1,list};
        try{global.dispatchEvent?.(new CustomEvent('kg:recall-source-updated',{detail:{generation:cache.generation}}))}catch(error){}
        return list;
      }catch(error){
        console.error('深度回忆发布题目载入失败',error);
        cache=previous;
        if(options.throwOnError)throw error;
        return previous.list;
      }finally{
        rebuilding=false;
        if(rebuildKey===key){rebuildPromise=null;rebuildKey=''}
      }
    })();
    rebuilding=true;
    return rebuildPromise;
  }
  function list(){
    if(!cache.list.length)void rebuild();
    return cache.list;
  }
  function banks(){return list()}
  function invalidate(){cache={generation:cache.generation+1,list:[]};void rebuild()}
  function resolveCollection(identifier){const id=text(identifier);return cache.list.find(item=>item.id===id||item.paperId===id||item.releaseId===id)||null}
  async function loadCollection(identifier){
    const input=identifier&&typeof identifier==='object'?identifier:{collectionId:text(identifier)};
    const current=resolveCollection(input.collectionId||input.releaseId||input.paperId);
    if(current?.questions?.length)return current;
    await rebuild({collectionId:text(input.collectionId||current?.id),paperId:text(input.paperId||current?.paperId),releaseId:text(input.releaseId||current?.releaseId)},{throwOnError:true});
    return resolveCollection(input.collectionId||input.releaseId||input.paperId||current?.id);
  }
  function find(collectionIdentifier,questionId){const collection=resolveCollection(collectionIdentifier);if(!collection)return null;const item=collection.questions.find(row=>row.id===text(questionId));return item?{bank:collection,collection,question:clone(item.question),item:clone(item)}:null}
  async function foundFromResolution(result){
    if(!result?.ok)return null;
    const collection=collectionFromEntry(result.entry);
    const item=collection.questions.find(row=>row.id===text(result.question?.id)&&(!result.context?.bankId||row.bankId===text(result.context.bankId)));
    return item?{bank:collection,collection,question:clone(item.question),item:clone(item),resolution:result}:null;
  }
  async function findPublished(input={}){
    if(typeof input==='string')input={questionId:input};
    const context=global.KGLearningRouteContext?.normalize?.({...input,mode:MODE})||{...input,mode:MODE};
    if(context.releaseId||context.paperId){
      const result=await resolver()?.resolveQuestion?.(context,{mode:MODE,respectRole:true});
      const found=await foundFromResolution(result);if(found)return found;
    }
    if(!cache.list.length)await rebuild();
    const collection=resolveCollection(input.collectionId||input.releaseId||input.paperId);
    if(collection){const item=collection.questions.find(row=>row.id===text(input.questionId)&&(!input.bankId||row.bankId===text(input.bankId)));if(item)return {bank:collection,collection,question:clone(item.question),item:clone(item)}}
    for(const row of cache.list){
      const item=row.questions.find(candidate=>candidate.id===text(input.questionId)&&(!input.bankId||candidate.bankId===text(input.bankId))&&(!input.paperId||row.paperId===text(input.paperId))&&(!input.releaseId||row.releaseId===text(input.releaseId)));
      if(item)return {bank:row,collection:row,question:clone(item.question),item:clone(item)};
    }
    return null;
  }
  async function findAny(questionId,options={}){return findPublished({...options,questionId})}
  async function activate(collectionIdentifier,questionId,options={}){
    if(!cache.list.length)await rebuild();
    const collection=resolveCollection(collectionIdentifier);
    const input=typeof collectionIdentifier==='object'?collectionIdentifier:{collectionId:collectionIdentifier,paperId:collection?.paperId||'',releaseId:collection?.releaseId||'',questionId,bankId:options.bankId||'',mode:MODE};
    const result=await resolver()?.resolveQuestion?.(input,{mode:MODE,respectRole:true});
    const found=(await foundFromResolution(result))||find(collectionIdentifier,questionId)||await findAny(questionId,{collectionId:collectionIdentifier});
    if(!found)return {valid:false,code:result?.code||'QUESTION_NOT_FOUND',errors:[resolver()?.message?.(result,'这道题不在当前可用的已发布试卷中。')||'这道题不在当前可用的已发布试卷中。'],resolution:result||null};
    const question=clone(found.question),context=global.KGLearningRouteContext?.normalize?.({paperId:found.collection.paperId,releaseId:found.collection.releaseId,questionId:question.id,bankId:question.sourceBankId,mode:MODE,source:options.source||'published-paper-deep-recall',returnUrl:options.returnUrl||''})||{};
    question.sourceCollectionId=found.collection.id;question.sourcePaperId=found.collection.paperId;question.sourceReleaseId=found.collection.releaseId;question.sourceQuestionId=text(question.id);
    const userId=global.KGRecallStorage?.currentUserId?.()||global.KGAuthCore?.currentUsername?.()||global.__KG_DIRECT_BOOTSTRAP__?.username||'guest';
    const payload={question,savedAt:Date.now(),source:'published-paper-deep-recall',sourceCollectionId:found.collection.id,sourcePaperId:found.collection.paperId,sourceReleaseId:found.collection.releaseId,sourceBankId:text(question.sourceBankId),sourceQuestionId:text(question.id),learningContext:clone(context),userId};
    try{
      const storage=global.KGRecallStorage;if(storage?.writeCurrent){if(!storage.writeCurrent(payload))throw new Error('本地存储写入失败')}else global.localStorage?.setItem(LEGACY_CURRENT_KEY,JSON.stringify(payload));
      global.KGLearningProgress?.activate?.(context,{mode:MODE,clearTransient:true,userId});
      global.KGLearningRouteContext?.remember?.(context);
      return {valid:true,...found,question,payload,context,resolution:result||found.resolution||null};
    }catch(error){return {valid:false,code:'ACTIVATION_FAILED',errors:['切换题目失败：'+error.message]}}
  }

  if(isRecallPage()){
    catalogReady.then(()=>{catalogLoaded=true;invalidate()},()=>{catalogLoaded=false;invalidate()});
    try{
      global.addEventListener?.('kg:published-papers-changed',invalidate);
      global.addEventListener?.('kg-app-storage-change',event=>{if([repository()?.storageKey||'kg_exam_papers_published_v1',repository()?.historyKey||'kg_exam_paper_release_history_v1'].includes(text(event?.detail?.key)))invalidate()});
    }catch(error){}
  }

  const api=Object.freeze({ready:catalogReady,banks,list,find,findPublished,findAny,activate,invalidate,rebuild,loadCollection,emptyQuestion});
  global.KGRecallQuestionSource=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
