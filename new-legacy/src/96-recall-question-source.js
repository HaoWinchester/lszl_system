'use strict';

/* 深度回忆发布试卷题目源。只读取不可变发布版本，不读取题库或演示数据。 */
(function(global){
  const LEGACY_CURRENT_KEY='kg_deep_recall_current_question_v1';
  const AUTH_SESSION_KEY='kg_local_current_user_v1';
  const catalogReady=Promise.resolve(global.KGQuestionCatalogAdapter?.ready);
  let catalogLoaded=false;
  let cache={signature:'',list:[]};

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function text(value){return String(value==null?'':value)}
  function repository(){return global.KGPublishedPaperRepository||null}
  function collectionId(releaseId){return 'paper-release:'+text(releaseId)}
  function signature(){
    try{return global.localStorage?.getItem(repository()?.storageKey||'kg_exam_papers_published_v1')||''}catch(error){return ''}
  }
  function emptyQuestion(){
    return {id:'unavailable',title:'暂无可用题目',stemParts:[{text:'当前没有可用于深度回忆的已发布试卷。'}],options:[],clues:[],concepts:[],tags:[],sourceCollectionId:'',sourceBankId:'',sourceQuestionId:'unavailable',sourcePaperId:'',sourceReleaseId:''};
  }
  function buildList(){
    const repo=repository();
    if(!repo)return [];
    return (repo.listCollections({mode:'deep_recall',respectRole:true})||[]).map(collection=>({
      id:collection.id||collectionId(collection.releaseId),
      paperId:text(collection.paperId),
      releaseId:text(collection.releaseId),
      version:Number(collection.version||0),
      name:text(collection.name||'未命名试卷')+(Number(collection.version||0)>0?' · v'+Number(collection.version):''),
      subject:text(collection.subject||'PMP'),
      configuredCount:Number(collection.configuredCount||0),
      availableCount:Number(collection.availableCount||0),
      missingCount:Number(collection.missingCount||0),
      blockedCount:Number(collection.blockedCount||0),
      questions:(collection.questions||[]).map(item=>{
        const question=clone(item.question)||{};
        question.sourceCollectionId=collection.id||collectionId(collection.releaseId);
        question.sourcePaperId=text(collection.paperId);
        question.sourceReleaseId=text(collection.releaseId);
        question.sourceBankId=text(item.bankId||question.sourceBankId);
        question.sourceQuestionId=text(question.id||item.id);
        return {
          id:text(question.id||item.id),
          title:text(question.title||item.title||'未命名题目'),
          topic:text(question.topic||question.domain||item.topic),
          difficulty:text(question.difficulty||item.difficulty),
          bankId:text(item.bankId||question.sourceBankId),
          paperId:text(collection.paperId),
          releaseId:text(collection.releaseId),
          paperIndex:Number(item.paperIndex||0),
          question
        };
      })
    })).filter(item=>item.id&&item.questions.length);
  }
  function list(){if(!catalogLoaded)return [];const raw=signature();if(cache.signature===raw)return cache.list;cache={signature:raw,list:buildList()};return cache.list}
  function banks(){return list()}
  function invalidate(){cache={signature:'',list:[]}}
  function resolveCollection(identifier){
    const id=text(identifier);
    return list().find(item=>item.id===id||item.paperId===id||item.releaseId===id)||null;
  }
  function find(collectionIdentifier,questionId){
    const collection=resolveCollection(collectionIdentifier);
    if(!collection)return null;
    const item=collection.questions.find(row=>row.id===text(questionId));
    return item?{bank:collection,collection,question:clone(item.question),item:clone(item)}:null;
  }
  function findPublished(input={}){
    const collection=resolveCollection(input.collectionId||input.releaseId||input.paperId);
    if(collection){
      const item=collection.questions.find(row=>
        row.id===text(input.questionId)&&(!input.bankId||row.bankId===text(input.bankId))
      );
      if(item)return {bank:collection,collection,question:clone(item.question),item:clone(item)};
    }
    for(const row of list()){
      const item=row.questions.find(candidate=>
        candidate.id===text(input.questionId)&&
        (!input.bankId||candidate.bankId===text(input.bankId))&&
        (!input.paperId||row.paperId===text(input.paperId))&&
        (!input.releaseId||row.releaseId===text(input.releaseId))
      );
      if(item)return {bank:row,collection:row,question:clone(item.question),item:clone(item)};
    }
    return null;
  }
  function findAny(questionId,options={}){return findPublished({...options,questionId})}
  function activate(collectionIdentifier,questionId){
    const found=find(collectionIdentifier,questionId)||findAny(questionId,{collectionId:collectionIdentifier});
    if(!found)return {valid:false,errors:['这道题不在当前可用的已发布试卷中。']};
    const question=clone(found.question);
    question.sourceCollectionId=found.collection.id;
    question.sourcePaperId=found.collection.paperId;
    question.sourceReleaseId=found.collection.releaseId;
    question.sourceQuestionId=text(question.id);
    const userId=global.KGRecallStorage?.currentUserId?.()||global.KGAuthCore?.currentUsername?.()||global.localStorage?.getItem(AUTH_SESSION_KEY)||'guest';
    const payload={
      question,
      savedAt:Date.now(),
      source:'published-paper-deep-recall',
      sourceCollectionId:found.collection.id,
      sourcePaperId:found.collection.paperId,
      sourceReleaseId:found.collection.releaseId,
      sourceBankId:text(question.sourceBankId),
      sourceQuestionId:text(question.id),
      userId
    };
    try{
      const storage=global.KGRecallStorage;
      if(storage?.writeCurrent){if(!storage.writeCurrent(payload))throw new Error('本地存储写入失败')}
      else global.localStorage?.setItem(LEGACY_CURRENT_KEY,JSON.stringify(payload));
      return {valid:true,...found,question,payload};
    }catch(error){return {valid:false,errors:['切换题目失败：'+error.message]}}
  }

  catalogReady.then(()=>{catalogLoaded=true;invalidate()},()=>{catalogLoaded=false;invalidate()});

  try{
    global.addEventListener?.('kg:published-papers-changed',invalidate);
    global.addEventListener?.('kg-app-storage-change',event=>{
      if(text(event?.detail?.key)===(repository()?.storageKey||'kg_exam_papers_published_v1'))invalidate();
    });
  }catch(error){}

  const api=Object.freeze({ready:catalogReady,banks,list,find,findPublished,findAny,activate,invalidate,emptyQuestion});
  global.KGRecallQuestionSource=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
