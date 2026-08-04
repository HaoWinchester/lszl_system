'use strict';

/*
 * 已发布试卷只读仓库。
 *
 * 学员端统一从 kg_exam_papers_published_v1 读取不可变发布版本，
 * 并且只解析发布时冻结的 questionSnapshots。不会回退到教师草稿、
 * 私人题库、公共题库或演示题库，避免三个学习页面读取口径不一致。
 */
(function(global){
  const STORAGE_KEY='kg_exam_papers_published_v1';
  const ALL_MODES=Object.freeze(['deep_recall','multi_question_canvas','single_deep_study']);
  let cache={raw:null,releases:[]};

  function clone(value){
    if(value===undefined)return undefined;
    try{return JSON.parse(JSON.stringify(value))}catch(error){return value}
  }
  function text(value){return String(value==null?'':value)}
  function number(value,fallback=0){const result=Number(value);return Number.isFinite(result)?result:fallback}
  function readRaw(){
    try{return global.localStorage?.getItem(STORAGE_KEY)||''}catch(error){return ''}
  }
  function parseRows(raw){
    try{const value=JSON.parse(raw||'[]');return Array.isArray(value)?value:[]}catch(error){return []}
  }
  function normalizeModes(value){
    const rows=Array.isArray(value)?value.map(text).filter(Boolean):[];
    return rows.length?Array.from(new Set(rows)):Array.from(ALL_MODES);
  }
  function normalizeRef(ref,index){
    ref=ref&&typeof ref==='object'?ref:{};
    return {
      bankId:text(ref.bankId||ref.sourceBankId),
      questionId:text(ref.questionId||ref.sourceQuestionId||ref.id),
      order:number(ref.order,index+1),
      score:number(ref.score,1)
    };
  }
  function normalizeQuestion(question,meta){
    if(!question||typeof question!=='object')return null;
    const result=clone(question)||{};
    const id=text(result.id||meta.questionId);
    if(!id)return null;
    result.id=id;
    result.sourceQuestionId=id;
    result.sourceBankId=text(meta.bankId);
    result.sourcePaperId=text(meta.paperId);
    result.sourceReleaseId=text(meta.releaseId);
    result.sourcePaperVersion=number(meta.version,0);
    result.subject=result.subject||meta.subject||'';
    if(!Array.isArray(result.stemParts))result.stemParts=[{text:text(result.stem)}];
    if(!Array.isArray(result.options))result.options=[];
    if(!Array.isArray(result.clues))result.clues=[];
    if(!Array.isArray(result.concepts))result.concepts=[];
    if(!Array.isArray(result.tags))result.tags=[];
    return result;
  }
  function normalizeRelease(row,index){
    row=row&&typeof row==='object'?row:{};
    const releaseId=text(row.releaseId||row.id||('release-'+index));
    const paperId=text(row.paperId||row.sourcePaperId||row.id||releaseId);
    const refs=(Array.isArray(row.questions)?row.questions:(Array.isArray(row.questionRefs)?row.questionRefs:[]))
      .map(normalizeRef)
      .filter(ref=>ref.bankId&&ref.questionId)
      .sort((a,b)=>a.order-b.order);
    const snapshots=Array.isArray(row.questionSnapshots)?row.questionSnapshots.map(clone):[];
    const release={
      id:paperId,
      paperId,
      releaseId,
      version:number(row.version||row.publishedVersion,0),
      name:text(row.name||row.title||'未命名试卷'),
      title:text(row.title||row.name||'未命名试卷'),
      subject:text(row.subject||'PMP'),
      description:text(row.description),
      categoryId:text(row.categoryId),
      categoryName:text(row.categoryName),
      purpose:text(row.purpose||'learning'),
      status:text(row.status||'published')||'published',
      enabledModes:normalizeModes(row.enabledModes),
      publishedAt:number(row.publishedAt,0),
      publishedBy:text(row.publishedBy),
      totalCount:number(row.totalCount||refs.length,refs.length),
      updatedAt:number(row.updatedAt||row.publishedAt,0),
      questions:refs,
      questionSnapshots:snapshots
    };
    return release;
  }
  function releases(){
    const raw=readRaw();
    if(cache.raw===raw)return cache.releases;
    const rows=parseRows(raw).map(normalizeRelease).filter(item=>item.releaseId&&item.paperId&&item.status==='published');
    cache={raw,releases:rows};
    return rows;
  }
  function invalidate(){cache={raw:null,releases:[]}}
  function findRelease(identifier){
    const id=text(identifier);
    if(!id)return null;
    const rows=releases();
    const exact=rows.find(item=>item.releaseId===id);
    if(exact)return exact;
    return rows.filter(item=>item.paperId===id||item.id===id).sort((a,b)=>
      number(b.version,0)-number(a.version,0)||number(b.publishedAt,0)-number(a.publishedAt,0)
    )[0]||null;
  }
  function snapshotKey(bankId,questionId){return text(bankId)+'::'+text(questionId)}
  function roleAllowed(question,bankId,mode,respectRole){
    if(respectRole===false)return true;
    const roleApi=global.KGRolePermissions;
    if(!roleApi)return true;
    try{
      if(mode==='deep_recall'&&typeof roleApi.canUseDeepRecallQuestion==='function')return !!roleApi.canUseDeepRecallQuestion(question,bankId);
      if(typeof roleApi.canOperateQuestion==='function')return !!roleApi.canOperateQuestion(question,bankId);
    }catch(error){return false}
    return true;
  }
  function resolvePublishedPaper(identifier,options={}){
    const release=typeof identifier==='object'&&identifier?findRelease(identifier.releaseId||identifier.paperId||identifier.id)||normalizeRelease(identifier,0):findRelease(identifier);
    if(!release)return null;
    const mode=text(options.mode);
    if(mode&&!release.enabledModes.includes(mode))return null;
    const snapshotMap=new Map();
    const bankMeta=new Map();
    (release.questionSnapshots||[]).forEach(snapshot=>{
      const bankId=text(snapshot?.bankId),questionId=text(snapshot?.questionId||snapshot?.question?.id);
      if(!bankId||!questionId||!snapshot?.question)return;
      snapshotMap.set(snapshotKey(bankId,questionId),snapshot);
      if(!bankMeta.has(bankId))bankMeta.set(bankId,{
        id:bankId,
        name:text(snapshot.bankName||release.name||'发布试卷题目'),
        subject:text(snapshot.bankSubject||release.subject||'PMP'),
        visibility:'published-paper',
        releaseId:release.releaseId,
        paperId:release.paperId,
        questions:[]
      });
    });
    const prepared=[];
    let missingCount=0,blockedCount=0;
    release.questions.forEach((ref,paperIndex)=>{
      const snapshot=snapshotMap.get(snapshotKey(ref.bankId,ref.questionId));
      const question=normalizeQuestion(snapshot?.question,{
        bankId:ref.bankId,
        questionId:ref.questionId,
        paperId:release.paperId,
        releaseId:release.releaseId,
        version:release.version,
        subject:snapshot?.bankSubject||release.subject
      });
      if(!snapshot||!question){missingCount+=1;return}
      if(!roleAllowed(question,ref.bankId,mode,options.respectRole)){blockedCount+=1;return}
      prepared.push({ref,paperIndex,question,bankId:ref.bankId,snapshot});
      const group=bankMeta.get(ref.bankId)||{
        id:ref.bankId,
        name:text(snapshot.bankName||release.name||'发布试卷题目'),
        subject:text(snapshot.bankSubject||release.subject||'PMP'),
        visibility:'published-paper',
        releaseId:release.releaseId,
        paperId:release.paperId,
        questions:[]
      };
      if(!bankMeta.has(ref.bankId))bankMeta.set(ref.bankId,group);
      group.questions.push(question);
    });
    const items=prepared.map(row=>{
      const bank=bankMeta.get(row.bankId);
      return {
        paper:release,
        release,
        paperId:release.paperId,
        releaseId:release.releaseId,
        version:release.version,
        paperIndex:row.paperIndex,
        index:row.paperIndex,
        bankQuestionIndex:Math.max(0,(bank?.questions||[]).findIndex(item=>text(item.id)===text(row.question.id))),
        bank,
        question:row.question,
        ref:row.ref,
        source:'published-release'
      };
    });
    return {
      paper:release,
      release,
      items,
      configuredCount:release.questions.length,
      targetCount:number(release.totalCount,release.questions.length),
      availableCount:items.length,
      missingCount,
      blockedCount,
      status:items.length?'ready':(release.questions.length?'unavailable':'empty')
    };
  }
  function listPublishedPapers(options={}){
    const mode=text(options.mode);
    return releases()
      .filter(release=>!mode||release.enabledModes.includes(mode))
      .map(release=>resolvePublishedPaper(release,{...options,mode}))
      .filter(Boolean);
  }
  function getPublishedPaper(identifier){return clone(findRelease(identifier))}
  function resolvePaperQuestions(identifier,options={}){return resolvePublishedPaper(identifier,options)}
  function findQuestion(input={},options={}){
    if(typeof input==='string')input={questionId:input};
    const paperIdentifier=input.releaseId||input.paperId||input.id||options.releaseId||options.paperId||'';
    const mode=text(input.mode||options.mode);
    const entries=paperIdentifier?
      [resolvePublishedPaper(paperIdentifier,{...options,mode})].filter(Boolean):
      listPublishedPapers({...options,mode});
    for(const entry of entries){
      const item=entry.items.find(row=>
        text(row.question?.id||row.ref?.questionId)===text(input.questionId||input.sourceQuestionId)&&
        (!input.bankId||text(row.bank?.id||row.ref?.bankId)===text(input.bankId))
      );
      if(item)return clone(item);
    }
    return null;
  }
  function listCollections(options={}){
    return listPublishedPapers(options).map(entry=>({
      id:'paper-release:'+entry.paper.releaseId,
      paperId:entry.paper.paperId,
      releaseId:entry.paper.releaseId,
      version:entry.paper.version,
      name:entry.paper.name,
      title:entry.paper.title,
      subject:entry.paper.subject,
      enabledModes:[...entry.paper.enabledModes],
      configuredCount:entry.configuredCount,
      availableCount:entry.availableCount,
      missingCount:entry.missingCount,
      blockedCount:entry.blockedCount,
      questions:entry.items.map(item=>({
        id:text(item.question.id),
        title:text(item.question.title||'未命名题目'),
        topic:text(item.question.topic||item.question.domain),
        difficulty:text(item.question.difficulty),
        bankId:text(item.bank.id),
        paperId:entry.paper.paperId,
        releaseId:entry.paper.releaseId,
        paperIndex:item.paperIndex,
        question:clone(item.question)
      }))
    }));
  }

  try{
    global.addEventListener?.('storage',event=>{if(text(event?.key)===STORAGE_KEY)invalidate()});
    global.addEventListener?.('kg:published-papers-changed',invalidate);
    global.addEventListener?.('kg-app-storage-change',event=>{if(text(event?.detail?.key)===STORAGE_KEY)invalidate()});
  }catch(error){}

  const api=Object.freeze({
    storageKey:STORAGE_KEY,
    modes:ALL_MODES,
    invalidate,
    listReleases:()=>releases().map(clone),
    listPublishedPapers,
    getPublishedPaper,
    resolvePublishedPaper,
    resolvePaperQuestions,
    findQuestion,
    listCollections
  });
  global.KGPublishedPaperRepository=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
