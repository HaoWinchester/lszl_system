'use strict';

/*
 * GuidedLearningStore v6
 * 节点只保存统一的完成状态；部分跳级测试成绩单独保存在 placementTests 中。
 */
(function(global){
  const PREFIX='kg_guided_learning_progress_v2__';
  const LEGACY_PREFIX='kg_guided_learning_progress_v1__';
  const DEFAULT_MODE_KEY='kg_default_entry_mode_v1';

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function now(){return Date.now()}
  function currentUserId(){
    try{return String(global.KGAuthCore?.currentUsername?.()||global.KGAuthCore?.currentUser?.()?.username||'guest')}catch(error){return 'guest'}
  }
  function key(courseId,userId=currentUserId(),prefix=PREFIX){
    return prefix+encodeURIComponent(String(userId||'guest'))+'__'+encodeURIComponent(String(courseId||'course'));
  }
  function orderedNodes(course){return Array.isArray(course?.nodes)?course.nodes:[]}
  function emptyNode(index){
    return {
      status:index===0?'available':'locked',
      completedAt:null,
      metrics:null
    };
  }
  function empty(course,userId=currentUserId()){
    const nodes={};
    orderedNodes(course).forEach((node,index)=>{nodes[node.id]=emptyNode(index)});
    return {
      schemaVersion:4,
      userId:String(userId||'guest'),
      courseId:String(course?.id||''),
      currentNodeId:String(orderedNodes(course)[0]?.id||''),
      nodes,
      placementTests:{},
      createdAt:now(),
      updatedAt:now()
    };
  }
  function legacyCompleted(source){
    const status=String(source?.status||'');
    const method=String(source?.completionMethod||'');
    const type=String(source?.completionType||'');
    return ['completed','recompleted','review','passed_by_test'].includes(status)
      ||['normal','placement_test'].includes(method)
      ||['learned','passed_by_test'].includes(type);
  }
  function migrateLegacy(course,userId){
    let raw=null;
    const possibleIds=[course?.id,'pmp-change-response-demo-v1'].filter(Boolean);
    for(const courseId of possibleIds){
      try{raw=JSON.parse(localStorage.getItem(key(courseId,userId,LEGACY_PREFIX))||'null')}catch(error){raw=null}
      if(raw)break;
    }
    if(!raw)return null;
    const migrated=empty(course,userId);
    orderedNodes(course).forEach(node=>{
      const legacy=raw.nodes?.[node.id];
      if(legacyCompleted(legacy)){
        migrated.nodes[node.id]={
          status:'completed',
          completedAt:Number(legacy.completedAt||now()),
          metrics:legacy.metrics?clone(legacy.metrics):null
        };
      }
    });
    migrated.updatedAt=now();
    return migrated;
  }
  function normalizePlacementTests(raw){
    const source=raw&&typeof raw==='object'?raw:{};
    const output={};
    Object.entries(source).forEach(([partId,record])=>{
      if(!record||typeof record!=='object')return;
      const history=Array.isArray(record.history)?record.history.slice(-10).map(item=>clone(item)):[];
      output[partId]={
        partId:String(record.partId||partId),
        attemptCount:Math.max(history.length,Number(record.attemptCount)||0),
        passed:Boolean(record.passed),
        passedAt:record.passedAt?Number(record.passedAt):null,
        bestCorrect:Math.max(0,Number(record.bestCorrect)||0),
        bestPercent:Math.max(0,Number(record.bestPercent)||0),
        latest:record.latest?clone(record.latest):history.at(-1)||null,
        history
      };
    });
    return output;
  }
  function normalize(raw,course,userId=currentUserId()){
    const base=empty(course,userId);
    const result={
      ...base,
      ...clone(raw||{}),
      schemaVersion:4,
      userId:String(userId||raw?.userId||'guest'),
      courseId:String(course?.id||raw?.courseId||''),
      nodes:{...base.nodes},
      placementTests:normalizePlacementTests(raw?.placementTests)
    };
    orderedNodes(course).forEach(node=>{
      const source=clone(raw?.nodes?.[node.id]||{});
      const completed=legacyCompleted(source);
      result.nodes[node.id]={
        status:completed?'completed':'locked',
        completedAt:completed?Number(source.completedAt||now()):null,
        metrics:completed&&source.metrics?clone(source.metrics):null
      };
    });
    return recomputeUnlocks(result,course);
  }
  function recomputeUnlocks(progress,course){
    const nodes=orderedNodes(course);
    let firstIncompleteFound=false;
    for(const node of nodes){
      const entry=progress.nodes[node.id]||(progress.nodes[node.id]=emptyNode(1));
      if(entry.status==='completed')continue;
      entry.status=firstIncompleteFound?'locked':'available';
      entry.completedAt=null;
      entry.metrics=null;
      firstIncompleteFound=true;
    }
    const current=nodes.find(node=>progress.nodes[node.id]?.status==='available')||nodes[nodes.length-1]||null;
    progress.currentNodeId=String(current?.id||'');
    progress.updatedAt=Number(progress.updatedAt||now());
    return progress;
  }
  function read(course,userId=currentUserId()){
    let raw=null;
    try{raw=JSON.parse(localStorage.getItem(key(course.id,userId))||'null')}catch(error){raw=null}
    if(!raw){
      raw=migrateLegacy(course,userId);
      if(raw){
        try{localStorage.setItem(key(course.id,userId),JSON.stringify(raw))}catch(error){}
      }
    }
    return normalize(raw,course,userId);
  }
  function write(progress,course,userId=progress?.userId||currentUserId()){
    const normalized=normalize({...clone(progress),updatedAt:now()},course,userId);
    try{localStorage.setItem(key(course.id,userId),JSON.stringify(normalized))}catch(error){}
    try{global.dispatchEvent(new CustomEvent('kg:guided-learning-progress',{detail:{courseId:course.id,userId,progress:clone(normalized)}}))}catch(error){}
    return clone(normalized);
  }
  function completeNode(course,nodeId,options={},userId=currentUserId()){
    const progress=read(course,userId);
    const entry=progress.nodes[nodeId];
    if(!entry||entry.status==='locked')return progress;
    entry.status='completed';
    entry.completedAt=entry.completedAt||now();
    if(options.metrics&&typeof options.metrics==='object')entry.metrics=clone(options.metrics);
    const nextIndex=orderedNodes(course).findIndex(node=>String(node.id)===String(nodeId))+1;
    progress.currentNodeId=String(orderedNodes(course)[nextIndex]?.id||nodeId);
    try{
      global.KGLearningEventRepository?.append?.('GUIDED_NODE_COMPLETED',{
        courseId:course.id,
        nodeId,
        metrics:clone(entry.metrics)
      },{userId:String(userId||currentUserId())});
    }catch(error){}
    return write(progress,course,userId);
  }
  function nodesInScope(course,scopeType,scopeId){
    if(scopeType==='stage'){
      const partIds=new Set((course.parts||[]).filter(part=>part.stageId===scopeId).map(part=>part.id));
      return orderedNodes(course).filter(node=>partIds.has(node.partId));
    }
    if(scopeType==='part')return orderedNodes(course).filter(node=>node.partId===scopeId);
    return [];
  }
  function placementTestRecord(course,partId,userId=currentUserId()){
    return clone(read(course,userId).placementTests?.[String(partId||'')]||null);
  }
  function recordPlacementTestAttempt(course,partId,result={},userId=currentUserId()){
    const progress=read(course,userId);
    const key=String(partId||'');
    const previous=progress.placementTests[key]||{
      partId:key,attemptCount:0,passed:false,passedAt:null,bestCorrect:0,bestPercent:0,latest:null,history:[]
    };
    const total=Math.max(1,Number(result.total)||1);
    const correct=Math.max(0,Math.min(total,Number(result.correct)||0));
    const percent=Math.round(correct/total*100);
    const attempt={
      testId:String(result.testId||''),
      partId:key,
      correct,
      total,
      percent,
      passed:Boolean(result.passed),
      activeDurationSeconds:Math.max(1,Number(result.activeDurationSeconds)||1),
      completedAt:Number(result.completedAt||now()),
      answers:Array.isArray(result.answers)?clone(result.answers):[]
    };
    const history=[...(previous.history||[]),attempt].slice(-10);
    progress.placementTests[key]={
      partId:key,
      attemptCount:Number(previous.attemptCount||0)+1,
      passed:Boolean(previous.passed||attempt.passed),
      passedAt:previous.passedAt||(attempt.passed?attempt.completedAt:null),
      bestCorrect:Math.max(Number(previous.bestCorrect)||0,correct),
      bestPercent:Math.max(Number(previous.bestPercent)||0,percent),
      latest:attempt,
      history
    };
    try{
      global.KGLearningEventRepository?.append?.('GUIDED_PLACEMENT_TEST_COMPLETED',{
        courseId:course.id,partId:key,...clone(attempt)
      },{userId:String(userId||currentUserId())});
    }catch(error){}
    return write(progress,course,userId);
  }
  function completePartByPlacementTest(course,partId,result={},userId=currentUserId()){
    let progress=recordPlacementTestAttempt(course,partId,{...result,passed:true},userId);
    const completedAt=Number(result.completedAt||now());
    nodesInScope(course,'part',partId).forEach(node=>{
      const entry=progress.nodes[node.id];
      if(entry?.status==='completed')return;
      progress.nodes[node.id]={status:'completed',completedAt,metrics:null};
    });
    try{
      global.KGLearningEventRepository?.append?.('GUIDED_PLACEMENT_TEST_PASSED',{
        courseId:course.id,partId:String(partId||''),testId:String(result.testId||''),
        correct:Number(result.correct)||0,total:Number(result.total)||0
      },{userId:String(userId||currentUserId())});
    }catch(error){}
    return write(progress,course,userId);
  }
  function completeScopeByTest(course,scopeType,scopeId,userId=currentUserId()){
    if(scopeType==='part'){
      const config=course?.placementTests?.[scopeId]||{};
      return completePartByPlacementTest(course,scopeId,{
        testId:config.id||String(scopeId)+'-placement-test',
        correct:Number(config.requiredCorrect)||Number(config.expectedActivityCount)||1,
        total:Number(config.expectedActivityCount)||1,
        passed:true,
        activeDurationSeconds:1
      },userId);
    }
    const progress=read(course,userId);
    const completedAt=now();
    nodesInScope(course,scopeType,scopeId).forEach(node=>{
      if(progress.nodes[node.id]?.status==='completed')return;
      progress.nodes[node.id]={status:'completed',completedAt,metrics:null};
    });
    return write(progress,course,userId);
  }
  function resetCourse(course,userId=currentUserId()){return write(empty(course,userId),course,userId)}
  function summary(course,progress=read(course)){
    const nodes=orderedNodes(course);
    const completed=nodes.filter(node=>progress.nodes[node.id]?.status==='completed').length;
    return {completed,total:nodes.length,percent:nodes.length?Math.round(completed/nodes.length*100):0,done:completed===nodes.length};
  }
  function stageSummary(course,stageId,progress=read(course)){
    const partIds=new Set((course.parts||[]).filter(part=>part.stageId===stageId).map(part=>part.id));
    const nodes=orderedNodes(course).filter(node=>partIds.has(node.partId));
    const completed=nodes.filter(node=>progress.nodes[node.id]?.status==='completed').length;
    return {completed,total:nodes.length,done:nodes.length>0&&completed===nodes.length,percent:nodes.length?Math.round(completed/nodes.length*100):0};
  }
  function partSummary(course,partId,progress=read(course)){
    const nodes=orderedNodes(course).filter(node=>node.partId===partId);
    const completed=nodes.filter(node=>progress.nodes[node.id]?.status==='completed').length;
    return {
      completed,total:nodes.length,done:nodes.length>0&&completed===nodes.length,
      percent:nodes.length?Math.round(completed/nodes.length*100):0
    };
  }
  function defaultMode(){try{return localStorage.getItem(DEFAULT_MODE_KEY)==='free'?'free':'learning'}catch(error){return 'learning'}}
  function setDefaultMode(mode){const value=mode==='free'?'free':'learning';try{localStorage.setItem(DEFAULT_MODE_KEY,value)}catch(error){}return value}

  global.KGGuidedLearningStore=Object.freeze({
    PREFIX,
    DEFAULT_MODE_KEY,
    currentUserId,
    read,
    write,
    completeNode,
    completeScopeByTest,
    recordPlacementTestAttempt,
    completePartByPlacementTest,
    placementTestRecord,
    resetCourse,
    summary,
    stageSummary,
    partSummary,
    defaultMode,
    setDefaultMode
  });
})(window);
